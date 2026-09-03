/** One trip across the wire per frame, and not one event out of place.
 *
 * The saving is easy to get right and easy to get wrong in the same change:
 * fewer messages is worthless if a step arrives before the sentence that
 * introduced it, or if two conversations streaming at once end up wearing each
 * other's text. So most of what is asserted here is order, per conversation,
 * against the unbatched stream it has to be indistinguishable from.
 */

import { describe, expect, it, vi } from 'vitest';

import type { AgentEvent, ToolCall } from '../src/agent/types';
import { batcher, EVERY_MS, mustGoNow, packFrame, type Framed, type Waiting } from '../src/lib/batching';
import type { Clock } from '../src/lib/streaming';

/** A clock a test winds by hand. */
function fakeClock(): Clock & { tick: (ms: number) => void } {
  let at = 0;
  let next = 1;
  const timers = new Map<number, { due: number; run: () => void }>();
  return {
    now: () => at,
    after(ms, run) {
      const id = next;
      next += 1;
      timers.set(id, { due: at + ms, run });
      return id;
    },
    stop(timer) {
      timers.delete(timer);
    },
    tick(ms) {
      at += ms;
      for (const [id, timer] of [...timers]) {
        if (timer.due > at) continue;
        timers.delete(id);
        timer.run();
      }
    },
  };
}

const CALL: ToolCall = { id: 'call-1', name: 'edit', input: { path: 'src/hero.css' } };

function delta(text: string): AgentEvent {
  return { type: 'message-delta', text };
}

function waiting(project: string, conversation: string, event: AgentEvent): Waiting {
  return { project, conversation, event };
}

/** Everything one conversation was handed, flattened back into a stream. */
function heardBy(frames: readonly Framed[][], conversation: string): readonly AgentEvent[] {
  const out: AgentEvent[] = [];
  for (const batch of frames) {
    for (const frame of batch) {
      if (frame.conversation !== conversation) continue;
      out.push(...frame.events);
    }
  }
  return out;
}

/** The same stream with the welding undone, so it can be compared to the
 *  unbatched one character for character. */
function unwelded(events: readonly AgentEvent[]): readonly string[] {
  return events.map((event) => (event.type === 'message-delta' ? `text:${event.text}` : event.type));
}

/* ========================================================================== */
/* Packing                                                                     */
/* ========================================================================== */

describe('packing a frame', () => {
  it('welds a run of text into one delta', () => {
    const frames = packFrame([
      waiting('/a', 'one', delta('The ')),
      waiting('/a', 'one', delta('hero ')),
      waiting('/a', 'one', delta('is done.')),
    ]);

    expect(frames).toHaveLength(1);
    expect(frames[0]?.events).toEqual([{ type: 'message-delta', text: 'The hero is done.' }]);
  });

  it('welds runs, not everything — a step between two sentences stays between them', () => {
    const frames = packFrame([
      waiting('/a', 'one', delta('a')),
      waiting('/a', 'one', delta('b')),
      waiting('/a', 'one', { type: 'tool-start', call: CALL }),
      waiting('/a', 'one', delta('c')),
      waiting('/a', 'one', delta('d')),
    ]);

    expect(unwelded(frames[0]?.events ?? [])).toEqual(['text:ab', 'tool-start', 'text:cd']);
  });

  it('gives every conversation its own frame', () => {
    const frames = packFrame([
      waiting('/a', 'one', delta('x')),
      waiting('/a', 'two', delta('y')),
      waiting('/a', 'one', delta('z')),
    ]);

    expect(frames).toHaveLength(2);
    expect(frames[0]?.conversation).toBe('one');
    expect(frames[0]?.events).toEqual([{ type: 'message-delta', text: 'xz' }]);
    expect(frames[1]?.conversation).toBe('two');
    expect(frames[1]?.events).toEqual([{ type: 'message-delta', text: 'y' }]);
  });

  it('keeps two projects apart even when the conversation is unnamed', () => {
    const frames = packFrame([
      { project: '/a', conversation: null, event: delta('a') },
      { project: '/b', conversation: null, event: delta('b') },
    ]);

    expect(frames).toHaveLength(2);
    expect(frames.map((frame) => frame.project)).toEqual(['/a', '/b']);
  });

  it('has nothing to say about an empty queue', () => {
    expect(packFrame([])).toEqual([]);
  });
});

