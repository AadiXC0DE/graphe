/** Where the notes are kept, so work outlives the window it was asked from.
 *
 * A page per project, a note per piece of work, and nothing shared between
 * them: two runs writing at the same moment are two different files, and
 * letting one go can only ever remove that one. The names of pieces of work
 * repeat across projects — the first on every board is `work-1` — which is the
 * whole reason the pages exist.
 *
 * Written whole and atomically, and never a source of errors. A page that
 * cannot be read is an empty board, and one that cannot be written is work
 * that will not survive the quit. Neither is worth a sentence in front of
 * anybody. What a note *means* is src/work/written.ts, which has no disk in it.
 */

import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

import { readWritten, type Written } from './written';

/** A folder name for a project path: readable enough to recognise, and carrying
 *  the whole path in a number so two projects with the same name are two
 *  pages. */
export function keyFor(project: string): string {
  const full = resolve(project);
  const named = basename(full).replace(/[^a-zA-Z0-9-]+/g, '-').slice(0, 24) || 'project';
  let stamp = 0;
  for (const character of full) stamp = (stamp * 31 + character.charCodeAt(0)) >>> 0;
  return `${named}-${stamp.toString(36)}`;
}

function fileNameFor(id: string): string {
  const clean = id
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return `${clean === '' ? 'work' : clean}.json`;
}

type Stored = { version: 1; work: Written };

export class Notebook {
  /** Enough to keep two writes of the same note from meeting in the same
   *  half-written file. */
  #writing = 0;

  constructor(private readonly root: string) {
    this.root = resolve(root);
  }

  /** The page a project's notes are on. */
  pageFor(project: string): string {
    return join(this.root, keyFor(project));
  }

  /** Write one note down, replacing whatever was there for that piece of work. */
  async note(one: Written): Promise<void> {
    const page = this.pageFor(one.project);
    const file = join(page, fileNameFor(one.id));
    this.#writing += 1;
    const half = `${file}.${String(process.pid)}-${String(this.#writing)}.writing`;
    try {
      await mkdir(page, { recursive: true });
      await writeFile(half, `${JSON.stringify(stored(one), null, 2)}\n`, 'utf8');
      await rename(half, file);
    } catch {
      await rm(half, { force: true }).catch(() => undefined);
    }
  }

  /** The same, from somewhere that cannot wait — the app on its way out. */
  noteNow(one: Written): void {
    const page = this.pageFor(one.project);
    const file = join(page, fileNameFor(one.id));
    this.#writing += 1;
    const half = `${file}.${String(process.pid)}-${String(this.#writing)}.writing`;
    try {
      mkdirSync(page, { recursive: true });
      writeFileSync(half, `${JSON.stringify(stored(one), null, 2)}\n`, 'utf8');
      renameSync(half, file);
    } catch {
      // Gone with the quit, and nothing else changes.
    }
  }

  /** Let one go. Only ever the one named. */
  async forget(project: string, id: string): Promise<void> {
    await rm(join(this.pageFor(project), fileNameFor(id)), { force: true }).catch(() => undefined);
  }

  /** One project's notes, oldest first. */
  async page(project: string): Promise<readonly Written[]> {
    return read(this.pageFor(project));
  }

  /** Every project's, for the way back in. Grouped by project so a cold start
   *  can set one board up at a time. */
  async everything(): Promise<ReadonlyMap<string, readonly Written[]>> {
    let pages: string[];
    try {
      pages = await readdir(this.root);
    } catch {
      return new Map();
    }
    const byProject = new Map<string, Written[]>();
    for (const page of pages) {
      for (const one of await read(join(this.root, page))) {
        const already = byProject.get(one.project);
        if (already === undefined) byProject.set(one.project, [one]);
        else already.push(one);
      }
    }
    return byProject;
  }
}

function stored(one: Written): Stored {
  return { version: 1, work: one };
}

async function read(page: string): Promise<readonly Written[]> {
  let names: string[];
  try {
    names = await readdir(page);
  } catch {
    return [];
  }
  const all: Written[] = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    try {
      const raw = JSON.parse(await readFile(join(page, name), 'utf8')) as { work?: unknown };
      const one = readWritten(raw.work);
      if (one !== null) all.push(one);
    } catch {
      // A note half-written by a machine that lost power costs that note.
    }
  }
  return all.sort((one, other) => one.at - other.at);
}
