/** The Pi adapter — the only module in Graphe allowed to touch Pi.
 *
 * notes/strategy/ARCHITECTURE.md, decision 2: Pi is pre-1.0, makes no semver
 * promise, and shipped three SDK-breaking changes in six weeks (session APIs,
 * auth moving into `ModelRuntime`, package entry points). Every Pi import lives
 * here so an upgrade breaks one file instead of fifty. Nothing below returns,
 * accepts or re-exports a Pi type: the app sees `GrapheSession`, `AgentEvent`
 * and `ToolCall` from `src/agent/types.ts`, and nothing else.
 *
 * The one Pi import is dynamic, inside `createSession`. That is not style. It
 * means the whole guard decision table and the event translation can be loaded,
 * and tested, without the SDK, a model, or a credential file anywhere in sight —
 * and it keeps Pi out of the Electron main process until somebody actually opens
 * a project.
 *
 * ## Where the Guard is wired in
 *
 * Pi has no permission system by design (decision 3), so the interception point
 * matters more here than anywhere else in the codebase. It is the `tool_call`
 * extension hook. Underneath, `AgentSession` installs that hook as the agent
 * loop's `beforeToolCall`, which runs after the tool's arguments are validated
 * and before `tool.execute` is reached; returning `{ block: true, reason }`
 * makes the loop skip execution entirely and hand `reason` back to the model as
 * the tool's error result. So a denial is both a real stop and a sentence the
 * model can read and adapt to.
 *
 * The package also exports `wrapRegisteredTool` / `wrapRegisteredTools`, which
 * look like the interception point and are not: their own doc comment says
 * "Tool call and tool result interception is handled by AgentSession via
 * agent-core hooks", and the implementation only adapts an extension-registered
 * tool's execution context and tracks newly added tool names. They never see
 * built-in `bash`, `read`, `write` or `edit` at all, which is precisely the set
 * that can destroy a project. Wrapping them would have produced a Guard that
 * passes its own tests and protects nothing.
 */

import type { GuardFacts } from '../guard/policy';
import { changesAnything, describeCall, evaluate, requiresSnapshot } from '../guard/policy';
import { afterCall, atTheEnd, beforeCall, readRules, rulesFile, RULE_WORDS, type Rules, type World } from '../hooks';
import type { HowFar } from '../guard/policy';
import { PLAN_WORDS, parseProposal, readOnlyTools } from '../plan';
import type { AgentEvent, ImageCard, ToolCall, Verdict } from '../types';
import type { Timeline } from '../../history/timeline';
import { EventRelay } from './events';
import { RepairCoordinator, repairPrompt } from './repair';
import { checksAfterChange, saysFailed, sourceAmong } from './verify';
import { notHere, runHelper } from '../../share/run';
import { readdir } from 'node:fs/promises';
import { eventsFromEntries, momentToReturnTo, momentsFromEntries, type Moment } from './history';
import { namedAs, readConversations, type Conversation } from './conversations';
import { PORTS_HELD as PORTS } from '../../work/ports';
import { grapheTools, memoryTools, readDiffTool, debugTools, newDebugRegistry, runningTools, type ChecksNoted, type PutOnBoard } from './tools';
import { whatWasChecked } from './checks';
import { anchorEditTool, taggedReadTool } from './anchor-edit';
import * as debug from './debug';
import { McpRegistry, inProject, mcpTool, readMcpConfig } from './mcp';
import { parseReview } from './review';
import { defaultEmbedder, memoryFileName, openMemory, type MemoryStore } from '../memory';
import { heldShell, loginShell, shellBounds } from '../sandbox/shell';
import { Running, type RunningPiece } from '../running';
import {
  collectAccounts,
  credentialFor,
  readFoundCredentials,
  type FoundAccount as FoundOnDisk,
} from './importers';

import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, sep } from 'node:path';

import { idFor } from '../../projects/carried';
import type { ThinkingLevel } from '../../lib/ipc';

/** Yes or no, from a person. There is deliberately no third answer: no "always",
 *  no "for this session", no "don't ask again". Confirmation fatigue is what
 *  created "Accept All" (research/03 §7) and a `confirm` that can be switched
 *  off is not a confirmation. */
export type Decision = 'yes' | 'no';

/** What the interceptor gives back to Pi. `undefined` means "let it run". */
export type Interception = { block: true; reason: string } | undefined;

/** Everything the Guard needs to take a restore point. Structurally a Timeline,
 *  so a test can pass a stub and nothing here needs a git folder. */
export type SnapshotSource = Pick<Timeline, 'snapshot'>;

/** Anything that went wrong that the app is expected to show somebody. */
export class AdapterError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'AdapterError';
  }
}

/* -------------------------------------------------------------------------- */
/* What the model is told when it does not get its way                         */
/* -------------------------------------------------------------------------- */

/** Blocked calls come back to the model as the tool's error text. It is worth
 *  writing these for the model as well as the log: a model that understands it
 *  was refused asks a better question, and a model that thinks the tool is
 *  broken retries the same thing five times and bills the user for it. */
const TOLD = {
  declined:
    'The person you are working for was asked about this and said no. Do not try it again in another form. Ask them what they would like instead.',
  noRestorePoint:
    'I could not save a restore point before this, so I did not do it. Nothing has changed. Say what you were trying to achieve and we will find another way.',
  /** The reason written on a restore point taken while nobody is being asked. */
  gettingOnWithIt: 'Saved before getting on with it',
} as const;

/** What the user reads when they say no. Plain, and not an apology. */
const SAID_NO = 'You said no, so I have left it alone.';
/** What the user reads when the restore point could not be made. */
const NO_RESTORE_POINT =
  "I could not save a restore point first, so I have not made this change. Nothing has been lost.";

/* -------------------------------------------------------------------------- */
/* Questions waiting on a person                                               */
/* -------------------------------------------------------------------------- */

/**
 * The questions the Guard has asked and nobody has answered yet.
 *
 * A `confirm` verdict parks the tool call here — genuinely parked: the promise
 * the extension hook returned to Pi has not resolved, so the agent loop has not
 * reached `tool.execute`, so the thing being asked about has not happened. The
 * host answers with `answer(id, 'yes' | 'no')`.
 *
 * Nothing is remembered between questions. Answering yes to installing one
 * package says nothing about the next one.
 */
export class Confirmations {
  private readonly waiting = new Map<string, (decision: Decision) => void>();

  /** Ids of calls currently waiting on a person, oldest first. */
  get pending(): readonly string[] {
    return [...this.waiting.keys()];
  }

  ask(call: ToolCall): Promise<Decision> {
    return new Promise<Decision>((resolve) => {
      // A second question about the same id can only mean the first one is
      // stale. Let it go rather than leaving the agent loop parked forever.
      this.waiting.get(call.id)?.('no');
      this.waiting.set(call.id, resolve);
    });
  }

  /** Returns false when there was no such question, which is what the host gets
   *  if it answers twice or answers something already abandoned. */
  answer(callId: string, decision: Decision): boolean {
    const resolve = this.waiting.get(callId);
    if (resolve === undefined) return false;
    this.waiting.delete(callId);
    resolve(decision);
    return true;
  }

  /** Stopping or closing the session answers every open question with no. An
   *  unanswered question must never resolve to yes. */
  abandonAll(): readonly string[] {
    const ids = [...this.waiting.keys()];
    const open = [...this.waiting.values()];
    this.waiting.clear();
    for (const resolve of open) resolve('no');
    return ids;
  }
}

/* -------------------------------------------------------------------------- */
/* The decision table                                                          */
/* -------------------------------------------------------------------------- */

export type InterceptorOptions = {
  facts: GuardFacts;
  relay: EventRelay;
  confirmations: Confirmations;
  /** Where restore points go. Without one, a `snapshot-first` call still runs —
   *  the host chose to open a session with no history — but it runs with no way
   *  back, which is why `createSession` takes a Timeline and expects one. */
  timeline?: SnapshotSource | undefined;
  /** True while the turn is only allowed to look. Anything that could change
   *  the project is refused with a sentence telling the model to propose it
   *  instead, which is the whole of planning before doing. */
  planning?: () => boolean;
  /** The project's own rules, as they were read. They can only ever make an
   *  answer harder, so a project that carries none changes nothing here. */
  rules?: () => Rules;
  /** What has actually been checked, for a rule that asks about it. A check
   *  nobody has run holds a turn exactly as a failing one does. */
  world?: () => World;
  /** Told about a call before it runs, so anything already checked can be
   *  forgotten when the files are about to move under it. */
  filesMayHaveMoved?: (call: ToolCall) => void;
};

function whyItMatters(verdict: Verdict): string {
  if (verdict.kind === 'snapshot-first') return verdict.reason;
  if (verdict.kind === 'confirm') return verdict.question;
  return 'A change worth being able to undo.';
}

/**
 * Review one tool call, and answer Pi with either "run it" or "no, and here is
 * why".
 *
 * Every branch of this function is the same four cases the Guard returns, in the
 * same order, with one addition: `requiresSnapshot` is consulted separately from
 * the verdict. That is not redundancy. `Verdict` can carry either "ask" or "save
 * first" but not both, and a destructive change needs both — the user approving
 * a dropped table must still get a restore point (policy.ts, S-01 and S-05).
 */
