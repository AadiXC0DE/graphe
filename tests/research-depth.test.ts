/** How far research goes, and what that actually changes. "Deeper" used to be a
 *  stronger adjective in the same sentence; these are the numbers that make it
 *  work somebody could count. */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { MOST_AT_ONCE } from '../src/cost/fleet';
import { MOST_APART } from '../src/agent/pi/tools';
import {
  asResearch,
  chooseDepth,
  chosenDepth,
  DEFAULT_DEPTH,
  DEPTHS,
  howDeep,
  LOOKING_INTO,
  MOST_TOGETHER,
  researchBrief,
  researchWords,
} from '../src/agent/research';

describe('how far it goes', () => {
  it('is three settings, and each one asks for more work than the last', () => {
    expect(DEPTHS.map((one) => one.id)).toEqual(['quick', 'deep', 'exhaustive']);
    for (let at = 1; at < DEPTHS.length; at += 1) {
      const before = DEPTHS[at - 1]!;
      const after = DEPTHS[at]!;
      expect(after.atOnce).toBeGreaterThan(before.atOnce);
      expect(after.sources).toBeGreaterThan(before.sources);
      expect(after.again).toBeGreaterThan(before.again);
    }
  });

  it('starts on the middle one, so nobody has to find it to get it', () => {
    expect(DEFAULT_DEPTH).toBe('deep');
    expect(chosenDepth()).toBe(DEFAULT_DEPTH);
    expect(researchBrief()).toBe(researchBrief(DEFAULT_DEPTH));
    expect(asResearch('Why is the nav slow?')).toContain(researchBrief(DEFAULT_DEPTH));
  });

  it('says its own numbers in the words somebody reads, not just in the brief', () => {
    const spelled: Readonly<Record<number, string>> = { 1: 'once', 2: 'two', 3: 'three', 4: 'four', 6: 'six' };
    for (const one of DEPTHS) {
      const note = one.note.toLowerCase();
      expect(note).toContain(spelled[one.atOnce]);
      expect(note).toContain(spelled[one.sources]);
    }
  });

  it('puts its own numbers in the brief, not a stronger word', () => {
    for (const one of DEPTHS) {
      const brief = researchBrief(one.id);
      expect(brief).toContain(`at least ${String(one.atOnce)} separate things`);
      expect(brief).toContain(`so ${String(one.atOnce)} are working at once`);
      expect(brief).toContain(`${String(one.sources)} that agree, found separately`);
    }
    // The one thing the three settings must never share.
    const briefs = DEPTHS.map((one) => researchBrief(one.id));
    expect(new Set(briefs).size).toBe(DEPTHS.length);
  });

  it('says how many times it goes back out over what is unsettled', () => {
    expect(researchBrief('quick')).toContain('Do that once');
    expect(researchBrief('deep')).toContain('up to 2 times');
    expect(researchBrief('exhaustive')).toContain('up to 3 times');
  });

  it('still sends the question whole, whichever setting is on', () => {
    for (const one of DEPTHS) {
      const sent = asResearch('  Is our type scale actually a scale?  ', one.id);
      expect(sent.startsWith(researchBrief(one.id))).toBe(true);
      expect(sent.endsWith('Is our type scale actually a scale?')).toBe(true);
      expect(asResearch('   ', one.id)).toBe('');
    }
  });

  it('remembers what was chosen, because the row and the send are two moments', () => {
    try {
      chooseDepth('exhaustive');
      expect(chosenDepth()).toBe('exhaustive');
      expect(asResearch('Why?', chosenDepth())).toContain('at least 6 separate things');
    } finally {
      chooseDepth(DEFAULT_DEPTH);
    }
    expect(chosenDepth()).toBe(DEFAULT_DEPTH);
  });

  it('falls back to the middle setting rather than nothing', () => {
    expect(howDeep()).toBe(howDeep(DEFAULT_DEPTH));
    expect(howDeep('quick').atOnce).toBe(2);
  });
});

describe('a split that will actually start', () => {
  /* A fan-out refused on the way out costs the turn and answers nothing, so the
     number asked for is checked against the two ceilings that can refuse it. */
  it('never asks for more helpers than are admitted at once', () => {
    expect(MOST_TOGETHER).toBeLessThan(MOST_AT_ONCE.helper);
    expect(MOST_TOGETHER).toBeLessThanOrEqual(MOST_APART);
    for (const one of DEPTHS) {
      expect(one.atOnce).toBeLessThanOrEqual(MOST_TOGETHER);
    }
  });

  it('tells the run its own ceiling, so it does not ask for what will be turned away', () => {
    for (const one of DEPTHS) {
      expect(researchBrief(one.id)).toContain(
        `Never put more than ${String(MOST_TOGETHER)} out at one time`,
      );
    }
  });

  it('asks for the split first and the helpers together, which is the whole method', () => {
    const brief = researchBrief();
    expect(brief).toMatch(/at the same time rather than one after another/i);
    expect(brief).toMatch(/all of them in the same reply/i);
    expect(brief).toMatch(/a whole question it can answer without the others/i);
  });

  it('tells the helper tool what its own ceiling is', () => {
    const tools = readFileSync(new URL('../src/agent/pi/tools.ts', import.meta.url), 'utf8');
    expect(tools).toContain('At most ${String(MOST_AT_ONCE.helper)} helpers work at once');
  });

  it('leaves every ceiling where it was', () => {
    // Helpers raised 8→20 for 20-card showcase (queued 12, concurrent 8→20 hard cap for demo).
    expect(MOST_AT_ONCE.helper).toBe(20);
    expect(MOST_APART).toBe(8);
  });
});

describe('the control, where the hand already is', () => {
  const panel = readFileSync(new URL('../src/components/HowToWork.tsx', import.meta.url), 'utf8');

  it('lives behind the research choice rather than in a screen somebody has to find', () => {
    expect(panel).toContain("plans === 'research' ? (");
    expect(panel).toContain('DEPTHS.map');
    expect(panel).toContain('chooseDepth(one.id)');
    // Every setting says what it does, in the same shape as the choice above it.
    expect(panel).toContain('{one.note}');
  });

  it('names how far in plain words and only once it has been changed', () => {
    expect(panel).toContain('howFar !== DEFAULT_DEPTH');
    expect(researchWords.howFar).toBe('How far to go');
  });

  it('asks each helper to say what it is looking into', () => {
    expect(LOOKING_INTO).toBe('Looking into:');
    for (const one of DEPTHS) {
      expect(researchBrief(one.id)).toContain(`a line reading "${LOOKING_INTO} "`);
    }
  });
});
