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
      if (options.unrestricted?.() === true) return options.plain(command, cwd, run);

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
