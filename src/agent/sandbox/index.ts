/** Putting the computer's own boundary around a command we are about to run.
 *
 * ## Why this exists next to the Guard
 *
 * The Guard (src/agent/guard/policy.ts) reads tool calls and is very good at it.
 * It is not a boundary: it lives in this process, it sees only what the model
 * asks for, and a child process that never asks is invisible to it. This module
 * is the layer underneath — the kernel refusing rather than us declining.
 *
 * ## A clean start is not proof
 *
 * The failure that matters is not "no boundary". It is "we believed there was
 * one". So nothing here reports a hold it has not seen work: the first call
 * spends one process proving that a write outside the bound folder is actually
 * refused on this machine, and a boundary that does not refuse is reported as no
 * boundary at all.
 *
 * When it cannot be applied the answer is to say so and carry on with the Guard
 * alone. Refusing to work would take a working app away from everyone whose
 * machine is missing a piece, in exchange for a boundary they were not getting
 * either way — and every caller here is one the Guard already covers. What is
 * not acceptable is the quiet version, so `hold` never hands back a runnable
 * command when it failed: a caller that wants to run anyway has to say so in its
 * own code.
 *
 * `GRAPHE_SANDBOX=off` turns it off, for somebody working out what it refuses.
 * That is the only switch, and it degrades the same loud way as a missing one.
 *
 * ## What it does not cover
 *
 * See `notes` at the foot of this file — read it before trusting this for
 * anything, and before packaging.
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, realpath, rm, unlink } from 'node:fs/promises';
import { homedir, platform, tmpdir } from 'node:os';
import { join } from 'node:path';

import { bubblewrapArgs, seatbeltProfile, usableFolder, type Bounds } from './profile';

export type { Bounds, Reach } from './profile';

/** Why a command is running with nothing but the Guard around it. */
export type Why =
  | 'turned-off'
  | 'no-boundary-here'
  | 'piece-missing'
  | 'not-holding'
  | 'nowhere-to-bind';

export type Held =
  | {
      held: true;
      /** Run these instead of what you handed in. */
      command: string;
      args: readonly string[];
      /** The machinery, for "Show me" and for the log. Never for a sentence. */
      detail: string;
    }
  | {
      held: false;
      why: Why;
      /** Plain enough to show somebody. */
      sentence: string;
      detail: string;
    };

/** What a person is told when the work ran with only the Guard watching. One
 *  sentence each, and none of them name a mechanism. */
const SENTENCE: Record<Why, string> = {
  'turned-off': 'The extra boundary around work is switched off on this computer, so only the Guard is watching.',
  'no-boundary-here': 'This computer has no boundary of its own to put around the work, so only the Guard is watching.',
  'piece-missing': 'The part of this computer that holds work inside a folder is not installed, so only the Guard is watching.',
  'not-holding': 'This computer offered to hold work inside a folder and then let a change through anyway, so I am not counting on it. Only the Guard is watching.',
  'nowhere-to-bind': 'I could not work out which folder to hold the work inside, so only the Guard is watching.',
};

function unheld(why: Why, detail: string): Held {
  return { held: false, why, sentence: SENTENCE[why], detail };
}

/** Where the boundary is applied from, when there is one. */
const SANDBOX_EXEC = '/usr/bin/sandbox-exec';
const BUBBLEWRAP = ['/usr/bin/bwrap', '/bin/bwrap', '/usr/local/bin/bwrap'];

/** Long enough for a cold start, short enough that a wedged probe cannot hold up
 *  the first helper of the day. */
const PROBE_PATIENCE_MS = 10_000;

type Look =
  | { ok: true; kind: 'seatbelt' | 'bubblewrap'; tool: string }
  | { ok: false; why: Why; detail: string };

let looked: Promise<Look> | null = null;

/** Forget what this machine was found to be able to do. Tests only. */
export function lookAgain(): void {
  looked = null;
}

/** Can this machine hold a command inside a folder, and does it actually do it?
 *  Worked out once and remembered — the answer cannot change while we run. */
export function boundaryHere(): Promise<Look> {
  looked ??= findBoundary();
  return looked;
}

async function findBoundary(): Promise<Look> {
  const os = platform();
  if (os === 'darwin') {
    if (!existsSync(SANDBOX_EXEC)) {
      return { ok: false, why: 'piece-missing', detail: `no ${SANDBOX_EXEC}` };
    }
    return prove('seatbelt', SANDBOX_EXEC);
  }
  if (os === 'linux') {
    const tool = BUBBLEWRAP.find((path) => existsSync(path));
    if (tool === undefined) {
      return { ok: false, why: 'piece-missing', detail: 'no bwrap on this machine' };
    }
    return prove('bubblewrap', tool);
  }
  return { ok: false, why: 'no-boundary-here', detail: `${os} has no boundary we know how to ask for` };
}

/**
 * Prove it, once, by trying to escape it.
 *
 * A scratch folder is bound, and a write *outside* that folder is attempted. The
 * boundary counts as real only when the write fails and the file is not there
 * afterwards — a profile that loads and permits everything looks exactly like a
 * working one from the exit code alone.
 */
