/** Writes held back a moment, one per thing being written.
 *
 * A canvas is saved a short while after it stops being drawn on, because
 * writing on every stroke is a file rewritten forty times a second. One shared
 * timer for all of them looked like the same thing and was not: touching a
 * second canvas cancelled the first one's write, and that edit was gone until
 * something else happened to it.
 *
 * So: one timer per id, and whatever is still waiting when the window goes is
 * written now rather than cleared. Clearing the timers instead is the same loss
 * by a tidier-looking route.
 *
 * The clock is injected, so what this promises can be tested rather than waited
 * for.
 */

/** Long enough that a stroke is not a write; short enough that a person who
 *  closes the window a beat later still finds their drawing. */
export const HOLD_MS = 400;

export type Clock = {
  after: (ms: number, run: () => void) => unknown;
  stop: (timer: unknown) => void;
};

const realClock: Clock = {
  after: (ms, run) => setTimeout(run, ms),
  stop: (timer) => {
    clearTimeout(timer as ReturnType<typeof setTimeout>);
  },
};

export type HeldWrites = {
  /** Write this one, a moment from now. A second change to the same id before
   *  then replaces the first — it is the same file, and the later one is the
   *  one that is true. */
  soon: (id: string, write: () => void) => void;
  /** Everything still waiting, written now. What closing the window has to do. */
  now: () => void;
  /** How many are waiting. For a test, and for saying so. */
  waiting: () => number;
};

export function heldWrites(hold = HOLD_MS, clock: Clock = realClock): HeldWrites {
  const held = new Map<string, { timer: unknown; write: () => void }>();
  return {
    soon(id, write) {
      const already = held.get(id);
      if (already !== undefined) clock.stop(already.timer);
      const timer = clock.after(hold, () => {
        held.delete(id);
        write();
      });
      held.set(id, { timer, write });
    },
    now() {
      // Taken out first: a write that changes something else must not find its
      // own entry still here and be written twice.
      const all = [...held.values()];
      held.clear();
      for (const one of all) {
        clock.stop(one.timer);
        one.write();
      }
    },
    waiting: () => held.size,
  };
}
