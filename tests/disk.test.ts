/** What Graphe leaves on the disk.
 *
 * Twenty-two gigabytes in a day, and Settings said none of it: the sweep
 * counted "finished copies" only, so a copy carrying a gigabyte of installed
 * packages was invisible to the person whose disk it was.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { canClear, folderNamed, measureFolders, whatToSweep, type Sweepable } from '../src/work/storage';

const main = readFileSync(fileURLToPath(new URL('../electron/main.ts', import.meta.url)), 'utf8');
const worktree = readFileSync(
  fileURLToPath(new URL('../src/history/worktree.ts', import.meta.url)),
  'utf8',
);

describe('the storage rows', () => {
  it('name every folder the app writes to, scratch included', async () => {
    const names = (await measureFolders('/nowhere')).map((one) => one.name);
    expect(names).toContain('Scratch');
    expect(names).toContain('Branches');
    expect(names).toContain('Board copies');
    expect(names).toContain('Conversations');
  });

  /* A branch may hold somebody's only copy of unlanded work; a scratch folder
     and a log never do. */
  it('offer a Clear only where clearing is safe', () => {
    expect(canClear('Scratch')).toBe(true);
    expect(canClear('Logs')).toBe(true);
    expect(canClear('Branches')).toBe(false);
    expect(canClear('Board copies')).toBe(false);
    expect(canClear('Conversations')).toBe(false);
  });

  it('know where each row is, and nothing at all for a name they do not have', () => {
    expect(folderNamed('/data', 'Scratch')).toBe('/data/scratch');
    expect(folderNamed('/data', 'Nothing')).toBeNull();
  });

  it('are what the shell answers with, beside the sentence', () => {
    const at = main.indexOf('handle<StorageNow>(CHANNEL.storage');
    const block = main.slice(at, main.indexOf('\n  });', at));
    expect(block).toContain('clearable: canClear(one.name)');
  });

  it('can only be emptied where that is safe, whatever is asked for', () => {
    const at = main.indexOf('handle<StorageNow>(CHANNEL.clearFolder');
    const block = main.slice(at, main.indexOf('\n  });', at));
    expect(block).toContain("canClear(name) ? folderNamed(userData, name) : null");
  });
});

describe('a copy that has landed and gone cold', () => {
  it('is released even when it is carrying an install', () => {
    expect(worktree).toContain('settledAfter?: {');
    expect(worktree).toContain("run(['branch', '--merged', base, '--format=%(refname:short)']");
    expect(main).toContain('const SETTLED_DAYS = 14;');
  });

  /* Both, never one: a branch that landed a minute ago may still be open, and
     a cold folder may be the only copy of work that never landed. */
  it('has to be both landed and cold', () => {
    const at = worktree.indexOf('async function settledLongAgo(');
    const block = worktree.slice(at, worktree.indexOf('\n}', at));
    expect(block).toContain('Date.now() - when < after.days');
    expect(block).toContain('merged.has(branch)');
  });

  it('is never one that holds work, at any age', () => {
    const at = worktree.indexOf('export async function sweepCheckouts(');
    const block = worktree.slice(at, worktree.indexOf('\n}', at));
    expect(block.indexOf('holdsWork')).toBeLessThan(block.indexOf('settledLongAgo'));
  });
});

describe('the rule under all of it', () => {
  const held = (over: Partial<Sweepable>): Sweepable => ({
    path: '/x',
    kind: 'copy',
    at: 0,
    holdsWork: true,
    ...over,
  });

  it('never sweeps work nobody has brought in, however old', () => {
    const { sweep, kept } = whatToSweep([held({ at: 0 })], Date.now());
    expect(sweep).toEqual([]);
    expect(kept).toHaveLength(1);
  });
});
