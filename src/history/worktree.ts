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

export type Result = { ok: true; value: Worktree | null } | { ok: false; because: string };

const ok = (value: Worktree | null = null): Result => ({ ok: true, value });
const no = (because: string): Result => ({ ok: false, because });

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
): Promise<Result> {
  if (!(await isRepo(run, repo))) return no(worktreeWords.notRepo);
  const branch = branchFor(id);
  const folder = `${checkoutFolder(repo)}/${id}`;

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
