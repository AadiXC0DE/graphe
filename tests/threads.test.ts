/** Two conversations open in one project, and nothing of one leaking into the
 *  other.
 *
 * A thread that keeps one sentence from the conversation you were in ten
 * seconds ago is worse than one that keeps none, because you cannot tell which
 * sentence it was. Every case here is that failure from a different direction.
 */

import { describe, expect, it } from 'vitest';

import { TASK_LABEL } from '../src/lib/describe';
import {
  helpersRunning,
  nowDoing,
  changeDesk,
  conversationIn,
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
import { NOTHING_SAID } from '../src/state/conversations';

const HERE = { path: '/p/paper-street', name: 'paper-street' };

/** A project with two conversations in it: `a` in front, `b` behind it. */
function twoOpen(): Desks {
  const opened = openDesk(noDesks, HERE);
  return changeDesk(opened, HERE.path, (desk) => ({
    ...desk,
    address: 'a',
    conversations: {
      a: { ...NOTHING_SAID, turns: [said('you', 'make the hero tighter')] },
      b: { ...NOTHING_SAID, turns: [said('you', 'the pricing page')] },
    },
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
    expect(conversationIn(desk, 'b').turns[0]).toMatchObject({ text: 'the pricing page' });
    // And the one that was in front is still there, exactly as it was.
    expect(conversationIn(desk, 'a').turns[0]).toMatchObject({ text: 'make the hero tighter' });
  });

  it('going back finds it as it was, not as an empty thread', () => {
    const there = showThread(twoOpen(), HERE.path, 'b');
    const back = showThread(there, HERE.path, 'a');

    expect(conversationIn(currentDesk(back), 'a').turns[0]).toMatchObject({
      text: 'make the hero tighter',
    });
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

    expect(conversationIn(desk, 'b').turns.some((turn) => turn.kind === 'said')).toBe(true);
    // And the conversation on screen heard nothing at all.
    expect(conversationIn(desk, 'a').turns).toHaveLength(1);
  });

  /* The agent beginning on a queued message is news for the waiting line
     beside the composer, not a new turn for the thread — the message is
     already there, written by the window the moment it was asked for. */
  it('does not fold a message that has begun into the thread again', () => {
    const desks = receive(twoOpen(), {
      project: HERE.path,
      conversation: 'a',
      event: { type: 'message-started', text: 'make the hero tighter' },
    });
    expect(conversationIn(currentDesk(desks), 'a').turns).toHaveLength(1);
  });

  it('still files one that names no conversation into the one in front', () => {
    const desks = receive(twoOpen(), {
      project: HERE.path,
      event: { type: 'message-delta', text: 'On it.' },
    });

    expect(conversationIn(currentDesk(desks), 'a').turns).toHaveLength(2);
  });

  it('measures concurrent jobs against the conversation that settled', () => {
    const started = changeDesk(twoOpen(), HERE.path, (desk) => ({
      ...desk,
      conversations: {
        a: {
          ...desk.conversations['a']!,
          doing: { task: { kind: 'blog' as const, size: 'feature' as const }, startedAt: 10 },
          counted: 10,
        },
        b: {
          ...desk.conversations['b']!,
          doing: { task: { kind: 'contact-form' as const, size: 'feature' as const }, startedAt: 20 },
          counted: 20,
        },
      },
    }));
    const summary = (total: number) => ({
      type: 'spend-summary' as const,
      summary: {
        currency: 'USD',
        total: { minor: total, currency: 'USD' },
        work: { minor: total, currency: 'USD' },
        retry: { minor: 0, currency: 'USD' },
        retryShare: 0,
        entryCount: 1,
        firstAt: 0,
        lastAt: 1,
        largestRetry: null,
      },
    });

    const backgroundSettled = receive(started, {
      project: HERE.path,
      conversation: 'b',
      event: summary(50),
    }, 100);
    const desk = currentDesk(backgroundSettled)!;
    expect(conversationIn(desk, 'a').doing?.task.kind).toBe('blog');
    expect(conversationIn(desk, 'b').doing).toBeNull();
    expect(desk.jobs.map((job) => job.cost.minor)).toEqual([30]);

    const bothSettled = receive(backgroundSettled, {
      project: HERE.path,
      conversation: 'a',
      event: summary(40),
    }, 110);
    expect(currentDesk(bothSettled)?.jobs.map((job) => job.cost.minor)).toEqual([30, 30]);
  });

  it('never puts a delayed event from an unknown conversation into the tab in front', () => {
    const before = twoOpen();
    const desks = receive(before, {
      project: HERE.path,
      conversation: 'already-closed',
      event: { type: 'error', message: 'terminated' },
    });

    expect(desks.byPath[HERE.path]?.conversations).toEqual(before.byPath[HERE.path]?.conversations);
  });

  /* Putting one down is not throwing it away — but the window does forget it,
     because reopening it reads it back from disk. */
  it('takes a put-down conversation off the row', () => {
    const desks = parkThread(twoOpen(), HERE.path, 'b');

    expect(threadsIn(currentDesk(desks)!).map((one) => one.address)).toEqual(['a']);
    expect(conversationIn(currentDesk(desks), 'a').turns[0]).toMatchObject({
      text: 'make the hero tighter',
    });
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

describe('helpers stay on screen when another tab is opened', () => {
  const helperTurn = (id: string, state: 'running' | 'done') => ({
    kind: 'did' as const,
    id,
    callId: id,
    label: TASK_LABEL,
    detail: `work ${id}`,
    state,
    at: 10,
  });

  it('keeps a helper the conversation behind is still running', () => {
    const desk = changeDesk(twoOpen(), HERE.path, (one) => ({
      ...one,
      conversations: {
        ...one.conversations,
        a: { ...one.conversations['a']!, turns: [] },
        b: { ...one.conversations['b']!, turns: [helperTurn('h1', 'running')] },
      },
    }));
    const front = currentDesk(desk)!;
    // The whole of the bug: reading the front conversation alone found none,
    // so the rail came off the screen and the helper looked stopped.
    expect(nowDoing(conversationIn(front, 'a').turns).helpers).toHaveLength(0);
    expect(helpersRunning(front).map((one) => one.id)).toEqual(['h1']);
  });

  it('leaves a finished helper behind a tab where it is', () => {
    const desk = changeDesk(twoOpen(), HERE.path, (one) => ({
      ...one,
      conversations: {
        ...one.conversations,
        a: { ...one.conversations['a']!, turns: [] },
        b: { ...one.conversations['b']!, turns: [helperTurn('h2', 'done')] },
      },
    }));
    expect(helpersRunning(currentDesk(desk)!)).toHaveLength(0);
  });

  it('never lists one twice', () => {
    const desk = changeDesk(twoOpen(), HERE.path, (one) => ({
      ...one,
      conversations: {
        ...one.conversations,
        a: { ...one.conversations['a']!, turns: [helperTurn('h3', 'running')] },
        b: { ...one.conversations['b']!, turns: [helperTurn('h3', 'running')] },
      },
    }));
    expect(helpersRunning(currentDesk(desk)!)).toHaveLength(1);
  });
});
