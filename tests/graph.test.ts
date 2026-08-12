/** The history drawn as lines, before anything is on screen.
 *
 * The cases that matter are the ones a straight list hides: two afternoons of
 * work running side by side, the moment they came back together, and a line
 * whose other end is further back than the window reaches. A column that opens
 * and never closes, or a line that arrives at the wrong row, is a picture of
 * work somebody did not do.
 */

import { describe, expect, it } from 'vitest';

import { layOut, type Graph } from '../src/history/graph';
import type { SavedVersion } from '../src/lib/ipc';

/* ------------------------------------------------------------------ scaffolding */

function version(id: string, parents: readonly string[] = []): SavedVersion {
  return {
    id,
    shortId: id.slice(0, 7),
    at: 0,
    title: id,
    by: 'graphe',
    named: false,
    current: false,
    parents,
    refs: [],
    wentBackTo: null,
  };
}

/** Newest first, the way the rail hands them over. */
function history(...versions: readonly SavedVersion[]): SavedVersion[] {
  const noon = new Date(2026, 7, 12, 12).getTime();
  return versions.map((one, index) => ({ ...one, at: noon - index * 60_000 }));
}

const ids = (graph: Graph) => graph.rows.map((one) => one.id);
const lanesOf = (graph: Graph) => graph.rows.map((one) => one.lane);
const rowOf = (graph: Graph, id: string) => graph.rows.find((one) => one.id === id);

/* ========================================================================== */
/* L-01 one thing after another                                                */
/* ========================================================================== */

describe('L-01 a straight run', () => {
  const straight = layOut(
    history(version('d', ['c']), version('c', ['b']), version('b', ['a']), version('a')),
  );

  it('keeps every version in the first column', () => {
    expect(lanesOf(straight)).toEqual([0, 0, 0, 0]);
    expect(straight.lanes).toBe(1);
  });

  it('numbers the rows from the top, newest first', () => {
    expect(ids(straight)).toEqual(['d', 'c', 'b', 'a']);
    expect(straight.rows.map((one) => one.row)).toEqual([0, 1, 2, 3]);
  });

  it('draws one line between each pair, and none off the bottom', () => {
    expect(straight.edges).toEqual([
      { from: { row: 0, lane: 0 }, to: { row: 1, lane: 0 }, offEnd: false },
      { from: { row: 1, lane: 0 }, to: { row: 2, lane: 0 }, offEnd: false },
      { from: { row: 2, lane: 0 }, to: { row: 3, lane: 0 }, offEnd: false },
    ]);
  });

  it('has nothing joining and nothing splitting', () => {
    expect(straight.rows.some((one) => one.joins || one.splits)).toBe(false);
  });
});

/* ========================================================================== */
/* L-02 barely anything to draw                                                */
/* ========================================================================== */

describe('L-02 an empty or single history', () => {
  it('is no rows and no lines, but still a column wide', () => {
    expect(layOut([])).toEqual({ rows: [], edges: [], lanes: 1 });
  });

  it('puts a lone first version in the first column with nothing attached', () => {
    const graph = layOut(history(version('only')));
    expect(graph.rows).toEqual([{ id: 'only', lane: 0, row: 0, joins: false, splits: false }]);
    expect(graph.edges).toEqual([]);
    expect(graph.lanes).toBe(1);
  });

  it('still draws the line leaving a lone version whose past is out of reach', () => {
    const graph = layOut(history(version('only', ['older'])));
    expect(graph.edges).toEqual([
      { from: { row: 0, lane: 0 }, to: { row: 1, lane: 0 }, offEnd: true },
    ]);
  });
});

/* ========================================================================== */
/* L-03 two lines coming back together                                         */
/* ========================================================================== */

