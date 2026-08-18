// @vitest-environment jsdom
/** The diagram engine, drawn.
 *
 *  The renderer needs a DOM (mermaid draws by building SVG elements), so this
 *  file runs in jsdom while everything else stays in node. The security claim
 *  tested here is the same one the whole file rests on: hostile diagram text
 *  comes back as inert shapes or nothing at all — never as a script or a link
 *  that could run. */

import { describe, expect, it } from 'vitest';

import { diagramTheme, isDarkBackground, renderMermaid } from '../src/lib/mermaid';

/* jsdom has no constructable stylesheets; mermaid builds its diagram CSS with
   one. The polyfill only carries rule text, which is all mermaid reads back. */
class FakeCSSStyleSheet {
  cssRules: string[] = [];
  insertRule(rule: string, index = 0): number {
    this.cssRules.splice(index, 0, rule);
    return index;
  }
  replaceSync(text: string): void {
    this.cssRules = [text];
  }
}
globalThis.CSSStyleSheet = FakeCSSStyleSheet as unknown as typeof CSSStyleSheet;

/* jsdom draws no SVG, so text measurement is missing; mermaid reads a label's
   box during layout. A box sized from the label's own text keeps layout
   realistic enough for the assertions here — tiny boxes collapse the layout and
   break edge placement. */
const svgProto = (globalThis as { SVGElement?: { prototype: { getBBox?: unknown } } }).SVGElement
  ?.prototype;
if (svgProto !== undefined && typeof svgProto.getBBox !== 'function') {
  svgProto.getBBox = function (this: { textContent?: string | null }) {
    const text = this.textContent ?? '';
    return { x: 0, y: 0, width: text.length * 12, height: 16 };
  };
}

describe('diagram colours', () => {
  it('maps the app palette onto the engine, with fallbacks for a missing colour', () => {
    const theme = diagramTheme({ background: '#0e0e0d', primary: '#e0714d' }, true);
    expect(theme.darkMode).toBe(true);
    expect(theme.primaryColor).toBe('#e0714d');
    expect(theme.background).toBe('#0e0e0d');
    expect(theme.textColor).toBe('#f2f2ef');
  });

  it('tells a dark page from a light one', () => {
    expect(isDarkBackground('#131312')).toBe(true);
    expect(isDarkBackground('#fbfbfa')).toBe(false);
  });
});

describe('rendering diagram text', () => {
  it('draws a valid diagram as an svg', async () => {
    const svg = await renderMermaid(
      'flowchart TD\n  A[Start] --> B{Choice}\n  B --> C[Done]',
    );
    expect(svg).not.toBeNull();
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
  });

  it('refuses a diagram it cannot draw, returning null for the caller to fall back on', async () => {
    const svg = await renderMermaid('this is not a diagram\njust some words');
    expect(svg).toBeNull();
  });

  it('draws hostile labels as text, not markup', async () => {
    const svg = await renderMermaid('flowchart TD\n  A["<script>alert(1)</script>"] --> B[x]');
    expect(svg).not.toBeNull();
    expect(svg).not.toContain('<script');
  });
});
