/** The turn, said in design words.
 *
 * Two things are tested here and they fail differently. Reading the changes is
 * arithmetic over text: wrong, and the sentence is a confident lie about
 * somebody's own work. Saying them is language: wrong, and it reads like a
 * machine, which is the one thing this interface is not allowed to sound like.
 */

import { describe, expect, it } from 'vitest';

import {
  inDesignWords,
  NOTHING_TO_SAY,
  readChanges,
  type Change,
  type Edit,
} from '../src/design/words';

function only(edits: readonly Edit[]): readonly Change[] {
  return readChanges(edits);
}

function find(changes: readonly Change[], property: string): Change | undefined {
  return changes.find((one) => one.property === property);
}

/* ========================================================================== */
/* D-01 plain CSS                                                              */
/* ========================================================================== */

describe('D-01 plain CSS', () => {
  const before = `
    .card {
      padding: 16px;
      border-radius: 8px;
      background: #FFFFFF;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
    }
    .card--wide { padding: 16px; }
    .card--tall { padding: 16px; }
  `;
  const after = `
    .card {
      padding: 24px;
      border-radius: 12px;
      background: #F8FAFC;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
    }
    .card--wide { padding: 24px; }
    .card--tall { padding: 24px; }
  `;

  const changes = only([{ file: 'src/components/Card.css', before, after }]);

  it('counts the same change in three places once, with a count of three', () => {
    const spacing = find(changes, 'padding');
    expect(spacing).toEqual({
      kind: 'spacing',
      property: 'padding',
      from: '16',
      to: '24',
      where: 'card',
      count: 3,
    });
  });

  it('drops the unit, because a designer says sixteen, not sixteen pixels', () => {
    expect(find(changes, 'padding')?.from).toBe('16');
    expect(find(changes, 'border-radius')?.to).toBe('12');
  });

  it('classifies corners, colour and shadow', () => {
    expect(find(changes, 'border-radius')?.kind).toBe('radius');
    expect(find(changes, 'background')?.kind).toBe('colour');
    expect(find(changes, 'box-shadow')?.kind).toBe('shadow');
  });

  it('lowercases a colour so #FFFFFF and #ffffff are one value', () => {
    expect(find(changes, 'background')?.from).toBe('#ffffff');
  });

  it('leads with the change that happened most', () => {
    expect(inDesignWords(changes)).toMatch(/^Spacing on three cards, from 16 to 24/);
  });

  it('reads type, colour and layout out of a realistic stylesheet', () => {
    const found = only([
      {
        file: 'src/styles/Header.css',
        before: '.header { display: block; color: #111; font-size: 14px; font-weight: 400; }',
        after: '.header { display: flex; color: #333; font-size: 16px; font-weight: 600; }',
      },
    ]);
    expect(find(found, 'display')?.kind).toBe('layout');
    expect(find(found, 'color')?.kind).toBe('colour');
    expect(find(found, 'font-size')?.kind).toBe('type');
    expect(find(found, 'font-weight')?.kind).toBe('type');
    expect(find(found, 'font-size')).toMatchObject({ from: '14', to: '16', where: 'header' });
  });

  it('reads margin, gap and position too', () => {
    const found = only([
      {
        file: 'Grid.css',
        before: '.grid { margin: 0; gap: 8px; position: static; }',
        after: '.grid { margin: 8px; gap: 16px; position: sticky; }',
      },
    ]);
    expect(find(found, 'margin')?.kind).toBe('spacing');
    expect(find(found, 'gap')?.kind).toBe('spacing');
    expect(find(found, 'position')?.kind).toBe('layout');
  });

  it('says nothing about a property that is not a design decision', () => {
    const found = only([
      {
        file: 'Card.css',
        before: '.card { z-index: 1; overflow: hidden; content: "a"; }',
        after: '.card { z-index: 4; overflow: visible; content: "b"; }',
      },
    ]);
    expect(found).toEqual([]);
  });

  it('leaves a value with several parts exactly as written', () => {
    const found = only([
      {
        file: 'Card.css',
        before: '.card { padding: 16px 24px; }',
        after: '.card { padding: 24px 32px; }',
      },
    ]);
    expect(find(found, 'padding')).toMatchObject({ from: '16px 24px', to: '24px 32px' });
  });
});

/* ========================================================================== */
/* D-02 CSS in JavaScript                                                      */
/* ========================================================================== */

