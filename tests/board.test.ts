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
  canHearYou,
  canKeep,
  saysCannotKeep,
  speaksForGroup,
  waysNumbering,
  groupWork,
  howManyGoing,
  howManyInFlight,
  isFull,
  nextUp,
  orderWork,
  roomLeft,
  saysBoard,
  saysDrop,
  saysFull,
  saysState,
  saysWhen,
  countWord,
  type OnBoard,
  type WorkState,
} from '../src/work/board';
import { capsNow } from '../src/work/capacity';

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

  it('takes that number from the one place the caps are worked out', () => {
    expect(AT_A_TIME).toBe(capsNow().board);
  });

  it('says the number it actually uses', () => {
    const word = countWord(AT_A_TIME);
    expect(saysFull().toLowerCase()).toContain(word.toLowerCase());
    expect(saysFull(2)).toContain('Two');
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

/* ========================================================================== */
/* B-06 one that stopped for a person                                          */
/* ========================================================================== */

describe('B-06 work that is waiting on you', () => {
  it('gets a band of its own, at the top, because it is the thing to do next', () => {
    const board = [
      piece('done', 'done', 1),
      piece('going', 'running', 2),
      piece('asks', 'needs-you', 3),
      piece('queued', 'waiting', 4),
    ];
    expect(bandOf('needs-you')).toBe('needs-you');
    expect(ids(orderWork(board))).toEqual(['asks', 'going', 'queued', 'done']);
    expect(groupWork(board)[0]?.label).toBe('Needs you');
  });

  it('is neither going nor finished, and says so', () => {
    expect(saysState('needs-you')).toBe(boardWords.needsYou);
    expect(saysDrop('needs-you')).toBe(boardWords.stop);
  });

  it('is counted first in the line over the sheet', () => {
    const board = [piece('a', 'needs-you', 1), piece('b', 'running', 2)];
    expect(saysBoard(board)).toBe('One waiting on you, one going.');
  });

  it('still holds its place, so nothing else starts over the top of it', () => {
    const board = [
      piece('a', 'needs-you', 1),
      piece('b', 'running', 2),
      piece('c', 'waiting', 3),
    ];
    // Not "going" — it is stopped — but it has not let go of anything either.
    expect(howManyGoing(board)).toBe(1);
    expect(howManyInFlight(board)).toBe(2);
    expect(roomLeft(board, 2)).toBe(0);
    expect(isFull(board, 2)).toBe(true);
    expect(nextUp(board, 2)).toEqual([]);
  });

  it('is never offered a turn of its own again', () => {
    expect(nextUp([piece('a', 'needs-you', 1)], 4)).toEqual([]);
  });

  it('never says what it really stopped on', () => {
    const said = [saysState('needs-you'), boardWords.needsYou, 'Needs you'].join(' ').toLowerCase();
    for (const banned of ['confirmation', 'permission', 'guard', 'policy', 'prompt']) {
      expect(said).not.toContain(banned);
    }
  });
});

describe('saying something to work already going', () => {
  /** The offer has to match what the other side can actually do. Pi delivers a
   *  steer between tool calls; a piece with no calls left ahead of it never
   *  reaches one, so the button would be a press that does nothing. */
  it('is offered while something is going, and while it waits on an answer', () => {
    expect(canHearYou('running')).toBe(true);
    // A piece stopped on a question is a turn held open mid-step, which is
    // where a sentence lands most reliably of all. Leaving it out hid the
    // control exactly where it works best.
    expect(canHearYou('needs-you')).toBe(true);
  });

  /** Nothing that has stopped can hear anything. Pi only drains the queue from
   *  inside a run already going; a sentence handed to a finished piece sits
   *  there until its copy is packed away and is then lost without a word. */
  it('is not offered once there is nothing left to hear it', () => {
    for (const state of ['waiting', 'done', 'failed'] as const) {
      expect(canHearYou(state)).toBe(false);
    }
  });

  it('says what it does without naming the machinery', () => {
    const said = [boardWords.say, boardWords.sayPlaceholder, boardWords.send, boardWords.sent];
    for (const one of said) {
      expect(one).not.toMatch(/steer|queue|prompt|interrupt|session|token/i);
    }
  });

  /** The sentence after sending must not claim more than happened: the message
   *  went, and it will be heard — not that anything has changed yet. */
  it('promises delivery, not a result', () => {
    expect(boardWords.sent).toMatch(/hear/i);
    expect(boardWords.sent).not.toMatch(/done|changed|fixed/i);
  });

  /** The state the board paints and the state the run is really in are not the
   *  same thing: a card says "Going" from the moment a turn settles until its
   *  copy has been read and put away. So the offer is a guess and the note
   *  after it must not be — the card is told whether it was taken. */
  it('does not treat being offered as proof it was heard', () => {
    expect(canHearYou('running')).toBe(true);
    expect(boardWords.sent).not.toMatch(/\bhas heard\b|\bheard it\b/i);
  });
});

describe('who carries the comparison', () => {
  const goes = [
    { id: 'a', oneOf: { named: 'the hero' } },
    { id: 'b', oneOf: { named: 'the hero' } },
    { id: 'c', oneOf: { named: 'the footer' } },
    { id: 'd' },
    { id: 'e', oneOf: null },
  ];

  it('offers it once per group, not once per card', () => {
    const speaks = speaksForGroup(goes);
    expect([...speaks].sort()).toEqual(['a', 'c']);
  });

  /** Throwing the first go away must not take the comparison with it — the
   *  remaining goes are exactly when somebody still needs to choose. */
  it('moves to the next one when the first is gone', () => {
    expect([...speaksForGroup(goes.slice(1))].sort()).toEqual(['b', 'c']);
  });

  it('offers nothing on ordinary work', () => {
    expect(speaksForGroup([{ id: 'd' }, { id: 'e', oneOf: null }]).size).toBe(0);
  });
});

describe('what each go is called', () => {
  const goes = [
    { id: 'a', ways: 'the hero' },
    { id: 'b', ways: 'the hero' },
    { id: 'c', ways: 'the hero' },
    { id: 'd', ways: 'the footer' },
    { id: 'e' },
  ];

  it('numbers every go in its group, and nothing else', () => {
    const numbering = waysNumbering(goes);
    expect(numbering.get('a')).toEqual({ at: 1, of: 3, named: 'the hero' });
    expect(numbering.get('c')).toEqual({ at: 3, of: 3, named: 'the hero' });
    expect(numbering.get('e')).toBeUndefined();
  });

  /** A group of one is not a choice: the others were thrown away, and "Way 1
   *  of 1" would be asking somebody to decide between one thing. */
  it('leaves a lone survivor of a group unnumbered', () => {
    expect(waysNumbering(goes).get('d')).toBeUndefined();
  });

  /** The defect this guards: the comparison narrowed the group to the goes
   *  that had a copy on disk and numbered what was left, so a card reading
   *  "Way 3 of 3" sat beside a column reading "Way 2 of 2". Both sides number
   *  the whole group, so a go carries one name wherever it is drawn. */
  it('does not renumber the rest when one of them has not started', () => {
    const asIfFiltered = waysNumbering(goes.filter((one) => one.id !== 'a'));
    expect(waysNumbering(goes).get('b')).toEqual({ at: 2, of: 3, named: 'the hero' });
    expect(asIfFiltered.get('b')).not.toEqual(waysNumbering(goes).get('b'));
  });
});

describe('what can be taken', () => {
  it('has a result only where something has finished', () => {
    expect(canKeep('done')).toBe(true);
    for (const state of ['waiting', 'running', 'needs-you', 'failed'] as const) {
      expect(canKeep(state)).toBe(false);
    }
  });

  /** The sentence somebody used to get for pressing "Use this one" on a go
   *  that was still working: that it had finished without changing any files.
   *  It had not finished, and its changes were on the screen at the time. */
  it('never tells somebody an unfinished go finished', () => {
    const said = saysCannotKeep('Redo the header', 'running');
    expect(said?.because).toMatch(/still going/);
    expect(said?.because).not.toMatch(/finished without/);
    expect(said?.what).toMatch(/yet/);
  });

  it('tells apart one that has not started from one that did not work', () => {
    expect(saysCannotKeep('Redo the header', 'waiting')?.because).toMatch(/not started/);
    expect(saysCannotKeep('Redo the header', 'failed')?.because).toMatch(/didn’t work/);
    expect(saysCannotKeep('Redo the header', 'needs-you')?.because).toMatch(/ask you/);
  });

  it('has nothing to say about one that has finished', () => {
    expect(saysCannotKeep('Redo the header', 'done')).toBeNull();
    expect(boardWords.notYet('done')).toBeNull();
  });

  it('says all of that without naming the machinery', () => {
    const states = ['waiting', 'running', 'needs-you', 'failed'] as const;
    const said = states.flatMap((state) => [
      boardWords.notYet(state) ?? '',
      boardWords.notYetBecause('Redo the header', state),
    ]);
    for (const one of said) {
      expect(one).not.toMatch(/commit|branch|worktree|session|token|snapshot/i);
    }
  });
});

describe('the sentence is not lost while it is being handed over', () => {
  /** The box used to close on the way out. A refusal then said "still in the
   *  box" about a box that was gone — and if the piece had finished, the whole
   *  control went with it, taking the words. */
  it('has a word for the moment between the press and the answer', () => {
    expect(boardWords.sending).not.toBe(boardWords.send);
    expect(boardWords.sending).toMatch(/send/i);
  });

  it('does not say where the words are in a way that can be wrong', () => {
    for (const said of [boardWords.send, boardWords.sending, boardWords.sent]) {
      expect(said).not.toMatch(/still in the box/i);
    }
  });
});

describe('letting a piece off the wait it was given', () => {
  /** The wait could be set when work was asked for and never changed after, so
   *  a piece waiting on something that was abandoned waited for good. The whole
   *  door to changing it — `putAfter` — had no caller anywhere. */
  it('says what it does without naming the machinery', () => {
    expect(boardWords.stopWaiting).not.toMatch(/depend|graph|queue|node|edge/i);
  });

  it('is about the wait, not about the work', () => {
    // "Stop this one" already means something else on the same card. This must
    // not read as a second way to say that.
    expect(boardWords.stopWaiting).not.toBe(boardWords.stop);
    expect(boardWords.stopWaiting).toMatch(/wait/i);
  });
});
