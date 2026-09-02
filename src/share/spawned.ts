/** Everything this app starts, written down where the shell can find it.
 *
 * Helpers, servers, checks, language servers, browsers, the children an add-on's
 * tool spawned. None of them appeared anywhere before, and none of them died
 * with the app — so quitting left a machine running work nobody could see and
 * nobody could stop.
 *
 * The ledger itself lives in the shell, because killing a process group is the
 * shell's job. This is the seam: anything under `src/` that starts a process
 * says so here, and the shell listens. Nothing listening is the ordinary case
 * in a test, and it costs nothing.
 */

export type Kind = 'helper' | 'server' | 'check' | 'lsp' | 'browser' | 'mcp' | 'other';

export type Watcher = {
  started: (one: { pid: number; what: string; kind: Kind; project?: string }) => void;
  ended: (pid: number) => void;
};

let watching: Watcher | null = null;

/** The shell says where to write these down. Called once, at launch. */
export function watchWhatWeStart(watcher: Watcher | null): void {
  watching = watcher;
}

/** One child started. A pid of zero or undefined is a spawn that never got off
 *  the ground, and there is nothing to write down about it. */
export function started(one: {
  pid: number | undefined;
  what: string;
  kind: Kind;
  project?: string;
}): void {
  if (watching === null || one.pid === undefined || one.pid <= 0) return;
  try {
    watching.started({ ...one, pid: one.pid });
  } catch {
    // A ledger that throws is a ledger, not the work. The child still ran.
  }
}

/** And one that is over. */
export function ended(pid: number | undefined): void {
  if (watching === null || pid === undefined || pid <= 0) return;
  try {
    watching.ended(pid);
  } catch {
    // Same again: a missed row is a row, not a failure.
  }
}
