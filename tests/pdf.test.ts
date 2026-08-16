/** Reading papers: turning an arxiv address into words.
 *
 *  The extraction itself — unpdf turning PDF bytes into text — needs a real
 *  PDF, which no test here fabricates. What is tested is everything around it:
 *  knowing a paper when one is handed over, reading its front matter off the
 *  export API's Atom feed, and slicing pages so a long paper is read a page or
 *  two at a time rather than all at once. */

import { describe, expect, it } from 'vitest';

import {
  arxivId,
  parseArxivMeta,
  slicePages,
} from '../src/agent/pi/pdf';

describe('knowing a paper when one is handed over', () => {
  it('finds the id in an abs address', () => {
    expect(arxivId('https://arxiv.org/abs/2401.01234')).toBe('2401.01234');
  });

  it('finds the id in a pdf address, with or without a version', () => {
    expect(arxivId('https://arxiv.org/pdf/2401.01234v2')).toBe('2401.01234');
    expect(arxivId('https://arxiv.org/pdf/2401.01234')).toBe('2401.01234');
  });

  it('does not claim an ordinary page is a paper', () => {
    expect(arxivId('https://example.com/abs/2401.01234')).toBeNull();
    expect(arxivId('https://arxiv.org/list/math')).toBeNull();
    expect(arxivId('https://en.wikipedia.org/wiki/Paper')).toBeNull();
  });
});

describe('the front matter off the export API', () => {
  const feed = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2401.01234v1</id>
    <title>Soft layers and hard choices</title>
    <author><name>Mira   Chen</name></author>
    <author><name>Ali  Khan</name></author>
    <summary>How a design system finds its floor.</summary>
  </entry>
</feed>`;

  it('reads title, authors, abstract and the pdf address', () => {
    const meta = parseArxivMeta(feed, '2401.01234');
    expect(meta).not.toBeNull();
    expect(meta?.title).toBe('Soft layers and hard choices');
    expect(meta?.authors).toBe('Mira Chen, Ali Khan');
    expect(meta?.abstract).toBe('How a design system finds its floor.');
    expect(meta?.pdf).toBe('https://arxiv.org/pdf/2401.01234');
  });

  it('returns nothing for a feed with no entry', () => {
    expect(parseArxivMeta('<feed></feed>', '2401.01234')).toBeNull();
  });
});

describe('reading one page at a time', () => {
  const pages = ['page one words', 'page two words', 'page three words'];

  it('marks where each page begins when there is more than one', () => {
    const { text } = slicePages(pages, 10_000);
    expect(text).toContain('— page 1 of 3 —');
    expect(text).toContain('page one words');
    expect(text).toContain('page three words');
  });

  it('reads a named range and says the rest is not here', () => {
    const { text, note } = slicePages(pages, 10_000, { fromPage: 2, toPage: 2 });
    expect(text).toContain('page two words');
    expect(text).not.toContain('page one words');
    expect(text).not.toContain('page three words');
    expect(note).toContain('before 2');
    expect(note).toContain('after 2');
  });

  it('stops at the character cap and says the rest is not here', () => {
    const long = ['a'.repeat(400), 'b'.repeat(400), 'c'.repeat(400)];
    const { text, note } = slicePages(long, 500);
    expect(text).toContain('a'.repeat(400));
    expect(text).not.toContain('b'.repeat(400));
    expect(note).toContain('first pages');
  });
});