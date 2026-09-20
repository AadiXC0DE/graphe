/** Running a flow: the machine, and nothing else.
 *
 * A flow is drawn in the window and run in the shell, and what happens between
 * the two is decided here. Nothing in this file reaches for Pi, the disk, the
 * wire or a clock: every effect is a method on `RunnerPort`, and every reading
 * of time is `port.now()`. That is what makes the whole of it checkable against
 * a fake port, and it is why only the shell knows what a worktree is.
 *
 * One tick is one wave: every block whose waits have finished, each driven to the
 * end of its own kind — a turn, a turn and its checks, a verdict — and then the
 * run either goes on, holds at a gate, or fails. `drive` is the same thing in a
 * loop, for a shell that just wants the run finished.
 *
 * Two lanes run at once, because that is the point of worktree lanes: different
 * folders, so two turns in them cannot collide. Blocks inside one lane are
 * strictly one after another, so a lane never has two turns going.
 */

import type { HowFar } from '../../src/agent/guard/policy';
import type { Money } from '../../src/agent/types';
import type { ThinkingLevel } from '../../src/lib/ipc';
import { capsNow } from '../../src/work/capacity';
import {
  askOf,
  checksFix,
  laneFor,
  readyNow,
  type Block,
  type BlockModel,
  type BlockRun,
  type Flow,
  type Lane,
  type Run,
} from '../../src/work/canvas';

/* -------------------------------------------------------------------------- */
/* What the shell supplies                                                     */
/* -------------------------------------------------------------------------- */

/** What one turn is sent with. The shell sets the session up from these before
 *  it prompts, and puts the model back afterwards. */
export type TurnOptions = {
  model: BlockModel;
  thinking: ThinkingLevel | null;
  lookFirst: boolean;
  attachments: readonly string[];
  howFar: HowFar;
};

/** How one turn ended, in the terms the machine works in. `failure` is said to
 *  the person as it stands. */
export type Settled =
  | { ok: true; said: string; turns: number; spent: Money | null }
  | { ok: false; failure: string };

/** One turn as the machine counts it: what it said, how many turns it took, what
 *  it cost. */
type Turned = { said: string; turns: number; spent: Money | null };

/**
 * Everything the runner needs from the world, which is all of it.
 *
 * The shell fills this in from what it already has: a lane is a conversation —
 * the flow's own folder for `lane-0`, a worktree and then a conversation for
 * every other lane — checks are the project's own checks, review is what the
 * Review press calls, and a pull request is one turn plus reading the url back.
 * `openLane` fills in the lane it was handed and returns the same id.
 */
export type RunnerPort = {
  openLane(lane: Lane): Promise<Lane>;
  /** Re-acquire a previously opened lane's board slot for a later wave. */
  acquireLane?(lane: Lane): Promise<Lane>;
  /** Wait until a board slot may be tried again after a waiting wave. */
  waitForRoom?(): Promise<void>;
  /** Release this lane's board slot after its current wave is complete. The
   * workspace itself remains available for a later dependent block. */
  releaseLane?(lane: Lane): Promise<void>;
  send(lane: Lane, block: Block, text: string, options: TurnOptions): Promise<Settled>;
  checks(lane: Lane): Promise<{ passed: boolean; report: string }>;
  review(lane: Lane, options?: TurnOptions): Promise<{ verdict: 'ships' | 'needs-work' | 'do-not-land'; line: string; turns?: number; spent?: Money | null }>;
  pullRequest(lane: Lane, options?: TurnOptions): Promise<{ url: string; turns?: number; spent?: Money | null } | { failure: string; turns?: number; spent?: Money | null }>;
  stop(lane: Lane): Promise<void>;
  /** Release any whole-run workspace leases held by the shell adapter. */
  release?(): Promise<void>;
  /** Persist and push, once per change. */
  changed(run: Run): void;
  now(): number;
};

/* -------------------------------------------------------------------------- */
/* Words                                                                       */
/* -------------------------------------------------------------------------- */

