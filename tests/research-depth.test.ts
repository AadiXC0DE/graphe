// @vitest-environment jsdom
/** How far research goes, and what that actually changes. "Deeper" used to be a
 *  stronger adjective in the same sentence; these are the numbers that make it
 *  work somebody could count.
 *  Source text, not behaviour: the task tool's own ceiling sentence; no behavioural test can reach it — tools.ts cannot be imported under jsdom. */

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import HowToWork, { type Plans } from '../src/components/HowToWork';
import { HELPER_TOTAL_MAX, MOST_AT_ONCE } from '../src/cost/fleet';
import {
  asResearch,
  chooseDepth,
  chosenDepth,
  DEEPEST_SPLIT,
  DEFAULT_DEPTH,
  DEPTHS,
  howDeep,
  LOOKING_INTO,
  MOST_TOGETHER,
  researchBrief,
  researchWords,
} from '../src/agent/research';
import { capsNow } from '../src/work/capacity';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function close(): void {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
}

/* The three rows only exist once the menu is open, so every test here presses
   the chip first — the way somebody reaches them. */
afterEach(() => {
  close();
  chooseDepth(DEFAULT_DEPTH);
});

function openTheMenu(plans: Plans): HTMLDivElement {
  close();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root?.render(createElement(HowToWork, { plans, onPlans: () => undefined }));
  });
  act(() => host?.querySelector<HTMLButtonElement>('.ways__chip')?.click());
  return host;
}

/** How far to go, as the buttons the menu actually draws. */
function rungs(where: HTMLElement): HTMLButtonElement[] {
  return [...where.querySelectorAll<HTMLButtonElement>('[role="group"] [role="option"]')];
}

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
  /* A fan-out refused on the way out costs the turn and answers nothing, so
     what the ladder asks for is checked against what the machine admits. The
     ladder's own numbers are static — the window cannot read the machine — and
     the fleet does the clamping. */
  it('never asks for more helpers than are admitted at once', () => {
    expect(MOST_TOGETHER).toBeLessThanOrEqual(MOST_AT_ONCE.helper);
    for (const one of DEPTHS) {
      expect(one.atOnce).toBeLessThanOrEqual(DEEPEST_SPLIT);
    }
  });

  /* The ladder is drawn in a window that cannot read the machine, so the rung
     and the brief say one static number and the fleet does the clamping. What
     is not allowed is the two disagreeing with each other. */
  it('says one number on the rung and the same one in the brief', () => {
    for (const one of DEPTHS) {
      expect(researchBrief(one.id)).toContain(
        `Never put more than ${String(DEEPEST_SPLIT)} out at one time`,
      );
      expect(researchBrief(one.id)).toContain(`so ${String(one.atOnce)} are working at once`);
    }
  });

  it('reads the machine for what may actually go out together', () => {
    expect(MOST_TOGETHER).toBe(capsNow().research);
  });

  it('asks for the split first and the helpers together, which is the whole method', () => {
    const brief = researchBrief();
    expect(brief).toMatch(/at the same time rather than one after another/i);
    expect(brief).toMatch(/all of them in the same reply/i);
    expect(brief).toMatch(/a whole question it can answer without the others/i);
  });

  it('tells the helper tool what its own ceiling is', () => {
    // `import.meta.url` is not a file URL under jsdom, so this reads by path.
    const tools = readFileSync('src/agent/pi/tools.ts', 'utf8');
    expect(tools).toContain('At most ${String(MOST_AT_ONCE.helper)} helpers work at once');
  });

  it('keeps the helper ceiling at the one total, and away uncapped', () => {
    // One number, not two: the cap IS the total, so they cannot drift apart.
    // This guards against a future raise sneaking past HELPER_TOTAL_MAX, and
    // against someone re-capping `away` and stalling a second project.
    expect(MOST_AT_ONCE.helper).toBe(HELPER_TOTAL_MAX);
    expect(MOST_AT_ONCE.away).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('the control, where the hand already is', () => {
  it('lives behind the research choice rather than in a screen somebody has to find', () => {
    const where = openTheMenu('research');
    const rows = rungs(where);
    expect(rows).toHaveLength(DEPTHS.length);
    // Every setting says what it does, in the same shape as the choice above it.
    rows.forEach((row, at) => {
      expect(row.textContent).toContain(DEPTHS[at]?.name);
      expect(row.textContent).toContain(DEPTHS[at]?.note);
    });
    // Pressing one is choosing it. No separate screen, no settings page.
    act(() => rows[DEPTHS.length - 1]?.click());
    expect(chosenDepth()).toBe(DEPTHS[DEPTHS.length - 1]?.id);

    // And a conversation that is not researching has no such rows at all.
    expect(rungs(openTheMenu('auto'))).toHaveLength(0);
  });

  it('names how far in plain words and only once it has been changed', () => {
    const where = openTheMenu('research');
    expect(where.querySelector('[role="group"]')?.getAttribute('aria-label')).toBe(
      researchWords.howFar,
    );
    // The chip keeps its own words at the setting nobody had to choose…
    expect(where.querySelector('.ways__label')?.textContent).toBe(researchWords.chip);
    // …and wears the setting itself once somebody has.
    act(() => rungs(where)[DEPTHS.length - 1]?.click());
    expect(where.querySelector('.ways__label')?.textContent).toBe(
      howDeep(DEPTHS[DEPTHS.length - 1]?.id ?? DEFAULT_DEPTH).name,
    );
  });

  it('asks each helper to say what it is looking into', () => {
    expect(LOOKING_INTO).toBe('Looking into:');
    for (const one of DEPTHS) {
      expect(researchBrief(one.id)).toContain(`a line reading "${LOOKING_INTO} "`);
    }
  });
});
