/** The lifecycle supervisor for one conversation's child runtime.
 *
 * Phase 6.2's shape: a managed child process per live conversation runtime,
 * with the parent owning the registry, the durable operation journal, UI
 * routing and the lifecycle. This is that supervisor, and it is deliberately
 * small — a spike's parent half, not a migration. `src/agent/pi/runtime-child.ts`
 * hosts Pi and the trusted extensions; this file starts it, speaks Pi's RPC
 * protocol to it, routes the guard hook and the window's dialogs across the
 * boundary, and is the only thing that outlives a child that dies.
 *
 * ## What the shell owns
 *
 *  - **The Guard.** The child's `tool_call` hook asks over the control channel;
 *    `judge` answers here, with the verdict the shell's own policy produced. So
 *    the decision never leaves the process that owns the facts behind it.
 *  - **The window.** Pi's extension UI requests come back on its own stdout and
 *    are handed to `askUi`, which is the shell's existing `askTheWindowFor`.
 *  - **Lifecycle.** Start, readiness, hard kill, and what a dead child means.
 *
 * ## What a dead child means
 *
 * A worker exit marks the run interrupted, settles pending UI waits as
 * cancelled, and starts nothing on restart. Those are the plan's words and they
 * are this file's behaviour: `onExit` reports the interruption, every pending
 * dialog settles as cancelled with the documented value for its kind, and no
 * code path here ever reissues a prompt. A run that was interrupted is the
 * user's to ask for again.
 *
 * ## Why fds 3 and 4
 *
 * Pi's own RPC protocol is commands on stdin and events on stdout, and it has
 * no place for a question our side has to answer before a tool runs. So the
 * child gets two more pipes for a private channel. They are not a general
 * message bus: one question at a time, one answer, keyed by the nonce minted
 * for this child. Nothing about Electron — no object, no bridge, no handle —
 * ever appears on either stream.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';

import type { ExtensionAnswer, ExtensionAsk } from '../../src/lib/extension-ask';
import type { ToolCall } from '../../src/agent/types';
import { RUN_AS_NODE } from '../../src/agent/pi/childenv';
import {
  CHILD_WRITES_FD,
  PI_ENTRY_ENV,
  SHELL_WRITES_FD,
  asObject,
  asRecord,
  asVerdict,
  fromChild,
  records,
  uiRequestIn,
  type Nonce,
  type UiRequest,
} from '../../src/agent/pi/rpc-protocol';

/** The variable an unbuilt copy names its child program with, the same seam
 *  `GRAPHE_PROBE_PROGRAM` is for the extension probe. */
const CHILD_PROGRAM_ENV = 'GRAPHE_RUNTIME_CHILD';

/** Built beside the shell, like the helper and the probe runner. */
const BUILT_CHILD = fileURLToPath(new URL('../runtime-child.mjs', import.meta.url));

/** How long a child gets to say it is ready. Past this it is killed and the
 *  start fails: a runtime nobody can reach is not a runtime. */
const READY_PATIENCE_MS = 30_000;

/** How long a child gets to go after the signal, before it is killed outright
 *  and the caller is told anyway. A killed process is reaped in milliseconds;
 *  this exists so a signal that never lands cannot hold up a project closing. */
const STOP_GRACE_MS = 3_000;

/** How much of a child's own output is kept for a log line. */
const SAID_MOST = 4_000;

/** What the shell answers about one call. Mirrors the Guard's own verdict as
 *  far as the boundary needs it: run, or do not and say why. */
export type VerdictForCall = (call: ToolCall) => Promise<{ block: false } | { block: true; reason: string }>;

/** One conversation runtime, as the shell reaches it. */
export type ChildRuntime = {
  readonly nonce: Nonce;
  /** The child's own idea of its process id, from its ready line. Zero until it
   *  has said. Recorded so a start can be told from a restart across a launch. */
  readonly pid: number;
  /** Pi's own protocol, as the shell sends it. */
  send(command: { type: string; [key: string]: unknown }): Promise<Record<string, unknown>>;
  /** Pi's events, plus everything the shell has to see, in arrival order. */
  onEvent(listener: (event: Record<string, unknown>) => void): () => void;
  /** The child is gone. Called once, whether it exited or was killed. */
  onExit(listener: (how: ChildExit) => void): () => void;
  /** Take the child down. Refuses to return before it is really gone. */
  stop(): Promise<void>;
};

