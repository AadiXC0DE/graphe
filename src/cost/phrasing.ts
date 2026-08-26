/** Every user-facing sentence the cost module can produce, in one file.
 *
 * It lives here and nowhere else so it can be read end to end and audited as
 * language — test C-01 in notes/strategy/COST-DESIGN.md and L-01 in the test plan. Copy
 * scattered across components cannot be swept; copy in one file can.
 *
 * ## The words that never appear
 *
 * Four of them, from COST-DESIGN.md: the unit models are billed in, the thing
 * that limits how much of a conversation is held, the tidying operation that
 * shortens it, and any product name from the account the user connected. A
 * designer has no reason to know any of those, and a screen that needs one of
 * them to make sense is a screen that needs rewriting. Everything is money, and
 * the choice between two ways of working is "Quick" and "Careful".
 *
 * ## The voice
 *
 * Plain, warm, and never condescending — from research/04 §4: never put the
 * reader's lack in the subject position. So it is "I've stopped rather than keep
 * spending on it", not "you may not realise this is expensive". When something
 * goes wrong the sentence takes the blame, because it was ours: attempts that
 * didn't work are things *we* did, and saying so is the entire point of §3.
 *
 * Every function here takes finished domain objects and returns strings. It
 * computes nothing, so a copy change can never change a number. */

import type { Money } from '../agent/types';
import type { Estimate } from './estimate';
import type { SessionSummary } from './ledger';
import type { LimitPeriod, LimitStatus, SpendLimit } from './limits';
import { formatMoney } from './money';

export type Voice = {
  /** BCP 47 tag. Undefined means the host's own locale. */
  locale?: string;
};

function amount(value: Money, voice: Voice = {}): string {
  return formatMoney(value, { locale: voice.locale });
}

const NUMBER_WORDS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
] as const;

function count(n: number): string {
  return NUMBER_WORDS[n] ?? String(n);
}

/** Time the way someone would say it out loud. "Roughly four minutes", never
 *  "3m 47s" — a precise duration invites you to check it against a stopwatch. */
export function roughDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 45) return 'under a minute';
  const minutes = Math.round(seconds / 60);
  if (minutes <= 1) return 'about a minute';
  if (minutes <= 12) return `roughly ${count(minutes)} minutes`;
  if (minutes < 25) return `roughly ${Math.round(minutes / 5) * 5} minutes`;
  if (minutes < 40) return 'about half an hour';
  if (minutes < 80) return 'about an hour';
  const hours = Math.round(minutes / 60);
  return `about ${count(hours)} hours`;
}

function periodPhrase(period: LimitPeriod): string {
  switch (period) {
    case 'day':
      return 'today';
    case 'session':
      return 'in this sitting';
    case 'month':
      return 'this month';
  }
}

/** Labels arrive as sentences ("Building the contact form") and get spliced into
 *  the middle of another one. Lower the first letter unless it looks like a name. */
function midSentence(label: string): string {
  const first = label[0];
  const second = label[1];
  if (!first) return label;
  if (second && first === first.toUpperCase() && second === second.toUpperCase()) return label;
  return first.toLowerCase() + label.slice(1);
}

/* ------------------------------------------------------------------ the meter */

/** Small, permanent, in the corner, and it never animates. A number that moves
 *  catches the eye every time it changes, which turns awareness into anxiety. */
export const meter = {
  label: 'Spent',
  /** The one line the corner shows. */
  today(total: Money, voice: Voice = {}): string {
    return `Today: ${amount(total, voice)}`;
  },
  screenReaderLabel(total: Money, voice: Voice = {}): string {
    return `Spent so far today: ${amount(total, voice)}`;
  },
  detailsLink: 'See where it went',
  /** The account is paid for by its own plan, so nothing here is a bill. Said
   *  rather than left to be assumed: a running figure beside a plan somebody
   *  already paid for is the meter making a confident claim it cannot check. */
  onAPlan: 'This account is on a plan you already pay for, so this is a rough count and not a bill.',
  /** Share of the prompt that came back free from earlier work. Never "tokens". */
  reused(share: number): string {
    const pct = Math.round(Math.min(1, Math.max(0, share)) * 100);
    if (pct <= 0) return 'Nothing reused from earlier yet';
    if (pct >= 95) return 'Almost everything reused from earlier';
    return `Reused ${pct}% from earlier`;
  },
  /** Which model took most of the bill. The real name is fine here — this is
   *  the details surface, not the ordinary corner. */
  mostUsed(name: string): string {
    return `Mostly ${name}`;
  },
};

/* -------------------------------------------------------- before a bigger job */

