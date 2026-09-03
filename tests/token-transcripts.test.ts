/** Tokens and money by day, and the reducers the cost screen reads.
 *
 * Four things are worth holding still: a day is a local day (somebody's
 * "yesterday" is not UTC's), a day carries what it cost and which models took
 * it, the conversation reducer runs over the same entries the days are folded
 * from, and the thirty-day window fills its gaps so the chart reads as a
 * calendar rather than a list of hits.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readTokenUsage } from '../electron/tokens';

import {
  byConversation,
  costInMonth,
  costOnDay,
  daysFromUsage,
  lastDays,
  saysTokens,
  spendCsv,
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
    expect(view.days.map((one) => [one.at, one.tokens])).toEqual([
      [dayAt(2026, 7, 21), 1_500],
      [dayAt(2026, 7, 22), 250],
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
    expect(view.days.map((one) => one.at)).toEqual([dayAt(2026, 7, 22)]);
    expect(view.total).toBe(40);
  });

  /** The whole point of carrying money alongside the counts: a cheap model
   *  burns a pile of tokens for a small bill, and the chart is drawn on cost. */
  it('carries what each day cost and which models took it', () => {
    const view = daysFromUsage([
      { at: MORNING, tokens: 100, cost: 0.5, model: 'sonnet' },
      { at: MORNING + 60_000, tokens: 300, cost: 1.5, model: 'opus' },
      { at: MORNING + 120_000, tokens: 100, cost: 0.25, model: 'sonnet' },
    ]);
    const day = view.days[0]!;
    expect(day.cost).toBeCloseTo(2.25);
    expect(day.models).toEqual([
      { model: 'opus', cost: 1.5, tokens: 300 },
      { model: 'sonnet', cost: 0.75, tokens: 200 },
    ]);
    expect(view.cost).toBeCloseTo(2.25);
  });

  it('leaves a day priced at nothing rather than guessing at a figure', () => {
    const view = daysFromUsage([{ at: MORNING, tokens: 100 }]);
    expect(view.days[0]!.cost).toBe(0);
    expect(view.days[0]!.models).toEqual([]);
    expect(view.cost).toBe(0);
  });

  it('adds each model up, dearest first, with the share that came from cache', () => {
    const view = daysFromUsage([
      { at: MORNING, tokens: 100, cost: 0.1, model: 'sonnet', input: 60, output: 20, cached: 20 },
      { at: MORNING + DAY, tokens: 100, cost: 0.9, model: 'opus', input: 50, output: 50, cached: 0 },
      { at: MORNING, tokens: 50, cost: 0.2, model: 'sonnet', input: 20, output: 10, cached: 20 },
    ]);
    expect(view.byModel.map((one) => one.model)).toEqual(['opus', 'sonnet']);
    const sonnet = view.byModel[1]!;
    expect(sonnet.turns).toBe(2);
    expect(sonnet.input).toBe(80);
    expect(sonnet.output).toBe(30);
    expect(sonnet.cached).toBeCloseTo(40 / 120);
    expect(view.byModel[0]!.cached).toBe(0);
  });
});

describe('byConversation', () => {
  const talk = (id: string) => ({ id, title: `talk ${id}`, path: `/sessions/${id}.jsonl` });

  it('adds a conversation up across every day it ran', () => {
    const found = byConversation([
      { at: MORNING, tokens: 100, cost: 1, conversation: talk('a') },
      { at: MORNING + DAY, tokens: 50, cost: 2, conversation: talk('a') },
      { at: MORNING, tokens: 10, cost: 5, conversation: talk('b') },
    ]);
    expect(found.map((one) => [one.id, one.turns, one.cost, one.tokens])).toEqual([
      ['b', 1, 5, 10],
      ['a', 2, 3, 150],
    ]);
    expect(found[0]!.path).toBe('/sessions/b.jsonl');
  });

  it('leaves out anything no conversation claimed', () => {
    expect(byConversation([{ at: MORNING, tokens: 100, cost: 1 }])).toEqual([]);
  });

  it('keeps only as many as a list can carry', () => {
    const many = Array.from({ length: 20 }, (_, at) => ({
      at: MORNING,
      tokens: 10,
      cost: at,
      conversation: talk(String(at)),
    }));
    const found = byConversation(many);
    expect(found.length).toBe(10);
    expect(found[0]!.id).toBe('19');
  });
});

