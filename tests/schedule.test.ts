/** When a repeat comes round next.
 *
 * The arithmetic here is the only part of "it keeps going without you" that
 * nobody can see going wrong. A rail that draws the wrong picture is obvious; a
 * rule that fires twice on the morning the clocks change, or twenty times when a
 * laptop is opened after a week away, is discovered by the bill.
 *
 * So the interesting cases are all the awkward ones: an hour that does not exist,
 * an hour that happens twice, the 31st of a month with thirty days, and a machine
 * that was shut through several of them.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  clockOf,
  daysInMonth,
  nextRun,
  readRepeat,
  saysNext,
  saysRepeat,
  TOO_LATE,
  whenNext,
  type Repeat,
} from '../src/work/schedule';

/* ------------------------------------------------------------ scaffolding */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Every test in this file is about wall-clock time, so the wall clock has to
 *  be one we chose. New York, because its clocks change on a Sunday morning at
 *  two, which is exactly where the awkward cases live. */
const WAS = process.env['TZ'];

beforeAll(() => {
  process.env['TZ'] = 'America/New_York';
});

afterAll(() => {
  if (WAS === undefined) delete process.env['TZ'];
  else process.env['TZ'] = WAS;
});

/** A local moment, spelled out, so no test depends on a machine's own zone. */
function local(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
): number {
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime();
}

function shown(at: number): string {
  const when = new Date(at);
  return [
    String(when.getFullYear()),
    String(when.getMonth() + 1).padStart(2, '0'),
    String(when.getDate()).padStart(2, '0'),
    `${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`,
  ].join('-');
}

const everyMorning: Repeat = { every: 'day', at: { hour: 7, minute: 0 } };

/* ========================================================================== */
/* S-01 the ordinary rhythms                                                   */
/* ========================================================================== */

describe('S-01 when the next one is', () => {
  it('is later the same day when the time has not come round yet', () => {
    expect(shown(nextRun(everyMorning, local(2026, 6, 10, 5, 30)))).toBe('2026-06-10-07:00');
  });

  it('is tomorrow once it has been and gone', () => {
    expect(shown(nextRun(everyMorning, local(2026, 6, 10, 9, 0)))).toBe('2026-06-11-07:00');
  });

  it('is never the moment it was asked about, so asking again always moves on', () => {
    const at = local(2026, 6, 10, 7, 0);
    expect(nextRun(everyMorning, at)).toBeGreaterThan(at);
    expect(shown(nextRun(everyMorning, at))).toBe('2026-06-11-07:00');
  });

  it('answers the same thing every time it is asked', () => {
    const asked = local(2026, 6, 10, 5, 30);
    expect(nextRun(everyMorning, asked)).toBe(nextRun(everyMorning, asked));
  });

  it('leaves the rule it was handed exactly as it was', () => {
    const rule: Repeat = { every: 'week', on: 3, at: { hour: 8, minute: 15 } };
    const copy = JSON.parse(JSON.stringify(rule)) as Repeat;
    nextRun(rule, local(2026, 6, 10));
    expect(rule).toEqual(copy);
  });

  it('skips the weekend when it was asked for on weekdays', () => {
    const weekdays: Repeat = { every: 'weekday', at: { hour: 7, minute: 0 } };
    // Friday 12 June 2026, after the time.
    expect(shown(nextRun(weekdays, local(2026, 6, 12, 9, 0)))).toBe('2026-06-15-07:00');
    // Saturday.
    expect(shown(nextRun(weekdays, local(2026, 6, 13, 3, 0)))).toBe('2026-06-15-07:00');
    // Sunday.
    expect(shown(nextRun(weekdays, local(2026, 6, 14, 22, 0)))).toBe('2026-06-15-07:00');
  });

  it('waits a whole week for a day of the week that has just gone', () => {
    const mondays: Repeat = { every: 'week', on: 1, at: { hour: 9, minute: 30 } };
    expect(shown(nextRun(mondays, local(2026, 6, 8, 10, 0)))).toBe('2026-06-15-09:30');
    expect(shown(nextRun(mondays, local(2026, 6, 8, 8, 0)))).toBe('2026-06-08-09:30');
  });

  it('finds the day of the month, in the month after when it has passed', () => {
    const first: Repeat = { every: 'month', on: 1, at: { hour: 6, minute: 0 } };
    expect(shown(nextRun(first, local(2026, 6, 10)))).toBe('2026-07-01-06:00');
  });
});

/* ========================================================================== */
/* S-02 month ends                                                             */
/* ========================================================================== */

