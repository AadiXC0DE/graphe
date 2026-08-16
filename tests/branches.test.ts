/** The lines of work a project keeps, read from git's own output.
 *
 * The shell runs git; this file turns `git for-each-ref` lines into the
 * branches the window draws. Pure — a string in, an object out — so the
 * parsing is decided in tests, never on the day's repository. */

import { describe, expect, it } from 'vitest';

import { parseBranchLine, parseBranches } from '../src/lib/branches';

describe('one branch line', () => {
  it('reads the name, upstream and the last commit', () => {
    const branch = parseBranchLine('main\x00origin/main\x00[gone]\x001a2b3c4\x00Ship the header');
    expect(branch).not.toBeNull();
    expect(branch?.name).toBe('main');
    expect(branch?.ahead).toBe(0);
    expect(branch?.behind).toBe(0);
    expect(branch?.message).toBe('Ship the header');
  });

  it('reads ahead and behind from git\'s track summary', () => {
    const branch = parseBranchLine('feature/x\x00origin/feature/x\x00[ahead 3, behind 1]\x009f8e7d6\x00  A  message  with spaces  ');
    expect(branch?.upstream).toBe('origin/feature/x');
    expect(branch?.ahead).toBe(3);
    expect(branch?.behind).toBe(1);
    // The subject is collapsed to one line of words.
    expect(branch?.message).toBe('A message with spaces');
  });

  it('treats a branch with no upstream as tracking nothing', () => {
    const branch = parseBranchLine('solo\x00\x00\x00abc1234\x00Just here');
    expect(branch?.upstream).toBeNull();
    expect(branch?.ahead).toBe(0);
  });

  it('passes over a line that is not a branch', () => {
    expect(parseBranchLine('')).toBeNull();
    expect(parseBranchLine('HEAD\x00\x00\x00abc\x00the symbolic head')).toBeNull();
  });
});

describe('the branch list', () => {
  const raw = [
    'main\x00origin/main\x00[ahead 2]\x00aaaa\x00The main line',
    'feature/x\x00origin/feature/x\x00[ahead 1, behind 2]\x00bbbb\x00The experiment',
    'old-idea\x00\x00\x00cccc\x00A forgotten idea',
  ].join('\n');

  it('puts the current branch first', () => {
    const branches = parseBranches(raw, 'feature/x');
    expect(branches[0]?.name).toBe('feature/x');
    expect(branches[0]?.current).toBe(true);
    expect(branches.filter((one) => one.current).length).toBe(1);
  });

  it('marks nothing current when the current branch is unknown', () => {
    const branches = parseBranches(raw, null);
    expect(branches.some((one) => one.current)).toBe(false);
  });

  it('keeps the rest in alphabetical order', () => {
    const branches = parseBranches(raw, 'feature/x');
    expect(branches.map((one) => one.name)).toEqual(['feature/x', 'main', 'old-idea']);
  });
});