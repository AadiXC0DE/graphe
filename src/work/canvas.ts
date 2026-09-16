/** A flow: blocks you place, join up, and then start.
 *
 * Everything here is a function of its arguments. What a flow is, what may be
 * joined to what, and what order it runs in are decided here; the view draws it
 * and the shell runs it. Nothing in this file reads, writes, waits or draws.
 */

import type { HowFar } from '../agent/guard/policy';
import type { Money } from '../agent/types';
import { asRunId, type RunId } from '../domain/identity';
import type { ThinkingLevel } from '../lib/ipc';

let counter = 0;

/** What a block is. Seven, four of which are real machinery; "research it" and
 *  "split it between subagents" are sentences inside an ask, not kinds. */
export type BlockKind = 'ask' | 'plan' | 'checks' | 'review' | 'gate' | 'pull-request' | 'goal';

/** Which model a block is run by, or null for whatever is answering. The same
 *  shape the rest of the app names a model with. */
export type BlockModel = { providerId: string; modelId: string } | null;

/** One block on the canvas. */
export type Block = {
  /** `block-…`, stable from placement. */
  id: string;
  kind: BlockKind;
  /** Two or three words on the card. The kind's own name until edited. */
  name: string;
  /** What it is asked to do. Empty is allowed only for kinds that send
   *  nothing: an ask or a goal with nothing in it cannot start. */
  says: string;
  /** null: the flow's default. */
  model: BlockModel;
  /** null: the model's remembered level. */
  thinking: ThinkingLevel | null;
  /** Every block this waits for. Empty: it starts the flow. Several means it
   *  begins when the last of them has finished. */
  after: readonly string[];
  /** Plan mode for this turn. */
  lookFirst: boolean;
  /** Content ids in the attachment store. Never bytes: a flow file holds ids. */
  attachments: readonly string[];
  /** Checks and Goal: how many fix turns to send before failing. */
  retries: number;
  /** Where somebody put it. Absent means the arithmetic decides. */
  at?: { x: number; y: number };
};

/** Branches in turn, in one conversation, or each in its own worktree. */
export type Lanes = 'in-turn' | 'worktrees';

/** The flow's own lane: the workspace it was started from, and the only lane a
 *  flow in turn ever uses. Every other lane is a branch's worktree. */
export const LANE_0 = 'lane-0';

export type Flow = {
  /** `flow-…` */
  id: string;
  name: string;
  blocks: readonly Block[];
  /** How far the whole flow may go on its own. */
  howFar: HowFar;
  lanes: Lanes;
  /** Newest first, at most KEPT_RUNS. The shell owns these; a save from the
   *  window never writes them. */
  runs: readonly Run[];
  createdAt: number;
  updatedAt: number;
};

/** How many runs a flow keeps. Enough to compare the last few tries without
 *  the file growing for ever. */
export const KEPT_RUNS = 10;

export type RunState = 'running' | 'needs-you' | 'done' | 'failed' | 'stopped' | 'interrupted';
export type BlockState = 'draft' | 'waiting' | 'running' | 'needs-you' | 'done' | 'failed' | 'stopped';

/** One place a run works: the flow's own workspace, or a branch's worktree. */
export type Lane = {
  /** `lane-0` is the flow's own; others are branches. */
  id: string;
  workspaceId: string;
  /** Opened on first use. */
  conversationId: string | null;
  /** The worktree's branch, for Review. */
  branch: string | null;
};

/** What one block came to in one run. */
export type BlockRun = {
  state: BlockState;
  lane: string;
  startedAt: number | null;
  endedAt: number | null;
  /** The last thing the turn said, whole. Null until done. */
  said: string | null;
  turns: number;
  spent: Money | null;
  /** Goal and checks retries used. */
  rounds: number;
  /** Review: the verdict card's line. Pull request: the URL. */
  result: string | null;
  failure: string | null;
};

export type Run = {
  id: RunId;
  state: RunState;
  startedAt: number;
  endedAt: number | null;
  lanes: readonly Lane[];
  blocks: Readonly<Record<string, BlockRun>>;
  spent: Money | null;
};

/** A canvas nobody has drawn on yet. */
export function newFlow(name = canvasWords.untitled): Flow {
  counter += 1;
  const at = Date.now();
  return {
    id: `flow-${at.toString(36)}-${String(counter)}`,
    name,
    blocks: [],
    // A flow is left to run: stopping to ask would stop it where nobody is
    // looking. The rung is on the flow's own bar, and this is its default.
    howFar: 'doing',
    lanes: 'in-turn',
    runs: [],
    createdAt: at,
    updatedAt: at,
  };
}

/** Unique for the life of the window. A flow read off disk brings its own ids. */
export function blockId(): string {
  counter += 1;
  return `block-${Date.now().toString(36)}-${String(counter)}`;
}

/* -------------------------------------------------------------------------- */
/* What the canvas says                                                        */
/* -------------------------------------------------------------------------- */

