/** A change, cut into pieces somebody can say yes or no to.
 *
 * Two failures are guarded against here. The first is misreading: a change that
 * arrives as a new file, a deletion, a move, a picture, or with Windows line
 * endings has to come back as what it is, not as a modification of nothing.
 *
 * The second is worse, because it looks like it worked. Keeping only some of
 * the pieces means every piece under a dropped one starts on a different line
 * than it used to, and a patch whose `@@` headers still describe the whole
 * change is refused by `git apply` — or, quietly, applied in the wrong place.
 * The arithmetic is checked here piece by piece.
 */

import { describe, expect, it } from 'vitest';

import {
  undoOf, WORDS, countsOf, diffOf, parseDiff } from '../src/diff/hunks';
import type { Hunk } from '../src/diff/hunks';

const diff = (...lines: readonly string[]): string => `${lines.join('\n')}\n`;

const TWO_FILES = diff(
  'diff --git a/src/one.ts b/src/one.ts',
  'index 1111111..2222222 100644',
  '--- a/src/one.ts',
  '+++ b/src/one.ts',
  '@@ -1,4 +1,5 @@',
  ' const a = 1;',
  ' const b = 2;',
  '+const c = 3;',
  ' const d = 4;',
  ' const e = 5;',
  'diff --git a/src/two.css b/src/two.css',
  'index 3333333..4444444 100644',
  '--- a/src/two.css',
  '+++ b/src/two.css',
  '@@ -3,5 +3,4 @@',
  ' .card {',
  '   color: red;',
  '-  padding: 4px;',
  '-  margin: 0;',
  '+  padding: 8px;',
  '   border: none;',
);

/* One file, three pieces, each adding a line. The starts are far enough apart
   that dropping any one of them has to move the ones below it. */
const THREE_PIECES = diff(
  'diff --git a/notes.txt b/notes.txt',
  'index aaaaaaa..bbbbbbb 100644',
  '--- a/notes.txt',
  '+++ b/notes.txt',
  '@@ -1,5 +1,6 @@',
  ' one',
  ' two',
  '+two and a half',
  ' three',
  ' four',
  ' five',
  '@@ -10,5 +11,6 @@',
  ' ten',
  ' eleven',
  '+eleven and a half',
  ' twelve',
  ' thirteen',
  ' fourteen',
  '@@ -20,5 +22,6 @@',
  ' twenty',
  ' twenty-one',
  '+twenty-one and a half',
  ' twenty-two',
  ' twenty-three',
  ' twenty-four',
);

const headersIn = (patch: string): string[] => patch.split('\n').filter((line) => line.startsWith('@@'));

/* ========================================================================== */
/* HK-01 reading a change                                                      */
/* ========================================================================== */

describe('HK-01 what is in there', () => {
  it('keeps the files apart, and counts what each one does', () => {
    const files = parseDiff(TWO_FILES);
    expect(files.map((one) => one.path)).toEqual(['src/one.ts', 'src/two.css']);
    expect(files.map((one) => one.kind)).toEqual(['modified', 'modified']);
    expect(files[0]?.hunks).toHaveLength(1);
    expect(files[0]?.hunks[0]).toMatchObject({
      path: 'src/one.ts',
      oldStart: 1,
      oldLines: 4,
      newStart: 1,
      newLines: 5,
      added: 1,
      removed: 0,
    });
    expect(files[1]?.hunks[0]).toMatchObject({ oldStart: 3, oldLines: 5, newLines: 4, added: 1, removed: 2 });
  });

  it('hands back the piece as it arrived, header and all', () => {
    const piece = parseDiff(TWO_FILES)[0]?.hunks[0];
    expect(piece?.text).toBe('@@ -1,4 +1,5 @@\n const a = 1;\n const b = 2;\n+const c = 3;\n const d = 4;\n const e = 5;\n');
  });

  /* A choice made about a piece has to survive reading the same change again,
     which it cannot do if the name of the piece is a counter. */
  it('names a piece after where it is, the same way every time', () => {
    const first = parseDiff(TWO_FILES).flatMap((one) => one.hunks.map((piece) => piece.id));
    const again = parseDiff(TWO_FILES).flatMap((one) => one.hunks.map((piece) => piece.id));
    expect(first).toEqual(again);
    expect(new Set(first).size).toBe(first.length);
    expect(first[0]).toContain('src/one.ts');
  });

  it('has an answer for nothing at all', () => {
    expect(parseDiff('')).toEqual([]);
    expect(parseDiff('   \n')).toEqual([]);
    expect(diffOf([], () => true)).toBe('');
  });
});