describe('L-03 a version with two parents', () => {
  const diamond = layOut(
    history(
      version('top', ['left', 'right']),
      version('left', ['base']),
      version('right', ['base']),
      version('base', ['root']),
      version('root'),
    ),
  );

  it('opens a second column for the other side of the work', () => {
    expect(lanesOf(diamond)).toEqual([0, 0, 1, 0, 0]);
    expect(diamond.lanes).toBe(2);
  });

  it('closes that column again once the two sides meet', () => {
    // Everything below the meeting point is back in the first column.
    expect(rowOf(diamond, 'base')?.lane).toBe(0);
    expect(rowOf(diamond, 'root')?.lane).toBe(0);
  });

  it('marks the version where the two joined', () => {
    expect(rowOf(diamond, 'top')?.joins).toBe(true);
    expect(diamond.rows.filter((one) => one.joins)).toHaveLength(1);
  });

  it('marks the version they both came out of', () => {
    expect(rowOf(diamond, 'base')?.splits).toBe(true);
    expect(diamond.rows.filter((one) => one.splits)).toHaveLength(1);
  });

  it('runs a line to each side and back, all of them ending on screen', () => {
    expect(diamond.edges).toEqual([
      { from: { row: 0, lane: 0 }, to: { row: 1, lane: 0 }, offEnd: false },
      { from: { row: 0, lane: 0 }, to: { row: 2, lane: 1 }, offEnd: false },
      { from: { row: 1, lane: 0 }, to: { row: 3, lane: 0 }, offEnd: false },
      { from: { row: 2, lane: 1 }, to: { row: 3, lane: 0 }, offEnd: false },
      { from: { row: 3, lane: 0 }, to: { row: 4, lane: 0 }, offEnd: false },
    ]);
  });
});

/* ========================================================================== */
/* L-04 two attempts from the same starting point                              */
/* ========================================================================== */

describe('L-04 two versions sharing one past', () => {
  const fork = layOut(
    history(version('a', ['shared']), version('b', ['shared']), version('shared')),
  );

  it('gives the second attempt a column of its own', () => {
    expect(lanesOf(fork)).toEqual([0, 1, 0]);
    expect(fork.lanes).toBe(2);
  });

  it('brings both back to one column at the version they share', () => {
    expect(rowOf(fork, 'shared')?.lane).toBe(0);
    expect(rowOf(fork, 'shared')?.splits).toBe(true);
  });

  it('does not call the shared version a join — nothing came together there', () => {
    expect(rowOf(fork, 'shared')?.joins).toBe(false);
  });

  it('curves the second column into the first', () => {
    expect(fork.edges).toEqual([
      { from: { row: 0, lane: 0 }, to: { row: 2, lane: 0 }, offEnd: false },
      { from: { row: 1, lane: 1 }, to: { row: 2, lane: 0 }, offEnd: false },
    ]);
  });
});

/* ========================================================================== */
/* L-05 further back than we can see                                           */
/* ========================================================================== */

describe('L-05 a past outside the window', () => {
  const windowed = history(version('b', ['a']), version('a', ['older']));

  it('runs the line off the bottom rather than dropping it', () => {
    const graph = layOut(windowed);
    const off = graph.edges.filter((one) => one.offEnd);
    expect(off).toEqual([{ from: { row: 1, lane: 0 }, to: { row: 2, lane: 0 }, offEnd: true }]);
  });

  it('ends it one row past the last one drawn', () => {
    const graph = layOut(windowed);
    expect(graph.edges[1]?.to.row).toBe(windowed.length);
    expect(graph.edges[1]?.to.row).toBe(graph.rows.length);
  });

  it('leaves the line that does end on screen alone', () => {
    const graph = layOut(windowed);
    expect(graph.edges[0]).toEqual({
      from: { row: 0, lane: 0 },
      to: { row: 1, lane: 0 },
      offEnd: false,
    });
  });

  it('keeps the column a vanished second parent was travelling in', () => {
    // The line leaves the bottom edge in its own column, not the one it left.
    const graph = layOut(history(version('top', ['p', 'older']), version('p')));
    expect(graph.lanes).toBe(2);
    expect(graph.edges[1]).toEqual({
      from: { row: 0, lane: 0 },
      to: { row: 2, lane: 1 },
      offEnd: true,
    });
  });
});

