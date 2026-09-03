/** A turn an add-on starts is still a turn.
 *
 * Pi lets an extension send a message with `triggerTurn`, which begins a run
 * nobody typed. Nothing translated it, so it was never budgeted, never named
 * and never in "why did it stop". The authority had a path for it and no
 * caller.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { extensionTurnOf } from '../src/agent/pi/events';
import {
  MOST_ROUNDS,
  continuationWords,
  extensionOverBudget,
  freshContinuation,
} from '../src/work/continuation';
import { continuationOwner, type OwnerHooks } from '../electron/continuation-owner';
import { applyEvent } from '../src/lib/thread';

const main = readFileSync(fileURLToPath(new URL('../electron/main.ts', import.meta.url)), 'utf8');
const adapter = readFileSync(
  fileURLToPath(new URL('../src/agent/pi/adapter.ts', import.meta.url)),
  'utf8',
);

const started = (message: unknown): unknown => ({ type: 'message_start', message });

describe('reading an add-on’s own turn out of the stream', () => {
  it('is the message with a customType on it', () => {
    expect(
      extensionTurnOf(started({ role: 'user', customType: 'orchestrating', content: 'carry on' })),
    ).toEqual({ type: 'extension-turn', from: 'orchestrating', text: 'carry on' });
  });

  it('reads the block form the same way', () => {
    expect(
      extensionTurnOf(
        started({
          role: 'user',
          customType: 'orchestrating',
          content: [{ type: 'text', text: 'carry on' }],
        }),
      ),
    ).toEqual({ type: 'extension-turn', from: 'orchestrating', text: 'carry on' });
  });

  it('is null for something a person typed', () => {
    expect(extensionTurnOf(started({ role: 'user', content: 'do it' }))).toBeNull();
  });

  it('is null for a blank customType, which names nobody', () => {
    expect(extensionTurnOf(started({ role: 'user', customType: '', content: 'x' }))).toBeNull();
  });

  it('is null for the model’s own messages and for every other event', () => {
    expect(extensionTurnOf(started({ role: 'assistant', customType: 'x', content: 'x' }))).toBeNull();
    expect(extensionTurnOf({ type: 'message_end', message: { role: 'user' } })).toBeNull();
    expect(extensionTurnOf(null)).toBeNull();
  });
});

describe('what the window does with it', () => {
  it('draws nothing: it is not something anybody said', () => {
    const turns = applyEvent([], { type: 'extension-turn', from: 'orchestrating', text: 'carry on' });
    expect(turns).toEqual([]);
  });
});

describe('one inside a turn somebody asked for is part of that turn', () => {
  it('is dropped while a prompt is in flight', () => {
    expect(adapter).toContain(
      "if (event.type === 'extension-turn' && activePrompts > 0) return;",
    );
  });
});

describe('the shell hands it to the authority', () => {
  it('names the add-on that asked', () => {
    expect(main).toContain(
      "continuations.extensionAsked(path, from.address ?? '', said.from, said.text)",
    );
  });
});

function owner(): {
  one: ReturnType<typeof continuationOwner>;
  said: string[];
  halted: string[];
} {
  const said: string[] = [];
  const halted: string[] = [];
  const hooks: OwnerHooks = {
    send: () => undefined,
    say: (_project, _address, text) => said.push(text),
    tell: () => undefined,
    list: () => Promise.resolve(null),
    goal: () => Promise.resolve(null),
    halt: (_project, address) => halted.push(address),
  };
  return { one: continuationOwner(hooks), said, halted };
}

describe('an add-on cannot loop past the budget', () => {
  it('has nothing to say while there is budget left', () => {
    expect(extensionOverBudget(freshContinuation())).toBeNull();
    expect(extensionOverBudget({ ...freshContinuation(), rounds: MOST_ROUNDS - 1 })).toBeNull();
  });

  it('stops at the budget, saying the same thing every other reason says', () => {
    const over = extensionOverBudget({ ...freshContinuation(), rounds: MOST_ROUNDS });
    expect(over?.said).toBe(continuationWords.spent(MOST_ROUNDS));
    expect(over?.state.stopped).toBe(true);
  });

  /* The turn has already begun by the time this hears about it, so refusing it
     means ending it rather than declining to send. */
  it('ends the run that is going, and says so', async () => {
    const { one, said, halted } = owner();
    for (let round = 0; round < MOST_ROUNDS; round += 1) {
      one.extensionAsked('/work/site', '/a', 'orchestrating', 'carry on');
      await one.settled('/work/site', '/a', 'finished');
    }
    expect(halted).toEqual([]);
    one.extensionAsked('/work/site', '/a', 'orchestrating', 'carry on');
    expect(halted).toEqual(['/a']);
    expect(said.at(-1)).toBe(continuationWords.spent(MOST_ROUNDS));
  });
});
