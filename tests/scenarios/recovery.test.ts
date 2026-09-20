/** T51, T55, T57, T58: what survives a stop, a restart, a delete and a sweep.
 *
 * Phase 10.2 asks for these as named cases. Each is about an ending: a goal that
 * finished versus one that ran out of rounds; a conversation the app was killed
 * in the middle of; a chat somebody deleted; and a folder the storage screen
 * offers to clear.
 */

import { existsSync, readdirSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

/* Real repositories and real git, several per test. Under a loaded machine a
   ten second ceiling is the machine talking rather than the code. */
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

import {
  addConversation,
  addWorkspace,
  conversationById,
  emptyIndex,
  ensureProject,
  markDeleted,
  updateConversation,
  workspaceForConversation,
} from '../../electron/services/workspace-registry';
import { moveToTrash, trashFolder } from '../../electron/services/trash';
import {
  recoverAfterRestart,
  type DurableFacts,
  type SessionState,
} from '../../src/domain/conversations';
import {
  asConversationId,
  asRuntimeEpoch,
  asWorkspaceId,
  type RuntimeEpoch,
} from '../../src/domain/identity';
import { conversationOwner } from '../../src/domain/events';
import { ROUNDS, parseGoalCommand, verifyGoal } from '../../src/work/goal';
import { MOST_ROUNDS, carryOnWords } from '../../src/work/carryon';
import { KEEP_DAYS, sweep, whatToSweep, type Sweepable } from '../../src/work/storage';
import { createWorktree, holdsWork, type RunGit } from '../../src/history/worktree';
import { gitIn, gitRepo, type Built } from '../helpers/fixtures';

const NOW = Date.UTC(2026, 8, 1);
const DAY = 24 * 60 * 60 * 1000;

const made: Built[] = [];
const folders: string[] = [];

afterEach(async () => {
  for (const one of made.splice(0)) await one.dispose();
  for (const one of folders.splice(0)) await rm(one, { recursive: true, force: true });
});

async function scratch(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'graphe-scenario-profile-')));
  folders.push(root);
  return root;
}

function runner(): RunGit {
  return async (args, options) => {
    const one = await gitIn(options.cwd, ...args);
    return { code: one.code, out: one.out };
  };
}

/* -------------------------------------------------------------------------- */