export type Prompt = {
  title: string;
  body: string;
  /** Present only when there is something honest to add about the number. */
  note?: string;
  confirm: string;
  alternative: string;
};

/**
 * "This is a bigger job — it will take roughly four minutes. Want me to go
 * ahead?"
 *
 * No number with a currency in front of it, ever. A subscription account is not
 * metered per token, catalogue rates are a guess about somebody else's billing,
 * and a confident price we cannot actually check is worse than no price at all.
 * What is left is the part that was always doing the work: a pause before
 * something big, so nobody watches forty files change without having agreed to
 * it. Time is kept because we measure it ourselves.
 *
 * Only ever shown above the user's own threshold, because a confirm on every
 * small change is noise, and noise gets dismissed without reading.
 */
export function biggerJob(estimate: Estimate, _voice: Voice = {}): Prompt {
  const time =
    estimate.expectedDurationMs === null ? null : roughDuration(estimate.expectedDurationMs);
  const note = estimateNote(estimate);
  return {
    title: 'This is a bigger job',
    body: time ? `It should take ${time}. Want me to go ahead?` : 'Want me to go ahead?',
    ...(note ? { note } : {}),
    confirm: 'Go ahead',
    alternative: 'Do a smaller version first',
  };
}

/** How much this is a guess, said plainly and without a number. A job we have
 *  never done is a job we cannot time either, and saying so is the whole
 *  content of the note. */
export function estimateNote(estimate: Estimate): string | null {
  switch (estimate.confidence) {
    case 'no-history':
      return 'I haven’t done one of these with you yet, so that is a rough guide.';
    case 'few-examples':
      return 'I’ve only done a couple of these so far.';
    case 'measured':
      return null;
  }
}

/* --------------------------------------------------- after a session: the split */

export type SummaryLines = {
  headline: string;
  work: string;
  retry: string;
  /** Every line in order, for a card that just wants to render them. */
  lines: string[];
};

/** The line no competitor can ship, because for them the retries are revenue.
 *
 *     Today: ₹120
 *     ₹85 building what you asked for
 *     ₹35 on attempts that didn't work — mostly me retrying the contact form
 */
export function sessionSummary(summary: SessionSummary, voice: Voice = {}): SummaryLines {
  const headline = `Today: ${amount(summary.total, voice)}`;
  const work = `${amount(summary.work, voice)} building what you asked for`;
  const retry =
    summary.retry.minor === 0
      ? 'Nothing went on attempts that didn’t work this time.'
      : summary.largestRetry
        ? `${amount(summary.retry, voice)} on attempts that didn’t work, mostly me retrying ${midSentence(summary.largestRetry.label)}`
        : `${amount(summary.retry, voice)} on attempts that didn’t work`;

  return { headline, work, retry, lines: [headline, work, retry] };
}

/** When there is no split to show yet. Said rather than left silent: a button
 *  that answers nothing teaches people it is broken. */
export const nothingSpentYet =
  'Nothing has been spent in this project yet, so there is nothing to break down.';

/** Shown beside the split, once, so the number is never mistaken for a charge
 *  from us. It is also the reason we can show it at all. */
export const retryHonesty =
  'Attempts that didn’t work are on me, and we take no cut of any of it: you pay your own account directly.';

/* ------------------------------------------------------------- the ceiling */

export function limitNudge(status: LimitStatus, voice: Voice = {}): string {
  const when = periodPhrase(status.limit.period);
  return `You’ve used ${amount(status.spent, voice)} of the ${amount(status.limit.ceiling, voice)} you set for ${when}. Nothing changes yet. This is just so it isn’t a surprise later.`;
}

/** Reached, not exceeded, and nothing is abandoned to get here. */
export function limitReached(status: LimitStatus, voice: Voice = {}): Prompt {
  const when = periodPhrase(status.limit.period);
  return {
    title: 'You’ve reached the limit you set',
    body: `That’s ${amount(status.limit.ceiling, voice)} for ${when}. I finished what I was in the middle of and saved it, so nothing is left half-done. I’ll wait here until you say otherwise.`,
    confirm: 'Raise the limit',
    alternative: 'Leave it for now',
  };
}

/** Asked *before* starting, so the ceiling is never met halfway through a job. */
export function limitWouldBePassed(
  status: LimitStatus,
  estimate: Estimate,
  voice: Voice = {},
): Prompt {
  const when = periodPhrase(status.limit.period);
  return {
    title: 'This would go past your limit',
    body: `This one looks like about ${amount(estimate.expected, voice)}, and you’ve used ${amount(status.spent, voice)} of ${amount(status.limit.ceiling, voice)} for ${when}. I’d rather ask than find out halfway through.`,
    confirm: 'Raise the limit and carry on',
    alternative: 'Do a smaller version first',
  };
}

