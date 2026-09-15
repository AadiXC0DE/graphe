/** One agent run at a time in a folder.
 *
 * Two conversations can share a workspace now, which is the point: a new chat
 * sees the files the last one wrote. What they cannot do is write those files
 * in the same minute. Tool calls are individually guarded, which is not the same
 * guarantee: a guarded `git checkout`, then a guarded write, is still two
 * conversations replacing each other's files.
 *
 * So a run takes the workspace for its whole length — every tool it starts,
 * every child it waits on, and the pause for a person's answer, because a run
 * waiting on a question is a run that will carry on writing. The next one waits
 * its turn in arrival order.
 *
 * What this is not: protection from an editor, a terminal, or anything else
 * outside Graphe. It is two chats inside one app agreeing about one folder.
 *
 * Pure: no timers, no I/O. `when` is a promise the caller awaits, and the
 * caller supplies the clock.
 */

export type Ticket = {
  /** The lock's name. A canonical folder, which is what two conversations
   *  actually have in common. */
  key: string;
  /** The run holding or asking. Unique per run, not per conversation: a second
   *  send while one is running is a different run and must queue behind it. */
  runId: string;
  /** What to show somebody waiting: the conversation in front of them. */
  label: string;
};

export type Admission =
  | {
      granted: true;
      /** True when this request is what took the lock. False when it was
       *  inherited from an ancestor that already held it: nothing was taken, so
       *  nothing is released when this run ends. */
      newlyHeld: boolean;
    }
  | {
      granted: false;
      /** How many runs are ahead, counting the holder. */
      ahead: number;
      /** The run in front of everybody, for "waiting on …". */
      holder: string | null;
      /** Resolves when this ticket is admitted, or `cancelled` when it was
       *  taken out of the queue first. */
      when: Promise<'granted' | 'cancelled'>;
    };

type Queued = Ticket & { admit: (outcome: 'granted' | 'cancelled') => void };

export class WorkspaceLocks {
  private readonly holder = new Map<string, Ticket>();
  private readonly waiting = new Map<string, Queued[]>();

  /**
   * Take the lock, or join the queue for it.
   *
   * `inherits` is a run that already holds this lock and is the ancestor of the
   * asking one: a child working in its parent's folder is the parent working,
   * and queueing it behind its own parent would deadlock the pair.
   */
  request(ticket: Ticket, inherits?: string): Admission {
    const holding = this.holder.get(ticket.key);
    if (holding === undefined) {
      this.holder.set(ticket.key, ticket);
      return { granted: true, newlyHeld: true };
    }
    if (inherits !== undefined && holding.runId === inherits) {
      return { granted: true, newlyHeld: false };
    }

    let admit: (outcome: 'granted' | 'cancelled') => void = () => undefined;
    const when = new Promise<'granted' | 'cancelled'>((resolve) => {
      admit = resolve;
    });
    const queue = this.waiting.get(ticket.key) ?? [];
    queue.push({ ...ticket, admit });
    this.waiting.set(ticket.key, queue);
    return {
      granted: false,
      ahead: queue.length,
      holder: holding.label,
      when,
    };
  }

  /**
   * Give the lock up and admit whoever is next.
   *
   * The next ticket's promise is resolved here, and this returns it so the
   * caller can start that run without polling. Releasing a lock somebody else
   * holds does nothing: a run that already stopped must not free another run's
   * workspace.
   */
  release(key: string, runId: string): Ticket | null {
    const holding = this.holder.get(key);
    if (holding === undefined || holding.runId !== runId) return null;
    return this.admitNext(key);
  }

  /** Take a ticket out of the queue. A ticket already admitted is released
   *  through `release`, and a ticket already cancelled is left alone. */
  cancel(key: string, runId: string): boolean {
    const queue = this.waiting.get(key);
    if (queue === undefined) return false;
    const at = queue.findIndex((one) => one.runId === runId);
    if (at < 0) return false;
    const [gone] = queue.splice(at, 1);
    if (queue.length === 0) this.waiting.delete(key);
    gone?.admit('cancelled');
    return true;
  }

  /** Who holds it, and who is waiting, in the order they will be let in. */
  state(key: string): { holder: Ticket | null; waiting: readonly Ticket[] } {
    return {
      holder: this.holder.get(key) ?? null,
      waiting: (this.waiting.get(key) ?? []).map(({ admit: _admit, ...one }) => one),
    };
  }

  /** Every lock with somebody holding or waiting: what the app knows is going
   *  on, for a global "running" view. */
  keys(): readonly string[] {
    return [...new Set([...this.holder.keys(), ...this.waiting.keys()])].sort();
  }

  private admitNext(key: string): Ticket | null {
    const queue = this.waiting.get(key) ?? [];
    const next = queue.shift();
    if (queue.length === 0) this.waiting.delete(key);
    if (next === undefined) {
      this.holder.delete(key);
      return null;
    }
    const { admit, ...ticket } = next;
    this.holder.set(key, ticket);
    admit('granted');
    return ticket;
  }
}
