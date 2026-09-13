/** A time limit on what an add-on may do while the turn waits for it.
 *
 * The failure this stands against is silent: one handler that never answers
 * holds the whole conversation open, and the window shows a run that never
 * ends. So the tests are about a handler that never answers, about the one
 * event where waiting is legitimate, and about what a timeout does not claim:
 * a handler it let go of may still be running, and its state is not reused.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  budgetMs,
  forgetOverruns,
  forgetRunning,
  HOOK_BUDGET_MS,
  hookStillRunning,
  raceBudget,
  recentOverruns,
  withHookBudget,
  type Overrun,
} from '../src/agent/pi/hook-budget';

type Handler = (...args: never[]) => unknown;

/** A stand-in for Pi's runner: an emit nobody calls, and the handlers an
 *  extension registered, where the loader keeps them. */
function runnerWith(handlers: Record<string, Handler[]>, path = '/add-ons/slow-one/index.mjs') {
  return {
    emit: (): unknown => undefined,
    extensions: [{ resolvedPath: path, handlers: new Map(Object.entries(handlers)) }],
  };
}

function handlerFor(runner: ReturnType<typeof runnerWith>, event: string): Handler {
  const found = runner.extensions[0]?.handlers.get(event)?.[0];
  if (found === undefined) throw new Error(`no handler for ${event}`);
  return found;
}

const never = (): Promise<never> => new Promise<never>(() => {});

afterEach(() => {
  forgetOverruns();
  forgetRunning();
});

describe('a handler that never answers', () => {
  it('lets the event finish anyway, inside the budget', async () => {
    const seen: Overrun[] = [];
    const runner = withHookBudget(runnerWith({ agent_end: [never] }), (one) => seen.push(one), 40);

    const began = Date.now();
    await expect(handlerFor(runner, 'agent_end')()).resolves.toBeUndefined();
    expect(Date.now() - began).toBeLessThan(1000);
    expect(seen).toHaveLength(1);
  });

  it('is written down by name, event and how long it took', async () => {
    const seen: Overrun[] = [];
    const runner = withHookBudget(runnerWith({ turn_end: [never] }), (one) => seen.push(one), 30);
    await handlerFor(runner, 'turn_end')();

    expect(seen[0]?.extension).toBe('slow-one');
    expect(seen[0]?.event).toBe('turn_end');
    expect(seen[0]?.ms).toBeGreaterThanOrEqual(25);
    expect(recentOverruns()).toEqual(seen);
  });

  it('keeps a handler that answers in time answering', async () => {
    const seen: Overrun[] = [];
    const runner = withHookBudget(
      runnerWith({ agent_settled: [() => 'in time'] }),
      (one) => seen.push(one),
      200,
    );
    await expect(handlerFor(runner, 'agent_settled')()).resolves.toBe('in time');
    expect(seen).toEqual([]);
  });
});