export const limitSetup = {
  title: 'Set a limit you’re comfortable with',
  body: 'I’ll say something when you’re getting close, and stop and ask before going past it. You can change it whenever you like.',
  confirm: 'Set the limit',
  alternative: 'Not right now',
  /** On the meter itself, which is where somebody is already looking at the
   *  number when they decide they want a ceiling on it. */
  open: 'Set a limit',
  change: 'Change the limit',
  field: 'Stop at',
  save: 'Set it',
  clear: 'No limit',
  /** What the ceiling actually binds. Said plainly, because "per session" is
   *  the sort of phrase people read past and then feel misled by. */
  scope: 'It holds for this sitting, and starts again next time you open this.',
};

export function limitSaved(limit: SpendLimit, voice: Voice = {}): string {
  return `Set: I’ll stop and ask before going past ${amount(limit.ceiling, voice)} ${periodPhrase(limit.period)}.`;
}

/* ----------------------------------------------------- Quick and Careful */

/** Not two products with names to learn. Two ways of working, chosen the way
 *  you'd choose a pen. */
export const workingStyle = {
  quick: {
    name: 'Quick',
    line: 'For small changes and tweaks. Cheaper, nearly instant.',
  },
  careful: {
    name: 'Careful',
    line: 'For tricky work and big changes. Slower, costs more, thinks harder.',
  },
  automatic: {
    name: 'Let Graphe decide',
    line: 'Quick for small things, Careful when it looks fiddly. You can override it any time.',
  },
};

/** Said quietly, after the fact. The choice was ours to make; this is us showing
 *  our working, not asking permission. */
export function choseStyle(style: 'quick' | 'careful'): string {
  return style === 'careful'
    ? 'This one’s fiddly, so I took the Careful route.'
    : 'This one’s small, so I kept it Quick.';
}

/* -------------------------------------------- long conversations, no lecture */

/** What we say instead of explaining how any of it works. Proactive, before it
 *  becomes expensive, and reassuring about the thing people actually fear:
 *  losing what they already said. */
export const longConversation = {
  tidying:
    'We’ve covered a lot in here. I’ll tidy up my notes so things stay quick. Nothing gets lost, and you can still scroll back through everything.',
  stayedAsIs:
    'I kept this conversation as it is for now. Nothing was changed or lost.',
  newThing: {
    title: 'This looks like a new thing',
    body: 'Starting fresh will be faster and cheaper. I’ll bring everything I know about the project with me, so you won’t have to explain it again.',
    confirm: 'Start fresh',
    alternative: 'Keep going here',
  },
};

/**
 * A service that could not answer, and the wait before asking again.
 *
 * Said because the alternative is a window that looks stopped for half an hour.
 * Whose service and why it could not answer are not this sentence's business —
 * there is nothing anybody can do about either, and naming them only makes the
 * wait feel like somebody's fault.
 */
export const busyService = {
  waiting(seconds: number): string {
    return `The service is busy, so I'll wait ${howLongToWait(seconds)} and carry on where I left off. You can leave this running.`;
  },
  carriedOn: 'Back again, carrying on from where it stopped.',
  gaveUp: 'The service stayed busy, so I stopped rather than keep waiting.',
};

/** A wait, in the roundest words that are still true. */
function howLongToWait(seconds: number): string {
  if (seconds < 90) return 'a minute';
  const minutes = Math.round(seconds / 60);
  return `${String(minutes)} minutes`;
}

/* ------------------------------------------------- runaway protection */

/** Same failure three times, then stop. Never a fourth attempt, and never a
 *  sentence that implies the user should have been watching. */
export function stuckAfterAttempts(
  attempts: number,
  label: string,
  spentSoFar: Money,
  voice: Voice = {},
): Prompt {
  return {
    title: 'I’m going round in circles',
    body: `I’ve tried ${midSentence(label)} ${count(attempts)} times and it still isn’t right. I’ve stopped rather than keep spending on it, and that’s ${amount(spentSoFar, voice)} so far. Everything is saved as it was.`,
    confirm: 'Try a different way',
    alternative: 'Let me take a look',
  };
}

export function unusualRate(recent: Money, voice: Voice = {}): Prompt {
  return {
    title: 'This is costing more than usual',
    body: `${amount(recent, voice)} in the last few minutes, which is faster than this normally goes. I’ve paused so you can decide.`,
    confirm: 'Carry on',
    alternative: 'Stop here',
  };
}

/* ------------------------------------------ connecting an account, day one */

/** Said before they click, not after the first bill. Losing a few signups here
 *  is enormously cheaper than losing trust later. */
