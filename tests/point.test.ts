/** Clicking the thing you mean. Pure — no browser is started anywhere in here,
 *  which is the point of the module being shaped the way it is. */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  describePointed,
  injectPointer,
  kindOf,
  labelFor,
  POINT_PATH,
  POINTER_MARK,
  POINTER_SCRIPT,
  stableSelector,
  whereIn,
  type ElementFacts,
  type Pointed,
} from '../src/preview/point';

/** An element described the way the page would describe it, innermost first. */
function node(
  tagName: string,
  extra: Partial<Omit<ElementFacts, 'tagName'>> = {},
  parent?: ElementFacts,
): ElementFacts {
  return { tagName, classList: [], nth: 1, ...extra, parent: parent ?? null };
}

/** A chain written outside-in, the way somebody reads a page. */
function chain(...tags: readonly ElementFacts[]): ElementFacts {
  let parent: ElementFacts | null = null;
  let deepest: ElementFacts | null = null;
  for (const one of tags) {
    const linked: ElementFacts = { ...one, parent };
    parent = linked;
    deepest = linked;
  }
  if (deepest === null) throw new Error('a chain needs an element in it');
  return deepest;
}

const pointed = (extra: Partial<Pointed> = {}): Pointed => ({
  selector: 'button',
  label: 'Get started',
  rect: { x: 0, y: 0, width: 10, height: 10 },
  ...extra,
});

/* ========================================================================== */
/* P-01 putting the script in a page                                           */
/* ========================================================================== */

describe('giving a document the pointer script', () => {
  it('puts it just before the body closes', () => {
    const out = injectPointer('<html><body><h1>Hi</h1></body></html>');
    expect(out.indexOf('<h1>Hi</h1>')).toBeLessThan(out.indexOf(POINTER_MARK));
    expect(out.indexOf(POINTER_MARK)).toBeLessThan(out.indexOf('</body>'));
    expect(out).toContain('<h1>Hi</h1>');
    expect(out).toContain('</body></html>');
  });

  it('appends when there is no body at all', () => {
    const out = injectPointer('<h1>A fragment</h1>');
    expect(out.startsWith('<h1>A fragment</h1>')).toBe(true);
    expect(out).toContain(POINTER_MARK);
  });

  it('still produces a page from nothing', () => {
    const out = injectPointer('');
    expect(out).toContain(POINTER_MARK);
    expect(out).toContain('__graphePointer');
  });

  it('reads a closing tag whatever case it is written in', () => {
    const out = injectPointer('<HTML><BODY><P>Hi</P></BODY></HTML>');
    expect(out.indexOf(POINTER_MARK)).toBeLessThan(out.indexOf('</BODY>'));
    expect(out).toContain('</BODY></HTML>');
  });

  it('is not fooled by a closing tag inside a script string', () => {
    const page = [
      '<html><body>',
      '<script>const end = "</body>"; document.title = end;</script>',
      '<p>after</p>',
      '</body></html>',
    ].join('\n');
    const out = injectPointer(page);
    expect(out).toContain('const end = "</body>"');
    expect(out.indexOf('<p>after</p>')).toBeLessThan(out.indexOf(POINTER_MARK));
  });

  it('is not fooled by a closing tag inside a comment', () => {
    const page = '<html><body><!-- </body> was here --><p>x</p></body></html>';
    const out = injectPointer(page);
    expect(out).toContain('<!-- </body> was here -->');
    expect(out.indexOf('<p>x</p>')).toBeLessThan(out.indexOf(POINTER_MARK));
  });

  it('takes the last body close when a page has several', () => {
    const page = '<body><p>one</p></body>\n<body><p>two</p></body>';
    const out = injectPointer(page);
    expect(out.indexOf('<p>two</p>')).toBeLessThan(out.indexOf(POINTER_MARK));
  });

  it('adds it once however many times it is asked', () => {
    const once = injectPointer('<html><body>x</body></html>');
    const twice = injectPointer(once);
    expect(twice).toBe(once);
    expect(twice.split(POINTER_MARK)).toHaveLength(2);
  });

  it('leaves an unterminated script alone rather than injecting inside it', () => {
    const out = injectPointer('<body><script>const a = 1;');
    expect(out).toContain('const a = 1;');
    expect(out.indexOf('const a = 1;')).toBeLessThan(out.indexOf(POINTER_MARK));
  });
});

