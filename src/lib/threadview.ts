/** Finding your way around a long conversation.
 *
 * Runs of steps already gather into one row — that is `steps.ts`, and it has
 * been there since the conversation started reading like one. What was missing
 * is everything else about a long thread: finding a word in it without
 * scrolling, and knowing whether the newest thing is on screen at all.
 *
 * Pure. It takes turns and gives back where to look.
 */

import { lastTurns } from "./hydrate";
import { rows, type Row } from "./steps";
import type { Turn } from "./thread";

export const threadWords = {
  /** Said on the press that takes somebody back to the newest thing. */
  latest: "Jump to latest",
  /** The press above a long conversation's tail. Says how many, because "load
   *  more" gives nobody any idea whether pressing it is a page or an hour. */
  earlier: (many: number): string =>
    many === 1 ? "Show 1 earlier turn" : `Show ${String(many)} earlier turns`,
  found: (at: number, of: number): string => `${String(at)} of ${String(of)}`,
  nothingFound: "Not in this conversation.",
  find: "Find in this conversation",
  /** Said on the press that forks the conversation at one message, while that
   *  message is still being written — there is no finished exchange to stop a
   *  copy at yet. */
  forkWaits: "Fork here waits until this turn finishes.",
} as const;

/* -------------------------------------------------------------------------- */
/* Finding something in it                                                     */
/* -------------------------------------------------------------------------- */

/** Where a word was found: which turn, and the line around it. */
export type Found = { at: number; line: string };

/** The words of a turn, whatever kind it is. Only what a person can read — a
 *  search that matches an id somebody never saw is a search that lies. */
export function wordsOf(turn: Turn): string {
  if (turn.kind === "said") return turn.text;
  if (turn.kind === "did") {
    const one = turn as { label?: string; detail?: string };
    return [one.label ?? "", one.detail ?? ""]
      .filter((part) => part !== "")
      .join(" ");
  }
  if (turn.kind === "plan") return turn.steps.join("\n");
  return "";
}

/** Every turn a query is in, in the order they were said. */
export function findIn(
  turns: readonly Turn[],
  query: string,
): readonly Found[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [];
  const found: Found[] = [];
  for (const [at, turn] of turns.entries()) {
    const words = wordsOf(turn);
    const where = words.toLowerCase().indexOf(needle);
    if (where < 0) continue;
    // The line it is on, so a result is legible without opening it.
    const from = words.lastIndexOf("\n", where) + 1;
    const to = words.indexOf("\n", where);
    found.push({ at, line: words.slice(from, to < 0 ? undefined : to).trim() });
  }
  return found;
}

/** The next result after the one somebody is on, wrapping. Null when there are
 *  none — a wrap over an empty list is an infinite loop wearing a hat. */
export function nextFound(
  found: readonly Found[],
  from: number | null,
): number | null {
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

/* -------------------------------------------------------------------------- */
/* The rows a transcript is drawn from                                         */
/* -------------------------------------------------------------------------- */

/** What one conversation draws: the rows, which of them is the last reply, and
 *  where each message stands.
 *
 * Here rather than inline at the call site because two panes now draw two
 * conversations, and the arithmetic that decides which rows exist and where a
 * fork may stop must be one piece of arithmetic: two hand-written copies is how
 * the same conversation comes to look different in two views of it.
 *
 * `drawing` is how much of the tail is in the document at all — nobody reopens
 * a sitting to read the top of it, and a ten-thousand-turn thread draws its
 * last few hundred with the rest one press away.
 */
export function drawnFrom(
  turns: readonly Turn[],
  drawing: number,
  keepApart: ReadonlySet<string> = new Set(),
): {
  readonly rows: readonly Row[];
  readonly earlier: number;
  /** The last message the agent said, by row index, or -1 when it said none. */
  readonly lastReply: number;
  /** How many things the person had said by each message, the one coordinate
   *  this window and the record share. */
  readonly stands: ReadonlyMap<string, number>;
} {
  const paged = lastTurns(turns, drawing);
  const all = rows(paged.turns, keepApart);
  const backwards = [...all]
    .reverse()
    .findIndex(
      (row) =>
        row.kind !== "steps" &&
        row.turn.kind === "said" &&
        row.turn.from === "graphe",
    );
  const stands = new Map<string, number>();
  let saidSoFar = 0;
  for (const one of all) {
    if (one.kind === "steps" || one.turn.kind !== "said") continue;
    if (one.turn.from === "you" && one.turn.text.trim() !== "") saidSoFar += 1;
    if (saidSoFar > 0) stands.set(one.turn.id, saidSoFar);
  }
  return {
    rows: all,
    earlier: paged.earlier,
    lastReply: backwards === -1 ? -1 : all.length - 1 - backwards,
    stands,
  };
}
