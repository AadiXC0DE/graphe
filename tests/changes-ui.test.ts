/** Choosing which pieces of a change to keep.
 *
 * The screen is a list of files, but the keyboard walks one flat run of pieces:
 * pressing down on the last piece of a file has to land on the first piece of
 * the next, or a review quietly stops half way and nobody notices.
 *
 * Two more failures are guarded here. A file's own "keep all" must touch that
 * file's pieces and no others — the pieces are keyed by path and line, and two
 * files whose changes start on the same line look alike. And the worst one:
 * keeping everything must hand back the change exactly as it arrived. If the
 * rebuilt patch differs by so much as a line number, "keep all" has quietly
 * become "rewrite", and the person who pressed it approved something else.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { CONTEXT, WIDER_STEP, widerThan, withWider } from '../src/diff/collapse';

import {
  SAYS,
  captionOf,
  fileKeep,
  keptOf,
  linesOf,
  orderOf,
  patchOf,
  stepBy,
  withFile,
  withHunk,
} from '../src/components/Changes';
import { countsOf, parseDiff } from '../src/diff/hunks';

/** A real `git diff`: a picture, a new file, a move, three pieces in one file
 *  and one in another. Kept as it came off the command, byte for byte. */
const CHANGE = `diff --git a/logo.png b/logo.png
index 1c0832c..aff5ecd 100644
Binary files a/logo.png and b/logo.png differ
diff --git a/src/keep.ts b/src/keep.ts
new file mode 100644
index 0000000..e80d16c
--- /dev/null
+++ b/src/keep.ts
@@ -0,0 +1,4 @@
+export const KEEP = {
+  one: 'first',
+  two: 'second',
+};
diff --git a/src/old-name.ts b/src/new-name.ts
similarity index 100%
rename from src/old-name.ts
rename to src/new-name.ts
diff --git a/src/panel.tsx b/src/panel.tsx
index 7322212..2720152 100644
--- a/src/panel.tsx
+++ b/src/panel.tsx
@@ -1,7 +1,8 @@
 import { useState } from 'react';

 export function Panel() {
-  const [open, setOpen] = useState(false);
+  const [open, setOpen] = useState(true);
+  const [busy, setBusy] = useState(false);
   const label = open ? 'Hide' : 'Show';
   return label;
 }
@@ -19,8 +20,8 @@ export function Panel() {
 // spacer 11
 // spacer 12

-function helper(a: number) {
-  return a + 1;
+function helper(a: number, b = 0) {
+  return a + b + 1;
 }

 // spacer 13
@@ -39,7 +40,8 @@ function helper(a: number) {
 const settings = {
   width: 320,
   height: 240,
-  title: 'Panel',
+  title: 'Side panel',
+  radius: 10,
 };

 export function last() {
diff --git a/src/theme.css b/src/theme.css
index f324eda..d74a67d 100644
--- a/src/theme.css
+++ b/src/theme.css
@@ -1,6 +1,5 @@
 .card {
   color: #111;
-  padding: 4px;
-  margin: 0;
+  padding: 8px;
   border: none;
 }
`;

/** The same change without the picture and the move, so a rebuilt patch can be
 *  held against it: a file carrying no pieces has nothing to keep, and comes
 *  back out of the rebuild by design. */
const TEXT_ONLY = CHANGE.split('diff --git ')
  .filter((part) => part !== '' && !part.startsWith('a/logo.png') && !part.startsWith('a/src/old-name.ts'))
  .map((part) => `diff --git ${part}`)
  .join('');

const files = parseDiff(CHANGE);
const none = new Set<string>();
const ids = orderOf(files);

const fileAt = (path: string) => {
  const found = files.find((file) => file.path === path);
  if (found === undefined) throw new Error(`no ${path} in the change`);
  return found;
};

/* ========================================================================== */
/* CH-01 walking the change with the keyboard                                  */
/* ========================================================================== */

