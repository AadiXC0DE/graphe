/** Whether a pairing can be read, and the colour to reach for when it cannot.
 *
 * The arithmetic is the part that has to be exact. A tool that tells a designer
 * their grey is fine when it is not has done worse than nothing, and one that
 * flags a pairing that reads perfectly well teaches people to ignore it. So the
 * measurements are checked against published pairs rather than against
 * themselves, and the fix is checked by measuring the colour it hands back.
 *
 * The other half is the language. Every sentence here is read by the person who
 * chose the colour, and the moment one of them carries a number or a rule the
 * feature is back to being the thing nobody acts on.
 */

import { describe, expect, it } from 'vitest';

import {
  contrast,
  findTrouble,
  hexOf,
  isLarge,
  legible,
  lightness,
  luminance,
  needsFor,
  readColour,
  reads,
  saysFindings,
  saysPair,
  suggest,
  type Finding,
  type Reading,
  type Spot,
  type Tone,
} from '../src/design/legibility';

const WHITE = '#ffffff';
const BLACK = '#000000';

/** A palette of the shape a project actually ships. */
const SCALE: readonly Tone[] = [
  { name: 'grey-100', value: '#f5f5f5' },
  { name: 'grey-300', value: '#d4d4d4' },
  { name: 'grey-500', value: '#999999' },
  { name: 'grey-700', value: '#666666' },
  { name: 'grey-900', value: '#1f1f1f' },
  { name: 'blue-200', value: '#bfdbfe' },
  { name: 'blue-500', value: '#3b82f6' },
  { name: 'blue-700', value: '#1d4ed8' },
  { name: 'red-700', value: '#b91c1c' },
];

function reading(front: string, back: string, text?: { px: number; weight?: number }): Reading {
  const found = reads(front, back, text);
  if (found === null) throw new Error(`could not read ${front} on ${back}`);
  return found;
}

/* ========================================================================== */
/* L-01 reading a written colour                                               */
/* ========================================================================== */

