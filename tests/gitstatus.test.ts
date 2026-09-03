/** The pure half of the overview: `git status --porcelain=v2` text in, a
 *  snapshot out. No shell here — the shell owns getting the text, this file
 *  owns reading it. */

import { describe, expect, it } from 'vitest';
import { parseGitStatus } from '../src/lib/gitstatus';

/** One `1 …` entry, spelled the way git spells it: two status letters, the
 *  submodule field, three file modes, two object ids, then the path. */
function tracked(slots: string, path: string): string {
  const oid = 'c2feccac137e9058c589ac6bbfe2cb75d0acb535';
  return `1 ${slots} N... 100644 100644 100644 ${oid} ${oid} ${path}`;
}

describe('git overview — reading git status text', () => {
  it('reads the branch and a clean tree', () => {
    const snapshot = parseGitStatus('# branch.head main\n# branch.upstream origin/main\n# branch.ab +0 -0\n');
    expect(snapshot).toEqual({
      branch: 'main',
      branches: [],
      dirty: false,
      unstaged: 0,
      staged: 0,
      untracked: 0,
      changedPaths: 0,
      files: [],
      // The porcelain format carries no line totals; whoever asks for the
      // status reads them separately.
      added: 0,
      removed: 0,
      ahead: 0,
      behind: 0,
    });
  });

  it('counts a file once, however many sides of it changed', () => {
    const raw = [
      '# branch.head design',
      tracked('.M', 'src/App.tsx'),
      tracked('M.', 'package.json'),
      tracked('MM', 'README.md'),
      '? public/hero.svg',
    ].join('\n');
    const snapshot = parseGitStatus(raw);
    // Four files, and README.md is both staged and edited again: the three
    // counts add up to five.
    expect(snapshot.unstaged + snapshot.staged + snapshot.untracked).toBe(5);
    expect(snapshot.changedPaths).toBe(4);
  });

  it('counts staged and unstaged work separately', () => {
    const raw = [
      '# branch.head design',
      tracked('.M', 'src/App.tsx'),
      tracked('M.', 'package.json'),
      tracked('MM', 'README.md'),
    ].join('\n');
    const snapshot = parseGitStatus(raw);
    expect(snapshot.branch).toBe('design');
    expect(snapshot.dirty).toBe(true);
    expect(snapshot.unstaged).toBe(2);
    expect(snapshot.staged).toBe(2);
  });

  it('names the files, so the panel can say where rather than how many', () => {
    const raw = [
      '# branch.head design',
      tracked('.M', 'src/pages/pricing.tsx'),
      tracked('A.', 'src/components/Banner.tsx'),
      '? public/hero.svg',
    ].join('\n');
    expect(parseGitStatus(raw).files).toEqual([
      { path: 'src/pages/pricing.tsx', kind: 'changed' },
      { path: 'src/components/Banner.tsx', kind: 'new' },
      { path: 'public/hero.svg', kind: 'new' },
    ]);
  });

  it('keeps a filename that has spaces in it whole', () => {
    const raw = ['# branch.head main', tracked('.M', 'src/Hero Section copy.tsx')].join('\n');
    expect(parseGitStatus(raw).files).toEqual([
      { path: 'src/Hero Section copy.tsx', kind: 'changed' },
    ]);
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
      tracked('..', 'src/App.svelte'),
      '2 ..R N... 100644 100644 100644 a.js -> b.js',
    ].join('\n');
    const snapshot = parseGitStatus(raw);
    expect(snapshot.dirty).toBe(false);
    expect(snapshot.staged).toBe(0);
    expect(snapshot.unstaged).toBe(0);
    expect(snapshot.files).toEqual([]);
  });
});