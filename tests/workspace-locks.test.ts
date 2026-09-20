/** Two conversations may share a folder. They may not write it at once.
 *
 * The queue is the whole contract: arrival order, one holder, and a ticket that
 * can be taken back before it is admitted.
 */

import { describe, expect, it } from 'vitest';

import { WorkspaceLocks, type Ticket } from '../electron/services/workspace-locks';

const ticket = (runId: string, over: Partial<Ticket> = {}): Ticket => ({
  key: '/work/site',
  runId,
  label: runId,
  ...over,
});

describe('a free workspace', () => {
  it('is granted to the first ask', () => {
    const locks = new WorkspaceLocks();
    expect(locks.request(ticket('a'))).toEqual({ granted: true, newlyHeld: true });
    expect(locks.state('/work/site').holder?.runId).toBe('a');
  });
});

describe('a workspace somebody is working in', () => {
  it('queues the second run behind it, and says what it is waiting on', async () => {
    const locks = new WorkspaceLocks();
    locks.request(ticket('a', { label: 'site, first chat' }));
    const second = locks.request(ticket('b'));
    expect(second.granted).toBe(false);
    if (second.granted) throw new Error('unreachable');
    expect(second.ahead).toBe(1);
    expect(second.holder).toBe('site, first chat');
    expect(locks.state('/work/site').waiting.map((one) => one.runId)).toEqual(['b']);
  });

  it('admits them in the order they arrived', async () => {
    const locks = new WorkspaceLocks();
    locks.request(ticket('a'));
    const second = locks.request(ticket('b'));
    const third = locks.request(ticket('c'));
    if (second.granted || third.granted) throw new Error('unreachable');

    locks.release('/work/site', 'a');
    expect(await second.when).toBe('granted');
    expect(locks.state('/work/site').holder?.runId).toBe('b');
    // The third is still waiting, and is still behind the one now working.
    expect(locks.state('/work/site').waiting.map((one) => one.runId)).toEqual(['c']);
    locks.release('/work/site', 'b');
    expect(await third.when).toBe('granted');
  });

  it('does not free the workspace when a run that no longer holds it lets go', () => {
    const locks = new WorkspaceLocks();
    locks.request(ticket('a'));
    expect(locks.release('/work/site', 'somebody-else')).toBeNull();
    expect(locks.state('/work/site').holder?.runId).toBe('a');
  });

  it('lets the next run start without anybody polling', async () => {
    const locks = new WorkspaceLocks();
    locks.request(ticket('a'));
    const second = locks.request(ticket('b'));
    if (second.granted) throw new Error('unreachable');
    const next = locks.release('/work/site', 'a');
    expect(next?.runId).toBe('b');
    expect(await second.when).toBe('granted');
  });
});

describe('a queued run that is taken back', () => {
  it('is told it was cancelled, and never starts', async () => {
    const locks = new WorkspaceLocks();
    locks.request(ticket('a'));
    const second = locks.request(ticket('b'));
    if (second.granted) throw new Error('unreachable');
    expect(locks.cancel('/work/site', 'b')).toBe(true);
    expect(await second.when).toBe('cancelled');
    expect(locks.state('/work/site').waiting).toEqual([]);
  });

  it('cannot be cancelled by a run id that is not in the queue', () => {
    const locks = new WorkspaceLocks();
    locks.request(ticket('a'));
    expect(locks.cancel('/work/site', 'nobody')).toBe(false);
    // Cancelling the holder is not how a running run stops: it releases when it
    // reaches a terminal state, so that its children and writes are done first.
    expect(locks.state('/work/site').holder?.runId).toBe('a');
  });
});

describe('a child of the run that holds the workspace', () => {
  it('works inside its parent instead of queueing behind it', () => {
    const locks = new WorkspaceLocks();
    locks.request(ticket('parent'));
    expect(locks.request(ticket('child'), 'parent')).toEqual({ granted: true, newlyHeld: false });
  });

  it('queues normally when the parent only held it earlier', () => {
    const locks = new WorkspaceLocks();
    locks.request(ticket('other'));
    const child = locks.request(ticket('child'), 'parent');
    expect(child.granted).toBe(false);
  });
});

describe('what the app knows is going on', () => {
  it('names every workspace with somebody in it or behind it', () => {
    const locks = new WorkspaceLocks();
    locks.request(ticket('a', { key: '/work/one' }));
    locks.request(ticket('b', { key: '/work/two' }));
    locks.request(ticket('c', { key: '/work/two' }));
    locks.release('/work/two', 'b');
    expect(locks.keys()).toEqual(['/work/one', '/work/two']);
    expect(locks.state('/work/two').holder?.runId).toBe('c');
  });
});
