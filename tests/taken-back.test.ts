/** A line put back in the box leaves the conversation.
 *
 * It is shown the moment it is typed, because it is going to be sent. Take it
 * back and the shown copy has to go with it, or the same sentence is on screen
 * twice — once as though it had been said, once waiting to be.
 */

import { describe, expect, it } from 'vitest';

import { withoutTakenBack } from '../src/lib/projects';
import { said, type Turn } from '../src/lib/thread';

const you = (text: string): Turn => said('you', text);
const them = (text: string): Turn => said('graphe', text);
const words = (turns: readonly Turn[]): string[] =>
  turns.map((one) => (one.kind === 'said' ? one.text : `[${one.kind}]`));

describe('TB-01 what comes out', () => {
  it('takes the queued line out of the conversation', () => {
    const turns = [you('build the header'), them('on it'), you('and make it sticky')];
    expect(words(withoutTakenBack(turns, ['and make it sticky']))).toEqual([
      'build the header',
      'on it',
    ]);
  });

  it('takes several out at once, in whatever order they came back', () => {
    const turns = [you('one'), them('right'), you('two'), you('three')];
    expect(words(withoutTakenBack(turns, ['three', 'two']))).toEqual(['one', 'right']);
  });

  it('ignores the spacing a person leaves around a line', () => {
    const turns = [them('done'), you('  and now the footer  ')];
    expect(words(withoutTakenBack(turns, ['and now the footer']))).toEqual(['done']);
  });
});

describe('TB-02 what stays', () => {
  /* The whole risk in this: a walk that does not stop eats the conversation. */
  it('stops at the first thing that is not the person speaking', () => {
    const turns = [you('carry on'), them('here is what I did'), you('carry on')];
    // Only the trailing one is queued; the identical earlier one was answered.
    expect(words(withoutTakenBack(turns, ['carry on']))).toEqual([
      'carry on',
      'here is what I did',
    ]);
  });

  it('leaves the thread alone when nothing came back', () => {
    const turns = [you('one'), them('two')];
    expect(withoutTakenBack(turns, [])).toBe(turns);
    expect(withoutTakenBack(turns, ['   '])).toBe(turns);
  });

  it('stops rather than hunting when the line is not the last thing said', () => {
    const turns = [you('the one queued'), you('something else')];
    expect(words(withoutTakenBack(turns, ['the one queued']))).toEqual([
      'the one queued',
      'something else',
    ]);
  });

  it('takes out only as many copies as actually came back', () => {
    const turns = [you('again'), you('again'), you('again')];
    expect(words(withoutTakenBack(turns, ['again', 'again']))).toEqual(['again']);
  });

  it('never empties a conversation it was handed nothing for', () => {
    const turns = [you('a'), you('b'), you('c')];
    expect(withoutTakenBack(turns, ['nothing like this'])).toHaveLength(3);
  });

  it('leaves an activity line where it is', () => {
    const turns: Turn[] = [
      you('do it'),
      { kind: 'did', id: 'd1', callId: 'c1', state: 'running', label: 'Reading' },
      you('queued'),
    ];
    expect(words(withoutTakenBack(turns, ['queued']))).toEqual(['do it', '[did]']);
  });
});
