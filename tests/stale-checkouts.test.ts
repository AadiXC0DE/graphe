/** Rows that name a folder this project does not have out.
 *
 * A copy given back is an ordinary row, not a broken one — what a conversation
 * owns is its branch. But a project that was moved carries rows pointing into a
 * repository that is no longer there, and reusing one hands a conversation
 * somebody else's files. So every row is checked against the checkouts the
 * repository really has, and the ones that do not match are put away in the
 * open rather than quietly used.
 *
 * Real git, real folders.
 */

import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

import { checkoutWords, validateCheckouts, type Checkout } from '../src/history/checkouts';
import { createWorktree, putAwayWorktree, type RunGit } from '../src/history/worktree';

const spawn = promisify(execFile);

function git(): RunGit {
  return async (args, options) => {
    try {
      const result = await spawn('git', ['-C', options.cwd, ...args], { encoding: 'utf8' });
      return { code: 0, out: result.stdout };
    } catch (error) {
      const failed = error as { code?: number };
      return { code: typeof failed.code === 'number' ? failed.code : 1, out: '' };
    }
  };
}

async function raw(cwd: string, ...args: string[]): Promise<string> {
  const result = await spawn('git', ['-C', cwd, ...args], { encoding: 'utf8' });
  return result.stdout;
}

async function freshRepo(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'graphe-stale-'));
  await raw(root, 'init', '-b', 'main');
  await raw(root, 'config', 'user.email', 'test@graphe.local');
  await raw(root, 'config', 'user.name', 'Test');
  await raw(root, 'config', 'commit.gpgsign', 'false');
  await writeFile(path.join(root, 'a.txt'), 'a one\n');
  await raw(root, 'add', '.');
  await raw(root, 'commit', '-m', 'first');
  return root;
}

describe('checking stored rows against the checkouts that exist', () => {
  it('keeps a row whose folder this repository really has out', async () => {
    const repo = await freshRepo();
    try {
      const made = await createWorktree(git(), repo, 'review', null);
      expect(made.ok).toBe(true);
      if (!made.ok || made.value === null) return;

      const rows = new Map<string, Checkout>([['one', { ...made.value, named: true }]]);
      const checked = await validateCheckouts(repo, rows, git());

      expect(checked.putAway).toEqual([]);
      expect(checked.rows.get('one')).toEqual({ ...made.value, named: true });
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it('marks a row whose copy has been given back', async () => {
    const repo = await freshRepo();
    try {
      const made = await createWorktree(git(), repo, 'review', null);
      if (!made.ok || made.value === null) return;
      expect((await putAwayWorktree(git(), repo, made.value.folder)).put).toBe(true);

      const rows = new Map<string, Checkout>([['one', made.value]]);
      const checked = await validateCheckouts(repo, rows, git());

      expect(checked.putAway).toEqual(['one']);
      // Nothing is dropped: the branch is still where the work is.
      expect(checked.rows.get('one')?.branch).toBe(made.value.branch);
      expect(checked.rows.get('one')?.away).toBe(true);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  /* The moved-project case: the folder is still on disk, and belongs to a
     repository that has nothing to do with this one. */
  it('marks a row pointing into another repository, folder and all', async () => {
    const here = await freshRepo();
    const elsewhere = await freshRepo();
    try {
      const made = await createWorktree(git(), elsewhere, 'review', null);
      if (!made.ok || made.value === null) return;

      const rows = new Map<string, Checkout>([['one', made.value]]);
      const checked = await validateCheckouts(here, rows, git());

      expect(checked.putAway).toEqual(['one']);
      expect(checked.rows.get('one')?.away).toBe(true);
    } finally {
      await rm(here, { recursive: true, force: true });
      await rm(elsewhere, { recursive: true, force: true });
    }
  });

  it('clears the mark once the copy is spread out again', async () => {
    const repo = await freshRepo();
    try {
      const made = await createWorktree(git(), repo, 'review', null);
      if (!made.ok || made.value === null) return;

      const rows = new Map<string, Checkout>([['one', { ...made.value, away: true }]]);
      const checked = await validateCheckouts(repo, rows, git());

      expect(checked.putAway).toEqual([]);
      expect(checked.rows.get('one')?.away).toBeUndefined();
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it('marks nothing when git cannot answer', async () => {
    const folder = await mkdtemp(path.join(tmpdir(), 'graphe-not-a-repo-'));
    try {
      const rows = new Map<string, Checkout>([
        ['one', { folder: path.join(folder, 'copy'), branch: 'graphe/review' }],
      ]);
      const checked = await validateCheckouts(folder, rows, git());

      expect(checked.putAway).toEqual([]);
      expect(checked.rows).toBe(rows);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });

  it('says it in the plural as well as the singular', () => {
    expect(checkoutWords.putAway(1)).toContain('One conversation');
    expect(checkoutWords.putAway(3)).toContain('3 conversations');
  });
});
