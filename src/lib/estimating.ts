/** Whether to say anything about money before starting, and what to say.
 *
 * BACKLOG F7: `src/cost/estimate.ts` has been built and tested since the first
 * week and nothing called it. This is the call. It is a separate file from the
 * window for the usual reason — the rule it encodes is worth being able to prove
 * without a browser — and it is deliberately thin: every number comes from
 * `estimate.ts` and every word comes from `phrasing.ts`. Nothing here computes
 * or writes anything.
 *
 * ## The rule, restated because it is the whole feature
 *
 * **Only large jobs.** COST-DESIGN §2 is unambiguous: a confirmation on every
 * small change becomes noise, noise gets dismissed reflexively, and that reflex
 * is how "Accept All" was invented. `shouldWarn` already owns that decision and
 * this does not second-guess it — it hands over a task and a threshold and does
 * what it is told.
 */

import {
  defaultWarnThreshold,
  estimateFrom,
  shouldWarn,
  type Estimate,
  type Task,
  type TaskObservation,
  type TaskSize,
} from '../cost/estimate';
 import { biggerJob } from '../cost/phrasing';
import { sizeUp } from '../cost/sizing';
import type { Prompt } from '../cost/phrasing';
import type { Money } from '../agent/types';

/**
 * What money is counted in before any has been spent.
 *
 * Everything the meter shows comes from the provider's own pricing, so the real
 * currency is not known until the first request has been billed — and the first
 * request is exactly the one this has to quote for. The bands and thresholds in
 * `estimate.ts` are per currency and internally consistent, so the fallback has
 * to match what pricing will actually arrive in.
 *
 * It is written here rather than imported because the window is not allowed to
 * know that the agent runtime exists (notes/strategy/ARCHITECTURE.md), and
 * `PI_CURRENCY` lives on the other side of that line. A test holds the two
 * together, which is the right shape for this: a duplicated constant with a
 * tripwire, rather than an import that quietly widens the seam.
 */
export const CURRENCY_BEFORE_ANY_SPEND = 'USD';

export type Quote = {
  /** What the request looks like. Filed against the measurement afterwards. */
  task: Task;
  estimate: Estimate;
  /** True when this is worth interrupting for. */
  warn: boolean;
  /** The words, or null when nothing should be said. Always from phrasing.ts. */
  prompt: Prompt | null;
};

/**
 * Price a request before it runs.
 *
 * `jobs` is what this project has actually cost so far, so the estimate is a
 * measurement as soon as there is anything to measure and an honest, wide guess
 * before that. `spent` is only consulted for its currency.
 */
export function quote(
  jobs: readonly TaskObservation[],
  spent: Money | null,
  request: string,
  /** What the agent itself judged this to be, once it has looked. Absent means
   *  nobody has judged it yet — which is every request on the way in. */
  judged?: TaskSize,
): Quote {
  const currency = spent?.currency ?? CURRENCY_BEFORE_ANY_SPEND;
  const task = sizeUp(request);
  // Only the history in the same currency. An account changed mid-project would
  // otherwise have last month's numbers compared against this month's threshold.
  const comparable = jobs.filter((one) => one.cost.currency === currency);
  const estimate = estimateFrom(comparable, task, currency);

  /* The pause before something big is still the point. Who decides it is big
   * is what changed.
   *
   * It used to be decided here, by matching words in the request: "landing
   * page" made "can you start the landing page?" a page build, so an estimate
   * appeared before running a server. Every fix for that is another word in
   * another list, and the list is wrong again the moment somebody phrases it
   * differently — which is not how anything else in this app decides anything.
   *
   * So the request no longer votes. The size comes from the agent, which has
   * looked at the project and said what the work is; until it has, there is
   * nothing to pause for and the turn simply runs. Reading the words is kept
   * only for the shape of the estimate itself, which is a price and not a
   * decision.
   */
  const warn = judged === undefined ? false : shouldWarn(estimateFrom(comparable, { ...task, size: judged }, currency), defaultWarnThreshold(currency));
  const priced = judged === undefined ? estimate : estimateFrom(comparable, { ...task, size: judged }, currency);
  return { task, estimate: priced, warn, prompt: warn ? biggerJob(priced) : null };
}

/** Said when somebody would rather start smaller. Not a refusal and not a
 *  lecture — the job is still there, and they have said something about how they
 *  want to approach it. */
export const smallerFirst =
  'Let’s start smaller, then. Tell me the first piece you want and I’ll do just that.';
