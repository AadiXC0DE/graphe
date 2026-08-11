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
 *
 * The same copy carries `Workbench` at the foot of the file, where the pieces
 * are not two goes at one change but several separate ones at once.
 */

import path from 'node:path';
import { mkdir, rm } from 'node:fs/promises';

import { ProjectHistory, HistoryError, historyProblems } from './repo';
import { AT_A_TIME, nextUp, roomLeft, type WorkState } from '../work/board';

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

/* ========================================================================== */
/* Several things at once                                                      */
/* ========================================================================== */

/** One piece of work on the board. */
export type PieceOfWork = {
  id: string;
  /** One sentence: what this piece of work is doing. */
  doing: string;
  state: WorkState;
  /** Its own copy of the project. Null until its turn comes, and again once it
   *  has been let go. */
  folder: string | null;
  /** What it ended at, once it has finished. */
  version: string | null;
  /** A picture of the result, when there is one. */
  picture: string | null;
  /** When it was asked for, epoch ms. */
  at: number;
  /** Why it stopped, in a sentence somebody can read. */
  trouble: string | null;
};

/** Where one piece of work's copy lives: its own folder inside the room, so
 *  letting one go never reaches anything but that one. */
export function folderForWork(under: string, id: string): string {
  return path.join(under, safeName(id));
}

/**
 * A board of separate pieces of work, each in its own copy of the project.
 *
 * The caller runs whatever it likes inside each `folder`. This owns how many go
 * at once, who is next when a slot frees up, which copy belongs to which piece
 * of work, and — the part that has to be right — that letting one go can only
 * ever remove that one's copy.
 */
export class Workbench {
  private readonly history: ProjectHistory;
  private readonly under: string;
  private readonly most: number;
  private readonly work: PieceOfWork[] = [];
  private asked = 0;

  constructor(options: {
    history: ProjectHistory;
    /** Somewhere outside the project to keep the copies. */
    under: string;
    /** How many go side by side. Never more than the module's own bound. */
    atOnce?: number;
  }) {
    this.history = options.history;
    this.under = options.under;
    this.most = Math.max(1, Math.min(AT_A_TIME, options.atOnce ?? AT_A_TIME));
  }

  get pieces(): readonly PieceOfWork[] {
    return this.work;
  }

  /** How many go side by side here. */
  get atOnce(): number {
    return this.most;
  }

  /** How many could start right now. Zero means the next one asked for waits. */
  get roomLeft(): number {
    return roomLeft(this.work, this.most);
  }

  /** Ask for another piece of work. Past the cap it waits its turn rather than
   *  being refused — nobody's request is ever thrown away. */
  ask(doing: string, options: { id?: string; at?: number } = {}): PieceOfWork {
    this.asked += 1;
    const piece: PieceOfWork = {
      id: this.freeId(options.id ?? `work-${String(this.asked)}`),
      doing: doing.trim(),
      state: 'waiting',
      folder: null,
      version: null,
      picture: null,
      at: options.at ?? Date.now(),
      trouble: null,
    };
    this.work.push(piece);
    return piece;
  }

  /**
   * Start as many waiting pieces as there is room for, and hand back the ones
   * that just began. Called again whenever a slot frees up.
   *
   * The project must have nothing unsaved, for the same reason a set of tries
   * does: a piece of work starts from a version, and starting from a
   * half-finished state would make keeping one mean losing that work.
   */
  async begin(): Promise<readonly PieceOfWork[]> {
    const wanted = nextUp(this.work, this.most);
    if (wanted.length === 0) return [];

    if (await this.history.hasUnsavedChanges()) {
      throw new HistoryError(historyProblems.unsavedFirst);
    }
    const from = await this.history.currentVersion();
    if (from === null) throw new HistoryError(historyProblems.tryFailed);

    const began: PieceOfWork[] = [];
    for (const piece of wanted) {
      const folder = folderForWork(this.under, piece.id);
      try {
        await mkdir(path.dirname(folder), { recursive: true });
        await this.history.addWorkspace(folder, from);
      } catch (cause) {
        // One copy failing is that piece's problem and not the board's — the
        // others carry on, and this one says so rather than disappearing.
        piece.state = 'failed';
        piece.trouble = cause instanceof HistoryError ? cause.message : historyProblems.tryFailed;
        continue;
      }
      piece.folder = folder;
      piece.state = 'running';
      began.push(piece);
    }
    return began;
  }

  /** What one piece of work ended at, saved inside its own copy. Null when it
   *  changed nothing, which is a real answer and not a failure. */
  async settle(id: string, title: string): Promise<string | null> {
    const piece = this.find(id);
    if (piece === undefined || piece.folder === null) return null;
    const inside = new ProjectHistory(piece.folder);
    const version = await inside.snapshot(title);
    piece.version = version;
    piece.state = 'done';
    return version;
  }

  /** It did not work. The copy stays until somebody throws it away, so whatever
   *  it did get to is still there to look at. */
  stopped(id: string, trouble: string): void {
    const piece = this.find(id);
    if (piece === undefined) return;
    piece.state = 'failed';
    piece.trouble = trouble;
  }

  /** What this one's result looks like. */
  showPicture(id: string, picture: string): void {
    const piece = this.find(id);
    if (piece === undefined) return;
    piece.picture = picture;
  }

  /**
   * Keep one, and put the project's files where that piece of work left them.
   *
   * `restoreTo` again, so this is a version like any other and undoable like any
   * other. The rest of the board carries on: they were never alternatives to
   * this one, they were other work.
   */
  async keep(id: string, title: string): Promise<string | null> {
    const piece = this.find(id);
    if (piece === undefined || piece.version === null) return null;
    const version = await this.history.restoreTo(piece.version, title);
    await this.drop(id);
    return version;
  }

  /** Let one go, whatever state it was in. Safe to call twice. */
  async drop(id: string): Promise<void> {
    const at = this.work.findIndex((one) => one.id === id);
    if (at < 0) return;
    const [piece] = this.work.splice(at, 1);
    if (piece !== undefined) await this.letGo(piece);
  }

  /** Clear the board. The project is left exactly as it was. */
  async clear(): Promise<void> {
    const all = this.work.splice(0, this.work.length);
    for (const piece of all) await this.letGo(piece);
  }

  private find(id: string): PieceOfWork | undefined {
    return this.work.find((one) => one.id === id);
  }

  private freeId(wanted: string): string {
    const clean = safeName(wanted);
    if (this.find(clean) === undefined) return clean;
    return `${clean}-${String(this.asked)}`;
  }

  /** The one dangerous moment in the file, kept in one place: a copy is only
   *  ever removed from inside the room we made it in, so nothing here can reach
   *  the folder somebody is looking at. */
  private async letGo(piece: PieceOfWork): Promise<void> {
    const folder = piece.folder;
    piece.folder = null;
    if (folder === null || !insideRoom(this.under, folder)) return;
    await this.history.removeWorkspace(folder);
    await rm(folder, { recursive: true, force: true });
  }
}

function safeName(id: string): string {
  const clean = id
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return clean.length > 0 ? clean : 'work';
}

function insideRoom(under: string, folder: string): boolean {
  const relative = path.relative(path.resolve(under), path.resolve(folder));
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}
