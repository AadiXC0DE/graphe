/** The design view: a rail, two tables and two lists of places.
 *
 * The counting and the reading of a typed length are functions and are tested
 * as functions; the rest is a layout, and the layout is read off the source.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SAYS as DESIGN } from '../src/components/DesignView';
import { SAYS as STYLES, usesIn } from '../src/components/Styles';
import { SAYS as MOTION, readTime } from '../src/components/Motion';
import { SAYS as DRIFT } from '../src/components/Drift';
import { SAYS as LEGIBLE } from '../src/components/Legible';

const read = (name: string): string =>
  readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8');

const view = read('components/DesignView.tsx');
const viewCss = read('components/DesignView.css');

describe('the rail', () => {
  it('is 220px and stays put while the parts scroll under it', () => {
    expect(viewCss).toMatch(/\.design__rail\s*\{[^}]*position:\s*sticky/);
    expect(viewCss).toMatch(/\.design__rail\s*\{[^}]*width:\s*220px/);
  });

  it('lists all six parts, always, with a count each', () => {
    expect(Object.keys(DESIGN.parts)).toEqual([
      'styles',
      'motion',
      'drift',
      'legible',
      'widths',
      'figma',
    ]);
    expect(view).toContain('className="design__partcount"');
    for (const part of Object.keys(DESIGN.parts)) {
      expect(view).toContain(`id="design-${part}"`);
    }
  });

  it('jumps with 1 to 6, and never while a value is being typed', () => {
    expect(view).toContain('nth < 1 || nth > ORDER.length');
    expect(view).toContain("target.tagName === 'INPUT'");
    expect(view).toContain('className="design__partkey"');
  });

  it('names the file being read, with the way into it', () => {
    expect(DESIGN.openFile).toBe('Open in editor');
    expect(view).toContain('className="design__path"');
  });

  /* The chips it replaces. */
  it('leaves no chip row behind', () => {
    expect(view).not.toContain('sheet__chip');
  });
});

describe('the head', () => {
  it('counts the changes on the button rather than in a sentence beside it', () => {
    expect(DESIGN.saveMany(3)).toBe('Save 3 changes');
    expect(DESIGN.saveMany(1)).toBe('Save 1 change');
    expect(DESIGN.save).toBe('Save');
  });

  it('has no sentence about being clean', () => {
    expect(view).not.toContain('Nothing changed yet');
    expect(view).not.toContain('sheet__dirty');
  });

  it('draws Discard only when there is something to discard', () => {
    expect(view).toMatch(/dirty \? \(\s*<button[\s\S]{0,200}SAYS\.discard/);
  });

  it('leaves Save present and quiet when there is nothing to save', () => {
    expect(view).toContain("sheet__savebtn--quiet");
    expect(view).toContain('disabled={!dirty || data.busy}');
  });
});

describe('the styles table', () => {
  const tsx = read('components/Styles.tsx');

  it('has a name, a value, a count and a way back', () => {
    expect([STYLES.name, STYLES.value, STYLES.used]).toEqual(['Name', 'Value', 'Used']);
    expect(tsx).toContain('<table className="styles__table">');
    expect(tsx).toContain('className="styles__reset"');
  });

  it('counts how many places reach for a value by name', () => {
    const found = usesIn(`
      .a { color: var(--accent); border: 1px solid var( --border ); }
      .b { background: var(--accent); }
    `);
    expect(found.get('--accent')).toBe(2);
    expect(found.get('--border')).toBe(1);
    expect(found.get('--nowhere')).toBeUndefined();
  });

  it('prints the raw name of a value, not a paraphrase', () => {
    expect(tsx).toContain('{token.name}');
  });

  it('filters with a field rather than hiding shelves', () => {
    expect(STYLES.find).toBe('Find a style');
    expect(tsx).toContain('className="styles__find"');
  });

  it('offers the way back only on a value that has moved', () => {
    expect(tsx).toContain('{moved && onReset !== undefined ? (');
  });
});

describe('the motion table', () => {
  const tsx = read('components/Motion.tsx');

  it('is the same shape: element, duration, easing', () => {
    expect([MOTION.element, MOTION.duration, MOTION.easing]).toEqual([
      'Element',
      'Duration',
      'Easing',
    ]);
    expect(tsx).toContain('<table className="motion__table">');
  });

  it('reads a length however somebody types it', () => {
    expect(readTime('200ms')).toBe(200);
    expect(readTime(' 0.2s ')).toBe(200);
    expect(readTime('180')).toBe(180);
    expect(readTime('quickly')).toBeNull();
    expect(readTime('-40ms')).toBeNull();
  });

  it('changes a value where it is read', () => {
    expect(tsx).toContain('onNudge(move, { duration: read })');
    expect(tsx).toContain('onNudge(move, { easing: read })');
  });
});

describe('the two lists of findings', () => {
  const drift = read('components/Drift.tsx');
  const legible = read('components/Legible.tsx');

  it('say where, as an editor would say it', () => {
    expect(DRIFT.at('src/styles/tokens.css', 42)).toBe('src/styles/tokens.css:42');
    expect(DRIFT.at('', 42)).toBe('line 42');
    expect(view).toContain('`${file}:${String(line)}`');
  });

  it('carry one press each', () => {
    expect(DRIFT.use).toBe('Use yours');
    expect(drift).toContain('className="drift__use"');
    expect(legible).toContain('className="legible__do"');
  });

  it('carry the whole lot at the top', () => {
    expect(DRIFT.useAll).toBe('Fix all');
    expect(LEGIBLE.fixAll).toBe('Fix all');
    expect(drift).toContain('className="drift__all"');
    expect(legible).toContain('className="legible__every"');
  });
});

describe('the last two bands', () => {
  it('offer another look at every width, at the end of the row that explains it', () => {
    const tsx = read('components/Responsive.tsx');
    expect(tsx).toContain('className="widths__top"');
    expect(tsx).toContain('{responsive.again}');
  });

  it('leave Figma as it was', () => {
    expect(read('components/InStep.tsx')).toContain("lookAgain: 'Refresh'");
  });
});
