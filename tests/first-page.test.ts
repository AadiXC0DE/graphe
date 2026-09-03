/** The first screen: a room, not a card.
 *
 * Everything here is read off the source, because the screen is a layout and a
 * few exact numbers rather than a function anybody can call. The one piece with
 * behaviour of its own — the colour a project gets — is a function, and it is
 * tested as one.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { hueOf, SAYS } from '../src/components/ProjectPicker';

const read = (name: string): string =>
  readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8');

const tsx = read('components/ProjectPicker.tsx');
const css = read('components/ProjectPicker.css');

describe('a colour per project', () => {
  it('gives the same name the same hue every time', () => {
    expect(hueOf('paper-street')).toBe(hueOf('paper-street'));
  });

  it('gives different names different hues', () => {
    const hues = new Set(['paper-street', 'atlas-studio', 'field-notes'].map(hueOf));
    expect(hues.size).toBe(3);
  });

  it('stays inside the circle, whatever the name', () => {
    for (const name of ['', 'a', 'a-very-long-project-name-indeed', '🌱 seeds']) {
      const hue = hueOf(name);
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
    }
  });

  it('paints the tile from that hue, light and dark', () => {
    expect(css).toContain('background: oklch(0.9 0.05 var(--tile-hue, 0))');
    expect(css).toContain('background: oklch(0.3 0.06 var(--tile-hue, 0))');
    expect(css).toContain('color: oklch(0.45 0.12 var(--tile-hue, 0))');
  });
});

describe('the ground', () => {
  it('is a dot grid, masked to nothing at the edges', () => {
    expect(css).toContain(
      'background-image: radial-gradient(circle at 1px 1px, var(--border) 1px, transparent 0)',
    );
    expect(css).toContain('background-size: 24px 24px');
    expect(css).toContain(
      'mask-image: radial-gradient(ellipse 60% 55% at 50% 40%, black 30%, transparent 100%)',
    );
  });

  /* A list of places is not an event, and a ground that breathes is a ground
     you keep noticing. */
  it('never moves', () => {
    expect(css).not.toMatch(/\.picker[^{]*::before\s*\{[^}]*animation/);
    expect(css).not.toContain('@keyframes');
  });
});

describe('the rows', () => {
  it('are 56px with a 28px tile', () => {
    expect(css).toMatch(/\.pickerrow__open\s*\{[^}]*height:\s*56px/);
    expect(css).toMatch(/\.pickerrow__tile\s*\{[^}]*width:\s*28px/);
  });

  it('put the branch and the time on the second line', () => {
    expect(tsx).toContain('`${project.branch} · ${when}`');
  });

  it('take the cost out of the row and leave it in the title', () => {
    expect(tsx).toContain('title={titleOf(project)}');
    expect(tsx).not.toMatch(/\{formatMoney\([^)]*\)\}\s*last time/);
  });

  it('strike a folder that is not where it was, and always offer the way out', () => {
    expect(css).toMatch(/\.pickerrow--missing \.pickerrow__name\s*\{[^}]*line-through/);
    expect(css).toMatch(/\.pickerrow--missing \.pickerrow__forget\s*\{[^}]*opacity:\s*1/);
  });
});

describe('the keyboard', () => {
  it('says what the arrows do, once, under the list', () => {
    expect(SAYS.keys).toBe('↑↓ to choose, Enter to open');
    expect(tsx).toContain('className="picker__hint"');
  });

  it('moves with the arrows and opens the nth row with a number', () => {
    expect(tsx).toContain("event.key === 'ArrowDown'");
    expect(tsx).toContain("event.key === 'ArrowUp'");
    expect(tsx).toContain('nth < 1 || nth > MOST_SHOWN');
  });

  it('browses with the same key the button draws', () => {
    expect(tsx).toContain("event.key.toLowerCase() === 'o'");
    expect(tsx).toContain('⌘O');
  });

  it('leaves the first row focused on arrival', () => {
    expect(tsx).toContain('rows.current[0]?.focus()');
  });
});

describe('what is said', () => {
  it('asks where we were on a return and what to open on a first run', () => {
    expect(SAYS.returning).toBe('Where were we?');
    expect(SAYS.first).toBe('Open a project folder to start.');
  });

  it('keeps the privacy line to one line', () => {
    expect(SAYS.privacy.length).toBeLessThan(120);
    expect(SAYS.privacy).toContain('stay on this computer');
  });

  /* Three cards of features for somebody who has not opened a folder yet is a
     brochure inside a tool. */
  it('makes no promises on a first run', () => {
    expect(tsx).not.toContain('picker__promises');
    expect(css).not.toContain('picker__promises');
  });
});

describe('a folder dropped on the window', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');

  it('opens it rather than trying to attach it', () => {
    expect(app).toContain('webkitGetAsEntry()?.isDirectory === true');
    expect(app).toContain('bridge.pathOf(file)');
  });

  it('is one handler, taken before the composer sees it', () => {
    expect(app).toContain('window.addEventListener("drop", drop, true)');
    expect(app.match(/window\.addEventListener\("drop"/g)?.length).toBe(1);
  });
});

describe('the branch comes with the list', () => {
  it('is part of a remembered project', () => {
    expect(read('lib/ipc.ts')).toMatch(/missing: boolean;[\s\S]{0,200}branch: string \| null;/);
  });

  it('is read where the shell answers for the list', () => {
    const main = readFileSync(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const remembered = /async function rememberedProjects\(\)[\s\S]*?\n\}/.exec(main)?.[0] ?? '';
    expect(remembered).toContain("'rev-parse', '--abbrev-ref', 'HEAD'");
    expect(remembered).toContain('branch');
  });
});