export const canvasWords = {
  name: 'Canvas',
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
  emptyNote: 'Take a template somebody already worked out, or place a block and build out from it.',
  canvases: 'Canvases',
  rename: 'What this canvas is called',
  close: 'Close this panel',
  fill: 'Fill window',
  start: 'Start',
  stop: 'Stop',
  continue: 'Continue',
  open: 'Open',
  watch: 'Watch',
  delete: 'Delete',
  duplicate: 'Duplicate',
  tidy: 'Tidy',
  fit: 'Fit',
  undo: 'Undo',
  redo: 'Redo',
  runs: 'Runs',
  place: 'Place a block',
  templates: 'Templates',
  further: 'Further out',
  closer: 'Closer',
  inTurn: 'In turn',
  inWorktrees: 'In worktrees',
  lanesNote: 'In turn runs each branch one after another in this conversation; in worktrees each branch gets its own copy and its own conversation, and runs at the same time.',
  blocks: 'Blocks',
  what: 'What it does',
  startFrom: 'Start from',
  model: 'Model',
  everyModel: 'Models',
  whichever: 'Default',
  whicheverNote: (model: string | null): string =>
    model === null
      ? 'Whatever this canvas is set to.'
      : `Whatever this canvas is set to: ${model} right now.`,
  thinking: 'Thinking',
  lookFirst: 'Plan first',
  lookFirstNote: 'Propose before touching anything',
  waitsFor: 'Runs after',
  nothing: 'Nothing (starts the flow)',
  attachments: 'Attachments',
  attach: 'Attach',
  takeOff: (name: string): string => `Take ${name} off this block`,
  retries: 'Retries',
  answerIt: 'Answer',
  watchNote: 'Read every turn this block took',
  counted: (blocks: number, done: number, going: number): string => {
    if (blocks === 0) return 'Nothing placed yet.';
    const many = `${String(blocks)} ${blocks === 1 ? 'block' : 'blocks'}`;
    if (going > 0) return `${many} · ${String(done)} done, ${String(going)} running`;
    if (done > 0) return `${many} · ${String(done)} done`;
    return `${many} · not started`;
  },
  states: {
    draft: 'Ready',
    waiting: 'Waiting',
    running: 'Running',
    'needs-you': 'Needs you',
    done: 'Done',
    failed: 'Failed',
    stopped: 'Stopped',
  } as Readonly<Record<BlockState, string>>,
  /** On a gate, and the press that opens it. */
  gateWaits: 'Stopped here until you say Continue.',
  /** On a goal or checks block while it is going round again. */
  round: (n: number, of: number): string => `Round ${String(n)} of ${String(of)}`,
  /** A lane past the ceiling waits for one to free up. */
  room: 'Waiting for room',
  working: 'Working…',
  asksYou: 'It has stopped to ask you something',
  /** The band along the foot once a run is over. */
  ending: {
    finished: 'Finished',
    stopped: 'Stopped',
    failed: 'Failed',
    interrupted: 'Interrupted when Graphe closed',
    resume: 'Resume',
    again: 'Start again',
    ranTo: (blocks: number, turns: number): string =>
      `${String(blocks)} ${blocks === 1 ? 'block' : 'blocks'} · ${canvasWords.turnsTook(turns)}`,
    left: (n: number): string => `${String(n)} never ran`,
    lastly: 'Last thing it said',
    openThread: 'Open the conversation',
    review: 'Review',
    hide: 'Hide this',
  },
  turnsTook: (n: number): string => (n === 1 ? '1 turn' : `${String(n)} turns`),
  after: (n: number): string => (n === 1 ? '1 follows' : `${String(n)} follow`),
  nothingYet: 'Nothing yet.',
  /** What one block came to, said over the block it is carried into. */
  cameTo: (name: string): string => `What ${name} came to:`,
  /** Refusals, said where the line was drawn or the Start was pressed. */
  itself: 'A block cannot wait for itself.',
  loop: 'These would wait for each other, so neither could start.',
  missing: 'I could not find that block.',
  running: 'This flow is running. Stop it before changing the shape.',
  saySomething: 'Say what it should do before starting.',
  nothingPlaced: 'Nothing to start. Place a block first.',
  needsBranch: 'A pull request needs a branch. Run this canvas in worktrees, or take the project off its default branch.',
} as const;

/** The three sentences an ask can start from. Named for the work, because that
 *  is what somebody is choosing between. */
export const ASK_STARTING: readonly { name: string; says: string }[] = [
  {
    name: 'Research it',
    says: 'Look this up properly before deciding anything. Read what is already here, search the web where it helps, and say what you found and what you would do about it. Change nothing.',
  },
  {
    name: 'Split between subagents',
    says: 'Split this between subagents working in parallel, then bring what they found back together.',
  },
  {
    name: 'Check it in the browser',
    says: 'Open the page in the browser and check the change works. Say what you saw, and take a picture of it.',
  },
];

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
 * words in the panel are the words that go out.
 */
export const BLOCKS: readonly BlockSpec[] = [
  {
    kind: 'ask',
    name: 'Ask',
    note: 'Say what to do, sent as it is.',
    needsWords: true,
    says: '',
  },
  {
    kind: 'plan',
    name: 'Plan',
    note: 'Read the project and propose. Changes nothing.',
    needsWords: false,
    says: 'Look around the project and say what you would do. Change nothing.',
  },
  {
    kind: 'checks',
    name: 'Checks',
    note: 'Run the project’s checks and fix what fails.',
    needsWords: false,
    says: 'Run this project’s checks. Fix anything that fails, then run them again until they pass.',
  },
  {
    kind: 'review',
    name: 'Review',
    note: 'Read the diff and give a verdict.',
    needsWords: false,
    says: 'Review what has changed and give your verdict, with the findings that matter first.',
  },
  {
    kind: 'gate',
    name: 'Gate',
    note: 'Stop here until you say Continue. Nothing is sent.',
    needsWords: false,
    says: '',
  },
  {
    kind: 'pull-request',
    name: 'Pull request',
    note: 'Open a pull request for the change.',
    needsWords: false,
    says: 'Open a pull request for what changed, with a title and a description of the change.',
  },
  {
    kind: 'goal',
    name: 'Goal',
    note: 'Keep going until the checks pass, or the tries run out.',
    needsWords: true,
    says: '',
  },
];

