/** The tape that turns "it feels slow" into a number.
 *
 * Two things are being kept honest. The arithmetic — a gap between two moments
 * is the gap somebody would measure with a stopwatch — and the promise that
 * this can never be the reason something broke: no clock, a hostile
 * `performance`, a moment that never happened, ten thousand marks in a long
 * sitting. None of those may throw, and none of them may lie.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { clear, mark, MOST, recorder, report, saysMarks, since, type Mark } from '../src/lib/marks';

/** A clock a test moves by hand. */
function handClock(): { now: () => number; at: (ms: number) => void } {
  let when = 0;
  return {
    now: () => when,
    at(ms) {
      when = ms;
    },
  };
}

afterEach(() => {
  clear();
  vi.unstubAllGlobals();
});

/* ========================================================================== */
/* The moments                                                                 */
/* ========================================================================== */

describe('marking the moments the targets are written in', () => {
  it('times everything from the first one', () => {
    const clock = handClock();
    const tape = recorder(clock.now);

    clock.at(1_200);
    tape.mark('launch');
    clock.at(1_512);
    tape.mark('first-paint');
    clock.at(2_060);
    tape.mark('project-open');

    expect(tape.report()).toEqual([
      { name: 'launch', ms: 0 },
      { name: 'first-paint', ms: 312 },
      { name: 'project-open', ms: 860 },
    ]);
  });

  it('measures the gap between any two of them', () => {
    const clock = handClock();
    const tape = recorder(clock.now);

    tape.mark('launch');
    clock.at(380);
    tape.mark('first-paint');
    clock.at(900);
    tape.mark('project-open');
    clock.at(1_140);
    tape.mark('first-token');
    clock.at(9_000);
    tape.mark('settled');

    expect(tape.since('launch', 'first-paint')).toBe(380);
    expect(tape.since('project-open', 'first-token')).toBe(240);
    expect(tape.since('launch', 'settled')).toBe(9_000);
  });

  it('says nothing rather than zero when a moment has not happened', () => {
    const tape = recorder(handClock().now);
    tape.mark('launch');

    expect(tape.since('launch', 'first-token')).toBeNull();
    expect(tape.since('project-open', 'settled')).toBeNull();
    expect(tape.report()).toEqual([{ name: 'launch', ms: 0 }]);
  });

  it('has nothing to report before anything is marked', () => {
    expect(recorder(handClock().now).report()).toEqual([]);
  });

  it('reads the latest of a moment that happens more than once', () => {
    const clock = handClock();
    const tape = recorder(clock.now);

    tape.mark('project-open');
    clock.at(500);
    tape.mark('first-token');
    clock.at(4_000);
    // A second project, opened in the same sitting.
    tape.mark('project-open');
    clock.at(4_180);
    tape.mark('first-token');

    expect(tape.since('project-open', 'first-token')).toBe(180);
  });
});

/* ========================================================================== */
/* Never in the way                                                            */
/* ========================================================================== */

describe('a recorder that cannot be the problem', () => {
  it('keeps a bound on itself, however long the sitting', () => {
    const clock = handClock();
    const tape = recorder(clock.now);

    for (let at = 0; at < MOST * 5; at += 1) {
      clock.at(at);
      tape.mark(`step-${String(at)}`);
    }

    const marks = tape.report();
    expect(marks).toHaveLength(MOST);
    // The oldest are dropped, not the origin: the numbers stay measured from
    // the start of the sitting rather than from wherever the ring happens to
    // begin.
    expect(marks[marks.length - 1]?.ms).toBe(MOST * 5 - 1);
    expect(marks[0]?.name).toBe(`step-${String(MOST * 4)}`);
  });

  it('works where there is no performance at all', () => {
    vi.stubGlobal('performance', undefined);

    expect(() => {
      mark('launch');
      mark('first-paint');
    }).not.toThrow();
    expect(report()).toHaveLength(2);
    expect(since('launch', 'first-paint')).not.toBeNull();
  });

  it('survives a performance that throws on everything', () => {
    vi.stubGlobal('performance', {
      now: () => {
        throw new Error('no');
      },
      mark: () => {
        throw new Error('no');
      },
    });

    expect(() => {
      mark('launch');
      mark('settled');
    }).not.toThrow();
    expect(report()).toHaveLength(2);
  });

  it('stamps the same names into the browser timeline when there is one', () => {
    const stamped: string[] = [];
    vi.stubGlobal('performance', {
      now: () => 0,
      mark: (name: string) => {
        stamped.push(name);
      },
    });

    mark('launch');
    mark('first-token');
    expect(stamped).toEqual(['launch', 'first-token']);
  });

  it('forgets a sitting when asked', () => {
    mark('launch');
    clear();
    expect(report()).toEqual([]);
    expect(since('launch', 'launch')).toBeNull();
  });
});

/* ========================================================================== */
/* The machinery view                                                          */
/* ========================================================================== */

describe('the perf section', () => {
  const TAPE: readonly Mark[] = [
    { name: 'launch', ms: 0 },
    { name: 'first-paint', ms: 312 },
    { name: 'project-open', ms: 860 },
    { name: 'first-token', ms: 1_140.44 },
  ];

  it('prints the real names and the real milliseconds', () => {
    const said = saysMarks(TAPE);
    expect(said.split('\n')[0]).toBe('perf');
    expect(said).toContain('first-paint');
    expect(said).toContain('312.0ms');
    // The step as well as the total, because the interesting number is usually
    // the gap.
    expect(said).toContain('(+548.0ms)');
    expect(said).toContain('1140.4ms');
  });

  it('says so plainly when nothing has been measured', () => {
    expect(saysMarks([])).toContain('nothing measured yet');
  });
});
