/** A flow: blocks you place, join up, and then start.
 *
 * The board runs work the moment it is asked for, which is right for "send this
 * off and tell me how it went" and wrong for composing. So a flow is drawn
 * first and nothing happens: blocks are a draft on disk until somebody presses
 * Start, and only then does each one become a piece on the board — the same
 * board, the same queue, the same ceiling. Stop takes them off it again.
 *
 * Everything here is a function of its arguments. What a flow *is*, what may be
 * joined to what, and what order it runs in are decided here; the view draws it
 * and the shell runs it.
 */

import type { WorkState } from './board';

/** Which model a block is run by, or null for whatever is answering. The same
 *  shape the rest of the app names a model with. */
export type BlockModel = { providerId: string; modelId: string } | null;

export type BlockKind =
  | 'look'
  | 'work'
  | 'helpers'
  | 'browser'
  | 'checks'
  | 'review'
  | 'pull-request';

/** One block on the canvas. */
export type Block = {
  /** Ours, and stable from the moment it is placed. */
  id: string;
  kind: BlockKind;
  /** What this one is asked to do. The kind's own words until somebody edits. */
  says: string;
  model: BlockModel;
  /** The block this one waits for, or null when it waits for nothing. */
  after: string | null;
  /** The piece on the board this became, once the flow was started. */
  piece: string | null;
};

export type Flow = {
  blocks: readonly Block[];
  /** When it was last started, or null while it is still being drawn. */
  startedAt: number | null;
};

export const EMPTY: Flow = { blocks: [], startedAt: null };

/** Draft until it has been started; after that it wears the board's own word. */
export type BlockState = 'draft' | WorkState;

/* -------------------------------------------------------------------------- */
/* What the canvas says                                                        */
/* -------------------------------------------------------------------------- */

export const canvasWords = {
  name: 'Canvas',
  note: 'Place the steps, join them up, then start.',
  empty: 'Build a flow',
  emptyNote: 'Take a loop somebody already worked out, or place a block and build out from it.',
  start: 'Start',
  stop: 'Stop',
  again: 'Start again',
  add: 'Add a block',
  blocks: 'Blocks',
  loops: 'Ready-made',
  what: 'What it does',
  runBy: 'Run by',
  whichever: 'Whatever is answering',
  waitsFor: 'Waits for',
  nothing: 'Nothing — it goes first',
  remove: 'Remove',
  connect: 'Drag from a block’s dot to the one that should follow it',
  /** Under the title. */
  counted: (blocks: number, done: number, going: number): string => {
    if (blocks === 0) return 'Nothing placed yet.';
    const many = `${String(blocks)} ${blocks === 1 ? 'block' : 'blocks'}`;
    if (going > 0) return `${many} · ${String(done)} done, ${String(going)} going`;
    if (done > 0) return `${many} · ${String(done)} done`;
    return `${many} · not started`;
  },
  states: {
    draft: 'Ready',
    waiting: 'Waiting',
    running: 'Going',
    'needs-you': 'Needs you',
    done: 'Done',
    failed: 'Stopped',
  } as Readonly<Record<BlockState, string>>,
  /** Refusals, said where the line was drawn. */
  itself: 'A block cannot wait for itself.',
  loop: 'These would wait for each other, so neither could start.',
  missing: 'I could not find that block.',
  running: 'This flow is going. Stop it before changing the shape.',
  saySomething: 'Say what it should do before starting.',
} as const;

/* -------------------------------------------------------------------------- */
/* The blocks somebody can place                                               */
/* -------------------------------------------------------------------------- */

export type BlockSpec = {
  kind: BlockKind;
  name: string;
  note: string;
  /** True where the block is worth nothing until somebody says what about. */
  needsWords: boolean;
  /** What it is asked, before anybody edits it. */
  says: string;
};

/**
 * Seven blocks, each one work the app already does.
 *
 * Named as the operation rather than the tool behind it, and each carries the
 * whole instruction it will be run with — a block *is* what it is asked, so the
 * words in the panel are the words that go out. Editing one is editing that.
 */
