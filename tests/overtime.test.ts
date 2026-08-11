/** What it cost over a longer stretch than one sitting.
 *
 * Two things are load-bearing here. The split between work and our own retries
 * has to survive being grouped — it is the whole reason the longer views exist.
 * And two currencies must never quietly become one number, because that number
 * would look right and be wrong.
 */

import { describe, expect, it } from 'vitest';

import {
  asSummary,
  forProject,
  monthKey,
  spendOverTime,
  type Spend,
} from '../src/cost/overtime';

const UTC = { timeZone: 'UTC', locale: 'en-GB' } as const;

/** Midday UTC on a given day, so a zone shift of a few hours cannot move it. */
function at(iso: string): number {
  return Date.parse(iso);
}

const NOW = at('2026-08-12T12:00:00Z');

function spend(extra: Partial<Spend> = {}): Spend {
  return {
    at: at('2026-08-03T12:00:00Z'),
    project: '/Users/me/Work/studio-site',
    minor: 1000,
    currency: 'INR',
    reason: 'work',
    ...extra,
  };
}

function over(entries: readonly Spend[], now = NOW) {
  return spendOverTime(entries, { now, ...UTC });
}

/* ========================================================================== */
/* O-01 nothing at all                                                         */
/* ========================================================================== */

describe('with nothing spent', () => {
  it('says so rather than inventing a zero in some currency', () => {
    const totals = over([]);
    expect(totals.currencies).toEqual([]);
    expect(totals.main).toBeNull();
    expect(totals.mixed).toBe(false);
    expect(totals.skipped).toBe(0);
  });

  it('drops damaged entries and counts them', () => {
    const totals = over([
      spend({ at: Number.NaN }),
      spend({ minor: 12.5 }),
      spend({ minor: -400 }),
      spend({ currency: 'rupees' }),
      spend({ reason: 'guesswork' as Spend['reason'] }),
    ]);
    expect(totals.currencies).toEqual([]);
    expect(totals.skipped).toBe(5);
  });

  it('keeps the good ones when only some are damaged', () => {
    const totals = over([spend({ minor: 500 }), spend({ at: Number.POSITIVE_INFINITY })]);
    expect(totals.skipped).toBe(1);
    expect(totals.main?.overall.total).toEqual({ minor: 500, currency: 'INR' });
  });
});

/* ========================================================================== */
/* O-02 one entry                                                              */
/* ========================================================================== */

describe('with one thing spent', () => {
  const totals = over([spend({ minor: 8500 })]);
  const main = totals.main;

  it('is that one figure, in that one currency', () => {
    expect(totals.mixed).toBe(false);
    expect(main?.currency).toBe('INR');
    expect(main?.overall.total).toEqual({ minor: 8500, currency: 'INR' });
    expect(main?.overall.entryCount).toBe(1);
  });

  it('sits under the folder it was done in, named as a person would', () => {
    expect(main?.byProject).toHaveLength(1);
    expect(main?.byProject[0]?.name).toBe('studio-site');
    expect(main?.byProject[0]?.project).toBe('/Users/me/Work/studio-site');
    expect(main?.byProject[0]?.firstAt).toBe(at('2026-08-03T12:00:00Z'));
    expect(main?.byProject[0]?.lastAt).toBe(at('2026-08-03T12:00:00Z'));
  });

  it('sits in a month with a name and a sortable key', () => {
    expect(main?.byMonth).toHaveLength(1);
    expect(main?.byMonth[0]?.key).toBe('2026-08');
    expect(main?.byMonth[0]?.name).toBe('August 2026');
    expect(main?.byMonth[0]?.current).toBe(true);
  });

  it('names a folder even when there is no folder', () => {
    const nowhere = over([spend({ project: '   ' })]);
    expect(nowhere.main?.byProject[0]?.name).toBe('Elsewhere');
  });

  it('ignores a trailing separator on the folder', () => {
    expect(over([spend({ project: '/Users/me/Work/studio-site/' })]).main?.byProject[0]?.name).toBe(
      'studio-site',
    );
    expect(over([spend({ project: 'C:\\Users\\me\\studio-site' })]).main?.byProject[0]?.name).toBe(
      'studio-site',
    );
  });
});

/* ========================================================================== */
/* O-03 the split, carried the whole way up                                    */
/* ========================================================================== */

