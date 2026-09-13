/** A save must not move the folder's own git state, and must not put a moment
 *
 *  The claim, in one line: opening a folder, reading a conversation and letting
 *  a turn end leave HEAD, the branch, the index and the configuration exactly
 *  as they were found, and every saved moment lands under the app's own ref
 *  namespace rather than on the branch somebody is working on. Real
 *  repositories on a real disk, because "the index is as it was" is a claim
 *  only git itself can settle. */

import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { devNull, tmpdir } from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, describe, expect, it, vi } from 'vitest';

import { HistoryError, ProjectHistory, historyProblems } from '../src/history/repo';
import { Timeline } from '../src/history/timeline';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const made: string[] = [];

afterAll(async () => {
  await Promise.all(made.map((folder) => rm(folder, { recursive: true, force: true })));
});

async function newFolder(): Promise<string> {
  const folder = await realpath(await mkdtemp(path.join(tmpdir(), 'graphe-checkpoint-')));
  made.push(folder);
  return folder;
}

const spawn = promisify(execFile);

/** Raw access to git, for the tests only: the app itself never runs a command
 *  outside `src/history/repo.ts`. */
async function git(root: string, args: string[]): Promise<string> {
  const { stdout } = await spawn('git', args, {
    cwd: root,
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: devNull,
      GIT_CONFIG_SYSTEM: devNull,
      GIT_AUTHOR_NAME: 'A Developer',
      GIT_AUTHOR_EMAIL: 'developer@example.com',
      GIT_COMMITTER_NAME: 'A Developer',
      GIT_COMMITTER_EMAIL: 'developer@example.com',
    },
    maxBuffer: 32 * 1024 * 1024,
  });
  return stdout;
}

async function put(root: string, file: string, contents: string): Promise<void> {
  const target = path.join(root, file);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, contents, 'utf8');
}

async function get(root: string, file: string): Promise<string> {
  return readFile(path.join(root, file), 'utf8');
}

/**
 * A repository somebody else set up: one file staged and then changed again, so
 * the index and the folder disagree; one file changed and left alone; one file
 * git has never seen. Every one of the three has to survive a save untouched.
 */
async function theirFolder(): Promise<string> {
  const root = await newFolder();
  await git(root, ['init', '--quiet', '-b', 'main']);
  await put(root, 'staged.txt', 'one\n');
  await put(root, 'loose.txt', 'one\n');
  await git(root, ['add', '.']);
  await git(root, ['commit', '--quiet', '--message', 'their own work']);
  await git(root, ['config', 'user.name', 'A Developer']);
  await git(root, ['config', 'user.email', 'developer@example.com']);

  await put(root, 'staged.txt', 'two\n');
  await git(root, ['add', 'staged.txt']);
  await put(root, 'staged.txt', 'three\n');
  await put(root, 'loose.txt', 'two\n');
  await put(root, 'brand-new.txt', 'hello\n');
  return root;
}

/** Everything about the folder's own state that a save must not move. */
async function stateOf(root: string): Promise<Record<string, string>> {
  return {
    head: await git(root, ['rev-parse', 'HEAD']),
    branch: await git(root, ['symbolic-ref', 'HEAD']),
    status: await git(root, ['status', '--porcelain=v1', '--untracked-files=all']),
    staged: await git(root, ['diff', '--cached']),
    unstaged: await git(root, ['diff']),
    config: await git(root, ['config', '--list', '--local']),
    branches: await git(root, ['for-each-ref', '--format=%(refname)', 'refs/heads']),
  };
}

describe('a save leaves the folder as it found it', () => {
  it('reads, opens and saves without moving HEAD, the branch, the index or the configuration', async () => {
    const root = await theirFolder();
    const before = await stateOf(root);
    const history = new ProjectHistory(root);

    expect(await history.isReady()).toBe(true);
    expect(await history.hasUnsavedChanges()).toBe(true);
    expect((await history.unsavedChanges()).map((one) => one.path).sort()).toEqual([
      'brand-new.txt',
      'loose.txt',
      'staged.txt',
    ]);
    expect((await history.diffWorking()).length).toBeGreaterThan(0);

    const saved = await history.snapshot('Saved after a turn');
    expect(saved).not.toBeNull();

    expect(await history.versions()).toHaveLength(2);
    expect(await history.currentVersion()).toBe(saved);
    expect(await stateOf(root)).toEqual(before);
  });

  it('saves even where a hook would have stopped a commit and signing is on', async () => {
    const root = await theirFolder();
    await git(root, ['config', 'commit.gpgsign', 'true']);
    await put(root, '.git/hooks/pre-commit', '#!/bin/sh\nexit 1\n');
    await chmod(path.join(root, '.git/hooks/pre-commit'), 0o755);
    const before = await stateOf(root);

    const saved = await new ProjectHistory(root).snapshot('Saved after a turn');
    expect(saved).not.toBeNull();
    expect(await stateOf(root)).toEqual(before);
  });

  it('leaves work alone in a folder whose branch has history of its own', async () => {
    const root = await theirFolder();
    // The old shape of a saved moment: a commit on their branch, as a project
    // that has been open in an older build of the app would have.
    await git(root, ['add', '--all']);
    await git(root, ['commit', '--quiet', '--message', 'Graphe-By: graphe']);
    const head = (await git(root, ['rev-parse', 'HEAD'])).trim();
    const beforeOpening = await stateOf(root);

    const line = await Timeline.open(root);
    const all = await line.versions();
    expect(all.map((one) => one.title)).toEqual(['Graphe-By: graphe', 'their own work']);
    expect(await stateOf(root)).toEqual(beforeOpening);

    await put(root, 'brand-new.txt', 'hello again\n');
    const beforeSaving = await stateOf(root);
    const made = await line.snapshot({ instruction: 'change the greeting' });
    expect(made).not.toBeNull();

    expect((await git(root, ['rev-parse', 'HEAD'])).trim()).toBe(head);
    expect(await line.versions()).toHaveLength(3);
    // Read the way any other moment on that branch is read, and off the branch.
    expect(await git(root, ['show', `${made!.id}:brand-new.txt`])).toBe('hello again\n');
    expect(await stateOf(root)).toEqual(beforeSaving);
  });
});

