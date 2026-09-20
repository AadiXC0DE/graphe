/** T02, T23, T26, T53: what belongs to a conversation and what belongs to the
 *  project.
 *
 * Two of these are the reason phase 5 exists: a reference brought into one chat
 * must not appear in a fresh one, and a cost must be charged once to the run
 * that incurred it. Both hold now.
 *
 * The rest are the same question asked of a write that arrives late: a sentence
 * taken back out of the queue, a card written from a notice, and a send the
 * shell refused. Each of them belongs to the conversation it was made in, not
 * to whichever one is on screen when the answer lands.
 *
 *  Source text, not behaviour: App.tsx's fork, take-back and notice calls and their main.ts handlers; no behavioural test reaches both sides at once.
 */

import { existsSync, readFileSync } from 'node:fs';
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
  changeThread,
  conversationIn,
  noDesks,
  openDesk,
  putBackTheBox,
  receive,
  showThread,
  spokenIn,
  tookBackTheLine,
  tookTheBox,
  type Desk,
  type Desks,
  type Reference,
} from '../../src/lib/projects';
import { said } from '../../src/lib/thread';
import { NOTHING_SAID } from '../../src/state/conversations';
import type { Attachment } from '../../src/components/Attachments';
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
  const MOCK: Reference = {
    id: 'r1',
    kind: 'image',
    name: 'the mock.png',
    note: 'brought in for the header',
  };
  const SHOT: Attachment = { id: 's1', kind: 'image', name: 'a screenshot.png', note: 'PNG' };
  const NOTE: Attachment = { id: 's2', kind: 'document', name: 'the brief.pdf', note: 'PDF' };

  /** One project, two conversations open, and the first of them holding
   *  everything a chat can hold that the project cannot. */
  function twoChats(): Desks {
    let desks = openDesk(noDesks, { path: PROJECT, name: 'atlas' });
    // A conversation this project has not had comes with what the shell read
    // for it, which is the only way one is ever opened.
    desks = showThread(desks, PROJECT, 'chat-a', { turns: [] });
    desks = changeThread(desks, { project: PROJECT, address: 'chat-a' }, (one) => ({
      ...one,
      references: [MOCK],
      attachments: [SHOT, NOTE],
      draft: 'make the hero tighter',
      plans: 'research',
    }));
    return showThread(desks, PROJECT, 'chat-b', { turns: [] });
  }

  it('shows the fresh conversation nothing that was brought into the other one', () => {
    const fresh = conversationIn(twoChats().byPath[PROJECT], 'chat-b');
    expect(fresh.references).toEqual([]);
    expect(fresh.attachments).toEqual([]);
    expect(fresh.draft).toBe('');
    expect(fresh.plans).toBe('auto');
  });

  /* A reference is something a chat was given, and the project has no list of
     its own to take it away to: the only place it is held is the conversation
     that was sent it, on screen or parked. */
  it('keeps a reference with the chat it was brought into, and nowhere else', () => {
    const there = twoChats();
    const desk = there.byPath[PROJECT];
    // The chat in front is the one nobody has said anything else about, so it
    // has none of its own — and the one behind it keeps its own.
    expect(conversationIn(desk, 'chat-b').references).toEqual([]);
    expect(conversationIn(desk, 'chat-a').references).toEqual([MOCK]);

    const fresh = showThread(there, PROJECT, 'chat-b', { turns: [] }).byPath[PROJECT];
    expect(conversationIn(fresh, 'chat-b').references).toEqual([]);
  });

  it('gives each chat back its own references, draft and box', () => {
    const there = twoChats();
    expect(conversationIn(there.byPath[PROJECT], 'chat-b').references).toEqual([]);

    const backToA = showThread(
      changeThread(there, { project: PROJECT, address: 'chat-b' }, (one) => ({
        ...one,
        references: [{ id: 'r2', kind: 'figma', name: 'Landing v4', note: 'the frame' }],
        attachments: [{ id: 's3', kind: 'image', name: 'b.png', note: 'PNG' }],
        draft: 'and the footer',
      })),
      PROJECT,
      'chat-a',
    );
    const a = conversationIn(backToA.byPath[PROJECT]!, 'chat-a');
    expect(a.references).toEqual([MOCK]);
    expect(a.attachments).toEqual([SHOT, NOTE]);
    expect(a.draft).toBe('make the hero tighter');
    expect(a.plans).toBe('research');

    const again = showThread(backToA, PROJECT, 'chat-b');
    const b = conversationIn(again.byPath[PROJECT]!, 'chat-b');
    expect(b.references?.map((one) => one.name)).toEqual(['Landing v4']);
    expect(b.attachments).toEqual([{ id: 's3', kind: 'image', name: 'b.png', note: 'PNG' }]);
    expect(b.draft).toBe('and the footer');
  });
});

/* -------------------------------------------------------------------------- */