describe('CH-01 where the next press lands', () => {
  /* One flat run, in reading order. A picture and a move carry no pieces, so
     the keyboard never stops on them — there is nothing there to say yes to. */
  it('reads every piece as one run, in the order they are shown', () => {
    expect(ids).toEqual([
      'src/keep.ts:0',
      'src/panel.tsx:1',
      'src/panel.tsx:19',
      'src/panel.tsx:39',
      'src/theme.css:1',
    ]);
  });

  it('steps off the end of one file onto the top of the next', () => {
    expect(stepBy(ids, 'src/keep.ts:0', 1)).toBe('src/panel.tsx:1');
    expect(stepBy(ids, 'src/panel.tsx:39', 1)).toBe('src/theme.css:1');
  });

  it('steps back across the same boundary', () => {
    expect(stepBy(ids, 'src/theme.css:1', -1)).toBe('src/panel.tsx:39');
    expect(stepBy(ids, 'src/panel.tsx:1', -1)).toBe('src/keep.ts:0');
  });

  /* Stopping, not wrapping. Coming back round to the top of a review reads as
     having lost your place rather than as having reached the end. */
  it('stays put at either end', () => {
    expect(stepBy(ids, 'src/keep.ts:0', -1)).toBe('src/keep.ts:0');
    expect(stepBy(ids, 'src/theme.css:1', 1)).toBe('src/theme.css:1');
  });

  it('starts at the top when nothing has been chosen yet', () => {
    expect(stepBy(ids, null, 1)).toBe('src/keep.ts:0');
    expect(stepBy([], null, 1)).toBe(null);
  });
});

/* ========================================================================== */
/* CH-02 keeping and dropping                                                  */
/* ========================================================================== */

describe('CH-02 what a press turns off', () => {
  it('flips one piece and leaves the rest alone', () => {
    const off = withHunk(none, 'src/panel.tsx:19');
    expect([...off]).toEqual(['src/panel.tsx:19']);
    expect([...withHunk(off, 'src/panel.tsx:19')]).toEqual([]);
  });

  /* The whole point of the per-file control: it must reach every piece of that
     file and not one piece of its neighbour. */
  it('drops exactly the pieces of the file it was pressed on', () => {
    const off = withFile(none, fileAt('src/panel.tsx'), false);
    expect([...off].sort()).toEqual(['src/panel.tsx:1', 'src/panel.tsx:19', 'src/panel.tsx:39']);
  });

  it('keeps a file back without disturbing what else was dropped', () => {
    const off = withFile(withHunk(none, 'src/theme.css:1'), fileAt('src/panel.tsx'), false);
    const back = withFile(off, fileAt('src/panel.tsx'), true);
    expect([...back]).toEqual(['src/theme.css:1']);
  });

  it('says whether a file is kept whole, in part, or not at all', () => {
    const panel = fileAt('src/panel.tsx');
    expect(fileKeep(panel, none)).toBe('all');
    expect(fileKeep(panel, withHunk(none, 'src/panel.tsx:19'))).toBe('some');
    expect(fileKeep(panel, withFile(none, panel, false))).toBe('none');
  });

  /* A picture has nothing to choose between, so it is never "partly kept". */
  it('counts a file with no pieces as kept', () => {
    expect(fileKeep(fileAt('logo.png'), none)).toBe('all');
  });
});

/* ========================================================================== */
/* CH-03 the count under the heading                                           */
/* ========================================================================== */

describe('CH-03 adding up what is kept', () => {
  /* The picture and the move are not in it: neither carries a piece, so neither
     can be kept, and a count that included them would promise more than the
     patch delivers. */
  it('counts the whole change while nothing is dropped', () => {
    expect(countsOf(keptOf(files, none))).toEqual({ files: 3, hunks: 5, added: 11, removed: 6 });
  });

  it('takes a dropped piece out of the lines as well as the count', () => {
    const off = withHunk(none, 'src/panel.tsx:1');
    expect(countsOf(keptOf(files, off))).toEqual({ files: 3, hunks: 4, added: 9, removed: 5 });
  });

  /* A file drops out of the tally when its last piece does. Saying "2 files"
     over a review that would touch one is the sort of small lie that costs
     trust in every other number on the screen. */
  it('stops counting a file once none of it is kept', () => {
    const off = withFile(none, fileAt('src/theme.css'), false);
    expect(countsOf(keptOf(files, off)).files).toBe(2);
    expect(countsOf(keptOf(files, new Set(ids)))).toEqual({
      files: 0,
      hunks: 0,
      added: 0,
      removed: 0,
    });
  });

  it('says the count in a sentence with a number in it', () => {
    expect(SAYS.confirm(0)).toBe('Nothing kept');
    expect(SAYS.confirm(1)).toBe('Keep 1 change');
    expect(SAYS.confirm(4)).toBe('Keep 4 changes');
  });
});

