/** Three widths, and the sentence under them.
 *
 * The arithmetic is the part that has to be right: a page that fits and is told
 * it does not sends somebody looking for a fault they do not have, and the
 * reverse ships a sideways scroll. The rest is language, and a summary that
 * says three pictures came out when one of them did not is worse than silence.
 */

import { describe, expect, it } from 'vitest';

import {
  overflowing,
  readsWell,
  responsive,
  saysOverflow,
  WIDTHS,
  type Look,
} from '../src/design/widths';

function look(name: string, over: Partial<Look> = {}): Look {
  return {
    id: name.toLowerCase(),
    name,
    width: 390,
    shot: 'data:image/png;base64,aaa',
    trouble: null,
    ...over,
  };
}

const trio = (over: readonly Partial<Look>[] = []): Look[] =>
  ['Phone', 'Tablet', 'Desktop'].map((name, at) => look(name, over[at] ?? {}));

/* ========================================================================== */
/* W-01 the three widths                                                       */
/* ========================================================================== */

describe('W-01 the widths themselves', () => {
  it('is three of them, phone to desktop', () => {
    expect(WIDTHS).toHaveLength(3);
    expect(WIDTHS.map((one) => one.id)).toEqual(['phone', 'tablet', 'desktop']);
  });

  it('goes narrow to wide', () => {
    const widths = WIDTHS.map((one) => one.width);
    expect(widths).toEqual([...widths].sort((one, other) => one - other));
  });

  it('is a real size, not a placeholder', () => {
    for (const one of WIDTHS) {
      expect(one.width).toBeGreaterThan(0);
      expect(one.height).toBeGreaterThan(0);
      expect(Number.isInteger(one.width)).toBe(true);
      expect(Number.isInteger(one.height)).toBe(true);
    }
  });

  it('is current, not the hardware of ten years ago', () => {
    expect(WIDTHS[0]?.width).toBeGreaterThanOrEqual(390);
    expect(WIDTHS[2]?.width).toBeGreaterThanOrEqual(1440);
  });

  it('is named the way a designer says it, never after a device', () => {
    for (const one of WIDTHS) {
      expect(one.name).toMatch(/^[A-Z][a-z]+$/);
      expect(one.name).not.toMatch(/\d/);
      expect(one.name).not.toMatch(/iphone|ipad|pixel|galaxy|macbook|pro|air|mini/i);
    }
  });

  it('has a portrait phone and tablet, and a landscape desktop', () => {
    expect(WIDTHS[0]?.height).toBeGreaterThan(WIDTHS[0]?.width ?? 0);
    expect(WIDTHS[1]?.height).toBeGreaterThan(WIDTHS[1]?.width ?? 0);
    expect(WIDTHS[2]?.height).toBeLessThan(WIDTHS[2]?.width ?? 0);
  });
});

/* ========================================================================== */
/* W-02 the summary                                                            */
/* ========================================================================== */

describe('W-02 reading the trio', () => {
  it('says all three are fine, and means it', () => {
    const said = readsWell(trio());
    expect(said.ok).toBe(true);
    expect(said.says).toBe('Looks right on the phone, tablet and desktop.');
  });

  it('says one width in the singular', () => {
    const said = readsWell([look('Phone')]);
    expect(said.ok).toBe(true);
    expect(said.says).toBe('Looks right on the phone.');
  });

  it('says two widths without a stray comma', () => {
    const said = readsWell([look('Phone'), look('Tablet')]);
    expect(said.says).toBe('Looks right on the phone and tablet.');
  });

  it('names the one that did not come out, in the singular', () => {
    const said = readsWell(trio([{}, {}, { shot: null }]));
    expect(said.ok).toBe(false);
    expect(said.says).toBe(
      'Looks right on the phone and tablet. The desktop one didn’t come out.',
    );
  });

  it('names two that did not come out, in the plural', () => {
    const said = readsWell(trio([{}, { shot: null }, { shot: null }]));
    expect(said.ok).toBe(false);
    expect(said.says).toBe(
      'Looks right on the phone. The tablet and desktop ones didn’t come out.',
    );
  });

  it('says so when none of them came out, and claims nothing', () => {
    const said = readsWell(trio([{ shot: null }, { shot: null }, { shot: null }]));
    expect(said.ok).toBe(false);
    expect(said.says).toBe('The phone, tablet and desktop ones didn’t come out.');
    expect(said.says).not.toContain('Looks right');
  });

  it('carries the trouble a width has, after the ones that are fine', () => {
    const said = readsWell(trio([{ trouble: saysOverflow('Phone', 40) }, {}, {}]));
    expect(said.ok).toBe(false);
    expect(said.says).toBe(
      'Looks right on the tablet and desktop. Something on the page is 40px wider than a phone, so it scrolls sideways.',
    );
  });

  it('is not ok when a picture came out with something wrong in it', () => {
    expect(readsWell(trio([{ trouble: 'Something is off.' }, {}, {}])).ok).toBe(false);
  });

  it('gives a trouble a full stop of its own if it arrives without one', () => {
    const said = readsWell(trio([{ trouble: 'The header overlaps the hero' }, {}, {}]));
    expect(said.says).toContain('The header overlaps the hero.');
  });

  it('falls back to the empty state when nothing was photographed', () => {
    const said = readsWell([]);
    expect(said.ok).toBe(false);
    expect(said.says).toBe(responsive.empty);
  });

  it('says both things when one failed and another has trouble', () => {
    const said = readsWell(trio([{ trouble: 'Something is off.' }, {}, { shot: null }]));
    expect(said.says).toBe(
      'Looks right on the tablet. Something is off. The desktop one didn’t come out.',
    );
  });
});

