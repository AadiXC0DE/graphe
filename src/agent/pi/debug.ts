/** Driving a real debugger: attach to a running program and look inside it.
 *
 * All three debuggers a person is likely to meet — lldb (C, Swift, Rust),
 * dlv (Go) and debugpy (Python) — speak the same Debug Adapter Protocol, the
 * wire protocol every editor uses. This module is a small DAP client: enough
 * of the protocol to attach, step, read frames and evaluate, without any of
 * the UI. The agent gets narrow tools on top (debug_attach, debug_step,
 * debug_frames, debug_eval, debug_detach), and a session is one attached
 * process held by a registry for the life of the sitting.
 *
 * Backends, in the shape each one actually accepts:
 *
 *  - lldb: `lldb-dap` speaks DAP over stdio. Attach asks for {pid}.
 *  - dlv: `dlv dap` listens on a port; the client connects and asks for
 *    {processId}.
 *  - debugpy: `python -m debugpy --listen <port> --pid <pid>` injects a DAP
 *    server into the running process; the client connects and pauses it.
 *
 * One thing is deliberately not hidden: macOS asks once, in System Settings →
 * Privacy & Security → Developer Tools, before any process may be attached to.
 * The tools surface that sentence when the attach is refused.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { connect as tcpConnect, createServer, type Socket } from 'node:net';

/* -------------------------------------------------------------------------- */
/* The protocol                                                                */
/* -------------------------------------------------------------------------- */

type Request = { seq: number; type: 'request'; command: string; arguments?: unknown };
type Response = { type: 'response'; request_seq: number; success: boolean; body?: unknown; message?: string };
type EventMessage = { type: 'event'; event: string; body?: unknown };

/** One debugger connection: a process (stdio) or a socket (dlv, debugpy), and
 *  the framing of requests, responses and events on top of it. */
class Channel {
  private seq = 0;
  private buffer = '';
  private waiting = new Map<number, { resolve: (r: Response) => void; timer: ReturnType<typeof setTimeout> }>();
  private readonly pendingEvents: EventMessage[] = [];
  private eventWaiters: ((event: EventMessage) => void)[] = [];
  private closed = false;

  constructor(readonly wire: { write(data: string): void; onData(cb: (chunk: string) => void): void; onEnd(cb: () => void): void; onError(cb: (err: Error) => void): void; kill(): void }) {}

  request(command: string, arguments_: unknown, timeoutMs = 20_000): Promise<unknown> {
    const seq = ++this.seq;
    const payload: Request = { seq, type: 'request', command, ...(arguments_ === undefined ? {} : { arguments: arguments_ }) };
    return new Promise((resolve, reject) => {
      if (this.closed) {
        reject(new Error('The debugger connection is closed.'));
        return;
      }
      const timer = setTimeout(() => {
        this.waiting.delete(seq);
        reject(new Error(`The debugger did not answer "${command}" in time.`));
      }, timeoutMs);
      this.waiting.set(seq, {
        resolve: (response) => {
          clearTimeout(timer);
          if (!response.success) {
            reject(new Error(response.message ?? `The debugger refused "${command}".`));
            return;
          }
          resolve(response.body);
        },
        timer,
      });
      const body = JSON.stringify(payload);
      this.wire.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
    });
  }

  nextEvent(): Promise<EventMessage> {
    const pending = this.pendingEvents.shift();
    if (pending !== undefined) return Promise.resolve(pending);
    return new Promise((resolve) => this.eventWaiters.push(resolve));
  }

  private onMessage(message: unknown) {
    if (message === null || typeof message !== 'object') return;
    const kind = (message as { type?: string }).type;
    if (kind === 'response') {
      const response = message as Response;
      this.waiting.get(response.request_seq)?.resolve(response);
      this.waiting.delete(response.request_seq);
    } else if (kind === 'event') {
      const event = message as EventMessage;
      const waiter = this.eventWaiters.shift();
      if (waiter !== undefined) waiter(event);
      else this.pendingEvents.push(event);
    }
  }

