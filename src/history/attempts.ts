/** Trying a change two ways, and keeping the one that looks right.
 *
 * A designer asks for two versions of something constantly, and no coding agent
 * does it well. Underneath, each attempt is a second working copy of the project
 * sharing its history, so nothing either attempt does can touch the files on
 * screen — and whichever one is kept is adopted by the same call that puts an
 * old version back, because an attempt's result is just a version.
 *
 * The words here never say so. An attempt is "a try"; keeping one is "use this
 * one"; the rest go away.
 */

import path from 'node:path';
import { mkdir, rm } from 'node:fs/promises';

import { ProjectHistory, HistoryError, historyProblems } from './repo';

/** One try, and where it is being made. */
export type Attempt = {
  id: string;
  /** "First try", "Second try" — what the two columns are called. */
  name: string;
  /** The folder this attempt's copy of the project lives in. */
  folder: string;
  /** What it ended up at, once it has finished. Null while it is still going. */
  version: string | null;
};

/** As many as anyone can actually compare. Two is the ask; three is the most a
 *  person will look at properly, and past that it is a gallery, not a choice. */
export const MOST_TRIES = 3;

const ORDINALS = ['First', 'Second', 'Third'] as const;

/** What each try is called. Ordinals rather than A/B, because a designer says
 *  "the second one". */
export function nameOfTry(index: number): string {
  return `${ORDINALS[index] ?? `Try ${index + 1}`} try`;
}

/** Where the copies live: outside the project, so nothing an attempt writes can
 *  ever appear in the folder somebody is looking at. */
export function folderForTry(under: string, id: string, index: number): string {
  return path.join(under, id, String(index + 1));
}

/** The sentence above the two columns. */
export function saysTries(count: number): string {
  return count === 2
    ? 'Two ways of doing it. Look at both, then keep the one you want.'
    : `${count} ways of doing it. Look at each, then keep the one you want.`;
}

/** The title of the version that keeping one produces. */
export function saysKept(name: string, asked: string | null): string {
  const which = name.toLowerCase();
  return asked === null || asked.trim() === ''
    ? `Kept the ${which}`
    : `${asked.trim()} — kept the ${which}`;
}

export const tryWords = {
  start: 'Try it two ways',
  keep: 'Use this one',
  discard: 'Throw both away',
  running: 'Trying it two ways. They are being made side by side.',
  nothingKept: 'Both thrown away. Your project is exactly as it was.',
} as const;

/**
 * Two or three copies of a project, made from the same starting point.
 *
 * The caller runs whatever it likes inside each `folder` — that is the agent's
 * business, not this module's. All this owns is making the copies, finding what
 * each one ended at, adopting one, and leaving nothing behind.
 */
export class Tries {
  readonly attempts: readonly Attempt[];

  private readonly history: ProjectHistory;
  private readonly under: string;
  private done = false;

  private constructor(history: ProjectHistory, under: string, attempts: Attempt[]) {
    this.history = history;
    this.under = under;
    this.attempts = attempts;
  }

  /**
   * Start a set of tries from where the project stands now.
   *
   * The project must have nothing unsaved: an attempt starts from a version, and
   * starting from a half-finished state would make "keep this one" mean throwing
   * away work nobody chose to throw away. The caller saves first.
   */
  static async start(options: {
    history: ProjectHistory;
    /** Somewhere outside the project to keep the copies. */
    under: string;
    id: string;
    count: number;
  }): Promise<Tries> {
    const count = Math.max(2, Math.min(MOST_TRIES, options.count));
    if (await options.history.hasUnsavedChanges()) {
      throw new HistoryError(historyProblems.unsavedFirst);
    }

    const from = await options.history.currentVersion();
    if (from === null) throw new HistoryError(historyProblems.tryFailed);

    const made: Attempt[] = [];
    try {
      for (let index = 0; index < count; index += 1) {
        const folder = folderForTry(options.under, options.id, index);
        await mkdir(path.dirname(folder), { recursive: true });
        await options.history.addWorkspace(folder, from);
        made.push({
          id: `${options.id}-${index + 1}`,
          name: nameOfTry(index),
          folder,
          version: null,
        });
      }
    } catch (cause) {
      // All or nothing: half a comparison is worse than none, and a folder left
      // behind is a folder somebody finds later and cannot explain.
      for (const attempt of made) await options.history.removeWorkspace(attempt.folder);
      throw cause;
    }

    return new Tries(options.history, options.under, made);
  }

  /** What one try ended at, saved inside its own copy. Null when it changed
   *  nothing, which is a real answer and not a failure. */
  async settle(attemptId: string, title: string): Promise<string | null> {
    const attempt = this.attempts.find((one) => one.id === attemptId);
    if (attempt === undefined) return null;
    const inside = new ProjectHistory(attempt.folder);
    const version = await inside.snapshot(title);
    attempt.version = version;
    return version;
  }

  /**
   * Keep one, and put the project's files where that try left them.
   *
   * `restoreTo` does the work, because adopting a try and going back to an
   * earlier version are the same act: take that set of files, record it as a
   * new version, rewrite nothing. Which is also why this is undoable.
   */
  async keep(attemptId: string, title: string): Promise<string | null> {
    const attempt = this.attempts.find((one) => one.id === attemptId);
    if (attempt === undefined || attempt.version === null) return null;
    const id = await this.history.restoreTo(attempt.version, title);
    await this.finish();
    return id;
  }

  /** Throw them all away. The project is left exactly as it was. */
  async discard(): Promise<void> {
    await this.finish();
  }

  private async finish(): Promise<void> {
    if (this.done) return;
    this.done = true;
    for (const attempt of this.attempts) {
      await this.history.removeWorkspace(attempt.folder);
    }
    await rm(path.dirname(this.attempts[0]?.folder ?? this.under), {
      recursive: true,
      force: true,
    });
  }
}
