/** "This is a bigger job — about ₹35 and roughly four minutes. Want me to go ahead?"
 *
 * docs/COST-DESIGN.md §2. The estimate has to come from measured history of
 * similar work, and it has to appear *only* for large jobs — a confirmation on
 * every small tweak becomes noise, gets dismissed reflexively, and that reflex is
 * how "Accept All" was invented.
 *
 * ## The honest part
 *
 * On day one there is no history. None. The first estimate a user ever sees is
 * not a measurement and we should not build machinery that implies it is. So
 * this module does three things instead of pretending:
 *
 * 1. It carries a **cold-start band** per job size — a deliberately wide, mildly
 *    pessimistic guess, so the first few quotes err towards "that cost less than
 *    you said" rather than the reverse. A pleasant surprise is survivable; a
 *    surprise bill is a trust-ending event (COST-DESIGN §8).
 * 2. It reports **confidence** as data, so the copy can say "I haven't done many
 *    of these yet" instead of quoting a fabricated precision.
 * 3. It **blends** the prior out gradually as real observations arrive, rather
 *    than flipping to measured mode on a single sample. One observation of one
 *    job is not a distribution.
 *
 * Target accuracy once warm is test C-05: within 30% of actual, 80% of the time. */

import type { Money } from '../agent/types';
import { fromMajor, max as maxMoney, min as minMoney, money, scale } from './money';

/** How big the job looks before we start. Coarse on purpose — this is a bucket
 *  for grouping past work, not a promise about the work itself. */
export type TaskSize = 'tweak' | 'page' | 'feature' | 'project';

export type Task = {
  /** A specific, plain-language kind: 'contact-form', 'figma-import'. Estimates
   *  match on this first and fall back to `size` when it is unfamiliar. */
  kind: string;
  size: TaskSize;
};

export type TaskObservation = Task & {
  /** What it actually cost, both work and retries. The user pays for both, so
   *  the estimate has to include both or it is systematically low. */
  cost: Money;
  durationMs?: number;
  at: number;
};

export type TaskObservationInput = Task & {
  cost: Money;
  durationMs?: number;
  at?: number;
};

/** How much of this number is measurement and how much is us guessing. */
export type Confidence = 'no-history' | 'few-examples' | 'measured';

export type Estimate = {
  task: Task;
  /** The number we quote. */
  expected: Money;
  /** The honest band around it. */
  low: Money;
  high: Money;
  confidence: Confidence;
  /** Observations this was built from. Zero means it is entirely a prior. */
  sampleSize: number;
  expectedDurationMs: number | null;
};

export type Band = { low: number; expected: number; high: number };

/** Cold-start bands, in major units.
 *
 *  These are guesses. They are anchored to the figures in COST-DESIGN.md (a page
 *  around ₹18, a bigger job around ₹35) and widened, and they are the first thing
 *  that should be replaced with real numbers once there is telemetry to replace
 *  them with. They are also *not* currency conversions of each other — each set
 *  is "what a job of this size feels like it should cost" in that market, which
 *  is the number the threshold has to be comparable against. Pass your own
 *  through `EstimateOptions.coldStart` rather than trusting these. */
const COLD_START: Readonly<Record<string, Readonly<Record<TaskSize, Band>>>> = {
  INR: {
    tweak: { low: 0.2, expected: 0.6, high: 2 },
    page: { low: 6, expected: 18, high: 45 },
    feature: { low: 20, expected: 45, high: 120 },
    project: { low: 80, expected: 200, high: 600 },
  },
  USD: {
    tweak: { low: 0.01, expected: 0.03, high: 0.1 },
    page: { low: 0.3, expected: 0.9, high: 2.5 },
    feature: { low: 1, expected: 2.5, high: 7 },
    project: { low: 4, expected: 10, high: 30 },
  },
};

const COLD_START_DURATION_MS: Readonly<Record<TaskSize, number>> = {
  tweak: 20_000,
  page: 4 * 60_000,
  feature: 9 * 60_000,
  project: 25 * 60_000,
};

/** The point at which a job stops being a tweak and is worth interrupting for.
 *  COST-DESIGN §2 anchors this at ₹20. The other rows are the same *feeling* in
 *  their own market, not an exchange-rate conversion of it. The user can change
 *  it, and this is only what they start from. */
const DEFAULT_WARN_THRESHOLDS: Readonly<Record<string, number>> = {
  INR: 20,
  USD: 1,
  EUR: 1,
  GBP: 1,
  AUD: 1.5,
  CAD: 1.5,
  JPY: 150,
};

export function defaultWarnThreshold(currency: string): Money {
  const code = currency.trim().toUpperCase();
  const major = DEFAULT_WARN_THRESHOLDS[code] ?? DEFAULT_WARN_THRESHOLDS['USD'] ?? 1;
  return fromMajor(major, code);
}

export type EstimateOptions = {
  /** Override the guesses above with your own measurements. */
  coldStart?: Partial<Record<TaskSize, Band>>;
  /** Only the most recent N matching jobs count. Prices and the agent both
   *  change; a quote built from six months ago is archaeology. */
  window?: number;
  /** Observations needed before we stop leaning on the prior. */
  measuredAfter?: number;
};

const DEFAULT_WINDOW = 20;
const DEFAULT_MEASURED_AFTER = 5;

function coldStartBand(currency: string, size: TaskSize, options: EstimateOptions): Band {
  const override = options.coldStart?.[size];
  if (override) return override;
  const table = COLD_START[currency.trim().toUpperCase()] ?? COLD_START['USD'];
  // COLD_START always has a USD table; the fallback keeps the types honest.
  return table?.[size] ?? { low: 0, expected: 0, high: 0 };
}