describe('D-02 style objects', () => {
  const changes = only([
    {
      file: 'src/components/PriceCard.tsx',
      before: `
        const styles = {
          padding: 16,
          fontSize: 14,
          borderRadius: 8,
          backgroundColor: '#ffffff',
        };
      `,
      after: `
        const styles = {
          padding: 24,
          fontSize: 16,
          borderRadius: 12,
          backgroundColor: '#f8fafc',
        };
      `,
    },
  ]);

  it('reads camelCase keys as the properties they are', () => {
    expect(find(changes, 'font-size')).toMatchObject({ kind: 'type', from: '14', to: '16' });
    expect(find(changes, 'border-radius')?.kind).toBe('radius');
    expect(find(changes, 'background-color')?.kind).toBe('colour');
  });

  it('reads a bare number the same way it reads a pixel value', () => {
    expect(find(changes, 'padding')).toMatchObject({ from: '16', to: '24', where: 'card' });
  });

  it('reads a quoted value without its quotes', () => {
    expect(find(changes, 'background-color')).toMatchObject({
      from: '#ffffff',
      to: '#f8fafc',
    });
  });

  it('reads an inline style attribute inside JSX', () => {
    const found = only([
      {
        file: 'Hero.tsx',
        before: '<div style={{ paddingTop: 12, lineHeight: 1.2 }} />',
        after: '<div style={{ paddingTop: 20, lineHeight: 1.5 }} />',
      },
    ]);
    expect(find(found, 'padding-top')?.kind).toBe('spacing');
    expect(find(found, 'line-height')).toMatchObject({ kind: 'type', from: '1.2', to: '1.5' });
  });
});

/* ========================================================================== */
/* D-03 Tailwind class lists                                                   */
/* ========================================================================== */

describe('D-03 class lists', () => {
  it('turns p-4 → p-6 into spacing, from 16 to 24', () => {
    const found = only([
      {
        file: 'src/components/Card.tsx',
        before: '<article className="p-4 rounded-lg bg-white text-sm">',
        after: '<article className="p-6 rounded-xl bg-slate-50 text-base">',
      },
    ]);
    expect(find(found, 'padding')).toEqual({
      kind: 'spacing',
      property: 'padding',
      from: '16',
      to: '24',
      where: 'card',
      count: 1,
    });
    expect(find(found, 'border-radius')).toMatchObject({ kind: 'radius', from: 'lg', to: 'xl' });
    expect(find(found, 'background')).toMatchObject({ kind: 'colour', from: 'white' });
    expect(find(found, 'font-size')).toMatchObject({ kind: 'type', from: 'sm', to: 'base' });
  });

  it('counts three cards wearing the same class as three', () => {
    const row = (padding: string): string =>
      `<div className="${padding}" /><div className="${padding}" /><div className="${padding}" />`;
    const found = only([{ file: 'Card.tsx', before: row('p-4'), after: row('p-6') }]);
    expect(find(found, 'padding')?.count).toBe(3);
    expect(inDesignWords(found)).toBe('Spacing on three cards, from 16 to 24.');
  });

  it('reads gap, weight, colour and layout classes', () => {
    const found = only([
      {
        file: 'Toolbar.tsx',
        before: '<nav className="flex gap-2 font-medium text-slate-500 items-start">',
        after: '<nav className="grid gap-4 font-bold text-slate-900 items-center">',
      },
    ]);
    expect(find(found, 'gap')).toMatchObject({ kind: 'spacing', from: '8', to: '16' });
    expect(find(found, 'font-weight')).toMatchObject({ kind: 'type', from: 'medium', to: 'bold' });
    expect(find(found, 'color')?.kind).toBe('colour');
    expect(find(found, 'display')).toMatchObject({ kind: 'layout', from: 'flex', to: 'grid' });
  });

  it('reads a bare class list with no markup around it', () => {
    const found = only([
      { file: 'Button.txt', before: 'px-4 py-2 shadow-sm', after: 'px-6 py-3 shadow-lg' },
    ]);
    expect(find(found, 'padding-inline')).toMatchObject({ from: '16', to: '24' });
    expect(find(found, 'padding-block')).toMatchObject({ from: '8', to: '12' });
    expect(find(found, 'box-shadow')?.kind).toBe('shadow');
  });

  it('ignores the variant in front of a class', () => {
    const found = only([
      { file: 'Card.tsx', before: '<i className="md:p-4 hover:bg-blue-500" />', after: '<i className="md:p-8 hover:bg-blue-700" />' },
    ]);
    expect(find(found, 'padding')).toMatchObject({ from: '16', to: '32' });
    expect(find(found, 'background')).toMatchObject({ from: 'blue-500', to: 'blue-700' });
  });

  it('reads an arbitrary value in brackets', () => {
    const found = only([
      { file: 'Card.tsx', before: '<i className="p-[18px]" />', after: '<i className="p-[26px]" />' },
    ]);
    expect(find(found, 'padding')).toMatchObject({ from: '18', to: '26' });
  });

  it('says nothing about a border width, which is not a colour', () => {
    const found = only([
      { file: 'Card.tsx', before: '<i className="border-2" />', after: '<i className="border-4" />' },
    ]);
    expect(found).toEqual([]);
  });
});

