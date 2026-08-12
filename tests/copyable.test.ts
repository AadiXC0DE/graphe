/** An element, ready to paste.
 *
 * Two failures matter more than tidiness here. Anything of ours that survives
 * into what somebody pastes is a leak into their file. And a page that is a
 * little broken — half a tag, a stray angle bracket, a tag nobody closed — is
 * an ordinary afternoon, so none of it may throw.
 */

import { describe, expect, it } from 'vitest';

import { copyable, styleRules, tidyMarkup, WORTH_COPYING } from '../src/preview/copyable';
import { copyOf, POINTER_SCRIPT, type Pointed } from '../src/preview/point';

/* ========================================================================== */
/* C-01 tidy markup                                                            */
/* ========================================================================== */

describe('tidying the markup', () => {
  it('puts a nested element on its own line, indented', () => {
    expect(tidyMarkup('<div class="card"><h2>Hello</h2><p>Words</p></div>')).toBe(
      ['<div class="card">', '  <h2>Hello</h2>', '  <p>Words</p>', '</div>'].join('\n'),
    );
  });

  it('keeps an element with only short text on one line', () => {
    expect(tidyMarkup('<button class="cta">\n  Get started\n</button>')).toBe(
      '<button class="cta">Get started</button>',
    );
  });

  it('indents as deep as the markup goes', () => {
    const out = tidyMarkup('<section><div><ul><li>One</li><li>Two</li></ul></div></section>');
    expect(out).toBe(
      [
        '<section>',
        '  <div>',
        '    <ul>',
        '      <li>One</li>',
        '      <li>Two</li>',
        '    </ul>',
        '  </div>',
        '</section>',
      ].join('\n'),
    );
  });

  it('takes the width of a step from the caller', () => {
    expect(tidyMarkup('<div><span>x</span></div>', { indent: 4 })).toBe(
      ['<div>', '    <span>x</span>', '</div>'].join('\n'),
    );
  });

  it('tidies the whitespace a template left behind', () => {
    expect(tidyMarkup('<p>\n   Hello    there\n\n</p>')).toBe('<p>Hello there</p>');
  });

  it('breaks a long line rather than running it off the screen', () => {
    const long =
      'Everything you need to ship a website this afternoon, and a good deal more besides all that';
    expect(tidyMarkup(`<p>${long}</p>`)).toBe(['<p>', `  ${long}`, '</p>'].join('\n'));
  });

  it('leaves preformatted text exactly as it was', () => {
    expect(tidyMarkup('<pre>  one\n    two\n</pre>')).toBe('<pre>  one\n    two\n</pre>');
  });

  it('keeps a comment somebody wrote', () => {
    expect(tidyMarkup('<div><!-- the price --><span>£4</span></div>')).toBe(
      ['<div>', '  <!-- the price -->', '  <span>£4</span>', '</div>'].join('\n'),
    );
  });

  it('drops a doctype, which is never part of one element', () => {
    expect(tidyMarkup('<!doctype html><p>Hi</p>')).toBe('<p>Hi</p>');
  });
});

/* ========================================================================== */
/* C-02 tags that close themselves                                             */
/* ========================================================================== */

describe('tags with nothing inside them', () => {
  it('closes an image on its own', () => {
    expect(tidyMarkup('<img src="a.png" alt="A studio at dusk">')).toBe(
      '<img src="a.png" alt="A studio at dusk" />',
    );
  });

  it('does not go looking for a closing tag it will never find', () => {
    expect(tidyMarkup('<div><br><hr><input type="text"></div>')).toBe(
      ['<div>', '  <br />', '  <hr />', '  <input type="text" />', '</div>'].join('\n'),
    );
  });

  it('reads one already written as closed', () => {
    expect(tidyMarkup('<div><img src="a.png"/><span>after</span></div>')).toBe(
      ['<div>', '  <img src="a.png" />', '  <span>after</span>', '</div>'].join('\n'),
    );
  });

  it('reads a bare attribute with no value', () => {
    expect(tidyMarkup('<input disabled type="checkbox" checked>')).toBe(
      '<input disabled type="checkbox" checked />',
    );
  });
});

/* ========================================================================== */
/* C-03 nothing of ours comes back out                                         */
/* ========================================================================== */

