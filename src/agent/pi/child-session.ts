/** One conversation's agent, hosted in a child process.
 *
 * Phase 6.2's shape: the same `GrapheSession` the in-process path returns, with
 * Pi and the extensions somebody trusted in a process of their own. What moves
 * is *where the agent is*, and deliberately nothing else — the Guard, the
 * window, the restore points and the transcript stay here, because every one of
 * them needs a fact only this process has.
 *
 * ## What crosses
 *
 * Two things and no more:
 *
 *  - **Pi's own RPC protocol.** Commands out; responses, agent events and
 *    extension UI requests in. `runtime.onEvent` feeds the same `relay.fromPi`
 *    the in-process path uses, so the window draws the same conversation
 *    whichever process is doing the work.
 *  - **A verdict.** The child asks whether a call may run and waits for the
 *    answer. It is told yes or no and the sentence the model reads — never why,
 *    never who was asked, never what was on the card.
 *
 * ## What is honestly missing
 *
 * `moments`, `mark`, `forkAfter` and `tryAnotherDirection` have **no RPC
 * command at all**: Pi's `navigateTree`, label changes and branch copying live
 * on `AgentSession` in-process and are not in `rpc-mode.js`'s switch. Each
 * returns its documented empty answer rather than inventing one, and a caller
 * that needs one needs the in-process path. `takeBackQueue` is the same shape
 * of problem from the other side: `clear_queue` is a command whose answer
 * arrives on a wire, and the member is synchronous, so it refuses honestly
 * rather than reporting an empty queue it has not read yet.
 */

import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

import { createSession, guardFor, readTranscript } from './adapter';
import type {
  Carried,
  CreateSessionOptions,
  Decision,
  GrapheSession,
  Guarded,
  Moment,
  Room,
  TakenBack,
} from './adapter';
import type { Answers } from '../asking';
import type { HowFar } from '../guard/policy';
import type { RunningPiece } from '../running';
import type { Overrun } from './hook-budget';
import { idFor } from '../../projects/carried';
import { extensionPathsIn } from './extension-probe';
import type { AddonCommand } from './commands';
import type { ExtensionReport } from './extension-states';
import type { SessionKind } from './extension-policy';
import type { GuardFacts } from '../guard/policy';
import { childRuntimes, startRuntime } from '../../../electron/services/runtime-supervisor';
import type { ChildExit, ChildRuntime } from '../../../electron/services/runtime-supervisor';
import type { ThinkingLevel } from '../../lib/ipc';
import type { AgentEvent, ImageCard } from '../types';

/* -------------------------------------------------------------------------- */
/* Which half hosts the agent                                                  */
/* -------------------------------------------------------------------------- */

/** Read by a test, and by a person debugging a copy of the app that has gone
 *  strange. Named rather than inferred so it can be turned on for one run. */
export const CHILD_RUNTIME_ENV = 'GRAPHE_CHILD_RUNTIME';

/** What a profile asks for. */
export type RuntimeChoice = 'child' | 'in-process';

/** Where a conversation's agent runs, from the environment first and the
 *  profile second.
 *
 *  The environment wins because it is the one a test can set without a profile.
 *  A value that is neither yes nor no is not a decision, so the setting under it
 *  stands: a shell that set the variable to something meaningless has not asked
 *  for anything. */
export function runtimeChoice(setting?: RuntimeChoice): RuntimeChoice {
  switch ((process.env[CHILD_RUNTIME_ENV] ?? '').trim().toLowerCase()) {
    case '1':
    case 'true':
      return 'child';
    case '0':
    case 'false':
      return 'in-process';
    default:
      return setting ?? 'in-process';
  }
}

/**
 * One conversation's agent, hosted wherever this run asks for it.
 *
 * The one helper every caller goes through, so a copy that has not asked for
 * the child behaves exactly as it always has. A helper and a board piece never
 * take the child: both are built for one turn by a process that is already
 * another conversation's, and a third process per helper is not what 6.2 is
 * for.
 *
 * A child that will not start is not a conversation that will not open. The
 * in-process path is right here and is what every other copy of the app is
 * using, so a failed start says so on the stream and the turn runs here
 * instead. That is temporary and on purpose: 6.2's own rule is that the child
 * does not become the default until it has the same evidence, and a fallback is
 * what keeps the rule honest while it does not.
 */