export function createGuardInterceptor(
  options: InterceptorOptions,
): (call: ToolCall) => Promise<Interception> {
  const { facts, relay, confirmations, timeline, planning, rules, world, filesMayHaveMoved } =
    options;

  /* Fails closed. A host with no history wired cannot run destructive work at all:
     "every destructive action is snapshotted first" is a promise, and a promise with
     a convenience exemption is not one. Read operations are unaffected — only calls
     the guard already judged destructive ever reach here. */
  const takeRestorePoint = async (reason: string): Promise<boolean> => {
    if (timeline === undefined) return false;
    try {
      await timeline.snapshot({ boundary: 'before-risky-change', instruction: reason });
      return true;
    } catch {
      return false;
    }
  };

  return async function review(call: ToolCall): Promise<Interception> {
    filesMayHaveMoved?.(call);
    // The explicit top autonomy rung is full access for this sitting. Keep this
    // before planning too: otherwise a leftover plan-only state silently turns
    // "Get on with it" back into a restricted mode. `evaluate` mirrors this
    // rule for every other policy consumer.
    if (facts.howFar === 'doing') {
      // The top rung is a person's decision about the Guard, not about what
      // their project has agreed. "Never publish by hand" is the team's line
      // and it survives somebody turning their own questions off.
      const house = rules?.();
      if (house !== undefined && house.rules.length > 0) {
        const said = beforeCall(call, { kind: 'allow' }, house, world?.() ?? {});
        if (said.verdict.kind === 'deny') {
          relay.blocked(call, said.verdict.reason);
          return { block: true, reason: said.verdict.reason };
        }
        if (said.verdict.kind === 'confirm') {
          relay.asking(call, said.verdict);
          const decision = await confirmations.ask(call);
          if (decision !== 'yes') {
            relay.blocked(call, SAID_NO);
            return { block: true, reason: TOLD.declined };
          }
        }
      }
      // A restore point still. Turning your own questions off says you do not
      // want to be asked; it does not say the moment before a destructive change
      // is not worth keeping — and this is the rung where nobody is watching, so
      // it is the rung that needs it most.
      if (requiresSnapshot(call, facts)) {
        const saved = await takeRestorePoint(TOLD.gettingOnWithIt);
        if (!saved) {
          relay.blocked(call, NO_RESTORE_POINT);
          return { block: true, reason: TOLD.noRestorePoint };
        }
      }
      relay.started(call);
      return undefined;
    }

    // Looking only. Withheld rather than refused-as-an-error: the model is told
    // to put it in the plan, which is the answer we actually want back.
    if (planning?.() === true && readOnlyTools([call.name]).length === 0) {
      return { block: true, reason: PLAN_WORDS.withheld };
    }

    // The Guard first and always. The project's rules fold on top and can only
    // make the answer harder — there is no argument to `beforeCall` that
    // produces something softer than what it was handed.
    const judged = evaluate(call, facts);
    const house = rules?.();
    const verdict =
      house === undefined ? judged : beforeCall(call, judged, house, world?.() ?? {}).verdict;

    if (verdict.kind === 'deny') {
      relay.blocked(call, verdict.reason);
      return { block: true, reason: verdict.reason };
    }

    if (verdict.kind === 'confirm') {
      relay.asking(call, verdict);
      const decision = await confirmations.ask(call);
      if (decision !== 'yes') {
        relay.blocked(call, SAID_NO);
        return { block: true, reason: TOLD.declined };
      }
    }

    // Before, not after. If this line and the next were swapped the restore
    // point would be of a project that had already been changed.
    if (requiresSnapshot(call, facts) || verdict.kind === 'snapshot-first') {
      const saved = await takeRestorePoint(whyItMatters(verdict));
      if (!saved) {
        relay.blocked(call, NO_RESTORE_POINT);
        return { block: true, reason: TOLD.noRestorePoint };
      }
    }

    relay.started(call);
    return undefined;
  };
}

/* -------------------------------------------------------------------------- */
/* What has been checked                                                       */
/* -------------------------------------------------------------------------- */

export type ChecksDesk = {
  /** What the rules read. */
  world: () => World;
  /** The files have moved, so nothing checked before now describes them. */
  forget: () => void;
  /** Reviewers are setting off; what this hands back keeps their answers. */
  noting: ChecksNoted;
};

/**
 * Where the answers to this project's own checks are kept between calls.
 *
 * The reading of a reviewer's words happens in `whatWasChecked`, which is pure.
 * All that is left here is one honest question: is this answer still about the
 * project as it now stands? Reviewers take minutes, and a change landing while
 * they read makes every one of their answers describe a version of the project
 * that no longer exists — so the moment they set off is counted, and an answer
 * arriving after that count has moved on is dropped rather than believed.
 */
export function checksDesk(): ChecksDesk {
  let checked: World = {};
  let moved = 0;

  return {
    world: () => checked,
    forget: () => {
      moved += 1;
      checked = {};
    },
    noting: () => {
      const setOff = moved;
      return (verdicts) => {
        if (setOff !== moved) return;
        checked = { checks: { ...checked.checks, ...whatWasChecked(verdicts) } };
      };
    },
  };
}

/* -------------------------------------------------------------------------- */
/* The session                                                                 */
/* -------------------------------------------------------------------------- */

export type CreateSessionOptions = {
  /** The project folder. The Guard's boundary in the normal autonomy modes;
   *  the explicit "Get on with it" mode deliberately lifts that boundary. */
  projectRoot: string;
  /** Every event the app shows, in order. */
  onEvent: (event: AgentEvent) => void;
  /** Where restore points go. Strongly recommended; see `InterceptorOptions`. */
  timeline?: Timeline;
  /** Standing instructions and facts the Guard cannot work out from the call
   *  alone — "ask me first", row counts, the user's real secret values. */
  guard?: Omit<GuardFacts, 'projectRoot'>;
  /** A transcript file to open. Left out, the transcript is in memory only and
   *  nothing is written to the user's disk. */
  sessionPath?: string;
  /** Where this project's conversations live on disk. Given, the session
   *  resumes the most recent one and keeps writing to it — a project reopened
   *  is a conversation continued, not one started again (BACKLOG B1.1). When
   *  neither this nor `sessionPath` is given, nothing is ever written. */
  sessionDir?: string;
  /** A project-owned register for servers and watchers. Sharing this between
   *  conversations keeps a server alive when a conversation is rebuilt or put
   *  down. Left out, an in-memory session owns and closes its own register. */
  running?: Running;
  /** Told about every server this session starts and stops, so a crash can be
   *  cleaned up on the way back in. A server is whatever somebody asked to be
   *  started, so the only way to recognise one afterwards is to have written it
   *  down at the time. */
  noteServers?: { began: (pid: number, command: string) => void; ended: (pid: number) => void };
  /** Start a conversation rather than carrying the last one on. Only means
   *  anything alongside `sessionDir`: without somewhere to write, every session
   *  is already a fresh one. */
  fresh?: boolean;
  /** A Figma credential, when one has been connected. Given, the agent can read
   *  the frames and values behind a Figma link instead of the link's text. */
  figmaToken?: string;
  /** Whether to load the recipes and skills the opened project carries. Left
   *  out, they are not loaded: project-supplied prompt text is attacker
   *  controllable, and it reaches the system prompt. */
  trustProject?: () => boolean;
  /** Where Pi keeps credentials and its model list. Defaults to the user's own
   *  `~/.pi/agent`, which is where signing in puts them. Worth overriding in a
   *  test: Pi creates the folder on sight. */
  agentDir?: string;
  /** The model chosen to work with, or null for "whatever is available". The
   *  id is Pi's own — resolved inside this file, where the model objects
   *  live, and never heard of outside it. */
  model?: { providerId: string; modelId: string } | null;
  /** The selected model's remembered depth. Pi clamps it again, so a stale
   *  choice can never be sent to a model that does not support it. */
  thinking?: ThinkingLevel;
  /** Whether one of the extensions this folder carries has been said yes to.
   *  Left out, none of them are: a folder's own code never loads by default. */
  trusts?: (id: string) => boolean;
  /** The folder somebody is actually looking at, when this session is running
   *  in a copy of it. The copy gets its own preview address; the real one keeps
   *  the ordinary one. */
  mainFolder?: string;
  /** Somewhere to put a piece of background work. Given, the agent can break a
   *  request into pieces that run side by side; left out, it cannot — which is
   *  what keeps a run on the board from filling the board it is running on. */
  putOnBoard?: PutOnBoard;
};

/**
 * A running agent, in our vocabulary.
 *
 * Deliberately small: every method here is a Pi API we have agreed to keep
 * working through their next breaking change, so the test is whether a designer
 * has the concept, not whether Pi has the call.
 *
 * Taken, because they are things people already do to a conversation: saying
 * something, choosing who answers, stopping, naming it, going back to a moment
 * in it to try a different direction, and marking a moment to find again.
 *
 * Left, because they are settings on a mechanism rather than intentions: model
 * cycling, thinking levels, steering, and lifting a stretch of conversation out
 * into a file of its own. Tidying a long conversation up is taken but not
 * offered — it happens by itself, after a reply, and nothing has to ask for it.
 */
/** How full a conversation is, in the model's own units. */
export type Room = {
  /** Roughly how much of the window this conversation takes; unknown just
   *  after compaction until the model reports its first new usage reading. */
  used: number | null;
  /** How much the model can hold at once. */
  total: number;
  /** The two above as a fraction, 0 to 1; unknown with `used`. */
  part: number | null;
};

/** What came of asking for the line back. A line that would not come back is
 *  not an empty line: the words are still in front of the agent, and answering
 *  "nothing" to both takes them off the screen while it still holds them. */
export type TakenBack =
  | { ok: true; steering: readonly string[]; followUp: readonly string[] }
  | { ok: false; because: string };

/** The line, taken out of the agent's hands. Separated from the session so the
 *  one decision here — a refusal is not an empty line — can be read on its
 *  own. */
export function takingBack(
  clear: () => { steering: readonly string[]; followUp: readonly string[] },
): TakenBack {
  try {
    const taken = clear();
    return { ok: true, steering: [...taken.steering], followUp: [...taken.followUp] };
  } catch (cause) {
    return {
      ok: false,
      because: cause instanceof Error ? cause.message : 'The line did not come back.',
    };
  }
}

