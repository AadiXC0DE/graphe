/** The projects this computer remembers.
 *
 * BACKLOG A4: the folder was asked for on every launch and forgotten on quit,
 * which is the smallest possible way to tell somebody their work is not
 * important enough to keep track of. A file with a list in it fixes that.
 *
 * ## Why a plain file, read once and written whole
 *
 * The list is a dozen entries at most and it changes when a person opens a
 * folder — a few times an hour, not a few times a second. Anything with an index
 * or a schema would be a database for a list you could read aloud. So: one JSON
 * file, held in memory for the life of the process, written atomically whenever
 * it changes.
 *
 * Atomically matters more than it looks. The write happens on quit as well as on
 * open, and a half-written file is the one failure mode that would lose the
 * whole list rather than one entry of it. Writing beside the target and renaming
 * over it means the file on disk is always either the old list or the new one.
 *
 * ## Nothing here throws
 *
 * A corrupt file, a file somebody edited by hand, a file with a number where a
 * string should be, a disk that will not accept a write: none of those are
 * things a designer did, and none of them are worth a sentence in front of one.
 * A list that cannot be read is an empty list, and a list that cannot be written
 * is a list that will not survive the quit — both of which leave the app exactly
 * as usable as it was before this file existed.
 *
 * ## What is not stored
 *
 * Anything said in the conversation, and anything about what is inside the
 * folder. This is a list of places, when they were last visited, and what was
 * spent there. It is small on purpose: a file the app keeps about a person
 * should be a file they could read.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

import type { Money } from '../agent/types';

/** One project, as the picker shows it. */
export type RememberedProject = {
  /** Absolute path. The identity of the project — everything else can change. */
  path: string;
  /** What the person calls it. The folder's own name, unless they renamed it. */
  name: string;
  /** Epoch ms. The list is ordered by this, newest first. */
  lastOpenedAt: number;
  /** What the last sitting in this folder cost, or null if nothing was spent.
   *  Shown quietly beside the name so opening a project is not the first time
   *  you find out what the last visit came to. */
  lastSpend: Money | null;
};

/** How many are worth keeping. Past a dozen the list stops being "where was I"
 *  and becomes a filing cabinet, which is a different feature with a different
 *  interface. The oldest fall off the end. */
export const MOST_REMEMBERED = 12;

/** The shape on disk. Versioned from the first day, because the alternative is
 *  guessing later whether an unrecognised file is old or broken. */
type StoredList = {
  version: 1;
  projects: RememberedProject[];
};

function isMoney(value: unknown): value is Money {
  if (typeof value !== 'object' || value === null) return false;
  const { minor, currency } = value as { minor?: unknown; currency?: unknown };
  return typeof minor === 'number' && Number.isFinite(minor) && typeof currency === 'string';
}

/** One entry, or null if it is not one. Every field is checked because this file
 *  is on the user's disk and nothing stops them, or anything else, editing it. */
function asProject(value: unknown): RememberedProject | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;

  const path = raw['path'];
  if (typeof path !== 'string' || path.trim() === '' || !isAbsolute(path)) return null;

  const name = typeof raw['name'] === 'string' && raw['name'].trim() !== '' ? raw['name'] : null;
  const at = raw['lastOpenedAt'];

  return {
    path: resolve(path),
    name: name ?? nameOf(path),
    lastOpenedAt: typeof at === 'number' && Number.isFinite(at) ? at : 0,
    lastSpend: isMoney(raw['lastSpend']) ? raw['lastSpend'] : null,
  };
}

/** The folder's own name, which is what people call their project. Falls back to
 *  the whole path for the pathological cases — a drive root, a trailing slash. */
export function nameOf(path: string): string {
  const base = basename(resolve(path));
  return base === '' ? path : base;
}

function newestFirst(a: RememberedProject, b: RememberedProject): number {
  return b.lastOpenedAt - a.lastOpenedAt;
}

export class Recents {
  #projects: RememberedProject[] = [];

  private constructor(private readonly file: string) {}

  /** Read the list, or start an empty one. Never fails: the app has to open
   *  whether or not this file made sense. */
  static async open(file: string): Promise<Recents> {
    const recents = new Recents(resolve(file));
    await recents.#read();
    return recents;
  }

  /** Newest first, which is the order the picker reads in. A copy, so nothing
   *  outside can quietly reorder the list we are about to write. */
  list(): readonly RememberedProject[] {
    return [...this.#projects];
  }

  /** The one that was open last, or null on a first launch. */
  mostRecent(): RememberedProject | null {
    return this.#projects[0] ?? null;
  }

  /** Move this project to the top, adding it if it is new.
   *
   *  Keeps whatever we already knew about it — the spend from its last sitting
   *  belongs to the folder, not to the visit, and losing it every time somebody
   *  reopens a project would make the number worse than useless. */
  async remember(project: { path: string; name?: string }, at = Date.now()): Promise<void> {
    const path = resolve(project.path);
    const known = this.#projects.find((one) => one.path === path);

    const entry: RememberedProject = {
      path,
      name: project.name?.trim() || known?.name || nameOf(path),
      lastOpenedAt: at,
      lastSpend: known?.lastSpend ?? null,
    };

    this.#projects = [entry, ...this.#projects.filter((one) => one.path !== path)].slice(
      0,
      MOST_REMEMBERED,
    );
    await this.#write();
  }

  /** What this project's sitting came to. Ignored for a project we have never
   *  heard of — spend without a visit cannot happen, and inventing the entry
   *  would put a project in the list that nobody opened. */
  async recordSpend(path: string, spent: Money | null): Promise<void> {
    const target = resolve(path);
    let changed = false;
    this.#projects = this.#projects.map((one) => {
      if (one.path !== target) return one;
      changed = true;
      return { ...one, lastSpend: spent };
    });
    if (changed) await this.#write();
  }

  /** Take it off the list. The folder itself is never touched — this is the
   *  answer to "I cannot find that folder any more", and a feature that deleted
   *  something in response to that sentence would be a catastrophe. */
  async forget(path: string): Promise<void> {
    const target = resolve(path);
    const before = this.#projects.length;
    this.#projects = this.#projects.filter((one) => one.path !== target);
    if (this.#projects.length !== before) await this.#write();
  }

  async #read(): Promise<void> {
    let text: string;
    try {
      text = await readFile(this.file, 'utf8');
    } catch {
      return; // Never opened before, or unreadable. Both are an empty list.
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return;
    }

    const projects = (parsed as Partial<StoredList> | null)?.projects;
    if (!Array.isArray(projects)) return;

    const seen = new Set<string>();
    const kept: RememberedProject[] = [];
    for (const candidate of projects) {
      const project = asProject(candidate);
      if (project === null || seen.has(project.path)) continue;
      seen.add(project.path);
      kept.push(project);
    }
    this.#projects = kept.sort(newestFirst).slice(0, MOST_REMEMBERED);
  }

  /** Beside the target, then renamed over it, so the file on disk is always a
   *  whole list. A failure here is silent by design — see the note at the top. */
  async #write(): Promise<void> {
    const stored: StoredList = { version: 1, projects: this.#projects };
    const temporary = join(dirname(this.file), `.${basename(this.file)}.writing`);
    try {
      await mkdir(dirname(this.file), { recursive: true });
      await writeFile(temporary, `${JSON.stringify(stored, null, 2)}\n`, 'utf8');
      await rename(temporary, this.file);
    } catch {
      // The list will not survive the quit. Nothing else about this session
      // changes, and there is nothing here worth interrupting anybody over.
    }
  }
}
