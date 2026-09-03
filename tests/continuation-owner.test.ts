/** The one thing allowed to send a message the person did not type.
 *
 * The decision is pure and tested next door. This is the part that cannot be:
 * one state per conversation, one send path, and the two properties everything
 * else rests on — one continuation per settle whatever the reasons present, and
 * a board finish or an add-on's ask consumed once rather than every settle
 * afterwards.
 */

import { describe, expect, it } from 'vitest';

import {
  continuationOwner,
  type Continuation,
  type GoalNow,
  type ListNow,
  type OwnerHooks,
} from '../electron/continuation-owner';
import { MOST_ROUNDS, MOST_STUCK } from '../src/work/continuation';

const project = '/work/site';
const address = 'conversation-1';

type Sent = { project: string; address: string; text: string; why: string };

function owner(
  list: () => ListNow | null = () => null,
  goal: () => GoalNow | null = () => null,
) {
  const sent: Sent[] = [];
  const saidOut: string[] = [];
  const told: Continuation[] = [];
  const halted: string[] = [];
  const hooks: OwnerHooks = {
    send: (where, at, text, why) => sent.push({ project: where, address: at, text, why }),
    say: (_where, _at, text) => saidOut.push(text),
    tell: (one) => told.push(one),
    list: () => Promise.resolve(list()),
    goal: () => Promise.resolve(goal()),
    halt: (_where, at) => halted.push(at),
  };
  return { one: continuationOwner(hooks), sent, said: saidOut, told, halted };
}

const someList = (done: number, total: number): ListNow => ({
  done,
  total,
  next: done >= total ? null : `Step ${String(done + 1)}`,
  finished: done >= total,
});

describe('one continuation per settle', () => {
  it('sends once when a list, a goal and the board all want a turn', async () => {
    const app = owner(
      () => someList(1, 6),
      () => ({ met: false, reason: 'not yet', objective: 'ship it' }),
    );
    app.one.landed(project, address, { id: 'a', title: 'The header' });
    app.one.extensionAsked(project, address, 'an add-on', 'Continue objective');
    await app.one.settled(project, address, 'finished');
    expect(app.sent).toHaveLength(1);
  });

  it('says out loud what it is doing, and tells the window', async () => {
    const app = owner(() => someList(3, 12));
    await app.one.settled(project, address, 'finished');
    expect(app.said[0]).toContain('Step 4');
    expect(app.told[0]?.resting).toBe(false);
    expect(app.told[0]?.why).toBe('checklist');
    expect(app.told[0]?.round).toBe(1);
  });

  it('sends to the conversation that settled, never to whichever is in front', async () => {
    const app = owner(() => someList(0, 3));
    await app.one.settled(project, 'a-background-tab', 'finished');
    expect(app.sent[0]?.address).toBe('a-background-tab');
  });
});

describe('what is consumed, and what is not', () => {
  it('takes a finished board piece in once, not on every settle after it', async () => {
    const app = owner();
    app.one.landed(project, address, { id: 'a', title: 'The header' });
    await app.one.settled(project, address, 'finished');
    await app.one.settled(project, address, 'finished');
    expect(app.sent).toHaveLength(1);
    expect(app.sent[0]?.why).toBe('board');
  });

  it('treats an add-on asking twice before a settle as asking for one turn', async () => {
    const app = owner();
    app.one.extensionAsked(project, address, 'an add-on', 'first');
    app.one.extensionAsked(project, address, 'an add-on', 'second');
    await app.one.settled(project, address, 'finished');
    expect(app.sent).toHaveLength(1);
    expect(app.sent[0]?.text).toBe('second');
  });

  it('names the add-on, so a turn nobody typed is never a mystery', async () => {
    const app = owner();
    app.one.extensionAsked(project, address, 'an add-on', 'Continue objective');
    await app.one.settled(project, address, 'finished');
    expect(app.said.join(' ')).toContain('an add-on');
  });
});

