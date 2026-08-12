/** The history as lines rather than a list.
 *
 * A rail can say what happened one version at a time, but it cannot show that
 * two afternoons of work ran side by side and then came back together. That
 * needs columns: each row gets one, and a curve leaves it for every version it
 * came after.
 *
 * The order is the order the list arrived in, never the clock — the times on
 * two versions can disagree with which one came first, and a line drawn from
 * the wrong end of that is worse than no line.
 */

import type { SavedVersion } from '../lib/ipc';

export type Lane = {
  id: string;
  /** 0-based column. */
  lane: number;
  /** Row index, 0 at the top (newest). */
  row: number;
  /** True when two or more parents are in play — where two lines joined. */
  joins: boolean;
  /** True when more than one child pointed at it — where a line split. */
  splits: boolean;
};

export type Edge = {
  /** Row and lane the line leaves from (the child, above). */
  from: { row: number; lane: number };
  /** Row and lane it arrives at. `row` is one past the last row when the parent
   *  is not in the window, in which case the line runs off the bottom edge. */
  to: { row: number; lane: number };
  /** The parent is outside the window, so the line has no end on screen. */
  offEnd: boolean;
};

export type Graph = {
  rows: readonly Lane[];
  edges: readonly Edge[];
  /** How many columns the widest point needs. At least 1. */
  lanes: number;
};

/** An edge whose far end is not known yet: a parent can be hundreds of rows
 *  down, or off the end of the window entirely. */
type Pending = {
  from: { row: number; lane: number };
  parent: string;
  /** The column the line is travelling in, which is where it leaves the bottom
   *  if the parent turns out to be outside the window. */
  travelling: number;
};

/** The leftmost column waiting for nothing, opening one if they are all busy. */
function freeColumn(active: (string | null)[]): number {
  const free = active.indexOf(null);
  return free >= 0 ? free : active.push(null) - 1;
}

/** Where every version sits, and every line between them. */
export function layOut(versions: readonly SavedVersion[]): Graph {
  const rows: Lane[] = [];
  const placed = new Map<string, Lane>();
  const pending: Pending[] = [];

  // Each column holds the id it is still waiting to draw, or nothing.
  const active: (string | null)[] = [];
  let widest = 0;

  for (const version of versions) {
    if (placed.has(version.id)) continue; // Said twice, drawn once.

    const row = rows.length;
    let lane = active.indexOf(version.id);
    if (lane < 0) lane = freeColumn(active);

    // Any other column waiting for this same id is a second line arriving here.
    for (let column = 0; column < active.length; column += 1) {
      if (column !== lane && active[column] === version.id) active[column] = null;
    }

    const one: Lane = {
      id: version.id,
      lane,
      row,
      joins: version.parents.length > 1,
      splits: false,
    };
    rows.push(one);
    placed.set(version.id, one);

    // The line carries on down its own column into the first parent, or stops.
    active[lane] = null;

    const taken = new Set<string>();
    for (const parent of version.parents) {
      if (taken.has(parent)) continue;
      taken.add(parent);

      let column: number;
      if (taken.size === 1) {
        column = lane;
      } else {
        const waiting = active.indexOf(parent);
        column = waiting >= 0 ? waiting : freeColumn(active);
      }
      active[column] = parent;
      pending.push({ from: { row, lane }, parent, travelling: column });
    }

    while (active.length > 0 && active[active.length - 1] === null) active.pop();
    widest = Math.max(widest, lane + 1, active.length);
  }

  const offBottom = rows.length;
  const edges: Edge[] = pending.map((line) => {
    const parent = placed.get(line.parent);
    return parent
      ? { from: line.from, to: { row: parent.row, lane: parent.lane }, offEnd: false }
      : { from: line.from, to: { row: offBottom, lane: line.travelling }, offEnd: true };
  });

  // Read off the lines actually drawn, so a merge that rejoins an existing
  // column still counts as two children arriving.
  const arriving = new Map<number, number>();
  for (const line of edges) {
    if (line.offEnd) continue;
    arriving.set(line.to.row, (arriving.get(line.to.row) ?? 0) + 1);
  }
  for (const one of rows) {
    if ((arriving.get(one.row) ?? 0) > 1) one.splits = true;
  }

  return { rows, edges, lanes: Math.max(1, widest) };
}
