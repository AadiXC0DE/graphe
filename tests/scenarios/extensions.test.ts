/** T33, T34, T38, T39: what an add-on may do, and what happens when it will not
 *  stop.
 *
 * Four claims, all of them about a boundary rather than a feature: code nobody
 * has approved is never run; a question is answered for real or reported as
 * unanswered; a handler that overruns stops mattering; and a late answer from
 * one is not fed back into the event it missed.
 *
 * The probe runs real factory code out of `tests/fixtures/extensions`, copied
 * into a scratch folder so anything it writes lands there.
 */

import { copyFile, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import {
  dialogsOver,
  unsupportedTerminal,
  type ExtensionAnswer,
  type ExtensionAsk,
} from '../../src/agent/pi/extension-ui';
import { cardsFor, probe } from '../../src/agent/pi/extension-probe';
import {
  forgetOverruns,
  forgetRunning,
  hookStillRunning,
  recentOverruns,
  withHookBudget,
  type Overrun,
} from '../../src/agent/pi/hook-budget';

const made: string[] = [];

afterEach(async () => {
  for (const one of made.splice(0)) await rm(one, { recursive: true, force: true });
  forgetOverruns();
  forgetRunning();
});

async function scratch(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'graphe-scenario-addon-'));
  made.push(root);
  return root;
}

/** One of the fixture add-ons, in a folder this test owns. */
async function addonNamed(which: string): Promise<string> {
  const root = await scratch();
  const into = join(root, which);
  await mkdir(into, { recursive: true });
  await copyFile(
    fileURLToPath(new URL(`../fixtures/extensions/${which}/index.mjs`, import.meta.url)),
    join(into, 'index.mjs'),
  );
  return join(into, 'index.mjs');
}

/** Let every promise that can settle, settle. Nothing here is on a clock. */
async function flush(): Promise<void> {
  for (let at = 0; at < 6; at += 1) await Promise.resolve();
}

/** Something that answers only when the test says so. */
function deferred<T>(): { promise: Promise<T>; settle: (value: T) => void } {
  const { promise, resolve } = Promise.withResolvers<T>();
  return { promise, settle: resolve };
}

/* -------------------------------------------------------------------------- */

describe('T33: an add-on nobody has approved', () => {
  it('is discovered without a line of its code running', async () => {
    const marker = await addonNamed('marker');
    const plain = await addonNamed('plain');
    const cache = await scratch();

    const cards = await cardsFor([marker, plain], cache, (path) => path === plain, 'pi-scenario');

    expect(cards.get(plain)?.tools).toEqual(['count_words', 'spell_check']);
    expect(cards.get(marker)).toBeNull();
    // The whole claim: the top-level write in that file never happened.
    expect(existsSync(join(marker, '..', 'it-ran'))).toBe(false);
  });

  it('is read once somebody has said yes, which is what makes the gate a gate', async () => {
    const marker = await addonNamed('marker');
    const cache = await scratch();

    const cards = await cardsFor([marker], cache, () => true, 'pi-scenario');

    expect(cards.get(marker)?.tools).toEqual(['marks']);
    expect(existsSync(join(marker, '..', 'it-ran'))).toBe(true);
  });

  it('is answered from a cache once somebody has approved it, so a second look runs nothing', async () => {
    const marker = await addonNamed('marker');
    const cache = await scratch();

    // Refused: no card, and the file's own code never ran.
    const refused = await cardsFor([marker], cache, () => false, 'pi-scenario');
    expect(refused.get(marker)).toBeNull();
    expect(existsSync(join(marker, '..', 'it-ran'))).toBe(false);

    // Approved: read for real, and the answer is written down beside the cache
    // rather than kept in memory.
    const allowed = await cardsFor([marker], cache, () => true, 'pi-scenario');
    expect(allowed.get(marker)?.tools).toEqual(['marks']);
    expect((await readdir(cache)).length).toBeGreaterThan(0);

    const again = await cardsFor([marker], cache, () => true, 'pi-scenario');
    expect(again.get(marker)).toEqual(allowed.get(marker));
    expect((await probe(marker))?.tools).toEqual(['marks']);
  });
});

/* -------------------------------------------------------------------------- */

