/** Where the things somebody asked for over and over are kept.
 *
 * Next to `preferences.ts` and `recents.ts` because it is the same kind of
 * thing — a small file the app keeps about a person, which that person could
 * open and read — and it follows the same three rules: read once at startup,
 * written whole and atomically, and never a source of errors. A file that
 * cannot be read is an empty list, and one that cannot be written is a repeat
 * that will not survive the quit. Neither is worth a sentence in front of
 * anybody.
 *
 * Everything about *what* a repeat is and *when* it comes round lives in
 * src/work/standing.ts, which has no disk in it so the window can say the same
 * sentences.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

import { readStanding, type Standing } from '../work/standing';

type Stored = { version: 1; standing: readonly Standing[] };

export class StandingFile {
  #all: readonly Standing[] = [];

  private constructor(private readonly file: string) {}

  static async open(file: string): Promise<StandingFile> {
    const standing = new StandingFile(resolve(file));
    try {
      standing.#all = readStanding(JSON.parse(await readFile(standing.file, 'utf8')));
    } catch {
      standing.#all = [];
    }
    return standing;
  }

  all(): readonly Standing[] {
    return this.#all;
  }

  /** Change the list with one of the pure operations, and write the result. */
  async change(
    next: readonly Standing[] | ((all: readonly Standing[]) => readonly Standing[]),
  ): Promise<readonly Standing[]> {
    this.#all = typeof next === 'function' ? next(this.#all) : next;
    await this.#write();
    return this.#all;
  }

  async #write(): Promise<void> {
    const stored: Stored = { version: 1, standing: this.#all };
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
