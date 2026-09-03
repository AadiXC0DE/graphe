/** A whole change as one flat list of rows, in either of the two readings.
 *
 * The viewer draws one list and windows it, so a file heading, a hunk heading
 * and a line of code all have to be the same kind of thing: an entry with a
 * key. Laying them out is also the one part of drawing a diff that grows with
 * the size of the diff, so it is done here, once, against a budget the caller
 * sets rather than against whatever the machine can manage.
 *
 * Pure: files in, entries out. Nothing drawn.
 */

import type { FileChange, Hunk } from './hunks';
import { linesOf, splitHunk, type Line, type Mark, type Row, type Work } from './sidebyside';

/** One line read down a single column, with the marks that belong to it. */
export type Cell = { line: Line; marks: readonly Mark[]; note: string | null };

export type Entry =
  | { kind: 'file'; key: string; file: FileChange }
  | { kind: 'whole'; key: string; file: FileChange }
  | { kind: 'hunk'; key: string; file: FileChange; hunk: Hunk }
  | { kind: 'split'; key: string; hunk: Hunk; row: Row }
  | { kind: 'one'; key: string; hunk: Hunk; cell: Cell }
  | { kind: 'fold'; key: string; hunk: Hunk; hidden: number; edge: boolean; line: number }
  /** The lines between two pieces of one file, which git never sent. */
  | { kind: 'gap'; key: string; hunk: Hunk; hidden: number; line: number }
  | { kind: 'rest'; key: string; hunks: number };

export type Reading = 'split' | 'unified';

/**
 * Two columns read as one, the way git prints it: every removal in a run, then
 * every addition that replaced them.
 *
 * The pairing is still the split view's, so a changed line keeps the marks its
 * partner gave it. Reading them out in pair order instead would interleave the
 * minuses and pluses, which is not what a unified diff looks like anywhere.
 */
export function oneColumn(rows: readonly Row[]): readonly Cell[] {
  const out: Cell[] = [];
  let held: Cell[] = [];

  const flush = (): void => {
    if (held.length === 0) return;
    out.push(...held);
    held = [];
  };

  for (const row of rows) {
    if (row.kind === 'same') {
      flush();
      if (row.left !== null) out.push({ line: row.left, marks: [], note: row.leftNote });
      continue;
    }
    if (row.left !== null) out.push({ line: row.left, marks: row.leftMarks, note: row.leftNote });
    if (row.right !== null) held.push({ line: row.right, marks: row.rightMarks, note: row.rightNote });
  }
  flush();
  return out;
}

/** The name git prints after the second `@@`: the function a piece sits in. */
export function captionOf(hunk: Hunk): string {
  const first = hunk.text.split('\n')[0] ?? '';
  const head = first.endsWith('\r') ? first.slice(0, -1) : first;
  const found = /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/.exec(head);
  return found === null ? '' : head.slice(found[0].length).trim();
}

/** Where in the file a piece lands, as the line a steer should carry. */
export function lineOf(hunk: Hunk): number {
  return hunk.newLines === 0 ? hunk.oldStart : hunk.newStart;
}

/** A hunk's two sides as plain code, for the highlighter. Each side's Nth line
 *  is the line the grammar would see there, so a row finds its own tokens by
 *  counting from the hunk's start. */
export function sidesOf(hunk: Hunk): { before: string; after: string } {
  const before: string[] = [];
  const after: string[] = [];
  for (const line of linesOf(hunk)) {
    if (line.sign === '\\') continue;
    if (line.sign !== '+') before.push(line.text);
    if (line.sign !== '-') after.push(line.text);
  }
  return { before: before.join('\n'), after: after.join('\n') };
}

/**
 * How many steps of arrangement one pass is allowed.
 *
 * Generous: a five thousand line change costs a few thousand. It bites on the
 * kind of change nobody reads line by line anyway, a vendored folder or a lock
 * file, and there the viewer says how much is left rather than freezing while
 * it lays out work nobody asked to see.
 */
export const BUDGET = 200_000;

/** Every row of a change, in reading order, with what the budget could not
 *  reach counted at the end. */
