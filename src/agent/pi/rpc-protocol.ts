/** The wire between the shell and a conversation's runtime.
 *
 * One child process hosts Pi for one conversation; the shell keeps the Guard,
 * the restore points and the window. Two things travel between them and nothing
 * else does:
 *
 *  - **Pi's own RPC protocol**, on stdin/stdout: commands out, responses and
 *    agent events in, and — because Pi runs the extensions — extension UI
 *    requests on the same stream. That is a documented interface of the
 *    installed package, not a shape inferred from it.
 *  - **A private control channel**, on fds 3 and 4, carrying the one question
 *    Pi's own protocol cannot carry: may this tool call run. Pi's hooks are
 *    in-process, so a Guard that lives in the shell has to answer the child
 *    over a channel of our own.
 *
 * The child is untrusted for the purposes of reading its words: every record
 * here is narrowed field by field, and one that does not match is dropped
 * rather than believed. Every control line carries the nonce the shell minted
 * for that one child, so a line from another process — or a line the model
 * talked an extension into printing — is not a Guard verdict.
 *
 * Framing is deliberately not `readline`. Pi's own documentation is explicit
 * that RPC mode splits records on LF alone, because U+2028 and U+2029 are valid
 * inside a JSON string and a line reader that treats them as newlines cuts a
 * record in half. The reader below is the whole of that rule.
 */

import type { ToolCall } from '../types';

/** Where the child writes what only the shell can answer. */
export const CHILD_WRITES_FD = 3;
/** Where the shell writes its answers. */
export const SHELL_WRITES_FD = 4;

/** The variable the one child of this run reads its nonce from. */
export const NONCE_ENV = 'GRAPHE_RUNTIME_NONCE';

/**
 * Pi's own entry file, as the shell resolved it.
 *
 * The child is built beside the shell, so on an ordinary install it could find
 * Pi by walking up from its own file. That is incidental rather than a
 * guarantee: a test builds the child into a scratch folder, and a copy of the
 * app may keep its worker somewhere else. Resolution is therefore the shell's —
 * it is the half that knows what it is installed with — and the child is told
 * the exact file to import rather than left to guess.
 */
export const PI_ENTRY_ENV = 'GRAPHE_RUNTIME_PI_ENTRY';

/** The nonce is minted per child and never reused. */
export type Nonce = string;

/* -------------------------------------------------------------------------- */
/* Framing                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * One record per LF. A trailing CR is accepted and dropped, because a shell
 * that pipes through a terminal may add one; nothing else is a delimiter.
 */
export function records(text: string): { lines: readonly string[]; rest: string } {
  const lines: string[] = [];
  let at = 0;
  while (true) {
    const end = text.indexOf('\n', at);
    if (end < 0) break;
    let line = text.slice(at, end);
    if (line.endsWith('\r')) line = line.slice(0, -1);
    lines.push(line);
    at = end + 1;
  }
  return { lines, rest: text.slice(at) };
}

/** A record ready to be written.
 *
 *  Nothing is escaped for the framing, because only LF delimits: `stringify`
 *  leaves U+2028 and U+2029 inside the string, and they are ordinary characters
 *  here rather than newlines. That is precisely why the rule is LF alone. */
export function asRecord(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

/** A JSON object, or null. Anything else — half a line, an array, a number —
 *  is not a record and must not be read as one. */
export function asObject(text: string): Record<string, unknown> | null {
  if (text.trim() === '') return null;
  try {
    const held: unknown = JSON.parse(text);
    if (held === null || typeof held !== 'object' || Array.isArray(held)) return null;
    return held as Record<string, unknown>;
  } catch {
    return null;
  }
}

function textAt(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === 'string' && value !== '' ? value : null;
}

/* -------------------------------------------------------------------------- */
/* What the child says                                                         */
/* -------------------------------------------------------------------------- */

/** The child has its control extension loaded and Pi is about to serve. The
 *  shell does not consider the runtime started until this arrives. */
export type ChildReady = { type: 'ready'; pid: number };

/** May this call run. `id` is the child's own, so its answer can be matched. */
export type ChildJudge = { type: 'judge'; id: string; call: ToolCall };

/** The child is going, and why. `why` is the child's own wording and is only
 *  ever used for the log — never as a sentence anybody is shown. */
export type ChildStopped = { type: 'stopped'; why: string };

export type ChildSays = ChildReady | ChildJudge | ChildStopped;

/** What the shell gives back: run it, or do not and here is the reason the
 *  model is told. There is no third answer — a question is answered by the
 *  shell asking the window, not by the child waiting on the wire. */
export type ShellVerdict =
  | { type: 'verdict'; id: string; block: false }
  | { type: 'verdict'; id: string; block: true; reason: string };

/**
 * Read one control line, or nothing.
 *
 * Nothing is the answer for a line that is not ours: the wrong nonce, an
 * unknown kind, a judge with no call. A child that could talk the shell into
 * answering a verdict it never asked for would be a Guard the model can reach.
 */
export function fromChild(line: string, nonce: Nonce): ChildSays | null {
  const held = asObject(line);
  if (held === null) return null;
  if (textAt(held, 'nonce') !== nonce) return null;
  const kind = textAt(held, 'type');
  if (kind === 'ready') {
    const pid = held['pid'];
    return { type: 'ready', pid: typeof pid === 'number' && Number.isInteger(pid) ? pid : 0 };
  }
  if (kind === 'stopped') return { type: 'stopped', why: textAt(held, 'why') ?? 'no reason given' };
  if (kind !== 'judge') return null;
  const id = textAt(held, 'id');
  const call = callIn(held['call']);
  return id === null || call === null ? null : { type: 'judge', id, call };
}

/** A tool call off the wire, or null. Narrowed to the three fields the Guard
 *  reads, so nothing else on the record can reach a policy decision. */
function callIn(value: unknown): ToolCall | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const id = textAt(row, 'id');
  const name = textAt(row, 'name');
  const input = row['input'];
  if (id === null || name === null) return null;
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return null;
  return { id, name, input: { ...(input as Record<string, unknown>) } };
}

/** Every line carries the nonce, on the way out as well as in: a child that
 *  started reading a leftover pipe must not act on another run's verdict. */
export function asVerdict(verdict: ShellVerdict, nonce: Nonce): string {
  return asRecord({ ...verdict, nonce });
}

/** What the shell answers about one call the child is holding. Named here
 *  rather than beside the supervisor because the Guard produces it: the child
 *  session hands the Guard over as one of these, and the supervisor consumes
 *  it. */
export type VerdictForCall = (call: ToolCall) => Promise<{ block: false } | { block: true; reason: string }>;

/* -------------------------------------------------------------------------- */
/* Pi's own protocol, as much of it as this side reads                        */
/* -------------------------------------------------------------------------- */

/**
 * A command for Pi, with an id so its response can be matched. The shape is
 * Pi's; this only names the write so the supervisor does not build JSON inline.
 */
export type Command = { id: string; type: string; [key: string]: unknown };

/** An extension UI request from Pi, as much of it as a window can draw. Loose
 *  on purpose: a method this version does not know is reported, not crashed on. */
export type UiRequest = {
  id: string;
  method: string;
  held: Record<string, unknown>;
};

export function uiRequestIn(value: Record<string, unknown>): UiRequest | null {
  const id = textAt(value, 'id');
  const method = textAt(value, 'method');
  if (id === null || method === null) return null;
  return { id, method, held: value };
}
