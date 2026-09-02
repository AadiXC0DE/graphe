/** Sixty tokens a second, and a thread that is redrawn twice.
 *
 * The failure this guards is not a wrong character on screen — it is a window
 * that cannot be typed in while a long reply arrives, because every token was a
 * state change. What matters here is that the text is never lost, never
 * reordered, and never handed on more often than a reader could see.
 */

import { describe, expect, it, vi } from 'vitest';

import { coalescer, EVERY_MS, type Clock } from '../src/lib/streaming';

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

describe('gathering tokens', () => {
  it('lets the first one straight through, so a reply starts when it starts', () => {
    const clock = fakeClock();
    const commit = vi.fn();
    const gather = coalescer(commit, EVERY_MS, clock);

    gather.push('Right');
    expect(commit).toHaveBeenCalledWith('Right');
  });

  it('holds everything after it until the tick, then hands it on as one piece', () => {
    const clock = fakeClock();
    const commit = vi.fn();
    const gather = coalescer(commit, 33, clock);

    gather.push('a');
    commit.mockClear();
    clock.tick(5);
    gather.push('b');
    clock.tick(5);
    gather.push('c');
    expect(commit).not.toHaveBeenCalled();

    clock.tick(33);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith('bc');
  });

  it('commits twice a run of sixty tokens over a second, not sixty times', () => {
    const clock = fakeClock();
    const commit = vi.fn();
    const gather = coalescer(commit, 33, clock);

    // Sixty tokens a second: one every ~16ms.
    for (let at = 0; at < 60; at += 1) {
      gather.push('x');
      clock.tick(16);
    }
    gather.flush();

    expect(commit.mock.calls.length).toBeLessThanOrEqual(32);
    expect(commit.mock.calls.map(([text]) => text as string).join('')).toBe('x'.repeat(60));
  });

  it('keeps the order and every character of what was pushed', () => {
    const clock = fakeClock();
    const got: string[] = [];
    const gather = coalescer((text) => got.push(text), 33, clock);

    const words = ['The ', 'header ', 'is ', 'tighter ', 'now.'];
    for (const word of words) {
      gather.push(word);
      clock.tick(4);
    }
    gather.flush();

    expect(got.join('')).toBe(words.join(''));
  });
});

describe('the end of a message', () => {
  it('hands on what is waiting rather than making the reader wait a frame', () => {
    const clock = fakeClock();
    const commit = vi.fn();
    const gather = coalescer(commit, 33, clock);

    gather.push('one');
    commit.mockClear();
    gather.push(' more');
    gather.flush();
    expect(commit).toHaveBeenCalledWith(' more');
  });

  it('says nothing when there is nothing waiting', () => {
    const clock = fakeClock();
    const commit = vi.fn();
    const gather = coalescer(commit, 33, clock);

    gather.push('all of it');
    commit.mockClear();
    gather.flush();
    gather.flush();
    expect(commit).not.toHaveBeenCalled();
  });

  it('does not fire the tick it had scheduled once it has flushed', () => {
    const clock = fakeClock();
    const commit = vi.fn();
    const gather = coalescer(commit, 33, clock);

    gather.push('a');
    gather.push('b');
    commit.mockClear();
    gather.flush();
    expect(commit).toHaveBeenCalledTimes(1);
    clock.tick(100);
    expect(commit).toHaveBeenCalledTimes(1);
  });
});

describe('a turn that was abandoned', () => {
  it('drops what was waiting and stops', () => {
    const clock = fakeClock();
    const commit = vi.fn();
    const gather = coalescer(commit, 33, clock);

    gather.push('half a th');
    commit.mockClear();
    gather.push('ought');
    gather.cancel();
    clock.tick(200);
    expect(commit).not.toHaveBeenCalled();
  });
});

describe('an empty token', () => {
  it('is not a reason to redraw anything', () => {
    const clock = fakeClock();
    const commit = vi.fn();
    const gather = coalescer(commit, 33, clock);

    gather.push('');
    expect(commit).not.toHaveBeenCalled();
  });
});
