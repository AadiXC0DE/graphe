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

  /* What somebody typed, an add-on asking for a turn and a child coming back,
     all in the same run: one send, and the add-on's ask is the one acted on —
     the order the reasons are tried in. The piece that landed is taken in by
     that same settle rather than waiting for the next one. */
  it('acts on an add-on’s ask before a piece that landed, and sends once', async () => {
    const app = owner(() => someList(1, 6));
    app.one.spoke(project, address);
    app.one.landed(project, address, { id: 'a', title: 'The header' });
    app.one.extensionAsked(project, address, 'an add-on', 'carry on');
    await app.one.settled(project, address, 'finished');
    expect(app.sent.map((one) => one.why)).toEqual(['extension']);
    // The next settle is the list's round, not the piece again.
    await app.one.settled(project, address, 'finished');
    expect(app.sent.map((one) => one.why)).toEqual(['extension', 'checklist']);
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

describe('a run that has ended', () => {
  /* The epoch is what makes a late arrival safe. A piece that landed, or an
     add-on that asked for a turn, while the person was typing belongs to a run
     that is over: it is a result to read, not a reason to send. */
  it('sends nothing for a piece that landed before the person spoke', async () => {
    const app = owner();
    app.one.landed(project, address, { id: 'a', title: 'The header' });
    app.one.spoke(project, address);
    await app.one.settled(project, address, 'finished');
    expect(app.sent).toHaveLength(0);
    expect(app.one.lastMove(project, address)?.move.kind).toBe('rest');
  });

  it('sends nothing for an add-on that asked before the person spoke', async () => {
    const app = owner();
    app.one.extensionAsked(project, address, 'an add-on', 'carry on');
    app.one.spoke(project, address);
    await app.one.settled(project, address, 'finished');
    expect(app.sent).toHaveLength(0);
  });

  it('keeps a piece that landed while the run was stopped from restarting it', async () => {
    const app = owner();
    app.one.stopped(project, address);
    app.one.landed(project, address, { id: 'a', title: 'The header' });
    await app.one.settled(project, address, 'stopped');
    app.one.spoke(project, address);
    await app.one.settled(project, address, 'finished');
    expect(app.sent).toHaveLength(0);
  });

  /* A child finishing is a result, not a reason: work that landed after the
     person stopped the run is theirs to read when they come back, and a list
     with steps left on it is not a reason to start one either. */
  it('starts nothing for a child that finished after Stop, list and all', async () => {
    const app = owner(() => someList(1, 6));
    app.one.stopped(project, address);
    app.one.landed(project, address, { id: 'a', title: 'The header' });
    await app.one.settled(project, address, 'stopped');
    expect(app.sent).toHaveLength(0);
    expect(app.one.resting(project, address)).toBe(true);
    // And it does not creep in on the settle after that one.
    await app.one.settled(project, address, 'finished');
    expect(app.sent).toHaveLength(0);
  });

  /* A hook that fell over after Stop, or a provider retry giving up after it:
     the run is over, and picking it up is what Stop was pressed to prevent. */
  it('does not pick up a run that failed after Stop', async () => {
    const app = owner(() => someList(1, 6));
    app.one.stopped(project, address);
    await app.one.settled(project, address, 'failed');
    await app.one.settled(project, address, 'failed');
    expect(app.sent).toHaveLength(0);
  });

  it('ends an add-on’s turn that was started after Stop rather than letting it run', () => {
    const app = owner();
    app.one.stopped(project, address);
    app.one.extensionAsked(project, address, 'an add-on', 'carry on');
    expect(app.halted).toEqual([address]);
    // Nothing said: they pressed Stop, and a note about an add-on on top of
    // that is noise over an act they already took.
    expect(app.said).toEqual([]);
  });

  it('spends no round on a turn it turned down', async () => {
    const app = owner();
    app.one.landed(project, address, { id: 'a', title: 'The header' });
    app.one.spoke(project, address);
    await app.one.settled(project, address, 'finished');
    expect(app.told.at(-1)?.round).toBe(0);
    expect(app.told.at(-1)?.resting).toBe(true);
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
