/** Everything this app started, and a way to end all of it.
 *
 * Helpers, development servers, checks, language servers, browsers, add-on
 * servers: each of these was spawned by a different corner of the code and none
 * of them appeared in any register. Quitting the app left them running, which
 * on a laptop means a development server still holding a port and half a
 * gigabyte with nobody left who can stop it.
 *
 * One ledger, written to as things start and read on the way out. Killing is by
 * process group where the child has one, so a helper's own children go with it,
 * and it escalates only after asking politely.
 */

import { execFile } from 'node:child_process';

export type Spawned = {
  pid: number;
  /** One phrase: what this process is, in the words the window would use. */
  what: string;
  kind: 'tool' | 'helper' | 'server' | 'check' | 'lsp' | 'browser' | 'mcp' | 'other';
  at: number;
  /** The project it belongs to, where it belongs to one. */
  project?: string;
};

export type Ledger = {
  note(s: Spawned): void;
  gone(pid: number): void;
  all(): readonly Spawned[];
  /** Ends everything noted here. Answers with the pids it had to kill. */
  killAll(grace?: number): Promise<readonly number[]>;
  /** The same, with no waiting, for a quit handler that has no time to await
   *  anything. Asks and then insists, in one pass. */
  killAllNow(): readonly number[];
  says(): string;
};

/** How long a child gets to end itself before it is ended. Long enough for a
 *  development server to close its port, short enough that quitting still feels
 *  like quitting. */
const GRACE_MS = 2_000;

/** How often to look again while waiting. */
const LOOK_EVERY_MS = 50;

const KIND_WORDS: Readonly<Record<Spawned['kind'], [one: string, many: string]>> = {
  tool: ['tool', 'tools'],
  helper: ['helper', 'helpers'],
  server: ['server', 'servers'],
  check: ['check', 'checks'],
  lsp: ['language server', 'language servers'],
  browser: ['browser', 'browsers'],
  mcp: ['add-on server', 'add-on servers'],
  other: ['process', 'processes'],
};

function rest(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

/** Whether that pid is still there. A process we are not allowed to signal is
 *  still a process. */
export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    return (cause as { code?: string }).code === 'EPERM';
  }
}

/** Signal the whole group if the child leads one, else just the child. Never
 *  throws: a pid that has already gone is the outcome we wanted. */
function end(pid: number, signal: NodeJS.Signals): void {
  if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid) return;
  try {
    process.kill(-pid, signal);
    return;
  } catch {
    // Not a group leader — an ordinary child, signalled on its own below.
  }
  try {
    process.kill(pid, signal);
  } catch {
    // Already gone.
  }
}

export function ledger(): Ledger {
  const noted = new Map<number, Spawned>();

  return {
    note(one) {
      if (!Number.isInteger(one.pid) || one.pid <= 1) return;
      noted.set(one.pid, one);
    },

    gone(pid) {
      noted.delete(pid);
    },

    all() {
      return [...noted.values()];
    },

    async killAll(grace = GRACE_MS) {
      const pids = [...noted.keys()];
      noted.clear();

      const living = pids.filter((pid) => alive(pid));
      if (living.length === 0) return [];

      for (const pid of living) end(pid, 'SIGTERM');

      const until = Date.now() + Math.max(0, grace);
      let left = living.filter((pid) => alive(pid));
      while (left.length > 0 && Date.now() < until) {
        await rest(LOOK_EVERY_MS);
        left = left.filter((pid) => alive(pid));
      }

      // Whatever is still here has had its chance.
      for (const pid of left) end(pid, 'SIGKILL');
      for (let look = 0; look < 10 && left.length > 0; look += 1) {
        await rest(LOOK_EVERY_MS);
        left = left.filter((pid) => alive(pid));
      }

      return living;
    },

    killAllNow() {
      const living = [...noted.keys()].filter((pid) => alive(pid));
      noted.clear();
      for (const pid of living) end(pid, 'SIGTERM');
      for (const pid of living) end(pid, 'SIGKILL');
      return living;
    },

    says() {
      const mine = [...noted.values()];
      if (mine.length === 0) return 'nothing running that I started';
      const counts = new Map<Spawned['kind'], number>();
      for (const one of mine) counts.set(one.kind, (counts.get(one.kind) ?? 0) + 1);
      const said = [...counts.entries()].map(([kind, n]) => {
        const words = KIND_WORDS[kind];
        return `${String(n)} ${n === 1 ? words[0] : words[1]}`;
      });
      return `${said.join(' · ')} (${mine.map((one) => String(one.pid)).join(', ')})`;
    },
  };
}

/* -------------------------------------------------------------------------- */
/* What somebody else started                                                  */
/* -------------------------------------------------------------------------- */

function parentage(): Promise<Map<number, number[]>> {
  return new Promise((answer) => {
    execFile('ps', ['-Ao', 'pid=,ppid='], { timeout: 4_000 }, (bad, out) => {
      const tree = new Map<number, number[]>();
      if (bad !== null) return answer(tree);
      for (const line of out.split('\n')) {
        const pair = line.trim().split(/\s+/);
        const pid = Number.parseInt(pair[0] ?? '', 10);
        const parent = Number.parseInt(pair[1] ?? '', 10);
        if (Number.isNaN(pid) || Number.isNaN(parent)) continue;
        const kids = tree.get(parent);
        if (kids === undefined) tree.set(parent, [pid]);
        else kids.push(pid);
      }
      answer(tree);
    });
  });
}

/**
 * How many processes are running under this one that the ledger never noted.
 *
 * Information for the Add-ons page — "processes started by add-ons right now" —
 * and nothing more: it counts, it does not control. `except` is what the ledger
 * already accounts for, and everything under those is ours too.
 *
 * Answers zero rather than failing. A number we could not read is not worth an
 * error on a page that only wanted to say a number.
 */
export async function addonProcesses(
  ourPid: number,
  except: readonly number[] = [],
): Promise<number> {
  const tree = await parentage().catch(() => new Map<number, number[]>());
  const ours = new Set(except);
  const seen = new Set<number>();
  let count = 0;

  const walk = (pid: number, mine: boolean): void => {
    for (const kid of tree.get(pid) ?? []) {
      if (seen.has(kid)) continue;
      seen.add(kid);
      const known = mine || ours.has(kid);
      if (!known) count += 1;
      walk(kid, known);
    }
  };
  walk(ourPid, false);

  return count;
}
