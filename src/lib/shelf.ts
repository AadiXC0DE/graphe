/** The shelf's arithmetic.
 *
 * Which conversations a typed word keeps, and the day they fall under. Pure, so
 * the rail can be argued about without rendering it.
 */

import { groupVersions, type Moment } from '../history/grouping';

/* -------------------------------------------------------------------------- */
/* Conversations                                                               */
/* -------------------------------------------------------------------------- */

/** Past this many, a column of names stops being something you can scan. */
export const SEARCH_APPEARS_AT = 15;

export function needsSearch(howMany: number): boolean {
  return howMany > SEARCH_APPEARS_AT;
}

/** The ones whose name holds every word typed, in the order they came in.
 *  Nothing typed keeps everything. */
export function matching<T extends { title: string }>(
  items: readonly T[],
  term: string,
): readonly T[] {
  const words = term
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word !== '');
  if (words.length === 0) return items;
  return items.filter((one) => {
    const title = one.title.toLowerCase();
    return words.every((word) => title.includes(word));
  });
}

export type Day<T> = {
  /** Stable between renders. */
  key: string;
  /** "Today", "Yesterday", "Tuesday", "3 August". */
  label: string;
  /** Newest first. */
  items: readonly T[];
};

/** A day at a time, newest day first. The timeline already knows how to cut a
 *  list into days and what to call them; this borrows both. */
export function byDay<T extends Moment>(items: readonly T[], now: number): readonly Day<T>[] {
  return groupVersions(items, { now }).groups.map((group) => ({
    key: group.key,
    label: group.label,
    items: group.items,
  }));
}

/** One day's worth reads as a list; two need saying apart. */
export function needsDayLabels(days: readonly Day<unknown>[]): boolean {
  return days.length > 1;
}
