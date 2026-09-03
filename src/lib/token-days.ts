/** Tokens and money through the model, one day at a time.
 *
 * The cost screen already says what money went where; this is the other half
 * of the same question — how much work went through the model, counted in
 * tokens and laid out over the days it happened. Money answers "what did it
 * cost", tokens answer "how much was done", and neither stands in for the
 * other: a cheap model burns a pile of tokens for a small bill.
 *
 * Pure. The shell reads its session transcripts and hands the raw entries over;
 * everything about days, models and conversations is decided here, where a test
 * can hold it against a fixed date.
 */

/** What one model took of one day. Cost is in whole currency units. */
export type ModelDay = { model: string; cost: number; tokens: number };

/** One local day, and everything that went through the model during it. */
export type DayTokens = {
  /** Local midnight of the day, epoch ms. */
  at: number;
  tokens: number;
  /** Whole currency units. Zero where nothing was priced. */
  cost: number;
  /** What each model took of the day, dearest first. */
  models: readonly ModelDay[];
};

/** One priced turn, as the transcripts report it. Everything but the moment
 *  and the count is optional: an older transcript quotes no price and names no
 *  model, and a day of those is still a day of work. */
export type UsageEntry = {
  at: number;
  tokens: number;
  /** Whole currency units. */
  cost?: number;
  /** The model, already shortened by the reader. */
  model?: string;
  input?: number;
  output?: number;
  /** Prompt tokens served from cache rather than read again. */
  cached?: number;
  conversation?: { id: string; title: string; path: string };
};

/** One model, added up across every day read. */
export type ModelTotal = {
  model: string;
  turns: number;
  input: number;
  output: number;
  /** How much of the prompt came from cache, 0 to 1. */
  cached: number;
  cost: number;
};

/** One conversation, added up across every day read. */
export type ConversationTotal = {
  id: string;
  title: string;
  /** The transcript, which is what opening it again asks for. */
  path: string;
  turns: number;
  tokens: number;
  cost: number;
};

export type TokenUsageView = {
  /** One entry per day that saw any use, oldest first. Days with nothing are
   *  left out; the chart fills them in, because a month of empty bars is not
   *  ours to ship. */
  days: readonly DayTokens[];
  /** Every token counted, across all the days. */
  total: number;
  /** Everything those days cost together, whole currency units. */
  cost: number;
  /** Every model that was paid for, dearest first. */
  byModel: readonly ModelTotal[];
  /** The conversations that cost the most, dearest first. */
  byConversation: readonly ConversationTotal[];
};

const DAY = 24 * 60 * 60 * 1000;

/** As many conversations as a list can carry before it stops being a list. */
export const MOST_CONVERSATIONS = 10;

/** Local midnight of the day `at` falls in. */
function midnightOf(at: number): number {
  const day = new Date(at);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
}

