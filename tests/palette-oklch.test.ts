/** Colour arithmetic, and the one promise the module makes.
 *
 * The conversions are checked against values that can be worked out by hand, so
 * a transposed matrix row is caught rather than absorbed. The promise is the
 * rest: whatever accent somebody picks, every colour they read clears AA at
 * normal contrast and AAA at high, on every ground it can land on. A theme
 * builder that lets a person make an unreadable app is worse than no builder.
 */

import { describe, expect, it } from 'vitest';

import {
  contrastRatio,
  hexFrom,
  hexOf,
  luminanceOf,
  oklchOf,
  rgbFrom,
  rgbOf,
  surfacesFrom,
  type Base,
  type Contrast,
  type Surfaces,
  type Tone,
} from '../src/design/palette-oklch';

const TONES: readonly Tone[] = ['warm', 'neutral', 'cool'];
const CONTRASTS: readonly Contrast[] = ['normal', 'high'];
const BASES: readonly Base[] = ['light', 'dark'];

/* Every hue a person might reach for, plus the two nobody should: a colour with
   no chroma at all, and one already at the top of the lightness axis. */
const ACCENTS = ['#b8492c', '#e0714d', '#38bdf8', '#f59e0b', '#be123c', '#22c55e', '#7c3aed', '#111111', '#ffffff'];

/* ========================================================================== */
/* CO-01 reading a colour                                                      */
/* ========================================================================== */

describe('CO-01 what counts as a colour', () => {
  it('reads hex in three digits and six', () => {
    expect(rgbFrom('#fff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(rgbFrom('#b8492c')).toEqual({ r: 184, g: 73, b: 44 });
    expect(rgbFrom('B8492C')).toEqual({ r: 184, g: 73, b: 44 });
  });

  it('reads the oklch a stylesheet may already say', () => {
    expect(hexOf(rgbFrom('oklch(1 0 0)') ?? { r: 0, g: 0, b: 0 })).toBe('#ffffff');
    expect(hexOf(rgbFrom('oklch(0% 0 0)') ?? { r: 9, g: 9, b: 9 })).toBe('#000000');
  });

  it('is nothing at all rather than a guess', () => {
    expect(rgbFrom('rebeccapurple')).toBeNull();
    expect(rgbFrom('#12345')).toBeNull();
    expect(rgbFrom('')).toBeNull();
  });
});

/* ========================================================================== */
/* CO-02 the conversions                                                       */
/* ========================================================================== */

describe('CO-02 sRGB to OKLCH and back', () => {
  it('comes back as the colour that went in', () => {
    for (const hex of ACCENTS) {
      expect(hexOf(rgbOf(oklchOf(rgbFrom(hex) ?? { r: 0, g: 0, b: 0 })))).toBe(hex.toLowerCase());
    }
  });

  /* White is L=1 with no chroma and black is L=0. Anything else in the matrix
     and these two drift. */
  it('puts the two ends of the axis where OKLab puts them', () => {
    const white = oklchOf({ r: 255, g: 255, b: 255 });
    expect(white.l).toBeCloseTo(1, 3);
    expect(white.c).toBeCloseTo(0, 3);
    expect(oklchOf({ r: 0, g: 0, b: 0 }).l).toBeCloseTo(0, 3);
  });

  it('keeps a grey grey', () => {
    const grey = oklchOf({ r: 128, g: 128, b: 128 });
    expect(grey.c).toBeCloseTo(0, 3);
    expect(hexFrom({ l: grey.l, c: 0, h: 0 })).toBe('#808080');
  });

  /* Asking for more chroma than sRGB holds gives back the most it does hold, at
     the lightness and hue that were asked for. */
  it('gives up chroma rather than the colour somebody chose', () => {
    const wild = hexFrom({ l: 0.6, c: 0.9, h: 145 });
    const got = oklchOf(rgbFrom(wild) ?? { r: 0, g: 0, b: 0 });
    expect(got.l).toBeCloseTo(0.6, 1);
    expect(got.h).toBeCloseTo(145, 0);
    expect(got.c).toBeLessThan(0.9);
  });
});

/* ========================================================================== */
/* CO-03 contrast                                                              */
/* ========================================================================== */

describe('CO-03 how well a pair reads', () => {
  it('is 21 for the pair nothing beats', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 6);
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 6);
  });

  /* #808080 by hand: 128/255 = 0.501961, linearised ((0.501961+0.055)/1.055)^2.4
     = 0.215861, so white is 1.05/0.265861 = 3.9494 and black 0.265861/0.05 =
     5.3172. The two multiply back to 21, which is the arithmetic checking
     itself. */
  it('measures a mid grey where the formula puts it', () => {
    expect(luminanceOf({ r: 128, g: 128, b: 128 })).toBeCloseTo(0.215861, 5);
    expect(contrastRatio('#808080', '#ffffff')).toBeCloseTo(3.9494, 3);
    expect(contrastRatio('#808080', '#000000')).toBeCloseTo(5.3172, 3);
    expect(contrastRatio('#808080', '#ffffff') * contrastRatio('#808080', '#000000')).toBeCloseTo(21, 6);
  });

  it('is 1 for a colour nobody can read, so nothing passes by accident', () => {
    expect(contrastRatio('nonsense', '#ffffff')).toBe(1);
  });
});

