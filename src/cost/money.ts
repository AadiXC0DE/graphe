/** Money, held as whole units of the smallest denomination a currency has.
 *
 * Everything the user ever sees about cost is money — see notes/strategy/COST-DESIGN.md §1.
 * That makes the arithmetic underneath load-bearing, and floats are the wrong
 * tool for it: 0.1 + 0.2 is not 0.3, and a meter that ticks up a few hundred
 * times in a session would drift visibly inside an afternoon.
 *
 * So: integers in, integers all the way through, and exactly one division at the
 * very end, purely to hand a number to Intl for display.
 *
 * The display rounding is deliberately coarse. ₹0.40 for a small change, ₹18 for
 * a page, ₹1,240 for a month — never ₹18.0473. Four decimal places are not more
 * honest, they are just harder to read, and the point of the number is that it
 * can be understood at a glance without stopping what you were doing. */

import type { Money } from '../agent/types';

export type { Money };

/** Currencies whose smallest unit is not 1/100. Everything unlisted is 2. */
const MINOR_UNIT_EXPONENTS: Readonly<Record<string, number>> = {
  BHD: 3,
  IQD: 3,
  JOD: 3,
  KWD: 3,
  LYD: 3,
  OMR: 3,
  TND: 3,
  BIF: 0,
  CLP: 0,
  DJF: 0,
  GNF: 0,
  ISK: 0,
  JPY: 0,
  KMF: 0,
  KRW: 0,
  PYG: 0,
  RWF: 0,
  UGX: 0,
  VND: 0,
  VUV: 0,
  XAF: 0,
  XOF: 0,
  XPF: 0,
};

/** How many decimal places this currency's smallest unit represents. */
export function minorUnitExponent(currency: string): number {
  return MINOR_UNIT_EXPONENTS[normaliseCurrency(currency)] ?? 2;
}

export function normaliseCurrency(currency: string): string {
  const code = currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) {
    throw new TypeError(`Expected a three-letter ISO 4217 currency code, got "${currency}"`);
  }
  return code;
}

/** The constructor. Rejects anything that is not a whole, safe integer, because
 *  a fractional minor unit is always a float that leaked in from somewhere. */
export function money(minor: number, currency: string): Money {
  if (!Number.isSafeInteger(minor)) {
    throw new RangeError(`Money must be a whole number of minor units, got ${minor}`);
  }
  return { minor, currency: normaliseCurrency(currency) };
}

export function zero(currency: string): Money {
  return money(0, currency);
}

/** The one place a float is allowed to become money: reading a figure a human
 *  typed or a config file holds. Rounds half away from zero. */
export function fromMajor(major: number, currency: string): Money {
  if (!Number.isFinite(major)) {
    throw new RangeError(`Expected a finite amount, got ${major}`);
  }
  const scale = 10 ** minorUnitExponent(currency);
  const scaled = major * scale;
  const rounded = scaled < 0 ? -Math.round(-scaled) : Math.round(scaled);
  return money(rounded, currency);
}

/** Display and analytics only. Never feed the result back into arithmetic. */
export function toMajor(amount: Money): number {
  return amount.minor / 10 ** minorUnitExponent(amount.currency);
}

function assertCurrency(amount: Money, expected: string): void {
  if (amount.currency !== expected) {
    throw new TypeError(`Cannot mix ${amount.currency} with ${expected}`);
  }
}

export function add(a: Money, b: Money): Money {
  assertCurrency(b, a.currency);
  return money(a.minor + b.minor, a.currency);
}

export function subtract(a: Money, b: Money): Money {
  assertCurrency(b, a.currency);
  return money(a.minor - b.minor, a.currency);
}

export function negate(amount: Money): Money {
  return money(-amount.minor, amount.currency);
}

/** Adds a list exactly. `currency` is only needed for an empty list, where there
 *  is nothing to infer the zero from. */
export function sum(amounts: readonly Money[], currency?: string): Money {
  const code = currency ? normaliseCurrency(currency) : amounts[0]?.currency;
  if (!code) {
    throw new TypeError('sum() of an empty list needs a currency to return zero in');
  }
  let minor = 0;
  for (const amount of amounts) {
    assertCurrency(amount, code);
    minor += amount.minor;
  }
  return money(minor, code);
}

export type Rounding = 'nearest' | 'up' | 'down';

/** Multiply by a plain number — for estimate bands and percentages. The result
 *  is snapped back to a whole minor unit immediately, so the float never
 *  survives past this call. */
export function scale(amount: Money, factor: number, rounding: Rounding = 'nearest'): Money {
  if (!Number.isFinite(factor)) {
    throw new RangeError(`Expected a finite factor, got ${factor}`);
  }
  const raw = amount.minor * factor;
  const rounded =
    rounding === 'up' ? Math.ceil(raw) : rounding === 'down' ? Math.floor(raw) : Math.round(raw);
  return money(rounded, amount.currency);
}

/** Negative if a < b, zero if equal, positive if a > b. */
export function compare(a: Money, b: Money): number {
  assertCurrency(b, a.currency);
  return a.minor - b.minor;
}

export function equals(a: Money, b: Money): boolean {
  return a.currency === b.currency && a.minor === b.minor;
}

export function isZero(amount: Money): boolean {
  return amount.minor === 0;
}

export function isNegative(amount: Money): boolean {
  return amount.minor < 0;
}

export function max(a: Money, b: Money): Money {
  return compare(a, b) >= 0 ? a : b;
}

export function min(a: Money, b: Money): Money {
  return compare(a, b) <= 0 ? a : b;
}

/** How far `part` is along towards `whole`, as 0…1 and beyond. A float, but a
 *  derived one used for progress and thresholds — never for an amount. */
export function ratio(part: Money, whole: Money): number {
  assertCurrency(whole, part.currency);
  if (whole.minor === 0) return part.minor === 0 ? 0 : Infinity;
  return part.minor / whole.minor;
}

export type FormatOptions = {
  /** BCP 47 tag. Left undefined, the host's own locale is used. */
  locale?: string;
  /** Show every minor unit. For a "technical details" pane, not for the meter. */
  exact?: boolean;
};

/** Decimal places for a number someone reads in passing.
 *
 *  Under ten, the pennies matter — a ₹0.40 change reading as "₹0" would look
 *  broken. Over ten they are noise, and hiding them is what makes ₹1,240
 *  legible at a glance. */
function glanceDigits(amount: Money, exponent: number): number {
  if (exponent === 0) return 0;
  if (amount.minor === 0) return 0;
  const majorMagnitude = Math.abs(amount.minor) / 10 ** exponent;
  return majorMagnitude < 10 ? Math.min(2, exponent) : 0;
}

export function formatMoney(amount: Money, options: FormatOptions = {}): string {
  const exponent = minorUnitExponent(amount.currency);
  const digits = options.exact ? exponent : glanceDigits(amount, exponent);
  return new Intl.NumberFormat(options.locale, {
    style: 'currency',
    currency: amount.currency,
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(toMajor(amount));
}
