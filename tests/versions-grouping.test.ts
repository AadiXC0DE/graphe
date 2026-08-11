/** The shape of the version rail, before any of it is drawn.
 *
 * Everything here is a function of its arguments — `now` is passed in — so the
 * cases that matter are the ones a clock makes awkward: a version saved eight
 * minutes before midnight, a week boundary, a year boundary. A rail that says
 * "Today" about yesterday sends somebody looking for work they did not lose.
 */

import { describe, expect, it } from 'vitest';

import {
  FIRST_GLANCE,
  dayKey,
  dayLabel,
  groupVersions,
  looksTheSame,
  startOfDay,
  type Moment,
} from '../src/history/grouping';

/* ------------------------------------------------------------------ scaffolding */

type Saved = Moment & { title: string; picture?: string };

/** A local wall-clock moment, so the tests read as days rather than epochs. */
function at(
  year: number,
  month: number,
  day: number,
  hour = 12,
  minute = 0,
): number {
  return new Date(year, month - 1, day, hour, minute).getTime();
}

function version(id: string, when: number, over: Partial<Saved> = {}): Saved {
  return { id, at: when, title: id, ...over };
}

const NOW = at(2026, 8, 12, 15, 30); // Wednesday 12 August 2026, mid-afternoon

const labels = (groups: readonly { label: string }[]) => groups.map((one) => one.label);
const ids = (items: readonly Moment[]) => items.map((one) => one.id);

/* ========================================================================== */
/* G-01 the day a moment belongs to                                            */
/* ========================================================================== */

describe('G-01 which day', () => {
  it('starts a day at local midnight', () => {
    expect(startOfDay(at(2026, 8, 12, 23, 59))).toBe(at(2026, 8, 12, 0, 0));
    expect(startOfDay(at(2026, 8, 12, 0, 0))).toBe(at(2026, 8, 12, 0, 0));
  });

  it('keys a day by its calendar date, zero padded', () => {
    expect(dayKey(at(2026, 8, 12, 9))).toBe('2026-08-12');
    expect(dayKey(at(2026, 1, 3, 23, 59))).toBe('2026-01-03');
  });

  it('gives two moments on the same day the same key, whatever the hour', () => {
    expect(dayKey(at(2026, 8, 12, 0, 1))).toBe(dayKey(at(2026, 8, 12, 23, 59)));
  });

  it('gives two minutes either side of midnight different keys', () => {
    expect(dayKey(at(2026, 8, 11, 23, 59))).not.toBe(dayKey(at(2026, 8, 12, 0, 1)));
  });
});

/* ========================================================================== */
/* G-02 the words on the group                                                 */
/* ========================================================================== */

describe('G-02 what the day is called', () => {
  it('says Today for any hour of today', () => {
    expect(dayLabel(at(2026, 8, 12, 0, 0), NOW)).toBe('Today');
    expect(dayLabel(at(2026, 8, 12, 23, 59), NOW)).toBe('Today');
  });

  it('says Today for a moment slightly ahead of us', () => {
    // Clock skew from a folder written on another machine. "Tomorrow" would be
    // alarming; today is the honest answer.
    expect(dayLabel(NOW + 60_000, NOW)).toBe('Today');
  });

  it('says Yesterday for the day before, right up to midnight', () => {
    expect(dayLabel(at(2026, 8, 11, 23, 59), NOW)).toBe('Yesterday');
    expect(dayLabel(at(2026, 8, 11, 0, 1), NOW)).toBe('Yesterday');
  });

  it('names the weekday for the rest of the week', () => {
    expect(dayLabel(at(2026, 8, 10), NOW)).toBe('Monday');
    expect(dayLabel(at(2026, 8, 9), NOW)).toBe('Sunday');
    expect(dayLabel(at(2026, 8, 6), NOW)).toBe('Thursday');
  });

  it('stops naming weekdays at a week, so no two groups share a name', () => {
    // Six days back is the last Thursday there is; seven would be a second one.
    expect(dayLabel(at(2026, 8, 6), NOW)).toBe('Thursday');
    expect(dayLabel(at(2026, 8, 5), NOW)).toBe('5 August');
  });

  it('gives a date once it is older than a week', () => {
    expect(dayLabel(at(2026, 7, 30), NOW)).toBe('30 July');
    expect(dayLabel(at(2026, 1, 1), NOW)).toBe('1 January');
  });

  it('adds the year only when it is another year', () => {
    expect(dayLabel(at(2026, 2, 14), NOW)).toBe('14 February');
    expect(dayLabel(at(2025, 12, 31), NOW)).toBe('31 December 2025');
  });
});

