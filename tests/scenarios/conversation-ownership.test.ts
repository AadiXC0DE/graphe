/** T02, T23, T53: what belongs to a conversation and what belongs to the project.
 *
 * Two of these are the reason phase 5 exists: a reference brought into one chat
 * must not appear in a fresh one, and a cost must be charged once to the run
 * that incurred it. T23's required result is not what the code does, so its test
 * fails on purpose and names the finding.
 */

import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
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
  updateConversation,
  workspaceForConversation,
} from '../../electron/services/workspace-registry';
import {
  changeDesk,
  noDesks,
  openDesk,
  receive,
  showThread,
  type Desk,
} from '../../src/lib/projects';
import type { TaskObservation } from '../../src/cost/estimate';
import { gitIn, gitRepo, type Built } from '../helpers/fixtures';

const NOW = 1_700_000_000_000;
const PROJECT = '/work/atlas';

const made: Built[] = [];

afterEach(async () => {
  for (const one of made.splice(0)) await one.dispose();
});

/* -------------------------------------------------------------------------- */

describe('T02: a conversation with a long history, closed and reopened', () => {
  it('comes back to the same session, the same branch and the same folder', async () => {
    const repo = await gitRepo();
    made.push(repo);
    const project = ensureProject(emptyIndex(), repo.root);
    const workspace = addWorkspace(project.index, {
      projectId: project.project.projectId,
      path: repo.root,
      kind: 'local',
      managed: false,
      now: NOW,
    });
    const opened = addConversation(workspace.index, {
      conversationId: 'chat-long',
      workspaceId: workspace.workspace.workspaceId,
      title: 'a long one',
      now: NOW,
    });
    const recorded = updateConversation(opened.index, 'chat-long', {
      sessionId: 'pi-session-7',
      sessionFile: '/profile/sessions/pi-session-7.jsonl',
      branchLeaf: 'leaf-42',
      title: 'the header, again',
    });

    // Closing a view and opening the chat again changes nothing about where it
    // works or which transcript it is. The record is the whole of the answer.
    const reopened = conversationById(recorded, 'chat-long');
    expect(reopened?.sessionFile).toBe('/profile/sessions/pi-session-7.jsonl');
    expect(reopened?.sessionId).toBe('pi-session-7');
    expect(reopened?.branchLeaf).toBe('leaf-42');
    expect(reopened?.title).toBe('the header, again');
    expect(workspaceForConversation(recorded, 'chat-long')?.cwd).toBe(repo.root);
  });

  it('finds its files exactly as it left them', async () => {
    const repo = await gitRepo();
    made.push(repo);
    const before = {
      status: await repo.status(),
      head: (await repo.git('rev-parse', 'HEAD')).out.trim(),
      note: (await repo.git('show', 'HEAD:notes.md')).out,
    };
    await writeFile(join(repo.root, 'more.ts'), 'export const more = true;\n');
    const withMore = await repo.status();

    // Nothing a reopen does may touch the folder: the files are the folder's,
    // not the conversation's, and a reopen is a read.
    expect(await repo.status()).toBe(withMore);
    expect((await repo.git('rev-parse', 'HEAD')).out.trim()).toBe(before.head);
    expect((await repo.git('show', 'HEAD:notes.md')).out).toBe(before.note);
    expect(existsSync(join(repo.root, 'more.ts'))).toBe(true);
    expect((await gitIn(repo.root, 'diff', '--cached')).out).toBe(
      (await repo.git('diff', '--cached')).out,
    );
  });
});

/* -------------------------------------------------------------------------- */

