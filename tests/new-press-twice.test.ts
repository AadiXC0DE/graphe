/** Rapid New presses, and the window that follows them.
 *
 * One press of New is one chat. The window names each press, and the shell keeps
 * the answer to a name for a minute so a retry of *that press* lands on the same
 * conversation rather than a second one — `src/lib/answered.ts`, and
 * `tests/new-press.test.ts` holds it. What that window does not cover is the
 * retry that arrives after it: past a minute the name is forgotten, the press is
 * built again, and because a fresh chat takes the press's own name as its address
 * the second build lands at the address the first conversation is already live
 * at.
 *
 * Two sessions at one address is two writers for one transcript, and the first is
 * orphaned — not closed, not resumed, just replaced in the list while it goes on
 * holding its own file. The carry-on path has guarded against exactly that from
 * the beginning; this is the same guard for the fresh path.
 *
 * The registry half is behavioural (a conversation exists at the press's address
 * from before the build). The shell's guard lives in Electron's `main.ts`, which
 * no test can import, so that half is asserted on the source it is written in.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { openingFor } from '../src/agent/pi/conversations';
import { addConversation, addWorkspace, emptyIndex, ensureProject } from '../electron/services/workspace-registry';
import { addressed, Workspaces } from '../src/projects/workspaces';

const MAIN = readFileSync(join(process.cwd(), 'electron', 'main.ts'), 'utf8');
const NOW = 1_700_000_000_000;

/** The two pieces of shell state a fresh press has to pass through: the index
 *  that decides which conversation lives at an address, and the live list. */
type Live = { address: string; conversation: string | null };

describe('a fresh press that arrives twice', () => {
  it('carries the same name both times, which is what makes it one chat', () => {
    // The window's own naming: one key per press, sent as the third argument.
    expect(openingFor(null, true, 'press-1')).toEqual({ kind: 'fresh', key: 'press-1' });
    // Two presses carry two names and are two chats, which is what somebody who
    // pressed New twice asked for.
    expect(openingFor(null, true, 'press-2')).toEqual({ kind: 'fresh', key: 'press-2' });
  });

  it('names an address the conversation is already written down at', () => {
    const ensured = ensureProject(emptyIndex(), '/p/paper-street');
    const added = addWorkspace(ensured.index, {
      projectId: ensured.project.projectId,
      path: '/p/paper-street',
      kind: 'local',
      managed: false,
      now: NOW,
    });
    // The first build writes the chat at the press's own name, before either
    // build has said anything — so the address of the retry is occupied.
    const first = addConversation(added.index, {
      conversationId: 'press-1',
      workspaceId: added.workspace.workspaceId,
      now: NOW,
    });
    expect(first.made).toBe(true);
    expect(first.conversation.conversationId).toBe('press-1');

    // And the second build finds it, which is what makes the retry idempotent
    // rather than a second conversation.
    const again = addConversation(first.index, {
      conversationId: 'press-1',
      workspaceId: added.workspace.workspaceId,
      now: NOW + 120_000,
    });
    expect(again.made).toBe(false);
    expect(Object.keys(again.index.conversations)).toEqual(['press-1']);
  });
});

describe('the guard the shell puts in front of a fresh build', () => {
  /** The live list, as the shell holds it: a conversation is found by its address
   *  or by the transcript it is writing. */
  function live(): Workspaces<Live> {
    const store = new Workspaces<Live>({ limit: 6, close: () => undefined });
    return store;
  }

  it('finds one already open at the press own address rather than building again', () => {
    const store = live();
    const held: Live = { address: 'press-1', conversation: null };
    store.adopt({ path: 'press-1', name: 'press-1', held });

    // What the guard asks before it builds: is something live at this address?
    expect(addressed(store, 'press-1')).not.toBeNull();
    // Resuming it is the move, so it comes forward rather than being replaced.
    expect(store.resume('press-1')?.held).toBe(held);
    expect(store.current?.held).toBe(held);
    expect(store.open).toHaveLength(1);
    // An address nothing is live at is still a build: the first press.
    expect(addressed(store, 'press-2')).toBeNull();
  });

  it('is written before the session is built, for a fresh press as for a carry-on', () => {
    const start = MAIN.slice(
      MAIN.indexOf('async function startConversationUnlocked'),
      MAIN.indexOf('  const from: Speaking = { address: null };'),
    );
    expect(start).not.toBe('');

    // The fresh path asks the same question the carry-on path asks, and asks it
    // before anything is built.
    expect(start).toContain("const pressed = how.kind === 'fresh' ? how.key : undefined;");
    expect(start).toContain('conversationAt(held, { conversation: pressed })');
    expect(start).toContain('held.sessions.resume(already.path)');
    expect(start).toContain('return done({ session: already.held, address: already.path });');

    // Before the build. The slice ends where the session starts being built, so
    // finding the guard inside it is that ordering — the guard cannot be a check
    // on work already done.
    const guard = start.indexOf('conversationAt(held, { conversation: pressed })');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(start.length);
  });
});
