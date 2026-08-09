/** The rules behind the chips above the composer.
 *
 *  Half of this is the language audit in miniature: every sentence a person can
 *  be shown when something does not come in is checked here for the two things
 *  that would make it a bad sentence — jargon, and blame. */

import { describe, expect, it } from 'vitest';
import {
  MAX_BYTES,
  checkFile,
  extensionOf,
  figmaLink,
  readableSize,
} from '../src/lib/attachments';

const KB = 1000;
const MB = 1000 * KB;

/* ========================================================================== */
/* What comes in                                                               */
/* ========================================================================== */

describe('what the composer takes', () => {
  it('takes the pictures designers actually drop', () => {
    for (const name of ['hero.png', 'sketch.JPG', 'shot.webp', 'photo.heic', 'icon.svg']) {
      expect(checkFile({ name, type: '', size: 2 * MB })).toEqual({ ok: true, kind: 'image' });
    }
  });

  it('takes the exports that come out of a design tool', () => {
    for (const name of ['Brand.pdf', 'Landing.fig', 'Old site.sketch', 'poster.ai']) {
      expect(checkFile({ name, type: '', size: 2 * MB })).toEqual({ ok: true, kind: 'document' });
    }
  });

  it("trusts the file's own type when the name has no extension", () => {
    expect(checkFile({ name: 'pasted image', type: 'image/png', size: 400 * KB })).toEqual({
      ok: true,
      kind: 'image',
    });
  });

  it('turns away what it cannot look at, and says what would work', () => {
    const verdict = checkFile({ name: 'contacts.csv', type: 'text/csv', size: 12 * KB });
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.because).toContain('.csv');
    expect(verdict.because).toContain('screenshot');
  });

  it('turns away a file that is too big, with both numbers in the sentence', () => {
    const verdict = checkFile({ name: 'huge.png', type: 'image/png', size: 48 * MB });
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.because).toContain('48 MB');
    expect(verdict.because).toContain(readableSize(MAX_BYTES));
  });

  it('accepts a file that is exactly at the ceiling', () => {
    expect(checkFile({ name: 'big.png', type: 'image/png', size: MAX_BYTES }).ok).toBe(true);
    expect(checkFile({ name: 'big.png', type: 'image/png', size: MAX_BYTES + 1 }).ok).toBe(false);
  });

  it('says something calm about an empty file rather than accepting nothing', () => {
    const verdict = checkFile({ name: 'empty.png', type: 'image/png', size: 0 });
    expect(verdict.ok).toBe(false);
  });

  it('never blames the person and never speaks in jargon', () => {
    const sentences = [
      checkFile({ name: 'contacts.csv', type: 'text/csv', size: 12 * KB }),
      checkFile({ name: 'huge.png', type: 'image/png', size: 48 * MB }),
      checkFile({ name: 'empty.png', type: 'image/png', size: 0 }),
    ].flatMap((verdict) => (verdict.ok ? [] : [verdict.because]));

    expect(sentences).toHaveLength(3);
    for (const sentence of sentences) {
      for (const word of [
        'invalid',
        'illegal',
        'unsupported',
        'error',
        'failed',
        'MIME',
        'you must',
        'you should',
        'not allowed',
      ]) {
        expect(sentence.toLowerCase()).not.toContain(word.toLowerCase());
      }
      expect(sentence.endsWith('.')).toBe(true);
    }
  });
});

describe('sizes, said the way a person says them', () => {
  it('rounds to something readable', () => {
    expect(readableSize(820)).toBe('820 bytes');
    expect(readableSize(820 * KB)).toBe('820 KB');
    expect(readableSize(1.2 * MB)).toBe('1.2 MB');
    expect(readableSize(48 * MB)).toBe('48 MB');
  });
});

describe('extensions', () => {
  it('reads the last one, and copes with none', () => {
    expect(extensionOf('hero.final.PNG')).toBe('png');
    expect(extensionOf('Screenshot 2026-08-10 at 14.02.11.png')).toBe('png');
    expect(extensionOf('no-extension')).toBe('');
  });
});

/* ========================================================================== */
/* Figma links                                                                 */
/* ========================================================================== */

describe('a pasted Figma link', () => {
  it('is recognised as a place, with the name that is already in the path', () => {
    const link = figmaLink('https://www.figma.com/design/8Kx2ab/Landing-v4?node-id=12-34');
    expect(link).not.toBeNull();
    expect(link?.name).toBe('Landing v4');
    expect(link?.what).toBe('Figma file');
  });

  it('knows the difference between a file, a prototype and a board', () => {
    expect(figmaLink('https://figma.com/proto/8Kx2/Landing-v4')?.what).toBe('Figma prototype');
    expect(figmaLink('https://figma.com/board/8Kx2/Workshop')?.what).toBe('FigJam board');
    expect(figmaLink('https://figma.com/file/8Kx2/Old-file')?.what).toBe('Figma file');
  });

  it('still gives a chip a name when the link has none', () => {
    expect(figmaLink('https://figma.com/design/8Kx2ab')?.name).toBe('Figma file');
  });

  it('reads a name that was escaped on its way into a URL', () => {
    expect(figmaLink('https://figma.com/design/8Kx2/Client%20work%202026')?.name).toBe(
      'Client work 2026',
    );
  });

  it('is not fooled by a lookalike domain', () => {
    expect(figmaLink('https://figma.com.evil.example/design/8Kx2/Landing')).toBeNull();
    expect(figmaLink('https://notfigma.com/design/8Kx2/Landing')).toBeNull();
  });

  it('leaves ordinary text and ordinary links alone', () => {
    expect(figmaLink('make the hero bigger')).toBeNull();
    expect(figmaLink('https://example.com/design/8Kx2/Landing')).toBeNull();
    expect(figmaLink('')).toBeNull();
  });

  it('does not mind the whitespace a paste brings with it', () => {
    expect(figmaLink('  https://figma.com/design/8Kx2/Landing-v4\n')?.name).toBe('Landing v4');
  });
});