export function specOf(kind: BlockKind): BlockSpec {
  return BLOCKS.find((one) => one.kind === kind) ?? BLOCKS[0]!;
}

/** True for a block that sends nothing and simply stops the flow. */
export function isGate(block: Block): boolean {
  return block.kind === 'gate';
}

/** How many fix turns a kind sends before it fails. Checks and a goal are the
 *  two that go round; everything else gets its one turn. */
export function retriesFor(kind: BlockKind): number {
  if (kind === 'checks') return 2;
  if (kind === 'goal') return 6;
  return 0;
}

/** What a goal block is asked, first time and every round after. */
export function goalSays(about: string): string {
  return `Work toward this until it is done, then stop: ${about.trim()}. Run this project’s checks when you think you are there.`;
}

/** What a checks block is asked after a run that failed. */
export function checksFix(failure: string): string {
  return `Fix what failed: ${failure.trim()}`;
}

/* -------------------------------------------------------------------------- */
/* Templates                                                                   */
/* -------------------------------------------------------------------------- */

/** One block in a template. `after` is indices into the same list, so a
 *  template is a shape rather than a set of ids nobody has yet. */
export type BlockShape = {
  kind: BlockKind;
  /** Overrides the kind's own name, where two blocks of one kind must be told
   *  apart in what a later block carries. */
  name?: string;
  says?: string;
  after: readonly number[];
};

export type Template = {
  id: string;
  name: string;
  note: string;
  lanes: Lanes;
  blocks: readonly BlockShape[];
};

export const TEMPLATES: readonly Template[] = [
  {
    id: 'ship-it',
    name: 'Ship it',
    note: 'Make the change, run the checks, read it back, then open the pull request.',
    lanes: 'in-turn',
    blocks: [
      { kind: 'ask', after: [] },
      { kind: 'checks', after: [0] },
      { kind: 'review', after: [1] },
      { kind: 'pull-request', after: [2] },
    ],
  },
  {
    id: 'plan-first',
    name: 'Plan first',
    note: 'Read the project, stop for a yes, make the change, then the checks.',
    lanes: 'in-turn',
    blocks: [
      { kind: 'plan', after: [] },
      { kind: 'gate', after: [0] },
      { kind: 'ask', after: [1] },
      { kind: 'checks', after: [2] },
    ],
  },
  {
    id: 'two-ways',
    name: 'Two ways',
    note: 'One plan, two tries in their own worktrees, then an ask that compares what both came to.',
    lanes: 'worktrees',
    blocks: [
      { kind: 'plan', after: [] },
      { kind: 'ask', name: 'Way A', after: [0] },
      { kind: 'ask', name: 'Way B', after: [0] },
      {
        kind: 'ask',
        name: 'Compare',
        says: 'Say what each way came to, which one to keep and why, then what is left to do.',
        after: [1, 2],
      },
    ],
  },
];

/** Put a whole template down, each block behind the ones it was drawn behind.
 *  The template's lanes come with it: "Two ways" is two worktrees or it is not
 *  two ways. */
export function placeTemplate(flow: Flow, template: Template): Flow {
  let next: Flow = { ...flow, lanes: template.lanes };
  const made: string[] = [];
  for (const one of template.blocks) {
    const at = next.blocks.length;
    next = place(next, one.kind, one.after.map((index) => made[index] ?? '').filter((id) => id !== ''));
    const id = next.blocks[at]?.id;
    if (id === undefined) continue;
    made.push(id);
    if (one.name !== undefined) next = change(next, id, { name: one.name });
    if (one.says !== undefined) next = change(next, id, { says: one.says });
  }
  return next;
}

/* -------------------------------------------------------------------------- */
/* Editing a flow                                                              */
/* -------------------------------------------------------------------------- */

export function place(flow: Flow, kind: BlockKind, after: string | readonly string[] | null = null): Flow {
  const spec = specOf(kind);
  const asked = after === null ? [] : typeof after === 'string' ? [after] : after;
  const block: Block = {
    id: blockId(),
    kind,
    name: spec.name,
    says: spec.says,
    model: null,
    thinking: null,
    // A wait pointing at a block nobody has would strand it, so it is dropped
    // where it is drawn.
    after: [...new Set(asked.filter((one) => flow.blocks.some((block) => block.id === one)))],
    lookFirst: false,
    attachments: [],
    retries: retriesFor(kind),
  };
  return { ...flow, blocks: [...flow.blocks, block] };
}

export function change(flow: Flow, id: string, over: Partial<Omit<Block, 'id'>>): Flow {
  return {
    ...flow,
    blocks: flow.blocks.map((one) => (one.id === id ? { ...one, ...over } : one)),
  };
}