export type GrapheSession = {
  /** Say something to the agent. Resolves when it has finished responding.
   *  Pictures travel with the message; omitted when there are none. */
  prompt(
    text: string,
    images?: readonly ImageCard[],
    options?: { lookFirst?: boolean; queue?: 'followUp' },
  ): Promise<void>;
  /** Work with a different model from now on, keeping the conversation. False
   *  when the choice does not resolve to a model this computer can use; the
   *  session then carries on with what it had rather than picking for you. */
  useModel(choice: { providerId: string; modelId: string } | null): Promise<boolean>;
  /** Which model is answering, or null for "whatever the account offers". */
  readonly model: { providerId: string; modelId: string } | null;
  /** How much time this model is taking before it answers. */
  readonly thinking: ThinkingLevel;
  /** The levels this exact model supports, in its own capability map. */
  readonly thinkingLevels: readonly ThinkingLevel[];
  /** Change the depth for this conversation. The model clamps unsupported
   *  choices, and the resulting level is returned. */
  setThinking(level: ThinkingLevel): ThinkingLevel;
  /** Stop what it is doing now. Open questions are answered no. */
  stop(): Promise<void>;
  /** Put a message into a turn already in flight, without stopping it — the
   *  agent hears it between tool calls and carries on. This is the "insert
   *  into the loop" move other coding agents offer; Pi calls it steering.
   *  Safe to call at any time: when nothing is running it simply joins. */
  steer(text: string, images?: readonly ImageCard[]): Promise<void>;
  /** Whether a steer sent right now would actually be heard.
   *
   *  Pi's queue is drained only from inside a run that is already going. A
   *  message pushed onto it once the run has ended sits there until the session
   *  is disposed of and is then lost — quietly, and with nothing returned to
   *  say so. Anything offering to pass a sentence along has to ask first. */
  readonly listening: boolean;
  /** True from the moment a prompt is accepted until its retries, continuations,
   *  and post-turn tidying have all completed. Used only to prevent cache
   *  eviction from aborting live work. */
  readonly working: boolean;
  /** Take everything waiting behind the run back out of the queue and hand it
   *  over, so it can be put back in the box and rewritten. Nothing is left
   *  queued afterwards — unless the answer says it did not come back, which is
   *  its own answer and not an empty line. */
  takeBackQueue(): TakenBack;
  /** Finish with this session. Safe to call twice. */
  dispose(): void;
  /** The files moved underneath us by something other than a tool call — work
   *  taken off the board, a person's own editor, going back in history. Any
   *  check that passed did so against files that are no longer there, and a
   *  rule reading it would be reading about the past. */
  forgetChecks(): void;
  /** Answer a `needs-confirmation`. False if there was no such question. */
  answer(callId: string, decision: Decision): boolean;
  /** How much of what the model can hold at once this conversation is using.
   *  Null before the model has answered once, and for a moment after a tidy —
   *  the count comes from the model's own reckoning, not ours. */
  readonly room: Room | null;
  /** Shorten the conversation now, rather than waiting for it to fill up. False
   *  when there is nothing to shorten or one is already going. */
  tidyNow(): Promise<boolean>;
  /** Stop asking before things the Guard would otherwise check, for as long as
   *  this session lives. Restore points and outright refusals are unaffected —
   *  see `stopAsking` in the Guard's own facts. */
  stopAsking(on: boolean): void;
  /** Whether it is currently not asking. */
  readonly quiet: boolean;
  /** How far it may go on its own, for as long as this session lives. A
   *  ceiling on questions, never on what is refused. */
  goAsFarAs(howFar: HowFar): void;
  /** Where the ladder is set right now. */
  readonly howFar: HowFar;
  /** What this session has kept running — servers, watchers, anything started
   *  to stay up. Empty for almost every sitting. */
  readonly running: readonly RunningPiece[];
  /** Stop one of them by name. Resolves only once its process has gone. */
  stopRunning(id: string): Promise<boolean>;
  /** The extensions this folder brought with it, and which of them loaded.
   *  Empty for a project that carries none, which is almost all of them. */
  readonly carried: readonly Carried[];
  /** Calls waiting on a person right now, oldest first. */
  readonly awaitingAnswer: readonly string[];
  /** The conversation this session started with, as the events that would have
   *  made it — an earlier sitting read back so the window can show it again
   *  (BACKLOG B1.1). Empty when this is a brand-new conversation. */
  readonly history: readonly AgentEvent[];
  /** Where this session is being written, so the window can mark which row in
   *  the shelf is the one on screen. Null when nothing is being kept. */
  readonly conversation: string | null;
  /** The name this conversation was given, or null while it is still known by
   *  the words it opened with. */
  readonly name: string | null;
  /** Name this conversation, so it keeps that name in the shelf. False when
   *  there is nothing in the name, or nowhere to keep it. */
  rename(name: string): boolean;
  /** The moments this conversation could be taken back to — each of the things
   *  the person said, oldest first, with any mark left on it. */
  readonly moments: readonly Moment[];
  /**
   * Go back to one of those moments and carry on from there in a different
   * direction. Resolves with the words said then, so they can be said
   * differently, and null when that moment cannot be returned to — an unknown
   * one, or a reply still arriving.
   *
   * The conversation is what moves. The files in the project are left exactly
   * as they are; taking those back is `src/history/attempts.ts`, and the two are
   * separate on purpose — a person can rethink what they asked for without
   * throwing away the work, and throw away the work without rethinking.
   */
  tryAnotherDirection(momentId: string): Promise<string | null>;
  /** Write something against a moment so it can be found again. Empty text
   *  takes the mark off. False when there is no such moment. */
  mark(momentId: string, note: string): boolean;
};

type Pi = typeof import('@earendil-works/pi-coding-agent');
type PiToolCallEvent = import('@earendil-works/pi-coding-agent').ToolCallEvent;
/** The runtime instance, and the interaction its login flow asks for. Both are
 *  Pi shapes; the app's own copies are declared below and cast at this seam.
 *  Derived from `create` rather than the class itself — the constructor is
 *  private, and the seam should never depend on it either. */
type PiRuntime = Awaited<ReturnType<Pi['ModelRuntime']['create']>>;
type PiAuthInteraction = Parameters<PiRuntime['login']>[2];

async function loadPi(): Promise<Pi> {
  try {
    return await import('@earendil-works/pi-coding-agent');
  } catch (cause) {
    throw new AdapterError('I could not start the part of me that does the work.', { cause });
  }
}

/* -------------------------------------------------------------------------- */
/* Connecting an account                                                       */
/* -------------------------------------------------------------------------- */

/** The two ways to connect a provider, in the words the window offers them. */
export type ProviderMethod = 'oauth' | 'api-key';

/** One provider, as plain data the window can draw. Everything Pi-shaped is
 *  read through here and left behind: the window never hears the words
 *  "credential", "runtime" or "catalog". */
export type ProviderSummary = {
  providerId: string;
  name: string;
  methods: readonly ProviderMethod[];
  oauthLabel: string | null;
  apiKeyLabel: string | null;
  connected: boolean;
  available: boolean;
  /** True when the connected account is paid for by its own plan rather than
   *  by use, so no per-use figure about it can be honest. */
  subscription: boolean;
  models: readonly ModelSummary[];
};

/** One model, as plain data. The rates are dollars per million tokens, which is
 *  how every provider quotes them and how Pi's catalog stores them. */
export type ModelSummary = {
  id: string;
  label: string;
  available: boolean;
  rates: { input: number; output: number } | null;
  contextWindow: number | null;
  /** Whether this model reads pictures. Null when its catalogue entry does not
   *  say — not knowing and knowing it cannot are different claims, and only one
   *  of them is worth stopping somebody over. */
  takesImages: boolean | null;
  thinking: readonly ThinkingLevel[];
};

/** The app's own copy of Pi's auth interaction. The shapes match on purpose —
 *  the main process implements this, the window implements the steps it emits,
 *  and neither side is allowed to know the shapes belong to Pi. */
export type OurAuthPrompt =
  | { type: 'text'; message: string; placeholder?: string; signal?: AbortSignal }
  | { type: 'secret'; message: string; placeholder?: string; signal?: AbortSignal }
  | { type: 'manual_code'; message: string; placeholder?: string; signal?: AbortSignal }
  | {
      type: 'select';
      message: string;
      options: readonly { id: string; label: string; description?: string }[];
      signal?: AbortSignal;
    };

export type OurAuthEvent =
  | { type: 'auth_url'; url: string; instructions?: string }
  | {
      type: 'device_code';
      userCode: string;
      verificationUri: string;
      intervalSeconds?: number;
      expiresInSeconds?: number;
    }
  | { type: 'progress'; message: string }
  | { type: 'info'; message: string };

export type OurAuthInteraction = {
  signal?: AbortSignal;
  prompt(prompt: OurAuthPrompt): Promise<string>;
  notify(event: OurAuthEvent): void;
};

/** The default credential folder — `~/.pi/agent`, the same place Pi's own
 *  command line signs in to. One home for accounts, so connecting here is
 *  connecting everywhere. */
export async function defaultAgentDir(): Promise<string> {
  const pi = await loadPi();
  return pi.getAgentDir();
}

/** One runtime per credential folder, created once and shared by every
 *  session and every connection. It writes the same `auth.json` a session
 *  would read, so a provider connected here works the next time a folder
 *  opens — no restart, no handshake between the two halves. */
const runtimes = new Map<string, Promise<PiRuntime>>();

/**
 * Forget the cached runtime, so the next ask reads the catalogue off disk again.
 *
 * The runtime reads `models.json` once, when it is made, and is then kept for
 * the life of the app. Anything that adds a model afterwards — pi's own
 * catalogue refresh, another tool writing the same file — was invisible until
 * the app was restarted, which is not something anybody should have to work
 * out for themselves.
 *
 * Nothing is disposed. Sessions already running hold their own reference and
 * carry on with the catalogue they started on; only the next one is new.
 */
export function forgetRuntime(agentDir: string): void {
  runtimes.delete(agentDir);
}

/** Ask the catalogue itself, giving up rather than hanging: this happens behind
 *  a button somebody pressed, so it has to come back. */
const LOOK_AGAIN_MS = 15_000;

async function lookAgainFor(runtime: PiRuntime): Promise<void> {
  const asked = runtime as unknown as {
    refresh?: (options: { allowNetwork: boolean; force: boolean; signal?: AbortSignal }) => Promise<unknown>;
  };
  if (typeof asked.refresh !== 'function') return;
  const giveUp = new AbortController();
  const timer = setTimeout(() => giveUp.abort(), LOOK_AGAIN_MS);
  try {
    await asked.refresh({ allowNetwork: true, force: true, signal: giveUp.signal });
  } catch {
    // A catalogue that will not answer is the catalogue we already have. The
    // list still comes back; it is just the one from disk.
  } finally {
    clearTimeout(timer);
  }
}

