/** Nothing floats out of the column it belongs to.
 *
 * The panel beside the conversation is a narrow stack of bands. A control that
 * opens a card over it either covers the band underneath or runs past the edge
 * of the column, and the line-of-work control did both: `width: max-content`
 * with a 22rem ceiling inside a 20rem rail.
 *
 * That is a whole class rather than one mistake, and none of the usual gates
 * see it — a floating element is valid CSS, typechecks, and every test passes
 * while it covers half the panel. So the rule is written down here instead: no
 * band in the panel may position anything out of flow.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const HERE = new URL('../src/components/', import.meta.url).pathname;

/** The bands that live inside the panel's own column. Sheets and modals are a
 *  different thing — they take the whole window on purpose. */
const IN_THE_PANEL = ['Lines.css', 'Swatches.css', 'Running.css'];

function rules(file: string): string {
  return readFileSync(join(HERE, file), 'utf8');
}

describe('what the panel’s own bands may do', () => {
  it('reads the files it claims to read', () => {
    const there = readdirSync(HERE);
    for (const one of IN_THE_PANEL) expect(there, one).toContain(one);
  });

  /** `position: absolute` in a band is the shape of the bug: it escapes the
   *  column's width and paints over whatever is below it. */
  it('never lifts anything out of the column', () => {
    const guilty = IN_THE_PANEL.filter((one) => /position:\s*(absolute|fixed)/.test(rules(one)));
    expect(guilty, `these float inside the panel: ${guilty.join(', ')}`).toEqual([]);
  });

  /** A band wider than its column pushes the rail or spills past it. Anything
   *  sized by its content has to be capped at the width it was given. */
  it('never sizes a control by its content without a ceiling', () => {
    for (const one of IN_THE_PANEL) {
      const text = rules(one);
      if (!/width:\s*max-content/.test(text)) continue;
      expect(text, `${one} sizes to content`).toMatch(/max-width:\s*100%/);
    }
  });

  /** A long line name, a long file name, a long anything: it truncates rather
   *  than deciding how wide the panel is. */
  it('lets a long name end in an ellipsis rather than widen the panel', () => {
    const lines = rules('Lines.css');
    expect(lines).toMatch(/text-overflow:\s*ellipsis/);
    expect(lines).toMatch(/min-width:\s*0/);
  });
});