  attach(): void {
    this.wire.onData((chunk) => {
      this.buffer += chunk;
      for (;;) {
        const header = /^Content-Length: (\d+)\r\n\r\n/.exec(this.buffer);
        if (header === null) {
          // Not a complete header yet; wait for more.
          return;
        }
        const length = Number(header[1]);
        const start = header[0].length;
        if (this.buffer.length < start + length) return;
        const raw = this.buffer.slice(start, start + length);
        this.buffer = this.buffer.slice(start + length);
        try {
          this.onMessage(JSON.parse(raw));
        } catch {
          // A line that is not JSON is debugger chatter; skip it.
        }
      }
    });
    this.wire.onError((error) => {
      this.closed = true;
      for (const entry of this.waiting.values()) {
        clearTimeout(entry.timer);
        entry.resolve({ type: 'response', request_seq: -1, success: false, message: error.message });
      }
      this.waiting.clear();
    });
    this.wire.onEnd(() => {
      this.closed = true;
      for (const entry of this.waiting.values()) {
        clearTimeout(entry.timer);
        entry.resolve({ type: 'response', request_seq: -1, success: false, message: 'The debugger went away.' });
      }
      this.waiting.clear();
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.wire.kill();
  }
}

function stdioChannel(child: ChildProcess): Channel['wire'] {
  return {
    write(data) {
      child.stdin?.write(data);
    },
    onData(cb) {
      child.stdout?.setEncoding('utf8');
      child.stdout?.on('data', cb);
    },
    onEnd(cb) {
      child.on('close', cb);
    },
    onError(cb) {
      child.on('error', cb);
    },
    kill() {
      if (!child.killed) child.kill('SIGTERM');
    },
  };
}

function socketChannel(socket: Socket): Channel['wire'] {
  return {
    write(data) {
      socket.write(data);
    },
    onData(cb) {
      socket.setEncoding('utf8');
      socket.on('data', cb);
    },
    onEnd(cb) {
      socket.on('end', cb);
    },
    onError(cb) {
      socket.on('error', cb);
    },
    kill() {
      socket.destroy();
    },
  };
}

/** A free port for a backend that listens (dlv, debugpy). */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() => resolve(typeof address === 'object' && address !== null ? address.port : 0));
    });
    probe.on('error', reject);
  });
}

/* -------------------------------------------------------------------------- */
/* One attached process                                                        */
/* -------------------------------------------------------------------------- */

export type DebugTarget = {
  pid: number;
  /** 'c' for C-family via lldb, 'go', 'python', or anything to let the agent
   *  decide by what is running. */
  kind?: 'c' | 'go' | 'python' | string;
  /** Optional program path for lldb, when pid attach needs it. */
  program?: string;
};

export type Frame = {
  id: number;
  name: string;
  line?: number;
  file?: string;
  source?: string;
  variables?: readonly { name: string; value: string; type?: string }[];
};

export type DebuggerSession = {
  target: DebugTarget;
  channel: Channel;
  threadId?: number;
};

/** Pick the debugger binary for a kind: lldb-dap for C-family, dlv for Go,
 *  debugpy for Python. Returns null when the binary is nowhere to be found. */
export async function backendFor(kind: DebugTarget['kind']): Promise<{ backend: 'lldb' | 'dlv' | 'debugpy'; command: string; args: string[] } | { error: string }> {
  const find = async (name: string): Promise<string | null> => {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    try {
      const { stdout } = await promisify(execFile)('xcrun', ['-f', name]);
      return stdout.trim() || null;
    } catch {
      return null;
    }
  };

  if (kind === 'go') {
    const dlv = await find('dlv').catch(() => null);
    if (dlv === null) return { error: 'I could not find the Go debugger (dlv). Install it with: go install github.com/go-delve/delve/cmd/dlv@latest' };
    return { backend: 'dlv', command: dlv, args: [] };
  }
  if (kind === 'python') {
    const python = (await find('python3').catch(() => null)) ?? 'python3';
    return { backend: 'debugpy', command: python, args: ['-m', 'debugpy'] };
  }
  const lldb = (await find('lldb-dap').catch(() => null)) ?? null;
  if (lldb === null) {
    return { error: 'I could not find the debugger (lldb-dap). It comes with Xcode or the Command Line Tools — install either and try again.' };
  }
  return { backend: 'lldb', command: lldb, args: [] };
}

