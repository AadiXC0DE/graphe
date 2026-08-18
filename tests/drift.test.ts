/** Values that were nearly the project's own.
 *
 * The colour maths is the part that has to be right. A near-miss that is not
 * flagged is a miss; a colour flagged because it happens to sit close in RGB is
 * worse than that, because two or three of those and nobody reads the section
 * again. So: exact is never flagged, far is never flagged, black and white and
 * hairlines are never flagged, and the one perceptual claim — that equal steps
 * in RGB are not equal steps to an eye — is tested on both sides.
 */

import { describe, expect, it } from 'vitest';

import {
  apart,
  colourWord,
  findDrift,
  hexOf,
  leaveAlone,
  leaveLengthAlone,
  nameFor,
  NEAR_COLOUR,
  readColour,
  readLength,
  saysAll,
  saysUseYours,
  saysDrift,
  toOklab,
  toOklch,
  type Finding,
  type Known,
  type Rgb,
} from '../src/design/drift';

const BLUE = '#2563eb';

const PALETTE: readonly Known[] = [
  { name: '--brand-blue', value: BLUE, kind: 'colour' },
  { name: '--ink', value: '#1a1a19', kind: 'colour' },
  { name: '--paper', value: '#fbfbfa', kind: 'colour' },
  { name: '--space-4', value: '16px', kind: 'space' },
  { name: '--space-6', value: '32px', kind: 'space' },
  { name: '--radius-md', value: '10px', kind: 'radius' },
];

const rgb = (text: string): Rgb => {
  const read = readColour(text);
  if (read === null) throw new Error(`unreadable: ${text}`);
  return read;
};

const gap = (one: string, other: string) => apart(rgb(one), rgb(other));

/** What a naive comparison would have said, for the one test that needs both. */
const rgbGap = (one: string, other: string) => {
  const a = rgb(one);
  const b = rgb(other);
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
};

const wrote = (findings: readonly Finding[]) => findings.map((one) => one.wrote);

/* ========================================================================== */
/* D-01 reading a colour                                                       */
/* ========================================================================== */

