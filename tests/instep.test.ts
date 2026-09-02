/** A Figma file that has moved on since the work was built from it.
 *
 * Two things are being checked and they fail differently. The comparison is
 * arithmetic over two readings: wrong, and the panel is a confident claim about
 * somebody else's design that is not true. The wording is language: wrong, and
 * it reads like a machine reporting a diff, which is the one thing this
 * interface is not allowed to sound like.
 *
 * Nothing in this file touches the network. The reader is always a fake.
 */

import { describe, expect, it } from 'vitest';

import {
  findMoved,
  nameOfDesign,
  readDesign,
  readHeld,
  said,
  saysInStep,
  saysMoved,
  MOST_MOVES,
  NOTHING_FOLLOWED,
  SAME_COLOUR,
  type Design,
  type Move,
} from '../src/design/moved';
import { follow, throughFigma } from '../src/design/follow';
import type { FigmaReader, Frame, TokenSet } from '../src/design/figma';

/* ========================================================================== */
/* Two readings, to move between                                               */
/* ========================================================================== */

const NO_VALUES: TokenSet = { colors: {}, spacing: {}, text: {} };

function design(over: Partial<Design> = {}): Design {
  return { frames: [], values: { ...NO_VALUES }, ...over };
}

function withColours(colors: Record<string, string>): Design {
  return design({ values: { ...NO_VALUES, colors } });
}

function withSpacing(spacing: Record<string, string>): Design {
  return design({ values: { ...NO_VALUES, spacing } });
}

function withText(text: Record<string, string>): Design {
  return design({ values: { ...NO_VALUES, text } });
}

function one(moves: readonly Move[]): Move {
  expect(moves).toHaveLength(1);
  const only = moves[0];
  if (only === undefined) throw new Error('no move');
  return only;
}

/* ========================================================================== */
/* Nothing moved                                                               */
/* ========================================================================== */

describe('two readings that agree', () => {
  const built = design({
    frames: [{ id: '1:23', name: 'Header', width: 1440, height: 96 }],
    values: {
      colors: { brand: '#b8492c' },
      spacing: { gutter: '24px' },
      text: { 'font-family-heading': 'Söhne' },
    },
  });

  it('finds nothing at all', () => {
    expect(findMoved(built, built)).toEqual([]);
  });

  it('finds nothing in a copy rather than the same object', () => {
    expect(findMoved(built, JSON.parse(JSON.stringify(built)) as Design)).toEqual([]);
  });

  it('says so, naming the file, rather than saying nothing', () => {
    expect(saysInStep('Header', [])).toBe('Nothing in Header has moved since this was built.');
  });

  it('finds nothing between two files that hold nothing', () => {
    expect(findMoved(design(), design())).toEqual([]);
  });
});

/* ========================================================================== */
/* A value that changed                                                        */
/* ========================================================================== */

