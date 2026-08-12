/** When something asked for on a repeat happens next.
 *
 * Pure, and `now` is always an argument. Nothing in here reads a clock, so the
 * answer a test gets is the answer a machine gets, and the awkward days — the
 * morning an hour goes missing, the 31st of a month with thirty days, a laptop
 * that was shut through Tuesday — can all be written down rather than hoped for.
 *
 * Everything is worked out in the wall-clock time of the machine, because "every
 * morning at seven" means seven in the morning where the person is, and the
 * platform's own calendar already knows when that is. Building each candidate as
 * a local date is what makes the clocks changing a non-event.
 */

export type TimeOfDay = { hour: number; minute: number };

/** Sunday is 0, the same as everywhere else that counts days. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** The four rhythms worth offering. Each is a sentence somebody would say out
 *  loud, which is the test for whether a fifth one belongs here. */
export type Repeat =
  | { every: 'day'; at: TimeOfDay }
  | { every: 'weekday'; at: TimeOfDay }
  | { every: 'week'; on: Weekday; at: TimeOfDay }
  | { every: 'month'; on: number; at: TimeOfDay };

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Far enough ahead to find the 29th of February, and bounded so a rule nothing
 *  matches ends rather than spins. */
const HORIZON = 400;

/** How late a missed one may be and still be worth doing. Past this it is
 *  yesterday's news, and the useful thing is the next one rather than a stale
 *  answer arriving as though it were fresh. */
export const TOO_LATE = DAY;

/* -------------------------------------------------------------------------- */
/* Reading a rule                                                              */
/* -------------------------------------------------------------------------- */

function whole(value: number, low: number, high: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(high, Math.max(low, Math.trunc(value)));
}

/** A rule as it will actually be used: out-of-range numbers pulled into range
 *  rather than refused, because a rule nobody can act on is worse than one that
 *  runs an hour off what was typed. */
export function readRepeat(repeat: Repeat): Repeat {
  const at: TimeOfDay = {
    hour: whole(repeat.at.hour, 0, 23, 9),
    minute: whole(repeat.at.minute, 0, 59, 0),
  };
  if (repeat.every === 'week') return { every: 'week', on: whole(repeat.on, 0, 6, 1) as Weekday, at };
  if (repeat.every === 'month') return { every: 'month', on: whole(repeat.on, 1, 31, 1), at };
  return { every: repeat.every, at };
}

/** How many days that month has, asked of the calendar rather than remembered. */
export function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

/** The last day of a short month stands in for a day it does not have, so "the
 *  31st" still happens in February. */
function dayThatMonth(year: number, month: number, wanted: number): number {
  return Math.min(wanted, daysInMonth(year, month));
}

function fallsOn(repeat: Repeat, date: Date): boolean {
  if (repeat.every === 'day') return true;
  if (repeat.every === 'weekday') {
    const weekday = date.getDay();
    return weekday >= 1 && weekday <= 5;
  }
  if (repeat.every === 'week') return date.getDay() === repeat.on;
  return date.getDate() === dayThatMonth(date.getFullYear(), date.getMonth(), repeat.on);
}

/* -------------------------------------------------------------------------- */
/* The next one                                                                */
/* -------------------------------------------------------------------------- */

/**
 * When this rule next comes round, strictly after the moment given.
 *
 * Never equal to `after`, so asking again the instant one has happened moves on
 * rather than answering with the same moment forever.
 *
 * On the morning the clocks go forward, a time that does not exist that day —
 * half past two, in most places — happens the moment it does exist, because the
 * calendar reads it that way and pretending otherwise would mean skipping the
 * day. On the morning they go back, the first of the two is the one taken.
 */
export function nextRun(repeat: Repeat, after: number): number {
  const rule = readRepeat(repeat);
  const from = new Date(after);
  for (let step = 0; step <= HORIZON; step += 1) {
    const day = new Date(from.getFullYear(), from.getMonth(), from.getDate() + step);
    if (!fallsOn(rule, day)) continue;
    const at = new Date(
      day.getFullYear(),
      day.getMonth(),
      day.getDate(),
      rule.at.hour,
      rule.at.minute,
      0,
      0,
    ).getTime();
    if (at > after) return at;
  }
  // Unreachable for every rule this type can hold; a year of days always
  // contains one of each. Answered rather than thrown, because a rule that
  // cannot be worked out should stop happening, not stop the app.
  return after + DAY;
}