describe('L-01 reading a written colour', () => {
  it('reads six-digit hex', () => {
    expect(readColour('#aabbcc')).toEqual({ r: 170, g: 187, b: 204, a: 1 });
  });

  it('reads the shorthand as the doubled form', () => {
    expect(readColour('#abc')).toEqual(readColour('#aabbcc'));
    expect(readColour('#fff')).toEqual(readColour('#ffffff'));
    expect(readColour('#000')).toEqual(readColour('#000000'));
  });

  it('reads the two lengths that carry a fourth channel', () => {
    expect(readColour('#00000080')?.a).toBeCloseTo(0.502, 3);
    expect(readColour('#0008')?.a).toBeCloseTo(0.533, 3);
    expect(readColour('#0000')?.a).toBe(0);
    expect(readColour('#000f')?.a).toBe(1);
  });

  it('does not care about case or the space around it', () => {
    expect(readColour('  #AaBbCc  ')).toEqual(readColour('#aabbcc'));
    expect(readColour('RGB(1, 2, 3)')).toEqual(readColour('rgb(1,2,3)'));
  });

  it('reads rgb in both spellings, with and without the fourth channel', () => {
    const plain = { r: 10, g: 20, b: 30, a: 1 };
    expect(readColour('rgb(10, 20, 30)')).toEqual(plain);
    expect(readColour('rgb(10 20 30)')).toEqual(plain);
    expect(readColour('rgba(10, 20, 30, 0.5)')).toEqual({ ...plain, a: 0.5 });
    expect(readColour('rgb(10 20 30 / 50%)')).toEqual({ ...plain, a: 0.5 });
  });

  it('reads rgb written as percentages', () => {
    expect(readColour('rgb(100% 0% 0%)')).toEqual({ r: 255, g: 0, b: 0, a: 1 });
  });

  it('reads hsl in both spellings', () => {
    expect(hexOf('hsl(0, 0%, 50%)')).toBe('#808080');
    expect(hexOf('hsl(240 100% 50%)')).toBe('#0000ff');
    expect(hexOf('hsl(120, 100%, 25%)')).toBe('#008000');
    expect(readColour('hsla(240, 100%, 50%, .5)')?.a).toBe(0.5);
  });

  it('reads a hue written as a turn, a radian or a gradian', () => {
    expect(hexOf('hsl(0.5turn 100% 50%)')).toBe(hexOf('hsl(180 100% 50%)'));
    expect(hexOf('hsl(200grad 100% 50%)')).toBe(hexOf('hsl(180 100% 50%)'));
    expect(hexOf('hsl(3.14159rad 100% 50%)')).toBe(hexOf('hsl(180 100% 50%)'));
  });

  it('wraps a hue that has gone round, in both directions', () => {
    expect(hexOf('hsl(360 100% 50%)')).toBe(hexOf('hsl(0 100% 50%)'));
    expect(hexOf('hsl(-120 100% 50%)')).toBe(hexOf('hsl(240 100% 50%)'));
  });

  it('clamps a channel written past the end of its range', () => {
    expect(readColour('rgb(300, -20, 0)')).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(readColour('rgba(0,0,0,4)')?.a).toBe(1);
  });

  it('says nothing about anything that is not a colour it can measure', () => {
    for (const bad of [
      '',
      '   ',
      '#',
      '#12345',
      '#1234567',
      '#gg0000',
      'rgb(0,0)',
      'rgb(0,0,0,0,0)',
      'rgb(a,b,c)',
      'hsl(0,0%)',
      'hsl(abc, 0%, 0%)',
      'rgb(0,0,0',
      'var(--text-muted)',
      'transparent',
      'currentColor',
      'red',
      'linear-gradient(#fff, #000)',
    ]) {
      expect(readColour(bad), bad).toBeNull();
    }
  });

  it('survives being handed something that is not a string at all', () => {
    expect(readColour(undefined as unknown as string)).toBeNull();
    expect(readColour(null as unknown as string)).toBeNull();
    expect(readColour(42 as unknown as string)).toBeNull();
  });

  it('writes a colour back out as a hex a file can hold', () => {
    expect(hexOf({ r: 170, g: 187, b: 204 })).toBe('#aabbcc');
    expect(hexOf('rgb(255 255 255)')).toBe('#ffffff');
    expect(hexOf('hsl(0 0% 0%)')).toBe('#000000');
    expect(hexOf('not a colour')).toBe('');
  });
});

/* ========================================================================== */
/* L-02 the measurement                                                        */
/* ========================================================================== */

describe('L-02 how far apart two colours are', () => {
  it('is 21 for black on white, which is as far as it goes', () => {
    expect(contrast(BLACK, WHITE)).toBeCloseTo(21, 6);
    expect(contrast('#000', '#fff')).toBeCloseTo(21, 6);
  });

  it('is 1 for a colour on itself', () => {
    expect(contrast(WHITE, WHITE)).toBe(1);
    expect(contrast('#b8492c', '#b8492c')).toBe(1);
  });

  it('matches the published figure for the greys everyone quotes', () => {
    expect(contrast('#767676', WHITE)).toBeCloseTo(4.54, 2);
    expect(contrast('#595959', WHITE)).toBeCloseTo(7.0, 2);
    expect(contrast('#777777', WHITE)).toBeCloseTo(4.48, 2);
    expect(contrast('#999999', WHITE)).toBeCloseTo(2.85, 2);
  });

  it('matches the published figure for saturated colours', () => {
    expect(contrast('#0000ff', WHITE)).toBeCloseTo(8.59, 2);
    expect(contrast('#ff0000', WHITE)).toBeCloseTo(4.0, 2);
    expect(contrast('#008000', WHITE)).toBeCloseTo(5.13, 1);
    expect(contrast('#ffff00', BLACK)).toBeCloseTo(19.56, 2);
  });

  it('does not care which way round it is asked', () => {
    expect(contrast('#767676', WHITE)).toBe(contrast(WHITE, '#767676'));
    expect(contrast(BLACK, '#3b82f6')).toBe(contrast('#3b82f6', BLACK));
  });

  it('reads the same colour whichever way it was written', () => {
    expect(contrast('#808080', WHITE)).toBeCloseTo(contrast('rgb(128,128,128)', WHITE), 10);
    expect(contrast('#0000ff', WHITE)).toBeCloseTo(contrast('hsl(240 100% 50%)', WHITE), 10);
  });

  it('says nothing rather than something wrong when a colour cannot be read', () => {
    expect(contrast('var(--x)', WHITE)).toBeNaN();
    expect(contrast(WHITE, 'nonsense')).toBeNaN();
    expect(luminance('var(--x)')).toBeNaN();
    expect(lightness('var(--x)')).toBeNaN();
  });
});