describe('T34: a trusted add-on that asks somebody something', () => {
  function personAtTheWindow(): {
    ask: (one: ExtensionAsk) => Promise<ExtensionAnswer>;
    asked: ExtensionAsk[];
    with: (one: ExtensionAnswer) => void;
  } {
    const asked: ExtensionAsk[] = [];
    const waiting: ((one: ExtensionAnswer) => void)[] = [];
    return {
      ask: (one) => {
        asked.push(one);
        const { promise, resolve } = Promise.withResolvers<ExtensionAnswer>();
        waiting.push(resolve);
        return promise;
      },
      asked,
      with: (one) => waiting.shift()?.(one),
    };
  }

  it('gets a real answer for every kind of question it can ask', async () => {
    const person = personAtTheWindow();
    const host = dialogsOver(person.ask);

    const choosing = host.select('Which file should I change?', ['hero.css', 'nav.css']);
    expect(person.asked[0]).toMatchObject({ kind: 'select', title: 'Which file should I change?' });
    person.with({ kind: 'select', value: 'hero.css' });
    expect(await choosing).toBe('hero.css');

    const confirming = host.confirm('Overwrite it?', 'There is already a file there.');
    person.with({ kind: 'confirm', value: true });
    expect(await confirming).toBe(true);

    const typing = host.input('What should it say?', 'a heading');
    expect(person.asked[2]).toMatchObject({ kind: 'input', placeholder: 'a heading' });
    person.with({ kind: 'input', value: 'the new heading' });
    expect(await typing).toBe('the new heading');

    const editing = host.editor('Rewrite the paragraph', 'The old one.');
    expect(person.asked[3]).toMatchObject({ kind: 'editor', prefill: 'The old one.' });
    person.with({ kind: 'editor', value: 'A better one.' });
    expect(await editing).toBe('A better one.');
  });

  it('reads an unanswered select as nothing chosen, and an unanswered confirm as no', async () => {
    const person = personAtTheWindow();
    const host = dialogsOver(person.ask);

    const choosing = host.select('Which one?', ['one', 'two']);
    person.with({ kind: 'select', value: null });
    expect(await choosing).toBeUndefined();

    // A confirmation nobody answered is a no: Pi's contract has no third answer,
    // and a yes nobody gave is the failure this host exists to stop.
    const never = host.confirm('Go ahead?', 'It cannot be undone.');
    person.with({ kind: 'confirm', value: false });
    expect(await never).toBe(false);

    const typing = host.input('What should it say?');
    person.with({ kind: 'input', value: null });
    expect(await typing).toBeUndefined();
  });

  it('answers the parts of the contract it cannot draw with silent fallbacks', async () => {
    const terminal = unsupportedTerminal();

    expect(terminal).toEqual({ fail: expect.any(Function), theme: expect.any(Function) });
    expect(() => terminal.theme()).toThrow(/terminal/);
    await expect(terminal.fail('setWidget')).rejects.toThrow(/terminal/);
  });
});

/* -------------------------------------------------------------------------- */