/** How a child ended. `killed` is this side's doing — a stop, an eviction, the
 *  app closing. `died` is the child's own, which is what a run being
 *  interrupted looks like.
 *
 *  `unanswered` is every question the child was still holding when it went:
 *  the ids of extension dialogs whose answers were being waited for, and the id
 *  of a tool call the child had parked on our verdict. They are reported rather
 *  than resolved here because the promise belongs to whoever is drawing the
 *  dialog — the shell's own registry — and a supervisor that settled somebody
 *  else's promise would be answering for them. Phase 6.2's rule is that a
 *  worker exit resolves those waits as cancelled; this is the supervisor saying
 *  which ones, at the one moment it knows. */
export type ChildExit =
  | { kind: 'died'; said: string; unanswered: readonly string[] }
  | { kind: 'killed'; unanswered: readonly string[] };

export type StartOptions = {
  /** The conversation's folder; every path rule is measured from here. */
  cwd: string;
  /** Where Pi keeps credentials, its model list and its sessions. */
  agentDir: string;
  /** Environment for the child on top of this process's own — a proxy, a
   *  credential the shell wrote out, whatever Pi reads. Never a place for
   *  secrets on a command line, which is why it travels as an environment. */
  env?: Readonly<Record<string, string>>;
  /** Pi's own entry file, for the child to import. Left out, the shell resolves
   *  it from its own installation — which is what a packaged app wants, since
   *  the worker does not sit beside `node_modules` and must boot without a
   *  global Node installation. */
  piEntry?: string;
  /** The rest of Pi's own arguments, as the shell would have passed them to a
   *  CLI: the model, the session file, the tool allowlist, the extension paths
   *  the trust filter kept. Nothing here is interpreted by this file. */
  args?: readonly string[];
  /** The Guard, judging a call the child is holding. */
  judge: VerdictForCall;
  /** An extension's question, put to the window and answered. Left out, every
   *  question is cancelled rather than answered — the same honest default the
   *  in-process path has. */
  ask?: (ask: ExtensionAsk) => Promise<ExtensionAnswer>;
  /** The child's own output, for the log. Never shown as a sentence. */
  onChatter?: (line: string) => void;
  /** An extension UI request this version does not know how to draw. Reported
   *  rather than ignored, which is what phase 6.3 requires. */
  onUnsupportedUi?: (request: UiRequest) => void;
};

/**
 * Write to the child, or say nothing at all.
 *
 * Every write here is a message the child may not be alive to read, and a
 * broken pipe raises an error event on the stream — which, with no listener,
 * ends the process doing the protecting. A record that did not land is the
 * same as the child having gone, which every caller already handles.
 */
function writeToChild(into: { write(chunk: string): boolean; destroyed: boolean }, record: string): void {
  if (into.destroyed) return;
  try {
    into.write(record);
  } catch {
    // The pipe is gone. Nothing to tell the child, and nothing to tell anyone.
  }
}

/** Nothing to ask with: cancelled, in the shape the question has. Never a
 *  made-up yes, and never a silent no caused by a missing window. */
function cancelled(ask: ExtensionAsk): ExtensionAnswer {
  if (ask.kind === 'confirm') return { kind: 'confirm', value: false };
  if (ask.kind === 'select') return { kind: 'select', value: null };
  if (ask.kind === 'editor') return { kind: 'editor', value: null };
  return { kind: 'input', value: null };
}

/** What a call is told when the shell could not answer for it. The same words
 *  the in-process Guard uses when it cannot make a restore point: nothing has
 *  changed, and the model is told to say what it was trying to achieve. */
const CANCELLED_REASON =
  'I could not check whether that was safe, so I did not do it. Nothing has changed. Say what you were trying to achieve and we will find another way.';

/** How much of an extension's own wording is put in a dialog title. Pi allows a
 *  long sentence here; a window has one line. */
const TITLE_MOST = 200;

const say = (value: unknown): string => (typeof value === 'string' ? value : '');
const shorten = (text: string): string => (text.length <= TITLE_MOST ? text : `${text.slice(0, TITLE_MOST - 1)}…`);

/**
 * One of Pi's UI requests, as the shell's own question.
 *
 * Null for a method this version cannot put to a window: a widget, a title, a
 * status line and an editor prefill are all things an extension asks for that
 * have no honest dialog. They are reported, not answered — inventing a value
 * for one would be the host claiming a capability it does not have.
 */