describe('L-02b straightening the light before measuring it', () => {
  it('is 1 for white and 0 for black', () => {
    expect(luminance(WHITE)).toBeCloseTo(1, 12);
    expect(luminance(BLACK)).toBe(0);
  });

  it('weighs green far above blue, because the eye does', () => {
    expect(luminance('#00ff00')).toBeCloseTo(0.7152, 6);
    expect(luminance('#ff0000')).toBeCloseTo(0.2126, 6);
    expect(luminance('#0000ff')).toBeCloseTo(0.0722, 6);
  });

  it('bends the middle grey down, where an average would leave it at half', () => {
    expect(luminance('#808080')).toBeCloseTo(0.2159, 4);
    expect(luminance('#808080')).not.toBeCloseTo(128 / 255, 2);
  });

  it('takes the straight line below the knee and the curve above it', () => {
    // 10/255 sits under the knee, 11/255 over it.
    expect(luminance('#0a0a0a')).toBeCloseTo(10 / 255 / 12.92, 10);
    expect(luminance('#0b0b0b')).toBeCloseTo(((11 / 255 + 0.055) / 1.055) ** 2.4, 10);
  });

  it('never goes backwards as a colour gets lighter', () => {
    let last = -1;
    for (let step = 0; step <= 255; step += 5) {
      const here = luminance({ r: step, g: step, b: step });
      expect(here).toBeGreaterThan(last);
      last = here;
    }
  });

  it('measures a see-through colour as it lands on its background', () => {
    expect(contrast('rgba(0,0,0,1)', WHITE)).toBeCloseTo(21, 6);
    expect(contrast('rgba(0,0,0,0)', WHITE)).toBe(1);
    expect(contrast('rgba(0,0,0,0.5)', WHITE)).toBeCloseTo(contrast('#808080', WHITE), 1);
    // The same ink is harder to read on a dark page than a light one.
    expect(contrast('rgba(0,0,0,0.5)', WHITE)).toBeGreaterThan(contrast('rgba(0,0,0,0.5)', '#333'));
  });
});

describe('L-02c perceived lightness', () => {
  it('runs 0 to 100, black to white', () => {
    expect(lightness(BLACK)).toBe(0);
    expect(lightness(WHITE)).toBeCloseTo(100, 10);
  });

  it('puts the halfway grey near the middle, which luminance does not', () => {
    expect(lightness('#777777')).toBeCloseTo(50, 0);
    expect(luminance('#777777')).toBeLessThan(0.25);
  });

  it('climbs with the colour', () => {
    const ramp = ['#000', '#333', '#666', '#999', '#ccc', '#fff'].map((one) => lightness(one));
    expect(ramp).toEqual([...ramp].sort((one, other) => one - other));
  });
});

/* ========================================================================== */
/* L-03 what a size owes                                                       */
/* ========================================================================== */

