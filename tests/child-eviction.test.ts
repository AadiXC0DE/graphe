/** Idle eviction and the ceiling: the two rules that keep one child per
 *  conversation from being one Pi per tab for ever.
 *
 * Both are driven here with fakes rather than with real children, because both
 * are decisions about time and memory and neither is worth ten minutes of test
 * time to reach. The clock, the free-memory reading and what a child holds are
 * all injected for that reason: what is being asserted is *when* a child is
 * given back, not that `ps` works.
 *
 * What must hold at the end, in every case:
 *
 *  - a conversation nobody has spoken to for the deadline gives its child back;
 *  - one that is working does not, however long it has been quiet;
 *  - a prompt that takes the count past the ceiling evicts the quietest other
 *    child rather than being refused;
 *  - a child that will not let go is still counted, so the ceiling is a fact
 *    about processes rather than about attempts.
 */

import { describe, expect, it } from 'vitest';

import { ChildRuntimes } from '../electron/services/runtime-supervisor';
import type { Evictable } from '../electron/services/runtime-supervisor';

/** One conversation's child, as the registry sees it, with a switch for every
 *  thing a test needs to be true or false about it. */
class FakeChild implements Evictable {
  readonly unloads: number[] = [];
  /** What `unload` answers. False stands for a child that would not stop. */
  letsGo = true;
  /** A rejected unload is not evidence that the process disappeared. */
  rejects = false;
  private readonly when: number | null;
  private readonly doing: boolean;

  constructor(options: { at: number | null; working?: boolean }) {
    this.when = options.at;
    this.doing = options.working ?? false;
  }

  busy(): boolean {
    return this.doing;
  }

  activeAt(): number | null {
    return this.when;
  }

  unload(): Promise<boolean> {
    this.unloads.push(Date.now());
    if (this.rejects) return Promise.reject(new Error('unload failed'));
    return Promise.resolve(this.letsGo);
  }
}

/** A registry with a clock and a memory figure of its own: 400MB free over
 *  100MB a child is a ceiling of two, which is the clamped floor and is enough
 *  for every case below to be about the rule rather than about arithmetic. */
function registryAt(at: { now?: number; free?: number; rss?: number } = {}): {
  runtimes: ChildRuntimes;
  setNow(at: number): void;
  said: { what: string; extra?: Record<string, unknown> }[];
} {
  let now = at.now ?? 0;
  const said: { what: string; extra?: Record<string, unknown> }[] = [];
  const runtimes = new ChildRuntimes({
    now: () => now,
    freeMemory: () => at.free ?? 400 * 1024 * 1024,
    rssPerChild: () => at.rss ?? 100 * 1024 * 1024,
    idleFor: 10 * 60_000,
    log: (what, extra) => said.push({ what, extra }),
  });
  return {
    runtimes,
    setNow: (one) => {
      now = one;
    },
    said,
  };
}

