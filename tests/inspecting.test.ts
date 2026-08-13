/** Clicking an element and being told what it is.
 *
 * The reading is a function of its arguments, so all of it is checked here: the
 * chain degrading a rung at a time, the values matched against the project's
 * own, and — the part that matters most — the card saying out loud what it
 * could not work out rather than quietly leaving it blank.
 */

import { describe, expect, it } from 'vitest';

import { read, saysReading, saysValues, valuesIn, widthsFor } from '../src/preview/inspect';
import type { Change, Material } from '../src/preview/inspect';
import type { Pointed, Trace } from '../src/preview/point';
import type { Known } from '../src/design/drift';
import type { Usage } from '../src/design/usage';

const TOKENS: readonly Known[] = [
  { name: '--ink', value: '#18181b', kind: 'colour' },
  { name: '--accent', value: '#b8492c', kind: 'colour' },
  { name: '--paper', value: '#faf8f5', kind: 'colour' },
  { name: '--space-4', value: '16px', kind: 'space' },
  { name: '--radius', value: '8px', kind: 'radius' },
];

function clicked(extra: Partial<Pointed> = {}): Pointed {
  return {
    selector: 'section.pricing > button.buy',
    label: 'Start free',
    kind: 'button',
    rect: { x: 40, y: 320, width: 160, height: 44 },
    place: { nth: 2, of: 3, within: 'pricing' },
    view: { width: 1440, height: 900 },
    source: {
      html: '<button class="buy">Start free</button>',
      styles: {
        color: 'rgb(250, 248, 245)',
        'background-color': 'rgb(184, 73, 44)',
        'border-radius': '8px',
        'padding-top': '16px',
        'padding-right': '16px',
        'padding-bottom': '16px',
        'padding-left': '16px',
      },
    },
    ...extra,
  };
}

const FLOOR: readonly Trace[] = [
  { how: 'selector', selector: 'section.pricing > button.buy' },
  { how: 'markup', html: '<button class="buy">Start free</button>' },
  { how: 'text', text: 'Start free' },
];

function usage(): Usage {
  return {
    components: [
      {
        id: 'Buy@src/ui/Buy.tsx',
        name: 'Buy',
        file: 'src/ui/Buy.tsx',
        line: 12,
        shared: true,
        times: 3,
        used: [
          { file: 'src/ui/Buy.tsx', times: 1, lines: [12], screens: [], kind: 'source' },
          {
            file: 'src/pages/Pricing.tsx',
            times: 2,
            lines: [40, 61],
            screens: [{ route: '/pricing', name: 'Pricing' }],
            kind: 'source',
          },
          {
            file: 'src/pages/Home.tsx',
            times: 1,
            lines: [8],
            screens: [{ route: '/', name: 'Home' }],
            kind: 'source',
          },
        ],
        screens: [
          { route: '/pricing', name: 'Pricing' },
          { route: '/', name: 'Home' },
        ],
        unsure: [],
        says: 'Buy is used on two screens.',
      },
    ],
    read: 9,
    skipped: [],
    unsure: [],
    mayBeMore: false,
  };
}

const CHANGES = new Map<string, Change>([
  ['src/ui/Buy.tsx', { name: 'Make the buy button warmer', when: 1_000_000, id: 'a1b2c3d' }],
]);

const NOW = 1_000_000 + 3 * 60 * 60 * 1000;

/* ------------------------------------------------------------------ the chain */

