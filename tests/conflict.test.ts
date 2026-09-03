/** Reading a file both sides changed in the same place.
 *
 * One rule outranks everything else here and most of these cases are about it:
 * text this cannot make sense of comes back byte for byte. A parser that
 * guesses at half a marker deletes somebody's work, so a clash inside a clash,
 * a section that never closes and markers in the wrong order all have to leave
 * the file exactly as it arrived.
 */

import { describe, expect, it } from 'vitest';

import {
  aroundClash,
  conflictWords,
  readConflict,
  resolveWith,
  saysConflict,
} from '../src/diff/conflict';

const lines = (...all: string[]): string => all.join('\n');

const ONE_CLASH = lines(
  'header {',
  '<<<<<<< HEAD',
  '  color: red;',
  '=======',
  '  color: blue;',
  '>>>>>>> graphe/blue-header',
  '}',
  '',
);

const WITH_BASE = lines(
  'header {',
  '<<<<<<< HEAD',
  '  color: red;',
  '||||||| merged common ancestors',
  '  color: black;',
  '=======',
  '  color: blue;',
  '>>>>>>> graphe/blue-header',
  '}',
  '',
);

/* ========================================================================== */
/* W-04a reading                                                               */
/* ========================================================================== */

describe('W-04a reading a conflicted file', () => {
  it('finds the clash, with what was above and below it', () => {
    const file = readConflict(ONE_CLASH);
    expect(file.ok).toBe(true);
    expect(file.clashes).toBe(1);
    expect(file.regions.map((one) => one.kind)).toEqual(['same', 'clash', 'same']);
  });

  it('reads both sides and what each was called', () => {
    const clash = readConflict(ONE_CLASH).regions[1];
    expect(clash).toMatchObject({
      kind: 'clash',
      mine: ['  color: red;'],
      theirs: ['  color: blue;'],
      mineLabel: 'HEAD',
      theirsLabel: 'graphe/blue-header',
      base: null,
    });
  });

  it('reads the version both sides started from when it is written down', () => {
    const clash = readConflict(WITH_BASE).regions[1];
    expect(clash).toMatchObject({ kind: 'clash', base: ['  color: black;'] });
  });

  it('reads a file with no markers as an ordinary file with nothing to decide', () => {
    const file = readConflict('one\ntwo\n');
    expect(file.ok).toBe(true);
    expect(file.clashes).toBe(0);
    expect(saysConflict(file)).toBe(conflictWords.resolved);
  });

  it('reads an empty file without inventing a region', () => {
    expect(readConflict('')).toMatchObject({ ok: true, clashes: 0, regions: [] });
  });

  it('finds every clash in a file that has several', () => {
    const two = lines(
      '<<<<<<< HEAD',
      'a',
      '=======',
      'A',
      '>>>>>>> theirs',
      'middle',
      '<<<<<<< HEAD',
      'b',
      '=======',
      'B',
      '>>>>>>> theirs',
      '',
    );
    expect(readConflict(two).clashes).toBe(2);
  });

  it('leaves a side that is empty empty, rather than guessing a line into it', () => {
    const gone = lines('<<<<<<< HEAD', 'a', '=======', '>>>>>>> theirs', '');
    expect(readConflict(gone).regions[0]).toMatchObject({ mine: ['a'], theirs: [] });
  });
});

/* ========================================================================== */
/* W-04b malformed input never eats anything                                   */
/* ========================================================================== */

describe('W-04b text this cannot read comes back exactly as it arrived', () => {
  const badly = [
    ['a clash that never closes', lines('<<<<<<< HEAD', 'mine', 'and more', '')],
    ['a clash with no second side', lines('<<<<<<< HEAD', 'mine', '=======', 'theirs', '')],
    ['a clash inside a clash', lines('<<<<<<< HEAD', '<<<<<<< HEAD', 'a', '=======', 'b', '>>>>>>> x', '=======', 'c', '>>>>>>> y', '')],
    ['the sides split twice', lines('<<<<<<< HEAD', 'a', '=======', 'b', '=======', 'c', '>>>>>>> x', '')],
    ['a close before a split', lines('<<<<<<< HEAD', 'a', '>>>>>>> x', '')],
    ['a base marker after the split', lines('<<<<<<< HEAD', 'a', '=======', '||||||| base', 'b', '>>>>>>> x', '')],
  ] as const;

  for (const [what, text] of badly) {
    it(`says it cannot read ${what}, and hands the text back`, () => {
      const file = readConflict(text);
      expect(file.ok).toBe(false);
      expect(file.because).toBe(conflictWords.unreadable);
      expect(saysConflict(file)).toBe(conflictWords.unreadable);
      expect(resolveWith(file, 'mine')).toBe(text);
      expect(resolveWith(file, 'theirs')).toBe(text);
      expect(resolveWith(file, 'both')).toBe(text);
    });
  }

  it('does not throw on any of it', () => {
    for (const [, text] of badly) expect(() => readConflict(text)).not.toThrow();
  });

  it('leaves a stray marker outside a clash alone as ordinary text', () => {
    const heading = lines('Title', '=======', 'body', '');
    const file = readConflict(heading);
    expect(file.ok).toBe(true);
    expect(file.clashes).toBe(0);
    expect(resolveWith(file, 'mine')).toBe(heading);
  });
});