export async function openSession(options: CreateSessionOptions): Promise<GrapheSession> {
  if (runtimeChoice(options.runtime) === 'in-process' || shallow(options.sessionKind)) {
    return createSession(options);
  }
  /* The Guard is built first and in this process, which is the whole point: a
     call the child holds is judged against the same facts as any other, and
     `judge` is the only part of it that crosses. */
  const guard = await guardFor(options, { deliver: options.onEvent });
  try {
    return await childSession(options, guard);
  } catch (cause) {
    // Nothing about the Guard was touched, so it is handed on rather than
    // rebuilt: a second one would read this project's rules file twice.
    options.onEvent({
      type: 'notice',
      what: `A conversation could not be given a process of its own, so it is running in this one as usual: ${cause instanceof Error ? cause.message : String(cause)}`,
    });
    return createSession(options);
  }
}

/** Whether this kind of session is one the child path is not offered to. */
function shallow(kind: SessionKind | undefined): boolean {
  return kind !== undefined && kind !== 'conversation';
}

/* -------------------------------------------------------------------------- */
/* Pi's own arguments                                                          */
/* -------------------------------------------------------------------------- */

/**
 * What Pi is told, as its own command line would be told it.
 *
 * Nothing here is interpreted by this side: the model, the session and the
 * extension paths are Pi's own vocabulary and travel as arguments because that
 * is the interface the installed package documents. Every name below is in
 * `docs/rpc.md` §Starting RPC Mode or `docs/usage.md`'s options table.
 */
export async function argsFor(options: CreateSessionOptions, agentDir: string): Promise<string[]> {
  /* Discovery is off and this list is the whole of what loads. A project's own
     add-ons are code that came with a folder, so they are handed over by name,
     and only the ones somebody said yes to — the same filter the in-process
     loader applies, keyed by a fingerprint of the source so a yes stops
     covering it the moment it is edited. */
  const args = ['--no-extensions', ...sessionArgs(options)];
  for (const where of await trustedExtensions(options, agentDir)) args.push('-e', where);
  /* The project's own prompt text and skills: attacker-controllable, and it
     reaches the system prompt, so Pi is told only what the person already
     answered. Non-interactive modes never prompt, which is why this decision
     has to be made here — and it is `trustProject`'s, the same callback the
     in-process loader answers, so the two paths agree about one folder. */
  args.push((options.trustProject ?? (() => false))() ? '--approve' : '--no-approve');
  const model = options.model;
  if (model !== null && model !== undefined) {
    args.push('--model', `${model.providerId}/${model.modelId}`);
  }
  if (options.thinking !== undefined) args.push('--thinking', options.thinking);
  return args;
}

/** Where this conversation lives, in Pi's own words. */
function sessionArgs(options: CreateSessionOptions): string[] {
  if (options.forkFrom !== undefined) return ['--fork', options.forkFrom];
  if (options.sessionPath !== undefined) return ['--session', options.sessionPath];
  if (options.sessionDir === undefined) {
    // Nowhere to write: the same in-memory conversation the in-process path
    // gets when neither a path nor a folder was given.
    return ['--no-session'];
  }
  const into = ['--session-dir', options.sessionDir];
  // `continueRecent` unless a new conversation was asked for, which is B1.1:
  // reopening a project is a conversation continued, not one started again.
  return options.fresh === true ? into : [...into, '--continue'];
}

/**
 * The add-ons somebody said yes to, by the file Pi would load.
 *
 * Read from source rather than remembered from a card: the id is a fingerprint
 * of the code, and a yes that outlived the code it was given for would be a yes
 * about something else.
 */
async function trustedExtensions(
  options: CreateSessionOptions,
  agentDir: string,
): Promise<readonly string[]> {
  const found = await extensionPathsIn(agentDir, options.projectRoot);
  const trusts = options.trusts ?? (() => false);
  const root = options.projectRoot.endsWith('/') ? options.projectRoot : `${options.projectRoot}/`;
  const kept: string[] = [];
  for (const where of found) {
    // Installed beside the agent folder rather than carried by the project: an
    // add-on somebody chose by hand is already trusted, exactly as in-process.
    if (!where.startsWith(root)) {
      kept.push(where);
      continue;
    }
    const source = await readFile(where, 'utf8').catch(() => null);
    if (source === null) continue;
    const name = basename(where).replace(/\.[^.]+$/, '');
    if (trusts(idFor(name, source))) kept.push(where);
  }
  return kept;
}