describe('which component made it', () => {
  it('takes a build tool at its word when one stamped the element', () => {
    const reading = read(
      clicked({
        origin: [
          ...FLOOR,
          { how: 'owner', component: 'Buy' },
          { how: 'stamp', file: 'src/ui/Buy.tsx', line: 12, column: 4, component: 'Buy' },
          { how: 'stack', file: 'src/ui/Buy.js', line: 40, column: 1, mapped: false },
        ],
      }),
      { usage: usage(), tokens: TOKENS, changes: CHANGES, now: NOW },
    );

    expect(reading.made.how).toBe('stamp');
    expect(reading.made.sure).toBe('exact');
    expect(reading.made.component).toBe('Buy');
    expect(reading.made.where).toEqual({ file: 'src/ui/Buy.tsx', line: 12, column: 4 });
    expect(reading.made.says).toBe('Buy made this — Buy.tsx, line 12.');
    expect(reading.unsure).toEqual([]);
  });

  it('puts the stack together with the owner, since neither knows both halves', () => {
    const reading = read(
      clicked({
        origin: [
          ...FLOOR,
          { how: 'owner', component: 'Buy' },
          { how: 'stack', file: 'src/ui/Buy.tsx', line: 12, column: 4, mapped: true },
        ],
      }),
    );

    expect(reading.made.how).toBe('stack');
    expect(reading.made.sure).toBe('exact');
    expect(reading.made.component).toBe('Buy');
    expect(reading.made.where?.line).toBe(12);
  });

  it('says so when the file is the one running rather than the one written', () => {
    const reading = read(
      clicked({
        origin: [...FLOOR, { how: 'stack', file: 'assets/index-4f2.js', line: 900, mapped: false }],
      }),
    );

    expect(reading.made.sure).toBe('likely');
    expect(reading.unsure).toContain('That file is the one the page is running, not the one you wrote.');
    expect(reading.unsure).toContain('I could not work out what that component is called.');
  });

  it('names the component off the project when only the name came back', () => {
    const reading = read(clicked({ origin: [...FLOOR, { how: 'owner', component: 'Buy' }] }), {
      usage: usage(),
    });

    expect(reading.made.how).toBe('owner');
    expect(reading.made.sure).toBe('likely');
    expect(reading.made.where).toEqual({ file: 'src/ui/Buy.tsx', line: 12 });
    expect(reading.made.alsoIn).toEqual(['src/pages/Pricing.tsx', 'src/pages/Home.tsx']);
    expect(reading.made.screens).toEqual(['Pricing', 'Home']);
  });

  it('falls to something to go looking for on a page that answers nothing', () => {
    const reading = read(clicked({ origin: FLOOR }));

    expect(reading.made.how).toBe('selector');
    expect(reading.made.sure).toBe('guess');
    expect(reading.made.find).toBe('Start free');
    expect(reading.made.says).toBe(
      'I could not work out which component made this. Look for Start free.',
    );
    expect(reading.unsure).toContain('I could not work out which component made this.');
  });

  it('still answers when the page worked nothing out at all', () => {
    const reading = read(clicked({ origin: [] }));

    expect(reading.title).toContain('button');
    expect(reading.made.find).toBe('section.pricing > button.buy');
    expect(reading.widths.all).toHaveLength(3);
    expect(reading.unsure.length).toBeGreaterThan(0);
  });

  it('never throws on an element with nothing on it', () => {
    const bare: Pointed = { selector: 'div', label: 'the block', rect: { x: 0, y: 0, width: 0, height: 0 } };
    const reading = read(bare);
    expect(reading.made.find).toBe('div');
    expect(reading.using).toEqual([]);
  });
});

/* ----------------------------------------------------------------- the values */

describe('which of the project\'s own values are in play', () => {
  it('names a colour the element is using, however the browser wrote it', () => {
    const reading = read(clicked({ origin: FLOOR }), { tokens: TOKENS });
    const said = reading.using.map((one) => one.says);

    expect(said).toContain('The background is your accent.');
    expect(said).toContain('The text is your paper.');
    expect(reading.using.find((one) => one.what === 'the background')?.name).toBe('--accent');
  });

  it('collapses four equal sides into the one decision somebody made', () => {
    const reading = read(clicked({ origin: FLOOR }), { tokens: TOKENS });
    const padding = reading.using.filter((one) => one.what.startsWith('the padding'));

    expect(padding).toHaveLength(1);
    expect(padding[0]?.what).toBe('the padding');
    expect(padding[0]?.says).toBe('The padding is your space 4.');
  });

  it('catches a colour a hair off one of them', () => {
    const found = valuesIn({ 'background-color': 'rgb(185, 74, 45)' }, TOKENS);

    expect(found.using).toEqual([]);
    expect(found.adrift).toHaveLength(1);
    expect(found.adrift[0]?.mine.name).toBe('--accent');
    expect(found.adrift[0]?.confidence).toBe('sure');
    expect(found.adrift[0]?.says).toBe('This is nearly your accent, but not quite.');
    expect(found.adrift[0]?.detail).toContain('#b8492c');
    expect(found.adrift[0]?.says).not.toContain('#');
  });

  it('catches a size a hair off one of them', () => {
    const found = valuesIn({ 'padding-top': '15px' }, TOKENS);

    expect(found.adrift).toHaveLength(1);
    expect(found.adrift[0]?.what).toBe('the padding above');
    expect(found.adrift[0]?.mine.name).toBe('--space-4');
  });

  it('leaves a decision alone rather than calling it a slip', () => {
    expect(valuesIn({ 'background-color': 'rgb(20, 200, 90)' }, TOKENS).adrift).toEqual([]);
    expect(valuesIn({ color: 'rgb(0, 0, 0)' }, TOKENS).using).toEqual([]);
    expect(valuesIn({ 'padding-top': '96px' }, TOKENS).adrift).toEqual([]);
  });

  it('reads the values off the page when the project has none of its own', () => {
    const pointed = clicked({ origin: FLOOR });
    pointed.source = {
      ...pointed.source!,
      vars: { '--accent': '#b8492c', '--space-4': '16px' },
    };
    const reading = read(pointed, {});

    expect(reading.using.map((one) => one.name)).toContain('--accent');
    expect(reading.unsure).not.toContain(
      'I could not find any of your own values to compare this against.',
    );
  });

  it('says so when there is nothing to compare against', () => {
    const reading = read(clicked({ origin: FLOOR }), {});
    expect(reading.unsure).toContain(
      'I could not find any of your own values to compare this against.',
    );
  });

  it('has one line for the whole list', () => {
    const clean = read(clicked({ origin: FLOOR }), { tokens: TOKENS });
    expect(saysValues(clean)).toBe('Everything here uses your own values.');

    const off = read(
      clicked({
        origin: FLOOR,
        source: { html: '', styles: { 'background-color': 'rgb(185, 74, 45)', color: '#18181b' } },
      }),
      { tokens: TOKENS },
    );
    expect(saysValues(off)).toBe('One value here is not quite yours.');
  });
});