describe('what we put on the page', () => {
  it('takes our mark off the element itself', () => {
    const out = copyable({ html: '<button data-graphe="launcher" class="cta">Go</button>' });
    expect(out.markup).toBe('<button class="cta">Go</button>');
    expect(out.text).not.toContain('graphe');
  });

  it('removes anything of ours sitting inside it', () => {
    const out = copyable({
      html: '<div class="card"><p>Real</p><div data-graphe="pointer"><span>ours</span></div></div>',
    });
    expect(out.markup).toBe(['<div class="card">', '  <p>Real</p>', '</div>'].join('\n'));
    expect(out.markup).not.toContain('ours');
  });

  it('removes a script of ours entirely', () => {
    const out = copyable({
      html: '<div><script data-graphe="pointer">window.__graphePointer = 1;</script><p>Real</p></div>',
    });
    expect(out.markup).not.toContain('graphe');
    expect(out.markup).toContain('<p>Real</p>');
  });

  it('leaves the page’s own script and style alone', () => {
    const out = tidyMarkup('<div><style>.a { color: red; }</style></div>');
    expect(out).toContain('<style>.a { color: red; }</style>');
  });

  it('takes off a mark of ours written in any case, with anything after it', () => {
    const out = copyable({ html: '<p DATA-GRAPHE="x" data-graphe-at="12" id="real">Hi</p>' });
    expect(out.markup).toBe('<p id="real">Hi</p>');
  });

  it('never mentions us anywhere in what gets pasted', () => {
    const out = copyable({
      html: '<section data-graphe="pointer" class="hero"><a data-graphe-label="x" href="/">Home</a></section>',
      styles: { color: 'rgb(0, 0, 0)' },
    });
    expect(out.text.toLowerCase()).not.toContain('graphe');
  });
});

/* ========================================================================== */
/* C-04 the rule                                                               */
/* ========================================================================== */

describe('the rule that comes with it', () => {
  it('names the rule after the element’s own id', () => {
    const out = copyable({ html: '<div id="hero" class="a">x</div>', styles: { color: 'rgb(1, 1, 1)' } });
    expect(out.selector).toBe('#hero');
    expect(out.styles).toBe('#hero {\n  color: rgb(1, 1, 1);\n}');
  });

  it('falls back to a class somebody chose, then to what it is', () => {
    expect(copyable({ html: '<div class="card wide">x</div>', styles: { color: 'red' } }).selector).toBe(
      '.card',
    );
    expect(copyable({ html: '<figure>x</figure>', styles: { color: 'red' } }).selector).toBe('figure');
  });

  it('passes over a class a build tool invented', () => {
    expect(copyable({ html: '<div class="css-1x2y3z card">x</div>', styles: {} }).selector).toBe('.card');
  });

  it('takes a name from the caller when given one', () => {
    const out = copyable({ html: '<div class="card">x</div>', selector: '.thing', styles: { color: 'red' } });
    expect(out.styles.startsWith('.thing {')).toBe(true);
  });

  it('writes the properties in a readable order, not the order they arrived', () => {
    const out = styleRules('.a', {
      color: 'rgb(0, 0, 0)',
      display: 'flex',
      'font-size': '16px',
      'padding-top': '8px',
    });
    expect(out.split('\n').slice(1, -1).map((line) => line.trim().split(':')[0])).toEqual([
      'display',
      'padding-top',
      'font-size',
      'color',
    ]);
  });

  it('leaves out values that say nothing', () => {
    const out = styleRules('.a', {
      'margin-top': '0px',
      'box-shadow': 'none',
      opacity: '1',
      transform: 'none',
      transition: 'all 0s ease 0s',
      color: 'rgb(0, 0, 0)',
    });
    expect(out).toBe('.a {\n  color: rgb(0, 0, 0);\n}');
  });

  it('leaves out a colour for a border that is not there', () => {
    expect(styleRules('.a', { 'border-color': 'rgb(0, 0, 0)', 'border-style': 'none' })).toBe('');
    expect(
      styleRules('.a', { 'border-color': 'rgb(0, 0, 0)', 'border-style': 'solid', 'border-width': '1px' }),
    ).toContain('border-color');
  });

  it('says nothing at all when there is nothing worth saying', () => {
    const out = copyable({ html: '<p>Hi</p>', styles: { 'margin-top': '0px' } });
    expect(out.styles).toBe('');
    expect(out.text).toBe('<p>Hi</p>');
  });

  it('puts the markup above the rule, ready to paste', () => {
    const out = copyable({ html: '<p class="lede">Hi</p>', styles: { color: 'red' } });
    expect(out.text).toBe('<p class="lede">Hi</p>\n\n.lede {\n  color: red;\n}');
  });

  it('asks for a short list of properties, not everything a browser knows', () => {
    expect(WORTH_COPYING.length).toBeLessThan(80);
    expect(WORTH_COPYING).toContain('color');
    expect(new Set(WORTH_COPYING).size).toBe(WORTH_COPYING.length);
  });
});

