/** What a stretch of work cost, read out of Pi and turned into money here.
 *
 * ## Pi already prices everything, so we do not
 *
 * This is the whole reason this file is forty lines instead of a price table.
 * Every model in Pi's catalog carries `cost` — per-million-token rates for
 * input, output, cache reads and cache writes, plus request-wide tiers — and
 * every provider calls `calculateCost(model, usage)` as the response finishes,
 * writing the result onto `usage.cost` of the assistant message it emits. Pi's
 * own footer and `/session` read exactly that. So the price of a turn arrives
 * already worked out, from the same catalog Pi bills against, and a table of
 * our own would be a second source of truth that goes stale the week a vendor
 * changes a price (notes/strategy/REUSE-PI.md — do not rebuild what Pi gives us).
 *
 * What we add is the part Pi has no opinion about: money as an exact integer,
 * and a vocabulary with no unit in it that a designer has never heard of.
 *
 * ## Where the unit stops
 *
 * Here. `priceOfPiMessage` is the last function in the codebase that reads
 * anything counted rather than paid, and it returns a currency amount. Nothing
 * downstream — not `AgentEvent`, not the IPC bridge, not the window — is given
 * a number it could accidentally render as anything but money
 * (notes/strategy/COST-DESIGN.md §1).
 *
 * ## The currency
 *
 * Pi's catalogs quote in US dollars, so that is what comes out of here, and
 * there is no exchange rate anywhere in this codebase. Showing an Indian
 * designer their spend in rupees means a real rate from somewhere real; making
 * one up would be worse than showing dollars, because a wrong number in a
 * familiar currency is trusted and a right one in an unfamiliar currency is
 * merely inconvenient. `Purse` takes the currency as a parameter so the day a
 * rate exists this file changes and nothing else does.
 *
 * ## Fractions of a penny
 *
 * A single turn often costs less than one minor unit — a third of a cent is
 * ordinary. Rounding each turn to the nearest whole unit would report zero for
 * most of them and lose the lot: a hundred third-of-a-cent turns are a real 33
 * cents that the meter would never show. So `Purse` keeps the remainder and
 * pays it out as soon as it adds up to a whole unit. Nothing is rounded away,
 * nothing is invented, and the money the user sees is never more than one minor
 * unit behind what has actually been billed.
 */

import type { Money, SpendReason } from '../types';
import { minorUnitExponent, money } from '../../cost/money';

/** Pi's model catalogs price in US dollars. */
export const PI_CURRENCY = 'USD';

type Fields = Readonly<Record<string, unknown>>;

function fieldsOf(value: unknown): Fields | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Fields;
}

/** A finite, positive number, or null. Pi has shipped `null`, `undefined` and
 *  `NaN` here at various times when a provider reported no usage at all. */
function positiveAt(source: Fields, key: string): number | null {
  const value = source[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return value;
}

/**
 * What Pi says this message cost, in whole currency units, or null.
 *
 * Read structurally, like everything else in this folder: Pi is pre-1.0 and the
 * shape of a payload is the thing worth failing on, not the name of a type that
 * moved (see the note at the top of events.ts). Only the assistant's own
 * messages are priced — tool results can carry a usage block of their own, but
 * it is not part of what the model was billed for and counting it would inflate
 * every number the user sees.
 */
export function priceOfPiMessage(event: unknown): number | null {
  const usage = usageOfPiMessage(event);
  return usage?.costTotal ?? null;
}

/** What Pi reported on one assistant turn — tokens and cost, still internal.
 *  Nothing here crosses into the window as a count; only ratios and money do. */
export type PiTurnUsage = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** Whole currency units, same as priceOfPiMessage. */
  costTotal: number | null;
  /** Provider id, when Pi named one. */
  provider: string | null;
  /** Model id, when Pi named one. */
  model: string | null;
};

/** Non-negative finite number, or 0. Usage blocks sometimes ship 0 rather than
 *  omitting a field, and both mean the same thing to us. */