function askFrom(request: UiRequest): ExtensionAsk | null {
  const held = request.held;
  const timeout = typeof held['timeout'] === 'number' && held['timeout'] > 0 ? held['timeout'] : null;
  switch (request.method) {
    case 'select': {
      const options = Array.isArray(held['options']) ? held['options'] : [];
      return {
        kind: 'select',
        title: shorten(say(held['title'])),
        // Values preserved separately from labels: Pi offers plain strings, so
        // the label is the value and the two cannot drift.
        options: options
          .filter((one): one is string => typeof one === 'string')
          .map((one) => ({ label: one, value: one })),
        timeoutMs: timeout,
      };
    }
    case 'confirm':
      return {
        kind: 'confirm',
        title: shorten(say(held['title'])),
        message: say(held['message']),
        timeoutMs: timeout,
      };
    case 'input':
      return {
        kind: 'input',
        title: shorten(say(held['title'])),
        placeholder: say(held['placeholder']) === '' ? null : say(held['placeholder']),
        timeoutMs: timeout,
      };
    case 'editor':
      return { kind: 'editor', title: shorten(say(held['title'])), prefill: say(held['prefill']) };
    default:
      return null;
  }
}

/** The answer, in the shape Pi's own protocol documents for that method. */
function responseFor(request: UiRequest, answer: ExtensionAnswer): Record<string, unknown> {
  if (answer.kind === 'confirm') return { id: request.id, confirmed: answer.value };
  if (answer.kind === 'input' || answer.kind === 'editor' || answer.kind === 'select') {
    return answer.value === null
      ? { id: request.id, cancelled: true }
      : { id: request.id, value: answer.value };
  }
  return { id: request.id, cancelled: true };
}

/** The child program this copy will start, if it has one. Built beside the
 *  shell; `GRAPHE_RUNTIME_CHILD` names another, which is how a test drives this
 *  path without a built app. */
export function childProgram(): string | null {
  const named = (process.env[CHILD_PROGRAM_ENV] ?? '').trim();
  if (named !== '') return existsSync(named) ? named : null;
  return existsSync(BUILT_CHILD) ? BUILT_CHILD : null;
}

/**
 * Pi's own entry, as this installation resolves it.
 *
 * Empty when it cannot be resolved at all, which leaves the child to try the
 * bare specifier — right for a child started by hand from the repository, and
 * the only honest answer when there is nothing to name.
 */
function piEntry(): string {
  try {
    return fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent'));
  } catch {
    return '';
  }
}

/** The node a child of this app runs as. `process.execPath` is the app's own
 *  binary under Electron, which needs to be told to behave as node. */
export function nodeForChild(): string {
  return process.execPath;
}

/**
 * Start one conversation's runtime.
 *
 * Resolves when the child's own control extension says it is ready — not when
 * the process was created, because a process that has not loaded Pi cannot
 * answer anything. A child that dies before saying so is a start that failed,
 * and its last words are in the error rather than in a log somebody has to go
 * looking for.
 */
