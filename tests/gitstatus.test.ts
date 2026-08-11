/** The pure half of the overview: `git status --porcelain=v2` text in, a
 *  snapshot out. No shell here — the shell owns getting the text, this file
 *  owns reading it. */

import { describe, expect, it } from 'vitest';
import { parseGitStatus } from '../src/lib/gitstatus';

describe('git overview — reading git status text', () => {
  it('reads the branch and a clean tree', () => {
    const snapshot = parseGitStatus('# branch.head main\n# branch.upstream origin/main\n# branch.ab +0 -0\n');
    expect(snapshot).toEqual({
      branch: 'main',
      dirty: false,
      unstaged: 0,
      staged: 0,
      untracked: 0,
      ahead: 0,
      behind: 0,
    });
  });

  it('counts staged and unstaged work separately', () => {
    const raw = [
      '# branch.head design',
      '1 .M N... 100644 100644 100644 src/App.tsx',
      '1 M. N... 100644 100644 100644 package.json',
      '1 MM N... 100644 100644 100644 README.md',
    ].join('\n');
    const snapshot = parseGitStatus(raw);
    expect(snapshot.branch).toBe('design');
    expect(snapshot.dirty).toBe(true);
    expect(snapshot.unstaged).toBe(2);
    expect(snapshot.staged).toBe(2);
  });

  it('counts untracked files and marks the tree dirty', () => {
    const raw = '# branch.head main\n? src/new.tsx\n? notes.md\n';
    const snapshot = parseGitStatus(raw);
    expect(snapshot.untracked).toBe(2);
    expect(snapshot.dirty).toBe(true);
    expect(snapshot.staged).toBe(0);
    expect(snapshot.unstaged).toBe(0);
  });

  it('reads ahead and behind from the branch header', () => {
    const raw = '# branch.head main\n# branch.upstream origin/main\n# branch.ab +3 -7\n';
    const snapshot = parseGitStatus(raw);
    expect(snapshot.ahead).toBe(3);
    expect(snapshot.behind).toBe(7);
  });

  it('treats a repository with no commits yet as a branchless clean tree', () => {
    const snapshot = parseGitStatus('# branch.oid (initial)\n? index.html\n');
    expect(snapshot.branch).toBeNull();
    expect(snapshot.untracked).toBe(1);
    expect(snapshot.dirty).toBe(true);
  });

  it('does not mistake unchanged entries for work', () => {
    const raw = [
      '# branch.head main',
      '1 .. N... 100644 100644 100644 src/App.svelte',
      '2 ..R N... 100644 100644 100644 a.js -> b.js',
    ].join('\n');
    const snapshot = parseGitStatus(raw);
    expect(snapshot.dirty).toBe(false);
    expect(snapshot.staged).toBe(0);
    expect(snapshot.unstaged).toBe(0);
  });
});