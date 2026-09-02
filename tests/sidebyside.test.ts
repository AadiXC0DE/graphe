/** A change in two columns, and the words marked inside a changed pair.
 *
 * The last block is the one that matters most: a five thousand line diff has to
 * cost about five thousand steps. It is asserted with a counter rather than a
 * clock, because a wall-clock test passes on a fast machine and fails on a
 * loaded one, and neither answer is about the code.
 */

import { describe, expect, it } from 'vitest';

import { parseDiff, type Hunk } from '../src/diff/hunks';
import {
  linesOf,
  marksBetween,
  splitFile,
  splitHunk,
  splitLines,
  type Work,
} from '../src/diff/sidebyside';

function hunkOf(body: readonly string[], head = '@@ -1,3 +1,3 @@'): Hunk {
  const diff = [
    'diff --git a/src/a.css b/src/a.css',
    '--- a/src/a.css',
    '+++ b/src/a.css',
    head,
    ...body,
    '',
  ].join('\n');
  const hunk = parseDiff(diff)[0]?.hunks[0];
  if (hunk === undefined) throw new Error('no hunk in the fixture');
  return hunk;
}

const texts = (rows: readonly { left: unknown; right: unknown }[]) =>
  rows.map((row) => [
    (row.left as { text: string } | null)?.text ?? null,
    (row.right as { text: string } | null)?.text ?? null,
  ]);

/* ========================================================================== */
/* D-01a lines                                                                 */
/* ========================================================================== */

describe('D-01a a piece read into lines', () => {
  it('numbers each side the way that side would', () => {
    const lines = linesOf(hunkOf([' one', '-two', '+TWO', ' three']));
    expect(lines.map((line) => [line.sign, line.before, line.after])).toEqual([
      [' ', 1, 1],
      ['-', 2, null],
      ['+', null, 2],
      [' ', 3, 3],
    ]);
  });

  it('takes the mark off the text and leaves the rest alone', () => {
    const lines = linesOf(hunkOf([' one', '-  indented', '+  indented too', ' three']));
    expect(lines[1]?.text).toBe('  indented');
  });
});

/* ========================================================================== */
/* D-01b the two columns                                                       */
/* ========================================================================== */

describe('D-01b lines laid out in two columns', () => {
  it('puts a line nobody touched on both sides of one row', () => {
    const rows = splitHunk(hunkOf([' one', '-two', '+TWO', ' three']));
    expect(rows[0]).toMatchObject({ kind: 'same' });
    expect(rows[0]?.left).toBe(rows[0]?.right);
  });

  it('pairs a removed line with the added one that replaced it', () => {
    const rows = splitHunk(hunkOf([' one', '-two', '+TWO', ' three']));
    expect(rows[1]).toMatchObject({ kind: 'changed' });
    expect(texts(rows)).toEqual([
      ['one', 'one'],
      ['two', 'TWO'],
      ['three', 'three'],
    ]);
  });

  it('leaves the right column empty where a line was only removed', () => {
    const rows = splitHunk(hunkOf([' one', '-two', ' three'], '@@ -1,3 +1,2 @@'));
    expect(rows[1]).toMatchObject({ kind: 'removed', right: null });
  });

  it('leaves the left column empty where a line was only added', () => {
    const rows = splitHunk(hunkOf([' one', '+two', ' three'], '@@ -1,2 +1,3 @@'));
    expect(rows[1]).toMatchObject({ kind: 'added', left: null });
  });

  it('pairs off as far as it can and spills the rest down one column', () => {
    const rows = splitHunk(hunkOf(['-a', '-b', '-c', '+A', ' end'], '@@ -1,4 +1,2 @@'));
    expect(rows.map((row) => row.kind)).toEqual(['changed', 'removed', 'removed', 'same']);
    expect(texts(rows)).toEqual([
      ['a', 'A'],
      ['b', null],
      ['c', null],
      ['end', 'end'],
    ]);
  });

  it('starts a new pairing after every line that stayed', () => {
    const rows = splitHunk(hunkOf(['-a', '+A', ' mid', '-b', '+B'], '@@ -1,3 +1,3 @@'));
    expect(rows.map((row) => row.kind)).toEqual(['changed', 'same', 'changed']);
  });

  it('carries the note about a missing last newline on the side it belongs to', () => {
    const rows = splitHunk(
      hunkOf(['-old', '\\ No newline at end of file', '+new', '\\ No newline at end of file'], '@@ -1 +1 @@'),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.leftNote).toBe('\\ No newline at end of file');
    expect(rows[0]?.rightNote).toBe('\\ No newline at end of file');
  });

  it('has nothing to lay out for an empty piece', () => {
    expect(splitLines([])).toEqual([]);
  });
});

/* ========================================================================== */
/* D-01c the words inside a pair                                               */
/* ========================================================================== */

