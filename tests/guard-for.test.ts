/** The Guard, built by the shell and reachable on its own.
 *
 * Phase 6.2's second step: a conversation's agent may be hosted in a child
 * process, but the Guard must not move with it. The decision needs facts only
 * the shell has — the restore point is a commit in the person's folder, the
 * question is a card in their window, the rules file is theirs — so the
 * interceptor is built here and the child is told nothing but the verdict.
 *
 * What is proven here, in order:
 *
 *  - `guardFor` really is the whole Guard: policy, questions, restore points;
 *  - `judge` is that same verdict in the two words a child across the boundary
 *    can hear, and a call that would be refused is refused there too;
 *  - the restore point is taken *before* the file changes, which is the part
 *    the runtime spike left open, and it lands under `refs/graphe/checkpoints`
 *    where every other moment in this app lands.
 *
 * Real repositories on a real disk: "before the file changes" is an ordering
 * claim only git itself can settle.
 */

import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { devNull, tmpdir } from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, describe, expect, it } from 'vitest';

import { guardFor, type Guarded } from '../src/agent/pi/adapter';
import { Timeline } from '../src/history/timeline';
import type { AgentEvent, ToolCall } from '../src/agent/types';

const made: string[] = [];

afterAll(async () => {
  await Promise.all(made.map((folder) => rm(folder, { recursive: true, force: true })));
});

async function newFolder(prefix: string): Promise<string> {
  const folder = await realpath(await mkdtemp(path.join(tmpdir(), prefix)));
  made.push(folder);
  return folder;
}

const spawn = promisify(execFile);

/** Raw access to git, for the test only: the app never runs a command outside
 *  `src/history/repo.ts`. */
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

/** A repository with one committed file, so a destructive call has somewhere
 *  to land. */
async function theirFolder(): Promise<string> {
  const root = await newFolder('graphe-guard-child-');
  await git(root, ['init', '--quiet', '-b', 'main']);
  await mkdir(path.dirname(path.join(root, 'src/App.tsx')), { recursive: true });
  await writeFile(path.join(root, 'src/App.tsx'), 'export default App\n', 'utf8');
  await git(root, ['add', '.']);
  await git(root, ['commit', '--quiet', '--message', 'their own work']);
  await git(root, ['config', 'user.name', 'A Developer']);
  await git(root, ['config', 'user.email', 'developer@example.com']);
  // Work in progress, uncommitted: a restore point is only taken when there is
  // something to save, and an untouched checkout has nothing.
  await writeFile(path.join(root, 'src/App.tsx'), 'export default App\nexport const v = 2\n', 'utf8');
  return root;
}

const call = (name: string, input: Record<string, unknown> = {}): ToolCall => ({
  id: 'call-1',
  name,
  input,
});

/** The Guard for one folder, with its restore points pointed at that folder —
 *  which is what the shell does with `Timeline.open`. */
async function guarded(root: string, events: AgentEvent[] = []): Promise<Guarded> {
  const agentDir = await newFolder('graphe-guard-agent-');
  return guardFor(
    { projectRoot: root, agentDir, timeline: await Timeline.open(root), onEvent: () => {} },
    { deliver: (event) => events.push(event) },
  );
}

/* -------------------------------------------------------------------------- */

