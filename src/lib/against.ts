/** Two or three goes at the same job, held up against each other.
 *
 * Several tools will run background work in parallel copies of a project. None
 * of them will tell you how the results differ, which leaves the one question
 * that matters — which of these do I take? — to be answered by opening three
 * folders. This reads each one's change and lines them up file by file.
 *
 * The part nobody has to decide about is worth naming: where every go made the
 * same change to the same file, there is nothing to weigh, and saying so once
 * at the end is shorter than saying it three times per row.
 *
 * Pure: text in, an arrangement out. No disk, no git.
 */

import { countsOf, parseDiff, type FileChange } from '../diff/hunks';
import { canKeep, type WorkState } from '../work/board';

export type Side = {
  id: string;
  /** What this one is called where somebody can read it. Handed in, so a go
   *  reads the same here as on its card. */
  name: string;
  /** Where this one is up to. A column for a go still forming is worth
   *  drawing. Whether it is done changing and whether it has anything to hand
   *  over are two questions, and a go that did not work answers them
   *  differently. */
  state: WorkState;
  /** Unified diff of everything it changed. */
  diff: string;
  picture?: string | null;
  /** What it came to, already in words. */
  spent?: string | null;
  /** Its own copy, when it still has one. Only used to decide whether a set can
   *  be served and looked at — nothing in the comparison itself reads it. */
  folder?: string | null;
};

export type Difference = {
  path: string;
  /** The sides that touched this file, in the order they were given. */
  onlyIn: readonly string[];
  /** Every side touched it. */
  inBoth: boolean;
  /** Keyed by side id. A side that left the file alone has no entry at all,
   *  which is a different thing to say than an entry of nothing. */
  counts: Record<string, { added: number; removed: number }>;
};

export type Comparison = {
  /** Every file any side touched, by name. */
  files: readonly Difference[];
  /** Of those, the ones every side changed in exactly the same way. */
  sameEverywhere: readonly string[];
};

/** What a side did to one file, as a single string that can be compared byte for
 *  byte. Null for anything that arrives whole rather than as lines — two
 *  pictures of the same size are not the same picture. */
function markOf(file: FileChange): string | null {
  if (file.binary) return null;
  return [file.kind, file.oldPath, ...file.hunks.map((hunk) => hunk.text)].join('\u0000');
}

type Gathered = {
  onlyIn: string[];
  counts: Record<string, { added: number; removed: number }>;
  marks: Map<string, string | null>;
};

/**
 * Every file any side touched, with who touched it and what it cost them.
 *
 * Order is by name, so the same three runs draw the same list twice.
 */
export function compare(sides: readonly Side[]): Comparison {
  const found = new Map<string, Gathered>();

  for (const side of sides) {
    for (const file of parseDiff(side.diff)) {
      if (file.path === '') continue;
      let one = found.get(file.path);
      if (one === undefined) {
        one = { onlyIn: [], counts: {}, marks: new Map() };
        found.set(file.path, one);
      }
      const counted = countsOf([file]);
      const already = one.counts[side.id];
      if (already === undefined) {
        one.onlyIn.push(side.id);
        one.counts[side.id] = { added: counted.added, removed: counted.removed };
        one.marks.set(side.id, markOf(file));
      } else {
        // One diff naming the same file twice: the counts still add up, but
        // there is no longer one change to hold against anybody else's.
        already.added += counted.added;
        already.removed += counted.removed;
        one.marks.set(side.id, null);
      }
    }
  }

  const files: Difference[] = [];
  const sameEverywhere: string[] = [];

  for (const path of [...found.keys()].sort()) {
    const one = found.get(path);
    if (one === undefined) continue;
    const inBoth = sides.length > 0 && one.onlyIn.length === sides.length;
    files.push({ path, onlyIn: [...one.onlyIn], inBoth, counts: { ...one.counts } });
    if (!inBoth) continue;
    const marks = sides.map((side) => one.marks.get(side.id) ?? null);
    const first = marks[0];
    if (first === null || first === undefined) continue;
    if (marks.every((mark) => mark === first)) sameEverywhere.push(path);
  }

  return { files, sameEverywhere };
}

/* -------------------------------------------------------------------------- */

function many(count: number, one: string, more: string): string {
  return `${String(count)} ${count === 1 ? one : more}`;
}

/** Named apart so the sentences below can reach them without naming their own
 *  object. */
const ALL_OF_THEM = 'All of them changed it';
const BOTH = 'Both changed it';
const onlyOne = (name: string): string => `Only ${name} changed it`;

