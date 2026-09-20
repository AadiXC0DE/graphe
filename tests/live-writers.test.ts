/** Whose folder it is, and what a sweep may do about that.
 *
 * Invariant 15: a workspace cannot be cleaned up while it has live writers or
 * unrecovered changes. The "unrecovered changes" half was already held by the
 * holds-work rule; this is the live-writer half, on a real profile: the sweep
 * at launch, the Settings list under it, and the lease that says a folder has
 * somebody in it right now.
 *
 * Real disk, real worktrees, real locks. `electron/main.ts` cannot be imported
 * here, so what the shell passes in is driven at the layer it passes it to:
 * `writingIn` is the whole of the answer the shell builds, and `sweepCheckouts`
 * and `whatToSweep` are what consume it.
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import { WorkspaceLocks, type Ticket } from '../electron/services/workspace-locks';
import { writingIn, type LiveWriter } from '../electron/services/workspace-live';
import { createWorktree, sweepCheckouts, type RunGit } from '../src/history/worktree';
import { KEEP_DAYS, sweep, whatToSweep, type Sweepable } from '../src/work/storage';
import { admissionWords } from '../src/work/admission';

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
  const root = await mkdtemp(path.join(tmpdir(), 'graphe-live-'));
  await raw(root, 'init', '-b', 'main');
  await raw(root, 'config', 'user.email', 'test@graphe.local');
  await raw(root, 'config', 'user.name', 'Test');
  await raw(root, 'config', 'commit.gpgsign', 'false');
  await writeFile(path.join(root, 'a.txt'), 'a one\n');
  await raw(root, 'add', '.');
  await raw(root, 'commit', '-m', 'first');
  return root;
}

const ticket = (key: string, runId: string, label: string): Ticket => ({ key, runId, label });

const NOW = Date.UTC(2026, 8, 1);
const DAY = 24 * 60 * 60 * 1000;

/** A folder past every window the app keeps, so only somebody being in it can
 *  save it. */
function ancient(folder: string, inUse: string | null): Sweepable {
  return {
    path: folder,
    kind: 'checkout',
    at: NOW - (KEEP_DAYS.checkout + 1) * DAY,
    holdsWork: false,
    inUse,
  };
}

/** The whole of what the shell hands the sweep: the lock layer, and the
 *  conversations a project has open in a checkout of their own. */
function liveFor(leases: WorkspaceLocks, open: readonly LiveWriter[] = []) {
  return writingIn({ leases, open });
}

/* ========================================================================== */