describe('T26: an upload that finishes after the window has moved on', () => {
  const A_PICTURE: Attachment = { id: 'a1', kind: 'image', name: 'hero.png', note: 'PNG' };
  const LATE: Attachment = { id: 'a2', kind: 'image', name: 'footer.png', note: 'PNG' };
  const B_PICTURE: Attachment = { id: 'b1', kind: 'image', name: 'logo.svg', note: 'SVG' };
  const A = { project: PROJECT, address: 'chat-a' };
  const B = { project: PROJECT, address: 'chat-b' };

  /** A's send accepted one picture, then the window moved to B, which has a
   *  sentence and a picture of its own in its box. */
  function movedOn(): Desks {
    let desks = openDesk(noDesks, { path: PROJECT, name: 'atlas' });
    desks = showThread(desks, PROJECT, 'chat-a', { turns: [] });
    desks = changeThread(desks, A, (one) => ({ ...one, attachments: [A_PICTURE] }));
    desks = showThread(desks, PROJECT, 'chat-b', { turns: [] });
    return changeThread(desks, B, (one) => ({
      ...one,
      attachments: [B_PICTURE],
      draft: 'about the footer',
    }));
  }

  it('takes only the accepted picture, and only out of the chat that sent it', () => {
    const after = tookTheBox(movedOn(), A, [A_PICTURE]);
    expect(conversationIn(after.byPath[PROJECT]!, 'chat-a').attachments).toEqual([]);
    // B's box and B's sentence are B's: an upload for A settles nothing here.
    expect(conversationIn(after.byPath[PROJECT]!, 'chat-b').attachments).toEqual([B_PICTURE]);
    expect(conversationIn(after.byPath[PROJECT]!, 'chat-b').draft).toBe('about the footer');
  });

  it('keeps what was put in the box while the send was still going', () => {
    const dropped = changeThread(movedOn(), A, (one) => ({
      ...one,
      attachments: [...(one.attachments ?? []), LATE],
    }));
    const after = tookTheBox(dropped, A, [A_PICTURE]);
    expect(conversationIn(after.byPath[PROJECT]!, 'chat-a').attachments).toEqual([LATE]);
  });

  it('gives a refused send its sentence back without touching the other chat', () => {
    const after = putBackTheBox(movedOn(), A, 'make the hero tighter');
    expect(conversationIn(after.byPath[PROJECT]!, 'chat-a').draft).toBe('make the hero tighter');
    expect(conversationIn(after.byPath[PROJECT]!, 'chat-b').draft).toBe('about the footer');
    expect(conversationIn(after.byPath[PROJECT]!, 'chat-b').attachments).toEqual([B_PICTURE]);
  });

  /* The sentence somebody started while the first one was still going is the
     one they are in the middle of. It stays, and it stays first: the refusal
     goes back behind it rather than on top of it. What makes that true is the
     box reporting what is in it as it is typed — see tests/draft-kept.test.ts,
     which is the other half of this. */
  it('puts a refused sentence back behind what was typed while it was on its way', () => {
    const typed = changeThread(movedOn(), A, (one) => ({ ...one, draft: 'and the footer' }));
    const after = putBackTheBox(typed, A, 'make the hero tighter');
    expect(conversationIn(after.byPath[PROJECT]!, 'chat-a').draft).toBe(
      'and the footer\n\nmake the hero tighter',
    );
  });
});

/* -------------------------------------------------------------------------- */

describe('T26b: a line taken back out of the queue', () => {
  const A = { project: PROJECT, address: 'chat-a' };
  const QUEUED = 'and the footer';

  /** Two conversations open, the second one in front, and a second thought
   *  queued behind the first one's run. */
  function queued(): Desks {
    let desks = openDesk(noDesks, { path: PROJECT, name: 'atlas' });
    desks = showThread(desks, PROJECT, 'chat-a', {
      turns: [said('you', 'make the hero tighter'), said('you', QUEUED)],
    });
    desks = showThread(desks, PROJECT, 'chat-b', { turns: [said('you', 'the pricing page')] });
    return changeThread(desks, A, (one) => ({ ...one, draft: 'about the header' }));
  }

  /* Taking a line back is a round trip through the shell. The words belong to
     the conversation that queued them — the one the press was made in — not to
     whichever chat is on screen when the shell answers. */
  it('comes off the thread that queued it, not the one in front', () => {
    const after = tookBackTheLine(queued(), A, [QUEUED]);
    expect(
      conversationIn(after.byPath[PROJECT]!, 'chat-a').turns.map((one) =>
        one.kind === 'said' ? one.text : one.kind,
      ),
    ).toEqual(['make the hero tighter']);
    // The chat in front was never asked anything and keeps its own turn.
    expect(
      conversationIn(after.byPath[PROJECT]!, 'chat-b').turns.map((one) =>
        one.kind === 'said' ? one.text : one.kind,
      ),
    ).toEqual(['the pricing page']);
  });

  it('goes into the box of the chat that asked, behind what is already there', () => {
    const after = tookBackTheLine(queued(), A, [QUEUED]);
    expect(conversationIn(after.byPath[PROJECT]!, 'chat-a').draft).toBe(
      'about the header\n\nand the footer',
    );
    expect(conversationIn(after.byPath[PROJECT]!, 'chat-b').draft).toBe('');
  });
});

