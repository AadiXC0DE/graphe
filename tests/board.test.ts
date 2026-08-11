/** The shape of the board, before any of it is drawn.
 *
 * Everything here is a function of its arguments — `now` included — so the
 * cases worth writing are the ones that decide what somebody looks at first:
 * what comes before what, what the one line over the sheet says, and who is next
 * when a slot frees up.
 */

import { describe, expect, it } from 'vitest';

import {
  AT_A_TIME,
  bandOf,
  boardWords,
  groupWork,
  howManyGoing,
  isFull,
  nextUp,
  orderWork,
  roomLeft,
  saysBoard,
  saysDrop,
  saysFull,
  saysState,
  saysWhen,
  type OnBoard,
  type WorkState,
} from '../src/work/board';

/* ------------------------------------------------------------ scaffolding */

const MINUTE = 60 * 1000;
const NOW = new Date(2026, 7, 12, 15, 30).getTime();

function piece(id: string, state: WorkState, minutesAgo: number): OnBoard {
  return { id, doing: `Do ${id}`, state, at: NOW - minutesAgo * MINUTE };
}

const ids = (items: readonly OnBoard[]) => items.map((one) => one.id);

/* ========================================================================== */
/* B-01 which band                                                             */
/* ========================================================================== */

describe('B-01 which band a piece of work is in', () => {
  it('puts going, waiting and finished in their own bands', () => {
    expect(bandOf('running')).toBe('running');
    expect(bandOf('waiting')).toBe('waiting');
    expect(bandOf('done')).toBe('finished');
  });

  it('counts one that did not work as finished, because it is over', () => {
    expect(bandOf('failed')).toBe('finished');
  });
});

/* ========================================================================== */
/* B-02 the order                                                              */
/* ========================================================================== */

describe('B-02 the order of the sheet', () => {
  it('has nothing to show for an empty board', () => {
    expect(orderWork([])).toEqual([]);
    expect(groupWork([])).toEqual([]);
  });

  it('draws what is going first, then what is waiting, then what is finished', () => {
    const board = [
      piece('done-one', 'done', 1),
      piece('waiting-one', 'waiting', 1),
      piece('going-one', 'running', 1),
      piece('broke-one', 'failed', 1),
    ];
    expect(ids(orderWork(board))).toEqual(['going-one', 'waiting-one', 'done-one', 'broke-one']);
  });

  it('puts the newest first inside each band', () => {
    const board = [
      piece('old', 'running', 30),
      piece('new', 'running', 1),
      piece('middle', 'running', 10),
      piece('old-done', 'done', 40),
      piece('new-done', 'done', 2),
    ];
    expect(ids(orderWork(board))).toEqual(['new', 'middle', 'old', 'new-done', 'old-done']);
  });

  it('leaves the board it was given alone', () => {
    const board = [piece('a', 'done', 1), piece('b', 'running', 2)];
    orderWork(board);
    expect(ids(board)).toEqual(['a', 'b']);
  });

  it('names each band and leaves out the ones with nothing in them', () => {
    const bands = groupWork([piece('a', 'running', 1), piece('b', 'running', 2)]);
    expect(bands).toHaveLength(1);
    expect(bands[0]?.key).toBe('running');
    expect(bands[0]?.label).toBe('Going');
    expect(ids(bands[0]?.items ?? [])).toEqual(['a', 'b']);
  });

  it('keeps the finished and the failed together in one band', () => {
    const bands = groupWork([piece('broke', 'failed', 5), piece('done', 'done', 1)]);
    expect(bands).toHaveLength(1);
    expect(bands[0]?.label).toBe('Finished');
    expect(ids(bands[0]?.items ?? [])).toEqual(['done', 'broke']);
  });

  it('draws every band it has, in order', () => {
    const bands = groupWork([
      piece('done', 'done', 3),
      piece('waiting', 'waiting', 2),
      piece('going', 'running', 1),
    ]);
    expect(bands.map((band) => band.key)).toEqual(['running', 'waiting', 'finished']);
  });
});

/* ========================================================================== */
/* B-03 how many at once, and who is next                                      */
/* ========================================================================== */

describe('B-03 the cap and the queue', () => {
  it('bounds how many go side by side', () => {
    expect(AT_A_TIME).toBeGreaterThanOrEqual(2);
    expect(AT_A_TIME).toBeLessThanOrEqual(6);
  });

  it('counts only what is actually going', () => {
    const board = [
      piece('a', 'running', 1),
      piece('b', 'waiting', 2),
      piece('c', 'done', 3),
      piece('d', 'running', 4),
    ];
    expect(howManyGoing(board)).toBe(2);
    expect(roomLeft(board, 4)).toBe(2);
    expect(isFull(board, 4)).toBe(false);
    expect(isFull(board, 2)).toBe(true);
  });

  it('never reports room it does not have', () => {
    const board = [piece('a', 'running', 1), piece('b', 'running', 2), piece('c', 'running', 3)];
    expect(roomLeft(board, 2)).toBe(0);
    expect(nextUp([...board, piece('d', 'waiting', 4)], 2)).toEqual([]);
  });

  it('starts the ones that have waited longest, first come first served', () => {
    const board = [
      piece('third', 'waiting', 1),
      piece('first', 'waiting', 30),
      piece('second', 'waiting', 10),
    ];
    expect(ids(nextUp(board, 2))).toEqual(['first', 'second']);
  });

  it('only ever offers as many as there is room for', () => {
    const board = [
      piece('going', 'running', 1),
      piece('a', 'waiting', 5),
      piece('b', 'waiting', 4),
      piece('c', 'waiting', 3),
    ];
    expect(ids(nextUp(board, 3))).toEqual(['a', 'b']);
  });

  it('offers nothing when nothing is waiting', () => {
    expect(nextUp([piece('a', 'running', 1), piece('b', 'done', 2)], 4)).toEqual([]);
  });

  it('never offers something already going or already finished', () => {
    const board = [piece('a', 'running', 1), piece('b', 'done', 2), piece('c', 'failed', 3)];
    expect(nextUp(board, 4)).toEqual([]);
  });
});