/** The flow's own lane: the folder the flow was started from. Every other lane
 *  is a worktree, which is what the ceiling counts. */
export const LANE_0 = 'lane-0';

/** What a block that never started says once the run it belonged to failed. */
export const NEVER_RAN = 'never ran';

/** On the card of a block held back by the ceiling. It goes in `result`, the one
 *  field of a block run a card prints a line of its own out of. */
export const WAITING_FOR_ROOM = 'Waiting for room';

/** The sentences the machine has to write, because it is the one that decided.
 *  What a turn, a check and a verdict say comes from the port; a checks fix
 *  turn's words come from `checksFix` in the model. */
export const runnerWords = {
  reviewing: (line: string): string => `Fix what the review asked for: ${line}`,
  checksFailed: 'The checks did not pass.',
  noLane: (why: string): string => `That lane could not be opened: ${why}`,
} as const;

/* -------------------------------------------------------------------------- */
/* Small arithmetic                                                            */
/* -------------------------------------------------------------------------- */

/** Fix turns a block may still send. The panel writes `retries`, and a block
 *  read off disk has already been given its kind's own number by the model. A
 *  number that is not one — a hand-edited file — can send no fix turn at all. */
function roundsLeft(block: Block): number {
  return Number.isFinite(block.retries) && block.retries > 0 ? Math.floor(block.retries) : 0;
}

/** Two spends added up. Two currencies do not add, so the first is kept rather
 *  than a number that means nothing. */
function spentTogether(one: Money | null, other: Money | null): Money | null {
  if (one === null) return other;
  if (other === null) return one;
  if (one.currency !== other.currency) return one;
  return { minor: one.minor + other.minor, currency: one.currency };
}

/** Why a block that ran out of rounds failed: what the checks said, or the fact
 *  itself where they said nothing. */
function whyItStopped(report: string): string {
  return report.trim() === '' ? runnerWords.checksFailed : report.trim();
}

/** A copy of a run as a port may keep it: both maps are copied, so nothing the
 *  shell holds can move underneath a wave that is halfway through it. */
function snapshot(run: Run): Run {
  return { ...run, lanes: [...run.lanes], blocks: { ...run.blocks } };
}

/** Every block's state as one line. Two waves leaving this the same have moved
 *  nothing, which is how `drive` knows it is done. */
function stateLine(run: Run): string {
  return Object.entries(run.blocks)
    .map(([id, one]) => `${id}:${one.state}`)
    .join(',');
}

/* -------------------------------------------------------------------------- */
/* The machine                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The runs somebody has stopped, by id.
 *
 * Stop is pressed while a turn is out — that is the only moment it is worth
 * pressing — and the wave waiting on that turn still holds a copy of the run
 * that says `running`. Its own copy cannot tell it what happened, and `changed`
 * only carries news one way, so Stop leaves the run's id here and the wave asks
 * before writing anything. `continued` and `resumed` are what clear it, because
 * they are the two ways a run goes again.
 *
 * An id rather than the port, so a shell that builds its port per call is not
 * silently unable to stop anything, and two projects running at once cannot
 * mistake one for the other.
 */
const GIVEN_UP = 64;
const gaveUpOn = new Set<string>();

/** Remember that this run is over, so a wave still holding a copy of it writes
 *  nothing more. Bounded, because runs are made for the life of the app. */
function noteGivenUp(run: Run): void {
  gaveUpOn.delete(run.id);
  gaveUpOn.add(run.id);
  while (gaveUpOn.size > GIVEN_UP) {
    const oldest = gaveUpOn.values().next().value;
    if (oldest === undefined) break;
    gaveUpOn.delete(oldest);
  }
}

function abandoned(m: Machine): boolean {
  return m.halted || gaveUpOn.has(m.run.id);
}

