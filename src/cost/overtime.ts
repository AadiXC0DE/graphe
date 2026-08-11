/** What it cost beyond this sitting: by project, and by month.
 *
 * The split between the work somebody asked for and our own retries is the one
 * number a metered competitor can never print, so it is carried the whole way
 * up rather than collapsed into a single figure at the top.
 *
 * Two currencies are never added together. They are grouped and reported side
 * by side, because a single number made of both would be a lie that looks tidy.
 *
 * Pure: `now` is passed in, the clock is never read here.
 */

import type { Money, SpendReason, SpendSummary } from '../agent/types';
import { money } from './money';

/** One thing that was paid for, flat enough to have been stored and read back. */
export type Spend = {
  /** Epoch ms. */
  at: number;
  /** The folder the work happened in. */
  project: string;
  /** Smallest unit of the currency, whole. */
  minor: number;
  currency: string;
  reason: SpendReason;
};

/** Any total, always carrying the split. */
export type Split = {
  total: Money;
  /** What was asked for. */
  work: Money;
  /** What our own failed attempts cost. */
  retry: Money;
  /** `retry` over `total`, 0 when nothing was spent. */
  retryShare: number;
  entryCount: number;
};

export type ProjectTotal = Split & {
  /** The folder itself, for looking it up again. */
  project: string;
  /** What that folder is called, for a heading. */
  name: string;
  firstAt: number;
  lastAt: number;
};

export type MonthTotal = Split & {
  /** Sortable and never shown: `2026-08`. */
  key: string;
  /** What a person calls it: `August 2026`. */
  name: string;
  /** The month the given moment falls in. */
  current: boolean;
};

export type CurrencyTotals = {
  currency: string;
  overall: Split;
  /** Most spent first. */
  byProject: readonly ProjectTotal[];
  /** Most recent first. */
  byMonth: readonly MonthTotal[];
};

export type OverTime = {
  /** One per currency, most spent first. Never added across. */
  currencies: readonly CurrencyTotals[];
  /** The one a single figure should show, or null when nothing was spent. */
  main: CurrencyTotals | null;
  /** More than one currency appeared, so a single figure would be wrong. */
  mixed: boolean;
  /** Entries too damaged to count towards anything. */
  skipped: number;
};

export type OverTimeOptions = {
  /** Epoch ms. Decides which month counts as the current one. */
  now: number;
  /** IANA zone. Left off, the machine's own — a month should end when the
   *  person's month ends, not at midnight somewhere else. */
  timeZone?: string;
  /** BCP 47 tag, for the month names. */
  locale?: string;
};

/** A folder with nothing to call it still needs a heading. */
const NO_PROJECT = 'Elsewhere';

function nameOf(project: string): string {
  const trimmed = project.trim().replace(/[/\\]+$/, '');
  if (trimmed === '') return NO_PROJECT;
  const last = trimmed.split(/[/\\]+/).pop() ?? '';
  return last === '' ? NO_PROJECT : last;
}

function usable(entry: Spend): boolean {
  return (
    Number.isFinite(entry.at) &&
    Number.isSafeInteger(entry.minor) &&
    entry.minor >= 0 &&
    /^[A-Za-z]{3}$/.test((entry.currency ?? '').trim()) &&
    (entry.reason === 'work' || entry.reason === 'retry-after-failure')
  );
}

/** Adds up in plain integers, and becomes money once at the end. */
type Tally = { total: number; work: number; retry: number; count: number };

function tally(): Tally {
  return { total: 0, work: 0, retry: 0, count: 0 };
}

function count(into: Tally, minor: number, reason: SpendReason): void {
  into.total += minor;
  if (reason === 'retry-after-failure') into.retry += minor;
  else into.work += minor;
  into.count += 1;
}

function settle(counted: Tally, currency: string): Split {
  return {
    total: money(counted.total, currency),
    work: money(counted.work, currency),
    retry: money(counted.retry, currency),
    retryShare: counted.total === 0 ? 0 : counted.retry / counted.total,
    entryCount: counted.count,
  };
}

/** `2026-08`, in the zone the person lives in. */
export function monthKey(at: number, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date(at));
  const year = parts.find((part) => part.type === 'year')?.value ?? '0000';
  const month = parts.find((part) => part.type === 'month')?.value ?? '01';
  return `${year}-${month}`;
}

