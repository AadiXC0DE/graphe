/** The sizes a project designs at, read out of its own stylesheets.
 *
 * Getting this wrong is worse than not doing it: a size invented out of a
 * `min-height` sends somebody looking at a page nobody ever designed, and a
 * breakpoint missed means the one width their layout actually breaks at is the
 * one width we never photograph. The unit arithmetic is the same story in
 * smaller print — 40rem is 640px in most projects and 800px in one that has set
 * its own root size, and photographing the wrong one of those proves nothing.
 */

import { describe, expect, it } from 'vitest';

import {
  flagOf,
  howBadly,
  nameForWidth,
  overflowsBy,
  responsive,
  saysHowItHolds,
  sizeAt,
  sizesFor,
  WIDTHS,
  widthsInCss,
  type Look,
} from '../src/design/widths';

const found = (css: string): number[] => [...widthsInCss(css)];

function look(over: Partial<Look> = {}): Look {
  return {
    id: 'phone',
    name: 'Phone',
    width: 390,
    shot: 'data:image/png;base64,aaa',
    trouble: null,
    ...over,
  };
}

/* ========================================================================== */
/* M-01 the plain conditions                                                   */
/* ========================================================================== */

describe('M-01 min-width and max-width', () => {
  it('reads a min-width', () => {
    expect(found('@media (min-width: 768px) { .a { color: red } }')).toEqual([768]);
  });

  it('reads a max-width', () => {
    expect(found('@media (max-width: 600px) { .a { color: red } }')).toEqual([600]);
  });

  it('reads both ends of one query', () => {
    expect(found('@media (min-width: 640px) and (max-width: 1024px) { .a { b: c } }')).toEqual([
      640, 1024,
    ]);
  });

  it('does not mind the whitespace, or the lack of it', () => {
    expect(found('@media(min-width:768px){.a{b:c}}')).toEqual([768]);
    expect(found('@media\n  (   min-width :  768px  )\n{ .a { b: c } }')).toEqual([768]);
  });

  it('does not mind the case', () => {
    expect(found('@MEDIA (MIN-WIDTH: 768PX) { .a { b: c } }')).toEqual([768]);
  });

  it('takes a media type in front of the condition', () => {
    expect(found('@media only screen and (min-width: 900px) { .a { b: c } }')).toEqual([900]);
    expect(found('@media screen and (max-width: 480px) { .a { b: c } }')).toEqual([480]);
  });

  it('reads a decimal without rounding it away', () => {
    expect(found('@media (min-width: 767.5px) { .a { b: c } }')).toEqual([768]);
  });
});

/* ========================================================================== */
/* M-02 the range syntax                                                       */
/* ========================================================================== */

describe('M-02 the range syntax', () => {
  it('reads width >= and width <=', () => {
    expect(found('@media (width >= 700px) { .a { b: c } }')).toEqual([700]);
    expect(found('@media (width <= 700px) { .a { b: c } }')).toEqual([700]);
  });

  it('steps a pixel inside a strict comparison, so the size is inside the design', () => {
    expect(found('@media (width > 700px) { .a { b: c } }')).toEqual([701]);
    expect(found('@media (width < 700px) { .a { b: c } }')).toEqual([699]);
  });

  it('reads an exact width', () => {
    expect(found('@media (width = 800px) { .a { b: c } }')).toEqual([800]);
    expect(found('@media (width: 800px) { .a { b: c } }')).toEqual([800]);
  });

  it('reads the comparison written the other way round', () => {
    expect(found('@media (700px <= width) { .a { b: c } }')).toEqual([700]);
    expect(found('@media (700px < width) { .a { b: c } }')).toEqual([701]);
    expect(found('@media (700px >= width) { .a { b: c } }')).toEqual([700]);
    expect(found('@media (700px > width) { .a { b: c } }')).toEqual([699]);
  });

  it('reads both bounds of a bounded range', () => {
    expect(found('@media (400px <= width <= 900px) { .a { b: c } }')).toEqual([400, 900]);
  });

  it('steps inside both ends of a strict bounded range', () => {
    expect(found('@media (400px < width < 900px) { .a { b: c } }')).toEqual([401, 899]);
  });

  it('mixes the two comparisons in one bounded range', () => {
    expect(found('@media (400px <= width < 900px) { .a { b: c } }')).toEqual([400, 899]);
  });
});