export const connectBilling = {
  title: 'How this gets paid for',
  /* Two kinds of account bill in completely different ways, and the person
     choosing between them was told neither. Signing in spends a plan somebody
     already pays monthly; a key is a meter that runs. */
  body: 'Whatever you connect is billed by them, not by us. Signing in uses the plan you already pay for each month. A key is a meter that runs while you work.',
  reassurance:
    'We show what a key is spending as you go, and you can set a limit right now. A plan we cannot read, so we say so rather than guess. We take no cut of either.',
  confirm: 'Set a monthly limit',
  alternative: 'I understand',
  /** Under the sign-in button, so the difference is read where the choice is
   *  made rather than in a paragraph above it. */
  signIn: 'Uses the plan you pay for monthly.',
  /** Under the paste-a-key button, for the same reason. */
  apiKey: 'Billed by use, by them.',
};

/* --------------------------------------------------------------- the sweep */

/** Every string this module can produce, with representative inputs, so the
 *  language audit has something concrete to sweep. Anything added above and
 *  forgotten here is invisible to test C-01, so keep the two in step. */
export function auditableStrings(voice: Voice = {}): string[] {
  const inr = (minor: number): Money => ({ minor, currency: 'INR' });
  const out: string[] = [];

  const push = (value: unknown): void => {
    if (typeof value === 'string') out.push(value);
    else if (Array.isArray(value)) value.forEach(push);
    else if (value && typeof value === 'object') Object.values(value).forEach(push);
  };

  const estimates: Estimate[] = (['no-history', 'few-examples', 'measured'] as const).map(
    (confidence) => ({
      task: { kind: 'contact-form', size: 'feature' },
      expected: inr(3500),
      low: inr(2000),
      high: inr(9000),
      confidence,
      sampleSize: confidence === 'measured' ? 9 : confidence === 'few-examples' ? 2 : 0,
      expectedDurationMs: 4 * 60_000,
    }),
  );

  const limit: SpendLimit = { ceiling: inr(200_000), period: 'month', nudgeAt: 0.8 };
  const statuses: LimitStatus[] = (['month', 'day', 'session'] as const).map((period) => ({
    state: 'nudge',
    limit: { ...limit, period },
    spent: inr(160_000),
    remaining: inr(40_000),
    over: inr(0),
    fraction: 0.8,
    allowsNewWork: true,
    preservesWorkInFlight: true,
  }));

  const summaries: SessionSummary[] = [
    {
      currency: 'INR',
      total: inr(12_000),
      work: inr(8500),
      retry: inr(3500),
      retryShare: 3500 / 12_000,
      entryCount: 7,
      firstAt: 0,
      lastAt: 1,
      largestRetry: { label: 'Building the contact form', amount: inr(3000), entryCount: 3 },
    },
    {
      currency: 'INR',
      total: inr(12_000),
      work: inr(8500),
      retry: inr(3500),
      retryShare: 3500 / 12_000,
      entryCount: 7,
      firstAt: 0,
      lastAt: 1,
      largestRetry: null,
    },
    {
      currency: 'INR',
      total: inr(8500),
      work: inr(8500),
      retry: inr(0),
      retryShare: 0,
      entryCount: 4,
      firstAt: 0,
      lastAt: 1,
      largestRetry: null,
    },
  ];

  push(meter.label);
  push(meter.detailsLink);
  push(meter.onAPlan);
  push(meter.reused(0.72));
  push(nothingSpentYet);
  push(meter.today(inr(12_000), voice));
  push(meter.screenReaderLabel(inr(12_000), voice));
  push(retryHonesty);
  push(limitSetup);
  push(workingStyle);
  push(longConversation);
  push(busyService.waiting(60));
  push(busyService.waiting(1800));
  push(busyService.carriedOn);
  push(busyService.gaveUp);
  push(connectBilling);
  push(choseStyle('quick'));
  push(choseStyle('careful'));
  push(limitSaved(limit, voice));
  push(stuckAfterAttempts(3, 'Building the contact form', inr(1200), voice));
  push(unusualRate(inr(4000), voice));
  for (const estimate of estimates) {
    push(biggerJob(estimate, voice));
    push(estimateNote(estimate));
    for (const status of statuses) push(limitWouldBePassed(status, estimate, voice));
  }
  for (const status of statuses) {
    push(limitNudge(status, voice));
    push(limitReached(status, voice));
  }
  for (const summary of summaries) push(sessionSummary(summary, voice));
  const durations = [10_000, 60_000, 4 * 60_000, 18 * 60_000, 30 * 60_000, 3 * 3_600_000];
  for (const ms of durations) push(roughDuration(ms));

  return out;
}
