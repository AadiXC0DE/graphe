/** A real terminal, in the folder that is on screen.
 *
 * Separate from the agent's own shell tool on purpose: this is the person's
 * terminal in the workspace they are looking at, with the shell they actually
 * use, and it does not inherit any claim that the Guard is watching it. What it
 * is guarded against is the app: input goes in as keystrokes and nothing else,
 * there is no "run this command" door, and no escape sequence reaches the
 * clipboard, the filesystem or the browser.
 *
 * The native pty is loaded lazily and its absence is a state, not a crash: a
 * packaged app whose helper lost its execute bit should say so and keep working.
 */

import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { basename } from 'node:path';

import type {
  TerminalChunk,
  TerminalExit,
  TerminalKind,
  TerminalSession,
} from '../../src/lib/ipc';

export type { TerminalChunk, TerminalExit, TerminalKind, TerminalSession };

type PtyProcess = {
  onData(listener: (data: string) => void): { dispose(): void };
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): { dispose(): void };
  write(data: string): void;
  resize(columns: number, rows: number): void;
  kill(signal?: string): void;
  readonly pid: number;
};

type PtyModule = {
  spawn(
    file: string,
    args: string[] | string,
    options: {
      name: string;
      cols: number;
      rows: number;
      cwd: string;
      env: Record<string, string>;
      useConpty?: boolean;
    },
  ): PtyProcess;
};

/** Where a shell comes from when nothing says otherwise. */
function loginShell(env: NodeJS.ProcessEnv): string {
  const chosen = env['SHELL'];
  return chosen === undefined || chosen.trim() === '' ? '/bin/sh' : chosen;
}

/**
 * The environment a terminal starts with.
 *
 * Deliberately the app's own environment minus the things that do not belong in
 * somebody's shell: the profile the app was launched with, and anything this
 * process was told only so that a test could run. Secrets are not stripped —
 * this is the person's own shell and taking their environment away would break
 * it — but nothing here adds any.
 */
function shellEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (key.startsWith('GRAPHE_')) continue;
    kept[key] = value;
  }
  if (kept['TERM'] === undefined) kept['TERM'] = 'xterm-256color';
  return kept;
}

/** The most output held for one terminal before the oldest is dropped. A
 *  terminal that prints forever must not be a memory leak with a prompt. */
const MOST_HELD = 512 * 1024;

/**
 * Every terminal this app has open.
 *
 * One per id, closed when the window closes and when the app goes away, and
 * never resized or written by anything but the terminal controller.
 */
export class Terminals {
  private readonly live = new Map<
    string,
    { session: TerminalSession; pty: PtyProcess; held: string[]; heldBytes: number; sequence: number }
  >();

  private made = 0;

  /** Loaded once, and remembered as missing when it is missing. The module is
   *  native: requiring it can throw for reasons a person can fix, and that must
   *  not be a crash on startup. */
  private pty: PtyModule | null | undefined;

  constructor(
    private readonly tell: (chunk: TerminalChunk) => void,
    private readonly ended: (exit: TerminalExit) => void,
  ) {}

  /** Whether a real terminal can be started here, and why not when it cannot. */
  available(): { yes: true } | { yes: false; because: string } {
    const module = this.module();
    if (module === null) {
      return {
        yes: false,
        because:
          'The terminal helper is not installed for this build, so a shell cannot be started here. Everything else works.',
      };
    }
    return { yes: true };
  }

  private module(): PtyModule | null {
    if (this.pty !== undefined) return this.pty;
    try {
      // `createRequire` rather than a static import: this is a native module
      // that is absent on some builds, and a static import would make the whole
      // shell fail to start when it is.
      const from = createRequire(import.meta.url);
      this.pty = from('node-pty') as PtyModule;
    } catch {
      this.pty = null;
    }
    return this.pty;
  }

  /**
   * Start a shell in a folder.
   *
   * The folder is the workspace somebody selected; there is no way to ask for
   * one from the wire, and no command is passed. What runs is the person's own
   * login shell, in a pty, as themselves.
   */
  open(options: {
    workspace: string;
    kind: TerminalKind;
    cols?: number;
    rows?: number;
    env?: NodeJS.ProcessEnv;
  }): { ok: true; session: TerminalSession } | { ok: false; because: string } {
    const module = this.module();
    if (module === null) return { ok: false, because: this.available().yes === false ? 'no helper' : 'no helper' };

    this.made += 1;
    const id = `term-${String(this.made)}`;
    const shell = loginShell(options.env ?? process.env);
    const session: TerminalSession = {
      id,
      kind: options.kind,
      workspace: options.workspace,
      shell: basename(shell),
      startedAt: Date.now(),
      exit: null,
    };
    try {
      const pty = module.spawn(shell, [], {
        name: 'xterm-256color',
        cols: options.cols ?? 80,
        rows: options.rows ?? 24,
        cwd: options.workspace,
        env: shellEnv(options.env ?? process.env),
      });
      const held: string[] = [];
      const record = { session, pty, held, heldBytes: 0, sequence: 0 };
      pty.onData((data: string) => {
        record.held.push(data);
        record.heldBytes += data.length;
        while (record.heldBytes > MOST_HELD && record.held.length > 1) {
          record.heldBytes -= (record.held.shift() ?? '').length;
        }
        record.sequence += 1;
        this.tell({ id, data, sequence: record.sequence });
      });
      pty.onExit((event) => {
        const exit = { code: event.exitCode, signal: event.signal ?? null };
        record.session = { ...session, exit };
        this.ended({ id, ...exit });
      });
      this.live.set(id, record);
      return { ok: true, session };
    } catch (cause) {
      return {
        ok: false,
        because: cause instanceof Error ? cause.message : 'the shell would not start',
      };
    }
  }

  /** Everything a terminal has printed, for a window that has just opened it. */
  scrollback(id: string): string {
    return (this.live.get(id)?.held ?? []).join('');
  }

  snapshot(id: string): { data: string; sequence: number } {
    const held = this.live.get(id);
    return { data: (held?.held ?? []).join(''), sequence: held?.sequence ?? 0 };
  }

  list(): readonly TerminalSession[] {
    return [...this.live.values()].map((one) => one.session);
  }

  /** Keystrokes, and nothing else. No framing, no command, no shell escape into
   *  the app: the bytes go to the pty exactly as typed. */
  write(id: string, data: string): boolean {
    const one = this.live.get(id);
    if (one === undefined || one.session.exit !== null) return false;
    one.pty.write(data);
    return true;
  }

  resize(id: string, cols: number, rows: number): boolean {
    const one = this.live.get(id);
    if (one === undefined) return false;
    const columns = Math.max(2, Math.min(500, Math.floor(cols)));
    const lines = Math.max(2, Math.min(300, Math.floor(rows)));
    try {
      one.pty.resize(columns, lines);
      return true;
    } catch {
      // A pty that has gone away cannot be resized, and that is not an error
      // worth showing anybody.
      return false;
    }
  }

  /** End one terminal. The process is killed, and its record goes. */
  close(id: string): boolean {
    const one = this.live.get(id);
    if (one === undefined) return false;
    try {
      one.pty.kill();
    } catch {
      // Already gone.
    }
    this.live.delete(id);
    return true;
  }

  /** Everything this app started, ended. Called on the way out. */
  closeAll(): void {
    for (const id of [...this.live.keys()]) this.close(id);
  }
}

/** Where a terminal's folder came from, said the way the header says it. */
export function saysWorkspace(folder: string): string {
  const home = homedir();
  return folder.startsWith(home) ? `~${folder.slice(home.length)}` : folder;
}