describe('L-03 big type carries itself', () => {
  it('treats missing type as body text, which is the strict case', () => {
    expect(isLarge()).toBe(false);
    expect(needsFor()).toBe(4.5);
    expect(needsFor({ px: 16 })).toBe(4.5);
  });

  it('counts 24px as large, at any weight', () => {
    expect(isLarge({ px: 24 })).toBe(true);
    expect(isLarge({ px: 23 })).toBe(false);
    expect(needsFor({ px: 32, weight: 300 })).toBe(3);
  });

  it('counts smaller type as large once it is bold', () => {
    expect(isLarge({ px: 19, weight: 700 })).toBe(true);
    expect(isLarge({ px: 19, weight: 400 })).toBe(false);
    expect(isLarge({ px: 18, weight: 900 })).toBe(false);
  });

  it('ignores a size that is not a number', () => {
    expect(isLarge({ px: Number.NaN })).toBe(false);
    expect(isLarge({ px: 30, weight: Number.NaN })).toBe(true);
  });

  it('passes a pairing at the headline size that fails at the body size', () => {
    const front = '#949494';
    expect(reading(front, WHITE).passes).toBe(false);
    expect(reading(front, WHITE, { px: 30 }).passes).toBe(true);
    expect(reading(front, WHITE, { px: 30 }).large).toBe(true);
  });

  it('marks the pairing that only fails because the type is small', () => {
    expect(reading('#949494', WHITE).onlyBig).toBe(true);
    expect(reading('#dddddd', WHITE).onlyBig).toBe(false);
    expect(reading('#949494', WHITE, { px: 30 }).onlyBig).toBe(false);
  });

  it('knows which of the two is the lighter, on a light page and a dark one', () => {
    expect(reading('#999999', WHITE).onLight).toBe(true);
    expect(reading('#333333', BLACK).onLight).toBe(false);
  });

  it('says nothing about a pairing it cannot read', () => {
    expect(reads('var(--x)', WHITE)).toBeNull();
    expect(reads(WHITE, 'var(--x)')).toBeNull();
  });

  it('decides on the measurement it took, not the rounded one it shows', () => {
    const found = reading('#767676', WHITE);
    expect(found.passes).toBe(true);
    expect(found.ratio).toBeGreaterThan(4.5);
    expect(found.needs).toBe(4.5);
  });
});

/* ========================================================================== */
/* L-04 the fix, out of the projectâs own colours                              */
/* ========================================================================== */