/* ========================================================================== */
/* M-03 the units                                                              */
/* ========================================================================== */

describe('M-03 units', () => {
  it('takes rem at sixteen to the em by default', () => {
    expect(found('@media (min-width: 40rem) { .a { b: c } }')).toEqual([640]);
  });

  it('takes em the same way', () => {
    expect(found('@media (min-width: 48em) { .a { b: c } }')).toEqual([768]);
  });

  it('follows a root size the project has set', () => {
    const css = `
      :root { font-size: 20px; }
      @media (min-width: 40rem) { .a { b: c } }
    `;
    expect(found(css)).toEqual([800]);
  });

  it('follows a root size set on html', () => {
    const css = `
      html { font-size: 10px; }
      @media (min-width: 76.8rem) { .a { b: c } }
    `;
    expect(found(css)).toEqual([768]);
  });

  it('reads a root size written as a percentage', () => {
    const css = `
      :root { font-size: 125%; }
      @media (min-width: 40rem) { .a { b: c } }
    `;
    expect(found(css)).toEqual([800]);
  });

  it('ignores an absurd root size rather than photographing a fantasy', () => {
    const css = `
      :root { font-size: 400px; }
      @media (min-width: 40rem) { .a { b: c } }
    `;
    expect(found(css)).toEqual([640]);
  });

  it('is not fooled by a font-size on some other rule', () => {
    const css = `
      .html-note { font-size: 40px; }
      @media (min-width: 40rem) { .a { b: c } }
    `;
    expect(found(css)).toEqual([640]);
  });

  it('takes the print units too', () => {
    expect(found('@media screen and (min-width: 60pc) { .a { b: c } }')).toEqual([960]);
    expect(found('@media screen and (min-width: 8in) { .a { b: c } }')).toEqual([768]);
  });

  it('refuses a unitless number, which is not a length', () => {
    expect(found('@media (min-width: 768) { .a { b: c } }')).toEqual([]);
  });

  it('refuses a length it cannot resolve on its own', () => {
    expect(found('@media (min-width: calc(40rem + 2px)) { .a { b: c } }')).toEqual([]);
    expect(found('@media (min-width: var(--wide)) { .a { b: c } }')).toEqual([]);
  });
});

/* ========================================================================== */
/* M-04 lists, and/or, nesting                                                 */
/* ========================================================================== */

describe('M-04 lists, and, or, nesting', () => {
  it('reads every query in a comma list', () => {
    expect(found('@media (max-width: 480px), (min-width: 1200px) { .a { b: c } }')).toEqual([
      480, 1200,
    ]);
  });

  it('reads both sides of an or', () => {
    expect(found('@media (min-width: 400px) or (min-width: 900px) { .a { b: c } }')).toEqual([
      400, 900,
    ]);
  });

  it('reads an or that has been bracketed inside another condition', () => {
    const css = '@media ((min-width: 400px) or (min-width: 900px)) and (hover: hover) { .a { b: c } }';
    expect(found(css)).toEqual([400, 900]);
  });

  it('reads a query nested inside another one', () => {
    const css = `
      @media (min-width: 600px) {
        .a { b: c }
        @media (min-width: 1100px) { .a { b: d } }
      }
    `;
    expect(found(css)).toEqual([600, 1100]);
  });

  it('reads every query in a whole stylesheet, in order', () => {
    const css = `
      @media (min-width: 1200px) { .a { b: c } }
      .b { c: d }
      @media (max-width: 480px) { .e { f: g } }
      @media (min-width: 768px) { .h { i: j } }
    `;
    expect(found(css)).toEqual([480, 768, 1200]);
  });
});

/* ========================================================================== */
/* M-05 what is not a width                                                    */
/* ========================================================================== */

