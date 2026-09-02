/** The conversation as something to read.
 *
 * A long turn is forty steps and every one is a row, so the sentence somebody
 * wants is nine screens above the last `read`. Steps that belong together fold
 * into one line — but nothing is hidden: a fold says what is in it, a failure
 * never folds, and the step that just happened stays out of it.
 */

import { describe, expect, it } from 'vitest';

import { said, type Turn } from '../src/lib/thread';
import {
  atLatest,
  findIn,
  foldedAway,
  nextFound,
  rowsOf,
  threadWords,
  wordsOf,
  WORTH_FOLDING,
} from '../src/lib/threadview';

let counter = 0;
function step(state: 'done' | 'failed' | 'running', label = 'Reading a file', at?: number): Turn {
  counter += 1;
  return {
    kind: 'did',
    id: `d${String(counter)}`,
    callId: `c${String(counter)}`,
    state,
    label,
    ...(at === undefined ? {} : { at }),
  } as Turn;
}

const steps = (n: number, state: 'done' | 'failed' = 'done'): Turn[] =>
  Array.from({ length: n }, () => step(state));

describe('folding a run of steps', () => {
  it('folds a run into one line that says what is in it', () => {
    const turns = [said('graphe', 'here goes'), ...steps(6), said('graphe', 'done')];
    const rows = rowsOf(turns);
    const fold = rows.find((one) => one.kind === 'folded');
    expect(fold).toBeDefined();
    expect(fold?.kind === 'folded' && fold.steps).toBe(6);
    expect(threadWords.folded(6, 0)).toContain('6 steps');
  });

  /* Two rows folded into one line saves nothing and costs a press. */
  it('leaves a run too short to be worth folding alone', () => {
    const turns = [...steps(WORTH_FOLDING - 1), said('graphe', 'done')];
    expect(rowsOf(turns).every((one) => one.kind === 'turn')).toBe(true);
  });

  /* A failure is the thing somebody came to find. */
  it('never folds a step that failed', () => {
    const turns = [...steps(3), step('failed', 'Running the tests'), ...steps(3)];
    const rows = rowsOf(turns);
    const failures = rows.filter((one) => one.kind === 'turn' && one.turn.kind === 'did' && one.turn.state === 'failed');
    expect(failures).toHaveLength(1);
  });

  it('never folds a step still running', () => {
    const turns = [...steps(4), step('running')];
    const rows = rowsOf(turns);
    expect(rows.some((one) => one.kind === 'turn' && one.turn.kind === 'did' && one.turn.state === 'running')).toBe(true);
  });

  /* Folding the step that just happened makes a live run look stopped. */
  it('leaves the newest step out of the fold while a run is live', () => {
    const rows = rowsOf(steps(6));
    const last = rows[rows.length - 1];
    expect(last?.kind).toBe('turn');
  });

  it('opens a fold somebody pressed, and keeps it open', () => {
    const turns = [said('graphe', 'here'), ...steps(6), said('graphe', 'done')];
    const shut = rowsOf(turns);
    const fold = shut.find((one) => one.kind === 'folded');
    expect(fold?.kind === 'folded' && typeof fold.from).toBe('number');
    const open = rowsOf(turns, new Set([fold?.kind === 'folded' ? fold.from : -1]));
    expect(open.some((one) => one.kind === 'folded')).toBe(false);
    expect(open.length).toBeGreaterThan(shut.length);
  });

  it('says how many rows it saved', () => {
    const turns = [said('graphe', 'here'), ...steps(8), said('graphe', 'done')];
    expect(foldedAway(turns)).toBeGreaterThan(0);
  });

  it('keeps every turn reachable — a fold holds what it stands for', () => {
    const turns = [said('graphe', 'here'), ...steps(8), said('graphe', 'done')];
    const held = rowsOf(turns).reduce(
      (sum, one) => sum + (one.kind === 'folded' ? one.turns.length : 1),
      0,
    );
    expect(held).toBe(turns.length);
  });

  /* Steps in one batch run at the same time, so adding them up would claim six
     seconds for two seconds of work. */
  it('says the span the steps covered, not the sum of them', () => {
    const turns = [step('done', 'a', 1_000), step('done', 'b', 2_000), step('done', 'c', 5_000), said('graphe', 'x')];
    const fold = rowsOf(turns).find((one) => one.kind === 'folded');
    expect(fold?.kind === 'folded' && fold.seconds).toBe(4);
  });

  it('says no time at all when the steps never said when they began', () => {
    const turns = [...steps(4), said('graphe', 'x')];
    const fold = rowsOf(turns).find((one) => one.kind === 'folded');
    expect(fold?.kind === 'folded' && fold.seconds).toBe(0);
    expect(threadWords.folded(4, 0)).toBe('4 steps');
  });

  it('draws an empty conversation as nothing', () => {
    expect(rowsOf([])).toEqual([]);
  });
});

describe('finding something in a conversation', () => {
  const turns = [
    said('you', 'make the header sticky'),
    step('done', 'Changing Header.tsx'),
    said('graphe', 'Done.\nThe header is sticky now.'),
  ];

  it('finds what a person can read', () => {
    const found = findIn(turns, 'sticky');
    expect(found).toHaveLength(2);
    expect(found[0]?.at).toBe(0);
  });

  it('gives the line it is on, so a result reads without opening it', () => {
    expect(findIn(turns, 'sticky now')[0]?.line).toBe('The header is sticky now.');
  });

  it('does not care about case', () => {
    expect(findIn(turns, 'STICKY').length).toBeGreaterThan(0);
  });

  it('finds nothing for nothing', () => {
    expect(findIn(turns, '   ')).toEqual([]);
    expect(findIn(turns, 'zebra')).toEqual([]);
  });

  it('reads the words of every kind of turn', () => {
    expect(wordsOf(said('you', 'hello'))).toBe('hello');
    expect(wordsOf(step('done', 'Reading a file'))).toContain('Reading a file');
  });

  it('walks the results and wraps round', () => {
    const found = findIn(turns, 'sticky');
    expect(nextFound(found, null)).toBe(0);
    expect(nextFound(found, 0)).toBe(2);
    expect(nextFound(found, 2)).toBe(0);
  });

  /* A wrap over an empty list is an infinite loop wearing a hat. */
  it('has nowhere to go when nothing was found', () => {
    expect(nextFound([], null)).toBeNull();
    expect(nextFound([], 4)).toBeNull();
  });
});

describe('whether the newest thing is on screen', () => {
  it('is true at the bottom, and a little above it', () => {
    expect(atLatest({ top: 900, height: 100, scrollHeight: 1000 })).toBe(true);
    expect(atLatest({ top: 850, height: 100, scrollHeight: 1000 })).toBe(true);
  });

  it('is false once somebody has really scrolled away', () => {
    expect(atLatest({ top: 100, height: 100, scrollHeight: 5000 })).toBe(false);
  });

  it('is true for a conversation shorter than the window', () => {
    expect(atLatest({ top: 0, height: 800, scrollHeight: 400 })).toBe(true);
  });
});