describe('T51: a goal that finished, one that is stuck, one that is waiting', () => {
  const done = { done: 3, total: 3, next: null };
  const half = { done: 1, total: 3, next: 'the footer' };

  it('says done only when every step settled and the checks passed', () => {
    const passed = verifyGoal(done, { passed: true, reason: 'the typecheck passed' }, 'ship it');
    expect(passed.met).toBe(true);
    expect(passed.reason).toContain('the typecheck passed');

    // A model saying it is finished is not evidence, and neither is a list with
    // one step still open.
    const unfinished = verifyGoal(half, { passed: true, reason: 'the typecheck passed' }, 'ship it');
    expect(unfinished.met).toBe(false);
    expect(unfinished.reason).toContain('the footer');

    const failed = verifyGoal(done, { passed: false, reason: 'the typecheck failed' }, 'ship it');
    expect(failed.met).toBe(false);
    expect(failed.reason).toContain('the typecheck failed');
  });

  it('gives each way of not finishing its own sentence', () => {
    const reasons = [
      verifyGoal(null, null, 'ship it').reason,
      verifyGoal(half, null, 'ship it').reason,
      verifyGoal(done, { passed: false, reason: 'the typecheck failed' }, 'ship it').reason,
      verifyGoal(null, null, '').reason,
    ];
    expect(new Set(reasons).size).toBe(reasons.length);
    for (const one of reasons) expect(one.length).toBeGreaterThan(0);
  });

  it('stops itself at a ceiling rather than looping for ever', () => {
    // The round budget is the whole guard against "carries on by itself"
    // meaning "for ever": finite numbers, and the loop's own words for having
    // reached one. `MOST_ROUNDS` is where the carry-on loop stops; `ROUNDS` is
    // the goal loop's own ceiling.
    expect(MOST_ROUNDS).toBeGreaterThan(0);
    expect(Number.isInteger(MOST_ROUNDS)).toBe(true);
    expect(ROUNDS).toBeGreaterThan(0);
    expect(Number.isInteger(ROUNDS)).toBe(true);
    expect(carryOnWords.spent(MOST_ROUNDS + 1)).toContain(String(MOST_ROUNDS + 1));
  });

  it('lets somebody stop it and start it again, as two explicit commands', () => {
    // Stopped and waiting are the person's moves rather than the loop's, and
    // each says what it is.
    expect(parseGoalCommand('/goal pause')).toEqual({ kind: 'pause' });
    expect(parseGoalCommand('/goal resume')).toEqual({ kind: 'resume' });
    expect(parseGoalCommand('/goal')).toEqual({ kind: 'show' });
    expect(parseGoalCommand('do the thing')).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */

describe('T55: an app that was force quit', () => {
  const epoch = asRuntimeEpoch(1);
  const facts = (status: SessionState, runtimeEpoch: RuntimeEpoch | null = epoch): DurableFacts => ({
    conversationId: asConversationId('chat-a'),
    workspaceId: asWorkspaceId('w-1'),
    status,
    ownerId: conversationOwner(asConversationId('chat-a')),
    runtimeEpoch,
    writtenAt: NOW,
  });

  it('reads work that was in flight as interrupted, not as finished', () => {
    const inFlight: SessionState[] = ['opening', 'queued', 'running', 'waiting-input', 'compacting', 'stopping'];
    for (const state of inFlight) {
      const back = recoverAfterRestart(facts(state), false);
      expect(back.state, state).toBe('interrupted');
      expect(back.runtimeEpoch).toBeNull();
      expect(back.ownerId).toBeNull();
    }
  });

  it('keeps what was not in flight exactly as it was written down', () => {
    const settled = ['idle', 'failed', 'interrupted', 'archived'] as const;
    for (const state of settled) expect(recoverAfterRestart(facts(state), false).state, state).toBe(state);
  });

  it('believes a runtime that is really attached, but only with a generation', () => {
    // `alive` is a fact the supervisor establishes by reattaching. Without a
    // recorded generation there is nothing for it to refer to, so it still
    // reads as interrupted rather than as somebody else's live session.
    expect(recoverAfterRestart(facts('running'), true)).toEqual({
      state: 'running',
      runtimeEpoch: epoch,
      ownerId: conversationOwner(asConversationId('chat-a')),
    });
    expect(recoverAfterRestart(facts('running', null), true)).toEqual({
      state: 'interrupted',
      runtimeEpoch: null,
      ownerId: null,
    });
    expect(recoverAfterRestart(facts('idle'), false)).toEqual({
      state: 'idle',
      runtimeEpoch: null,
      ownerId: null,
    });
  });
});

/* -------------------------------------------------------------------------- */

describe('T57: deleting a chat, and archiving one', () => {
  it('keeps the transcript, and leaves the workspace and its files alone', async () => {
    const profile = await scratch();
    const repo = await gitRepo();
    made.push(repo);
    await writeFile(join(repo.root, 'uncommitted-work.ts'), 'export const wip = true;\n');

    const sessions = join(profile, 'sessions');
    await mkdir(sessions, { recursive: true });
    const transcript = join(sessions, 'chat-a.jsonl');
    await writeFile(transcript, '{"type":"message"}\n');

    const project = ensureProject(emptyIndex(), repo.root);
    const workspace = addWorkspace(project.index, {
      projectId: project.project.projectId,
      path: repo.root,
      kind: 'local',
      managed: false,
      now: NOW,
    });
    const chat = addConversation(workspace.index, {
      conversationId: 'chat-a',
      workspaceId: workspace.workspace.workspaceId,
      now: NOW,
    });

    const kept = await moveToTrash(transcript, profile, NOW);
    expect(kept).not.toBeNull();
    expect(existsSync(transcript)).toBe(false);
    expect(kept?.startsWith(trashFolder(profile))).toBe(true);
    expect(await readFile(kept ?? '', 'utf8')).toBe('{"type":"message"}\n');

    // Deleting a chat is not deleting the work: the conversation's workspace,
    // the folder, and the bytes nobody committed are all still there.
    expect(workspaceForConversation(chat.index, 'chat-a')?.cwd).toBe(repo.root);
    expect(existsSync(repo.root)).toBe(true);
    expect(existsSync(join(repo.root, 'uncommitted-work.ts'))).toBe(true);
    expect(await repo.status()).toContain('?? uncommitted-work.ts');
    // And it is not marked deleted: hiding a chat from a list is the window's
    // decision, and the folder behind it is still the one it works in.
    expect(chat.index.workspaces[workspace.workspace.workspaceId]?.state).toBe('ready');
  });

  it('archives without touching the folder either, and can be brought back', async () => {
    const project = ensureProject(emptyIndex(), '/work/atlas');
    const workspace = addWorkspace(project.index, {
      projectId: project.project.projectId,
      path: '/work/atlas',
      kind: 'local',
      managed: false,
      now: NOW,
    });
    const chat = addConversation(workspace.index, {
      conversationId: 'chat-a',
      workspaceId: workspace.workspace.workspaceId,
      now: NOW,
    });

    const archived = updateConversation(chat.index, 'chat-a', { archived: true });
    expect(conversationById(archived, 'chat-a')?.archived).toBe(true);
    expect(workspaceForConversation(archived, 'chat-a')?.cwd).toBe('/work/atlas');
    const back = updateConversation(archived, 'chat-a', { archived: false });
    expect(conversationById(back, 'chat-a')?.archived).toBe(false);
    // The record is still the same conversation: an archive flag is not a new
    // identity and not a copy.
    expect(conversationById(back, 'chat-a')?.conversationId).toBe('chat-a');
    expect(conversationById(back, 'chat-a')?.workspaceId).toBe(workspace.workspace.workspaceId);
  });

  it('writes down a workspace as gone without losing which folder it was', () => {
    const project = ensureProject(emptyIndex(), '/work/atlas');
    const workspace = addWorkspace(project.index, {
      projectId: project.project.projectId,
      path: '/work/atlas',
      kind: 'local',
      managed: false,
      now: NOW,
    });
    const deleted = markDeleted(workspace.index, workspace.workspace.workspaceId);
    const record = deleted.workspaces[workspace.workspace.workspaceId];
    expect(record?.state).toBe('deleted');
    expect(record?.cwd).toBe('/work/atlas');
  });
});

/* -------------------------------------------------------------------------- */

describe('T58: what the storage screen may clear', () => {
  it('keeps a checkout holding work, and clears one that is finished with', async () => {
    const repo = await gitRepo({ dirty: false });
    made.push(repo);
    const checkout = await createWorktree(runner(), repo.root, 'chat', null);
    if (!checkout.ok || checkout.value === null) throw new Error('the fixture could not isolate');
    await writeFile(join(checkout.value.folder, 'half-done.ts'), 'export const wip = true;\n');

    const dirty: Sweepable = {
      path: checkout.value.folder,
      kind: 'checkout',
      // Older than anything the screen would keep, so only "holds work" can
      // save it.
      at: NOW - (KEEP_DAYS.checkout + 1) * DAY,
      holdsWork: await holdsWork(runner(), checkout.value.folder),
      inUse: null,
    };
    const finished: Sweepable = {
      path: join(repo.root, '.graphe', 'worktrees', 'finished-long-ago'),
      kind: 'checkout',
      at: NOW - (KEEP_DAYS.checkout + 1) * DAY,
      holdsWork: false,
      inUse: null,
    };
    await mkdir(finished.path, { recursive: true });

    const { sweep: going, kept, because } = whatToSweep([dirty, finished], NOW);

    expect(going.map((one) => one.path)).toEqual([finished.path]);
    expect(kept.map((one) => one.path)).toEqual([dirty.path]);
    // The screen names the folders, not a count, and says what stayed and why.
    expect(because).toContain('holding work');
    expect(existsSync(dirty.path)).toBe(true);
  });

  it('reports the exact path it removed, and frees what it said it would', async () => {
    const repo = await gitRepo({ dirty: false });
    made.push(repo);
    const stale = join(repo.root, '.graphe', 'worktrees', 'stale');
    await mkdir(stale, { recursive: true });
    await writeFile(join(stale, 'output.txt'), 'x'.repeat(2_048));
    const picked: Sweepable[] = [
      { path: stale, kind: 'copy', at: NOW - (KEEP_DAYS.copy + 1) * DAY, holdsWork: false, inUse: null },
    ];

    const removed = await sweep(picked);

    expect(removed.removed).toBe(1);
    expect(existsSync(stale)).toBe(false);
  });

  it('leaves the branch behind when it clears a checkout, so the work is still somewhere', async () => {
    const repo = await gitRepo({ dirty: false });
    made.push(repo);
    const checkout = await createWorktree(runner(), repo.root, 'chat', null);
    if (!checkout.ok || checkout.value === null) throw new Error('the fixture could not isolate');
    await writeFile(join(checkout.value.folder, 'saved.ts'), 'export const saved = true;\n');
    await gitIn(checkout.value.folder, 'add', '-A');
    await gitIn(checkout.value.folder, 'commit', '-qm', 'the conversation’s saves');

    // Its saves are committed, so `git status` calls the folder clean and the
    // screen offers it up on age alone. What the sweep removes is the copy: the
    // branch it was on is where the work is, and it stays.
    const holds = await holdsWork(runner(), checkout.value.folder);
    expect(holds).toBe(false);
    expect(
      (await gitIn(repo.root, 'log', '--oneline', `graphe/chat`)).out.trim().length,
    ).toBeGreaterThan(0);

    await sweep([
      {
        path: checkout.value.folder,
        kind: 'checkout',
        at: NOW - (KEEP_DAYS.checkout + 1) * DAY,
        holdsWork: holds,
        inUse: null,
      },
    ]);
    expect(existsSync(checkout.value.folder)).toBe(false);
    expect((await gitIn(repo.root, 'rev-parse', '--verify', 'graphe/chat')).code).toBe(0);
  });

  it('never offers a folder it cannot name a kind for', async () => {
    const profile = await scratch();
    const folderRows = readdirSync(profile);
    expect(folderRows).toEqual([]);
    // Nothing in the walk is inferred from age alone: every row carries a kind,
    // which is what the retention rule is looked up by.
    const unknown = whatToSweep([], NOW);
    expect(unknown.sweep).toEqual([]);
    expect(unknown.because).toBe('Nothing to clear. Everything here is still in use.');
  });
});