describe('D-01 every way a colour gets written', () => {
  it('reads six-digit hex', () => {
    expect(readColour('#2563eb')).toEqual({ r: 37, g: 99, b: 235, a: 1 });
  });

  it('does not care about case', () => {
    expect(readColour('#2563EB')).toEqual(readColour('#2563eb'));
  });

  it('reads three-digit hex as the doubled form', () => {
    expect(readColour('#abc')).toEqual({ r: 170, g: 187, b: 204, a: 1 });
    expect(readColour('#fff')).toEqual(readColour('#ffffff'));
  });

  it('reads four- and eight-digit hex, alpha and all', () => {
    expect(readColour('#00000080')).toEqual({ r: 0, g: 0, b: 0, a: 128 / 255 });
    expect(readColour('#abcd')).toEqual({
      r: 170,
      g: 187,
      b: 204,
      a: 221 / 255,
    });
    expect(readColour('#abcd')).toEqual(readColour('#aabbccdd'));
  });

  it('reads rgb() and rgba() with commas', () => {
    expect(readColour('rgb(37, 99, 235)')).toEqual({
      r: 37,
      g: 99,
      b: 235,
      a: 1,
    });
    expect(readColour('rgba(37, 99, 235, 0.5)')).toEqual({
      r: 37,
      g: 99,
      b: 235,
      a: 0.5,
    });
  });

  it('reads the modern spaced form, slash and all', () => {
    expect(readColour('rgb(37 99 235)')).toEqual({
      r: 37,
      g: 99,
      b: 235,
      a: 1,
    });
    expect(readColour('rgb(37 99 235 / 50%)')).toEqual({
      r: 37,
      g: 99,
      b: 235,
      a: 0.5,
    });
    expect(readColour('rgba(37 99 235 / 0.5)')).toEqual({
      r: 37,
      g: 99,
      b: 235,
      a: 0.5,
    });
  });

  it('reads channels written as percentages', () => {
    expect(readColour('rgb(100% 0% 0%)')).toEqual({ r: 255, g: 0, b: 0, a: 1 });
  });

  it('reads hsl() and hsla(), old form and new', () => {
    expect(readColour('hsl(0, 0%, 50%)')).toEqual({
      r: 128,
      g: 128,
      b: 128,
      a: 1,
    });
    expect(readColour('hsl(240 100% 50%)')).toEqual({
      r: 0,
      g: 0,
      b: 255,
      a: 1,
    });
    expect(readColour('hsla(240, 100%, 50%, 0.25)')).toEqual({
      r: 0,
      g: 0,
      b: 255,
      a: 0.25,
    });
    expect(readColour('hsl(240 100% 50% / 25%)')).toEqual({
      r: 0,
      g: 0,
      b: 255,
      a: 0.25,
    });
  });

  it('reads a hue in any of its units, and wraps it', () => {
    expect(readColour('hsl(0.5turn 100% 50%)')).toEqual({
      r: 0,
      g: 255,
      b: 255,
      a: 1,
    });
    expect(readColour('hsl(200grad 100% 50%)')).toEqual({
      r: 0,
      g: 255,
      b: 255,
      a: 1,
    });
    expect(readColour('hsl(-120 100% 50%)')).toEqual({
      r: 0,
      g: 0,
      b: 255,
      a: 1,
    });
    expect(readColour('hsl(600 100% 50%)')).toEqual(readColour('hsl(240 100% 50%)'));
  });

  it('holds channels inside their range', () => {
    expect(readColour('rgb(300, -20, 0)')).toEqual({
      r: 255,
      g: 0,
      b: 0,
      a: 1,
    });
    expect(readColour('rgba(0, 0, 0, 4)')).toEqual({ r: 0, g: 0, b: 0, a: 1 });
  });

  it('knows the three names that decide whether anything is flagged', () => {
    expect(readColour('white')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(readColour('black')).toEqual({ r: 0, g: 0, b: 0, a: 1 });
    expect(readColour('transparent')?.a).toBe(0);
    expect(readColour('WHITE')).toEqual(readColour('white'));
  });

  it('comes back empty-handed rather than guessing', () => {
    for (const bad of [
      '',
      '   ',
      '#',
      '#12',
      '#12345',
      '#1234567',
      '#gg0000',
      'rebeccapurple',
      'currentColor',
      'var(--brand-blue)',
      'rgb(1, 2)',
      'rgb(1, 2, 3, 4, 5)',
      'rgb(a, b, c)',
      'rgb(37 99 235',
      'hsl()',
      'linear-gradient(#fff, #000)',
      'oklch(0.6 0.2 260)',
    ]) {
      expect(readColour(bad)).toBeNull();
    }
  });

  it('writes a colour back out', () => {
    expect(hexOf(rgb('#2563eb'))).toBe('#2563eb');
    expect(hexOf(rgb('rgb(37 99 235)'))).toBe('#2563eb');
    expect(hexOf(rgb('rgba(0, 0, 0, 0.5)'))).toBe('#00000080');
    expect(hexOf(rgb(hexOf(rgb('#abc'))))).toBe('#aabbcc');
  });
});

/* ========================================================================== */
/* D-02 the perceptual space itself                                            */
/* ========================================================================== */

describe('D-02 OKLab, as published', () => {
  it('puts white at one and black at zero', () => {
    expect(toOklab(rgb('#ffffff')).L).toBeCloseTo(1, 6);
    expect(toOklab(rgb('#000000')).L).toBeCloseTo(0, 6);
  });

  it('puts mid grey where the transfer curve says, not at half', () => {
    // Undoing sRGB's curve is the step a naive comparison skips: #808080 is
    // 50% of the byte range and 0.5998 of the lightness.
    expect(toOklab(rgb('#808080')).L).toBeCloseTo(0.5998, 3);
  });

  it('leaves grey with no colour in it', () => {
    for (const grey of ['#000000', '#808080', '#ffffff', '#3c3c3c']) {
      const lab = toOklab(rgb(grey));
      expect(Math.abs(lab.a)).toBeLessThan(1e-6);
      expect(Math.abs(lab.b)).toBeLessThan(1e-6);
      expect(toOklch(rgb(grey)).C).toBeLessThan(1e-6);
    }
  });

  it('lands the primaries on their known hues', () => {
    expect(toOklch(rgb('#ff0000')).h).toBeCloseTo(29.23, 1);
    expect(toOklch(rgb('#00ff00')).h).toBeCloseTo(142.5, 0);
    expect(toOklch(rgb('#0000ff')).h).toBeCloseTo(264.05, 1);
  });

  it('is zero for the same colour and the same both ways round', () => {
    expect(apart(rgb('#2563eb'), rgb('#2563eb'))).toBe(0);
    expect(gap('#2563eb', '#3b82f6')).toBeCloseTo(gap('#3b82f6', '#2563eb'), 12);
  });

  it('grows with the size of the difference', () => {
    expect(gap('#2563eb', '#2563ec')).toBeLessThan(gap('#2563eb', '#3b82f6'));
    expect(gap('#2563eb', '#3b82f6')).toBeLessThan(gap('#2563eb', '#ef4444'));
  });
});

/* ========================================================================== */
/* D-03 perceptual, not RGB                                                    */
/* ========================================================================== */

describe('D-03 the same step in RGB is not the same step to an eye', () => {
  const dark: [string, string] = ['#0a0a0a', '#1e1e1e'];
  const light: [string, string] = ['#dcdcdc', '#f0f0f0'];

  it('is the same distance in RGB either way', () => {
    expect(rgbGap(...dark)).toBeCloseTo(rgbGap(...light), 6);
  });

  it('is not the same distance to an eye', () => {
    // Twenty steps low down is an obvious change; twenty steps up near white is
    // barely one. A comparison that cannot tell those apart flags the wrong one.
    expect(gap(...dark)).toBeGreaterThan(gap(...light) * 1.4);
  });

  it('flags the pair that is close and leaves the pair that is not', () => {
    const near = { nearColour: 0.07 };
    const lightFind = findDrift(
      `.a { color: ${light[1]}; }`,
      [{ name: '--sand', value: light[0] }],
      near,
    );
    const darkFind = findDrift(
      `.a { color: ${dark[1]}; }`,
      [{ name: '--coal', value: dark[0] }],
      near,
    );
    expect(wrote(lightFind)).toEqual([light[1]]);
    expect(darkFind).toEqual([]);
  });

  it('does not mistake a hue for a neighbour just because the bytes are close', () => {
    // #ff0000 and #ff00ff differ in one channel; nobody would confuse them.
    expect(gap('#ff0000', '#ff00ff')).toBeGreaterThan(NEAR_COLOUR * 3);
  });
});

/* ========================================================================== */
/* D-04 what is left alone                                                     */
/* ========================================================================== */

describe('D-04 the things that are legitimately not on a scale', () => {
  const nearBlack: readonly Known[] = [
    { name: '--ink', value: '#0a0a0a', kind: 'colour' },
    { name: '--paper', value: '#fbfbfa', kind: 'colour' },
  ];

  it('never flags pure black or pure white', () => {
    const css =
      '.a { color: #000; background: #fff; border-color: #ffffff; outline-color: #000000; }';
    expect(findDrift(css, nearBlack)).toEqual([]);
  });

  it('never flags anything see-through', () => {
    const css = `.a {
      background: rgba(0, 0, 0, 0.06);
      box-shadow: 0 1px 2px rgba(37, 99, 236, 0.4);
      color: rgb(26 26 26 / 90%);
      border-color: #2563eb80;
    }`;
    expect(findDrift(css, PALETTE)).toEqual([]);
  });

  it('says so on its own, without a file around it', () => {
    expect(leaveAlone(rgb('#000000'))).toBe(true);
    expect(leaveAlone(rgb('#ffffff'))).toBe(true);
    expect(leaveAlone(rgb('transparent'))).toBe(true);
    expect(leaveAlone(rgb('rgba(37, 99, 235, 0.5)'))).toBe(true);
    expect(leaveAlone(rgb('#2563eb'))).toBe(false);
  });

  it('never compares against a project value that is black or white either', () => {
    const near = findDrift('.a { color: #fafafa; }', [{ name: '--paper', value: '#ffffff' }]);
    expect(near).toEqual([]);
  });

  it('never flags zero, a hairline or a border', () => {
    const css = `.a {
      margin: 0;
      padding: 0px;
      border: 1px solid;
      outline-width: 1.5px;
      border-bottom-width: 2px;
    }`;
    expect(findDrift(css, [{ name: '--space-1', value: '2px', kind: 'space' }])).toEqual([]);
    expect(leaveLengthAlone({ amount: 1, unit: 'px', px: 1 })).toBe(true);
    expect(leaveLengthAlone({ amount: 0, unit: 'px', px: 0 })).toBe(true);
    expect(leaveLengthAlone({ amount: 15, unit: 'px', px: 15 })).toBe(false);
  });

  it('never flags a share of something, or a size it was not given', () => {
    const css =
      '.a { width: 100%; height: auto; max-width: 99%; line-height: 1.5; flex: 1 1 0; z-index: 15; }';
    expect(findDrift(css, PALETTE)).toEqual([]);
  });

  it('never flags a negative offset', () => {
    expect(findDrift('.a { margin-top: -15px; }', PALETTE)).toEqual([]);
  });
});

/* ========================================================================== */
/* D-05 reading a size                                                         */
/* ========================================================================== */

describe('D-05 sizes', () => {
  it('reads the units that can be compared', () => {
    expect(readLength('12px')).toEqual({ amount: 12, unit: 'px', px: 12 });
    expect(readLength('0.875rem')).toEqual({
      amount: 0.875,
      unit: 'rem',
      px: 14,
    });
    expect(readLength('1em')).toEqual({ amount: 1, unit: 'em', px: 16 });
    expect(readLength(' 24PX ')).toEqual({ amount: 24, unit: 'px', px: 24 });
  });

  it('refuses the ones that cannot', () => {
    for (const bad of [
      '',
      'auto',
      '100%',
      '1.5',
      '12',
      '12vw',
      '2ch',
      '1fr',
      '12 px',
      'calc(100% - 12px)',
    ]) {
      expect(readLength(bad)).toBeNull();
    }
  });
});

/* ========================================================================== */
/* D-06 near, exact and far                                                    */
/* ========================================================================== */

describe('D-06 which colours are findings', () => {
  it('flags one that is nearly the project’s own', () => {
    const found = findDrift('.a { color: #2a68ee; }', PALETTE);
    expect(found).toHaveLength(1);
    expect(found[0]?.wrote).toBe('#2a68ee');
    expect(found[0]?.mine).toEqual({ name: '--brand-blue', value: BLUE });
    expect(found[0]?.kind).toBe('colour');
  });

  it('flags the stock blue against a brand blue — the whole point', () => {
    const found = findDrift('.button { background: #3b82f6; }', PALETTE);
    expect(found).toHaveLength(1);
    expect(found[0]?.mine.name).toBe('--brand-blue');
  });

  it('never flags a value the project already has', () => {
    const css = `.a { color: ${BLUE}; background: #1A1A19; border-color: rgb(37, 99, 235); }`;
    expect(findDrift(css, PALETTE)).toEqual([]);
  });

  it('never flags one written a different way round', () => {
    const css = '.a { color: rgb(37 99 235); background: rgba(37, 99, 235, 1); }';
    expect(findDrift(css, PALETTE)).toEqual([]);
  });

  it('finds one written as hsl() as readily as a hex', () => {
    const found = findDrift('.a { color: hsl(224 76% 53%); }', PALETTE);
    expect(found).toHaveLength(1);
    expect(found[0]?.wrote).toBe('hsl(224 76% 53%)');
    expect(found[0]?.mine.name).toBe('--brand-blue');
  });

  it('never flags a colour that is simply a different colour', () => {
    const css = '.a { color: #ef4444; background: #22c55e; border-color: #8b5cf6; }';
    expect(findDrift(css, PALETTE)).toEqual([]);
  });

  it('leaves a colour a whole step off the palette alone', () => {
    // Two steps up a ramp is a decision, not a slip: 0.10 apart and out of range.
    const css = '.a { color: #60a5fa; background: #93c5fd; }';
    expect(findDrift(css, PALETTE)).toEqual([]);
  });

  it('offers the nearest of the project’s values, not the first', () => {
    const known: Known[] = [
      { name: '--far', value: '#1a1a19', kind: 'colour' },
      { name: '--close', value: '#2563eb', kind: 'colour' },
      { name: '--middling', value: '#3b82f6', kind: 'colour' },
    ];
    const found = findDrift('.a { color: #2a68ee; }', known);
    expect(found[0]?.mine.name).toBe('--close');
  });

  it('does not flag a palette file against itself', () => {
    const file = `:root {
      --brand-blue: #2563eb;
      --brand-blue-dark: #1e4fc4;
      --ink: #1a1a19;
      --space-4: 16px;
      --space-5: 15px;
    }`;
    const known: Known[] = [
      { name: '--brand-blue', value: '#2563eb', kind: 'colour' },
      { name: '--brand-blue-dark', value: '#1e4fc4', kind: 'colour' },
      { name: '--ink', value: '#1a1a19', kind: 'colour' },
      { name: '--space-4', value: '16px', kind: 'space' },
      { name: '--space-5', value: '15px', kind: 'space' },
    ];
    expect(findDrift(file, known)).toEqual([]);
  });

  it('gets more certain the closer it gets', () => {
    const at = (colour: string) => findDrift(`.a { color: ${colour}; }`, PALETTE)[0]?.confidence;
    expect(at('#2563ec')).toBe('sure');
    expect(at('#2a68ee')).toBe('sure');
    expect(at('#3b82f6')).toBe('maybe');
    expect(at('#2563eb')).toBeUndefined();
  });

  it('honours a threshold that is handed to it', () => {
    expect(findDrift('.a { color: #3b82f6; }', PALETTE, { nearColour: 0.01 })).toEqual([]);
    expect(findDrift('.a { color: #60a5fa; }', PALETTE, { nearColour: 0.2 })).toHaveLength(1);
  });
});

/* ========================================================================== */
/* D-07 where it is                                                            */
/* ========================================================================== */

describe('D-07 line and column', () => {
  it('counts from one, as an editor does', () => {
    const found = findDrift('.a { color: #2a68ee; }', PALETTE);
    expect(found[0]?.line).toBe(1);
    expect(found[0]?.column).toBe(13);
  });

  it('finds the right line in a file with several', () => {
    const css = ['.a {', '  color: #2a68ee;', '}', '', '.b {', '  color: #2a68ee;', '}'].join('\n');
    const found = findDrift(css, PALETTE);
    expect(found.map((one) => one.line)).toEqual([2, 6]);
    expect(found.map((one) => one.column)).toEqual([10, 10]);
  });

  it('finds both when they share a line', () => {
    const found = findDrift('.a { color: #2a68ee; border-color: #2a68ee; }', PALETTE);
    expect(found.map((one) => one.column)).toEqual([13, 36]);
  });

  it('gives each one an id that does not move between runs', () => {
    const css = '.a {\n  color: #2a68ee;\n  padding: 15px;\n}';
    const once = findDrift(css, PALETTE);
    const twice = findDrift(css, PALETTE);
    expect(once.map((one) => one.id)).toEqual(twice.map((one) => one.id));
    expect(new Set(once.map((one) => one.id)).size).toBe(once.length);
    expect(once).toEqual(twice);
  });
});

/* ========================================================================== */
/* D-08 what is not looked at                                                  */
/* ========================================================================== */

describe('D-08 the parts of a file that are not values', () => {
  it('ignores comments of both shapes', () => {
    const css = `/* #2a68ee and 15px */
.a { color: red; }
// #2a68ee 15px
/* over
   two lines #2a68ee */`;
    expect(findDrift(css, PALETTE)).toEqual([]);
  });

  it('ignores quoted text', () => {
    const source = `const one = "#2a68ee";
const two = '#2a68ee';
const three = \`#2a68ee\`;
const four = "15px";`;
    expect(findDrift(source, PALETTE)).toEqual([]);
  });

  it('ignores what is inside url()', () => {
    const css = '.a { background: url(/img/2a68ee/15px.png); }';
    expect(findDrift(css, PALETTE)).toEqual([]);
  });

  it('ignores the head of an at-rule but not its body', () => {
    const css = '@media (min-width: 15px) { .a { padding: 15px; } }';
    const found = findDrift(css, PALETTE);
    expect(found).toHaveLength(1);
    expect(found[0]?.column).toBe(42);
  });

  it('keeps counting lines through the parts it skips', () => {
    const css = [
      '/* a comment',
      '   over three lines',
      '   #ffffff */',
      '.a { color: #2a68ee; }',
    ].join('\n');
    expect(findDrift(css, PALETTE)[0]?.line).toBe(4);
  });

  it('still reads a value the comment sits beside', () => {
    const css = '.a { color: #2a68ee; /* the button */ }';
    expect(findDrift(css, PALETTE)).toHaveLength(1);
  });
});

/* ========================================================================== */
/* D-09 sizes off the scale                                                    */
/* ========================================================================== */

describe('D-09 sizes that are nearly the project’s own', () => {
  it('flags one a fraction off', () => {
    const found = findDrift('.a { padding: 15px; }', PALETTE);
    expect(found).toHaveLength(1);
    expect(found[0]?.kind).toBe('length');
    expect(found[0]?.mine).toEqual({ name: '--space-4', value: '16px' });
  });

  it('compares across units', () => {
    const found = findDrift('.a { padding: 0.95rem; }', PALETTE);
    expect(found[0]?.mine.name).toBe('--space-4');
    expect(findDrift('.a { padding: 1rem; }', PALETTE)).toEqual([]);
    expect(findDrift('.a { padding: 1em; }', PALETTE)).toEqual([]);
  });

  it('leaves a size that is simply a different size', () => {
    const css = '.a { padding: 24px; margin: 40px; gap: 6px; }';
    expect(findDrift(css, PALETTE)).toEqual([]);
  });

  it('offers the nearest step on the scale', () => {
    const found = findDrift('.a { padding: 31px; }', PALETTE);
    expect(found[0]?.mine.name).toBe('--space-6');
  });

  it('tells corners from spacing', () => {
    const found = findDrift('.a { border-radius: 9.5px; }', PALETTE);
    expect(found[0]?.mine.name).toBe('--radius-md');
    expect(found[0]?.says).toContain('corner rounding');
  });

  it('honours a threshold that is handed to it', () => {
    expect(findDrift('.a { padding: 15px; }', PALETTE, { nearLength: 0.01 })).toEqual([]);
    expect(findDrift('.a { padding: 20px; }', PALETTE, { nearLength: 0.3 })).toHaveLength(1);
  });

  it('works out what a value is when it is not told', () => {
    const known: Known[] = [
      { name: '--brand-blue', value: '#2563eb' },
      { name: '--gutter', value: '16px' },
    ];
    const found = findDrift('.a { color: #2a68ee; padding: 15px; }', known);
    expect(found.map((one) => one.kind)).toEqual(['colour', 'length']);
  });
});

/* ========================================================================== */
/* D-10 the words                                                              */
/* ========================================================================== */

describe('D-10 one sentence a designer can act on', () => {
  it('says the line the section is named after', () => {
    expect(saysDrift({ kind: 'colour', confidence: 'sure', yours: 'brand blue' })).toBe(
      'This is nearly your brand blue, but not quite.',
    );
  });

  it('softens as it gets less sure', () => {
    const said = (['sure', 'likely', 'maybe'] as const).map((confidence) =>
      saysDrift({ kind: 'colour', confidence, yours: 'brand blue' }),
    );
    expect(new Set(said).size).toBe(3);
    expect(said[1]).toBe('This is a shade off your brand blue.');
    expect(said[2]).toBe('This is close to your brand blue, but not the same.');
  });

  it('has a sentence for a size too', () => {
    expect(saysDrift({ kind: 'length', confidence: 'sure', yours: 'spacing' })).toBe(
      'This is a hair off your spacing.',
    );
    expect(
      saysDrift({
        kind: 'length',
        confidence: 'likely',
        yours: 'corner rounding',
      }),
    ).toBe('This is nearly your corner rounding, but not quite.');
  });

  it('never carries a value into the sentence', () => {
    const css = `.a {
      color: #2a68ee;
      background: #3b82f6;
      padding: 15px;
      border-radius: 9.5px;
      margin: 31px;
    }`;
    const found = findDrift(css, PALETTE);
    expect(found.length).toBeGreaterThan(3);
    for (const one of found) {
      expect(one.says).not.toContain('#');
      expect(one.says).not.toMatch(/\d/);
      expect(one.says).not.toMatch(/rgb|hsl|px|rem|var\(|--/);
    }
  });

  it('never says a word the app does not say', () => {
    const found = findDrift('.a { color: #2a68ee; padding: 15px; }', [
      { name: '--color-token-500', value: '#2563eb', kind: 'colour' },
      { name: '--space-4', value: '16px', kind: 'space' },
    ]);
    for (const one of found) {
      expect(one.says.toLowerCase()).not.toMatch(/token|hex|literal|variable|css/);
    }
  });

  it('uses the project’s own name for a colour', () => {
    expect(nameFor({ name: '--brand-blue', value: BLUE }, rgb(BLUE))).toBe('brand blue');
    expect(nameFor({ name: 'accent-warm', value: '#b8492c' }, rgb('#b8492c'))).toBe('accent warm');
  });

  it('falls back to the colour when the name says nothing', () => {
    expect(nameFor({ name: '--color', value: BLUE }, rgb(BLUE))).toBe('blue');
    expect(nameFor({ name: '--color-500', value: BLUE }, rgb(BLUE))).toBe('blue 500');
    expect(nameFor({ name: '--token', value: '#22c55e' }, rgb('#22c55e'))).toBe('green');
  });

  it('calls a size by its scale rather than its label', () => {
    expect(nameFor({ name: '--space-4', value: '16px', kind: 'space' })).toBe('spacing');
    expect(nameFor({ name: '--radius-md', value: '10px', kind: 'radius' })).toBe('corner rounding');
    expect(nameFor({ name: '--text-sm', value: '13px', kind: 'size' })).toBe('sizing');
    expect(nameFor({ name: '--gutter', value: '16px' })).toBe('sizing');
  });

  it('names a colour the way somebody would say it', () => {
    const said: Record<string, string> = {
      '#ef4444': 'red',
      '#f97316': 'orange',
      '#eab308': 'yellow',
      '#22c55e': 'green',
      '#06b6d4': 'teal',
      '#3b82f6': 'blue',
      '#2563eb': 'blue',
      '#8b5cf6': 'purple',
      '#ec4899': 'pink',
      '#ff0000': 'red',
      '#808080': 'grey',
      '#000000': 'black',
      '#ffffff': 'white',
    };
    for (const [colour, word] of Object.entries(said)) {
      expect(colourWord(rgb(colour))).toBe(word);
    }
  });

  /* "Use yours" used to be a button wired to nothing. What it sends has to be
     exact: a near-miss is by definition almost the same as other values in the
     same file, so a vague instruction gets acted on in the wrong place. */
  it('names the one place to change, and says to leave the rest alone', () => {
    const [finding] = findDrift('.a { color: #2a68ee; }', PALETTE);
    expect(finding).toBeDefined();
    if (finding === undefined) return;

    const said = saysUseYours(finding, 'styles/app.css');
    expect(said).toContain('styles/app.css');
    expect(said).toContain(`line ${String(finding.line)}`);
    expect(said).toContain(finding.wrote);
    expect(said).toContain(finding.use);
    expect(said).toContain(finding.mine.name);
    expect(said).toMatch(/leave every other .* alone/i);
  });

  it('still says where when the stylesheet has no name', () => {
    const [finding] = findDrift('.a { color: #2a68ee; }', PALETTE);
    if (finding === undefined) return;
    const said = saysUseYours(finding, '');
    expect(said).toContain(`line ${String(finding.line)}`);
    expect(said).not.toContain('In , ');
    expect(said).not.toContain('undefined');
  });

  it('counts the section in words', () => {
    const one = findDrift('.a { color: #2a68ee; }', PALETTE);
    const two = findDrift('.a { color: #2a68ee; padding: 15px; }', PALETTE);
    expect(saysAll([])).toBe('Everything here uses your own values.');
    expect(saysAll(one)).toBe('One value here is not quite yours.');
    expect(saysAll(two)).toBe('Two values here are not quite yours.');
  });
});

/* ========================================================================== */
/* D-11 nothing to go on                                                       */
/* ========================================================================== */

describe('D-11 malformed, empty and hostile input', () => {
  it('has nothing to say about nothing', () => {
    expect(findDrift('', PALETTE)).toEqual([]);
    expect(findDrift('.a { color: red; }', [])).toEqual([]);
    expect(findDrift('   \n\n   ', PALETTE)).toEqual([]);
  });

  it('survives a file that is not a file', () => {
    expect(findDrift(undefined as unknown as string, PALETTE)).toEqual([]);
    expect(findDrift(null as unknown as string, PALETTE)).toEqual([]);
  });

  it('ignores project values it cannot read', () => {
    const known: Known[] = [
      { name: '--broken', value: 'not a colour', kind: 'colour' },
      { name: '--empty', value: '', kind: 'colour' },
      { name: '--stack', value: 'ui-sans-serif, system-ui', kind: 'other' },
      {
        name: '--shadow',
        value: '0 1px 2px rgb(0 0 0 / 0.04)',
        kind: 'shadow',
      },
    ];
    expect(findDrift('.a { color: #2a68ee; padding: 15px; }', known)).toEqual([]);
  });

  it('reads the good values in a file full of bad ones', () => {
    const css = `.a {
      color: #12345;
      background: rgb(1, 2);
      border-color: #2a68ee;
      outline: 1px solid #gg0000;
    `;
    const found = findDrift(css, PALETTE);
    expect(wrote(found)).toEqual(['#2a68ee']);
  });

  it('does not run off the end of an unclosed comment or string', () => {
    expect(() => findDrift('.a { /* #2a68ee', PALETTE)).not.toThrow();
    expect(() => findDrift('.a { content: "#2a68ee', PALETTE)).not.toThrow();
    expect(findDrift('.a { /* #2a68ee', PALETTE)).toEqual([]);
  });

  it('caps a file that has drifted everywhere', () => {
    const css = Array.from({ length: 30 }, (_, at) => `.c${String(at)} { color: #2a68ee; }`).join(
      '\n',
    );
    expect(findDrift(css, PALETTE)).toHaveLength(30);
    expect(findDrift(css, PALETTE, { most: 5 })).toHaveLength(5);
    expect(findDrift(css, PALETTE, { most: 0 })).toEqual([]);
  });
});

/* ========================================================================== */
/* D-12 a whole stylesheet                                                     */
/* ========================================================================== */

describe('D-12 the file as it actually arrives', () => {
  const css = `/* Buttons — #ff0000 in here is not a value */
.button {
  background: #3b82f6;
  color: #ffffff;
  padding: 15px 16px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 9.5px;
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.05);
}

.button--quiet {
  background: transparent;
  color: #2563ec;
  margin-top: 31px;
}

@media (min-width: 640px) {
  .button { padding: 15px; }
}
`;

  const found = findDrift(css, PALETTE);

  it('finds every near-miss and nothing else', () => {
    expect(wrote(found).sort()).toEqual(['#2563ec', '#3b82f6', '15px', '15px', '31px', '9.5px']);
  });

  it('puts the ones it is surest about first', () => {
    const ranks = found.map((one) => ['sure', 'likely', 'maybe'].indexOf(one.confidence));
    expect(ranks).toEqual([...ranks].sort((one, other) => one - other));
    expect(found[0]?.wrote).toBe('#2563ec');
  });

  it('reads in file order inside a run of equal certainty', () => {
    const likely = found.filter((one) => one.confidence === 'likely');
    expect(likely.map((one) => one.line)).toEqual(
      [...likely.map((one) => one.line)].sort((a, b) => a - b),
    );
  });

  it('hands the screen what to write instead', () => {
    expect(found.find((one) => one.wrote === '#3b82f6')?.use).toBe('var(--brand-blue)');
    expect(found.find((one) => one.wrote === '15px')?.use).toBe('var(--space-4)');
  });

  it('writes a plain value when the project has no name for it', () => {
    const found2 = findDrift('.a { color: #2a68ee; }', [{ name: 'brand blue', value: BLUE }]);
    expect(found2[0]?.use).toBe(BLUE);
  });

  it('keeps the exact values off the sentence and on the detail', () => {
    const one = found.find((finding) => finding.wrote === '#3b82f6');
    expect(one?.detail).toContain('#3b82f6');
    expect(one?.detail).toContain(BLUE);
    expect(one?.says).not.toContain('#');
  });

  it('reports a distance as a number, for whoever wants one', () => {
    for (const one of found) {
      expect(one.distance).toBeGreaterThan(0);
      expect(Number.isFinite(one.distance)).toBe(true);
    }
    expect(found.find((one) => one.wrote === '#3b82f6')?.distance).toBeCloseTo(0.082, 2);
  });

  it('says the same thing every time it is asked', () => {
    expect(findDrift(css, PALETTE)).toEqual(found);
  });
});