describe('a colour that changed', () => {
  it('says the name the designer gave it, and which way it went', () => {
    const move = one(
      findMoved(
        withColours({ 'color-brand-primary': '#b8492c' }),
        withColours({ 'color-brand-primary': '#8f3620' }),
      ),
    );
    expect(move.kind).toBe('colour');
    expect(move.what).toBe('changed');
    expect(move.thing).toBe('brand primary');
    expect(move.says).toBe('Your brand primary in Figma is deeper than this was built from.');
  });

  it('says lighter when it went the other way', () => {
    const move = one(
      findMoved(withColours({ brand: '#8f3620' }), withColours({ brand: '#b8492c' })),
    );
    expect(move.says).toContain('lighter');
  });

  it('names the colour it has become when it is a different colour entirely', () => {
    const move = one(
      findMoved(
        withColours({ 'color-brand': '#1f6feb' }),
        withColours({ 'color-brand': '#c0392b' }),
      ),
    );
    expect(move.says).toBe('Your brand in Figma is red now, where this was built from blue.');
  });

  it('falls back to the colour itself when the name says nothing', () => {
    const move = one(findMoved(withColours({ color: '#1f6feb' }), withColours({ color: '#1466e0' })));
    expect(move.thing).toBe('blue');
  });

  it('hears a colour that only became more see-through', () => {
    const move = one(
      findMoved(withColours({ scrim: '#00000080' }), withColours({ scrim: '#00000040' })),
    );
    expect(move.says).toBe('Your scrim in Figma is more see-through than this was built from.');
  });

  it('hears one that became less see-through', () => {
    const move = one(
      findMoved(withColours({ scrim: '#00000040' }), withColours({ scrim: '#000000cc' })),
    );
    expect(move.says).toContain('less see-through');
  });

  it('carries both values for the swatches and for "Show me", never in the sentence', () => {
    const move = one(
      findMoved(withColours({ brand: '#b8492c' }), withColours({ brand: '#8f3620' })),
    );
    expect(move.was).toBe('#b8492c');
    expect(move.now).toBe('#8f3620');
    expect(move.detail).toBe('brand: #b8492c → #8f3620');
    expect(move.says).not.toContain('#');
  });

  it('measures how far it went, in the space an eye works in', () => {
    const near = one(findMoved(withColours({ a: '#b8492c' }), withColours({ a: '#b54628' })));
    const far = one(findMoved(withColours({ a: '#b8492c' }), withColours({ a: '#1f6feb' })));
    expect(far.distance).toBeGreaterThan(near.distance);
    expect(near.distance).toBeGreaterThan(0);
  });
});

describe('a size that changed', () => {
  it('says bigger, and keeps the designer’s own name for it', () => {
    const move = one(findMoved(withSpacing({ 'space-gutter': '24px' }), withSpacing({ 'space-gutter': '32px' })));
    expect(move.kind).toBe('size');
    expect(move.thing).toBe('space gutter');
    expect(move.says).toBe('Your space gutter in Figma is bigger than this was built from.');
  });

  it('says smaller the other way round', () => {
    const move = one(findMoved(withSpacing({ gap: '32px' }), withSpacing({ gap: '16px' })));
    expect(move.says).toContain('smaller');
  });

  it('reports the share it moved by, not the pixels', () => {
    const move = one(findMoved(withSpacing({ gap: '16px' }), withSpacing({ gap: '24px' })));
    expect(move.distance).toBeCloseTo(0.5, 4);
    expect(move.says).not.toMatch(/\d/);
  });
});

describe('type that changed', () => {
  it('hears a different typeface without pretending to know how it differs', () => {
    const move = one(
      findMoved(
        withText({ 'font-family-heading': 'Söhne' }),
        withText({ 'font-family-heading': 'Inter' }),
      ),
    );
    expect(move.kind).toBe('type');
    expect(move.says).toBe('Your font family heading in Figma has changed since this was built.');
  });

  it('hears a type size the same way it hears a spacing one', () => {
    const move = one(
      findMoved(withText({ 'font-size-body': '16px' }), withText({ 'font-size-body': '18px' })),
    );
    expect(move.says).toContain('bigger');
  });
});

/* ========================================================================== */
/* Gone, new, renamed                                                          */
/* ========================================================================== */

describe('a value that is not there any more', () => {
  it('says so, and keeps what it was', () => {
    const move = one(findMoved(withSpacing({ 'space-gutter': '24px' }), design()));
    expect(move.what).toBe('gone');
    expect(move.says).toBe('Space gutter is not in Figma any more.');
    expect(move.was).toBe('24px');
    expect(move.now).toBe(null);
  });
});

describe('a value that has just appeared', () => {
  it('says it is new rather than treating it as a problem', () => {
    const move = one(findMoved(design(), withSpacing({ 'space-huge': '64px' })));
    expect(move.what).toBe('new');
    expect(move.says).toBe('Space huge is new in Figma since this was built.');
    expect(move.was).toBe(null);
  });

  it('names a new colour by its own colour when the name says nothing', () => {
    const move = one(findMoved(design(), withColours({ colour: '#1f6feb' })));
    expect(move.says).toBe('Blue is new in Figma since this was built.');
  });
});

