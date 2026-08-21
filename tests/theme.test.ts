/** Choosing light or dark, and the contrast that made it worth choosing.
 *
 * The palette has carried both themes since the beginning and nothing in the
 * app ever let anybody pick — only the component gallery wrote `data-theme`, so
 * a person got whatever macOS was doing and had no say in it.
 *
 * The second half is why the light theme felt washed out. Every piece of text
 * on it already cleared AA; what did not was the structure. A hairline at
 * 1.23:1 against the background is a hairline nobody can see, so cards, rows
 * and boxes had no visible edges while their words read perfectly.
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { markFor, showing, themeFrom, THEMES, THEME_WORDS } from '../src/lib/theme';

const TOKENS = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');

/** The relative luminance and contrast maths from WCAG 2.1. */
function luminance(hex: string): number {
  const clean = hex.replace('#', '');
  const channel = (at: number) => parseInt(clean.slice(at, at + 2), 16) / 255;
  const bend = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * bend(channel(0)) + 0.7152 * bend(channel(2)) + 0.0722 * bend(channel(4));
}
function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  const hi = Math.max(x, y);
  const lo = Math.min(x, y);
  return (hi + 0.05) / (lo + 0.05);
}
/** A token's value inside a given block of the stylesheet. */
function token(block: string, name: string): string {
  const at = TOKENS.indexOf(block);
  expect(at, `block ${block}`).toBeGreaterThan(-1);
  const found = new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(TOKENS.slice(at, at + 2600));
  expect(found, `--${name} under ${block}`).not.toBeNull();
  return (found as RegExpExecArray)[1] as string;
}

describe('picking a theme', () => {
  it('offers following the computer as a real answer, not the absence of one', () => {
    expect(THEMES.map((one) => one.id)).toEqual(['system', 'light', 'dark']);
  });

  /** Following the computer means removing the mark, not writing one. A stamp
   *  that guessed would stop tracking the moment the computer changed. */
  it('stamps nothing when following the computer', () => {
    expect(markFor('system')).toBeNull();
    expect(markFor('light')).toBe('light');
    expect(markFor('dark')).toBe('dark');
  });

  it('falls back to following the computer on anything it cannot read', () => {
    for (const junk of [null, undefined, '', 'sepia', 7, {}]) {
      expect(themeFrom(junk)).toBe('system');
    }
    expect(themeFrom('dark')).toBe('dark');
  });

  it('says which palette is actually on screen', () => {
    expect(showing('system', true)).toBe('dark');
    expect(showing('system', false)).toBe('light');
    // A choice outranks the computer in both directions.
    expect(showing('light', true)).toBe('light');
    expect(showing('dark', false)).toBe('dark');
  });

  it('names it the way somebody would say it', () => {
    for (const said of Object.values(THEME_WORDS)) {
      expect(said).not.toMatch(/prefers-color-scheme|data-theme|palette|token/i);
    }
  });
});

describe('an edge you can actually see', () => {
  /** The failure this guards: text passing AA while every container it sits in
   *  has no visible boundary. Both themes were under 1.4:1 on their hairlines,
   *  which reads as "everything is washed out" even though nothing written is. */
  it('draws light-theme edges well clear of the background', () => {
    const bg = token('/* Light theme */', 'bg');
    expect(contrast(token('/* Light theme */', 'border'), bg)).toBeGreaterThan(1.45);
    expect(contrast(token('/* Light theme */', 'border-strong'), bg)).toBeGreaterThan(2.0);
  });

  it('draws dark-theme edges well clear of the background', () => {
    const bg = token('prefers-color-scheme: dark', 'bg');
    expect(contrast(token('prefers-color-scheme: dark', 'border'), bg)).toBeGreaterThan(1.5);
    expect(contrast(token('prefers-color-scheme: dark', 'border-strong'), bg)).toBeGreaterThan(1.9);
  });

  /** The edge of a control identified by its edge — a bare field, a switch that
   *  is off — is the one WCAG puts a hard 3:1 on. It was already right and must
   *  stay right while the decorative ones move around it. */
  it('keeps a control’s own edge at the 3:1 the guideline asks for', () => {
    const bg = token('/* Light theme */', 'bg');
    expect(contrast(token('/* Light theme */', 'border-control'), bg)).toBeGreaterThanOrEqual(3);
  });

  /** Every word on either theme still clears AA. Raising the edges must not
   *  have been paid for out of the text. */
  it('leaves every piece of text clearing AA on both themes', () => {
    for (const block of ['/* Light theme */', 'prefers-color-scheme: dark']) {
      const bg = token(block, 'bg');
      for (const name of ['text', 'text-muted', 'text-faint', 'accent']) {
        expect(contrast(token(block, name), bg), `${name} on ${block}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
