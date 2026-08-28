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

import type { HowFar } from '../agent/guard/policy';

/** Which model a block is run by, or null for whatever is answering. The same
 *  shape the rest of the app names a model with. */
export type BlockModel = { providerId: string; modelId: string } | null;

let counter = 0;

export type BlockKind =
  | 'look'
  | 'work'
  | 'research'
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
  /** How far this one may go on its own. Left out, the canvas's own answer. */
  howFar?: HowFar;
  /** Look around and propose before touching anything. */
  lookFirst?: boolean;
  /** Pictures this block is sent with, the way a message is sent with them. */
  pictures?: readonly BlockPicture[];
};

/** One picture on a block. Held whole rather than as a path: a flow is drawn
 *  once and run later, and a file that moved between the two would be a block
 *  that quietly stopped being about anything. */
export type BlockPicture = {
  name: string;
  mimeType: string;
  /** Base64, without the data: prefix — the same shape the shell carries. */
  bytes: string;
};

/** Enough to show it something; not so many that a flow file becomes a photo
 *  album. */
export const MOST_PICTURES = 4;

export type Flow = {
  /** Ours, and stable for as long as the flow exists. A canvas is a tab like a
   *  conversation is a tab, so it needs a name of its own to be one. */
  id: string;
  name: string;
  blocks: readonly Block[];
  /** The conversation this canvas drives. A block is an ordinary turn in it —
   *  same tools, same Guard, same everything a person typing would get — so a
   *  canvas is a way of sending, not a second kind of agent. Null until it has
   *  been started once. */
  conversation: string | null;
  /** How far the whole flow may go on its own, where a block does not say. */
  howFar: HowFar;
  /** The block being run right now, or null. */
  running: string | null;
  /** What has finished, in the order it finished. */
  done: readonly string[];
  /** When it was last started, or null while it is still being drawn. */
  startedAt: number | null;
};

/** A canvas nobody has drawn on yet. */
export function newFlow(name = canvasWords.untitled): Flow {
  counter += 1;
  return {
    id: `flow-${Date.now().toString(36)}-${String(counter)}`,
    name,
    blocks: [],
    conversation: null,
    // The same rung a conversation opens on. A canvas is not a reason to be
    // asked less, and the row in its own bar is where that is changed.
    howFar: 'asking',
    running: null,
    done: [],
    startedAt: null,
  };
}

/** Where a block has got to. */
export type BlockState = 'draft' | 'waiting' | 'running' | 'done' | 'failed';

/* -------------------------------------------------------------------------- */
/* What the canvas says                                                        */
/* -------------------------------------------------------------------------- */