export const AGAINST_WORDS = {
  heading: 'Side by side',
  close: 'Close',
  files: 'File by file',
  keep: 'Use this one',
  /** The other half of choosing: a patch says what changed, a running copy says
   *  what it looks like. Both goes are already built in copies of their own, so
   *  this serves them rather than making anything new. */
  inTheBrowser: 'Open them in the browser',
  opening: 'Getting them ready…',
  keeping: 'Taking it…',
  nothing: 'None of these changed anything.',
  /** The same place, when there is nothing yet rather than nothing at all. */
  notStarted: 'None of these has started yet.',
  nothingSoFar: 'None of them has changed anything yet.',
  /** In place of the picture, on a go that has not produced one. */
  noPicture: 'No picture of this one.',
  /** A side that left this file exactly as it found it. */
  untouched: 'Did not touch this',
  /** The same cell, on a go that could still get to this file. */
  untouchedYet: 'Nothing here yet',
  all: ALL_OF_THEM,
  /** Two goes are both, never all of them. */
  both: BOTH,
  only: onlyOne,
  picture: (name: string): string => `What ${name} ended up looking like`,
  tally: (added: number, removed: number): string => `+${String(added)} −${String(removed)}`,
  /** Under a column's name: everything that go changed, at a glance. */
  total: (files: number, added: number, removed: number): string =>
    files === 0
      ? 'Changed nothing'
      : `${many(files, 'file', 'files')}, +${String(added)} −${String(removed)}`,
  /** The same line on a go that has not finished. Every number in that column
   *  is a reading taken just now, not a result. */
  soFar: (files: number, added: number, removed: number): string =>
    files === 0
      ? 'Nothing changed yet'
      : `${many(files, 'file', 'files')} so far, +${String(added)} −${String(removed)}`,
  /** Who touched one file. Names, not ids — this is read aloud in the row. */
  who: (names: readonly string[], of: number): string => {
    if (names.length >= of && of > 1) return of === 2 ? BOTH : ALL_OF_THEM;
    const [first] = names;
    if (names.length === 1 && first !== undefined) return onlyOne(first);
    if (names.length === 0) return 'None of them changed it';
    return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1] ?? ''} changed it`;
  },
  /** The quiet line at the end, for the part nobody has to decide about. */
  same: (count: number): string =>
    `${many(count, 'file', 'files')} came out the same in all of them:`,
  /** The line under the heading. */
  summary: (differing: number, same: number): string => {
    if (differing === 0 && same === 0) return 'None of them changed anything.';
    if (differing === 0)
      return `Nothing to decide — all of them made the same change to ${many(same, 'file', 'files')}.`;
    if (same === 0) return `${many(differing, 'file', 'files')} to decide about.`;
    return `${many(differing, 'file', 'files')} to decide about, and ${many(same, 'file', 'files')} that came out the same in all of them.`;
  },
  /** The same line before there is anything to decide about, which is a
   *  different thing to say than "none of them changed anything". */
  waitingToStart: 'Nothing has started yet. Each way fills in here as it begins.',
  noneFinished: 'None of them has finished. This is what they have changed so far.',
  /** Said after the counts, so nobody reads a column that is still moving as a
   *  result. */
  stillGoing: (count: number): string =>
    count === 1
      ? 'One of them is still going, so what it shows can still change.'
      : `${String(count)} of them are still going, so what they show can still change.`,
} as const;

/* -------------------------------------------------------------------------- */

/** Whether the numbers in this column can still move under the reader. A go
 *  that did not work is over: it keeps the folder it got to and nothing will be
 *  added to it. */
export function isFinal(side: Side): boolean {
  return side.state === 'done' || side.state === 'failed';
}

/** Whether there is a result here to take. Not the same question as finished —
 *  a go that did not work is over and still has nothing to hand over. */
export function canTake(side: Side): boolean {
  return canKeep(side.state);
}

/**
 * The line under the heading, which has to be true of goes that have not
 * finished as well as of the files they changed.
 *
 * Counting files is only the answer once something has been counted. Before
 * that the honest line is about the goes themselves — a sheet that says
 * "none of them changed anything" about work that has not started is wrong
 * twice over.
 */
export function saysSummary(sides: readonly Side[], differing: number, same: number): string {
  const going = sides.filter((side) => !isFinal(side));
  if (going.length === sides.length) {
    if (sides.length === 0) return AGAINST_WORDS.nothing;
    return sides.every((side) => side.state === 'waiting')
      ? AGAINST_WORDS.waitingToStart
      : AGAINST_WORDS.noneFinished;
  }
  const counted = AGAINST_WORDS.summary(differing, same);
  return going.length === 0 ? counted : `${counted} ${AGAINST_WORDS.stillGoing(going.length)}`;
}

/** What the body says when no go has touched a file. Which of the three it is
 *  depends entirely on whether they have had the chance. */
export function saysNothingHere(sides: readonly Side[]): string {
  if (sides.every(isFinal)) return AGAINST_WORDS.nothing;
  if (sides.every((side) => side.state === 'waiting')) return AGAINST_WORDS.notStarted;
  return AGAINST_WORDS.nothingSoFar;
}
