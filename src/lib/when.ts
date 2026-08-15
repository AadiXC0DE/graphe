/** When something happened, said the way a person would say it.
 *
 * The timeline is scanned, not read: somebody is looking for the moment before
 * it went wrong, and they are looking for it by feel. "18 minutes ago" is a
 * feeling. A timestamp is a lookup.
 *
 * Rounded on purpose, and rounded down. "2 minutes ago" for anything between two
 * and three is what people mean when they say it, and a list that reads
 * "2 minutes ago, 2 minutes ago, 3 minutes ago" is a list nobody trusts to be
 * about anything.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
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
];

/** Midnight at the start of whatever day this moment is in. */
function startOfDay(at: Date): number {
  return new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime();
}

/** "6:12pm". Lower case and closed up, because it sits inside a sentence rather
 *  than in a column of times. */
export function clockTime(at: Date): string {
  const hours = at.getHours();
  const minutes = String(at.getMinutes()).padStart(2, '0');
  const half = hours < 12 ? 'am' : 'pm';
  const twelve = hours % 12 === 0 ? 12 : hours % 12;
  return `${twelve}:${minutes}${half}`;
}

/**
 * How long ago, in words.
 *
 * `now` is a parameter rather than a call to the clock so this is a function of
 * its arguments and nothing else — which is the only way a test of it means
 * anything.
 */
export function ago(at: number, now: number = Date.now()): string {
  const since = now - at;

  // A version saved a moment ago, and the small amount of clock skew that comes
  // from a folder written on another machine. Both are "just now"; neither is
  // worth a number, and a negative one would be alarming.
  if (since < 45 * 1000) return 'Just now';
  // Up to two whole minutes, because rounding down turns anything under that
  // into "1 minutes ago", and a plural nobody would say is the sort of thing
  // that makes an interface look like it was assembled rather than written.
  if (since < 2 * MINUTE) return 'A minute ago';
  if (since < HOUR) return `${Math.floor(since / MINUTE)} minutes ago`;
  if (since < 2 * HOUR) return 'An hour ago';

  const then = new Date(at);
  const today = startOfDay(new Date(now));

  if (at >= today) return `${Math.floor(since / HOUR)} hours ago`;
  if (at >= today - DAY) return `Yesterday, ${clockTime(then)}`;
  if (at >= today - 6 * DAY) return `${DAYS[then.getDay()] ?? ''}, ${clockTime(then)}`;

  const month = MONTHS[then.getMonth()] ?? '';
  const sameYear = then.getFullYear() === new Date(now).getFullYear();
  return sameYear
    ? `${then.getDate()} ${month}`
    : `${then.getDate()} ${month} ${then.getFullYear()}`;
}

/** The same thing, for a sentence that already has a preposition in front of it:
 *  "Put back to 2 minutes ago". */
export function agoInSentence(at: number, now: number = Date.now()): string {
  const said = ago(at, now);
  return said === 'Just now' ? 'a moment ago' : said.charAt(0).toLowerCase() + said.slice(1);
}

/** How long a run went for, the compact way a footer says it: "48m" or "2h 5m".
 *  Seconds in, whole minutes and hours out, minutes alone below an hour. */
export function durationInWords(totalSeconds: number): string {
  const minutes = Math.max(1, Math.round(totalSeconds / 60));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