describe('a handler the budget let go of', () => {
  it('is recorded as possibly still running, never as stopped or failed', async () => {
    const seen: Overrun[] = [];
    const runner = withHookBudget(
      runnerWith({ agent_end: [never] }, '/add-ons/never-answers/index.mjs'),
      (one) => seen.push(one),
      25,
    );
    await expect(handlerFor(runner, 'agent_end')()).resolves.toBeUndefined();

    expect(seen[0]?.abandoned).toBe(true);
    expect(seen[0]?.stopped).toBe(false);
    // `never` declares no slot for a signal, so nothing could have stopped it.
    expect(seen[0]?.signalled).toBe(false);
    expect(hookStillRunning('never-answers', 'agent_end')).toBe(true);
  });

  it('stops counting as running once it answers, without rewriting how it ended', async () => {
    const held = Promise.withResolvers<void>();
    const seen: Overrun[] = [];
    const runner = withHookBudget(
      runnerWith({ turn_end: [() => held.promise] }, '/add-ons/settles-late/index.mjs'),
      (one) => seen.push(one),
      25,
    );
    await handlerFor(runner, 'turn_end')();
    expect(hookStillRunning('settles-late', 'turn_end')).toBe(true);

    held.resolve();
    await vi.waitFor(() => {
      expect(hookStillRunning('settles-late', 'turn_end')).toBe(false);
    });

    expect(recentOverruns()).toHaveLength(1);
    expect(seen[0]?.abandoned).toBe(true);
    expect(seen[0]?.stopped).toBe(true);
  });

  it('is not started again until the abandoned run has stopped', async () => {
    let calls = 0;
    const held = Promise.withResolvers<void>();
    const handler = (): Promise<void> => {
      calls += 1;
      return held.promise;
    };
    const runner = withHookBudget(
      runnerWith({ agent_end: [handler] }, '/add-ons/still-busy/index.mjs'),
      () => {},
      20,
    );
    const call = handlerFor(runner, 'agent_end');

    await call();
    expect(calls).toBe(1);
    // Refused, not queued: the first run still holds whatever it holds.
    await expect(call()).resolves.toBeUndefined();
    expect(calls).toBe(1);

    held.resolve();
    await vi.waitFor(() => {
      expect(hookStillRunning('still-busy', 'agent_end')).toBe(false);
    });
    await call();
    expect(calls).toBe(2);
  });

  it('hands a signal to a handler that declares a slot for one, and aborts it', async () => {
    let given: AbortSignal | undefined;
    let aborted = false;
    const handler = (_event: unknown, _ctx: unknown, signal?: AbortSignal): Promise<never> => {
      given = signal;
      signal?.addEventListener('abort', () => {
        aborted = true;
      });
      return never();
    };
    const seen: Overrun[] = [];
    const runner = withHookBudget(
      runnerWith({ agent_end: [handler as Handler] }, '/add-ons/takes-signal/index.mjs'),
      (one) => seen.push(one),
      20,
    );
    // Pi calls a lifecycle handler with the event and its context; the signal
    // is the slot after those, which this handler declares.
    const call = handlerFor(runner, 'agent_end') as (...args: unknown[]) => Promise<unknown>;
    await call({ type: 'agent_end' }, {});

    expect(given).toBeInstanceOf(AbortSignal);
    expect(aborted).toBe(true);
    expect(seen[0]?.signalled).toBe(true);
    expect(seen[0]?.stopped).toBe(false);
  });

  it('leaves a sibling handler on the same event alone', async () => {
    const runner = withHookBudget(
      runnerWith({ agent_end: [never, () => 'sibling'] }, '/add-ons/two-handlers/index.mjs'),
      () => {},
      20,
    );
    const [first, second] = runner.extensions[0]?.handlers.get('agent_end') ?? [];
    await first?.();
    expect(await second?.()).toBe('sibling');
  });
});

describe('the one place waiting is allowed', () => {
  it('leaves a tool_call handler exactly as it was, because a person may be answering', async () => {
    const original: Handler = () => never();
    const runner = withHookBudget(runnerWith({ tool_call: [original] }), () => {}, 20);
    expect(handlerFor(runner, 'tool_call')).toBe(original);
  });
});

describe('a handler that fails', () => {
  it('inside the budget, hands the failure on so it still gets reported', async () => {
    const runner = withHookBudget(
      runnerWith({
        agent_end: [
          () => {
            throw new Error('bad add-on');
          },
        ],
      }),
      () => {},
      200,
    );
    await expect(handlerFor(runner, 'agent_end')()).rejects.toThrow('bad add-on');
  });

  it('after the budget, does not take the process down with it', async () => {
    const loose: unknown[] = [];
    const caught = (reason: unknown): void => {
      loose.push(reason);
    };
    process.on('unhandledRejection', caught);
    try {
      const runner = withHookBudget(
        runnerWith({
          agent_end: [
            () =>
              new Promise((_resolve, reject) => {
                setTimeout(() => reject(new Error('too late')), 30);
              }),
          ],
        }),
        () => {},
        5,
      );
      await expect(handlerFor(runner, 'agent_end')()).resolves.toBeUndefined();
      await new Promise((resolve) => setTimeout(resolve, 120));
    } finally {
      process.off('unhandledRejection', caught);
    }
    expect(loose).toEqual([]);
  });
});

describe('wrapping the same runner twice', () => {
  it('changes nothing the second time', () => {
    const runner = withHookBudget(runnerWith({ agent_end: [never] }), () => {}, 20);
    const once = handlerFor(runner, 'agent_end');
    withHookBudget(runner, () => {}, 20);
    expect(handlerFor(runner, 'agent_end')).toBe(once);
  });
});

describe('how long the budget is', () => {
  it('is the default unless somebody who knows what they are doing says otherwise', () => {
    expect(budgetMs({})).toBe(HOOK_BUDGET_MS);
    expect(budgetMs({ GRAPHE_HOOK_BUDGET_MS: ' 8000 ' })).toBe(8000);
    expect(budgetMs({ GRAPHE_HOOK_BUDGET_MS: 'soon' })).toBe(HOOK_BUDGET_MS);
    expect(budgetMs({ GRAPHE_HOOK_BUDGET_MS: '-1' })).toBe(HOOK_BUDGET_MS);
  });

  it('is measured from the wait, not guessed', async () => {
    const raced = await raceBudget(never(), 25);
    expect(raced.over).toBe(true);
    expect(raced.ms).toBeGreaterThanOrEqual(20);
    expect((await raceBudget(Promise.resolve('done'), 200)).value).toBe('done');
  });
});
