/** Cards for the conversations that have a copy of the project.
 *
 * The two things worth holding to: which of the five states one copy is in —
 * the precedence matters, because a question outranks a folder — and the order
 * they come out in, because a card that needs a person and sorts fourth is a
 * card nobody presses.
 */

import { describe, expect, it } from 'vitest';

import {
  canLand,
  cardsFrom,
  needingYou,
  saysCard,
  stateOf,
  workspaceWords,
  type WorkspaceFacts,
} from '../src/work/workspaces';

const NOW = new Date(2026, 7, 12, 15, 30).getTime();
const MINUTE = 60 * 1000;

function facts(over: Partial<WorkspaceFacts> = {}): WorkspaceFacts {
  return {
    address: 'a1',
    title: 'Make the header sticky',
    branch: 'graphe/sticky-header',
    base: 'main',
    changed: 2,
    added: 30,
    removed: 4,
    lastAt: NOW - MINUTE,
    cost: null,
    run: 'settled',
    landed: false,
    away: false,
    holdsWork: false,
    ...over,
  };
}

/* ========================================================================== */
/* W-01a which of the five                                                     */
/* ========================================================================== */

describe('W-01a which state a copy is in', () => {
  it('is working while the conversation is going', () => {
    expect(stateOf(facts({ run: 'running' }))).toBe('working');
  });

  it('is ready to review once it has settled with something to show', () => {
    expect(stateOf(facts())).toBe('ready to review');
  });

  it('is working, not ready to review, when nothing changed', () => {
    expect(stateOf(facts({ changed: 0 }))).toBe('working');
  });

  it('is put away when the folder was given back', () => {
    expect(stateOf(facts({ away: true }))).toBe('put away');
  });

  it('is landed whatever else is true of it', () => {
    expect(stateOf(facts({ landed: true, run: 'asking', away: true }))).toBe('landed');
  });

  it('says needs you even when the copy is put away, because the question outlives the folder', () => {
    expect(stateOf(facts({ run: 'asking', away: true }))).toBe('needs you');
  });
});

/* ========================================================================== */
/* W-01b the order                                                             */
/* ========================================================================== */

describe('W-01b the order the cards are drawn in', () => {
  const cards = cardsFrom([
    facts({ address: 'landed', landed: true, lastAt: NOW }),
    facts({ address: 'working', run: 'running', lastAt: NOW }),
    facts({ address: 'away', away: true, lastAt: NOW }),
    facts({ address: 'ready', lastAt: NOW }),
    facts({ address: 'asking', run: 'asking', lastAt: NOW }),
  ]);

  it('puts the one that needs a person first and the landed one last', () => {
    expect(cards.map((one) => one.address)).toEqual([
      'asking',
      'ready',
      'working',
      'away',
      'landed',
    ]);
  });

  it('sorts the ones in the same state newest first', () => {
    const same = cardsFrom([
      facts({ address: 'old', run: 'running', lastAt: NOW - 10 * MINUTE }),
      facts({ address: 'new', run: 'running', lastAt: NOW }),
      facts({ address: 'middle', run: 'running', lastAt: NOW - 5 * MINUTE }),
    ]);
    expect(same.map((one) => one.address)).toEqual(['new', 'middle', 'old']);
  });

  it('leaves the facts it was given alone', () => {
    const given = [facts({ address: 'b', lastAt: NOW - MINUTE }), facts({ address: 'a', lastAt: NOW })];
    cardsFrom(given);
    expect(given.map((one) => one.address)).toEqual(['b', 'a']);
  });

  it('counts the ones asking for a person, and not the ones that are not', () => {
    expect(needingYou(cards)).toBe(2);
    expect(needingYou([])).toBe(0);
  });
});

/* ========================================================================== */
/* W-01c what the card says                                                    */
/* ========================================================================== */

describe('W-01c what one card says', () => {
  it('leads with the conversation’s title', () => {
    expect(saysCard(cardsFrom([facts()])[0]!).head).toBe('Make the header sticky');
  });

  it('falls back to the branch when there is no title, because that is still a name', () => {
    expect(saysCard(cardsFrom([facts({ title: '  ' })])[0]!).head).toBe('graphe/sticky-header');
  });

  it('says the state, the tally and what it is measured against', () => {
    const sub = saysCard(cardsFrom([facts()])[0]!).sub;
    expect(sub).toContain('Ready to review');
    expect(sub).toContain('2 files');
    expect(sub).toContain('+30 −4');
    expect(sub).toContain('from main');
  });

  it('says nothing changed rather than showing a tally of zero', () => {
    const sub = saysCard(cardsFrom([facts({ changed: 0, added: 0, removed: 0 })])[0]!).sub;
    expect(sub).toContain(workspaceWords.nothingChanged);
    expect(sub).not.toContain('+0');
  });

  it('shows what it came to when there is a cost', () => {
    const sub = saysCard(cardsFrom([facts({ cost: { minor: 120, currency: 'USD' } })])[0]!).sub;
    expect(sub).toMatch(/1\.20/);
  });

  it('says nothing about cost when nothing was spent, or the currency makes no sense', () => {
    expect(saysCard(cardsFrom([facts({ cost: { minor: 0, currency: 'USD' } })])[0]!).sub).not.toMatch(
      /\d\.\d/,
    );
    expect(() =>
      saysCard(cardsFrom([facts({ cost: { minor: 100, currency: 'nonsense' } })])[0]!),
    ).not.toThrow();
  });

  it('warns when the copy holds writing its branch does not', () => {
    const sub = saysCard(cardsFrom([facts({ holdsWork: true })])[0]!).sub;
    expect(sub).toContain(workspaceWords.holds);
  });
});

/* ========================================================================== */
/* W-01d landing                                                               */
/* ========================================================================== */

describe('W-01d which cards can be landed', () => {
  it('offers landing on a card with changes', () => {
    expect(canLand(cardsFrom([facts()])[0]!)).toBe(true);
  });

  it('does not offer landing twice', () => {
    expect(canLand(cardsFrom([facts({ landed: true })])[0]!)).toBe(false);
  });

  it('does not offer landing on a copy that changed nothing', () => {
    expect(canLand(cardsFrom([facts({ changed: 0 })])[0]!)).toBe(false);
  });
});