describe('D-01c what changed inside a changed pair', () => {
  it('marks only the word that moved', () => {
    const rows = splitHunk(hunkOf(['-line 3 before', '+line 3 after'], '@@ -1 +1 @@'));
    const row = rows[0];
    expect(row?.leftMarks).toEqual([{ from: 7, to: 13 }]);
    expect(row?.rightMarks).toEqual([{ from: 7, to: 12 }]);
    expect(row?.left?.text.slice(7, 13)).toBe('before');
    expect(row?.right?.text.slice(7, 12)).toBe('after');
  });

  it('marks a run that shares only its tail', () => {
    const marks = marksBetween('  color: red;', '  color: blue;');
    expect('  color: red;'.slice(marks.left[0]?.from, marks.left[0]?.to)).toBe('red');
    expect('  color: blue;'.slice(marks.right[0]?.from, marks.right[0]?.to)).toBe('blue');
  });

  it('marks nothing when the two lines have nothing in common, rather than painting both whole', () => {
    expect(marksBetween('abc', 'xyz')).toEqual({ left: [], right: [] });
  });

  it('marks nothing when the lines are the same', () => {
    expect(marksBetween('same', 'same')).toEqual({ left: [], right: [] });
  });

  it('marks an insertion with an empty run on the side it is missing from', () => {
    const marks = marksBetween('a c', 'a b c');
    expect(marks.left).toEqual([]);
    expect('a b c'.slice(marks.right[0]?.from, marks.right[0]?.to)).toBe('b ');
  });

  it('leaves a generated or minified line unmarked, where a highlight helps nobody', () => {
    const long = `${'x'.repeat(3000)}a`;
    expect(marksBetween(long, `${long}b`)).toEqual({ left: [], right: [] });
  });

  it('never marks a row that is not a changed pair', () => {
    const rows = splitHunk(hunkOf([' one', '+two'], '@@ -1,1 +1,2 @@'));
    expect(rows.every((row) => row.leftMarks.length === 0 && row.rightMarks.length === 0)).toBe(true);
  });
});

/* ========================================================================== */
/* D-01d a whole file                                                          */
/* ========================================================================== */

describe('D-01d a file, piece by piece', () => {
  it('keeps the pieces apart, because the gap between them is the rest of the file', () => {
    const diff = [
      'diff --git a/src/a.css b/src/a.css',
      '--- a/src/a.css',
      '+++ b/src/a.css',
      '@@ -1,2 +1,2 @@',
      ' one',
      '-two',
      '+TWO',
      '@@ -40,2 +40,2 @@',
      ' forty',
      '-alpha',
      '+beta',
      '',
    ].join('\n');
    const file = parseDiff(diff)[0];
    if (file === undefined) throw new Error('no file in the fixture');
    const split = splitFile(file);
    expect(split).toHaveLength(2);
    expect(split[1]?.rows[0]?.left?.before).toBe(40);
  });
});

/* ========================================================================== */
/* D-01e the work it takes                                                     */
/* ========================================================================== */

/** A hunk of `n` lines, one in three of them changed — a busy diff, not a
 *  friendly one. */
function bigHunk(n: number): Hunk {
  const body: string[] = [];
  for (let at = 0; at < n; at += 1) {
    if (at % 3 === 0) {
      body.push(`-const value${String(at)} = before(${String(at)});`);
      body.push(`+const value${String(at)} = after(${String(at)});`);
    } else {
      body.push(` const kept${String(at)} = ${String(at)};`);
    }
  }
  return hunkOf(body, `@@ -1,${String(n)} +1,${String(n)} @@`);
}

describe('D-01e a five thousand line diff is not quadratic', () => {
  it('lays out five thousand lines in steps counted in thousands, not millions', () => {
    const work: Work = { steps: 0 };
    const rows = splitHunk(bigHunk(5_000), work);
    expect(rows.length).toBeGreaterThan(4_000);
    // Twenty-five million would be the quadratic answer.
    expect(work.steps).toBeLessThan(300_000);
  });

  it('costs about twice as much for twice as many lines', () => {
    const small: Work = { steps: 0 };
    const large: Work = { steps: 0 };
    splitHunk(bigHunk(2_500), small);
    splitHunk(bigHunk(5_000), large);
    expect(large.steps / small.steps).toBeLessThan(2.5);
  });

  it('does not slow down when the same line is repeated, which is where a matrix would', () => {
    const body = Array.from({ length: 2_000 }, (_, at) =>
      at % 2 === 0 ? '-repeated line' : '+repeated line changed',
    );
    const work: Work = { steps: 0 };
    splitHunk(hunkOf(body, '@@ -1,1000 +1,1000 @@'), work);
    expect(work.steps).toBeLessThan(120_000);
  });
});