describe('a folder somebody is writing in is not swept, and is named', () => {
  it('keeps it and says who has it, in the app’s own words for that state', async () => {
    const repo = await freshRepo();
    try {
      const idle = await createWorktree(git(), repo, 'idle', null);
      const busy = await createWorktree(git(), repo, 'busy', null);
      if (!idle.ok || idle.value === null || !busy.ok || busy.value === null) return;

      const locks = new WorkspaceLocks();
      locks.request(ticket(busy.value.folder, 'run-1', 'conversation B'));
      const live = liveFor(locks);

      const given = await sweepCheckouts(git(), repo, [idle.value.folder, busy.value.folder], {
        inUse: (folder) => live.who(folder) !== null,
      });

      // The abandoned one went; the one with a run in it stayed, whole.
      expect(given).toEqual([idle.value.folder]);
      expect(existsSync(idle.value.folder)).toBe(false);
      expect(existsSync(busy.value.folder)).toBe(true);
      expect((await raw(busy.value.folder, 'rev-parse', '--abbrev-ref', 'HEAD')).trim()).toBe(
        'graphe/busy',
      );
      // And it is named, so a folder left behind is one somebody can account
      // for rather than one they have to go looking for.
      expect(live.who(idle.value.folder)).toBeNull();
      expect(live.who(busy.value.folder)).toBe('conversation B');
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it('says it in the sentence the rest of the app uses, with the name after it', () => {
    const locks = new WorkspaceLocks();
    const folder = '/work/site/.graphe/worktrees/chat';
    locks.request(ticket(folder, 'run-1', 'the chat about the header'));
    const live = liveFor(locks);
    const decided = whatToSweep([ancient(folder, live.who(folder))], NOW);

    expect(decided.sweep).toEqual([]);
    expect(decided.kept).toHaveLength(1);
    // The exact sentence a turn is turned down with, so a person meeting this
    // state in Settings reads what they read anywhere else.
    expect(decided.because).toContain(admissionWords.workingHere);
    expect(decided.because).toContain('the chat about the header');
    expect(decided.because).toContain('Nothing to clear');
  });

  it('still sweeps the same folder once the run has let it go', () => {
    const locks = new WorkspaceLocks();
    locks.request(ticket('/work/site/one', 'run-1', 'conversation B'));

    expect(whatToSweep([ancient('/work/site/one', liveFor(locks).who('/work/site/one'))], NOW).sweep)
      .toHaveLength(0);

    // The run ended, so nothing is writing there any more and it is an
    // ordinary old folder again.
    locks.release('/work/site/one', 'run-1');
    const after = liveFor(locks);
    expect(after.who('/work/site/one')).toBeNull();
    expect(whatToSweep([ancient('/work/site/one', after.who('/work/site/one'))], NOW).sweep).toHaveLength(1);
  });

  it('treats a conversation open in a checkout as somebody about to write there', async () => {
    const repo = await freshRepo();
    try {
      const made = await createWorktree(git(), repo, 'open-now', null);
      if (!made.ok || made.value === null) return;

      // Merely open: no run yet, so no lease. It is still not a folder to take.
      const live = liveFor(new WorkspaceLocks(), [
        { folder: made.value.folder, who: 'conversation A' },
      ]);
      const given = await sweepCheckouts(git(), repo, [made.value.folder], {
        inUse: (folder) => live.who(folder) !== null,
      });

      expect(given).toEqual([]);
      expect(existsSync(made.value.folder)).toBe(true);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it('names the run rather than the conversation once it is writing', () => {
    const locks = new WorkspaceLocks();
    const folder = '/work/site/one';
    locks.request(ticket(folder, 'run-1', 'conversation B is writing'));
    // Both facts are true of it. The lease is the stronger one: that is the
    // holder a person is waiting on.
    const live = liveFor(locks, [{ folder, who: 'conversation B' }]);
    expect(live.who(folder)).toBe('conversation B is writing');
  });

  it('recognises the folder through a link, because it is the same folder', async () => {
    const real = await mkdtemp(path.join(tmpdir(), 'graphe-live-real-'));
    const link = `${real}-link`;
    try {
      await mkdir(path.join(real, 'copy'), { recursive: true });
      await symlink(real, link);
      const locks = new WorkspaceLocks();
      locks.request(ticket(path.join(real, 'copy'), 'run-1', 'conversation A'));

      const live = liveFor(locks);
      expect(live.who(path.join(link, 'copy'))).toBe('conversation A');
    } finally {
      await rm(real, { recursive: true, force: true });
      await rm(link, { recursive: true, force: true });
    }
  });
});

describe('the sweep that decides, not only the sweep that removes', () => {
  it('refuses a folder a run took between the decision and the clearing', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'graphe-live-late-'));
    try {
      await mkdir(path.join(root, 'copies', 'piece'), { recursive: true });
      await writeFile(path.join(root, 'copies', 'piece', 'work.txt'), 'being written\n');
      const folder = path.join(root, 'copies', 'piece');

      // What `whatToSweep` was told: nobody in it. What `sweep` is handed a
      // moment later: somebody is, which is the whole race this closes.
      const decided = whatToSweep([ancient(folder, null)], NOW);
      expect(decided.sweep).toHaveLength(1);

      const taken = { ...decided.sweep[0]!, inUse: 'conversation A' };
      expect(await sweep([taken])).toEqual({ removed: 0, freed: 0 });
      expect(existsSync(folder)).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