/* ========================================================================== */
/* W-04c resolving                                                             */
/* ========================================================================== */

describe('W-04c taking one side', () => {
  const file = readConflict(ONE_CLASH);

  it('keeps yours', () => {
    expect(resolveWith(file, 'mine')).toBe(lines('header {', '  color: red;', '}', ''));
  });

  it('takes theirs', () => {
    expect(resolveWith(file, 'theirs')).toBe(lines('header {', '  color: blue;', '}', ''));
  });

  it('keeps both, yours first', () => {
    expect(resolveWith(file, 'both')).toBe(
      lines('header {', '  color: red;', '  color: blue;', '}', ''),
    );
  });

  it('drops the version they started from either way', () => {
    expect(resolveWith(readConflict(WITH_BASE), 'mine')).not.toContain('black');
  });

  it('settles one place at a time and leaves the rest with their markers', () => {
    const two = lines(
      '<<<<<<< HEAD',
      'a',
      '=======',
      'A',
      '>>>>>>> theirs',
      'middle',
      '<<<<<<< HEAD',
      'b',
      '=======',
      'B',
      '>>>>>>> theirs',
      '',
    );
    const half = resolveWith(readConflict(two), (at) => (at === 0 ? 'mine' : null));
    expect(half).toBe(lines('a', 'middle', '<<<<<<< HEAD', 'b', '=======', 'B', '>>>>>>> theirs', ''));
    expect(readConflict(half).clashes).toBe(1);
  });

  it('answers each place differently when it is asked to', () => {
    const two = lines('<<<<<<< HEAD', 'a', '=======', 'A', '>>>>>>> t', '<<<<<<< HEAD', 'b', '=======', 'B', '>>>>>>> t', '');
    expect(resolveWith(readConflict(two), (at) => (at === 0 ? 'mine' : 'theirs'))).toBe(
      lines('a', 'B', ''),
    );
  });

  it('keeps carriage returns exactly as they arrived', () => {
    const crlf = ['<<<<<<< HEAD\r', 'a\r', '=======\r', 'b\r', '>>>>>>> t\r', ''].join('\n');
    expect(resolveWith(readConflict(crlf), 'mine')).toBe('a\r\n');
  });

  it('leaves a file with no clashes exactly as it was', () => {
    expect(resolveWith(readConflict('one\ntwo\n'), 'theirs')).toBe('one\ntwo\n');
  });
});

/* ========================================================================== */
/* W-04d one clash with the file around it                                     */
/* ========================================================================== */

describe('W-04d what the three panes are handed', () => {
  it('gives the lines above, the two sides and the lines below', () => {
    expect(aroundClash(readConflict(ONE_CLASH), 0)).toEqual({
      before: ['header {'],
      mine: ['  color: red;'],
      base: null,
      theirs: ['  color: blue;'],
      after: ['}', ''],
    });
  });

  it('leaves the clashes it is not showing with their markers, so nothing looks decided', () => {
    const two = lines('<<<<<<< HEAD', 'a', '=======', 'A', '>>>>>>> t', 'mid', '<<<<<<< HEAD', 'b', '=======', 'B', '>>>>>>> t', '');
    const second = aroundClash(readConflict(two), 1);
    expect(second?.before).toEqual(['<<<<<<< HEAD', 'a', '=======', 'A', '>>>>>>> t', 'mid']);
    expect(second?.mine).toEqual(['b']);
  });

  it('has nothing to show for a place that is not there', () => {
    expect(aroundClash(readConflict(ONE_CLASH), 3)).toBeNull();
    expect(aroundClash(readConflict('<<<<<<< HEAD\n'), 0)).toBeNull();
  });
});

/* ========================================================================== */
/* W-04e the header                                                            */
/* ========================================================================== */

describe('W-04e the line over the three panes', () => {
  it('counts the places and names both sides', () => {
    expect(saysConflict(readConflict(ONE_CLASH))).toBe(
      'Both sides changed the same 1 place in this file, HEAD and graphe/blue-header.',
    );
  });

  it('counts several as several', () => {
    const two = lines('<<<<<<< a', 'x', '=======', 'y', '>>>>>>> b', '<<<<<<< a', 'x', '=======', 'y', '>>>>>>> b', '');
    expect(saysConflict(readConflict(two))).toContain('2 places');
  });

  it('falls back to plain words when the markers named nobody', () => {
    const bare = lines('<<<<<<<', 'x', '=======', 'y', '>>>>>>>', '');
    expect(saysConflict(readConflict(bare))).toContain(
      `${conflictWords.mine} and ${conflictWords.theirs}`,
    );
  });
});
