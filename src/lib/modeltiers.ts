/** Sorting models into the three questions a designer actually has.
 *
 * `qwen3.7-max`, `minimax-m3` and `deepseek-v4-flash` are eighteen equal rows of
 * nothing to somebody who does not follow model releases. What they want to
 * choose between is cheap, careful, and the sensible middle — so the list is
 * grouped by that, with the real name kept underneath for the people who do
 * know and want to pick precisely.
 *
 * The grouping is derived from the price the provider quotes, not from a list of
 * model names, because a hand-kept list is a list that rots within a month.
 */

export type Tier = 'fast' | 'balanced' | 'best';

export type Priced = {
  /** Dollars per million tokens, or null when the provider does not say. */
  rates: { input: number; output: number } | null;
};

/**
 * One number per model: dollars per million tokens at a 3:1 read-to-write
 * mix, which is roughly how a coding conversation actually bills.
 */
export function blended(model: Priced): number | null {
  if (model.rates === null) return null;
  return (3 * model.rates.input + model.rates.output) / 4;
}

/** Where the bands sit, in dollars per million. Calibrated so that the models
 *  people know land where they expect: a small fast model under the first,
 *  a mid-range one between, a top-end one above the second. */
const FAST_UNDER = 2.5;
const BEST_OVER = 8;

export function tierOf(model: Priced): Tier | null {
  const price = blended(model);
  if (price === null) return null;
  if (price < FAST_UNDER) return 'fast';
  if (price > BEST_OVER) return 'best';
  return 'balanced';
}

export const tierNames: Record<Tier, { name: string; note: string }> = {
  fast: { name: 'Fast and cheap', note: 'for small changes' },
  balanced: { name: 'Balanced', note: 'a good default' },
  best: { name: 'Best quality', note: 'for hard problems, costs more' },
};

const ORDER: readonly Tier[] = ['fast', 'balanced', 'best'];

/**
 * Group models by tier, cheapest band first.
 *
 * Returns null when the grouping would not help — every model in one band, or
 * none of them priced. A list under a single heading is a heading that has told
 * you nothing, and the caller falls back to grouping by provider.
 */
export function byTier<T extends Priced>(models: readonly T[]): [Tier, T[]][] | null {
  const bands = new Map<Tier, T[]>();
  for (const model of models) {
    const tier = tierOf(model);
    if (tier === null) return null;
    const already = bands.get(tier);
    if (already === undefined) bands.set(tier, [model]);
    else already.push(model);
  }
  if (bands.size < 2) return null;
  return ORDER.filter((tier) => bands.has(tier)).map((tier) => [tier, bands.get(tier) ?? []]);
}
