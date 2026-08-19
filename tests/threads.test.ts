/** Two conversations open in one project, and nothing of one leaking into the
 *  other.
 *
 * A thread that keeps one sentence from the conversation you were in ten
 * seconds ago is worse than one that keeps none, because you cannot tell which
 * sentence it was. Every case here is that failure from a different direction.
 */

import { describe, expect, it } from 'vitest';

import {
  changeDesk,
  currentDesk,
  noDesks,
  openDesk,
  parkThread,
  receive,
  showThread,
  threadsIn,
  type Desks,
} from '../src/lib/projects';
import { said } from '../src/lib/thread';

const HERE = { path: '/p/paper-street', name: 'paper-street' };

/** A project with two conversations in it: `a` in front, `b` put down. */
function twoOpen(): Desks {
  const opened = openDesk(noDesks, HERE);
  return changeDesk(opened, HERE.path, (desk) => ({
    ...desk,
    address: 'a',
    turns: [said('you', 'make the hero tighter')],
    parked: { b: { turns: [said('you', 'the pricing page')] } },
    order: ['a', 'b'],
  }));
}

describe('a project with more than one conversation open', () => {
  /* A row that reorders under the hand every time somebody presses one of its
     tabs is the thing tabs exist not to be. */
  it('keeps the same order however much you switch between them', () => {
    const order = (desks: Desks) => threadsIn(currentDesk(desks)!).map((one) => one.address);
    const start = twoOpen();
    expect(order(start)).toEqual(['a', 'b']);
    expect(order(showThread(start, HERE.path, 'b'))).toEqual(['a', 'b']);
    expect(order(showThread(showThread(start, HERE.path, 'b'), HERE.path, 'a'))).toEqual(['a', 'b']);
  });

  it('lists them all, and says which one is in front', () => {
    const found = threadsIn(currentDesk(twoOpen())!);
    expect(found).toHaveLength(2);
    expect(found.filter((one) => one.here).map((one) => one.address)).toEqual(['a']);
  });

  it('swaps whole when you go to another, and puts the one you left down whole', () => {
    const desks = showThread(twoOpen(), HERE.path, 'b');
    const desk = currentDesk(desks)!;

    expect(desk.address).toBe('b');
    expect(desk.turns[0]).toMatchObject({ text: 'the pricing page' });
    // And the one that was in front is still there, exactly as it was.
    expect(desk.parked['a']?.turns[0]).toMatchObject({ text: 'make the hero tighter' });
  });

  it('going back finds it as it was, not as an empty thread', () => {
    const there = showThread(twoOpen(), HERE.path, 'b');
    const back = showThread(there, HERE.path, 'a');

    expect(currentDesk(back)?.turns[0]).toMatchObject({ text: 'make the hero tighter' });
  });

  /* The one that matters: a reply still arriving when somebody switched belongs
     to the conversation it started in. */
  it('files a reply under the conversation it came from, not the one on screen', () => {
    const desks = receive(twoOpen(), {
      project: HERE.path,
      conversation: 'b',
      event: { type: 'message-delta', text: 'Two pages use it.' },
    });
    const desk = currentDesk(desks)!;

    expect(desk.parked['b']?.turns.some((turn) => turn.kind === 'said')).toBe(true);
    // And the conversation on screen heard nothing at all.
    expect(desk.turns).toHaveLength(1);
  });

  it('still files one that names no conversation into the one in front', () => {
    const desks = receive(twoOpen(), {
      project: HERE.path,
      event: { type: 'message-delta', text: 'On it.' },
    });

    expect(currentDesk(desks)?.turns).toHaveLength(2);
  });

  /* Putting one down is not throwing it away — but the window does forget it,
     because reopening it reads it back from disk. */
  it('takes a put-down conversation off the row', () => {
    const desks = parkThread(twoOpen(), HERE.path, 'b');

    expect(threadsIn(currentDesk(desks)!).map((one) => one.address)).toEqual(['a']);
    expect(currentDesk(desks)?.turns[0]).toMatchObject({ text: 'make the hero tighter' });
  });

  it('refuses to put down the one you are looking at', () => {
    const desks = parkThread(twoOpen(), HERE.path, 'a');
    expect(currentDesk(desks)?.address).toBe('a');
    expect(threadsIn(currentDesk(desks)!)).toHaveLength(2);
  });

  it('does nothing when asked for a conversation this project does not have', () => {
    const before = twoOpen();
    expect(showThread(before, HERE.path, 'nope')).toBe(before);
  });

  /* The spend is the project's, not the conversation's, so it is counted
     wherever the words happen to land. */
  it('counts money against the project even when the words go elsewhere', () => {
    const desks = receive(twoOpen(), {
      project: HERE.path,
      conversation: 'b',
      event: { type: 'spend', amount: { minor: 40, currency: 'USD' }, label: 'Reading', reason: 'work' },
    });

    expect(currentDesk(desks)?.spent?.total).toEqual({ minor: 40, currency: 'USD' });
  });
});