export type Standing = {
  /** When it last actually ran, or null when it never has. */
  lastRunAt: number | null;
  now: number;
  /** How late a missed one may be and still be worth doing. */
  tooLate?: number;
};

/**
 * Whether to do it now, and when the one after that is.
 *
 * The whole of the asleep-through-it problem is here. A machine shut from Friday
 * to Monday has missed a Saturday and a Sunday, and the answer is one run, not
 * two: the missed moment is looked at, not counted. Past `tooLate` even that is
 * let go, because an answer about Saturday arriving on Monday reads as an answer
 * about Monday.
 */
export function whenNext(repeat: Repeat, standing: Standing): { runNow: boolean; nextAt: number } {
  const { lastRunAt, now } = standing;
  const tooLate = standing.tooLate ?? TOO_LATE;
  if (lastRunAt === null) return { runNow: false, nextAt: nextRun(repeat, now) };

  const due = nextRun(repeat, lastRunAt);
  if (due > now) return { runNow: false, nextAt: due };
  if (now - due > tooLate) return { runNow: false, nextAt: nextRun(repeat, now) };
  return { runNow: true, nextAt: nextRun(repeat, now) };
}

/* -------------------------------------------------------------------------- */
/* Saying it                                                                   */
/* -------------------------------------------------------------------------- */

const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** Twelve-hour, because that is how the audience says the time. */
export function clockOf(at: TimeOfDay): string {
  const { hour, minute } = readRepeat({ every: 'day', at }).at;
  const half = hour < 12 ? 'am' : 'pm';
  const shown = hour % 12 === 0 ? 12 : hour % 12;
  return `${String(shown)}:${String(minute).padStart(2, '0')}${half}`;
}

function ordinal(day: number): string {
  const tens = day % 100;
  if (tens >= 11 && tens <= 13) return `${String(day)}th`;
  const last = day % 10;
  const suffix = last === 1 ? 'st' : last === 2 ? 'nd' : last === 3 ? 'rd' : 'th';
  return `${String(day)}${suffix}`;
}

/** The rule, in the words somebody would have used to ask for it. */
export function saysRepeat(repeat: Repeat): string {
  const rule = readRepeat(repeat);
  const time = clockOf(rule.at);
  if (rule.every === 'day') return `Every day at ${time}`;
  if (rule.every === 'weekday') return `Every weekday at ${time}`;
  if (rule.every === 'week') return `Every ${DAY_NAMES[rule.on] ?? 'Monday'} at ${time}`;
  return `The ${ordinal(rule.on)} of every month at ${time}`;
}

/** Which calendar day one moment is on relative to another, in whole days. */
function daysApart(at: number, now: number): number {
  const one = new Date(at);
  const other = new Date(now);
  const from = new Date(other.getFullYear(), other.getMonth(), other.getDate()).getTime();
  const to = new Date(one.getFullYear(), one.getMonth(), one.getDate()).getTime();
  return Math.round((to - from) / DAY);
}

/** When the next one is, said the way a person would say it. */
export function saysNext(at: number, now: number): string {
  const time = clockOf({ hour: new Date(at).getHours(), minute: new Date(at).getMinutes() });
  if (at <= now) return 'Any moment now';
  if (at - now < HOUR) {
    const minutes = Math.max(1, Math.round((at - now) / MINUTE));
    return minutes === 1 ? 'In a minute' : `In ${String(minutes)} minutes`;
  }
  const days = daysApart(at, now);
  if (days === 0) return `Later today at ${time}`;
  if (days === 1) return `Tomorrow at ${time}`;
  if (days < 7) return `On ${DAY_NAMES[new Date(at).getDay()] ?? 'Monday'} at ${time}`;
  const when = new Date(at);
  return `On ${String(when.getDate())} ${MONTH_NAMES[when.getMonth()] ?? ''} at ${time}`.replace(
    /\s+/g,
    ' ',
  );
}