type Machine = {
  flow: Flow;
  run: Run;
  port: RunnerPort;
  /** Set by the first failure: the rest of the run is over. */
  halted: boolean;
  /** The gate the run is holding at, if it is holding at one. */
  gate: string | null;
};

function put(m: Machine, block: Block, lane: string, over: Partial<BlockRun>): void {
  const held = m.run.blocks[block.id];
  const was: BlockRun =
    held ?? {
      state: 'draft',
      lane,
      startedAt: null,
      endedAt: null,
      said: null,
      turns: 0,
      spent: null,
      rounds: 0,
      result: null,
      failure: null,
    };
  // The lane is written every time rather than only on the first write: a block
  // told which lane it runs in by the picture is what a card and the Review queue
  // both read, and a run read back off disk may hold the wrong one.
  m.run.blocks = { ...m.run.blocks, [block.id]: { ...was, ...over, lane } };
}

function succeed(m: Machine, block: Block, lane: string, over: Partial<BlockRun>): void {
  put(m, block, lane, { state: 'done', endedAt: m.port.now(), failure: null, ...over });
  m.port.changed(snapshot(m.run));
}

function broke(m: Machine, block: Block, lane: string, why: string, over: Partial<BlockRun> = {}): void {
  put(m, block, lane, { state: 'failed', endedAt: m.port.now(), failure: why, ...over });
  m.port.changed(snapshot(m.run));
}

/** A failure ends the run: the lanes still mid-turn are told to stop, and `ends`
 *  says below what became of everything else. */
async function endIt(m: Machine): Promise<void> {
  if (m.halted) return;
  m.halted = true;
  const going = m.run.lanes.filter((lane) =>
    Object.values(m.run.blocks).some((one) => one.lane === lane.id && one.state === 'running'),
  );
  for (const lane of going) {
    try {
      await m.port.stop(lane);
    } catch {
      // The run is already failing; a cleanup refusal must not leave its state
      // as an unhandled rejected promise.
    }
  }
}

/** The lane, opened if it has no conversation yet. A lane that already has one is
 *  the whole of what a resume needs: nothing is made a second time, and the
 *  worktree behind it is the one the run was already working in. */
async function opened(m: Machine, id: string): Promise<Lane> {
  const known = m.run.lanes.find((one) => one.id === id);
  if (known !== undefined && known.conversationId !== null) {
    const lane = (await m.port.acquireLane?.(known)) ?? known;
    if (lane !== known) {
      m.run = { ...m.run, lanes: [...m.run.lanes.filter((one) => one.id !== lane.id), lane] };
      m.port.changed(snapshot(m.run));
    }
    return lane;
  }
  const lane = await m.port.openLane(
    known ?? { id, workspaceId: '', conversationId: null, branch: null },
  );
  m.run = { ...m.run, lanes: [...m.run.lanes.filter((one) => one.id !== lane.id), lane] };
  m.port.changed(snapshot(m.run));
  return lane;
}

/** One turn, and what it came to. Null once the run has been abandoned
 *  underneath it: a stop is not a failure to report against the block. */
async function tookTurn(
  m: Machine,
  block: Block,
  lane: Lane,
  text: string,
  options: TurnOptions,
): Promise<Turned | null> {
  const settled = await m.port.send(lane, block, text, options);
  if (abandoned(m)) return null;
  if (!settled.ok) {
    broke(m, block, lane.id, settled.failure, { state: 'failed' });
    return null;
  }
  m.run.spent = spentTogether(m.run.spent, settled.spent);
  return { said: settled.said, turns: settled.turns, spent: settled.spent };
}

async function askOnce(m: Machine, block: Block, lane: Lane, options: TurnOptions): Promise<void> {
  const settled = await tookTurn(m, block, lane, askOf(m.flow, m.run, block), options);
  if (settled === null) return;
  succeed(m, block, lane.id, settled);
}

/** A turn, then the checks, then another turn carrying what failed — until the
 *  checks pass or the rounds the block was given run out. */