function countAt(source: Fields, key: string): number {
  const value = source[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0;
  return value;
}

/**
 * The usage block on an assistant message, read the same way as the price.
 *
 * Pi's own shape (see SessionStats / UsageTotals): `input`, `output`,
 * `cacheRead`, `cacheWrite`, and `cost.total`. Providers that do not support
 * prompt caching leave the cache fields at 0 forever — that is how we know not
 * to claim a hit rate.
 */
export function usageOfPiMessage(event: unknown): PiTurnUsage | null {
  const source = fieldsOf(event);
  if (source === null) return null;
  const message = fieldsOf(source['message']);
  if (message === null || message['role'] !== 'assistant') return null;
  const usage = fieldsOf(message['usage']);
  if (usage === null) return null;
  const cost = fieldsOf(usage['cost']);
  const provider =
    typeof message['provider'] === 'string' && message['provider'] !== ''
      ? message['provider']
      : null;
  const modelRaw =
    (typeof message['responseModel'] === 'string' && message['responseModel'] !== ''
      ? message['responseModel']
      : null) ??
    (typeof message['model'] === 'string' && message['model'] !== '' ? message['model'] : null);
  return {
    input: countAt(usage, 'input'),
    output: countAt(usage, 'output'),
    cacheRead: countAt(usage, 'cacheRead'),
    cacheWrite: countAt(usage, 'cacheWrite'),
    costTotal: cost === null ? null : positiveAt(cost, 'total'),
    provider,
    model: modelRaw,
  };
}

/** How much of the prompt was served from cache, 0–1, or null when the provider
 *  never reported any caching at all (so a 0 would be a lie). */
export function cacheHitShare(usage: {
  input: number;
  cacheRead: number;
  cacheWrite: number;
}): number | null {
  const prompt = usage.input + usage.cacheRead + usage.cacheWrite;
  if (prompt <= 0) return null;
  if (usage.cacheRead <= 0 && usage.cacheWrite <= 0) return null;
  return Math.min(1, Math.max(0, usage.cacheRead / prompt));
}

/** A model id shortened for a person: drop provider prefixes and date tails. */
export function shortModelName(model: string): string {
  const trimmed = model.trim();
  if (trimmed === '') return trimmed;
  const last = trimmed.split(/[/:]/).pop() ?? trimmed;
  return last.replace(/-\d{8}$/, '').replace(/-\d{4}-\d{2}-\d{2}$/, '');
}

/**
 * Turns prices into money, exactly, keeping what does not yet add up to a coin.
 *
 * One purse per session. The remainder is kept per reason so that a fraction of
 * a cent spent on a retry can never be paid out as work, which would quietly
 * flatter us in the one number COST-DESIGN §3 exists to keep honest.
 */
export class Purse {
  readonly currency: string;
  readonly #exponent: number;
  readonly #owed = new Map<SpendReason, number>();
  #chargedMajor = 0;

  constructor(currency: string = PI_CURRENCY) {
    this.currency = currency.trim().toUpperCase();
    this.#exponent = minorUnitExponent(this.currency);
  }

  /** Everything ever handed in, whether or not it has been paid out yet. Used
   *  to reconcile against Pi's own total for the session. */
  get chargedMajor(): number {
    return this.#chargedMajor;
  }

  /** What is still owed but too small to pay, in minor units. Display is not
   *  its purpose — it exists so a test can prove nothing is being dropped. */
  outstandingMinor(): number {
    let total = 0;
    for (const part of this.#owed.values()) total += part;
    return total;
  }

  /**
   * Hand in what a stretch of work cost. Returns whole minor units when there
   * are any to pay out, and null when it all went into the remainder.
   */
  take(major: number, reason: SpendReason): Money | null {
    if (!Number.isFinite(major) || major <= 0) return null;
    this.#chargedMajor += major;

    const owed = (this.#owed.get(reason) ?? 0) + major * 10 ** this.#exponent;
    const whole = Math.floor(owed);
    this.#owed.set(reason, owed - whole);
    return whole >= 1 ? money(whole, this.currency) : null;
  }
}