/* -------------------------------------------------------------------------- */
/* The session                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * One conversation, hosted in a child, speaking the same `GrapheSession` as
 * everything else.
 *
 * The Guard arrives already built, in this process, so a call the child holds
 * is judged against the same facts as any other — and so `judge` is handed over
 * as the whole of what the child is allowed to ask. Everything the Guard says
 * goes into the same stream the in-process path uses.
 */
/** How a conversation's child is started, so the same arguments bring one back
 *  after an idle one was given back. */
type ChildMaking = () => Promise<ChildRuntime>;

export async function childSession(
  options: CreateSessionOptions,
  guard: Guarded,
): Promise<GrapheSession> {
  const agentDir = guard.agentDir;
  const args = await argsFor({ ...options, agentDir }, agentDir);
  const startChild = async (): Promise<ChildRuntime> => {
    // Room for one more child is made before it is started, so a machine at its
    // ceiling takes somebody's quiet conversation rather than refusing this one.
    await childRuntimes.makeRoom();
    return startRuntime({
      cwd: options.projectRoot,
      agentDir,
      args,
      judge: guard.judge,
      ...(options.ask === undefined ? {} : { ask: options.ask }),
      // The child's own output is for the log and never a sentence on screen.
      onChatter: () => undefined,
      // A widget, a title or a status line has no dialog and is reported rather
      // than answered with something invented — the same rule the in-process
      // path follows.
      onUnsupportedUi: (request) => {
        options.onEvent({
          type: 'notice',
          what: `An add-on asked for ${request.method}, which this window could not do. Nothing was drawn for it, and it was told so.`,
        });
      },
    });
  };

  const hosted = new Hosted(options, guard, await startChild(), startChild);
  /* The conversation so far, read off the transcript the child has just opened.
     The window asks for this the moment a project opens and turns it back into
     the thread somebody left, so it has to be in hand before this resolves —
     the same reason the in-process path reads its manager before returning. A
     brand-new conversation has no file yet, which is an empty thread. */
  await hosted.readBack();
  return hosted;
}

/**
 * The conversation, as the window reaches it.
 *
 * A class rather than an object literal because so much of this is state that
 * arrives from the child on its own schedule — the model, the room, the name,
 * whether a turn is running — and every getter that reads it has to answer
 * *now* while the wire answers later. Each is asked for when the child says
 * something that could have changed it, and remembered in between.
 *
 * It is also what the eviction registry holds: `busy`, `activeAt` and `unload`
 * are the whole of what taking one conversation's process away needs, and the
 * class keeps the means to start another, so the next prompt from the same
 * session file brings one back.
 */
export class Hosted implements GrapheSession {
  private closed = false;
  /** Prompts accepted and not yet come to rest. Load-bearing: `busy` is what
   *  the eviction registry reads, and a settle that never arrives must not hold
   *  the composer a spinner. */
  private inFlight = 0;
  private rest: (() => void)[] = [];
  /** The child has gone. Every later call is refused rather than written into
   *  a pipe nobody holds. Cleared when a new child is started. */
  private gone: ChildExit | null = null;
  /** Pi's own account of this session, refreshed when it could have moved. */
  private said: Record<string, unknown> = {};
  private activation: string | null = null;
  /** Where this conversation sits in the eviction registry. */
  private token: number;
  /** This side is taking the child back for being idle, so the exit that
   *  follows is not a death and not a stop. */
  private givingBack = false;
  /** The child was given back rather than dying. The next prompt from the same
   *  session file starts another one; a death never does. */
  private givenBack = false;
  /** How to stop hearing the child that was current when this was set. Named
   *  apart from `listening`, which is the GrapheSession member. */
  private readonly links: (() => void)[] = [];
  /** When somebody last asked this conversation for something. Null until they
   *  have, which is the oldest thing there is. */
  private askedAt: number | null = null;

  constructor(
    private readonly options: CreateSessionOptions,
    private readonly guard: Guarded,
    private runtime: ChildRuntime,
    private readonly startChild: ChildMaking,
  ) {
    this.token = childRuntimes.register(this);
    this.attend();
    this.firstRead = this.reread();
  }

  /** The first read of Pi's own account, which `readBack` waits on. */
  private readonly firstRead: Promise<void>;

  /* -- what the child says ------------------------------------------------ */

