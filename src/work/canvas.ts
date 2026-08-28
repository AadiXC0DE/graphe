/** The board, drawn as the graph it already is.
 *
 * Work that waits for other work is a graph — `after` is the edge — and until
 * now the only way to read it was a sheet of cards with a sentence on each
 * saying what it was behind. This lays the same pieces out left to right, so a
 * loop is something you can see and draw rather than something you infer.
 *
 * Nothing here runs anything, and nothing here is a second kind of work. A step
 * on the canvas is a piece on the board; laying it out is arithmetic over what
 * the board already said.
 */

import type { WorkState } from './board';

/** One step, as the canvas needs it. A narrowing of the board's own piece. */
export type Step = {
  id: string;
  /** What it was asked to do, in the person's own words. */
  doing: string;
  state: WorkState;
  /** Epoch ms, when it was asked for. */
  at: number;
  /** What has to finish first, or null when nothing does. */
  after: string | null;
  /** What it did, in a sentence, once there is one. */
  says: string | null;
  trouble: string | null;
  /** True while it is stopped on a question only a person can answer. */
  asking: boolean;
};

/** A step with somewhere to be drawn. */
export type Placed = Step & { column: number; row: number };

export type Flow = {
  steps: readonly Placed[];
  columns: number;
  rows: number;
};

export const canvasWords = {
  name: 'Canvas',
  /** The one line under the title. */
  note: 'Every step, and what waits for what.',
  empty: 'Nothing on the canvas yet.',
  emptyNote: 'Start from a loop, or place one step and build out from it.',
  blank: 'Place one step',
  add: 'Add a step after this one',
  connect: 'Drag to the step this should wait for',
  /** A loop that could not be put down whole. What did land is on the canvas;
   *  the rest is not, because a step that waits for nothing would have started
   *  on its own against a change that was never made. */
  brokeOff: 'That step could not be placed, so the rest of the loop was not.',
  /** Said on a step that is holding everything behind it up. */
  holdingUp: (n: number): string => (n === 1 ? '1 step waits on this' : `${String(n)} steps wait on this`),
  counted: (steps: number, going: number): string =>
    `${String(steps)} ${steps === 1 ? 'step' : 'steps'}${going === 0 ? '' : ` · ${String(going)} going`}`,
  /** The states, as a word on the card. Nothing depends on colour alone. */
  states: {
    waiting: 'Waiting',
    running: 'Going',
    'needs-you': 'Needs you',
    done: 'Done',
    failed: 'Stopped',
  } as Readonly<Record<WorkState, string>>,
} as const;

/* ------------------------------------------------------------------ layout */

/**
 * How far along the chain each step sits.
 *
 * A step is one past whatever it waits for. A wait that points at nothing we
 * hold — thrown away, or from before this window opened — is treated as no wait
 * at all, so the step is drawn rather than lost.
 */
function depths(steps: readonly Step[]): Map<string, number> {
  const byId = new Map(steps.map((one) => [one.id, one]));
  const depth = new Map<string, number>();

  for (const step of steps) {
    const seen = new Set([step.id]);
    let far = 0;
    let walk = step.after;
    let looped = false;
    while (walk !== null) {
      if (seen.has(walk)) {
        // A loop cannot be asked for — `Following.could` refuses one — but a
        // board read back off disk could still hold it, and drawing it flat is
        // better than a layout that never finishes.
        looped = true;
        break;
      }
      const parent = byId.get(walk);
      if (parent === undefined) break;
      seen.add(walk);
      far += 1;
      walk = parent.after;
    }
    depth.set(step.id, looped ? 0 : far);
  }
  return depth;
}

/**
 * Lay the board out left to right.
 *
 * A step keeps its parent's row when that row is free, so a chain reads as one
 * straight line and only a fork moves anything down. Within a column the order
 * is the order they were asked for, which is the order they will run in.
 */
export function layOut(steps: readonly Step[]): Flow {
  if (steps.length === 0) return { steps: [], columns: 0, rows: 0 };

  const depth = depths(steps);
  const ordered = [...steps].sort((one, other) => {
    const byDepth = (depth.get(one.id) ?? 0) - (depth.get(other.id) ?? 0);
    return byDepth !== 0 ? byDepth : one.at - other.at || one.id.localeCompare(other.id);
  });

  const taken = new Map<number, Set<number>>();
  const rowOf = new Map<string, number>();
  const placed: Placed[] = [];

  for (const step of ordered) {
    const column = depth.get(step.id) ?? 0;
    const used = taken.get(column) ?? new Set<number>();
    const wanted = step.after === null ? 0 : (rowOf.get(step.after) ?? 0);
    let row = wanted;
    while (used.has(row)) row += 1;
    used.add(row);
    taken.set(column, used);
    rowOf.set(step.id, row);
    placed.push({ ...step, column, row });
  }

  const columns = Math.max(...placed.map((one) => one.column)) + 1;
  const rows = Math.max(...placed.map((one) => one.row)) + 1;
  return { steps: placed, columns, rows };
}

/** Everything waiting directly on this one. */
export function waitingOn(steps: readonly Step[], id: string): readonly Step[] {
  return steps.filter((one) => one.after === id);
}

/**
 * Whether one step may be made to wait for another.
 *
 * The board answers this for real when it is asked — this is the same question
 * put early, so a line somebody drags cannot be dropped somewhere it would only
 * be refused. `Following.could` is the authority; this must never be softer.
 */
