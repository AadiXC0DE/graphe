// @vitest-environment jsdom
/** Moving between lines of work, and the switcher that does it.
 *
 * The failure behind this file is not arithmetic. The control existed, looked
 * live, and did nothing: the callback behind it read which folder was in front
 * without listing it as a dependency, so it closed over the value from the very
 * first render — no folder open — and returned before it did anything. Clicking
 * a name was indistinguishable from a control that had not been built.
 *
 * Most of the rules below are the half that can be tested without a browser:
 * which rows to draw, what each one says about where it stands, and which names
 * to refuse before somebody presses rather than after. The last one draws the
 * pill, because a word written down in a table is not the word on screen.
 */

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import Lines from '../src/components/Lines';
import type { GitBranch } from '../src/lib/ipc';
import { LINE_WORDS, linesMatching, refuseName, saysStanding } from '../src/lib/lines';

function line(over: Partial<GitBranch> & { name: string }): GitBranch {
  return {
    current: false,
    upstream: null,
    ahead: 0,
    behind: 0,
    message: '',
    ...over,
  };
}

const LINES: readonly GitBranch[] = [
  line({ name: 'main', current: true, upstream: 'origin/main', behind: 2, message: 'The preview line' }),
  line({ name: 'pricing-page', upstream: 'origin/pricing-page', ahead: 3, message: 'Pricing table, second pass' }),
  line({ name: 'hero-rework', message: 'One big line for the hero' }),
];

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

const hosts: HTMLElement[] = [];
const roots: Root[] = [];
afterEach(() => {
  act(() => {
    for (const one of roots.splice(0)) one.unmount();
  });
  for (const host of hosts.splice(0)) host.remove();
});

/** The switcher, drawn: what the control says and what opening it offers. */
function switcher(): { pill: string | null; offer: string | null } {
  const host = document.createElement('div');
  document.body.append(host);
  hosts.push(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => {
    root.render(
      createElement(Lines, {
        branches: LINES,
        fallback: 'main',
        onSwitch: () => {},
        onCreate: () => {},
      }),
    );
  });
  const now = host.querySelector<HTMLButtonElement>('.lines__now');
  if (now === null) throw new Error('the switcher is not drawn');
  act(() => {
    now.click();
  });
  return {
    pill: now.getAttribute('aria-label'),
    offer: host.querySelector('.lines__new')?.textContent ?? null,
  };
}

describe('where a line stands', () => {
  it('says nothing when there is nothing worth saying', () => {
    // In step with what it tracks. A row saying "in step" every time is a row
    // nobody reads by the fourth one.
    expect(saysStanding(line({ name: 'x', upstream: 'origin/x' }))).toBeNull();
  });

  it('says when a line has never been shared', () => {
    expect(saysStanding(line({ name: 'x' }))).toBe(LINE_WORDS.notShared);
  });

  it('counts both directions, and both at once', () => {
    expect(saysStanding(line({ name: 'x', upstream: 'origin/x', ahead: 3 }))).toBe('3 ahead');
    expect(saysStanding(line({ name: 'x', upstream: 'origin/x', behind: 2 }))).toBe('2 behind');
    expect(saysStanding(line({ name: 'x', upstream: 'origin/x', ahead: 3, behind: 2 }))).toBe(
      '3 ahead, 2 behind',
    );
  });
});

describe('finding one in a long list', () => {
  it('shows everything before anything is typed', () => {
    expect(linesMatching(LINES, '').length).toBe(3);
    expect(linesMatching(LINES, '   ').length).toBe(3);
  });

  it('matches on the name and on what the line last did', () => {
    expect(linesMatching(LINES, 'pricing').map((one) => one.name)).toEqual(['pricing-page']);
    // "Pricing table, second pass" is the message on the same line; searching
    // what a line is about is the point of showing the message at all.
    expect(linesMatching(LINES, 'second pass').map((one) => one.name)).toEqual(['pricing-page']);
  });

  it('does not care about case', () => {
    expect(linesMatching(LINES, 'HERO').map((one) => one.name)).toEqual(['hero-rework']);
  });

  /** A switcher that hides where you are makes you count the remaining rows to
   *  work out where that is. */
  it('keeps the line you are on in the list', () => {
    expect(linesMatching(LINES, 'main').map((one) => one.name)).toEqual(['main']);
  });

  it('comes back empty rather than pretending, when nothing matches', () => {
    expect(linesMatching(LINES, 'zzz')).toEqual([]);
  });
});

describe('a name the machine would refuse', () => {
  /** Said before the press. A refusal arriving from underneath, after the
   *  window has already closed, reads as the app breaking. */
  it('refuses a name with a space in it', () => {
    expect(refuseName('two words', LINES)).toBe(LINE_WORDS.badName);
  });

  it('refuses a name that starts with a dash', () => {
    expect(refuseName('-force', LINES)).toBe(LINE_WORDS.badName);
  });

  it('refuses a name that is already taken', () => {
    expect(refuseName('main', LINES)).toBe(LINE_WORDS.taken);
    expect(refuseName('  main  ', LINES)).toBe(LINE_WORDS.taken);
  });

  it('says nothing about an empty box, which is not a mistake yet', () => {
    expect(refuseName('', LINES)).toBeNull();
    expect(refuseName('   ', LINES)).toBeNull();
  });

  it('lets an ordinary name through', () => {
    expect(refuseName('pricing-page-2', LINES)).toBeNull();
    expect(refuseName('fix/the-nav', LINES)).toBeNull();
  });
});

describe('the words', () => {
  /** The audience is developers. "Branch" needs no translation, and a gloss
   *  under it reads as a lesson nobody asked for. */
  it('says the real word, without glossing it', () => {
    expect(LINE_WORDS.heading).toBe('Branch');
    expect(Object.values(LINE_WORDS)).not.toContain('the line of work');
  });

  it('names the thing being done, not the machinery doing it', () => {
    for (const said of [LINE_WORDS.newLine, LINE_WORDS.onThisOne, LINE_WORDS.none]) {
      expect(said).not.toMatch(/checkout|HEAD|ref\b/i);
    }
  });

  it('is the word actually shown, not just written down', () => {
    const drawn = switcher();
    // The pill is the control somebody presses, and it says what pressing it
    // does; the panel it opens offers the create row in the same words.
    expect(drawn.pill).toBe(LINE_WORDS.open);
    expect(drawn.offer).toBe(LINE_WORDS.newLine);
  });
});
