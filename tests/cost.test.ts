import { describe, expect, it, vi } from 'vitest';

import type { Money } from '../src/agent/types';
import * as phrasing from '../src/cost/phrasing';
import {
  Ledger,
  emptySummary,
  summarise,
  type SpendDraft,
} from '../src/cost/ledger';
import {
  TaskHistory,
  defaultWarnThreshold,
  estimateFrom,
  shouldWarn,
  type TaskObservation,
} from '../src/cost/estimate';
import {
  LimitWatcher,
  checkLimit,
  createLimit,
  projectedState,
  raiseCeiling,
  wouldExceed,
} from '../src/cost/limits';
import {
  add,
  compare,
  formatMoney,
  fromMajor,
  isZero,
  money,
  ratio,
  scale,
  subtract,
  sum,
  toMajor,
  zero,
} from '../src/cost/money';

const inr = (minor: number): Money => money(minor, 'INR');

/* ------------------------------------------------------------------ C-01 */

describe('C-01 — the language audit', () => {
  /** The four words from docs/COST-DESIGN.md, plus the product names behind
   *  "Quick" and "Careful". Substring matching for the units, word boundaries
   *  for the names so an innocent substring cannot trip the sweep. */
  const BANNED: { name: string; pattern: RegExp }[] = [
    { name: 'token', pattern: /token/i },
    { name: 'context window', pattern: /context\s*window/i },
    { name: 'compaction', pattern: /compact/i },
    { name: 'a raw model name', pattern: /\b(claude|sonnet|opus|haiku|gpt|gemini|llama|grok)\b/i },
    { name: 'a raw model name', pattern: /\b[a-z]+-(?:sonnet|opus|haiku)-?[0-9.]*\b/i },
    { name: 'a vendor name', pattern: /\b(anthropic|openai)\b/i },
  ];

  /** Every string reachable from the module's exports: the constants directly,
   *  and every function's output via the module's own sample sweep. */
  function everyString(): string[] {
    const found: string[] = [];
    const seen = new Set<unknown>();
    const walk = (value: unknown): void => {
      if (typeof value === 'string') {
        found.push(value);
        return;
      }
      if (!value || typeof value !== 'object' || seen.has(value)) return;
      seen.add(value);
      for (const child of Object.values(value)) walk(child);
    };
    walk(phrasing);
    for (const locale of [undefined, 'en-IN', 'en-US', 'ja-JP']) {
      found.push(...phrasing.auditableStrings(locale ? { locale } : {}));
    }
    return found;
  }

  it('sweeps a meaningful number of strings', () => {
    // A sweep that silently found nothing would pass every assertion below.
    expect(everyString().length).toBeGreaterThan(80);
    expect(everyString()).toContain(phrasing.longConversation.tidying);
    expect(everyString()).toContain(phrasing.connectBilling.body);
  });

  it('would notice a violation if one were written', () => {
    const violations = [
      'That used about 1,200 tokens',
      'Your context window is full',
      'Running compaction on this conversation',
      'I used claude-sonnet-5 for this one',
      'Switching to Opus for the tricky part',
    ];
    for (const text of violations) {
      expect(BANNED.some(({ pattern }) => pattern.test(text))).toBe(true);
    }
  });

  it('no string the cost module produces contains the retired jargon', () => {
    const offences: string[] = [];
    for (const text of everyString()) {
      for (const { name, pattern } of BANNED) {
        if (pattern.test(text)) offences.push(`${name} → "${text}"`);
      }
    }
    expect(offences).toEqual([]);
  });

  it('surfaces the two ways of working by feel, not by name', () => {
    expect(phrasing.workingStyle.quick.name).toBe('Quick');
    expect(phrasing.workingStyle.careful.name).toBe('Careful');
    expect(phrasing.choseStyle('careful')).toContain('Careful');
  });

  it('never blames the reader for what it cost', () => {
    const blaming = /you (should|shouldn't|must|failed|wasted|need to understand)/i;
    for (const text of everyString()) expect(text).not.toMatch(blaming);
  });
});

/* ------------------------------------------------------------------ money */

describe('money is exact', () => {
  it('does not drift across many small entries, where floats would', () => {
    const entries = Array.from({ length: 10_000 }, () => inr(7));
    expect(sum(entries).minor).toBe(70_000);

    // The same addition in the obvious floating-point way, for contrast.
    let float = 0;
    for (let i = 0; i < 10_000; i += 1) float += 0.07;
    expect(float).not.toBe(700);
    expect(toMajor(sum(entries))).toBe(700);
  });

  it('accumulates one minor unit at a time without loss', () => {
    let total = zero('INR');
    for (let i = 0; i < 100_000; i += 1) total = add(total, inr(1));
    expect(total.minor).toBe(100_000);
    expect(toMajor(total)).toBe(1000);
  });

  it('refuses fractional minor units', () => {
    expect(() => money(40.5, 'INR')).toThrow(RangeError);
    expect(() => money(Number.NaN, 'INR')).toThrow(RangeError);
  });

  it('refuses to mix currencies', () => {
    expect(() => add(inr(100), money(100, 'USD'))).toThrow(TypeError);
    expect(() => sum([inr(100), money(100, 'USD')])).toThrow(TypeError);
    expect(() => compare(inr(100), money(100, 'USD'))).toThrow(TypeError);
  });

  it('needs a currency to sum an empty list', () => {
    expect(() => sum([])).toThrow(TypeError);
    expect(sum([], 'INR')).toEqual(inr(0));
  });

  it('rounds only at the boundary where a human number comes in', () => {
    expect(fromMajor(40.25, 'INR').minor).toBe(4025);
    expect(fromMajor(0.1 + 0.2, 'INR').minor).toBe(30);
    // Halves go away from zero, so a refund rounds the same distance as a charge.
    expect(fromMajor(0.125, 'INR').minor).toBe(13);
    expect(fromMajor(-0.125, 'INR').minor).toBe(-13);
    expect(fromMajor(1240, 'JPY').minor).toBe(1240);
  });

  it('scales back to whole minor units immediately', () => {
    expect(scale(inr(333), 1 / 3).minor).toBe(111);
    expect(scale(inr(100), 1.155, 'up').minor).toBe(116);
    expect(scale(inr(100), 1.155, 'down').minor).toBe(115);
  });

  it('subtracts, compares and reports zero', () => {
    expect(subtract(inr(500), inr(200))).toEqual(inr(300));
    expect(compare(inr(500), inr(200))).toBeGreaterThan(0);
    expect(isZero(subtract(inr(500), inr(500)))).toBe(true);
    expect(ratio(inr(1600), inr(2000))).toBeCloseTo(0.8);
  });
});

describe('money reads at a glance', () => {
  it('formats the way the design doc writes it', () => {
    expect(formatMoney(inr(40), { locale: 'en-IN' })).toBe('₹0.40');
    expect(formatMoney(inr(1800), { locale: 'en-IN' })).toBe('₹18');
    expect(formatMoney(inr(124_000), { locale: 'en-IN' })).toBe('₹1,240');
    expect(formatMoney(inr(0), { locale: 'en-IN' })).toBe('₹0');
  });

  it('never shows the four-decimal-place version', () => {
    expect(formatMoney(inr(1804), { locale: 'en-IN' })).toBe('₹18');
    expect(formatMoney(inr(1804), { locale: 'en-IN', exact: true })).toBe('₹18.04');
  });

  it('respects currencies with no minor unit', () => {
    expect(formatMoney(money(1240, 'JPY'), { locale: 'ja-JP' })).not.toContain('.');
    expect(formatMoney(money(250, 'USD'), { locale: 'en-US' })).toBe('$2.50');
  });

  it('rejects anything that is not an ISO currency code', () => {
    expect(() => money(1, 'rupees')).toThrow(TypeError);
  });
});

/* ----------------------------------------------------------------- ledger */

describe('the ledger splits work from our own retries', () => {
  const session = (): Ledger => {
    const ledger = new Ledger('INR');
    const entries: SpendDraft[] = [
      { amount: inr(5000), reason: 'work', label: 'Building the contact form', at: 1 },
      { amount: inr(2000), reason: 'work', label: 'Styling the header', at: 2 },
      { amount: inr(1500), reason: 'work', label: 'Publishing', at: 3 },
      { amount: inr(2500), reason: 'retry-after-failure', label: 'Building the contact form', at: 4 },
      { amount: inr(1000), reason: 'retry-after-failure', label: 'Styling the header', at: 5 },
    ];
    for (const entry of entries) ledger.record(entry);
    return ledger;
  };

  it('totals the two reasons separately and they add back to the whole', () => {
    const summary = session().summary();
    expect(summary.total).toEqual(inr(12_000));
    expect(summary.work).toEqual(inr(8500));
    expect(summary.retry).toEqual(inr(3500));
    expect(add(summary.work, summary.retry)).toEqual(summary.total);
    expect(summary.retryShare).toBeCloseTo(3500 / 12_000);
    expect(summary.entryCount).toBe(5);
  });

  it('names the retry that dominates', () => {
    expect(session().summary().largestRetry?.label).toBe('Building the contact form');
    expect(session().summary().largestRetry?.amount).toEqual(inr(2500));
  });

  it('names nothing when the waste is spread evenly', () => {
    const ledger = new Ledger('INR');
    ledger.record({ amount: inr(100), reason: 'retry-after-failure', label: 'One' });
    ledger.record({ amount: inr(100), reason: 'retry-after-failure', label: 'Two' });
    ledger.record({ amount: inr(100), reason: 'retry-after-failure', label: 'Three' });
    expect(ledger.summary().largestRetry).toBeNull();
  });

  it('groups by label, largest first', () => {
    expect(session().byLabel('work')[0]?.label).toBe('Building the contact form');
    expect(session().byLabel()[0]?.amount).toEqual(inr(7500));
  });

  it('handles a session where nothing has been spent yet', () => {
    const summary = new Ledger('INR').summary();
    expect(summary).toEqual(emptySummary('INR'));
    expect(summary.retryShare).toBe(0);
    expect(summary.largestRetry).toBeNull();
  });

  it('handles a session with no failures at all', () => {
    const ledger = new Ledger('INR');
    ledger.record({ amount: inr(8500), reason: 'work', label: 'Building the contact form' });
    const summary = ledger.summary();
    expect(summary.retry).toEqual(inr(0));
    expect(summary.retryShare).toBe(0);
    expect(phrasing.sessionSummary(summary).retry).toContain('Nothing went on attempts');
  });

  it('slices by time without recomputing anything by hand', () => {
    expect(session().since(4).summary().total).toEqual(inr(3500));
    expect(session().since(4).summary().work).toEqual(inr(0));
  });

  it('tells a live meter when something is recorded', () => {
    const ledger = new Ledger('INR');
    const listener = vi.fn();
    const unsubscribe = ledger.subscribe(listener);
    ledger.record({ amount: inr(10), reason: 'work', label: 'A tweak' });
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    ledger.record({ amount: inr(10), reason: 'work', label: 'Another tweak' });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('rejects a foreign currency or a negative charge', () => {
    const ledger = new Ledger('INR');
    expect(() => ledger.record({ amount: money(1, 'USD'), reason: 'work', label: 'x' })).toThrow(
      TypeError,
    );
    expect(() => ledger.record({ amount: inr(-1), reason: 'work', label: 'x' })).toThrow(RangeError);
  });

  it('summarises stored entries that never became a live ledger', () => {
    const stored = session().entries();
    expect(summarise(stored, 'INR')).toEqual(session().summary());
  });

  it('produces the three lines from the design doc', () => {
    const lines = phrasing.sessionSummary(session().summary(), { locale: 'en-IN' });
    expect(lines.headline).toBe('Today: ₹120');
    expect(lines.work).toBe('₹85 building what you asked for');
    expect(lines.retry).toBe(
      '₹35 on attempts that didn’t work — mostly me retrying building the contact form',
    );
  });
});

/* --------------------------------------------------------------- estimate */

describe('estimating before, not billing after', () => {
  const task = { kind: 'contact-form', size: 'feature' } as const;
  const observation = (minor: number, at: number): TaskObservation => ({
    ...task,
    cost: inr(minor),
    durationMs: 4 * 60_000,
    at,
  });

  it('admits when it has no history to work from', () => {
    const estimate = estimateFrom([], task, 'INR');
    expect(estimate.confidence).toBe('no-history');
    expect(estimate.sampleSize).toBe(0);
    expect(estimate.expected).toEqual(fromMajor(45, 'INR'));
    expect(compare(estimate.high, estimate.expected)).toBeGreaterThan(0);
    expect(compare(estimate.low, estimate.expected)).toBeLessThan(0);
  });

  it('does not flip to confident on a single observation', () => {
    const estimate = estimateFrom([observation(1000, 1)], task, 'INR');
    expect(estimate.confidence).toBe('few-examples');
    // Blended: pulled towards the one measurement, but not all the way.
    expect(estimate.expected.minor).toBeLessThan(4500);
    expect(estimate.expected.minor).toBeGreaterThan(1000);
  });

  it('settles on the measured middle once there are enough of them', () => {
    const history = [1000, 1100, 1200, 1300, 1400, 1500].map((minor, i) =>
      observation(minor, i + 1),
    );
    const estimate = estimateFrom(history, task, 'INR');
    expect(estimate.confidence).toBe('measured');
    expect(estimate.sampleSize).toBe(6);
    expect(estimate.expected).toEqual(inr(1300));
    expect(compare(estimate.low, estimate.expected)).toBeLessThanOrEqual(0);
    expect(compare(estimate.high, estimate.expected)).toBeGreaterThan(0);
    expect(estimate.expectedDurationMs).toBe(4 * 60_000);
  });

  it('falls back to jobs of a similar size when the kind is new', () => {
    const history = [1000, 1100, 1200, 1300, 1400].map((minor, i) => observation(minor, i + 1));
    const estimate = estimateFrom(history, { kind: 'newsletter-signup', size: 'feature' }, 'INR');
    expect(estimate.confidence).toBe('measured');
    expect(estimate.sampleSize).toBe(5);
  });

  it('forgets old prices beyond the window', () => {
    const history = [
      ...Array.from({ length: 20 }, (_, i) => observation(9000, i + 1)),
      ...Array.from({ length: 20 }, (_, i) => observation(1000, i + 21)),
    ];
    expect(estimateFrom(history, task, 'INR', { window: 20 }).expected).toEqual(inr(1000));
  });

  it('starts from the ₹20 threshold the design doc names', () => {
    expect(defaultWarnThreshold('INR')).toEqual(inr(2000));
    expect(defaultWarnThreshold('inr')).toEqual(inr(2000));
  });

  it('asks before a bigger job and stays quiet for a small one', () => {
    const history = new TaskHistory('INR');
    for (let i = 0; i < 6; i += 1) {
      history.record({ kind: 'tweak-spacing', size: 'tweak', cost: inr(40), durationMs: 15_000, at: i });
      history.record({
        kind: 'contact-form',
        size: 'feature',
        cost: inr(3500),
        durationMs: 4 * 60_000,
        at: i,
      });
    }
    const small = history.plan({ kind: 'tweak-spacing', size: 'tweak' });
    const big = history.plan({ kind: 'contact-form', size: 'feature' });
    expect(small.warn).toBe(false);
    expect(big.warn).toBe(true);
    expect(phrasing.biggerJob(big.estimate, { locale: 'en-IN' }).body).toBe(
      'About ₹35 and roughly four minutes. Want me to go ahead?',
    );
  });

  it('leans on the top of the band while it is still guessing', () => {
    const guess = estimateFrom([], { kind: 'unseen', size: 'page' }, 'INR');
    // Expected ₹18, band up to ₹45. Below the quoted number but inside the band,
    // an unmeasured estimate still asks — being wrong the other way is worse.
    expect(shouldWarn(guess, inr(2500))).toBe(true);

    const measured = estimateFrom(
      Array.from({ length: 6 }, (_, i) => ({
        kind: 'page',
        size: 'page' as const,
        cost: inr(1800),
        at: i,
      })),
      { kind: 'page', size: 'page' },
      'INR',
    );
    expect(measured.confidence).toBe('measured');
    expect(shouldWarn(measured, inr(2500))).toBe(false);
    expect(shouldWarn(measured, inr(1800))).toBe(true);
  });

  it('refuses to compare across currencies', () => {
    const estimate = estimateFrom([], task, 'INR');
    expect(() => shouldWarn(estimate, money(100, 'USD'))).toThrow(TypeError);
  });

  it('accepts measured bands in place of the built-in guesses', () => {
    const estimate = estimateFrom([], task, 'INR', {
      coldStart: { feature: { low: 5, expected: 10, high: 20 } },
    });
    expect(estimate.expected).toEqual(inr(1000));
  });
});

/* ----------------------------------------------------------------- limits */

describe('a ceiling the user set', () => {
  const limit = createLimit(fromMajor(2000, 'INR'), 'month');

  it('moves ok → nudge → stop at the right places', () => {
    expect(checkLimit(limit, fromMajor(1599.99, 'INR')).state).toBe('ok');
    expect(checkLimit(limit, fromMajor(1600, 'INR')).state).toBe('nudge');
    expect(checkLimit(limit, fromMajor(1999.99, 'INR')).state).toBe('nudge');
    expect(checkLimit(limit, fromMajor(2000, 'INR')).state).toBe('stop');
    expect(checkLimit(limit, fromMajor(2500, 'INR')).state).toBe('stop');
  });

  it('reports what is left without ever going negative', () => {
    const over = checkLimit(limit, fromMajor(2500, 'INR'));
    expect(over.remaining).toEqual(zero('INR'));
    expect(over.over).toEqual(fromMajor(500, 'INR'));
    expect(checkLimit(limit, fromMajor(1500, 'INR')).remaining).toEqual(fromMajor(500, 'INR'));
    expect(checkLimit(limit, fromMajor(1600, 'INR')).fraction).toBeCloseTo(0.8);
  });

  it('stops new work at the ceiling and never abandons what is running', () => {
    for (const spent of [0, 1600, 2000, 5000]) {
      const status = checkLimit(limit, fromMajor(spent, 'INR'));
      expect(status.preservesWorkInFlight).toBe(true);
      expect(status.allowsNewWork).toBe(status.state !== 'stop');
    }
  });

  it('says the nudge once, not on every tick', () => {
    const watcher = new LimitWatcher(limit);
    expect(watcher.update(fromMajor(100, 'INR')).announce).toBe(false);
    expect(watcher.update(fromMajor(1600, 'INR')).announce).toBe(true);
    expect(watcher.update(fromMajor(1700, 'INR')).announce).toBe(false);
    expect(watcher.update(fromMajor(1800, 'INR')).announce).toBe(false);
    const stopped = watcher.update(fromMajor(2000, 'INR'));
    expect(stopped.announce).toBe(true);
    expect(stopped.previousState).toBe('nudge');
    expect(watcher.update(fromMajor(2100, 'INR')).announce).toBe(false);
  });

  it('re-arms both warnings when the ceiling is raised', () => {
    const watcher = new LimitWatcher(limit);
    watcher.update(fromMajor(2000, 'INR'));
    watcher.raiseTo(fromMajor(4000, 'INR'));
    expect(watcher.limit.ceiling).toEqual(fromMajor(4000, 'INR'));
    expect(watcher.update(fromMajor(2000, 'INR')).announce).toBe(false);
    expect(watcher.update(fromMajor(3200, 'INR')).announce).toBe(true);
  });

  it('checks a job against the ceiling before starting it', () => {
    const spent = fromMajor(1900, 'INR');
    expect(wouldExceed(limit, spent, fromMajor(50, 'INR'))).toBe(false);
    expect(wouldExceed(limit, spent, fromMajor(200, 'INR'))).toBe(true);
    expect(projectedState(limit, spent, fromMajor(200, 'INR'))).toBe('stop');
    expect(projectedState(limit, fromMajor(100, 'INR'), fromMajor(200, 'INR'))).toBe('ok');
  });

  it('rejects a nonsensical limit', () => {
    expect(() => createLimit(zero('INR'))).toThrow(RangeError);
    expect(() => createLimit(fromMajor(10, 'INR'), 'month', 1.5)).toThrow(RangeError);
    expect(() => raiseCeiling(limit, fromMajor(10, 'INR'))).toThrow(RangeError);
    expect(() => checkLimit(limit, money(100, 'USD'))).toThrow(TypeError);
  });

  it('explains the ceiling in money and in plain words', () => {
    const nudge = phrasing.limitNudge(checkLimit(limit, fromMajor(1600, 'INR')), {
      locale: 'en-IN',
    });
    expect(nudge).toContain('₹1,600');
    expect(nudge).toContain('₹2,000');
    expect(nudge).toContain('this month');

    const reached = phrasing.limitReached(checkLimit(limit, fromMajor(2000, 'INR')), {
      locale: 'en-IN',
    });
    expect(reached.body).toContain('nothing is left half-done');
    expect(reached.confirm).toBe('Raise the limit');
  });
});

/* ------------------------------------------------------------- end to end */

describe('a session, start to finish', () => {
  it('meters, warns, stops, and accounts for itself', () => {
    const ledger = new Ledger('INR');
    const history = new TaskHistory('INR');
    const watcher = new LimitWatcher(createLimit(fromMajor(100, 'INR'), 'session'));

    for (let i = 0; i < 6; i += 1) {
      history.record({ kind: 'contact-form', size: 'feature', cost: inr(3500), at: i });
    }

    const plan = history.plan({ kind: 'contact-form', size: 'feature' });
    expect(plan.warn).toBe(true);
    expect(phrasing.biggerJob(plan.estimate).title).toBe('This is a bigger job');

    ledger.record({ amount: inr(2500), reason: 'work', label: 'Building the contact form' });
    ledger.record({
      amount: inr(1200),
      reason: 'retry-after-failure',
      label: 'Building the contact form',
    });
    expect(watcher.update(ledger.total()).status.state).toBe('ok');

    ledger.record({ amount: inr(4500), reason: 'work', label: 'Building the contact form' });
    expect(watcher.update(ledger.total()).status.state).toBe('nudge');

    ledger.record({ amount: inr(1900), reason: 'work', label: 'Publishing' });
    const final = watcher.update(ledger.total());
    expect(final.status.state).toBe('stop');
    expect(final.status.allowsNewWork).toBe(false);
    expect(final.status.preservesWorkInFlight).toBe(true);

    const summary = ledger.summary();
    expect(summary.total).toEqual(inr(10_100));
    expect(add(summary.work, summary.retry)).toEqual(summary.total);
    expect(phrasing.sessionSummary(summary, { locale: 'en-IN' }).lines).toHaveLength(3);
  });
});
