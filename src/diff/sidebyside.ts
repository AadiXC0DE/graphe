/** A change laid out in two columns, with the words that actually moved marked.
 *
 * The hunk list reads a change as one column of plus and minus lines, which is
 * the right shape for saying yes or no to a piece and the wrong shape for
 * seeing what a line became. Split view answers that: the old line and the new
 * one on the same row, and inside a pair, the run of characters that differs.
 *
 * The alignment is one pass. A run of removed lines followed by a run of added
 * ones is paired off in order, and the word marking inside a pair is a common
 * prefix and a common suffix — no matrix, nothing quadratic, so a five thousand
 * line diff costs five thousand steps rather than twenty-five million. `work`
 * is there so a test can hold it to that rather than to a stopwatch.
 *
 * Pure: hunks in, rows out. No disk, no git, nothing drawn.
 */

import type { FileChange, Hunk } from './hunks';

/** One line of a hunk, with the number each side would give it. */
export type Line = {
  /** `\` is the note about a missing last newline, which belongs to no side. */
  sign: '+' | '-' | ' ' | '\\';
  text: string;
  before: number | null;
  after: number | null;
};

export type RowKind = 'same' | 'added' | 'removed' | 'changed';

/** A run of characters that differs, as offsets into the row's own text. */
export type Mark = { from: number; to: number };

export type Row = {
  left: Line | null;
  right: Line | null;
  kind: RowKind;
  /** Only ever set on a changed pair, and only when the two lines have
   *  something in common — marking every character of two unrelated lines is
   *  noise dressed up as detail. */
  leftMarks: readonly Mark[];
  rightMarks: readonly Mark[];
  /** Git's `\ No newline at end of file`, on the side it belongs to. */
  leftNote: string | null;
  rightNote: string | null;
};

/** How much this took, counted in steps rather than milliseconds, so a test can
 *  hold the arrangement to the size of the diff on any machine. */
export type Work = { steps: number };

export const sideWords = {
  /** The two ways of reading the same change, named on the one control that
   *  swaps between them. */
  split: 'Side by side',
  unified: 'One column',
  before: 'Before',
  after: 'After',
  /** Read out where a row has a line on one side only. */
  onlyAfter: 'Added',
  onlyBefore: 'Removed',
} as const;

/* -------------------------------------------------------------------------- */
/* Lines                                                                       */
/* -------------------------------------------------------------------------- */

function bare(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line;
}

/** One piece's body, with the line numbers each side would give it. */
export function linesOf(hunk: Hunk): readonly Line[] {
  const rows: Line[] = [];
  const all = hunk.text.split('\n');
  let before = hunk.oldStart;
  let after = hunk.newStart;
  for (let at = 1; at < all.length; at += 1) {
    const raw = all[at] ?? '';
    // The last entry is the text's own closing newline, not a line.
    if (at === all.length - 1 && raw === '') break;
    const line = bare(raw);
    const mark = line[0] ?? ' ';
    if (mark === '\\') {
      rows.push({ sign: '\\', text: line, before: null, after: null });
    } else if (mark === '+') {
      rows.push({ sign: '+', text: line.slice(1), before: null, after });
      after += 1;
    } else if (mark === '-') {
      rows.push({ sign: '-', text: line.slice(1), before, after: null });
      before += 1;
    } else {
      rows.push({ sign: ' ', text: line.slice(1), before, after });
      before += 1;
      after += 1;
    }
  }
  return rows;
}

/* -------------------------------------------------------------------------- */
/* Word marks                                                                  */
/* -------------------------------------------------------------------------- */

/** Words, runs of space, and single punctuation — each with where it starts. */
const TOKEN = /\w+|\s+|[^\w\s]/g;

type Token = { text: string; at: number };

function tokensOf(text: string, work: Work): Token[] {
  const found: Token[] = [];
  TOKEN.lastIndex = 0;
  let match = TOKEN.exec(text);
  while (match !== null) {
    found.push({ text: match[0], at: match.index });
    work.steps += 1;
    match = TOKEN.exec(text);
  }
  return found;
}

/** Anything longer than this is a generated line or a minified one, and the
 *  reader gains nothing from a highlight inside it. */
const TOO_LONG = 2_000;

/**
 * What differs between two lines, as one run on each side.
 *
 * The shared head and the shared tail are taken off, and what is left in the
 * middle is the mark. That is linear in the length of the lines and it is what
 * a person sees anyway: a word swapped, an argument added, a string changed.
 *
 * Two lines with nothing in common get no marks at all — the row is already
 * saying the whole line changed, and painting every character says it twice.
 */