describe('the days a chart draws', () => {
  it('fills the gaps so thirty days read as a calendar', () => {
    const days = daysFromUsage([{ at: MORNING, tokens: 999, cost: 3 }]).days;
    const drawn = lastDays(days, MORNING, 30);
    expect(drawn.length).toBe(30);
    expect(drawn[29]!.at).toBe(dayAt(2026, 7, 21));
    expect(drawn[29]!.cost).toBe(3);
    expect(drawn[0]!.at).toBe(dayAt(2026, 6, 23));
    expect(drawn[0]!.cost).toBe(0);
    expect(drawn[0]!.models).toEqual([]);
  });

  it('says what today and this month have cost', () => {
    const days = daysFromUsage([
      { at: MORNING, tokens: 10, cost: 1.5 },
      { at: MORNING - DAY, tokens: 10, cost: 2.5 },
      // The month before, which the month figure must not pick up.
      { at: new Date(2026, 6, 30, 9).getTime(), tokens: 10, cost: 99 },
    ]).days;
    expect(costOnDay(days, MORNING)).toBe(1.5);
    expect(costOnDay(days, MORNING + 5 * DAY)).toBe(0);
    expect(costInMonth(days, MORNING)).toBe(4);
  });
});

describe('spendCsv', () => {
  it('writes a row per day and model, with a header a spreadsheet reads', () => {
    const view = daysFromUsage([
      { at: MORNING, tokens: 100, cost: 1.5, model: 'sonnet' },
      { at: MORNING, tokens: 40, cost: 0.5, model: 'opus' },
      { at: MORNING + DAY, tokens: 10, cost: 0.25 },
    ]);
    expect(spendCsv(view)).toBe(
      [
        'Day,Model,Tokens,Cost',
        '2026-08-21,sonnet,100,1.50',
        '2026-08-21,opus,40,0.50',
        '2026-08-22,,10,0.25',
        '',
      ].join('\n'),
    );
  });

  it('quotes a model name with a comma in it rather than splitting the row', () => {
    const view = daysFromUsage([{ at: MORNING, tokens: 10, cost: 1, model: 'a,b' }]);
    expect(spendCsv(view)).toContain('"a,b"');
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
        timestamp: new Date(NOW - DAY).toISOString(),
        message: { role: 'user', content: [{ type: 'text', text: 'Tighten the review screen' }] },
      }),
      JSON.stringify({
        type: 'message',
        timestamp: new Date(NOW - DAY + 3_600_000).toISOString(),
        message: {
          role: 'assistant',
          model: 'anthropic/claude-sonnet-4-6-20260101',
          usage: { input: 1000, output: 200, totalTokens: 1200, cost: { total: 0.4 } },
        },
      }),
      JSON.stringify({
        type: 'message',
        timestamp: new Date(NOW - DAY + 7_200_000).toISOString(),
        message: {
          role: 'assistant',
          model: 'anthropic/claude-sonnet-4-6-20260101',
          usage: { input: 50, output: 50, totalTokens: 100, cost: { total: 0.1 } },
        },
      }),
    ]);

    const view = await readTokenUsage(folder, NOW);
    expect(view).not.toBeNull();
    expect(view!.total).toBe(1300);
    expect(view!.days.length).toBe(1);
    expect(view!.cost).toBeCloseTo(0.5);
  });

  /** The model id and the conversation's name are what the two tables under
   *  the chart are made of. */
  it('names the model shortly and the conversation the way the sidebar does', async () => {
    const view = (await readTokenUsage(folder, NOW))!;
    expect(view.byModel.map((one) => one.model)).toEqual(['claude-sonnet-4-6']);
    expect(view.byModel[0]!.turns).toBe(2);
    expect(view.byConversation[0]!.title).toBe('Tighten the review screen');
    expect(view.byConversation[0]!.id).toBe('one');
    expect(view.byConversation[0]!.path).toBe(join(folder, `${stamp(NOW - DAY)}_one.jsonl`));
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
