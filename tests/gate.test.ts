/** The picture that stops the work.
 *
 * Two failures matter here and they pull in opposite directions. A change that
 * should have been stopped and was not is the whole feature missing: somebody
 * agreed to a page they never saw. A change stopped for a reflowed paragraph is
 * worse than that, because two or three of those and the gate gets switched
 * off — so the line is tested from both sides, and so is every case where there
 * is nothing to compare against.
 *
 * The third failure is quieter and would be the worst: a width that could not
 * be photographed counted as a pass, or recorded as the picture the next change
 * is measured against. Both are tested for by name.
 */

import { describe, expect, it } from 'vitest';

import {
  gateOf,
  gateWords,
  HOW_MUCH,
  howMuchBy,
  nextAccepted,
  readChange,
  saysHowMuch,
  saysMoved,
  USUAL,
  type Change,
  type HowMuch,
} from '../src/design/gate';

/* -------------------------------------------------------------------------- */
/* Widths, without a camera                                                    */
/* -------------------------------------------------------------------------- */

const SIZES: Readonly<Record<string, { name: string; width: number; pixels: number }>> = {
  phone: { name: 'Phone', width: 390, pixels: 390 * 844 },
  tablet: { name: 'Tablet', width: 834, pixels: 834 * 1194 },
  desktop: { name: 'Desktop', width: 1440, pixels: 1440 * 900 },
};

/** A width whose picture differs from the agreed one by `moved` of itself.
 *  `bands` is that share again, per strip, when the change is somewhere in
 *  particular rather than everywhere. */
function compared(id: string, moved: number, bands?: readonly number[]): Change {
  const size = SIZES[id] ?? { name: id, width: 0, pixels: 1_000_000 };
  return {
    kind: 'compared',
    id,
    name: size.name,
    width: size.width,
    changed: Math.round(size.pixels * moved),
    pixels: size.pixels,
    ...(bands === undefined
      ? {}
      : { bands: bands.map((share) => Math.round((size.pixels / bands.length) * share)) }),
  };
}

function first(id: string): Change {
  const size = SIZES[id] ?? { name: id, width: 0, pixels: 0 };
  return { kind: 'first', id, name: size.name, width: size.width };
}

function nopicture(id: string, why: string | null = null): Change {
  const size = SIZES[id] ?? { name: id, width: 0, pixels: 0 };
  return { kind: 'nopicture', id, name: size.name, width: size.width, why };
}

const WONT_BUILD = 'A project that won’t build is the usual reason.';

/* -------------------------------------------------------------------------- */

describe('G-01 where the line sits', () => {
  it('lets a small change through without asking anybody', () => {
    // WHY: the gate is on all the time. Anything that stops on a nudge is a
    // gate somebody turns off, and then nothing is checked at all.
    const verdict = gateOf([compared('desktop', 0.02)]);
    expect(verdict.standing).toBe('clear');
    expect(verdict.stops).toBe(false);
    expect(verdict.asks).toBe(false);
    expect(verdict.says).toBe(gateWords.clear);
  });

  it('stops a change that has moved a tenth of the page', () => {
    const verdict = gateOf([compared('desktop', 0.18)]);
    expect(verdict.stops).toBe(true);
    expect(verdict.standing).toBe('stopped');
    expect(verdict.says).toContain('desktop');
    expect(verdict.says).toContain(gateWords.held);
  });

  it('stops a change sitting exactly on the line rather than a hair past it', () => {
    // WHY: a line somebody set to a tenth means a tenth. Reading it as "more
    // than a tenth" makes the number in front of them not quite the number.
    const on = gateOf([compared('desktop', USUAL.moved)]);
    const under = gateOf([compared('desktop', USUAL.moved - 0.01)]);
    expect(on.stops).toBe(true);
    expect(under.stops).toBe(false);
  });
});