export const BLOCKS: readonly BlockSpec[] = [
  {
    kind: 'work',
    name: 'Work on it',
    note: 'Make the change.',
    needsWords: true,
    says: '',
  },
  {
    kind: 'look',
    name: 'Look around',
    note: 'Read the project and say what it would do. Changes nothing.',
    needsWords: false,
    says: 'Look around the project and say what you would do. Change nothing.',
  },
  {
    kind: 'helpers',
    name: 'Send in helpers',
    note: 'Split it between several working at once.',
    needsWords: true,
    says: '',
  },
  {
    kind: 'browser',
    name: 'Try it in the browser',
    note: 'Open the page and check the change works.',
    needsWords: false,
    says: 'Open the page in the browser and check the change works. Say what you saw, and take a picture of it.',
  },
  {
    kind: 'checks',
    name: 'Run the checks',
    note: 'Run the project’s checks and fix what fails.',
    needsWords: false,
    says: 'Run this project’s checks. Fix anything that fails, then run them again until they pass.',
  },
  {
    kind: 'review',
    name: 'Review',
    note: 'Read the change and give a verdict.',
    needsWords: false,
    says: 'Review what has changed and give your verdict, with the findings that matter first.',
  },
  {
    kind: 'pull-request',
    name: 'Pull request',
    note: 'Open a pull request for the change.',
    needsWords: false,
    says: 'Open a pull request for what changed, with a title and a description of the change.',
  },
];

export function specOf(kind: BlockKind): BlockSpec {
  return BLOCKS.find((one) => one.kind === kind) ?? BLOCKS[0]!;
}

/** What a helpers block is asked, once somebody has said what about. Written
 *  here rather than in the view so the sentence can be read back in a test. */
export function helperWords(about: string): string {
  return `Split this between several helpers working at once, then bring what they found together: ${about.trim()}`;
}

/* -------------------------------------------------------------------------- */
/* Ready-made loops                                                            */
/* -------------------------------------------------------------------------- */

export type Loop = {
  id: string;
  name: string;
  note: string;
  /** `after` is an index into this same list, so a loop is a shape rather than
   *  a set of ids nobody has yet. */
  blocks: readonly { kind: BlockKind; after: number | null }[];
};