  /** Listen to whichever child is the current one. Called again when an idle
   *  child has been given back and the next prompt brings another, so the dead
   *  one's handles go first — a listener left behind would deliver every later
   *  event twice. */
  private attend(): void {
    for (const drop of this.links.splice(0)) drop();
    /* Pi's own stream, fed into the same relay the in-process path uses — one
       `fromPi`, not two, which is what makes the two paths' event streams the
       same shape for the window. The `snake_case` names are already translated
       inside Pi: its RPC mode emits the session's own events through
       `toJsonEvent`, which is the shape `fromPi` was written against. */
    this.links.push(
      this.runtime.onEvent((event) => {
        this.heard(event);
        this.guard.relay.fromPi(event);
      }),
      this.runtime.onExit((how) => this.exited(how)),
    );
  }

  /* -- being given back, and coming back ---------------------------------- */

  /** Whether anything is going on that must not be cut short. A turn in flight,
   *  a run held between steps, and a question on screen are all of it. A closed
   *  conversation is never evictable: it is already going. */
  busy(): boolean {
    return (
      this.closed ||
      this.inFlight > 0 ||
      this.guard.paused.on ||
      this.guard.confirmations.pending.length > 0 ||
      this.guard.asking.pending.length > 0
    );
  }

  /** When somebody last asked this conversation for something. */
  activeAt(): number | null {
    return this.askedAt;
  }

  /**
   * Give the child back, because nothing is being asked of it.
   *
   * A `killed` child and a conversation with no runtime: nothing was
   * interrupted, so nothing is reported as interrupted, and the transcript is
   * whole. The next prompt starts another child against the same session file —
   * which is where this conversation has been writing all along.
   */
  async unload(): Promise<boolean> {
    if (this.busy() || this.gone !== null) return false;
    this.givingBack = true;
    try {
      await this.runtime.stop();
    } finally {
      this.givingBack = false;
    }
    if (this.gone === null) return false;
    /* The exit handler refused this session the way a death does. Coming back
       is the whole point of an eviction, so the refusal is undone. Everything
       Pi said about the session stays: it is the same session file, and the
       next child reports the same model, name and room for it. */
    this.gone = null;
    this.givenBack = true;
    this.options.onRuntimeUnloaded?.();
    return true;
  }

  /** Start a child again, after an idle one was given back. */
  private async wake(): Promise<void> {
    if (!this.givenBack) return;
    const runtime = await this.startChild();
    this.runtime = runtime;
    this.givenBack = false;
    this.attend();
    await this.reread();
  }

  /** Every event, before the relay burns what it needs. */
  heard(event: Record<string, unknown>): void {
    if (event['type'] === 'agent_settled') {
      this.inFlight = 0;
      for (const resolve of this.rest.splice(0)) resolve();
      this.options.onEvent({ type: 'busy', on: false });
      // The name and the file are only known once there is a conversation to
      // name, and both move with what was just said.
      void this.reread();
    }
  }

  /** The child is gone. Everything waiting is settled as cancelled. */
  exited(how: ChildExit): void {
    this.gone = how;
    /* Given back for being idle: not a death and not a stop. The transcript is
       whole, nothing was in flight, and the next prompt starts another child in
       the same session file — so nothing is said on the stream at all. */
    if (this.givingBack) return;
    this.inFlight = 0;
    for (const resolve of this.rest.splice(0)) resolve();
    // A question nobody can answer any more. The promise belongs to the card
    // behind the Guard, and letting it go is what takes that card off screen.
    const open = this.guard.releaseEverything();
    if (open.callIds.length > 0) {
      this.options.onEvent({ type: 'questions-withdrawn', callIds: open.callIds });
    }
    if (open.askedIds.length > 0) {
      this.options.onEvent({ type: 'asking-withdrawn', ids: open.askedIds });
    }
    /* `died` is the child's own ending, which is what an interrupted run looks
       like; `killed` is this side's doing and cut nobody short. Said in the
       same words the in-process path uses, so the transcript's own marker is
       drawn by the code that already draws it. */
    if (how.kind === 'died') {
      this.options.onEvent({
        type: 'error',
        message: 'I stopped where I was: the process doing this work went away.',
      });
    }
    this.options.onEvent({ type: 'settled', how: how.kind === 'died' ? 'failed' : 'stopped' });
    this.options.onEvent({ type: 'busy', on: false });
  }