/* ========================================================================== */
/* What cannot wait                                                            */
/* ========================================================================== */

describe('events that gate the window', () => {
  it('names the ones that change what is on screen rather than what it says', () => {
    expect(mustGoNow({ type: 'tool-start', call: CALL })).toBe(true);
    expect(mustGoNow({ type: 'needs-confirmation', call: CALL, verdict: { kind: 'confirm', question: 'Delete it?' } })).toBe(true);
    expect(mustGoNow({ type: 'asked-first', id: 'q1', questions: [] })).toBe(true);
    expect(mustGoNow({ type: 'blocked', call: CALL, reason: 'outside the project' })).toBe(true);
    expect(mustGoNow({ type: 'settled', how: 'finished' })).toBe(true);
    expect(mustGoNow({ type: 'busy', on: true })).toBe(true);
    expect(mustGoNow({ type: 'notice', what: 'The spending ceiling is reached.' })).toBe(true);
  });

  it('lets the streaming ones wait, because that is the whole saving', () => {
    expect(mustGoNow(delta('a'))).toBe(false);
    expect(mustGoNow({ type: 'message-end' })).toBe(false);
    expect(mustGoNow({ type: 'tool-progress', id: 'call-1', text: 'reading' })).toBe(false);
    expect(mustGoNow({ type: 'spend', amount: { minor: 12, currency: 'USD' }, label: 'Building the hero', reason: 'work' })).toBe(false);
  });
});

/* ========================================================================== */
/* The batcher                                                                 */
/* ========================================================================== */

describe('gathering events', () => {
  it('sends nothing until the tick', () => {
    const clock = fakeClock();
    const send = vi.fn();
    const gather = batcher(send, EVERY_MS, clock);

    gather.push(waiting('/a', 'one', delta('a')));
    gather.push(waiting('/a', 'one', delta('b')));
    expect(send).not.toHaveBeenCalled();

    clock.tick(EVERY_MS);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toEqual([
      { project: '/a', conversation: 'one', events: [{ type: 'message-delta', text: 'ab' }] },
    ]);
  });

  it('sends a step the moment it happens, with the text that came before it', () => {
    const clock = fakeClock();
    const send = vi.fn();
    const gather = batcher(send, EVERY_MS, clock);

    gather.push(waiting('/a', 'one', delta('Editing ')));
    gather.push(waiting('/a', 'one', { type: 'tool-start', call: CALL }));

    expect(send).toHaveBeenCalledTimes(1);
    expect(unwelded(send.mock.calls[0]?.[0][0].events)).toEqual(['text:Editing ', 'tool-start']);
  });

  it('does not fire the tick it already emptied', () => {
    const clock = fakeClock();
    const send = vi.fn();
    const gather = batcher(send, EVERY_MS, clock);

    gather.push(waiting('/a', 'one', delta('a')));
    gather.push(waiting('/a', 'one', { type: 'busy', on: true }));
    send.mockClear();

    clock.tick(EVERY_MS * 4);
    expect(send).not.toHaveBeenCalled();
  });

  it('hands over what is waiting when it is flushed', () => {
    const clock = fakeClock();
    const send = vi.fn();
    const gather = batcher(send, EVERY_MS, clock);

    gather.push(waiting('/a', 'one', delta('half a sentence')));
    gather.flush();
    expect(send).toHaveBeenCalledTimes(1);

    gather.flush();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('takes many events a frame and hands them over once', () => {
    const clock = fakeClock();
    const send = vi.fn();
    const gather = batcher(send, EVERY_MS, clock);

    for (let at = 0; at < 60; at += 1) gather.push(waiting('/a', 'one', delta('x')));
    clock.tick(EVERY_MS);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0][0].events).toEqual([{ type: 'message-delta', text: 'x'.repeat(60) }]);
  });
});