async function goal(m: Machine, block: Block, lane: Lane, options: TurnOptions): Promise<void> {
  let rounds = 0;
  let turns = 0;
  let spent: Money | null = null;
  // Every round sends a turn first, so this is never read before it is set.
  let said: string | null;
  let text = askOf(m.flow, m.run, block);
  for (;;) {
    const settled = await tookTurn(m, block, lane, text, options);
    if (settled === null) return;
    turns += settled.turns;
    spent = spentTogether(spent, settled.spent);
    said = settled.said;
    const ran = await m.port.checks(lane);
    if (abandoned(m)) return;
    if (ran.passed) return succeed(m, block, lane.id, { said, turns, spent, rounds });
    if (rounds >= roundsLeft(block)) {
      return broke(m, block, lane.id, whyItStopped(ran.report), { said, turns, spent, rounds });
    }
    rounds += 1;
    put(m, block, lane.id, { turns, spent, rounds });
    m.port.changed(snapshot(m.run));
    text = checksFix(ran.report);
  }
}

/** The project's own checks, and a fix turn for each failure — until they pass or
 *  the rounds run out. Nothing is sent at all when they pass first time. */
async function checks(m: Machine, block: Block, lane: Lane, options: TurnOptions): Promise<void> {
  let rounds = 0;
  let turns = 0;
  let spent: Money | null = null;
  let said: string | null = null;
  for (;;) {
    const ran = await m.port.checks(lane);
    if (abandoned(m)) return;
    if (ran.passed) return succeed(m, block, lane.id, { said, turns, spent, rounds });
    if (rounds >= roundsLeft(block)) {
      return broke(m, block, lane.id, whyItStopped(ran.report), { said, turns, spent, rounds });
    }
    rounds += 1;
    const settled = await tookTurn(m, block, lane, checksFix(ran.report), options);
    if (settled === null) return;
    turns += settled.turns;
    spent = spentTogether(spent, settled.spent);
    said = settled.said;
    put(m, block, lane.id, { turns, spent, rounds });
    m.port.changed(snapshot(m.run));
  }
}

/** A verdict. `ships` is done; `needs-work` with a round to spend gets one fix
 *  turn and one more verdict; `needs-work` with none, and `do-not-land`, are
 *  failures. */
async function review(m: Machine, block: Block, lane: Lane, options: TurnOptions): Promise<void> {
  const first = await m.port.review(lane, options);
  if (abandoned(m)) return;
  // The initial verdict is a model turn too, including a review that ships or
  // is rejected without a repair round.
  m.run.spent = spentTogether(m.run.spent, first.spent ?? null);
  if (first.verdict === 'ships') {
    return succeed(m, block, lane.id, { result: first.line, said: first.line, turns: first.turns ?? 0, spent: first.spent ?? null });
  }
  if (first.verdict === 'do-not-land' || roundsLeft(block) <= 0) {
    return broke(m, block, lane.id, first.line, { result: first.line, said: first.line, turns: first.turns ?? 0, spent: first.spent ?? null });
  }
  const settled = await tookTurn(m, block, lane, runnerWords.reviewing(first.line), options);
  if (settled === null) return;
  put(m, block, lane.id, { turns: settled.turns, spent: settled.spent, rounds: 1 });
  m.port.changed(snapshot(m.run));
  const again = await m.port.review(lane, options);
  if (abandoned(m)) return;
  const over: Partial<BlockRun> = {
    result: again.line,
    said: again.line,
    turns: (first.turns ?? 0) + settled.turns + (again.turns ?? 0),
    spent: spentTogether(spentTogether(first.spent ?? null, settled.spent), again.spent ?? null),
    rounds: 1,
  };
  if (again.verdict === 'ships') return succeed(m, block, lane.id, over);
  return broke(m, block, lane.id, again.line, over);
}