function monthName(at: number, options: OverTimeOptions): string {
  return new Intl.DateTimeFormat(options.locale, {
    timeZone: options.timeZone,
    year: 'numeric',
    month: 'long',
  }).format(new Date(at));
}

type MonthWork = { key: string; at: number; counted: Tally };
type ProjectWork = { project: string; first: number; last: number; counted: Tally };

type CurrencyWork = {
  currency: string;
  counted: Tally;
  months: Map<string, MonthWork>;
  projects: Map<string, ProjectWork>;
};

/**
 * Everything the longer views need, in one pass over the entries.
 *
 * Damaged entries are dropped and counted rather than thrown over: a total that
 * refuses to appear because one stored row is malformed helps nobody.
 */
export function spendOverTime(
  entries: readonly Spend[],
  options: OverTimeOptions,
): OverTime {
  const byCurrency = new Map<string, CurrencyWork>();
  let skipped = 0;

  for (const entry of entries) {
    if (!usable(entry)) {
      skipped += 1;
      continue;
    }

    const currency = entry.currency.trim().toUpperCase();
    let work = byCurrency.get(currency);
    if (work === undefined) {
      work = { currency, counted: tally(), months: new Map(), projects: new Map() };
      byCurrency.set(currency, work);
    }
    count(work.counted, entry.minor, entry.reason);

    const key = monthKey(entry.at, options.timeZone);
    const month = work.months.get(key);
    if (month === undefined) {
      const started = tally();
      count(started, entry.minor, entry.reason);
      work.months.set(key, { key, at: entry.at, counted: started });
    } else {
      count(month.counted, entry.minor, entry.reason);
      month.at = Math.min(month.at, entry.at);
    }

    const project = (entry.project ?? '').trim();
    const seen = work.projects.get(project);
    if (seen === undefined) {
      const started = tally();
      count(started, entry.minor, entry.reason);
      work.projects.set(project, {
        project,
        first: entry.at,
        last: entry.at,
        counted: started,
      });
    } else {
      count(seen.counted, entry.minor, entry.reason);
      seen.first = Math.min(seen.first, entry.at);
      seen.last = Math.max(seen.last, entry.at);
    }
  }

  const thisMonth = monthKey(options.now, options.timeZone);

  const currencies = [...byCurrency.values()]
    .map((work): CurrencyTotals => {
      const byMonth = [...work.months.values()]
        .sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0))
        .map((month) => ({
          ...settle(month.counted, work.currency),
          key: month.key,
          name: monthName(month.at, options),
          current: month.key === thisMonth,
        }));

      const byProject = [...work.projects.values()]
        .map((project) => ({
          ...settle(project.counted, work.currency),
          project: project.project,
          name: nameOf(project.project),
          firstAt: project.first,
          lastAt: project.last,
        }))
        .sort(
          (a, b) =>
            b.total.minor - a.total.minor ||
            a.name.localeCompare(b.name) ||
            a.project.localeCompare(b.project),
        );

      return { currency: work.currency, overall: settle(work.counted, work.currency), byMonth, byProject };
    })
    .sort((a, b) => b.overall.total.minor - a.overall.total.minor || a.currency.localeCompare(b.currency));

  return {
    currencies,
    main: currencies[0] ?? null,
    mixed: currencies.length > 1,
    skipped,
  };
}

/** One project's totals, or null when nothing was spent there. */
export function forProject(totals: CurrencyTotals, project: string): ProjectTotal | null {
  const wanted = project.trim().replace(/[/\\]+$/, '');
  return (
    totals.byProject.find(
      (one) => one.project === project || one.project.replace(/[/\\]+$/, '') === wanted,
    ) ?? null
  );
}

/**
 * A longer total, in the shape the end-of-sitting card already speaks.
 *
 * Lets a month or a project be described by the same sentences as a sitting,
 * so the split is worded one way everywhere.
 */
export function asSummary(split: Split, extra: { firstAt?: number; lastAt?: number } = {}): SpendSummary {
  return {
    currency: split.total.currency,
    total: split.total,
    work: split.work,
    retry: split.retry,
    retryShare: split.retryShare,
    entryCount: split.entryCount,
    firstAt: extra.firstAt ?? null,
    lastAt: extra.lastAt ?? null,
    largestRetry: null,
  };
}