/* ========================================================================== */
/* C-05 the same thing never said twice                                        */
/* ========================================================================== */

describe('styles written on the element itself', () => {
  it('drops the ones the rule already says', () => {
    const out = copyable({
      html: '<p style="color: red; font-size: 18px">Hi</p>',
      styles: { color: 'rgb(255, 0, 0)', 'font-size': '18px' },
    });
    expect(out.markup).toBe('<p>Hi</p>');
    expect(out.styles).toContain('color: rgb(255, 0, 0);');
  });

  it('keeps the ones the rule has nothing to say about', () => {
    const out = copyable({
      html: '<p style="color: red; --brand: blue">Hi</p>',
      styles: { color: 'rgb(255, 0, 0)' },
    });
    expect(out.markup).toBe('<p style="--brand: blue">Hi</p>');
  });

  it('leaves them alone when there is no rule to compare against', () => {
    expect(tidyMarkup('<p style="color: red">Hi</p>')).toBe('<p style="color: red">Hi</p>');
  });

  it('does not split a value that has a semicolon inside it', () => {
    const out = copyable({
      html: '<div style="background-image: url(a.png?a=1;b=2); color: red">x</div>',
      styles: { color: 'rgb(255, 0, 0)' },
    });
    expect(out.markup).toBe('<div style="background-image: url(a.png?a=1;b=2)">x</div>');
  });

  it('only touches the element that was pointed at', () => {
    const out = copyable({
      html: '<div style="color: red"><span style="color: red">deep</span></div>',
      styles: { color: 'rgb(255, 0, 0)' },
    });
    expect(out.markup).toContain('<span style="color: red">deep</span>');
    expect(out.markup.startsWith('<div>')).toBe(true);
  });
});

/* ========================================================================== */
/* C-06 quoting and letters from everywhere                                    */
/* ========================================================================== */

describe('quoting and unusual letters', () => {
  it('writes every attribute in double quotes', () => {
    expect(tidyMarkup("<a href='/about' class=nav>About</a>")).toBe(
      '<a href="/about" class="nav">About</a>',
    );
  });

  it('escapes a quote inside a value rather than ending the attribute early', () => {
    expect(tidyMarkup(`<img alt='He said "hi"'>`)).toBe('<img alt="He said &quot;hi&quot;" />');
  });

  it('leaves what is already written as an entity alone', () => {
    expect(tidyMarkup('<p title="Tom &amp; Jerry">A &lt; B</p>')).toBe(
      '<p title="Tom &amp; Jerry">A &lt; B</p>',
    );
  });

  it('carries letters from any language through untouched', () => {
    expect(tidyMarkup('<p lang="hi">नमस्ते दुनिया</p>')).toBe('<p lang="hi">नमस्ते दुनिया</p>');
    expect(tidyMarkup('<p>“Quoted” — 日本語 · emoji 🎨</p>')).toBe('<p>“Quoted” — 日本語 · emoji 🎨</p>');
  });

  it('counts a long line in letters, not in bytes', () => {
    expect(tidyMarkup('<p>日本語</p>')).toBe('<p>日本語</p>');
  });
});

/* ========================================================================== */
/* C-07 markup that is a little broken                                         */
/* ========================================================================== */