async function pull(m: Machine, block: Block, lane: Lane): Promise<void> {
  const asked = await m.port.pullRequest(lane, {
    model: block.model ?? m.flow.model ?? null,
    thinking: block.thinking ?? m.flow.thinking ?? null,
    lookFirst: false,
    attachments: block.attachments,
    howFar: m.flow.howFar,
  });
  if (abandoned(m)) return;
  m.run.spent = spentTogether(m.run.spent, asked.spent ?? null);
  if ('url' in asked) return succeed(m, block, lane.id, {
    result: asked.url,
    said: asked.url,
    turns: asked.turns ?? 0,
    spent: asked.spent ?? null,
  });
  return broke(m, block, lane.id, asked.failure, {
    turns: asked.turns ?? 0,
    spent: asked.spent ?? null,
  });
}

/** One block, run to the end of its kind. What it comes to is written as it goes,
 *  so a card is never further behind than the turn is. */
async function oneBlock(m: Machine, block: Block, lane: Lane): Promise<void> {
  const options: TurnOptions = {
    model: block.model ?? m.flow.model ?? null,
    thinking: block.thinking ?? m.flow.thinking ?? null,
    // A plan block is the one that must not touch anything, whatever the panel
    // was left on.
    lookFirst: block.kind === 'plan' || block.lookFirst,
    attachments: block.attachments,
    howFar: m.flow.howFar,
  };
  switch (block.kind) {
    case 'gate':
      put(m, block, lane.id, { state: 'needs-you' });
      m.port.changed(snapshot(m.run));
      m.gate = block.id;
      return;
    case 'ask':
    case 'plan':
      return askOnce(m, block, lane, options);
    case 'goal':
      return goal(m, block, lane, options);
    case 'checks':
      return checks(m, block, lane, options);
    case 'review':
      return review(m, block, lane, options);
    case 'pull-request':
      return pull(m, block, lane);
  }
}

/** Every block of one lane, one at a time: two turns in one folder would take the
 *  same workspace twice. */
async function oneLane(m: Machine, id: string, blocks: readonly Block[]): Promise<void> {
  let openedLane: Lane | null = null;
  try {
    for (const block of blocks) {
      if (abandoned(m) || m.gate !== null) return;
      put(m, block, id, { state: 'running', startedAt: m.port.now(), result: null, failure: null });
      m.port.changed(snapshot(m.run));
      let lane: Lane;
      try {
        lane = await opened(m, id);
        openedLane = lane;
      } catch (cause) {
        if (abandoned(m)) return;
        broke(m, block, id, runnerWords.noLane(cause instanceof Error ? cause.message : String(cause)));
        await endIt(m);
        return;
      }
      if (abandoned(m)) return;
      try {
        await oneBlock(m, block, lane);
      } catch (cause) {
        if (abandoned(m)) return;
        broke(m, block, id, cause instanceof Error ? cause.message : String(cause));
        await endIt(m);
        return;
      }
      if (abandoned(m) || m.gate !== null) return;
      if (m.run.blocks[block.id]?.state === 'failed') {
        await endIt(m);
        return;
      }
    }
  } finally {
    // A gate, cancellation, lane-open failure, or ordinary completion all
    // release the machine slot. The persisted lane remains for later waves;
    // acquireLane re-admits it when another block needs it.
    if (openedLane !== null) await m.port.releaseLane?.(openedLane);
  }
}

/** What became of everything once a wave is over: the run failed, is holding at a
 *  gate, or has nothing left to do. */
