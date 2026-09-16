/** Writes held back a moment, one per thing being written.
 *
 * The claim: a canvas is written shortly after somebody stops drawing on it,
 * and a touch on the second canvas never costs the first one's edit.
 */

import { describe, expect, it } from 'vitest';

import { heldWrites, HOLD_MS } from '../src/lib/heldwrites';

/** A clock the test drives, so what this promises is run rather than waited
 *  for. */
function clock() {
  let at = 0;
  const due = new Map<number, { when: number; run: () => void }>();
  let next = 1;
  return {
    clock: {
      after: (ms: number, run: () => void) => {
        const id = next++;
        due.set(id, { when: at + ms, run });
        return id;
      },
      stop: (timer: unknown) => {
        due.delete(timer as number);
      },
    },
    tick: (ms: number) => {
      at += ms;
      for (const [id, one] of [...due.entries()]) {
        if (one.when > at) continue;
        due.delete(id);
        one.run();
      }
    },
  };
}

describe('writes held back a moment', () => {
  it('writes nothing before its moment, and once at it', () => {
    const time = clock();
    const held = heldWrites(HOLD_MS, time.clock);
    const written: string[] = [];
    held.soon('a', () => written.push('a'));
    time.tick(HOLD_MS - 1);
    expect(written).toEqual([]);
    expect(held.waiting()).toBe(1);
    time.tick(1);
    expect(written).toEqual(['a']);
    // Nothing is waiting once it has been written.
    expect(held.waiting()).toBe(0);
  });

  it('replaces a second change to the same id, so the file is written once', () => {
    const time = clock();
    const held = heldWrites(HOLD_MS, time.clock);
    const written: string[] = [];
    held.soon('a', () => written.push('first'));
    held.soon('a', () => written.push('second'));
    expect(held.waiting()).toBe(1);
    time.tick(HOLD_MS);
    expect(written).toEqual(['second']);
  });

  it('holds one write per id, so a touch on one canvas never cancels another', () => {
    const time = clock();
    const held = heldWrites(HOLD_MS, time.clock);
    const written: string[] = [];
    held.soon('a', () => written.push('a'));
    time.tick(HOLD_MS / 2);
    held.soon('b', () => written.push('b'));
    time.tick(HOLD_MS);
    expect(written.sort()).toEqual(['a', 'b']);
  });

  it('writes everything still waiting when the window goes', () => {
    const time = clock();
    const held = heldWrites(HOLD_MS, time.clock);
    const written: string[] = [];
    held.soon('a', () => written.push('a'));
    held.soon('b', () => written.push('b'));
    held.now();
    expect(written.sort()).toEqual(['a', 'b']);
    expect(held.waiting()).toBe(0);
  });

  it('never writes a change twice, whatever the clock does afterwards', () => {
    const time = clock();
    const held = heldWrites(HOLD_MS, time.clock);
    const written: string[] = [];
    held.soon('a', () => written.push('a'));
    held.now();
    time.tick(HOLD_MS * 4);
    held.now();
    expect(written).toEqual(['a']);
  });

  it('writes rather than clears when the window goes mid-hold', () => {
    const time = clock();
    const held = heldWrites(HOLD_MS, time.clock);
    let written = 0;
    held.soon('a', () => {
      written += 1;
    });
    time.tick(HOLD_MS / 4);
    held.now();
    expect(written).toBe(1);
    time.tick(HOLD_MS * 2);
    expect(written).toBe(1);
  });
});