describe('S-02 the end of a short month', () => {
  it('knows how many days each month has', () => {
    expect(daysInMonth(2026, 1)).toBe(28);
    expect(daysInMonth(2028, 1)).toBe(29);
    expect(daysInMonth(2026, 3)).toBe(30);
    expect(daysInMonth(2026, 0)).toBe(31);
  });

  it('runs on the last day of a month that has no 31st', () => {
    const last: Repeat = { every: 'month', on: 31, at: { hour: 7, minute: 0 } };
    expect(shown(nextRun(last, local(2026, 4, 2)))).toBe('2026-04-30-07:00');
    expect(shown(nextRun(last, local(2026, 6, 2)))).toBe('2026-06-30-07:00');
  });

  it('runs on the 28th of an ordinary February and the 29th of a leap one', () => {
    const last: Repeat = { every: 'month', on: 31, at: { hour: 7, minute: 0 } };
    expect(shown(nextRun(last, local(2026, 2, 2)))).toBe('2026-02-28-07:00');
    expect(shown(nextRun(last, local(2028, 2, 2)))).toBe('2028-02-29-07:00');
  });

  it('keeps the 31st in the months that have one', () => {
    const last: Repeat = { every: 'month', on: 31, at: { hour: 7, minute: 0 } };
    expect(shown(nextRun(last, local(2026, 5, 2)))).toBe('2026-05-31-07:00');
  });

  it('does not run twice in a month it had to be pulled back in', () => {
    const last: Repeat = { every: 'month', on: 31, at: { hour: 7, minute: 0 } };
    const inApril = nextRun(last, local(2026, 4, 2));
    expect(shown(nextRun(last, inApril))).toBe('2026-05-31-07:00');
  });

  it('handles the 30th of February the same way', () => {
    const thirtieth: Repeat = { every: 'month', on: 30, at: { hour: 12, minute: 0 } };
    expect(shown(nextRun(thirtieth, local(2026, 2, 1)))).toBe('2026-02-28-12:00');
  });

  it('crosses into the next year without help', () => {
    const first: Repeat = { every: 'month', on: 1, at: { hour: 6, minute: 0 } };
    expect(shown(nextRun(first, local(2026, 12, 5)))).toBe('2027-01-01-06:00');
  });
});

/* ========================================================================== */
/* S-03 the mornings the clocks change                                         */
/* ========================================================================== */

describe('S-03 the clocks changing', () => {
  /* New York, 2026: forward on 8 March at two in the morning, back on 1
     November at two. */

  it('keeps a morning rule at the same time on the clock either side of it', () => {
    expect(shown(nextRun(everyMorning, local(2026, 3, 7, 12, 0)))).toBe('2026-03-08-07:00');
    expect(shown(nextRun(everyMorning, local(2026, 3, 8, 12, 0)))).toBe('2026-03-09-07:00');
  });

  it('costs an hour going forward and gains one coming back, in real time', () => {
    const before = local(2026, 3, 7, 7, 0);
    const after = nextRun(everyMorning, before);
    expect(after - before).toBe(23 * HOUR);

    const autumn = local(2026, 11, 1 - 1, 7, 0);
    expect(nextRun(everyMorning, autumn) - autumn).toBe(25 * HOUR);
  });

  it('runs an hour that does not exist as soon as it does exist', () => {
    // Half past two never happens on 8 March in New York. Skipping the day
    // would be worse than running at the moment the clock reaches it.
    const halfTwo: Repeat = { every: 'day', at: { hour: 2, minute: 30 } };
    const at = nextRun(halfTwo, local(2026, 3, 7, 12, 0));
    expect(shown(at)).toBe('2026-03-08-03:30');
    expect(at).toBeGreaterThan(local(2026, 3, 7, 12, 0));
  });

  it('takes the first of an hour that happens twice, and only the first', () => {
    const halfOne: Repeat = { every: 'day', at: { hour: 1, minute: 30 } };
    const first = nextRun(halfOne, local(2026, 10, 31, 12, 0));
    expect(shown(first)).toBe('2026-11-01-01:30');
    // The second one-thirty that morning is an hour later in real time, and
    // asking again from the first must not land on it.
    expect(shown(nextRun(halfOne, first))).toBe('2026-11-02-01:30');
    // Twenty-five real hours, which is the arithmetic saying it skipped the
    // second one-thirty rather than running again an hour later.
    expect(nextRun(halfOne, first) - first).toBe(25 * HOUR);
  });

  it('does the same where the clocks change on a different morning', () => {
    process.env['TZ'] = 'Europe/London';
    try {
      // British Summer Time starts on 29 March 2026 at one in the morning.
      const before = local(2026, 3, 28, 7, 0);
      expect(nextRun(everyMorning, before) - before).toBe(23 * HOUR);
      expect(shown(nextRun(everyMorning, before))).toBe('2026-03-29-07:00');
    } finally {
      process.env['TZ'] = 'America/New_York';
    }
  });

  it('is unbothered where the clocks never change at all', () => {
    process.env['TZ'] = 'Asia/Kolkata';
    try {
      const before = local(2026, 3, 7, 7, 0);
      expect(nextRun(everyMorning, before) - before).toBe(24 * HOUR);
    } finally {
      process.env['TZ'] = 'America/New_York';
    }
  });
});

