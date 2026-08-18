/** A ceiling that binds, rather than one that counts.
 *
 * The meter has always been able to say what a fan-out cost after the fact.
 * What is tested here is the part that has to happen while it is happening:
 * a run gets its share before it starts, the one after it is refused when the
 * share cannot be covered, and reaching the ceiling ends the processes that are
 * running rather than merely stopping counting them.
 *
 * The last of those is tested against a real child process, because "it stops"
 * and "we stopped adding it up" are exactly the two things that looked the same
 * from inside the app.
 */

import { spawn } from 'node:child_process';

import { beforeEach, describe, expect, it } from 'vitest';

import {
  HELPER_PATIENCE_MS,
  HELPER_TOOK_TOO_LONG,
  stopChild,
  taskTool,
} from '../src/agent/pi/tools';
import type { Money } from '../src/agent/types';
import { ceilingWords, Fleet, fleet, MOST_AT_ONCE, readCeiling, type UnseenSpend } from '../src/cost/fleet';
import { Allotment, createLimit } from '../src/cost/limits';
import { fromMajor, money } from '../src/cost/money';

function usd(major: number): Money {
  return fromMajor(major, 'USD');
}

/** A ceiling in the currency everything is priced in. */
function ceilingOf(major: number) {
  return createLimit(usd(major), 'session');
}

/** A process that will happily run forever, so the only reason it can end is
 *  that something ended it. */
function foreverProcess() {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    stdio: 'ignore',
  });
  const ended = new Promise<string | number | null>((resolve) => {
    child.on('exit', (code, signal) => resolve(signal ?? code));
  });
  return { child, ended };
}

beforeEach(() => {
  fleet.forget();
});

/* ------------------------------------------------------- sharing it out */

describe('one ceiling, several runs', () => {
  const limit = ceilingOf(10);

  it('measures the next run against what the others have already claimed', () => {
    const shared = new Allotment(limit);

    expect(shared.begin('one', usd(4)).ok).toBe(true);
    expect(shared.begin('two', usd(4)).ok).toBe(true);
    // Nothing has been spent at all, so a meter would say there is $10 left.
    expect(shared.spent).toEqual(usd(0));
    const third = shared.begin('three', usd(4));

    expect(third.ok).toBe(false);
    expect(third.ok === false && third.because).toBe('not-enough-left');
  });

  it('gives back what a run did not use', () => {
    const shared = new Allotment(limit);
    shared.begin('one', usd(6));
    shared.record('one', usd(1));
    expect(shared.free).toEqual(usd(4));

    expect(shared.end('one')).toEqual(usd(1));
    expect(shared.free).toEqual(usd(9));
  });

  it('counts spend nobody claimed against the ceiling all the same', () => {
    const shared = new Allotment(limit);
    shared.record(null, usd(9));
    expect(shared.status.state).toBe('nudge');

    const refused = shared.begin('one', usd(4));
    expect(refused.ok === false && refused.because).toBe('not-enough-left');
  });

  it('refuses everything once the ceiling itself is reached', () => {
    const shared = new Allotment(limit);
    const update = shared.record(null, usd(10));

    expect(update.status.state).toBe('stop');
    expect(update.announce).toBe(true);
    const refused = shared.begin('one', usd(0.01));
    expect(refused.ok === false && refused.because).toBe('at-the-ceiling');
    // The rule the whole module is built around, unchanged by any of this.
    expect(update.status.preservesWorkInFlight).toBe(true);
  });

  it('will not mix two currencies rather than compare them wrongly', () => {
    const shared = new Allotment(limit);
    expect(() => shared.record(null, money(500, 'INR'))).toThrow(TypeError);
    expect(() => shared.begin('one', money(500, 'INR'))).toThrow(TypeError);
  });
});

/* --------------------------------------------------------- run N plus one */

