import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);
import { join } from 'node:path';
import { createWorktree, type RunGit } from '../src/history/worktree';

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
 */
async function gitRun(cwd: string, args: string[]): Promise<{ code: number; out?: string }> {
  try {
    const made = await execFileAsync('git', args, { cwd, encoding: 'utf8' });
    return { code: 0, out: made.stdout };
  } catch (cause) {
    const failed = cause as { code?: number };
    return { code: typeof failed.code === 'number' ? failed.code : 1, out: '' };
  }
}

function gitRunHereFor(): RunGit {
  return (args, options) => gitRun(options.cwd, args);
}

export async function preparePrWorktree(project: string, prNumber: number): Promise<{ folder: string }> {
  const normalized = Number.isFinite(prNumber) && prNumber > 0 ? Math.floor(prNumber) : 0;
  if (normalized <= 0) throw new Error('Invalid PR number');
  const folder = join(project, '.graphe', 'worktrees', `pr-${normalized}`);
  const run = gitRunHereFor();
  const fetched = await gitRun(project, ['fetch', 'origin', `pull/${normalized}/head`]);
  if (fetched.code !== 0) throw new Error('Could not fetch PR');
  // If a worktree already exists at folder, remove it first so the branch
  // can be force-updated — git refuses `branch -f` while the branch is
  // checked out in a worktree, which would leave reset --hard pointing at
  // the old tip.
  await run(['worktree', 'remove', '--force', folder], { cwd: project }).catch(() => undefined);
  await run(['worktree', 'prune'], { cwd: project }).catch(() => undefined);
  // Ensure the branch points at the freshly fetched PR head
  const branched = await gitRun(project, ['branch', '-f', `graphe/pr-${normalized}`, 'FETCH_HEAD']);
  if (branched.code !== 0) throw new Error('Could not update PR branch to FETCH_HEAD');
  // Fresh worktree at FETCH_HEAD via the branch
  const created = await createWorktree(run, project, `pr-${normalized}`, { ref: `graphe/pr-${normalized}` }, { folder });
  if (!created.ok) {
    // Fallback: try direct worktree add if createWorktree's branch step raced
    const direct = await run(['worktree', 'add', '--force', folder, `graphe/pr-${normalized}`], { cwd: project });
    if (direct.code !== 0) throw new Error(created.because);
  }
  return { folder };
}
