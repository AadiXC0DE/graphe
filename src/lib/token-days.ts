/** Tokens through the model, one day at a time.
 *
 * The cost screen already says what money went where; this is the other half
 * of the same question — how much work went through the model, counted in
 * tokens and laid out over the days it happened. Money answers "what did it
 * cost", tokens answer "how much was done", and neither stands in for the
 * other: a cheap model burns a pile of tokens for a small bill.
 *
 * Pure. The shell reads its session transcripts and hands the raw pairs over;
 * everything about buckets, gaps and weeks is decided here, where a test can
 * hold it against a fixed date.
 */

/** One local day, and every token that went through the model during it. */
export type DayTokens = {
  /** Local midnight of the day, epoch ms — the key a grid of weeks is built
   *  from. */
  at: number;
  tokens: number;
};

const DAY = 24 * 60 * 60 * 1000;

export type TokenUsageView = {
  /** One entry per day that saw any use, oldest first. Days with nothing are
   *  left out; the grid fills them in, because a year of empty squares is not
   *  ours to ship. */
  days: readonly DayTokens[];
  /** Every token counted, across all the days. */
  total: number;
};

/** Local midnight of the day `at` falls in. */
function midnightOf(at: number): number {
  const day = new Date(at);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
}

/** Fold raw (when, how many) pairs into per-day totals, oldest first. */
export function daysFromUsage(
  entries: readonly { at: number; tokens: number }[],
): TokenUsageView {
  const byDay = new Map<number, number>();
  let total = 0;
  for (const one of entries) {
    if (!Number.isFinite(one.tokens) || one.tokens <= 0) continue;
    const at = midnightOf(one.at);
    byDay.set(at, (byDay.get(at) ?? 0) + one.tokens);
    total += one.tokens;
  }
  const days = [...byDay.entries()]
    .map(([at, tokens]) => ({ at, tokens }))
    .sort((one, other) => one.at - other.at);
  return { days, total };
}

/** How many tokens one cell's colour stands for, given the whole range.
 *
 * Ranked against the other days that have anything, not scaled to the largest
 * one — one heavy afternoon must not flatten a fortnight of ordinary ones
 * into the bottom shade. Ties fall downwards, so a run of identical days all
 * wear the same shade rather than straddling two.
 */
export function intensityOf(tokens: number, days: readonly DayTokens[]): number {
  if (tokens <= 0) return 0;
  const busy = days.map((one) => one.tokens).filter((one) => one > 0);
  if (busy.length === 0) return 0;
  const quieter = busy.filter((one) => one < tokens).length;
  const share = quieter / busy.length;
  if (share === 0) return 1;
  if (share < 2 / 3) return 2;
  return 3;
}

/** The weeks to draw, newest last: an array of columns, each seven days from
 *  Monday. `weeks` columns ending on today, zero-token days included so the
 *  grid reads as a calendar rather than a list of hits. */
export function weeksOf(days: readonly DayTokens[], now: number, weeks: number): readonly (readonly DayTokens[])[] {
  const counts = new Map(days.map((one) => [one.at, one.tokens]));
  const today = midnightOf(now);
  // Back to the Monday that starts the oldest week we mean to show.
  const weekday = (at: number): number => (new Date(at).getDay() + 6) % 7;
  const firstMonday = today - weekday(today) * DAY - (weeks - 1) * 7 * DAY;
  const columns: DayTokens[][] = [];
  for (let week = 0; week < weeks; week += 1) {
    const column: DayTokens[] = [];
    for (let day = 0; day < 7; day += 1) {
      const at = firstMonday + (week * 7 + day) * DAY;
      column.push({ at, tokens: at <= today ? (counts.get(at) ?? 0) : -1 });
    }
    columns.push(column);
  }
  return columns;
}

/** Tokens said the way a person reads them: 1.2k, 3.4m. */
export function saysTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens >= 10_000_000 ? 0 : 1)}m`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(tokens >= 100_000 ? 0 : 1)}k`;
  return String(Math.round(tokens));
}