describe('a fan-out that runs out', () => {
  it('starts as many helpers as the ceiling covers, and refuses the next', () => {
    const many = new Fleet();
    many.hold(ceilingOf(10));

    // With nothing measured yet a helper is given the top of its band, which is
    // the direction a ceiling has to be wrong in.
    const admitted = [1, 2, 3, 4, 5, 6].map((n) =>
      many.begin({ id: `helper-${String(n)}`, kind: 'helper', stop: () => {} }),
    );

    expect(admitted.filter((one) => one.ok)).toHaveLength(4);
    const refused = admitted.find((one) => !one.ok);
    expect(refused?.ok === false && refused.because).toContain('$10');
  });

  it('binds no money at all when nobody has set a ceiling', () => {
    const many = new Fleet();
    // Admitted, ended, admitted again: twenty runs pass through without a
    // ceiling ever refusing one. How many run *at once* is a separate limit,
    // and a count is not a cost.
    for (let n = 0; n < 20; n += 1) {
      const id = `helper-${String(n)}`;
      expect(many.begin({ id, kind: 'helper', stop: () => {} }).ok).toBe(true);
      many.ended(id);
    }
    expect(many.allowsNewWork).toBe(true);
  });

  it('measures against everything spent before the ceiling was set', () => {
    const many = new Fleet();
    many.spent(null, usd(9));
    many.hold(ceilingOf(10));

    expect(many.status?.spent).toEqual(usd(9));
    expect(many.begin({ id: 'helper-1', kind: 'helper', stop: () => {} }).ok).toBe(false);
  });
});

/* ------------------------------------------------------------ it stops */

describe('reaching the ceiling', () => {
  it('ends the processes that are running, not just the counting of them', async () => {
    const one = foreverProcess();
    const two = foreverProcess();
    fleet.hold(ceilingOf(10));

    for (const [id, run] of [
      ['helper-1', one],
      ['helper-2', two],
    ] as const) {
      expect(fleet.begin({ id, kind: 'helper', stop: () => {} }).ok).toBe(true);
      // The same two steps the task tool takes: agreed to first, and told how
      // to end it once there is a process to end.
      fleet.watch(id, () => stopChild(run.child));
    }

    fleet.spent(null, usd(10));

    expect(await one.ended).toBe('SIGTERM');
    expect(await two.ended).toBe('SIGTERM');
    expect(fleet.running).toBe(0);
  });

  it('stops a run that says how to end it a moment too late', async () => {
    const late = foreverProcess();
    fleet.hold(ceilingOf(10));
    fleet.begin({ id: 'helper-1', kind: 'helper', stop: () => {} });

    fleet.spent(null, usd(10));
    fleet.watch('helper-1', () => stopChild(late.child));

    expect(await late.ended).toBe('SIGTERM');
  });

  it('says so once, after everything has actually been stopped', () => {
    const said: string[] = [];
    let runningWhenTold = -1;
    fleet.hold(ceilingOf(10));
    fleet.onReached((status) => {
      said.push(status.state);
      runningWhenTold = fleet.running;
    });
    fleet.begin({ id: 'helper-1', kind: 'helper', stop: () => {} });

    fleet.spent(null, usd(6));
    fleet.spent(null, usd(6));
    fleet.spent(null, usd(1));

    expect(said).toEqual(['stop']);
    expect(runningWhenTold).toBe(0);
  });

  it('refuses the next piece of work the person types', () => {
    fleet.hold(ceilingOf(10));
    fleet.spent(null, usd(10));

    expect(fleet.allowsNewWork).toBe(false);
    expect(fleet.status?.preservesWorkInFlight).toBe(true);
  });
});

/* --------------------------------------------------- through the real tool */

describe('the helper tool at the ceiling', () => {
  it('answers with the limit rather than spawning anything', async () => {
    fleet.hold(ceilingOf(10));
    fleet.spent(null, usd(10));

    const result = await taskTool('/tmp/agent').execute(
      'call-1',
      { task: 'Read every page and tell me which fonts they load' },
      undefined,
      undefined,
      undefined as never,
    );
    const [first] = result.content;
    const said = first !== undefined && first.type === 'text' ? first.text : '';

    expect(said).toContain('$10');
    expect(said).toContain('no more helpers can start');
    expect(fleet.running).toBe(0);
  });

  /* The sentence names the ceiling the person set, and nothing else with money
     in it. A price we cannot check is worse than no price. */
  it('quotes their own ceiling and never a guess at what this would cost', () => {
    const said = ceilingWords.refused(usd(10), 'en-US');
    expect(said).toContain('$10');
    expect(said.match(/\$/g)).toHaveLength(1);
  });
});