describe('L-04 a fix from the palette the project already has', () => {
  it('reaches for the projectâs own colour rather than inventing one', () => {
    const fix = suggest('#999999', WHITE, { scale: SCALE });
    expect(fix?.fromScale).toBe(true);
    expect(fix?.colour).toBe('#666666');
    expect(fix?.name).toBe('grey-700');
  });

  it('hands back a colour that genuinely reads', () => {
    const fix = suggest('#999999', WHITE, { scale: SCALE });
    expect(contrast(fix?.colour ?? '', WHITE)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps the colour the colour it was — a grey does not come back red', () => {
    const fix = suggest('#999999', WHITE, { scale: [{ name: 'red-700', value: '#b91c1c' }] });
    expect(fix?.fromScale).toBe(false);
    expect(fix?.colour).not.toBe('#b91c1c');
  });

  it('moves a pale blue on to the projectâs deep blue, not to its grey', () => {
    const fix = suggest('#93c5fd', WHITE, { scale: SCALE });
    expect(fix?.name).toBe('blue-700');
  });

  it('will not swap one hue for its neighbour', () => {
    const fix = suggest('#fdba74', WHITE, { scale: SCALE });
    expect(fix?.fromScale).toBe(false);
    expect(fix?.colour).not.toBe('#b91c1c');
  });

  it('takes the nearest of the ones that work, not the safest', () => {
    const fix = suggest('#999999', WHITE, {
      scale: [
        { name: 'grey-700', value: '#666666' },
        { name: 'ink', value: '#1a1a19' },
      ],
    });
    expect(fix?.name).toBe('grey-700');
  });

  it('passes over a colour of its own that does not read either', () => {
    const fix = suggest('#999999', WHITE, { scale: [{ name: 'grey-400', value: '#a3a3a3' }] });
    expect(fix?.fromScale).toBe(false);
  });

  it('takes a palette written as plain strings', () => {
    const fix = suggest('#999999', WHITE, { scale: ['#666666', '#1a1a19'] });
    expect(fix?.fromScale).toBe(true);
    expect(fix?.colour).toBe('#666666');
    expect(fix?.name).toBeNull();
  });

  it('steps over an entry it cannot read rather than falling over', () => {
    const fix = suggest('#999999', WHITE, { scale: ['var(--grey)', 'nonsense', '#666666'] });
    expect(fix?.colour).toBe('#666666');
  });

  it('gives the colour back spelled the way the project wrote it', () => {
    const fix = suggest('#999999', WHITE, { scale: [{ name: 'ink', value: 'rgb(31, 31, 31)' }] });
    expect(fix?.colour).toBe('rgb(31, 31, 31)');
  });

  it('asks less of the palette when the type is large', () => {
    // #8a8a8a is enough for a headline and not enough for body copy, so the
    // same palette answers the two sizes with two different colours.
    const scale = ['#8a8a8a', '#666666'];
    expect(suggest('#c4c4c4', WHITE, { scale, text: { px: 30 } })?.colour).toBe('#8a8a8a');
    expect(suggest('#c4c4c4', WHITE, { scale })?.colour).toBe('#666666');
  });
});

/* ========================================================================== */
/* L-05 the fix, with no palette to go on                                      */
/* ========================================================================== */

describe('L-05 a fix worked out from where the colour is', () => {
  it('darkens a pale grey on a light page until it reads', () => {
    const fix = suggest('#999999', WHITE);
    expect(fix?.fromScale).toBe(false);
    expect(fix?.direction).toBe('darker');
    expect(contrast(fix?.colour ?? '', WHITE)).toBeGreaterThanOrEqual(4.5);
  });

  it('lightens a dark colour on a dark page', () => {
    const fix = suggest('#333333', BLACK);
    expect(fix?.direction).toBe('lighter');
    expect(contrast(fix?.colour ?? '', BLACK)).toBeGreaterThanOrEqual(4.5);
  });

  it('stops at the first shade that works rather than going to black', () => {
    const fix = suggest('#999999', WHITE);
    expect(fix?.colour).not.toBe('#000000');
    expect(lightness(fix?.colour ?? '')).toBeGreaterThan(40);
    expect(contrast(fix?.colour ?? '', WHITE)).toBeLessThan(5);
  });

  it('keeps the hue it was given', () => {
    const fix = suggest('#93c5fd', WHITE);
    const moved = readColour(fix?.colour ?? '');
    expect(moved).not.toBeNull();
    expect((moved?.b ?? 0)).toBeGreaterThan(moved?.r ?? 0);
    expect((moved?.b ?? 0)).toBeGreaterThan(moved?.g ?? 0);
  });

  it('asks for less of a move when the type is large', () => {
    const small = suggest('#999999', WHITE);
    const large = suggest('#999999', WHITE, { text: { px: 30 } });
    expect(lightness(large?.colour ?? '')).toBeGreaterThan(lightness(small?.colour ?? ''));
    expect(contrast(large?.colour ?? '', WHITE)).toBeGreaterThanOrEqual(3);
  });

  it('offers nothing when the pairing already reads', () => {
    expect(suggest(BLACK, WHITE)).toBeNull();
    expect(suggest('#767676', WHITE)).toBeNull();
    expect(suggest('#949494', WHITE, { text: { px: 30 } })).toBeNull();
  });

  it('offers nothing when it cannot read the colours', () => {
    expect(suggest('var(--x)', WHITE)).toBeNull();
    expect(suggest(WHITE, 'var(--x)')).toBeNull();
  });

  it('counts the move in steps, never fewer than one', () => {
    const near = suggest('#7c7c7c', WHITE);
    expect(near?.steps).toBe(1);
    expect(suggest('#cccccc', WHITE)?.steps).toBeGreaterThan(2);
  });

  it('finds a way out even when the colour is its own background', () => {
    const fix = suggest(WHITE, WHITE);
    expect(fix).not.toBeNull();
    expect(contrast(fix?.colour ?? '', WHITE)).toBeGreaterThanOrEqual(4.5);
  });

  it('always hands back something that reads, whatever it is given', () => {
    // A spread of pairs rather than a lucky one: every fix is measured.
    let seed = 7;
    const next = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };

    for (let round = 0; round < 200; round += 1) {
      const front = hexOf({ r: next() * 255, g: next() * 255, b: next() * 255 });
      const back = hexOf({ r: next() * 255, g: next() * 255, b: next() * 255 });
      const fix = suggest(front, back, { scale: SCALE });
      if (fix === null) {
        expect(contrast(front, back), `${front} on ${back}`).toBeGreaterThanOrEqual(4.5);
        continue;
      }
      expect(contrast(fix.colour, back), `${front} on ${back} → ${fix.colour}`).toBeGreaterThanOrEqual(4.5);
      expect(fix.steps).toBeGreaterThanOrEqual(1);
      const way = lightness(fix.colour) < lightness(front) ? 'darker' : 'lighter';
      expect(fix.direction).toBe(way);
    }
  });
});