/* ========================================================================== */
/* HK-02 the shapes a change comes in                                          */
/* ========================================================================== */

describe('HK-02 more than an edit', () => {
  it('knows a file that was not there before', () => {
    const files = parseDiff(
      diff(
        'diff --git a/src/new.ts b/src/new.ts',
        'new file mode 100644',
        'index 0000000..ccccccc',
        '--- /dev/null',
        '+++ b/src/new.ts',
        '@@ -0,0 +1,2 @@',
        '+export const one = 1;',
        '+export const two = 2;',
      ),
    );
    expect(files[0]?.kind).toBe('added');
    expect(files[0]?.path).toBe('src/new.ts');
    expect(files[0]?.hunks[0]).toMatchObject({ oldStart: 0, oldLines: 0, newStart: 1, newLines: 2, added: 2 });
  });

  it('knows a file that is gone, and still says where it was', () => {
    const files = parseDiff(
      diff(
        'diff --git a/src/old.ts b/src/old.ts',
        'deleted file mode 100644',
        'index ddddddd..0000000',
        '--- a/src/old.ts',
        '+++ /dev/null',
        '@@ -1,2 +0,0 @@',
        '-export const one = 1;',
        '-export const two = 2;',
      ),
    );
    expect(files[0]?.kind).toBe('removed');
    expect(files[0]?.path).toBe('src/old.ts');
    expect(files[0]?.hunks[0]).toMatchObject({ newStart: 0, newLines: 0, removed: 2 });
  });

  it('knows a file that moved, and both ends of the move', () => {
    const files = parseDiff(
      diff(
        'diff --git a/old/name.ts b/new/name.ts',
        'similarity index 87%',
        'rename from old/name.ts',
        'rename to new/name.ts',
        'index eeeeeee..fffffff 100644',
        '--- a/old/name.ts',
        '+++ b/new/name.ts',
        '@@ -1,3 +1,3 @@',
        ' a',
        '-b',
        '+c',
        ' d',
      ),
    );
    expect(files[0]).toMatchObject({ kind: 'renamed', oldPath: 'old/name.ts', path: 'new/name.ts' });
    expect(files[0]?.hunks).toHaveLength(1);
  });

  it('knows a move that changed nothing, which has no pieces at all', () => {
    const files = parseDiff(
      diff('diff --git a/a.txt b/b.txt', 'similarity index 100%', 'rename from a.txt', 'rename to b.txt'),
    );
    expect(files[0]).toMatchObject({ kind: 'renamed', oldPath: 'a.txt', path: 'b.txt', hunks: [] });
  });

  /* A picture has no lines to pick through, so it is flagged rather than
     reported as a file where nothing happened. */
  it('flags what is not text and leaves it whole', () => {
    const files = parseDiff(
      diff(
        'diff --git a/logo.png b/logo.png',
        'index 1111111..2222222 100644',
        'Binary files a/logo.png and b/logo.png differ',
      ),
    );
    expect(files[0]?.binary).toBe(true);
    expect(files[0]?.hunks).toEqual([]);
    expect(files[0]?.path).toBe('logo.png');
  });

  it('reads a file whose name has a space in it', () => {
    const files = parseDiff(
      diff(
        'diff --git a/my notes.md b/my notes.md',
        'index 1111111..2222222 100644',
        '--- a/my notes.md',
        '+++ b/my notes.md',
        '@@ -1,2 +1,2 @@',
        ' one',
        '-two',
        '+three',
      ),
    );
    expect(files[0]?.path).toBe('my notes.md');
  });
});

/* ========================================================================== */
/* HK-03 the awkward text                                                      */
/* ========================================================================== */