describe('the ceiling', () => {
  it('is half of what was free over what a child holds, clamped to two and eight', () => {
    const roomy = registryAt({ free: 8 * 1024 * 1024 * 1024 });
    // 4GB of room over 100MB a child is 40, which is more Pis than anybody has
    // conversations.
    expect(roomy.runtimes.ceiling).toBe(8);

    const cramped = registryAt({ free: 200 * 1024 * 1024 });
    // One child's worth of room, which would make the child runtime pointless.
    expect(cramped.runtimes.ceiling).toBe(2);

    const ordinary = registryAt({ free: 1024 * 1024 * 1024 });
    expect(ordinary.runtimes.ceiling).toBe(5);
  });

  it('is written to the log with the figure it was worked out from', () => {
    const { runtimes, said } = registryAt({ free: 1024 * 1024 * 1024 });
    runtimes.register(new FakeChild({ at: 0 }));
    expect(said).toEqual([
      { what: 'child runtimes', extra: { ceiling: 5, rssPerChildMb: 100, freeMemoryMb: 1024 } },
    ]);
  });

  it('takes the quietest other child rather than refusing a prompt', async () => {
    const { runtimes } = registryAt();
    const first = new FakeChild({ at: 1 });
    const second = new FakeChild({ at: 2 });
    const third = new FakeChild({ at: 3 });
    runtimes.register(first);
    runtimes.register(second);
    expect(runtimes.count).toBe(2);

    // A third conversation asks for a child of its own, on a machine whose
    // ceiling is two. Somebody has to go, and it is whoever was asked for
    // something longest ago.
    await runtimes.makeRoom();
    expect(first.unloads).toHaveLength(1);
    expect(second.unloads).toHaveLength(0);

    runtimes.register(third);
    expect(runtimes.count).toBe(2);
  });

  it('keeps counting a child that would not let go, and goes on to the next', async () => {
    const { runtimes } = registryAt();
    const stubborn = new FakeChild({ at: 1 });
    stubborn.letsGo = false;
    runtimes.register(stubborn);
    const other = new FakeChild({ at: 2 });
    runtimes.register(other);

    await runtimes.makeRoom();
    // Asked once rather than in a loop, and the next-quietest was tried after
    // it: one refusing child must not stop the ceiling being met.
    expect(stubborn.unloads).toHaveLength(1);
    expect(other.unloads).toHaveLength(1);
    // Still holding the one that would not stop, because it is really alive.
    expect(runtimes.count).toBe(1);
  });

  it('keeps counting a child when unload rejects', async () => {
    const { runtimes } = registryAt();
    const rejected = new FakeChild({ at: 1 });
    rejected.rejects = true;
    runtimes.register(rejected);
    const other = new FakeChild({ at: 2 });
    runtimes.register(other);

    await runtimes.makeRoom();
    expect(rejected.unloads).toHaveLength(1);
    expect(other.unloads).toHaveLength(1);
    // A rejected stop attempt leaves the child alive and counted, just like a
    // truthful `false` result; only the other child was evicted.
    expect(runtimes.count).toBe(1);
  });

  it('does nothing when no other child is quiet', async () => {
    const { runtimes } = registryAt();
    const working = new FakeChild({ at: 1, working: true });
    runtimes.register(working);
    const also = new FakeChild({ at: 2, working: true });
    runtimes.register(also);

    await runtimes.makeRoom();
    expect(working.unloads).toHaveLength(0);
    expect(also.unloads).toHaveLength(0);
    expect(runtimes.count).toBe(2);
  });
});

describe('idle eviction', () => {
  it('gives back a child nothing has been asked of for the deadline', async () => {
    const { runtimes, setNow } = registryAt();
    const idle = new FakeChild({ at: 0 });
    runtimes.register(idle);

    setNow(9 * 60_000);
    await runtimes.sweep();
    // Nine minutes is not ten: a conversation somebody is reading is not one
    // that has been abandoned.
    expect(idle.unloads).toHaveLength(0);
    expect(runtimes.count).toBe(1);

    setNow(10 * 60_000);
    await runtimes.sweep();
    expect(idle.unloads).toHaveLength(1);
    expect(runtimes.count).toBe(0);
  });

  it('leaves a conversation that is working alone, however long it has been', async () => {
    const { runtimes, setNow } = registryAt();
    const busy = new FakeChild({ at: 0, working: true });
    runtimes.register(busy);

    setNow(60 * 60_000);
    await runtimes.sweep();
    expect(busy.unloads).toHaveLength(0);
    expect(runtimes.count).toBe(1);
  });

  it('counts a child nobody has ever asked for something as the oldest there is', async () => {
    const { runtimes, setNow } = registryAt();
    const never = new FakeChild({ at: null });
    const asked = new FakeChild({ at: 0 });
    runtimes.register(never);
    runtimes.register(asked);

    // At the deadline only one of them is over it; the one that was asked for
    // something at zero is right on the edge.
    setNow(10 * 60_000);
    await runtimes.sweep();
    expect(never.unloads).toHaveLength(1);
    expect(asked.unloads).toHaveLength(1);
  });

  it('stops sweeping once nothing is held', async () => {
    const { runtimes } = registryAt();
    const one = new FakeChild({ at: 0 });
    const token = runtimes.register(one);
    runtimes.forget(token);
    // Nothing to sweep, and no timer left running that would keep a shell whose
    // last conversation closed from exiting.
    await expect(runtimes.sweep()).resolves.toBeUndefined();
    expect(runtimes.count).toBe(0);
  });
});
