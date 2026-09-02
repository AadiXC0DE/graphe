/** Which folders are a project, and which are somebody's whole computer.
 *
 * Opening a project starts keeping history in it, and the first turn saves
 * everything in it. That is right for a folder somebody made for a piece of
 * work and wrong for the Desktop, the home folder or a mounted disk — the most
 * natural things in the world to click on. So the answer is decided here,
 * before anything is written, and the refusal comes with the folder to make
 * instead.
 *
 * A folder that already keeps history opens whatever it is: somebody set that
 * up deliberately, and second-guessing it would be the app deciding it knows
 * better than the person about their own repository.
 */

import { readdir, stat } from 'node:fs/promises';
import * as path from 'node:path';

/** Past either of these and it is not one project, whatever it is called. */
export const TOO_MANY_FILES = 20_000;
export const TOO_MANY_BYTES = 2 * 1024 * 1024 * 1024;

export type OpenVerdict = { kind: 'open' } | { kind: 'refuse'; because: string; offer: string };

export const openingWords = {
  home: 'That is your home folder — everything on this computer is inside it, not one project.',
  system: 'That is a folder your computer keeps for itself, not a project.',
  disk: 'That is a whole disk, not a project.',
  kept: (name: string) =>
    `${name} holds everything you have ever put there, which is more than one project.`,
  cloud: 'That is your iCloud Drive, which keeps changing underneath as it syncs.',
  scratch: 'That is the computer’s scratch folder, and it gets emptied without warning.',
  tooMany: (files: number) =>
    `There are more than ${files.toLocaleString('en-US')} files in there, which is far more than one project.`,
  tooBig: (bytes: number) => `That folder holds more than ${inGigabytes(bytes)}, far more than one project.`,
  offer: 'Make a folder for this project inside it, and open that.',
} as const;

function inGigabytes(bytes: number): string {
  return `${String(Math.round(bytes / (1024 * 1024 * 1024)))} GB`;
}

/** The folders in a home directory that are the operating system's, not a
 *  person's idea of a place to keep work. */
const KEPT_FOLDERS = new Set(['desktop', 'documents', 'downloads', 'movies', 'music', 'pictures', 'public']);

const SYSTEM_ROOTS = new Set(['/users', '/home', '/system', '/library', '/applications']);

const SCRATCH_ROOTS = new Set(['/tmp', '/private/tmp', '/var/tmp', '/private/var/tmp']);

const ICLOUD = 'library/mobile documents';

/** Trailing separators, `~`, and `.` segments off; nothing here touches disk. */
function tidy(folder: string, home: string): string {
  const expanded =
    folder === '~' ? home : folder.startsWith('~/') || folder.startsWith('~\\') ? path.join(home, folder.slice(2)) : folder;
  const resolved = path.resolve(expanded);
  return resolved.length > 1 ? resolved.replace(/[\\/]+$/, '') : resolved;
}

/** Where `folder` sits inside `home`, in lowercase posix segments, or null when
 *  it is not in there at all. */
function under(home: string, folder: string): string | null {
  const inside = path.relative(home, folder);
  if (inside === '' || inside.startsWith('..') || path.isAbsolute(inside)) return null;
  return inside.split(path.sep).join('/').toLowerCase();
}

/** The reason this folder cannot become a project, or null if it can. Pure: the
 *  size checks live in `sizeOf`, because those have to read the disk. */
export function refusedFolder(folder: string, home: string): string | null {
  const at = tidy(folder, home);
  const mine = tidy(home, home);
  const lower = at.toLowerCase();

  if (path.parse(at).root === at) return openingWords.disk;
  if (lower === '/volumes' || /^\/volumes\/[^/]+$/.test(lower)) return openingWords.disk;
  if (at === mine) return openingWords.home;
  if (SYSTEM_ROOTS.has(lower)) return openingWords.system;
  if (SCRATCH_ROOTS.has(lower)) return openingWords.scratch;

  const inside = under(mine, at);
  if (inside === null) return null;

  // iCloud first: `library` on its own is a system folder, but the drive people
  // actually keep work in lives several segments down inside it.
  if (inside === ICLOUD || new RegExp(`^${ICLOUD}/[^/]+$`).test(inside)) return openingWords.cloud;
  if (inside === 'library') return openingWords.system;
  if (KEPT_FOLDERS.has(inside)) return openingWords.kept(path.basename(at));
  return null;
}

/** How much is in there, giving up the moment it is past either cap. Walking
 *  200,000 files to find out there are 200,000 files is the slow way to say no. */
export async function sizeOf(
  folder: string,
  caps: { files: number; bytes: number },
): Promise<{ files: number; bytes: number; over: boolean }> {
  let files = 0;
  let bytes = 0;
  const left: string[] = [folder];

  while (left.length > 0) {
    const here = left.pop();
    if (here === undefined) break;
    let entries;
    try {
      entries = await readdir(here, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(here, entry.name);
      // Links are not followed: a loop through one would never finish, and what
      // they point at is counted where it really lives or not at all.
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        left.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      files += 1;
      try {
        bytes += (await stat(full)).size;
      } catch {
        // Gone between the listing and the look. Nothing to count.
      }
      if (files > caps.files || bytes > caps.bytes) return { files, bytes, over: true };
    }
  }
  return { files, bytes, over: false };
}

/** The whole answer for one folder. `count` is optional so a caller that has
 *  already measured, or does not care to, is not made to. */
export async function verdictFor(
  folder: string,
  opts: { home: string; isRepo: boolean; count?: () => Promise<{ files: number; bytes: number }> },
): Promise<OpenVerdict> {
  if (opts.isRepo) return { kind: 'open' };

  const because = refusedFolder(folder, opts.home);
  if (because !== null) return { kind: 'refuse', because, offer: openingWords.offer };

  if (opts.count !== undefined) {
    const size = await opts.count();
    if (size.files > TOO_MANY_FILES) {
      return { kind: 'refuse', because: openingWords.tooMany(TOO_MANY_FILES), offer: openingWords.offer };
    }
    if (size.bytes > TOO_MANY_BYTES) {
      return { kind: 'refuse', because: openingWords.tooBig(TOO_MANY_BYTES), offer: openingWords.offer };
    }
  }
  return { kind: 'open' };
}