describe('work against attempts that didn’t work', () => {
  const entries = [
    spend({ minor: 6000, reason: 'work' }),
    spend({ minor: 2500, reason: 'work' }),
    spend({ minor: 1500, reason: 'retry-after-failure' }),
    spend({
      minor: 4000,
      reason: 'retry-after-failure',
      project: '/Users/me/Work/other-site',
      at: at('2026-07-04T12:00:00Z'),
    }),
  ];
  const main = over(entries).main;

  it('splits the overall total', () => {
    expect(main?.overall.total.minor).toBe(14_000);
    expect(main?.overall.work.minor).toBe(8500);
    expect(main?.overall.retry.minor).toBe(5500);
    expect(main?.overall.retryShare).toBeCloseTo(5500 / 14_000, 10);
  });

  it('splits each project', () => {
    const studio = main?.byProject.find((one) => one.name === 'studio-site');
    const other = main?.byProject.find((one) => one.name === 'other-site');
    expect(studio?.work.minor).toBe(8500);
    expect(studio?.retry.minor).toBe(1500);
    expect(other?.work.minor).toBe(0);
    expect(other?.retry.minor).toBe(4000);
    expect(other?.retryShare).toBe(1);
  });

  it('splits each month', () => {
    const august = main?.byMonth.find((one) => one.key === '2026-08');
    const july = main?.byMonth.find((one) => one.key === '2026-07');
    expect(august?.work.minor).toBe(8500);
    expect(august?.retry.minor).toBe(1500);
    expect(july?.total.minor).toBe(4000);
    expect(july?.retry.minor).toBe(4000);
  });

  it('has no share to report when nothing was spent', () => {
    const nothing = over([spend({ minor: 0 })]);
    expect(nothing.main?.overall.retryShare).toBe(0);
    expect(nothing.main?.overall.total.minor).toBe(0);
  });

  it('adds up to the total, every time', () => {
    for (const totals of [main?.overall, ...(main?.byProject ?? []), ...(main?.byMonth ?? [])]) {
      expect((totals?.work.minor ?? 0) + (totals?.retry.minor ?? 0)).toBe(totals?.total.minor);
    }
  });
});

/* ========================================================================== */
/* O-04 several months                                                         */
/* ========================================================================== */

describe('month by month', () => {
  const entries = [
    spend({ at: at('2026-06-15T12:00:00Z'), minor: 300 }),
    spend({ at: at('2026-08-01T12:00:00Z'), minor: 100 }),
    spend({ at: at('2025-12-31T12:00:00Z'), minor: 200 }),
    spend({ at: at('2026-08-09T12:00:00Z'), minor: 50 }),
  ];
  const months = over(entries).main?.byMonth ?? [];

  it('puts the most recent first', () => {
    expect(months.map((one) => one.key)).toEqual(['2026-08', '2026-06', '2025-12']);
  });

  it('gathers everything in the same month into one row', () => {
    expect(months[0]?.total.minor).toBe(150);
    expect(months[0]?.entryCount).toBe(2);
  });

  it('names each one the way a person says it', () => {
    expect(months.map((one) => one.name)).toEqual(['August 2026', 'June 2026', 'December 2025']);
  });

  it('marks only the month the given moment falls in', () => {
    expect(months.map((one) => one.current)).toEqual([true, false, false]);
    const earlier = spendOverTime(entries, { now: at('2026-06-02T12:00:00Z'), ...UTC });
    expect(earlier.main?.byMonth.map((one) => one.current)).toEqual([false, true, false]);
  });

  it('holds nothing for a month nothing was spent in', () => {
    expect(months.some((one) => one.key === '2026-07')).toBe(false);
  });
});

describe('where one month ends and the next begins', () => {
  const lastSecond = at('2026-07-31T23:59:59Z');
  const firstSecond = at('2026-08-01T00:00:00Z');

  it('splits at midnight', () => {
    const totals = spendOverTime(
      [spend({ at: lastSecond, minor: 100 }), spend({ at: firstSecond, minor: 200 })],
      { now: NOW, ...UTC },
    );
    expect(totals.main?.byMonth.map((one) => [one.key, one.total.minor])).toEqual([
      ['2026-08', 200],
      ['2026-07', 100],
    ]);
  });

  it('splits at the person’s own midnight, not somebody else’s', () => {
    // Half past midnight in Kolkata is still the previous evening in London.
    const entries = [spend({ at: at('2026-07-31T19:00:00Z'), minor: 100 })];
    expect(monthKey(entries[0]!.at, 'UTC')).toBe('2026-07');
    expect(monthKey(entries[0]!.at, 'Asia/Kolkata')).toBe('2026-08');

    const india = spendOverTime(entries, {
      now: NOW,
      timeZone: 'Asia/Kolkata',
      locale: 'en-GB',
    });
    expect(india.main?.byMonth[0]?.key).toBe('2026-08');
    expect(india.main?.byMonth[0]?.name).toBe('August 2026');
  });

  it('reads a year boundary as a change of year', () => {
    expect(monthKey(at('2025-12-31T23:00:00Z'), 'UTC')).toBe('2025-12');
    expect(monthKey(at('2026-01-01T01:00:00Z'), 'UTC')).toBe('2026-01');
  });
});

/* ========================================================================== */
/* O-05 several projects                                                       */
/* ========================================================================== */