describe('M-05 what is not a size', () => {
  it('ignores print', () => {
    expect(found('@media print { .a { b: c } }')).toEqual([]);
    expect(found('@media print and (min-width: 800px) { .a { b: c } }')).toEqual([]);
  });

  it('keeps the screen half of a list that also has print in it', () => {
    const css = '@media print, screen and (min-width: 800px) { .a { b: c } }';
    expect(found(css)).toEqual([800]);
  });

  it('ignores speech', () => {
    expect(found('@media speech and (min-width: 800px) { .a { b: c } }')).toEqual([]);
  });

  it('ignores the features that are not widths', () => {
    const css = `
      @media (min-height: 800px) { .a { b: c } }
      @media (prefers-color-scheme: dark) { .a { b: c } }
      @media (prefers-reduced-motion: reduce) { .a { b: c } }
      @media (hover: hover) and (pointer: fine) { .a { b: c } }
      @media (orientation: landscape) { .a { b: c } }
      @media (min-resolution: 2dppx) { .a { b: c } }
      @media (min-aspect-ratio: 16/9) { .a { b: c } }
    `;
    expect(found(css)).toEqual([]);
  });

  it('keeps the width out of a query that also asks about something else', () => {
    const css = '@media (min-width: 900px) and (orientation: landscape) { .a { b: c } }';
    expect(found(css)).toEqual([900]);
  });

  it('ignores a guard rail nobody designs at', () => {
    const css = `
      @media (min-width: 1px) { .a { b: c } }
      @media (min-width: 0px) { .a { b: c } }
      @media (max-width: 5000px) { .a { b: c } }
      @media (min-width: -400px) { .a { b: c } }
    `;
    expect(found(css)).toEqual([]);
  });

  it('does not read a query that has been commented out', () => {
    const css = `
      /* @media (min-width: 999px) { .a { b: c } } */
      @media (min-width: 768px) { .a { b: c } }
    `;
    expect(found(css)).toEqual([768]);
  });

  it('does not read a query out of a quoted string', () => {
    const css = `
      .a::before { content: "@media (min-width: 999px)"; }
      @media (min-width: 768px) { .a { b: c } }
    `;
    expect(found(css)).toEqual([768]);
  });

  it('is not confused by a container query', () => {
    const css = '@container (min-width: 300px) { .a { b: c } }';
    expect(found(css)).toEqual([]);
  });
});

/* ========================================================================== */
/* M-06 tidying                                                                */
/* ========================================================================== */

describe('M-06 sorting, dedupe and near neighbours', () => {
  it('says a size once however often it is written', () => {
    const css = `
      @media (min-width: 768px) { .a { b: c } }
      @media (min-width: 768px) { .d { e: f } }
      @media (min-width: 48rem) { .g { h: i } }
    `;
    expect(found(css)).toEqual([768]);
  });

  it('sorts narrow to wide whatever order the file is in', () => {
    const css = `
      @media (min-width: 1400px) { .a { b: c } }
      @media (min-width: 480px) { .a { b: c } }
      @media (min-width: 900px) { .a { b: c } }
    `;
    expect(found(css)).toEqual([480, 900, 1400]);
  });

  it('treats the two halves of one breakpoint as one size', () => {
    const css = `
      @media (max-width: 767px) { .a { b: c } }
      @media (min-width: 768px) { .a { b: c } }
    `;
    expect(found(css)).toEqual([767]);
  });

  it('keeps two sizes that are genuinely different', () => {
    const css = `
      @media (min-width: 768px) { .a { b: c } }
      @media (min-width: 800px) { .a { b: c } }
    `;
    expect(found(css)).toEqual([768, 800]);
  });
});

/* ========================================================================== */
/* M-07 malformed input                                                        */
/* ========================================================================== */

describe('M-07 half-typed files', () => {
  it('says nothing about an empty file', () => {
    expect(found('')).toEqual([]);
    expect(found('   \n  ')).toEqual([]);
  });

  it('says nothing about a file with no queries in it', () => {
    expect(found('.a { color: red }')).toEqual([]);
  });

  it('reads a query whose block was never opened', () => {
    expect(found('@media (min-width: 768px)')).toEqual([768]);
  });

  it('reads a query whose bracket was never closed', () => {
    expect(found('@media (min-width: 768px { .a { b: c } }')).toEqual([768]);
  });

  it('survives an unterminated comment', () => {
    expect(found('@media (min-width: 768px) { .a { b: c } } /* trailing')).toEqual([768]);
  });

  it('survives an unterminated string', () => {
    expect(found('@media (min-width: 768px) { .a { content: "oops } }')).toEqual([768]);
  });

  it('survives a bare @media with nothing after it', () => {
    expect(found('@media')).toEqual([]);
    expect(found('@media { .a { b: c } }')).toEqual([]);
  });

  it('survives junk between the brackets', () => {
    expect(found('@media (:::) and (min-width: 768px) { .a { b: c } }')).toEqual([768]);
  });

  it('is not thrown by something that is not a string at all', () => {
    expect(found(null as unknown as string)).toEqual([]);
    expect(found(undefined as unknown as string)).toEqual([]);
  });
});

