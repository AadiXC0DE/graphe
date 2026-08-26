/** Folders that hold other folders' projects.
 *
 *  A folder opened in Graphe has always been assumed to be one project — one
 *  `.git`, one history, one branch. Plenty of real folders are not: a working
 *  directory with `backend/` and `frontend/` beside each other, each its own
 *  repository. This finds those children, one level deep, and nothing more.
 *
 *  Depth one is the whole contract. Scanning further costs time nobody asked
 *  to spend, drags in vendored copies (`node_modules` of a dependency that
 *  ships a test fixture), and starts guessing at what "the project" means.
 *  A folder holding three projects is common; one holding nine is a filing
 *  problem, not an app feature.
 *
 *  Pure and quiet. Nothing here creates anything, touches git, or reports
 *  failure — a folder that cannot be read is a folder with no children found.
 */

import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { neverOpened } from '../src/files/listing';

/** One child repository: its folder name, where it lives, and the name again
 *  for addresses (`backend`) — kept separate from `path` so callers never
 *  re-derive one from the other and get it wrong. */
export type DetectedRepo = {
  /** Folder name, as it appears inside the parent. */
  rel: string;
  /** Absolute path of the child. */
  path: string;
};

/** The most children worth noticing before this stops being a feature and
 *  becomes a directory listing. */
export const MOST_CHILDREN = 3;

/** How many children make this parent "several projects" rather than a folder
 *  that happens to contain one nested repository (which is ordinary — an
 *  example app inside a docs repo, say). One child changes nothing; the parent
 *  keeps behaving exactly as it always has. */
export const SEVERAL_CHILDREN = 2;

/**
 * The immediate children of `parent` that are their own repositories.
 *
 * A child counts when it is a real directory (not a symlink), not on the
 * never-opened list, and holds a `.git` — file or folder, so worktrees and
 * submodules count the same as full clones. Sorted by name, capped at
 * `MOST_CHILDREN`. When `parent` itself is a repository the answer is empty:
 * the parent wins, and its children are just folders inside it.
 */
export async function childRepos(parent: string): Promise<readonly DetectedRepo[]> {
  if (await hasDotGit(parent)) return [];

  let entries;
  try {
    entries = await readdir(parent, { withFileTypes: true });
  } catch {
    return [];
  }

  const found: DetectedRepo[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (found.length >= MOST_CHILDREN) break;
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    if (entry.name.startsWith('.') || neverOpened(entry.name)) continue;
    const path = join(parent, entry.name);
    if (await hasDotGit(path)) found.push({ rel: entry.name, path });
  }
  return found;
}

/** `.git` as a folder (a clone) or a file (a worktree, a submodule) both count.
 *  Anything else about the folder — unreadable, vanished mid-scan — is simply
 *  not a repository. */
async function hasDotGit(folder: string): Promise<boolean> {
  try {
    await stat(join(folder, '.git'));
    return true;
  } catch {
    return false;
  }
}

/**
 * Changed files from several child repositories, named so they can be matched
 * against a walk of the parent: every path gains the child's name as a prefix,
 * which is exactly how the parent's own listing spells that file.
 */
export function changedAcross(
  children: readonly { rel: string; files: readonly { path: string }[] }[],
): readonly { path: string }[] {
  return children.flatMap((one) =>
    one.files.map((file) => ({ path: `${one.rel}/${file.path}` })),
  );
}