/* ========================================================================== */
/* S-04 a machine that was asleep                                              */
/* ========================================================================== */

describe('S-04 shut through it', () => {
  it('waits when nothing has ever run', () => {
    const now = local(2026, 6, 10, 5, 0);
    expect(whenNext(everyMorning, { lastRunAt: null, now })).toEqual({
      runNow: false,
      nextAt: local(2026, 6, 10, 7, 0),
    });
  });

  it('waits when the next one has not come round yet', () => {
    const answer = whenNext(everyMorning, {
      lastRunAt: local(2026, 6, 9, 7, 0),
      now: local(2026, 6, 10, 5, 0),
    });
    expect(answer.runNow).toBe(false);
    expect(shown(answer.nextAt)).toBe('2026-06-10-07:00');
  });

  it('does it once when it has just come round', () => {
    const answer = whenNext(everyMorning, {
      lastRunAt: local(2026, 6, 9, 7, 0),
      now: local(2026, 6, 10, 7, 1),
    });
    expect(answer.runNow).toBe(true);
    expect(shown(answer.nextAt)).toBe('2026-06-11-07:00');
  });

  it('does it once, not five times, after a laptop was shut all week', () => {
    // Shut on Monday morning, opened on Saturday. Five mornings went past.
    let lastRunAt: number | null = local(2026, 6, 8, 7, 0);
    const now = local(2026, 6, 13, 10, 0);

    let ran = 0;
    for (let go = 0; go < 20; go += 1) {
      const answer = whenNext(everyMorning, { lastRunAt, now, tooLate: 7 * DAY });
      if (!answer.runNow) break;
      ran += 1;
      lastRunAt = now;
    }
    expect(ran).toBe(1);
  });

  it('lets a missed one go entirely once it is stale', () => {
    const answer = whenNext(everyMorning, {
      lastRunAt: local(2026, 6, 1, 7, 0),
      now: local(2026, 6, 13, 10, 0),
    });
    expect(answer.runNow).toBe(false);
    expect(shown(answer.nextAt)).toBe('2026-06-14-07:00');
  });

  it('still does one that was missed only a moment ago', () => {
    const answer = whenNext(everyMorning, {
      lastRunAt: local(2026, 6, 9, 7, 0),
      now: local(2026, 6, 10, 7, 0) + MINUTE,
      tooLate: TOO_LATE,
    });
    expect(answer.runNow).toBe(true);
  });

  it('never hands back a next one that has already been', () => {
    for (const hours of [0, 1, 5, 23, 24, 49, 200]) {
      const now = local(2026, 6, 10, 7, 0) + hours * HOUR;
      const answer = whenNext(everyMorning, { lastRunAt: local(2026, 6, 9, 7, 0), now });
      expect(answer.nextAt).toBeGreaterThan(now);
    }
  });

  it('settles into one a day once it has caught up', () => {
    let lastRunAt: number | null = local(2026, 6, 1, 7, 0);
    let now = local(2026, 6, 5, 6, 0);
    let ran = 0;
    // Ten minutes at a time for two days of wall clock.
    for (let tick = 0; tick < 24 * 12; tick += 1) {
      const answer = whenNext(everyMorning, { lastRunAt, now, tooLate: 30 * DAY });
      if (answer.runNow) {
        ran += 1;
        lastRunAt = now;
      }
      now += 10 * MINUTE;
    }
    expect(ran).toBe(3);
  });
});

/* ========================================================================== */
/* S-05 rules that were typed badly                                            */
/* ========================================================================== */

