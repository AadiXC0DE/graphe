/** The unchanged lines nobody came to read, folded away.
 *
 * A piece git handed over with a lot of context reads as a wall: three lines
 * either side of a change is what the eye needs, and the rest is a fold that
 * says how much is under it. A run that reaches the start or the end of its
 * piece is marked, because past that edge there are lines git never sent and
 * only the caller can fetch them.
 *
 * Pure: rows in, rows out. Nothing drawn, nothing fetched.
 */

import type { FileChange, Hunk } from './hunks';
import { lineAt, lineOf, type Entry } from './rows';

/** Unchanged lines kept either side of a change. */
export const CONTEXT = 3;

/** Under this a fold hides no more rows than it costs, so it is not worth one. */
const LEAST = 2;

function unchanged(entry: Entry): boolean {
  if (entry.kind === 'split') return entry.row.kind === 'same';
  if (entry.kind === 'one') return entry.cell.line.sign === ' ';
  return false;
}

/** A fold's key, stable across opening it so the list keeps its place. */
function keyFor(hunk: Hunk, from: number): string {
  return `x:${hunk.id}:${String(from)}`;
}

function foldOne(
  rows: readonly Entry[],
  hunk: Hunk,
  open: ReadonlySet<string>,
  context: number,
): readonly Entry[] {
  const out: Entry[] = [];
  let at = 0;
  while (at < rows.length) {
    const row = rows[at];
    if (row === undefined) break;
    if (!unchanged(row)) {
      out.push(row);
      at += 1;
      continue;
    }
    let end = at;
    while (end < rows.length) {
      const one = rows[end];
      if (one === undefined || !unchanged(one)) break;
      end += 1;
    }
    const head = at === 0 ? 0 : context;
    const tail = end === rows.length ? 0 : context;
    const hidden = end - at - head - tail;
    if (hidden < LEAST) {
      out.push(...rows.slice(at, end));
      at = end;
      continue;
    }
    const key = keyFor(hunk, at);
    out.push(...rows.slice(at, at + head));
    if (open.has(key)) {
      out.push(...rows.slice(at + head, end - tail));
    } else {
      const first = rows[at + head];
      out.push({
        kind: 'fold',
        key,
        hunk,
        hidden,
        edge: at === 0 || end === rows.length,
        line: (first === undefined ? null : lineAt(first)) ?? lineOf(hunk),
      });
    }
    out.push(...rows.slice(end - tail, end));
    at = end;
  }
  return out;
}

/** The lines between two pieces of one file, which the caller can fetch and
 *  nothing here has in hand. Nothing where the two pieces abut. */
function gapBetween(last: Hunk | null, next: Hunk): Entry | null {
  if (last === null) return null;
  const hidden = next.oldStart - (last.oldStart + last.oldLines);
  if (hidden <= 0) return null;
  return {
    kind: 'gap',
    key: `g:${last.id}:${next.id}`,
    hunk: next,
    hidden,
    line: last.newStart + last.newLines,
  };
}

/** Every long run of unchanged lines replaced by one fold, piece by piece.
 *  A key in `open` is a fold somebody pressed, and its lines come back. */
export function foldUnchanged(
  entries: readonly Entry[],
  open: ReadonlySet<string>,
  context: number = CONTEXT,
): readonly Entry[] {
  const out: Entry[] = [];
  let at = 0;
  /* The piece before this one, so the lines git left out between two pieces of
     one file can be counted. Cleared at each file. */
  let last: Hunk | null = null;
  while (at < entries.length) {
    const entry = entries[at];
    if (entry === undefined) break;
    if (entry.kind === 'file') last = null;
    if (entry.kind === 'hunk') {
      const between = gapBetween(last, entry.hunk);
      if (between !== null) out.push(between);
      last = entry.hunk;
    }
    if (entry.kind !== 'split' && entry.kind !== 'one') {
      out.push(entry);
      at += 1;
      continue;
    }
    const hunk = entry.hunk;
    let end = at;
    while (end < entries.length) {
      const one = entries[end];
      if (one === undefined) break;
      if (one.kind !== 'split' && one.kind !== 'one') break;
      if (one.hunk.id !== hunk.id) break;
      end += 1;
    }
    out.push(...foldOne(entries.slice(at, end), hunk, open, context));
    at = end;
  }
  return out;
}

/** The first fold inside a piece, so `e` at the cursor knows what to open. */
export function foldIn(entries: readonly Entry[], hunk: string): string | null {
  const found = entries.find((entry) => entry.kind === 'fold' && entry.hunk.id === hunk);
  return found === undefined ? null : found.key;
}

/* -------------------------------------------------------------------------- */
/* More of the file than git sent                                              */
/* -------------------------------------------------------------------------- */

/** How much wider each press asks, and where a file starts. */
export const WIDER_STEP = 40;

/**
 * One file swapped for the same file read with more context around it.
 *
 * The wider read is a whole diff of one file, so what comes back replaces that
 * file in place rather than being merged hunk by hunk: git has already decided
 * which pieces survive a wider window, and two of them may now be one.
 */
export function withWider(
  files: readonly FileChange[],
  wider: Readonly<Record<string, readonly FileChange[]>>,
): readonly FileChange[] {
  return files.flatMap((file) => {
    const found = wider[file.path];
    return found === undefined || found.length === 0 ? [file] : found;
  });
}

/** The next window to ask for, given what this file was last read at. */
export function widerThan(context: number | undefined): number {
  return (context ?? CONTEXT) + WIDER_STEP;
}