/** Take one out, and hand whatever was waiting on it to what it was waiting for
 *  — a block removed from the middle must not strand the rest of the line.
 *
 *  With several parents that is a splice rather than a swap: the removed
 *  block's own waits take its place in each child's list, beside whatever else
 *  that child was already waiting for. */
export function remove(flow: Flow, id: string): Flow {
  const gone = flow.blocks.find((one) => one.id === id);
  if (gone === undefined) return flow;
  return {
    ...flow,
    blocks: flow.blocks
      .filter((one) => one.id !== id)
      .map((one) =>
        one.after.includes(id)
          ? {
              ...one,
              after: [
                ...new Set([...one.after.filter((was) => was !== id), ...gone.after]),
              ].filter((was) => was !== one.id),
            }
          : one,
      ),
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
  // Everything the proposed parent already waits for, however many branches
  // that is. A single walk up one chain missed a ring closed through the other.
  const seen = new Set<string>();
  const todo = [after];
  while (todo.length > 0) {
    const one = todo.pop() as string;
    if (one === id) return { ok: false, because: canvasWords.loop };
    if (seen.has(one)) continue;
    seen.add(one);
    todo.push(...(byId.get(one)?.after ?? []));
  }
  return { ok: true };
}

/** Add a wait. Already waiting for it, or unable to, and the flow is unchanged
 *  — dropping a line twice is not two lines. */
export function join(flow: Flow, id: string, after: string | null): Flow {
  if (after === null) return change(flow, id, { after: [] });
  const block = flow.blocks.find((one) => one.id === id);
  if (block === undefined || block.after.includes(after)) return flow;
  return canWaitFor(flow, id, after).ok
    ? change(flow, id, { after: [...block.after, after] })
    : flow;
}

/** Take one wait off. What is left may be nothing, and then the flow begins
 *  here — which is how a line is removed as well as added. */
export function unjoin(flow: Flow, id: string, after: string): Flow {
  const block = flow.blocks.find((one) => one.id === id);
  if (block === undefined || !block.after.includes(after)) return flow;
  return change(flow, id, { after: block.after.filter((one) => one !== after) });
}

/** Whether a line already runs from one to the other, so a second drag over it
 *  can take it off rather than refuse. */
export function joined(flow: Flow, id: string, after: string): boolean {
  return flow.blocks.find((one) => one.id === id)?.after.includes(after) === true;
}

/* -------------------------------------------------------------------------- */
/* Starting it                                                                 */
/* -------------------------------------------------------------------------- */

/** The run the window and the foot band are about: the newest one. */
export function latestRun(flow: Flow): Run | null {
  return flow.runs[0] ?? null;
}

/** Where a block has got to in the run the flow is showing. A flow with no run
 *  has never been started, so everything on it is a draft. */
export function stateOf(block: Block, flow: Flow): BlockState {
  const run = latestRun(flow);
  if (run === null) return 'draft';
  return run.blocks[block.id]?.state ?? 'draft';
}

/** How far along each block sits, counted from whatever it waits for. */
export function columns(flow: Flow): Map<string, number> {
  const byId = new Map(flow.blocks.map((one) => [one.id, one]));
  const at = new Map<string, number>();
  // One past the furthest thing it waits for, so a block waiting on two chains
  // of different lengths sits after both of them rather than beside the short
  // one. `walking` closes a ring a hand-edited flow could still hold.
  const walking = new Set<string>();
  const far = (id: string): number => {
    const held = at.get(id);
    if (held !== undefined) return held;
    if (walking.has(id)) return 0;
    walking.add(id);
    const parents = byId.get(id)?.after ?? [];
    const deep = parents.reduce((most, one) => (byId.has(one) ? Math.max(most, far(one) + 1) : most), 0);
    walking.delete(id);
    at.set(id, deep);
    return deep;
  };
  for (const block of flow.blocks) far(block.id);
  return at;
}

/** The order blocks go on the board in, so each is asked to wait for one that
 *  already has an id of its own. */
export function runOrder(flow: Flow): readonly Block[] {
  const at = columns(flow);
  return [...flow.blocks].sort((one, other) => (at.get(one.id) ?? 0) - (at.get(other.id) ?? 0));
}

/** True for a block that has not had its turn in this run. */
function notStarted(run: Run, block: Block): boolean {
  const held = run.blocks[block.id];
  return held === undefined || held.state === 'draft' || held.state === 'waiting';
}

/**
 * What may be sent now: every block not started whose parents have all finished
 * in this run.
 *
 * In turn, that is at most one — the next in run order. In worktrees it is one
 * per lane, which is every branch of a fan out at once and never two turns in
 * one folder: two blocks that both start the flow are both in `lane-0`, and
 * files are written by one turn at a time.
 */
export function readyNow(flow: Flow, run: Run): readonly Block[] {
  const ready = runOrder(flow).filter((one) => {
    if (!notStarted(run, one)) return false;
    return one.after.every((was) => run.blocks[was]?.state === 'done');
  });
  if (flow.lanes !== 'worktrees') return ready.slice(0, 1);
  const taken = new Set<string>();
  return ready.filter((one) => {
    const lane = laneFor(flow, one);
    if (taken.has(lane)) return false;
    taken.add(lane);
    return true;
  });
}

/** The blocks a branch begins at: a fork's second and later children, in the
 *  order they were placed. One worktree each. */
function branchStarts(flow: Flow): readonly string[] {
  return flow.blocks
    .filter((one) => {
      const first = flow.blocks.find((other) => other.id === one.after[0]);
      if (first === undefined) return false;
      return flow.blocks.find((other) => other.after.includes(first.id))?.id !== one.id;
    })
    .map((one) => one.id);
}

/**
 * Which lane a block runs in, worked out from the shape.
 *
 * A block with no parents runs in the flow's own lane. Otherwise it inherits
 * its first parent's lane, and a parent's second and later children each start
 * a branch of their own when the flow is in worktrees — which is what makes a
 * fan out two branches rather than one queue. A fan in takes its first parent's
 * lane, and the other lanes' work reaches it in its words.
 */
export function laneFor(flow: Flow, block: Block): string {
  if (flow.lanes !== 'worktrees') return LANE_0;
  const parent = flow.blocks.find((one) => one.id === block.after[0]);
  if (parent === undefined) return LANE_0;
  // A fan in runs where its first parent ran, and the other lanes' work reaches
  // it in its words rather than in a folder of its own.
  if (block.after.length > 1) return laneFor(flow, parent);
  const children = flow.blocks.filter((one) => one.after.includes(parent.id));
  if (children[0]?.id === block.id) return laneFor(flow, parent);
  // Numbered in placement order, so two forks in one flow never share a
  // worktree however many branches each of them has.
  return `lane-${String(branchStarts(flow).indexOf(block.id) + 1)}`;
}

/** The next block to send, or null when there is nothing left to send. Null for
 *  a flow that has never been started: a run is what makes a block go. */
export function nextUp(flow: Flow): Block | null {
  const run = latestRun(flow);
  if (run === null) return null;
  return readyNow(flow, run)[0] ?? null;
}

/**
 * What one block is asked, ready to send.
 *
 * A plan, a goal and a checks fix are asked the kind's own sentence, and an ask
 * is asked what somebody typed. Work that landed in another lane is not in this
 * lane's transcript, so it is carried in above the sentence, named for the
 * block it came from. Work in this lane is already the conversation.
 */
export function askOf(flow: Flow, run: Run, block: Block): string {
  const sentence =
    block.kind === 'goal'
      ? goalSays(block.says)
      : block.says.trim() === ''
        ? specOf(block.kind).says
        : block.says.trim();
  const mine = laneFor(flow, block);
  const carried = flow.blocks
    .filter(
      (one) =>
        block.after.includes(one.id) && laneFor(flow, one) !== mine,
    )
    .map((one) => {
      const said = run.blocks[one.id]?.said ?? '';
      return `${canvasWords.cameTo(one.name)}\n${said}`;
    });
  return carried.length === 0 ? sentence : [...carried, sentence].join('\n\n');
}

/** Whether a flow's waits ever resolve, or two blocks wait for each other. */
function ringed(flow: Flow): boolean {
  const have = new Set(flow.blocks.map((one) => one.id));
  const placed = new Set<string>();
  for (let pass = 0; pass <= flow.blocks.length; pass += 1) {
    let grew = false;
    for (const one of flow.blocks) {
      if (placed.has(one.id)) continue;
      // A wait on a block nobody has is already gone, so it does not hold one.
      if (!one.after.every((was) => !have.has(was) || placed.has(was))) continue;
      placed.add(one.id);
      grew = true;
    }
    if (!grew) break;
  }
  return placed.size !== flow.blocks.length;
}

/** Where the flow would run while it is in turn: on a branch of its own, or on
 *  the project's default branch. The window knows which; this file does not, so
 *  whoever asks says. */
export type Standing = 'branch' | 'default-branch';

/**
 * Whether a flow may be started, and why not.
 *
 * A pull request opened from the project's default branch is not a pull
 * request, so that block needs either worktrees or a project already off it,
 * and the sentence says which.
 */
export function canStart(
  flow: Flow,
  standing: Standing = 'branch',
): { ok: true } | { ok: false; because: string } {
  if (flow.blocks.length === 0) return { ok: false, because: canvasWords.nothingPlaced };
  const mute = flow.blocks.find(
    (one) => (one.kind === 'ask' || one.kind === 'goal') && one.says.trim() === '',
  );
  if (mute !== undefined) return { ok: false, because: canvasWords.saySomething };
  if (ringed(flow)) return { ok: false, because: canvasWords.loop };
  const wantsOne = flow.blocks.some((one) => one.kind === 'pull-request');
  if (wantsOne && flow.lanes !== 'worktrees' && standing === 'default-branch') {
    return { ok: false, because: canvasWords.needsBranch };
  }
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* The record of a run                                                         */
/* -------------------------------------------------------------------------- */

/** The flow with this run on it, newest first, and no more than KEPT_RUNS of
 *  them. Replacing one by id is what a runner does on every tick. */
export function withRun(flow: Flow, run: Run): Flow {
  const rest = flow.runs.filter((one) => one.id !== run.id);
  return { ...flow, runs: [run, ...rest].slice(0, KEPT_RUNS) };
}

/** How a run ended, for the foot band. Null while it is still going: there is
 *  nothing to say until something has stopped. */
export type Ending = {
  /** True where every block ended in `done`. Anything else — a failure, a stop
   *  — is not whole. */
  whole: boolean;
  /** Blocks that had a turn, whether or not it went well. */
  ran: number;
  turns: number;
  cost: Money | null;
  /** Blocks that never ran at all. */
  left: readonly Block[];
  /** The last block to say anything, and what it said. */
  last: { block: Block; said: string } | null;
};

export function endedAs(flow: Flow, run: Run): Ending | null {
  if (run.state === 'running' || run.state === 'needs-you') return null;
  const never = flow.blocks.filter((one) => notStarted(run, one));
  let turns = 0;
  let last: { block: Block; said: string } | null = null;
  for (const block of flow.blocks) {
    const done = run.blocks[block.id];
    if (done === undefined || done.said === null) continue;
    if (last === null || (done.endedAt ?? 0) >= (run.blocks[last.block.id]?.endedAt ?? 0)) {
      last = { block, said: done.said };
    }
  }
  for (const block of flow.blocks) turns += run.blocks[block.id]?.turns ?? 0;
  return {
    whole: flow.blocks.every((one) => run.blocks[one.id]?.state === 'done'),
    ran: flow.blocks.length - never.length,
    turns,
    cost: run.spent,
    left: never,
    last,
  };
}

/* -------------------------------------------------------------------------- */
/* Undo, and redo                                                              */
/* -------------------------------------------------------------------------- */

/** How many drawings back undo reaches. As many as a person might want to step
 *  back through, and no more than a session holds easily. */
export const KEPT_UNDOS = 50;

export type History = {
  /** Oldest first. */
  past: readonly Flow[];
  now: Flow;
  /** Nearest first. */
  future: readonly Flow[];
};

export function historyOf(flow: Flow): History {
  return { past: [], now: flow, future: [] };
}

/** Every drawing of one canvas, in order. A different canvas starts a ring of
 *  its own: undo never reaches from one canvas into another. */
export function undoable(history: History, flow: Flow): History {
  if (flow.id !== history.now.id) return historyOf(flow);
  if (flow === history.now) return history;
  return { past: [...history.past, history.now].slice(-KEPT_UNDOS), now: flow, future: [] };
}

export function undo(history: History): History {
  const back = history.past[history.past.length - 1];
  if (back === undefined) return history;
  return {
    past: history.past.slice(0, -1),
    now: back,
    future: [history.now, ...history.future].slice(0, KEPT_UNDOS),
  };
}

export function redo(history: History): History {
  const ahead = history.future[0];
  if (ahead === undefined) return history;
  return {
    past: [...history.past, history.now].slice(-KEPT_UNDOS),
    now: ahead,
    future: history.future.slice(1),
  };
}

/* -------------------------------------------------------------------------- */
/* Laying it out                                                               */
/* -------------------------------------------------------------------------- */

export type Placed = Block & { x: number; y: number; state: BlockState };
export type Drawn = { blocks: readonly Placed[]; width: number; height: number };

/** The card, and the room around it. Here rather than in the view because
 *  where a block goes when nobody has moved it is arithmetic, not drawing. */
export const CARD = { width: 232, height: 124, gapX: 88, gapY: 28 } as const;

/**
 * Where everything sits.
 *
 * A block somebody moved is where they put it. Everything else is laid out left
 * to right, one column per step along the chain, keeping its parent's row where
 * that row is free — so a flow drawn by pressing reads as a straight line, and
 * a flow arranged by hand stays arranged.
 */
export function tidy(flow: Flow): Readonly<Record<string, { x: number; y: number }>> {
  const at = columns(flow);
  const taken = new Map<number, Set<number>>();
  const rowOf = new Map<string, number>();
  const where: Record<string, { x: number; y: number }> = {};

  for (const block of runOrder(flow)) {
    const column = at.get(block.id) ?? 0;
    const used = taken.get(column) ?? new Set<number>();
    // Beside the first thing it waits for, or the top row when it waits for
    // nothing; then down until the column is free.
    let row = block.after.length === 0 ? 0 : Math.min(...block.after.map((one) => rowOf.get(one) ?? 0));
    while (used.has(row)) row += 1;
    used.add(row);
    taken.set(column, used);
    rowOf.set(block.id, row);
    where[block.id] = {
      x: column * (CARD.width + CARD.gapX),
      y: row * (CARD.height + CARD.gapY),
    };
  }
  return where;
}

export function layOut(flow: Flow): Drawn {
  if (flow.blocks.length === 0) return { blocks: [], width: 0, height: 0 };
  const auto = tidy(flow);
  const blocks: Placed[] = flow.blocks.map((one) => {
    const spot = one.at ?? auto[one.id] ?? { x: 0, y: 0 };
    return { ...one, x: spot.x, y: spot.y, state: stateOf(one, flow) };
  });
  return {
    blocks,
    width: Math.max(...blocks.map((one) => one.x)) + CARD.width,
    height: Math.max(...blocks.map((one) => one.y)) + CARD.height,
  };
}

/** True once somebody has moved something, so Tidy is worth offering. */
export function isArranged(flow: Flow): boolean {
  const where = tidy(flow);
  return flow.blocks.some((one) => {
    const auto = where[one.id];
    return one.at !== undefined && (auto === undefined || one.at.x !== auto.x || one.at.y !== auto.y);
  });
}

/**
 * What one line between two blocks is doing.
 *
 * Colour is progress and motion is only ever now: a line both ends of which
 * have finished has been through, and the line feeding whatever is being worked
 * on carries the wave. A board of grey lines said neither.
 */
export function lineState(parent: BlockState, block: BlockState): 'idle' | 'passed' | 'live' {
  if (parent !== 'done') return 'idle';
  if (block === 'running' || block === 'needs-you') return 'live';
  return block === 'done' ? 'passed' : 'idle';
}

/* -------------------------------------------------------------------------- */
/* Reading one back                                                            */
/* -------------------------------------------------------------------------- */

/**
 * What a file may call a block, and what it is here.
 *
 * The only names a card can be given: anything else is dropped rather than
 * drawn unnamed. Four one-sentence kinds became asks, and a wait became the
 * gate it always was.
 */
const KINDS: Readonly<Record<string, BlockKind>> = {
  ask: 'ask',
  plan: 'plan',
  checks: 'checks',
  review: 'review',
  gate: 'gate',
  'pull-request': 'pull-request',
  goal: 'goal',
  custom: 'ask',
  research: 'ask',
  subagents: 'ask',
  browser: 'ask',
  wait: 'gate',
};

/** Every level a model may be asked for. Anything else is the model's own. */
const THINKING: Readonly<Record<string, ThinkingLevel>> = {
  off: 'off',
  minimal: 'minimal',
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'xhigh',
  max: 'max',
};

/** Every state a run may be in, and every one a block may be in. A name the
 *  file made up is nothing rather than the nearest one, because a card or a
 *  foot band printed off one would be a lie somebody acts on. */
const RUN_STATES: Readonly<Record<string, RunState>> = {
  running: 'running',
  'needs-you': 'needs-you',
  done: 'done',
  failed: 'failed',
  stopped: 'stopped',
  interrupted: 'interrupted',
};

const BLOCK_STATES: Readonly<Record<string, BlockState>> = {
  draft: 'draft',
  waiting: 'waiting',
  running: 'running',
  'needs-you': 'needs-you',
  done: 'done',
  failed: 'failed',
  stopped: 'stopped',
};

/** Whatever the file held, as a list of ids. A string is a flow written when a
 *  block could only wait for one thing. */
function readAfter(value: unknown): readonly string[] {
  if (typeof value === 'string') return value === '' ? [] : [value];
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      (value as readonly unknown[]).filter(
        (one): one is string => typeof one === 'string' && one !== '',
      ),
    ),
  ];
}