  private async reread(): Promise<void> {
    const answer = await this.send({ type: 'get_state' }).catch(() => null);
    if (answer === null || answer['success'] !== true) return;
    const data = answer['data'];
    if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
      this.said = data as Record<string, unknown>;
    }
  }

  /** One command, or a refusal. Never a write to a child that has gone. */
  private async send(command: { type: string; [key: string]: unknown }): Promise<Record<string, unknown>> {
    if (this.closed) throw new Error('That project is no longer open.');
    /* A child given back for being idle is not a child that died: asking this
       conversation something starts one again, against the same session file.
       A child that died is not started again — that run was interrupted, and
       reissuing it is not this layer's to do. */
    if (this.givenBack) await this.wake();
    if (this.gone !== null) throw new Error('That conversation is no longer running.');
    this.askedAt = Date.now();
    return this.runtime.send(command);
  }

  /* -- saying something --------------------------------------------------- */

  async prompt(
    text: string,
    images?: readonly ImageCard[],
    options?: { lookFirst?: boolean; queue?: 'followUp' },
  ): Promise<void> {
    if (this.inFlight === 0) this.options.onEvent({ type: 'busy', on: true });
    this.inFlight += 1;
    try {
      await this.send({
        type: 'prompt',
        message: text,
        ...withPictures(images),
        // A second prompt while a turn is running is refused unless it is told
        // how to queue it, which is Pi's own rule.
        ...(options?.queue === 'followUp' ? { streamingBehavior: 'followUp' } : {}),
      });
      await this.untilItRests();
    } finally {
      this.inFlight = Math.max(0, this.inFlight - 1);
    }
  }

  /** Wait for Pi's own `agent_settled`, or for the child to go. */
  private untilItRests(): Promise<void> {
    if (this.inFlight === 0 || this.gone !== null) return Promise.resolve();
    const { promise, resolve } = Promise.withResolvers<void>();
    this.rest.push(resolve);
    return promise;
  }

  async steer(text: string, images?: readonly ImageCard[]): Promise<void> {
    await this.send({ type: 'steer', message: text, ...withPictures(images) });
  }

  async stop(): Promise<void> {
    // A held turn is let go first: stopping a turn that waits must end it.
    this.guard.paused.hold(false);
    const open = this.guard.releaseEverything();
    if (open.callIds.length > 0) {
      this.options.onEvent({ type: 'questions-withdrawn', callIds: open.callIds });
    }
    if (open.askedIds.length > 0) {
      this.options.onEvent({ type: 'asking-withdrawn', ids: open.askedIds });
    }
    await this.send({ type: 'abort' }).catch(() => undefined);
    this.inFlight = 0;
    for (const resolve of this.rest.splice(0)) resolve();
    /* `stopped` rather than a bare settle: a stop that reads as success
       advances the list and applies the checkout for work nobody finished. */
    this.options.onEvent({ type: 'settled', how: 'stopped' });
    this.options.onEvent({ type: 'busy', on: false });
  }

  /* -- who is answering --------------------------------------------------- */

  async useModel(choice: { providerId: string; modelId: string } | null): Promise<boolean> {
    if (choice === null) return true;
    /* Pi answers `set_model` with the model it resolved under `data`, and
       refuses one it cannot find as a failed response — so `success` is the
       answer and `data` is not a flag. */
    const answer = await this.send({
      type: 'set_model',
      provider: choice.providerId,
      modelId: choice.modelId,
    }).catch(() => null);
    if (answer === null || answer['success'] !== true) return false;
    await this.reread();
    return true;
  }

  async useAdvisor(): Promise<void> {
    /* Switching the advisor's tools is `setActiveToolsByName` — an in-process
     * call with no command in rpc-mode's switch. The shell saves the choice
     * either way, so it stands from the next time this project is opened. */
  }

  get model(): { providerId: string; modelId: string } | null {
    const held = this.said['model'];
    if (held === null || typeof held !== 'object' || Array.isArray(held)) {
      return this.options.model ?? null;
    }
    const one = held as Record<string, unknown>;
    const providerId = one['provider'];
    const modelId = one['id'];
    if (typeof providerId !== 'string' || typeof modelId !== 'string') return null;
    return { providerId, modelId };
  }

  get thinking(): ThinkingLevel {
    const level = this.said['thinkingLevel'];
    if (typeof level === 'string' && level !== '') return level as ThinkingLevel;
    return this.options.thinking ?? 'off';
  }

  get thinkingLevels(): readonly ThinkingLevel[] {
    // Read for a chip and answered on a wire: this is what the child last said
    // rather than a question asked from inside a getter.
    return this.levels;
  }

  private levels: readonly ThinkingLevel[] = ['off'];

  setThinking(level: ThinkingLevel): ThinkingLevel {
    void this.send({ type: 'set_thinking_level', level })
      .then(() => this.reread())
      .catch(() => undefined);
    return level;
  }

  /* -- holding and listening ---------------------------------------------- */

  holdOn(on: boolean): void {
    /* A gate inside the Guard, which the child never hears about: holding is
     * this side not sending the next call's verdict, so the step genuinely has
     * not run. Letting go carries on where things are, because the next
     * judgement reads the world again rather than trusting what it remembered. */
    this.guard.paused.hold(on);
    if (!on) this.options.onEvent({ type: 'waiting-for-you', on: false });
  }

  get held(): boolean {
    return this.guard.paused.on;
  }

  get listening(): boolean {
    return !this.closed && this.gone === null && this.inFlight > 0;
  }

  get working(): boolean {
    return this.listening;
  }

  /* -- what is loaded ----------------------------------------------------- */

  get addons(): readonly {
    name: string;
    says: string;
    policy: 'on' | 'tools-only' | 'off';
    startsTurns: boolean;
    runsBackgroundWork: boolean;
    rewritesSystemPrompt: boolean;
  }[] {
    /* What each card would do is read by probing the add-on, which means
     * importing it — the one thing this side deliberately does not do for a
     * child-hosted conversation. The child's loader knows; asking it needs a
     * command rpc-mode does not have. */
    return [];
  }

  get hookOverruns(): readonly Overrun[] {
    /* The per-handler budget is a wrapper this side puts around an in-process
     * hook. A hook in the child is the child's, and there is no measurement
     * here rather than a measurement of zero. */
    return [];
  }

  get activationPending(): string | null {
    return this.activation;
  }

  markActivationPending(says: string): void {
    this.activation = says;
  }

  async recall(): Promise<readonly { content: string }[]> {
    /* The memory is a custom tool of this side's, built in-process today. A
     * child has none, and an empty answer is the honest one. */
    return [];
  }

  takeBackQueue(): TakenBack {
    /* `clear_queue` is Pi's own route for interactive Esc, and its answer —
     * the words it took back — arrives on a wire. This member is synchronous,
     * so there is no honest empty line to give: reporting `ok: true` with
     * nothing in it would take the words off the screen while the agent still
     * holds them. A caller that needs this needs the in-process path. */
    return {
      ok: false,
      because: 'This conversation runs in its own process, which cannot hand the line back while you wait.',
    };
  }

  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    // Off the eviction registry first: a conversation that is closing is not
    // one the ceiling should reach for.
    childRuntimes.forget(this.token);
    this.guard.paused.hold(false);
    this.guard.releaseEverything();
    for (const resolve of this.rest.splice(0)) resolve();
    void this.runtime.stop();
  }

  /* -- the Guard, as the window reaches it -------------------------------- */

  forgetChecks(): void {
    this.guard.desk.forget();
  }

  answer(callId: string, decision: Decision): boolean {
    return this.guard.confirmations.answer(callId, decision);
  }

  answerAsked(id: string, answers: Answers | null): boolean {
    return this.guard.asking.answer(id, answers);
  }

  get awaitingAnswer(): readonly string[] {
    return [...this.guard.confirmations.pending, ...this.guard.asking.pending];
  }

  stopAsking(on: boolean): void {
    this.guard.facts.stopAsking = on;
  }

  get quiet(): boolean {
    return this.guard.facts.stopAsking === true;
  }

  goAsFarAs(howFar: HowFar): void {
    this.guard.facts.howFar = howFar;
  }

  setComputerUse(use: NonNullable<GuardFacts['computerUse']>): void {
    this.guard.facts.computerUse = {
      ...use,
      allowedApps: [...use.allowedApps],
      browserSites: [...use.browserSites],
    };
  }

  setPlanMode(on: boolean): void {
    this.guard.setPlanMode(on);
  }

  get howFar(): HowFar {
    return this.guard.facts.howFar ?? 'asking';
  }

  /* -- what is running ---------------------------------------------------- */

  get running(): readonly RunningPiece[] {
    /* The register is a custom tool of this side's. Servers a child started
     * are the child's, and this side has no measurement of them. */
    return [];
  }

  runningSaid(): string {
    return '';
  }

  async stopRunning(): Promise<boolean> {
    return false;
  }

  get carried(): readonly Carried[] {
    return [];
  }

  commands(): readonly AddonCommand[] {
    // Live, because an add-on that went away while a message waited is gone
    // from here and the shell must be able to say so. Off what the child last
    // said rather than a question asked from inside a synchronous method.
    return this.commandsHere;
  }

  private commandsHere: readonly AddonCommand[] = [];

  extensions(): readonly ExtensionReport[] {
    return [];
  }

  /* -- the conversation --------------------------------------------------- */

  get room(): Room | null {
    const usage = this.said['contextUsage'];
    if (usage === null || typeof usage !== 'object' || Array.isArray(usage)) return null;
    const held = usage as Record<string, unknown>;
    const total = held['contextWindow'];
    if (typeof total !== 'number' || !(total > 0)) return null;
    const tokens = held['tokens'];
    const used = typeof tokens === 'number' && Number.isFinite(tokens) ? tokens : null;
    return {
      used,
      total,
      part: used === null ? null : Math.min(1, Math.max(0, used / total)),
      shortened: this.shortened,
    };
  }

  /** How many times Pi has shortened this conversation, counted off its own
   *  `compaction_end`, which is the same event the in-process path counts. */
  private shortened = 0;

  async tidyNow(): Promise<boolean> {
    const answer = await this.send({ type: 'compact' }).catch(() => null);
    return answer !== null && answer['success'] === true;
  }

  async settleUp(): Promise<boolean> {
    // Once a sitting, and only where this side holds a memory — which it does
    // not here. False rather than a prompt nobody asked for.
    return false;
  }

  get history(): readonly AgentEvent[] {
    /* Read off the transcript rather than over the wire. Pi's `get_entries`
       returns this session's entries and `eventsFromEntries` is the reader that
       turns those into the events which would have made the conversation — and
       the child has already written every one of them to Pi's own file. Read at
       open, because the window asks for it in the same breath as the open. */
    return this.wasSaid;
  }

  private wasSaid: readonly AgentEvent[] = [];

  /** The conversation so far, off the file the child is writing to. Called
   *  before this session is handed back, for the reason `history` gives. */
  async readBack(): Promise<void> {
    /* Pi's own account of the session arrives on a wire and the constructor
       asks for it without waiting, so `conversation` is null until the answer
       lands. Reading the transcript before then finds no file and comes back
       with an empty thread, which is what the window would draw for a
       conversation that has one. */
    await this.firstRead;
    const file = this.conversation;
    if (file === null) return;
    const read = await readTranscript(file).catch(() => null);
    if (read === null || !read.ok) return;
    this.wasSaid = read.value;
  }

  get conversation(): string | null {
    return stringAt(this.said, 'sessionFile');
  }

  get name(): string | null {
    return stringAt(this.said, 'sessionName');
  }

  rename(name: string): boolean {
    if (this.closed || this.gone !== null) return false;
    void this.send({ type: 'set_session_name', name })
      .then(() => this.reread())
      .catch(() => undefined);
    return true;
  }

  get moments(): readonly Moment[] {
    /* Nothing over the wire gives these. `get_entries` would hand over the
     * entries and `momentsFromEntries` turns them into moments, but that
     * reader is this side's and the entries are the child's, so this is a
     * follow-up rather than an invention. */
    return [];
  }

  forkAfter(): string | null {
    return null;
  }

  async tryAnotherDirection(): Promise<string | null> {
    return null;
  }

  mark(): boolean {
    return false;
  }
}

/** A string field of one of Pi's records, or null. */
function stringAt(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === 'string' && value !== '' ? value : null;
}

/** Pictures, in Pi's own envelope. Nothing outside this file hears the word
 *  `ImageContent`, exactly as on the in-process path. */
function withPictures(images?: readonly ImageCard[]): Record<string, unknown> {
  if (images === undefined || images.length === 0) return {};
  return {
    images: images.map((picture) => ({
      type: 'image',
      data: picture.bytes,
      mimeType: picture.mimeType,
    })),
  };
}
