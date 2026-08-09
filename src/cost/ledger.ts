/** The spend ledger: an append-only list of what money went where.
 *
 * The whole reason this file exists in the shape it does is notes/strategy/COST-DESIGN.md §3
 * — at the end of a session we show the split between work the user asked for and
 * retries caused by our own failures:
 *
 *     Today: ₹120
 *     ₹85 building what you asked for
 *     ₹35 on attempts that didn't work — mostly me retrying the contact form
 *
 * Every competitor's revenue *is* the retry, so none of them can ever ship that
 * line. It is therefore not a reporting detail here; it is the primary output of
 * this module, and `SessionSummary` is built around it rather than bolting it on.
 *
 * In memory only, by design. Persistence belongs to whatever owns the session. */

import type { LabelTotal, Money, SpendEntry, SpendReason, SpendSummary } from '../agent/types';
import { add, compare, sum, ratio, zero } from './money';

export type { LabelTotal, SpendEntry, SpendReason, SpendSummary };

/** What a caller has at the moment of recording. `id` and `at` are filled in
 *  unless the caller is replaying a stored session. */
export type SpendDraft = {
  amount: Money;
  reason: SpendReason;
  /** Plain language, in the user's own terms: 'Building the contact form'. */
  label: string;
  id?: string;
  at?: number;
};

/** What `summary()` returns. The shape itself lives in src/agent/types.ts,
 *  because the desktop shell keeps the ledger and the window is sent the
 *  result — see the note on `SpendSummary` there. */
export type SessionSummary = SpendSummary;

/** A retry has to account for at least this much of the wasted spend before we
 *  name it. Naming a 12% contributor would be technically true and misleading. */
const DOMINANT_RETRY_SHARE = 0.4;

let sequence = 0;

function newId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ?? `spend-${Date.now().toString(36)}-${(sequence += 1).toString(36)}`;
}

export class Ledger {
  readonly currency: string;
  #entries: SpendEntry[] = [];
  #listeners = new Set<(entry: SpendEntry, ledger: Ledger) => void>();

  constructor(currency: string, entries: readonly SpendDraft[] = []) {
    this.currency = currency.trim().toUpperCase();
    for (const entry of entries) this.record(entry);
  }

  record(draft: SpendDraft): SpendEntry {
    if (draft.amount.currency !== this.currency) {
      throw new TypeError(`This ledger is in ${this.currency}, not ${draft.amount.currency}`);
    }
    if (draft.amount.minor < 0) {
      throw new RangeError('Spend cannot be negative — record a refund as its own ledger');
    }
    const entry: SpendEntry = {
      id: draft.id ?? newId(),
      at: draft.at ?? Date.now(),
      amount: draft.amount,
      reason: draft.reason,
      label: draft.label,
    };
    this.#entries.push(entry);
    for (const listener of this.#listeners) listener(entry, this);
    return entry;
  }

  /** In the order recorded. Copied, so a caller cannot mutate history. */
  entries(): readonly SpendEntry[] {
    return [...this.#entries];
  }

  get size(): number {
    return this.#entries.length;
  }

  total(): Money {
    return sum(
      this.#entries.map((entry) => entry.amount),
      this.currency,
    );
  }

  totalByReason(reason: SpendReason): Money {
    return sum(
      this.#entries.filter((entry) => entry.reason === reason).map((entry) => entry.amount),
      this.currency,
    );
  }

  totalsByReason(): Record<SpendReason, Money> {
    return {
      work: this.totalByReason('work'),
      'retry-after-failure': this.totalByReason('retry-after-failure'),
    };
  }

  /** Grouped by the plain-language label, largest first. */
  byLabel(reason?: SpendReason): LabelTotal[] {
    const totals = new Map<string, LabelTotal>();
    for (const entry of this.#entries) {
      if (reason && entry.reason !== reason) continue;
      const existing = totals.get(entry.label);
      if (existing) {
        totals.set(entry.label, {
          label: entry.label,
          amount: add(existing.amount, entry.amount),
          entryCount: existing.entryCount + 1,
        });
      } else {
        totals.set(entry.label, { label: entry.label, amount: entry.amount, entryCount: 1 });
      }
    }
    return [...totals.values()].sort((a, b) => compare(b.amount, a.amount));
  }

  /** Everything the end-of-session card needs, in one pass. */
  summary(): SessionSummary {
    const total = this.total();
    const work = this.totalByReason('work');
    const retry = this.totalByReason('retry-after-failure');
    const retriesByLabel = this.byLabel('retry-after-failure');
    const biggest = retriesByLabel[0] ?? null;
    const dominant =
      biggest && ratio(biggest.amount, retry) >= DOMINANT_RETRY_SHARE ? biggest : null;

    return {
      currency: this.currency,
      total,
      work,
      retry,
      retryShare: total.minor === 0 ? 0 : ratio(retry, total),
      entryCount: this.#entries.length,
      firstAt: this.#entries[0]?.at ?? null,
      lastAt: this.#entries[this.#entries.length - 1]?.at ?? null,
      largestRetry: dominant,
    };
  }

  /** Spend recorded since a moment — for "today", or since a session started. */
  since(at: number): Ledger {
    return new Ledger(
      this.currency,
      this.#entries.filter((entry) => entry.at >= at),
    );
  }

  /** For a meter that wants to stay current. Returns its own unsubscribe. */
  subscribe(listener: (entry: SpendEntry, ledger: Ledger) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  clear(): void {
    this.#entries = [];
  }
}

/** Summarise a bare list of entries, for stored sessions that never became a
 *  live `Ledger`. */
export function summarise(entries: readonly SpendEntry[], currency: string): SessionSummary {
  return new Ledger(currency, entries).summary();
}

export function emptySummary(currency: string): SessionSummary {
  const none = zero(currency);
  return {
    currency: none.currency,
    total: none,
    work: none,
    retry: none,
    retryShare: 0,
    entryCount: 0,
    firstAt: null,
    lastAt: null,
    largestRetry: null,
  };
}
