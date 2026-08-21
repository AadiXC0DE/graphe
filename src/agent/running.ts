/** Things that keep running after the turn that started them.
 *
 * A command the agent runs ordinarily is a question and an answer: it starts, it
 * finishes, its output is the reply. A server is not that. It answers by staying
 * up, and everything useful about it happens afterwards — which is why running
 * one through the ordinary path could only ever end two ways: the turn hangs
 * waiting for a command that never returns, or the command is let go of and dies
 * with the shell that held it.
 *
 * So a server is kept here instead. Started once, held for as long as the
 * project is open, its output collected while nobody is reading, and stopped by
 * name — by the agent, by the person, or by the project closing.
 *
 * ## The boundary is still on
 *
 * These run inside the same kernel boundary as every other command, with one
 * capability added by name: `reach: 'serving'` lets a process bind a port on
 * this machine (see sandbox/profile.ts). That is the whole difference. Writes
 * are bound to the same folders, the private places are still refused, and
 * nothing outside this machine can reach what is bound.
 *
 * Pure enough to test: everything that decides — what to call a piece, which
 * address came out of its output, what to keep of it — is a function here, and
 * only `start` and `stop` touch a process.
 */

import { spawn, type ChildProcess } from 'node:child_process';

import { portEnv } from '../work/ports';
import { worthShowing, type Answered } from '../lib/showable';
import { hold } from './sandbox';
import type { Bounds } from './sandbox/profile';
import type { RunningPiece } from './types';

export type { RunningPiece, RunState } from './types';

/** How much of a server's talking to keep. Enough to see why it would not
 *  start; far short of a log file. */
const KEEP = 16_000;

/** How long to wait for a server to say where it is before answering anyway.
 *  Vite takes about a second; something building from cold takes longer and is
 *  reported as still starting rather than as broken. */
export const SETTLE = 4_000;


/* -------------------------------------------------------------------------- */
/* Reading what it says                                                        */
/* -------------------------------------------------------------------------- */

/** Every shape a server uses to say where it is. `0.0.0.0` and `[::]` mean "any
 *  address on this machine", which for somebody looking at it means localhost. */
/** Any local host, including the LAN address Flask and Django print. The path
 *  stops before the punctuation a banner wraps it in: python's own line ends
 *  `(http://[::]:8000/) ...`, and taking the bracket with it produced an
 *  address that looked right in a log and would not load. */
