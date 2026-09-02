/** Two or three goes at the same job, each held against the base they started
 *  from, so the question "which of these do I take?" has an answer on screen.
 *
 * `src/lib/against.ts` already lines several diffs up file by file. What it
 * does not carry is the base — the commit every attempt branched from — and
 * without it a sheet of three columns is three unrelated patches. This adds
 * that: what each attempt did against one known starting point, which files
 * every attempt agreed about, and what taking one of them means for the rest.
 *
 * Taking one is the whole point, so it is a function rather than a note on a
 * card: `pickOne` says what to land and what to drop, and a caller that runs it
 * blind still gets the right two lists.
 *
 * Pure: diff text in, an arrangement out. No disk, no git.
 */

import { countsOf, parseDiff } from '../diff/hunks';
import { compare as lineUp, isFinal, canTake, type Side } from '../lib/against';
import type { WorkState } from './board';

/** One go at the job. The same shape a card on the board carries, plus the
 *  patch it produced. */
export type Attempt = {
  id: string;
  /** What it is called where somebody reads it — "Way 2 of 3". */
  name: string;
  state: WorkState;
  /** Unified diff of everything it changed, against the base. */
  diff: string;
  picture?: string | null;
  spent?: string | null;
};

/** One file, and what each attempt did to it. */
export type FileRow = {
  path: string;
  /** The attempts that touched it, in the order they were given. */
  touched: readonly string[];
  /** True unless every attempt made the same change to it. A file only one of
   *  three touched differs: the other two chose not to. */
  differs: boolean;
  /** Keyed by attempt id. An attempt that left the file alone has no entry. */
  counts: Readonly<Record<string, { added: number; removed: number }>>;
};

/** One column's heading: what this attempt came to overall. */
export type Column = {
  id: string;
  name: string;
  files: number;
  added: number;
  removed: number;
  /** The line under the name. Says "so far" while the numbers can still move. */
  line: string;
  /** Nothing more will be added to it. */
  final: boolean;
  /** There is a result here to take. */
  canTake: boolean;
};

export type Comparison = {
  /** What all of them started from, named so the columns mean something. */
  base: string;
  attempts: readonly Column[];
  files: readonly FileRow[];
  /** Files every attempt changed in exactly the same way — nothing to decide. */
  sameInAll: readonly string[];
  /** The rest, which is what the sheet is for. */
  differing: readonly string[];
  /** The line under the heading. */
  says: string;
};

export const compareWords = {
  heading: 'Side by side',
  against: (base: string): string => `Each one against ${base}`,
  keep: 'Use this one',
  nothing: 'None of these changed anything.',
  changedNothing: 'Changed nothing',
  total: (files: number, added: number, removed: number): string =>
    files === 0
      ? 'Changed nothing'
      : `${String(files)} ${files === 1 ? 'file' : 'files'}, +${String(added)} −${String(removed)}`,
  soFar: (files: number, added: number, removed: number): string =>
    files === 0
      ? 'Nothing changed yet'
      : `${String(files)} ${files === 1 ? 'file' : 'files'} so far, +${String(added)} −${String(removed)}`,
  /** Said on the press that takes the decision, so nobody expects the others to
   *  still be there afterwards. */
  insteadOf: (name: string, others: readonly string[]): string =>
    others.length === 0
      ? `Landing ${name}.`
      : `Landing ${name} throws away ${others.length === 1 ? others[0] ?? 'the other one' : `the other ${String(others.length)}`}.`,
  summary: (differing: number, same: number): string => {
    const files = (count: number): string =>
      `${String(count)} ${count === 1 ? 'file' : 'files'}`;
    if (differing === 0 && same === 0) return 'None of these changed anything.';
    if (differing === 0)
      return `Nothing to decide: all of them made the same change to ${files(same)}.`;
    if (same === 0) return `${files(differing)} to decide about.`;
    return `${files(differing)} to decide about, and ${files(same)} that came out the same in all of them.`;
  },
  stillGoing: (count: number): string =>
    count === 1
      ? 'One of them is still going, so what it shows can still change.'
      : `${String(count)} of them are still going, so what they show can still change.`,
} as const;

/** An attempt is a side, once it is told what it is being compared against. */
function asSide(one: Attempt): Side {
  return {
    id: one.id,
    name: one.name,
    state: one.state,
    diff: one.diff,
    picture: one.picture ?? null,
    spent: one.spent ?? null,
  };
}

function columnOf(one: Attempt): Column {
  const counted = countsOf(parseDiff(one.diff));
  const final = isFinal(one);
  return {
    id: one.id,
    name: one.name,
    files: counted.files,
    added: counted.added,
    removed: counted.removed,
    line: final
      ? compareWords.total(counted.files, counted.added, counted.removed)
      : compareWords.soFar(counted.files, counted.added, counted.removed),
    final,
    canTake: canTake(one),
  };
}

/**
 * Every attempt against one base, file by file.
 *
 * Files are in name order, so the same three runs draw the same list twice. An
 * attempt that produced nothing still gets a column: an empty one is a result,
 * and leaving it out makes three ways look like two.
 */
export function compare(attempts: readonly Attempt[], base: string): Comparison {
  const lined = lineUp(attempts.map(asSide));
  const same = new Set(lined.sameEverywhere);

  const files: FileRow[] = lined.files.map((one) => ({
    path: one.path,
    touched: one.onlyIn,
    differs: !same.has(one.path),
    counts: one.counts,
  }));

  const differing = files.filter((one) => one.differs).map((one) => one.path);
  const going = attempts.filter((one) => !isFinal(one)).length;
  const counted = compareWords.summary(differing.length, same.size);

  return {
    base,
    attempts: attempts.map(columnOf),
    files,
    sameInAll: [...same],
    differing,
    says: going === 0 ? counted : `${counted} ${compareWords.stillGoing(going)}`,
  };
}

/** What taking one of them means: the one to land, and the ones that go with
 *  the decision. Null when the id is not one of the attempts, so a stale press
 *  on a sheet that has moved on lands nothing at all. */
export function pickOne(
  comparison: Comparison,
  id: string,
): { land: string; drop: readonly string[]; says: string } | null {
  const chosen = comparison.attempts.find((one) => one.id === id);
  if (chosen === undefined) return null;
  const others = comparison.attempts.filter((one) => one.id !== id);
  return {
    land: id,
    drop: others.map((one) => one.id),
    says: compareWords.insteadOf(chosen.name, others.map((one) => one.name)),
  };
}