/* ========================================================================== */
/* L-06 the sentence                                                           */
/* ========================================================================== */

/** The vocabulary this whole feature exists to keep off the screen. */
const JARGON =
  /\b(wcag|aa|aaa|axe|lighthouse|ratio|contrast|luminance|compliance|violation|criterion|guideline|threshold|srgb|hex|rgb|hsl|css)\b/i;

function said(front: string, back: string, text?: { px: number; weight?: number }): string {
  return saysPair(reading(front, back, text), suggest(front, back, { text }));
}

describe('L-06 saying it the way a designer would', () => {
  it('says a pale grey on white is too pale, and roughly how far to move it', () => {
    expect(said('#999999', WHITE)).toBe(
      'Too pale to read on this background: about two steps darker would do it.',
    );
  });

  it('says a near miss is a near miss', () => {
    expect(said('#999999', WHITE, { px: 30 })).toBe('Nearly there: a step darker would do it.');
  });

  it('tells a pairing that only fails at this size what would fix it', () => {
    expect(said('#7c7c7c', WHITE)).toBe(
      'Fine for a headline, but too pale at this size: a step darker would do it.',
    );
  });

  it('turns the word round on a dark background', () => {
    expect(said('#333333', BLACK)).toMatch(/^Too dark to read on this background/);
    expect(said('#333333', BLACK)).toContain('lighter');
  });

  it('gives up on counting steps once the colour is a long way off', () => {
    expect(said('#f0f0f0', WHITE)).toBe(
      'Too pale to read on this background: it needs to be much darker.',
    );
  });

  it('says a pairing that only fails at this size the way that reads', () => {
    expect(saysPair(reading('#949494', WHITE))).toBe(
      'Fine for a headline, but too pale at this size.',
    );
  });

  it('has something to say about a pairing that is fine', () => {
    expect(saysPair(reading(BLACK, WHITE))).toBe(legible.fine);
  });

  it('still says something useful with no fix to hand', () => {
    expect(saysPair(reading('#999999', WHITE))).toBe('Too pale to read on this background.');
    expect(saysPair(reading('#333333', BLACK))).toBe('Too dark to read on this background.');
  });

  it('never puts a number in front of anybody', () => {
    const pairs: [string, string][] = [
      ['#999999', WHITE],
      ['#7c7c7c', WHITE],
      ['#cccccc', WHITE],
      ['#f0f0f0', WHITE],
      ['#949494', WHITE],
      ['#333333', BLACK],
      ['#3b82f6', WHITE],
      [BLACK, WHITE],
    ];
    for (const [front, back] of pairs) {
      const sentence = said(front, back);
      expect(sentence, sentence).not.toMatch(/\d/);
      expect(sentence, sentence).not.toMatch(JARGON);
    }
  });

  it('is a whole sentence every time', () => {
    for (const front of ['#999999', '#7c7c7c', '#cccccc', '#949494', '#f0f0f0']) {
      const sentence = said(front, WHITE);
      expect(sentence).toMatch(/^[A-Z]/);
      expect(sentence).toMatch(/\.$/);
      expect(sentence).not.toMatch(/\s{2}/);
    }
  });

  it('counts the list the way a person says it', () => {
    expect(saysFindings([])).toBe(legible.empty);
    expect(saysFindings([{} as Finding])).toBe('One thing here is hard to read.');
    expect(saysFindings([{}, {}] as Finding[])).toBe('Two things here are hard to read.');
    expect(saysFindings(Array.from({ length: 4 }, () => ({}) as Finding))).toBe(
      'Four things here are hard to read.',
    );
  });

  it('keeps the other vocabulary out of the fixed words too', () => {
    for (const line of Object.values(legible)) {
      expect(line, line).not.toMatch(JARGON);
      expect(line, line).not.toMatch(/\d/);
    }
  });
});

