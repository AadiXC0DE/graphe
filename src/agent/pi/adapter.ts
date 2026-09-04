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
import {
  asksAboutTheScreen,
  changesAnything,
  describeCall,
  evaluate,
  requiresSnapshot,
  worksAScreen,
} from '../guard/policy';
import { containsPath } from '../guard/paths';
import { afterCall, atTheEnd, beforeCall, readRules, rulesFile, RULE_WORDS, type Rules, type World } from '../hooks';
import { readAgentsMd } from '../../lib/agentsMd';
import {
  AGENTS_BUDGET,
  PROMPT_BUDGET,
  saysPromptSize,
  standingWords,
  withinBudget,
} from './standing';
import {
  ALWAYS_WORDS,
  alwaysFile,
  alwaysFrom,
  commandFor,
  worthRunning,
  type When,
} from '../../work/always';
import type { HowFar } from '../guard/policy';
import { PLAN_WORDS, parseProposal, withheldWhilePlanning } from '../plan';
import type { AgentEvent, ImageCard, SettledHow, ToolCall, Verdict } from '../types';
import type { Timeline } from '../../history/timeline';
import { EventRelay } from './events';
import { RepairCoordinator, repairPrompt } from './repair';
import { checksAfterChange, saysFailed, sourceAmong } from './verify';
import { notHere, runHelper } from '../../share/run';
import { readdir, realpath } from 'node:fs/promises';
import {
  NOTES_CARRIED,
  WORTH_KEEPING,
  eventsFromEntries,
  momentToReturnTo,
  momentsFromEntries,
  type Moment,
} from './history';
import { namedAs, readConversations, type Conversation } from './conversations';
import { PORTS_HELD as PORTS } from '../../work/ports';
import { browserFolder, closeBrowser } from './computer';
import { grapheTools, memoryTools, readDiffTool, debugTools, newDebugRegistry, runningTools, type ChecksNoted, type PutOnBoard, type StepMoved, type CancelBuild, type MakeChecklist, type HelperModel, type HelperPace } from './tools';
import { lspTool } from './lsp';
import { whatWasChecked } from './checks';
import { anchorEditTool, taggedReadTool } from './anchor-edit';
import * as debug from './debug';
import { McpRegistry, inProject, mcpTool, readMcpConfig } from './mcp';
import { parseReview } from './review';
import { askWords, cannotAsk, saysAnswers, tidyQuestions, type Answers } from '../asking';
import { CARRY_ON, isTransientStreamError, WAITS_MS } from './transient';
import { maskToolResult } from './redact';
import { cachedProbe, extensionPathsIn, saysCard, type CapabilityCard } from './extension-probe';

import { recentOverruns, withHookBudget } from './hook-budget';
import {
  dropsEntirely,
  dropsLifecycleHooks,
  policyFor,
  type Policy,
  type SessionKind,
} from './extension-policy';

/** The folder an add-on lives in, which is what its author called it. */
function nameFromPath(where: string): string {
  const parts = where.split(/[\\/]/).filter((part) => part !== '');
  return parts[parts.length - 1] ?? 'an add-on';
}

/** The hooks that let an add-on end, extend or restart a turn. Dropped for one
 *  that starts turns of its own; its tools still work. */
const LIFECYCLE_HOOKS: readonly string[] = [
  'agent_end',
  'agent_settled',
  'turn_end',
  'turn_start',
  'session_compact',
  'before_agent_start',
];

/** What the window is told when something outside Graphe is refusing every
 *  step. Said as a notice rather than an error: the conversation did nothing
 *  wrong, and painting it red for an add-on's decision is the app blaming the
 *  work for its own housekeeping. */
const ADDON_BLOCKED = 'An add-on has stopped every step of this run.';

import { defaultEmbedder, memoryFileName, memoryWords, openMemory, type MemoryStore } from '../memory';
import { heldShell, loginShell, shellBounds } from '../sandbox/shell';
import { Running, type RunningPiece } from '../running';
import {
  collectAccounts,
  credentialFor,
  readFoundCredentials,
  type FoundAccount as FoundOnDisk,
} from './importers';

import { readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';

import {
  ADVISOR_SETTINGS_FILE,
  advisorSettings,
  advisorToolNames,
  extensionToolNames,
  type LoadedExtension,
} from '../advisor';
import { SUBAGENT_SETTINGS_FILE, artifactsBesideSessions, subagentsLoaded } from './subagents';
import { idFor } from '../../projects/carried';
import type { ModelChoice, ThinkingLevel } from '../../lib/ipc';

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
const SYMLINK_ESCAPE =
  'This path reaches somewhere outside your project folder through a link, so I have left it alone.';
/**
 * Turn the advisor's tools on or off on a session already running.
 *
 * The names stay in the allowlist either way; only whether they are active
 * changes, so one press takes effect on the next step. False when the switch
 * did not take — an older Pi has no such call and keeps the tools the
 * conversation started with, which is a chip and an advisor that disagree
 * until somebody is told.
 */
export function switchAdvisorTools(
  session: {
    getActiveToolNames: () => readonly string[];
    setActiveToolsByName: (names: string[]) => unknown;
  },
  tools: readonly string[],
  on: boolean,
): boolean {
  if (tools.length === 0) return true;
  try {
    const active = new Set(session.getActiveToolNames());
    for (const name of tools) {
      if (on) active.add(name);
      else active.delete(name);
    }
    session.setActiveToolsByName([...active]);
    return true;
  } catch {
    return false;
  }
}

/** What the user reads when the advisor switch did not take. */
export const ADVISOR_STUCK =
  'I could not switch the advisor in this conversation: the version of Pi installed keeps the tools a conversation started with. The choice is saved, so it stands from the next time this project is opened.';

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

/**
 * A turn held between steps, so somebody can take the machine back.
 *
 * The same parking as `Confirmations`: the promise the extension hook handed
 * back has not resolved, so the agent loop has not reached the next
 * `tool.execute`. What is different is that this is nobody's question — it is a
 * person saying "wait there" while they look at a page, move a window or put
 * something right. Letting go carries on from wherever things now are, because
 * the next step reads the world again rather than trusting what it remembered.
 *
 * A step already running is not interrupted. Holding a turn is not stopping it,
 * and a half-finished press is worse than either.
 */
export class Paused {
  private held = false;
  private waiting: (() => void)[] = [];

  get on(): boolean {
    return this.held;
  }

  hold(on: boolean): void {
    this.held = on;
    if (!on) this.letGo();
  }

  /** Where a turn waits. Resolves at once when nothing is holding it. */
  gate(): Promise<void> {
    if (!this.held) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.waiting.push(resolve);
    });
  }

  /** Stopping releases everything: a held turn must never outlive the stop that
   *  was meant to end it. */
  letGo(): void {
    const open = this.waiting;
    this.waiting = [];
    for (const resolve of open) resolve();
  }
}

/**
 * The one set of questions a turn is allowed to stop for, and who has answered.
 *
 * The same parking as `Confirmations` and for the same reason: the promise
 * handed back to the tool has not resolved, so the model is genuinely waiting
 * rather than being told to wait. What differs is the answer — a set of picks
 * rather than a yes — and that an unanswered one resolves to "decide it
 * yourself" instead of "no". A question nobody answers must never stop work.
 */
export class Asking {
  private readonly waiting = new Map<string, (answers: Answers | null) => void>();

  get pending(): readonly string[] {
    return [...this.waiting.keys()];
  }

  ask(id: string): Promise<Answers | null> {
    return new Promise<Answers | null>((resolve) => {
      this.waiting.get(id)?.(null);
      this.waiting.set(id, resolve);
    });
  }

  /** Null is a real answer: it is somebody saying "just decide for me". */
  answer(id: string, answers: Answers | null): boolean {
    const resolve = this.waiting.get(id);
    if (resolve === undefined) return false;
    this.waiting.delete(id);
    resolve(answers);
    return true;
  }