function ends(m: Machine): void {
  if (m.halted) {
    for (const block of m.flow.blocks) {
      const held = m.run.blocks[block.id];
      if (held?.state === 'done' || held?.state === 'failed') continue;
      // A block caught mid-turn stopped where it stood, and keeps whatever the
      // turn had to say; one that never began never ran, which is the failure.
      const wasGoing = held?.state === 'running' || held?.state === 'needs-you';
      put(m, block, held?.lane ?? laneFor(m.flow, block), {
        state: 'stopped',
        endedAt: m.port.now(),
        failure: wasGoing ? held.failure : NEVER_RAN,
      });
    }
    m.run = { ...m.run, state: 'failed', endedAt: m.port.now() };
    m.port.changed(snapshot(m.run));
    return;
  }
  if (m.gate !== null) {
    m.run = { ...m.run, state: 'needs-you' };
    m.port.changed(snapshot(m.run));
    return;
  }
  // Something is still not done, so the run is going and the wave after this one
  // is what moves it on.
  if (m.flow.blocks.length === 0) return;
  if (!m.flow.blocks.every((one) => m.run.blocks[one.id]?.state === 'done')) return;
  m.run = { ...m.run, state: 'done', endedAt: m.port.now() };
  m.port.changed(snapshot(m.run));
}

/**
 * One wave.
 *
 * Which lanes may open is decided before anything starts, in the order the blocks
 * come: a worktree lane takes a place against the ceiling shared with the board,
 * and a lane past it waits rather than racing for the last place two at a time.
 */
export async function tick(
  flow: Flow,
  run: Run,
  port: RunnerPort,
  room: number = capsNow().board,
): Promise<Run> {
  if (run.state !== 'running') return run;
  const m: Machine = { flow, run: snapshot(run), port, halted: false, gate: null };

  const waiting: Block[] = [];
  const starting: { id: string; blocks: Block[] }[] = [];
  // `run.lanes` is historical: completed lanes remain there for fan-in and
  // review. Only lanes with a live block in this wave consume board slots;
  // completed lanes release their slot through RunnerPort.releaseLane.
  const occupied = new Set(
    Object.values(m.run.blocks)
      .filter((one) => one.state === 'running' || one.state === 'needs-you')
      .map((one) => one.lane),
  );
  let spare = Math.max(0, room - [...occupied].filter((one) => one !== LANE_0).length);

  for (const block of readyNow(flow, m.run)) {
    const id = laneFor(flow, block);
    const held = starting.find((one) => one.id === id);
    if (held !== undefined) {
      held.blocks.push(block);
      continue;
    }
    if (!occupied.has(id) && id !== LANE_0) {
      if (spare <= 0) {
        waiting.push(block);
        continue;
      }
      spare -= 1;
    }
    starting.push({ id, blocks: [block] });
  }

  for (const block of waiting) {
    const held = m.run.blocks[block.id];
    if (held?.state === 'waiting' && held.result === WAITING_FOR_ROOM) continue;
    put(m, block, laneFor(flow, block), { state: 'waiting', result: WAITING_FOR_ROOM });
    m.port.changed(snapshot(m.run));
  }

  if (starting.length > 0) {
    m.port.changed(snapshot(m.run));
    await Promise.all(starting.map((one) => oneLane(m, one.id, one.blocks)));
    // A wave that comes back to find its run was stopped underneath it says so
    // rather than reporting its half-finished turn as the state of things. What
    // Stop already pushed is what this is, so nothing is pushed again.
    if (gaveUpOn.has(m.run.id)) return givenUpAs(flow, m.run, port.now());
  }
  // Asked of the run rather than of the wave: a run every block of which has
  // finished is over, however it came to be that way.
  ends(m);
  return snapshot(m.run);
}

/** Everything mid-turn, marked stopped where it stood.
 *
 * A gate somebody was looking at is stopped too: the run it belonged to is over,
 * and a gate that outlived it would open into nothing. What has finished stays
 * finished — stopping is to keep the work, not to lose the report of it. */
function givenUpAs(flow: Flow, run: Run, at: number): Run {
  const blocks: Record<string, BlockRun> = { ...run.blocks };
  for (const block of flow.blocks) {
    const held = blocks[block.id];
    if (held?.state !== 'running' && held?.state !== 'needs-you') continue;
    blocks[block.id] = { ...held, state: 'stopped', endedAt: at };
  }
  return { ...snapshot(run), state: 'stopped', endedAt: at, blocks };
}

