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
import { availableParallelism, freemem, totalmem } from 'node:os';

import { readFileSync } from 'node:fs';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  HELPER_PATIENCE_MS,
  HELPER_RAN_TOO_LONG,
  HELPER_TOOK_TOO_LONG,
  HELPER_WALL_CLOCK_MS,
  helperClocks,
  stopChild,
  taskTool,
  whyEndHelper,
} from '../src/agent/pi/tools';
import { capsFor, capsNow } from '../src/work/capacity';
import { AT_A_TIME } from '../src/work/board';
import { CHECKS_AT_A_TIME } from '../src/agent/pi/checks';
import { MOST_RUNNING } from '../src/agent/running';
import { MOST_TOGETHER } from '../src/agent/research';
import type { Money } from '../src/agent/types';
import {
  ceilingWords,
  Fleet,
  fleet,
  HELPER_TOTAL_MAX,
  MOST_AT_ONCE,
  readCeiling,
  type UnseenSpend,
} from '../src/cost/fleet';
import { Allotment, createLimit } from '../src/cost/limits';
import { fromMajor, money } from '../src/cost/money';

function usd(major: number): Money {
  return fromMajor(major, 'USD');
}

/** A ceiling in the currency everything is priced in. */
function ceilingOf(major: number) {
  return createLimit(usd(major), 'session');
}

/** The top of one helper's band before anything about it has been measured —
 *  what a fresh fleet reserves for each one. */
const EACH_HELPER_MAJOR = 2.5;

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
    // A ceiling that runs out one helper before the machine's own cap does, so
    // what refuses the next one is the money rather than the count.
    const room = MOST_AT_ONCE.helper - 1;
    const many = new Fleet();
    many.hold(ceilingOf(EACH_HELPER_MAJOR * room));

    // With nothing measured yet a helper is given the top of its band, which is
    // the direction a ceiling has to be wrong in.
    const admitted = Array.from({ length: room + 1 }, (_, n) =>
      many.begin({ id: `helper-${String(n)}`, kind: 'helper', stop: () => {} }),
    );

    expect(admitted.filter((one) => one.ok)).toHaveLength(room);
    const refused = admitted.find((one) => !one.ok);
    expect(refused?.ok === false && refused.because).toBe(
      ceilingWords.refused(usd(EACH_HELPER_MAJOR * room)),
    );
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

  it('has a second clock that no amount of noise can put off', () => {
    expect(HELPER_WALL_CLOCK_MS).toBeGreaterThan(HELPER_PATIENCE_MS);
    expect(HELPER_WALL_CLOCK_MS).toBe(30 * 60 * 1000);
  });

  it('tells the model what to do instead of trying again', () => {
    expect(HELPER_TOOK_TOO_LONG).toMatch(/not send the same piece of work again/i);
    expect(HELPER_TOOK_TOO_LONG).toMatch(/smaller pieces|yourself/i);
  });

  it('says which of the two clocks ran out, because they mean opposite things', () => {
    expect(HELPER_TOOK_TOO_LONG).toMatch(/nothing at all/i);
    expect(HELPER_RAN_TOO_LONG).toMatch(/working the whole time/i);
    expect(HELPER_RAN_TOO_LONG).not.toBe(HELPER_TOOK_TOO_LONG);
  });
});

/* A builder running a long test suite writes nothing anybody was watching for,
   and was killed for it with "the helper took too long" — which reads as a
   stall when what happened was work. */
