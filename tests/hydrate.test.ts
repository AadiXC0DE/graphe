/** Reopening a long conversation.
 *
 * Ten thousand events folded one at a time, each one copying the whole thread,
 * is a window that will not answer the keyboard for seconds. The fold has to
 * come out the same either way — same turns, same order, same text — which is
 * what most of this file checks: the fast path against the slow one.
 */

import { describe, expect, it } from 'vitest';

import type { AgentEvent } from '../src/agent/types';
import { AT_FIRST, foldEvents, lastTurns } from '../src/lib/hydrate';
import { applyEvent, said, type Turn } from '../src/lib/thread';

/** The old way: a fresh copy of the thread per event. */
function oneAtATime(events: readonly AgentEvent[]): readonly Turn[] {
  return events.reduce<readonly Turn[]>((turns, event) => applyEvent(turns, event), []);
}

/** Turns, with the ids and clock readings off: both count up as the fold runs,
 *  so two folds of the same events never share them. */
function shape(turns: readonly Turn[]): unknown {
  return turns.map((turn) => {
    const { id: _id, ...rest } = turn;
    if ('at' in rest) delete (rest as { at?: number }).at;
    return rest;
  });
}

const CALL = { id: 'call-1', name: 'read_file', input: { path: 'src/App.tsx' } };

function aSitting(): AgentEvent[] {
  return [
    { type: 'user-said', text: 'tighten the header' },
    { type: 'message-delta', text: 'Right' },
    { type: 'message-delta', text: ', ' },
    { type: 'message-delta', text: 'looking.' },
    { type: 'tool-start', call: CALL },
    { type: 'tool-progress', id: 'call-1', text: 'half way' },
    { type: 'tool-end', id: 'call-1', ok: true, detail: '40 lines' },
    { type: 'message-delta', text: 'Done.' },
    { type: 'message-end' },
    { type: 'settled', how: 'finished' },
  ] as AgentEvent[];
}

describe('folding a saved conversation', () => {
  it('comes out exactly as folding one event at a time did', () => {
    const events = aSitting();
    expect(shape(foldEvents(events))).toEqual(shape(oneAtATime(events)));
  });

  it('joins a streamed reply back into one turn, and starts a new one after a step', () => {
    const turns = foldEvents(aSitting());
    const spoken = turns.filter((turn) => turn.kind === 'said' && turn.from === 'graphe');
    expect(spoken).toHaveLength(2);
    expect(spoken[0]).toMatchObject({ text: 'Right, looking.', streaming: false });
    expect(spoken[1]).toMatchObject({ text: 'Done.', streaming: false });
  });

  it('closes the step the transcript closed', () => {
    const turns = foldEvents(aSitting());
    const step = turns.find((turn) => turn.kind === 'did');
    expect(step).toMatchObject({ state: 'done' });
  });

  it('is the same fold on ten thousand tokens as on ten', () => {
    const many: AgentEvent[] = [{ type: 'user-said', text: 'go' }];
    for (let at = 0; at < 10_000; at += 1) many.push({ type: 'message-delta', text: 'x' });
    many.push({ type: 'message-end' });

    const turns = foldEvents(many);
    expect(turns).toHaveLength(2);
    expect(turns[1]).toMatchObject({ text: 'x'.repeat(10_000), streaming: false });
  });

  it('does not hand back the array it built as something anybody can add to', () => {
    // Two folds of the same events must not share a turn object.
    const events = aSitting();
    const one = foldEvents(events);
    const two = foldEvents(events);
    expect(one[0]).not.toBe(two[0]);
  });

  it('folds nothing into nothing', () => {
    expect(foldEvents([])).toEqual([]);
  });
});

describe('how much of it is drawn to begin with', () => {
  const thread = Array.from({ length: 1200 }, (_, at) => said('you', `line ${String(at)}`));

  it('keeps the end of it, which is what somebody reopened it for', () => {
    const { turns, earlier } = lastTurns(thread, 500);
    expect(turns).toHaveLength(500);
    expect(turns[turns.length - 1]).toBe(thread[thread.length - 1]);
    expect(earlier).toBe(700);
  });

  it('says nothing is above it when the whole thread fits', () => {
    const short = thread.slice(0, 12);
    const { turns, earlier } = lastTurns(short, 500);
    expect(turns).toBe(short);
    expect(earlier).toBe(0);
  });

  it('holds a cap of nothing rather than throwing', () => {
    expect(lastTurns(thread, 0)).toEqual({ turns: [], earlier: 1200 });
  });

  it('starts at five hundred turns', () => {
    expect(AT_FIRST).toBe(500);
  });
});