describe('G-02 a strip of the page, not only the total', () => {
  it('stops when one band of the page is nearly all different, however quiet the rest is', () => {
    // WHY: a component that vanished from a long page is a few per cent of it.
    // The total alone would wave that through, which is the change most worth
    // stopping for.
    const gone = compared('desktop', 0.05, [0, 0, 0, 0.42, 0, 0, 0, 0]);
    expect(gateOf([gone]).stops).toBe(true);
    expect(readChange(gone)?.moved).toBeLessThan(USUAL.moved);
  });

  it('lets the same amount of change through when it is spread thinly everywhere', () => {
    // WHY: text reflowing touches every strip a little. That is a page working,
    // not a page broken, and it must read differently from a block that moved.
    const reflow = compared('desktop', 0.05, [0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05]);
    expect(gateOf([reflow]).stops).toBe(false);
  });

  it('says the band, not the total, when the band is what stopped it', () => {
    const gone = compared('desktop', 0.05, [0, 0, 0, 0.42, 0, 0, 0, 0]);
    const reading = readChange(gone);
    expect(reading?.says).toContain('band');
    expect(reading?.says).not.toContain('5%');
  });
});

describe('G-03 when there is nothing to compare against', () => {
  it('never blocks a first look, and says plainly that the mark is being set', () => {
    // WHY: a first run with no baseline must be neither a silent pass nor a
    // block for something nobody could have got wrong.
    const verdict = gateOf([first('phone'), first('tablet'), first('desktop')]);
    expect(verdict.stops).toBe(false);
    expect(verdict.asks).toBe(true);
    expect(verdict.standing).toBe('first');
    expect(verdict.says).toBe(gateWords.first);
  });

  it('never counts a width that failed to photograph as a width that passed', () => {
    // WHY: the quiet failure. Two clear widths and one blank one is not "all
    // clear", and somebody is about to say yes on the strength of it.
    const verdict = gateOf([compared('phone', 0.01), compared('tablet', 0.01), nopicture('desktop')]);
    expect(verdict.standing).toBe('unchecked');
    expect(verdict.asks).toBe(true);
    expect(verdict.stops).toBe(false);
    expect(verdict.unchecked.map((one) => one.id)).toEqual(['desktop']);
    expect(verdict.says).toContain('desktop');
  });

  it('gives the reason once when a project that will not build lost every width', () => {
    const verdict = gateOf([
      nopicture('phone', WONT_BUILD),
      nopicture('tablet', WONT_BUILD),
      nopicture('desktop', WONT_BUILD),
    ]);
    expect(verdict.says).toContain(WONT_BUILD);
    expect(verdict.says.indexOf(WONT_BUILD)).toBe(verdict.says.lastIndexOf(WONT_BUILD));
    expect(verdict.stops).toBe(false);
  });

  it('holds a real change even when another width could not be photographed', () => {
    // WHY: a missing picture must not become a way past the gate.
    const verdict = gateOf([compared('phone', 0.4), nopicture('desktop', WONT_BUILD)]);
    expect(verdict.stops).toBe(true);
  });
});

describe('G-04 one width is enough', () => {
  it('stops on the phone alone when every wider size is fine', () => {
    // WHY: the change that only breaks the phone is the one a desktop screen
    // never shows, and the reason the pictures are taken at three sizes at all.
    const verdict = gateOf([compared('phone', 0.5), compared('desktop', 0.01)]);
    expect(verdict.stops).toBe(true);
    expect(verdict.says).toContain('phone');
    expect(verdict.says).not.toContain('desktop');
  });

  it('opens on the width that moved furthest, not the widest or the first', () => {
    const verdict = gateOf([compared('desktop', 0.14), compared('phone', 0.6)]);
    expect(verdict.open).toBe('phone');
  });
});

describe('G-05 moving the mark', () => {
  it('moves nothing when the work is set aside', () => {
    // WHY: setting aside must leave the project — and what it is measured
    // against — exactly as it was, or the next change is compared to something
    // nobody agreed to.
    expect(nextAccepted([compared('phone', 0.4), first('desktop')], false)).toEqual([]);
  });

  it('never records a width that has no picture as the one to measure against', () => {
    // WHY: storing "nothing" as the agreed picture makes the next change look
    // like a total rewrite, and the gate then fires on everything forever.
    const moved = nextAccepted(
      [compared('phone', 0.4), first('tablet'), nopicture('desktop', WONT_BUILD)],
      true,
    );
    expect(moved).toEqual(['phone', 'tablet']);
  });
});

