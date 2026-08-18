import { copyFile, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

/** One conversation, its own checkout.
 *
 * Two tabs working the same project parallel are two agents writing the same
 * files, and that ends in whichever finished second silently winning — the
 * reason Cursor, Windsurf and Claude Code each give an agent its own git
 * worktree and branch, then merge that branch back. This is the same shape,
 * kept small and ordinary-git so a designer's folder stays a normal repository
 * (ARCHITECTURE.md decision 4).
 *
 * Three verbs and one refusal:
 *
 *  - **`create`** makes a checkout and a branch for a conversation, somewhere
 *    the project never tracks. The branch starts where the work would have
 *    started — the current HEAD, or the project's own default line when a
 *    fresh base is asked for.
 *  - **`land`** brings a conversation's branch into the main checkout. Refused
 *    while the main checkout has tracked changes a merge could squash — the one
 *    moment a designer's unfinished work could be silently replaced, and
 *    nothing here is allowed to do that.
 *  - **`drop`** throws a checkout away, branch and all.
 *
 * Everything here is pure: the caller hands in the git runner, so a test can
 * point it at a real repository and the conversation can hand it the shell's
 * own.
 */

/** One conversation's isolated checkout. */
export type Worktree = {
  /** Absolute path of the checkout, where the session works. */
  folder: string;
  /** The branch it is checked out on. */
  branch: string;
};

/** The git runner the caller supplies. `cwd` is where the command runs. */
export type RunGit = (
  args: string[],
  options: { cwd: string },
) => Promise<{ code: number; out?: string }>;

export const worktreeWords = {
  notRepo: 'This folder is not a git repository, so a conversation cannot work on its own checkout of it.',
  dirty: 'You have unsaved work here that a merge could squash. Save it first, and this will finish.',
  noWorktree: 'This conversation has no checkout to merge back.',
} as const;

/** What an Apply carried back, and where it could not. */
export type BringBack = {
  /** Paths now carrying the conversation's version in the main checkout. */
  applied: readonly string[];
  /** Paths both sides changed. Left as the main checkout has them. */
  conflicted: readonly string[];
};

export type Result = { ok: true; value: Worktree | null } | { ok: false; because: string };

const ok = (value: Worktree | null = null): Result => ({ ok: true, value });
const no = (because: string): Result => ({ ok: false, because });

export const bringBackWords = {
  notRepo: 'This folder is not a git repository, so a conversation cannot bring its work back here.',
} as const;

/** Whether `folder` is a git checkout itself. */
async function isRepo(run: RunGit, folder: string): Promise<boolean> {
  return (await run(['rev-parse', '--is-inside-work-tree'], { cwd: folder })).code === 0;
}

/** Whether the main checkout has tracked changes a merge could squash.
 *  Untracked files are not squashed by a merge, so they do not hold one up. */
async function isDirty(run: RunGit, repo: string): Promise<boolean> {
  const { code, out } = await run(['status', '--porcelain'], { cwd: repo });
  if (code !== 0 || out === undefined) return false;
  return out.split('\n').some((line) => line.trim() !== '' && !line.startsWith('??'));
}

/** A branch name that reads as belonging to us and no-one else. Every segment
 *  is ours, so nothing in an id can smuggle a traversal or a name around the
 *  prefix. */
export function branchFor(id: string): string {
  const kept = id
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .split('/')
    .filter((part) => part !== '' && part !== '.' && part !== '..')
    .join('/')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `graphe/${kept === '' ? 'conversation' : kept}`;
}

/** A safe leaf name for a folder, from any id. */
export function folderLeaf(id: string): string {
  return branchFor(id).replace(/^graphe\//, '').replace(/[^a-zA-Z0-9_-]/g, '-');
}

/** Where the checkouts live, under the repository's own untracked roof. */
export function checkoutFolder(repo: string): string {
  return `${repo}/.graphe/worktrees`;
}

/**
 * Create one conversation's checkout.
 *
 * `base` names the branch to start from when a fresh base is wanted; null means
 * the current HEAD. The branch is new either way, so the conversation carries on
 * from where the work would have started rather than from a stranger's thread.
 */
export async function createWorktree(
  run: RunGit,
  repo: string,
  id: string,
  base: { ref: string } | null,
  options: { folder?: string } = {},
): Promise<Result> {
  if (!(await isRepo(run, repo))) return no(worktreeWords.notRepo);
  const branch = branchFor(id);
  const folder = options.folder ?? `${checkoutFolder(repo)}/${folderLeaf(id)}`;

  // Make the branch from the base (or the current HEAD), then check it out.
  // An existing branch is not a failure — a crash between create and use should
  // not strand a conversation that is half there — so only the checkout argues.
  const from = base === null ? 'HEAD' : base.ref;
  await run(['branch', branch, from], { cwd: repo });

  const added = await run(['worktree', 'add', '--force', folder, branch], { cwd: repo });
  if (added.code !== 0) return no(worktreeWords.notRepo);
  return ok({ folder, branch });
}

/** The branch a checkout is on, or null when it is not a worktree of ours. */
async function branchAt(run: RunGit, folder: string): Promise<string | null> {
  const { code, out } = await run(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: folder });
  if (code !== 0 || out === undefined) return null;
  const name = out.trim();
  return name === '' || name === 'HEAD' ? null : name;
}

/**
 * Bring a conversation's checkout into the main checkout, then throw the
 * checkout away.
 *
 * Refused while the main checkout has tracked changes a merge could squash.
 * The merge is a fast-forward when it can be, and an ordinary merge otherwise —
 * the conversation carries its own history, so a real conflict is git's and is
 * left for the person rather than guessed at.
 */
export async function landWorktree(run: RunGit, repo: string, folder: string): Promise<Result> {
  const branch = await branchAt(run, folder);
  if (branch === null) return no(worktreeWords.noWorktree);
  if (await isDirty(run, repo)) return no(worktreeWords.dirty);

  const merged = await run(['merge', '--no-edit', branch], { cwd: repo });
  if (merged.code !== 0) return no(worktreeWords.dirty);
  await dropWorktree(run, repo, folder);
  return ok();
}

/** Throw a conversation's checkout away, branch and all. */
export async function dropWorktree(run: RunGit, repo: string, folder: string): Promise<Result> {
  const branch = await branchAt(run, folder);
  await run(['worktree', 'remove', '--force', folder], { cwd: repo });
  if (branch !== null) await run(['branch', '-D', branch], { cwd: repo });
  return ok();
}

/** The names and statuses git reports, as `{ kind, path }` rows. */
async function changedAgainst(
  run: RunGit,
  dir: string,
  args: string[],
): Promise<Array<{ kind: 'A' | 'D' | 'M'; path: string }>> {
  const { code, out } = await run(args, { cwd: dir });
  if (code !== 0 || out === undefined) return [];
  const seen = new Map<string, 'A' | 'D' | 'M'>();
  for (const line of out.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    // A bare path (from `ls-files --others`) is a brand-new file.
    const match = /^([AMD])\s+(.+)$/.exec(trimmed);
    if (match === null) {
      if (trimmed !== '.' && !trimmed.startsWith('"')) seen.set(trimmed, 'A');
      continue;
    }
    const kind = match[1] ?? 'A';
    const path = (match[2] ?? '').trim();
    if (path !== '' && path !== '.') seen.set(path, kind === 'D' ? 'D' : 'A');
  }
  return [...seen.entries()].map(([path, kind]) => ({ kind, path }));
}

/** The worktree's own changes: committed since the base, uncommitted, and
 *  brand-new (untracked). A new file is a change too — Apply carries it. */
async function worktreeChanges(
  run: RunGit,
  folder: string,
  base: string,
): Promise<Array<{ kind: 'A' | 'D' | 'M'; path: string }>> {
  const committed = await changedAgainst(run, folder, ['diff', '--name-status', '--no-renames', base]);
  const working = await changedAgainst(run, folder, ['diff', '--name-status', '--no-renames']);
  const untracked = await changedAgainst(run, folder, ['ls-files', '--others', '--exclude-standard']);
  const byPath = new Map<string, 'A' | 'D' | 'M'>();
  for (const row of [...committed, ...working, ...untracked]) byPath.set(row.path, row.kind);
  return [...byPath.entries()].map(([path, kind]) => ({ kind, path }));
}

/** The commit the worktree branched from: two sides one ancestor, so the
 *  changes each side made since then are the ones worth comparing. */
async function sharedBase(run: RunGit, folder: string, repo: string): Promise<string | null> {
  const branch = await branchAt(run, folder);
  if (branch === null) return null;
  const { code, out } = await run(['merge-base', branch, 'HEAD'], { cwd: repo });
  return code === 0 && out !== undefined ? out.trim() : null;
}

/** Whether the main checkout changed that path since the shared base. */
async function mainChanged(run: RunGit, repo: string, base: string, path: string): Promise<boolean> {
  const rows = await changedAgainst(run, repo, ['diff', '--name-status', '--no-renames', base, '--', path]);
  return rows.length > 0;
}

/** Copy one file from the worktree into the main checkout, or remove it. */
async function carryFile(repo: string, folder: string, row: { kind: 'A' | 'D' | 'M'; path: string }): Promise<void> {
  const target = resolve(repo, row.path);
  if (row.kind === 'D') {
    await rm(target, { force: true });
    return;
  }
  await mkdir(dirname(target), { recursive: true });
  await copyFile(resolve(folder, row.path), target);
}

/**
 * Bring a conversation's work back into the main checkout, as uncommitted
 * changes.
 *
 * This is Cursor's Apply: it diffs the checkout's whole state against the base
 * it branched from — committed and uncommitted alike — and carries the files
 * into the main checkout without a commit, so the work is on disk the moment
 * it is applied and the person still decides the saving. A path the main
 * checkout has also changed since the base is left alone and reported, rather
 * than one side silently overwriting the other (that is the one moment a
 * designer's unfinished work could be replaced).
 */
export async function bringBack(
  run: RunGit,
  repo: string,
  folder: string,
): Promise<{ ok: true; value: BringBack } | { ok: false; because: string }> {
  if (!(await isRepo(run, repo))) return { ok: false, because: bringBackWords.notRepo };
  const base = await sharedBase(run, folder, repo);
  if (base === null) return { ok: false, because: bringBackWords.notRepo };
  const changes = await worktreeChanges(run, folder, base);
  const applied: string[] = [];
  const conflicted: string[] = [];
  for (const row of changes) {
    if (await mainChanged(run, repo, base, row.path)) {
      conflicted.push(row.path);
    } else {
      await carryFile(repo, folder, row);
      applied.push(row.path);
    }
  }
  return { ok: true, value: { applied, conflicted } };
}

/* -------------------------------------------------------------------------- */
/* Naming one                                                                  */
/* -------------------------------------------------------------------------- */

/** How many names to try before giving up on counting and taking the moment. */
const ENOUGH = 200;

/**
 * A name for a parallel checkout that nothing else is using.
 *
 * Naming one after how many conversations are open right now is the bug this
 * replaces: open three, close the second, open another, and the count says two
 * while conversation three is still working — so both are handed
 * `conversation-3`, the same branch and the same folder, and two agents write
 * one checkout.
 *
 * `made` only ever goes up. Anything already on disk from an earlier sitting is
 * stepped over rather than reused, because what is in it was somebody's work.
 * Pure: the caller says what exists, so this can be checked without a disk.
 */
export function nextCheckoutName(
  made: number,
  taken: (name: string) => boolean,
  now: number = Date.now(),
): { name: string; made: number } {
  let at = made;
  for (let tries = 0; tries < ENOUGH; tries += 1) {
    at += 1;
    const name = `conversation-${String(at)}`;
    if (!taken(name)) return { name, made: at };
  }
  // Two hundred in use is not a real project. The moment cannot collide with a
  // count, so this can never loop and never hands back a name in use.
  return { name: `conversation-${now.toString(36)}`, made: at };
}
