/** The diff viewer, in the parts of it that can be argued about without drawing.
 *
 * `src/diff/sidebyside.ts` had the pairing and the word marks and no consumer at
 * all. What was missing between it and a screen is here: one flat list of rows
 * for the whole change so it can be windowed, the two readings over the same
 * pairing, and the colour and the marks applied to the same characters at once.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseDiff } from '../src/diff/hunks';
import { piecesOf, type Token } from '../src/diff/paint';
import {
  BUDGET,
  captionOf,
  entriesOf,
  fileAt,
  fileKeep,
  indexOfHunk,
  lineOf,
  oneColumn,
  sidesOf,
  type Entry,
} from '../src/diff/rows';
import { splitHunk } from '../src/diff/sidebyside';

const changes = readFileSync(
  fileURLToPath(new URL('../src/components/Changes.tsx', import.meta.url)),
  'utf8',
);
const view = readFileSync(
  fileURLToPath(new URL('../src/components/DiffView.tsx', import.meta.url)),
  'utf8',
);

const DIFF = `diff --git a/src/one.ts b/src/one.ts
index 111..222 100644
--- a/src/one.ts
+++ b/src/one.ts
@@ -1,4 +1,4 @@ export function greet(
 const a = 1;
-const greeting = "hello there";
+const greeting = "hello world";
 const b = 2;
 const c = 3;
diff --git a/README.md b/README.md
index 333..444 100644
--- a/README.md
+++ b/README.md
@@ -1,2 +1,3 @@
 # Graphe
+A line nobody had before.

`;

const files = parseDiff(DIFF);
const kinds = (entries: readonly Entry[]): readonly string[] => entries.map((one) => one.kind);

describe('one flat list for the whole change', () => {
  it('opens every file with its heading, then its pieces', () => {
    const { entries } = entriesOf(files, 'split');
    expect(kinds(entries).slice(0, 2)).toEqual(['file', 'hunk']);
    expect(entries.filter((one) => one.kind === 'file')).toHaveLength(2);
    expect(entries.filter((one) => one.kind === 'hunk')).toHaveLength(2);
  });

  it('gives every entry a key of its own, so a windowed list can be keyed', () => {
    const { entries } = entriesOf(files, 'split');
    expect(new Set(entries.map((one) => one.key)).size).toBe(entries.length);
  });

  it('says a file that only moved rather than drawing no rows for it', () => {
    const moved = parseDiff(
      'diff --git a/one.png b/two.png\nsimilarity index 100%\nrename from one.png\nrename to two.png\n',
    );
    expect(kinds(entriesOf(moved, 'split').entries)).toEqual(['file', 'whole']);
  });
});

describe('the two readings, over the same pairing', () => {
  it('splits a changed line into a left and a right', () => {
    const hunk = files[0]?.hunks[0];
    if (hunk === undefined) throw new Error('no hunk');
    const rows = splitHunk(hunk);
    const changed = rows.find((row) => row.kind === 'changed');
    expect(changed?.left?.text).toContain('hello there');
    expect(changed?.right?.text).toContain('hello world');
  });

  /* Read out in pair order the minuses and pluses would interleave, which is
     not what a unified diff looks like anywhere. */
  it('reads down one column with every removal before its replacement', () => {
    const hunk = files[0]?.hunks[0];
    if (hunk === undefined) throw new Error('no hunk');
    const signs = oneColumn(splitHunk(hunk)).map((cell) => cell.line.sign);
    expect(signs).toEqual([' ', '-', '+', ' ', ' ']);
  });

  it('carries the same word marks into both readings', () => {
    const hunk = files[0]?.hunks[0];
    if (hunk === undefined) throw new Error('no hunk');
    const rows = splitHunk(hunk);
    const changed = rows.find((row) => row.kind === 'changed');
    expect(changed?.rightMarks.length).toBeGreaterThan(0);
    const marked = oneColumn(rows).find((cell) => cell.marks.length > 0);
    expect(marked?.marks).toEqual(changed?.leftMarks);
  });

  it('marks only what actually changed inside the pair', () => {
    const hunk = files[0]?.hunks[0];
    if (hunk === undefined) throw new Error('no hunk');
    const changed = splitHunk(hunk).find((row) => row.kind === 'changed');
    const mark = changed?.rightMarks[0];
    const text = changed?.right?.text ?? '';
    if (mark === undefined) throw new Error('no mark');
    expect(text.slice(mark.from, mark.to)).toContain('world');
    expect(text.slice(mark.from, mark.to)).not.toContain('const');
  });
});

describe('a change too big to lay out in one pass', () => {
  it('stops at the budget and counts what is left rather than freezing', () => {
    const { entries, left } = entriesOf(files, 'unified', 1);
    expect(left).toBeGreaterThan(0);
    expect(entries.at(-1)).toMatchObject({ kind: 'rest', hunks: left });
  });

  it('lays the whole of an ordinary change out well inside it', () => {
    const { work, left } = entriesOf(files, 'split');
    expect(left).toBe(0);
    expect(work.steps).toBeLessThan(BUDGET);
  });
});

