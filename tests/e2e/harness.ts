/** A whole Graphe turn, without Electron.
 *
 * The shell's continuation owner, the checklist the step tools move, the
 * waiting line beside the composer and the thread the window draws, wired to
 * each other the way `electron/main.ts` wires them and fed by a scripted model.
 * Nothing here is a second implementation: every decision is taken by the
 * module that takes it in the app, and this only holds the state those modules
 * are not allowed to hold.
 *
 * The list lives in memory rather than under `userData`, which is the one
 * substitution made. Everything it does to it comes from `work/buildplan.ts`.
 */

import { continuationOwner, type Continuation } from '../../electron/continuation-owner';
import type { AgentEvent, SettledHow, ToolCall } from '../../src/agent/types';
import { drainStarted, withoutOurs } from '../../src/lib/queue';
import {
  changeDesk,
  noDesks,
  openDesk,
  receive,
  type Desks,
} from '../../src/lib/projects';
import type { Turn } from '../../src/lib/thread';
import {
  addTasks,
  dropStep,
  failStep,
  insertStep,
  isFinished,
  needsWhich,
  nextOf,
  progress,
  replaceKeepingTicks,
  skipStep,
  startStep,
  tickStep,
  unfinished,
  type Moved,
  type Task,
} from '../../src/work/buildplan';
import type { Piece, Why } from '../../src/work/continuation';
import {
  createGoal,
  goalWords,
  listForGoal,
  verifyGoal,
  withElapsed,
  type Goal,
} from '../../src/work/goal';
import { fakeModel, type Scripted } from './fake-model';

/* The two sentences the shell answers a step tool with when there is nothing to
   move. Kept here in the words `electron/main.ts` uses them in. */
export const NO_LIST_TO_TICK =
  'There is no checklist on screen for this conversation, so there was nothing to move. Carry on.';
const WHAT_THE_MODEL_CALLED_IT = 'What this needs';

/** As many rounds as the loop is ever allowed to take before this gives up on
 *  it. Well past the app's own ceiling, so reaching it means a test hung. */
const MOST_ROUNDS_HERE = 60;

export type ListReport = {
  source: string;
  done: number;
  total: number;
  next: string | null;
  finished: boolean;
};

export type Report = {
  /** Messages sent on the person's behalf. */
  continuations: number;
  /** Every status the list moved to, in order, as `4 done`. */
  statuses: readonly string[];
  /** The ones nothing the model called was responsible for. Zero, or the app is
   *  ticking the list for the model again. */
  appWroteStatuses: number;
  /** The conversation as the window draws it. */
  turns: readonly Turn[];
  /** What the app said out loud, in its own words. */
  said: readonly string[];
  list: ListReport | null;
  tasks: readonly Task[];
  /** Replies played, the person's first one included. */
  rounds: number;
  /** What each round was asked with. */
  prompts: readonly string[];
  sends: readonly { why: Why; text: string }[];
  /** What the window was told about the loop, once per settle. */
  moves: readonly Continuation[];
  /** The waiting line beside the composer as it stands. */
  waiting: readonly string[];
  /** Every shape that line took while the run was going. */
  waitingSeen: readonly (readonly string[])[];
  busy: boolean;
  goal: Goal | null;
};

export type RunOpts = {
  /** What the person typed to start this off. */
  asked?: string;
  /** A message typed while round n was still running. */
  typed?: Readonly<Record<number, string>>;
  /** Add-ons asking for a turn of their own while round n was running. */
  asks?: Readonly<Record<number, readonly { from: string; text: string }[]>>;
};

export type HarnessOpts = {
  project?: string;
  address?: string;
  list?: readonly string[];
  goal?: string;
  asked?: string;
  /** The project's own checks, for a goal to be measured against. */
  checks?: () => { passed: boolean; reason: string } | null;
};