/* ========================================================================== */
/* CO-04 the palette, and the promise                                          */
/* ========================================================================== */

const READABLE = ['text', 'textMuted', 'textFaint', 'accent', 'accentInk', 'danger'] as const;

function grounds(one: Surfaces): readonly string[] {
  return [one.bg, one.bgRaised, one.bgSunken];
}

describe('CO-04 every derived pair can be read', () => {
  it('clears 4.5:1 at normal contrast, whatever the accent', () => {
    for (const base of BASES) {
      for (const tone of TONES) {
        for (const accent of ACCENTS) {
          const made = surfacesFrom(accent, tone, 'normal', base);
          for (const ink of READABLE) {
            for (const ground of grounds(made)) {
              expect(
                contrastRatio(made[ink], ground),
                `${ink} on a ${base} ${tone} ground from ${accent}`,
              ).toBeGreaterThanOrEqual(4.5);
            }
          }
        }
      }
    }
  });

  it('clears 7:1 at high contrast, whatever the accent', () => {
    for (const base of BASES) {
      for (const tone of TONES) {
        for (const accent of ACCENTS) {
          const made = surfacesFrom(accent, tone, 'high', base);
          for (const ink of READABLE) {
            for (const ground of grounds(made)) {
              expect(
                contrastRatio(made[ink], ground),
                `${ink} on a ${base} ${tone} ground from ${accent}`,
              ).toBeGreaterThanOrEqual(7);
            }
          }
        }
      }
    }
  });

  /* The two pairs that are not text on a page: a badge's own colour on its own
     tint, and the label on an accent-coloured button. */
  it('clears the same bar on the accent tint and on the accent itself', () => {
    for (const base of BASES) {
      for (const contrast of CONTRASTS) {
        for (const accent of ACCENTS) {
          const made = surfacesFrom(accent, 'neutral', contrast, base);
          const needs = contrast === 'high' ? 7 : 4.5;
          expect(contrastRatio(made.accentInk, made.accentSoft)).toBeGreaterThanOrEqual(needs);
          expect(contrastRatio(made.text, made.accentSoft)).toBeGreaterThanOrEqual(needs);
          expect(contrastRatio(made.accentText, made.accent)).toBeGreaterThanOrEqual(needs);
        }
      }
    }
  });

  /* WCAG 1.4.11: a control identified by its edge owes 3:1, and the shipped
     themes each carry a comment saying so. */
  it('gives a bare control an edge somebody can see', () => {
    for (const base of BASES) {
      for (const contrast of CONTRASTS) {
        const made = surfacesFrom('#b8492c', 'warm', contrast, base);
        for (const ground of grounds(made)) {
          expect(contrastRatio(made.borderControl, ground)).toBeGreaterThanOrEqual(
            contrast === 'high' ? 4.5 : 3,
          );
        }
      }
    }
  });
});

describe('CO-05 the palette reads as a palette', () => {
  it('runs light to dark one way and dark to light the other', () => {
    const light = surfacesFrom('#b8492c', 'warm', 'normal', 'light');
    expect(luminanceOf(rgbFrom(light.bgRaised) ?? { r: 0, g: 0, b: 0 })).toBeGreaterThan(
      luminanceOf(rgbFrom(light.bgSunken) ?? { r: 0, g: 0, b: 0 }),
    );
    const dark = surfacesFrom('#e0714d', 'warm', 'normal', 'dark');
    expect(luminanceOf(rgbFrom(dark.bgRaised) ?? { r: 0, g: 0, b: 0 })).toBeGreaterThan(
      luminanceOf(rgbFrom(dark.bgSunken) ?? { r: 0, g: 0, b: 0 }),
    );
    expect(luminanceOf(rgbFrom(dark.bg) ?? { r: 0, g: 0, b: 0 })).toBeLessThan(
      luminanceOf(rgbFrom(light.bg) ?? { r: 0, g: 0, b: 0 }),
    );
  });

  /* Three weights, and they have to stay in that order or the interface loses
     its hierarchy however well each one measures. */
  it('keeps faint fainter than muted, and muted fainter than text', () => {
    for (const base of BASES) {
      const made = surfacesFrom('#38bdf8', 'cool', 'normal', base);
      expect(contrastRatio(made.text, made.bg)).toBeGreaterThan(contrastRatio(made.textMuted, made.bg));
      expect(contrastRatio(made.textMuted, made.bg)).toBeGreaterThan(contrastRatio(made.textFaint, made.bg));
    }
  });

  it('keeps the hue somebody chose', () => {
    const made = surfacesFrom('#38bdf8', 'neutral', 'normal', 'light');
    const chosen = oklchOf(rgbFrom('#38bdf8') ?? { r: 0, g: 0, b: 0 });
    expect(oklchOf(rgbFrom(made.accent) ?? { r: 0, g: 0, b: 0 }).h).toBeCloseTo(chosen.h, 0);
  });

  it('answers with a palette rather than nothing when the accent is gibberish', () => {
    const made = surfacesFrom('not a colour', 'warm', 'normal', 'light');
    expect(contrastRatio(made.text, made.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(made.accent, made.bg)).toBeGreaterThanOrEqual(4.5);
  });
});
