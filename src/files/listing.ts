/** Finding everything in a project without reading a project's worth of noise.
 *
 * The decisions live here rather than in the shell so they can be tested with a
 * folder made of objects instead of a folder made of disks.
 */

import type { FileEntry } from './tree';

/**
 * Folders that are never opened at all.
 *
 * Skipped before descending, not filtered afterwards: a project with
 * `node_modules` in it is two hundred thousand entries, and reading them to
 * throw them away is the difference between a panel and a hang.
 */
export const NEVER_OPENED: readonly string[] = [
  'node_modules',
  '.git',
  '.hg',
  '.svn',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.turbo',
  '.parcel-cache',
  '.vite',
  'coverage',
  '.cache',
  '.venv',
  'venv',
  '__pycache__',
  'target',
  'vendor',
  'Pods',
  '.gradle',
  '.idea',
  '.vscode',
  'DerivedData',
];

/** Deep enough for any project anybody nests by hand, and a floor under a
 *  folder that turns out to be somebody's whole computer. */
export const DEEPEST = 10;

/** More than any project a person reads through, and few enough that the list
 *  crosses to the window in one piece. */
export const MOST = 5000;

/** Past this a file is not something to read on screen. */
export const BIGGEST = 2_000_000;

/** One entry, as a folder reader found it. */
export type Found = {
  name: string;
  kind: 'file' | 'folder';
  /** Bytes. Folders say 0. */
  size: number;
};

/** What the walk is given instead of a disk. Anything it cannot open is an
 *  empty answer, never a throw. */
export type LookInside = (path: string) => Promise<readonly Found[]>;

export type Walk = {
  files: readonly FileEntry[];
  /** True when a cap was reached and there is more down there. */
  stopped: boolean;
};

export type Limits = { deepest?: number; most?: number };

export function neverOpened(name: string): boolean {
  return NEVER_OPENED.includes(name);
}

/** Backslashes, `./` and repeats folded away, so two spellings of one file are
 *  one file. */
export function tidyPath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part !== '' && part !== '.')
    .join('/');
}

/**
 * Every file under a folder, project-relative and forward-slashed.
 *
 * Bounded three ways — the folders above, a depth and a total — because the
 * folder handed to this is whatever somebody pointed at, and that is sometimes
 * their home directory.
 */
export async function everythingIn(
  root: string,
  lookInside: LookInside,
  limits: Limits = {},
): Promise<Walk> {
  const deepest = limits.deepest ?? DEEPEST;
  const most = limits.most ?? MOST;
  const files: FileEntry[] = [];
  let stopped = false;

  const walk = async (where: string, prefix: string, depth: number): Promise<void> => {
    if (files.length >= most) return;
    const found = [...(await lookInside(where))].sort((a, b) => (a.name < b.name ? -1 : 1));

    for (const entry of found) {
      if (files.length >= most) {
        stopped = true;
        return;
      }
      if (entry.name === '' || entry.name === '.' || entry.name === '..') continue;

      if (entry.kind === 'file') {
        files.push({ path: `${prefix}${entry.name}`, size: entry.size });
        continue;
      }
      if (neverOpened(entry.name)) continue;
      if (depth + 1 > deepest) {
        stopped = true;
        continue;
      }
      await walk(`${where}/${entry.name}`, `${prefix}${entry.name}/`, depth + 1);
    }
  };

  await walk(root, '', 0);
  return { files, stopped };
}

/**
 * The walk, with what moved in this version marked on it.
 *
 * Anything changed that the walk did not reach is added rather than dropped:
 * a file past the cap, or inside a folder we never open, is the file somebody
 * most wants to see.
 */
export function markChanged(
  files: readonly FileEntry[],
  changed: readonly { path: string }[],
): readonly FileEntry[] {
  const moved = new Set(changed.map((one) => tidyPath(one.path)).filter((one) => one !== ''));
  if (moved.size === 0) return files;

  const marked = files.map((file) => {
    const path = tidyPath(file.path);
    return moved.delete(path) ? { ...file, path, changed: true } : file;
  });
  for (const path of moved) marked.push({ path, size: 0, changed: true });
  return marked;
}

/** Bytes with nothing to read in them. Only the start is looked at: a file's
 *  first few kilobytes say what it is. */
export function looksBinary(bytes: Uint8Array): boolean {
  const upTo = Math.min(bytes.length, 8000);
  for (let index = 0; index < upTo; index += 1) {
    if (bytes[index] === 0) return true;
  }
  return false;
}

export function tooBig(size: number): boolean {
  return size > BIGGEST;
}

/** Why a file cannot be shown, in words a person can act on. */
export const cannotOpen = {
  outside: 'That is not in your project, so I have left it alone.',
  tooBig: 'This one is too big to read on screen.',
  notText: 'This one is not text, so there is nothing to read here.',
  secret: 'This one holds keys or passwords, so I do not open it.',
  gone: 'I could not find that one in your project any more.',
} as const;
