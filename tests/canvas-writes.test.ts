import { afterEach, describe, expect, it, vi } from 'vitest';
import { CanvasWrites, canvasWriteKey } from '../src/lib/canvas-writes';

afterEach(() => vi.useRealTimers());

describe('canvas write boundaries', () => {
  it('coalesces edits but keeps project owners separate', async () => {
    vi.useFakeTimers();
    const writes = new CanvasWrites();
    const old = vi.fn(async () => undefined);
    const latest = vi.fn(async () => undefined);
    const elsewhere = vi.fn(async () => undefined);
    writes.schedule(canvasWriteKey('/a', 'one'), old);
    writes.schedule(canvasWriteKey('/a', 'one'), latest);
    writes.schedule(canvasWriteKey('/b', 'one'), elsewhere);
    await writes.flush();
    expect(old).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledTimes(1);
    expect(elsewhere).toHaveBeenCalledTimes(1);
  });

  it('waits for in-flight writes before the latest edit and Start barrier', async () => {
    const writes = new CanvasWrites();
    const held = Promise.withResolvers<void>();
    const order: number[] = [];
    writes.schedule('one', async () => { await held.promise; order.push(1); });
    const first = writes.flush('one');
    writes.schedule('one', async () => { order.push(2); });
    const start = writes.flush('one');
    expect(order).toEqual([]);
    held.resolve();
    await Promise.all([first, start]);
    expect(order).toEqual([1, 2]);
  });

  it('retains failures until a successful edit repairs them', async () => {
    const writes = new CanvasWrites();
    writes.schedule('one', async () => { throw new Error('disk full'); });
    await expect(writes.flush('one')).rejects.toThrow('disk full');
    await expect(writes.flush('one')).rejects.toThrow('disk full');
    writes.schedule('one', async () => undefined);
    await expect(writes.flush('one')).resolves.toBeUndefined();
  });

  it('drains an edit that arrives while Start waits for an earlier write', async () => {
    const writes = new CanvasWrites();
    const held = Promise.withResolvers<void>();
    const latest = vi.fn(async () => undefined);
    writes.schedule('one', async () => held.promise);
    const start = writes.flush('one');
    await Promise.resolve();
    writes.schedule('one', latest);
    held.resolve();
    await start;
    expect(latest).toHaveBeenCalledOnce();
  });

  it('cancels queued edits before deletion and drains writes already started', async () => {
    const writes = new CanvasWrites();
    const held = Promise.withResolvers<void>();
    const pending = vi.fn(async () => undefined);
    writes.schedule('one', async () => held.promise);
    const first = writes.flush('one');
    writes.schedule('one', pending);
    const deleted = writes.cancel('one');
    held.resolve();
    await Promise.all([first, deleted]);
    await writes.flush();
    expect(pending).not.toHaveBeenCalled();
  });
});
