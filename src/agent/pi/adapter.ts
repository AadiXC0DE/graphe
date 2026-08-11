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
import { PLAN_WORDS, parseProposal, readOnlyTools } from '../plan';
import type { AgentEvent, ImageCard, ToolCall, Verdict } from '../types';
import type { Timeline } from '../../history/timeline';
import { EventRelay } from './events';
import { eventsFromEntries } from './history';
import { readConversations, type Conversation } from './conversations';
import { grapheTools } from './tools';
import {
  collectAccounts,
  credentialFor,
  readFoundCredentials,
  type FoundAccount as FoundOnDisk,
} from './importers';

import { join, sep } from 'node:path';

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
  /** True while the turn is only allowed to look. Anything that could change
   *  the project is refused with a sentence telling the model to propose it
   *  instead, which is the whole of planning before doing. */
  planning?: () => boolean;
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
  const { facts, relay, confirmations, timeline, planning } = options;

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
    // Looking only. Withheld rather than refused-as-an-error: the model is told
    // to put it in the plan, which is the answer we actually want back.
    if (planning?.() === true && readOnlyTools([call.name]).length === 0) {
      return { block: true, reason: PLAN_WORDS.withheld };
    }

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
  /** Where this project's conversations live on disk. Given, the session
   *  resumes the most recent one and keeps writing to it — a project reopened
   *  is a conversation continued, not one started again (BACKLOG B1.1). When
   *  neither this nor `sessionPath` is given, nothing is ever written. */
  sessionDir?: string;
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
  /** Say something to the agent. Resolves when it has finished responding.
   *  Pictures travel with the message; omitted when there are none. */
  prompt(
    text: string,
    images?: readonly ImageCard[],
    options?: { lookFirst?: boolean },
  ): Promise<void>;
  /** Work with a different model from now on, keeping the conversation. False
   *  when the choice does not resolve to a model this computer can use; the
   *  session then carries on with what it had rather than picking for you. */
  useModel(choice: { providerId: string; modelId: string } | null): Promise<boolean>;
  /** Which model is answering, or null for "whatever the account offers". */
  readonly model: { providerId: string; modelId: string } | null;
  /** Stop what it is doing now. Open questions are answered no. */
  stop(): Promise<void>;
  /** Finish with this session. Safe to call twice. */
  dispose(): void;
  /** Answer a `needs-confirmation`. False if there was no such question. */
  answer(callId: string, decision: Decision): boolean;
  /** Calls waiting on a person right now, oldest first. */
  readonly awaitingAnswer: readonly string[];
  /** The conversation this session started with, as the events that would have
   *  made it — an earlier sitting read back so the window can show it again
   *  (BACKLOG B1.1). Empty when this is a brand-new conversation. */
  readonly history: readonly AgentEvent[];
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

function runtimeFor(agentDir: string): Promise<PiRuntime> {
  const already = runtimes.get(agentDir);
  if (already !== undefined) return already;
  const pending = loadPi().then((pi) =>
    pi.ModelRuntime.create({
      authPath: join(agentDir, 'auth.json'),
      modelsPath: join(agentDir, 'models.json'),
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

/** Everything the window can know about who can think for it, read through
 *  one call. Nothing here throws for a provider in a bad state — each is read
 *  defensively and reported as it actually is, because a provider the runtime
 *  cannot reach is a provider the window should still see, greyed out. */
export async function connection(agentDir: string): Promise<readonly ProviderSummary[]> {
  const runtime = await runtimeFor(agentDir);

  let connected = new Set<string>();
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
      }));
    } catch {
      // Unreadable providers are not offered at all.
    }
    if (models.length === 0) continue;

    const methods: ProviderMethod[] = [];
    let oauthLabel: string | null = null;
    let apiKeyLabel: string | null = null;
    if (provider.auth.oauth?.login !== undefined) {
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
    let usable = new Set<string>();
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
      models: models.map((model) =>
        usable.has(model.id) ? { ...model, available: true } : model,
      ),
    });
  }
  return summaries;
}

/**
 * Keep the extensions somebody deliberately added; drop the ones a folder
 * brought with it.
 *
 * An extension is arbitrary code running in the same process as the agent, so
 * "it was in the repository I opened" is not consent. Anything resolving inside
 * the project is left out, which is the same line `trustProject` draws for
 * skills and recipes. What the person installed themselves lives under their own
 * agent directory and loads normally.
 *
 * The Guard is unaffected either way: it is registered as a factory here, and a
 * tool an extension registers under a name the Guard does not know falls to the
 * deny-by-default floor rather than through it.
 */
