// @vitest-environment jsdom
/** The conflict resolver, drawn.
 *
 * One rule outranks every other rule on this screen: a file whose markers could
 * not be read is reported and left byte for byte alone. Offering mine-or-theirs
 * over text nobody understood is offering to rebuild a file from a guess, and
 * that is how somebody loses an afternoon. So the test that matters most here
 * is the one where nothing is offered.
 */

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import Conflict from '../src/components/Conflict';
import { canDecide, conflictWords, leftToDecide, readConflict, resolveWith } from '../src/diff/conflict';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

type Props = Parameters<typeof Conflict>[0];

function draw(over: Partial<Props> = {}): HTMLDivElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  const props: Props = {
    open: true,
    paths: ['src/app.css'],
    path: 'src/app.css',
    text: null,
    busy: false,
    onPath: vi.fn(),
    onSettle: vi.fn(),
    onAsk: vi.fn(),
    onClose: vi.fn(),
    ...over,
  };
  act(() => root?.render(createElement(Conflict, props)));
  return host;
}

/** Two sides, one place, written the way git writes it with the base in. */
const ONE_CLASH = [
  'body {',
  '<<<<<<< Yours',
  '  color: red;',
  '||||||| Before either',
  '  color: black;',
  '=======',
  '  color: blue;',
  '>>>>>>> Theirs',
  '}',
].join('\n');

/** A section that never closes. Git does not write this; something else did.  */
const BROKEN = ['body {', '<<<<<<< Yours', '  color: red;', '=======', '  color: blue;', '}'].join('\n');

function ways(where: HTMLElement): HTMLButtonElement[] {
  return [...where.querySelectorAll<HTMLButtonElement>('.clash__way')];
}

function settle(where: HTMLElement): HTMLButtonElement | null {
  return where.querySelector<HTMLButtonElement>('.sheet__savebtn');
}

describe('a file whose markers could not be read', () => {
  it('is not offered a decision', () => {
    expect(canDecide(readConflict(BROKEN))).toBe(false);
    const where = draw({ text: BROKEN });
    expect(ways(where)).toHaveLength(0);
    expect(where.querySelectorAll('.clash__place')).toHaveLength(0);
  });

  it('says it has been left alone, in those words', () => {
    const where = draw({ text: BROKEN });
    expect(where.textContent).toContain(conflictWords.unreadable);
  });

  it('cannot be written back, whatever anybody presses', () => {
    const where = draw({ text: BROKEN });
    expect(settle(where)?.disabled).toBe(true);
  });

  it('leaves one way on: hand it to the conversation that wrote the other side', () => {
    const onAsk = vi.fn();
    const where = draw({ text: BROKEN, onAsk });
    const ask = where.querySelector<HTMLButtonElement>('.clash__ask');
    expect(ask).not.toBeNull();
    act(() => ask?.click());
    expect(onAsk).toHaveBeenCalledWith('src/app.css', 0);
  });

  it('comes back byte for byte if anything does try to resolve it', () => {
    expect(resolveWith(readConflict(BROKEN), 'theirs')).toBe(BROKEN);
  });
});

describe('a file that can be decided', () => {
  it('draws one place with three ways out of it', () => {
    const where = draw({ text: ONE_CLASH });
    expect(where.querySelectorAll('.clash__place')).toHaveLength(1);
    expect(ways(where).map((one) => one.textContent)).toEqual([
      conflictWords.takeMine,
      conflictWords.takeTheirs,
      conflictWords.takeBoth,
    ]);
  });

  it('puts both versions and the one they started from side by side', () => {
    const where = draw({ text: ONE_CLASH });
    const panes = [...where.querySelectorAll('.clash__panename')].map((one) => one.textContent);
    expect(panes).toEqual(['Yours', 'Before either', 'Theirs']);
  });

  it('will not write anything back while a place is still undecided', () => {
    const where = draw({ text: ONE_CLASH });
    expect(leftToDecide(readConflict(ONE_CLASH), new Map())).toBe(1);
    expect(settle(where)?.disabled).toBe(true);
  });

  it('writes the decided file once every place has an answer', () => {
    const onSettle = vi.fn();
    const where = draw({ text: ONE_CLASH, onSettle });
    act(() => ways(where)[1]?.click());
    const button = settle(where);
    expect(button?.disabled).toBe(false);
    act(() => button?.click());
    expect(onSettle).toHaveBeenCalledTimes(1);
    const written = (onSettle.mock.calls[0] as [string, string])[1];
    expect(written).toContain('color: blue;');
    expect(written).not.toContain('color: red;');
    expect(written).not.toContain('<<<<<<<');
  });

  it('says how many places are still open, so nothing is written half decided', () => {
    const where = draw({ text: ONE_CLASH });
    expect(where.textContent).toContain(conflictWords.stillOpen(1));
  });
});

describe('nothing to settle', () => {
  it('says so rather than drawing an empty screen', () => {
    const where = draw({ paths: [], path: null });
    expect(where.textContent).toContain(conflictWords.none);
  });

  it('draws nothing at all when it is not open', () => {
    const where = draw({ open: false, text: ONE_CLASH });
    expect(where.textContent).toBe('');
  });
});
