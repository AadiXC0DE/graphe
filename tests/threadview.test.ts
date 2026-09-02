/** Finding your way around a long conversation.
 *
 * Runs of steps already gather into one row — that is `steps.ts`. What was
 * missing is everything else about a long thread: finding a word in it without
 * scrolling, and knowing whether the newest thing is on screen at all.
 */

import { describe, expect, it } from 'vitest';

import { said, type Turn } from '../src/lib/thread';
import { atLatest, findIn, nextFound, wordsOf } from '../src/lib/threadview';

let counter = 0;
function step(state: 'done' | 'failed' | 'running', label = 'Reading a file'): Turn {
  counter += 1;
  return {
    kind: 'did',
    id: `d${String(counter)}`,
    callId: `c${String(counter)}`,
    state,
    label,
  } as Turn;
}

describe('finding something in a conversation', () => {
  const turns = [
    said('you', 'make the header sticky'),
    step('done', 'Changing Header.tsx'),
    said('graphe', 'Done.\nThe header is sticky now.'),
  ];

  it('finds what a person can read', () => {
    const found = findIn(turns, 'sticky');
    expect(found).toHaveLength(2);
    expect(found[0]?.at).toBe(0);
  });

  it('gives the line it is on, so a result reads without opening it', () => {
    expect(findIn(turns, 'sticky now')[0]?.line).toBe('The header is sticky now.');
  });

  it('does not care about case', () => {
    expect(findIn(turns, 'STICKY').length).toBeGreaterThan(0);
  });

  it('finds nothing for nothing', () => {
    expect(findIn(turns, '   ')).toEqual([]);
    expect(findIn(turns, 'zebra')).toEqual([]);
  });

  it('reads the words of every kind of turn', () => {
    expect(wordsOf(said('you', 'hello'))).toBe('hello');
    expect(wordsOf(step('done', 'Reading a file'))).toContain('Reading a file');
  });

  it('walks the results and wraps round', () => {
    const found = findIn(turns, 'sticky');
    expect(nextFound(found, null)).toBe(0);
    expect(nextFound(found, 0)).toBe(2);
    expect(nextFound(found, 2)).toBe(0);
  });

  /* A wrap over an empty list is an infinite loop wearing a hat. */
  it('has nowhere to go when nothing was found', () => {
    expect(nextFound([], null)).toBeNull();
    expect(nextFound([], 4)).toBeNull();
  });
});

describe('whether the newest thing is on screen', () => {
  it('is true at the bottom, and a little above it', () => {
    expect(atLatest({ top: 900, height: 100, scrollHeight: 1000 })).toBe(true);
    expect(atLatest({ top: 850, height: 100, scrollHeight: 1000 })).toBe(true);
  });

  it('is false once somebody has really scrolled away', () => {
    expect(atLatest({ top: 100, height: 100, scrollHeight: 5000 })).toBe(false);
  });

  it('is true for a conversation shorter than the window', () => {
    expect(atLatest({ top: 0, height: 800, scrollHeight: 400 })).toBe(true);
  });
});
