/** Which shelf a value lands on, and in what order.
 *
 * The band is dense enough that a wrong guess is loud: a colour on the spacing
 * shelf, a scale that does not climb, or the same name drawn twice because a
 * theme restated it. All of that is arithmetic and words, so it is settled here
 * rather than in front of a screen.
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  canShow,
  GROUP_ORDER,
  groupOf,
  groupTokens,
  MOST_IN_A_GROUP,
  readable,
  specimenSize,
} from '../src/design/grouping';
import { readTokens, usesIn } from '../src/design/tokens';
import type { StyleToken } from '../src/lib/ipc';

let line = 0;

function make(
  name: string,
  value: string,
  kind: StyleToken['kind'],
  used = 1,
): StyleToken {
  line += 1;
  return { name, value, kind, line, used, file: 'src/styles/tokens.css' };
}

const shelves = (tokens: readonly StyleToken[]): string[] =>
  groupTokens(tokens).map((group) => group.id);

const names = (tokens: readonly StyleToken[], id: string): string[] =>
  groupTokens(tokens)
    .find((group) => group.id === id)
    ?.tokens.map((token) => token.name) ?? [];

/* ========================================================================== */
/* Which shelf                                                                 */
/* ========================================================================== */

describe('what shelf a value belongs on', () => {
  it('puts each kind where a designer would look for it', () => {
    expect(groupOf(make('--brand', '#3355ff', 'colour'))).toBe('colour');
    expect(groupOf(make('--space-2', '8px', 'space'))).toBe('spacing');
    expect(groupOf(make('--radius-md', '10px', 'radius'))).toBe('corners');
    expect(groupOf(make('--shadow-md', '0 4px 16px #0001', 'shadow'))).toBe('shadow');
  });

  it('separates the sizes that are type from the sizes that are furniture', () => {
    expect(groupOf(make('--text-base', '1rem', 'size'))).toBe('type');
    expect(groupOf(make('--font-lg', '20px', 'size'))).toBe('type');
    expect(groupOf(make('--heading-xl', '32px', 'size'))).toBe('type');
    expect(groupOf(make('--topbar-height', '38px', 'size'))).toBe('size');
    expect(groupOf(make('--icon-sm', '16px', 'size'))).toBe('size');
  });

  it('drops anything it cannot place onto the last shelf rather than guessing', () => {
    expect(groupOf(make('--dur-ui', '200ms', 'other'))).toBe('other');
  });

  it('survives a kind it has never heard of', () => {
    const strange = { ...make('--mystery', '3', 'other'), kind: 'gradient' };
    expect(groupOf(strange as unknown as StyleToken)).toBe('other');
    expect(shelves([strange as unknown as StyleToken])).toEqual(['other']);
  });
});

describe('what is worth drawing', () => {
  it('shows every kind it can place a value in', () => {
    expect(canShow(make('--brand', '#3355ff', 'colour'))).toBe(true);
    expect(canShow(make('--space-2', '8px', 'space'))).toBe(true);
    expect(canShow(make('--shadow-md', '0 4px 16px #0001', 'shadow'))).toBe(true);
  });

  it('shows a font family, because the design system is where fonts are read', () => {
    expect(canShow(make('--font-ui', 'Inter, sans-serif', 'other'))).toBe(true);
    expect(shelves([make('--font-ui', 'Inter, sans-serif', 'other')])).toEqual(['type']);
  });

  /* A duration, a unit, a grid: not a colour or a size, and still a decision
     somebody wrote in the file and will come here to look up. */
  it('shows a value that is a number even when it is neither', () => {
    expect(canShow(make('--dur-ui', '200ms', 'other'))).toBe(true);
    expect(canShow(make('--columns', '12', 'other'))).toBe(true);
    expect(shelves([make('--dur-ui', '200ms', 'other')])).toEqual(['other']);
  });

  it('leaves out anything that is only prose in a custom property', () => {
    expect(canShow(make('--brand', 'some prose that is not a value', 'other'))).toBe(false);
    expect(shelves([make('--brand', 'some prose', 'other')])).toEqual([]);
  });
});

/* ========================================================================== */
/* Grouping                                                                    */
/* ========================================================================== */

