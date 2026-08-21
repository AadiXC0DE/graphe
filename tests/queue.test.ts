/** The waiting line beside the composer, drained by the message that started. */
import { describe, expect, it } from 'vitest';
import { drainStarted } from '../src/lib/queue';

describe('drainStarted', () => {
  it('takes the message that has begun out of the line', () => {
    expect(drainStarted(['first', 'second', 'third'], 'second')).toEqual(['first', 'third']);
  });

  it('removes only the first of two identical messages', () => {
    expect(drainStarted(['do it', 'do it', 'then that'], 'do it')).toEqual(['do it', 'then that']);
  });

  it('leaves the line alone when the message is not in it', () => {
    const line = ['waiting'];
    expect(drainStarted(line, 'something else')).toBe(line);
  });

  it('leaves an empty line alone', () => {
    expect(drainStarted([], 'anything')).toEqual([]);
  });
});