/* ========================================================================== */
/* CH-04 the patch that goes back                                              */
/* ========================================================================== */

describe('CH-04 handing the change back', () => {
  /* The one that matters. "Keep everything" has to be the identity: the same
     text, character for character, not a re-rendering of it that happens to
     apply today. */
  it('gives back the change exactly as it arrived when nothing was dropped', () => {
    expect(patchOf(parseDiff(TEXT_ONLY), none)).toBe(TEXT_ONLY);
  });

  it('leaves out a dropped piece and moves the ones under it', () => {
    const rebuilt = patchOf(files, withHunk(none, 'src/panel.tsx:1'));
    expect(rebuilt).not.toContain('const [busy, setBusy]');
    // The first piece added a line; without it the two below start one earlier.
    expect(rebuilt.split('\n').filter((line) => line.startsWith('@@'))).toEqual([
      '@@ -0,0 +1,4 @@',
      '@@ -19,8 +19,8 @@ export function Panel() {',
      '@@ -39,7 +39,8 @@ function helper(a: number) {',
      '@@ -1,6 +1,5 @@',
    ]);
  });

  it('leaves a file out whole once none of it is kept', () => {
    const rebuilt = patchOf(files, withFile(none, fileAt('src/panel.tsx'), false));
    expect(rebuilt).not.toContain('src/panel.tsx');
    expect(rebuilt).toContain('src/theme.css');
  });

  /* Reading the rebuilt patch back has to find what was kept and nothing else,
     which is the cheapest stand-in for `git apply` this side of a disk. */
  it('rebuilds into something that reads back the same way', () => {
    const off = withHunk(none, 'src/panel.tsx:19');
    const again = parseDiff(patchOf(files, off));
    expect(countsOf(again)).toEqual(countsOf(keptOf(files, off)));
  });
});

/* ========================================================================== */
/* CH-05 one piece, on screen                                                  */
/* ========================================================================== */

describe('CH-05 the lines of a piece', () => {
  const piece = fileAt('src/theme.css').hunks[0];
  const inside = fileAt('src/panel.tsx').hunks[1];
  if (piece === undefined || inside === undefined) throw new Error('the change lost a piece');

  /* Both sides at once. A removed line has no number on the new side and an
     added one has none on the old, and putting a number in either place is how
     a reader ends up looking at the wrong line of the file on disk. */
  it('numbers each line on the side it belongs to', () => {
    expect(linesOf(piece).map((line) => [line.sign, line.before, line.after])).toEqual([
      [' ', 1, 1],
      [' ', 2, 2],
      ['-', 3, null],
      ['-', 4, null],
      ['+', null, 3],
      [' ', 5, 4],
      [' ', 6, 5],
    ]);
  });

  it('carries the text without the mark in front of it', () => {
    expect(linesOf(piece).map((line) => line.text)).toEqual([
      '.card {',
      '  color: #111;',
      '  padding: 4px;',
      '  margin: 0;',
      '  padding: 8px;',
      '  border: none;',
      '}',
    ]);
  });

  it('picks up the name a change sits inside, where there is one', () => {
    expect(captionOf(inside)).toBe('export function Panel() {');
    expect(captionOf(piece)).toBe('');
  });

  it('says where a piece is in words with a number in them', () => {
    expect(SAYS.where(piece)).toBe('Lines 1–5');
  });
});