describe('grouping a project', () => {
  it('has nothing to say about a project with no styles', () => {
    expect(groupTokens([])).toEqual([]);
  });

  it('returns the shelves in the same order every time', () => {
    const mixed = [
      make('--shadow-md', '0 4px 16px #0001', 'shadow'),
      make('--topbar-height', '38px', 'size'),
      make('--space-2', '8px', 'space'),
      make('--brand', '#3355ff', 'colour'),
      make('--text-base', '16px', 'size'),
      make('--radius-md', '10px', 'radius'),
    ];
    expect(shelves(mixed)).toEqual(['colour', 'type', 'spacing', 'corners', 'shadow', 'size']);
    expect(shelves(mixed)).toEqual(shelves([...mixed].reverse()));
  });

  it('never returns a shelf with nothing on it', () => {
    const groups = groupTokens([make('--brand', '#3355ff', 'colour')]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.id).toBe('colour');
    expect(groups.every((group) => group.tokens.length > 0)).toBe(true);
  });

  it('lays a shelf out in the order it will be read', () => {
    const ids = groupTokens([
      make('--brand', '#3355ff', 'colour'),
      make('--space-2', '8px', 'space'),
    ]).map((group) => group.id);
    for (const id of ids) expect(GROUP_ORDER).toContain(id);
  });

  it('gives every shelf a name a designer would use', () => {
    const titles = groupTokens([
      make('--brand', '#3355ff', 'colour'),
      make('--radius-md', '10px', 'radius'),
    ]).map((group) => group.title);
    expect(titles).toEqual(['Colour', 'Corners']);
    for (const title of titles) {
      expect(title).not.toMatch(/token|variable|css|property/i);
      expect(title).toMatch(/^[A-Z]/);
    }
  });

  it('draws the same name once, keeping the declaration the file wins with', () => {
    const themed = [
      make('--brand', '#3355ff', 'colour'),
      make('--brand', '#7799ff', 'colour'),
      make('--brand', '#88aaff', 'colour'),
    ];
    const colours = groupTokens(themed)[0]?.tokens ?? [];
    expect(colours).toHaveLength(1);
    expect(colours[0]?.value).toBe('#3355ff');
  });

  it('draws every value it was given, and each one once', () => {
    const groups = groupTokens([
      make('--brand', '#3355ff', 'colour'),
      make('--paper', '#ffffff', 'colour'),
      make('--space-2', '8px', 'space'),
      make('--font-ui', 'Inter, sans-serif', 'other'),
    ]);
    const drawn = groups.flatMap((group) => group.tokens.map((token) => token.name));
    expect(drawn.toSorted()).toEqual(['--brand', '--font-ui', '--paper', '--space-2']);
  });
});

/* ========================================================================== */
/* Order within a shelf                                                        */
/* ========================================================================== */

describe('the order values sit in on a shelf', () => {
  it('makes a scale climb, however the file lists it', () => {
    const jumbled = [
      make('--space-4', '16px', 'space'),
      make('--space-1', '4px', 'space'),
      make('--space-8', '72px', 'space'),
      make('--space-2', '8px', 'space'),
    ];
    expect(names(jumbled, 'spacing')).toEqual(['--space-1', '--space-2', '--space-4', '--space-8']);
  });

  it('compares sizes across units rather than by their digits', () => {
    const mixed = [
      make('--text-lg', '1.5rem', 'size'),
      make('--text-sm', '13px', 'size'),
      make('--text-base', '1rem', 'size'),
    ];
    expect(names(mixed, 'type')).toEqual(['--text-sm', '--text-base', '--text-lg']);
  });

  it('leaves the palette in the order somebody wrote it', () => {
    const palette = [
      make('--ink', '#111111', 'colour'),
      make('--accent', '#b8492c', 'colour'),
      make('--paper', '#ffffff', 'colour'),
    ];
    expect(names(palette, 'colour')).toEqual(['--ink', '--accent', '--paper']);
  });

  it('puts a value it cannot measure after the scale, not inside it', () => {
    const odd = [
      make('--space-fluid', 'clamp(1rem, 2vw, 2rem)', 'space'),
      make('--space-2', '8px', 'space'),
      make('--space-1', '4px', 'space'),
    ];
    expect(names(odd, 'spacing')).toEqual(['--space-1', '--space-2', '--space-fluid']);
  });

  it('keeps two values of the same size in the order they were declared', () => {
    const tied = [make('--gap-b', '8px', 'space'), make('--gap-a', '8px', 'space')];
    expect(names(tied, 'spacing')).toEqual(['--gap-b', '--gap-a']);
  });
});

/* ========================================================================== */
/* The upper bound                                                             */
/* ========================================================================== */