/* ------------------------------------------------------ what a helper cost */

describe('who pays for a helper', () => {
  it('counts what a helper spent in its own process against the ceiling', () => {
    const seen: UnseenSpend[] = [];
    fleet.hold(ceilingOf(10));
    fleet.onUnseenSpend((spend) => seen.push(spend));
    fleet.begin({ id: 'helper-1', kind: 'helper', stop: () => {} });

    fleet.spentUnseen('helper-1', {
      amount: usd(3),
      label: 'Reading the layout files',
      reason: 'work',
      project: '/Users/mira/Projects/portfolio',
    });

    // Passed on, because nothing upstream saw it: the meter would otherwise
    // show one number and the account another.
    expect(seen).toHaveLength(1);
    expect(seen[0]?.project).toBe('/Users/mira/Projects/portfolio');
    expect(fleet.status?.spent).toEqual(usd(3));
  });

  it('lets six helpers add up to more than the ceiling can take', () => {
    const many = new Fleet();
    many.hold(ceilingOf(10));
    for (let n = 1; n <= 4; n += 1) {
      const id = `helper-${String(n)}`;
      many.begin({ id, kind: 'helper', stop: () => {} });
      many.spentUnseen(id, {
        amount: usd(2.6),
        label: 'Reading the layout files',
        reason: 'work',
        project: '/Users/mira/Projects/portfolio',
      });
    }

    expect(many.status?.state).toBe('stop');
    expect(many.begin({ id: 'helper-5', kind: 'helper', stop: () => {} }).ok).toBe(false);
  });

  it('learns what a helper really costs, so the next share is a measurement', () => {
    // Nothing measured: a helper is set aside the top of its band, and a dollar
    // will not cover it.
    const guessing = new Fleet();
    guessing.hold(ceilingOf(1));
    expect(guessing.begin({ id: 'helper-1', kind: 'helper', stop: () => {} }).ok).toBe(false);

    const measured = new Fleet();
    measured.hold(ceilingOf(1000));
    for (let n = 1; n <= 6; n += 1) {
      const id = `helper-${String(n)}`;
      measured.begin({ id, kind: 'helper', stop: () => {} });
      measured.spent(id, usd(0.1));
      measured.ended(id);
    }

    // The same dollar of room, against six helpers that each cost a dime.
    measured.hold(ceilingOf(1.6));
    expect(measured.status?.spent).toEqual(usd(0.6));
    expect(measured.begin({ id: 'later', kind: 'helper', stop: () => {} }).ok).toBe(true);
  });
});

/* -------------------------------------------------------- reading one in */

describe('a ceiling somebody wrote down', () => {
  it('reads an amount and a currency', () => {
    expect(readCeiling('20 USD')?.ceiling).toEqual(usd(20));
    expect(readCeiling('  2000 inr ')?.ceiling).toEqual(fromMajor(2000, 'INR'));
    expect(readCeiling('20 USD')?.period).toBe('session');
  });

  it('refuses anything it cannot hold somebody to', () => {
    expect(readCeiling('')).toBeNull();
    expect(readCeiling('lots')).toBeNull();
    expect(readCeiling('0 USD')).toBeNull();
    expect(readCeiling('-5 USD')).toBeNull();
    expect(readCeiling('20 DOLLARS')).toBeNull();
  });
});

/* ========================================================================== */
/* A ceiling that cannot measure what is being spent                           */
/* ========================================================================== */