export async function startRuntime(options: StartOptions): Promise<ChildRuntime> {
  const program = childProgram();
  if (program === null) {
    throw new Error(
      'This copy has no child runtime built beside it, so a conversation cannot be hosted in one.',
    );
  }

  const nonce = randomUUID();
  const child: ChildProcessWithoutNullStreams = spawn(nodeForChild(), [program, ...(options.args ?? [])], {
    cwd: options.cwd,
    // Electron's own binary is not node until it is told to be. The nonce is
    // this child's alone, and the root is where it resolves Pi from — see
    // `PI_ROOT_ENV` for why that is passed instead of assumed.
    env: {
      ...process.env,
      [RUN_AS_NODE]: '1',
      GRAPHE_RUNTIME_NONCE: nonce,
      [PI_ENTRY_ENV]: options.piEntry ?? piEntry(),
      ...options.env,
    },
    // Two pipes of our own, numbered where the protocol module says. The
    // child's error output is piped rather than ignored: its last words are
    // what explains a start that never became ready.
    stdio: ['pipe', 'pipe', 'pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });

  const control = child.stdio[CHILD_WRITES_FD];
  const answers = child.stdio[SHELL_WRITES_FD];
  // Both are sockets under the hood and answer to both interfaces; the check is
  // there so a spawn that somehow did not wire them up fails here, at the start,
  // rather than as a write to undefined mid-turn.
  if (!(control instanceof Readable) || !(answers instanceof Writable)) {
    child.kill('SIGKILL');
    throw new Error('The child runtime could not be given its control channel.');
  }

  // A pipe to a child that has gone raises `error` with nobody listening,
  // which takes the whole shell down. Both of these are written to after a
  // child may have died — the refusal a death has to send is the one write
  // that is most likely to find a broken pipe — so a write that cannot land is
  // swallowed here rather than crashing the process it was protecting.
  control.on('error', () => undefined);
  answers.on('error', () => undefined);

  const eventListeners = new Set<(event: Record<string, unknown>) => void>();
  const exitListeners = new Set<(how: ChildExit) => void>();
  /** Pi's own answers, by the id this side sent. */
  const pending = new Map<string, (answer: Record<string, unknown>) => void>();
  /** The one question the child is holding. Answered once. */
  let judging: { id: string; call: ToolCall } | null = null;
  let chatter = '';
  let said = '';
  let pid = 0;
  let finished: ChildExit | null = null;
  /** Whether this side is taking the child down. Declared before the exit
   *  handler, which reads it to tell a kill of ours from a death of its own. */
  let stopping = false;
  let ready: (() => void) | null = null;
  let readyFailed: ((because: string) => void) | null = null;

  /** Question ids the child is holding answers for, oldest first. */
  const openAsks = new Set<string>();

  const tellEveryone = (how: ChildExit): void => {
    if (finished !== null) return;
    finished = how;
    for (const one of exitListeners) one(how);
    exitListeners.clear();
  };

  /** Everything still outstanding, named, for the exit to report. */
  const outstanding = (): readonly string[] => [
    ...(judging === null ? [] : [judging.id]),
    ...openAsks,
  ];

  const settleEverything = (): void => {
    // A tool call the child was holding is refused, not approved: the Guard's
    // promise is that nothing destructive runs without an answer, and a dead
    // shell is not an answer. The write is best-effort — the pipe may already
    // be gone, which is what an ended child looks like from here.
    if (judging !== null) {
      writeToChild(answers, asVerdict({ type: 'verdict', id: judging.id, block: true, reason: CANCELLED_REASON }, nonce));
      judging = null;
    }
    for (const settle of pending.values()) settle({ type: 'response', success: false, error: 'the runtime ended' });
    pending.clear();
  };

  const onChildLine = (line: string): void => {
    const says = fromChild(line, nonce);
    if (says !== null) {
      if (says.type === 'ready') {
        pid = says.pid;
        ready?.();
        ready = null;
        return;
      }
      if (says.type === 'stopped') {
        said = says.why;
        return;
      }
      void answerTheChild(says.id, says.call);
      return;
    }
    const event = asObject(line);
    if (event === null) return;
    if (event['type'] === 'response') {
      const id = typeof event['id'] === 'string' ? event['id'] : '';
      const settle = pending.get(id);
      if (settle !== undefined) {
        pending.delete(id);
        settle(event);
        return;
      }
    }
    if (event['type'] === 'extension_ui_request') {
      // A dialog is answered; everything else an extension asks for — a notice,
      // a status line, a widget — has no dialog to put it in and is still
      // something a host must be able to see. So it is routed and delivered,
      // not routed and dropped.
      void routeUi(event);
    }
    for (const one of eventListeners) one(event);
  };

  const answerTheChild = async (id: string, call: ToolCall): Promise<void> => {
    judging = { id, call };
    let verdict: { block: false } | { block: true; reason: string };
    try {
      verdict = await options.judge(call);
    } catch {
      // A Guard that threw is a Guard that did not say yes. The same answer as
      // a Guard that never answered at all.
      verdict = { block: true, reason: CANCELLED_REASON };
    }
    // The child may have died while the shell was deciding. Its verdict is
    // dropped rather than written to a pipe nobody holds.
    if (finished !== null || judging?.id !== id) return;
    judging = null;
    writeToChild(answers, asVerdict({ ...verdict, type: 'verdict', id }, nonce));
  };

  /**
   * An extension's question, drawn by the window and answered back.
   *
   * Pi grades these itself in its own shape, so the translation is per method:
   * a select answers with the option string it offered, a confirm with a
   * boolean, and a cancelled dialog with the one cancellation Pi documents.
   * A method this version cannot draw is reported and cancelled — never
   * answered with something invented.
   */
  const routeUi = async (held: Record<string, unknown>): Promise<void> => {
    const request = uiRequestIn(held);
    if (request === null) return;
    const ask = askFrom(request);
    if (ask === null) {
      options.onUnsupportedUi?.(request);
      return;
    }
    openAsks.add(request.id);
    const answer = options.ask === undefined ? cancelled(ask) : await options.ask(ask).catch(() => cancelled(ask));
    openAsks.delete(request.id);
    if (finished !== null) return;
    writeToChild(child.stdin, asRecord({ type: 'extension_ui_response', ...responseFor(request, answer) }));
  };

  child.stdout.setEncoding('utf8');
  let outHeld = '';
  child.stdout.on('data', (chunk: string) => {
    outHeld += chunk;
    const read = records(outHeld);
    outHeld = read.rest;
    for (const line of read.lines) onChildLine(line);
  });

  child.stderr.setEncoding('utf8');
  let errHeld = '';
  child.stderr.on('data', (chunk: string) => {
    errHeld += chunk;
    const read = records(errHeld);
    errHeld = read.rest;
    for (const line of read.lines) {
      if (line.trim() === '') continue;
      chatter = (chatter + line + '\n').slice(-SAID_MOST);
      options.onChatter?.(line);
    }
  });

  let controls = '';
  control.setEncoding('utf8');
  control.on('data', (chunk: string) => {
    controls += chunk;
    const read = records(controls);
    controls = read.rest;
    for (const line of read.lines) onChildLine(line);
  });

  child.on('error', (cause) => {
    const why = cause instanceof Error ? cause.message : String(cause);
    const waiting = outstanding();
    settleEverything();
    tellEveryone({ kind: 'died', said: why, unanswered: waiting });
    readyFailed?.(why);
    readyFailed = null;
    ready = null;
  });

  child.on('exit', (_code, signal) => {
    // Taken before anything is settled: the point is to name what was still
    // outstanding when the child went, and settling empties that list.
    const waiting = outstanding();
    // `killed` is this side's doing. Anything else is the child ending on its
    // own, which is a run being interrupted — never a run that finished.
    const how: ChildExit = stopping
      ? { kind: 'killed', unanswered: waiting }
      : {
          kind: 'died',
          said: said === '' ? (signal ?? 'it ended without saying why') : said,
          unanswered: waiting,
        };
    settleEverything();
    tellEveryone(how);
    readyFailed?.(how.kind === 'died' ? how.said : 'it was stopped before it was ready');
    readyFailed = null;
    ready = null;
  });

  const readyOrNot = new Promise<void>((resolve, reject) => {
    ready = resolve;
    readyFailed = reject;
  });
  const bell = setTimeout(() => {
    readyFailed?.('the runtime did not start within its patience');
    readyFailed = null;
    ready = null;
    child.kill('SIGKILL');
  }, READY_PATIENCE_MS);
  (bell as unknown as { unref?: () => void }).unref?.();

  try {
    await readyOrNot;
  } catch (cause) {
    throw new Error(cause instanceof Error ? cause.message : String(cause));
  } finally {
    clearTimeout(bell);
  }

  let answered = 0;
  return {
    nonce,
    get pid(): number {
      return pid;
    },

    send(command): Promise<Record<string, unknown>> {
      if (finished !== null) {
        return Promise.reject(new Error('That conversation is no longer running.'));
      }
      answered += 1;
      const id = `graphe-${String(answered)}`;
      const done = Promise.withResolvers<Record<string, unknown>>();
      pending.set(id, done.resolve);
      writeToChild(child.stdin, asRecord({ id, ...command }));
      return done.promise;
    },

    onEvent(listener): () => void {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },

    onExit(listener): () => void {
      if (finished !== null) {
        listener(finished);
        return () => undefined;
      }
      exitListeners.add(listener);
      return () => exitListeners.delete(listener);
    },

    async stop(): Promise<void> {
      if (finished !== null) return;
      stopping = true;
      child.kill('SIGTERM');
      const gone = Promise.withResolvers<void>();
      const once = (): void => gone.resolve();
      child.once('exit', once);
      const grace = setTimeout(() => {
        child.kill('SIGKILL');
      }, STOP_GRACE_MS);
      (grace as unknown as { unref?: () => void }).unref?.();
      await gone.promise;
      clearTimeout(grace);
      child.stdin.destroy();
      child.stdout.destroy();
      child.stderr.destroy();
      control.destroy();
      answers.destroy();
    },
  };
}