describe('markup nobody finished writing', () => {
  it('manages a tag that was never closed', () => {
    expect(tidyMarkup('<div class="card"><p>Hi')).toBe(
      ['<div class="card">', '  <p>Hi</p>', '</div>'].join('\n'),
    );
  });

  it('ignores a closing tag for something that was never opened', () => {
    expect(tidyMarkup('<p>Hi</span></p>')).toBe('<p>Hi</p>');
  });

  it('closes what is still open when tags are crossed over', () => {
    const out = tidyMarkup('<b><i>both</b></i>');
    expect(out).toContain('both');
    expect(out.startsWith('<b>')).toBe(true);
  });

  it('reads a stray angle bracket as text', () => {
    expect(tidyMarkup('<p>5 < 6</p>')).toBe('<p>5 < 6</p>');
  });

  it('manages a tag that stops halfway', () => {
    expect(() => tidyMarkup('<div class="card"')).not.toThrow();
    expect(tidyMarkup('<div class="card"')).toBe('<div class="card"></div>');
  });

  it('manages an unterminated comment and an unterminated style', () => {
    expect(() => tidyMarkup('<div><!-- never ends')).not.toThrow();
    expect(() => tidyMarkup('<div><style>.a { color: red;')).not.toThrow();
  });

  it('gives back nothing for nothing, rather than falling over', () => {
    expect(copyable({ html: '' })).toEqual({ markup: '', styles: '', selector: '.element', text: '' });
    expect(copyable({ html: '   \n  ' }).markup).toBe('');
  });

  it('survives being handed something that is not markup at all', () => {
    expect(() => copyable({ html: 'just a sentence' })).not.toThrow();
    expect(copyable({ html: 'just a sentence' }).markup).toBe('just a sentence');
    expect(() => copyable({ html: undefined as unknown as string })).not.toThrow();
  });

  it('survives a deeply nested page', () => {
    const deep = `${'<div>'.repeat(200)}x${'</div>'.repeat(200)}`;
    expect(() => tidyMarkup(deep)).not.toThrow();
    expect(tidyMarkup(deep)).toContain('x');
  });

  it('changes nothing it was given', () => {
    const source = { html: '<p data-graphe="x" style="color: red">Hi</p>', styles: { color: 'red' } };
    copyable(source);
    expect(source.html).toBe('<p data-graphe="x" style="color: red">Hi</p>');
    expect(source.styles).toEqual({ color: 'red' });
  });
});

/* ========================================================================== */
/* C-08 the same click, as code                                                */
/* ========================================================================== */

describe('a click that brought the element with it', () => {
  const clicked = (source?: Pointed['source']): Pointed => ({
    selector: '#hero > button.cta:nth-of-type(2)',
    label: 'Get started',
    kind: 'button',
    rect: { x: 0, y: 0, width: 10, height: 10 },
    ...(source ? { source } : {}),
  });

  it('gives back the markup and the rule together', () => {
    const out = copyOf(
      clicked({
        html: '<button data-graphe="x" class="cta" style="color: rgb(255, 255, 255)">Get started</button>',
        styles: { color: 'rgb(255, 255, 255)', 'margin-top': '0px' },
      }),
    );
    expect(out?.markup).toBe('<button class="cta">Get started</button>');
    expect(out?.styles).toBe('.cta {\n  color: rgb(255, 255, 255);\n}');
    expect(out?.text).not.toContain('graphe');
  });

  it('says so plainly when the click did not bring it', () => {
    expect(copyOf(clicked())).toBeNull();
  });

  it('names the rule after the element, not after the way it was found', () => {
    const out = copyOf(clicked({ html: '<button class="cta">Go</button>', styles: { color: 'red' } }));
    expect(out?.selector).toBe('.cta');
    expect(out?.styles).not.toContain('nth-of-type');
  });
});

describe('what the page itself gathers', () => {
  it('asks only for the values worth carrying across', () => {
    expect(POINTER_SCRIPT).toContain('getComputedStyle');
    for (const property of WORTH_COPYING) expect(POINTER_SCRIPT).toContain(`"${property}"`);
  });

  it('gathers on a click, and never while the cursor is only passing over', () => {
    expect(POINTER_SCRIPT).toContain('send(pointedFrom(el, true))');
    expect(POINTER_SCRIPT).toContain('chip.textContent = G.describePointed(pointedFrom(el))');
  });

  it('still closes its own tag safely with the extra in it', () => {
    expect(POINTER_SCRIPT.toLowerCase()).not.toContain('</script');
    expect(POINTER_SCRIPT).not.toMatch(/https?:\/\//);
  });
});