/* ========================================================================== */
/* L-06 the same version handed over twice                                     */
/* ========================================================================== */

describe('L-06 a repeated version', () => {
  it('is drawn once, in the place it first appeared', () => {
    const graph = layOut(history(version('a', ['b']), version('a', ['b']), version('b')));
    expect(ids(graph)).toEqual(['a', 'b']);
    expect(graph.rows.map((one) => one.row)).toEqual([0, 1]);
  });

  it('does not double the line leaving it', () => {
    const graph = layOut(history(version('a', ['b']), version('a', ['b']), version('b')));
    expect(graph.edges).toHaveLength(1);
  });

  it('opens no column of its own, whatever the repeat claims about its past', () => {
    const graph = layOut(
      history(version('a', ['b']), version('a', ['x', 'y']), version('b')),
    );
    expect(lanesOf(graph)).toEqual([0, 0]);
    expect(graph.lanes).toBe(1);
    expect(graph.edges.some((one) => one.offEnd)).toBe(false);
  });
});

/* ========================================================================== */
/* L-07 how wide the picture has to be                                         */
/* ========================================================================== */

describe('L-07 the width it needs', () => {
  it('is one column for a history that never divides', () => {
    const graph = layOut(history(version('c', ['b']), version('b', ['a']), version('a')));
    expect(graph.lanes).toBe(1);
  });

  it('is never less than one, even with nothing to draw', () => {
    expect(layOut([]).lanes).toBe(1);
  });

  it('counts a column that opened and closed again', () => {
    const graph = layOut(history(version('a', ['z']), version('b'), version('z')));
    expect(lanesOf(graph)).toEqual([0, 1, 0]);
    expect(graph.lanes).toBe(2);
  });

  it('reuses a column that emptied instead of opening a third', () => {
    const graph = layOut(
      history(version('a', ['z']), version('b'), version('c'), version('z')),
    );
    expect(lanesOf(graph)).toEqual([0, 1, 1, 0]);
    expect(graph.lanes).toBe(2);
  });

  it('puts a run of unrelated starting points all in the first column', () => {
    const graph = layOut(history(version('a'), version('b'), version('c')));
    expect(lanesOf(graph)).toEqual([0, 0, 0]);
    expect(graph.lanes).toBe(1);
  });

  it('does not count columns nothing is waiting in', () => {
    // Two sides that meet again, then a long tail: the tail adds no width.
    const graph = layOut(
      history(
        version('top', ['left', 'right']),
        version('left', ['base']),
        version('right', ['base']),
        version('base', ['one']),
        version('one', ['two']),
        version('two'),
      ),
    );
    expect(graph.lanes).toBe(2);
  });
});

/* ========================================================================== */
/* L-08 joining a line that is already being drawn                             */
/* ========================================================================== */

describe('L-08 a join back into an existing line', () => {
  const rejoin = layOut(
    history(version('x', ['q']), version('m', ['p', 'q']), version('p'), version('q')),
  );

  it('does not open a second column for a line already on screen', () => {
    expect(lanesOf(rejoin)).toEqual([0, 1, 1, 0]);
    expect(rejoin.lanes).toBe(2);
  });

  it('lands both lines on the version they share', () => {
    expect(rejoin.edges).toEqual([
      { from: { row: 0, lane: 0 }, to: { row: 3, lane: 0 }, offEnd: false },
      { from: { row: 1, lane: 1 }, to: { row: 2, lane: 1 }, offEnd: false },
      { from: { row: 1, lane: 1 }, to: { row: 3, lane: 0 }, offEnd: false },
    ]);
  });

  it('still counts two arriving as a split', () => {
    expect(rowOf(rejoin, 'q')?.splits).toBe(true);
    expect(rowOf(rejoin, 'm')?.joins).toBe(true);
  });
});