describe('a shelf that will not end', () => {
  const many = Array.from({ length: 60 }, (_, at) =>
    make(`--c-${String(at)}`, '#3355ff', 'colour'),
  );

  it('stops at a length a panel can hold, and says how many are left', () => {
    const shelf = groupTokens(many)[0];
    expect(shelf?.tokens).toHaveLength(MOST_IN_A_GROUP);
    expect(shelf?.hidden).toBe(60 - MOST_IN_A_GROUP);
  });

  it('says nothing is hidden when nothing is', () => {
    const shelf = groupTokens(many.slice(0, 4))[0];
    expect(shelf?.hidden).toBe(0);
    expect(shelf?.tokens).toHaveLength(4);
  });

  it('takes whatever bound its caller asks for', () => {
    const shelf = groupTokens(many, 5)[0];
    expect(shelf?.tokens).toHaveLength(5);
    expect(shelf?.hidden).toBe(55);
  });

  it('caps each shelf on its own', () => {
    const spacing = [4, 8, 12, 16].map((step) => make(`--s-${String(step)}`, `${String(step)}px`, 'space'));
    const both = [...many.slice(0, 10), ...spacing];
    const groups = groupTokens(both, 6);
    expect(groups.map((group) => group.tokens.length)).toEqual([6, 4]);
    expect(groups.map((group) => group.hidden)).toEqual([4, 0]);
  });
});

/* ========================================================================== */
/* Words and sizes                                                             */
/* ========================================================================== */

describe('saying a name out loud', () => {
  it('drops the dashes a file needs and a person does not', () => {
    expect(readable('--accent-soft')).toBe('accent soft');
    expect(readable('--space-4')).toBe('space 4');
    expect(readable('brand')).toBe('brand');
  });

  it('gives back something rather than nothing for an odd name', () => {
    expect(readable('--')).toBe('--');
    expect(readable('  ')).toBe('');
  });
});

describe('how large a specimen is drawn', () => {
  it('reads a size in the units a stylesheet is written in', () => {
    expect(specimenSize('20px')).toBe(20);
    expect(specimenSize('1rem')).toBe(16);
    expect(specimenSize('1.125em')).toBe(18);
  });

  it('keeps a loud step inside the panel', () => {
    expect(specimenSize('4rem')).toBe(34);
    expect(specimenSize('2px')).toBe(9);
    expect(specimenSize('4rem', 9, 48)).toBe(48);
  });

  it('has no size to offer for something that is not one', () => {
    expect(specimenSize('bold')).toBeNull();
    expect(specimenSize('clamp(1rem, 2vw, 2rem)')).toBeNull();
    expect(specimenSize('0')).toBeNull();
    expect(specimenSize('-2px')).toBeNull();
    expect(specimenSize('80%')).toBeNull();
  });
});

/* ========================================================================== */
/* The file this app ships with                                                */
/* ========================================================================== */

describe('grouping the tokens this app ships with', () => {
  const css = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');
  const uses = usesIn([css]);
  const read = readTokens(css);
  const ours: readonly StyleToken[] = read.map((token) => ({
    ...token,
    used: uses.get(token.name) ?? 0,
    file: 'src/styles/tokens.css',
  }));
  const groups = groupTokens(ours);
  const shelf = (id: string): readonly StyleToken[] =>
    groups.find((group) => group.id === id)?.tokens ?? [];

  it('finds a palette worth drawing as squares', () => {
    expect(shelf('colour').length).toBeGreaterThan(8);
    expect(shelf('colour').map((token) => token.name)).toContain('--accent');
  });

  it('finds the spacing scale, in order', () => {
    const spacing = shelf('spacing').map((token) => token.value);
    expect(spacing).toContain('4px');
    expect(spacing).toEqual([...spacing].sort((a, b) => parseFloat(a) - parseFloat(b)));
  });

  it('finds a type scale it can draw at size', () => {
    const type = shelf('type');
    expect(type.map((token) => token.name)).toContain('--text-base');
    /* Sizes are drawn at size; the family stacks ride at the head of the shelf. */
    const sized = type.filter((token) => specimenSize(token.value) !== null);
    expect(sized.length).toBeGreaterThan(0);
    expect(sized.every((token) => specimenSize(token.value) !== null)).toBe(true);
  });

  it('names the families it types in', () => {
    const type = shelf('type').map((token) => token.name);
    expect(type).toContain('--font-ui');
    expect(type).toContain('--font-mono');
  });

  it('keeps the window furniture off the type shelf', () => {
    const type = shelf('type').map((token) => token.name);
    expect(type).not.toContain('--topbar-height');
    expect(shelf('size').map((token) => token.name)).toContain('--topbar-height');
  });

  it('draws every shadow it found', () => {
    expect(shelf('shadow').map((token) => token.name)).toContain('--shadow-sm');
  });

  it('never offers the same name twice', () => {
    const drawn = groups.flatMap((group) => group.tokens.map((token) => token.name));
    expect(new Set(drawn).size).toBe(drawn.length);
  });

  /* The column that makes the band worth reading: a value the whole app leans
     on and a value nothing has reached for yet look identical without it. */
  it('knows which of its own values the app actually uses', () => {
    const asked = ours.find((token) => token.name === '--accent');
    const never = ours.find((token) => token.name === '--dur-exit');
    expect(asked?.used ?? 0).toBeGreaterThan(0);
    expect(never?.used).toBe(0);
  });
});
