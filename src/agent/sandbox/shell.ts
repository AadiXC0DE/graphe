/** The main agent's own commands, run inside the computer's boundary.
 *
 * The helper the `task` tool spawns is a process we start ourselves, so putting
 * it inside a boundary is a matter of changing what we spawn. The main agent's
 * shell is not ours: the agent runtime owns that tool and runs the command with
 * its own executor, which is also what handles cancelling, timeouts and killing
 * everything a command left behind. Reimplementing that to get a boundary would
 * trade a working Stop button for one.
 *
 * So this does not replace the executor. It replaces the *command handed to it*
 * with the same command wrapped by `hold`, and hands the result straight back:
 *
 *     exec '/usr/bin/sandbox-exec' '-D' 'WRITE0=…' '-p' '…' '/bin/bash' '-c' 'the command'
 *
 * `exec` matters — the outer shell replaces itself, so the process the runtime
 * is watching, timing out and killing *is* the bound one. Everything it wrote
 * about a command still applies.
 *
 * Two things are bound in that a read-only helper never needed:
 *
 *  - **A scratch folder**, and `TMPDIR` pointed at it. Ordinary shell work
 *    writes there constantly — a here-document alone does — and a command that
 *    cannot write a temporary file fails in a way that reads as the command
 *    being wrong.
 *  - **The folders programs keep their downloads in.** Installing a package
 *    fails outright without them, and nothing kept there is irreplaceable.
 *
 * Failing stays loud: `hold` hands back no runnable command when it could not
 * bind, so the fall through to running with only the Guard is written down here,
 * and the person is told in the command's own output the first time it happens.
 */

import { spawn } from 'node:child_process';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { hold } from './index';
import type { Bounds } from './profile';

/** Everything a command run needs to say for itself while it goes. Shaped to
 *  meet the runtime's own shell seam without naming it. */
export type ShellRun = {
  onData: (data: Buffer) => void;
  signal?: AbortSignal;
  timeout?: number;
  env?: NodeJS.ProcessEnv;
};

/** Running one command and waiting for it. */
export type RunShell = (
  command: string,
  cwd: string,
  options: ShellRun,
) => Promise<{ exitCode: number | null }>;

/** The shell a command is run with, and the arguments that mean "run this". */
export type ShellParts = { shell: string; args: readonly string[] };

export type HeldShell = {
  /** The one method, so this can be handed over where a plain runner goes. */
  exec: RunShell;
  /** Throw away the scratch folder. Nothing runs after this. */
  close: () => Promise<void>;
};

export type HeldShellOptions = {
  /** The folder this agent was given. It may be a copy of the project rather
   *  than the project itself, so it is passed in rather than worked out. */
  folder: string;
  /** Which shell to use, resolved the same way the runtime resolves it.
   *  Allowed to throw — a machine with no shell has no boundary to want. */
  parts: () => ShellParts;
  /** Running a command with nothing around it. */
  plain: RunShell;
  /** The deliberately high-autonomy runner. Unlike `plain`, this is allowed
   *  to enter the person's login shell, so it sees the same PATH, credential
   *  helpers and language runtimes as their terminal. */
  unrestrictedPlain?: RunShell;
  /**
   * The person has deliberately chosen the high-autonomy mode. Commands in
   * that mode use their normal login environment, including the credential
   * helpers and package-manager folders already set up on this computer.
   *
   * This is a function rather than a value because the control changes an
   * already-open session. The next command must see the new choice without
   * rebuilding the agent.
   */
  unrestricted?: () => boolean;
  /** Home, for the folders below. Tests pass their own. */
  home?: string;
};

/**
 * Run through the person's login shell. Finder-launched macOS apps inherit a
 * very small environment, while Node version managers commonly initialise in
 * `.zshrc`/`.bashrc`; copying PATH once at startup is not a reliable substitute
 * for that setup. This runner is intentionally only used for the explicit
 * high-autonomy choice — ordinary commands keep their contained runner.
 */