const ADDRESS =
  /https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\d{1,3}(?:\.\d{1,3}){3}|\[::1?\]|\[::\]):(\d{2,5})(\/[^\s"'`)\],;]*)?/gi;

const ANYWHERE = new Set(['0.0.0.0', '[::]', '[::1]']);

/**
 * The address a server has announced, or null if it has not yet.
 *
 * The last one wins. A dev server prints its own address after the banner it
 * printed first, and tools that proxy print the one they are proxying to before
 * the one to actually open.
 */
export function addressIn(output: string): string | null {
  let found: string | null = null;
  for (const match of output.matchAll(ADDRESS)) {
    const host = (match[1] ?? '').toLowerCase();
    const port = match[2] ?? '';
    const path = match[3] ?? '';
    const where = ANYWHERE.has(host) || host === '127.0.0.1' ? 'localhost' : host;
    found = `http://${where}:${port}${path === '/' ? '' : path}`;
  }
  return found;
}

/**
 * The port a process is actually listening on, asked of the computer.
 *
 * Reading the address out of what a server prints is a guess about somebody
 * else's banner, and it fails in a way nobody can see: Python buffers its one
 * line when it is not attached to a terminal, so the address never arrives at
 * all and the piece sits there with no way to open it. Others print a path, a
 * proxy, or nothing.
 *
 * So this asks the operating system instead. It answers for anything that
 * listens — a Rails server, a Go binary, something nobody has thought of —
 * without knowing what any of them print.
 *
 * Null when nothing is listening yet, which is the ordinary answer for a
 * worker or a watcher and not a failure.
 */
export async function listeningPort(pid: number): Promise<number | null> {
  const { execFile } = await import('node:child_process');
  return new Promise((resolve) => {
    // The child is a shell that started the real thing, so the whole group is
    // asked about rather than the one process we happen to hold.
    execFile(
      'lsof',
      ['-nP', '-iTCP', '-sTCP:LISTEN', '-a', '-g', String(pid), '-Fn'],
      { timeout: 4000 },
      (_error, out) => {
        const ports = [...String(out).matchAll(/^n.*:(\d{2,5})$/gm)].map((one) => Number(one[1]));
        resolve(ports.length === 0 ? null : (ports[0] as number));
      },
    );
  });
}

/**
 * Ask an address what it answers with, once.
 *
 * A HEAD first, because a page can be large and nothing here needs the body;
 * some servers refuse HEAD, so a GET follows. Short timeout: this decides
 * whether to open a frame, and a slow answer is not worth holding anything up
 * for.
 */
export async function whatItAnswers(address: string): Promise<Answered> {
  const ask = async (method: 'HEAD' | 'GET'): Promise<Answered | null> => {
    const stop = new AbortController();
    const timer = setTimeout(() => stop.abort(), 2500);
    try {
      const said = await fetch(address, { method, signal: stop.signal, redirect: 'follow' });
      return { status: said.status, type: said.headers.get('content-type') };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };
  return (await ask('HEAD')) ?? (await ask('GET')) ?? { status: null, type: null };
}

/** What to call this in a sentence, when nobody said. The program's own name,
 *  which is what somebody would call it anyway: "vite", "npm run dev". */
export function labelFor(command: string): string {
  const line = command.replace(/\s+/g, ' ').trim();
  const withoutCd = line.replace(/^cd\s+\S+\s*&&\s*/, '');
  const words = withoutCd.split(' ').filter((word) => !word.startsWith('-'));
  const first = words.slice(0, 3).join(' ');
  return first === '' ? 'something' : first;
}

/* -------------------------------------------------------------------------- */
/* The register                                                                */
/* -------------------------------------------------------------------------- */
type Entry = {
  piece: RunningPiece;
  child: ChildProcess | null;
  said: string;
  /** Resolves on the process's exit, not when a signal was merely sent. Stop
   *  waits on this so its button never claims success while the port is held. */
  ended: Promise<void>;
  resolveEnded: () => void;
  /** How much of `said` has already been handed back, so a reader gets what is
   *  new rather than the whole thing again. */
  read: number;
};

export type StartOptions = {
  command: string;
  folder: string;
  /** Told the process id and the command of everything started here, and told
   *  again when it ends. A server is whatever somebody asked for, so the only
   *  way to recognise one after a crash is to have written it down at the
   *  time. Left out, nothing is written and a crash leaves it holding its port. */
  noted?: { began: (pid: number, command: string) => void; ended: (pid: number) => void };
  /** What the person or the agent calls it. Left out, the command names itself. */
  label?: string;
  /** The shell to run it through, as the sandbox already resolves one. */
  parts: { shell: string; args: readonly string[] };
  /** Where it may write. The reach is always `serving` — that is what this is. */
  writable: readonly string[];
  /** The door this copy of the project owns. Told to the process so whatever
   *  it runs picks it up, instead of four copies all asking for the same one. */
  port?: number | null;
  /** The turn that asked for it. Stopping that turn while startup is in flight
   *  must not let a server appear afterwards. */
  signal?: AbortSignal;
  /** How long to wait for it to say where it is. */
  settle?: number;
  /** Told whenever a piece changes, so a window can redraw without asking. */
  onChange?: () => void;
};

/**
 * Everything this project has running.
 *
 * One per project, held by whoever holds the project. Nothing in here survives
 * the project closing: `stopAll` is called then, and a process group is ended
 * rather than a process, so a shell's children go with it.
 */
export class Running {
  #entries = new Map<string, Entry>();
  #next = 0;
  #closed = false;

  /** What is running, oldest first. Safe to hand anywhere: a copy, not the
   *  thing the register is keeping. */
  list(): readonly RunningPiece[] {
    return [...this.#entries.values()].map((entry) => ({ ...entry.piece }));
  }

  at(id: string): RunningPiece | null {
    const entry = this.#entries.get(id);
    return entry === undefined ? null : { ...entry.piece };
  }

  /** What it has said since the last time somebody asked. `all` for the lot. */
  said(id: string, options: { all?: boolean } = {}): string {
    const entry = this.#entries.get(id);
    if (entry === undefined) return '';
    if (options.all === true) return entry.said;
    const fresh = entry.said.slice(entry.read);
    entry.read = entry.said.length;
    return fresh;
  }

  /**
   * Start something and hand it back once it has said where it is — or once it
   * is clear it is not going to say soon, which is not the same as broken.
   */
  async start(options: StartOptions): Promise<RunningPiece> {
    const wasAborted = (): boolean => options.signal?.aborted === true;
    if (this.#closed) throw new Error('That project is no longer open.');
    if (wasAborted()) throw new Error('Starting that was stopped.');
    const id = `run-${String(++this.#next)}`;
    const bounds: Bounds = { writable: [...options.writable], reach: 'serving' };
    const bound = await hold(options.parts.shell, [...options.parts.args, options.command], bounds);
    // The project may have closed while the operating-system boundary was being
    // prepared. Never spawn after its owner has gone away.
    if (this.#closed) throw new Error('That project is no longer open.');
    if (wasAborted()) throw new Error('Starting that was stopped.');

    const piece: RunningPiece = {
      id,
      label: options.label?.trim() || labelFor(options.command),
      command: options.command,
      folder: options.folder,
      address: null,
      state: 'starting',
      since: Date.now(),
      exitCode: null,
    };
    let resolveEnded = (): void => undefined;
    const ended = new Promise<void>((resolve) => {
      resolveEnded = resolve;
    });
    const entry: Entry = { piece, child: null, said: '', ended, resolveEnded, read: 0 };
    this.#entries.set(id, entry);

    const [program, ...args] = bound.held
      ? [bound.command, ...bound.args]
      : [options.parts.shell, ...options.parts.args, options.command];
    if (!bound.held) {
      entry.said = `${bound.sentence}\n`;
    }

    const child = spawn(program ?? options.parts.shell, args, {
      cwd: options.folder,
      env: {
        ...process.env,
        FORCE_COLOR: '0',
        NO_COLOR: '1',
        ...(options.port == null ? {} : portEnv(options.port)),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      // Its own group, so stopping it stops what it started. A dev server is
      // almost always a script that spawns the real thing.
      detached: process.platform !== 'win32',
    });
    entry.child = child;
    if (child.pid !== undefined) options.noted?.began(child.pid, options.command);
    const abort = (): void => end(child, entry.ended);
    if (wasAborted()) abort();
    else options.signal?.addEventListener('abort', abort, { once: true });

    const heard = (chunk: Buffer): void => {
      entry.said = `${entry.said}${chunk.toString('utf8')}`.slice(-KEEP);
      entry.read = Math.min(entry.read, entry.said.length);
      const address = addressIn(entry.said);
      if (address !== null && entry.piece.address !== address) {
        entry.piece.address = address;
        entry.piece.state = 'running';
        options.onChange?.();
      }
    };
    child.stdout?.on('data', heard);
    child.stderr?.on('data', heard);

    child.once('error', (cause: NodeJS.ErrnoException) => {
      entry.said = `${entry.said}${cause.message}\n`.slice(-KEEP);
      entry.piece.state = 'stopped';
      entry.piece.exitCode = null;
      entry.child = null;
      options.signal?.removeEventListener('abort', abort);
      entry.resolveEnded();
      options.onChange?.();
    });
    // Both, because they are different questions. `exit` is the process going;
    // `close` also waits for every pipe it handed on, and something that
    // double-forked out of the group keeps those open for as long as it lives —
    // so waiting only for `close` left the band saying "running" forever and the
    // note of it never cleared.
    const markEnded = (code: number | null): void => {
      if (entry.piece.state !== 'stopped') {
        entry.piece.state = 'stopped';
        entry.piece.exitCode = code;
        if (child.pid !== undefined) options.noted?.ended(child.pid);
        entry.child = null;
        options.onChange?.();
      }
      options.signal?.removeEventListener('abort', abort);
      entry.resolveEnded();
    };
    child.once('exit', (code) => markEnded(code));
    child.once('close', (code) => markEnded(code));

    await settled(entry, options.settle ?? SETTLE);

    // Nothing printed, but something may well be listening: a banner that was
    // buffered, or a server that never had one. Ask the computer before giving
    // up on an address, because without one there is nothing to open and the
    // piece reads as a job with no result.
    if (entry.piece.address === null && entry.piece.state !== 'stopped' && child.pid !== undefined) {
      const port = await listeningPort(child.pid);
      if (port !== null) entry.piece.address = `http://localhost:${String(port)}`;
    }

    // Holding a port says nothing about whether there is anything to look at.
    // An API answers in JSON, a worker answers nothing at all, and putting
    // either in a frame shows somebody a wall of braces where their work should
    // be. Asked once, of the address itself, so a server nobody has thought of
    // yet is judged by what it actually answers with.
    if (entry.piece.address !== null && entry.piece.state !== 'stopped') {
      entry.piece.showsAPage = worthShowing(await whatItAnswers(entry.piece.address));
    }

    // Still up and saying nothing about an address is ordinary: a background
    // worker, a watcher, an API that prints nothing. Running is what it is.
    if (entry.piece.state === 'starting') entry.piece.state = 'running';
    options.onChange?.();
    return { ...entry.piece };
  }

  /** Stop one. Ends its whole group and does not answer until the process has
   *  actually gone (or the hard-stop window has elapsed). */
  async stop(id: string): Promise<boolean> {
    const entry = this.#entries.get(id);
    if (entry === undefined) return false;
    if (entry.piece.state === 'stopped' || entry.child === null) return true;
    end(entry.child, entry.ended);
    await Promise.race([
      entry.ended,
      new Promise<void>((resolve) => setTimeout(resolve, STOP_WAIT_MS)),
    ]);
    // A process that never delivered an exit event is no reason to leave the UI
    // claiming it is alive after both TERM and KILL have been sent.
    const latest = this.#entries.get(id);
    if (latest !== undefined && latest.piece.state !== 'stopped') {
      latest.piece.state = 'stopped';
      latest.piece.exitCode = null;
      latest.child = null;
      latest.resolveEnded();
    }
    return true;
  }

  /** Stop everything and forget it. The project is closing. */
  stopAll(): void {
    this.#closed = true;
    for (const id of [...this.#entries.keys()]) void this.stop(id);
    this.#entries.clear();
  }

  /** Drop the ones that have ended, so a list somebody reads is about now. Kept
   *  separate from stopping: a piece that fell over stays visible until asked
   *  about, or nobody would ever learn that it had. */
  forgetStopped(): void {
    for (const [id, entry] of this.#entries) {
      if (entry.piece.state === 'stopped') this.#entries.delete(id);
    }
  }
}

/** Wait for an address, for the thing to fall over, or for the patience to run
 *  out — whichever comes first. */
function settled(entry: Entry, patience: number): Promise<void> {
  return new Promise((resolve) => {
    const started = Date.now();
    const look = setInterval(() => {
      const done =
        entry.piece.address !== null ||
        entry.piece.state === 'stopped' ||
        Date.now() - started >= patience;
      if (!done) return;
      clearInterval(look);
      resolve();
    }, 60);
    look.unref?.();
  });
}
/** A polite server should be gone almost immediately. Half a second still gives
 * cleanup hooks time to run, while keeping Stop perceptibly instant. */
const FORCE_AFTER_MS = 500;
const STOP_WAIT_MS = 1500;

/** End a process group, politely and then not. Killing the shell alone leaves
 * the server it started behind, which is how a port stays busy after a stop. */
function end(child: ChildProcess | null, ended?: Promise<void>): void {
  if (child === null || child.pid === undefined) return;
  const hardStop = (): void => {
    try {
      if (process.platform !== 'win32') process.kill(-child.pid!, 'SIGKILL');
      else child.kill('SIGKILL');
    } catch {
      try {
        child.kill('SIGKILL');
      } catch {
        // It already went, which is the result Stop wanted.
      }
    }
  };
  try {
    if (process.platform !== 'win32') process.kill(-child.pid, 'SIGTERM');
    else child.kill('SIGTERM');
  } catch {
    try {
      child.kill('SIGTERM');
    } catch {
      // It may have gone between the check and the signal.
    }
  }
  const hard = setTimeout(hardStop, FORCE_AFTER_MS);
  hard.unref?.();
  void ended?.then(() => clearTimeout(hard));
}
