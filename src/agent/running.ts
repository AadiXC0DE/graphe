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
const ADDRESS =
  /https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]|\[::\]):(\d{2,5})(\/[^\s"'`]*)?/gi;

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
    const id = `run-${String(++this.#next)}`;
    const bounds: Bounds = { writable: [...options.writable], reach: 'serving' };
    const bound = await hold(options.parts.shell, [...options.parts.args, options.command], bounds);

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
    const entry: Entry = { piece, child: null, said: '', read: 0 };
    this.#entries.set(id, entry);

    const [program, ...args] = bound.held
      ? [bound.command, ...bound.args]
      : [options.parts.shell, ...options.parts.args, options.command];
    if (!bound.held) {
      entry.said = `${bound.sentence}\n`;
    }

    const child = spawn(program ?? options.parts.shell, args, {
      cwd: options.folder,
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      // Its own group, so stopping it stops what it started. A dev server is
      // almost always a script that spawns the real thing.
      detached: process.platform !== 'win32',
    });
    entry.child = child;
    if (child.pid !== undefined) options.noted?.began(child.pid, options.command);

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
      options.onChange?.();
    });
    // Both, because they are different questions. `exit` is the process going;
    // `close` also waits for every pipe it handed on, and something that
    // double-forked out of the group keeps those open for as long as it lives —
    // so waiting only for `close` left the band saying "running" forever and the
    // note of it never cleared.
    const ended = (code: number | null): void => {
      if (entry.piece.state === 'stopped') return;
      entry.piece.state = 'stopped';
      entry.piece.exitCode = code;
      if (child.pid !== undefined) options.noted?.ended(child.pid);
      entry.child = null;
      options.onChange?.();
    };
    child.once('exit', (code) => ended(code));
    child.once('close', (code) => ended(code));

    await settled(entry, options.settle ?? SETTLE);
    // Still up and saying nothing about an address is ordinary: a background
    // worker, a watcher, an API that prints nothing. Running is what it is.
    if (entry.piece.state === 'starting') entry.piece.state = 'running';
    options.onChange?.();
    return { ...entry.piece };
  }

  /** Stop one. Ends its whole group, and answers the same whether it was
   *  already gone — stopping something twice is not an error anybody can act on. */
  stop(id: string): boolean {
    const entry = this.#entries.get(id);
    if (entry === undefined) return false;
    end(entry.child);
    // Not marked stopped here. Signalling a process is asking it to go, and the
    // one that knows it went is the `close` handler above — saying so the
    // instant we asked told people a port was free while it was still held.
    return true;
  }

  /** Stop everything and forget it. The project is closing. */
  stopAll(): void {
    for (const id of [...this.#entries.keys()]) this.stop(id);
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

/** End a process group, politely and then not. Killing the shell alone leaves
 *  the server it started behind, which is how a port stays busy after a stop. */
function end(child: ChildProcess | null): void {
  if (child === null || child.pid === undefined) return;
  if (process.platform !== 'win32') {
    try {
      process.kill(-child.pid, 'SIGTERM');
      const hard = setTimeout(() => {
        try {
          process.kill(-child.pid!, 'SIGKILL');
        } catch {
          // It went in the polite window, which is the ordinary outcome.
        }
      }, 3000);
      hard.unref?.();
      return;
    } catch {
      // It may have gone between the check and the signal.
    }
  }
  try {
    child.kill('SIGTERM');
  } catch {
    // Already gone.
  }
}
