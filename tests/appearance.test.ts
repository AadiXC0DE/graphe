/** An appearance, and the one rule that keeps it honest.
 *
 * The rule is that every custom property this module writes is already declared
 * in `styles/tokens.css`. A control that writes `--corner-roundness` looks like
 * it works, changes nothing, and is the exact failure a theme builder is prone
 * to — so the stylesheet is read here and the names are checked against it.
 *
 * After that: a saved file that has been hand-edited must cost somebody the one
 * line they got wrong rather than their whole appearance, and a font name goes
 * into a stylesheet, so it is checked rather than trusted.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  appearanceWords,
  asCss,
  cssFor,
  defaultAppearance,
  readAppearance,
  tokensFor,
  type Appearance,
} from '../src/design/appearance';

const stylesheet = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');

const declared = new Set([...stylesheet.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((found) => found[1] ?? ''));

const like = (over: Partial<Appearance>): Appearance => ({ ...defaultAppearance, ...over });

/* ========================================================================== */
/* AP-01 nothing is invented                                                   */
/* ========================================================================== */

describe('AP-01 every value written is a value something reads', () => {
  it('only writes properties the stylesheet declares', () => {
    for (const one of [
      defaultAppearance,
      like({ density: 'compact', radius: 'sharp', motion: 'off' }),
      like({ density: 'spacious', radius: 'round', contrast: 'high' }),
    ]) {
      for (const name of Object.keys(tokensFor(one))) {
        expect(declared.has(name), `${name} is written but nothing declares it`).toBe(true);
      }
    }
  });

  /* The other direction, for the things this panel claims to control: a slider
     for density that misses --space-6 leaves one gap in the app at the old
     size, which reads as a bug in the layout rather than a gap in the panel. */
  it('covers every scale it says it covers', () => {
    const written = new Set(Object.keys(tokensFor(defaultAppearance)));
    for (const at of [1, 2, 3, 4, 5, 6, 7, 8]) expect(written.has(`--space-${String(at)}`)).toBe(true);
    for (const size of ['2xs', 'xs', 'sm', 'base', 'lg', 'xl', '2xl']) {
      expect(written.has(`--text-${size}`)).toBe(true);
    }
    for (const size of ['sm', 'md', 'lg']) expect(written.has(`--radius-${size}`)).toBe(true);
    for (const name of ['--dur-micro', '--dur-ui', '--dur-large', '--dur-exit', '--stagger']) {
      expect(written.has(name)).toBe(true);
    }
    expect(written.has('--font-ui')).toBe(true);
    expect(written.has('--font-mono')).toBe(true);
  });
});

/* ========================================================================== */
/* AP-02 the scales move                                                       */
/* ========================================================================== */

describe('AP-02 density, corners and motion', () => {
  it('ships the stylesheet’s own numbers when nothing has been changed', () => {
    const tokens = tokensFor(defaultAppearance);
    expect(tokens['--space-4']).toBe('16px');
    expect(tokens['--space-8']).toBe('72px');
    expect(tokens['--text-base']).toBe('0.9375rem');
    expect(tokens['--radius-md']).toBe('10px');
    expect(tokens['--dur-ui']).toBe('200ms');
  });

  it('tightens and loosens the spacing together', () => {
    expect(tokensFor(like({ density: 'compact' }))['--space-4']).toBe('14px');
    expect(tokensFor(like({ density: 'spacious' }))['--space-4']).toBe('18px');
  });

  /* Type moves less than padding: 15px of prose becomes 14, not 13. */
  it('moves type less than it moves space', () => {
    expect(tokensFor(like({ density: 'compact' }))['--text-base']).toBe('0.875rem');
    expect(tokensFor(like({ density: 'spacious' }))['--text-base']).toBe('1rem');
  });

  it('rounds and squares the corners', () => {
    expect(tokensFor(like({ radius: 'sharp' }))['--radius-lg']).toBe('4px');
    expect(tokensFor(like({ radius: 'round' }))['--radius-lg']).toBe('22px');
  });

  it('means nothing moves when motion is off', () => {
    const tokens = tokensFor(like({ motion: 'off' }));
    for (const name of ['--dur-micro', '--dur-ui', '--dur-large', '--dur-exit', '--stagger']) {
      expect(tokens[name]).toBe('0ms');
    }
  });

  it('shortens rather than removes when motion is reduced', () => {
    const tokens = tokensFor(like({ motion: 'reduced' }));
    expect(tokens['--dur-ui']).toBe('100ms');
    expect(tokens['--stagger']).toBe('0ms');
  });
});

/* ========================================================================== */
/* AP-03 colour follows the accent                                             */
/* ========================================================================== */

