/** The projects the shell has open at once.
 *
 * The window keeps a desk per project (src/lib/projects.ts); this is the other
 * half of the same idea, in the process that owns the things a window cannot
 * hold — the agent session, the folder's version history, and the ledger.
 *
 * ## Why they stay open
 *
 * Closing a project on every switch would be simpler, and it would be a lie.
 * The window would still be showing the conversation, because it kept it, while
 * the agent had forgotten every word of it — so the next sentence somebody typed
 * would be answered by something with amnesia, and the thread on screen would be
 * the evidence that we lost their place. BACKLOG B2 is "switching must not lose
 * your place", and their place includes what they were in the middle of saying.
 *
 * So a project stays open until it falls off the end. `LIMIT` exists because
 * each one holds a live session: a designer with four projects on the go is
 * ordinary, a designer with forty open at once is not, and the oldest one going
 * quiet is much better than the machine going slowly.
 *
 * ## Isolation
 *
 * Every workspace owns its own everything. There is no shared ledger, no shared
 * history and no fallback to "the current one" anywhere in this file — a lookup
 * that misses returns null rather than the nearest thing, because the nearest
 * thing is somebody else's project.
 */

/** One project, and everything the shell holds for it. Generic in what is held
 *  so this file stays about the bookkeeping: the shell puts the session, the
 *  timeline and the ledger in there, and a test can put a counter in there. */
export type Workspace<T> = {
  readonly path: string;
  readonly name: string;
  readonly held: T;
};

/** How many projects may be open at once. Four is "this week's work". */
export const LIMIT = 4;

export type WorkspacesOptions<T> = {
  /** Let go of everything a workspace held. Called exactly once per workspace,
   *  whether it was closed on purpose or fell off the end of the list. */
  close: (held: T) => void;
  limit?: number;
};

export class Workspaces<T> {
  /** In front first, oldest last. The order *is* the least-recently-used list,
   *  which is why it is an array and not a map. */
  #open: Workspace<T>[] = [];

  readonly #close: (held: T) => void;
  readonly #limit: number;

  constructor(options: WorkspacesOptions<T>) {
    this.#close = options.close;
    this.#limit = Math.max(1, options.limit ?? LIMIT);
  }

  /** The project everything happens to, or null before one is open. */
  get current(): Workspace<T> | null {
    return this.#open[0] ?? null;
  }

  /** In front first. A copy — nothing outside gets to reorder the list. */
  get open(): readonly Workspace<T>[] {
    return [...this.#open];
  }

  /** Exactly the one at this path, or null. Never the nearest one. */
  find(path: string): Workspace<T> | null {
    return this.#open.find((one) => one.path === path) ?? null;
  }

  /**
   * Bring an already-open project to the front. Null when it is not open, which
   * is the caller's cue to make one — and the reason this does not take a
   * factory: opening a project can fail in ways only the shell can word.
   */
  resume(path: string): Workspace<T> | null {
    const found = this.find(path);
    if (found === null) return null;
    this.#open = [found, ...this.#open.filter((one) => one !== found)];
    return found;
  }

  /**
   * Put a newly opened project in front.
   *
   * A workspace already open at the same path is closed first: two live sessions
   * on one folder would be two agents writing the same files, which is the one
   * thing the single-instance lock exists to prevent at the window level.
   */
  adopt(workspace: Workspace<T>): Workspace<T> {
    this.close(workspace.path);
    this.#open = [workspace, ...this.#open];
    while (this.#open.length > this.#limit) {
      // From the back, and never the one in front: the limit is about machines,
      // and taking away the project somebody is looking at to satisfy it would
      // be the limit deciding what they are working on.
      const oldest = this.#open.pop();
      if (oldest === undefined) break;
      this.#close(oldest.held);
    }
    return workspace;
  }

  /** Let one go. Silent when there was nothing there. */
  close(path: string): void {
    const found = this.find(path);
    if (found === null) return;
    this.#open = this.#open.filter((one) => one !== found);
    this.#close(found.held);
  }

  /** Everything, on the way out. */
  closeAll(): void {
    const all = this.#open;
    this.#open = [];
    for (const one of all) this.#close(one.held);
  }
}
