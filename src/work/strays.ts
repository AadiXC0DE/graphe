/** Helpers still running for an app that is not there any more.
 *
 * A helper is its own program, so the one thing it does not need is us: kill
 * the app and the helper carries on reading, thinking and spending against
 * somebody's account with nothing left to report to. A limit cannot stop it —
 * the thing that holds the limit went away — and nobody would ever find it.
 *
 * So they are ended on the way back in, before anything else starts. Deciding
 * which is pure and takes the list as an argument; only `endStrays` touches the
 * machine.
 */

import { execFile } from 'node:child_process';

/** One program the machine says is running. */
export type Alive = { pid: number; ppid: number; command: string };

/**
 * What counts as ours, by the name it runs under.
 *
 * Two kinds, and the second was learned the hard way. A helper doing the
 * thinking is its own program and is recognised by its filename. But the app
 * itself is several processes — the window, the graphics — and when the one
 * that owns them goes away abruptly they are not always taken with it. One was
 * found alone on a machine having spent eleven hours at two cores, drawing a
 * window for an app that no longer existed.
 *
 * Named exactly, because anything else with a parent that has gone is somebody
 * else's business — every other app on the machine has helpers too.
 */
const OURS = ['subagent-runner.mjs', 'Graphe Helper'];

/** One server this app started, written down while it runs.
 *
 * A helper can be recognised by its own filename. A server cannot — it is
 * whatever somebody asked to be started, `npm run dev` or a python one-liner —
 * so the only way to know it was ours is to have said so at the time. */
export type NotedServer = { pid: number; command: string };

/** How long one gets to leave politely before it is made to. */
const GIVE_UP_AFTER_MS = 3000;

/** `ps -A -o pid=,ppid=,args=`, as rows. Anything that does not parse is left
 *  out: a line we cannot read is not a licence to end a program. */
export function readRunning(text: string): readonly Alive[] {
  const all: Alive[] = [];
  for (const line of text.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*\S)\s*$/.exec(line);
    if (match === null) continue;
    const pid = Number(match[1]);
    const ppid = Number(match[2]);
    if (!Number.isFinite(pid) || pid <= 0) continue;
    all.push({ pid, ppid, command: match[3] ?? '' });
  }
  return all;
}

/**
 * Which of them are helpers with nobody left above them.
 *
 * A helper of *this* app has us as its parent and we are plainly still here, so
 * it is never in this list — which is what makes running this at every start
 * safe rather than a way to end our own work.
 */
export function whichAreStray(
  running: readonly Alive[],
  stillThere: (pid: number) => boolean,
): readonly number[] {
  return running
    .filter((one) => OURS.some((name) => one.command.includes(name)))
    // Only the ones whose owner has gone. A live app's own processes have a
    // live parent, so this never reaches another copy that is working.
    .filter((one) => one.ppid <= 1 || !stillThere(one.ppid))
    .map((one) => one.pid);
}

/**
 * Which written-down servers are still running, and still the thing we wrote down.
 *
 * A process id on its own is not enough: the app may have been away long enough
 * for the machine to hand that number to somebody else, and ending a stranger's
 * program because it inherited a number is far worse than leaving a port busy.
 * So the command has to match too — the whole of what we recorded has to still
 * be there in what the machine reports.
 */
export function whichServersAreStray(
  noted: readonly NotedServer[],
  running: readonly Alive[],
): readonly number[] {
  const byPid = new Map(running.map((one) => [one.pid, one.command]));
  const stray: number[] = [];
  for (const one of noted) {
    const command = byPid.get(one.pid);
    if (command === undefined) continue;
    if (one.command.trim() === '' || !command.includes(one.command.trim())) continue;
    stray.push(one.pid);
  }
  return stray;
}

/** Whether a program with this number is still running. */
export function stillRunning(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    // Running but not ours to signal is still running.
    return (cause as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** What the machine says is running. Empty where it cannot say: nothing is
 *  ended on a guess. */
export function listRunningPrograms(): Promise<readonly Alive[]> {
  return running();
}

function running(): Promise<readonly Alive[]> {
  return new Promise((resolve) => {
    try {
      execFile('ps', ['-A', '-o', 'pid=,ppid=,args='], { maxBuffer: 8 * 1024 * 1024 }, (error, out) => {
        resolve(error === null ? readRunning(out) : []);
      });
    } catch {
      resolve([]);
    }
  });
}

/**
 * End every helper left behind, and say how many.
 *
 * Silent where the machine has no way to list what it is running: nothing is
 * ended on a guess.
 */
export async function endStrays(
  look: () => Promise<readonly Alive[]> = running,
  end: (pid: number, signal: NodeJS.Signals) => void = (pid, signal) => process.kill(pid, signal),
): Promise<number> {
  const strays = whichAreStray(await look(), stillRunning);
  for (const pid of strays) {
    try {
      end(pid, 'SIGTERM');
    } catch {
      continue;
    }
    setTimeout(() => {
      if (!stillRunning(pid)) return;
      try {
        end(pid, 'SIGKILL');
      } catch {
        // Somebody else's now.
      }
    }, GIVE_UP_AFTER_MS).unref();
  }
  return strays.length;
}
