/** The handful of things this computer remembers about how somebody likes to
 *  work.
 *
 * Next to `recents.ts` because it is the same kind of thing — a small file the
 * app keeps about a person, which that person could open and read — and it
 * follows the same three rules: read once at startup, written whole and
 * atomically, and never a source of errors. A preferences file that cannot be
 * read is the defaults, and a preferences file that cannot be written is a
 * setting that will not survive the quit. Neither is worth a sentence in front
 * of anybody.
 *
 * ## Why there is only one setting in here
 *
 * Because there is only one. "Show me" is sticky once set (BACKLOG D1) and
 * everything else the product does, it decides for itself. A preferences screen
 * is a place to put decisions we could not make, and the whole argument of this
 * product is that we make them.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

import type { ModelChoice, ThinkingLevel } from '../lib/ipc';
import { asTrusted, sameTrusted, type Trusted } from './carried';
import { asKept, sameKept, type Kept } from './kept';

export { keeping, type Kept } from './kept';

/** Everything a person can change about the app itself. */
export type Preferences = {
  /**
   * Name the real thing behind each action — the command, the path, the git
   * operation.
   *
   * Off by default, and that default is load-bearing. On, this is a second line
   * of machinery under every step; for the audience this product exists for,
   * that is the exact texture of the tools they came here to avoid.
   */
  showMe: boolean;
  /**
   * The model chosen to work with, or null for "whatever is available".
   *
   * Null is the honest default: with no choice made, every session starts with
   * whatever the connected account makes available, and the window shows the
   * full list so a choice is never more than one click away.
   */
  model: ModelChoice | null;
  /** How much time each model should take before it answers. The map is keyed
   * by its provider and model id because different models support different
   * choices. */
  thinking: Readonly<Record<string, ThinkingLevel>>;
  /**
   * Versions somebody chose to keep at the top of the rail, by project folder.
   *
   * A view preference rather than history: keeping one changes what the rail
   * shows first and nothing about the project, so it belongs here rather than
   * in the timeline. Keyed by folder, because two projects sharing a shelf
   * would put yesterday's other job at the top of today's.
   */
  kept: Kept;
  /**
   * Extensions a project brought with it that somebody has said yes to, by
   * project folder.
   *
   * Nothing is trusted by default: an extension is code loaded into the agent's
   * own process, and cloning a repository is not choosing to run what is in it.
   * The id carries a fingerprint of the code, so a yes stops covering it as
   * soon as it changes — which is the whole reason this is not one flag per
   * folder.
   */
  trusted: Trusted;
  /**
   * Show everything the project holds, beside the conversation.
   *
   * Off by default for the same reason `showMe` is: every other tool of this
   * kind opens on a file tree, and that is precisely what makes them unusable
   * on the first morning. Sticky once somebody asks for it, because somebody
   * who asked once is asking for good.
   */
  showFiles: boolean;
  /**
   * Do the work in a copy first, and show it before it reaches the files.
   *
   * Off by default because the promise the product already keeps — every moment
   * is saved, going back is one press — makes work landing straight away safe.
   * On, for the people whose files are shared with somebody else and who would
   * rather look first.
   */
  holdBack: boolean;
};

export const defaultPreferences: Preferences = {
  showMe: false,
  model: null,
  thinking: {},
  kept: {},
  trusted: {},
  showFiles: false,
  holdBack: false,
};

type Stored = { version: 1; preferences: Preferences };

function asPreferences(value: unknown): Preferences {
  if (typeof value !== 'object' || value === null) return { ...defaultPreferences };
  const raw = (value as { preferences?: unknown }).preferences;
  if (typeof raw !== 'object' || raw === null) return { ...defaultPreferences };
  const record = raw as Record<string, unknown>;
  const showMe = record['showMe'];
  const model = record['model'];
  const rawThinking = record['thinking'];
  const thinking: Record<string, ThinkingLevel> = {};
  const levels = new Set<ThinkingLevel>(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
  if (typeof rawThinking === 'object' && rawThinking !== null && !Array.isArray(rawThinking)) {
    for (const [key, level] of Object.entries(rawThinking)) {
      if (typeof level === 'string' && levels.has(level as ThinkingLevel)) {
        thinking[key] = level as ThinkingLevel;
      }
    }
  }
  return {
    showMe: showMe === true,
    model:
      typeof model === 'object' &&
      model !== null &&
      typeof (model as Record<string, unknown>)['providerId'] === 'string' &&
      typeof (model as Record<string, unknown>)['modelId'] === 'string'
        ? {
            providerId: (model as Record<string, unknown>)['providerId'] as string,
            modelId: (model as Record<string, unknown>)['modelId'] as string,
          }
        : null,
    thinking,
    kept: asKept(record['kept']),
    trusted: asTrusted(record['trusted']),
    showFiles: record['showFiles'] === true,
    holdBack: record['holdBack'] === true,
  };
}

function sameThinking(
  left: Readonly<Record<string, ThinkingLevel>>,
  right: Readonly<Record<string, ThinkingLevel>>,
): boolean {
  const leftEntries = Object.entries(left);
  if (leftEntries.length !== Object.keys(right).length) return false;
  return leftEntries.every(([key, level]) => right[key] === level);
}

export class PreferenceFile {
  #preferences: Preferences = { ...defaultPreferences };

  private constructor(private readonly file: string) {}

  static async open(file: string): Promise<PreferenceFile> {
    const preferences = new PreferenceFile(resolve(file));
    await preferences.#read();
    return preferences;
  }

  /** A copy, so nothing outside can change what is about to be written. */
  all(): Preferences {
    return { ...this.#preferences };
  }

  /** Change some of them and keep the rest. Returns the whole set, because the
   *  caller is about to send it to the window and a partial answer would mean
   *  the window has to remember what it did not ask about. */
  async change(some: Partial<Preferences>): Promise<Preferences> {
    const next: Preferences = { ...this.#preferences, ...some };
    const unchanged =
      next.showMe === this.#preferences.showMe &&
      next.showFiles === this.#preferences.showFiles &&
      next.holdBack === this.#preferences.holdBack &&
      next.model?.providerId === this.#preferences.model?.providerId &&
      next.model?.modelId === this.#preferences.model?.modelId &&
      sameThinking(next.thinking, this.#preferences.thinking) &&
      sameKept(next.kept, this.#preferences.kept) &&
      sameTrusted(next.trusted, this.#preferences.trusted);
    if (unchanged) return this.all();
    this.#preferences = next;
    await this.#write();
    return this.all();
  }

  async #read(): Promise<void> {
    try {
      this.#preferences = asPreferences(JSON.parse(await readFile(this.file, 'utf8')));
    } catch {
      this.#preferences = { ...defaultPreferences };
    }
  }

  async #write(): Promise<void> {
    const stored: Stored = { version: 1, preferences: this.#preferences };
    const temporary = join(dirname(this.file), `.${basename(this.file)}.writing`);
    try {
      await mkdir(dirname(this.file), { recursive: true });
      await writeFile(temporary, `${JSON.stringify(stored, null, 2)}\n`, 'utf8');
      await rename(temporary, this.file);
    } catch {
      // The setting will not survive the quit, and nothing else changes.
    }
  }
}