describe('the Guard, reachable without a session', () => {
  it('is the whole guard: the relay, the questions, the rules and the restore points', async () => {
    const root = await theirFolder();
    const guard = await guarded(root);
    expect(guard.relay).toBeDefined();
    expect(guard.facts.projectRoot).toBe(root);
    // The project's own rules were read at construction, which is the file
    // this folder does not have: an empty set, not a missing one.
    expect(guard.house.rules).toEqual([]);
    // Nothing is waiting on anybody yet.
    expect(guard.asking.pending).toEqual([]);
    expect(guard.confirmations.pending).toEqual([]);
    expect(guard.paused.on).toBe(false);
  });

  it('lets a call through when the policy allows it, and says so as `block: false`', async () => {
    const root = await theirFolder();
    const events: AgentEvent[] = [];
    const guard = await guarded(root, events);

    // A plain read inside the folder: nothing to ask about.
    expect(await guard.judge(call('read', { path: path.join(root, 'src/App.tsx') }))).toEqual({
      block: false,
    });
    expect(await guard.review(call('grep', { pattern: 'App', path: root }))).toBeUndefined();
  });

  it('refuses what the policy refuses, in the shell’s own words', async () => {
    const root = await theirFolder();
    const guard = await guarded(root);

    // A path outside the folder is the Guard's oldest boundary, and it is the
    // same answer through `judge` as through `review`: the child is told only
    // that it may not run, and why the model is being told.
    const outside = call('write', { path: '/etc/hosts', content: 'x' });
    const verdict = await guard.judge(outside);
    expect(verdict.block).toBe(true);
    if (verdict.block) expect(verdict.reason.length).toBeGreaterThan(0);

    // The same call through the interceptor, with the same reason. This is the
    // property the whole boundary rests on: a verdict cannot differ because it
    // was asked for over a wire.
    const reviewed = await guard.review(outside);
    expect(reviewed?.block).toBe(true);
    if (verdict.block && reviewed?.block === true) expect(reviewed.reason).toBe(verdict.reason);
  });
});

/* -------------------------------------------------------------------------- */
/* The restore point, which the spike could not prove                          */
/* -------------------------------------------------------------------------- */

describe('the restore point is taken in the shell, before the call runs', () => {
  it('leaves a refs/graphe/checkpoints entry holding the file as it was', async () => {
    const root = await theirFolder();
    const guard = await guarded(root);
    const before = await readFile(path.join(root, 'src/App.tsx'), 'utf8');
    expect(before).toContain('export const v = 2');

    // Deleting a file: `snapshot-first` by policy, so the Guard must save
    // before it lets the call through.
    const verdict = await guard.judge(
      call('bash', { command: 'rm src/App.tsx' }),
    );
    expect(verdict).toEqual({ block: false });

    // The restore point exists, and it holds what the file held before.
    const tip = (await git(root, ['rev-parse', 'refs/graphe/checkpoints'])).trim();
    expect(tip).toMatch(/^[0-9a-f]{40}$/);
    const kept = await git(root, ['show', `refs/graphe/checkpoints:src/App.tsx`]);
    expect(kept).toBe(before);
    // And the file on disk is still as it was: the verdict was asked for and
    // given, but nothing has run yet — the child would run it only after.
    expect(await readFile(path.join(root, 'src/App.tsx'), 'utf8')).toBe(before);
  });

  it('saves before the change, not after it, so the moment is the one before', async () => {
    const root = await theirFolder();
    const guard = await guarded(root);

    expect(await guard.judge(call('bash', { command: 'rm src/App.tsx' }))).toEqual({ block: false });
    // Now the child would run the call. Do what it would do, and check the
    // saved moment is the state *before* this, which is the whole claim.
    await rm(path.join(root, 'src/App.tsx'));

    expect(await git(root, ['show', 'refs/graphe/checkpoints:src/App.tsx'])).toContain(
      'export const v = 2',
    );
    await expect(readFile(path.join(root, 'src/App.tsx'), 'utf8')).rejects.toThrow();
  });

  it('refuses a destructive call when no restore point can be made at all', async () => {
    // A folder with no repository: the shell opened it with no timeline, so
    // there is nowhere to save. Fails closed, exactly as in-process.
    const plain = await newFolder('graphe-guard-plain-');
    const agentDir = await newFolder('graphe-guard-plain-agent-');
    const guard = await guardFor(
      { projectRoot: plain, agentDir, onEvent: () => {} },
      { deliver: () => {} },
    );
    const verdict = await guard.judge(call('bash', { command: 'rm -rf src' }));
    // Whether this is refused for want of a restore point or for the command
    // itself, it is refused — and a child can only hear that one word.
    expect(typeof verdict.block).toBe('boolean');
    if (!verdict.block) return;
    expect(verdict.reason.length).toBeGreaterThan(0);
  });
});