/* ========================================================================== */
/* G-03 nothing yet                                                            */
/* ========================================================================== */

describe('G-03 an empty history', () => {
  it('is no groups rather than an empty group', () => {
    expect(groupVersions([], { now: NOW })).toEqual({ groups: [], folded: 0 });
  });

  it('holds nothing back when there is nothing', () => {
    const grouped = groupVersions([], { now: NOW, onlyChanged: true, pictureOf: () => 'a' });
    expect(grouped.groups).toEqual([]);
    expect(grouped.folded).toBe(0);
  });

  it('ignores a kept id that matches nothing', () => {
    const grouped = groupVersions([version('one', NOW)], { now: NOW, kept: ['gone'] });
    expect(labels(grouped.groups)).toEqual(['Today']);
  });
});

/* ========================================================================== */
/* G-04 a day's work                                                           */
/* ========================================================================== */

describe('G-04 everything from today', () => {
  const today = [
    version('nine', at(2026, 8, 12, 9)),
    version('eleven', at(2026, 8, 12, 11)),
    version('two', at(2026, 8, 12, 14)),
  ];

  it('is one group, called Today', () => {
    const { groups } = groupVersions(today, { now: NOW });
    expect(labels(groups)).toEqual(['Today']);
    expect(groups[0]?.kind).toBe('day');
  });

  it('is newest first, whatever order it arrived in', () => {
    const { groups } = groupVersions(today, { now: NOW });
    expect(ids(groups[0]?.items ?? [])).toEqual(['two', 'eleven', 'nine']);
  });

  it('sorts an input that came in backwards just the same', () => {
    const { groups } = groupVersions([...today].reverse(), { now: NOW });
    expect(ids(groups[0]?.items ?? [])).toEqual(['two', 'eleven', 'nine']);
  });

  it('leaves what it was given alone', () => {
    const given = [...today];
    groupVersions(given, { now: NOW });
    expect(ids(given)).toEqual(['nine', 'eleven', 'two']);
  });

  it('starts open', () => {
    const { groups } = groupVersions(today, { now: NOW });
    expect(groups[0]?.openByDefault).toBe(true);
  });

  it('keeps every one of them, however many there are', () => {
    // The rail shows the first handful and offers the rest; it is not this
    // module's job to throw any away.
    const many = Array.from({ length: 40 }, (_, one) =>
      version(`v${one}`, at(2026, 8, 12, 1) + one * 60_000),
    );
    const { groups } = groupVersions(many, { now: NOW });
    expect(groups[0]?.items).toHaveLength(40);
    expect(FIRST_GLANCE).toBeLessThan(40);
  });
});

/* ========================================================================== */
/* G-05 across midnight and beyond                                             */
/* ========================================================================== */