export function loginShell(shell: string, fallback: RunShell): RunShell {
  return async (command, cwd, run) => {
    const developmentServer = developmentServerCommand(command);
    if (developmentServer !== null) {
      return runDevelopmentServer(shell, developmentServer, cwd, run, fallback);
    }
    return new Promise<{ exitCode: number | null }>((resolve, reject) => {
      let finished = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const child = spawn(shell, ['-lic', command], {
        cwd,
        env: { ...process.env, ...run.env },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        // The shell leads its own process group, so stopping it can end the
        // whole tree it launched. Without this, `(npm run dev &)` — or any
        // command that backgrounds a daemon — left the daemon alive after a
        // Stop. The daemon held the shell's pipes open, so `close` below never
        // fired, the tool never returned, and the Stop button appeared dead.
        detached: process.platform !== 'win32',
      });

      const finish = (result: { exitCode: number | null }) => {
        if (finished) return;
        finished = true;
        if (timer !== undefined) clearTimeout(timer);
        run.signal?.removeEventListener('abort', stop);
        resolve(result);
      };
      const stop = () => stopProcessGroup(child);

      child.stdout?.on('data', run.onData);
      child.stderr?.on('data', run.onData);
      child.once('close', (code) => finish({ exitCode: code }));
      child.once('error', (cause: NodeJS.ErrnoException) => {
        if (finished) return;
        // A custom shell path that disappeared should not turn a working
        // terminal into a fake "no runtime" failure. The ordinary local Pi
        // runner remains a real, useful fallback in that rare case.
        if (cause.code === 'ENOENT') {
          finished = true;
          if (timer !== undefined) clearTimeout(timer);
          run.signal?.removeEventListener('abort', stop);
          void fallback(command, cwd, run).then(resolve, reject);
          return;
        }
        finished = true;
        if (timer !== undefined) clearTimeout(timer);
        run.signal?.removeEventListener('abort', stop);
        reject(cause);
      });
      if (run.signal?.aborted) stop();
      else run.signal?.addEventListener('abort', stop, { once: true });
      if (run.timeout !== undefined && run.timeout > 0) {
        // Pi expresses bash timeouts in seconds; keep the custom runner's
        // contract identical to its ordinary local runner.
        timer = setTimeout(stop, run.timeout * 1000);
      }
    });
  };
}

/** Where programs keep what they downloaded. Writable, because installing
 *  anything fails without them and nothing kept there cannot be fetched again. */
export function downloadFolders(home = homedir()): string[] {
  return [`${home}/.npm`, `${home}/.cache`, `${home}/Library/Caches`];
}

/** What the main agent's commands may write to, and how far they may reach.
 *  Reach is wider than a helper's because ordinary work fetches things. */
export function shellBounds(folder: string, scratch: string, home?: string): Bounds {
  return { writable: [folder, scratch, ...downloadFolders(home)], reach: 'secure' };
}

/** One word, safe to put in a command line however it is spelt. */
export function quoted(word: string): string {
  return `'${word.split("'").join("'\\''")}'`;
}

/**
 * The ways somebody starts something that waits to be reached.
 *
 * Wider than the package managers on purpose. Whatever the wording, all of these
 * end the same way: a process that sits there holding a port. Two places need to
 * know which those are — the runner with the person's own terminal, where one
 * must be let go of rather than waited on, and the contained runner, where one
 * cannot work at all.
 */
/** Ends a name without swallowing the next word of a longer one, so `serve`
 *  does not match `serve-report`. */
const ENDS = '(?![\\w-])';

const SERVER_COMMANDS = [
  // Whatever the project calls its own.
  new RegExp(`^(?:npm|pnpm)\\s+run\\s+(?:dev|serve|start|preview)${ENDS}`),
  new RegExp(`^(?:npm|pnpm|yarn|bun)\\s+(?:dev|serve|start|preview)${ENDS}`),
  // A folder of files, served as they are.
  new RegExp(`^(?:python3?|py)\\s+-m\\s+(?:http\\.server|SimpleHTTPServer)${ENDS}`),
  new RegExp(`^php\\s+-S${ENDS}`),
  new RegExp(`^ruby\\s+-run\\s+-e\\s+httpd${ENDS}`),
  new RegExp(`^busybox\\s+httpd${ENDS}`),
  // The usual ones, run directly or fetched by npx.
  new RegExp(
    `^(?:npx\\s+(?:-y\\s+)?)?(?:serve|http-server|live-server|vite|nodemon|browser-sync|miniserve|caddy)${ENDS}`,
  ),
  new RegExp(
    `^(?:npx\\s+(?:-y\\s+)?)?(?:next|nuxt|astro|remix|svelte-kit|gatsby|ng|expo)\\s+(?:dev|start|serve)${ENDS}`,
  ),
  new RegExp(`^(?:npx\\s+(?:-y\\s+)?)?webpack(?:-dev-server)?\\s+serve${ENDS}`),
] as const;