describe('G-06 how much counts is somebody’s to change', () => {
  const tight = HOW_MUCH.find((one) => one.id === 'any') as HowMuch;
  const loose = HOW_MUCH.find((one) => one.id === 'big') as HowMuch;

  it('stops on a nudge when somebody has asked for anything to stop it', () => {
    const change = compared('desktop', 0.03);
    expect(gateOf([change], tight).stops).toBe(true);
    expect(gateOf([change], USUAL).stops).toBe(false);
  });

  it('lets a real change through when somebody has asked for only big ones', () => {
    const change = compared('desktop', 0.15);
    expect(gateOf([change], USUAL).stops).toBe(true);
    expect(gateOf([change], loose).stops).toBe(false);
  });

  it('falls back to the middle one for a choice nobody recognises', () => {
    expect(howMuchBy('nonsense')).toEqual(USUAL);
    expect(howMuchBy(null)).toEqual(USUAL);
    expect(howMuchBy('big')).toEqual(loose);
  });

  it('says where the line sits in real numbers', () => {
    // WHY: the designer reads the phrase, the developer reads the number, and
    // both are looking at the same control.
    expect(saysHowMuch(USUAL)).toContain('10%');
    expect(saysHowMuch(USUAL)).toContain('35%');
  });
});

describe('G-07 the sentence carries the real number', () => {
  it('gives the share as a percentage somebody can act on', () => {
    expect(saysMoved('Phone', 0.38)).toContain('38%');
    expect(saysMoved('Phone', 0.38)).toContain('phone');
  });

  it('never rounds a change that happened down to nothing', () => {
    // WHY: "0% of the picture is different" under a picture that is different
    // is the one sentence that would make nobody trust any of the others.
    expect(saysMoved('Phone', 0.004)).toContain('less than 1%');
    expect(saysMoved('Phone', 0.004)).not.toContain('0%');
  });
});

describe('G-08 nonsense in', () => {
  it('reads nothing from a comparison that counted no pixels', () => {
    expect(
      readChange({ kind: 'compared', id: 'phone', name: 'Phone', width: 390, changed: 10, pixels: 0 }),
    ).toBeNull();
  });

  it('treats a comparison that came back with nothing as unchecked, never as clear', () => {
    // WHY: the same quiet failure as a missing picture, arriving by a different
    // door — a count of zero pixels is not evidence that nothing moved.
    const verdict = gateOf([
      { kind: 'compared', id: 'phone', name: 'Phone', width: 390, changed: 10, pixels: 0 },
    ]);
    expect(verdict.standing).toBe('unchecked');
    expect(verdict.stops).toBe(false);
  });

  it('treats a count that is not a number as unchecked rather than as no change', () => {
    // WHY: a broken count reading as zero is the silent pass again — a page
    // that was never measured would report as a page that did not move.
    const verdict = gateOf([
      {
        kind: 'compared',
        id: 'phone',
        name: 'Phone',
        width: 390,
        changed: Number.NaN,
        pixels: SIZES['phone']?.pixels ?? 1,
      },
    ]);
    expect(verdict.standing).toBe('unchecked');
    expect(verdict.stops).toBe(false);
  });

  it('answers an empty set without inventing a problem', () => {
    const verdict = gateOf([]);
    expect(verdict.standing).toBe('clear');
    expect(verdict.open).toBeNull();
    expect(verdict.readings).toEqual([]);
  });

  it('eventually stops cumulative sub-threshold drift against one human baseline', () => {
    const pixels = SIZES['desktop']?.pixels ?? 1;
    const standings = [0.02, 0.04, 0.06, 0.08, 0.11].map((share) =>
      gateOf([
        {
          kind: 'compared' as const,
          id: 'desktop',
          name: 'Desktop',
          width: 1440,
          changed: pixels * share,
          pixels,
        },
      ]).standing,
    );
    // Auto-clear does not rebase, so each comparison remains against the same
    // person-approved picture and the fifth small move crosses the 10% line.
    expect(standings).toEqual(['clear', 'clear', 'clear', 'clear', 'stopped']);
  });
});
