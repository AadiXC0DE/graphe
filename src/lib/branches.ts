/** Reading the project's lines of work, with no node modules involved.
 *
 * The shell runs git so the renderer never has to (electron/main.ts), and this
 * file only turns the output into the branches the window draws. Pure and
 * synchronous, like the status parser above it: a string in, an object out,
 * testable without a repository.
 *
 * The format is `git for-each-ref` with `%00` separators, one line per branch:
 *
 *   <name>%00<upstream>%00<track>%00<short id>%00<subject>
 *
 * where `<track>` is git's own summary — `[ahead 2, behind 1]`, `[gone]`, or
 * nothing at all when the branch tracks nothing.
 */

import type { GitBranch } from './ipc';

/** One branch from a for-each-ref line, or null when the line is not one. */
export function parseBranchLine(line: string): Omit<GitBranch, 'current'> | null {
  const parts = line.split('\0');
  if (parts.length < 5) return null;
  const name = parts[0] ?? '';
  const upstream = parts[1];
  const track = parts[2] ?? '';
  const message = (parts[4] ?? '').replace(/\s+/g, ' ').trim();
  if (name === '' || name === 'HEAD') return null;

  const ahead = /ahead (\d+)/.exec(track)?.[1];
  const behind = /behind (\d+)/.exec(track)?.[1];
  const gone = track.includes('gone');

  return {
    name,
    upstream:
      upstream !== undefined && upstream !== '' && !gone ? upstream : null,
    ahead: ahead === undefined ? 0 : Number(ahead),
    behind: behind === undefined ? 0 : Number(behind),
    message,
  };
}

/** The branches, current one first, then the rest alphabetically. `current` is
 *  the branch the status parser already read (`branch.head`), because the
 *  for-each-ref output does not mark it. */
export function parseBranches(raw: string, current: string | null): readonly GitBranch[] {
  const branches: GitBranch[] = [];
  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue;
    const branch = parseBranchLine(line);
    if (branch === null) continue;
    branches.push({ ...branch, current: branch.name === current });
  }
  branches.sort((a, b) => {
    if (a.current !== b.current) return a.current ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return branches;
}