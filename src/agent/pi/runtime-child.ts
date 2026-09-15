/** One conversation's agent runtime, in a process that can be ended.
 *
 * Pi runs here, and so do the extensions somebody trusted — which is the whole
 * point: extension code is arbitrary JavaScript and it belongs off Electron's
 * main event loop, where a loop that never yields cannot freeze the window.
 * This file is the child half; `electron/services/runtime-supervisor.ts` is the
 * parent half, and `./rpc-protocol.ts` is everything they say to each other.
 *
 * Three parts:
 *
 *  - **Pi's own RPC mode**, reached through the package's documented `main()`
 *    with `--mode rpc`. Its stdin/stdout carry commands, responses and agent
 *    events, and its own extension UI sub-protocol — the dialogs and notices an
 *    extension asks for — which the shell's window answers.
 *  - **A control extension**, handed to `main()` as an inline factory rather
 *    than loaded from a path: the shell has to be able to host *its* Guard hook
 *    in a child that has never seen a file on our disk. The factory registers
 *    the guard hook and the transcript's secret masker, and nothing else.
 *  - **A judge link** on fds 3/4, the one thing Pi's own protocol has no place
 *    for: whether a tool call may run is the shell's decision, and the answer
 *    has to arrive before Pi reaches the tool.
 *
 * What is deliberately *not* here: an agent directory, a model catalogue, a
 * credential. Those are the shell's to choose and arrive as ordinary Pi
 * arguments, so a migration never keeps two copies of them in step.
 *
 * Started under `ELECTRON_RUN_AS_NODE`, exactly like the helper and the
 * extension probe, and built beside the shell (`runtime-child.mjs`) so packaged
 * and unpackaged builds resolve it the same way.
 */

import { createReadStream, createWriteStream, realpathSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

import type { ExtensionAPI, InlineExtension, ToolCallEvent, ToolResultEvent } from '@earendil-works/pi-coding-agent';

import { patchWorkerThreads } from './node-shim';
import { maskToolResult } from './redact';
import { NONCE_ENV, PI_ENTRY_ENV, asRecord, records, type ChildSays, type ShellVerdict } from './rpc-protocol';

/**
 * Pi, at the file the shell resolved.
 *
 * A dynamic import rather than a static one, and the only place in this file
 * that has to be: the specifier arrives from the shell. The child never guesses
 * where Pi lives — a bare specifier would resolve from wherever this file
 * happens to sit, which is the app's own folder in an ordinary install and
 * nowhere at all for a worker built into a scratch folder. The shell is the
 * half that knows what it is installed with, so it says, and a child started
 * without that is a start that failed rather than a wrong Pi loaded.
 */
async function loadPi(): Promise<typeof import('@earendil-works/pi-coding-agent')> {
  const at = (process.env[PI_ENTRY_ENV] ?? '').trim();
  if (at === '') throw new Error('the runtime was not told which Pi to use');
  const loaded = await import(pathToFileURL(at).href);
  return loaded as typeof import('@earendil-works/pi-coding-agent');
}

/**
 * How long the shell has to answer one judgement before the call is refused.
 *
 * Refused, not allowed. The Guard's whole promise is that nothing destructive
 * runs without somebody's answer, and a shell that has stopped answering — it
 * was killed, it wedged, its pipe filled — is not an answer. A call refused on
 * this deadline is a sentence the model reads; a call allowed on it would be
 * the single failure this boundary exists to prevent.
 */
const JUDGE_PATIENCE_MS = 120_000;

/** Where the child says what only it knows, on the control channel. */
function controlOut(): (says: ChildSays) => void {
  const out = createWriteStream('', { fd: 3, autoClose: false });
  const nonce = process.env[NONCE_ENV] ?? '';
  // A child whose parent has gone must not be held alive by the write that was
  // telling it so. Nothing here is worth waiting for afterwards.
  out.on('error', () => undefined);
  return (says) => {
    out.write(asRecord({ ...says, nonce }));
  };
}

/**
 * Ask the shell about one tool call, and wait for its answer.
 *
 * The answer is matched by id and by nonce: the nonce was minted for this child
 * and no other, and a verdict for a question already refused must not be read
 * as the answer to the next one.
 */
function judgeLink(): (id: string) => Promise<ShellVerdict | null> {
  const nonce = process.env[NONCE_ENV] ?? '';
  const from = createReadStream('', { fd: 4, autoClose: false });
  from.on('error', () => undefined);
  /** The one question in flight. Pi preflights sibling calls one at a time. */
  let waiting: { id: string; settle: (answer: ShellVerdict | null) => void } | null = null;
  let held = '';

  const stopWaiting = (answer: ShellVerdict | null): void => {
    const one = waiting;
    waiting = null;
    one?.settle(answer);
  };

  from.on('data', (chunk: string | Buffer) => {
    held += String(chunk);
    const read = records(held);
    held = read.rest;
    for (const line of read.lines) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
      const row = parsed as Record<string, unknown>;
      if (row['nonce'] !== nonce || row['type'] !== 'verdict') continue;
      const id = typeof row['id'] === 'string' ? row['id'] : '';
      if (id === '' || waiting?.id !== id) continue;
      const block = row['block'] === true;
      const reason = typeof row['reason'] === 'string' ? row['reason'] : '';
      waiting.settle(block ? { type: 'verdict', id, block: true, reason } : { type: 'verdict', id, block: false });
      waiting = null;
    }
  });

  return (id: string) =>
    new Promise<ShellVerdict | null>((resolve) => {
      // A second question supersedes the first rather than queueing behind it:
      // the first has already been refused, and its promise must not be left
      // hanging with a deadline of its own.
      stopWaiting(null);
      const bell = setTimeout(() => {
        if (waiting?.id === id) stopWaiting(null);
      }, JUDGE_PATIENCE_MS);
      (bell as unknown as { unref?: () => void }).unref?.();
      waiting = {
        id,
        settle: (answer) => {
          clearTimeout(bell);
          resolve(answer);
        },
      };
    });
}