/* ========================================================================== */
/* P-02 the script itself                                                      */
/* ========================================================================== */

describe('the script that runs on somebody else’s page', () => {
  it('closes its own script tag safely', () => {
    expect(POINTER_SCRIPT.toLowerCase()).not.toContain('</script');
  });

  it('never reaches off the machine', () => {
    expect(POINTER_SCRIPT).not.toMatch(/https?:\/\//);
    expect(POINTER_SCRIPT).not.toContain('<link');
    expect(POINTER_SCRIPT).not.toContain('importScripts');
  });

  it('reports a click to the path the server owns', () => {
    expect(POINT_PATH).toBe('/__graphe/point');
    expect(POINTER_SCRIPT).toContain(`window.fetch('${POINT_PATH}'`);
    expect(POINTER_SCRIPT).toContain('postMessage');
  });

  it('waits to be switched on, and can be switched off again', () => {
    expect(POINTER_SCRIPT).toContain("data.graphe !== 'point'");
    expect(POINTER_SCRIPT).toContain('window.__graphePointer = { start: start, stop: stop, clear: clear }');
    expect(POINTER_SCRIPT).toContain("window.addEventListener('pagehide', stop)");
  });

  it('asks the one question worth asking, on the page', () => {
    // A note is written where it is about. What it says about the element is
    // one line; the instruction is the person's own.
    expect(POINTER_SCRIPT).toContain('What should change here?');
    expect(POINTER_SCRIPT).toContain('function note(');
    expect(POINTER_SCRIPT).toContain('function leaveMark(');
    // Enter sends it, shift and enter does not.
    expect(POINTER_SCRIPT).toContain("event.key === 'Enter' && !event.shiftKey");
  });

  /* Two hand-written rebuilders stand between a page and the app: the server's,
     for the POST, and the page view's preload, for the message. Both read a
     click field by field and build a new object, which is what keeps a page from
     sending anything it likes — and it means a field added to `Pointed` and
     forgotten in one of them disappears without a word. That is exactly how
     every note written on the page arrived empty. */
  it('carries every part of a click along both roads it can take', () => {
    const source = readFileSync(new URL('../src/preview/point.ts', import.meta.url), 'utf8');
    const start = source.indexOf('export type Pointed = {');
    const shape = source.slice(start, source.indexOf('\n};', start));
    const fields = [...shape.matchAll(/^ {2}(\w+)\??:/gm)].map((found) => found[1]);

    expect(fields).toContain('said');
    expect(fields.length).toBeGreaterThan(5);

    const roads = {
      'the page view preload': readFileSync(new URL('../electron/pagepreload.ts', import.meta.url), 'utf8'),
      'the preview server': readFileSync(new URL('../src/preview/serve.ts', import.meta.url), 'utf8'),
    };
    for (const [road, text] of Object.entries(roads)) {
      for (const field of fields) {
        expect(text, `${road} drops "${String(field)}"`).toContain(`'${String(field)}'`);
      }
    }
  });

  it('takes the whole overlay off when it is told to', () => {
    expect(POINTER_SCRIPT).toContain('function clear(');
    expect(POINTER_SCRIPT).toContain('[data-graphe="mark"]');
  });

  it('takes its listeners back off when it stops', () => {
    // Only the ones put on the page itself. What our own launcher listens to
    // lives as long as the launcher does, and is not paired with anything.
    const watched = '(mousemove|mousedown|pointerdown|click|keydown|scroll|resize)';
    const added = POINTER_SCRIPT.match(new RegExp(`(document|window)\\.addEventListener\\('${watched}'`, 'g'));
    const removed = POINTER_SCRIPT.match(new RegExp(`(document|window)\\.removeEventListener\\('${watched}'`, 'g'));
    expect(added?.length).toBe(removed?.length);
  });

  it('parses, and watches nothing on the page until it is asked to', () => {
    const made: { tag: string; marker: string | null }[] = [];
    const listeners: string[] = [];
    const window = {
      addEventListener: (name: string) => listeners.push(`window:${name}`),
      location: { hash: '' },
      parent: null,
      opener: null,
    } as Record<string, unknown>;
    const body = { appendChild: () => undefined };
    const document = {
      readyState: 'complete',
      addEventListener: (name: string) => listeners.push(`document:${name}`),
      documentElement: { style: {} },
      body,
      createElement: (tag: string) => {
        const made1 = { tag, marker: null as string | null };
        made.push(made1);
        return {
          style: { cssText: '' },
          setAttribute: (name: string, value: string) => {
            if (name === 'data-graphe') made1.marker = value;
          },
          addEventListener: () => undefined,
          appendChild: () => undefined,
          set textContent(_: string) {},
          set type(_: string) {},
        };
      },
    };

    new Function('window', 'document', POINTER_SCRIPT)(window, document);

    // The way in is on the page, so it is built on arrival. Everything that
    // watches the page still waits to be asked.
    expect(listeners).toEqual(['window:message', 'window:pagehide']);
    expect(made).toEqual([{ tag: 'button', marker: 'launcher' }]);
    expect(window['__graphePointer']).toBeTypeOf('object');
  });

  it('marks everything it adds, so a photograph can leave it out', () => {
    // capture.ts hides `[data-graphe]` before taking a picture. Anything we put
    // on the page without that marker would land in every before-and-after.
    const created = POINTER_SCRIPT.match(/createElement\('?"?(\w+)/g) ?? [];
    const marked = POINTER_SCRIPT.match(/setAttribute\('data-graphe'/g) ?? [];
    expect(marked.length).toBe(created.length);
  });

  it('highlights in the app’s own accent', () => {
    expect(POINTER_SCRIPT).toContain('#b8492c');
  });

  it('carries the same judgement the rest of this file tests', () => {
    // The bodies are the real source of these functions, so the page cannot
    // decide an element differently from the assertions below.
    expect(POINTER_SCRIPT).toMatch(/function stableSelector\d*\(/);
    expect(POINTER_SCRIPT).toMatch(/function labelFor\d*\(/);
    expect(POINTER_SCRIPT).toMatch(/function describePointed\d*\(/);
    expect(POINTER_SCRIPT).toContain('nth-of-type');
    expect(POINTER_SCRIPT).toMatch(/startsWith\(['"]the ['"]\)/);
  });
});

/* ========================================================================== */
/* P-03 naming an element                                                      */
/* ========================================================================== */

describe('naming an element so it can be found again', () => {
  it('prefers an id, and says nothing else once it has one', () => {
    const el = chain(node('section', { id: 'hero' }), node('button', { id: 'start', nth: 2 }));
    expect(stableSelector(el)).toBe('#start');
  });

  it('prefers a class somebody chose over counting', () => {
    const el = chain(node('div'), node('button', { classList: ['hero-cta'], nth: 2 }));
    expect(stableSelector(el)).toContain('button.hero-cta');
  });

  it('counts among its own kind when there is nothing to go on', () => {
    const el = chain(node('div'), node('li', { nth: 3 }));
    expect(stableSelector(el)).toBe('div:nth-of-type(1) > li:nth-of-type(3)');
  });

  it('stops at an ancestor with an id', () => {
    const el = chain(
      node('main'),
      node('section', { id: 'hero' }),
      node('div'),
      node('button', { nth: 2 }),
    );
    expect(stableSelector(el)).toBe('#hero > div:nth-of-type(1) > button:nth-of-type(2)');
  });

  it('never names the page itself', () => {
    const el = chain(node('html'), node('body'), node('h1'));
    expect(stableSelector(el)).toBe('h1:nth-of-type(1)');
  });

  it('says something even for the body', () => {
    expect(stableSelector(node('body'))).toBe('body');
  });

  it('walks up four levels and no further', () => {
    const el = chain(
      node('main'),
      node('div'),
      node('div'),
      node('div'),
      node('div'),
      node('span', { nth: 2 }),
    );
    expect(stableSelector(el).split(' > ')).toHaveLength(5);
    expect(stableSelector(el).startsWith('div')).toBe(true);
  });

  describe('classes a build tool made up', () => {
    const skipped = ['css-1x2y3z', 'sc-AbCdEf', 'jsx-1234567890', 'svelte-1a2b3c', 'e1a2b3c40', '_2xKd9f', 'Button_root__2x9Kd'];

    for (const name of skipped) {
      it(`passes over ${name}`, () => {
        const el = chain(node('div'), node('button', { classList: [name], nth: 2 }));
        expect(stableSelector(el)).toContain('button:nth-of-type(2)');
        expect(stableSelector(el)).not.toContain(name);
      });
    }

    it('keeps a real name sitting beside a made-up one', () => {
      const el = chain(node('div'), node('button', { classList: ['css-1x2y3z', 'primary-cta'] }));
      expect(stableSelector(el)).toContain('button.primary-cta');
    });

    it('passes over a made-up id too', () => {
      const el = chain(node('div'), node('button', { id: 'css-1x2y3z', nth: 2 }));
      expect(stableSelector(el)).toContain('button:nth-of-type(2)');
    });

    it('passes over an id that could not be written in a selector', () => {
      const el = chain(node('div'), node('button', { id: '2 cats', nth: 2 }));
      expect(stableSelector(el)).toContain('button:nth-of-type(2)');
    });
  });

  describe('utility soup', () => {
    it('ranks a chosen name above a utility one', () => {
      const el = chain(node('div'), node('a', { classList: ['flex', 'px-4', 'nav-link'] }));
      expect(stableSelector(el)).toContain('a.nav-link');
    });

    it('still uses a utility class when it is all there is, with a count beside it', () => {
      const el = chain(node('div'), node('a', { classList: ['flex', 'px-4'], nth: 3 }));
      expect(stableSelector(el)).toContain('a.flex:nth-of-type(3)');
    });

    it('leaves out classes a selector cannot hold', () => {
      const el = chain(node('div'), node('a', { classList: ['md:flex', 'w-1/2'], nth: 3 }));
      expect(stableSelector(el)).toContain('a:nth-of-type(3)');
    });
  });

  it('makes sense of a missing count', () => {
    const el = node('li', { nth: Number.NaN });
    expect(stableSelector(el)).toBe('li:nth-of-type(1)');
  });
});

/* ========================================================================== */
/* P-04 where it sits                                                          */
/* ========================================================================== */

describe('saying where an element sits', () => {
  it('names the nearest ancestor with an id', () => {
    const el = chain(node('main'), node('section', { id: 'hero' }), node('button'));
    expect(whereIn(el)).toBe('hero');
  });

  it('says a name as words', () => {
    const el = chain(node('section', { classList: ['heroSection'] }), node('button'));
    expect(whereIn(el)).toBe('hero section');
  });

  it('falls back to what kind of region it is', () => {
    const el = chain(node('nav'), node('div'), node('a'));
    expect(whereIn(el)).toBe('navigation');
  });

  it('gives up rather than naming the page', () => {
    const el = chain(node('body'), node('div'), node('a'));
    expect(whereIn(el)).toBeNull();
  });
});

/* ========================================================================== */
/* P-05 what to call it                                                        */
/* ========================================================================== */

describe('what to call the thing that was clicked', () => {
  it('uses its own words', () => {
    expect(labelFor({ tagName: 'BUTTON', text: 'Get started' })).toBe('Get started');
  });

  it('tidies the whitespace a template leaves behind', () => {
    expect(labelFor({ tagName: 'H1', text: '\n  Hello   there \n' })).toBe('Hello there');
  });

  it('trims a long line at a word', () => {
    const said = labelFor({
      tagName: 'P',
      text: 'Everything you need to ship a website this afternoon',
    });
    expect(said.length).toBeLessThanOrEqual(41);
    expect(said.endsWith('…')).toBe(true);
    expect(said).toBe('Everything you need to ship a website…');
  });

  it('trims mid-word only when there is no word to trim at', () => {
    const said = labelFor({ tagName: 'P', text: 'a'.repeat(60) });
    expect(said).toBe(`${'a'.repeat(39)}…`);
  });

  it('leaves a line of exactly the limit alone', () => {
    const forty = 'b'.repeat(40);
    expect(labelFor({ tagName: 'P', text: forty })).toBe(forty);
  });

  it('lets a spoken label win over the visible text', () => {
    expect(labelFor({ tagName: 'BUTTON', text: 'Go', ariaLabel: 'Start a new project' })).toBe(
      'Start a new project',
    );
  });

  it('reads a picture by its description', () => {
    expect(labelFor({ tagName: 'IMG', alt: 'A studio at dusk' })).toBe('A studio at dusk');
  });

  it('falls back to what it is', () => {
    expect(labelFor({ tagName: 'BUTTON' })).toBe('the button');
    expect(labelFor({ tagName: 'H2' })).toBe('the heading');
    expect(labelFor({ tagName: 'IMG' })).toBe('the image');
    expect(labelFor({ tagName: 'A' })).toBe('the link');
  });

  it('falls back plainly for something it has never heard of', () => {
    expect(labelFor({ tagName: 'MARQUEE' })).toBe('the element');
  });

  it('believes a role over a tag', () => {
    expect(labelFor({ tagName: 'DIV', role: 'button' })).toBe('the button');
    expect(kindOf({ tagName: 'DIV', role: 'heading' })).toBe('heading');
    expect(kindOf({ tagName: 'DIV' })).toBe('block');
  });

  it('treats an empty label as no label', () => {
    expect(labelFor({ tagName: 'BUTTON', text: '   ', ariaLabel: '' })).toBe('the button');
  });
});

/* ========================================================================== */
/* P-06 the sentence in the composer                                           */
/* ========================================================================== */

describe('the sentence that goes in the composer', () => {
  it('says what it is, what it says, and which one', () => {
    expect(
      describePointed(
        pointed({ kind: 'button', place: { nth: 2, of: 3, within: 'hero' } }),
      ),
    ).toBe('The button "Get started" · 2 of 3 in the hero');
  });

  it('holds no CSS', () => {
    const said = describePointed(
      pointed({ selector: '#hero > button.cta:nth-of-type(2)', kind: 'button' }),
    );
    expect(said).not.toContain('nth-of-type');
    expect(said).not.toContain('#hero');
  });

  it('says nothing about position when there is only one', () => {
    expect(describePointed(pointed({ kind: 'button', place: { nth: 1, of: 1 } }))).toBe(
      'The button "Get started"',
    );
  });

  it('says where without counting', () => {
    expect(
      describePointed(pointed({ kind: 'image', label: 'A studio at dusk', place: { nth: 1, of: 1, within: 'header' } })),
    ).toBe('The image "A studio at dusk" · in the header');
  });

  it('does not quote a label that is already a description', () => {
    expect(describePointed(pointed({ kind: 'button', label: 'the button' }))).toBe('The button');
  });

  it('manages without a kind', () => {
    expect(describePointed(pointed())).toBe('The element "Get started"');
  });

  it('manages without anything to say', () => {
    expect(describePointed(pointed({ label: '', kind: 'heading' }))).toBe('The heading');
  });
});
