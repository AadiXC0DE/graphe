/** The waiting line holds what a person typed, and nothing else.
 *
 * Carrying on through a list and going round toward a goal both put a message
 * behind the run. Pi reports those as queued like any other, and drawn in the
 * line they read as somebody's message waiting to be answered — which is two
 * wrong things at once: nobody typed it, and there is nothing to wait for.
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { drainStarted, withoutOurs } from '../src/lib/queue';

describe('OL-01 ours come out of the line', () => {
  it('leaves what the person typed', () => {
    expect(withoutOurs(['fix the header', 'Carry on with the checklist.'], ['Carry on with the checklist.'])).toEqual([
      'fix the header',
    ]);
  });

  it('takes out one copy per one of ours, not every match', () => {
    expect(withoutOurs(['again', 'again', 'again'], ['again'])).toEqual(['again', 'again']);
  });

  it('leaves the line alone when none of it is ours', () => {
    const line = ['one', 'two'];
    expect(withoutOurs(line, ['something else'])).toBe(line);
    expect(withoutOurs(line, [])).toBe(line);
    expect(withoutOurs([], ['ours'])).toEqual([]);
  });

  it('is not confused by a person typing the same words we would have', () => {
    // One of ours is recorded, so exactly one comes out — the other stands.
    expect(withoutOurs(['Carry on', 'Carry on'], ['Carry on'])).toEqual(['Carry on']);
  });
});

describe('OL-02 and stop being ours once they have run', () => {
  it('a started message is taken off the list of ours', () => {
    expect(drainStarted(['a', 'b'], 'a')).toEqual(['b']);
  });

  /* Otherwise the next round of the same list, whose words are different only
     in the counts, would be hidden by the last round's entry. */
  it('only the first of two identical ones', () => {
    expect(drainStarted(['a', 'a'], 'a')).toEqual(['a']);
  });

  it('nothing matching is not a drain', () => {
    const line = ['a'];
    expect(drainStarted(line, 'b')).toBe(line);
  });
});

/* The window used to hold the list of its own messages, and take them out of
   the line itself. The loop moved into the shell, so the window stopped being
   told what was its own — and every round of a carried-on list reappeared in
   the line as though somebody had typed it. The shell is what queued them, so
   the shell is what takes them out. */
describe('OL-03 the shell takes them out on the way to the window', () => {
  const shell = readFileSync(new URL('../electron/main.ts', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');

  it('filters the line where the events are forwarded', () => {
    expect(shell).toContain('function enrichForTheWindow');
    const at = shell.indexOf('function enrichForTheWindow');
    const block = shell.slice(at, at + 1200);
    expect(block).toContain("event.type === 'queued'");
    expect(block).toContain('withoutOurs(event.steering, mine)');
    expect(block).toContain('withoutOurs(event.followUp, mine)');
  });

  it('stops counting one of its own the moment it begins', () => {
    const at = shell.indexOf('function enrichForTheWindow');
    expect(shell.slice(at, at + 1200)).toContain('drainStarted(mine, event.text)');
  });

  it('and the window no longer keeps a second copy of the answer', () => {
    expect(app).not.toContain('withoutOurs(');
    expect(app).not.toContain('oursInLine');
  });
});