/* ========================================================================== */
/* CH-06 the words on it                                                       */
/* ========================================================================== */

describe('CH-06 what the screen says', () => {
  it('says nothing a designer would have to look up', () => {
    const said = Object.values(SAYS)
      .map((one) => (typeof one === 'function' ? '' : one))
      .join(' ')
      .toLowerCase();
    for (const jargon of ['hunk', 'diff', 'patch', 'staged', 'commit', 'binary', 'blob', 'git']) {
      expect(said).not.toContain(jargon);
    }
  });
});

/* ========================================================================== */
/* CH-07 more of the file than git sent                                        */
/* ========================================================================== */

/** Reading a file again with a wider window round the change.
 *
 * The fold between two pieces offers "Show 40 more lines", and the lines it is
 * offering are lines git never handed over. Nothing in the window can work them
 * out, so the press has to reach the disk. This is that road, end to end: a
 * ceiling in the reader, a channel, a prop, and the merge that puts the wider
 * read back where the narrow one was. */
const TWO_FILES = `diff --git a/one.ts b/one.ts
--- a/one.ts
+++ b/one.ts
@@ -1,3 +1,3 @@
 const a = 1;
-const b = 2;
+const b = 3;
 const c = 4;
diff --git a/two.ts b/two.ts
--- a/two.ts
+++ b/two.ts
@@ -1,2 +1,2 @@
-let x = 0;
+let x = 1;
 let y = 2;
`;

describe('CH-07 asking for more of the file', () => {
  const changesTsx = readFileSync(
    fileURLToPath(new URL('../src/components/Changes.tsx', import.meta.url)),
    'utf8',
  );
  const app = readFileSync(fileURLToPath(new URL('../src/App.tsx', import.meta.url)), 'utf8');
  const ipc = readFileSync(fileURLToPath(new URL('../src/lib/ipc.ts', import.meta.url)), 'utf8');
  const preload = readFileSync(
    fileURLToPath(new URL('../electron/preload.ts', import.meta.url)),
    'utf8',
  );
  const main = readFileSync(fileURLToPath(new URL('../electron/main.ts', import.meta.url)), 'utf8');
  const bridge = readFileSync(
    fileURLToPath(new URL('../src/lib/bridge.ts', import.meta.url)),
    'utf8',
  );

  it('is one road with all five planks', () => {
    expect(ipc).toContain("changesWider: 'graphe:changes-wider'");
    expect(preload).toContain('ipcRenderer.invoke(CHANNEL.changesWider');
    expect(main).toContain('handle<string>(CHANNEL.changesWider');
    expect(bridge).toContain('changesWider: (file, context, where) =>');
    expect(app).toContain('bridge.changesWider(');
  });

  it('asks git for the one file, and only for the one file', () => {
    expect(main).toContain('diffWider(file, context)');
    const repo = readFileSync(
      fileURLToPath(new URL('../src/history/repo.ts', import.meta.url)),
      'utf8',
    );
    expect(repo).toContain("`-U${String(lines)}`");
    expect(repo).toContain("'--',\n      file,");
  });

  /* Widening the same file twice must open it further, not read it again at
     the same width. */
  it('asks for a wider window each time', () => {
    expect(widerThan(undefined)).toBe(CONTEXT + WIDER_STEP);
    expect(widerThan(widerThan(undefined))).toBe(CONTEXT + WIDER_STEP * 2);
  });

  it('puts the wider read where the narrow one was, and leaves the rest alone', () => {
    const files = parseDiff(TWO_FILES);
    const wider = parseDiff(TWO_FILES).filter((one) => one.path === 'one.ts');
    const after = withWider(files, { 'one.ts': wider });
    expect(after.map((one) => one.path)).toEqual(files.map((one) => one.path));
  });

  it('leaves every file alone when nothing has been widened', () => {
    const files = parseDiff(TWO_FILES);
    expect(withWider(files, {})).toEqual(files);
  });

  it('offers nothing to press where the screen was given no way to ask', () => {
    expect(changesTsx).toContain('onWider === undefined ? {} : { onExpand: readWider }');
  });
});