/* ========================================================================== */
/* Order                                                                       */
/* ========================================================================== */

describe('two conversations streaming at once', () => {
  /** A believable interleave: two replies arriving together, each stopping to
   *  run a step, each finishing. */
  const stream: readonly Waiting[] = (() => {
    const out: Waiting[] = [];
    for (let at = 0; at < 40; at += 1) {
      out.push(waiting('/a', 'one', delta(`one-${String(at)} `)));
      out.push(waiting('/b', 'two', delta(`two-${String(at)} `)));
      if (at % 7 === 3) out.push(waiting('/a', 'one', { type: 'tool-start', call: CALL }));
      if (at % 5 === 2) out.push(waiting('/b', 'two', { type: 'tool-end', id: 'call-1', ok: true }));
      if (at % 11 === 9) out.push(waiting('/a', 'one', { type: 'busy', on: true }));
    }
    out.push(waiting('/a', 'one', { type: 'settled', how: 'finished' }));
    out.push(waiting('/b', 'two', { type: 'settled', how: 'finished' }));
    return out;
  })();

  it('gives each conversation exactly the stream it would have had unbatched', () => {
    const clock = fakeClock();
    const batches: Framed[][] = [];
    const gather = batcher((frames) => batches.push([...frames]), EVERY_MS, clock);

    for (const [at, one] of stream.entries()) {
      gather.push(one);
      // A wire that is not a metronome: some events land in the same frame,
      // some a frame apart, some after a pause long enough to have ticked.
      if (at % 9 === 8) clock.tick(EVERY_MS);
      if (at % 23 === 22) clock.tick(EVERY_MS * 3);
    }
    gather.flush();

    for (const conversation of ['one', 'two']) {
      const wanted = stream
        .filter((one) => one.conversation === conversation)
        .map((one) => one.event);
      // Welding joins neighbouring text, so both sides are compared as the
      // sequence of things that happened rather than as event objects.
      expect(unwelded(weld(heardBy(batches, conversation)))).toEqual(unwelded(weld(wanted)));
    }
  });

  it('loses no text at all', () => {
    const clock = fakeClock();
    const batches: Framed[][] = [];
    const gather = batcher((frames) => batches.push([...frames]), EVERY_MS, clock);

    for (const one of stream) gather.push(one);
    gather.flush();

    const said = heardBy(batches, 'one')
      .filter((event) => event.type === 'message-delta')
      .map((event) => (event.type === 'message-delta' ? event.text : ''))
      .join('');
    const wanted = stream
      .filter((one) => one.conversation === 'one' && one.event.type === 'message-delta')
      .map((one) => (one.event.type === 'message-delta' ? one.event.text : ''))
      .join('');
    expect(said).toBe(wanted);
  });

  it('never puts one conversation in another one\u2019s frame', () => {
    const clock = fakeClock();
    const batches: Framed[][] = [];
    const gather = batcher((frames) => batches.push([...frames]), EVERY_MS, clock);

    for (const one of stream) gather.push(one);
    gather.flush();

    for (const batch of batches) {
      for (const frame of batch) {
        const wanted = frame.conversation === 'one' ? '/a' : '/b';
        expect(frame.project).toBe(wanted);
      }
    }
  });
});

/** The welding a frame does, applied to a whole stream, so the batched and
 *  unbatched sides can be compared as one shape. */
function weld(events: readonly AgentEvent[]): readonly AgentEvent[] {
  const out: AgentEvent[] = [];
  for (const event of events) {
    const last = out[out.length - 1];
    if (last?.type === 'message-delta' && event.type === 'message-delta') {
      out[out.length - 1] = { type: 'message-delta', text: last.text + event.text };
      continue;
    }
    out.push(event);
  }
  return out;
}
