/** Tokens by day, and the grid that shows them.
 *
 * Three things are worth holding still: a day is a local day (somebody's
 * "yesterday" is not UTC's), gaps between busy days stay in the grid so it
 * reads as a calendar, and the colour steps are quartiles over the days that
 * have anything — one heavy afternoon must not flatten a fortnight of ordinary
 * ones into the bottom shade.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readTokenUsage } from '../electron/tokens';

import {
  daysFromUsage,
  intensityOf,
  saysTokens,
  weeksOf,
} from '../src/lib/token-days';

/** A fixed morning, so nothing here depends on the clock this runs on. */
const MORNING = new Date(2026, 7, 21, 9, 0, 0).getTime();
const DAY = 24 * 60 * 60 * 1000;

function dayAt(year: number, month: number, date: number): number {
  return new Date(year, month, date).getTime();
}

describe('daysFromUsage', () => {
  it('folds everything that happened in one local day into one entry', () => {
    const view = daysFromUsage([
      { at: MORNING, tokens: 1_000 },
      { at: MORNING + 3 * 60 * 60 * 1000, tokens: 500 },
      { at: MORNING + 26 * 60 * 60 * 1000, tokens: 250 },
    ]);
    expect(view.days).toEqual([
      { at: dayAt(2026, 7, 21), tokens: 1_500 },
      { at: dayAt(2026, 7, 22), tokens: 250 },
    ]);
    expect(view.total).toBe(1_750);
  });

  it('says days oldest first, whatever order they arrived in', () => {
    const view = daysFromUsage([
      { at: MORNING + DAY, tokens: 10 },
      { at: MORNING, tokens: 20 },
    ]);
    expect(view.days.map((one) => one.at)).toEqual([dayAt(2026, 7, 21), dayAt(2026, 7, 22)]);
  });

  it('counts nothing for entries with no tokens, rather than shipping zero days', () => {
    const view = daysFromUsage([
      { at: MORNING, tokens: 0 },
      { at: MORNING, tokens: -5 },
      { at: MORNING, tokens: Number.NaN },
      { at: MORNING + DAY, tokens: 40 },
    ]);
    expect(view.days).toEqual([{ at: dayAt(2026, 7, 22), tokens: 40 }]);
    expect(view.total).toBe(40);
  });
});

describe('intensityOf', () => {
  const days = daysFromUsage([
    { at: MORNING, tokens: 100 },
    { at: MORNING + DAY, tokens: 200 },
    { at: MORNING + 2 * DAY, tokens: 300 },
    { at: MORNING + 3 * DAY, tokens: 400 },
  ]).days;

  it('gives an empty day no colour at all', () => {
    expect(intensityOf(0, days)).toBe(0);
  });

  it('ranks a day against the others, so one spike does not flatten the rest', () => {
    expect(intensityOf(100, days)).toBe(1);
    expect(intensityOf(200, days)).toBe(2);
    expect(intensityOf(300, days)).toBe(2);
    expect(intensityOf(400, days)).toBe(3);
  });

  it('gives every identical day the same shade rather than straddling two', () => {
    const even = daysFromUsage([
      { at: MORNING, tokens: 500 },
      { at: MORNING + DAY, tokens: 500 },
      { at: MORNING + 2 * DAY, tokens: 500 },
    ]).days;
    expect(intensityOf(500, even)).toBe(1);
  });

  it('answers nothing when there is nothing to measure against', () => {
    expect(intensityOf(500, [])).toBe(0);
  });
});

describe('weeksOf', () => {
  it('lays whole weeks out, Monday first, through the end of the week that holds today', () => {
    // 2026-08-21 is a Friday. Two weeks means the Monday eleven days back,
    // and the last cell is that week's Sunday — two days past today.
    const weeks = weeksOf([], MORNING, 2);
    expect(weeks.length).toBe(2);
    expect(weeks[0]!.length).toBe(7);
    expect(new Date(weeks[0]![0]!.at).getDay()).toBe(1);
    const last = weeks[1]![6]!;
    expect(last.at).toBe(dayAt(2026, 7, 23));
    expect(last.tokens).toBe(-1);
    const today = weeks[1]![4]!;
    expect(today.at).toBe(dayAt(2026, 7, 21));
  });

  it('carries the counts it was given and fills the rest with zeros', () => {
    const days = daysFromUsage([{ at: MORNING, tokens: 999 }]).days;
    const weeks = weeksOf(days, MORNING, 2);
    const today = weeks[1]![4]!; // Friday of the second week
    expect(today.tokens).toBe(999);
    expect(weeks[0]![0]!.tokens).toBe(0);
  });

  it('marks days the week has not reached yet, so they can drop out of the drawing', () => {
    const weeks = weeksOf([], MORNING, 2);
    expect(weeks[1]![6]!.tokens).toBe(-1);
  });
});

