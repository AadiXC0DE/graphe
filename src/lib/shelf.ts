/** The shelf's arithmetic.
 *
 * What a page row has to say about itself, which conversations a typed word
 * keeps, the day they fall under, and the order the parts band draws in. Pure,
 * so the rail can be argued about without rendering it.
 */

import { groupVersions, type Moment } from '../history/grouping';
import type { Page } from '../preview/pages';

/* -------------------------------------------------------------------------- */
/* Pages                                                                       */
/* -------------------------------------------------------------------------- */

/** A page, plus whatever the app happens to know about it. Every extra is
 *  optional, so a caller that knows only the route still gets a row. */
export type ShelfPage = Page & {
  /** A picture of it, as anything an image can take. */
  picture?: string;
  /** The one the live preview is pointed at. */
  showing?: boolean;
  /** It moved in the newest version. */
  changed?: boolean;
  /** How many things are wrong with it. */
  problems?: number;
};

export type PageMark = {
  showing: boolean;
  changed: boolean;
  problems: number;
  /** The same state in words, for anyone who cannot see the marks. */
  says: string | null;
};

/** A count somebody handed us, as a number of things. Nonsense and negatives
 *  are none, because a row is never worth a wrong badge. */
function countOf(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

/** What a page row shows, from what little it was told. */
export function markOf(page: ShelfPage): PageMark {
  const showing = page.showing === true;
  const changed = page.changed === true;
  const problems = countOf(page.problems);

  const words: string[] = [];
  if (showing) words.push('Open in the preview');
  if (changed) words.push('Changed in the newest version');
  if (problems === 1) words.push('1 thing to fix');
  else if (problems > 1) words.push(`${problems} things to fix`);

  return { showing, changed, problems, says: words.length === 0 ? null : words.join(', ') };
}

/** What somebody typed, as a name worth asking for — or nothing at all. A
 *  leading slash is how a designer writes an address, not part of the name. */
export function cleanPageName(typed: string): string | null {
  const said = typed
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[/\\]+|[/\\]+$/g, '')
    .trim();
  return said === '' ? null : said.slice(0, 60);
}

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

/* -------------------------------------------------------------------------- */
/* Parts                                                                       */
/* -------------------------------------------------------------------------- */

/** One of the pieces a project is built from, named the way a designer names
 *  it rather than the way a file does. */
export type Part = {
  id: string;
  /** "Button", "Card", "Text field". */
  name: string;
  /** How many places use it. */
  uses?: number;
  /** The file it lives in, when there is one to open. */
  file?: string;
};

/** The most-used first, then alphabetical. One row per part however many times
 *  it was handed to us. */
export function partsInOrder(parts: readonly Part[]): readonly Part[] {
  const seen = new Map<string, Part>();
  for (const part of parts) if (!seen.has(part.id)) seen.set(part.id, part);
  return [...seen.values()].sort((one, other) => {
    const gap = countOf(other.uses) - countOf(one.uses);
    return gap !== 0 ? gap : one.name.localeCompare(other.name);
  });
}