/** Nearest-rank percentile over integers — no interpolation, so no floats. */
function percentile(sortedMinor: readonly number[], p: number): number {
  if (sortedMinor.length === 0) return 0;
  const index = Math.min(sortedMinor.length - 1, Math.max(0, Math.floor(p * sortedMinor.length)));
  return sortedMinor[index] ?? 0;
}

function median(sortedMinor: readonly number[]): number {
  return percentile(sortedMinor, 0.5);
}

/** Same kind is the best signal. Same size across kinds is the next best. */
function relevant(
  observations: readonly TaskObservation[],
  task: Task,
  window: number,
): TaskObservation[] {
  const byKind = observations.filter((o) => o.kind === task.kind);
  const pool = byKind.length > 0 ? byKind : observations.filter((o) => o.size === task.size);
  return [...pool].sort((a, b) => a.at - b.at).slice(-window);
}

export function estimateFrom(
  observations: readonly TaskObservation[],
  task: Task,
  currency: string,
  options: EstimateOptions = {},
): Estimate {
  const window = options.window ?? DEFAULT_WINDOW;
  const measuredAfter = options.measuredAfter ?? DEFAULT_MEASURED_AFTER;
  const band = coldStartBand(currency, task.size, options);
  const prior = {
    low: fromMajor(band.low, currency),
    expected: fromMajor(band.expected, currency),
    high: fromMajor(band.high, currency),
  };

  const matches = relevant(observations, task, window);
  const sampleSize = matches.length;

  if (sampleSize === 0) {
    // Nothing measured. Say so, and quote the pessimistic middle of a wide band.
    return {
      task,
      expected: prior.expected,
      low: prior.low,
      high: prior.high,
      confidence: 'no-history',
      sampleSize: 0,
      expectedDurationMs: COLD_START_DURATION_MS[task.size],
    };
  }

  const sorted = matches.map((o) => o.cost.minor).sort((a, b) => a - b);
  const observedMedian = median(sorted);
  const durations = matches
    .map((o) => o.durationMs)
    .filter((d): d is number => typeof d === 'number')
    .sort((a, b) => a - b);
  const expectedDurationMs =
    durations.length > 0 ? median(durations) : COLD_START_DURATION_MS[task.size];

  if (sampleSize >= measuredAfter) {
    const expected = money(observedMedian, currency);
    return {
      task,
      expected,
      low: minMoney(money(percentile(sorted, 0.2), currency), expected),
      high: maxMoney(money(percentile(sorted, 0.8), currency), scale(expected, 1.15, 'up')),
      confidence: 'measured',
      sampleSize,
      expectedDurationMs,
    };
  }

  // Between one and a few observations: blend the prior out linearly rather than
  // flipping to "measured" on a single data point, and keep the band wide.
  const weight = sampleSize / measuredAfter;
  const blendedMinor = Math.round(observedMedian * weight + prior.expected.minor * (1 - weight));
  const expected = money(blendedMinor, currency);
  return {
    task,
    expected,
    low: minMoney(scale(expected, 0.5, 'down'), prior.low),
    high: maxMoney(scale(expected, 2, 'up'), prior.high),
    confidence: 'few-examples',
    sampleSize,
    expectedDurationMs,
  };
}

/** Does the "this is a bigger job" prompt appear?
 *
 *  When we have measured the work, we compare the number we would quote. When we
 *  have not, we compare the top of the band — an uncertain estimate that *could*
 *  be expensive is exactly the case where asking first is cheap and being wrong
 *  is not. This makes early sessions ask slightly more often, which is the right
 *  direction to be wrong in while we are still learning the user's projects. */
export function shouldWarn(estimate: Estimate, threshold: Money): boolean {
  if (estimate.expected.currency !== threshold.currency) {
    throw new TypeError(
      `Cannot compare ${estimate.expected.currency} against a ${threshold.currency} threshold`,
    );
  }
  const compareAgainst = estimate.confidence === 'measured' ? estimate.expected : estimate.high;
  return compareAgainst.minor >= threshold.minor;
}

/** Measured history of similar jobs, kept in memory for the session. */
export class TaskHistory {
  readonly currency: string;
  #observations: TaskObservation[] = [];
  #options: EstimateOptions;

  constructor(currency: string, options: EstimateOptions = {}) {
    this.currency = currency.trim().toUpperCase();
    this.#options = options;
  }

  record(observation: TaskObservationInput): TaskObservation {
    if (observation.cost.currency !== this.currency) {
      throw new TypeError(`This history is in ${this.currency}, not ${observation.cost.currency}`);
    }
    const stored: TaskObservation = {
      kind: observation.kind,
      size: observation.size,
      cost: observation.cost,
      at: observation.at ?? Date.now(),
      ...(observation.durationMs === undefined ? {} : { durationMs: observation.durationMs }),
    };
    this.#observations.push(stored);
    return stored;
  }

  observations(): readonly TaskObservation[] {
    return [...this.#observations];
  }

  estimate(task: Task): Estimate {
    return estimateFrom(this.#observations, task, this.currency, this.#options);
  }

  /** The whole decision in one call: what it will cost, and whether to ask. */
  plan(task: Task, threshold: Money = defaultWarnThreshold(this.currency)) {
    const estimate = this.estimate(task);
    return { estimate, warn: shouldWarn(estimate, threshold), threshold };
  }
}