/* ========================================================================== */
/* M-08 the sizes to look at                                                   */
/* ========================================================================== */

describe('M-08 merging with the sizes we ship', () => {
  it('falls back to ours when the project has never said', () => {
    expect(sizesFor(['.a { color: red }'])).toEqual(WIDTHS);
    expect(sizesFor([])).toEqual(WIDTHS);
  });

  it('uses the project’s own sizes when it has them', () => {
    const css = `
      @media (min-width: 480px) { .a { b: c } }
      @media (min-width: 900px) { .a { b: c } }
      @media (min-width: 1280px) { .a { b: c } }
    `;
    expect(sizesFor([css]).map((one) => one.width)).toEqual([480, 900, 1280]);
  });

  it('adds a phone when every query the project has is a wide one', () => {
    const css = '@media (min-width: 1024px) { .a { b: c } }';
    const sizes = sizesFor([css]);
    expect(sizes.map((one) => one.width)).toEqual([390, 1024, 1440]);
  });

  it('adds a full-width look when every query is a narrow one', () => {
    const css = '@media (max-width: 480px) { .a { b: c } }';
    expect(sizesFor([css]).map((one) => one.width)).toEqual([480, 1440]);
  });

  it('adds both ends when the project only thought about the middle', () => {
    const css = '@media (max-width: 600px) { .a { b: c } }';
    expect(sizesFor([css]).map((one) => one.width)).toEqual([390, 600, 1440]);
  });

  it('reads every stylesheet it is handed, as one project', () => {
    const sizes = sizesFor([
      '@media (min-width: 480px) { .a { b: c } }',
      '@media (min-width: 1100px) { .a { b: c } }',
    ]);
    expect(sizes.map((one) => one.width)).toEqual([480, 1100, 1440]);
  });

  it('never shows more pictures than can be read at once', () => {
    const css = [320, 480, 600, 768, 900, 1024, 1200, 1440, 1600]
      .map((width) => `@media (min-width: ${width}px) { .a { b: c } }`)
      .join('\n');
    const sizes = sizesFor([css]);
    expect(sizes.length).toBeLessThanOrEqual(4);
    expect(sizes[0]?.width).toBe(320);
    expect(sizes[sizes.length - 1]?.width).toBe(1600);
  });

  it('keeps them narrow to wide', () => {
    const css = `
      @media (min-width: 1200px) { .a { b: c } }
      @media (max-width: 420px) { .a { b: c } }
      @media (min-width: 820px) { .a { b: c } }
    `;
    const widths = sizesFor([css]).map((one) => one.width);
    expect(widths).toEqual([...widths].sort((one, other) => one - other));
  });

  it('gives every size an id of its own, even when two share a name', () => {
    const css = `
      @media (min-width: 600px) { .a { b: c } }
      @media (min-width: 820px) { .a { b: c } }
    `;
    const sizes = sizesFor([css]);
    const ids = sizes.map((one) => one.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('is a real size in every slot, ready to photograph', () => {
    const css = '@media (min-width: 700px) { .a { b: c } }';
    for (const size of sizesFor([css])) {
      expect(size.width).toBeGreaterThan(0);
      expect(size.height).toBeGreaterThan(0);
      expect(Number.isInteger(size.width)).toBe(true);
      expect(Number.isInteger(size.height)).toBe(true);
      expect(size.name).toMatch(/^[A-Z][a-z]+$/);
    }
  });
});

/* ========================================================================== */
/* M-09 naming a size                                                          */
/* ========================================================================== */

describe('M-09 what a designer calls it', () => {
  it('names each band the way one says it out loud', () => {
    expect(nameForWidth(390)).toBe('Phone');
    expect(nameForWidth(480)).toBe('Phone');
    expect(nameForWidth(768)).toBe('Tablet');
    expect(nameForWidth(834)).toBe('Tablet');
    expect(nameForWidth(1024)).toBe('Laptop');
    expect(nameForWidth(1440)).toBe('Desktop');
    expect(nameForWidth(2000)).toBe('Desktop');
  });

  it('never a device, never a number', () => {
    for (const width of [320, 500, 700, 1100, 1900]) {
      expect(nameForWidth(width)).not.toMatch(/\d/);
      expect(nameForWidth(width)).not.toMatch(/iphone|ipad|pixel|galaxy|macbook/i);
    }
  });

  it('agrees with the sizes we ship', () => {
    for (const one of WIDTHS) expect(nameForWidth(one.width)).toBe(one.name);
  });

  it('makes a whole size out of a width', () => {
    expect(sizeAt(390)).toEqual({ id: 'phone', name: 'Phone', width: 390, height: 844 });
  });

  it('rounds a measured width rather than carrying its decimals', () => {
    expect(sizeAt(767.4).width).toBe(767);
  });

  it('does not fall over on a width that is not a number', () => {
    expect(sizeAt(Number.NaN).width).toBeGreaterThan(0);
    expect(nameForWidth(Number.NaN)).toBe('Phone');
  });
});

/* ========================================================================== */
/* M-10 how badly it breaks                                                    */
/* ========================================================================== */

describe('M-10 judging one width', () => {
  it('says nothing at all when the page fits', () => {
    expect(overflowsBy(390, 390)).toBe(0);
    expect(overflowsBy(390, 200)).toBe(0);
    expect(howBadly(390, 390)).toBe('fits');
    expect(saysHowItHolds('Phone', 390, 380)).toBeNull();
  });

  it('measures the overhang', () => {
    expect(overflowsBy(390, 430)).toBe(40);
    expect(overflowsBy(390, 430.4)).toBe(40);
  });

  it('calls a few stray pixels a hair, and says so gently', () => {
    expect(howBadly(390, 395)).toBe('slightly');
    const said = saysHowItHolds('Phone', 390, 395);
    expect(said).toBe(
      'Something on the page sits 5px past the edge of a phone — a hair, but it scrolls sideways.',
    );
  });

  it('calls a real overhang what it is, in the sentence we already had', () => {
    expect(howBadly(390, 430)).toBe('badly');
    expect(saysHowItHolds('Phone', 390, 430)).toBe(
      'Something on the page is 40px wider than a phone, so it scrolls sideways.',
    );
  });

  it('scales what counts as a hair with the size of the screen', () => {
    expect(howBadly(1440, 1450)).toBe('slightly');
    expect(howBadly(390, 410)).toBe('badly');
  });

  it('never opens with a number', () => {
    for (const content of [395, 430, 900]) {
      expect(saysHowItHolds('Phone', 390, content)).toMatch(/^[A-Z][a-z]/);
    }
  });

  it('says nothing about a screen of no width', () => {
    expect(howBadly(0, 500)).toBe('fits');
    expect(saysHowItHolds('Phone', Number.NaN, 500)).toBeNull();
  });
});

/* ========================================================================== */
/* M-11 what goes on the picture                                               */
/* ========================================================================== */

describe('M-11 the flag on the picture', () => {
  it('leaves a good picture unmarked', () => {
    expect(flagOf(look())).toEqual({ tone: 'fine', badge: null, says: null });
  });

  it('marks a picture that did not come out, and claims nothing about the page', () => {
    const flag = flagOf(look({ shot: null }));
    expect(flag.tone).toBe('missing');
    expect(flag.badge).toBe(responsive.missing);
    expect(flag.says).toBeNull();
  });

  it('marks a fault on the picture, and carries the sentence with it', () => {
    const flag = flagOf(look({ trouble: 'Something on the page is 40px wider than a phone' }));
    expect(flag.tone).toBe('trouble');
    expect(flag.badge).toBe(responsive.flagged);
    expect(flag.says).toBe('Something on the page is 40px wider than a phone.');
  });

  it('treats an empty finding as no finding', () => {
    expect(flagOf(look({ trouble: '   ' })).tone).toBe('fine');
  });

  it('says a missing picture before it says anything about the layout', () => {
    expect(flagOf(look({ shot: null, trouble: 'wider than a phone' })).tone).toBe('missing');
  });

  it('keeps the badge short enough to sit on a picture', () => {
    for (const badge of [responsive.flagged, responsive.missing]) {
      expect(badge.split(' ').length).toBeLessThanOrEqual(3);
    }
  });

  it('never reaches for the other vocabulary', () => {
    for (const line of Object.values(responsive)) {
      expect(line).not.toMatch(/breakpoint|viewport|responsive|css|media query|device/i);
    }
  });
});