  /** Stopping or closing lets every open question go. Never left hanging: the
   *  turn is over, and a promise nobody will resolve holds the loop forever. */
  abandonAll(): readonly string[] {
    const ids = [...this.waiting.keys()];
    const open = [...this.waiting.values()];
    this.waiting.clear();
    for (const resolve of open) resolve(null);
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
  /** Where a turn waits when somebody has asked it to. Left out, nothing ever
   *  waits, which is what every caller meant before there was a way to ask. */
  paused?: Paused;
  /** Where restore points go. Without one, a `snapshot-first` call still runs —
   *  the host chose to open a session with no history — but it runs with no way
   *  back, which is why `createSession` takes a Timeline and expects one. */
  timeline?: SnapshotSource | undefined;
  /** True while the turn is only allowed to look. Anything that could change
   *  the project is refused with a sentence telling the model to propose it
   *  instead, which is the whole of planning before doing. */
  planning?: () => boolean;
  /** True while Plan is on. Unlike `planning`, which lasts one look-around
   *  pass, this stays until somebody exits it. */
  planMode?: () => boolean;
  /** The project's own rules, as they were read. They can only ever make an
   *  answer harder, so a project that carries none changes nothing here. */
  rules?: () => Rules;
  /** What has actually been checked, for a rule that asks about it. A check
   *  nobody has run holds a turn exactly as a failing one does. */
  world?: () => World;
  /** Told about a call before it runs, so anything already checked can be
   *  forgotten when the files are about to move under it. */
  filesMayHaveMoved?: (call: ToolCall) => void;
  /** This call has passed everything and is about to run. Not the same moment
   *  as being asked for: a call the Guard refuses never happens, and must not
   *  count as work having started. */
  workBegan?: (call: ToolCall) => void;
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
  const { facts, relay, confirmations, timeline, planning, planMode, rules, world, filesMayHaveMoved, workBegan } =
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

  /**
   * The policy table intentionally stays pure, so it can reject textual `..`
   * escapes without reading the disk. Here, immediately before the tool runs,
   * we also resolve the nearest existing ancestor. That catches a file that is
   * lexically under the project but reaches outside through a symlink.
   */
  const symlinkEscape = async (call: ToolCall): Promise<string | null> => {
    const root = await realpath(facts.projectRoot).catch(() => null);
    if (root === null) return null;
    for (const named of describeCall(call).paths) {
      const lexical = containsPath(facts.projectRoot, named);
      if (!lexical.inside || lexical.resolved === null) continue;
      let probe = lexical.resolved;
      while (true) {
        const actual = await realpath(probe).catch(() => null);
        if (actual !== null) {
          if (!containsPath(root, actual).inside) return SYMLINK_ESCAPE;
          break;
        }
        const parent = dirname(probe);
        if (parent === probe) break;
        probe = parent;
      }
    }
    return null;
  };

  return async function review(call: ToolCall): Promise<Interception> {
    filesMayHaveMoved?.(call);
    // Held before anything is judged, so a turn waits where it is rather than
    // one more step landing after somebody asked it to wait.
    if (options.paused?.on === true) {
      relay.waitingForYou(true);
      await options.paused.gate();
      relay.waitingForYou(false);
    }
    // Plan is read-only until somebody leaves it, and it outranks the autonomy
    // ladder: "go as far as you like" is standing permission, Plan is a
    // decision made on this message, and the later decision wins.
    if (planMode?.() === true && withheldWhilePlanning(call)) {
      relay.blocked(call, PLAN_WORDS.withheld);
      return { block: true, reason: PLAN_WORDS.withheld };
    }

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
      workBegan?.(call);
      relay.started(call);
      return undefined;
    }

    // Looking only. Withheld rather than refused-as-an-error: the model is told
    // to put it in the plan, which is the answer we actually want back.
    if (planning?.() === true && withheldWhilePlanning(call)) {
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
      if (asksAboutTheScreen(call)) facts.screenSaidYes = true;
    }

    if (describeCall(call).paths.length > 0) {
      const linkEscape = await symlinkEscape(call);
      if (linkEscape !== null) {
        relay.blocked(call, linkEscape);
        return { block: true, reason: linkEscape };
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

    workBegan?.(call);
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
  /** True for work nobody is sitting in front of. Such a run answers its own
   *  questions, so it is never given the tool that asks one. */
  unattended?: boolean;
  /** Evaluation-only: expose exactly Pi's seven working tools. This is never
   *  the desktop default; it exists so a controlled comparison can keep the
   *  model's tool surface identical across harnesses. */
  benchmarkToolFloor?: boolean;
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
  /** Give what this session starts a preview address of its own, decided by
   *  its folder. For work nobody is watching: several copies really do run the
   *  same start command at once, and a stable address is what a preview links
   *  to. A conversation someone is sitting in front of must not set this — it
   *  is meant to behave exactly like a terminal in that folder. */
  ownPort?: boolean;
  /** Somewhere to put a piece of background work. Given, the agent can break a
   *  request into pieces that run side by side; left out, it cannot — which is
   *  what keeps a run on the board from filling the board it is running on. */
  putOnBoard?: PutOnBoard;
  /** Tick one thing off the checklist the person can see. */
  stepMoved?: StepMoved;
  /**
   * Graphe's own standing block, asked for at the top of every model call.
   *
   * A function rather than a string: the checklist moves during a turn, and a
   * block captured when the conversation opened is a block that is wrong by the
   * second reply.
   */
  standing?: () => Promise<string | null>;
  /** Where provider credentials are read from, when the shell has written them
   *  out of the login keychain. Left out, Pi's own file is used — a plain file
   *  holding OAuth tokens and an API key. */
  authPath?: string;
  /** What kind of session this is, so an add-on that starts turns of its own is
   *  not loaded into a board piece or a helper. */
  sessionKind?: SessionKind;
  /** The person's own answer for this conversation, when they have given one. */
  addonsChosen?: Policy;
  /** The two gates the advisor can hold, both off unless somebody turned one
   *  on. Written into the advisor's own settings file every session start, so
   *  an existing file stops overriding what Graphe intends. */
  advisorGates?: { completionGate: boolean; loopGate: boolean };
  /**
   * Whether the job — not the round — is over.
   *
   * "Always do this at the end" used to run at the end of every round of a
   * carrying-on loop. The shell knows when the whole job has come to rest;
   * this asks it. Left out, every settle is a job ending, which is what it was
   * before there were rounds.
   */
  jobAtRest?: () => boolean;
  /** Cancel that checklist. Same reach as `stepMoved`, so it only exists where
   *  a list could. */
  cancelBuild?: CancelBuild;
  /** Write that checklist in the first place. */
  makeChecklist?: MakeChecklist;
  /** Whether this project's browser keeps what it is signed in to between
   *  sittings. Asked each time, so turning it off takes effect at once. */
  keepsBrowserLogins?: () => boolean;
  /** Sites the driven browser may reach at all. Asked each time, so the list
   *  in Settings takes effect at once. Left out, the environment decides. */
  browserSites?: () => readonly string[];
  /** A few sentences of fact about this folder, appended to the system prompt.
   *  For things the folder itself cannot say — that it holds several projects
   *  and git belongs inside each one, say. Facts only; never instructions
   *  somebody did not choose. */
  contextNotes?: readonly string[];
  /** Open in Plan: nothing that could change the project runs until somebody
   *  leaves it. A new conversation starts wherever the project last was. */
  planMode?: boolean;
  /** The model asked about the hard parts, or null for one model doing all of
   *  it. Only means anything with the advisor addition installed — without it
   *  there is no tool to turn on, and the choice sits waiting. */
  advisor?: ModelChoice | null;
  /** How long the advisor takes before answering. Left out, whatever is in the
   *  package's settings file stands. */
  advisorThinking?: ThinkingLevel | null;
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
  /** How many times this conversation has been shortened to make room. Zero
   *  for almost every sitting; the number is what explains a conversation that
   *  remembers less than somebody expects. */
  shortened: number;
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
  /** Ask a stronger model about the hard parts from now on, or null to have
   *  one model do all of it. Silent where the advisor addition is not
   *  installed: there is no tool to turn on, and the choice waits for it. */
  useAdvisor(choice: ModelChoice | null, thinks?: ThinkingLevel): Promise<void>;
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
  /** Hold the turn between steps, or let it go on. */
  holdOn(on: boolean): void;
  /** True while a turn is being held. */
  readonly held: boolean;
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
  /**
   * What each installed add-on will actually do, and what was done about it.
   *
   * Derived by asking the add-on, never from a list of names — the Add-ons page
   * draws its line straight from this, so an add-on published tomorrow is
   * described on the same evidence as one installed today.
   */
  readonly addons: readonly {
    name: string;
    says: string;
    policy: Policy;
    startsTurns: boolean;
    runsBackgroundWork: boolean;
    rewritesSystemPrompt: boolean;
  }[];
  /** Lifecycle handlers that ran past their budget, for the diagnostics. */
  readonly hookOverruns: readonly { extension: string; event: string; ms: number }[];
  /**
   * The notes this conversation would find most relevant, for the standing
   * block the system prompt carries.
   *
   * They used to be prepended to the first message of a sitting and nothing
   * else, so after the conversation was tidied up they were gone — and a long
   * job is exactly the one that gets tidied. Never throws: a memory that will
   * not answer is a memory not worth a sentence.
   */
  recall(about: string, most: number): Promise<readonly { content: string }[]>;
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
  /** Answer the questions asked before the work started. Null is a real
   *  answer — it is somebody saying to decide for them. False when that card
   *  has already been answered or the turn it belonged to has ended. */
  answerAsked(id: string, answers: Answers | null): boolean;
  /** How much of what the model can hold at once this conversation is using.
   *  Null before the model has answered once, and for a moment after a tidy —
   *  the count comes from the model's own reckoning, not ours. */
  readonly room: Room | null;
  /** Shorten the conversation now, rather than waiting for it to fill up. False
   *  when there is nothing to shorten or one is already going. */
  tidyNow(): Promise<boolean>;
  /** The sitting is over: write down anything about this project worth having
   *  next time. Silent, at most once, and only after a sitting that did
   *  something. False when there was nothing to do. */
  settleUp(): Promise<boolean>;
  /** Stop asking before things the Guard would otherwise check, for as long as
   *  this session lives. Restore points and outright refusals are unaffected —
   *  see `stopAsking` in the Guard's own facts. */
  stopAsking(on: boolean): void;
  /** Whether it is currently not asking. */
  readonly quiet: boolean;
  /** How far it may go on its own, for as long as this session lives. A
   *  ceiling on questions, never on what is refused. */
  goAsFarAs(howFar: HowFar): void;
  /** Computer-use enrolment for the rest of this session. Takes effect on the
   *  next tool call, not the next session. */
  setComputerUse(use: NonNullable<GuardFacts['computerUse']>): void;
  /** Plan Mode — persistent read-only until explicit Exit / Do it. */
  setPlanMode(on: boolean): void;
  /** Where the ladder is set right now. */
  readonly howFar: HowFar;
  /** What this session has kept running — servers, watchers, anything started
   *  to stay up. Empty for almost every sitting. */
  readonly running: readonly RunningPiece[];
  /** Everything one of them has said since it started, whole. Reading it does
   *  not move the cursor the agent's own reads use. */
  runningSaid(id: string): string;
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

/**
 * The runtime, imported once.
 *
 * It is 810ms of import on this machine, and it used to be paid by whoever
 * opened the first project — so the slowest thing the app ever does was the
 * first thing somebody asked it to do. `warmUp` moves it to the idle moment
 * after the window is on screen; the promise is shared, so a project opened
 * before it finishes waits on the same one rather than starting a second.
 */
let piLoading: Promise<Pi> | null = null;

async function loadPi(): Promise<Pi> {
  piLoading ??= import('@earendil-works/pi-coding-agent');
  try {
    return await piLoading;
  } catch (cause) {
    // A failed import must not be remembered as the answer: the next attempt
    // deserves its own try, and its own error.
    piLoading = null;
    throw new AdapterError('I could not start the part of me that does the work.', { cause });
  }
}

/** Start the import now, without waiting for it. Called when the window is up
 *  and nothing is being asked of the machine. Never throws — a warm-up that
 *  fails is a first project open that pays for itself, as it always did. */
export function warmUp(): void {
  void loadPi().catch(() => undefined);
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

/**
 * Where provider credentials are read from.
 *
 * Pi's own `auth.json` is a plain file holding OAuth tokens and an API key —
 * user-only, but plain. Given an `authPath` the shell wrote out of the login
 * keychain, that is the one used instead; given none, Pi's own is where it has
 * always been.
 */
function runtimeFor(agentDir: string, authPath?: string): Promise<PiRuntime> {
  const already = runtimes.get(agentDir);
  if (already !== undefined) return already;
  const pending = loadPi().then((pi) =>
    pi.ModelRuntime.create({
      authPath: authPath ?? join(agentDir, 'auth.json'),
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
function theirsTrustedAndPolicied(
  projectRoot: string,
  trusts: (id: string) => boolean,
  seen: (carried: readonly Carried[]) => void,
  policy: {
    kind: SessionKind;
    chosen?: Policy | undefined;
    cards: Map<string, CapabilityCard | null>;
    dropped: (one: { where: string; policy: Policy; card: CapabilityCard | null }) => void;
  },
) {
  const root = projectRoot.endsWith(sep) ? projectRoot : projectRoot + sep;
  return <T extends { extensions: readonly { resolvedPath?: string; path?: string }[] }>(
    base: T,
  ): T => {
    const carried: Carried[] = [];
    const kept = base.extensions.filter((one) => {
      const where = one.resolvedPath ?? one.path ?? '';
      if (where === '') return false;

      /* What this extension will do, worked out by asking it rather than by
         knowing its name. A card that was read and came back empty is treated
         as the riskiest kind; one that was never looked at at all is left
         alone, because "we did not check" is not evidence. */
      if (policy.cards.has(where)) {
        const card = policy.cards.get(where) ?? null;
        const verdict = policyFor(card, policy.kind, policy.chosen);
        if (dropsEntirely(verdict)) {
          policy.dropped({ where, policy: verdict, card });
          return false;
        }
      }

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

/**
 * Write the chosen advisor where the addition will look for it.
 *
 * The file is Pi's, not ours, and somebody may well be keeping their own
 * settings in it — so it is read, three keys are changed, and the rest is put
 * back exactly as it was. Never throws: an advisor that does not survive the
 * quit is not worth refusing to open a project over.
 */
async function keepAdvisorSettings(
  agentDir: string,
  advises: ModelChoice | null,
  does: ModelChoice | null,
  advisorThinks?: ThinkingLevel | undefined,
  switches?: { completionGate: boolean; loopGate: boolean } | undefined,
): Promise<void> {
  const file = join(agentDir, ADVISOR_SETTINGS_FILE);
  let existing: unknown = null;
  try {
    existing = JSON.parse(await readFile(file, 'utf8'));
  } catch {
    // No file yet, or one nobody can parse. Either way there is nothing to keep.
  }
  const next = advisorSettings(existing, {
    advises,
    does,
    advisorThinks,
    ...(switches === undefined ? {} : { switches }),
  });
  if (JSON.stringify(existing) === JSON.stringify(next)) return;
  try {
    await mkdir(agentDir, { recursive: true });
    await writeFile(file, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  } catch {
    // The choice applies to this sitting anyway; only the memory of it is lost.
  }
}

/**
 * Point the subagents extension's scratch away from the project.
 *
 * Its own default is `<project>/.pi/subagents/`, which is how twenty-two files
 * of helper transcript ended up in front of somebody's next commit. Written
 * once, only when the file has no answer of its own, and never over a file we
 * cannot read — the same rule the advisor settings follow.
 */
async function keepSubagentSettings(agentDir: string): Promise<void> {
  const file = join(agentDir, SUBAGENT_SETTINGS_FILE);
  const text = await readFile(file, 'utf8').catch(() => null);
  let existing: unknown = null;
  if (text !== null) {
    try {
      existing = JSON.parse(text);
    } catch {
      return;
    }
  }
  const next = artifactsBesideSessions(existing);
  if (next === null) return;
  try {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  } catch {
    // The exclude keeps the scratch uncommittable either way.
  }
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
      `That account is no longer saved on this computer. The tool that kept it must have forgotten it.`,
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    // A board piece, a helper and a canvas run have nobody in front of them, so
    // there is nobody to answer a question about working the computer.
    unattended:
      options.unattended === true ||
      (options.sessionKind !== undefined && options.sessionKind !== 'conversation'),
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
  /** True while Plan is on. Unlike `planning`, it lasts until somebody leaves it. */
  let planMode = options.planMode === true;
  /** Nothing reaches the window while this is on, except what was spent. Used
   *  for the one turn nobody asked for — see `settleUp`. */
  let unwatched = false;
  /** Whether this sitting did anything worth having notes about. */
  let didSomething = false;
  /** Once a sitting, at most. */
  let settledUp = false;
  /** Whether this sitting has had its first question yet — the moment the most
   *  relevant notes are handed over, so memory works without being asked. */
  let firstTurn = true;
  /** What was said during one, kept so the proposal can be read out of it. */
  let proposed = '';
  /** Everything said since the last settled moment, so a review verdict can be
   *  read out of the final reply and shown as its own card. */
  let tape = '';
  /**
   * A failure caught on its way to the window, while there are still waits
   * left to spend on it.
   *
   * The engine does not throw when a provider fails: the turn settles with the
   * failure on it and `prompt()` returns as though all was well, which is why
   * the retry that used to live around that call could never once have run.
   * The failure arrives here instead. Held rather than shown, because a
   * "stopped part way" card followed by the work carrying on underneath it is
   * two contradictory things on one screen.
   */
  let heldBackTrouble: string | null = null;
  let waitsLeft = 0;
  /** Ask loops still holding patience, innermost last. Two prompts can be in
   *  flight — a person's queued follow-up behind a carry-on round — and a
   *  failure belongs to whichever is actually streaming. */
  const holdingBack: number[] = [];
  let holdToken = 0;
  /**
   * How this run is ending, when something already knows.
   *
   * A settle used to say nothing about how it came about, so the synthetic one
   * Stop makes reached every reader looking exactly like success: the list
   * advanced, the checkout was applied, screenshots were taken. Set by whoever
   * ended it and read once, at the settle.
   */
  let endingHow: SettledHow | null = null;
  /** Whether this run has already reported a failure, so a settle after one is
   *  not called finished. */
  let failedThisRun = false;
  /** Which run the events belong to, so a failure held back for one loop is
   *  never spent on another. */
  let runNumber = 0;
  /** How this run ended, worked out once. */
  const howItEnded = (): SettledHow => {
    if (endingHow !== null) return endingHow;
    if (addonBlockedRun) return 'blocked-by-addon';
    if (confirmations.pending.length > 0 || asking.pending.length > 0) return 'asked-person';
    if (failedThisRun) return 'failed';
    return 'finished';
  };
  const say = (raw: AgentEvent): void => {
    const event: AgentEvent =
      raw.type === 'settled' && raw.how === undefined
        ? { ...raw, how: howItEnded(), run: `r${String(runNumber)}` }
        : raw;
    if (event.type === 'tool-start') didSomething = true;
    if (event.type === 'error') failedThisRun = true;
    /* An add-on's message inside a turn somebody asked for is part of that
       turn. Only one that arrives with nothing running is a run nobody typed,
       and that is the only one the authority has to hear about. */
    if (event.type === 'extension-turn' && activePrompts > 0) return;
    /* A step refused by something outside Graphe. Graphe's own refusals never
       reach here as a tool result — they are said as `blocked`, with a reason
       the person has already read. This is a hook somebody installed saying no,
       which the model sees only as a step that failed. */
    if (event.type === 'tool-end' && !event.ok && event.detail !== undefined) {
      if (/\bblocked\b/i.test(event.detail)) sawBlocked(event.detail);
      else blockedStreak = { reason: '', count: 0 };
    }
    if (event.type === 'tidied' && event.ok) shortened += 1;
    if (unwatched) {
      // What it costs is never hidden, whoever asked for the turn.
      if (event.type === 'spend') options.onEvent(event);
      return;
    }
    if (planning && event.type === 'message-delta') proposed += event.text;
    if (event.type === 'message-delta') tape += event.text;
    if (event.type === 'error' && waitsLeft > 0 && isTransientStreamError(event.message)) {
      heldBackTrouble = event.message;
      return;
    }
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
      // The same for a card asked before the work: the turn is over, so
      // nothing it says can reach anything. Left open it would be a form that
      // reads as "still working" for the rest of the sitting.
      const dropped = asking.abandonAll();
      if (dropped.length > 0) options.onEvent({ type: 'asking-withdrawn', ids: dropped });
      sayWhatTheRulesHeld();
      // Only at the end of the job, not at the end of every round. With a loop
      // carrying a list on, "always do this at the end" used to run once per
      // round — see the shell, which decides when the job is at rest.
      if (event.how === 'finished' && options.jobAtRest?.() !== false) {
        void runAlways('whenItFinishes', []);
      }
      endingHow = null;
      failedThisRun = false;
      addonBlockedRun = false;
      blockedStreak = { reason: '', count: 0 };
    }
  };

  /**
   * An add-on refusing every step.
   *
   * A blocked tool call is an ordinary error result to the model: it keeps
   * going, sees tool after tool refused, and eventually gives up and writes
   * prose. That is what a "randomly stopped" run looks like when something has
   * blocked the session, and nothing in the window said so.
   */
  let blockedStreak = { reason: '', count: 0 };
  let addonBlockedRun = false;
  /** Three in a row with the same reason is a rule, not a coincidence. */
  const BLOCKS_BEFORE_SAYING = 3;
  function sawBlocked(reason: string): void {
    const same = reason.trim();
    blockedStreak =
      same === blockedStreak.reason
        ? { reason: same, count: blockedStreak.count + 1 }
        : { reason: same, count: 1 };
    if (blockedStreak.count !== BLOCKS_BEFORE_SAYING) return;
    addonBlockedRun = true;
    options.onEvent({
      type: 'notice',
      what: ADDON_BLOCKED,
      because: same,
      actions: [
        { id: 'reset-addon', label: 'Reset it for this conversation' },
        { id: 'addons-off', label: 'Turn it off here' },
      ],
    });
  }

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
  /* What this project always does, read at the same moment and for the same
     reason. A file that will not read runs none of them and says so once. */
  const always = alwaysFrom(
    await readFile(alwaysFile(options.projectRoot ?? ''), 'utf8').catch(() => null),
  );
  // AGENTS.md hierarchy — Codex-compatible, closest wins, 32 KiB cap.
  // Read once at sitting start, no writes. Prepended to system prompt after memory.
  let agentsMdNote: string | null = null;
  if (options.projectRoot !== undefined && options.projectRoot !== '') {
    try {
      const read = await readAgentsMd(options.projectRoot);
      // Held to the same cap the budget holds it to. A 40 KB house-rules file
      // would otherwise take most of the window before the work starts, and
      // the rest of it is on disk for the model to read when it needs it.
      agentsMdNote = read === null ? null : withinBudget(read, AGENTS_BUDGET, standingWords.agentsTrimmed);
    } catch {
      agentsMdNote = null;
    }
  }

  /**
   * Run the things this project always does, at one of the three moments.
   *
   * Only what the Guard would allow outright. Nobody is being asked — that is
   * the whole point — so anything that would have raised a question does not
   * run, and is named once rather than silently skipped.
   */
  const alreadySaid = new Set<string>();
  async function runAlways(when: When, touched: readonly string[]): Promise<void> {
    const root = options.projectRoot;
    if (root === undefined) return;
    for (const one of always.all[when]) {
      if (!worthRunning(one, touched)) continue;
      const command = commandFor(one, touched);
      const allowed = evaluate({ id: `always-${one.name}`, name: 'bash', input: { command } }, facts);
      if (allowed.kind !== 'allow') {
        if (!alreadySaid.has(one.name)) {
          alreadySaid.add(one.name);
          options.onEvent({ type: 'message-delta', text: `\n\n${ALWAYS_WORDS.refused(one.name)}` });
          options.onEvent({ type: 'message-end' });
        }
        continue;
      }
      const ran = await runHelper('/bin/sh', ['-c', command], {
        folder: root,
        patience: VERIFY_PATIENCE,
      }).catch(() => null);
      if (ran === null || ran.code === 0) continue;
      const said = ran.said.trim().slice(-2000);
      options.onEvent({
        type: 'message-delta',
        text: `\n\n${ALWAYS_WORDS.failed(one.name, said)}`,
      });
      options.onEvent({ type: 'message-end' });
    }
  }

  let openedAlready = false;
  let rulesDiagnosticsSaid = false;
  const sayRulesDiagnostics = (): void => {
    if (rulesDiagnosticsSaid) return;
    rulesDiagnosticsSaid = true;
    const diagnostics = [
      ...(house.trouble === null ? [] : [RULE_WORDS.fileTrouble(house.trouble)]),
      ...house.skipped,
      ...(always.trouble === null ? [] : [always.trouble]),
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
   * Work has actually begun, so the asking is over.
   *
   * Only for a call that passed everything and is about to run. Reading around
   * first is fine and does not count as starting; changing something is what a
   * person cannot be left waiting behind. A call the Guard refused changed
   * nothing at all, and used to spend the one question a turn is allowed —
   * so the model was told it was too late to ask before anything had happened.
   */
  const workBegan = (call: ToolCall): void => {
    if (asksLeft === 'open' && changesAnything(call, facts) && !worksAScreen(call)) {
      asksLeft = 'started';
    }
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
    const touched = sourceAmong(describeCall(call).paths);
    // The project's own, whether or not anything is listening for a repair:
    // formatting what was just written is not a nudge, it is the thing the
    // project asked for.
    if (touched.length > 0) await runAlways('afterEachChange', touched);
    if (!repairIsListening()) return;
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
  /** The one set of questions a turn may stop for, and the count that names
   *  them. Ids are per session, so a card answered in one conversation can
   *  never resolve a question in another. */
  const asking = new Asking();
  let askedSoFar = 0;

  const paused = new Paused();

  const review = createGuardInterceptor({
    facts,
    relay,
    confirmations,
    paused,
    timeline: options.timeline,
    planning: () => planning,
    planMode: () => planMode,
    rules: () => house,
    world: desk.world,
    filesMayHaveMoved: forgetChecks,
    workBegan,
  });

  const runtime = await runtimeFor(agentDir, options.authPath);
  /** Filled while the loader runs, which is before anything below can read it. */
  let carried: readonly Carried[] = [];
  /**
   * What each installed extension will do, asked of the extension itself.
   *
   * Never a list of package names: a rule written against one package is a rule
   * that stops holding the moment somebody installs a different one. The probe
   * instantiates each factory once against a stub that records and does
   * nothing, and the card it produces drives the policy, the Add-ons line and
   * the prompt budget alike.
   */
  const cards = new Map<string, CapabilityCard | null>();
  const leftOut: { where: string; policy: Policy; card: CapabilityCard | null }[] = [];
  const cardsFolder = join(agentDir, 'graphe-extension-cards');
  for (const where of await extensionPathsIn(agentDir, options.projectRoot)) {
    cards.set(where, await cachedProbe(where, cardsFolder).catch(() => null));
  }
  const agentsPrompt = agentsMdNote === null ? [] : [`<agents_md>\n${agentsMdNote}\n</agents_md>`];
  const allNotes = [...(options.contextNotes ?? []), ...agentsPrompt];
  const loader = new pi.DefaultResourceLoader({
    cwd: options.projectRoot,
    agentDir,
    // A few sentences about the folder itself, when there is something a folder
    // listing cannot say. Empty is the ordinary case and passes nothing through.
    ...(allNotes.length === 0 ? {} : { appendSystemPrompt: allNotes }),
    // Extensions are on, but only the ones the person chose for themselves.
    // `extensionsOverride` runs after discovery and before anything is
    // installed into the session, so it is the one place a rule like that can
    // be enforced — see `onlyTheirs` for what it keeps.
    noExtensions: false,
    extensionsOverride: theirsTrustedAndPolicied(
      options.projectRoot,
      options.trusts ?? (() => false),
      (found) => {
        carried = found;
      },
      {
        kind: options.sessionKind ?? 'conversation',
        ...(options.addonsChosen === undefined ? {} : { chosen: options.addonsChosen }),
        cards,
        dropped: (one) => {
          leftOut.push(one);
        },
      },
    ),
    noThemes: true,
    extensionFactories: [
      {
        name: 'graphe-guard',
        factory: (api) => {
          api.on('tool_call', async (event) => review(asToolCall(event)));
          /*
           * A transcript is kept for ever and holds whatever the tools read —
           * file contents, command output, web pages — in the clear. The Guard
           * refuses to read a credential file, but full-access shell output is
           * nobody's to filter, and this is the last place before Pi appends
           * the result to the file on disk.
           */
          api.on('tool_result', (event) => {
            const before = event as { content?: readonly unknown[] };
            if (!Array.isArray(before.content)) return undefined;
            let found = 0;
            const content = before.content.map((one) => {
              const part = one as { type?: string; text?: string };
              if (part.type !== 'text' || typeof part.text !== 'string') return one;
              const masked = maskToolResult(part.text);
              found += masked.found;
              return { ...part, text: masked.text };
            });
            return found === 0 ? undefined : ({ content } as never);
          });
        },
      },
      /*
       * Graphe's own standing block, appended last so it is the end of the
       * system prompt whatever else is installed.
       *
       * The checklist used to travel with the person's typed message, so a
       * steer carried it and a retry after a rate limit did not — exactly the
       * turns where a long job forgets it had a list. Add-ons write into the
       * system prompt too, and on a small model the system prompt wins over
       * anything in a user message.
       */
      {
        name: 'graphe-standing',
        factory: (api) => {
          /** Said once per sitting: a warning repeated every turn is a warning
           *  nobody reads. */
          const already = new Set<string>();
          const sayOnce = (id: string, what: string): void => {
            if (already.has(id)) return;
            already.add(id);
            options.onEvent({ type: 'notice', what });
          };
          api.on('before_agent_start', async (_event, ctx) => {
            const block = await options.standing?.().catch(() => null);
            const was = (ctx as { getSystemPrompt?: () => string }).getSystemPrompt?.() ?? '';
            /* Our own block is never cut: it is what holds the job together.
               What is over budget is everything else, and a prompt too heavy
               for a small model to hold a list in is a prompt that quietly
               stops working. */
            const room = PROMPT_BUDGET - (block?.length ?? 0);
            const before =
              was.length <= room ? was : withinBudget(was, room, standingWords.promptTrimmed);
            const characters = before.length + (block?.length ?? 0);
            // Said whether or not there is a block, so the chip can show how
            // heavy the prompt has become before a small model stops coping.
            options.onEvent({ type: 'prompt-size', characters });
            if (before !== was) sayOnce('prompt-over-budget', saysPromptSize(was.length + (block?.length ?? 0)));
            if (block === null || block === undefined || block === '') {
              return before === was ? undefined : { systemPrompt: before };
            }
            return { systemPrompt: `${before}\n\n${block}` };
          });
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

  // Extensions register their tools while the loader runs. Naming `tools` at
  // all makes Pi read that array as the whole allowlist, so anything an
  // extension added has to be in it or the person installed a tool nothing can
  // ever call. The Guard still sees every one of these calls, and a name it has
  // no row for still stops to ask.
  const loadedExtensions = loader.getExtensions().extensions as readonly LoadedExtension[];
  /*
   * Two rules that hold for anything installed, now or later.
   *
   * A lifecycle handler gets a budget: Pi awaits `agent_end` before it will say
   * the run has settled, so one add-on draining its own background work held
   * every settle in this app hostage for up to half an hour. Past the budget
   * the handler is let go of and the event carries on.
   *
   * And an add-on classified as one that starts turns of its own keeps its
   * tools but loses its hooks in an ordinary conversation, because Graphe is
   * already deciding when a turn begins and two of those is the bug.
   */
  const budgetHooks = (): void => {
    withHookBudget(loader.getExtensions(), (over) => {
      options.onEvent({
        type: 'notice',
        what: `${over.extension} took too long on ${over.event} and was left to it.`,
      });
    });
  };
  budgetHooks();
  for (const one of loadedExtensions) {
    const where = (one as { resolvedPath?: string; path?: string }).resolvedPath ?? '';
    if (!cards.has(where)) continue;
    const card = cards.get(where) ?? null;
    if (!dropsLifecycleHooks(policyFor(card, options.sessionKind ?? 'conversation', options.addonsChosen))) {
      continue;
    }
    const handlers = (one as { handlers?: Map<string, unknown[]> }).handlers;
    if (!(handlers instanceof Map)) continue;
    for (const event of LIFECYCLE_HOOKS) handlers.delete(event);
    leftOut.push({ where, policy: 'tools-only', card });
  }
  const extensionTools = extensionToolNames(loadedExtensions);
  /** The advisor's own tools, kept apart because a chip turns them on and off
   *  without rebuilding the conversation. */
  const advisorTools = advisorToolNames(loadedExtensions);
  /* The advisor addition keeps one settings file for the whole machine, so the
     choice that file holds is whichever conversation wrote it last. Held here
     as well, and written again before each turn, so the file says what *this*
     conversation chose at the moment it is about to be used. */
  let advises = options.advisor ?? null;
  let advisorThinks = options.advisorThinking ?? undefined;
  /** Named once here, because `prompt` shadows `options` with its own. */
  const gates = options.advisorGates;
  if (advisorTools.length > 0) {
    await keepAdvisorSettings(agentDir, advises, options.model ?? null, advisorThinks, gates);
  }
  if (subagentsLoaded(loadedExtensions)) await keepSubagentSettings(agentDir);

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

  // Our own ids rather than Pi's `Model`, so no Pi shape leaves this file.
  // Keep what user selected even if stale — helpers will surface an error
  // rather than silently switching to a different model (the model 1 vs 2 bug).
  let inUse: { providerId: string; modelId: string } | null =
    chosen === null || chosen === undefined ? null : { providerId: chosen.providerId, modelId: chosen.modelId };
  let currentThinking: HelperPace | undefined = options.thinking as HelperPace | undefined;

  // A helper thinks with whatever this session thinks with. Resolved here and
  // handed over, because the child has no settings of its own to fall back on.
  // These are getters so a later useModel()/setThinking() updates helpers immediately.
  const getHelperModel = (): HelperModel => {
    if (inUse !== null) return { providerId: inUse.providerId, modelId: inUse.modelId };
    // No explicit choice — use whatever the session model would be or first available
    if (model !== undefined) return { providerId: model.provider, modelId: model.id };
    return firstUsable(runtime);
  };
  const getHelperThinking = (): HelperPace | undefined => currentThinking;

  /**
   * Whether a question may still stop this turn.
   *
   * `open` only at the very top. It closes the moment anything is changed, and
   * it closes for good once one set of questions has been asked — one stop per
   * turn, at the start, or none. This is the whole safety property: a person
   * told what is about to happen can walk away, and a person who walked away
   * never comes back to find an hour was spent waiting on a form.
   *
   * It also never opens where nobody is watching. Background work answers its
   * own questions by design, so the tool is not built for it at all.
   */
  let asksLeft: 'open' | 'started' | 'asked' = 'open';

  const askFirst = async (raw: unknown): Promise<string> => {
    if (asksLeft === 'started') return cannotAsk.started;
    if (asksLeft === 'asked') return cannotAsk.already;
    const questions = tidyQuestions(raw);
    // Nothing survived: every "question" had one real answer, so there was
    // never a decision for anybody to make.
    if (questions.length === 0) return cannotAsk.nothingWorthAsking;

    asksLeft = 'asked';
    const id = `ask-${String(++askedSoFar)}`;
    say({ type: 'asked-first', id, questions });
    const answers = await asking.ask(id);
    // Nobody answered, or somebody said to get on with it. Both are the same
    // instruction to the model, and neither is a reason to stop.
    if (answers === null) {
      say({ type: 'asking-withdrawn', ids: [id] });
      return askWords.skipped;
    }
    return saysAnswers(questions, answers);
  };

  const benchmarkToolFloor = options.benchmarkToolFloor === true;
  const customTools = benchmarkToolFloor
    ? []
    : grapheTools(
        agentDir,
        options.figmaToken,
        getHelperModel,
        getHelperThinking,
        options.projectRoot,
        options.putOnBoard,
        desk.noting,
        // Nobody to answer means no tool, rather than a tool that always says so.
        options.unattended === true ? null : askFirst,
        options.stepMoved,
        options.cancelBuild,
        options.makeChecklist,
        options.keepsBrowserLogins,
        options.browserSites,
      );

  /* The anchored edit and its read: the model reads a file, the read's reply
     carries the file's fingerprint, and an edit can name lines plus that
     fingerprint instead of retyping the old text — refused cleanly if the
     file has moved on. Both keep the built-in names, so the model sees one
     `read` and one `edit` and the Guard's rows hold. Pi's own tools stay
     underneath as the exact-text path and the actual reading. */
  const piRead = pi.createReadToolDefinition(options.projectRoot);
  const piEdit = pi.createEditToolDefinition(options.projectRoot);
  if (!benchmarkToolFloor) {
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
  }

  /* The project's memory: a note store beside the conversation, one database
     per project, opened with the app's embedding engine when it can load. A
     machine that cannot (no model yet, no network for the first download)
     still gets word-based recall — the engine degrades, never fails. */
  let memory: MemoryStore | null = null;
  if (!benchmarkToolFloor) {
    try {
      memory = await openMemory({
        dbPath: join(agentDir, 'memory', memoryFileName(options.projectRoot)),
        /* Said once, and only when there is really something to wait for: the
           model is 23 MB off Hugging Face, and a silent minute on first recall
           reads as the app having stopped. */
        embedder: defaultEmbedder(join(agentDir, 'model'), () => {
          options.onEvent({ type: 'notice', what: memoryWords.downloading });
        }),
      });
      customTools.push(...memoryTools(memory));
    } catch {
      // No memory, no ceremony: the tools simply are not there, and nothing else
      // in the session cares.
      memory = null;
    }
  }

  /* The debugger sessions this sitting holds: attached programs, closed with
     the session so nothing is left paused or held. */
  const debugRegistry = newDebugRegistry();
  if (!benchmarkToolFloor) customTools.push(...debugTools(debugRegistry));

  /* Work that answers by staying up: servers, watchers, anything the ordinary
     shell would either wait forever for or let die with the command that
     started it. Desktop sessions share the project's register; standalone
     sessions own one and close it themselves. */
  const ownsRunning = options.running === undefined;
  const keptRunning = options.running ?? new Running();
  if (!benchmarkToolFloor) {
    customTools.push(
      ...runningTools(keptRunning, {
        folder: options.projectRoot,
        parts: () => {
          const config = pi.getShellConfig(settings.shell);
          return { shell: config.shell, args: config.args };
        },
        writable: shellBounds(options.projectRoot, options.projectRoot).writable,
        // Only where nobody is watching. A conversation sets nothing, so the
        // project's own config decides its port exactly as a terminal would.
        port: options.ownPort === true ? PORTS.claim(options.projectRoot) : null,
        ...(options.noteServers === undefined ? {} : { noted: options.noteServers }),
        onChange: () => {
          say({ type: 'running', pieces: keptRunning.list() });
        },
      }),
    );
  }

  /* The plugged-in tool servers (MCP), read from the project's own .pi/mcp.json.
     Nothing starts until the model actually calls one of them, and every call
     travels through the Guard like any other tool call. */
  const mcpRegistry = new McpRegistry(
    inProject(await readMcpConfig(options.projectRoot), options.projectRoot),
    undefined,
    // Read again whenever the model asks. Somebody connecting a tool while a
    // conversation is open is the ordinary case, not the odd one.
    async () => inProject(await readMcpConfig(options.projectRoot), options.projectRoot),
  );
  // Always registered. It used to appear only once a project already had a
  // server, so a tool connected during a conversation could not be used until
  // the next one — and a typo in the file meant no tool at all and no way to
  // say why. With nothing connected it answers that nothing is, which is a
  // sentence the model can act on.
  if (!benchmarkToolFloor) customTools.push(mcpTool(mcpRegistry));

  // Minimal LSP stub: always available via grep fallback, no external server needed.
  // grapheTools already adds lspTool when not benchmark; this keeps the session
  // covered even if that path is bypassed.
  if (!benchmarkToolFloor && !customTools.some((tool) => tool.name === 'lsp')) {
    customTools.push(lspTool(options.projectRoot));
  }

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
    // Full access still starts it for real; the register is what knows it is
    // there, will not start a second copy of it, and can stop it afterwards.
    keepInstead: async (command, cwd) => {
      try {
        const config = pi.getShellConfig(settings.shell);
        if (config.commandTransport === 'stdin') return null;
        const already = keptRunning.same(command, cwd) !== null;
        const piece = await keptRunning.start({
          command,
          folder: cwd,
          parts: { shell: config.shell, args: config.args },
          writable: shellBounds(options.projectRoot, options.projectRoot).writable,
          ...(options.noteServers === undefined ? {} : { noted: options.noteServers }),
          onChange: () => say({ type: 'running', pieces: keptRunning.list() }),
        });
        const where =
          piece.address === null
            ? 'It has not printed an address yet. Ask running() again in a moment.'
            : `at ${piece.address}`;
        return [
          `${already ? 'That is already running' : 'Started and left running'} ${where}`,
          `Check on it with running(), and end it with stop_running(${piece.id}).`,
        ].join(' ');
      } catch (cause) {
        // The register's own refusal — too many up already — is the answer.
        return cause instanceof Error ? cause.message : null;
      }
    },
  });
  const boundShell = pi.createBashToolDefinition(options.projectRoot, {
    operations: shell,
    ...(settings.prefix === undefined ? {} : { commandPrefix: settings.prefix }),
  });

  // inUse already defined above (keeps chosen even if stale for helpers)

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
        tools: [...WORKING_TOOLS, ...customTools.map((tool) => tool.name), ...extensionTools],
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

  const advisorActive = (on: boolean): boolean => switchAdvisorTools(session, advisorTools, on);
  /** Set when a press did nothing, cleared once it has been said. */
  let advisorStuck = false;
  const sayAdvisorStuck = (): void => {
    if (!advisorStuck) return;
    advisorStuck = false;
    options.onEvent({ type: 'message-delta', text: `\n\n${ADVISOR_STUCK}` });
    options.onEvent({ type: 'message-end' });
  };
  advisorStuck = !advisorActive(advises !== null);

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
  /** How many times this conversation has been shortened. */
  let shortened = 0;

  const roomNow = (): Room | null => {
    try {
      const usage = session.getContextUsage();
      if (usage === undefined || usage.contextWindow <= 0) return null;
      if (usage.tokens === null) {
        return { used: null, total: usage.contextWindow, part: null, shortened };
      }
      return {
        used: usage.tokens,
        total: usage.contextWindow,
        part: Math.min(1, Math.max(0, usage.tokens / usage.contextWindow)),
        shortened,
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
      sayAdvisorStuck();
      // Once a sitting, before the first request goes anywhere.
      if (!openedAlready) {
        openedAlready = true;
        await runAlways('whenItOpens', []);
      }
      repairs.beginTurn();
      typesAskedThisTurn = false;
      // A yes to working the screen is worth one turn. Asking again for every
      // press turned a run of twenty moves into a queue of twenty questions.
      if (activePrompts === 0) facts.screenSaidYes = false;
      // A new request may ask again; a follow-up landing mid-run may not. The
      // second is somebody adding to work already going, and stopping that to
      // put a form up is exactly what this must never do.
      if (activePrompts === 0) {
        // Again before every run: an add-on that registered a handler inside
        // `session_start` registered it after the first sweep went past.
        budgetHooks();
        asksLeft = 'open';
        runNumber += 1;
        // Said rather than inferred. The window used to work out that it was
        // busy from the shape of the turns, so a step left running by a stop
        // kept the composer a spinner for the rest of the sitting.
        say({ type: 'busy', on: true });
      }
      activePrompts += 1;
      // Before the turn, not only when the choice changed: the file is shared
      // with every other conversation, and the last one to write it wins.
      if (advisorTools.length > 0) {
        // `gates` rather than `options.advisorGates`: inside `prompt` the name
        // `options` is the call's own, not the session's.
        await keepAdvisorSettings(agentDir, advises, inUse, advisorThinks, gates).catch(
          () => undefined,
        );
      }
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
                said = `${NOTES_CARRIED}\n${notes
                  .map((note) => `- ${note.content}`)
                  .join('\n')}\n\n${said}`;
              }
            } catch {
              // A memory that will not answer is a memory not worth a sentence.
            }
          }
        }
        /**
         * Ask, and keep asking while the answer is only that the service is
         * busy.
         *
         * Both endings are read the same way. A turn can fail by throwing
         * before it starts, or — far more often — by settling with the failure
         * on it, which `prompt()` reports as an ordinary return. The second is
         * the one that ends long jobs, and it is the one nothing here used to
         * see.
         *
         * The engine has already tried three times over fourteen seconds by the
         * time this is reached. That covers a blip. This covers a rate limit
         * measured in minutes and an outage measured in an afternoon, so
         * somebody can start a long list and walk away from it.
         */
        const askUntilItAnswers = async (promptText: string, opts: unknown): Promise<void> => {
          let words = promptText;
          let how = opts;
          /** This loop's own token, so a failure is spent by whichever loop is
           *  actually running rather than by whichever asked first. */
          const mine = ++holdToken;
          for (let attempt = 0; ; attempt += 1) {
            heldBackTrouble = null;
            /* Patience belongs to the run, not to how many prompts are in
               flight. A carry-on round or a person's queued follow-up made
               `activePrompts` two, so a rate limit mid-list ended the turn with
               an error instead of waiting it out — which is the failure a long
               job is most likely to meet. The guard against one loop swallowing
               another's failure is the token below: only the innermost loop
               still holding patience takes it. */
            waitsLeft = WAITS_MS.length - attempt;
            holdingBack.push(mine);
            try {
              await (session.prompt as (text: string, opts?: unknown) => Promise<void>)(
                words,
                how as never,
              );
            } catch (cause) {
              if (!isTransientStreamError(cause)) throw cause;
              heldBackTrouble = plainly(cause);
            } finally {
              waitsLeft = 0;
              const at = holdingBack.lastIndexOf(mine);
              if (at >= 0) holdingBack.splice(at, 1);
            }

            const trouble = heldBackTrouble;
            heldBackTrouble = null;
            if (trouble === null) return;
            if (attempt >= WAITS_MS.length) {
              // Out of waits. The window has been told nothing about this yet,
              // so it is told now, in the ordinary way.
              // `waitsLeft` is back to zero, so this one is not held back.
              say({ type: 'held', ok: false });
              say({ type: 'error', message: trouble });
              return;
            }

            const wait = WAITS_MS[attempt] ?? 0;
            say({ type: 'holding', seconds: Math.round(wait / 1000) });
            await sleep(wait);
            say({ type: 'held', ok: true });
            // Never the original request again: everything already done is
            // still in the conversation, and asking twice does it twice.
            words = CARRY_ON;
            how = undefined;
          }
        };

        // The window chose to queue this message behind the run in flight
        // (the composer's "queue it" option). Pi delivers a prompt marked
        // followUp after the current turn finishes, without interrupting it.
        if (options?.queue === 'followUp') {
          const queued =
            withPictures === undefined
              ? { streamingBehavior: 'followUp' as const }
              : { ...withPictures, streamingBehavior: 'followUp' as const };
          await askUntilItAnswers(said, queued);
        } else {
          try {
            await askUntilItAnswers(said, withPictures);
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
            await askUntilItAnswers(said, queued);
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
        if (activePrompts === 0) say({ type: 'busy', on: false });
      }
    },

    async useAdvisor(next, thinks): Promise<void> {
      if (closed) return;
      advisorStuck = !advisorActive(next !== null);
      advises = next;
      advisorThinks = thinks;
      // Not into the middle of a reply: the next turn opens with it instead.
      if (!session.isStreaming) sayAdvisorStuck();
      if (advisorTools.length > 0) {
        await keepAdvisorSettings(agentDir, next, inUse, thinks, gates);
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
      currentThinking = session.thinkingLevel as HelperPace;
      return session.thinkingLevel as ThinkingLevel;
    },

    async stop(): Promise<void> {
      // Said out loud, because nothing else says it. A question is only ever
      // closed in the window by the window's own answer, so one answered here
      // left a card on screen whose answer could never arrive — and an
      // unanswered card reads as "still working", which is why Stop looked
      // dead while the run behind it had already ended.
      // A held turn is let go first: stopping a turn that is waiting must end
      // it, not leave it waiting for a resume nobody is going to press.
      paused.hold(false);
      const withdrawn = confirmations.abandonAll();
      if (withdrawn.length > 0) say({ type: 'questions-withdrawn', callIds: withdrawn });
      const letGo = asking.abandonAll();
      if (letGo.length > 0) say({ type: 'asking-withdrawn', ids: letGo });
      await session.abort();
      // The run is over whatever pi did with the abort. Saying so is what puts
      // the composer back to Send; waiting for an event that may not come is
      // how the button stayed a spinner. `stopped` rather than a bare settle:
      // a stop that reads as success advances the list, applies the checkout
      // and takes screenshots for work nobody finished.
      endingHow = 'stopped';
      say({ type: 'settled', how: 'stopped', run: `r${String(runNumber)}` });
      say({ type: 'busy', on: false });
    },

    /** Wait between steps, or carry on. Holding is not stopping: the turn stays
     *  where it is and picks up from wherever things are when it is let go. */
    holdOn(on: boolean): void {
      paused.hold(on);
      if (!on) say({ type: 'waiting-for-you', on: false });
    },

    get held(): boolean {
      return paused.on;
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
      paused.hold(false);
      confirmations.abandonAll();
      asking.abandonAll();
      unsubscribe();
      session.dispose();
      void shell.close();
      void mcpRegistry.close();
      void memory?.close().catch(() => {});
      // The browser is kept warm between calls, which is what makes it quick —
      // and means it outlives the conversation unless somebody says otherwise.
      if (!benchmarkToolFloor) {
        void closeBrowser(
          options.projectRoot,
          undefined,
          options.keepsBrowserLogins?.() === true && options.projectRoot !== undefined
            ? browserFolder(agentDir, options.projectRoot)
            : null,
        );
      }
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

    answerAsked(id: string, answers: Answers | null): boolean {
      return asking.answer(id, answers);
    },

    get awaitingAnswer(): readonly string[] {
      // Both kinds. A conversation parked on either is one somebody is in the
      // middle of, and evicting it would answer for them.
      return [...confirmations.pending, ...asking.pending];
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

    /* Mutated rather than rebuilt: the interceptor reads these facts on every
       call, so the switch takes effect on the next tool call and not on the
       next session. */
    setComputerUse(use: NonNullable<GuardFacts['computerUse']>): void {
      facts.computerUse = {
        ...use,
        allowedApps: [...use.allowedApps],
        browserSites: [...use.browserSites],
      };
    },

    setPlanMode(on: boolean): void {
      planMode = on;
    },

    get howFar(): HowFar {
      return facts.howFar ?? 'asking';
    },

    get running(): readonly RunningPiece[] {
      return keptRunning.list();
    },

    runningSaid(id: string): string {
      return keptRunning.said(id, { all: true });
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

    get addons(): readonly {
      name: string;
      says: string;
      policy: Policy;
      startsTurns: boolean;
      runsBackgroundWork: boolean;
      rewritesSystemPrompt: boolean;
    }[] {
      const kind = options.sessionKind ?? 'conversation';
      return [...cards.entries()].flatMap(([where, card]) => {
        if (card === null) return [];
        return [
          {
            name: card.id === '' ? nameFromPath(where) : card.id,
            says: saysCard(card),
            policy: policyFor(card, kind, options.addonsChosen),
            startsTurns: card.startsTurns,
            runsBackgroundWork: card.runsBackgroundWork,
            rewritesSystemPrompt: card.rewritesSystemPrompt,
          },
        ];
      });
    },

    get hookOverruns(): readonly { extension: string; event: string; ms: number }[] {
      return recentOverruns();
    },

    async recall(about: string, most: number): Promise<readonly { content: string }[]> {
      if (closed || memory === null) return [];
      try {
        return await memory.recall(about, { limit: most });
      } catch {
        return [];
      }
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

    /**
     * The sitting is over. Write down anything worth keeping.
     *
     * A sitting already begins by carrying its notes in; this is the other
     * half, and without it the memory only ever holds what somebody thought to
     * ask for. The conversation is still loaded, so this is the cheapest moment
     * there will ever be to ask — and the last.
     *
     * Nothing of it reaches the window. Whoever closed the conversation has
     * moved on, and a reply arriving after they left is not something they can
     * do anything with. What it spends is still reported, because money is
     * never hidden.
     *
     * Quiet about its own failures too: a sitting that could not write its
     * notes down is not a sitting that went wrong.
     */
    async settleUp(): Promise<boolean> {
      if (closed || settledUp || memory === null || !didSomething) return false;
      settledUp = true;
      unwatched = true;
      try {
        await session.prompt(WORTH_KEEPING);
        return true;
      } catch {
        return false;
      } finally {
        unwatched = false;
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