export function entriesOf(
  files: readonly FileChange[],
  reading: Reading,
  budget: number = BUDGET,
): { entries: readonly Entry[]; work: Work; left: number } {
  const work: Work = { steps: 0 };
  const entries: Entry[] = [];
  let left = 0;
  let spent = false;

  for (const file of files) {
    const name = `${file.oldPath}>${file.path}`;
    if (spent) {
      left += file.hunks.length;
      continue;
    }
    entries.push({ kind: 'file', key: `f:${name}`, file });
    if (file.hunks.length === 0) {
      entries.push({ kind: 'whole', key: `w:${name}`, file });
      continue;
    }
    for (const hunk of file.hunks) {
      if (spent) {
        left += 1;
        continue;
      }
      entries.push({ kind: 'hunk', key: `h:${hunk.id}`, file, hunk });
      const rows = splitHunk(hunk, work);
      if (reading === 'split') {
        rows.forEach((row, at) => {
          entries.push({ kind: 'split', key: `${hunk.id}:${String(at)}`, hunk, row });
        });
      } else {
        oneColumn(rows).forEach((cell, at) => {
          entries.push({ kind: 'one', key: `${hunk.id}:${String(at)}`, hunk, cell });
        });
      }
      if (work.steps >= budget) spent = true;
    }
  }

  if (left > 0) entries.push({ kind: 'rest', key: 'rest', hunks: left });
  return { entries, work, left };
}

/** Where a hunk's heading sits in the list, so the keyboard can bring it into
 *  view even when it has not been drawn. */
/** Where a file's heading sits in the list, so pressing its row scrolls there
 *  even when its rows have not been drawn. */
export function indexOfFile(entries: readonly Entry[], path: string): number {
  return entries.findIndex((entry) => entry.kind === 'file' && entry.file.path === path);
}

/** One row of the file list: what changed, and how much. */
export type FileRow = {
  path: string;
  kind: FileChange['kind'];
  added: number;
  removed: number;
  /** Whether every hunk in it is being kept. */
  keeping: 'all' | 'some' | 'none';
};

export function fileRows(
  files: readonly FileChange[],
  dropped: ReadonlySet<string>,
): readonly FileRow[] {
  return files.map((file) => ({
    path: file.path,
    kind: file.kind,
    added: file.hunks.reduce((sum, hunk) => sum + hunk.added, 0),
    removed: file.hunks.reduce((sum, hunk) => sum + hunk.removed, 0),
    keeping: fileKeep(file, dropped),
  }));
}

/** What the toolbar says about the whole change. */
export function tallyOf(rows: readonly FileRow[]): { files: number; added: number; removed: number } {
  return {
    files: rows.length,
    added: rows.reduce((sum, one) => sum + one.added, 0),
    removed: rows.reduce((sum, one) => sum + one.removed, 0),
  };
}

/** Whether a line changed nothing but whitespace. Both sides with every space
 *  taken out are the same line, so it is noise in a review of the words. */
export function onlySpacing(before: string, after: string): boolean {
  return before.replace(/\s+/g, '') === after.replace(/\s+/g, '');
}

export function indexOfHunk(entries: readonly Entry[], id: string): number {
  return entries.findIndex((entry) => entry.kind === 'hunk' && entry.hunk.id === id);
}

/** The file whose rows are on screen at a given entry, for the band at the top. */
/**
 * Whether a file is being kept whole, dropped whole, or something in between.
 *
 * The heading's own control answers to this: a file with two of five hunks
 * dropped is neither on nor off, and a switch drawn as either would lie about
 * what pressing it does.
 */
export function fileKeep(
  file: FileChange,
  dropped: ReadonlySet<string>,
): 'all' | 'some' | 'none' {
  if (file.hunks.length === 0) return 'all';
  const out = file.hunks.filter((hunk) => dropped.has(hunk.id)).length;
  if (out === 0) return 'all';
  return out === file.hunks.length ? 'none' : 'some';
}

/** The line a row hangs a comment on: the new side wherever there is one, so a
 *  comment lands where a reviewer is looking rather than where the line was. */
export function lineAt(entry: Entry): number | null {
  if (entry.kind === 'one') return entry.cell.line.after ?? entry.cell.line.before;
  if (entry.kind === 'split') return entry.row.right?.after ?? entry.row.left?.before ?? null;
  return null;
}

/** One remark on one line of one file, as the pull request holds it. */
export type DiffComment = {
  id: string;
  path: string;
  line: number;
  author: string;
  body: string;
  /** When it was written, as the host wrote it. */
  at: string;
};

export function lineKey(path: string, line: number): string {
  return `${path}:${String(line)}`;
}

/** Comments gathered under the line they belong to, so a row finds its own in
 *  one lookup rather than a pass over every comment on the change. */
export function commentsByLine(
  comments: readonly DiffComment[],
): ReadonlyMap<string, readonly DiffComment[]> {
  const out = new Map<string, DiffComment[]>();
  for (const one of comments) {
    const key = lineKey(one.path, one.line);
    const held = out.get(key);
    if (held === undefined) out.set(key, [one]);
    else held.push(one);
  }
  return out;
}

export function fileAt(entries: readonly Entry[], at: number): FileChange | null {
  for (let step = Math.min(at, entries.length - 1); step >= 0; step -= 1) {
    const entry = entries[step];
    if (entry?.kind === 'file') return entry.file;
    if (entry?.kind === 'hunk') return entry.file;
  }
  return null;
}