/* ========================================================================== */
/* W-03 the overflow                                                           */
/* ========================================================================== */

describe('W-03 wider than the screen', () => {
  it('is overflowing when the content is wider', () => {
    expect(overflowing(390, 430)).toBe(true);
  });

  it('is not overflowing when the content fits', () => {
    expect(overflowing(390, 320)).toBe(false);
  });

  it('is not overflowing at exactly the same width', () => {
    expect(overflowing(390, 390)).toBe(false);
  });

  it('is not overflowing one pixel under, and is one pixel over', () => {
    expect(overflowing(390, 389)).toBe(false);
    expect(overflowing(390, 391)).toBe(true);
  });

  it('says nothing about a screen of no width, or a number that is not one', () => {
    expect(overflowing(0, 100)).toBe(false);
    expect(overflowing(-390, 100)).toBe(false);
    expect(overflowing(Number.NaN, 100)).toBe(false);
    expect(overflowing(390, Number.NaN)).toBe(false);
    expect(overflowing(390, Number.POSITIVE_INFINITY)).toBe(false);
  });

  it('holds for each of the three widths', () => {
    for (const one of WIDTHS) {
      expect(overflowing(one.width, one.width)).toBe(false);
      expect(overflowing(one.width, one.width + 1)).toBe(true);
    }
  });

  it('says how much wider, with the number', () => {
    expect(saysOverflow('Phone', 40)).toBe(
      'Something on the page is 40px wider than a phone, so it scrolls sideways.',
    );
  });

  it('rounds a measured overhang rather than showing its decimals', () => {
    expect(saysOverflow('Phone', 39.6)).toContain('40px');
    expect(saysOverflow('Tablet', 12.2)).toContain('12px');
  });

  it('never says a negative overhang', () => {
    expect(saysOverflow('Phone', -8)).toContain('0px');
  });

  it('says the width the way a designer does, with the right article', () => {
    expect(saysOverflow('Tablet', 20)).toContain('than a tablet');
    expect(saysOverflow('Desktop', 20)).toContain('than a desktop');
    expect(saysOverflow('Ultrawide', 20)).toContain('than an ultrawide');
  });

  it('pairs with the arithmetic that produced it', () => {
    const phone = WIDTHS[0];
    const content = (phone?.width ?? 0) + 40;
    expect(overflowing(phone?.width ?? 0, content)).toBe(true);
    expect(saysOverflow(phone?.name ?? '', content - (phone?.width ?? 0))).toContain('40px wider');
  });
});

/* ========================================================================== */
/* W-04 the copy                                                               */
/* ========================================================================== */

describe('W-04 the words on the button', () => {
  it('asks the question a designer asks', () => {
    expect(responsive.button).toBe('Does this work on a phone?');
  });

  it('never reaches for the other vocabulary', () => {
    for (const line of Object.values(responsive)) {
      expect(line).not.toMatch(/breakpoint|viewport|responsive|css|media query|device/i);
    }
  });

  it('is a real sentence in every slot', () => {
    for (const line of Object.values(responsive)) {
      expect(line.trim()).not.toBe('');
      expect(line).not.toMatch(/\s{2}/);
    }
  });

  it('offers something to do from the empty state', () => {
    expect(responsive.empty).toMatch(/three widths/);
  });
});
