/** Versions, arranged the way a timeline is actually read.
 *
 * A rail that draws every version it has is a rail nobody scrolls to the bottom
 * of. So the list arrives already in shape: the ones somebody chose to keep at
 * the top, then a bucket per day, newest first, with a label a person would say
 * out loud.
 *
 * `now` is a parameter and never the clock, so a test of this means something
 * and a rail rendered at 23:59 does not disagree with itself a minute later.
 */

const DAY = 24 * 60 * 60 * 1000;

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

/** How many of a day's versions are worth showing before somebody asks for the
 *  rest. Eight is two rows of four, or four rows of two in a narrow rail. */
export const FIRST_GLANCE = 8;

/** The least this module needs to know about a version. */
export type Moment = {
  id: string;
  /** Epoch ms. */
  at: number;
};

export type VersionGroup<T> = {
  /** Stable between renders, so "this one is open" survives a new version. */
  key: string;
  /** "Kept", "Today", "Yesterday", "Tuesday", "3 August". */
  label: string;
  kind: 'kept' | 'day';
  /** Newest first. */
  items: readonly T[];
  /** Today and the kept shelf start open; older days start folded away. */
  openByDefault: boolean;
};

export type Grouping<T> = {
  now: number;
  /** Ids somebody chose to keep. They come out in their own group, once. */
  kept?: readonly string[];
  /** Drop the versions that look exactly like the one before them. */
  onlyChanged?: boolean;
  pictureOf?: (version: T) => string | null | undefined;
  /** Never dropped, whatever the picture says — a named moment matters even
   *  when nothing moved on screen. */
  spare?: (version: T) => boolean;
};

export type Grouped<T> = {
  groups: readonly VersionGroup<T>[];
  /** How many the "only when it changed" fold is holding back. */
  folded: number;
};

/** Midnight at the start of whatever day this moment is in, locally. */
export function startOfDay(at: number): number {
  const when = new Date(at);
  return new Date(when.getFullYear(), when.getMonth(), when.getDate()).getTime();
}

/** Which calendar day this is, as something safe to use as a key. */
export function dayKey(at: number): string {
  const when = new Date(at);
  const month = String(when.getMonth() + 1).padStart(2, '0');
  const day = String(when.getDate()).padStart(2, '0');
  return `${when.getFullYear()}-${month}-${day}`;
}

/** The day, in words. Rounded whole days rather than milliseconds, so the hour
 *  the clocks change does not shift a label. */
export function dayLabel(at: number, now: number): string {
  const back = Math.round((startOfDay(now) - startOfDay(at)) / DAY);
  if (back <= 0) return 'Today';
  if (back === 1) return 'Yesterday';

  const then = new Date(at);
  if (back <= 6) return DAYS[then.getDay()] ?? '';

  const month = MONTHS[then.getMonth()] ?? '';
  return then.getFullYear() === new Date(now).getFullYear()
    ? `${then.getDate()} ${month}`
    : `${then.getDate()} ${month} ${then.getFullYear()}`;
}

/**
 * The ones that look exactly like the moment before them.
 *
 * Most versions change a file and nothing a designer can see; in a visual
 * history those are the noise. Only an identical picture counts — a version we
 * have no picture of is never called unchanged, because we do not know.
 */
export function looksTheSame<T extends Moment>(
  versions: readonly T[],
  pictureOf: (version: T) => string | null | undefined,
): ReadonlySet<string> {
  const newestFirst = [...versions].sort((one, other) => other.at - one.at);
  const same = new Set<string>();

  for (let at = 0; at < newestFirst.length - 1; at += 1) {
    const one = newestFirst[at];
    const before = newestFirst[at + 1];
    if (one === undefined || before === undefined) continue;
    const picture = pictureOf(one);
    const earlier = pictureOf(before);
    if (picture && earlier && picture === earlier) same.add(one.id);
  }

  return same;
}

/** Versions in the order the rail draws them: kept first, then a day at a
 *  time, newest day first and newest within the day. */
export function groupVersions<T extends Moment>(
  versions: readonly T[],
  how: Grouping<T>,
): Grouped<T> {
  const newestFirst = [...versions].sort((one, other) => other.at - one.at);
  const kept = new Set(how.kept ?? []);

  let shown = newestFirst;
  let folded = 0;
  if (how.onlyChanged === true && how.pictureOf) {
    const same = looksTheSame(newestFirst, how.pictureOf);
    shown = newestFirst.filter(
      (one) => !same.has(one.id) || kept.has(one.id) || how.spare?.(one) === true,
    );
    folded = newestFirst.length - shown.length;
  }

  const groups: VersionGroup<T>[] = [];

  const keptOnes = shown.filter((one) => kept.has(one.id));
  if (keptOnes.length > 0) {
    groups.push({ key: 'kept', label: 'Kept', kind: 'kept', items: keptOnes, openByDefault: true });
  }

  // Insertion order is already newest-day-first, because `shown` is.
  const byDay = new Map<string, { at: number; items: T[] }>();
  for (const one of shown) {
    if (kept.has(one.id)) continue;
    const key = dayKey(one.at);
    const bucket = byDay.get(key);
    if (bucket) bucket.items.push(one);
    else byDay.set(key, { at: one.at, items: [one] });
  }

  let newest = true;
  for (const [key, day] of byDay) {
    const label = dayLabel(day.at, how.now);
    groups.push({
      key,
      label,
      kind: 'day',
      items: day.items,
      // The newest day is open even when it is not today: a rail whose every
      // group is folded looks empty.
      openByDefault: newest || label === 'Today',
    });
    newest = false;
  }

  return { groups, folded };
}