/** The tool call as the shell's Guard reads it. A copy, not a view: the Guard
 *  judges what it was handed, and a later mutation of Pi's own object — which
 *  the `tool_call` contract explicitly allows — cannot change that. */
function callOf(event: ToolCallEvent): { id: string; name: string; input: Record<string, unknown> } {
  return { id: event.toolCallId, name: event.toolName, input: { ...event.input } };
}

/** The shell's own hooks, hosted in the child. */
function controlExtension(out: (says: ChildSays) => void, ask: (id: string) => Promise<ShellVerdict | null>): InlineExtension {
  return {
    name: 'graphe-control',
    factory: (api: ExtensionAPI): void => {
      out({ type: 'ready', pid: process.pid });
      api.on('tool_call', async (event: ToolCallEvent) => {
        const call = callOf(event);
        if (call.id === '' || call.name === '') return undefined;
        out({ type: 'judge', id: call.id, call });
        const answer = await ask(call.id);
        if (answer === null) {
          return {
            block: true,
            reason: 'I could not check whether that was safe, so I did not do it. Nothing has changed.',
          };
        }
        return answer.block ? { block: true, reason: answer.reason } : undefined;
      });
      // A transcript is kept for ever and holds whatever the tools read — file
      // contents, command output, whole pages — in the clear. The Guard refuses
      // to read a credential file, but full-access shell output is nobody's to
      // filter, and this is the last place before Pi appends the result to the
      // file on disk. The same masker the in-process path uses, at the same
      // moment.
      api.on('tool_result', (event: ToolResultEvent) => {
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
        return found === 0 ? undefined : { content };
      });
    },
  } as InlineExtension;
}

/** Whether this file is the program that was started, rather than a module a
 *  test imported. Both sides resolved, because a temp folder on this machine is
 *  reached by two paths. */
function startedHere(): boolean {
  const at = process.argv[1];
  if (at === undefined) return false;
  try {
    return realpathSync(at) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (startedHere()) {
  // Before the first import of Pi: the child is Electron's Node, and undici
  // reads a function that Node does not have. See ./node-shim.ts. Both of the
  // module's imports are hoisted, so this is the earliest statement that runs.
  patchWorkerThreads();

  // The same two markers Pi's CLI entry sets, so a tool the child runs sees the
  // world it would see under `pi` directly.
  process.env['PI_CODING_AGENT'] = 'true';
  process.env['AI_AGENT'] = 'pi';

  const out = controlOut();
  const { main } = await loadPi();
  await main(['--mode', 'rpc', ...process.argv.slice(2)], {
    extensionFactories: [controlExtension(out, judgeLink())],
  });
}
