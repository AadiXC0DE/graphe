/** The strip under the message box, with a long model name on it.
 *
 * "Muse Spark 1.2 Contributor" is three times the length of the names this row
 * was measured against, and with Queue and Interrupt out as well it ran off its
 * own edge — Interrupt past the right border, the model name collapsed to
 * nothing rather than truncated.
 *
 * Measured in a browser rather than asserted here: see the note below. What
 * this pins is that the rules which do the shrinking apply at every width,
 * because they used to live only inside a narrow-composer query.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const CSS = readFileSync(fileURLToPath(new URL('../src/components/Composer.css', import.meta.url)), 'utf8');

/** Everything before the first container query — the rules that always apply. */
const ALWAYS = CSS.slice(0, CSS.indexOf('@container'));

describe('CR-01 what gives up the width', () => {
  it('the three chips can shrink at any width, not only a narrow one', () => {
    expect(ALWAYS).toContain('.composer__row .thinking {');
    expect(ALWAYS).toMatch(/\.composer__row \.thinking \{[^}]*flex: 0 1 auto/s);
  });

  it('and their labels truncate rather than vanishing', () => {
    for (const label of ['ways__label', 'asking__label', 'thinking__label']) {
      expect(ALWAYS, label).toContain(`.composer__row .${label}`);
    }
    const at = ALWAYS.indexOf('.composer__row .thinking__label');
    const block = ALWAYS.slice(at, at + 260);
    expect(block).toContain('text-overflow: ellipsis');
    expect(block).toContain('min-width: 0');
    expect(block).toContain('white-space: nowrap');
  });
});

describe('CR-02 what does not', () => {
  /* Queue and Interrupt only exist while something is running, and a press
     squashed to fit is a press missed. */
  it('the two presses beside the box keep their size', () => {
    const at = ALWAYS.indexOf('.composer__row .composer__queue');
    expect(at).toBeGreaterThan(-1);
    expect(ALWAYS.slice(at, at + 140)).toContain('flex: none');
  });
});

describe('CR-03 the narrow rules still say how far', () => {
  it('a maximum on the model name, tightening as the composer narrows', () => {
    const caps = [...CSS.matchAll(/\.composer__row \.thinking__label \{\s*max-width: (\d+)ch/g)].map(
      (one) => Number(one[1]),
    );
    expect(caps.length).toBeGreaterThanOrEqual(2);
    // Narrower composer, shorter name — in that order, or the queries fight.
    expect([...caps].sort((a, b) => b - a)).toEqual(caps);
  });

  it('and a second line as the last resort rather than running off the edge', () => {
    expect(CSS).toMatch(/@container \(max-width: 380px\)[^@]*flex-wrap: wrap/s);
  });
});

/* ========================================================================== */
/* CR-02 what `@` offers                                                       */
/* ========================================================================== */

/** A skill's note is a sentence, not a tag. Drawn beside the name it was a flex
 *  item that does not shrink, so it took its whole content width: the name was
 *  squeezed to nothing and the row ran off the side of the window, over
 *  everything behind it. */
describe('CR-02 the row a skill is offered on', () => {
  const ROW = /\.composer__skills button\.composer__mention \{[^}]*\}/s;

  it('stacks the note under the name rather than beside it', () => {
    expect(ALWAYS).toMatch(ROW);
    expect(ALWAYS.match(ROW)?.[0]).toContain('flex-direction: column');
  });

  it('lets the note shrink and clips it, so no row is wider than the menu', () => {
    const note = ALWAYS.match(/\.composer__skills button\.composer__mention em \{[^}]*\}/s)?.[0] ?? '';
    expect(note).toContain('flex: 0 1 auto');
    expect(note).toContain('min-width: 0');
    expect(note).toContain('text-overflow: ellipsis');
    expect(note).toContain('overflow: hidden');
  });

  it('holds the menu itself to a width and a height, however many are offered', () => {
    const menu = ALWAYS.match(/\.composer__skills \{[^}]*\}/s)?.[0] ?? '';
    expect(menu).toMatch(/width: min\(/);
    expect(menu).toContain('max-height');
    expect(menu).toContain('overflow-y: auto');
  });
});