describe('AP-03 one colour decides the rest', () => {
  it('writes a whole palette, not just the accent', () => {
    const tokens = tokensFor(like({ accent: '#38bdf8' }));
    for (const name of ['--bg', '--bg-raised', '--bg-sunken', '--text', '--text-muted', '--border', '--accent-soft']) {
      expect(tokens[name]).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('runs the ladder the other way for a dark window', () => {
    const light = tokensFor(defaultAppearance, 'light');
    const dark = tokensFor(defaultAppearance, 'dark');
    expect(light['--bg']).not.toBe(dark['--bg']);
    expect(light['--text']).not.toBe(dark['--text']);
    // Spacing has nothing to do with which way the colours run.
    expect(light['--space-4']).toBe(dark['--space-4']);
  });
});

/* ========================================================================== */
/* AP-04 fonts                                                                 */
/* ========================================================================== */

describe('AP-04 the face it wears', () => {
  it('puts the chosen face in front of the fallbacks', () => {
    expect(tokensFor(like({ uiFont: 'Inter' }))['--font-ui']).toMatch(/^'Inter', ui-sans-serif/);
    expect(tokensFor(like({ codeFont: 'JetBrains Mono' }))['--font-mono']).toMatch(/^'JetBrains Mono', ui-monospace/);
  });

  it('drops to the computer’s own list when that is what was asked for', () => {
    expect(tokensFor(like({ uiFont: 'System' }))['--font-ui']?.startsWith('ui-sans-serif')).toBe(true);
  });

  /* A font name is written straight into a stylesheet, so a name carrying a
     brace or a semicolon would be a way to write rules nobody asked for. */
  it('will not let a font name close the rule it sits in', () => {
    const sneaky = tokensFor(like({ uiFont: "X'; } :root { --bg: red; }" }))['--font-ui'] ?? '';
    expect(sneaky.startsWith('ui-sans-serif')).toBe(true);
    expect(sneaky).not.toContain('}');
  });
});

/* ========================================================================== */
/* AP-05 as a stylesheet                                                       */
/* ========================================================================== */

describe('AP-05 what gets injected', () => {
  it('is one block of declarations', () => {
    const css = asCss({ '--accent': '#b8492c', '--space-1': '4px' });
    expect(css).toBe(':root {\n  --accent: #b8492c;\n  --space-1: 4px;\n}');
  });

  it('can be written under a theme’s own selector', () => {
    expect(asCss({ '--bg': '#000000' }, ":root[data-theme='graphe']")).toContain("[data-theme='graphe']");
  });

  /* Ligatures are a property, not a value, so they are the one thing that
     cannot be a token — and they only appear when somebody turns them off. */
  it('says nothing about ligatures until they are turned off', () => {
    expect(cssFor(defaultAppearance)).not.toContain('font-variant-ligatures');
    expect(cssFor(like({ ligatures: false }))).toContain('font-variant-ligatures: none');
  });
});

/* ========================================================================== */
/* AP-06 reading a saved one                                                   */
/* ========================================================================== */

describe('AP-06 a file somebody has edited', () => {
  it('keeps what it can read and ships the rest', () => {
    const read = readAppearance({ density: 'compact', radius: 'nonsense', motion: 'off' });
    expect(read.density).toBe('compact');
    expect(read.radius).toBe(defaultAppearance.radius);
    expect(read.motion).toBe('off');
  });

  it('is the shipped appearance when there is nothing to read', () => {
    for (const raw of [null, undefined, 42, 'appearance', []]) {
      expect(readAppearance(raw)).toEqual(defaultAppearance);
    }
  });

  it('will not take a colour nothing can parse', () => {
    expect(readAppearance({ accent: 'burnt sienna' }).accent).toBe(defaultAppearance.accent);
    expect(readAppearance({ accent: '#38bdf8' }).accent).toBe('#38bdf8');
    expect(readAppearance({ accent: 'oklch(0.7 0.15 40)' }).accent).toBe('oklch(0.7 0.15 40)');
  });

  it('will not take a font name that is not one', () => {
    expect(readAppearance({ uiFont: 'Inter' }).uiFont).toBe('Inter');
    expect(readAppearance({ uiFont: 'url(evil)' }).uiFont).toBe(defaultAppearance.uiFont);
  });

  it('reads what it writes', () => {
    const one = like({ density: 'spacious', motion: 'reduced', accent: '#22c55e', ligatures: false });
    expect(readAppearance(JSON.parse(JSON.stringify(one)))).toEqual(one);
  });
});

describe('AP-07 the words', () => {
  it('names every control it offers', () => {
    expect(appearanceWords.accent.name).toBe('Accent');
    for (const words of [appearanceWords.tone, appearanceWords.contrast, appearanceWords.density, appearanceWords.motion]) {
      expect(words.name.length).toBeGreaterThan(0);
      expect(words.hint.length).toBeGreaterThan(0);
    }
  });
});

describe('the preview', () => {
  it('never reaches past its own swatch', () => {
    const sheet = cssFor({ ...defaultAppearance, ligatures: false }, 'light', '.appearance__preview');
    expect(sheet).toContain('.appearance__preview {');
    expect(sheet).toContain('.appearance__preview code');
    expect(sheet).not.toMatch(/(^|\n)code,/);
    expect(sheet).not.toContain(':root');
  });
});
