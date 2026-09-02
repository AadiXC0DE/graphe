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

import type { ChangedFile, GitSnapshot } from './ipc';

/** How many names the snapshot carries. The panel shows a handful and says how
 *  many more there are; a build that touched four hundred files should not send
 *  four hundred strings across for nobody to read. */
const NAMES = 40;

/** The branch header, e.g. `# branch.head main`. Missing on a repository with
 *  no commits yet — which is what `branch: null` means. */
const BRANCH = /^# branch\.head (.*)$/m;

/** The up/down header, e.g. `# branch.ab +2 -1`. Absent when there is nothing
 *  the other side knows about, which is the common case. */
const AHEAD_BEHIND = /^# branch\.ab \+(\d+) -(\d+)$/m;

export function parseGitStatus(raw: string): GitSnapshot {
  const branch = BRANCH.exec(raw)?.[1] ?? null;
  const branchAb = AHEAD_BEHIND.exec(raw);

  let unstaged = 0;
  let staged = 0;
  let untracked = 0;
  const files: ChangedFile[] = [];
  for (const line of raw.split('\n')) {
    // `1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>`. The two letters say which
    // side changed — index half first, worktree half second — and a dot means
    // unchanged on that side. The path is taken by position rather than by
    // pattern, because a filename may contain spaces.
    if (line.startsWith('1 ')) {
      const parts = line.split(' ');
      const slots = parts[1];
      if (slots === undefined || slots.length !== 2) continue;
      const index = slots[0];
      const worktree = slots[1];
      if (worktree !== '.') unstaged += 1;
      if (index !== '.') staged += 1;
      if (index === '.' && worktree === '.') continue;
      const path = parts.slice(8).join(' ');
      if (path !== '' && files.length < NAMES) {
        files.push({ path, kind: index === 'A' || worktree === 'A' ? 'new' : 'changed' });
      }
      continue;
    }
    if (line.startsWith('? ')) {
      untracked += 1;
      const path = line.slice(2);
      if (path !== '' && files.length < NAMES) files.push({ path, kind: 'new' });
    }
  }

  const dirty = staged > 0 || unstaged > 0 || untracked > 0;

  return {
    branch,
    // The branch list is read separately (src/lib/branches.ts) and merged in
    // by the shell; the status parser itself carries none.
    branches: [],
    dirty,
    unstaged,
    staged,
    untracked,
    files,
    // Read separately, by whoever asked for the status: `--porcelain=v2`
    // carries no line totals at all.
    added: 0,
    removed: 0,
    ahead: branchAb === null ? 0 : Number(branchAb[1] ?? 0),
    behind: branchAb === null ? 0 : Number(branchAb[2] ?? 0),
  };
}

/**
 * The lines added and removed, from `git diff --numstat`.
 *
 * One line per file, `added<TAB>removed<TAB>path`, and a dash for either count
 * on a file git read as binary. Those are counted as files rather than lines,
 * which is the honest answer: a picture has no lines.
 */
export function parseNumstat(raw: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of raw.split('\n')) {
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    added += Number(parts[0]) || 0;
    removed += Number(parts[1]) || 0;
  }
  return { added, removed };
}