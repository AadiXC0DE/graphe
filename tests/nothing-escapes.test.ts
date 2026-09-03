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
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HERE = fileURLToPath(new URL('../src/components/', import.meta.url));

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

/** No bar down the edge of the window.
 *
 * The scrollbar rule lives on `body`, and both of its properties inherit — so
 * every scroller in the app wears a thin one unless it says otherwise. That is
 * right for a box inside the work and wrong for the panels fixed to the glass:
 * theirs runs the full height of the window, beside the work rather than in it,
 * and in full screen there is no frame to explain it. Each of those opted out
 * once; the panel on the right stopped when the rule moved and nothing noticed.
 *
 * Hiding it and handing the width back on hover is not opting out. A bar that
 * arrives with a width takes that width out of the panel and slides every line
 * in it sideways under the pointer, which is what a reader reported. So the
 * width is read in both directions: none, and nowhere put back.
 */
describe('panels fixed to the edge of the window carry no scrollbar', () => {
  const edges = ['Overview.css', 'Sidebar.css', 'Versions.css'];

  for (const name of edges) {
    it(`${name} hides its own bar and never grows it back`, () => {
      const css = readFileSync(join(HERE, name), 'utf8');
      // Only meaningful for a panel that actually scrolls.
      expect(css).toMatch(/overflow(-y)?:\s*(auto|scroll)/);
      expect(css).toMatch(/scrollbar-width:\s*none/);
      expect(css).not.toMatch(/scrollbar-width:\s*(thin|auto)/);
    });
  }

  it('the conversation scroller hides its own too', () => {
    const app = readFileSync(join(HERE, '..', 'App.css'), 'utf8');
    expect(app).toMatch(/scrollbar-width:\s*none/);
    expect(app).not.toMatch(/scrollbar-width:\s*(thin|auto)/);
  });
});

/** The bar that fades in must not also grow in.
 *
 * `scroll--auto` is the app's hover-reveal, and the way to write it wrongly is
 * to hide the bar with `scrollbar-width: none` and hand the width back on
 * hover: the reveal then costs real layout space and shoves the content it is
 * meant to be reporting on. The width is settled once, before anything is
 * hovered, and only the colour comes and goes.
 */
describe('the shared auto-hide scrollbar', () => {
  const shared = readFileSync(
    fileURLToPath(new URL('../src/styles/scrollbar.css', import.meta.url)),
    'utf8',
  ).replace(/\/\*[\s\S]*?\*\//g, '');

  it('settles the width once and never changes it', () => {
    const widths = shared.match(/scrollbar-width:[^;]+/g) ?? [];
    expect(widths).toEqual(['scrollbar-width: thin']);
    // …and at no specificity, so a scroller wanting none of it still wins.
    expect(shared).toMatch(/:where\(\.scroll--auto, \.sheet__body\)\s*\{\s*scrollbar-width: thin/);
  });

  it('fades the thumb instead', () => {
    expect(shared).toMatch(/scrollbar-color:\s*transparent transparent/);
    expect(shared).toMatch(/:hover[\s\S]*scrollbar-color:\s*var\(--border-control\)/);
  });

  it('leaves the gutter to each scroller', () => {
    expect(shared).not.toMatch(/scrollbar-gutter/);
  });
});