describe('the frames', () => {
  const header = { id: '1:23', name: 'Header', width: 1440, height: 96 };

  it('hears a frame that was renamed rather than saying one went and one came', () => {
    const moves = findMoved(
      design({ frames: [header] }),
      design({ frames: [{ ...header, name: 'Masthead' }] }),
    );
    const move = one(moves);
    expect(move.what).toBe('renamed');
    expect(move.says).toBe('Header is called Masthead in Figma now.');
  });

  it('hears a frame that got taller', () => {
    const move = one(
      findMoved(design({ frames: [header] }), design({ frames: [{ ...header, height: 128 }] })),
    );
    expect(move.says).toBe('Header is taller than this was built from.');
    expect(move.detail).toBe('1:23: 1440×96 → 1440×128');
  });

  it('hears a frame that got wider when its height stayed', () => {
    const move = one(
      findMoved(design({ frames: [header] }), design({ frames: [{ ...header, width: 1920 }] })),
    );
    expect(move.says).toContain('wider');
  });

  it('hears one that has gone, and one that has arrived', () => {
    const moves = findMoved(
      design({ frames: [header] }),
      design({ frames: [{ id: '4:56', name: 'Footer' }] }),
    );
    expect(moves.map((move) => move.says)).toEqual([
      'Header is not in Figma any more.',
      'Footer is new in Figma since this was built.',
    ]);
  });

  it('says nothing about a frame whose name only changed its spacing', () => {
    expect(
      findMoved(
        design({ frames: [{ id: '1:23', name: 'Header ' }] }),
        design({ frames: [{ id: '1:23', name: '  Header' }] }),
      ),
    ).toEqual([]);
  });
});

/* ========================================================================== */
/* What is left alone                                                          */
/* ========================================================================== */

describe('what is never flagged', () => {
  it('leaves a colour that only moved by the rounding a trip through hex costs', () => {
    expect(findMoved(withColours({ brand: '#b8492c' }), withColours({ brand: '#b8492d' }))).toEqual(
      [],
    );
  });

  it('holds that threshold where it was set rather than by accident', () => {
    expect(SAME_COLOUR).toBeLessThan(0.01);
    expect(SAME_COLOUR).toBeGreaterThan(0);
  });

  it('takes a wider threshold when it is given one', () => {
    const same = { sameColour: 1 };
    expect(findMoved(withColours({ a: '#1f6feb' }), withColours({ a: '#c0392b' }), same)).toEqual([]);
  });

  it('leaves a size that moved by less than half a pixel', () => {
    expect(findMoved(withSpacing({ gap: '16px' }), withSpacing({ gap: '16.2px' }))).toEqual([]);
  });

  it('leaves a frame whose height moved by less than half a pixel', () => {
    expect(
      findMoved(
        design({ frames: [{ id: '1:23', name: 'Header', height: 96 }] }),
        design({ frames: [{ id: '1:23', name: 'Header', height: 96.2 }] }),
      ),
    ).toEqual([]);
  });

  it('leaves a typeface that is only spelt with different spacing or case', () => {
    expect(findMoved(withText({ f: 'Söhne' }), withText({ f: '  söhne  ' }))).toEqual([]);
  });

  it('leaves a colour it cannot read on either side alone', () => {
    expect(findMoved(withColours({ a: 'var(--brand)' }), withColours({ a: '#b8492c' }))).toEqual([]);
    expect(findMoved(withColours({ a: '#b8492c' }), withColours({ a: 'oklch(0.6 0.1 40)' }))).toEqual(
      [],
    );
  });

  it('leaves a colour that is written differently and is the same colour', () => {
    expect(findMoved(withColours({ a: '#ff0000' }), withColours({ a: 'rgb(255, 0, 0)' }))).toEqual(
      [],
    );
  });

  it('leaves a size written in a unit it cannot compare', () => {
    expect(findMoved(withSpacing({ a: '50%' }), withSpacing({ a: '60%' }))).not.toHaveLength(0);
    expect(findMoved(withSpacing({ a: '50%' }), withSpacing({ a: '50%' }))).toEqual([]);
  });

  it('never grows past a list somebody would read', () => {
    const before: Record<string, string> = {};
    const after: Record<string, string> = {};
    for (let at = 0; at < 80; at += 1) {
      before[`gap-${String(at)}`] = '16px';
      after[`gap-${String(at)}`] = '24px';
    }
    expect(findMoved(withSpacing(before), withSpacing(after))).toHaveLength(MOST_MOVES);
  });

  it('takes a shorter list when it is asked for one', () => {
    const before = { a: '16px', b: '16px', c: '16px' };
    const after = { a: '24px', b: '24px', c: '24px' };
    expect(findMoved(withSpacing(before), withSpacing(after), { most: 2 })).toHaveLength(2);
  });
});

