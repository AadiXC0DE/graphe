type Write = () => Promise<void>;
type Entry = { timer: ReturnType<typeof setTimeout> | null; pending: Write | null; running: Promise<void>; error: unknown };

/** Coalesce edits without allowing an older write to finish after a newer one. */
export class CanvasWrites {
  private readonly entries = new Map<string, Entry>();

  schedule(key: string, write: Write): void {
    const entry = this.entries.get(key) ?? { timer: null, pending: null, running: Promise.resolve(), error: null };
    this.entries.set(key, entry);
    if (entry.timer !== null) clearTimeout(entry.timer);
    entry.pending = write;
    entry.timer = setTimeout(() => { void this.flush(key).catch(() => undefined); }, 400);
  }

  async flush(key?: string): Promise<void> {
    if (key === undefined) {
      await Promise.all([...this.entries.keys()].map((one) => this.flush(one)));
      return;
    }
    const entry = this.entries.get(key);
    if (entry === undefined) return;
    if (entry.timer !== null) clearTimeout(entry.timer);
    entry.timer = null;
    const write = entry.pending;
    entry.pending = null;
    if (write !== null) {
      entry.running = entry.running.catch(() => undefined).then(async () => {
        try { await write(); entry.error = null; }
        catch (cause) { entry.error = cause; }
      });
    }
    const running = entry.running;
    await running;
    // An edit can arrive while the disk write is in flight. Start's barrier
    // must include it, not only the snapshot present at the first await.
    if (entry.pending !== null || entry.running !== running) return this.flush(key);
    if (entry.error !== null) throw entry.error;
  }

  async cancel(key: string): Promise<void> {
    const entry = this.entries.get(key);
    if (entry === undefined) return;
    if (entry.timer !== null) clearTimeout(entry.timer);
    entry.pending = null;
    await entry.running;
    this.entries.delete(key);
  }
}

export const canvasWriteKey = (project: string, flow: string): string => JSON.stringify([project, flow]);
