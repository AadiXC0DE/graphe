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

import { foldIn, foldUnchanged } from '../src/diff/collapse';
import { parseDiff } from '../src/diff/hunks';
import { piecesOf, type Token } from '../src/diff/paint';
import {
  BUDGET,
  captionOf,
  commentsByLine,
  entriesOf,
  fileAt,
  fileKeep,
  fileRows,
  indexOfFile,
  indexOfHunk,
  lineAt,
  lineKey,
  onlySpacing,
  tallyOf,
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

describe('the file list', () => {
  it('is one row per file, with what each one changed', () => {
    const rows = fileRows(files, new Set());
    expect(rows.map((one) => one.path)).toEqual(['src/one.ts', 'README.md']);
    expect(rows[0]).toMatchObject({ kind: 'modified', added: 1, removed: 1, keeping: 'all' });
  });

  it('marks a file whose every hunk is dropped', () => {
    const id = files[0]?.hunks[0]?.id ?? '';
    expect(fileRows(files, new Set([id]))[0]?.keeping).toBe('none');
  });

  it('adds the whole change up for the toolbar', () => {
    expect(tallyOf(fileRows(files, new Set()))).toEqual({ files: 2, added: 2, removed: 1 });
  });

  it('finds a file by name, so pressing its row can scroll to it undrawn', () => {
    const { entries } = entriesOf(files, 'split');
    expect(entries[indexOfFile(entries, 'README.md')]).toMatchObject({ kind: 'file' });
    expect(indexOfFile(entries, 'nothing.ts')).toBe(-1);
  });

  it('is folded and unfolded with one key, and the choice is kept', () => {
    expect(view).toContain("if (event.key === '[') {");
    expect(view).toContain("keep(FILES_SHOWN, was ? 'shut' : 'open')");
  });

  it('moves a file at a time on n and p', () => {
    expect(view).toContain("if (event.key !== 'n' && event.key !== 'p') return;");
  });
});

describe('lines that changed nothing but their spacing', () => {
  it('are the same line with the spaces taken out', () => {
    expect(onlySpacing('const a = 1;', 'const   a = 1;')).toBe(true);
    expect(onlySpacing('  const a = 1;', 'const a = 1;')).toBe(true);
    expect(onlySpacing('const a = 1;', 'const a = 2;')).toBe(false);
  });

  it('are left out until somebody asks for them', () => {
    expect(view).toContain('if (spacing) return entries;');
    expect(view).toContain('!onlySpacing(left.text, right.text)');
  });
});

/* A hunk git handed over with a lot of context reads as a wall. Three lines
   either side of a change is what the eye needs; the rest is one row that says
   how much is under it. */
describe('the unchanged lines nobody came to read', () => {
  const WIDE = `diff --git a/wide.ts b/wide.ts
--- a/wide.ts
+++ b/wide.ts
@@ -1,21 +1,21 @@
 a1
 a2
 a3
 a4
 a5
 a6
 a7
 a8
 a9
 a10
-old
+new
 b1
 b2
 b3
 b4
 b5
 b6
 b7
 b8
 b9
 b10
`;
  const wide = parseDiff(WIDE);

  const foldsIn = (entries: readonly Entry[]): readonly Entry[] =>
    entries.filter((one) => one.kind === 'fold');

  it('keeps three lines either side of a change and folds the rest', () => {
    const { entries } = entriesOf(wide, 'unified');
    const out = foldUnchanged(entries, new Set());
    const folds = foldsIn(out);
    expect(folds).toHaveLength(2);
    expect(out.filter((one) => one.kind === 'one')).toHaveLength(8);
  });

  it('counts what each fold is hiding', () => {
    const out = foldUnchanged(entriesOf(wide, 'unified').entries, new Set());
    const hidden = foldsIn(out).map((one) => (one.kind === 'fold' ? one.hidden : 0));
    expect(hidden).toEqual([7, 7]);
  });

  /* Past the first and the last folded run there are lines git never sent, and
     only the caller can fetch them. */
  it('marks a fold that reaches the edge of the piece', () => {
    const out = foldUnchanged(entriesOf(wide, 'unified').entries, new Set());
    expect(foldsIn(out).every((one) => one.kind === 'fold' && one.edge)).toBe(true);
  });

  it('carries the line to ask around', () => {
    const out = foldUnchanged(entriesOf(wide, 'unified').entries, new Set());
    const first = foldsIn(out)[0];
    expect(first?.kind === 'fold' ? first.line : 0).toBe(1);
  });

  it('gives back the lines of a fold somebody opened', () => {
    const { entries } = entriesOf(wide, 'unified');
    const key = foldIn(foldUnchanged(entries, new Set()), wide[0]?.hunks[0]?.id ?? '');
    if (key === null) throw new Error('no fold');
    const out = foldUnchanged(entries, new Set([key]));
    expect(foldsIn(out)).toHaveLength(1);
    expect(out.filter((one) => one.kind === 'one')).toHaveLength(15);
  });

  it('folds the same runs in either reading', () => {
    const out = foldUnchanged(entriesOf(wide, 'split').entries, new Set());
    expect(foldsIn(out)).toHaveLength(2);
  });

  it('leaves an ordinary three-line hunk alone', () => {
    const { entries } = entriesOf(files, 'split');
    expect(foldsIn(foldUnchanged(entries, new Set()))).toHaveLength(0);
  });

  it('leaves the headings where they were', () => {
    const { entries } = entriesOf(wide, 'unified');
    const out = foldUnchanged(entries, new Set());
    expect(out[0]).toMatchObject({ kind: 'file' });
    expect(out[1]).toMatchObject({ kind: 'hunk' });
  });

  it('gives every fold a key of its own, and one that survives opening', () => {
    const { entries } = entriesOf(wide, 'unified');
    const shut = foldsIn(foldUnchanged(entries, new Set())).map((one) => one.key);
    expect(new Set(shut).size).toBe(shut.length);
    const open = foldsIn(foldUnchanged(entries, new Set([shut[0] ?? '']))).map((one) => one.key);
    expect(open).toEqual(shut.slice(1));
  });

  it('is on unless somebody turned it off, and the choice is kept', () => {
    expect(view).toContain("remembered(COLLAPSED) !== 'no'");
    expect(view).toContain("keep(COLLAPSED, was ? 'no' : 'yes')");
  });

  it('opens the fold nearest the cursor on e', () => {
    expect(view).toContain("if (event.key === 'e') {");
    expect(view).toContain('foldIn(folded, at)');
  });
});

describe('the file heading, pinned', () => {
  it('is drawn above the scroller once its own row has gone past the top', () => {
    expect(view).toContain('const pinned = here !== null && headAt >= 0 && headAt < topAt;');
    expect(view).toContain('diffview__pinned');
  });

  it('is the same heading in both places', () => {
    expect(view.match(/<FileTop/g)).toHaveLength(2);
  });
});

describe('remarks on a line', () => {
  const said = [
    { id: '1', path: 'src/one.ts', line: 2, author: 'ada', body: 'why?', at: '2026-01-01' },
    { id: '2', path: 'src/one.ts', line: 2, author: 'bob', body: 'because', at: '2026-01-02' },
    { id: '3', path: 'README.md', line: 2, author: 'ada', body: 'nice', at: '2026-01-03' },
  ];

  it('gathers them under the line they belong to', () => {
    const by = commentsByLine(said);
    expect(by.get(lineKey('src/one.ts', 2))).toHaveLength(2);
    expect(by.get(lineKey('README.md', 2))).toHaveLength(1);
    expect(by.get(lineKey('src/one.ts', 9))).toBeUndefined();
  });

  it('keeps them in the order they arrived', () => {
    const on = commentsByLine(said).get(lineKey('src/one.ts', 2)) ?? [];
    expect(on.map((one) => one.author)).toEqual(['ada', 'bob']);
  });

  it('hangs a row on its new-side line, so a remark lands where the eye is', () => {
    const { entries } = entriesOf(files, 'unified');
    const added = entries.find((one) => one.kind === 'one' && one.cell.line.sign === '+');
    if (added === undefined) throw new Error('no added line');
    expect(lineAt(added)).toBe(added.kind === 'one' ? added.cell.line.after : 0);
  });

  it('falls back to the old side for a line that is only there', () => {
    const { entries } = entriesOf(files, 'unified');
    const gone = entries.find((one) => one.kind === 'one' && one.cell.line.sign === '-');
    if (gone === undefined) throw new Error('no removed line');
    expect(lineAt(gone)).toBe(gone.kind === 'one' ? gone.cell.line.before : 0);
  });

  it('has nothing to hang on a heading', () => {
    const { entries } = entriesOf(files, 'unified');
    expect(lineAt(entries[0] as Entry)).toBeNull();
  });

  /* Changes and Review pass neither prop, and must look exactly as they did. */
  it('leaves the gutter alone where nothing can be said', () => {
    expect(view).toContain('onComment === undefined || key === null ? null : (');
  });

  it('posts what was written and closes the box', () => {
    expect(view).toContain('void onComment(entry.hunk.path, line, draft.trim());');
    expect(view).toContain('setAsking(null);');
  });

  it('says the time the way the rest of the app does', () => {
    expect(view).toContain("import { ago } from '../lib/when';");
  });
});

/* Git sends three lines of context and nothing between one piece and the next.
   Those lines exist, and only the caller can fetch them. */
describe('the lines between two pieces', () => {
  const APART = `diff --git a/far.ts b/far.ts
--- a/far.ts
+++ b/far.ts
@@ -1,3 +1,3 @@
-one
+ONE
 a
 b
@@ -44,3 +44,3 @@
 c
-two
+TWO
 d
diff --git a/near.ts b/near.ts
--- a/near.ts
+++ b/near.ts
@@ -1,2 +1,2 @@
-x
+X
 y
@@ -3,2 +3,2 @@
-z
+Z
 w
diff --git a/late.ts b/late.ts
--- a/late.ts
+++ b/late.ts
@@ -60,2 +60,2 @@
-p
+P
 q
`;
  const apart = parseDiff(APART);
  const gapsIn = (entries: readonly Entry[]): readonly Entry[] =>
    entries.filter((one) => one.kind === 'gap');

  it('is a row of its own between two pieces of one file', () => {
    const out = foldUnchanged(entriesOf(apart, 'unified').entries, new Set());
    const gaps = gapsIn(out);
    expect(gaps).toHaveLength(1);
    const before = out.slice(0, out.indexOf(gaps[0] as Entry));
    expect(before.filter((one) => one.kind === 'hunk')).toHaveLength(1);
    expect(out[out.indexOf(gaps[0] as Entry) + 1]).toMatchObject({ kind: 'hunk' });
  });

  it('counts the lines git did not give us', () => {
    const out = foldUnchanged(entriesOf(apart, 'unified').entries, new Set());
    const gap = gapsIn(out)[0];
    expect(gap?.kind === 'gap' ? gap.hidden : 0).toBe(40);
  });

  it('carries the line to ask around, and the file to ask about', () => {
    const out = foldUnchanged(entriesOf(apart, 'unified').entries, new Set());
    const gap = gapsIn(out)[0];
    if (gap?.kind !== 'gap') throw new Error('no gap');
    expect(gap.line).toBe(4);
    expect(gap.hunk.path).toBe('far.ts');
  });

  /* `late.ts` opens at line 60, a long way past where `near.ts` left off. The
     count is per file or it would invent a gap at every file boundary. */
  it('is never drawn between two files', () => {
    const out = foldUnchanged(entriesOf(apart, 'unified').entries, new Set());
    expect(gapsIn(out)).toHaveLength(1);
    for (const gap of gapsIn(out)) {
      const before = out.slice(0, out.indexOf(gap));
      const lastFile = before.map((one) => one.kind).lastIndexOf('file');
      const lastHunk = before.map((one) => one.kind).lastIndexOf('hunk');
      expect(lastHunk).toBeGreaterThan(lastFile);
    }
  });

  it('is absent where the two pieces abut', () => {
    const near = apart[1];
    if (near === undefined) throw new Error('no file');
    expect(gapsIn(foldUnchanged(entriesOf([near], 'unified').entries, new Set()))).toHaveLength(0);
  });

  it('has a key of its own', () => {
    const out = foldUnchanged(entriesOf(apart, 'unified').entries, new Set());
    expect(new Set(out.map((one) => one.key)).size).toBe(out.length);
    expect(gapsIn(out)[0]?.key.startsWith('g:')).toBe(true);
  });

  it('is in both readings', () => {
    expect(gapsIn(foldUnchanged(entriesOf(apart, 'split').entries, new Set()))).toHaveLength(1);
  });

  /* There is nothing in hand to open, so `e` walks past it. */
  it('is not what e opens', () => {
    const { entries } = entriesOf(apart, 'unified');
    const out = foldUnchanged(entries, new Set());
    expect(foldIn(out, apart[0]?.hunks[1]?.id ?? '')).toBeNull();
  });

  it('is a plain rule rather than a press where nobody can fetch the lines', () => {
    expect(view).toContain('onExpand === undefined ? (');
    expect(view).toContain('<span className="diffview__between">{DIFF_SAYS.between(entry.hidden)}</span>');
  });
});