/** The one wait that matters: the target has stopped and its threads can be
 *  read. Attach stops a target; step resumes it and it stops again. */
async function waitStopped(channel: Channel, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const event = await channel.nextEvent();
    if (event.event === 'stopped') return;
    if (event.event === 'exited' || event.event === 'terminated') {
      throw new Error('The target process exited while we were working with it.');
    }
  }
  throw new Error('The target did not stop in time.');
}

/** Attach to a running process. Returns the session, or an error sentence.
 *  `backendOverride` is for tests: hand a stub debugger instead of the real one. */
export async function attach(
  target: DebugTarget,
  backendOverride?: { backend: 'lldb' | 'dlv' | 'debugpy'; command: string; args: string[] },
): Promise<DebuggerSession> {
  const resolved = backendOverride ?? (await backendFor(target.kind));
  if ('error' in resolved) throw new Error(resolved.error);

  let channel: Channel;
  if (resolved.backend === 'lldb') {
    const child = spawn(resolved.command, resolved.args, { stdio: ['pipe', 'pipe', 'pipe'] });
    channel = new Channel(stdioChannel(child));
    channel.attach();
    await channel.request('initialize', { adapterID: 'lldb-dap', supportsVariableType: true }, 10_000);
    await channel.request('attach', { pid: target.pid, stopOnEntry: false, program: target.program }, 15_000);
    await channel.request('configurationDone', undefined, 10_000);
    await waitStopped(channel, 15_000);
  } else {
    const port = await freePort();
    let child: ChildProcess | null = null;
    if (resolved.backend === 'dlv') {
      child = spawn(resolved.command, ['dap', '--listen', `127.0.0.1:${port}`], { stdio: 'ignore' });
      await waitForPort(port, 15_000);
      channel = new Channel(socketChannel(await openSocket(port)));
      channel.attach();
      await channel.request('initialize', { adapterID: 'dlv', supportsVariableType: true }, 10_000);
      await channel.request('attach', { processId: target.pid, stopOnEntry: false }, 15_000);
      await channel.request('configurationDone', undefined, 10_000);
      await waitStopped(channel, 15_000);
    } else {
      // debugpy: inject into the running process, then connect to its port.
      const injected = spawn(resolved.command, ['-m', 'debugpy', '--listen', `127.0.0.1:${port}`, '--pid', String(target.pid)], { stdio: 'ignore' });
      await waitForPort(port, 20_000);
      injected.kill('SIGTERM');
      channel = new Channel(socketChannel(await openSocket(port)));
      channel.attach();
      await channel.request('initialize', { adapterID: 'debugpy', supportsVariableType: true }, 10_000);
      await channel.request('pause', { threadId: 1 }, 10_000);
      await waitStopped(channel, 10_000);
    }
    if (child !== null) {
      // dlv keeps listening after detach; we own the process we spawned.
      const owned = child;
      const original = channel.wire.kill.bind(channel.wire);
      channel.wire.kill = () => {
        original();
        if (!owned.killed) owned.kill('SIGTERM');
      };
    }
  }

  const session: DebuggerSession = { target, channel };
  return session;
}

function waitForPort(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const socket = tcpConnect({ port, host: '127.0.0.1' });
      socket.once('connect', () => {
        socket.destroy();
        resolve();
      });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() > deadline) reject(new Error('The debugger never opened its door.'));
        else setTimeout(tryOnce, 200);
      });
    };
    tryOnce();
  });
}

function openSocket(port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = tcpConnect({ port, host: '127.0.0.1' });
    socket.once('connect', () => resolve(socket));
    socket.once('error', reject);
  });
}

/* -------------------------------------------------------------------------- */
/* Reading the target                                                          */
/* -------------------------------------------------------------------------- */

/** The frames of the stopped thread, with the top frame's variables filled in
 *  so the agent can read what a crash actually had in hand. */