async function prove(kind: 'seatbelt' | 'bubblewrap', tool: string): Promise<Look> {
  let scratch: string | null = null;
  const outside = join(homedir(), `.graphe-boundary-${String(process.pid)}-${String(Date.now())}`);
  try {
    scratch = await realpath(await mkdtemp(join(tmpdir(), 'graphe-boundary-')));
    const bounds: Bounds = { writable: [scratch], reach: 'nothing' };
    // `$0` rather than the path inside the script: nothing about the path is
    // ever read as shell.
    const ran = await runOnce(wrap(kind, tool, bounds, '/bin/sh', ['-c', ': > "$0"', outside]));
    const leaked = existsSync(outside);
    if (leaked) await unlink(outside).catch(() => {});
    if (ran.ok || leaked) {
      return { ok: false, why: 'not-holding', detail: `${kind} allowed a write to ${outside}` };
    }
    return { ok: true, kind, tool };
  } catch (cause) {
    return { ok: false, why: 'not-holding', detail: messageOf(cause) };
  } finally {
    if (scratch !== null) await rm(scratch, { recursive: true, force: true }).catch(() => {});
  }
}

function wrap(
  kind: 'seatbelt' | 'bubblewrap',
  tool: string,
  bounds: Bounds,
  command: string,
  args: readonly string[],
): { command: string; args: string[] } {
  if (kind === 'bubblewrap') {
    return { command: tool, args: bubblewrapArgs(bounds, command, args) };
  }
  const profile = seatbeltProfile(bounds);
  const parameters = profile.params.flatMap(([name, value]) => ['-D', `${name}=${value}`]);
  return { command: tool, args: [...parameters, '-p', profile.text, command, ...args] };
}

function runOnce(spawnable: { command: string; args: string[] }): Promise<{ ok: boolean }> {
  return new Promise((finished) => {
    execFile(
      spawnable.command,
      spawnable.args,
      { timeout: PROBE_PATIENCE_MS, windowsHide: true },
      (problem) => finished({ ok: problem === null }),
    );
  });
}

function messageOf(cause: unknown): string {
  return cause instanceof Error && cause.message !== '' ? cause.message : 'the boundary could not be tried';
}

/** The one way a technical user turns this off, and the only one. */
function switchedOff(): boolean {
  return (process.env['GRAPHE_SANDBOX'] ?? '').trim().toLowerCase() === 'off';
}

let last: Held | null = null;

/** How the most recent command was run. What a band in the window would read to
 *  say, without being asked, that work is running with less around it than
 *  usual. */
export function lastHeld(): Held | null {
  return last;
}

/**
 * Wrap a command so the computer itself keeps it inside its folder.
 *
 * Answers with the command to run instead, or with the reason there is none.
 * The failing answer deliberately carries no command: falling through to running
 * unheld has to be something a caller writes down.
 */
export async function hold(
  command: string,
  args: readonly string[],
  bounds: Bounds,
): Promise<Held> {
  const answer = await decide(command, args, bounds);
  last = answer;
  return answer;
}

async function decide(command: string, args: readonly string[], bounds: Bounds): Promise<Held> {
  if (switchedOff()) return unheld('turned-off', 'GRAPHE_SANDBOX=off');

  const look = await boundaryHere();
  if (!look.ok) return unheld(look.why, look.detail);

  // The kernel matches on the real path, so a folder reached through a shortcut
  // — /tmp on macOS is one — has to be resolved before it is named, or every
  // write into it is refused and nothing says why.
  const writable: string[] = [];
  for (const folder of bounds.writable) {
    const usable = usableFolder(folder);
    if (usable === null) continue;
    const real = await realpath(usable).catch(() => null);
    if (real !== null) writable.push(real);
  }
  if (writable.length === 0) {
    return unheld('nowhere-to-bind', `none of ${bounds.writable.join(', ')} could be resolved`);
  }

  const wrapped = wrap(look.kind, look.tool, { ...bounds, writable }, command, args);
  return {
    held: true,
    command: wrapped.command,
    args: wrapped.args,
    detail: `${look.kind}: writes bound to ${writable.join(', ')}; reach ${bounds.reach}`,
  };
}

/* -------------------------------------------------------------------------- */
/* notes — what this does not cover                                            */
/* -------------------------------------------------------------------------- */

/**
 * Written down because half of this is packaging, and packaging is not solved
 * here.
 *
 *  - **Reads are open.** Only the private places and key-shaped filenames are
 *    refused. Anything else on the disk can be read by anything we wrap. A read
 *    allowlist is the stronger shape and is not built.
 *  - **Egress is a port, not an address.** `secure` means outbound 443. Which
 *    host that is cannot be filtered without a proxy in the middle, which is the
 *    part `@anthropic-ai/sandbox-runtime` has and this does not. On Linux there
 *    is not even a port filter: bubblewrap can only remove the network entirely,
 *    so `secure` there is the whole network.
 *  - **Nothing can listen.** A bound command reaches out and cannot be reached,
 *    so a development server started from the shell never comes up. Graphe
 *    serves its own preview from outside all of this, which is why that has not
 *    bitten yet.
 *  - **macOS packaging.** `sandbox-exec` has been deprecated by Apple since
 *    10.10 and could be removed. Today Graphe ships ad-hoc signed with the
 *    hardened runtime off, and this works. A future Developer ID build turning
 *    the hardened runtime on should be checked again, and an App Store build
 *    cannot do this at all — a process already inside the App Sandbox cannot
 *    apply a second one.
 *  - **Linux packaging.** bubblewrap has to be installed. Distributions that
 *    ship it setuid are fine; on others it needs unprivileged user namespaces
 *    enabled, and where they are off there is no boundary to have.
 *  - **Windows.** Nothing. `no-boundary-here`, every time.
 *  - **What is inside stays inside.** A child bound to the copy it was given can
 *    still do anything it likes to that copy. The boundary is about the rest of
 *    the machine, and the restore points are what cover the folder itself.
 */
