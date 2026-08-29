/** What the app remembers about a conversation's own copy of a project,
 *  between one sitting and the next.
 *
 *  The folder is not the durable half. It is given back whenever nobody is in
 *  it — that is where a dependency install and a build go, and a few of those
 *  is gigabytes — and spread out again from the branch when somebody returns.
 *  So a row that names a folder no longer on disk is an ordinary row, not a
 *  broken one, and reading it as broken is how a conversation loses its work.
 */

import { branchFor } from './worktree';

/** A conversation's copy of the project: where it goes, and what it is on.
 *  `named` is set once the branch has been renamed after the work — it happens
 *  at most once, so the fact has to outlive the sitting that did it. */
export type Checkout = { folder: string; branch: string; named?: boolean };

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