export async function frames(session: DebuggerSession, limit = 12): Promise<readonly Frame[]> {
  const threads = (await session.channel.request('threads', undefined, 10_000)) as { threads?: { id: number; name?: string }[] };
  const threadId = session.threadId ?? threads.threads?.[0]?.id;
  if (threadId === undefined) throw new Error('The target has no threads to read.');
  session.threadId = threadId;

  const stack = (await session.channel.request('stackTrace', { threadId, startFrame: 0, levels: limit }, 10_000)) as {
    stackFrames?: { id: number; name: string; line?: number; source?: { path?: string; name?: string } }[];
  };
  const out: Frame[] = [];
  for (const raw of stack.stackFrames ?? []) {
    const frame: Frame = {
      id: raw.id,
      name: raw.name,
      line: raw.line,
      file: raw.source?.path,
      source: raw.source?.name,
    };
    out.push(frame);
  }
  // Only the top frame's locals: reading every frame's variables is how a
  // debugger call explodes into a wall of text.
  const top = out[0];
  if (top !== undefined) {
    try {
      const scopes = (await session.channel.request('scopes', { frameId: top.id }, 10_000)) as { scopes?: { variablesReference: number; name?: string }[] };
      const locals = scopes.scopes?.find((scope) => scope.variablesReference !== 0);
      if (locals !== undefined) {
        const values = (await session.channel.request('variables', { variablesReference: locals.variablesReference }, 10_000)) as {
          variables?: { name: string; value: string; type?: string }[];
        };
        top.variables = (values.variables ?? []).slice(0, 20).map((variable) => ({
          name: variable.name,
          value: variable.value,
          type: variable.type,
        }));
      }
    } catch {
      // Frames without variables are still frames.
    }
  }
  return out;
}

/** Step the stopped thread; returns the frames where it landed. */
export async function step(session: DebuggerSession, direction: 'over' | 'into' | 'out'): Promise<readonly Frame[]> {
  const threadId = session.threadId ?? ((await session.channel.request('threads', undefined, 10_000)) as { threads?: { id?: number }[] }).threads?.[0]?.id;
  if (threadId === undefined) throw new Error('I do not know which thread to step.');
  session.threadId = threadId;
  const command = direction === 'over' ? 'next' : direction === 'into' ? 'stepIn' : 'stepOut';
  await session.channel.request(command, { threadId }, 5_000);
  await waitStopped(session.channel, 20_000);
  return frames(session);
}

/** Evaluate an expression in the top frame of the stopped thread. */
export async function evaluate(session: DebuggerSession, expression: string): Promise<string> {
  const threadId = session.threadId;
  if (threadId === undefined) throw new Error('Attach first, then evaluate.');
  const stack = (await session.channel.request('stackTrace', { threadId, startFrame: 0, levels: 1 }, 10_000)) as { stackFrames?: { id?: number }[] };
  const frameId = stack.stackFrames?.[0]?.id;
  if (frameId === undefined) throw new Error('There is no frame to evaluate in.');
  const result = (await session.channel.request('evaluate', { expression, frameId, context: 'repl' }, 15_000)) as { result?: string; variablesReference?: number };
  return result.result ?? '(nothing came back)';
}

/** Let the target run on, and say goodbye without killing it. */
export async function detach(session: DebuggerSession): Promise<void> {
  try {
    await session.channel.request('disconnect', { terminateDebuggee: false }, 5_000);
  } catch {
    // The disconnect itself failing still means the target was let go.
  }
  session.channel.close();
}

/** The sentence a refused attach gets on a Mac: the one-time permission. */
export function permissionHint(): string {
  return 'macOS let the attach be refused because this app has not been allowed to debug yet. Open System Settings → Privacy & Security → Developer Tools, let Graphe debug, and try again. A program that cannot be attached to for other reasons — a system one, for instance — needs a different approach: run it under the debugger from the start instead.';
}

/** The one-shot fallbacks, when a real attach is not possible. */
export const ONESHOT = [
  'A wedged Python program can still be read with a stack dump: py-spy dump --pid <pid> (install with: pip install py-spy).',
  'A crashing program can be run under the debugger from the start: lldb <program> -o run -o bt -o quit.',
] as const;