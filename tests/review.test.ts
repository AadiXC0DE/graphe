/** The page a client opens.
 *
 * It leaves the machine, so the two things that matter are that it asks nothing
 * of the network once it is open, and that nothing a person typed can turn into
 * markup on the way in. */

import { describe, expect, it } from 'vitest';

import { escapeHtml, reviewPage, safeToShare, type Review, type Shown } from '../src/share/review';

/** A one-pixel picture, carried as bytes the way a real one would be. */
const DOT =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function change(over: Partial<Shown> = {}): Shown {
  return {
    title: 'Made the header stay put when you scroll',
    when: new Date(2026, 7, 10, 12, 30).getTime(),
    says: 'One area changed, near the top.',
    before: DOT,
    after: DOT,
    ...over,
  };
}

function review(over: Partial<Review> = {}): Review {
  return {
    project: 'Kettle & Co',
    made: new Date(2026, 7, 11, 9, 15).getTime(),
    changes: [change()],
    spent: '$1.20',
    ...over,
  };
}

/* ========================================================================== */
/* Nothing is fetched                                                          */
/* ========================================================================== */

describe('the page stands on its own', () => {
  it('names no address outside the file', () => {
    const html = reviewPage(review({ changes: [change(), change({ before: null })] }));
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toMatch(/\/\/[a-z0-9-]+\.[a-z]{2,}/i);
  });

  it('has no link, script or font asking for anything', () => {
    const html = reviewPage(review());
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<link\b/i);
    expect(html).not.toMatch(/@import/i);
    expect(html).not.toMatch(/url\(/i);
    expect(html).not.toMatch(/\bsrcset=/i);
  });

  it('draws only pictures it is already carrying', () => {
    const html = reviewPage(review());
    const sources = [...html.matchAll(/<img[^>]*\ssrc="([^"]*)"/g)].map(([, value]) => value ?? '');
    expect(sources.length).toBe(2);
    for (const source of sources) expect(source.startsWith('data:image/')).toBe(true);
    expect(html).toContain(DOT);
  });

  it('refuses to draw a picture that would be fetched', () => {
    const html = reviewPage(
      review({ changes: [change({ before: 'https://example.com/before.png', after: DOT })] }),
    );
    expect(html).not.toContain('example.com');
    expect(html).toContain('This part is new');
  });

  it('will not be talked into a javascript source', () => {
    const html = reviewPage(
      review({ changes: [change({ before: 'javascript:alert(1)', after: 'javascript:alert(2)' })] }),
    );
    expect(html).not.toContain('javascript:');
    expect(html).toContain('There is no picture of this one.');
  });

  it('is a whole document', () => {
    const html = reviewPage(review());
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain('name="viewport"');
    expect(html.trimEnd().endsWith('</html>')).toBe(true);
  });
});

/* ========================================================================== */
/* Escaping                                                                    */
/* ========================================================================== */