/** Content ids in the attachment store. Whatever a flow written before that
 *  held was bytes, and bytes are not an id, so they are left behind. */
function readAttachments(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      (value as readonly unknown[]).filter(
        (one): one is string => typeof one === 'string' && one.trim() !== '',
      ),
    ),
  ];
}

function readAt(value: unknown): { x: number; y: number } | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  const x = raw['x'];
  const y = raw['y'];
  if (typeof x !== 'number' || !Number.isFinite(x)) return null;
  if (typeof y !== 'number' || !Number.isFinite(y)) return null;
  return { x, y };
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

function readThinking(value: unknown): ThinkingLevel | null {
  return typeof value === 'string' ? (THINKING[value] ?? null) : null;
}

function readMoney(value: unknown): Money | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  const minor = raw['minor'];
  const currency = raw['currency'];
  if (typeof minor !== 'number' || !Number.isFinite(minor)) return null;
  if (typeof currency !== 'string' || currency === '') return null;
  return { minor, currency };
}

function readLanes(value: unknown): readonly Lane[] {
  if (!Array.isArray(value)) return [];
  const lanes: Lane[] = [];
  for (const one of value as readonly unknown[]) {
    if (typeof one !== 'object' || one === null) continue;
    const raw = one as Record<string, unknown>;
    const id = raw['id'];
    const workspaceId = raw['workspaceId'];
    if (typeof id !== 'string' || id === '') continue;
    if (typeof workspaceId !== 'string' || workspaceId === '') continue;
    const conversationId = raw['conversationId'];
    const branch = raw['branch'];
    lanes.push({
      id,
      workspaceId,
      conversationId: typeof conversationId === 'string' && conversationId !== '' ? conversationId : null,
      branch: typeof branch === 'string' && branch !== '' ? branch : null,
    });
  }
  return lanes;
}

