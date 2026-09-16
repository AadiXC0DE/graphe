// @vitest-environment jsdom
/** The Tokens band: what it draws, and the one press on a row.
 *
 * A design system is read down a column, so the things worth holding still are
 * the shelf a value lands on, the use count that says whether anything leans on
 * it, the file and line somebody would open, and that a search narrows rather
 * than renames. Nothing here edits anything, and the band is absent rather than
 * empty when a project has no values of its own.
 *
 *  Source text, not behaviour: what the band's stylesheet keeps out of the flow and how it caps a long shelf; no behavioural test can reach it — jsdom applies no imported stylesheet.
 */

import { readFileSync } from 'node:fs';

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import Tokens, { SAYS } from '../src/components/Tokens';
import type { StyleToken } from '../src/lib/ipc';

const styles = readFileSync(`${process.cwd()}/src/components/Tokens.css`, 'utf8');

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = '';
});

function token(
  name: string,
  value: string,
  kind: StyleToken['kind'],
  used: number,
  line = 4,
): StyleToken {
  return { name, value, kind, line, used, file: 'src/styles/tokens.css' };
}

/** A project with one of everything the band has a shelf for. */
const PROJECT: readonly StyleToken[] = [
  token('--accent', '#b8492c', 'colour', 12, 133),
  token('--space-4', '16px', 'space', 7),
  token('--radius-md', '10px', 'radius', 3),
  token('--shadow-sm', '0 1px 2px rgb(0 0 0 / 0.04)', 'shadow', 0),
  token('--text-base', '0.9375rem', 'size', 9),
  token('--font-ui', "'Satoshi', sans-serif", 'other', 4, 50),
];

type Drawn = { host: HTMLElement; opened: string[] };

function draw(tokens: readonly StyleToken[] = PROJECT, sheets = 2): Drawn {
  const opened: string[] = [];
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() =>
    root.render(
      createElement(Tokens, { tokens, sheets, onOpenFile: (file: string) => opened.push(file) }),
    ),
  );
  return { host, opened };
}