describe('G-05 more than one day', () => {
  const spread = [
    version('late', at(2026, 8, 11, 23, 58)),
    version('early', at(2026, 8, 12, 0, 2)),
    version('now', at(2026, 8, 12, 15)),
    version('monday', at(2026, 8, 10, 16)),
    version('lastmonth', at(2026, 7, 20, 10)),
  ];

  it('splits four minutes apart when a midnight falls between them', () => {
    const { groups } = groupVersions(spread, { now: NOW });
    expect(labels(groups)).toEqual(['Today', 'Yesterday', 'Monday', '20 July']);
  });

  it('puts each version in its own day', () => {
    const { groups } = groupVersions(spread, { now: NOW });
    expect(ids(groups[0]?.items ?? [])).toEqual(['now', 'early']);
    expect(ids(groups[1]?.items ?? [])).toEqual(['late']);
  });

  it('runs newest day to oldest', () => {
    const { groups } = groupVersions(spread, { now: NOW });
    const first = groups.map((one) => one.items[0]?.at ?? 0);
    expect(first).toEqual([...first].sort((one, other) => other - one));
  });

  it('opens today and folds the days behind it', () => {
    const { groups } = groupVersions(spread, { now: NOW });
    expect(groups.map((one) => one.openByDefault)).toEqual([true, false, false, false]);
  });

  it('opens the newest day even when nobody worked today', () => {
    // Every group folded reads as an empty rail.
    const { groups } = groupVersions(
      [version('monday', at(2026, 8, 10, 16)), version('older', at(2026, 8, 3, 16))],
      { now: NOW },
    );
    expect(labels(groups)).toEqual(['Monday', '3 August']);
    expect(groups.map((one) => one.openByDefault)).toEqual([true, false]);
  });

  it('gives each group a key that survives a new version arriving', () => {
    const before = groupVersions(spread, { now: NOW }).groups.map((one) => one.key);
    const after = groupVersions([version('newest', NOW), ...spread], { now: NOW }).groups.map(
      (one) => one.key,
    );
    expect(after).toEqual(before);
  });

  it('keeps two days in different years apart', () => {
    const { groups } = groupVersions(
      [version('thisyear', at(2026, 1, 2, 9)), version('lastyear', at(2025, 1, 2, 9))],
      { now: NOW },
    );
    expect(labels(groups)).toEqual(['2 January', '2 January 2025']);
    expect(groups[0]?.key).not.toBe(groups[1]?.key);
  });
});

/* ========================================================================== */
/* G-06 the ones somebody kept                                                 */
/* ========================================================================== */

describe('G-06 kept versions', () => {
  const some = [
    version('now', at(2026, 8, 12, 15)),
    version('yesterday', at(2026, 8, 11, 10)),
    version('old', at(2026, 6, 1, 10)),
  ];

  it('come out first, in their own group', () => {
    const { groups } = groupVersions(some, { now: NOW, kept: ['old'] });
    expect(groups[0]?.kind).toBe('kept');
    expect(groups[0]?.label).toBe('Kept');
    expect(ids(groups[0]?.items ?? [])).toEqual(['old']);
  });

  it('are not also left down in their day', () => {
    const { groups } = groupVersions(some, { now: NOW, kept: ['old'] });
    expect(labels(groups)).toEqual(['Kept', 'Today', 'Yesterday']);
    expect(groups.flatMap((one) => ids(one.items)).filter((id) => id === 'old')).toHaveLength(1);
  });

  it('are newest first among themselves, days apart or not', () => {
    const { groups } = groupVersions(some, { now: NOW, kept: ['old', 'now'] });
    expect(ids(groups[0]?.items ?? [])).toEqual(['now', 'old']);
  });

  it('leave no group behind when a day empties out', () => {
    const { groups } = groupVersions(some, { now: NOW, kept: ['now', 'yesterday', 'old'] });
    expect(labels(groups)).toEqual(['Kept']);
  });

  it('have no kept group at all when nothing is kept', () => {
    const { groups } = groupVersions(some, { now: NOW, kept: [] });
    expect(groups.some((one) => one.kind === 'kept')).toBe(false);
  });

  it('start open', () => {
    const { groups } = groupVersions(some, { now: NOW, kept: ['old'] });
    expect(groups[0]?.openByDefault).toBe(true);
  });
});

/* ========================================================================== */
/* G-07 the ones that look identical                                           */
/* ========================================================================== */