describe('S-05 a rule with a number out of range', () => {
  it('pulls an impossible hour into a possible one', () => {
    expect(readRepeat({ every: 'day', at: { hour: 30, minute: 90 } }).at).toEqual({
      hour: 23,
      minute: 59,
    });
    expect(readRepeat({ every: 'day', at: { hour: -4, minute: -1 } }).at).toEqual({
      hour: 0,
      minute: 0,
    });
  });

  it('falls back rather than refusing when a number is not a number', () => {
    expect(readRepeat({ every: 'day', at: { hour: Number.NaN, minute: 0 } }).at.hour).toBe(9);
  });

  it('pulls a day of the week and a day of the month into range', () => {
    const week = readRepeat({ every: 'week', on: 11 as never, at: { hour: 7, minute: 0 } });
    expect(week.every === 'week' && week.on).toBe(6);
    const month = readRepeat({ every: 'month', on: 99, at: { hour: 7, minute: 0 } });
    expect(month.every === 'month' && month.on).toBe(31);
  });

  it('still finds a next one for every rule it can be handed', () => {
    const now = local(2026, 6, 10, 12, 0);
    const rules: readonly Repeat[] = [
      { every: 'day', at: { hour: 0, minute: 0 } },
      { every: 'day', at: { hour: 23, minute: 59 } },
      { every: 'weekday', at: { hour: 12, minute: 0 } },
      { every: 'week', on: 0, at: { hour: 12, minute: 0 } },
      { every: 'week', on: 6, at: { hour: 12, minute: 0 } },
      { every: 'month', on: 1, at: { hour: 12, minute: 0 } },
      { every: 'month', on: 31, at: { hour: 12, minute: 0 } },
    ];
    for (const rule of rules) expect(nextRun(rule, now)).toBeGreaterThan(now);
  });
});

/* ========================================================================== */
/* S-06 the words                                                              */
/* ========================================================================== */

describe('S-06 saying when', () => {
  it('says the time the way a person says it', () => {
    expect(clockOf({ hour: 7, minute: 0 })).toBe('7:00am');
    expect(clockOf({ hour: 0, minute: 5 })).toBe('12:05am');
    expect(clockOf({ hour: 12, minute: 0 })).toBe('12:00pm');
    expect(clockOf({ hour: 18, minute: 30 })).toBe('6:30pm');
  });

  it('says each rhythm as somebody would have asked for it', () => {
    expect(saysRepeat(everyMorning)).toBe('Every day at 7:00am');
    expect(saysRepeat({ every: 'weekday', at: { hour: 9, minute: 0 } })).toBe(
      'Every weekday at 9:00am',
    );
    expect(saysRepeat({ every: 'week', on: 1, at: { hour: 9, minute: 0 } })).toBe(
      'Every Monday at 9:00am',
    );
    expect(saysRepeat({ every: 'month', on: 1, at: { hour: 9, minute: 0 } })).toBe(
      'The 1st of every month at 9:00am',
    );
    expect(saysRepeat({ every: 'month', on: 22, at: { hour: 9, minute: 0 } })).toContain('22nd');
    expect(saysRepeat({ every: 'month', on: 13, at: { hour: 9, minute: 0 } })).toContain('13th');
    expect(saysRepeat({ every: 'month', on: 3, at: { hour: 9, minute: 0 } })).toContain('3rd');
  });

  it('says when the next one is, roughly, the way a person would', () => {
    const now = local(2026, 6, 10, 5, 0);
    expect(saysNext(local(2026, 6, 10, 7, 0), now)).toBe('Later today at 7:00am');
    expect(saysNext(local(2026, 6, 11, 7, 0), now)).toBe('Tomorrow at 7:00am');
    expect(saysNext(local(2026, 6, 13, 7, 0), now)).toBe('On Saturday at 7:00am');
    expect(saysNext(local(2026, 7, 1, 7, 0), now)).toBe('On 1 July at 7:00am');
    expect(saysNext(now + 20 * MINUTE, now)).toBe('In 20 minutes');
    expect(saysNext(now + MINUTE, now)).toBe('In a minute');
    expect(saysNext(now - MINUTE, now)).toBe('Any moment now');
  });

  it('never says where any of this really lives', () => {
    const everything = [
      saysRepeat(everyMorning),
      saysRepeat({ every: 'weekday', at: { hour: 9, minute: 0 } }),
      saysRepeat({ every: 'week', on: 4, at: { hour: 9, minute: 0 } }),
      saysRepeat({ every: 'month', on: 31, at: { hour: 9, minute: 0 } }),
      saysNext(local(2026, 6, 11, 7, 0), local(2026, 6, 10, 5, 0)),
      saysNext(local(2026, 6, 10, 5, 1), local(2026, 6, 10, 5, 0)),
    ]
      .join(' ')
      .toLowerCase();

    for (const banned of [
      'cron',
      'schedule',
      'scheduled',
      'job',
      'timer',
      'background',
      'daemon',
      'process',
      'queue',
      'thread',
      'session',
      'token',
      'api',
      'git',
      'commit',
      'branch',
    ]) {
      expect(everything).not.toContain(banned);
    }
  });
});