function typeInto(box: HTMLInputElement, text: string): void {
  act(() => {
    // React tracks the node's own `value` setter, so only the prototype's reads
    // as a change.
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set?.call(box, text);
    box.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function captions(host: HTMLElement): string[] {
  return [...host.querySelectorAll('.tokens__caption')].map(
    (one) => one.textContent?.replace(/\d+$/, '') ?? '',
  );
}

function rowNamed(host: HTMLElement, name: string): HTMLElement {
  const row = [...host.querySelectorAll<HTMLElement>('.tokens__row')].find(
    (one) => one.querySelector('.tokens__name')?.textContent === name,
  );
  if (!row) throw new Error(`no row for ${name}`);
  return row;
}

/* ========================================================================== */
/* What it draws                                                               */
/* ========================================================================== */

describe('the band a project with values gets', () => {
  it('has a shelf for each kind of value, in the order they are read', () => {
    const { host } = draw();
    expect(captions(host)).toEqual(['Colour', 'Type', 'Spacing', 'Corners', 'Shadow']);
    expect(host.textContent).toContain(SAYS.heading);
  });

  it('names a value, and shows it, and paints a colour as itself', () => {
    const { host } = draw();
    const accent = rowNamed(host, '--accent');
    expect(accent.querySelector('.tokens__value')?.textContent).toBe('#b8492c');
    expect(accent.querySelector<HTMLElement>('.tokens__well')?.style.background).toBe(
      'rgb(184, 73, 44)',
    );
    // A spacing is a value to read, not a colour to paint.
    expect(rowNamed(host, '--space-4').querySelector('.tokens__well')).toBeNull();
  });

  it('says how many places reach for a value, and leaves it blank when none do', () => {
    const { host } = draw();
    expect(rowNamed(host, '--accent').querySelector('.tokens__used')?.textContent).toBe('12');
    expect(rowNamed(host, '--shadow-sm').querySelector('.tokens__used')?.textContent).toBe('');
  });

  it('says where each value is written, and how wide the reading was', () => {
    const { host } = draw();
    expect(rowNamed(host, '--accent').querySelector('.tokens__place')?.textContent).toBe(
      'src/styles/tokens.css:133',
    );
    expect(host.querySelector('.tokens__from')?.textContent).toBe(SAYS.from(2));
    expect(SAYS.from(1)).toBe('From 1 stylesheet');
  });

  /* Only a colour gets that column, and a swatch that was not painted would
     look exactly like one painted white. */
  it('draws the shelves a project actually has and no others', () => {
    const { host } = draw([token('--accent', '#b8492c', 'colour', 1)]);
    expect(captions(host)).toEqual(['Colour']);
  });
});

/* ========================================================================== */
/* Finding one                                                                 */
/* ========================================================================== */

describe('searching it', () => {
  it('narrows to the values that match, shelf by shelf', () => {
    const { host } = draw();
    typeInto(host.querySelector<HTMLInputElement>('.tokens__find')!, 'space');
    expect(captions(host)).toEqual(['Spacing']);
    expect(host.querySelectorAll('.tokens__row')).toHaveLength(1);
  });

  it('matches a value as well as a name', () => {
    const { host } = draw();
    typeInto(host.querySelector<HTMLInputElement>('.tokens__find')!, '#b8492c');
    expect(host.querySelectorAll('.tokens__row')).toHaveLength(1);
    expect(host.textContent).toContain('--accent');
  });

  it('says so rather than drawing nothing when nothing matches', () => {
    const { host } = draw();
    typeInto(host.querySelector<HTMLInputElement>('.tokens__find')!, 'nothing like this');
    expect(host.querySelectorAll('.tokens__row')).toHaveLength(0);
    expect(host.textContent).toContain(SAYS.nothingFound);
  });

  it('gives the whole list back when the box is cleared', () => {
    const { host } = draw();
    const box = host.querySelector<HTMLInputElement>('.tokens__find')!;
    typeInto(box, 'space');
    typeInto(box, '');
    expect(host.querySelectorAll('.tokens__row')).toHaveLength(PROJECT.length);
  });
});

/* ========================================================================== */
/* The one press                                                               */
/* ========================================================================== */

describe('opening one in the editor', () => {
  it('hands over the sheet the value was read from, and nothing else', () => {
    const { host, opened } = draw();
    const place = rowNamed(host, '--accent').querySelector<HTMLButtonElement>('.tokens__place');
    expect(place?.textContent).toBe('src/styles/tokens.css:133');
    act(() => place?.click());
    expect(opened).toEqual(['src/styles/tokens.css']);
  });

  it('names itself for somebody who cannot see the row it is on', () => {
    const { host } = draw();
    const place = rowNamed(host, '--radius-md').querySelector<HTMLButtonElement>('.tokens__place');
    expect(place?.getAttribute('aria-label')).toBe(
      'Open src/styles/tokens.css in your editor',
    );
    expect(place?.title).toBe(SAYS.open);
  });

  /* Read-only: nothing on this band changes a value, and a field somebody could
     type in would be a promise it does not keep. */
  it('offers nothing that edits a value', () => {
    const { host } = draw();
    expect(host.querySelectorAll('input:not([type="search"])')).toHaveLength(0);
    expect(styles).toContain('.tokens__table');
  });
});

/* ========================================================================== */
/* A project with no values                                                    */
/* ========================================================================== */

describe('a project with no values of its own', () => {
  /* Absent, not empty: a heading over a blank table says only that something is
     missing, and there is nothing here to miss. */
  it('draws nothing at all', () => {
    const { host } = draw([]);
    expect(host.querySelector('.tokens')).toBeNull();
    expect(host.textContent).toBe('');
  });

  it('draws nothing when everything it found is prose rather than a value', () => {
    const { host } = draw([token('--note', 'some prose that is not a value', 'other', 0)]);
    expect(host.querySelector('.tokens')).toBeNull();
  });
});

/* ========================================================================== */
/* A shelf that will not end                                                   */
/* ========================================================================== */

describe('a project with more values than a panel can hold', () => {
  const many = Array.from({ length: 50 }, (_, at) =>
    token(`--c-${String(at)}`, '#3355ff', 'colour', 1),
  );

  it('says how many it is holding back rather than growing without end', () => {
    const { host } = draw(many, 1);
    expect(host.querySelectorAll('.tokens__row')).toHaveLength(36);
    expect(host.querySelector('.tokens__shelfcount')?.textContent).toBe('50');
    expect(host.querySelector('.tokens__hidden')?.textContent).toBe(SAYS.hidden(14));
  });

  it('says the whole count in the heading, drawn or not', () => {
    const { host } = draw(many, 1);
    expect(host.textContent).toContain('50 values');
  });

  it('says nothing about hiding when it hid nothing', () => {
    const { host } = draw(many.slice(0, 3), 1);
    expect(host.querySelector('.tokens__hidden')).toBeNull();
    expect(host.textContent).toContain('3 values');
  });
});
