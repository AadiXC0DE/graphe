/** The Figma file each project is kept in step with.
 *
 * Next to `preferences.ts` and `standing.ts` because it is the same kind of
 * thing — one small file under the app's own data directory, read once at
 * startup, written whole and atomically, and never the source of an error a
 * designer has to read. What a reading means lives in src/design/moved.ts,
 * which has no disk in it; this only keeps the readings.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

import { readHeld, type Held } from '../design/moved';

type Row = { project: string; held: Held };
type Stored = { version: 1; followed: readonly Row[] };

function rowsOf(raw: unknown): Row[] {
  const holder = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const list = Array.isArray(holder['followed']) ? holder['followed'] : [];
  const rows: Row[] = [];
  for (const entry of list) {
    const row = typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>) : null;
    const project = typeof row?.['project'] === 'string' ? row['project'] : '';
    const held = readHeld(row?.['held']);
    if (project === '' || held === null) continue;
    rows.push({ project: resolve(project), held });
  }
  return rows;
}

export class FollowedFile {
  #rows: Row[] = [];

  private constructor(private readonly file: string) {}

  static async open(file: string): Promise<FollowedFile> {
    const followed = new FollowedFile(resolve(file));
    try {
      followed.#rows = rowsOf(JSON.parse(await readFile(followed.file, 'utf8')));
    } catch {
      followed.#rows = [];
    }
    return followed;
  }

  /** What this project follows, or null. One file per project: a second one
   *  would need a second name on every sentence the panel says. */
  for(project: string): Held | null {
    return this.#rows.find((row) => row.project === resolve(project))?.held ?? null;
  }

  async keep(project: string, held: Held): Promise<Held> {
    const where = resolve(project);
    this.#rows = [...this.#rows.filter((row) => row.project !== where), { project: where, held }];
    await this.#write();
    return held;
  }

  async forget(project: string): Promise<void> {
    const where = resolve(project);
    this.#rows = this.#rows.filter((row) => row.project !== where);
    await this.#write();
  }

  async #write(): Promise<void> {
    const stored: Stored = { version: 1, followed: this.#rows };
    const temporary = join(dirname(this.file), `.${basename(this.file)}.writing`);
    try {
      await mkdir(dirname(this.file), { recursive: true });
      await writeFile(temporary, `${JSON.stringify(stored, null, 2)}\n`, 'utf8');
      await rename(temporary, this.file);
    } catch {
      // It will not survive the quit, and nothing else changes.
    }
  }
}