function onlyTheirs(projectRoot: string) {
  const root = projectRoot.endsWith(sep) ? projectRoot : projectRoot + sep;
  return <T extends { extensions: readonly { resolvedPath?: string; path?: string }[] }>(
    base: T,
  ): T => ({
    ...base,
    extensions: base.extensions.filter((one) => {
      const where = one.resolvedPath ?? one.path ?? '';
      return where !== '' && !where.startsWith(root);
    }),
  });
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

export type { Conversation };

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

  let connected = new Set<string>();
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

  const facts: GuardFacts = { ...options.guard, projectRoot: options.projectRoot };

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
  /** What was said during one, kept so the proposal can be read out of it. */
  let proposed = '';
  const say = (event: AgentEvent): void => {
    if (planning && event.type === 'message-delta') proposed += event.text;
    options.onEvent(event);
  };

  const relay = new EventRelay(say, { billedSoFar });
  const confirmations = new Confirmations();
  const review = createGuardInterceptor({
    facts,
    relay,
    confirmations,
    timeline: options.timeline,
    planning: () => planning,
  });

  const agentDir = options.agentDir ?? (await defaultAgentDir());
  const runtime = await runtimeFor(agentDir);
  const loader = new pi.DefaultResourceLoader({
    cwd: options.projectRoot,
    agentDir,
    // Extensions are on, but only the ones the person chose for themselves.
    // `extensionsOverride` runs after discovery and before anything is
    // installed into the session, so it is the one place a rule like that can
    // be enforced — see `onlyTheirs` for what it keeps.
    noExtensions: false,
    extensionsOverride: onlyTheirs(options.projectRoot),
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
  const customTools = grapheTools(agentDir, options.figmaToken);

  // The chosen model, resolved here where the model objects live. A choice
  // that no longer exists — the provider removed it, or the ids changed — is
  // simply no choice: Pi falls back to whatever the account makes available
  // rather than the window learning about it as a failure.
  const chosen = options.model;
  const model =
    chosen === null || chosen === undefined
      ? undefined
      : runtime.getModel(chosen.providerId, chosen.modelId) ?? undefined;

  /* Our own ids rather than Pi's `Model`, so no Pi shape leaves this file. */
  let inUse: { providerId: string; modelId: string } | null =
    model === undefined || chosen === null || chosen === undefined ? null : chosen;

  // The manager stays in our hands after the session is built, because the read
  // side of a resumed conversation needs the same manager that will keep
  // writing to it. `continueRecent` resumes the newest session for this folder,
  // or starts one when there is none yet — so "open the project again" is the
  // whole of B1.1, and nothing else has to decide anything.
  const manager =
    options.sessionPath === undefined
      ? options.sessionDir === undefined
        ? pi.SessionManager.inMemory(options.projectRoot)
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
        customTools,
        modelRuntime: runtime,
        model,
        sessionManager: manager,
      })
    ).session;
  } catch (cause) {
    // Overwhelmingly this is "no model is set up yet". The app owns sign-in;
    // all we can do is say so without a stack trace.
    throw new AdapterError('I am not set up to work yet.', { cause });
  }

  running = session;
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

  return {
    async prompt(
      text: string,
      images?: readonly ImageCard[],
      options?: { lookFirst?: boolean },
    ): Promise<void> {
      if (closed) throw new AdapterError('That project is no longer open.');
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
        await session.prompt(looking ? `${text}\n\n${PLAN_WORDS.asked}` : text, withPictures);
      } catch (cause) {
        const message = plainly(cause);
        relay.failed(message);
        throw new AdapterError(message, { cause });
      } finally {
        if (looking) {
          planning = false;
          say({ type: 'planned', ...parseProposal(proposed) });
        }
      }
      // After the reply, never during it: `compact()` aborts whatever is running
      // first, so calling it mid-turn would abandon the answer somebody is
      // waiting for in order to tidy the notes about it.
      await tidyIfItHasGrownLong();
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

    // Read when asked, not once at the top: a window reloading mid-sitting needs
    // the conversation as it stands, not as it was when the session was built.
    get history(): readonly AgentEvent[] {
      return eventsFromEntries(manager.buildContextEntries());
    },
  };
}