/** A non-negative finite number, or zero. */
function count(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * The conversations these entries belong to, dearest first.
 *
 * A separate reducer over the same entries the days are folded from: "which
 * conversation cost that" is the question people ask after "which day", and it
 * cannot be answered from days at all.
 */
export function byConversation(
  entries: readonly UsageEntry[],
  most: number = MOST_CONVERSATIONS,
): readonly ConversationTotal[] {
  const found = new Map<string, ConversationTotal>();
  for (const one of entries) {
    const which = one.conversation;
    if (which === undefined || which.id === '') continue;
    const kept = found.get(which.id) ?? {
      id: which.id,
      title: which.title,
      path: which.path,
      turns: 0,
      tokens: 0,
      cost: 0,
    };
    kept.turns += 1;
    kept.tokens += count(one.tokens);
    kept.cost += count(one.cost);
    found.set(which.id, kept);
  }
  return [...found.values()]
    .sort((one, other) => other.cost - one.cost || other.tokens - one.tokens)
    .slice(0, most);
}

/** Every model that was paid for, dearest first. */
function modelsFrom(entries: readonly UsageEntry[]): readonly ModelTotal[] {
  const found = new Map<string, ModelTotal & { prompt: number; fromCache: number }>();
  for (const one of entries) {
    const model = one.model ?? '';
    if (model === '') continue;
    const kept = found.get(model) ?? {
      model,
      turns: 0,
      input: 0,
      output: 0,
      cached: 0,
      cost: 0,
      prompt: 0,
      fromCache: 0,
    };
    kept.turns += 1;
    kept.input += count(one.input);
    kept.output += count(one.output);
    kept.cost += count(one.cost);
    kept.fromCache += count(one.cached);
    kept.prompt += count(one.input) + count(one.cached);
    found.set(model, kept);
  }
  return [...found.values()]
    .map(({ prompt, fromCache, ...rest }) => ({
      ...rest,
      cached: prompt === 0 ? 0 : fromCache / prompt,
    }))
    .sort((one, other) => other.cost - one.cost || other.turns - one.turns);
}

/** Fold raw entries into per-day totals, oldest first, with the models and the
 *  conversations added up alongside. */
export function daysFromUsage(entries: readonly UsageEntry[]): TokenUsageView {
  const byDay = new Map<number, { tokens: number; cost: number; models: Map<string, ModelDay> }>();
  let total = 0;
  let cost = 0;
  const priced: UsageEntry[] = [];
  for (const one of entries) {
    if (!Number.isFinite(one.tokens) || one.tokens <= 0) continue;
    priced.push(one);
    const at = midnightOf(one.at);
    const day = byDay.get(at) ?? { tokens: 0, cost: 0, models: new Map<string, ModelDay>() };
    const spent = count(one.cost);
    day.tokens += one.tokens;
    day.cost += spent;
    const model = one.model ?? '';
    if (model !== '') {
      const kept = day.models.get(model) ?? { model, cost: 0, tokens: 0 };
      kept.cost += spent;
      kept.tokens += one.tokens;
      day.models.set(model, kept);
    }
    byDay.set(at, day);
    total += one.tokens;
    cost += spent;
  }
  const days = [...byDay.entries()]
    .map(([at, day]) => ({
      at,
      tokens: day.tokens,
      cost: day.cost,
      models: [...day.models.values()].sort(
        (one, other) => other.cost - one.cost || other.tokens - one.tokens,
      ),
    }))
    .sort((one, other) => one.at - other.at);
  return {
    days,
    total,
    cost,
    byModel: modelsFrom(priced),
    byConversation: byConversation(priced),
  };
}

/** The last `count` days ending on the day `now` falls in, oldest first, with
 *  the empty ones filled in so the chart reads as a calendar. */
export function lastDays(
  days: readonly DayTokens[],
  now: number,
  howMany: number,
): readonly DayTokens[] {
  const known = new Map(days.map((one) => [one.at, one]));
  const today = midnightOf(now);
  const out: DayTokens[] = [];
  for (let back = howMany - 1; back >= 0; back -= 1) {
    const at = midnightOf(today - back * DAY);
    out.push(known.get(at) ?? { at, tokens: 0, cost: 0, models: [] });
  }
  return out;
}

/** What the day `at` falls in cost. */
export function costOnDay(days: readonly DayTokens[], at: number): number {
  const wanted = midnightOf(at);
  return days.find((one) => one.at === wanted)?.cost ?? 0;
}

/** What the calendar month `at` falls in has cost so far. */
export function costInMonth(days: readonly DayTokens[], at: number): number {
  const when = new Date(at);
  const year = when.getFullYear();
  const month = when.getMonth();
  let sum = 0;
  for (const day of days) {
    const on = new Date(day.at);
    if (on.getFullYear() === year && on.getMonth() === month) sum += day.cost;
  }
  return sum;
}

/** Tokens said the way a person reads them: 1.2k, 3.4m. */
export function saysTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens >= 10_000_000 ? 0 : 1)}m`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(tokens >= 100_000 ? 0 : 1)}k`;
  return String(Math.round(tokens));
}

/** A day as a spreadsheet wants it: 2026-09-02. */
function isoDay(at: number): string {
  const day = new Date(at);
  const two = (value: number): string => String(value).padStart(2, '0');
  return `${String(day.getFullYear())}-${two(day.getMonth() + 1)}-${two(day.getDate())}`;
}

/** A field a spreadsheet will not misread. */
function cell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** The days, split by model, as a CSV somebody can put through expenses. */
export function spendCsv(view: TokenUsageView): string {
  const lines = ['Day,Model,Tokens,Cost'];
  for (const day of view.days) {
    if (day.models.length === 0) {
      lines.push(`${isoDay(day.at)},,${String(day.tokens)},${day.cost.toFixed(2)}`);
      continue;
    }
    for (const model of day.models) {
      lines.push(
        `${isoDay(day.at)},${cell(model.model)},${String(model.tokens)},${model.cost.toFixed(2)}`,
      );
    }
  }
  return `${lines.join('\n')}\n`;
}
