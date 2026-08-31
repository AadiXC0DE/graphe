import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);
import { join } from 'node:path';
import { createWorktree, type RunGit } from '../src/history/worktree';
import { keepOutOfCommits } from './excludes';

/**
 * Prepare an isolated worktree for a pull request — fetch and checkout.
 *
 * Fetches `pull/<n>/head` from origin and creates (or reuses) a worktree at
 * `.graphe/worktrees/pr-<n>` inside the project. The worktree is left on
 * disk so the review can read files from there rather than from the folder
 * the person happens to have open.
 *
 * Used for PR review isolation (#12): the folder may be on any branch and
 * reading files from it would be reviewing the wrong code.
 *
 * Only this pull request's own checkout is replaced. Another one on disk may
 * be open in a conversation right now, and throwing it away underneath that
 * conversation is worse than a folder nobody has read since — dropping the
 * conversation is what removes its checkout.
 */
async function gitRun(
  cwd: string,
  args: string[],
): Promise<{ code: number; out?: string; said?: string }> {
  try {
    const made = await execFileAsync('git', args, { cwd, encoding: 'utf8' });
    return { code: 0, out: made.stdout };
  } catch (cause) {
    const failed = cause as { code?: number; stdout?: string; stderr?: string; message?: string };
    return {
      code: typeof failed.code === 'number' ? failed.code : 1,
      out: failed.stdout ?? '',
      said: (failed.stderr ?? failed.message ?? '').trim(),
    };
  }
}

function gitRunHereFor(): RunGit {
  return (args, options) => gitRun(options.cwd, args);
}

/** What git said, kept for the details behind the message rather than the
 *  message itself. */
function because(what: string, said?: string): Error {
  const detail = (said ?? '').trim();
  return detail === '' ? new Error(what) : new Error(what, { cause: new Error(detail) });
}

/** The line that keeps the checkouts out of the person's next commit. */
export const EXCLUDE_LINE = '.graphe/';

/**
 * Keep the checkouts out of the person's next commit.
 *
 * `git add -A` stages a worktree folder as an embedded repository, so without
 * this a review checkout lands in somebody's commit.
 */
export function keepCheckoutsOutOfCommits(project: string): Promise<boolean> {
  return keepOutOfCommits(project, [EXCLUDE_LINE]);
}

export async function preparePrWorktree(project: string, prNumber: number): Promise<{ folder: string }> {
  const normalized = Number.isFinite(prNumber) && prNumber > 0 ? Math.floor(prNumber) : 0;
  if (normalized <= 0) throw new Error('Invalid PR number');
  const folder = join(project, '.graphe', 'worktrees', `pr-${normalized}`);
  const run = gitRunHereFor();
  // Before the checkout exists, so there is never a moment where it could be
  // staged.
  await keepCheckoutsOutOfCommits(project);
  const fetched = await gitRun(project, ['fetch', 'origin', `pull/${normalized}/head`]);
  if (fetched.code !== 0) {
    // Pull requests are fetched the way GitHub publishes them, so a project
    // whose origin is somewhere else fails here and should hear that rather
    // than "could not fetch".
    throw because(
      `I could not fetch pull request #${String(normalized)} from origin. Either it does not exist, or this project's origin is not GitHub — reviewing a pull request needs a GitHub remote.`,
      fetched.said,
    );
  }
  // If a worktree already exists at folder, remove it first so the branch
  // can be force-updated — git refuses `branch -f` while the branch is
  // checked out in a worktree, which would leave reset --hard pointing at
  // the old tip.
  await run(['worktree', 'remove', '--force', folder], { cwd: project }).catch(() => undefined);
  await run(['worktree', 'prune'], { cwd: project }).catch(() => undefined);
  // Ensure the branch points at the freshly fetched PR head
  const branched = await gitRun(project, ['branch', '-f', `graphe/pr-${normalized}`, 'FETCH_HEAD']);
  if (branched.code !== 0) {
    throw because(
      `I fetched pull request #${String(normalized)} but could not point a branch at it.`,
      branched.said,
    );
  }
  // Fresh worktree at FETCH_HEAD via the branch
  const created = await createWorktree(run, project, `pr-${normalized}`, { ref: `graphe/pr-${normalized}` }, { folder });
  if (!created.ok) {
    // Fallback: try direct worktree add if createWorktree's branch step raced
    const direct = await run(['worktree', 'add', '--force', folder, `graphe/pr-${normalized}`], { cwd: project });
    if (direct.code !== 0) {
      throw because(
        `${created.because} I could not make a separate checkout for pull request #${String(normalized)}.`,
        (direct as { said?: string }).said,
      );
    }
  }
  return { folder };
}
