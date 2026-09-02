/** Landing a conversation, in somebody's own history.
 *
 * A twelve-turn conversation is twelve automatic saves — made past the person's
 * hooks and without their signature, which is right for the timeline and wrong
 * for a history a colleague reads. So the default is one commit, made the way
 * they make commits: their `pre-commit` hook runs, and it can turn the landing
 * down.
 *
 * Real git, real hooks, real folders.
 */

import { execFile } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

import {
  createWorktree,
  landWorktree,
  landingWords,
  worktreeWords,
  type RunGit,
} from '../src/history/worktree';

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
  const root = await mkdtemp(path.join(tmpdir(), 'graphe-landing-'));
  await raw(root, 'init', '-b', 'main');
  await raw(root, 'config', 'user.email', 'test@graphe.local');
  await raw(root, 'config', 'user.name', 'Test');
  await raw(root, 'config', 'commit.gpgsign', 'false');
  await writeFile(path.join(root, 'a.txt'), 'a one\n');
  await raw(root, 'add', '.');
  await raw(root, 'commit', '-m', 'first');
  return root;
}

/** The person's own `pre-commit`, which the automatic saves skip. Writes a line
 *  outside the project each time it runs, so counting them is counting real
 *  commits rather than intentions. */
async function preCommitHook(repo: string, marker: string, answer = 0): Promise<void> {
  const hook = path.join(repo, '.git', 'hooks', 'pre-commit');
  await writeFile(hook, `#!/bin/sh\necho ran >> ${marker}\nexit ${String(answer)}\n`);
  await chmod(hook, 0o755);
}

async function ranTimes(marker: string): Promise<number> {
  if (!existsSync(marker)) return 0;
  return (await readFile(marker, 'utf8')).split('\n').filter((line) => line !== '').length;
}

async function versionCount(repo: string): Promise<number> {
  return Number.parseInt((await raw(repo, 'rev-list', '--count', 'HEAD')).trim(), 10);
}

/** Twelve turns' worth of automatic saves in a conversation's own checkout,
 *  taken the way `snapshot` takes them: past the hooks, unsigned. */
async function twelveTurns(folder: string): Promise<void> {
  for (let turn = 1; turn <= 12; turn += 1) {
    await writeFile(path.join(folder, 'a.txt'), `turn ${String(turn)}\n`);
    await raw(folder, 'add', '--all');
    await raw(folder, '-c', 'commit.gpgsign=false', 'commit', '--no-verify', '-m', `Graphe ${String(turn)}`);
  }
}

describe('landing squashes by default', () => {
  it('turns twelve automatic saves into one commit, and runs the pre-commit hook', async () => {
    const repo = await freshRepo();
    const marker = path.join(repo, '..', `${path.basename(repo)}-hook.log`);
    try {
      const made = await createWorktree(git(), repo, 'review', null);
      expect(made.ok).toBe(true);
      if (!made.ok || made.value === null) return;
      await twelveTurns(made.value.folder);
      await preCommitHook(repo, marker);

      const before = await versionCount(repo);
      const landed = await landWorktree(git(), repo, made.value.folder, {
        how: 'squash',
        message: 'Dark mode across the settings panel',
      });
      expect(landed.ok).toBe(true);

      expect((await versionCount(repo)) - before).toBe(1);
      expect(await ranTimes(marker)).toBe(1);
      expect((await raw(repo, 'log', '-1', '--pretty=%s')).trim()).toBe(
        'Dark mode across the settings panel',
      );
      expect((await raw(repo, 'log', '-1', '--pretty=%an')).trim()).toBe('Test');
      expect(await readFile(path.join(repo, 'a.txt'), 'utf8')).toBe('turn 12\n');
      // The twelve are not in the person's history at all.
      expect(await raw(repo, 'log', '--pretty=%s')).not.toContain('Graphe 7');
      expect((await raw(repo, 'status', '--porcelain')).trim()).toBe('');
    } finally {
      await rm(repo, { recursive: true, force: true });
      await rm(marker, { force: true });
    }
  });

  it('names the commit after the conversation when nobody typed a message', async () => {
    const repo = await freshRepo();
    try {
      const made = await createWorktree(git(), repo, 'conversation-3', null);
      if (!made.ok || made.value === null) return;
      await twelveTurns(made.value.folder);

      expect((await landWorktree(git(), repo, made.value.folder)).ok).toBe(true);
      expect((await raw(repo, 'log', '-1', '--pretty=%s')).trim()).toBe(
        landingWords.message('graphe/conversation-3'),
      );
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it('keeps every version when that is what was asked for', async () => {
    const repo = await freshRepo();
    try {
      const made = await createWorktree(git(), repo, 'review', null);
      if (!made.ok || made.value === null) return;
      await twelveTurns(made.value.folder);

      const before = await versionCount(repo);
      const landed = await landWorktree(git(), repo, made.value.folder, { how: 'every-version' });
      expect(landed.ok).toBe(true);
      expect((await versionCount(repo)) - before).toBe(12);
      expect(await raw(repo, 'log', '--pretty=%s')).toContain('Graphe 7');
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it('leaves the work staged and the checkout alone when the hook says no', async () => {
    const repo = await freshRepo();
    const marker = path.join(repo, '..', `${path.basename(repo)}-refused.log`);
    try {
      const made = await createWorktree(git(), repo, 'review', null);
      if (!made.ok || made.value === null) return;
      const { folder } = made.value;
      await twelveTurns(folder);
      await preCommitHook(repo, marker, 1);

      const before = await versionCount(repo);
      const landed = await landWorktree(git(), repo, folder);
      expect(landed.ok).toBe(false);
      if (!landed.ok) expect(landed.because).toBe(landingWords.failed);

      // Nothing committed, nothing thrown away: the changes are there to commit
      // by hand, and the conversation still has its checkout.
      expect(await versionCount(repo)).toBe(before);
      expect(await readFile(path.join(repo, 'a.txt'), 'utf8')).toBe('turn 12\n');
      expect(await raw(repo, 'worktree', 'list')).toContain(path.basename(folder));
    } finally {
      await rm(repo, { recursive: true, force: true });
      await rm(marker, { force: true });
    }
  });

  it('puts the project back when both sides changed the same lines', async () => {
    const repo = await freshRepo();
    try {
      const made = await createWorktree(git(), repo, 'review', null);
      if (!made.ok || made.value === null) return;
      await writeFile(path.join(made.value.folder, 'a.txt'), 'the conversation decided this\n');
      await raw(made.value.folder, 'commit', '-am', 'Graphe 1');

      await writeFile(path.join(repo, 'a.txt'), 'I decided this\n');
      await raw(repo, 'commit', '-am', 'mine');

      const landed = await landWorktree(git(), repo, made.value.folder);
      expect(landed.ok).toBe(false);
      if (!landed.ok) expect(landed.because).toBe(worktreeWords.clashed);

      // Left exactly as it was: no half-merged files, no markers on disk.
      expect((await raw(repo, 'status', '--porcelain', '-uno')).trim()).toBe('');
      expect(await readFile(path.join(repo, 'a.txt'), 'utf8')).toBe('I decided this\n');
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it('says both ways round in words a person can choose between', () => {
    expect(landingWords.squash).toBe('One commit, your message');
    expect(landingWords.every).toBe('Keep every version');
    expect(landingWords.note).toContain('pre-commit');
  });
});