describe('a ceiling in the wrong currency', () => {
  it('says so rather than quietly measuring nothing', () => {
    const one = new Fleet();
    one.hold(createLimit(fromMajor(20, 'EUR'), 'session'));

    // What the account actually bills in.
    one.spent(null, fromMajor(5, 'USD'));

    const says = one.takeCannotBind();
    expect(says).not.toBeNull();
    expect(says).toContain('EUR');
    expect(says).toContain('USD');
    expect(says).toMatch(/cannot stop anything/);
  });

  it('says it once, because it is a fact about the setting and not an event', () => {
    const one = new Fleet();
    one.hold(createLimit(fromMajor(20, 'EUR'), 'session'));
    one.spent(null, fromMajor(5, 'USD'));

    expect(one.takeCannotBind()).not.toBeNull();
    expect(one.takeCannotBind()).toBeNull();
  });

  it('stays quiet when the ceiling can do its job', () => {
    const one = new Fleet();
    one.hold(createLimit(fromMajor(20, 'USD'), 'session'));
    one.spent(null, fromMajor(5, 'USD'));
    expect(one.takeCannotBind()).toBeNull();
  });

  it('stays quiet when nobody set a ceiling at all', () => {
    const one = new Fleet();
    one.spent(null, fromMajor(5, 'USD'));
    expect(one.takeCannotBind()).toBeNull();
  });

  it('says it in words a person can act on', () => {
    const one = new Fleet();
    one.hold(createLimit(fromMajor(20, 'GBP'), 'session'));
    one.spent(null, fromMajor(1, 'USD'));
    const says = one.takeCannotBind() ?? '';
    expect(says).toMatch(/Set one in USD/);
    expect(says).toMatch(/[.!]$/);
  });
});

/* ========================================================================== */
/* How many at once                                                            */
/* ========================================================================== */

describe('a cap on how many run at once', () => {
  const start = (one: Fleet, id: string, kind: 'helper' | 'away' = 'helper') =>
    one.begin({ id, kind, stop: () => {} });

  it('lets a turn fan out, and stops it short of a swarm', () => {
    const one = new Fleet();
    for (let i = 0; i < MOST_AT_ONCE.helper; i += 1) {
      expect(start(one, `h${String(i)}`).ok).toBe(true);
    }
    const refused = start(one, 'one-too-many');
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.because).toContain('as many as run at once');
  });

  it('counts each kind against its own cap', () => {
    const one = new Fleet();
    for (let i = 0; i < MOST_AT_ONCE.helper; i += 1) start(one, `h${String(i)}`);
    // Helpers are full; background work has its own budget and is unaffected.
    expect(start(one, 'a1', 'away').ok).toBe(true);
    expect(one.runningOf('helper')).toBe(MOST_AT_ONCE.helper);
    expect(one.runningOf('away')).toBe(1);
  });

  it('lets the next one in once somebody answers', () => {
    const one = new Fleet();
    for (let i = 0; i < MOST_AT_ONCE.helper; i += 1) start(one, `h${String(i)}`);
    expect(start(one, 'blocked').ok).toBe(false);
    one.ended('h0');
    expect(start(one, 'now-fine').ok).toBe(true);
  });

  it('caps even with no ceiling set, because a ceiling is about money', () => {
    const one = new Fleet();
    expect(one.ceiling).toBeNull();
    for (let i = 0; i < MOST_AT_ONCE.helper; i += 1) start(one, `h${String(i)}`);
    expect(start(one, 'over').ok).toBe(false);
  });
});

describe('a helper that never answers', () => {
  it('has a clock, and it is shorter than a night', () => {
    // Background work gets four hours because nobody is waiting. A helper runs
    // inside somebody's turn, and they are sitting there.
    expect(HELPER_PATIENCE_MS).toBeGreaterThan(60_000);
    expect(HELPER_PATIENCE_MS).toBeLessThan(4 * 60 * 60 * 1000);
  });

  it('tells the model what to do instead of trying again', () => {
    expect(HELPER_TOOK_TOO_LONG).toMatch(/not send the same piece of work again/i);
    expect(HELPER_TOOK_TOO_LONG).toMatch(/smaller pieces|yourself/i);
  });
});
