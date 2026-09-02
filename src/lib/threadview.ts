/** The conversation as something to read, rather than everything that happened.
 *
 * A long turn is forty steps — read a file, read another, run the tests, read
 * the failure — and every one of them is a row. The work is legible; the
 * reading of it is not, because the sentence somebody actually wants is nine
 * screens above the last `read`.
 *
 * So steps that belong together fold into one line with a count and how long
 * they took, and open again on a press. Nothing is hidden: a fold says what is
 * in it, and the failures never fold, because a failure is the thing somebody
 * came to find.
 *
 * With it: finding a word in a conversation, and knowing whether the newest
 * thing is on screen.
 *
 * Pure. It takes turns and gives back what to draw.
 */

import type { Turn } from './thread';

/** As few as is worth folding. Two rows folded into one line saves nothing and
 *  costs a press. */
export const WORTH_FOLDING = 3;

export const threadWords = {
  /** The fold's own line. Says what is in it, because a fold that does not is
   *  the app deciding something was not worth seeing. */
  folded: (steps: number, seconds: number): string =>
    seconds >= 1
      ? `${String(steps)} steps · ${String(seconds)}s`
      : `${String(steps)} steps`,
  open: 'Show these',
  close: 'Fold these',
  /** Said on the press that takes somebody back to the newest thing. */
  latest: 'Jump to latest',
  found: (at: number, of: number): string => `${String(at)} of ${String(of)}`,
  nothingFound: 'Not in this conversation.',
} as const;

/* -------------------------------------------------------------------------- */
/* Folding                                                                     */
/* -------------------------------------------------------------------------- */

/** One row of the thread as drawn: a turn, or a fold standing for several. */
export type Row =
  | { kind: 'turn'; turn: Turn; at: number }
  | { kind: 'folded'; turns: readonly Turn[]; from: number; steps: number; seconds: number };

/** Whether a turn is a step that may fold into its neighbours. */
function foldable(turn: Turn): boolean {
  // A step that failed is the thing somebody came to find. It never folds.
  if (turn.kind !== 'did') return false;
  return turn.state === 'done';
}

/**
 * How long a run of steps covered, in whole seconds.
 *
 * From the first step's start to the last one's, because a step records when it
 * began and not how long it took. That is the span rather than the sum, which
 * is the honest number anyway: steps in one batch run at the same time, and
 * adding them up would claim six seconds for two seconds of work.
 *
 * Zero when the steps never said when they began — an older transcript, or a
 * step that arrived without one.
 */
function secondsOf(turns: readonly Turn[]): number {
  const times = turns
    .map((one) => (one.kind === 'did' ? one.at : undefined))
    .filter((one): one is number => typeof one === 'number');
  if (times.length < 2) return 0;
  return Math.round((Math.max(...times) - Math.min(...times)) / 1000);
}

/**
 * The thread as rows, with runs of finished steps folded.
 *
 * `opened` is the set of fold starts somebody has pressed open, so a fold stays
 * open while more arrives above and below it — folding it again under somebody
 * reading it is the bug this is written to avoid.
 */
export function rowsOf(
  turns: readonly Turn[],
  opened: ReadonlySet<number> = new Set(),
  worthFolding = WORTH_FOLDING,
): readonly Row[] {
  const rows: Row[] = [];
  let at = 0;
  while (at < turns.length) {
    const turn = turns[at];
    if (turn === undefined) break;
    if (!foldable(turn)) {
      rows.push({ kind: 'turn', turn, at });
      at += 1;
      continue;
    }
    let end = at;
    while (end < turns.length) {
      const one = turns[end];
      if (one === undefined || !foldable(one)) break;
      end += 1;
    }
    const run = turns.slice(at, end);
    // The last step of a run stays out of the fold: it is the one that just
    // happened, and folding it makes a live run look like nothing is going on.
    const live = end === turns.length;
    const foldTo = live ? end - 1 : end;
    const folding = turns.slice(at, foldTo);
    if (folding.length >= worthFolding && !opened.has(at)) {
      rows.push({
        kind: 'folded',
        turns: folding,
        from: at,
        steps: folding.length,
        seconds: secondsOf(folding),
      });
      for (let more = foldTo; more < end; more += 1) {
        const one = turns[more];
        if (one !== undefined) rows.push({ kind: 'turn', turn: one, at: more });
      }
    } else {
      for (const [where, one] of run.entries()) {
        rows.push({ kind: 'turn', turn: one, at: at + where });
      }
    }
    at = end;
  }
  return rows;
}

/** How many rows a thread is drawn as. What the fold is worth, in one number. */
export function foldedAway(turns: readonly Turn[], opened?: ReadonlySet<number>): number {
  return turns.length - rowsOf(turns, opened).length;
}

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