export type Harness = {
  run: (script: readonly Scripted[], opts?: RunOpts) => Promise<Report>;
  runIn: (address: string, script: readonly Scripted[], opts?: RunOpts) => Promise<Report>;
  /** Another conversation in the same project. */
  open: (address: string, opts?: { list?: readonly string[]; goal?: string }) => void;
  report: (address?: string) => Report;
  /** A piece finished on the board, told to the conversation that asked. */
  landed: (address: string, piece: Piece) => Promise<void>;
  /** A card answered with a click rather than with typing. */
  answered: (address?: string) => void;
  tasks: (address?: string) => readonly Task[];
  /** Take the checklist off the screen, as `cancel_build` does. */
  clear: (address?: string) => string;
  desks: () => Desks;
  project: string;
};

type Conversation = {
  address: string;
  plan: readonly Task[] | null;
  source: string;
  goal: Goal | null;
  statuses: string[];
  appStatuses: string[];
  continuations: number;
  said: string[];
  sends: { why: Why; text: string }[];
  moves: Continuation[];
  prompts: string[];
  rounds: number;
  busy: boolean;
  /** Everything behind the run, in the order it was queued. */
  line: string[];
  /** The app's own, out of that line. */
  ours: string[];
  waitingSeen: string[][];
  /** Runs the authority ended because an add-on asked past the budget. */
  halted: number;
};

function blankConversation(address: string): Conversation {
  return {
    address,
    plan: null,
    source: WHAT_THE_MODEL_CALLED_IT,
    goal: null,
    statuses: [],
    appStatuses: [],
    continuations: 0,
    said: [],
    sends: [],
    moves: [],
    prompts: [],
    rounds: 0,
    busy: false,
    line: [],
    ours: [],
    waitingSeen: [],
    halted: 0,
  };
}

