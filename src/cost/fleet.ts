/** The ceiling, with teeth.
 *
 * limits.ts counts and `Allotment` shares out; neither of them can stop
 * anything, because neither of them knows what is running. This does. Everything
 * that can spend money on its own — a helper in its own process, a piece of work
 * carrying on while nobody watches — registers here with the one thing needed to
 * end it, and the ceiling is enforced in two places at once:
 *
 *  - **Nothing new starts** once the remainder cannot cover a run's share. Six
 *    helpers sent off together each look affordable against the total; measured
 *    against what the five before them have already claimed, they do not.
 *  - **What is going is stopped.** Only what loses nothing by stopping: a helper
 *    changes nothing by design, and a run in its own copy of the project saves
 *    what it reached on the way out. The conversation somebody is sitting in
 *    front of is never registered here — it finishes and is saved, which is the
 *    rule limits.ts is built around.
 *
 * One of these per process. Helpers are spawned from inside a tool call, which
 * has no route back to the shell that owns the ledger, so the shell and the
 * tools meet here.
 */

import type { Money, SpendReason } from '../agent/types';
import {
  estimateFrom,
  reserveFor,
  TaskHistory,
  type TaskSize,
} from './estimate';
import { Allotment, createLimit, type LimitStatus, type SpendLimit } from './limits';
import { formatMoney, fromMajor, money, normaliseCurrency } from './money';

/** What kind of thing is running. Each has its own idea of how big a run of it
 *  usually is, which is what its share of the ceiling is worked out from. */
export type RunKind = 'helper' | 'away';

const SIZE_OF: Readonly<Record<RunKind, TaskSize>> = { helper: 'page', away: 'feature' };

/** One thing running that the ceiling is allowed to end. */
export type Running = {
  id: string;
  kind: RunKind;
  /** How it is ended. Called at most once, and never for work that would be
   *  lost by it. */
  stop: () => void;
};

/** Money spent by something the meter never saw — a helper is its own process,
 *  and its spend reaches the ledger through here or not at all. */
export type UnseenSpend = {
  amount: Money;
  label: string;
  reason: SpendReason;
  /** The folder the run was working in. */
  project: string;
};

export type Admitted = { ok: true } | { ok: false; because: string };

/** The two sentences this file says, and both are said to the model rather than
 *  drawn: a helper is refused or ended inside a tool call, and what comes back
 *  is what the model has to explain with. Everything the *person* is shown about
 *  the ceiling comes from phrasing.ts. The amount is their own ceiling, which is
 *  the one figure we can name without guessing at somebody else's billing. */
export const ceilingWords = {
  refused(ceiling: Money, locale?: string): string {
    const amount = formatMoney(ceiling, locale === undefined ? {} : { locale });
    return `This has reached the ${amount} limit the person set, so no more helpers can start. Tell them so, and carry on with what you can do yourself.`;
  },
  stopped: 'This helper was stopped: the limit the person set has been reached. Tell them so rather than trying again.',
  tooMany(most: number): string {
    return `${String(most)} helpers are already working, which is as many as run at once. Wait for one to answer and send this again, or do this piece yourself.`;
  },
};

/**
 * How many of each kind run at once.
 *
 * Helpers are whole processes with their own runtime, and the model is told to
 * send them all in one reply — so the ceiling on money is not the only ceiling
 * needed. Six is more parallelism than a single turn has ever usefully had, and
 * far short of what a reply asking for twelve would have started. Away work
 * keeps its own four, set where the board is.
 */
export const MOST_AT_ONCE: Readonly<Record<RunKind, number>> = {
  /* The same number a single request may break itself into (`MOST_APART`), so a
     fan-out that the model was told it could ask for is never refused on the
     way out by a ceiling nobody mentioned. Research splits a question fewer
     ways than this on purpose, leaving room for whatever is already working. */
  helper: 8,
  // Background work is already capped per project by the board that holds it,
  // and this fleet is one for the whole app: capping it here as well would mean
  // a second project could not start anything while the first was busy.
  away: Number.POSITIVE_INFINITY,
};

/** Said to the *person*, once, when their ceiling is in one currency and the
 *  account bills in another. There is no exchange rate in this codebase and
 *  inventing one would be worse — but a limit that cannot stop anything must
 *  never be a limit that says nothing. */
export function ceilingCannotBind(ceiling: string, spending: string): string {
  return `The limit you set is in ${ceiling} and this account is billed in ${spending}, so it cannot stop anything. Set one in ${spending} and it will.`;
}

/**
 * Everything running, and the ceiling over all of it.
 *
 * With no ceiling set nothing here binds: runs are still counted, so the moment
 * one is set the number it is measured against is real rather than starting from
 * zero halfway through an afternoon.
 */
