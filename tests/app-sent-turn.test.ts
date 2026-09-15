/** A turn the app sends for itself has to look like a turn.
 *
 * Between "Step 4 of 12 · carrying on" and the first token there is no shape in
 * the thread to read, so the composer said Send and the tab sat still for a
 * conversation that was already answering. The shell says when a run is in
 * flight; this is the window listening to it.
 *
 * And a card answered with a click is answered: only typing used to clear the
 * hold, so the first Yes ended the rounds for the rest of the job.
 *
 *  Source text, not behaviour: the window reading the shell's `busy` flag, and the shell clearing a hold when a card is answered; no behavioural test can reach it — the pair joins unrendered App.tsx to electron/main.ts across the IPC seam.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { conversationIn, noDesks, openDesk, parkThread, receive, showThread, type Desks } from '../src/lib/projects';
import type { AgentEvent } from '../src/agent/types';

const main = readFileSync(fileURLToPath(new URL('../electron/main.ts', import.meta.url)), 'utf8');
const app = readFileSync(fileURLToPath(new URL('../src/App.tsx', import.meta.url)), 'utf8');

const project = '/work/site';

/** Whether a run is in flight in a named conversation of the project just
 *  opened. The question is about that conversation, so it is asked of it. */
function busyIn(held: Desks, address: string | null): boolean {
  const desk = held.byPath[project];
  return desk === undefined ? false : conversationIn(desk, address).busy;
}

function desks(...events: readonly AgentEvent[]) {
  let held = openDesk(noDesks, { path: project, name: 'site' });
  for (const event of events) held = receive(held, { project, event });
  return held;
}

describe('the shell says whether a run is in flight', () => {
  it('is not in flight before anything says so', () => {
    expect(busyIn(desks(), null)).toBe(false);
  });

  it('is in flight from the moment the shell says on', () => {
    expect(busyIn(desks({ type: 'busy', on: true }), null)).toBe(true);
  });

  it('is not in flight again once the shell says off', () => {
    expect(busyIn(desks({ type: 'busy', on: true }, { type: 'busy', on: false }), null)).toBe(false);
  });

  /* A settle is the end of a run whatever else was said, so a `busy: false`
     that never arrives cannot leave the composer a spinner for the sitting. */
  it('is not in flight after a settle', () => {
    expect(busyIn(desks({ type: 'busy', on: true }, { type: 'settled' }), null)).toBe(false);
  });

  it('is true with no turns at all, which is the whole point', () => {
    const held = desks({ type: 'busy', on: true });
    const desk = held.byPath[project]!;
    expect(conversationIn(desk, null).turns).toEqual([]);
    expect(conversationIn(desk, null).busy).toBe(true);
  });
});

describe('it belongs to the conversation it was said about', () => {
  it('lands on a parked conversation rather than on the one in front', () => {
    let held = openDesk(noDesks, { path: project, name: 'site' });
    held = receive(held, { project, event: { type: 'busy', on: true }, conversation: '/a' });
    // Nothing knows about /a yet, so nothing is claimed for it.
    expect(busyIn(held, null)).toBe(false);
  });

  it('follows a conversation across a switch', () => {
    let held = openDesk(noDesks, { path: project, name: 'site' });
    held = showThread(held, project, '/a', { turns: [] });
    held = showThread(held, project, '/b', { turns: [] });
    held = receive(held, { project, event: { type: 'busy', on: true } });
    expect(busyIn(held, '/b')).toBe(true);
    held = showThread(held, project, '/a');
    expect(busyIn(held, '/a')).toBe(false);
    held = showThread(held, project, '/b');
    expect(busyIn(held, '/b')).toBe(true);
    expect(busyIn(parkThread(held, project, '/a'), '/b')).toBe(true);
  });
});

describe('the window answers to it', () => {
  it('reads busy as busy, not only the shapes in the thread', () => {
    expect(app).toContain('(desk !== null && chat.busy)');
  });

  it('measures a turn it sent for itself, so the estimate has something to file', () => {
    expect(app).toContain('const started = { task: sizeUp(notice.said), startedAt: Date.now() };');
    expect(app).toContain('return { ...one, doing: one.doing ?? started, busy: true };');
  });
});

describe('a card answered with a click is answered', () => {
  it('clears the hold on a Guard decision', () => {
    const at = main.indexOf('handle<boolean>(CHANNEL.answer,');
    const block = main.slice(at, main.indexOf('\n  });', at));
    expect(block).toContain('answered(open, where)');
  });

  it('clears the hold on the questions asked before the work started', () => {
    const at = main.indexOf('handle<boolean>(CHANNEL.answerAsked,');
    const block = main.slice(at, main.indexOf('\n  });', at));
    expect(block).toContain('answered(open, where)');
  });

  it('clears it for the conversation the card belongs to', () => {
    expect(main).toContain("holdForAnswer(open.path, listAddress(open, where) ?? '', false);");
    // The one place the hold is set and cleared, so the flag and whatever else
    // is being kept beside it cannot drift.
    expect(main).toContain('function holdForAnswer(project: string, address: string, on: boolean)');
    expect(main).toContain('continuations.waiting(project, address, on);');
  });

  it('clears it when a card is taken back off the screen instead', () => {
    expect(main).toContain(
      "if (said.type === 'questions-withdrawn' || said.type === 'asking-withdrawn') {",
    );
  });
});
