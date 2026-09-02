/** Finding your way around a long conversation.
 *
 * Runs of steps already gather into one row — that is `steps.ts`, and it has
 * been there since the conversation started reading like one. What was missing
 * is everything else about a long thread: finding a word in it without
 * scrolling, and knowing whether the newest thing is on screen at all.
 *
 * Pure. It takes turns and gives back where to look.
 */

import type { Turn } from './thread';

export const threadWords = {
  /** Said on the press that takes somebody back to the newest thing. */
  latest: 'Jump to latest',
  found: (at: number, of: number): string => `${String(at)} of ${String(of)}`,
  nothingFound: 'Not in this conversation.',
  find: 'Find in this conversation',
} as const;

/* -------------------------------------------------------------------------- */
/* Finding something in it                                                     */
/* -------------------------------------------------------------------------- */

/** Where a word was found: which turn, and the line around it. */
export type Found = { at: number; line: string };

/** The words of a turn, whatever kind it is. Only what a person can read — a
 *  search that matches an id somebody never saw is a search that lies. */
export function wordsOf(turn: Turn): string {
  if (turn.kind === 'said') return turn.text;
  if (turn.kind === 'did') {
    const one = turn as { label?: string; detail?: string };
    return [one.label ?? '', one.detail ?? ''].filter((part) => part !== '').join(' ');
  }
  if (turn.kind === 'plan') return turn.steps.join('\n');
  return '';
}

/** Every turn a query is in, in the order they were said. */
export function findIn(turns: readonly Turn[], query: string): readonly Found[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [];
  const found: Found[] = [];
  for (const [at, turn] of turns.entries()) {
    const words = wordsOf(turn);
    const where = words.toLowerCase().indexOf(needle);
    if (where < 0) continue;
    // The line it is on, so a result is legible without opening it.
    const from = words.lastIndexOf('\n', where) + 1;
    const to = words.indexOf('\n', where);
    found.push({ at, line: words.slice(from, to < 0 ? undefined : to).trim() });
  }
  return found;
}

/** The next result after the one somebody is on, wrapping. Null when there are
 *  none — a wrap over an empty list is an infinite loop wearing a hat. */
export function nextFound(found: readonly Found[], from: number | null): number | null {
  if (found.length === 0) return null;
  if (from === null) return found[0]?.at ?? null;
  const after = found.find((one) => one.at > from);
  return (after ?? found[0])?.at ?? null;
}

/* -------------------------------------------------------------------------- */
/* Whether the newest thing is on screen                                       */
/* -------------------------------------------------------------------------- */

/** Near enough to the bottom that new text should keep it there. A few rows of
 *  slack, so a person who scrolled one line up is not fighting the scroller. */
export const NEAR_ENOUGH = 120;

export function atLatest(
  where: { top: number; height: number; scrollHeight: number },
  slack = NEAR_ENOUGH,
): boolean {
  return where.scrollHeight - (where.top + where.height) <= slack;
}