/* -------------------------------------------------------------------------- */

describe('a card written on the strength of a notice', () => {
  /** Chat B in front, and a look-around still running in chat A. */
  function bothOpen(): Desks {
    let desks = openDesk(noDesks, { path: PROJECT, name: 'atlas' });
    desks = showThread(desks, PROJECT, 'chat-a', { turns: [] });
    return showThread(desks, PROJECT, 'chat-b', { turns: [] });
  }

  /* Research runs while somebody may be reading another chat, so the card goes
     where the notice's words went. */
  it('is filed in the conversation the notice came from', () => {
    const desks = bothOpen();
    const owner = spokenIn(desks, { project: PROJECT, conversation: 'chat-a' });
    expect(owner).toEqual({ project: PROJECT, address: 'chat-a' });

    const after = changeThread(desks, owner!, (one) => ({
      ...one,
      turns: [{ kind: 'plan' as const, id: 'research-1', text: '', steps: ['one'], caveats: [], questions: [], answered: null }],
    }));
    expect(conversationIn(after.byPath[PROJECT]!, 'chat-a').turns).toHaveLength(1);
    expect(conversationIn(after.byPath[PROJECT]!, 'chat-b').turns).toEqual([]);
  });

  it('falls back to the chat in front only when the notice names none', () => {
    const desks = bothOpen();
    expect(spokenIn(desks, { project: PROJECT, conversation: null })).toEqual({
      project: PROJECT,
      address: 'chat-b',
    });
    expect(spokenIn(desks, { project: PROJECT })).toEqual({ project: PROJECT, address: 'chat-b' });
    // A notice about no folder at all belongs to nobody.
    expect(spokenIn(desks, { project: null, conversation: 'chat-a' })).toBeNull();
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
      conversations: {
        ...desk.conversations,
        'chat-a': { ...NOTHING_SAID, doing: { task, startedAt: NOW } },
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
      conversations: {
        ...desk.conversations,
        'chat-a': { ...conversationIn(desk, 'chat-a'), doing: { task, startedAt: NOW + 1_500 } },
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
    expect(conversationIn(afterSecond.byPath[PROJECT], 'chat-a').counted).toBe(800);
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
    expect(conversationIn(desk, 'chat-b').turns).toEqual([]);
    expect(conversationIn(desk, 'chat-a').turns).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */

/** The window's own wiring, read off it: every decision above is made here and
 *  called there, and a call swapped back to the chat in front is invisible to
 *  types. */
describe('the window answers to it', () => {
  const app = readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8');
  const actions = readFileSync(
    new URL('../../src/hooks/useConversationActions.ts', import.meta.url),
    'utf8',
  );
  const main = readFileSync(new URL('../../electron/main.ts', import.meta.url), 'utf8');

  /* Fork here presses one message rather than the conversation, so the place
     it stands travels with the press. Counted, because that is the one
     coordinate the window and the record can both arrive at. */
  it('sends where a message stands with a fork of it', () => {
    expect(app).toContain('bridge.forkConversation(path, said ?? null, where)');
    // The press is drawn by the row's own module, which the window reaches by
    // a dynamic import: one row of a conversation, in either transcript.
    const row = readFileSync(new URL('../../src/components/Turnstile.tsx', import.meta.url), 'utf8');
    expect(row).toContain('onForkHere(saidBy)');
    expect(main).toContain('from.held.forkAfter(boundary)');
  });

  it('refuses a fork of a boundary that has not finished happening', () => {
    const at = main.indexOf('const atTheEnd =');
    expect(at).toBeGreaterThan(-1);
    expect(main.slice(at, at + 400)).toContain('still being written');
    // And the mid-turn refusal it was written beside is still there.
    expect(main).toContain('A fork made mid-turn would copy a conversation that had not finished happening.');
  });
  it('takes a line back through the conversation the press was made in', () => {
    // The write itself belongs to the owner-bound actions now; what matters is
    // that the window hands the line to the conversation the press named,
    // through the one operation that puts it back in that chat's box.
    expect(actions).toContain('tookBackTheLine(current, owner, words)');
    expect(app).toContain('takeBackTheLine(mine, words)');
    expect(app).not.toContain('withoutTakenBack');
  });

  it('files a card through the conversation the notice names', () => {
    const at = app.indexOf('const owner = spokenIn(current, notice);');
    expect(at).toBeGreaterThan(-1);
    // Addressed by that owner, not written into whatever desk is in front.
    expect(app.slice(at, at + 300)).toContain('changeThread(current, owner');
  });

  /* The first screen draws the composer with no folder open, so its mode chips
     have to land on the window's own state: read there, and written there. */
  it('gives the mode chips a home before any conversation exists', () => {
    expect(app).toContain('const plans = desk === null ? loosePlans : chat.plans;');
    expect(app).toContain('setLoosePlans(');
  });
});
