/** What the window was shown, and whether it is still what is on disk.
 *
 * The file list and the diff are read once and drawn from memory for as long as
 * somebody is looking at them, so an editor or a terminal writing one of those
 * paths leaves the panel showing bytes that are no longer there — and nothing
 * compared the two, so the old reading was drawn as the current one. A reading
 * carries the revision it was taken at. A later read of the same thing is
 * compared against it, and one that no longer matches is read again rather than
 * handed over as though nothing had moved.
 *
 * Two revisions, because two questions are being asked. A listing is a set of
 * names and sizes, so its revision moves when a file appears, goes or changes
 * length. Open bytes are the bytes, so theirs moves whenever the content does —
 * including an edit that keeps the file exactly as long, which is precisely the
 * case a name and a size cannot see.
 *
 * No disk here: the caller reads, and tells this what it read.
 */

import { createHash } from 'node:crypto';

/** The revision one thing was read at, and when that read happened. */
export type Reading = { revision: string; at: number };

function digest(of: string): string {
  return createHash('sha256').update(of).digest('hex').slice(0, 32);
}

/** A listing as one string two readings compare by. The parts are joined with a
 *  separator no path can contain, so two different listings cannot spell the
 *  same revision. */
export function listRevision(parts: readonly (string | number)[]): string {
  return digest(parts.join('\u0000'));
}

/** The revision of one file's bytes. The length is in it as well as the hash so
 *  a file that cannot be read at all still has a revision of its own. */
export function fileRevision(bytes: Buffer | string): string {
  const held = typeof bytes === 'string' ? Buffer.from(bytes, 'utf8') : bytes;
  return digest(`${String(held.byteLength)}\u0000${createHash('sha256').update(held).digest('hex')}`);
}

/**
 * The last reading of each thing, by whatever key the caller files it under.
 *
 * A reading is only ever replaced by a newer one of the same key: an answer for
 * one workspace must never be compared against another's, so the key carries
 * the workspace and the thing read. Nothing is ever expired — the entries are
 * small, and a reading with no successor is exactly the one worth keeping.
 */
export class Readings {
  readonly #held = new Map<string, Reading>();

  /** What this was last read at, or null when it has never been read. */
  held(key: string): Reading | null {
    return this.#held.get(key) ?? null;
  }

  /**
   * Note a reading taken now, and answer whether it is the same one the caller
   * already had.
   *
   * False means the thing moved since it was last read: what somebody is
   * looking at is not what is there, and the caller reads it again. True is
   * both "nothing changed" and "never read before", which is the same answer to
   * the only question asked here — nothing has moved under a reader.
   */
  note(key: string, revision: string, at = Date.now()): { changed: boolean; reading: Reading } {
    const before = this.#held.get(key);
    const reading: Reading = { revision, at };
    this.#held.set(key, reading);
    return { changed: before !== undefined && before.revision !== revision, reading };
  }
}

/** The key one workspace's listing is filed under. */
export function listingKey(folder: string): string {
  return `files\u0000${folder}`;
}

/** The key one file's bytes are filed under. The folder is in the key as well
 *  as the path: a chat working in its own copy opens `src/app.ts` there, which
 *  is not the project's `src/app.ts`. */
export function fileKey(folder: string, path: string): string {
  return `file\u0000${folder}\u0000${path}`;
}

/** The key one review's diff is filed under. */
export function diffKey(folder: string, base: string): string {
  return `diff\u0000${folder}\u0000${base}`;
}
