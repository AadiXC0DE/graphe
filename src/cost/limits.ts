/** A ceiling the user sets, not one we impose.
 *
 *     "Stop and ask me before going past ₹2,000 this month."
 *
 * notes/strategy/COST-DESIGN.md §6. Two rules govern everything here:
 *
 * **A nudge at 80%, not a wall at 100%.** The point of the limit is that nothing
 * is ever a surprise, which means the warning arrives while there is still room
 * to act on it.
 *
 * **Reaching the ceiling must never lose work.** A limit that kills a job halfway
 * through leaves a half-broken project, and a spending limit that causes data
 * loss is worse than no limit at all — see test plan S-31 and C-04. So `stop`
 * means *start nothing new*: whatever is in flight finishes and is saved, then
 * the agent explains and asks. There is deliberately no state in this module
 * that means "abandon what you are doing", because nothing should ever be able
 * to ask for that. */

import type { Money } from '../agent/types';
import { compare, max as maxMoney, money, ratio, subtract, zero } from './money';

export type LimitPeriod = 'session' | 'day' | 'month';

/** `ok` — carry on. `nudge` — mention it once, change nothing. `stop` — finish
 *  and save what is running, then ask before starting anything else. */
export type LimitState = 'ok' | 'nudge' | 'stop';

export type SpendLimit = {
  ceiling: Money;
  period: LimitPeriod;
  /** Fraction of the ceiling at which the nudge appears. */
  nudgeAt: number;
};

export const DEFAULT_NUDGE_FRACTION = 0.8;

export function createLimit(
  ceiling: Money,
  period: LimitPeriod = 'month',
  nudgeAt: number = DEFAULT_NUDGE_FRACTION,
): SpendLimit {
  if (ceiling.minor <= 0) {
    throw new RangeError('A limit has to be more than nothing');
  }
  if (!(nudgeAt > 0 && nudgeAt < 1)) {
    throw new RangeError(`The nudge has to sit between 0 and 1, got ${nudgeAt}`);
  }
  return { ceiling, period, nudgeAt };
}

export type LimitStatus = {
  state: LimitState;
  limit: SpendLimit;
  spent: Money;
  /** Never negative — past the ceiling this is zero and `over` carries the rest. */
  remaining: Money;
  over: Money;
  /** 0…1 and beyond. Display only. */
  fraction: number;
  /** May the agent begin something new? False only at `stop`. */
  allowsNewWork: boolean;
  /** Always true, and stated rather than assumed: nothing already running is
   *  cancelled by a limit. It finishes, it is saved, then we ask. */
  preservesWorkInFlight: true;
};

export function checkLimit(limit: SpendLimit, spent: Money): LimitStatus {
  const currency = limit.ceiling.currency;
  if (spent.currency !== currency) {
    throw new TypeError(`This limit is in ${currency}, not ${spent.currency}`);
  }
  // The nudge point is resolved to a whole minor unit once, so the state machine
  // compares integers rather than turning on a float comparison at the boundary.
  const nudgeAtMinor = Math.ceil(limit.ceiling.minor * limit.nudgeAt);
  const state: LimitState =
    compare(spent, limit.ceiling) >= 0 ? 'stop' : spent.minor >= nudgeAtMinor ? 'nudge' : 'ok';

  return {
    state,
    limit,
    spent,
    remaining: maxMoney(subtract(limit.ceiling, spent), zero(currency)),
    over: maxMoney(subtract(spent, limit.ceiling), zero(currency)),
    fraction: ratio(spent, limit.ceiling),
    allowsNewWork: state !== 'stop',
    preservesWorkInFlight: true,
  };
}

/** Would starting this job take us past the ceiling? Used before a big job, so
 *  the answer arrives with the estimate rather than halfway through. */
export function wouldExceed(limit: SpendLimit, spent: Money, estimate: Money): boolean {
  return compare(money(spent.minor + estimate.minor, spent.currency), limit.ceiling) > 0;
}

/** The state we would land in if a job of this size ran to completion. */
export function projectedState(limit: SpendLimit, spent: Money, estimate: Money): LimitState {
  return checkLimit(limit, money(spent.minor + estimate.minor, spent.currency)).state;
}

export function raiseCeiling(limit: SpendLimit, ceiling: Money): SpendLimit {
  if (compare(ceiling, limit.ceiling) <= 0) {
    throw new RangeError('A raised ceiling has to be higher than the one it replaces');
  }
  return createLimit(ceiling, limit.period, limit.nudgeAt);
}

export type LimitUpdate = {
  status: LimitStatus;
  /** True only on the turn the state first worsens. The nudge is said once; a
   *  sentence repeated every few seconds is nagging, and nagging gets muted. */
  announce: boolean;
  previousState: LimitState;
};

const SEVERITY: Readonly<Record<LimitState, number>> = { ok: 0, nudge: 1, stop: 2 };

/** Edge-triggered wrapper around `checkLimit`, for a live meter. */
export class LimitWatcher {
  #limit: SpendLimit;
  #announced: LimitState = 'ok';

  constructor(limit: SpendLimit) {
    this.#limit = limit;
  }

  get limit(): SpendLimit {
    return this.#limit;
  }

  update(spent: Money): LimitUpdate {
    const status = checkLimit(this.#limit, spent);
    const previousState = this.#announced;
    const announce = SEVERITY[status.state] > SEVERITY[previousState];
    if (announce) this.#announced = status.state;
    return { status, announce, previousState };
  }

  /** Raising the ceiling re-arms the nudge, so the user gets the same warning on
   *  the new number that they got on the old one. */
  raiseTo(ceiling: Money): SpendLimit {
    this.#limit = raiseCeiling(this.#limit, ceiling);
    this.#announced = 'ok';
    return this.#limit;
  }
}