export const LOOPS: readonly Loop[] = [
  {
    id: 'ship-it',
    name: 'Work, try it, check it, hand it over',
    note: 'Make the change, open it in the browser, run the checks, then a pull request.',
    blocks: [
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
    blocks: [
      { kind: 'look', after: null },
      { kind: 'work', after: 0 },
      { kind: 'review', after: 1 },
    ],
  },
  {
    id: 'many-hands',
    name: 'Look around, several helpers, review',
    note: 'One pass to see the shape, several working at once, then one verdict over the lot.',
    blocks: [
      { kind: 'look', after: null },
      { kind: 'helpers', after: 0 },
      { kind: 'review', after: 1 },
    ],
  },
];

/* -------------------------------------------------------------------------- */
/* Editing a flow                                                              */
/* -------------------------------------------------------------------------- */

let counter = 0;

/** Unique for the life of the window. A flow read back off disk brings its own
 *  ids, and nothing here can hand out one of those twice. */
export function blockId(): string {
  counter += 1;
  return `block-${Date.now().toString(36)}-${String(counter)}`;
}

export function place(flow: Flow, kind: BlockKind, after: string | null = null): Flow {
  const spec = specOf(kind);
  const block: Block = {
    id: blockId(),
    kind,
    says: spec.says,
    model: null,
    after: flow.blocks.some((one) => one.id === after) ? after : null,
    piece: null,
  };
  return { ...flow, blocks: [...flow.blocks, block] };
}

/** Put a whole loop down, each block behind the one it was drawn behind. */
export function placeLoop(flow: Flow, loop: Loop): Flow {
  let next = flow;
  const made: string[] = [];
  for (const one of loop.blocks) {
    const before = next.blocks.length;
    next = place(next, one.kind, one.after === null ? null : (made[one.after] ?? null));
    made.push(next.blocks[before]?.id ?? '');
  }
  return next;
}

export function change(flow: Flow, id: string, over: Partial<Omit<Block, 'id'>>): Flow {
  return {
    ...flow,
    blocks: flow.blocks.map((one) => (one.id === id ? { ...one, ...over } : one)),
  };
}

/** Take one out, and hand whatever was waiting on it to what it was waiting for
 *  — a block removed from the middle must not strand the rest of the line. */
export function remove(flow: Flow, id: string): Flow {
  const gone = flow.blocks.find((one) => one.id === id);
  if (gone === undefined) return flow;
  return {
    ...flow,
    blocks: flow.blocks
      .filter((one) => one.id !== id)
      .map((one) => (one.after === id ? { ...one, after: gone.after } : one)),
  };
}

/**
 * Whether one block may be made to wait for another.
 *
 * Asked as the line is dragged, so a shape that could never run is refused
 * where it is drawn rather than found later by nothing happening.
 */
export function canWaitFor(
  flow: Flow,
  id: string,
  after: string | null,
): { ok: true } | { ok: false; because: string } {
  if (after === null) return { ok: true };
  if (id === after) return { ok: false, because: canvasWords.itself };
  const byId = new Map(flow.blocks.map((one) => [one.id, one]));
  if (!byId.has(id) || !byId.has(after)) return { ok: false, because: canvasWords.missing };
  let walk: string | null = after;
  const seen = new Set<string>();
  while (walk !== null && !seen.has(walk)) {
    if (walk === id) return { ok: false, because: canvasWords.loop };
    seen.add(walk);
    walk = byId.get(walk)?.after ?? null;
  }
  return { ok: true };
}

export function join(flow: Flow, id: string, after: string | null): Flow {
  return canWaitFor(flow, id, after).ok ? change(flow, id, { after }) : flow;
}

/* -------------------------------------------------------------------------- */
/* Starting it                                                                 */
/* -------------------------------------------------------------------------- */

/** Blocks that cannot go yet, because nobody has said what they are about. */
export function notReady(flow: Flow): readonly Block[] {
  return flow.blocks.filter((one) => specOf(one.kind).needsWords && one.says.trim() === '');
}

/** True while any block still has a piece on the board. */
export function isRunning(flow: Flow): boolean {
  return flow.blocks.some((one) => one.piece !== null);
}

export function canStart(flow: Flow): boolean {
  return flow.blocks.length > 0 && notReady(flow).length === 0 && !isRunning(flow);
}

/** How far along a block is: a draft until it has a piece, and the board's own
 *  word for it after that. */
export function stateOf(block: Block, states: Readonly<Record<string, WorkState>>): BlockState {
  return block.piece === null ? 'draft' : (states[block.piece] ?? 'waiting');
}

/** How far along each block sits, counted from whatever it waits for. */
function columns(flow: Flow): Map<string, number> {
  const byId = new Map(flow.blocks.map((one) => [one.id, one]));
  const at = new Map<string, number>();
  for (const block of flow.blocks) {
    let far = 0;
    const seen = new Set([block.id]);
    let walk = block.after;
    while (walk !== null && !seen.has(walk)) {
      const parent = byId.get(walk);
      if (parent === undefined) break;
      seen.add(walk);
      far += 1;
      walk = parent.after;
    }
    at.set(block.id, far);
  }
  return at;
}

/** The order blocks go on the board in, so each is asked to wait for one that
 *  already has an id of its own. */
export function runOrder(flow: Flow): readonly Block[] {
  const at = columns(flow);
  return [...flow.blocks].sort((one, other) => (at.get(one.id) ?? 0) - (at.get(other.id) ?? 0));
}

/** What one block is asked, ready to send. */
export function asksOf(block: Block): string {
  const said = block.says.trim();
  if (block.kind === 'helpers') return helperWords(said);
  return said === '' ? specOf(block.kind).says : said;
}

/** Back to a draft: the shape kept, the board forgotten. */
export function reset(flow: Flow): Flow {
  return { startedAt: null, blocks: flow.blocks.map((one) => ({ ...one, piece: null })) };
}

/* -------------------------------------------------------------------------- */
/* Laying it out                                                               */
/* -------------------------------------------------------------------------- */

export type Placed = Block & { column: number; row: number; state: BlockState };
export type Drawn = { blocks: readonly Placed[]; columns: number; rows: number };

/**
 * Left to right, one column per step along the chain.
 *
 * A block keeps its parent's row where that row is free, so a chain reads as
 * one straight line and only a fork moves anything down.
 */
export function layOut(flow: Flow, states: Readonly<Record<string, WorkState>> = {}): Drawn {
  if (flow.blocks.length === 0) return { blocks: [], columns: 0, rows: 0 };
  const at = columns(flow);
  const ordered = runOrder(flow);
  const taken = new Map<number, Set<number>>();
  const rowOf = new Map<string, number>();
  const blocks: Placed[] = [];

  for (const block of ordered) {
    const column = at.get(block.id) ?? 0;
    const used = taken.get(column) ?? new Set<number>();
    let row = block.after === null ? 0 : (rowOf.get(block.after) ?? 0);
    while (used.has(row)) row += 1;
    used.add(row);
    taken.set(column, used);
    rowOf.set(block.id, row);
    blocks.push({ ...block, column, row, state: stateOf(block, states) });
  }

  return {
    blocks,
    columns: Math.max(...blocks.map((one) => one.column)) + 1,
    rows: Math.max(...blocks.map((one) => one.row)) + 1,
  };
}

/** Everything waiting directly on this one. */
export function waitingOn(flow: Flow, id: string): readonly Block[] {
  return flow.blocks.filter((one) => one.after === id);
}

/* -------------------------------------------------------------------------- */
/* Reading one back                                                            */
/* -------------------------------------------------------------------------- */

const KINDS = new Set<string>(BLOCKS.map((one) => one.kind));

function readModel(value: unknown): BlockModel {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  const providerId = raw['providerId'];
  const modelId = raw['modelId'];
  if (typeof providerId !== 'string' || providerId.trim() === '') return null;
  if (typeof modelId !== 'string' || modelId.trim() === '') return null;
  return { providerId, modelId };
}

/** A flow out of whatever a file held. Anything unreadable is no flow at all,
 *  which is an empty canvas rather than an error. */
export function readFlow(raw: unknown): Flow {
  if (typeof raw !== 'object' || raw === null) return EMPTY;
  const held = raw as Record<string, unknown>;
  const list = held['blocks'];
  if (!Array.isArray(list)) return EMPTY;

  const blocks: Block[] = [];
  const seen = new Set<string>();
  for (const one of list as readonly unknown[]) {
    if (typeof one !== 'object' || one === null) continue;
    const block = one as Record<string, unknown>;
    const id = block['id'];
    const kind = block['kind'];
    if (typeof id !== 'string' || id === '' || seen.has(id)) continue;
    if (typeof kind !== 'string' || !KINDS.has(kind)) continue;
    seen.add(id);
    blocks.push({
      id,
      kind: kind as BlockKind,
      says: typeof block['says'] === 'string' ? block['says'] : '',
      model: readModel(block['model']),
      after: typeof block['after'] === 'string' ? block['after'] : null,
      piece: typeof block['piece'] === 'string' ? block['piece'] : null,
    });
  }

  // A wait pointing at a block that did not survive the read would strand it.
  const have = new Set(blocks.map((one) => one.id));
  const kept = blocks.map((one) =>
    one.after !== null && !have.has(one.after) ? { ...one, after: null } : one,
  );
  const startedAt = held['startedAt'];
  return {
    blocks: kept,
    startedAt: typeof startedAt === 'number' && startedAt > 0 ? startedAt : null,
  };
}