function runtimeFor(agentDir: string): Promise<PiRuntime> {
  const already = runtimes.get(agentDir);
  if (already !== undefined) return already;
  const pending = loadPi().then((pi) =>
    pi.ModelRuntime.create({
      authPath: join(agentDir, 'auth.json'),
      modelsPath: join(agentDir, 'models.json'),
      // False on purpose, and it is not what "look again" depends on: the
      // refresh below passes `allowNetwork` itself, which wins over this. So
      // starting the app can never reach for the catalogue, and only a press
      // can.
      allowModelNetwork: false,
    }),
  );
  runtimes.set(agentDir, pending);
  // A failure here is a failure of the whole folder's worth of connections;
  // forget it so the next ask tries again rather than inheriting the error.
  void pending.catch(() => {
    runtimes.delete(agentDir);
  });
  return pending;
}

/**
 * Something a helper can think with when nobody has chosen anything.
 *
 * `getAvailableSnapshot` is what the runtime already knows, with no network
 * behind it — the child cannot ask a person to sign in, so a guess that costs a
 * round trip is a guess worth not making.
 */
function firstUsable(runtime: PiRuntime): { providerId: string; modelId: string } | null {
  try {
    const one = runtime.getAvailableSnapshot()[0];
    return one === undefined ? null : { providerId: one.provider, modelId: one.id };
  } catch {
    return null;
  }
}

/** Everything the window can know about who can think for it, read through
 *  one call. Nothing here throws for a provider in a bad state — each is read
 *  defensively and reported as it actually is, because a provider the runtime
 *  cannot reach is a provider the window should still see, greyed out. */
export async function connection(
  agentDir: string,
  options: { fresh?: boolean } = {},
): Promise<readonly ProviderSummary[]> {
  // Asked for again on purpose: forget the copy this app loaded when it
  // started, then ask the catalogue itself — over the network, because a model
  // added by another tool this morning is exactly what somebody is looking for
  // when they press it. Ordinary reads never reach for the network.
  if (options.fresh === true) {
    forgetRuntime(agentDir);
    const made = await runtimeFor(agentDir);
    await lookAgainFor(made);
  }
  const runtime = await runtimeFor(agentDir);

  const connected = new Set<string>();
  try {
    for (const one of await runtime.listCredentials()) connected.add(one.providerId);
  } catch {
    // No account list is still a list — of nothing.
  }

  const summaries: ProviderSummary[] = [];
  for (const provider of runtime.getProviders()) {
    let models: readonly ModelSummary[] = [];
    try {
      models = provider.getModels().map((model) => ({
        id: model.id,
        label: model.name,
        available: false,
        rates: ratesOf(model),
        contextWindow: typeof model.contextWindow === 'number' ? model.contextWindow : null,
        thinking: thinkingLevelsOf(model),
        takesImages: takesImagesOf(model),
      }));
    } catch {
      // Unreadable providers are not offered at all.
    }
    if (models.length === 0) continue;

    const methods: ProviderMethod[] = [];
    let oauthLabel: string | null = null;
    let apiKeyLabel: string | null = null;
    // Anthropic's own terms forbid another app signing people in with their
    // Claude plan, so only its key is offered. No other provider is filtered.
    const signInAllowed = provider.id !== 'anthropic';
    if (signInAllowed && provider.auth.oauth?.login !== undefined) {
      methods.push('oauth');
      oauthLabel = provider.auth.oauth.loginLabel ?? provider.auth.oauth.name ?? null;
    }
    if (provider.auth.apiKey?.login !== undefined) {
      methods.push('api-key');
      apiKeyLabel = provider.auth.apiKey.name ?? null;
    }
    if (methods.length === 0) continue;

    // Which of its models can actually be used right now. Read through the
    // runtime's own judgement — it knows how the stored credential resolves
    // per model, and the window should not have to guess.
    const usable = new Set<string>();
    try {
      for (const model of await runtime.getAvailable(provider.id)) usable.add(model.id);
    } catch {
      // Nothing usable is a true answer for a provider that is not configured.
    }

    summaries.push({
      providerId: provider.id,
      name: provider.name,
      methods,
      oauthLabel,
      apiKeyLabel,
      connected: connected.has(provider.id),
      available: safeConfigured(runtime, provider.id),
      subscription: safeSubscription(runtime, provider.id),
      models: models.map((model) =>
        usable.has(model.id) ? { ...model, available: true } : model,
      ),
    });
  }
  return summaries;
}

/** One extension that came down with the folder somebody opened. */
export type Carried = { id: string; name: string; where: string; trusted: boolean };

/** What the fingerprint is taken of. A file we cannot read is not a file we can
 *  recognise again, so it gets no id and is never loaded. */
function sourceOf(where: string): string {
  try {
    return readFileSync(where, 'utf8');
  } catch {
    return '';
  }
}

/** The name to put in front of somebody: the folder the extension lives in,
 *  which is what its author called it. */
function nameOfExtension(root: string, where: string): string {
  const inside = where.startsWith(root) ? where.slice(root.length) : where;
  const parts = inside.split(sep).filter((part) => part !== '');
  // `.pi/extensions/storybook/index.ts` is called storybook, not index.ts.
  const last = parts[parts.length - 1] ?? inside;
  const parent = parts[parts.length - 2];
  return /^index\./.test(last) && parent !== undefined ? parent : last.replace(/\.[^.]+$/, '');
}

/**
 * Keep the extensions somebody deliberately added, and the ones they have since
 * said yes to; drop the rest of what a folder brought with it.
 *
 * An extension is arbitrary code running in the same process as the agent — the
 * Guard never sees it, because the Guard reviews tool calls and this is the
 * thing that registers them. So "it was in the repository I opened" is not
 * consent, and the answer is asked for per extension rather than per folder:
 * the id carries a fingerprint of the code, so a yes stops covering it the
 * moment it is edited.
 *
 * Whatever is dropped is written down rather than discarded, because an
 * extension that silently does not load is a bug nobody can see.
 */
function theirsAndTrusted(
  projectRoot: string,
  trusts: (id: string) => boolean,
  seen: (carried: readonly Carried[]) => void,
) {
  const root = projectRoot.endsWith(sep) ? projectRoot : projectRoot + sep;
  return <T extends { extensions: readonly { resolvedPath?: string; path?: string }[] }>(
    base: T,
  ): T => {
    const carried: Carried[] = [];
    const kept = base.extensions.filter((one) => {
      const where = one.resolvedPath ?? one.path ?? '';
      if (where === '') return false;
      if (!where.startsWith(root)) return true;

      const name = nameOfExtension(root, where);
      const id = idFor(name, sourceOf(where));
      if (id === '') return false;
      const trusted = trusts(id);
      carried.push({ id, name, where: where.slice(root.length), trusted });
      return trusted;
    });
    seen(carried);
    return { ...base, extensions: kept };
  };
}

/** Every conversation this folder has had. Never throws: a folder with no
 *  transcripts is an empty list, not a failure. */
export async function listConversations(
  projectRoot: string,
  sessionDir: string,
): Promise<readonly Conversation[]> {
  try {
    const pi = await loadPi();
    return readConversations(await pi.SessionManager.list(projectRoot, sessionDir));
  } catch {
    return [];
  }
}

export type { Conversation, Moment };

/**
 * The things that can be added to Graphe, and the two verbs that change them.
 *
 * Pi's own package manager does the work; the catalogue comes from the npm
 * registry, because Pi has no search of its own. Nothing here throws — every
 * failure is a sentence.
 */