describe('project by project', () => {
  const entries = [
    spend({ project: '/w/small', minor: 100 }),
    spend({ project: '/w/large', minor: 900 }),
    spend({ project: '/w/middle', minor: 500 }),
    spend({ project: '/w/large', minor: 100 }),
  ];
  const totals = over(entries);
  const projects = totals.main?.byProject ?? [];

  it('puts the most expensive first', () => {
    expect(projects.map((one) => one.name)).toEqual(['large', 'middle', 'small']);
    expect(projects[0]?.total.minor).toBe(1000);
  });

  it('settles a tie by name so the order never wobbles', () => {
    const tied = over([
      spend({ project: '/w/zebra', minor: 500 }),
      spend({ project: '/w/apple', minor: 500 }),
    ]);
    expect(tied.main?.byProject.map((one) => one.name)).toEqual(['apple', 'zebra']);
  });

  it('remembers when each one was first and last worked on', () => {
    const spread = over([
      spend({ project: '/w/one', at: at('2026-05-01T12:00:00Z') }),
      spend({ project: '/w/one', at: at('2026-08-01T12:00:00Z') }),
      spend({ project: '/w/one', at: at('2026-06-01T12:00:00Z') }),
    ]);
    expect(spread.main?.byProject[0]?.firstAt).toBe(at('2026-05-01T12:00:00Z'));
    expect(spread.main?.byProject[0]?.lastAt).toBe(at('2026-08-01T12:00:00Z'));
  });

  it('finds one by the folder it was opened from', () => {
    const main = totals.main;
    expect(main === null || main === undefined).toBe(false);
    expect(forProject(main!, '/w/large')?.total.minor).toBe(1000);
    expect(forProject(main!, '/w/large/')?.name).toBe('large');
    expect(forProject(main!, '/w/nothing-here')).toBeNull();
  });

  it('keeps two folders of the same name apart', () => {
    const same = over([
      spend({ project: '/one/site', minor: 100 }),
      spend({ project: '/two/site', minor: 200 }),
    ]);
    expect(same.main?.byProject).toHaveLength(2);
    expect(same.main?.byProject.map((one) => one.project)).toEqual(['/two/site', '/one/site']);
  });
});

/* ========================================================================== */
/* O-06 more than one currency                                                 */
/* ========================================================================== */

describe('when two currencies turn up', () => {
  const entries = [
    spend({ currency: 'INR', minor: 120_000, reason: 'work' }),
    spend({ currency: 'INR', minor: 30_000, reason: 'retry-after-failure' }),
    spend({ currency: 'usd', minor: 4200, reason: 'work' }),
    spend({ currency: 'JPY', minor: 900, reason: 'work' }),
  ];
  const totals = over(entries);

  it('never adds them together', () => {
    expect(totals.mixed).toBe(true);
    expect(totals.currencies).toHaveLength(3);
    const seen = totals.currencies.map((one) => [one.currency, one.overall.total.minor]);
    expect(seen).toEqual([
      ['INR', 150_000],
      ['USD', 4200],
      ['JPY', 900],
    ]);
  });

  it('keeps every amount in its own currency all the way down', () => {
    for (const one of totals.currencies) {
      for (const amount of [one.overall.total, one.overall.work, one.overall.retry]) {
        expect(amount.currency).toBe(one.currency);
      }
      for (const project of one.byProject) expect(project.total.currency).toBe(one.currency);
      for (const month of one.byMonth) expect(month.total.currency).toBe(one.currency);
    }
  });

  it('offers the largest as the one to show, without hiding the rest', () => {
    expect(totals.main?.currency).toBe('INR');
    expect(totals.currencies.map((one) => one.currency)).toContain('USD');
  });

  it('reads a currency written in lower case as the same currency', () => {
    const mixedCase = over([spend({ currency: 'inr', minor: 100 }), spend({ currency: 'INR', minor: 400 })]);
    expect(mixedCase.mixed).toBe(false);
    expect(mixedCase.main?.overall.total).toEqual({ minor: 500, currency: 'INR' });
  });

  it('splits each currency’s own work and retries', () => {
    const inr = totals.currencies.find((one) => one.currency === 'INR');
    const usd = totals.currencies.find((one) => one.currency === 'USD');
    expect(inr?.overall.retry.minor).toBe(30_000);
    expect(usd?.overall.retry).toEqual({ minor: 0, currency: 'USD' });
  });
});

/* ========================================================================== */
/* O-07 handing a longer total to the sentences                                */
/* ========================================================================== */

describe('describing a longer stretch', () => {
  it('takes the shape the end-of-sitting card already speaks', () => {
    const month = over([
      spend({ minor: 8500, reason: 'work' }),
      spend({ minor: 1500, reason: 'retry-after-failure' }),
    ]).main?.byMonth[0];

    const summary = asSummary(month!, { firstAt: 1, lastAt: 2 });
    expect(summary.currency).toBe('INR');
    expect(summary.total.minor).toBe(10_000);
    expect(summary.work.minor).toBe(8500);
    expect(summary.retry.minor).toBe(1500);
    expect(summary.retryShare).toBeCloseTo(0.15, 10);
    expect(summary.largestRetry).toBeNull();
    expect(summary.firstAt).toBe(1);
  });

  it('leaves the moments empty when there are none to give', () => {
    const summary = asSummary(over([spend()]).main!.overall);
    expect(summary.firstAt).toBeNull();
    expect(summary.lastAt).toBeNull();
  });
});
