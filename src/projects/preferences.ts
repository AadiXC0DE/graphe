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

import { defaultAppearance, readAppearance, type Appearance } from '../design/appearance';
import type { Money } from '../agent/types';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

import { asAdvisor, asAdvisorThinking, sameAdvisor } from '../agent/advisor';
import type { ModelChoice, ThinkingLevel } from '../lib/ipc';
import type { Theme } from '../lib/theme';
import { themeFrom } from '../lib/theme';
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
  /**
   * The model asked about the hard parts, or null for one model doing all of
   * it.
   *
   * Global like `model`, and for the same reason: this is a reading of what
   * somebody is willing to spend on a second opinion, and they are the same
   * person in every folder.
   */
  advisor: ModelChoice | null;
  advisorThinking: ThinkingLevel | null;
  /**
   * The two gates the advisor can hold, both off unless somebody turns them on.
   *
   * Asking a second model before saying a job is done turns "finish" into
   * "report" — the model does the work, is handed a list of everything not yet
   * proven, and writes a status update instead of finishing. Asking every time
   * a command repeats fires on running the tests three times. Neither was ever
   * somebody's decision; both are theirs now.
   */
  advisorGates: { completionGate: boolean; loopGate: boolean };
  /**
   * Whether add-ons that start turns of their own keep their hooks.
   *
   * On, because Graphe ships a shelf of them and an app that installs something
   * and then quietly disables half of it is worse than one that never offered
   * it. The reason to take the hooks away was that two things deciding when a
   * turn begins is a bug — but the Continuation Authority handles an add-on
   * asking for a turn as one more reason among its own, counts it against the
   * same budget and names it. So it can be let through.
   */
  addons: 'on' | 'tools-only';
  /** How the app looks, as a set of token overrides — accent, tone, contrast,
   *  radius, density, fonts, motion. Five colour presets were the whole of it
   *  before, and a preset is somebody else's taste. */
  appearance: Appearance;
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
   * Whether each project holds work back to be looked at first, keyed by its
   * path.
   *
   * Per project, so saying "ask me first" in one folder never changes another:
   * what a designer decides for a shared codebase they do not own is not what
   * they want for their own. On where nothing has been said: work that has not
   * moved the page is let through without a word, so being asked means
   * something moved rather than that a turn finished.
   *
   * Read it through `holdsBack`, never by hand — absent is off, and a `true`
   * here is somebody having turned it on.
   */
  heldBack: Readonly<Record<string, boolean>>;
  /**
   * Whether each project's browser keeps its logins between sittings, by path.
   *
   * Off where nothing has been said: a browser that remembers is a browser
   * holding somebody's signed-in accounts on this disk, and that is a thing to
   * turn on rather than a thing to discover. Read it through `keepsLogins`.
   */
  keptLogins: Readonly<Record<string, boolean>>;
  /**
   * How much a picture has to move before work is stopped, by id.
   *
   * One of `HOW_MUCH` in `src/design/gate.ts`, or null for the middle one. Not
   * per project: it is a reading of how fussy somebody is, and they are the
   * same person in every folder.
   */
  howMuch: string | null;
  /**
   * The ceiling on spending, or null when nobody has set one.
   *
   * Remembered across launches, because a ceiling that forgets itself the
   * moment you close the window is not a ceiling. What has been spent is not
   * remembered with it — that is per sitting, and measuring a month against one
   * afternoon would hold nobody to anything.
   */
  ceiling: Money | null;
  /** Which finishing the window wears. 'system' follows the computer;
   *  any other value is stamped as data-theme and wins over the media query. */
  theme: Theme;
};

/** Every field, because an appearance is small and comparing it wrongly means
 *  a change that never reaches the disk. */
function sameAppearance(one: Appearance, other: Appearance): boolean {
  return (
    one.accent === other.accent &&
    one.tone === other.tone &&
    one.contrast === other.contrast &&
    one.radius === other.radius &&
    one.density === other.density &&
    one.uiFont === other.uiFont &&
    one.codeFont === other.codeFont &&
    one.ligatures === other.ligatures &&
    one.motion === other.motion
  );
}

/** Both gates off unless the file says otherwise, and anything unreadable is
 *  off too: a gate that turns itself on because a file was half-written is the
 *  failure this exists to stop. */
