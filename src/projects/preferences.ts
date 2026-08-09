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
};

export const defaultPreferences: Preferences = { showMe: false };

type Stored = { version: 1; preferences: Preferences };

function asPreferences(value: unknown): Preferences {
  if (typeof value !== 'object' || value === null) return { ...defaultPreferences };
  const raw = (value as { preferences?: unknown }).preferences;
  if (typeof raw !== 'object' || raw === null) return { ...defaultPreferences };
  const showMe = (raw as Record<string, unknown>)['showMe'];
  return { showMe: showMe === true };
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
    if (next.showMe === this.#preferences.showMe) return this.all();
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