/* ========================================================================== */
/* L-07 the whole page                                                         */
/* ========================================================================== */

const SPOTS: readonly Spot[] = [
  { id: 'body', where: 'The body copy', front: '#1a1a19', back: '#fbfbfa' },
  { id: 'footer', where: 'The footer links', front: '#999999', back: WHITE },
  { id: 'hero', where: 'The hero subtitle', front: '#e5e5e5', back: WHITE, text: { px: 30 } },
  { id: 'unknown', where: 'The card label', front: 'var(--muted)', back: WHITE },
];

describe('L-07 everything on the page that cannot be read', () => {
  it('leaves out what reads perfectly well', () => {
    expect(findTrouble(SPOTS).map((one) => one.id)).not.toContain('body');
  });

  it('leaves out what it cannot measure rather than guessing', () => {
    expect(findTrouble(SPOTS).map((one) => one.id)).not.toContain('unknown');
  });

  it('puts the worst one first', () => {
    const found = findTrouble(SPOTS);
    expect(found.map((one) => one.id)).toEqual(['hero', 'footer']);
  });

  it('carries the place through as the app named it', () => {
    expect(findTrouble(SPOTS)[1]?.where).toBe('The footer links');
  });

  it('keeps the colours as the project wrote them, for the swatches', () => {
    const found = findTrouble([
      { id: 'one', where: 'A label', front: 'rgb(153, 153, 153)', back: WHITE },
    ]);
    expect(found[0]?.front).toBe('rgb(153, 153, 153)');
  });

  it('offers the projectâs own colour when it was given the palette', () => {
    const found = findTrouble(SPOTS, SCALE);
    expect(found.find((one) => one.id === 'footer')?.fix?.name).toBe('grey-700');
  });

  it('judges the headline by the headlineâs measure', () => {
    const found = findTrouble(SPOTS);
    expect(found.find((one) => one.id === 'hero')?.detail.needs).toBe(3);
    expect(found.find((one) => one.id === 'hero')?.detail.large).toBe(true);
  });

  it('finds nothing on a page that reads', () => {
    expect(findTrouble([SPOTS[0] as Spot])).toEqual([]);
    expect(saysFindings(findTrouble([SPOTS[0] as Spot]))).toBe(legible.empty);
  });
});

describe('L-07b the numbers, kept where the sentence cannot reach them', () => {
  it('measures what is on screen, down to the second place', () => {
    const found = findTrouble([{ id: 'a', where: 'A label', front: '#999999', back: WHITE }]);
    expect(found[0]?.detail.ratio).toBe(2.85);
    expect(found[0]?.detail.needs).toBe(4.5);
  });

  it('names the colours it actually measured, laid on their background', () => {
    const found = findTrouble([
      { id: 'a', where: 'A label', front: 'rgba(0,0,0,0.35)', back: WHITE },
    ]);
    expect(found[0]?.detail.front).toBe('#a6a6a6');
    expect(found[0]?.detail.back).toBe('#ffffff');
  });

  it('has one line for under the sentence, with the real values in it', () => {
    const found = findTrouble([{ id: 'a', where: 'A label', front: '#999999', back: WHITE }]);
    expect(found[0]?.detail.line).toBe('#999999 on #ffffff · measures 2.85, needs 4.5');
  });

  it('keeps every number on that line and none of them in the sentence', () => {
    for (const one of findTrouble(SPOTS, SCALE)) {
      expect(one.says).not.toMatch(/\d/);
      expect(one.detail.line).toMatch(/\d/);
    }
  });
});
