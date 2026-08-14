/** One conversation, its own checkout — the git worktree behind parallel tabs.
 *
 * Real git throughout, so what is claimed here is what actually happens on a
 * repository: a conversation's work lives in its own folder and branch, its
 * branch lands in the main checkout, and a main checkout with unsaved changes
 * is the one thing never flattened.
 */

import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

import {
  branchFor,
  checkoutFolder,
  createWorktree,
  dropWorktree,
  landWorktree,
  type RunGit,
} from '../src/history/worktree';

const spawn = promisify(execFile);

/** A real git runner. The working directory comes with each call. */
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

/** A fresh little repository, set up with direct git so the harness is trusted. */
async function freshRepo(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'graphe-worktree-'));
  await raw(root, 'init', '-b', 'main');
  await raw(root, 'config', 'user.email', 'test@graphe.local');
  await raw(root, 'config', 'user.name', 'Test');
  await raw(root, 'config', 'commit.gpgsign', 'false');
  await writeFile(path.join(root, 'a.txt'), 'a one\n');
  await raw(root, 'add', '.');
  await raw(root, 'commit', '-m', 'first');
  return root;
}

describe('branchFor — a branch that reads as ours', () => {
  it('keeps a clean id under our own prefix', () => {
    expect(branchFor('review')).toBe('graphe/review');
  });

  it('sheds anything that could read as a path outside the prefix', () => {
    expect(branchFor('../escape')).toBe('graphe/escape');
    expect(branchFor('no spaces')).toBe('graphe/no-spaces');
  });
});

describe('checkoutFolder', () => {
  it('lives under the repository, never inside its tracked tree', () => {
    expect(checkoutFolder('/one/two')).toBe('/one/two/.graphe/worktrees');
  });
});

describe('createWorktree', () => {
  it('makes a separate checkout on its own branch, starting at HEAD', async () => {
    const repo = await freshRepo();
    try {
      const made = await createWorktree(git(), repo, 'review', null);
      expect(made.ok).toBe(true);
      if (!made.ok || made.value === null) return;

      expect(made.value.branch).toBe('graphe/review');
      expect(made.value.folder).toContain('.graphe/worktrees/review');
      expect((await raw(made.value.folder, 'rev-parse', '--abbrev-ref', 'HEAD')).trim()).toBe(
        'graphe/review',
      );
      // Started where the work would have — on the current commit.
      expect((await raw(made.value.folder, 'show', 'HEAD:a.txt')).trim()).toBe('a one');
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it('branches from a named base when asked for a fresh start', async () => {
    const repo = await freshRepo();
    try {
      // A second commit on main, so the worktree rooted elsewhere differs.
      await writeFile(path.join(repo, 'a.txt'), 'a two\n');
      await raw(repo, 'commit', '-am', 'second');
      const made = await createWorktree(git(), repo, 'fresh', { ref: 'main~1' });
      expect(made.ok).toBe(true);
      if (!made.ok || made.value === null) return;
      expect((await raw(made.value.folder, 'show', 'HEAD:a.txt')).trim()).toBe('a one');
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it('refuses when the folder is not a repository', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'graphe-notrepo-'));
    try {
      const made = await createWorktree(git(), root, 'review', null);
      expect(made.ok).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('landWorktree — a conversation returns its work home', () => {
  it('merges a change made in the checkout into the main one', async () => {
    const repo = await freshRepo();
    try {
      const made = await createWorktree(git(), repo, 'review', null);
      expect(made.ok).toBe(true);
      if (!made.ok || made.value === null) return;

      // Work happens in the checkout, and the main checkout stays untouched.
      await writeFile(path.join(made.value.folder, 'a.txt'), 'a changed in the conversation\n');
      await raw(made.value.folder, 'commit', '-am', 'changed in a tab');

      const landed = await landWorktree(git(), repo, made.value.folder);
      expect(landed.ok).toBe(true);

      // The main checkout now has the conversation's change, and the checkout
      // is taken away.
      expect((await raw(repo, 'show', 'HEAD:a.txt')).trim()).toBe('a changed in the conversation');
      const list = await raw(repo, 'worktree', 'list');
      expect(list).not.toContain('.graphe/worktrees');
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it('refuses while the main checkout has unsaved tracked changes', async () => {
    const repo = await freshRepo();
    try {
      const made = await createWorktree(git(), repo, 'other', null);
      expect(made.ok).toBe(true);
      if (!made.ok || made.value === null) return;

      await writeFile(path.join(made.value.folder, 'a.txt'), 'done in the tab\n');
      await raw(made.value.folder, 'commit', '-am', 'tab work');

      await writeFile(path.join(repo, 'a.txt'), 'mine, not saved\n');
      const landed = await landWorktree(git(), repo, made.value.folder);
      expect(landed.ok).toBe(false);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });
});

describe('dropWorktree', () => {
  it('throws the checkout and its branch away', async () => {
    const repo = await freshRepo();
    try {
      const made = await createWorktree(git(), repo, 'review', null);
      expect(made.ok).toBe(true);
      if (!made.ok || made.value === null) return;

      const dropped = await dropWorktree(git(), repo, made.value.folder);
      expect(dropped.ok).toBe(true);
      const list = await raw(repo, 'worktree', 'list');
      expect(list).not.toContain('.graphe/worktrees');
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });
});