export class Fleet {
  #allotment: Allotment | null = null;
  #history: TaskHistory | null = null;
  #running = new Map<string, Running>();
  #unseen = new Set<(spend: UnseenSpend) => void>();
  #reached = new Set<(status: LimitStatus) => void>();
  /** Spend seen before any ceiling was set, kept so a ceiling set mid-afternoon
   *  is measured against the whole of it. Currency-keyed, because there is no
   *  exchange rate anywhere in this codebase and inventing one would be worse
   *  than counting only what matches. */
  #before = new Map<string, number>();
  /** True while the stops are being called, so a run that ends itself on the
   *  way out cannot start the round again. */
  #stopping = false;
  /** A currency that was spent while a ceiling in a different one was set. The
   *  ceiling cannot measure it, so it cannot stop it — and saying nothing about
   *  that leaves somebody believing they are capped when they are not. */
  #cannotMeasure: string | null = null;

  /** The ceiling, or null when nobody has set one. */
  get ceiling(): SpendLimit | null {
    return this.#allotment?.limit ?? null;
  }

  /**
   * The sentence to show when the ceiling cannot do its job, or null.
   *
   * Read after spend has been counted. Answers once and then stays quiet: this
   * is a fact about the setting, not an event, and saying it every turn would
   * make it furniture.
   */
  takeCannotBind(): string | null {
    const allotment = this.#allotment;
    const spending = this.#cannotMeasure;
    if (allotment === null || spending === null) return null;
    this.#cannotMeasure = null;
    return ceilingCannotBind(allotment.currency, spending);
  }

  get status(): LimitStatus | null {
    return this.#allotment?.status ?? null;
  }

  /** May anything new start at all? True with no ceiling set. */
  get allowsNewWork(): boolean {
    return this.#allotment === null ? true : this.#allotment.status.allowsNewWork;
  }

  get running(): number {
    return this.#running.size;
  }