describe('HK-03 text that is not tidy', () => {
  const NO_NEWLINE = diff(
    'diff --git a/tail.txt b/tail.txt',
    'index 1111111..2222222 100644',
    '--- a/tail.txt',
    '+++ b/tail.txt',
    '@@ -1,2 +1,2 @@',
    ' first',
    '-second',
    '\\ No newline at end of file',
    '+second again',
    '\\ No newline at end of file',
  );

  /* The note is not a line of the file. Counting it as one puts every count in
     the header out by one, and the patch is refused. */
  it('does not count the note about a missing last newline', () => {
    const piece = parseDiff(NO_NEWLINE)[0]?.hunks[0];
    expect(piece).toMatchObject({ oldLines: 2, newLines: 2, added: 1, removed: 1 });
  });

  it('carries the note through into a rebuilt patch, both times it appears', () => {
    const rebuilt = diffOf(parseDiff(NO_NEWLINE), () => true);
    expect(rebuilt.split('\\ No newline at end of file')).toHaveLength(3);
    expect(rebuilt).toBe(NO_NEWLINE);
  });

  /* The carriage returns belong to the file, not to the diff. Trimming them
     rewrites every line of a Windows file the moment one piece is kept. */
  it('leaves Windows line endings on the content exactly as they were', () => {
    const windows = diff(
      'diff --git a/win.txt b/win.txt',
      'index 1111111..2222222 100644',
      '--- a/win.txt',
      '+++ b/win.txt',
      '@@ -1,3 +1,3 @@',
      ' alpha\r',
      '-beta\r',
      '+gamma\r',
      ' delta\r',
    );
    const piece = parseDiff(windows)[0]?.hunks[0];
    expect(piece).toMatchObject({ oldLines: 3, newLines: 3, added: 1, removed: 1 });
    expect(piece?.text).toContain('+gamma\r\n');
    expect(diffOf(parseDiff(windows), () => true)).toBe(windows);
  });

  it('reads a change whose every line is Windows-terminated', () => {
    const all = TWO_FILES.split('\n').join('\r\n');
    const files = parseDiff(all);
    expect(files.map((one) => one.path)).toEqual(['src/one.ts', 'src/two.css']);
    expect(countsOf(files)).toEqual({ files: 2, hunks: 2, added: 2, removed: 2 });
    expect(diffOf(files, () => true)).toBe(all);
  });

  it('treats a bare empty line as a line that stayed', () => {
    const files = parseDiff(
      diff(
        'diff --git a/gap.txt b/gap.txt',
        'index 1111111..2222222 100644',
        '--- a/gap.txt',
        '+++ b/gap.txt',
        '@@ -1,3 +1,4 @@',
        ' one',
        '',
        '+two',
        ' three',
      ),
    );
    expect(files[0]?.hunks[0]).toMatchObject({ oldLines: 3, newLines: 4, added: 1 });
  });
});

/* ========================================================================== */
/* HK-04 keeping only some of it                                               */
/* ========================================================================== */

describe('HK-04 building the patch back', () => {
  const pieces = () => parseDiff(THREE_PIECES)[0]?.hunks ?? [];

  it('gives back what it was given when everything is kept', () => {
    expect(diffOf(parseDiff(THREE_PIECES), () => true)).toBe(THREE_PIECES);
    expect(diffOf(parseDiff(TWO_FILES), () => true)).toBe(TWO_FILES);
  });

  /* The one that matters. The first piece added a line, so with it gone every
     piece below it starts one line earlier than the original header says. */
  it('moves the pieces below a dropped one up by what it would have added', () => {
    const all = pieces();
    const first = all[0]?.id;
    const rebuilt = diffOf(parseDiff(THREE_PIECES), (piece: Hunk) => piece.id !== first);
    expect(headersIn(rebuilt)).toEqual(['@@ -10,5 +10,6 @@', '@@ -20,5 +21,6 @@']);
    // The old side is untouched: the patch still applies to the file as it was.
    expect(rebuilt).toContain(' eleven\n+eleven and a half\n');
    expect(rebuilt).not.toContain('two and a half');
  });

  it('moves only what is below, when the dropped one is in the middle', () => {
    const middle = pieces()[1]?.id;
    const rebuilt = diffOf(parseDiff(THREE_PIECES), (piece: Hunk) => piece.id !== middle);
    expect(headersIn(rebuilt)).toEqual(['@@ -1,5 +1,6 @@', '@@ -20,5 +21,6 @@']);
  });

  it('leaves the headers alone when the dropped one is the last', () => {
    const last = pieces()[2]?.id;
    const rebuilt = diffOf(parseDiff(THREE_PIECES), (piece: Hunk) => piece.id !== last);
    expect(headersIn(rebuilt)).toEqual(['@@ -1,5 +1,6 @@', '@@ -10,5 +11,6 @@']);
  });

  it('counts a removal the other way, so the pieces below move down', () => {
    const trimming = diff(
      'diff --git a/cut.txt b/cut.txt',
      'index 1111111..2222222 100644',
      '--- a/cut.txt',
      '+++ b/cut.txt',
      '@@ -1,4 +1,2 @@',
      ' one',
      '-two',
      '-three',
      ' four',
      '@@ -10,3 +8,4 @@',
      ' ten',
      '+ten and a half',
      ' eleven',
      ' twelve',
    );
    const files = parseDiff(trimming);
    const first = files[0]?.hunks[0]?.id;
    const rebuilt = diffOf(files, (piece: Hunk) => piece.id !== first);
    expect(headersIn(rebuilt)).toEqual(['@@ -10,3 +10,4 @@']);
  });

  it('leaves a file out whole when nothing in it was kept', () => {
    const rebuilt = diffOf(parseDiff(TWO_FILES), (piece: Hunk) => piece.path === 'src/two.css');
    expect(rebuilt).not.toContain('src/one.ts');
    expect(rebuilt.startsWith('diff --git a/src/two.css')).toBe(true);
    expect(headersIn(rebuilt)).toEqual(['@@ -3,5 +3,4 @@']);
  });

  it('rebuilds into something it can read back the same way', () => {
    const files = parseDiff(THREE_PIECES);
    const first = files[0]?.hunks[0]?.id;
    const again = parseDiff(diffOf(files, (piece: Hunk) => piece.id !== first));
    expect(again[0]?.hunks.map((piece) => [piece.oldStart, piece.newStart])).toEqual([
      [10, 10],
      [20, 21],
    ]);
    expect(countsOf(again)).toEqual({ files: 1, hunks: 2, added: 2, removed: 0 });
  });

  it('spells the counts out even where the change was one line', () => {
    const single = diff(
      'diff --git a/one.txt b/one.txt',
      'index 1111111..2222222 100644',
      '--- a/one.txt',
      '+++ b/one.txt',
      '@@ -7 +7 @@ inside something',
      '-before',
      '+after',
    );
    expect(headersIn(diffOf(parseDiff(single), () => true))).toEqual(['@@ -7,1 +7,1 @@ inside something']);
  });
});