/* ========================================================================== */
/* D-04 the quiet cases                                                        */
/* ========================================================================== */

describe('D-04 nothing to say', () => {
  it('finds nothing in an edit that changed nothing', () => {
    const same = '.card { padding: 16px; }';
    expect(only([{ file: 'Card.css', before: same, after: same }])).toEqual([]);
  });

  it('finds nothing in a file it cannot read', () => {
    expect(
      only([
        {
          file: 'logo.bin',
          before: ' PNG\r\n\n???? ‡‡‡ 89 fj',
          after: ' PNG\r\n\n%%%% ??? 04 zx',
        },
      ]),
    ).toEqual([]);
  });

  it('finds nothing in prose', () => {
    expect(
      only([
        {
          file: 'README.md',
          before: 'The cards are a little tight, and the shadow is heavy.',
          after: 'The cards have room now, and the shadow is lighter.',
        },
      ]),
    ).toEqual([]);
  });

  it('says so honestly rather than guessing', () => {
    expect(inDesignWords([])).toBe(NOTHING_TO_SAY);
    expect(NOTHING_TO_SAY).toMatch(/\.$/);
  });

  it('says nothing about a property that only appears afterwards', () => {
    const found = only([
      { file: 'Card.css', before: '.card { color: #111; }', after: '.card { color: #111; gap: 8px; }' },
    ]);
    expect(found).toEqual([]);
  });

  it('reads no edits as nothing', () => {
    expect(only([])).toEqual([]);
  });
});

/* ========================================================================== */
/* D-05 across files                                                           */
/* ========================================================================== */

describe('D-05 several files', () => {
  it('joins the same change in two files that are both cards', () => {
    const found = only([
      { file: 'src/components/Card.tsx', before: '<i className="p-4" />', after: '<i className="p-6" />' },
      { file: 'src/components/ProductCard.tsx', before: '<i className="p-4" />', after: '<i className="p-6" />' },
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ where: 'card', count: 2 });
  });

  it('keeps changes in different things apart', () => {
    const found = only([
      { file: 'Card.css', before: '.a { padding: 16px; }', after: '.a { padding: 24px; }' },
      { file: 'Button.css', before: '.b { padding: 16px; }', after: '.b { padding: 24px; }' },
    ]);
    expect(found).toHaveLength(2);
    expect(found.map((one) => one.where).sort()).toEqual(['button', 'card']);
  });

  it('calls a file named after the filing "the page"', () => {
    const found = only([
      { file: 'src/styles/globals.css', before: 'body { color: #111; }', after: 'body { color: #333; }' },
    ]);
    expect(found[0]?.where).toBe('page');
  });

  it('takes the last word of a compound name', () => {
    const found = only([
      { file: 'pricing-table.css', before: '.t { gap: 8px; }', after: '.t { gap: 16px; }' },
    ]);
    expect(found[0]?.where).toBe('table');
  });

  it('reads a CSS module the same as the component beside it', () => {
    const found = only([
      { file: 'Card.module.css', before: '.c { padding: 16px; }', after: '.c { padding: 24px; }' },
    ]);
    expect(found[0]?.where).toBe('card');
  });
});

/* ========================================================================== */
/* D-06 the sentence                                                           */
/* ========================================================================== */

