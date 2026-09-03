/** What the app has left on the disk, and what of it is finished with.
 *
 * Everything a conversation needs while it runs — a checkout of the project, a
 * copy for each piece on the board, the transcript — is kept under the app's
 * own folder and nothing has ever removed any of it. On the machine this was
 * written on that folder had grown to several gigabytes, most of it copies of
 * work landed months ago.
 *
 * Deciding is pure and takes the list as an argument; `measureFolders` and
 * `sweep` are the only parts that touch the disk. The rule that matters is the
 * one at the top of `whatToSweep`: work that has not been brought in is never
 * swept, at any age. Age decides between two finished things, never between
 * finished and not.
 */

import { access, readdir, rm, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { delimiter, join } from 'node:path';

/** One folder under the app's data directory, as a Settings row reads it. */
export type Folder = { name: string; bytes: number; files: number };

/** Something on the disk that could go, and what it is. */
export type Sweepable = {
  path: string;
  kind: 'checkout' | 'copy' | 'kept-aside' | 'transcript' | 'build';
  /** When it was last useful — closed, finished, last written to. */
  at: number;
  /** True while it still holds a change nobody has brought in. */
  holdsWork: boolean;
};

/** How long each kind is kept after it stopped being used.
 *
 *  A fortnight for a checkout because a conversation is often come back to; a
 *  week for a board copy because a finished piece has already been landed or
 *  set aside; a month for what was set aside deliberately; three months for a
 *  transcript, which is small and is the only record of what happened. */
export const KEEP_DAYS = { checkout: 14, copy: 7, keptAside: 30, transcript: 90 } as const;

const DAY_MS = 24 * 60 * 60 * 1000;

/** A build is output, not anybody's work, so it goes on the same clock as a
 *  board copy. */
function keepDaysFor(kind: Sweepable['kind']): number {
  if (kind === 'checkout') return KEEP_DAYS.checkout;
  if (kind === 'kept-aside') return KEEP_DAYS.keptAside;
  if (kind === 'transcript') return KEEP_DAYS.transcript;
  return KEEP_DAYS.copy;
}

/** The folders under the app's data directory, in the order Settings shows
 *  them, and the plain name each is given there. */
const FOLDERS: readonly { dir: string; name: string; clearable?: boolean }[] = [
  { dir: 'worktrees', name: 'Branches' },
  { dir: 'copies', name: 'Board copies' },
  { dir: 'kept-aside', name: 'Set aside' },
  { dir: 'sessions', name: 'Conversations' },
  { dir: 'builds', name: 'Builds' },
  { dir: 'scratch', name: 'Scratch', clearable: true },
  { dir: 'logs', name: 'Logs', clearable: true },
];

/** Which rows are safe to empty outright. A branch may hold work; a scratch
 *  folder and a log never do. */
export function canClear(name: string): boolean {
  return FOLDERS.some((one) => one.name === name && one.clearable === true);
}

/** Where one row's folder is, so a Clear knows what to remove. */
export function folderNamed(userData: string, name: string): string | null {
  const found = FOLDERS.find((one) => one.name === name);
  return found === undefined ? null : join(userData, found.dir);
}

/* -------------------------------------------------------------------------- */
/* Deciding                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Which of these have been finished with long enough to go.
 *
 * Nothing holding work is ever swept, whatever its age — that is the first
 * check and there is no branch around it. `because` is the sentence to show,
 * and it says what stayed as well as what goes, because "cleared 41 folders" on
 * its own is the sort of line somebody reads twice.
 */
export function whatToSweep(
  all: readonly Sweepable[],
  now: number,
): { sweep: readonly Sweepable[]; kept: readonly Sweepable[]; because: string } {
  const sweep: Sweepable[] = [];
  const kept: Sweepable[] = [];
  let holding = 0;

  for (const one of all) {
    if (one.holdsWork) {
      holding += 1;
      kept.push(one);
      continue;
    }
    const olderThan = now - one.at;
    if (olderThan >= keepDaysFor(one.kind) * DAY_MS) sweep.push(one);
    else kept.push(one);
  }

  return { sweep, kept, because: whyThat(sweep.length, holding, kept.length - holding) };
}

function whyThat(going: number, holding: number, recent: number): string {
  if (going === 0) {
    if (holding > 0) return `Nothing to clear. ${saysCount(holding)} still holding work you have not brought in.`;
    return 'Nothing to clear. Everything here is still in use.';
  }
  const stays: string[] = [];
  if (holding > 0) stays.push(`${saysCount(holding)} still holding work`);
  if (recent > 0) stays.push(`${String(recent)} too recent to touch`);
  const tail = stays.length === 0 ? '' : ` Staying: ${stays.join(', ')}.`;
  return `${saysCount(going)} finished with and ready to clear.${tail}`;
}

function saysCount(n: number): string {
  return n === 1 ? '1 folder' : `${String(n)} folders`;
}

/* -------------------------------------------------------------------------- */
/* Saying it                                                                   */
/* -------------------------------------------------------------------------- */

/** The Settings row: each folder, its size, and the total. One line, because
 *  the row is one line. */
export function saysStorage(folders: readonly Folder[]): string {
  const real = folders.filter((one) => one.bytes > 0);
  if (real.length === 0) return 'Nothing kept on this computer yet.';
  const total = real.reduce((sum, one) => sum + one.bytes, 0);
  const parts = [...real]
    .sort((a, b) => b.bytes - a.bytes)
    .map((one) => `${one.name} ${saysBytes(one.bytes)}`);
  return `${saysBytes(total)} on this computer: ${parts.join(', ')}.`;
}

/* Sizes are read by the window as well, and everything else here reaches the
   disk, so they are their own file and re-exported from where they were. */
export { saysBytes } from './bytes';
import { saysBytes } from './bytes';

/** The Settings copy, in one place so the button and the sentence under it
 *  cannot drift apart. */
export const storageWords = {
  title: 'Storage',
  clear: 'Clear finished work',
  what:
    'Removes the checkouts of conversations closed more than a fortnight ago, board copies of finished pieces older than a week, work set aside more than a month ago and transcripts older than three months. Anything still holding a change you have not brought in stays, however old it is.',
  where:
    'Everything is under ~/Library/Application Support/Graphe. Provider sign-ins live in ~/.pi/agent.',
} as const;

/* -------------------------------------------------------------------------- */
/* The disk                                                                    */
/* -------------------------------------------------------------------------- */

/** Size and file count of each folder the app keeps. Anything unreadable is
 *  reported as empty rather than as an error somebody has to read. */
export async function measureFolders(userData: string): Promise<readonly Folder[]> {
  const measured: Folder[] = [];
  for (const { dir, name } of FOLDERS) {
    measured.push({ name, ...(await measure(join(userData, dir))) });
  }
  return measured;
}

async function measure(folder: string): Promise<{ bytes: number; files: number }> {
  let bytes = 0;
  let files = 0;
  let entries;
  try {
    entries = await readdir(folder, { withFileTypes: true });
  } catch {
    return { bytes: 0, files: 0 };
  }
  for (const entry of entries) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) {
      const inside = await measure(path);
      bytes += inside.bytes;
      files += inside.files;
      continue;
    }
    // Symbolic links are counted as nothing: the bytes belong to whatever they
    // point at, which is usually somewhere else entirely.
    if (!entry.isFile()) continue;
    try {
      bytes += (await stat(path)).size;
      files += 1;
    } catch {
      /* gone between the listing and the look */
    }
  }
  return { bytes, files };
}

