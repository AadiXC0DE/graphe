/** A Hosted stop waits for Pi's own settle instead of inventing success while
 *  the child can still emit events from the previous turn. */

import { describe, expect, it, vi } from 'vitest';

import { Hosted } from '../src/agent/pi/child-session';
import type { Guarded, CreateSessionOptions } from '../src/agent/pi/adapter';
import type { ChildExit, ChildRuntime } from '../electron/services/runtime-supervisor';

class FakeRuntime implements ChildRuntime {
  readonly nonce = 'test-nonce';
  readonly pid = 123;
  readonly commands: string[] = [];
  private readonly events = new Set<(event: Record<string, unknown>) => void>();
  private readonly exits = new Set<(exit: ChildExit) => void>();

  send(command: { type: string; [key: string]: unknown }): Promise<Record<string, unknown>> {
    this.commands.push(command.type);
    return Promise.resolve(command.type === 'get_state'
      ? { success: true, data: {} }
      : { success: true });
  }

  onEvent(listener: (event: Record<string, unknown>) => void): () => void {
    this.events.add(listener);
    return () => this.events.delete(listener);
  }

  onExit(listener: (how: ChildExit) => void): () => void {
    this.exits.add(listener);
    return () => this.exits.delete(listener);
  }

  stop(): Promise<void> {
    return Promise.resolve();
  }

  emit(event: Record<string, unknown>): void {
    for (const listener of this.events) listener(event);
  }
}

function guard(): Guarded {
  return {
    relay: { fromPi: vi.fn() },
    review: vi.fn(),
    judge: vi.fn(),
    asking: { pending: [] },
    confirmations: { pending: [] },
    paused: { on: false, hold: vi.fn() },
    facts: { projectRoot: '/workspace/hosted-stop', howFar: 'asking' },
    house: {},
    desk: { forget: vi.fn() },
    agentDir: '/tmp/hosted-stop-agent',
    planning: () => false,
    setPlanning: vi.fn(),
    setPlanMode: vi.fn(),
    gate: () => 'open',
    askFirst: vi.fn(),
    reopenGate: vi.fn(),
    workBegan: vi.fn(),
    releaseEverything: () => ({ callIds: [], askedIds: [] }),
    forgetChecks: vi.fn(),
  } as unknown as Guarded;
}

describe('a hosted stop', () => {
  it('applies the shared steer admission before sending an RPC', async () => {
    const runtime = new FakeRuntime();
    const hosted = new Hosted({
      projectRoot: '/workspace/hosted-stop',
      onEvent: () => undefined,
    } as CreateSessionOptions, guard(), runtime, async () => runtime);

    await expect(hosted.steer('late line')).rejects.toThrow(
      'Nothing is running to steer, so that line was not sent. Send it as an ordinary message instead.',
    );
    expect(runtime.commands.filter((command) => command === 'steer')).toHaveLength(0);

    const prompting = hosted.prompt('the first line');
    await vi.waitFor(() => expect(runtime.commands).toContain('prompt'));
    await hosted.steer('line for the running turn');
    expect(runtime.commands).toContain('steer');
    runtime.emit({ type: 'agent_settled' });
    await prompting;
    hosted.dispose();
  });

  it('does not report stopped until the child authoritatively settles', async () => {
    const runtime = new FakeRuntime();
    const events: Record<string, unknown>[] = [];
    const options = {
      projectRoot: '/workspace/hosted-stop',
      onEvent: (event: Record<string, unknown>) => events.push(event),
    } as CreateSessionOptions;
    const hosted = new Hosted(options, guard(), runtime, async () => runtime);
    const stopping = hosted.stop();

    await vi.waitFor(() => expect(runtime.commands).toContain('abort'));
    expect(events.some((event) => event.type === 'settled')).toBe(false);
    runtime.emit({ type: 'message-delta', text: 'late output from the old turn' });
    expect(events.some((event) => event.type === 'settled')).toBe(false);

    runtime.emit({ type: 'agent_settled' });
    await stopping;
    expect(events.filter((event) => event.type === 'settled')).toEqual([{ type: 'settled', how: 'stopped' }]);
    hosted.dispose();
  });
});
