/** The waiting line beside the composer, drained by the message that started.
 *
 * Two lines are drawn there and they are drained differently, which is the
 * whole point of these: the agent's own queue arrives from Pi as words and can
 * only be matched as words, while the sends waiting for the folder belong to
 * this app and carry the id of the run each becomes.
 */
import { describe, expect, it } from 'vitest';
import { drainQueued, drainStarted } from '../src/lib/queue';
import type { WaitingSend } from '../src/agent/types';

const waiting = (id: string, text: string, over: Partial<WaitingSend> = {}): WaitingSend => ({
  id,
  text,
  workspace: '/work/site',
  ahead: 'Conversation A',
  ...over,
});

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

describe('drainQueued', () => {
  it('takes off the send whose run has begun, and leaves the rest', () => {
    const line = [waiting('run-1', 'first'), waiting('run-2', 'second')];
    expect(drainQueued(line, 'run-1').map((one) => one.text)).toEqual(['second']);
  });

  it('takes off the one that started when two sends read the same', () => {
    // The case words cannot settle: the same sentence typed twice is two waits,
    // and the second going first must not take the first off the screen.
    const line = [waiting('run-1', 'do it'), waiting('run-2', 'do it')];
    expect(drainQueued(line, 'run-2').map((one) => one.id)).toEqual(['run-1']);
    expect(drainQueued(line, 'run-1').map((one) => one.id)).toEqual(['run-2']);
  });

  it('leaves the line alone when the id was never on it', () => {
    const line = [waiting('run-1', 'first')];
    expect(drainQueued(line, 'run-9')).toBe(line);
  });

  it('leaves an empty line alone', () => {
    expect(drainQueued([], 'run-1')).toEqual([]);
  });
});