export const canvasWords = {
  name: 'Canvas',
  /** What a canvas is called before anybody has said. */
  untitled: 'Canvas',
  /** A canvas takes its name from the first thing it was asked to do. */
  named: (blocks: readonly Block[]): string => {
    const first = blocks.find((one) => one.says.trim() !== '');
    if (first === undefined) return canvasWords.untitled;
    const said = first.says.trim().replace(/\s+/g, ' ');
    return said.length <= 28 ? said : `${said.slice(0, 27)}…`;
  },
  note: 'Place the steps, join them up, then start.',
  empty: 'Build a flow',
  emptyNote: 'Take a loop somebody already worked out, or place a block and build out from it.',
  rename: 'What this canvas is called',
  shut: 'Close this panel',
  bigger: 'Fill the window',
  smaller: 'Back to the column',
  start: 'Start',
  stop: 'Stop',
  again: 'Start again',
  add: 'Add a block',
  blocks: 'Blocks',
  loops: 'Ready-made',
  what: 'What it does',
  runBy: 'Run by',
  howFar: 'How far it may go',
  /** The one the whole flow runs at, where a block does not say otherwise. */
  sameAsFlow: 'Same as the canvas',
  rungs: {
    looking: 'Just looking',
    asking: 'Asks first',
    changing: 'Changes files',
    doing: 'Gets on with it',
  } as Readonly<Record<HowFar, string>>,
  whichever: 'Whatever is answering',
  waitsFor: 'Waits for',
  nothing: 'Nothing — it goes first',
  shows: 'Shows it',
  addPicture: 'Add a picture',
  tooMany: (n: number): string => `A block carries up to ${String(n)} pictures.`,
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
    kind: 'research',
    name: 'Look it up',
    note: 'Read around the problem before deciding, and say what it found.',
    needsWords: true,
    says: '',
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

/** True while a block is being run. */
export function isRunning(flow: Flow): boolean {
  return flow.running !== null;
}

export function canStart(flow: Flow): boolean {
  return flow.blocks.length > 0 && notReady(flow).length === 0 && !isRunning(flow);
}

/**
 * The next block to send, or null when there is nothing left to send.
 *
 * The first one in order that has not finished and whose wait has. A block
 * whose wait never finished is never sent — what follows a step that did not
 * happen would be working against a change nobody made.
 */
export function nextUp(flow: Flow): Block | null {
  const done = new Set(flow.done);
  for (const block of runOrder(flow)) {
    if (done.has(block.id)) continue;
    if (block.after !== null && !done.has(block.after)) continue;
    return block;
  }
  return null;
}

/** How far along a block is. */
export function stateOf(block: Block, flow: Flow): BlockState {
  if (flow.done.includes(block.id)) return 'done';
  if (flow.running === block.id) return 'running';
  if (flow.running === null && flow.startedAt === null) return 'draft';
  // Going, and this one has not had its turn: either its wait is still out or
  // it is simply behind something else.
  return 'waiting';
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

/** What a looking-up block is asked. */
export function lookedUpWords(about: string): string {
  return `Look this up properly before deciding anything: ${about.trim()}. Read what is already here, search the web where it helps, and say what you found and what you would do about it. Change nothing.`;
}

/** What one block is asked, ready to send. */
export function asksOf(block: Block): string {
  const said = block.says.trim();
  if (block.kind === 'helpers') return helperWords(said);
  if (block.kind === 'research') return lookedUpWords(said);
  return said === '' ? specOf(block.kind).says : said;
}

/** Back to a draft: the shape kept, what it got to forgotten. The conversation
 *  stays — what it said is worth keeping and is the record of the run. */
export function reset(flow: Flow): Flow {
  return { ...flow, startedAt: null, running: null, done: [] };
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
export function layOut(flow: Flow): Drawn {
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
    blocks.push({ ...block, column, row, state: stateOf(block, flow) });
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

function readPictures(value: unknown): readonly BlockPicture[] {
  if (!Array.isArray(value)) return [];
  const kept: BlockPicture[] = [];
  for (const one of value as readonly unknown[]) {
    if (typeof one !== 'object' || one === null) continue;
    const raw = one as Record<string, unknown>;
    const name = raw['name'];
    const mimeType = raw['mimeType'];
    const bytes = raw['bytes'];
    if (typeof name !== 'string' || typeof mimeType !== 'string' || typeof bytes !== 'string') continue;
    if (mimeType.trim() === '' || bytes === '') continue;
    kept.push({ name, mimeType, bytes });
    if (kept.length === MOST_PICTURES) break;
  }
  return kept;
}

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
export function readFlow(raw: unknown): Flow | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const held = raw as Record<string, unknown>;
  const id = held['id'];
  const list = held['blocks'];
  if (typeof id !== 'string' || id === '' || !Array.isArray(list)) return null;

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
      ...(isHowFar(block['howFar']) ? { howFar: block['howFar'] } : {}),
      ...(block['lookFirst'] === true ? { lookFirst: true } : {}),
      ...(readPictures(block['pictures']).length === 0
        ? {}
        : { pictures: readPictures(block['pictures']) }),
    });
  }

  // A wait pointing at a block that did not survive the read would strand it.
  const have = new Set(blocks.map((one) => one.id));
  const kept = blocks.map((one) =>
    one.after !== null && !have.has(one.after) ? { ...one, after: null } : one,
  );
  const startedAt = held['startedAt'];
  const name = held['name'];
  const conversation = held['conversation'];
  const running = held['running'];
  const doneList = held['done'];
  const have2 = new Set(kept.map((one) => one.id));
  return {
    id,
    name: typeof name === 'string' && name.trim() !== '' ? name : canvasWords.untitled,
    blocks: kept,
    conversation: typeof conversation === 'string' && conversation !== '' ? conversation : null,
    howFar: isHowFar(held['howFar']) ? held['howFar'] : 'asking',
    // Nothing is running the moment this is read: the window that was running
    // it is gone, and claiming otherwise would draw a block that never moves.
    running: typeof running === 'string' && have2.has(running) ? null : null,
    done: Array.isArray(doneList)
      ? (doneList as readonly unknown[]).filter(
          (one): one is string => typeof one === 'string' && have2.has(one),
        )
      : [],
    startedAt: typeof startedAt === 'number' && startedAt > 0 ? startedAt : null,
  };
}

export const RUNGS: readonly HowFar[] = ['looking', 'asking', 'changing', 'doing'];

function isHowFar(value: unknown): value is HowFar {
  return typeof value === 'string' && (RUNGS as readonly string[]).includes(value);
}

/** Every flow a file held, in the order it held them. Anything unreadable is
 *  one canvas lost rather than a project that will not open. */
export function readFlows(raw: unknown): readonly Flow[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const flows: Flow[] = [];
  for (const one of raw as readonly unknown[]) {
    const flow = readFlow(one);
    if (flow === null || seen.has(flow.id)) continue;
    seen.add(flow.id);
    flows.push(flow);
  }
  return flows;
}

/** The list with this one in it, in place if it was already there. */
export function withFlow(flows: readonly Flow[], flow: Flow): readonly Flow[] {
  return flows.some((one) => one.id === flow.id)
    ? flows.map((one) => (one.id === flow.id ? flow : one))
    : [...flows, flow];
}

export function withoutFlow(flows: readonly Flow[], id: string): readonly Flow[] {
  return flows.filter((one) => one.id !== id);
}