function asGates(raw: unknown): { completionGate: boolean; loopGate: boolean } {
  if (typeof raw !== 'object' || raw === null) return { completionGate: false, loopGate: false };
  const one = raw as Record<string, unknown>;
  return { completionGate: one['completionGate'] === true, loopGate: one['loopGate'] === true };
}

export const defaultPreferences: Preferences = {
  showMe: false,
  model: null,
  advisor: null,
  advisorThinking: null,
  advisorGates: { completionGate: false, loopGate: false },
  addons: 'on',
  appearance: defaultAppearance,
  thinking: {},
  kept: {},
  trusted: {},
  showFiles: false,
  heldBack: {},
  keptLogins: {},
  howMuch: null,
  ceiling: null,
  theme: 'system',
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
    advisor: asAdvisor(record['advisor']),
    advisorThinking: asAdvisorThinking(record['advisorThinking']),
    advisorGates: asGates(record['advisorGates']),
    addons: record['addons'] === 'tools-only' ? 'tools-only' : 'on',
    appearance: readAppearance(record['appearance']),
    thinking,
    kept: asKept(record['kept']),
    trusted: asTrusted(record['trusted']),
    showFiles: record['showFiles'] === true,
    heldBack: asHeldBack(record['heldBack']),
    keptLogins: asHeldBack(record['keptLogins']),
    howMuch: typeof record['howMuch'] === 'string' ? record['howMuch'] : null,
    ceiling: asCeiling(record['ceiling']),
    theme: themeFrom(record['theme']),
  };
}

/** Read back defensively: a file edited by hand must not become a ceiling of
 *  NaN, which would hold nobody to anything. */
function asCeiling(value: unknown): Money | null {
  if (typeof value !== 'object' || value === null) return null;
  const money = value as Record<string, unknown>;
  const minor = money['minor'];
  const currency = money['currency'];
  if (typeof minor !== 'number' || !Number.isFinite(minor) || minor <= 0) return null;
  if (typeof currency !== 'string' || currency === '') return null;
  return { minor: Math.round(minor), currency };
}


/** A held-back map from whatever a file held. Both answers are kept: a `false`
 *  is somebody having turned it off, and dropping it would turn it back on at
 *  the next launch. Anything that is not a folder-name/boolean pair is dropped
 *  rather than refused — a preference that will not load is worse than one that
 *  loads short. */
function asHeldBack(value: unknown): Readonly<Record<string, boolean>> {
  const out: Record<string, boolean> = {};
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    for (const [path, on] of Object.entries(value)) {
      if (path !== '' && typeof on === 'boolean') out[path] = on;
    }
  }
  return out;
}

/** Two ceilings are the same when they are both unset, or say the same amount
 *  in the same currency. */
function sameCeiling(one: Money | null, other: Money | null): boolean {
  if (one === null || other === null) return one === other;
  return one.minor === other.minor && one.currency === other.currency;
}

/** Two held-back maps are the same when they say the same about every project.
 *  Literally: a choice that happens to match the default is still a choice
 *  somebody made, and is written down so it survives the default changing. */
function sameHeldBack(one: Readonly<Record<string, boolean>>, other: Readonly<Record<string, boolean>>): boolean {
  const every = new Set([...Object.keys(one), ...Object.keys(other)]);
  return [...every].every((key) => one[key] === other[key]);
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
      next.howMuch === this.#preferences.howMuch &&
      sameHeldBack(next.heldBack, this.#preferences.heldBack) &&
      sameHeldBack(next.keptLogins, this.#preferences.keptLogins) &&
      next.model?.providerId === this.#preferences.model?.providerId &&
      next.model?.modelId === this.#preferences.model?.modelId &&
      sameAdvisor(next.advisor, this.#preferences.advisor) &&
      next.advisorThinking === this.#preferences.advisorThinking &&
      next.advisorGates.completionGate === this.#preferences.advisorGates.completionGate &&
      next.advisorGates.loopGate === this.#preferences.advisorGates.loopGate &&
      next.addons === this.#preferences.addons &&
      sameAppearance(next.appearance, this.#preferences.appearance) &&
      sameThinking(next.thinking, this.#preferences.thinking) &&
      sameKept(next.kept, this.#preferences.kept) &&
      sameTrusted(next.trusted, this.#preferences.trusted) &&
      next.theme === this.#preferences.theme &&
      // Left out, a ceiling was the one preference that never reached the file:
      // nothing else about it had changed, so nothing was written, and it was
      // gone by the next launch while the window still said it was set.
      sameCeiling(next.ceiling, this.#preferences.ceiling);
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