export function canWaitFor(
  steps: readonly Step[],
  id: string,
  after: string,
): { ok: true } | { ok: false; because: string } {
  if (id === after) return { ok: false, because: 'This would be waiting for itself.' };
  const byId = new Map(steps.map((one) => [one.id, one]));
  const mine = byId.get(id);
  const theirs = byId.get(after);
  if (mine === undefined || theirs === undefined) {
    return { ok: false, because: 'I could not find that step.' };
  }
  if (mine.state !== 'waiting') {
    return {
      ok: false,
      because: mine.state === 'running' || mine.state === 'needs-you'
        ? 'This is already going, so it cannot be made to wait.'
        : 'This has already finished, so there is nothing left for it to wait for.',
    };
  }
  if (theirs.state === 'failed') {
    return { ok: false, because: 'That one didn’t work, so nothing can follow it.' };
  }
  // Walk up from the proposed parent: meeting ourselves is the loop.
  let walk: string | null = after;
  const seen = new Set<string>();
  while (walk !== null && !seen.has(walk)) {
    if (walk === id) {
      return { ok: false, because: 'These would end up waiting for each other, so neither could start.' };
    }
    seen.add(walk);
    walk = byId.get(walk)?.after ?? null;
  }
  return { ok: true };
}

/* ------------------------------------------------------------- what to add */

export type StepKindId = 'look' | 'work' | 'browser' | 'checks' | 'review' | 'pull-request';

/**
 * The kinds of step somebody can place.
 *
 * Each is work the app already does, named as the operation rather than as the
 * tool behind it. `asks` is the whole instruction the step is put on the board
 * with — a step is a piece of work, so what it *is* is what it is asked.
 */
export type StepKind = {
  id: StepKindId;
  name: string;
  note: string;
  /** True where the step is only worth placing once somebody says what about. */
  needsWords: boolean;
  asks: (about: string) => string;
};

export const STEP_KINDS: readonly StepKind[] = [
  {
    id: 'work',
    name: 'Work on it',
    note: 'Make the change.',
    needsWords: true,
    asks: (about) => about.trim(),
  },
  {
    id: 'look',
    name: 'Look around',
    note: 'Read the project and say what it would do. Changes nothing.',
    needsWords: false,
    asks: (about) =>
      about.trim() === ''
        ? 'Look around the project and say what you would do. Change nothing.'
        : `Look around the project first: ${about.trim()}. Say what you would do, and change nothing.`,
  },
  {
    // Every step after the first is about the change the one before it made, so
    // none of them takes the subject: spliced into a sentence of its own, an
    // instruction reads as a noun and the step asks for something nonsensical.
    id: 'browser',
    name: 'Try it in the browser',
    note: 'Open the page and check it works.',
    needsWords: false,
    asks: () =>
      'Open the page in the browser and check the change works. Say what you saw, and take a picture of it.',
  },
  {
    id: 'checks',
    name: 'Run the checks',
    note: 'Run the project’s checks and fix what fails.',
    needsWords: false,
    asks: () => 'Run this project’s checks. Fix anything that fails, then run them again until they pass.',
  },
  {
    id: 'review',
    name: 'Review',
    note: 'Read the change and give a verdict.',
    needsWords: false,
    asks: () => 'Review what has changed and give your verdict, with the findings that matter first.',
  },
  {
    id: 'pull-request',
    name: 'Pull request',
    note: 'Open a pull request for the change.',
    needsWords: false,
    asks: () => 'Open a pull request for what changed, with a title and a description of the change.',
  },
];

export function stepKind(id: StepKindId): StepKind {
  return STEP_KINDS.find((one) => one.id === id) ?? STEP_KINDS[0]!;
}

/* ------------------------------------------------------------- the starters */

/** A loop somebody can put down whole. `after` is an index into `steps`, the
 *  way `set_going` numbers the pieces in one call. */
export type Starter = {
  id: string;
  name: string;
  note: string;
  steps: readonly { kind: StepKindId; after: number | null }[];
};

/**
 * Two loops, because two is a choice and six is a catalogue.
 *
 * Both are chains people already run by hand a message at a time; the canvas is
 * the first place they can be put down once and watched.
 */
export const STARTERS: readonly Starter[] = [
  {
    id: 'ship-it',
    name: 'Work, try it, check it, hand it over',
    note: 'Make the change, open it in the browser, run the checks, then a pull request.',
    steps: [
      { kind: 'work', after: null },
      { kind: 'browser', after: 0 },
      { kind: 'checks', after: 1 },
      { kind: 'pull-request', after: 2 },
    ],
  },
  {
    id: 'look-first',
    name: 'Look around, work on it, review it',
    note: 'Read the project before touching it, make the change, then read the change back.',
    steps: [
      { kind: 'look', after: null },
      { kind: 'work', after: 0 },
      { kind: 'review', after: 1 },
    ],
  },
];

/** What to put on the board for one starter, in order. Each entry's `after` is
 *  the index of the one before it, so the caller can hand back real ids as it
 *  goes and never has to guess one. */
export function askedFor(starter: Starter, about: string): readonly { asks: string; after: number | null }[] {
  return starter.steps.map((one) => ({
    asks: stepKind(one.kind).asks(about),
    after: one.after,
  }));
}