export async function packageHost(agentDir: string, projectRoot: string) {
  const pi = await loadPi();
  const settings = pi.SettingsManager.create(projectRoot, agentDir);
  const manager = new pi.DefaultPackageManager({ cwd: projectRoot, agentDir, settingsManager: settings });
  return {
    async search(term: string): Promise<unknown> {
      const asked = term.trim() === '' ? 'pi-' : term.trim();
      const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(asked)}&size=40`;
      const answered = await fetch(url, { headers: { accept: 'application/json' } });
      if (!answered.ok) throw new Error('registry');
      return answered.json();
    },
    list(): Promise<unknown> {
      return Promise.resolve(manager.listConfiguredPackages());
    },
    async add(id: string): Promise<void> {
      await manager.installAndPersist(`npm:${id}`);
    },
    async remove(id: string): Promise<void> {
      await manager.removeAndPersist(`npm:${id}`);
    },
  };
}

/** Read defensively: a provider that quotes nothing gets null rather than a
 *  zero, because free and unpriced are not the same claim. */
const THINKING_LEVELS: readonly ThinkingLevel[] = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
];

/** Pi keeps this capability on the model. Reading it here means Codex and
 * every custom provider get their own real set instead of a guessed one. */
function thinkingLevelsOf(model: { reasoning?: unknown; thinkingLevelMap?: unknown }): readonly ThinkingLevel[] {
  const map = model.thinkingLevelMap;
  if (map !== null && typeof map === 'object' && !Array.isArray(map)) {
    const values = map as Record<string, unknown>;
    return THINKING_LEVELS.filter((level) => values[level] !== null);
  }
  return model.reasoning === true ? ['off', 'minimal', 'low', 'medium', 'high'] : ['off'];
}

/**
 * Whether a model reads pictures, out of the catalogue Pi already keeps.
 *
 * Every model definition may declare what it accepts — `['text']` or
 * `['text', 'image']`. Nothing here has to be written down or kept up to date:
 * the catalogue is refreshed with the agent, and this only reads it.
 *
 * An entry that says nothing is null rather than false. Plenty of older entries
 * omit it, and refusing somebody's picture on the strength of a missing field
 * would be worse than letting the provider answer for itself.
 */
function takesImagesOf(model: { input?: unknown }): boolean | null {
  const input = model.input;
  if (!Array.isArray(input)) return null;
  return input.some((one) => one === 'image');
}

function ratesOf(model: { cost?: unknown }): { input: number; output: number } | null {
  const cost = model.cost;
  if (cost === null || typeof cost !== 'object') return null;
  const { input, output } = cost as { input?: unknown; output?: unknown };
  if (typeof input !== 'number' || typeof output !== 'number') return null;
  if (!Number.isFinite(input) || !Number.isFinite(output)) return null;
  return { input, output };
}

function safeConfigured(runtime: PiRuntime, providerId: string): boolean {
  try {
    return runtime.hasConfiguredAuth(providerId);
  } catch {
    return false;
  }
}

function safeSubscription(runtime: PiRuntime, providerId: string): boolean {
  try {
    return runtime.isUsingSubscription(providerId);
  } catch {
    return false;
  }
}

/** Sign in to a provider, or paste its API key. The interaction is the main
 *  process's: it opens the browser, asks the window for keys and pasted
 *  codes, and reports each step on its way. Resolves when the attempt is
 *  over, or rejects with the reason it was not. */
export async function connectToProvider(
  agentDir: string,
  providerId: string,
  method: ProviderMethod,
  interaction: OurAuthInteraction,
): Promise<void> {
  const runtime = await runtimeFor(agentDir);
  // Pi spells the api-key method with an underscore. The window never hears
  // either spelling — this seam is where one becomes the other.
  const piMethod = method === 'api-key' ? 'api_key' : 'oauth';
  await runtime.login(providerId, piMethod, interaction as PiAuthInteraction);
}

/** Forget a provider's account on this computer. */
export async function disconnectProvider(agentDir: string, providerId: string): Promise<void> {
  const runtime = await runtimeFor(agentDir);
  await runtime.logout(providerId);
}

/* -------------------------------------------------------------------------- */
/* Accounts other tools already saved                                          */
/* -------------------------------------------------------------------------- */

/** An account opencode or Codex saved, as the window may see it. */
export type FoundAccount = FoundOnDisk & { name: string };

/**
 * Accounts opencode and Codex have saved on this computer, narrowed to what
 * this app can actually use: a provider Pi does not know, or an account it
 * already has, is not offered. Nothing secret crosses back — the window sees
 * a name, a kind and a sentence of where it came from.
 */
export async function discoveredAccounts(
  agentDir: string,
): Promise<readonly FoundAccount[]> {
  const runtime = await runtimeFor(agentDir);
  const known = new Map<string, string>();
  for (const provider of runtime.getProviders()) known.set(provider.id, provider.name);

  const connected = new Set<string>();
  try {
    for (const one of await runtime.listCredentials()) connected.add(one.providerId);
  } catch {
    // No account list is still a list — of nothing.
  }

  const found = collectAccounts(await readFoundCredentials());
  return found
    .filter((one) => known.has(one.providerId) && !connected.has(one.providerId))
    .map((one) => ({ ...one, name: known.get(one.providerId) ?? one.providerId }));
}

/**
 * Carry one of those accounts into this app's own store — the same `auth.json`
 * a session would read, so the connection works the moment it lands. The
 * secret is re-read from the other tool's file here, at import time, and never
 * cached anywhere else.
 *
 * It goes through `login` because `setRuntimeApiKey`, which this used to call,
 * only sets a key in a Map — an account brought over that way was gone on quit,
 * and never reached the separate process the `task` tool spawns. `login` is the
 * one public way to save a credential, and its paste-a-key flow asks a single
 * question, which we answer with the key we already have.
 */
export async function importAccount(
  agentDir: string,
  account: FoundOnDisk,
): Promise<void> {
  const credential = await credentialFor(account);
  if (credential === null) {
    throw new AdapterError(
      `That account is no longer saved on this computer — the tool that kept it must have forgotten it.`,
    );
  }
  const runtime = await runtimeFor(agentDir);

  // Both kinds of credential arrive the same way at Pi: as the bearer key its
  // openai-style providers send. A sign-in token is a token with the same
  // job — this is exactly how opencode itself uses the ChatGPT one.
  // Only the question that asked for a secret. A few providers ask more than
  // one — Cloudflare wants an account id, Bedrock opens with a menu — and
  // answering all of them with the key files it in the wrong place, or hands it
  // to a `select` that throws with the answer in the message.
  const answerWithTheKey: OurAuthInteraction = {
    prompt: async (question) => {
      if (question.type !== 'secret') {
        throw new AdapterError(
          `${account.providerId} asks for more than a key, so it cannot be brought over from another tool. Connect it here instead.`,
        );
      }
      return credential.secret;
    },
    notify: () => {},
  };

  try {
    await runtime.login(account.providerId, 'api_key', answerWithTheKey as PiAuthInteraction);
  } catch (cause) {
    if (cause instanceof AdapterError) throw cause;
    throw new AdapterError('I could not save that account on this computer.', { cause });
  }
}

/** Pi's tool call, as ours. A copy, not a view: the Guard judges what it was
 *  handed, and a later mutation of Pi's own object cannot change that. */
function asToolCall(event: PiToolCallEvent): ToolCall {
  return {
    id: event.toolCallId,
    name: event.toolName,
    input: { ...event.input },
  };
}

function plainly(cause: unknown): string {
  if (cause instanceof Error && cause.message !== '') return cause.message;
  return 'Something went wrong on my side, and I have stopped where I was.';
}

/** Pi refuses a second prompt while a turn is still running unless it is told
 *  how to queue it. Recognised by its own sentence, so an upgrade that renames
 *  the error cannot take the queue with it. */
function isAlreadyProcessing(cause: unknown): boolean {
  return (
    cause instanceof Error &&
    /already processing|streamingBehavior/i.test(cause.message)
  );
}

/**
 * All seven of Pi's tools, named rather than inherited.
 *
 * Pi's default turns on only four — `grep`, `find` and `ls` are built and then
 * never handed to the model — which left the agent spelling its searches as
 * shell commands for the Guard to parse, instead of making the reads they are.
 * Naming the set here also means a Pi upgrade cannot quietly change it.
 */
const WORKING_TOOLS = ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls'] as const;

/**
 * Open a session against a project.
 *
 * Two choices here are load-bearing rather than incidental:
 *
 * `noExtensions: true`. `DefaultResourceLoader` otherwise discovers and runs
 * every extension it finds in `~/.pi/agent/extensions` and `<project>/.pi/extensions`.
 * Those can register their own tools and their own `tool_call` handlers, and Pi
 * stops at the *first* handler that blocks — so a third-party extension loaded
 * ahead of ours could hand the model a tool the Guard has never heard of. The
 * inline factory below is still loaded: `noExtensions` filters discovered files,
 * not factories passed in.
 *
 * `SessionManager.inMemory` unless the session is given somewhere to live. A
 * path opens a particular transcript; a directory resumes the most recent
 * conversation in it (BACKLOG B1.1). The desktop shell always passes a
 * directory under the app's own data folder, so transcripts never appear inside
 * the user's project, and nothing is written to disk at all unless one is given.
 */
export async function createSession(options: CreateSessionOptions): Promise<GrapheSession> {
  const pi = await loadPi();

  // Worked out before the Guard's facts rather than beside the runtime, because
  // the agent has to be able to read the skills and extensions it runs on — a
  // feature somebody installed failing silently is the bug this prevents.
  const agentDir = options.agentDir ?? (await defaultAgentDir());

  const facts: GuardFacts = {
    ...options.guard,
    projectRoot: options.projectRoot,
    agentFolder: agentDir,
  };

  /**
   * Pi's own running total for this session, in whole currency units.
   *
   * Pi adds this up across every entry the session has ever had, including the
   * ones tidied away, so it is the same figure the account is billed. We price
   * each turn as it happens because that is the only way to know *whose fault*
   * it was, and then check the sum against this when everything settles: work
   * Pi bills for without ever emitting an assistant message — summarising, and
   * the tidying up of a long conversation — would otherwise be invisible, and a
   * meter that reads under the real bill is the one failure this whole feature
   * exists to prevent.
   *
   * Read defensively and through a hole the size of one number. If a Pi upgrade
   * moves it, the meter loses a reconciliation, not its contents.
   */
  let running: { getSessionStats?: () => { cost?: unknown } } | null = null;
  const rawBill = (): number | null => {
    try {
      const cost = running?.getSessionStats?.().cost;
      return typeof cost === 'number' && Number.isFinite(cost) ? cost : null;
    } catch {
      return null;
    }
  };

  /** What a resumed conversation had already cost. Pi's total covers every entry
   *  the manager holds, history included, so without this the first settle would
   *  report yesterday's bill as money spent just now. */
  let alreadyBilled = 0;
  const billedSoFar = (): number | null => {
    const raw = rawBill();
    return raw === null ? null : raw - alreadyBilled;
  };

  /** True only for the length of a looking-around pass. */
  let planning = false;
  /** Whether this sitting has had its first question yet — the moment the most
   *  relevant notes are handed over, so memory works without being asked. */
  let firstTurn = true;
  /** What was said during one, kept so the proposal can be read out of it. */
  let proposed = '';
  /** Everything said since the last settled moment, so a review verdict can be
   *  read out of the final reply and shown as its own card. */
  let tape = '';
  const say = (event: AgentEvent): void => {
    if (planning && event.type === 'message-delta') proposed += event.text;
    if (event.type === 'message-delta') tape += event.text;
    options.onEvent(event);
    if (event.type === 'settled') {
      const verdict = parseReview(tape);
      tape = '';
      if (verdict !== null) options.onEvent({ type: 'reviewed', verdict });
      // A question outlives the turn that asked it when the run ends any way
      // other than somebody answering — a refusal, a failure, an abort. Nothing
      // can answer it after that, and the window reads a card still waiting as
      // "this is still working": the composer stayed a spinner and Stop had
      // nothing left to stop, for the rest of the sitting.
      const stranded = confirmations.abandonAll();
      if (stranded.length > 0) {
        options.onEvent({ type: 'questions-withdrawn', callIds: stranded });
      }
      sayWhatTheRulesHeld();
    }
  };

  /** How many turns have ended with the project's rules unsatisfied. Bounded on
   *  purpose: a rule naming a check that never passes would otherwise say the
   *  same sentence at the end of every turn for the rest of the sitting. */
  let heldAlready = 0;
  const MOST_HELD_SAYINGS = 3;

  /** How many after-call messages have been said. Same bound as the end-of-turn
   *  one: a rule that matches every write would otherwise narrate every tool. */
  let afterAlready = 0;
  /** Long enough for a project's own type-check, short enough that a wedged one
 *  is not a hang. A check that does not answer is simply not asked again. */
const VERIFY_PATIENCE = 90_000;

const MOST_AFTER_SAYINGS = 3;

  /* What this project has agreed, read once when the sitting opens. Re-read on
     nothing: a rules file that changed mid-turn would judge the first half of a
     turn by one set of rules and the second half by another. */
  const house = readRules(
    await readFile(rulesFile(options.projectRoot), 'utf8').catch(() => null),
  );
  let rulesDiagnosticsSaid = false;
  const sayRulesDiagnostics = (): void => {
    if (rulesDiagnosticsSaid) return;
    rulesDiagnosticsSaid = true;
    const diagnostics = [
      ...(house.trouble === null ? [] : [RULE_WORDS.fileTrouble(house.trouble)]),
      ...house.skipped,
    ];
    if (diagnostics.length === 0) return;
    options.onEvent({ type: 'message-delta', text: `\n\n${diagnostics.join('\n')}` });
    options.onEvent({ type: 'message-end' });
  };
  /** What has actually been checked, filled in when the project's own checks
   *  answer. Nothing else fills it: a rule naming a check nobody wrote holds,
   *  which is the same deny-by-default the Guard uses. */
  const desk = checksDesk();
  /** Host-owned repair budget. The model cannot raise these limits: at most two
   *  after-call verification nudges for one check/file, two in one turn, and
   *  six in the whole sitting. */
  const repairs = new RepairCoordinator();
  /** Filled after Pi creates the session. Tool-end cannot arrive before then. */
  let repairIsListening = (): boolean => false;
  let steerRepair: ((text: string) => Promise<void>) | null = null;

  /** A change to the files makes every earlier check stale. Called on the way
   *  in, before the call runs, because afterwards is a moment too late. */
  const forgetChecks = (call: ToolCall): void => {
    if (changesAnything(call, facts)) desk.forget();
  };

  /**
   * What the project's own rules make of the turn that just ended.
   *
   * Said, not enforced. Handing the turn straight back to the model would let a
   * check that cannot pass loop it forever, and a loop nobody can stop is worse
   * than a sentence somebody can act on — so the words go where both the person
   * and the model can read them, and the next message is theirs to make.
   */
  function sayWhatTheRulesHeld(): void {
    if (house.rules.length === 0) return;
    const ending = atTheEnd(house, desk.world());
    const said = [...ending.hold, ...ending.mention];
    if (said.length === 0) {
      heldAlready = 0;
      afterAlready = 0;
      return;
    }
    if (heldAlready >= MOST_HELD_SAYINGS) return;
    heldAlready += 1;
    options.onEvent({ type: 'message-delta', text: `\n\n${said.join('\n')}` });
    options.onEvent({ type: 'message-end' });
  }

  /**
   * Run the checks a project already has, on the files that just changed.
   *
   * Never blocks the turn: the model keeps working while this runs, and a
   * failure arrives as the same bounded nudge a written rule would produce.
   * Type-checking runs whole because a file checked alone is checked without
   * the project's settings, so it is asked at most once a turn; linting names
   * the files and can run as often as they change.
   */
  let typesAskedThisTurn = false;
  /** Whether this project type-checked the first time we looked.
   *
   * A folder that was already unhappy before anybody touched it will be unhappy
   * after every edit, and nudging the model to repair something it did not
   * break is a loop that wastes somebody's money on a problem they already knew
   * about. So the first answer of a sitting is a reading, not a verdict: green
   * means later failures are ours to mention, red means this project is not
   * type-clean today and we say nothing more about it. */
  let typesWereGreen: boolean | null = null;
  async function verifyWhatChanged(call: ToolCall): Promise<void> {
    const root = options.projectRoot;
    if (root === undefined || !changesAnything(call, facts)) return;
    if (!repairIsListening()) return;
    const touched = sourceAmong(describeCall(call).paths);
    if (touched.length === 0) return;

    const entries = await readdir(root).catch(() => [] as string[]);
    for (const check of checksAfterChange(entries, touched)) {
      if (check.key === 'types') {
        if (typesAskedThisTurn || typesWereGreen === false) continue;
        typesAskedThisTurn = true;
      }
      const ran = await runHelper(check.tool, check.args, {
        folder: root,
        patience: VERIFY_PATIENCE,
      }).catch(() => null);
      // Not installed, or it could not be started: nothing to say. A check we
      // cannot run is not a failing check, and must not read as one.
      if (check.key === 'types' && typesWereGreen === null) {
        // The first reading of the sitting only tells us where we started.
        typesWereGreen = ran !== null && !notHere(ran) && ran.code === 0;
        if (!typesWereGreen) continue;
      }
      if (ran === null || notHere(ran) || ran.code === 0) continue;
      const decision = repairs.try({ check: check.key, file: touched.join(',') });
      if (!decision.allow) continue;
      const said = [
        saysFailed(check.key, touched),
        repairPrompt(check.key, touched.join(','), decision.attempt),
      ].join('\n');
      await steerRepair?.(said).catch(() => undefined);
      return;
    }
  }

  /**
   * What the project has to say about something that already happened.
   *
   * Nothing here can undo it — the moment for that was beforeCall. What it can
   * do is name the check that now needs running, and hand the model a sentence
   * about what it just did. Wired with the same cap atTheEnd already has: a
   * catch-all after rule would otherwise emit on every write forever.
   */
  function handleAfterCall(call: ToolCall): void {
    // What the project can check about itself, whether or not it wrote rules.
    // A folder that type-checks and lints has said what "still fine" means; it
    // should not also have to write a file asking us to look.
    void verifyWhatChanged(call);
    if (house.rules.length === 0) return;
    const after = afterCall(call, house, desk.world());
    if (after.sayBack.length > 0 && afterAlready < MOST_AFTER_SAYINGS) {
      afterAlready += 1;
      // The person sees why verification is happening. Do not emit message-end
      // in the middle of a live tool loop; Pi owns the real message boundary.
      options.onEvent({ type: 'message-delta', text: `\n\n${after.sayBack.join('\n')}` });
    }

    if (!repairIsListening()) return;
    const files = [...describeCall(call).paths].map((one) => one.trim()).filter((one) => one !== '').sort();
    // One incident names the whole touched set. Unknown command paths share the
    // stricter check-wide bucket rather than inventing a file from output text.
    const file = files.length === 0 ? undefined : files.join(',');
    for (const check of after.run) {
      const decision = repairs.try({ check, ...(file === undefined ? {} : { file }) });
      if (!decision.allow) continue;
      const instruction = [
        ...after.sayBack,
        repairPrompt(check, file, decision.attempt),
      ].join('\n');
      // tool-end arrives while Pi's loop is still streaming, which is the safe
      // steering window. If that changes in a future Pi version the nudge is
      // simply not sent; the visible rule sentence and atTheEnd fallback remain.
      void steerRepair?.(instruction).catch(() => undefined);
      break;
    }
  }

  const relay = new EventRelay(say, {
    billedSoFar,
    onToolEnd: ({ call, ok }) => {
      // Post-action rules describe something that actually happened. A failed
      // tool result changed nothing and must not start a verification cycle.
      if (ok && call !== undefined) handleAfterCall(call);
    },
  });
  const confirmations = new Confirmations();

  const review = createGuardInterceptor({
    facts,
    relay,
    confirmations,
    timeline: options.timeline,
    planning: () => planning,
    rules: () => house,
    world: desk.world,
    filesMayHaveMoved: forgetChecks,
  });

  const runtime = await runtimeFor(agentDir);
  /** Filled while the loader runs, which is before anything below can read it. */
  let carried: readonly Carried[] = [];
  const loader = new pi.DefaultResourceLoader({
    cwd: options.projectRoot,
    agentDir,
    // Extensions are on, but only the ones the person chose for themselves.
    // `extensionsOverride` runs after discovery and before anything is
    // installed into the session, so it is the one place a rule like that can
    // be enforced — see `onlyTheirs` for what it keeps.
    noExtensions: false,
    extensionsOverride: theirsAndTrusted(
      options.projectRoot,
      options.trusts ?? (() => false),
      (found) => {
        carried = found;
      },
    ),
    noThemes: true,
    extensionFactories: [
      {
        name: 'graphe-guard',
        factory: (api) => {
          api.on('tool_call', async (event) => review(asToolCall(event)));
        },
      },
    ],
  });
  // Skills and prompt templates that came with the *project* are text an
  // attacker can put in a repository, and Pi would otherwise load them straight
  // into the system prompt of an agent holding somebody's folder open. Trusted
  // only once the person has been shown what arrived and said yes; the ones from
  // their own home directory are theirs and load as normal.
  await loader.reload({
    resolveProjectTrust: async () => (options.trustProject ?? (() => false))(),
  });

  // Graphe's own tools — the web search and the task helper — travel as Pi's
  // `customTools`, which keeps them out of the extension machinery entirely:
  // no discovery, no third-party injection point, no name collision with
  // something a plugin registered. The Guard still sees every one of their
  // calls, because they are ordinary tool calls like any other.
  // The chosen model, resolved here where the model objects live. A choice
  // that no longer exists — the provider removed it, or the ids changed — is
  // simply no choice: Pi falls back to whatever the account makes available
  // rather than the window learning about it as a failure.
  const chosen = options.model;
  const model =
    chosen === null || chosen === undefined
      ? undefined
      : runtime.getModel(chosen.providerId, chosen.modelId) ?? undefined;

  // A helper thinks with whatever this session thinks with. Resolved here and
  // handed over, because the child has no settings of its own to fall back on.
  const forHelpers =
    model === undefined
      ? firstUsable(runtime)
      : { providerId: model.provider, modelId: model.id };

  const customTools = grapheTools(
    agentDir,
    options.figmaToken,
    forHelpers,
    options.thinking,
    options.projectRoot,
    options.putOnBoard,
    desk.noting,
  );

  /* The anchored edit and its read: the model reads a file, the read's reply
     carries the file's fingerprint, and an edit can name lines plus that
     fingerprint instead of retyping the old text — refused cleanly if the
     file has moved on. Both keep the built-in names, so the model sees one
     `read` and one `edit` and the Guard's rows hold. Pi's own tools stay
     underneath as the exact-text path and the actual reading. */
  const piRead = pi.createReadToolDefinition(options.projectRoot);
  const piEdit = pi.createEditToolDefinition(options.projectRoot);
  customTools.push(
    taggedReadTool({
      cwd: options.projectRoot,
      delegate: (params, signal) =>
        piRead.execute('graphe-read', params, signal, undefined, undefined as never),
    }),
    anchorEditTool({
      cwd: options.projectRoot,
      delegate: (params, signal) =>
        piEdit.execute(
          'graphe-edit',
          params as Parameters<typeof piEdit.execute>[1],
          signal,
          undefined,
          undefined as never,
        ),
    }),
    readDiffTool(options.projectRoot),
  );

  /* The project's memory: a note store beside the conversation, one database
     per project, opened with the app's embedding engine when it can load. A
     machine that cannot (no model yet, no network for the first download)
     still gets word-based recall — the engine degrades, never fails. */
  let memory: MemoryStore | null = null;
  try {
    memory = await openMemory({
      dbPath: join(agentDir, 'memory', memoryFileName(options.projectRoot)),
      embedder: defaultEmbedder(),
    });
    customTools.push(...memoryTools(memory));
  } catch {
    // No memory, no ceremony: the tools simply are not there, and nothing else
    // in the session cares.
    memory = null;
  }

  /* The debugger sessions this sitting holds: attached programs, closed with
     the session so nothing is left paused or held. */
  const debugRegistry = newDebugRegistry();
  customTools.push(...debugTools(debugRegistry));

  /* Work that answers by staying up: servers, watchers, anything the ordinary
     shell would either wait forever for or let die with the command that
     started it. Desktop sessions share the project's register; standalone
     sessions own one and close it themselves. */
  const ownsRunning = options.running === undefined;
  const keptRunning = options.running ?? new Running();
  customTools.push(
    ...runningTools(keptRunning, {
      folder: options.projectRoot,
      parts: () => {
        const config = pi.getShellConfig(settings.shell);
        return { shell: config.shell, args: config.args };
      },
      writable: shellBounds(options.projectRoot, options.projectRoot).writable,
      // A door of this copy's own. The project itself keeps the ordinary one,
      // so the folder somebody is looking at behaves exactly as it always did;
      // it is the copies that would otherwise collide.
      port:
        options.mainFolder !== undefined && options.mainFolder !== options.projectRoot
          ? PORTS.claim(options.projectRoot)
          : null,
      ...(options.noteServers === undefined ? {} : { noted: options.noteServers }),
      onChange: () => {
        say({ type: 'running', pieces: keptRunning.list() });
      },
    }),
  );

  /* The plugged-in tool servers (MCP), read from the project's own .pi/mcp.json.
     Nothing starts until the model actually calls one of them, and every call
     travels through the Guard like any other tool call. */
  const mcpRegistry = new McpRegistry(
    inProject(await readMcpConfig(options.projectRoot), options.projectRoot),
  );
  // Always registered. It used to appear only once a project already had a
  // server, so a tool connected during a conversation could not be used until
  // the next one — and a typo in the file meant no tool at all and no way to
  // say why. With nothing connected it answers that nothing is, which is a
  // sentence the model can act on.
  customTools.push(mcpTool(mcpRegistry));

  // The shell is Pi's tool, not ours, and it is the one that can change
  // anything on this disk. Pi builds it from `createBashToolDefinition`, whose
  // `operations` seam is where a command is actually run — so the same
  // definition, built here with a runner that wraps every command in the
  // computer's own boundary first, and handed over as a custom tool. A custom
  // tool of the same name replaces the built-in in Pi's registry, so the model
  // sees one `bash`, described exactly as Pi describes it, and the Guard's hook
  // fires on it exactly as before.
  //
  // The folder held is the one this session was opened on. That may be a copy
  // rather than the project on screen, which is precisely why it is read from
  // the options rather than worked out here.
  //
  // The shell somebody chose for themselves is still the shell: it is read the
  // same way Pi reads it and put inside the boundary, rather than replaced by
  // one of ours.
  const settings = ((): { shell?: string; prefix?: string } => {
    try {
      const chosenShell = pi.SettingsManager.create(options.projectRoot, agentDir);
      return { shell: chosenShell.getShellPath(), prefix: chosenShell.getShellCommandPrefix() };
    } catch {
      return {};
    }
  })();
  const localShell = pi.createLocalBashOperations({ shellPath: settings.shell }).exec;
  const fullAccessShell = loginShell(
    process.env['SHELL'] ?? settings.shell ?? (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash'),
    localShell,
  );
  const shell = heldShell({
    folder: options.projectRoot,
    // The runner reads this immediately before every command, so changing the
    // session's autonomy setting applies to the next command without replacing
    // the current conversation.
    unrestricted: () => facts.howFar === 'doing',
    parts: () => {
      const config = pi.getShellConfig(settings.shell);
      // A shell fed its command down a pipe is not one we can name on a command
      // line, so it runs unheld rather than wrongly.
      if (config.commandTransport === 'stdin') throw new Error('nothing to name');
      return { shell: config.shell, args: config.args };
    },
    plain: localShell,
    unrestrictedPlain: fullAccessShell,
  });
  const boundShell = pi.createBashToolDefinition(options.projectRoot, {
    operations: shell,
    ...(settings.prefix === undefined ? {} : { commandPrefix: settings.prefix }),
  });

  /* Our own ids rather than Pi's `Model`, so no Pi shape leaves this file. */
  let inUse: { providerId: string; modelId: string } | null =
    model === undefined || chosen === null || chosen === undefined ? null : chosen;

  // The manager stays in our hands after the session is built, because the read
  // side of a resumed conversation needs the same manager that will keep
  // writing to it. `continueRecent` resumes the newest session for this folder,
  // or starts one when there is none yet — so "open the project again" is the
  // whole of B1.1, and nothing else has to decide anything. `create` is the one
  // case that must not do that: somebody asking for a new conversation and being
  // handed the last one back is a button that does nothing.
  const manager =
    options.sessionPath === undefined
      ? options.sessionDir === undefined
        ? pi.SessionManager.inMemory(options.projectRoot)
        : options.fresh === true
          ? pi.SessionManager.create(options.projectRoot, options.sessionDir)
          : pi.SessionManager.continueRecent(options.projectRoot, options.sessionDir)
      : pi.SessionManager.open(options.sessionPath);

  let session;
  try {
    session = (
      await pi.createAgentSession({
        cwd: options.projectRoot,
        agentDir,
        resourceLoader: loader,
        // Naming `tools` at all switches Pi from "the four defaults plus every
        // custom tool" to "exactly this list", so ours have to be in it or they
        // vanish. Taken off the tools themselves rather than written twice.
        tools: [...WORKING_TOOLS, ...customTools.map((tool) => tool.name)],
        // Cast because Pi's own bash definition is narrower in its schema than
        // the list it goes into; Pi assigns it the same way internally.
        customTools: [...customTools, boundShell as (typeof customTools)[number]],
        modelRuntime: runtime,
        model,
        ...(options.thinking === undefined ? {} : { thinkingLevel: options.thinking }),
        sessionManager: manager,
      })
    ).session;
  } catch (cause) {
    // Overwhelmingly this is "no model is set up yet". The app owns sign-in;
    // all we can do is say so without a stack trace.
    throw new AdapterError('I am not set up to work yet.', { cause });
  }

  running = session;
  repairIsListening = () => session.isStreaming;
  steerRepair = async (text: string): Promise<void> => {
    // Pi drains steering only from a run already in flight. Never turn a late
    // after-call result into a fresh prompt: that is the unbounded loop this
    // host-owned budget exists to prevent. The budget is consumed only after
    // repairIsListening passed immediately above.
    if (!session.isStreaming) return;
    await session.steer(text);
  };
  alreadyBilled = rawBill() ?? 0;

  const unsubscribe = session.subscribe((event) => {
    relay.fromPi(event);
  });

  let closed = false;

  /**
   * Tidy a long conversation up, using Pi's own tidying and nobody else's.
   *
   * COST-DESIGN §5 and REUSE-PI.md, which is blunt about this: our "we've
   * covered a lot in here" is **a wrapper over Pi's compaction, not our own
   * summariser**. Everything below is arithmetic on two numbers Pi hands us and
   * one call to `session.compact()`. There is no prompt here, no model call of
   * ours, and no text we generate.
   *
   * ## Why we ask at all, when Pi already does this by itself
   *
   * Pi's automatic threshold is left on and is the backstop. But it fires when
   * the conversation is nearly full, which is both the most expensive moment and
   * the worst one to interrupt — it happens mid-turn, in the middle of somebody
   * waiting for an answer. Doing it a little earlier, in the gap after a turn
   * has finished, means the tidying is the only thing happening and the sentence
   * about it does not arrive on top of half a reply.
   *
   * "A little earlier" is Pi's own `shouldCompact` with Pi's own settings and a
   * larger reserve. Not a threshold of our own invention: if Pi changes how the
   * decision is made, this changes with it.
   *
   * Everything is read defensively through small holes. A Pi upgrade that moves
   * `getContextUsage` costs us the early tidy, not the session.
   */
  const early = {
    ...pi.DEFAULT_COMPACTION_SETTINGS,
    reserveTokens: pi.DEFAULT_COMPACTION_SETTINGS.reserveTokens * 2,
  };

  /** Read through the same small hole the automatic tidy reads through: a Pi
   *  upgrade that moves this costs a meter, not a session. */
  const roomNow = (): Room | null => {
    try {
      const usage = session.getContextUsage();
      if (usage === undefined || usage.contextWindow <= 0) return null;
      if (usage.tokens === null) {
        return { used: null, total: usage.contextWindow, part: null };
      }
      return {
        used: usage.tokens,
        total: usage.contextWindow,
        part: Math.min(1, Math.max(0, usage.tokens / usage.contextWindow)),
      };
    } catch {
      return null;
    }
  };

  const tidyIfItHasGrownLong = async (): Promise<void> => {
    if (closed) return;
    try {
      if (session.isCompacting) return;
      const usage = session.getContextUsage();
      if (usage === undefined || usage.tokens === null) return;
      if (!pi.shouldCompact(usage.tokens, usage.contextWindow, early)) return;
      // The window hears about this from Pi's own `compaction_start`, which the
      // relay is already translating — so there is nothing to announce here, and
      // nothing that could announce a tidy that did not happen.
      await session.compact();
    } catch {
      // Pi's automatic threshold is still on and will do this itself when it
      // has to. A conversation that stayed long is not worth a sentence.
    }
  };

  /** Read through one hole apiece, because a conversation that will not list
   *  its moments is a feature missing, not a session broken. */
  const markOf = (id: string): string | null => {
    try {
      return manager.getLabel(id) ?? null;
    } catch {
      return null;
    }
  };

  let activePrompts = 0;

  const momentsNow = (): readonly Moment[] => {
    try {
      return momentsFromEntries(manager.buildContextEntries(), markOf);
    } catch {
      return [];
    }
  };

  return {
    async prompt(
      text: string,
      images?: readonly ImageCard[],
      options?: { lookFirst?: boolean; queue?: 'followUp' },
    ): Promise<void> {
      if (closed) throw new AdapterError('That project is no longer open.');
      sayRulesDiagnostics();
      repairs.beginTurn();
      typesAskedThisTurn = false;
      activePrompts += 1;
      const looking = options?.lookFirst === true;
      if (looking) {
        planning = true;
        proposed = '';
        say({ type: 'planning' });
      }
      try {
        // Pi's own envelope, made only at this seam: nothing outside this file
        // ever hears the words `ImageContent`. The pictures are sent only when
        // there are some — an empty array is not an image to attach.
        const withPictures =
          images === undefined || images.length === 0
            ? undefined
            : {
                images: images.map((picture) => ({
                  type: 'image' as const,
                  data: picture.bytes,
                  mimeType: picture.mimeType,
                })),
              };
        // A sitting starts with the notes it will need, so the memory is used
        // without anyone having to know it exists. Only the first question of
        // a sitting carries them, and only when there is something to carry.
        let said = looking ? `${text}\n\n${PLAN_WORDS.asked}` : text;
        if (firstTurn) {
          firstTurn = false;
          if (memory !== null) {
            try {
              const notes = await memory.recall('', { limit: 4 });
              if (notes.length > 0) {
                said = `A few notes I keep about this project, most relevant first:\n${notes
                  .map((note) => `- ${note.content}`)
                  .join('\n')}\n\n${said}`;
              }
            } catch {
              // A memory that will not answer is a memory not worth a sentence.
            }
          }
        }
        // The window chose to queue this message behind the run in flight
        // (the composer's "queue it" option). Pi delivers a prompt marked
        // followUp after the current turn finishes, without interrupting it.
        if (options?.queue === 'followUp') {
          const queued =
            withPictures === undefined
              ? { streamingBehavior: 'followUp' as const }
              : { ...withPictures, streamingBehavior: 'followUp' as const };
          await session.prompt(said, queued);
        } else {
          try {
            await session.prompt(said, withPictures);
          } catch (cause) {
            // Pi refuses a second prompt while a turn is still running unless
            // it is told how to queue it. The window can ask while the agent
            // is mid-turn (the gap between "sent" and the first visible step),
            // so a message that arrives like that is queued as a follow-up
            // rather than thrown back as a raw error. See the steer path for
            // the interrupt choice.
            if (!isAlreadyProcessing(cause)) throw cause;
            const queued =
              withPictures === undefined
                ? { streamingBehavior: 'followUp' as const }
                : { ...withPictures, streamingBehavior: 'followUp' as const };
            await session.prompt(said, queued);
          }
        }
      } catch (cause) {
        const message = plainly(cause);
        relay.failed(message);
        throw new AdapterError(message, { cause });
      } finally {
        if (looking) {
          planning = false;
          say({ type: 'planned', ...parseProposal(proposed) });
        }
        // After the reply, never during it: `compact()` aborts whatever is
        // running first, so calling it mid-turn would abandon the answer
        // somebody is waiting for in order to tidy the notes about it.
        //
        // In the finally rather than after the try, because the turn that most
        // needs tidying is the one that failed *because* the window was full —
        // and rethrowing before this line left it exactly as full, so the next
        // turn failed the same way, and the one after that. It only acts when
        // the conversation really has grown long, and it never throws.
        await tidyIfItHasGrownLong();
        activePrompts = Math.max(0, activePrompts - 1);
      }
    },

    async useModel(next): Promise<boolean> {
      if (closed) return false;
      // Pi has no "no model" to set, so clearing only affects the next session.
      if (next === null) {
        inUse = null;
        return true;
      }
      const resolved = runtime.getModel(next.providerId, next.modelId);
      if (resolved === undefined) return false;
      try {
        await session.setModel(resolved);
      } catch {
        return false;
      }
      inUse = next;
      return true;
    },

    get model(): { providerId: string; modelId: string } | null {
      return inUse;
    },

    get thinking(): ThinkingLevel {
      return session.thinkingLevel as ThinkingLevel;
    },

    get thinkingLevels(): readonly ThinkingLevel[] {
      try {
        return session.getAvailableThinkingLevels() as ThinkingLevel[];
      } catch {
        return ['off'];
      }
    },

    setThinking(level: ThinkingLevel): ThinkingLevel {
      if (closed) return session.thinkingLevel as ThinkingLevel;
      session.setThinkingLevel(level);
      return session.thinkingLevel as ThinkingLevel;
    },

    async stop(): Promise<void> {
      // Said out loud, because nothing else says it. A question is only ever
      // closed in the window by the window's own answer, so one answered here
      // left a card on screen whose answer could never arrive — and an
      // unanswered card reads as "still working", which is why Stop looked
      // dead while the run behind it had already ended.
      const withdrawn = confirmations.abandonAll();
      if (withdrawn.length > 0) say({ type: 'questions-withdrawn', callIds: withdrawn });
      await session.abort();
      // The run is over whatever pi did with the abort. Saying so is what puts
      // the composer back to Send; waiting for an event that may not come is
      // how the button stayed a spinner.
      say({ type: 'settled' });
    },

    get listening(): boolean {
      if (closed) return false;
      return session.isStreaming;
    },

    get working(): boolean {
      return !closed && activePrompts > 0;
    },

    async steer(text: string, images?: readonly ImageCard[]): Promise<void> {
      if (closed) throw new AdapterError('That project is no longer open.');
      // Same envelope the prompt makes: nobody outside this file hears the
      // word `ImageContent`. Pi's steer lands the message mid-turn and lets
      // the current run carry on — it does not start a separate one.
      const withPictures =
        images === undefined || images.length === 0
          ? undefined
          : {
              images: images.map((picture) => ({
                type: 'image' as const,
                data: picture.bytes,
                mimeType: picture.mimeType,
              })),
            };
      await session.steer(
        text,
        withPictures === undefined || withPictures.images.length === 0
          ? undefined
          : withPictures.images,
      );
    },

    forgetChecks(): void {
      desk.forget();
    },

    dispose(): void {
      if (closed) return;
      closed = true;
      confirmations.abandonAll();
      unsubscribe();
      session.dispose();
      void shell.close();
      void mcpRegistry.close();
      void memory?.close().catch(() => {});
      // A standalone/in-memory session owns its servers. Desktop project
      // sessions share a project register, so rebuilding one conversation must
      // not take down a server the project is still using.
      if (ownsRunning) keptRunning.stopAll();
      for (const attached of debugRegistry.sessions.values()) {
        void debug.detach(attached).catch(() => {});
      }
    },

    answer(callId: string, decision: Decision): boolean {
      return confirmations.answer(callId, decision);
    },

    get awaitingAnswer(): readonly string[] {
      return confirmations.pending;
    },

    get room(): Room | null {
      return roomNow();
    },

    /**
     * The same tidying the session does for itself, asked for by hand.
     *
     * Pi's own compaction and nothing else — no prompt of ours, no summariser
     * of ours. The window hears about it through Pi's `compaction_start`, which
     * the relay already translates, so there is nothing to announce here.
     */
    /* Mutated rather than rebuilt: the interceptor reads these facts on every
       call, so the switch takes effect on the next tool call and not on the
       next session. */
    stopAsking(on: boolean): void {
      facts.stopAsking = on;
    },

    get quiet(): boolean {
      return facts.stopAsking === true;
    },

    goAsFarAs(howFar: HowFar): void {
      facts.howFar = howFar;
    },

    get howFar(): HowFar {
      return facts.howFar ?? 'asking';
    },

    get running(): readonly RunningPiece[] {
      return keptRunning.list();
    },

    async stopRunning(id: string): Promise<boolean> {
      const stopped = await keptRunning.stop(id);
      if (stopped) keptRunning.forgetStopped();
      say({ type: 'running', pieces: keptRunning.list() });
      return stopped;
    },

    get carried(): readonly Carried[] {
      return carried;
    },

    async tidyNow(): Promise<boolean> {
      if (closed) return false;
      try {
        if (session.isCompacting) return false;
        await session.compact();
        return true;
      } catch {
        return false;
      }
    },

    // Read when asked, not once at the top: a window reloading mid-sitting needs
    // the conversation as it stands, not as it was when the session was built.
    get history(): readonly AgentEvent[] {
      return eventsFromEntries(manager.buildContextEntries());
    },

    // Read on demand: `continueRecent` picks the file when the session starts,
    // and a new conversation has none until its first write.
    get conversation(): string | null {
      return manager.getSessionFile() ?? null;
    },

    get name(): string | null {
      try {
        return namedAs(session.sessionName);
      } catch {
        return null;
      }
    },

    rename(name: string): boolean {
      if (closed) return false;
      const kept = namedAs(name);
      if (kept === null) return false;
      try {
        session.setSessionName(kept);
        return true;
      } catch {
        return false;
      }
    },

    get moments(): readonly Moment[] {
      return momentsNow();
    },

    async tryAnotherDirection(momentId: string): Promise<string | null> {
      if (closed) return null;
      // Checked against the conversation as it stands first, so an id from
      // somewhere else is an answer rather than a throw from underneath.
      const moment = momentToReturnTo(momentsNow(), momentId);
      if (moment === null) return null;
      try {
        // Pi rewinds to just before the chosen message and hands its words back
        // for the composer, which is exactly "say that again, differently".
        const back = await session.navigateTree(momentId);
        return back.cancelled ? null : back.editorText ?? moment.said;
      } catch {
        // Mid-reply is the ordinary case here, and it is a no, not a failure.
        return null;
      }
    },

    takeBackQueue(): TakenBack {
      // A session that is over holds nothing, which is an empty line rather
      // than a refusal.
      if (closed) return { ok: true, steering: [], followUp: [] };
      return takingBack(() => session.clearQueue());
    },

    mark(momentId: string, note: string): boolean {
      if (closed) return false;
      if (momentToReturnTo(momentsNow(), momentId) === null) return false;
      try {
        manager.appendLabelChange(momentId, namedAs(note) ?? undefined);
        return true;
      } catch {
        return false;
      }
    },
  };
}
