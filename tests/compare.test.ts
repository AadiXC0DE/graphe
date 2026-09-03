/** Two or three goes at the same job, against the base they all started from.
 *
 * The interesting cases are the ones a person is actually deciding between: a
 * file every go changed the same way (nothing to weigh), a file only one of
 * them touched (which is itself a difference), and what taking one of them does
 * to the other two.
 */

import { describe, expect, it } from 'vitest';

import { compare, compareWords, pickOne, type Attempt } from '../src/work/compare';

function patch(path: string, body: string): string {
  return [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`, body, ''].join('\n');
}

const SWAP_TWO = patch(
  'src/a.css',
  ['@@ -1,3 +1,3 @@', ' one', '-two', '+TWO', ' three'].join('\n'),
);
const SWAP_TWO_DIFFERENTLY = patch(
  'src/a.css',
  ['@@ -1,3 +1,3 @@', ' one', '-two', '+deux', ' three'].join('\n'),
);
const ADD_A_FILE = patch(
  'src/b.ts',
  ['new file mode 100644', '@@ -0,0 +1,2 @@', '+const b = 1;', '+export default b;'].join('\n'),
);

function attempt(over: Partial<Attempt> = {}): Attempt {
  return { id: 'one', name: 'Way 1 of 2', state: 'done', diff: SWAP_TWO, ...over };
}

/* ========================================================================== */
/* W-05a file by file                                                          */
/* ========================================================================== */

describe('W-05a what each go did, file by file', () => {
  it('names the base it lined them up against', () => {
    expect(compare([attempt()], 'main').base).toBe('main');
  });

  it('calls a file all of them changed the same way same in all', () => {
    const sheet = compare(
      [attempt({ id: 'one' }), attempt({ id: 'two', name: 'Way 2 of 2' })],
      'main',
    );
    expect(sheet.sameInAll).toEqual(['src/a.css']);
    expect(sheet.differing).toEqual([]);
    expect(sheet.files[0]?.differs).toBe(false);
  });

  it('calls a file they changed differently a difference', () => {
    const sheet = compare(
      [attempt({ id: 'one' }), attempt({ id: 'two', name: 'Way 2 of 2', diff: SWAP_TWO_DIFFERENTLY })],
      'main',
    );
    expect(sheet.differing).toEqual(['src/a.css']);
    expect(sheet.sameInAll).toEqual([]);
  });

  it('counts a file only one of them touched as a difference too, because the others chose not to', () => {
    const sheet = compare(
      [
        attempt({ id: 'one', diff: `${SWAP_TWO}${ADD_A_FILE}` }),
        attempt({ id: 'two', name: 'Way 2 of 2' }),
      ],
      'main',
    );
    expect(sheet.differing).toEqual(['src/b.ts']);
    expect(sheet.files.find((file) => file.path === 'src/b.ts')?.touched).toEqual(['one']);
  });

  it('keeps the files in name order, so the same two goes draw the same sheet twice', () => {
    const sheet = compare([attempt({ diff: `${ADD_A_FILE}${SWAP_TWO}` })], 'main');
    expect(sheet.files.map((file) => file.path)).toEqual(['src/a.css', 'src/b.ts']);
  });
});

/* ========================================================================== */
/* W-05b the column headings                                                   */
/* ========================================================================== */

describe('W-05b what each column says about itself', () => {
  it('gives a go that produced nothing a column anyway', () => {
    const sheet = compare([attempt({ id: 'empty', diff: '' })], 'main');
    expect(sheet.attempts).toHaveLength(1);
    expect(sheet.attempts[0]?.line).toBe(compareWords.changedNothing);
  });

  it('says so far while a go can still change', () => {
    const sheet = compare([attempt({ state: 'running' })], 'main');
    expect(sheet.attempts[0]?.final).toBe(false);
    expect(sheet.attempts[0]?.line).toContain('so far');
    expect(sheet.says).toContain('still going');
  });

  it('counts a go that did not work as over, with nothing to take', () => {
    const sheet = compare([attempt({ state: 'failed' })], 'main');
    expect(sheet.attempts[0]?.final).toBe(true);
    expect(sheet.attempts[0]?.canTake).toBe(false);
  });

  it('adds a go’s whole change up', () => {
    const sheet = compare([attempt({ diff: `${SWAP_TWO}${ADD_A_FILE}` })], 'main');
    expect(sheet.attempts[0]).toMatchObject({ files: 2, added: 3, removed: 1 });
  });
});

/* ========================================================================== */
/* W-05c taking one                                                            */
/* ========================================================================== */

describe('W-05c taking one of them', () => {
  const sheet = compare(
    [
      attempt({ id: 'one', name: 'Way 1 of 3' }),
      attempt({ id: 'two', name: 'Way 2 of 3', diff: SWAP_TWO_DIFFERENTLY }),
      attempt({ id: 'three', name: 'Way 3 of 3', diff: ADD_A_FILE }),
    ],
    'main',
  );

  it('says what to land and what goes with the decision', () => {
    expect(pickOne(sheet, 'two')).toMatchObject({ land: 'two', drop: ['one', 'three'] });
  });

  it('says out loud that the others are thrown away', () => {
    expect(pickOne(sheet, 'two')?.says).toContain('Way 2 of 3');
    expect(pickOne(sheet, 'two')?.says).toContain('other 2');
  });

  it('names the only other one rather than counting it', () => {
    const two = compare(
      [attempt({ id: 'one', name: 'Way 1 of 2' }), attempt({ id: 'two', name: 'Way 2 of 2' })],
      'main',
    );
    expect(pickOne(two, 'one')?.says).toContain('Way 2 of 2');
  });

  it('drops nothing when there was only ever one', () => {
    const alone = compare([attempt({ id: 'one', name: 'The only one' })], 'main');
    expect(pickOne(alone, 'one')?.drop).toEqual([]);
  });

  it('lands nothing when the press was on a go the sheet no longer has', () => {
    expect(pickOne(sheet, 'gone')).toBeNull();
  });
});

/* ========================================================================== */
/* W-05d the line under the heading                                            */
/* ========================================================================== */

describe('W-05d the line under the heading', () => {
  it('says there is nothing to decide when they all agreed', () => {
    const sheet = compare([attempt({ id: 'one' }), attempt({ id: 'two' })], 'main');
    expect(sheet.says).toContain('Nothing to decide');
  });

  it('counts what there is to decide about', () => {
    const sheet = compare(
      [attempt({ id: 'one' }), attempt({ id: 'two', diff: SWAP_TWO_DIFFERENTLY })],
      'main',
    );
    expect(sheet.says).toBe(compareWords.summary(1, 0));
  });

  it('says none of them changed anything when none of them did', () => {
    expect(compare([attempt({ diff: '' })], 'main').says).toBe(compareWords.nothing);
  });
});