/* ========================================================================== */
/* B-04 the words                                                              */
/* ========================================================================== */

describe('B-04 the one line over the sheet', () => {
  it('says so plainly when there is nothing on it', () => {
    expect(saysBoard([])).toBe(boardWords.nothing);
  });

  it('counts what is going and what is waiting, in words', () => {
    const board = [
      piece('a', 'running', 1),
      piece('b', 'running', 2),
      piece('c', 'running', 3),
      piece('d', 'waiting', 4),
    ];
    expect(saysBoard(board)).toBe('Three going, one waiting.');
  });

  it('mentions only what is there', () => {
    expect(saysBoard([piece('a', 'running', 1)])).toBe('One going.');
    expect(saysBoard([piece('a', 'done', 1), piece('b', 'done', 2)])).toBe('Two finished.');
  });

  it('says when one did not work, without dressing it up', () => {
    const board = [piece('a', 'running', 1), piece('b', 'failed', 2)];
    expect(saysBoard(board)).toBe('One going, one didn’t work.');
  });

  it('keeps the order of the sentence the same as the order of the sheet', () => {
    const board = [
      piece('a', 'done', 1),
      piece('b', 'waiting', 2),
      piece('c', 'running', 3),
      piece('d', 'failed', 4),
    ];
    expect(saysBoard(board)).toBe('One going, one waiting, one finished, one didn’t work.');
  });

  it('falls back to a figure past the counting numbers', () => {
    const many = Array.from({ length: 14 }, (_, index) => piece(`p${String(index)}`, 'done', index));
    expect(saysBoard(many)).toBe('14 finished.');
  });
});

describe('B-05 what a card says about itself', () => {
  it('has a word for every state', () => {
    expect(saysState('running')).toBe('Going');
    expect(saysState('waiting')).toBe('Waiting its turn');
    expect(saysState('done')).toBe('Ready to look at');
    expect(saysState('failed')).toBe('Didn’t work');
  });

  it('offers to stop what is still going, and to throw away what is over', () => {
    expect(saysDrop('running')).toBe(boardWords.stop);
    expect(saysDrop('waiting')).toBe(boardWords.stop);
    expect(saysDrop('done')).toBe(boardWords.drop);
    expect(saysDrop('failed')).toBe(boardWords.drop);
  });

  it('explains why something is waiting rather than leaving it a mystery', () => {
    expect(saysFull(4)).toContain('Four at a time');
    expect(saysFull(4)).toContain('as soon as one finishes');
  });

  it('rounds how long ago to something a person would say', () => {
    expect(saysWhen(NOW, NOW)).toBe('just now');
    expect(saysWhen(NOW - 30 * 1000, NOW)).toBe('just now');
    expect(saysWhen(NOW - 90 * 1000, NOW)).toBe('a minute ago');
    expect(saysWhen(NOW - 4 * MINUTE, NOW)).toBe('4 minutes ago');
    expect(saysWhen(NOW - 90 * MINUTE, NOW)).toBe('an hour ago');
    expect(saysWhen(NOW - 5 * 60 * MINUTE, NOW)).toBe('5 hours ago');
    expect(saysWhen(NOW - 30 * 60 * MINUTE, NOW)).toBe('yesterday');
    expect(saysWhen(NOW - 3 * 24 * 60 * MINUTE, NOW)).toBe('3 days ago');
  });

  it('never says a clock ran backwards', () => {
    expect(saysWhen(NOW + 5 * MINUTE, NOW)).toBe('just now');
  });

  it('never says where any of this really lives', () => {
    const everything = [
      saysBoard([piece('a', 'running', 1), piece('b', 'waiting', 2), piece('c', 'failed', 3)]),
      saysFull(4),
      saysWhen(NOW - MINUTE, NOW),
      ...Object.values(boardWords),
      ...(['running', 'waiting', 'done', 'failed'] as const).flatMap((state) => [
        saysState(state),
        saysDrop(state),
      ]),
    ]
      .join(' ')
      .toLowerCase();

    for (const banned of [
      'git',
      'commit',
      'branch',
      'worktree',
      'session',
      'parallel',
      'agent',
      'token',
      'api',
      'queue',
      'thread',
      'process',
    ]) {
      expect(everything).not.toContain(banned);
    }
  });
});