describe('T38: a handler that will not stop answering', () => {
  /** A runner shaped like Pi's, holding one add-on with one handler per event. */
  type Hook = (...args: never[]) => unknown;
  function runnerWith(
    handlers: Record<string, Hook>,
    path = '/addons/slow-one/index.mjs',
  ): { extensions: { path: string; handlers: Map<string, Hook[]> }[] } {
    return {
      extensions: [
        { path, handlers: new Map(Object.entries(handlers).map(([event, handler]) => [event, [handler]])) },
      ],
    };
  }

  it('lets the event go on, and says which add-on overran', async () => {
    const never = (): Promise<unknown> => deferred<unknown>().promise;
    const overruns: Overrun[] = [];
    const runner = withHookBudget(runnerWith({ agent_end: never }), (one) => overruns.push(one), 20);

    const answered = await runner.extensions[0]?.handlers.get('agent_end')?.[0]?.();

    // No opinion from a handler that ran out of time: the event moved on rather
    // than the shell waiting for it.
    expect(answered).toBeUndefined();
    expect(overruns).toHaveLength(1);
    expect(overruns[0]).toMatchObject({
      extension: 'slow-one',
      event: 'agent_end',
      abandoned: true,
      stopped: false,
    });
    expect(recentOverruns()[0]?.extension).toBe('slow-one');
    expect(hookStillRunning('slow-one', 'agent_end')).toBe(true);
  });

  it('does not run that handler again while the last run is still going', async () => {
    let calls = 0;
    const held = deferred<unknown>();
    const slow = (): Promise<unknown> => {
      calls += 1;
      return held.promise;
    };
    const runner = withHookBudget(runnerWith({ agent_end: slow }), () => undefined, 20);
    const handler = runner.extensions[0]?.handlers.get('agent_end')?.[0];

    await handler?.();
    expect(calls).toBe(1);
    // Its state is not ours to hand to another run yet, so it is not handed on.
    expect(await handler?.()).toBeUndefined();
    expect(calls).toBe(1);

    held.settle(undefined);
    await flush();
    await handler?.();
    expect(calls).toBe(2);
  });

  it('keeps one overrun from silencing the same add-on’s next handler', async () => {
    let calls = 0;
    const overruns: Overrun[] = [];
    const runner = withHookBudget(
      {
        extensions: [
          {
            path: '/addons/pair/index.mjs',
            handlers: new Map<string, Hook[]>([
              [
                'agent_end',
                [
                  (() => {
                    calls += 1;
                    return deferred<unknown>().promise;
                  }),
                  (() => {
                    calls += 1;
                    return 'fine';
                  }),
                ],
              ],
            ]),
          },
        ],
      },
      (one) => overruns.push(one),
      20,
    );
    const both = runner.extensions[0]?.handlers.get('agent_end') ?? [];

    expect(await both[0]?.()).toBeUndefined();
    expect(await both[1]?.()).toBe('fine');
    expect(calls).toBe(2);
    expect(overruns).toHaveLength(1);
  });

  it('wraps a handler registered late, so a hook cannot arrive unbudgeted', async () => {
    const overruns: Overrun[] = [];
    const runner = withHookBudget(runnerWith({}, '/addons/late-register/index.mjs'), (one) => overruns.push(one), 20);
    const handlers = runner.extensions[0]?.handlers;
    handlers?.set('agent_end', [(() => deferred<unknown>().promise)]);

    expect(await handlers?.get('agent_end')?.[0]?.()).toBeUndefined();
    expect(overruns.map((one) => one.extension)).toEqual(['late-register']);
  });
});

/* -------------------------------------------------------------------------- */

describe('T39: a hook that was let go of finishes afterwards', () => {
  it('clears the record when it stops, and hands its answer to nobody', async () => {
    const held = deferred<unknown>();
    const overruns: Overrun[] = [];
    const runner = withHookBudget(
      {
        extensions: [
          { path: '/addons/late-one/index.mjs', handlers: new Map([['agent_end', [(() => held.promise)]]]) },
        ],
      },
      (one) => overruns.push(one),
      20,
    );
    const handler = runner.extensions[0]?.handlers.get('agent_end')?.[0];

    expect(await handler?.()).toBeUndefined();
    expect(hookStillRunning('late-one', 'agent_end')).toBe(true);

    // The work finishes long after the event has gone. Nothing from it is
    // returned to anybody, and the record is cleared so the next event may run
    // the handler again.
    held.settle('what it would have said');
    await flush();
    expect(hookStillRunning('late-one', 'agent_end')).toBe(false);
    expect(overruns).toHaveLength(1);
    expect(overruns[0]?.stopped).toBe(true);
  });

  it('says a handler may still be running rather than that it stopped', async () => {
    const overs: Overrun[] = [];
    const runner = withHookBudget(
      {
        extensions: [
          { path: '/addons/stuck/index.mjs', handlers: new Map([['turn_end', [(() => deferred<unknown>().promise)]]]) },
        ],
      },
      (one) => overs.push(one),
      20,
    );
    await runner.extensions[0]?.handlers.get('turn_end')?.[0]?.();

    // The record is what a person is shown, and it says what is true: the
    // handler was let go of and has not stopped.
    expect(overs[0]?.stopped).toBe(false);
    expect(hookStillRunning('stuck', 'turn_end')).toBe(true);
    // A second event for a different hook is unaffected by that one.
    expect(hookStillRunning('stuck', 'agent_settled')).toBe(false);
  });
});