/* ========================================================================== */
/* HK-05 how much there is                                                     */
/* ========================================================================== */

describe('HK-05 saying it in one line', () => {
  it('adds up across the files', () => {
    expect(countsOf(parseDiff(TWO_FILES))).toEqual({ files: 2, hunks: 2, added: 2, removed: 2 });
    expect(countsOf(parseDiff(THREE_PIECES))).toEqual({ files: 1, hunks: 3, added: 3, removed: 0 });
  });

  it('reads as a sentence, in words anybody has', () => {
    expect(WORDS.summary(countsOf(parseDiff(TWO_FILES)))).toBe('2 files, 2 changes — 2 lines added, 2 removed');
    expect(WORDS.summary(countsOf(parseDiff(THREE_PIECES)))).toBe('1 file, 3 changes — 3 lines added, 0 removed');
    expect(WORDS.summary(countsOf([]))).toBe(WORDS.nothing);
  });

  it('says nothing a designer would have to look up', () => {
    const said = [WORDS.nothing, WORDS.whole, ...Object.values(WORDS.kinds), WORDS.summary(countsOf(parseDiff(TWO_FILES)))].join(' ');
    for (const jargon of ['hunk', 'diff', 'patch', 'staged', 'commit', 'binary', 'blob']) {
      expect(said.toLowerCase()).not.toContain(jargon);
    }
  });
});

/** The patch that takes pieces back out is applied in reverse, against a file
 *  that still holds every piece. So its anchors are the ones that arrived. */
describe('undoOf — anchors for a patch applied in reverse', () => {
  const pieces = () => parseDiff(THREE_PIECES)[0]?.hunks ?? [];

  it('leaves every new-side number exactly where it came in', () => {
    const first = pieces()[0]?.id;
    // diffOf, built for a forward apply onto the old file, moves the ones
    // below the dropped piece up by what it would have added.
    expect(headersIn(diffOf(parseDiff(THREE_PIECES), (p: Hunk) => p.id !== first))).toEqual([
      '@@ -10,5 +10,6 @@',
      '@@ -20,5 +21,6 @@',
    ]);
    // Reverse-applied, the file still holds the first piece, so the ones below
    // have not moved — and must not be told they have.
    expect(headersIn(undoOf(parseDiff(THREE_PIECES), (p: Hunk) => p.id !== first))).toEqual([
      '@@ -10,5 +11,6 @@',
      '@@ -20,5 +22,6 @@',
    ]);
  });

  it('is unchanged from the input when everything is taken', () => {
    expect(undoOf(parseDiff(THREE_PIECES), () => true)).toBe(THREE_PIECES);
  });

  it('leaves a file out whole when nothing of it is taken', () => {
    expect(undoOf(parseDiff(THREE_PIECES), () => false)).toBe('');
  });

  it('holds the piece\u2019s own lines, not a rebuilt version of them', () => {
    const last = pieces()[2]?.id;
    const only = undoOf(parseDiff(THREE_PIECES), (p: Hunk) => p.id === last);
    expect(only).toContain('twenty-one and a half');
    expect(headersIn(only)).toEqual(['@@ -20,5 +22,6 @@']);
  });
});