/** One command out of a line of them, with the wrappers people put round a
 *  server taken off: the brackets, the `nohup`, the trailing `&`. */
function bare(piece: string): string {
  return piece
    .trim()
    .replace(/^\(\s*/, '')
    .replace(/^nohup\s+/, '')
    .replace(/\s*&\s*$/, '')
    .trim();
}

/**
 * Does any part of this line start something that waits to be reached?
 *
 * Any part, not the first: `cd site && python3 -m http.server` is how anybody
 * would write it, and reading only the front of the line meant the one shape
 * people actually type was the one shape that went unrecognised.
 */
function startsAServer(line: string): boolean {
  for (const raw of line.split(/&&|\|\||;|\n/)) {
    // The head of a pipeline is the thing that runs; `| tee log` is not.
    const head = bare(raw.split('|')[0] ?? '');
    if (SERVER_COMMANDS.some((shape) => shape.test(head))) return true;
  }
  return false;
}

/** A foreground development server does useful work only after it has returned
 * its URL. Letting one occupy the agent's one command slot makes it look as if
 * the agent has frozen, and it prevents the next check from ever running. */
export function developmentServerCommand(command: string): string | null {
  const trimmed = command.trim();
  const grouped = /^\(\s*([\s\S]+?)\s*&\s*(?:echo\s+\$!|disown)?\s*\)$/.exec(trimmed)?.[1]?.trim();
  const whole = grouped ?? trimmed;
  const candidate =
    /^nohup\s+([\s\S]*?)\s*&?\s*$/.exec(whole)?.[1]?.trim() ?? whole.replace(/\s*&\s*$/, '');
  return startsAServer(candidate) ? candidate : null;
}

export function isForegroundDevelopmentServer(command: string): boolean {
  return developmentServerCommand(command) !== null;
}

/**
 * Nothing inside the boundary can be reached from outside it.
 *
 * The boundary opens one way out and nothing at all coming back, so a server
 * started in there holds a port nobody can knock on. It used to fail as
 * `Operation not permitted` several commands deep, which reads as a broken
 * machine rather than as the rule it is — and the agent's next four guesses
 * were all the same command wearing a different hat.
 *
 * Graphe serves its own preview from outside the boundary, so the thing being
 * asked for is already here. This is where that gets said.
 */
export const CANNOT_LISTEN =
  'I did not run that. What I run is sealed off from the network, so anything it started would hold a door nobody could knock on. Graphe serves the project itself, from outside that seal — ask to see it and it opens in the window here. To run a server in your own terminal instead, switch to "Gets on with it".';

/** End a detached shell's entire process group. Killing its shell alone leaves
 * Vite/npm behind; killing the group is what makes the chat Stop button real. */
function stopProcessGroup(child: ReturnType<typeof spawn>): void {
  if (process.platform !== 'win32' && child.pid !== undefined) {
    try {
      process.kill(-child.pid, 'SIGTERM');
      setTimeout(() => {
        try {
          process.kill(-child.pid!, 'SIGKILL');
        } catch {
          // It stopped in the polite window, which is the ordinary outcome.
        }
      }, 3000).unref();
      return;
    } catch {
      // It may have stopped between the check and the signal. The ordinary
      // child kill below is still useful on platforms without process groups.
    }
  }
  if (!child.killed) child.kill('SIGTERM');
}

/**
 * Start a development server in its own process group and give the agent its
 * command slot back once it has had a moment to start. The process remains
 * attached to this runner, so Stop can end npm, Vite and their children rather
 * than merely ending the shell that launched them.
 */
function runDevelopmentServer(
  shell: string,
  command: string,
  cwd: string,
  run: ShellRun,
  fallback: RunShell,
): Promise<{ exitCode: number | null }> {
  return new Promise((resolve, reject) => {
    let returned = false;
    let finished = false;
    const child = spawn(shell, ['-lic', command], {
      cwd,
      env: { ...process.env, ...run.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      // The group leader is deliberately the shell we started. Its children
      // stay in that group even when the model wrote `(npm run dev & echo $!)`.
      detached: process.platform !== 'win32',
    });
    const returnToAgent = (result: { exitCode: number | null }) => {
      if (returned) return;
      returned = true;
      resolve(result);
    };
    const stop = () => stopProcessGroup(child);
    const grace = setTimeout(() => returnToAgent({ exitCode: 0 }), 1000);
    const data = (chunk: Buffer) => {
      // Keep draining after return so a chatty server cannot block on its pipe,
      // but do not leak later server logs into a later tool call.
      if (!returned) run.onData(chunk);
    };

    child.stdout?.on('data', data);
    child.stderr?.on('data', data);
    child.once('close', (code) => {
      finished = true;
      clearTimeout(grace);
      run.signal?.removeEventListener('abort', stop);
      returnToAgent({ exitCode: code });
    });
    child.once('error', (cause: NodeJS.ErrnoException) => {
      if (finished) return;
      clearTimeout(grace);
      run.signal?.removeEventListener('abort', stop);
      if (cause.code === 'ENOENT') {
        returned = true;
        void fallback(command, cwd, run).then(resolve, reject);
        return;
      }
      reject(cause);
    });
    if (run.signal?.aborted) stop();
    else run.signal?.addEventListener('abort', stop, { once: true });
  });
}

/** The command that runs `command` inside the boundary, as a single line. */
export function heldLine(held: { command: string; args: readonly string[] }): string {
  // `exec`, so the process the runtime waits on and kills is the bound one and
  // not a shell holding it.
  return `exec ${[held.command, ...held.args].map(quoted).join(' ')}`;
}

/** The one reason for running unheld that `hold` cannot report, because it
 *  happens before there is anything to ask it about. */
const NO_SCRATCH =
  'I could not make a working folder for this computer to hold the work inside, so only the Guard is watching.';

/**
 * A command runner that puts every command inside the boundary first.
 *
 * When there is no boundary to be had the command still runs — taking the shell
 * away would take the app away, and the Guard is the layer that was always
 * there — but the reason is said out loud once, in the output of the first
 * command it affects, where the person and the model both read it.
 */
export function heldShell(options: HeldShellOptions): HeldShell {
  let scratch: Promise<string | null> | null = null;
  let told = false;

  const scratchFolder = async (): Promise<string | null> => {
    scratch ??= mkdtemp(join(tmpdir(), 'graphe-shell-'))
      .then((made) => realpath(made))
      .catch(() => null);
    return scratch;
  };

  const unheld = async (
    command: string,
    cwd: string,
    run: ShellRun,
    sentence: string | null,
  ): Promise<{ exitCode: number | null }> => {
    if (sentence !== null && !told) {
      told = true;
      run.onData(Buffer.from(`${sentence}\n`));
    }
    return options.plain(command, cwd, run);
  };

  return {
    exec: async (command, cwd, run) => {
      // "Get on with it" means the agent gets the same terminal environment
      // the person has. Keeping the OS boundary here made the label misleading:
      // Git could not reach macOS's credential helper and package scripts could
      // not use their normal supporting folders even though the Guard had let
      // the command through.
      if (options.unrestricted?.() === true) {
        // A command with no ceiling can pin the sitting for hours. Twenty
        // minutes is long enough for a real build and short enough that a stuck
        // loop cannot burn a night. Dev servers are detached before they get
        // here, so they are not cut short by this.
        const capped =
          run.timeout === undefined || run.timeout <= 0
            ? { ...run, timeout: 20 * 60 }
            : run;
        return (options.unrestrictedPlain ?? options.plain)(command, cwd, capped);
      }

      // Said before it is attempted, because attempting it can only end one way.
      if (isForegroundDevelopmentServer(command)) {
        run.onData(Buffer.from(`${CANNOT_LISTEN}\n`));
        return { exitCode: 1 };
      }

      const folder = await scratchFolder();
      if (folder === null) return unheld(command, cwd, run, NO_SCRATCH);

      let parts: ShellParts;
      try {
        parts = options.parts();
      } catch {
        // No shell to name means nothing to wrap. The runner below fails the
        // same way it would have failed anyway, and says so itself.
        return unheld(command, cwd, run, null);
      }

      const bounds = shellBounds(options.folder, folder, options.home);
      const bound = await hold(parts.shell, [...parts.args, command], bounds);
      if (!bound.held) return unheld(command, cwd, run, bound.sentence);

      return options.plain(heldLine(bound), cwd, {
        ...run,
        // Temporary files land in the folder that is bound rather than the one
        // that is not.
        env: { ...run.env, TMPDIR: folder, TMP: folder, TEMP: folder },
      });
    },
    close: async () => {
      const folder = await scratchFolder();
      scratch = null;
      if (folder !== null) await rm(folder, { recursive: true, force: true }).catch(() => {});
    },
  };
}