/* ========================================================================== */
/* Order and identity                                                          */
/* ========================================================================== */

describe('the order things are said in', () => {
  const built = design({
    frames: [{ id: '1:23', name: 'Header' }, { id: '9:9', name: 'Footer' }],
    values: { ...NO_VALUES, colors: { brand: '#1f6feb', old: '#123456' }, spacing: { gap: '16px' } },
  });
  const now = design({
    frames: [{ id: '1:23', name: 'Masthead' }],
    values: { ...NO_VALUES, colors: { brand: '#c0392b', fresh: '#00ff00' }, spacing: { gap: '24px' } },
  });
  const moves = findMoved(built, now);

  it('leads with what changed, before what came and went', () => {
    const order = moves.map((move) => move.what);
    expect(order.indexOf('changed')).toBe(0);
    expect(order.lastIndexOf('changed')).toBeLessThan(order.indexOf('gone'));
    expect(order.indexOf('gone')).toBeLessThan(order.indexOf('new'));
  });

  it('gives every row an id of its own that does not move between readings', () => {
    const ids = moves.map((move) => move.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(findMoved(built, now).map((move) => move.id)).toEqual(ids);
  });

  it('says the same thing twice, and leaves what it was handed alone', () => {
    const copy = JSON.parse(JSON.stringify(built)) as Design;
    findMoved(built, now);
    expect(built).toEqual(copy);
    expect(findMoved(built, now)).toEqual(moves);
  });
});

/* ========================================================================== */
/* The headline                                                                */
/* ========================================================================== */

describe('the one line above the list', () => {
  const move = (id: string): Move => ({
    id,
    kind: 'colour',
    what: 'changed',
    thing: 'brand',
    was: '#000000',
    now: '#111111',
    distance: 0.1,
    says: 'x',
    detail: 'x',
    asks: 'x',
  });

  it('is the sentence, exactly', () => {
    expect(saysInStep('Header', [move('a'), move('b'), move('c')])).toBe(
      'Your Header in Figma has moved on since this was built: three things differ.',
    );
  });

  it('agrees in number for one', () => {
    expect(saysInStep('Header', [move('a')])).toContain('one thing differs');
  });

  it('counts in words as far as it is worth counting, then in figures', () => {
    const many = (count: number) => Array.from({ length: count }, (_, at) => move(String(at)));
    expect(saysInStep('X', many(10))).toContain('ten things differ');
    expect(saysInStep('X', many(11))).toContain('11 things differ');
  });

  it('ends in a full stop, whatever the shape', () => {
    for (const count of [0, 1, 2, 40]) {
      const many = Array.from({ length: count }, (_, at) => move(String(at)));
      expect(saysInStep('X', many)).toMatch(/\.$/);
    }
  });

  it('has something honest to say before anything is being followed', () => {
    expect(NOTHING_FOLLOWED).toMatch(/\.$/);
    expect(NOTHING_FOLLOWED).toContain('Figma');
  });
});

/* ========================================================================== */
/* What is said to bring the work back in step                                 */
/* ========================================================================== */

describe('the request that closes the gap', () => {
  it('carries the real values, because an instruction without them is not one', () => {
    const move = one(
      findMoved(withColours({ brand: '#b8492c' }), withColours({ brand: '#8f3620' }), {
        name: 'Header',
      }),
    );
    expect(move.asks).toContain('#b8492c');
    expect(move.asks).toContain('#8f3620');
    expect(move.asks).toContain('Header');
  });

  it('asks for something different of a value that has gone', () => {
    const move = one(findMoved(withSpacing({ gap: '16px' }), design(), { name: 'Header' }));
    expect(move.asks).toContain('gone');
    expect(move.asks).toContain('16px');
  });

  it('asks for a rename to go all the way through', () => {
    const move = one(
      findMoved(
        design({ frames: [{ id: '1:23', name: 'Header' }] }),
        design({ frames: [{ id: '1:23', name: 'Masthead' }] }),
        { name: 'Header' },
      ),
    );
    expect(move.asks).toContain('Masthead');
    expect(move.asks).toMatch(/rename/i);
  });
});

/* ========================================================================== */
/* Malformed input                                                             */
/* ========================================================================== */

describe('readings with holes in them', () => {
  const empty: Design = { frames: [], values: { colors: {}, spacing: {}, text: {} } };

  it('answers with nothing rather than throwing', () => {
    for (const rubbish of [undefined, null, 'not a reading', 42, [], {}, { frames: 'no' }]) {
      expect(readDesign(rubbish)).toEqual(empty);
    }
  });

  it('keeps the rows it can read and drops the rest', () => {
    const read = readDesign({
      frames: [
        null,
        { id: '1:23', name: 'Header' },
        { name: 'no id' },
        { id: '4:56' },
        { id: '1:23', name: 'a second Header' },
        { id: '7:8', name: 'Odd', width: 'wide', height: -4 },
      ],
      values: { colors: { a: '#fff', b: 12, '': '#000' }, spacing: null, text: 'no' },
    });
    expect(read.frames).toEqual([
      { id: '1:23', name: 'Header' },
      { id: '4:56', name: '4:56' },
      { id: '7:8', name: 'Odd' },
    ]);
    expect(read.values).toEqual({ colors: { a: '#fff' }, spacing: {}, text: {} });
  });

  it('compares two readings it had to salvage without throwing', () => {
    const built = readDesign({ values: { spacing: { gap: '16px' } } });
    const now = readDesign({ values: { spacing: { gap: '24px' } } });
    expect(findMoved(built, now)).toHaveLength(1);
  });

  it('survives being handed rubbish as a reading', () => {
    expect(findMoved(null as unknown as Design, undefined as unknown as Design)).toEqual([]);
  });
});

describe('what was kept, read back', () => {
  const kept = {
    id: 'KEY',
    name: 'Header',
    url: 'https://www.figma.com/design/KEY/Landing?node-id=1-23',
    fileKey: 'KEY',
    design: { frames: [{ id: '1:23', name: 'Header' }], values: { colors: { a: '#fff' } } },
    latest: { frames: [{ id: '1:23', name: 'Masthead' }], values: { colors: { a: '#fff' } } },
    readAt: 1_700_000_000_000,
  };

  it('comes back whole', () => {
    const held = readHeld(kept);
    expect(held?.name).toBe('Header');
    expect(held?.fileKey).toBe('KEY');
    expect(held?.readAt).toBe(1_700_000_000_000);
    expect(findMoved(held?.design ?? readDesign(null), held?.latest ?? readDesign(null))).toHaveLength(1);
  });

  it('is nothing at all when there is no file behind it', () => {
    for (const rubbish of [undefined, null, 'no', 42, [], {}, { name: 'Header' }]) {
      expect(readHeld(rubbish)).toBe(null);
    }
  });

  it('treats a row with no last reading as one that has never moved', () => {
    const held = readHeld({ ...kept, latest: undefined });
    expect(held).not.toBe(null);
    expect(findMoved(held?.design ?? readDesign(null), held?.latest ?? readDesign(null))).toEqual([]);
  });

  it('never carries a time it made up', () => {
    expect(readHeld({ ...kept, readAt: 'Tuesday' })?.readAt).toBe(0);
    expect(readHeld({ ...kept, readAt: Number.NaN })?.readAt).toBe(0);
  });
});

/* ========================================================================== */
/* Naming the thing being followed                                             */
/* ========================================================================== */

describe('what the file is called', () => {
  it('is the frame, when a frame is what somebody pointed at', () => {
    expect(
      nameOfDesign('https://www.figma.com/design/KEY/Landing-v4?node-id=1-23', [
        { id: '1:23', name: 'Header' },
      ]),
    ).toBe('Header');
  });

  it('is the file’s own name when no one frame was read', () => {
    expect(nameOfDesign('https://www.figma.com/design/KEY/Landing-v4')).toBe('Landing v4');
    expect(
      nameOfDesign('https://www.figma.com/design/KEY/Landing-v4', [
        { id: '1', name: 'A' },
        { id: '2', name: 'B' },
      ]),
    ).toBe('Landing v4');
  });

  it('reads a name that came through the address escaped', () => {
    expect(nameOfDesign('https://www.figma.com/design/KEY/Brand%20Kit')).toBe('Brand Kit');
  });

  it('says something honest when the address carries no name', () => {
    expect(nameOfDesign('https://www.figma.com/design/KEY')).toBe('that Figma file');
    expect(nameOfDesign('')).toBe('that Figma file');
  });
});

/* ========================================================================== */
/* The vocabulary                                                              */
/* ========================================================================== */

/** Every word this interface does not say, whoever wrote it down. */
const NEVER_SAID = /\b(git|commit|branch|staged|session|token|api|mcp|server|endpoint|sync|json|node id|variable|diff|payload|schema)\b/i;

describe('nothing here speaks the other vocabulary', () => {
  it('says none of it, over every shape a finding can take', () => {
    const built = design({
      frames: [{ id: '1:23', name: 'Header', height: 96 }, { id: '9:9', name: 'Footer' }],
      values: {
        colors: { 'token-color-brand': '#1f6feb', 'api-ink': '#111111', gone: '#654321' },
        spacing: { 'css-gap': '16px' },
        text: { 'font-family-heading': 'Söhne' },
      },
    });
    const now = design({
      frames: [{ id: '1:23', name: 'Header', height: 128 }, { id: '2:2', name: 'Sidebar' }],
      values: {
        colors: { 'token-color-brand': '#c0392b', 'api-ink': '#ffffff', fresh: '#00ff00' },
        spacing: { 'css-gap': '24px' },
        text: { 'font-family-heading': 'Inter' },
      },
    });

    const moves = findMoved(built, now, { name: 'Header' });
    expect(moves.length).toBeGreaterThan(6);
    for (const move of moves) {
      expect(move.says).not.toMatch(NEVER_SAID);
      expect(move.thing).not.toMatch(NEVER_SAID);
      expect(move.says).toMatch(/\.$/);
    }
    expect(saysInStep('Header', moves)).not.toMatch(NEVER_SAID);
  });

  it('takes the words we do not say out of somebody else’s naming', () => {
    expect(said('token-color-brand', 'colour', { r: 31, g: 111, b: 235, a: 1 })).toBe('brand');
    expect(said('css-var-gap', 'size')).toBe('gap');
    expect(said('token', 'size')).toBe('spacing');
    expect(said('api', 'type')).toBe('type');
  });

  it('never lets a value into a sentence', () => {
    for (const way of ['deeper', 'lighter', 'bigger', 'smaller', 'taller'] as const) {
      expect(saysMoved({ kind: 'colour', what: 'changed', thing: 'brand', way })).not.toMatch(/\d|#/);
    }
  });

  it('ends every sentence it can say in a full stop', () => {
    const shapes = [
      { kind: 'colour', what: 'changed', thing: 'brand' },
      { kind: 'colour', what: 'changed', thing: 'brand', becomes: 'red', from: 'blue' },
      { kind: 'size', what: 'changed', thing: 'gap', way: 'bigger' },
      { kind: 'type', what: 'changed', thing: 'heading' },
      { kind: 'frame', what: 'renamed', thing: 'Header', called: 'Masthead' },
      { kind: 'frame', what: 'gone', thing: 'Header' },
      { kind: 'frame', what: 'new', thing: 'Footer' },
    ] as const;
    for (const shape of shapes) expect(saysMoved(shape)).toMatch(/\.$/);
  });
});

/* ========================================================================== */
/* The thin half, with a fake reader                                           */
/* ========================================================================== */

function fakeReader(over: Partial<FigmaReader> = {}): FigmaReader & { asked: string[] } {
  const asked: string[] = [];
  const reader = {
    asked,
    frames(fileKey: string, nodeIds: readonly string[]): Promise<readonly Frame[]> {
      asked.push(`frames ${fileKey} ${nodeIds.join(',')}`);
      return Promise.resolve([{ id: '1:23', name: 'Header', image: 'https://example.test/a.png' }]);
    },
    tokens(fileKey: string): Promise<TokenSet> {
      asked.push(`values ${fileKey}`);
      return Promise.resolve({ colors: { brand: '#b8492c' }, spacing: {}, text: {} });
    },
    ...over,
  };
  return reader as FigmaReader & { asked: string[] };
}

describe('following a file', () => {
  it('asks for the frame in the address and the values of the file', async () => {
    const reader = fakeReader();
    const followed = await follow(
      'https://www.figma.com/design/8Kx2ABcd/Landing-v4?node-id=1-23',
      throughFigma(reader),
    );

    expect(reader.asked).toEqual(['frames 8Kx2ABcd 1:23', 'values 8Kx2ABcd']);
    expect(followed.fileKey).toBe('8Kx2ABcd');
    expect(followed.name).toBe('Header');
    expect(followed.design.frames).toEqual([{ id: '1:23', name: 'Header' }]);
    expect(followed.design.values.colors['brand']).toBe('#b8492c');
  });

  it('keeps no picture, because a Figma picture stops working', async () => {
    const followed = await follow(
      'https://www.figma.com/design/KEY/Landing?node-id=1-23',
      throughFigma(fakeReader()),
    );
    expect(JSON.stringify(followed.design)).not.toContain('example.test');
  });

  it('asks for no frames when the address points at no frame', async () => {
    const reader = fakeReader({ frames: () => Promise.resolve([]) });
    const followed = await follow('https://www.figma.com/design/KEY/Brand-Kit', throughFigma(reader));
    expect(followed.design.frames).toEqual([]);
    expect(followed.name).toBe('Brand Kit');
  });

  it('refuses something that is not a Figma address, before it asks anything', async () => {
    const reader = fakeReader();
    await expect(follow('the landing page, second frame', throughFigma(reader))).rejects.toThrow(
      /not a Figma link/,
    );
    expect(reader.asked).toEqual([]);
  });

  it('passes on the sentence Figma’s own trouble was already written as', async () => {
    const reader = fakeReader({
      frames: () => Promise.reject(new Error('That file is not shared with the account you connected.')),
    });
    await expect(
      follow('https://www.figma.com/design/KEY/Landing', throughFigma(reader)),
    ).rejects.toThrow('That file is not shared with the account you connected.');
  });

  it('never puts a number or a raw fault in front of anybody', async () => {
    const reader = fakeReader({ tokens: () => Promise.reject(new TypeError('fetch failed 500')) });
    const why = await follow('https://www.figma.com/design/KEY/Landing', throughFigma(reader))
      .then(() => null)
      .catch((cause: unknown) => (cause instanceof Error ? cause.message : String(cause)));
    // The reader writes those sentences; this only proves nothing is added.
    expect(why).toBe('fetch failed 500');
  });
});