describe('T23: a reference brought into one chat, then a fresh chat opened', () => {
  /* Phase 10.2 requires: "B Context empty; explicit shared context labeled".
     What the code does: `references` is a field of the project's `Desk`, and
     `showThread` carries the project's fields across a change of conversation,
     so the fresh chat opens holding the other chat's references. The test is
     written to fail and is expected to keep failing until references are owned
     by the conversation (finding S01, phase 4.5). */
  it.fails('shows the fresh conversation nothing that was brought into the other one', () => {
    const first = showThread(openDesk(noDesks, { path: PROJECT, name: 'atlas' }), PROJECT, 'chat-a');
    const withReference = changeDesk(first, PROJECT, (desk) => ({
      ...desk,
      references: [
        { id: 'r1', kind: 'image', name: 'the mock.png', note: 'brought in for the header' },
      ],
    }));

    const second = showThread(withReference, PROJECT, 'chat-b');
    const fresh = second.byPath[PROJECT];
    expect(fresh?.address).toBe('chat-b');
    expect(fresh?.references).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */

describe('T53: usage from two runs in one conversation', () => {
  const task = { kind: 'header', size: 'tweak' as const };
  const summary = (minor: number, entryCount: number) => ({
    type: 'spend-summary' as const,
    summary: {
      currency: 'USD',
      total: { minor, currency: 'USD' },
      work: { minor, currency: 'USD' },
      retry: { minor: 0, currency: 'USD' },
      retryShare: 0,
      entryCount,
      firstAt: NOW,
      lastAt: NOW,
      largestRetry: null,
    },
  });

  /** Two conversations open on one project, the second one in front and the
   *  first one running. */
  function running(): Desk {
    let desks = openDesk(noDesks, { path: PROJECT, name: 'atlas' });
    desks = showThread(desks, PROJECT, 'chat-a', { turns: [] });
    desks = showThread(desks, PROJECT, 'chat-b', { turns: [] });
    desks = changeDesk(desks, PROJECT, (desk) => ({
      ...desk,
      parked: {
        ...desk.parked,
        'chat-a': { turns: [], doing: { task, startedAt: NOW }, counted: 0 },
      },
    }));
    const desk = desks.byPath[PROJECT];
    if (desk === undefined) throw new Error('the fixture made no desk');
    return desk;
  }

  it('charges the ledger’s whole total once, not once per report', () => {
    const opening = { current: PROJECT, byPath: { [PROJECT]: running() } };
    const afterFirst = receive(
      opening,
      { project: PROJECT, conversation: 'chat-a', event: summary(500, 2) },
      NOW + 1_000,
    );
    expect(afterFirst.byPath[PROJECT]?.jobs).toHaveLength(1);
    expect(afterFirst.byPath[PROJECT]?.jobs[0]?.cost.minor).toBe(500);

    // The next round starts, and the ledger reports the sitting's whole total
    // again rather than the difference. Only the difference belongs to this job.
    const rearmed = changeDesk(afterFirst, PROJECT, (desk) => ({
      ...desk,
      parked: {
        ...desk.parked,
        'chat-a': { turns: [], doing: { task, startedAt: NOW + 1_500 }, counted: desk.parked['chat-a']?.counted ?? 0 },
      },
    }));
    const afterSecond = receive(
      { current: PROJECT, byPath: { [PROJECT]: rearmed.byPath[PROJECT]! } },
      { project: PROJECT, conversation: 'chat-a', event: summary(800, 4) },
      NOW + 2_000,
    );

    const jobs = afterSecond.byPath[PROJECT]?.jobs ?? [];
    expect(jobs).toHaveLength(2);
    const charged = jobs.reduce((total, one: TaskObservation) => total + one.cost.minor, 0);
    // Both reports were about one sitting: charging the second whole would bill
    // the first 500 twice.
    expect(charged).toBe(800);
    // What the ledger has been charged so far belongs to the conversation that
    // spent it, which is where the next difference is measured from.
    expect(afterSecond.byPath[PROJECT]?.parked['chat-a']?.counted).toBe(800);
    expect(afterSecond.byPath[PROJECT]?.counted).toBe(0);
  });

  it('puts the money on the project and the words on the conversation that ran', () => {
    const before = running();
    const after = receive(
      { current: PROJECT, byPath: { [PROJECT]: before } },
      { project: PROJECT, conversation: 'chat-a', event: { type: 'message-delta', text: 'working' } },
      NOW + 500,
    );
    const desk = after.byPath[PROJECT];
    expect(desk?.address).toBe('chat-b');
    // The reply landed in the conversation it started in, and the one in front
    // was not handed another chat's words.
    expect(desk?.turns).toEqual([]);
    expect(desk?.parked['chat-a']?.turns).toHaveLength(1);
  });
});
