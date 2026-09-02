/** What the app remembers about a conversation's own copy of a project,
 *  between one sitting and the next.
 *
 *  The folder is not the durable half. It is given back whenever nobody is in
 *  it — that is where a dependency install and a build go, and a few of those
 *  is gigabytes — and spread out again from the branch when somebody returns.
 *  So a row that names a folder no longer on disk is an ordinary row, not a
 *  broken one, and reading it as broken is how a conversation loses its work.
 */

import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';

import { branchFor, type RunGit } from './worktree';

/** A conversation's copy of the project: where it goes, and what it is on.
 *  `named` is set once the branch has been renamed after the work — it happens
 *  at most once, so the fact has to outlive the sitting that did it. */
export type Checkout = { folder: string; branch: string; named?: boolean; away?: boolean };

/** The last segment of a path, either separator. */
function leafOf(folder: string): string {
  const parts = folder.split(/[\\/]/).filter((part) => part !== '');
  return parts[parts.length - 1] ?? '';
}

/** One stored row. Rows written before the branch was kept named only a folder,
 *  and the branch that made them is a function of its name. */
export function checkoutRow(value: unknown): Checkout | null {
  if (typeof value === 'string') {
    const leaf = leafOf(value);
    if (value.trim() === '' || leaf === '') return null;
    return { folder: value, branch: branchFor(leaf) };
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as { folder?: unknown; branch?: unknown; named?: unknown };
  if (typeof row.folder !== 'string' || typeof row.branch !== 'string') return null;
  if (row.folder.trim() === '' || row.branch.trim() === '') return null;
  return { folder: row.folder, branch: row.branch, ...(row.named === true ? { named: true } : {}) };
}

export const checkoutWords = {
  /** Said on open, when a row names a folder this project does not have out.
   *  The work is on the branch either way; what has gone is the copy on disk. */
  putAway: (count: number): string =>
    count === 1
      ? 'One conversation’s copy of this project is put away. Its work is on its branch, and opening the conversation spreads it out again.'
      : `${String(count)} conversations’ copies of this project are put away. Their work is on their branches, and opening one spreads it out again.`,
} as const;

/** One folder under the name the filesystem knows it by, so a row written
 *  through a link still matches the folder git reports. */
async function trueName(folder: string): Promise<string> {
  return realpath(folder).catch(() => resolve(folder));
}

/** The folders this repository actually has checked out right now. */
async function worktreeFolders(repo: string, run: RunGit): Promise<Set<string> | null> {
  const listed = await run(['worktree', 'list', '--porcelain'], { cwd: repo });
  if (listed.code !== 0 || listed.out === undefined) return null;
  const found = new Set<string>();
  for (const line of listed.out.split('\n')) {
    if (line.startsWith('worktree ')) found.add(await trueName(line.slice(9).trim()));
  }
  return found;
}

/**
 * Check every stored row against the checkouts this repository really has.
 *
 * A row whose folder is not one of them is put away, not live — a project that
 * was moved carries rows pointing at folders belonging to a repository that is
 * no longer there, and reusing one hands a conversation somebody else's files.
 * Nothing is dropped: what a conversation owns is its branch, and a row marked
 * `away` is spread out again from that branch when it is next opened.
 */
export async function validateCheckouts(
  repo: string,
  rows: Map<string, Checkout>,
  run: RunGit,
): Promise<{ rows: Map<string, Checkout>; putAway: readonly string[] }> {
  const live = await worktreeFolders(repo, run);
  // Git could not answer, so nothing is proven and nothing is marked.
  if (live === null) return { rows, putAway: [] };

  const checked = new Map<string, Checkout>();
  const putAway: string[] = [];
  for (const [address, row] of rows) {
    if (live.has(await trueName(row.folder))) {
      checked.set(address, {
        folder: row.folder,
        branch: row.branch,
        ...(row.named === true ? { named: true } : {}),
      });
      continue;
    }
    checked.set(address, { ...row, away: true });
    putAway.push(address);
  }
  return { rows: checked, putAway };
}

/** The whole index, as read back. `keep` decides which folders belong to this
 *  project — nothing here touches a disk, so the caller answers that. */
export function readCheckoutIndex(
  parsed: unknown,
  keep: (folder: string) => boolean,
): Map<string, Checkout> {
  const found = new Map<string, Checkout>();
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return found;
  for (const [address, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (address.trim() === '') continue;
    const row = checkoutRow(value);
    if (row === null || !keep(row.folder)) continue;
    found.set(address, row);
  }
  return found;
}