export function harness(opts: HarnessOpts = {}): Harness {
  const project = opts.project ?? '/tmp/graphe-e2e';
  const front = opts.address ?? '';
  const held = new Map<string, Conversation>();

  let desks: Desks = openDesk(noDesks, { path: project, name: 'e2e' });
  desks = changeDesk(desks, project, (desk) => ({ ...desk, address: front, order: [front] }));

  function conv(address: string): Conversation {
    const found = held.get(address);
    if (found !== undefined) return found;
    const fresh = blankConversation(address);
    held.set(address, fresh);
    return fresh;
  }

  /* ---------------------------------------------------------------------- */
  /* The list                                                                */
  /* ---------------------------------------------------------------------- */

  function noteStatuses(
    one: Conversation,
    before: readonly Task[],
    after: readonly Task[],
    by: 'model' | 'app',
  ): void {
    const was = new Map(before.map((task) => [task.n, task.status]));
    for (const task of after) {
      const old = was.get(task.n);
      if (old === undefined || old === task.status) continue;
      one.statuses.push(`${String(task.n)} ${task.status}`);
      if (by === 'app') one.appStatuses.push(`${String(task.n)} ${task.status}`);
    }
  }

  function moveTheList(
    one: Conversation,
    move: (plan: readonly Task[]) => Moved,
    by: 'model' | 'app',
  ): string {
    if (one.plan === null) return NO_LIST_TO_TICK;
    const before = one.plan;
    const { plan, said } = move(before);
    if (plan === before) return said;
    noteStatuses(one, before, plan, by);
    one.plan = plan;
    return said;
  }

  /** Which step, when the model did not say. One still owed can only be that
   *  one; two or more and a bare call is a guess. */
  function whichStep(plan: readonly Task[], n: number | null): number | null {
    if (n !== null) return n;
    if (needsWhich(plan)) return null;
    return nextOf(plan)?.n ?? null;
  }

  function mustSayWhich(plan: readonly Task[]): string {
    const owed = unfinished(plan)
      .map((task) => `${String(task.n)}. ${task.title}`)
      .join(' · ');
    return `Say which step. Still open: ${owed}.`;
  }

  function layOut(
    one: Conversation,
    titles: readonly string[],
    mode: 'append' | 'replace',
    by: 'model' | 'app',
  ): string {
    const wanted = titles.map((title) => title.trim()).filter((title) => title !== '');
    if (wanted.length === 0) return 'A checklist needs at least one step.';
    const before = one.plan ?? [];
    const tasks =
      mode === 'replace' || before.length === 0
        ? replaceKeepingTicks(before, wanted)
        : addTasks(before, wanted);
    noteStatuses(one, before, tasks, by);
    one.plan = tasks;
    const first = nextOf(tasks);
    return `The checklist has ${String(tasks.length)} steps${
      first === null ? '' : `, starting with ${String(first.n)}. “${first.title}”`
    }. Tick each one off with step_done as it lands.`;
  }

  function listOf(one: Conversation): ListReport | null {
    if (one.plan === null) return null;
    const how = progress(one.plan);
    return {
      source: one.source,
      done: how.done,
      total: how.total,
      next: nextOf(one.plan)?.title ?? null,
      finished: isFinished(one.plan),
    };
  }

  /* ---------------------------------------------------------------------- */
  /* The tools the model actually has                                        */
  /* ---------------------------------------------------------------------- */

  function numberIn(input: Record<string, unknown>, key = 'n'): number | null {
    const asked = input[key];
    return typeof asked === 'number' && Number.isFinite(asked) ? Math.trunc(asked) : null;
  }

  function wordsIn(input: Record<string, unknown>, key: string): string {
    const said = input[key];
    return typeof said === 'string' ? said : '';
  }

  function stepMoved(
    one: Conversation,
    kind: 'done' | 'started' | 'failed' | 'skipped' | 'dropped' | 'inserted',
    input: Record<string, unknown>,
  ): string {
    return moveTheList(
      one,
      (plan) => {
        const n = whichStep(plan, numberIn(input, kind === 'inserted' ? 'after' : 'n'));
        if (n === null) return { plan, said: mustSayWhich(plan) };
        switch (kind) {
          case 'done':
            return tickStep(plan, n, wordsIn(input, 'note'));
          case 'started':
            return startStep(plan, n);
          case 'failed':
            return failStep(plan, n, wordsIn(input, 'why'));
          case 'skipped':
            return skipStep(plan, n, wordsIn(input, 'why'));
          case 'dropped':
            return dropStep(plan, n, wordsIn(input, 'why'));
          case 'inserted':
            return insertStep(plan, n, wordsIn(input, 'title'));
        }
      },
      'model',
    );
  }

  function cancel(one: Conversation): string {
    if (one.plan === null) return NO_LIST_TO_TICK;
    one.plan = null;
    return `The checklist “${one.source}” is cancelled and gone from the screen.`;
  }

  /** What a tool call answers with. Anything Graphe does not own runs and says
   *  so, which is all a scripted `bash` needs to be. */
  function toolAnswer(one: Conversation, call: ToolCall): string {
    switch (call.name) {
      case 'make_checklist': {
        const steps = call.input['steps'];
        const mode = call.input['mode'] === 'replace' ? 'replace' : 'append';
        return layOut(one, Array.isArray(steps) ? (steps as readonly string[]) : [], mode, 'model');
      }
      case 'step_done':
        return stepMoved(one, 'done', call.input);
      case 'step_started':
        return stepMoved(one, 'started', call.input);
      case 'step_failed':
        return stepMoved(one, 'failed', call.input);
      case 'step_skipped':
        return stepMoved(one, 'skipped', call.input);
      case 'drop_step':
        return stepMoved(one, 'dropped', call.input);
      case 'insert_step':
        return stepMoved(one, 'inserted', call.input);
      case 'cancel_build':
        return cancel(one);
      default:
        return `${call.name} ran.`;
    }
  }

  /* ---------------------------------------------------------------------- */
  /* The window's own reckoning                                              */
  /* ---------------------------------------------------------------------- */

  /** The line as the composer draws it: what is behind the run, without the
   *  app's own nudges in it. */
  function waitingLine(one: Conversation): readonly string[] {
    return withoutOurs(one.line, one.ours);
  }

  function watchTheLine(one: Conversation): void {
    const now = [...waitingLine(one)];
    const last = one.waitingSeen[one.waitingSeen.length - 1];
    if (last !== undefined && last.length === now.length && last.every((was, at) => was === now[at])) {
      return;
    }
    one.waitingSeen.push(now);
  }

  /** One event, folded into the desk it came from. Everything that only draws
   *  happens here; what reacts is in `feed`. */
  function fold(one: Conversation, event: AgentEvent): void {
    desks = receive(desks, {
      project,
      conversation: one.address === '' ? null : one.address,
      event,
    });
    if (event.type === 'busy') one.busy = event.on;
    if (event.type === 'message-started') {
      one.ours = [...drainStarted(one.ours, event.text)];
      one.line = [...drainStarted(one.line, event.text)];
    }
    watchTheLine(one);
  }

  /* ---------------------------------------------------------------------- */
  /* The one thing allowed to send a message nobody typed                    */
  /* ---------------------------------------------------------------------- */

  const owner = continuationOwner({
    send: (_project, address, text, why) => {
      const one = conv(address);
      one.continuations += 1;
      one.sends.push({ why, text });
      one.ours.push(text);
      one.line.push(text);
      fold(one, { type: 'queued', steering: [], followUp: [...one.line] });
    },
    say: (_project, address, text) => {
      if (text === '') return;
      const one = conv(address);
      one.said.push(text);
      fold(one, { type: 'message-delta', text: `\n\n${text}` });
      fold(one, { type: 'message-end' });
    },
    tell: (one) => {
      conv(one.address).moves.push(one);
    },
    list: (_project, address) => {
      const one = conv(address);
      const now = listOf(one);
      return Promise.resolve(
        now === null ? null : { done: now.done, total: now.total, next: now.next, finished: now.finished },
      );
    },
    goal: (_project, address) => {
      const one = conv(address);
      const goal = one.goal;
      if (goal === null || goal.status !== 'active') return Promise.resolve(null);
      /* Round 0 of a goal writes its own list. If the model could not, the app
         writes one of one step so the loop has something to check against. */
      if (one.plan === null || one.plan.length === 0) {
        layOut(one, listForGoal(goal.objective), 'replace', 'app');
        return Promise.resolve({
          met: false,
          reason: goalWords.noStepsEither,
          objective: goal.objective,
        });
      }
      const how = progress(one.plan);
      const plan = { done: how.done, total: how.total, next: nextOf(one.plan)?.title ?? null };
      const checks = how.done < how.total ? null : (opts.checks?.() ?? null);
      const verdict = verifyGoal(plan, checks, goal.objective);
      one.goal = verdict.met
        ? { ...withElapsed(goal), status: 'done' }
        : { ...withElapsed(goal), iterations: goal.iterations + 1 };
      return Promise.resolve({ ...verdict, objective: goal.objective });
    },
    halt: (_project, address) => {
      conv(address).halted += 1;
    },
  });

  /* ---------------------------------------------------------------------- */
  /* Playing a script                                                        */
  /* ---------------------------------------------------------------------- */

  /** One event, folded and then reacted to exactly where `main.ts` reacts. */
  async function feed(one: Conversation, event: AgentEvent): Promise<void> {
    fold(one, event);
    /* Anything on screen waiting on a person holds the loop back — a plan card
       included, because it is a card somebody is reading and about to answer.
       Cleared not by the settle (these cards outlive the turn that drew them)
       but by the person saying something, which is what answering one does. */
    if (
      event.type === 'needs-confirmation' ||
      event.type === 'asked-first' ||
      (event.type === 'planned' && event.steps.length > 0)
    ) {
      owner.waiting(project, one.address, true);
    }
    if (event.type !== 'settled') return;
    const how: SettledHow = event.how ?? 'finished';
    // Escape and the Stop beside the line both land on the shell before the
    // settle it caused arrives.
    if (how === 'stopped') owner.stopped(project, one.address);
    await owner.settled(project, one.address, how);
  }

  async function play(
    address: string,
    script: readonly Scripted[],
    runOpts: RunOpts = {},
  ): Promise<Report> {
    const one = conv(address);
    const model = fakeModel(script);
    let asked = runOpts.asked ?? opts.asked ?? 'Do these things.';

    // Each run is its own measurement. The list, the goal and the line are the
    // conversation's and carry over; what was counted about the last run is not.
    one.statuses = [];
    one.appStatuses = [];
    one.continuations = 0;
    one.said = [];
    one.sends = [];
    one.moves = [];
    one.prompts = [];
    one.rounds = 0;
    one.waitingSeen = [];

    owner.spoke(project, address);
    fold(one, { type: 'user-said', text: asked });

    for (let round = 0; round < MOST_ROUNDS_HERE; round += 1) {
      one.rounds += 1;
      one.prompts.push(asked);
      const typed = runOpts.typed?.[round];
      const asks = runOpts.asks?.[round] ?? [];

      /* What each call answered with. The model script says a step was called;
         what the list says back is the list's own, and it lands on the step's
         line the way a real tool result does. */
      const answers = new Map<string, string>();

      for (const raw of model.events(round)) {
        if (raw.type === 'tool-start') answers.set(raw.call.id, toolAnswer(one, raw.call));
        const event: AgentEvent =
          raw.type === 'tool-end' && answers.has(raw.id)
            ? { ...raw, detail: answers.get(raw.id) ?? '' }
            : raw;
        await feed(one, event);
        if (event.type === 'busy' && event.on) {
          fold(one, { type: 'message-started', text: asked });
          for (const ask of asks) owner.extensionAsked(project, address, ask.from, ask.text);
          if (typed !== undefined) {
            one.line.push(typed);
            fold(one, { type: 'user-said', text: typed });
            fold(one, { type: 'queued', steering: [], followUp: [...one.line] });
          }
        }
      }

      /* Whatever is behind the run goes next, in the order it was queued —
         the app's own nudge is a follow-up like anybody's, so a message typed
         while the run was going is answered before it. */
      const next = one.line[0];
      if (next === undefined) break;
      const theirs = !one.ours.includes(next);
      asked = next;
      if (theirs) owner.spoke(project, address);
    }

    return report(address);
  }

  function report(address: string = front): Report {
    const one = conv(address);
    const desk = desks.byPath[project];
    const turns =
      desk === undefined
        ? []
        : desk.address === address
          ? desk.turns
          : (desk.parked[address]?.turns ?? []);
    return {
      continuations: one.continuations,
      statuses: one.statuses,
      appWroteStatuses: one.appStatuses.length,
      turns,
      said: one.said,
      list: listOf(one),
      tasks: one.plan ?? [],
      rounds: one.rounds,
      prompts: one.prompts,
      sends: one.sends,
      moves: one.moves,
      waiting: waitingLine(one),
      waitingSeen: one.waitingSeen,
      busy: one.busy,
      goal: one.goal,
    };
  }

  function open(address: string, over: { list?: readonly string[]; goal?: string } = {}): void {
    const one = conv(address);
    if (over.list !== undefined) layOut(one, over.list, 'replace', 'app');
    if (over.goal !== undefined) one.goal = createGoal(over.goal);
    if (address === front) return;
    desks = changeDesk(desks, project, (desk) =>
      desk.parked[address] !== undefined
        ? desk
        : {
            ...desk,
            parked: { ...desk.parked, [address]: { turns: [], doing: null, counted: 0 } },
            order: [...desk.order, address],
          },
    );
    // The list a conversation opens with is the person's, not a status the app
    // wrote for the model: it is the starting point, so the count starts here.
    one.appStatuses.length = 0;
    one.statuses.length = 0;
  }

  open(front, {
    ...(opts.list === undefined ? {} : { list: opts.list }),
    ...(opts.goal === undefined ? {} : { goal: opts.goal }),
  });

  /** A piece finished on the board, said exactly the way the shell says it: to
   *  the conversation that asked for it, and settling one that is idle because
   *  no settle of its own is coming. */
  async function landed(address: string, piece: Piece): Promise<void> {
    const one = conv(address);
    one.continuations = 0;
    one.said = [];
    one.sends = [];
    one.moves = [];
    owner.landed(project, address, piece);
    if (one.busy) return;
    await owner.settled(project, address, 'finished');
  }

  /** A card answered with a click, which is what `CHANNEL.answer` does. */
  function answered(address: string = front): void {
    owner.waiting(project, address, false);
  }

  return {
    run: (script, runOpts) => play(front, script, runOpts),
    runIn: (address, script, runOpts) => play(address, script, runOpts),
    open,
    report,
    landed,
    answered,
    tasks: (address = front) => conv(address).plan ?? [],
    clear: (address = front) => cancel(conv(address)),
    desks: () => desks,
    project,
  };
}
