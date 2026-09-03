// @vitest-environment jsdom
/** Which font, from the ones actually installed.
 *
 * The setting was a text field that wanted a family name spelled exactly, and
 * answered a typo by falling back to the system stack without a word. What is
 * worth guarding is that the list is real where the machine can be read, that
 * there is still a list where it cannot, and that the popup is drawn at window
 * coordinates rather than against whichever ancestor happens to be positioned.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import FontPicker, { FONT_WORDS } from '../src/components/FontPicker';
import { SYSTEM_FONT } from '../src/design/appearance';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

const hosts: [HTMLElement, Root][] = [];
afterEach(() => {
  for (const [host, root] of hosts.splice(0)) {
    // Unmounted rather than detached: the list is a portal into the body, and a
    // detached host leaves it standing.
    act(() => root.unmount());
    host.remove();
  }
  delete (window as unknown as { queryLocalFonts?: unknown }).queryLocalFonts;
});

function draw(props: Partial<Parameters<typeof FontPicker>[0]> = {}): HTMLElement {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  hosts.push([host, root]);
  act(() => {
    root.render(
      createElement(FontPicker, {
        value: SYSTEM_FONT,
        onChange: () => {},
        sample: 'Where were we?',
        label: 'Interface font',
        ...props,
      }),
    );
  });
  return host;
}

const chip = (host: HTMLElement): HTMLElement => host.querySelector('.fontpicker__chip') as HTMLElement;

const list = (): HTMLElement | null => document.querySelector('.fontpicker__list');

const options = (): string[] =>
  [...document.querySelectorAll('.fontpicker__one')].map((one) => one.textContent ?? '');

describe('the picker', () => {
  it('is a chip carrying the family and a line drawn in it, and no list until pressed', () => {
    const host = draw({ value: 'Inter' });
    expect(chip(host).textContent).toContain('Inter');
    expect(chip(host).textContent).toContain('Where were we?');
    expect(chip(host).getAttribute('aria-expanded')).toBe('false');
    expect(list()).toBeNull();
  });

  /* The sheet clips its corners and the nearest positioned ancestor is not the
     chip, so the list is drawn into the body at window coordinates. */
  it('draws the list outside the chip, in the body', async () => {
    const host = draw();
    await act(async () => {
      chip(host).click();
    });
    expect(host.querySelector('.fontpicker__list')).toBeNull();
    const drawn = list();
    expect(drawn).not.toBeNull();
    expect(drawn?.parentElement).toBe(document.body);
    expect((drawn as HTMLElement).style.position).toBe('fixed');
  });

  it('offers what the computer says is installed, the system stack first', async () => {
    (window as unknown as { queryLocalFonts: () => Promise<{ family: string }[]> }).queryLocalFonts =
      () =>
        Promise.resolve([
          { family: 'Menlo' },
          { family: 'Inter' },
          { family: 'Menlo' },
          { family: 'Avenir' },
        ]);
    const host = draw();
    await act(async () => {
      chip(host).click();
    });
    expect(options()).toEqual(['Avenir', 'Inter', 'Menlo', SYSTEM_FONT]);
  });

  /* A browser tab, or a window that was never granted it. An empty list with no
     explanation is worse than the field this replaced. */
  it('still offers a list where the fonts cannot be read at all', async () => {
    const host = draw();
    await act(async () => {
      chip(host).click();
    });
    expect(options()).toContain(SYSTEM_FONT);
    expect(options()).toContain('JetBrains Mono');
    expect(options().length).toBeGreaterThan(5);
  });

  it('falls back to the same list when the reading is refused', async () => {
    (window as unknown as { queryLocalFonts: () => Promise<{ family: string }[]> }).queryLocalFonts =
      () => Promise.reject(new Error('refused'));
    const host = draw();
    await act(async () => {
      chip(host).click();
    });
    expect(options()).toContain(SYSTEM_FONT);
  });

  it('narrows on what is typed, and says so when nothing matches', async () => {
    const host = draw();
    await act(async () => {
      chip(host).click();
    });
    const find = document.querySelector('.fontpicker__find') as HTMLInputElement;
    const type = (text: string): void => {
      act(() => {
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          'value',
        )?.set;
        setter?.call(find, text);
        find.dispatchEvent(new Event('input', { bubbles: true }));
      });
    };
    type('mono');
    expect(options()).toEqual(['JetBrains Mono', 'SF Mono']);
    type('kubernetes');
    expect(document.querySelector('.fontpicker__quiet')?.textContent).toBe(FONT_WORDS.nothing);
  });

  it('hands back the family pressed, and closes', async () => {
    const got: string[] = [];
    const host = draw({ onChange: (family) => got.push(family) });
    await act(async () => {
      chip(host).click();
    });
    const one = [...document.querySelectorAll('.fontpicker__one')].find(
      (each) => each.textContent === 'Inter',
    ) as HTMLElement;
    act(() => one.click());
    expect(got).toEqual(['Inter']);
    expect(list()).toBeNull();
  });

  it('closes on Escape without letting the press travel on', async () => {
    const host = draw();
    await act(async () => {
      chip(host).click();
    });
    let reached = 0;
    const count = (): void => {
      reached += 1;
    };
    window.addEventListener('keydown', count);
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    window.removeEventListener('keydown', count);
    expect(list()).toBeNull();
    expect(reached).toBe(0);
  });

  it('closes on a press outside it, and not on one inside', async () => {
    const host = draw();
    await act(async () => {
      chip(host).click();
    });
    act(() => {
      (document.querySelector('.fontpicker__find') as HTMLElement).dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true }),
      );
    });
    expect(list()).not.toBeNull();
    act(() => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(list()).toBeNull();
  });
});

describe('the window it runs in', () => {
  /* Without this the reading is refused and every machine falls back to the
     short list, which is the bug this replaced wearing a different coat. */
  it('is allowed to read the fonts installed on the computer', () => {
    // Read from the working directory: under jsdom, import.meta.url is a URL
    // no file reader will take.
    const main = readFileSync(join(process.cwd(), 'electron/main.ts'), 'utf8');
    const at = main.indexOf('function applyPermissionPolicy');
    expect(at).toBeGreaterThan(-1);
    expect(main.slice(at, at + 900)).toContain("'local-fonts'");
  });

  it('is where the appearance band sends both fonts', () => {
    const band = readFileSync(join(process.cwd(), 'src/components/AppearanceBand.tsx'), 'utf8');
    expect(band).not.toContain('appearance__font');
    expect(band.split('<FontPicker')).toHaveLength(3);
  });
});
