/** The yes has to be recorded and dropped in the right places, or the Guard's
 *  new allowance is either never spent or never cleared.
 *
 *  Source text, not behaviour: the dropped yes when a new request begins; no behavioural test can reach it — it needs a live sitting. */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { Confirmations, createGuardInterceptor, type Decision } from '../src/agent/pi/adapter';
import { EventRelay } from '../src/agent/pi/events';
import { readRules, type Rules } from '../src/agent/hooks';
import type { GuardFacts } from '../src/agent/guard/policy';
import type { ToolCall } from '../src/agent/types';

const adapter = readFileSync(
  fileURLToPath(new URL('../src/agent/pi/adapter.ts', import.meta.url)),
  'utf8',
);

const ROOT = '/Users/mira/Projects/portfolio';
const SCREEN: ToolCall = { id: 'call-1', name: 'browser_click', input: { what: 'Sign in' } };

/** The project's own line: a word before anything at all. */
const HOUSE = readRules(
  JSON.stringify({
    rules: [
      {
        name: 'Ask me first',
        when: 'before',
        it: 'anything',
        then: 'ask',
        because: 'This project wants a word before anything happens.',
      },
    ],
  }),
);

/** The interceptor writes the yes into the facts it was handed, and those belong
 *  to the caller — which is the only place a test can watch it from. */
function wired(
  over: { howFar?: GuardFacts['howFar']; rules?: Rules; decision?: Decision } = {},
): { facts: GuardFacts; asked: string[]; review: (call: ToolCall) => Promise<unknown> } {
  const facts: GuardFacts = {
    projectRoot: ROOT,
    ...(over.howFar === undefined ? {} : { howFar: over.howFar }),
  };
  const confirmations = new Confirmations();
  const asked: string[] = [];
  const relay = new EventRelay((event) => {
    if (event.type !== 'needs-confirmation') return;
    asked.push(event.call.id);
    // Answered once the Guard is waiting: the card is announced a line before
    // `ask` registers it, and a microtask lands after that frame.
    queueMicrotask(() => confirmations.answer(event.call.id, over.decision ?? 'yes'));
  });
  const review = createGuardInterceptor({
    facts,
    relay,
    confirmations,
    ...(over.rules === undefined ? {} : { rules: (): Rules => over.rules as Rules }),
  });
  return { facts, asked, review };
}

describe('where the yes is written and where it is forgotten', () => {
  it('is not recorded from the house-rule question, which asks something else', async () => {
    // The top rung, where the only thing that can ask about a screen is the
    // project's own rule — a different question from the Guard's.
    const house = wired({ howFar: 'doing', rules: HOUSE });
    await house.review(SCREEN);

    expect(house.asked).toHaveLength(1);
    expect(house.facts.screenSaidYes).toBeUndefined();
  });

  it('is set only after the person actually said yes', async () => {
    const yes = wired();
    await yes.review(SCREEN);
    expect(yes.asked).toHaveLength(1);
    expect(yes.facts.screenSaidYes).toBe(true);

    // After the refusal branch, so a no never records a yes.
    const no = wired({ decision: 'no' });
    await no.review(SCREEN);
    expect(no.facts.screenSaidYes).toBeUndefined();
  });

  it('is dropped when a new request starts, not carried between them', () => {
    expect(adapter).toContain('if (activePrompts === 0) facts.screenSaidYes = false;');
  });

  it('is not cleared by a follow-up landing mid-run', () => {
    const at = adapter.indexOf('facts.screenSaidYes = false');
    const line = adapter.slice(adapter.lastIndexOf('\n', at) + 1, at + 60);
    expect(line).toContain('activePrompts === 0');
  });
});