/** A run that cannot get further without room: it is going, nothing of it is
 *  running, and a block is waiting for a lane of its own. The shell ticks it
 *  again when something else lets a lane go. */
export function waitingForRoom(run: Run): boolean {
  if (run.state !== 'running') return false;
  const all = Object.values(run.blocks);
  if (all.some((one) => one.state === 'running')) return false;
  return all.some((one) => one.state === 'waiting' && one.result === WAITING_FOR_ROOM);
}

/**
 * Waves until there is nothing left to do.
 *
 * Stops where the run is no longer going, where the ceiling is what is holding
 * it, and where a wave moved nothing — another turn of the loop would do the
 * same thing again.
 */
export async function drive(
  flow: Flow,
  run: Run,
  port: RunnerPort,
  room: number = capsNow().board,
): Promise<Run> {
  let held = await tick(flow, run, port, room);
  for (;;) {
    if (held.state !== 'running') return held;
    if (waitingForRoom(held)) {
      if (port.waitForRoom === undefined) return held;
      await port.waitForRoom();
      held = await tick(flow, held, port, room);
      continue;
    }
    const next = await tick(flow, held, port, room);
    if (next.state !== 'running') return next;
    if (stateLine(next) === stateLine(held)) return next;
    held = next;
  }
}

/**
 * Stop, from the press in the bar.
 *
 * Every lane mid-turn is told to stop, and the mark is left before anything is
 * written: a wave waiting on one of those turns may come back at any moment, and
 * it has to find the stop rather than overwrite it.
 */
export async function stopped(flow: Flow, run: Run, port: RunnerPort): Promise<Run> {
  if (run.state !== 'running' && run.state !== 'needs-you') return run;
  noteGivenUp(run);
  for (const lane of run.lanes) {
    const going = Object.values(run.blocks).some(
      (one) => one.lane === lane.id && one.state === 'running',
    );
    if (going) {
      try {
        await port.stop(lane);
      } catch {
        // Stopping is best effort; the persisted run still becomes stopped.
      }
    }
  }
  const over = givenUpAs(flow, run, port.now());
  port.changed(over);
  return over;
}

/**
 * Carry on through a gate.
 *
 * The gate is done, the run is going again, and the blocks waiting behind it are
 * the next wave. A run holding anywhere else, or at another block, is left
 * exactly as it was.
 */
export function continued(flow: Flow, run: Run, port: RunnerPort, block: string): Run {
  if (run.state !== 'needs-you') return run;
  const gate = flow.blocks.find((one) => one.id === block && one.kind === 'gate');
  if (gate === undefined) return run;
  const held = run.blocks[gate.id];
  if (held === undefined || held.state !== 'needs-you') return run;
  const over: Run = {
    ...snapshot(run),
    state: 'running',
    blocks: { ...run.blocks, [gate.id]: { ...held, state: 'done', endedAt: port.now() } },
  };
  // The two ways a run goes again — this and a resume — are the two that clear
  // the stop. A shell holding the run as it was before the press would otherwise
  // hand back a stopped run the next wave would refuse to move.
  gaveUpOn.delete(run.id);
  port.changed(over);
  return over;
}

/**
 * Take up a run the app did not finish.
 *
 * The lanes are kept, so every conversation — and every worktree branch — is the
 * one the run was already working in. Everything that did not finish is run again
 * from its beginning, which is the only honest thing to do with a turn nobody is
 * waiting on any more. The flow is not needed for any of it: what a block is
 * asked is read from the flow when its turn comes.
 */
export function resumed(run: Run, port: RunnerPort): Run {
  if (run.state !== 'interrupted' && run.state !== 'stopped') return run;
  const blocks: Record<string, BlockRun> = {};
  for (const [id, one] of Object.entries(run.blocks)) {
    if (one.state === 'done') blocks[id] = one;
  }
  const over: Run = { ...snapshot(run), state: 'running', blocks, endedAt: null };
  gaveUpOn.delete(run.id);
  port.changed(over);
  return over;
}
