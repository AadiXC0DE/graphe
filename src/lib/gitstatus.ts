/** Reading `git status --porcelain=v2 --branch` with no node modules involved.
 *
 * The shell runs git so the renderer never has to (electron/main.ts), and this
 * file only turns the output into the snapshot the window draws. Pure and
 * synchronous — the same call, the same text, the same answer — which is what
 * makes it testable the way every other decision in this codebase is tested,
 * with a string in and an object out.
 *
 * ## What the format is
 *
 * `--porcelain=v2` is git's machine format: one header line per commit and
 * branch, then one line per changed file. In the middle of a burst of agent
 * changes nothing here is a source of truth — the numbers are "at the moment
 * the shell asked", and the shell asks when the window opens the overview and
 * when a sitting settles.
 */

import type { GitSnapshot } from './ipc';

/** The branch header, e.g. `# branch.head main`. Missing on a repository with
 *  no commits yet — which is what `branch: null` means. */
const BRANCH = /^# branch\.head (.*)$/m;

/** The up/down header, e.g. `# branch.ab +2 -1`. Absent when there is nothing
 *  the other side knows about, which is the common case. */
const AHEAD_BEHIND = /^# branch\.ab \+(\d+) -(\d+)$/m;

/** A file git does not know about at all. Global, because it is counted with
 *  `matchAll`. */
const UNTRACKED = /^\? /gm;

export function parseGitStatus(raw: string): GitSnapshot {
  const branch = BRANCH.exec(raw)?.[1] ?? null;
  const branchAb = AHEAD_BEHIND.exec(raw);

  let unstaged = 0;
  let staged = 0;
  for (const line of raw.split('\n')) {
    // Only the `1 <XY> ...` entries have the two letters that say which side
    // changed: first is the index half, second the worktree half.
    const slots = /^1 ([^ ]{2}) [^ ]/.exec(line);
    if (slots === null || slots[1] === undefined) continue;
    const index = slots[1][0];
    const worktree = slots[1][1];
    // A dot means unchanged on that side — git's own escape from the false "clean".
    if (worktree !== '.') unstaged += 1;
    if (index !== '.') staged += 1;
  }

  const untracked = [...raw.matchAll(UNTRACKED)].length;
  const dirty = staged > 0 || unstaged > 0 || untracked > 0;

  return {
    branch,
    dirty,
    unstaged,
    staged,
    untracked,
    ahead: branchAb === null ? 0 : Number(branchAb[1] ?? 0),
    behind: branchAb === null ? 0 : Number(branchAb[2] ?? 0),
  };
}