/* ---------------------------------------------------------------- when it moved */

describe('when it last changed', () => {
  it('names the change, in the words somebody gave it', () => {
    const reading = read(
      clicked({
        origin: [...FLOOR, { how: 'stamp', file: 'src/ui/Buy.tsx', line: 12, component: 'Buy' }],
      }),
      { changes: CHANGES, now: NOW },
    );

    expect(reading.changed?.name).toBe('Make the buy button warmer');
    expect(reading.changed?.says).toBe('Last changed 3 hours ago, in "Make the buy button warmer".');
    expect(reading.changed?.id).toBe('a1b2c3d');
  });

  it('says it could not tell rather than leaving a blank', () => {
    const reading = read(
      clicked({
        origin: [...FLOOR, { how: 'stamp', file: 'src/ui/Other.tsx', line: 3, component: 'Other' }],
      }),
      { changes: CHANGES, now: NOW },
    );

    expect(reading.changed).toBeNull();
    expect(reading.unsure).toContain('I could not work out when this last changed.');
  });

  it('asks nothing about a change when it never found a file', () => {
    const reading = read(clicked({ origin: FLOOR }), { changes: CHANGES, now: NOW });
    expect(reading.changed).toBeNull();
    expect(reading.unsure).not.toContain('I could not work out when this last changed.');
  });
});

/* ------------------------------------------------------------- the other widths */

describe('what it looks like at the other widths', () => {
  it('marks the one being looked at and names the rest', () => {
    const widths = widthsFor({}, clicked());

    expect(widths.all.filter((one) => one.here).map((one) => one.name)).toEqual(['Desktop']);
    expect(widths.says).toBe('You are looking at this on Desktop. Here it is on Phone and Tablet.');
  });

  it('takes the nearest size, because nobody has their window at exactly 1440', () => {
    const widths = widthsFor({}, clicked({ view: { width: 402, height: 874 } }));
    expect(widths.all.find((one) => one.here)?.name).toBe('Phone');
  });

  it('uses the sizes the project designs at when it has said', () => {
    const material: Material = {
      widths: [
        { id: 'narrow', name: 'Narrow', width: 640, height: 900 },
        { id: 'wide', name: 'Wide', width: 1280, height: 900 },
      ],
    };
    const widths = widthsFor(material, clicked());
    expect(widths.all.map((one) => one.name)).toEqual(['Narrow', 'Wide']);
    expect(widths.all.find((one) => one.here)?.name).toBe('Wide');
  });

  it('still offers the sizes when the click never said how wide the page was', () => {
    const widths = widthsFor({}, clicked({ view: undefined }));
    expect(widths.all.every((one) => !one.here)).toBe(true);
    expect(widths.says).toBe('Here it is on Phone, Tablet and Desktop.');
  });
});

/* ------------------------------------------------------------------ handing it on */

describe('the same reading, for the agent that gets asked to change it', () => {
  it('carries the file, the component, the values and the doubts', () => {
    const reading = read(
      clicked({
        origin: [...FLOOR, { how: 'stamp', file: 'src/ui/Buy.tsx', line: 12, component: 'Buy' }],
      }),
      { tokens: TOKENS, usage: usage(), changes: CHANGES, now: NOW },
    );
    const said = saysReading(reading);

    expect(said).toContain('Buy made this — Buy.tsx, line 12.');
    expect(said).toContain('Also used in src/pages/Pricing.tsx and src/pages/Home.tsx.');
    expect(said).toContain('Appears on Pricing and Home.');
    expect(said).toContain('Make the buy button warmer');
    expect(said).toContain('The background is your accent.');
  });

  it('says what it could not work out, on a page it knows nothing about', () => {
    const said = saysReading(read(clicked({ origin: FLOOR })));
    expect(said).toContain('I could not work out which component made this.');
    expect(said).toContain('Look for Start free.');
  });
});