describe('where a saved moment is kept', () => {
  it('is under the app own namespace, and the branch carries none of it', async () => {
    const root = await theirFolder();
    const history = new ProjectHistory(root);
    const saved = await history.snapshot('Saved after a turn');

    expect((await git(root, ['rev-parse', 'refs/graphe/checkpoints'])).trim()).toBe(saved);
    expect(await git(root, ['show', 'refs/graphe/checkpoints:staged.txt'])).toBe('three\n');
    expect(await git(root, ['show', 'refs/graphe/checkpoints:brand-new.txt'])).toBe('hello\n');
    expect(await git(root, ['show', 'refs/graphe/checkpoints:loose.txt'])).toBe('two\n');

    // Their branch is where they left it, one commit of their own and no more.
    const onBranch = (await git(root, ['log', '--oneline', 'main'])).trim().split('\n');
    expect(onBranch).toHaveLength(1);
    expect(onBranch[0]).toContain('their own work');
  });

  it('is readable back as ordinary history, newest first', async () => {
    const root = await theirFolder();
    const line = await Timeline.open(root);
    await put(root, 'loose.txt', 'three\n');
    const made = await line.snapshot({ instruction: 'change the loose file' });

    const all = await line.versions();
    expect(all.map((one) => one.title)).toEqual(['Changed the loose file', 'their own work']);
    expect(all[0]!.id).toBe(made?.id);
    expect(all[0]!.named).toBe(false);
    expect(all[1]!.by).toBe('you');
  });

  it('gives a copy made to try something out its own, so nothing of it reaches the timeline', async () => {
    const root = await theirFolder();
    const history = new ProjectHistory(root);
    const first = await history.snapshot('Saved after a turn');
    const before = await history.versions();

    const copy = await newFolder();
    await history.addWorkspace(copy);
    await put(copy, 'loose.txt', 'tried this\n');
    const inside = new ProjectHistory(copy);
    const tried = await inside.snapshot('Tried something');
    expect(tried).not.toBeNull();

    // The project's own timeline and its newest moment are exactly as they were.
    expect((await history.versions()).map((one) => one.id)).toEqual(before.map((one) => one.id));
    expect((await git(root, ['rev-parse', 'refs/graphe/checkpoints'])).trim()).toBe(first);

    // The try is kept under a namespace of its own, and goes when the copy does.
    const kept = await git(root, ['for-each-ref', '--format=%(refname) %(objectname)', 'refs/graphe/copies']);
    expect(kept.trim().split('\n')).toHaveLength(1);
    expect(kept).toContain(tried!);

    await history.removeWorkspace(copy);
    expect((await git(root, ['for-each-ref', '--format=%(refname)', 'refs/graphe/copies'])).trim()).toBe('');
  });
});

describe('going back', () => {
  it('refuses while anything is unsaved, and says so', async () => {
    const root = await theirFolder();
    const history = new ProjectHistory(root);
    const first = await history.snapshot('Saved after a turn');
    const head = (await git(root, ['rev-parse', 'HEAD'])).trim();

    await put(root, 'loose.txt', 'three\n');
    const stagedBefore = await git(root, ['diff', '--cached']);
    const refused = await history.restoreTo(first!, 'Went back').catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(HistoryError);
    expect((refused as HistoryError).message).toBe(historyProblems.unsavedFirst);

    // Nothing moved: the work is exactly where the person left it, and what
    // they had staged is still staged.
    expect(await get(root, 'loose.txt')).toBe('three\n');
    expect(await get(root, 'staged.txt')).toBe('three\n');
    expect(await git(root, ['diff', '--cached'])).toBe(stagedBefore);
    expect((await git(root, ['rev-parse', 'HEAD'])).trim()).toBe(head);
  });

  it('puts the files back when nothing is unsaved, as a moment of its own', async () => {
    const root = await theirFolder();
    const history = new ProjectHistory(root);
    const first = await history.snapshot('Saved after a turn');
    const head = (await git(root, ['rev-parse', 'HEAD'])).trim();

    await put(root, 'loose.txt', 'three\n');
    await history.snapshot('Changed the loose file');
    const back = await history.restoreTo(first!, 'Went back');

    expect(await get(root, 'loose.txt')).toBe('two\n');
    expect(await get(root, 'brand-new.txt')).toBe('hello\n');
    expect((await history.versions()).map((one) => one.title)).toEqual([
      'Went back',
      'Changed the loose file',
      'Saved after a turn',
      'their own work',
    ]);
    expect(back).not.toBeNull();
    expect((await git(root, ['rev-parse', 'HEAD'])).trim()).toBe(head);
  });
});
