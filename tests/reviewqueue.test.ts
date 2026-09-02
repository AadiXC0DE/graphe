/** The queue of finished work waiting to be looked at.
 *
 * Two things carry the weight. Half-done reviews must survive an entry
 * arriving again — a board piece that reports itself twice must not wipe the
 * decisions somebody was halfway through. And a per-file decision must beat the
 * whole entry's verdict in both directions, because that is the only reason
 * anybody uses a review screen twice.
 */

import { describe, expect, it } from 'vitest';

import {
  chooseFile,
  decide,
  filesToTake,
  markRead,
  queueFrom,
  reviewWords,
  saysEntry,
  waiting,
  type Arriving,
  type Entry,
} from '../src/work/reviewqueue';

const NOW = new Date(2026, 7, 12, 15, 30).getTime();
const MINUTE = 60 * 1000;

function arriving(over: Partial<Arriving> = {}): Arriving {
  return {
    id: 'e1',
    from: 'conversation',
    title: 'Make the header sticky',
    address: 'a1',
    files: [
      { path: 'src/Header.tsx', added: 12, removed: 3 },
      { path: 'src/Header.css', added: 4, removed: 0 },
    ],
    at: NOW,
    ...over,
  };
}

const one = (entries: readonly Entry[]): Entry => entries[0]!;

/* ========================================================================== */
/* W-03a arriving                                                              */
/* ========================================================================== */

describe('W-03a what gets into the queue', () => {
  it('takes an arrival in, unread', () => {
    const queue = queueFrom([], [arriving()]);
    expect(queue).toHaveLength(1);
    expect(one(queue).read).toBe(false);
  });

  it('leaves out an arrival that changed nothing, because there is nothing to look at', () => {
    expect(queueFrom([], [arriving({ files: [] })])).toHaveLength(0);
  });

  it('draws the newest first', () => {
    const queue = queueFrom(
      [],
      [
        arriving({ id: 'old', at: NOW - 10 * MINUTE }),
        arriving({ id: 'new', at: NOW }),
        arriving({ id: 'middle', at: NOW - MINUTE }),
      ],
    );
    expect(queue.map((entry) => entry.id)).toEqual(['new', 'middle', 'old']);
  });

  it('keeps what a person already did when the same entry arrives again', () => {
    let queue = queueFrom([], [arriving()]);
    queue = markRead(queue, 'e1');
    queue = chooseFile(queue, 'e1', 'src/Header.css', 'keep mine');

    const again = queueFrom(queue, [arriving({ files: [{ path: 'src/Header.tsx', added: 20, removed: 3 }] })]);
    expect(one(again).read).toBe(true);
    expect(one(again).choices?.['src/Header.css']).toBe('keep mine');
    expect(one(again).files).toHaveLength(1);
  });
});

/* ========================================================================== */
/* W-03b the badge                                                             */
/* ========================================================================== */

describe('W-03b the number on the badge', () => {
  it('counts what nobody has opened', () => {
    const queue = queueFrom([], [arriving({ id: 'a' }), arriving({ id: 'b' })]);
    expect(waiting(queue)).toBe(2);
    expect(waiting(markRead(queue, 'a'))).toBe(1);
  });

  it('reading one is not deciding about it: it stays in the queue', () => {
    const queue = markRead(queueFrom([], [arriving()]), 'e1');
    expect(queue).toHaveLength(1);
  });

  it('is nothing on an empty queue', () => {
    expect(waiting([])).toBe(0);
  });
});

/* ========================================================================== */
/* W-03c per file                                                              */
/* ========================================================================== */

describe('W-03c deciding file by file', () => {
  const queue = queueFrom([], [arriving()]);

  it('takes every file when the whole entry is taken', () => {
    expect(filesToTake(one(queue), 'take it')).toEqual(['src/Header.tsx', 'src/Header.css']);
  });

  it('holds one file back out of an entry that is otherwise taken', () => {
    const held = chooseFile(queue, 'e1', 'src/Header.css', 'keep mine');
    expect(filesToTake(one(held), 'take it')).toEqual(['src/Header.tsx']);
  });

  it('still takes the one file singled out of an entry that is turned down', () => {
    const picked = chooseFile(queue, 'e1', 'src/Header.tsx', 'take theirs');
    expect(filesToTake(one(picked), 'keep mine')).toEqual(['src/Header.tsx']);
  });

  it('takes nothing from a turned-down entry nobody picked anything out of', () => {
    expect(filesToTake(one(queue), 'keep mine')).toEqual([]);
    expect(filesToTake(one(queue), 'drop it')).toEqual([]);
  });

  it('clears a per-file decision back to following the entry', () => {
    const held = chooseFile(queue, 'e1', 'src/Header.css', 'keep mine');
    const back = chooseFile(held, 'e1', 'src/Header.css', null);
    expect(one(back).choices).toBeUndefined();
    expect(filesToTake(one(back), 'take it')).toHaveLength(2);
  });

  it('leaves other entries alone', () => {
    const two = queueFrom([], [arriving({ id: 'a' }), arriving({ id: 'b' })]);
    const changed = chooseFile(two, 'a', 'src/Header.css', 'keep mine');
    expect(changed.find((entry) => entry.id === 'b')?.choices).toBeUndefined();
  });
});

/* ========================================================================== */
/* W-03d the verdict                                                           */
/* ========================================================================== */

describe('W-03d deciding a whole entry', () => {
  const queue = queueFrom([], [arriving(), arriving({ id: 'e2', title: 'Other' })]);

  it('takes it off the list whichever way it goes', () => {
    for (const verdict of ['take it', 'keep mine', 'ask again', 'drop it'] as const) {
      expect(decide(queue, 'e1', verdict).entries.map((entry) => entry.id)).toEqual(['e2']);
    }
  });

  it('says how many files came across', () => {
    expect(decide(queue, 'e1', 'take it').did).toBe(reviewWords.took('Make the header sticky', 2));
  });

  it('says it kept yours when nothing crossed', () => {
    expect(decide(queue, 'e1', 'keep mine').did).toBe(reviewWords.kept('Make the header sticky'));
  });

  it('says what crossed when one file was picked out of a turned-down entry', () => {
    const picked = chooseFile(queue, 'e1', 'src/Header.tsx', 'take theirs');
    expect(decide(picked, 'e1', 'keep mine').did).toBe(
      reviewWords.took('Make the header sticky', 1),
    );
  });

  it('names sending it back as its own thing, not as taking it', () => {
    expect(decide(queue, 'e1', 'ask again').did).toBe(reviewWords.asked('Make the header sticky'));
  });

  it('changes nothing and says so when the entry has already gone', () => {
    const gone = decide(queue, 'nope', 'take it');
    expect(gone.entries).toBe(queue);
    expect(gone.did).toBe(reviewWords.gone);
  });
});

/* ========================================================================== */
/* W-03e words                                                                 */
/* ========================================================================== */

describe('W-03e what a row says', () => {
  it('names where it came from and adds the tally up', () => {
    expect(saysEntry(one(queueFrom([], [arriving()])))).toBe(
      'From a conversation · 2 files +16 −3',
    );
  });

  it('names a board piece as a board piece', () => {
    expect(saysEntry(one(queueFrom([], [arriving({ from: 'board' })])))).toContain(
      'From the board',
    );
  });

  it('counts one file as one file', () => {
    const single = arriving({ files: [{ path: 'a.css', added: 1, removed: 0 }] });
    expect(saysEntry(one(queueFrom([], [single])))).toContain('1 file +1 −0');
  });
});