function readBlockRun(value: unknown): BlockRun | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  const lane = raw['lane'];
  const number = (one: unknown): number | null =>
    typeof one === 'number' && Number.isFinite(one) ? one : null;
  const text = (one: unknown): string | null => (typeof one === 'string' && one !== '' ? one : null);
  const state = raw['state'];
  return {
    state: (typeof state === 'string' ? BLOCK_STATES[state] : undefined) ?? 'draft',
    lane: typeof lane === 'string' && lane !== '' ? lane : LANE_0,
    startedAt: number(raw['startedAt']),
    endedAt: number(raw['endedAt']),
    said: typeof raw['said'] === 'string' ? raw['said'] : null,
    turns: Math.max(0, Math.floor(number(raw['turns']) ?? 0)),
    spent: readMoney(raw['spent']),
    rounds: Math.max(0, Math.floor(number(raw['rounds']) ?? 0)),
    result: text(raw['result']),
    failure: text(raw['failure']),
  };
}

/** Every run a flow held, newest first and never more than it keeps. A run
 *  whose block nobody has any more is dropped with the block. */
function readRuns(value: unknown, have: ReadonlySet<string>): readonly Run[] {
  if (!Array.isArray(value)) return [];
  const runs: Run[] = [];
  const seen = new Set<string>();
  for (const one of value as readonly unknown[]) {
    if (runs.length === KEPT_RUNS) break;
    if (typeof one !== 'object' || one === null) continue;
    const raw = one as Record<string, unknown>;
    const id = raw['id'];
    const startedAt = raw['startedAt'];
    const state = raw['state'];
    if (typeof id !== 'string' || id === '' || seen.has(id)) continue;
    if (typeof startedAt !== 'number' || !Number.isFinite(startedAt)) continue;
    const where = typeof state === 'string' ? RUN_STATES[state] : undefined;
    if (where === undefined) continue;
    seen.add(id);
    const blocks: Record<string, BlockRun> = {};
    const held = raw['blocks'];
    if (typeof held === 'object' && held !== null && !Array.isArray(held)) {
      for (const [key, block] of Object.entries(held as Record<string, unknown>)) {
        if (!have.has(key)) continue;
        const read = readBlockRun(block);
        if (read !== null) blocks[key] = read;
      }
    }
    const endedAt = raw['endedAt'];
    runs.push({
      id: asRunId(id),
      state: where,
      startedAt,
      endedAt: typeof endedAt === 'number' && Number.isFinite(endedAt) ? endedAt : null,
      lanes: readLanes(raw['lanes']),
      blocks,
      spent: readMoney(raw['spent']),
    });
  }
  return runs;
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
    if (typeof kind !== 'string') continue;
    const now = KINDS[kind];
    if (now === undefined) continue;
    seen.add(id);
    const spec = specOf(now);
    const said = block['says'];
    const retries = block['retries'];
    const attachments = readAttachments(block['attachments'] ?? block['pictures']);
    const at = readAt(block['at']);
    blocks.push({
      id,
      kind: now,
      name: typeof block['name'] === 'string' && block['name'].trim() !== '' ? block['name'] : spec.name,
      // An empty sentence is the kind's own words for everything that brought
      // some, and a block that was never said what about for the two that did
      // not.
      says: typeof said === 'string' && said.trim() !== '' ? said : spec.needsWords ? '' : spec.says,
      model: readModel(block['model']),
      thinking: readThinking(block['thinking']),
      after: readAfter(block['after']),
      lookFirst: block['lookFirst'] === true,
      attachments,
      retries:
        typeof retries === 'number' && Number.isFinite(retries) && retries >= 0
          ? Math.floor(retries)
          : retriesFor(now),
      ...(at === null ? {} : { at }),
    });
  }

  // A wait pointing at a block that did not survive the read would strand it,
  // and a ring of them would be a flow that draws but never starts. Both become
  // one wait fewer, which is a flow somebody can still run.
  const have = new Set(blocks.map((one) => one.id));
  const after = new Map(
    blocks.map((one) => [one.id, one.after.filter((was) => was !== one.id && have.has(was))]),
  );
  // Edges are added back one at a time and any that closes a ring is dropped,
  // so a shape that was nearly right stays nearly right rather than falling
  // apart into loose blocks.
  const kept = new Map(blocks.map((one) => [one.id, [] as string[]]));
  const reaches = (from: string, to: string): boolean => {
    const seen = new Set<string>();
    const todo = [from];
    while (todo.length > 0) {
      const one = todo.pop() as string;
      if (one === to) return true;
      if (seen.has(one)) continue;
      seen.add(one);
      todo.push(...(kept.get(one) ?? []));
    }
    return false;
  };
  for (const one of blocks) {
    for (const parent of after.get(one.id) ?? []) {
      if (reaches(parent, one.id)) continue;
      kept.get(one.id)?.push(parent);
    }
  }
  const standing: Block[] = blocks.map((one) => ({ ...one, after: kept.get(one.id) ?? [] }));
  const lanes = held['lanes'];
  const createdAt = held['createdAt'];
  return {
    id,
    name:
      typeof held['name'] === 'string' && held['name'].trim() !== ''
        ? (held['name'] as string)
        : canvasWords.untitled,
    blocks: standing,
    howFar: isHowFar(held['howFar']) ? held['howFar'] : 'doing',
    lanes: lanes === 'worktrees' ? 'worktrees' : 'in-turn',
    runs: readRuns(held['runs'], new Set(standing.map((one) => one.id))),
    // A flow written before flows were dated is not from 1970; it is undated.
    createdAt: typeof createdAt === 'number' && Number.isFinite(createdAt) ? createdAt : 0,
    updatedAt:
      typeof held['updatedAt'] === 'number' && Number.isFinite(held['updatedAt'])
        ? (held['updatedAt'] as number)
        : 0,
  };
}

/** What a flow may be set to. The Guard knows two more, and a person setting a
 *  whole flow once has never wanted them. */
const EVERY_RUNG: readonly HowFar[] = ['looking', 'asking', 'changing', 'doing'];

function isHowFar(value: unknown): value is HowFar {
  return typeof value === 'string' && (EVERY_RUNG as readonly string[]).includes(value);
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