describe('saysTokens', () => {
  it('says small counts plainly and big ones the way people read them', () => {
    expect(saysTokens(812)).toBe('812');
    expect(saysTokens(41_200)).toBe('41.2k');
    expect(saysTokens(152_700)).toBe('153k');
    expect(saysTokens(3_400_000)).toBe('3.4m');
    expect(saysTokens(12_000_000)).toBe('12m');
  });
});

/* -------------------------------------------------------------------------- */
/* Reading the transcripts on disk                                            */
/* -------------------------------------------------------------------------- */


describe('readTokenUsage', () => {
  let folder: string;

  beforeAll(async () => {
    folder = await mkdtemp(join(tmpdir(), 'graphe-tokens-'));
  });

  afterAll(async () => {
    await rm(folder, { recursive: true, force: true });
  });

  const DAY = 24 * 60 * 60 * 1000;
  const NOW = new Date(2026, 7, 21, 12, 0, 0).getTime();

  function stamp(at: number): string {
    const day = new Date(at);
    const two = (n: number) => String(n).padStart(2, '0');
    return `${day.getFullYear()}-${two(day.getMonth() + 1)}-${two(day.getDate())}T${two(day.getHours())}-${two(day.getMinutes())}-${two(day.getSeconds())}`;
  }

  async function session(name: string, lines: readonly string[]): Promise<void> {
    await writeFile(join(folder, name), lines.join('\n'));
  }

  it('reads the usage blocks out of the sessions in the window', async () => {
    await session(`${stamp(NOW - DAY)}_one.jsonl`, [
      JSON.stringify({ type: 'session', timestamp: new Date(NOW - DAY).toISOString() }),
      JSON.stringify({
        type: 'message',
        timestamp: new Date(NOW - DAY + 3_600_000).toISOString(),
        message: { role: 'assistant', usage: { input: 1000, output: 200, totalTokens: 1200 } },
      }),
      JSON.stringify({
        type: 'message',
        timestamp: new Date(NOW - DAY + 7_200_000).toISOString(),
        message: { role: 'assistant', usage: { input: 50, output: 50, totalTokens: 100 } },
      }),
    ]);

    const view = await readTokenUsage(folder, NOW);
    expect(view).not.toBeNull();
    expect(view!.total).toBe(1300);
    expect(view!.days.length).toBe(1);
  });

  it('adds up the parts when an old transcript reports no total', async () => {
    await session(`${stamp(NOW - 2 * DAY)}_old.jsonl`, [
      JSON.stringify({
        type: 'message',
        timestamp: new Date(NOW - 2 * DAY).toISOString(),
        message: { role: 'assistant', usage: { input: 10, output: 20, cacheRead: 30 } },
      }),
    ]);
    const view = (await readTokenUsage(folder, NOW))!;
    expect(view.total).toBe(60 + 1300);
  });

  it('leaves sessions older than the window unread', async () => {
    await session(`${stamp(NOW - 90 * DAY)}_ancient.jsonl`, [
      JSON.stringify({
        type: 'message',
        timestamp: new Date(NOW - 90 * DAY).toISOString(),
        message: { role: 'assistant', usage: { totalTokens: 999_999 } },
      }),
    ]);
    const view = (await readTokenUsage(folder, NOW))!;
    expect(view.total).toBeLessThan(999_999);
  });

  it('survives broken lines, empty files and folders that are not there', async () => {
    await session(`${stamp(NOW - 3 * DAY)}_torn.jsonl`, [
      '{"type":"message", truncated',
      '',
      'not json at all',
    ]);
    await session(`${stamp(NOW - 4 * DAY)}_empty.jsonl`, []);
    await mkdir(join(folder, 'notes'), { recursive: true });
    await writeFile(join(folder, 'notes', 'ignored.txt'), 'not a transcript');

    const view = await readTokenUsage(folder, NOW);
    expect(view).not.toBeNull();

    const missing = await readTokenUsage(join(folder, 'nowhere'), NOW);
    expect(missing).toBeNull();
  });

  it('answers null for a folder with no transcripts at all', async () => {
    const fresh = await mkdtemp(join(tmpdir(), 'graphe-notokens-'));
    try {
      expect(await readTokenUsage(fresh, NOW)).toBeNull();
    } finally {
      await rm(fresh, { recursive: true, force: true });
    }
  });
});
