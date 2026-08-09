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
import { evaluate, requiresSnapshot } from '../guard/policy';
import type { AgentEvent, ToolCall, Verdict } from '../types';
import type { Timeline } from '../../history/timeline';
import { EventRelay } from './events';

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
  abandonAll(): void {
    const open = [...this.waiting.values()];
    this.waiting.clear();
    for (const resolve of open) resolve('no');
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
  const { facts, relay, confirmations, timeline } = options;

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
    const verdict = evaluate(call, facts);

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
    if (requiresSnapshot(call, facts)) {
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
/* The session                                                                 */
/* -------------------------------------------------------------------------- */

export type CreateSessionOptions = {
  /** The project folder. Also the Guard's boundary: nothing may reach outside it. */
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
  /** Where Pi keeps credentials and its model list. Defaults to the user's own
   *  `~/.pi/agent`, which is where signing in puts them. Worth overriding in a
   *  test: Pi creates the folder on sight. */
  agentDir?: string;
};

/**
 * A running agent, in our vocabulary.
 *
 * Deliberately small. Pi's `AgentSession` has model cycling, thinking levels,
 * compaction, tree navigation, steering and forking on it; none of that is a
 * concept a designer has, and every one of them we expose is a Pi API we have
 * agreed to keep working through the next breaking change.
 */
export type GrapheSession = {
  /** Say something to the agent. Resolves when it has finished responding. */
  prompt(text: string): Promise<void>;
  /** Stop what it is doing now. Open questions are answered no. */
  stop(): Promise<void>;
  /** Finish with this session. Safe to call twice. */
  dispose(): void;
  /** Answer a `needs-confirmation`. False if there was no such question. */
  answer(callId: string, decision: Decision): boolean;
  /** Calls waiting on a person right now, oldest first. */
  readonly awaitingAnswer: readonly string[];
};

type Pi = typeof import('@earendil-works/pi-coding-agent');
type PiToolCallEvent = import('@earendil-works/pi-coding-agent').ToolCallEvent;

async function loadPi(): Promise<Pi> {
  try {
    return await import('@earendil-works/pi-coding-agent');
  } catch (cause) {
    throw new AdapterError('I could not start the part of me that does the work.', { cause });
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
 * `SessionManager.inMemory` unless a path is given. Opening a project should not
 * leave transcripts on somebody's disk they did not ask for.
 */
export async function createSession(options: CreateSessionOptions): Promise<GrapheSession> {
  const pi = await loadPi();

  const facts: GuardFacts = { ...options.guard, projectRoot: options.projectRoot };
  const relay = new EventRelay(options.onEvent);
  const confirmations = new Confirmations();
  const review = createGuardInterceptor({
    facts,
    relay,
    confirmations,
    timeline: options.timeline,
  });

  const agentDir = options.agentDir ?? pi.getAgentDir();
  const loader = new pi.DefaultResourceLoader({
    cwd: options.projectRoot,
    agentDir,
    noExtensions: true,
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
  await loader.reload();

  let session;
  try {
    session = (
      await pi.createAgentSession({
        cwd: options.projectRoot,
        agentDir,
        resourceLoader: loader,
        sessionManager:
          options.sessionPath === undefined
            ? pi.SessionManager.inMemory(options.projectRoot)
            : pi.SessionManager.open(options.sessionPath),
      })
    ).session;
  } catch (cause) {
    // Overwhelmingly this is "no model is set up yet". The app owns sign-in;
    // all we can do is say so without a stack trace.
    throw new AdapterError('I am not set up to work yet.', { cause });
  }

  const unsubscribe = session.subscribe((event) => {
    relay.fromPi(event);
  });

  let closed = false;

  return {
    async prompt(text: string): Promise<void> {
      if (closed) throw new AdapterError('This session has been closed.');
      try {
        await session.prompt(text);
      } catch (cause) {
        const message = plainly(cause);
        relay.failed(message);
        throw new AdapterError(message, { cause });
      }
    },

    async stop(): Promise<void> {
      confirmations.abandonAll();
      await session.abort();
    },

    dispose(): void {
      if (closed) return;
      closed = true;
      confirmations.abandonAll();
      unsubscribe();
      session.dispose();
    },

    answer(callId: string, decision: Decision): boolean {
      return confirmations.answer(callId, decision);
    },

    get awaitingAnswer(): readonly string[] {
      return confirmations.pending;
    },
  };
}