export function marksBetween(
  left: string,
  right: string,
  work: Work = { steps: 0 },
): { left: readonly Mark[]; right: readonly Mark[] } {
  if (left === right) return { left: [], right: [] };
  if (left.length > TOO_LONG || right.length > TOO_LONG) return { left: [], right: [] };

  const one = tokensOf(left, work);
  const other = tokensOf(right, work);

  let head = 0;
  while (head < one.length && head < other.length && one[head]?.text === other[head]?.text) {
    head += 1;
    work.steps += 1;
  }

  let tail = 0;
  while (
    tail < one.length - head &&
    tail < other.length - head &&
    one[one.length - 1 - tail]?.text === other[other.length - 1 - tail]?.text
  ) {
    tail += 1;
    work.steps += 1;
  }

  // Nothing shared: the row already says the line changed.
  if (head === 0 && tail === 0) return { left: [], right: [] };

  const span = (tokens: Token[], text: string): readonly Mark[] => {
    const from = head === 0 ? 0 : (tokens[head - 1]?.at ?? 0) + (tokens[head - 1]?.text.length ?? 0);
    const to = tail === 0 ? text.length : (tokens[tokens.length - tail]?.at ?? text.length);
    return to > from ? [{ from, to }] : [];
  };

  return { left: span(one, left), right: span(other, right) };
}

/* -------------------------------------------------------------------------- */
/* Rows                                                                        */
/* -------------------------------------------------------------------------- */

type Held = { line: Line; note: string | null };

function pairUp(
  removed: readonly Held[],
  added: readonly Held[],
  out: Row[],
  work: Work,
): void {
  const most = Math.max(removed.length, added.length);
  for (let at = 0; at < most; at += 1) {
    work.steps += 1;
    const left = removed[at];
    const right = added[at];
    if (left !== undefined && right !== undefined) {
      const marks = marksBetween(left.line.text, right.line.text, work);
      out.push({
        left: left.line,
        right: right.line,
        kind: 'changed',
        leftMarks: marks.left,
        rightMarks: marks.right,
        leftNote: left.note,
        rightNote: right.note,
      });
      continue;
    }
    if (left !== undefined) {
      out.push({
        left: left.line,
        right: null,
        kind: 'removed',
        leftMarks: [],
        rightMarks: [],
        leftNote: left.note,
        rightNote: null,
      });
      continue;
    }
    if (right !== undefined) {
      out.push({
        left: null,
        right: right.line,
        kind: 'added',
        leftMarks: [],
        rightMarks: [],
        leftNote: null,
        rightNote: right.note,
      });
    }
  }
}

/**
 * A hunk's lines as two columns.
 *
 * Context lines sit on both sides of the same row. A run of removals followed
 * by a run of additions is paired in order — the first removed line against the
 * first added one — which is what every split view does and is the only pairing
 * that stays linear.
 */
export function splitLines(lines: readonly Line[], work: Work = { steps: 0 }): readonly Row[] {
  const out: Row[] = [];
  let removed: Held[] = [];
  let added: Held[] = [];
  let last: Line | null = null;

  const flush = (): void => {
    if (removed.length > 0 || added.length > 0) pairUp(removed, added, out, work);
    removed = [];
    added = [];
  };

  for (const line of lines) {
    work.steps += 1;
    if (line.sign === '\\') {
      // The note belongs to the line above it, whichever side that was.
      if (last?.sign === '-') {
        const held = removed[removed.length - 1];
        if (held !== undefined) held.note = line.text;
      } else if (last?.sign === '+') {
        const held = added[added.length - 1];
        if (held !== undefined) held.note = line.text;
      } else {
        const row = out[out.length - 1];
        if (row !== undefined) {
          row.leftNote = line.text;
          row.rightNote = line.text;
        }
      }
      continue;
    }
    if (line.sign === '-') {
      removed.push({ line, note: null });
      last = line;
      continue;
    }
    if (line.sign === '+') {
      added.push({ line, note: null });
      last = line;
      continue;
    }
    flush();
    out.push({
      left: line,
      right: line,
      kind: 'same',
      leftMarks: [],
      rightMarks: [],
      leftNote: null,
      rightNote: null,
    });
    last = line;
  }
  flush();
  return out;
}

/** One piece, as two columns. */
export function splitHunk(hunk: Hunk, work: Work = { steps: 0 }): readonly Row[] {
  return splitLines(linesOf(hunk), work);
}

/** A whole file, piece by piece. The pieces stay separate: the gap between two
 *  of them is lines nobody changed, and drawing it would be drawing the file. */
export function splitFile(
  file: FileChange,
  work: Work = { steps: 0 },
): readonly { hunk: Hunk; rows: readonly Row[] }[] {
  return file.hunks.map((hunk) => ({ hunk, rows: splitHunk(hunk, work) }));
}