describe('every way it stops', () => {
  it('sends nothing once somebody has pressed Escape', async () => {
    const app = owner(() => someList(1, 8));
    app.one.stopped(project, address);
    await app.one.settled(project, address, 'stopped');
    expect(app.sent).toHaveLength(0);
  });

  it('sends nothing while somebody is being asked something', async () => {
    const app = owner(() => someList(1, 8));
    app.one.waiting(project, address, true);
    await app.one.settled(project, address, 'finished');
    expect(app.sent).toHaveLength(0);
  });

  it('sends again once whatever was being asked is answered', async () => {
    const app = owner(() => someList(1, 8));
    app.one.waiting(project, address, true);
    await app.one.settled(project, address, 'finished');
    app.one.waiting(project, address, false);
    await app.one.settled(project, address, 'finished');
    expect(app.sent).toHaveLength(1);
  });

  it('stops out loud after two rounds that tick nothing off', async () => {
    const app = owner(() => someList(2, 9));
    for (let round = 0; round < MOST_STUCK + 1; round += 1) {
      await app.one.settled(project, address, 'finished');
    }
    expect(app.sent).toHaveLength(MOST_STUCK);
    expect(app.said[app.said.length - 1]).not.toBe('');
    expect(app.told[app.told.length - 1]?.resting).toBe(true);
  });

  it('spends its budget and says so', async () => {
    let done = 0;
    const app = owner(() => someList(done++, 500));
    for (let round = 0; round < MOST_ROUNDS + 2; round += 1) {
      await app.one.settled(project, address, 'finished');
    }
    expect(app.sent).toHaveLength(MOST_ROUNDS);
    expect(app.said.join(' ')).toContain(String(MOST_ROUNDS));
  });

  it('starts the budget again when the person says something', async () => {
    let done = 0;
    const app = owner(() => someList(done++, 500));
    for (let round = 0; round < MOST_ROUNDS + 2; round += 1) {
      await app.one.settled(project, address, 'finished');
    }
    app.one.spoke(project, address);
    await app.one.settled(project, address, 'finished');
    expect(app.sent.length).toBe(MOST_ROUNDS + 1);
  });
});

describe('whether the job is at rest', () => {
  /* Everything that used to run on every settle — applying the checkout, taking
     the pictures, "always do this at the end" — runs on this instead, so it
     runs once per job rather than once per round. */
  it('is false while it is still sending, and true once it has stopped', async () => {
    const app = owner(() => someList(0, 4));
    await app.one.settled(project, address, 'finished');
    expect(app.one.resting(project, address)).toBe(false);

    const finished = owner(() => someList(4, 4));
    await finished.one.settled(project, address, 'finished');
    expect(finished.one.resting(project, address)).toBe(true);
  });

  it('is true the moment somebody stops it', async () => {
    const app = owner(() => someList(0, 4));
    app.one.stopped(project, address);
    await app.one.settled(project, address, 'stopped');
    expect(app.one.resting(project, address)).toBe(true);
  });
});

describe('what it remembers', () => {
  it('keeps one state per conversation, so two tabs never share a budget', async () => {
    const app = owner(() => someList(1, 8));
    await app.one.settled(project, 'one', 'finished');
    await app.one.settled(project, 'two', 'finished');
    expect(app.sent.map((one) => one.address)).toEqual(['one', 'two']);
    expect(app.told.map((one) => one.round)).toEqual([1, 1]);
  });

  it('says what it last decided, for the diagnostics', async () => {
    const app = owner(() => someList(1, 8));
    expect(app.one.lastMove(project, address)).toBeNull();
    await app.one.settled(project, address, 'finished');
    expect(app.one.lastMove(project, address)?.move.kind).toBe('send');
  });

  it('forgets one conversation, or a whole project, without touching the rest', async () => {
    const app = owner(() => someList(1, 8));
    await app.one.settled(project, 'one', 'finished');
    await app.one.settled('/work/other', 'one', 'finished');
    app.one.forget(project, 'one');
    expect(app.one.lastMove(project, 'one')).toBeNull();
    expect(app.one.lastMove('/work/other', 'one')).not.toBeNull();
    app.one.forget('/work/other');
    expect(app.one.lastMove('/work/other', 'one')).toBeNull();
  });
});