describe('what the band and the steers need', () => {
  it('names the file the scroller is standing in', () => {
    const { entries } = entriesOf(files, 'split');
    expect(fileAt(entries, 0)?.path).toBe('src/one.ts');
    expect(fileAt(entries, entries.length - 1)?.path).toBe('README.md');
  });

  it('finds a piece by name even where its rows are not drawn', () => {
    const { entries } = entriesOf(files, 'split');
    const id = files[1]?.hunks[0]?.id ?? '';
    expect(indexOfHunk(entries, id)).toBeGreaterThan(0);
    expect(entries[indexOfHunk(entries, id)]).toMatchObject({ kind: 'hunk' });
  });

  it('carries the line a steer should start at', () => {
    const hunk = files[0]?.hunks[0];
    if (hunk === undefined) throw new Error('no hunk');
    expect(lineOf(hunk)).toBe(hunk.newStart);
  });

  it('names the function a piece sits in, where git said one', () => {
    const hunk = files[0]?.hunks[0];
    if (hunk === undefined) throw new Error('no hunk');
    expect(captionOf(hunk)).toBe('export function greet(');
  });

  it('hands the highlighter each side as the code the grammar would see', () => {
    const hunk = files[0]?.hunks[0];
    if (hunk === undefined) throw new Error('no hunk');
    const { before, after } = sidesOf(hunk);
    expect(before).toContain('hello there');
    expect(before).not.toContain('hello world');
    expect(after).toContain('hello world');
    expect(after.split('\n')).toHaveLength(4);
  });
});

describe('a file kept, dropped, or something in between', () => {
  const file = files[0];
  if (file === undefined) throw new Error('no file');
  const id = file.hunks[0]?.id ?? '';

  it('is all until something is dropped', () => {
    expect(fileKeep(file, new Set())).toBe('all');
  });

  it('is none when every piece is', () => {
    expect(fileKeep(file, new Set([id]))).toBe('none');
  });

  it('is some when a file has more pieces than are dropped', () => {
    const many = parseDiff(
      `diff --git a/x.ts b/x.ts\n--- a/x.ts\n+++ b/x.ts\n@@ -1,1 +1,1 @@\n-a\n+b\n@@ -9,1 +9,1 @@\n-c\n+d\n`,
    )[0];
    if (many === undefined) throw new Error('no file');
    expect(fileKeep(many, new Set([many.hunks[0]?.id ?? '']))).toBe('some');
  });

  it('is all for a file with nothing inside it to drop', () => {
    expect(fileKeep({ ...file, hunks: [] }, new Set([id]))).toBe('all');
  });
});

describe('colour and the marks land on the same characters', () => {
  const tokens: readonly Token[] = [
    { text: 'const ', colour: '#a00' },
    { text: 'greeting', colour: '#0a0' },
    { text: ';', colour: null },
  ];
  const text = 'const greeting;';

  it('cuts on both, so a changed name keeps the colour it had', () => {
    const pieces = piecesOf(text, tokens, [{ from: 6, to: 14 }]);
    expect(pieces.map((one) => one.text).join('')).toBe(text);
    const marked = pieces.filter((one) => one.marked);
    expect(marked.map((one) => one.text).join('')).toBe('greeting');
    expect(marked[0]?.colour).toBe('#0a0');
  });

  it('draws the line plainly when the highlighter has nothing to say', () => {
    expect(piecesOf(text, null, [])).toEqual([{ text, colour: null, marked: false }]);
  });

  /* The highlighter is asked for a hunk's worth at a time, and a line whose
     tokens do not add up is a line whose colour would land on the wrong
     characters. */
  it('drops tokens that do not add up to the line rather than trusting them', () => {
    const pieces = piecesOf(text, [{ text: 'const', colour: '#a00' }], []);
    expect(pieces).toEqual([{ text, colour: null, marked: false }]);
  });

  it('keeps the marks when the tokens are unusable', () => {
    const pieces = piecesOf(text, [{ text: 'no', colour: '#a00' }], [{ from: 6, to: 14 }]);
    expect(pieces.filter((one) => one.marked).map((one) => one.text).join('')).toBe('greeting');
  });
});

describe('where the viewer is used', () => {
  it('is what the working change is drawn with', () => {
    expect(changes).toContain("import DiffView from './DiffView';");
    expect(changes).toContain('<DiffView');
    expect(changes).not.toContain('changes__lines');
  });

  it('keeps the yes and no on every piece', () => {
    expect(changes).toContain('onToggle={(hunk) => {');
    expect(changes).toContain('onKeepFile={(file, keep) => setDropped((was) => withFile(was, file, keep))}');
  });

  it('sends a steer carrying the file and the line, and never sends one itself', () => {
    expect(view).toContain('onExplain(hunk.path, line)');
    expect(view).toContain('onFix(hunk.path, line)');
    expect(view).not.toContain('bridge.');
  });

  it('draws a bounded number of rows however long the change is', () => {
    expect(view).toContain('useWindowed');
  });
});