describe('a helper that is quiet, and a helper that is long', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function watch(): { endings: string[]; clocks: ReturnType<typeof helperClocks> } {
    const endings: string[] = [];
    return { endings, clocks: helperClocks((why) => endings.push(why)) };
  }

  it('lets a step run ten silent minutes as long as something says it is there', () => {
    const { endings, clocks } = watch();
    // A test suite: nothing on the answer channel, a line of its own output
    // every half minute.
    for (let at = 0; at < 20; at += 1) {
      vi.advanceTimersByTime(30_000);
      clocks.stirred();
    }
    expect(endings).toEqual([]);
    clocks.stop();
  });

  it('ends one that has shown no sign of itself at all', () => {
    const { endings, clocks } = watch();
    vi.advanceTimersByTime(HELPER_PATIENCE_MS + 10_000);
    expect(endings).toEqual([HELPER_TOOK_TOO_LONG]);
    clocks.stop();
  });

  it('ends one still going at the wall clock, however busy it has been', () => {
    const { endings, clocks } = watch();
    for (let at = 0; at * 30_000 < HELPER_WALL_CLOCK_MS + 60_000; at += 1) {
      vi.advanceTimersByTime(30_000);
      clocks.stirred();
    }
    expect(endings).toEqual([HELPER_RAN_TOO_LONG]);
    clocks.stop();
  });

  it('ends once and then stops looking', () => {
    const { endings, clocks } = watch();
    vi.advanceTimersByTime(HELPER_WALL_CLOCK_MS * 2);
    expect(endings).toHaveLength(1);
    clocks.stop();
  });

  it('is stopped by a run that finished, so nothing fires behind it', () => {
    const { endings, clocks } = watch();
    clocks.stop();
    vi.advanceTimersByTime(HELPER_WALL_CLOCK_MS * 2);
    expect(endings).toEqual([]);
  });

  it('reads the two deadlines the same way whichever came first', () => {
    expect(whyEndHelper({ startedAt: 0, lastSign: 0, now: 1000 })).toBeNull();
    expect(whyEndHelper({ startedAt: 0, lastSign: 0, now: HELPER_PATIENCE_MS })).toBe(
      HELPER_TOOK_TOO_LONG,
    );
    expect(
      whyEndHelper({
        startedAt: 0,
        lastSign: HELPER_WALL_CLOCK_MS - 1000,
        now: HELPER_WALL_CLOCK_MS,
      }),
    ).toBe(HELPER_RAN_TOO_LONG);
  });

  it('counts the child\'s own noise as a sign of life, not only its answer', () => {
    const tools = readFileSync(new URL('../src/agent/pi/tools.ts', import.meta.url), 'utf8');
    const at = tools.indexOf("child.stderr.on('data'");
    expect(at).toBeGreaterThan(-1);
    expect(tools.slice(at, at + 300)).toContain('stirred()');
  });
});

/* ------------------------------------------------------- one set of caps */

/* Five files used to hold five numbers and none of them knew about the others.
   The point of the check is not any one value; it is that there is one place
   the values come from, and that it is this machine. */
describe('the caps every file runs on', () => {
  it('is the machine\'s fan-out, not a number of its own', () => {
    expect(MOST_AT_ONCE.helper).toBe(capsNow().helpers);
    expect(MOST_AT_ONCE.helper).toBeGreaterThanOrEqual(2);
    expect(MOST_AT_ONCE.helper).toBeLessThanOrEqual(6);
  });

  it('is one answer, and all five agree with it', () => {
    const caps = capsNow();
    expect(HELPER_TOTAL_MAX).toBe(caps.helpers);
    expect(MOST_TOGETHER).toBe(caps.research);
    expect(AT_A_TIME).toBe(caps.board);
    expect(CHECKS_AT_A_TIME).toBe(caps.checks);
    expect(MOST_RUNNING).toBe(caps.running);
  });

  it('is what this machine works out, rather than what a file remembered', () => {
    expect(capsNow()).toEqual(
      capsFor({
        totalMemBytes: totalmem(),
        freeMemBytes: freemem(),
        cores: availableParallelism(),
      }),
    );
  });

  it('never sends more research out than the fan-out will admit', () => {
    expect(MOST_TOGETHER).toBeLessThanOrEqual(HELPER_TOTAL_MAX);
  });

  it('follows the machine down: a small one carries fewer helpers than a large one', () => {
    const small = capsFor({ totalMemBytes: 8 * 1024 ** 3, freeMemBytes: 0, cores: 4 });
    const large = capsFor({ totalMemBytes: 64 * 1024 ** 3, freeMemBytes: 0, cores: 16 });
    expect(small.helpers).toBeLessThan(large.helpers);
    expect(small.research).toBeLessThanOrEqual(small.helpers);
    expect(large.research).toBeLessThanOrEqual(large.helpers);
  });
});

describe('a warning that stops being true', () => {
  it('goes quiet once a spend the ceiling can measure arrives', () => {
    const one = new Fleet();
    one.hold(createLimit(fromMajor(20, 'USD'), 'session'));
    one.spent(null, fromMajor(1, 'EUR'));
    one.spent(null, fromMajor(1, 'USD'));
    expect(one.takeCannotBind()).toBeNull();
  });

  /* The nonsense this prevents: "your limit is in EUR and the account bills in
     EUR, so it cannot stop anything." */
  it('does not carry over to the ceiling that replaced it', () => {
    const one = new Fleet();
    one.hold(createLimit(fromMajor(20, 'USD'), 'session'));
    one.spent(null, fromMajor(1, 'EUR'));
    one.hold(createLimit(fromMajor(20, 'EUR'), 'session'));
    expect(one.takeCannotBind()).toBeNull();
  });

  it('leaves background work to the board that already counts it', () => {
    const one = new Fleet();
    // Two projects, four pieces each. A cap here would be a cap across every
    // project at once, and the board holds one per project.
    for (let i = 0; i < 12; i += 1) {
      expect(one.begin({ id: `away-${String(i)}`, kind: 'away', stop: () => {} }).ok).toBe(true);
    }
  });
});