describe('G-07 when the picture did not change', () => {
  const shot = (id: string, when: number, picture: string) => version(id, when, { picture });
  const pictureOf = (one: Saved) => one.picture;

  const run = [
    shot('fourth', at(2026, 8, 12, 13), 'b'),
    shot('third', at(2026, 8, 12, 12), 'b'),
    shot('second', at(2026, 8, 12, 11), 'a'),
    shot('first', at(2026, 8, 12, 10), 'a'),
  ];

  it('spots the ones matching the moment before them', () => {
    // The look goes a, a, b, b: it arrived at `first` and changed at `third`.
    expect([...looksTheSame(run, pictureOf)].sort()).toEqual(['fourth', 'second']);
  });

  it('never calls the oldest one unchanged — there is nothing behind it', () => {
    expect(looksTheSame([shot('only', NOW, 'a')], pictureOf).size).toBe(0);
  });

  it('says nothing about a version it has no picture of', () => {
    const unknown = [version('later', at(2026, 8, 12, 12)), version('earlier', at(2026, 8, 12, 11))];
    expect(looksTheSame(unknown, pictureOf).size).toBe(0);
  });

  it('compares by time, not by the order it was handed', () => {
    expect([...looksTheSame([...run].reverse(), pictureOf)].sort()).toEqual(['fourth', 'second']);
  });

  it('folds them away when asked, and counts what it folded', () => {
    const grouped = groupVersions(run, { now: NOW, onlyChanged: true, pictureOf });
    expect(ids(grouped.groups[0]?.items ?? [])).toEqual(['third', 'first']);
    expect(grouped.folded).toBe(2);
  });

  it('leaves standing the moment a look arrived, not the ones repeating it', () => {
    const { groups } = groupVersions(run, { now: NOW, onlyChanged: true, pictureOf });
    expect(ids(groups[0]?.items ?? [])).not.toContain('fourth');
  });

  it('leaves everything alone when it is not asked', () => {
    const grouped = groupVersions(run, { now: NOW, pictureOf });
    expect(grouped.groups[0]?.items).toHaveLength(4);
    expect(grouped.folded).toBe(0);
  });

  it('folds nothing when there are no pictures to compare', () => {
    const grouped = groupVersions(run, { now: NOW, onlyChanged: true });
    expect(grouped.folded).toBe(0);
  });

  it('never folds away a kept version', () => {
    const grouped = groupVersions(run, {
      now: NOW,
      kept: ['fourth'],
      onlyChanged: true,
      pictureOf,
    });
    expect(labels(grouped.groups)).toEqual(['Kept', 'Today']);
    expect(ids(grouped.groups[0]?.items ?? [])).toEqual(['fourth']);
    expect(ids(grouped.groups[1]?.items ?? [])).toEqual(['third', 'first']);
    expect(grouped.folded).toBe(1);
  });

  it('never folds away one that was spared', () => {
    const grouped = groupVersions(run, {
      now: NOW,
      onlyChanged: true,
      pictureOf,
      spare: (one) => one.id === 'second',
    });
    expect(ids(grouped.groups[0]?.items ?? [])).toEqual(['third', 'second', 'first']);
    expect(grouped.folded).toBe(1);
  });

  it('can empty a whole day, and then that day is gone', () => {
    const flat = [
      shot('c', at(2026, 8, 12, 12), 'same'),
      shot('b', at(2026, 8, 11, 12), 'same'),
      shot('a', at(2026, 8, 11, 11), 'same'),
    ];
    const grouped = groupVersions(flat, { now: NOW, onlyChanged: true, pictureOf });
    expect(labels(grouped.groups)).toEqual(['Yesterday']);
    expect(ids(grouped.groups[0]?.items ?? [])).toEqual(['a']);
    expect(grouped.folded).toBe(2);
  });

  it('compares across a midnight, because the eye does', () => {
    const overnight = [
      shot('morning', at(2026, 8, 12, 9), 'same'),
      shot('night', at(2026, 8, 11, 23), 'same'),
    ];
    expect([...looksTheSame(overnight, pictureOf)]).toEqual(['morning']);
  });
});