describe('D-06 the sentence', () => {
  const change = (over: Partial<Change> = {}): Change => ({
    kind: 'spacing',
    property: 'padding',
    from: '16',
    to: '24',
    where: 'card',
    count: 3,
    ...over,
  });

  it('is the headline sentence, exactly', () => {
    expect(inDesignWords([change()])).toBe('Spacing on three cards, from 16 to 24.');
  });

  it('says "the card" for one, not "one card"', () => {
    expect(inDesignWords([change({ count: 1 })])).toBe('Spacing on the card, from 16 to 24.');
  });

  it('agrees in number all the way up', () => {
    expect(inDesignWords([change({ count: 2 })])).toContain('two cards');
    expect(inDesignWords([change({ count: 12 })])).toContain('twelve cards');
    expect(inDesignWords([change({ count: 21 })])).toContain('21 cards');
  });

  it('pluralises an awkward noun properly', () => {
    expect(inDesignWords([change({ where: 'box', count: 2 })])).toContain('two boxes');
    expect(inDesignWords([change({ where: 'gallery', count: 2 })])).toContain('two galleries');
    expect(inDesignWords([change({ where: 'nav', count: 2 })])).toContain('two navs');
  });

  it('joins two clauses naturally, the busiest first', () => {
    const said = inDesignWords([
      change({ kind: 'colour', property: 'background', from: '#fff', to: '#000', count: 1 }),
      change({ count: 3 }),
    ]);
    expect(said).toBe(
      'Spacing on three cards, from 16 to 24 and background on the card, from #fff to #000.',
    );
  });

  it('never runs to a third clause, and counts what it left out', () => {
    const said = inDesignWords([
      change({ count: 3 }),
      change({ kind: 'radius', property: 'border-radius', from: '8', to: '12', count: 2 }),
      change({ kind: 'shadow', property: 'box-shadow', from: 'a', to: 'b', count: 1 }),
    ]);
    expect(said).toBe(
      'Spacing on three cards, from 16 to 24 and corners on two cards, from 8 to 12, plus one more change.',
    );
  });

  it('counts several left out in words', () => {
    const said = inDesignWords([
      change({ count: 5 }),
      change({ kind: 'radius', property: 'border-radius', count: 4 }),
      change({ kind: 'shadow', property: 'box-shadow', count: 3 }),
      change({ kind: 'layout', property: 'display', count: 2 }),
      change({ kind: 'type', property: 'font-size', count: 1 }),
    ]);
    expect(said).toMatch(/, plus three more changes\.$/);
  });

  it('names the thing that moved, not the property', () => {
    expect(inDesignWords([change({ kind: 'type', property: 'font-size', count: 1 })])).toMatch(
      /^Text size on the card/,
    );
    expect(inDesignWords([change({ kind: 'type', property: 'font-weight', count: 1 })])).toMatch(
      /^Weight on/,
    );
    expect(inDesignWords([change({ kind: 'type', property: 'line-height', count: 1 })])).toMatch(
      /^Line height on/,
    );
    expect(inDesignWords([change({ kind: 'colour', property: 'color', count: 1 })])).toMatch(
      /^Colour on/,
    );
    expect(
      inDesignWords([change({ kind: 'colour', property: 'border-color', count: 1 })]),
    ).toMatch(/^Border colour on/);
    expect(inDesignWords([change({ kind: 'radius', property: 'border-radius', count: 1 })])).toMatch(
      /^Corners on/,
    );
    expect(inDesignWords([change({ kind: 'layout', property: 'display', count: 1 })])).toMatch(
      /^Layout on/,
    );
  });

  it('never says a word from the other vocabulary', () => {
    const said = inDesignWords([change(), change({ kind: 'radius', property: 'border-radius' })]);
    expect(said).not.toMatch(/\b(css|class|token|commit|file|\.tsx)\b/i);
  });

  it('ends in a full stop, whatever the shape', () => {
    for (const many of [1, 2, 3, 4]) {
      const said = inDesignWords(
        Array.from({ length: many }, (_, at) => change({ property: `p-${at}`, count: many - at })),
      );
      expect(said).toMatch(/\.$/);
    }
  });
});

/* ========================================================================== */
/* D-07 it is pure                                                             */
/* ========================================================================== */

describe('D-07 same input, same words', () => {
  const edits: readonly Edit[] = [
    { file: 'Card.tsx', before: '<i className="p-4 bg-white" />', after: '<i className="p-6 bg-slate-50" />' },
  ];

  it('says the same thing twice', () => {
    expect(inDesignWords(readChanges(edits))).toBe(inDesignWords(readChanges(edits)));
  });

  it('leaves what it was handed alone', () => {
    const changes = readChanges(edits);
    const copy = changes.map((one) => ({ ...one }));
    inDesignWords(changes);
    expect(changes).toEqual(copy);
    expect(edits[0]).toEqual({
      file: 'Card.tsx',
      before: '<i className="p-4 bg-white" />',
      after: '<i className="p-6 bg-slate-50" />',
    });
  });
});