  /** How many of one kind are running right now. The cap is per kind: a turn's
   *  helpers and the board's background work are different budgets. */
  runningOf(kind: RunKind): number {
    let many = 0;
    for (const one of this.#running.values()) if (one.kind === kind) many += 1;
    return many;
  }

  /** Set the ceiling, or take it away. What has already been spent in this
   *  currency carries over, and so does what runs have been measured to cost —
   *  raising a ceiling is not a reason to start guessing again. */
  hold(limit: SpendLimit | null): void {
    // A new ceiling is a new question. Anything unsaid about the last one is
    // about a setting that no longer exists.
    this.#cannotMeasure = null;
    if (limit === null) {
      this.#allotment = null;
      this.#history = null;
      return;
    }
    const currency = limit.ceiling.currency;
    const same = this.#allotment?.currency === currency;
    const spent = money(
      (same ? this.#allotment?.spent.minor ?? 0 : 0) + (this.#before.get(currency) ?? 0),
      currency,
    );
    this.#before.delete(currency);
    this.#allotment = new Allotment(limit, spent);
    if (!same || this.#history === null) this.#history = new TaskHistory(currency);
  }

  raiseTo(ceiling: Money): void {
    this.#allotment?.raiseTo(ceiling);
  }

  /**
   * A run asking to start.
   *
   * Refused as a sentence rather than a throw: every caller has somewhere to
   * put one, and a refusal is a decision rather than a failure.
   */
  begin(run: Running): Admitted {
    // How many, before how much. A ceiling only binds once somebody sets one,
    // and the model is told to put every helper call in one reply — so without
    // this a reply asking for twelve helpers started twelve whole processes,
    // each loading the agent runtime. This is the same idea as the four pieces
    // background work allows, at the size of a turn.
    if (this.runningOf(run.kind) >= MOST_AT_ONCE[run.kind]) {
      return { ok: false, because: ceilingWords.tooMany(MOST_AT_ONCE[run.kind]) };
    }
    const allotment = this.#allotment;
    if (allotment === null) {
      this.#running.set(run.id, run);
      return { ok: true };
    }
    const admission = allotment.begin(run.id, this.#shareFor(allotment.currency, run.kind));
    if (!admission.ok) {
      return { ok: false, because: ceilingWords.refused(allotment.limit.ceiling) };
    }
    this.#running.set(run.id, run);
    return { ok: true };
  }

  /**
   * The way to end a run, once there is one.
   *
   * Asking and starting are two different moments — nothing is spawned until
   * the ceiling has agreed to it — and the ceiling can be reached in between.
   * A run that is no longer registered by the time it says how to stop it is
   * stopped there and then.
   */
  watch(id: string, stop: () => void): void {
    const run = this.#running.get(id);
    if (run === undefined) {
      stop();
      return;
    }
    this.#running.set(id, { ...run, stop });
  }

  /** Money the meter has already been told about. Counted against the ceiling
   *  and against the run that spent it, and nothing is announced. */
  spent(id: string | null, amount: Money): void {
    this.#count(id, amount);
  }

  /** Money from a run of our own that nothing upstream saw. Counted first, then
   *  passed on so it reaches the ledger the meter reads. */
  spentUnseen(id: string | null, spend: UnseenSpend): void {
    this.#count(id, spend.amount);
    for (const listener of this.#unseen) {
      try {
        listener(spend);
      } catch {
        // A window that cannot be told is not a reason to lose the count.
      }
    }
  }

  /**
   * A run is over. What it did not use goes back to everyone else, and what it
   * did use makes the next share of its kind a measurement rather than a guess.
   *
   * One the ceiling stopped is no longer registered, so it teaches the estimate
   * nothing — a run cut off halfway is not what a run of that kind costs.
   */
  ended(id: string): void {
    const kind = this.#running.get(id)?.kind;
    const cost = this.#allotment?.end(id) ?? null;
    this.#running.delete(id);
    // A run that spent nothing did not happen — it was refused, or it fell over
    // before it reached an account — and it is not evidence of anything.
    if (cost === null || cost.minor === 0 || kind === undefined || this.#history === null) return;
    this.#history.record({ kind, size: SIZE_OF[kind], cost });
  }

  /** Everything registered, stopped. Returns how many were told to. */
  stopEverything(): number {
    if (this.#stopping) return 0;
    this.#stopping = true;
    const all = [...this.#running.values()];
    this.#running.clear();
    try {
      for (const run of all) {
        try {
          run.stop();
        } catch {
          // One that will not stop is not a reason to leave the rest running.
        }
      }
    } finally {
      this.#stopping = false;
    }
    return all.length;
  }

  /** Told when spend arrives that nothing else has seen, so the meter can show
   *  what a fan-out actually cost. */
  onUnseenSpend(listener: (spend: UnseenSpend) => void): () => void {
    this.#unseen.add(listener);
    return () => this.#unseen.delete(listener);
  }

  /** Told once, on the turn the ceiling is first reached. */
  onReached(listener: (status: LimitStatus) => void): () => void {
    this.#reached.add(listener);
    return () => this.#reached.delete(listener);
  }

  /** Start again from nothing: no ceiling, nothing running, nobody listening. */
  forget(): void {
    this.#allotment = null;
    this.#history = null;
    this.#running.clear();
    this.#before.clear();
    this.#unseen.clear();
    this.#reached.clear();
    this.#cannotMeasure = null;
  }

  #count(id: string | null, amount: Money): void {
    const allotment = this.#allotment;
    if (allotment === null || amount.currency !== allotment.currency) {
      this.#before.set(amount.currency, (this.#before.get(amount.currency) ?? 0) + amount.minor);
      // Money is going out that the ceiling will never see. Remember it so
      // somebody can be told; a limit that quietly measures nothing is worse
      // than no limit, because it is believed.
      if (allotment !== null) this.#cannotMeasure = amount.currency;
      return;
    }
    // Something the ceiling *can* measure. Whatever was true before is not now,
    // and a warning kept past the thing it was about is how somebody ends up
    // told their limit is in the currency it is already in.
    this.#cannotMeasure = null;
    const update = allotment.record(id, amount);
    if (update.status.state !== 'stop' || !update.announce) return;
    // The order matters: stop first, then say so. Telling somebody the fleet has
    // been stopped before it has been is the one version of this that lies.
    this.stopEverything();
    for (const listener of this.#reached) {
      try {
        listener(update.status);
      } catch {
        // Said badly or not at all; everything is already stopped either way.
      }
    }
  }

  /** What one run of this kind should be given. Measured once a few runs of
   *  that kind have finished, and a deliberately pessimistic guess before. */
  #shareFor(currency: string, kind: RunKind): Money {
    const task = { kind, size: SIZE_OF[kind] };
    const history = this.#history;
    return reserveFor(history === null ? estimateFrom([], task, currency) : history.estimate(task));
  }
}

/** The one for this process. */
export const fleet = new Fleet();

/**
 * A ceiling somebody set, read from a line of text.
 *
 * "20 USD". The period is always this sitting, because a sitting is the only
 * stretch this app can actually see the whole of — nothing keeps a ledger
 * between launches yet, and a monthly ceiling measured against one afternoon's
 * spend would be a ceiling that does not hold.
 */
export function readCeiling(text: string): SpendLimit | null {
  const match = /^\s*([0-9]+(?:\.[0-9]+)?)\s*([A-Za-z]{3})\s*$/.exec(text ?? '');
  if (match === null) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  try {
    return createLimit(fromMajor(amount, normaliseCurrency(match[2] ?? '')), 'session');
  } catch {
    return null;
  }
}
