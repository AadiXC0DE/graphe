// @vitest-environment jsdom
/** What this cost, drawn.
 *
 * Three numbers answer "am I fine?"; everything under them answers "where did
 * it go?". What is worth guarding is that the three read from the right
 * stretch (the sitting is not the day and the day is not the month), that the
 * chart draws one bar per day whether or not the day saw anything, and that
 * the two tables and the CSV all come from the same reading.
 */

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import Usage from '../src/components/Usage';
import { daysFromUsage } from '../src/lib/token-days';
import { fromMajor } from '../src/cost/money';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

const hosts: HTMLElement[] = [];
afterEach(() => {
  for (const host of hosts.splice(0)) host.remove();
});

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();
const EARLIER = NOW - 3 * DAY;
/* The fixture's older day can fall in the month before, in the first days of
   one. The three numbers are read against the same calendar the screen uses. */
const SAME_MONTH = new Date(EARLIER).getMonth() === new Date(NOW).getMonth();
const MONTH = SAME_MONTH ? 7 : 3;

const talk = (id: string, title: string) => ({ id, title, path: `/sessions/${id}.jsonl` });

const view = daysFromUsage([
  { at: NOW, tokens: 1_000, cost: 2, model: 'sonnet', input: 700, output: 100, cached: 200, conversation: talk('a', 'Tighten the review screen') },
  { at: NOW, tokens: 500, cost: 1, model: 'opus', input: 400, output: 100, cached: 0, conversation: talk('b', 'Colour and type pass') },
  { at: EARLIER, tokens: 900, cost: 4, model: 'opus', input: 800, output: 100, cached: 0, conversation: talk('b', 'Colour and type pass') },
]);

async function open(props: Partial<Parameters<typeof Usage>[0]> = {}): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.append(host);
  hosts.push(host);
  await act(async () => {
    createRoot(host).render(
      createElement(Usage, {
        open: true,
        spent: { total: fromMajor(0.75, 'USD'), split: null, usage: null },
        onClose: () => {},
        onTokens: () => Promise.resolve(view),
        ...props,
      }),
    );
  });
  return host;
}

const numbers = (host: HTMLElement): string[] =>
  [...host.querySelectorAll('.usage__number')].map(
    (one) => `${one.querySelector('strong')?.textContent ?? ''} ${one.querySelector('span')?.textContent ?? ''}`,
  );

describe('the three numbers', () => {
  it('reads the sitting from the meter and the day and month from the transcripts', async () => {
    const host = await open();
    expect(numbers(host)).toEqual([
      '$0.75 This sitting',
      '$3.00 Today',
      `$${MONTH.toFixed(2)} This month`,
    ]);
  });

  it('says the limit and how far along the month is, when one is set', async () => {
    const host = await open({
      limit: { ceiling: fromMajor(40, 'USD'), period: 'month', nudgeAt: 0.8 },
      onLimit: () => {},
    });
    expect(host.querySelector('.usage__of')?.textContent).toBe('of $40 limit');
    expect(host.querySelector<HTMLElement>('.usage__rule span')?.style.width).toBe(
      `${String((MONTH / 40) * 100)}%`,
    );
  });

  it('says nothing about a limit nobody set', async () => {
    const host = await open();
    expect(host.querySelector('.usage__of')).toBeNull();
  });
});

describe('by day', () => {
  it('draws one bar per day for thirty days, empty ones included', async () => {
    const host = await open();
    const bars = host.querySelectorAll('.usage__bar');
    expect(bars.length).toBe(30);
    // The dearest day is full height; today is three of its four.
    expect(host.querySelectorAll<HTMLElement>('.usage__barstack')[26]!.style.height).toBe('100%');
    expect(host.querySelectorAll<HTMLElement>('.usage__barstack')[29]!.style.height).toBe('75%');
    expect(host.querySelectorAll<HTMLElement>('.usage__barstack')[28]!.style.height).toBe('0%');
  });

  it('stacks the day by model, and says the day, the money and the tokens on hover', async () => {
    const host = await open();
    const today = host.querySelectorAll('.usage__bar')[29]!;
    expect(today.querySelectorAll('.usage__barstack i').length).toBe(2);
    expect(today.getAttribute('title')).toContain('$3.00');
    expect(today.getAttribute('title')).toContain('1.5k tokens');
  });
});

describe('the tables', () => {
  it('lists every model, dearest first, with what it read and what it cost', async () => {
    const host = await open();
    const rows = [...host.querySelectorAll('.usage__table tbody tr')].map((row) =>
      [...row.querySelectorAll('th, td')].map((cell) => cell.textContent),
    );
    expect(rows).toEqual([
      ['opus', '2', '1.2k', '200', '0%', '$5.00'],
      ['sonnet', '1', '700', '100', '22%', '$2.00'],
    ]);
  });

  it('lists the conversations, dearest first, and opens the one pressed', async () => {
    const opened: string[] = [];
    const host = await open({ onOpenConversation: (path) => opened.push(path) });
    expect([...host.querySelectorAll('.usage__conversationtitle')].map((one) => one.textContent)).toEqual([
      'Colour and type pass',
      'Tighten the review screen',
    ]);
    act(() => {
      host.querySelectorAll<HTMLButtonElement>('.usage__conversation')[0]!.click();
    });
    expect(opened).toEqual(['/sessions/b.jsonl']);
  });
});

describe('the rest of the sheet', () => {
  it('says the work and the retries as one line, once the sitting has settled', async () => {
    const host = await open({
      spent: {
        total: fromMajor(9.5, 'USD'),
        split: {
          currency: 'USD',
          total: fromMajor(9.5, 'USD'),
          work: fromMajor(8.4, 'USD'),
          retry: fromMajor(1.1, 'USD'),
          retryShare: 1.1 / 9.5,
          entryCount: 4,
          firstAt: null,
          lastAt: null,
          largestRetry: null,
        },
        usage: null,
      },
    });
    expect(host.querySelector('.usage__retries')?.textContent).toBe(
      'Work you asked for $8.40 · attempts that did not work $1.10',
    );
  });

  it('hands the shell a CSV of the same days', async () => {
    const written: string[] = [];
    const host = await open({ onExport: (csv) => written.push(csv) });
    act(() => {
      host.querySelector<HTMLButtonElement>('.usage__export')!.click();
    });
    expect(written[0]).toContain('Day,Model,Tokens,Cost');
    expect(written[0]).toContain(',opus,900,4.00');
  });

  it('says nothing has been spent when there is neither a sitting nor a transcript', async () => {
    const host = await open({ spent: null, onTokens: () => Promise.resolve(null) });
    expect(host.querySelector('.usage__empty')).not.toBeNull();
    expect(host.querySelector('.usage__numbers')).toBeNull();
  });
});
