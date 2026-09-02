/** How much of an add-on runs, per session.
 *
 * The rule is small enough to state in a sentence and important enough that
 * every combination of it is written out below: an add-on that starts work of
 * its own is a second thing deciding when work continues, and where Graphe is
 * driving there can only be one.
 */

import { describe, expect, it } from 'vitest';

import { cardFrom, type CapabilityCard, type Recorded } from '../src/agent/pi/extension-probe';
import {
  dropsEntirely,
  dropsLifecycleHooks,
  policyFor,
  policyWords,
  saysPolicy,
  type Policy,
  type SessionKind,
} from '../src/agent/pi/extension-policy';

function recorded(some: Partial<Recorded>): Recorded {
  return {
    id: 'an-add-on',
    hooks: [],
    tools: [],
    commands: [],
    sentTurns: false,
    source: '',
    ...some,
  };
}

/** Tools and nothing else. */
const quiet: CapabilityCard = cardFrom(
  recorded({ tools: [{ name: 'count_words', description: 'Count the words in a file.' }] }),
);

/** Takes the end of a turn and asks for another one. */
const drives: CapabilityCard = cardFrom(
  recorded({ hooks: ['agent_end'], sentTurns: true, source: 'triggerTurn' }),
);

const SESSIONS: readonly SessionKind[] = ['conversation', 'board', 'helper', 'canvas'];
const CHOICES: readonly Policy[] = ['on', 'tools-only', 'off'];

describe('an add-on that only adds tools', () => {
  it('runs whole, everywhere — nobody has to find a switch to get their tools', () => {
    for (const session of SESSIONS) expect(policyFor(quiet, session)).toBe('on');
  });
});

describe('an add-on that starts work of its own', () => {
  it('keeps its tools in a conversation, where somebody is watching every turn', () => {
    expect(policyFor(drives, 'conversation')).toBe('tools-only');
  });

  it('stands down entirely wherever Graphe is driving', () => {
    expect(policyFor(drives, 'board')).toBe('off');
    expect(policyFor(drives, 'helper')).toBe('off');
    expect(policyFor(drives, 'canvas')).toBe('off');
  });
});

describe('an add-on nothing could be read out of', () => {
  it('is treated as one that drives, because it is the one we know least about', () => {
    expect(policyFor(null, 'conversation')).toBe('tools-only');
    for (const session of SESSIONS.filter((one) => one !== 'conversation')) {
      expect(policyFor(null, session)).toBe('off');
    }
  });
});

describe('what somebody chose for this conversation', () => {
  it('beats every default, whatever the card and wherever it is', () => {
    for (const card of [quiet, drives, null]) {
      for (const session of SESSIONS) {
        for (const chosen of CHOICES) {
          expect(policyFor(card, session, chosen)).toBe(chosen);
        }
      }
    }
  });

  it('leaves the default standing when nothing was chosen', () => {
    for (const card of [quiet, drives, null]) {
      for (const session of SESSIONS) {
        expect(policyFor(card, session, undefined)).toBe(policyFor(card, session));
      }
    }
  });
});

describe('what a setting asks the loader to do', () => {
  it('attaches lifecycle handlers only when the whole add-on is running', () => {
    expect(dropsLifecycleHooks('on')).toBe(false);
    expect(dropsLifecycleHooks('tools-only')).toBe(true);
    // Safe either way round: a loader that asks only this question still gets
    // the answer that cannot hijack a turn.
    expect(dropsLifecycleHooks('off')).toBe(true);
  });

  it('leaves the add-on out altogether only when it is off', () => {
    expect(dropsEntirely('off')).toBe(true);
    expect(dropsEntirely('tools-only')).toBe(false);
    expect(dropsEntirely('on')).toBe(false);
  });

  it('never leaves an add-on both loaded and free to drive where Graphe drives', () => {
    for (const session of SESSIONS.filter((one) => one !== 'conversation')) {
      const policy = policyFor(drives, session);
      expect(dropsEntirely(policy) || dropsLifecycleHooks(policy)).toBe(true);
    }
  });
});

describe('the words', () => {
  it('names what the switch does rather than how it does it', () => {
    expect(policyWords.label).toBe('Add-ons that start work on their own');
    const everything = [
      policyWords.label,
      policyWords.note,
      policyWords.on,
      policyWords.toolsOnly,
      policyWords.off,
      ...CHOICES.map((one) => saysPolicy(one)),
    ];
    for (const line of everything) {
      expect(line).not.toMatch(/\b(hook|lifecycle|registers?|factory|extension|package|npm|API)\b/i);
      expect(line).not.toContain('!');
    }
  });

  it('says something different for each of the three settings', () => {
    expect(new Set(CHOICES.map((one) => saysPolicy(one))).size).toBe(3);
    for (const one of CHOICES) expect(saysPolicy(one).length).toBeGreaterThan(0);
  });

  it('names no add-on anywhere, so tomorrow’s is judged the same as today’s', () => {
    const source = [policyWords.label, policyWords.note, ...CHOICES.map(saysPolicy)].join(' ');
    expect(source).not.toMatch(/\bpi-[a-z]+\b/i);
  });
});