/**
 * Remove what was picked, and say how much came back.
 *
 * Takes the decision rather than making one: `whatToSweep` is what refuses to
 * touch work, and a caller that reached here with something holding work has
 * already gone wrong. Anything that cannot be removed is left alone and counted
 * out — a folder in use is not a failure worth stopping the rest for.
 */
export async function sweep(picked: readonly Sweepable[]): Promise<{ removed: number; freed: number }> {
  let removed = 0;
  let freed = 0;
  for (const one of picked) {
    if (one.holdsWork) continue;
    const { bytes } = await measure(one.path).catch(() => ({ bytes: 0, files: 0 }));
    try {
      await rm(one.path, { recursive: true, force: true });
      removed += 1;
      freed += bytes;
    } catch {
      /* still in use, or not ours to remove */
    }
  }
  return { removed, freed };
}

/* -------------------------------------------------------------------------- */
/* npm                                                                         */
/* -------------------------------------------------------------------------- */

/** Is `npm` reachable from here?
 *
 *  Add-ons install through it and `npx`-based tools need it. A Mac that has
 *  never had Node on it has neither, and the failure without this is a page
 *  that says an install went wrong rather than a page that says what is
 *  missing. Nothing is run: the file is looked for on PATH. */
export async function npmOnPath(): Promise<boolean> {
  const names = process.platform === 'win32' ? ['npm.cmd', 'npm.exe'] : ['npm'];
  for (const folder of (process.env['PATH'] ?? '').split(delimiter)) {
    if (folder === '') continue;
    for (const name of names) {
      const found = await access(join(folder, name), constants.X_OK)
        .then(() => true)
        .catch(() => false);
      if (found) return true;
    }
  }
  return false;
}