describe('nothing a person typed becomes markup', () => {
  const NASTY = `<script>alert("x")</script> & 'quotes' "too"`;

  it('escapes the five characters that matter', () => {
    expect(escapeHtml('<')).toBe('&lt;');
    expect(escapeHtml('>')).toBe('&gt;');
    expect(escapeHtml('&')).toBe('&amp;');
    expect(escapeHtml('"')).toBe('&quot;');
    expect(escapeHtml("'")).toBe('&#39;');
    expect(escapeHtml('plain words')).toBe('plain words');
  });

  it('escapes an ampersand once, not twice', () => {
    expect(escapeHtml('Kettle & Co')).toBe('Kettle &amp; Co');
    expect(escapeHtml('&amp;')).toBe('&amp;amp;');
  });

  it('escapes the project name', () => {
    const html = reviewPage(review({ project: NASTY }));
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp;');
    expect(html).toContain('&#39;quotes&#39;');
    expect(html).toContain('&quot;too&quot;');
  });

  it('escapes a change title, everywhere it appears', () => {
    const html = reviewPage(review({ changes: [change({ title: NASTY })] }));
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('alert("x")');
    // The title is also the picture's description, which sits inside an attribute
    // and so must survive the quotes in it without ending the attribute early.
    const descriptions = [...html.matchAll(/\salt="([^"]*)"/g)].map(([, value]) => value);
    expect(descriptions.length).toBe(2);
    for (const description of descriptions) {
      expect(description).toContain('&lt;script&gt;');
      expect(description).toContain('&quot;');
    }
    // Once in the list at the top, once as the heading, once per picture.
    expect(html.match(/&lt;script&gt;/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it('escapes the summary sentence', () => {
    const html = reviewPage(review({ changes: [change({ says: NASTY })] }));
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;/script&gt;');
  });

  it('escapes the money, which is a string like any other', () => {
    const html = reviewPage(review({ spent: '<b>$4</b>' }));
    expect(html).not.toContain('<b>$4</b>');
    expect(html).toContain('&lt;b&gt;$4&lt;/b&gt;');
  });

  it('leaves the document with balanced angle brackets after a hostile name', () => {
    const html = reviewPage(review({ project: '</title><script>bad()</script>' }));
    expect(html).not.toContain('</title><script>');
    expect(html.match(/<title>/g)?.length).toBe(1);
    expect(html).not.toContain('bad()</script>');
  });
});

/* ========================================================================== */
/* Both themes, any width                                                      */
/* ========================================================================== */

describe('it looks like the app in either theme', () => {
  it('carries a dark theme', () => {
    const html = reviewPage(review());
    expect(html).toContain('@media (prefers-color-scheme: dark)');
    // The real dark tokens, not an invented palette.
    expect(html).toContain('#131312');
    expect(html).toContain('#f2f2ef');
    expect(html).toContain('#e0714d');
    expect(html).toContain('color-scheme: dark');
  });

  it('carries the light tokens too', () => {
    const html = reviewPage(review());
    expect(html).toContain('#fbfbfa');
    expect(html).toContain('#1a1a19');
    expect(html).toContain('#b8492c');
  });

  it('cannot scroll sideways and cannot be widened by a picture', () => {
    const html = reviewPage(review());
    expect(html).toContain('overflow-x: hidden');
    expect(html).toContain('max-width: 100%');
    expect(html).toContain('@media (max-width: 640px)');
    expect(html).toContain('overflow-wrap: anywhere');
  });

  it('gives the reader a way to compare the two pictures', () => {
    const html = reviewPage(review());
    expect(html).toContain('Side by side');
    expect(html).toContain('>Before</label>');
    expect(html).toContain('>After</label>');
    expect(html).toContain('type="radio"');
    // Each change owns its own set of choices.
    const two = reviewPage(review({ changes: [change(), change()] }));
    expect(two).toContain('name="show-1"');
    expect(two).toContain('name="show-2"');
    expect(two.match(/id="show-1-before"/g)?.length).toBe(1);
  });

  it('offers no choice when there is only one picture to look at', () => {
    const html = reviewPage(review({ changes: [change({ before: null })] }));
    expect(html).not.toContain('Side by side');
    expect(html).toContain('This part is new');
  });

  it('says so plainly when only the old picture survives', () => {
    const html = reviewPage(review({ changes: [change({ after: null })] }));
    expect(html).toContain('There is no picture of it afterwards.');
  });
});

/* ========================================================================== */
/* The summary at the top                                                      */
/* ========================================================================== */

describe('the answer comes before the pictures', () => {
  it('opens with what changed and why', () => {
    const html = reviewPage(review());
    const summary = html.indexOf('What changed, and why');
    const firstPicture = html.indexOf('<img');
    expect(summary).toBeGreaterThan(-1);
    expect(summary).toBeLessThan(firstPicture);
    expect(html).toContain('One change, made on 10 August 2026');
  });

  it('counts in words and names the span of days', () => {
    const spread = reviewPage(
      review({
        changes: [
          change({ when: new Date(2026, 7, 8, 10, 0).getTime() }),
          change({ when: new Date(2026, 7, 10, 12, 0).getTime() }),
          change({ when: new Date(2026, 7, 11, 12, 0).getTime() }),
        ],
      }),
    );
    expect(spread).toMatch(/Three changes, made between 8 August 2026 and 11 August 2026/);

    const sameDay = reviewPage(
      review({
        changes: [
          change({ when: new Date(2026, 7, 10, 9, 0).getTime() }),
          change({ when: new Date(2026, 7, 10, 15, 0).getTime() }),
        ],
      }),
    );
    expect(sameDay).toMatch(/Two changes, all made on 10 August 2026/);
  });

  it('lists each change and links to it', () => {
    const html = reviewPage(review({ changes: [change(), change({ title: 'Second thing' })] }));
    expect(html).toContain('href="#change-1"');
    expect(html).toContain('href="#change-2"');
    expect(html).toContain('id="change-2"');
  });

  it('leaves the money off when there is none to report', () => {
    expect(reviewPage(review({ spent: null }))).not.toContain('Cost of the work');
    expect(reviewPage(review({ spent: '$1.20' }))).toContain('$1.20');
  });

  it('is the same page every time', () => {
    const one = review();
    expect(reviewPage(one)).toBe(reviewPage(one));
  });
});

/* ========================================================================== */
/* Nothing to show yet                                                         */
/* ========================================================================== */

describe('an empty review is still an honest page', () => {
  const html = reviewPage(review({ changes: [] }));

  it('is a whole document', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html.trimEnd().endsWith('</html>')).toBe(true);
    expect(html).toContain('<title>');
  });

  it('says there is nothing rather than showing an empty frame', () => {
    expect(html).toContain('Nothing has changed yet.');
    expect(html).toContain('There is nothing to show here yet.');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<ol class="contents"');
  });

  it('still names the project', () => {
    expect(html).toContain('Kettle &amp; Co');
  });
});

/* ========================================================================== */
/* Nothing leaves with a key in it                                             */
/* ========================================================================== */

describe('a key stops the page being made at all', () => {
  it('lets an ordinary review through', () => {
    expect(safeToShare(review())).toEqual({ ok: true });
    expect(safeToShare(review({ changes: [] }))).toEqual({ ok: true });
    expect(
      safeToShare(
        review({
          changes: [change({ says: 'Swapped the sign-in button for a quieter one.' })],
        }),
      ),
    ).toEqual({ ok: true });
  });

  it('refuses a review carrying a key', () => {
    const leaked = review({
      changes: [change({ says: 'Wired it up with sk-lVn3Q8xTr2Ab9KdMz0PfWq7Y and it works now.' })],
    });
    const answer = safeToShare(leaked);
    expect(answer.ok).toBe(false);
    if (answer.ok) throw new Error('expected a refusal');
    expect(answer.because.length).toBeGreaterThan(20);
  });

  it('looks at every field a reader would see', () => {
    const key = 'AKIAIOSFODNN7EXAMPLE';
    expect(safeToShare(review({ project: `Kettle ${key}` })).ok).toBe(false);
    expect(safeToShare(review({ changes: [change({ title: `Fixed ${key}` })] })).ok).toBe(false);
    expect(safeToShare(review({ spent: `$1.20 ${key}` })).ok).toBe(false);
  });

  it('catches a private key pasted into a sentence', () => {
    const answer = safeToShare(
      review({
        changes: [change({ says: 'Left this here: -----BEGIN RSA PRIVATE KEY----- oops' })],
      }),
    );
    expect(answer.ok).toBe(false);
  });

  it('refuses in plain words, with no shop talk in the sentence', () => {
    const answer = safeToShare(
      review({ changes: [change({ title: 'ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' })] }),
    );
    if (answer.ok) throw new Error('expected a refusal');
    expect(answer.because).not.toMatch(/\b(api|token|git|commit|regex|json|string|null)\b/i);
    expect(answer.because).toMatch(/[.!]$/);
  });

  it('does not read the pictures, which are bytes and not words', () => {
    // A long enough picture will eventually contain anything by chance; scanning
    // it would refuse honest work.
    const noisy = `${DOT}sk-aaaaaaaaaaaaaaaaaaaaaaaa`;
    expect(safeToShare(review({ changes: [change({ after: noisy })] })).ok).toBe(true);
  });
});
