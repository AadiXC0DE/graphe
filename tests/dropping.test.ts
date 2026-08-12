/** Dropping something on the app, from anywhere on it.
 *
 * The window is the target, which means these rules answer for everything a
 * person can let go of over a screen: a picture, a folder of exports, a link
 * dragged out of a browser tab, and a drag that arrives carrying nothing at
 * all. Every one of those ends in a sentence rather than in silence, and every
 * sentence is checked here for the two things that would make it a bad one —
 * jargon, and blame.
 */

import { describe, expect, it } from 'vitest';

import {
  MAX_AT_ONCE,
  MAX_BYTES,
  NOT_DRAGGING,
  carriesSomething,
  deeper,
  dragging,
  readDropped,
  readableSize,
  shallower,
  type FileFacts,
} from '../src/lib/attachments';

const KB = 1000;
const MB = 1000 * KB;

function picture(name = 'hero.png', size = 400 * KB): FileFacts {
  return { name, type: 'image/png', size };
}

/** Every sentence a drop can produce, so a sweep can be sure it has them all. */
function sentencesFrom(...landings: readonly ReturnType<typeof readDropped>[]): readonly string[] {
  return landings.map((one) => one.because).filter((one): one is string => one !== null);
}

/* ========================================================================== */
/* Whether a drag is worth answering at all                                    */
/* ========================================================================== */

describe('what is worth lighting the window up for', () => {
  it('takes files and links', () => {
    expect(carriesSomething(['Files'])).toBe(true);
    expect(carriesSomething(['text/uri-list', 'text/plain'])).toBe(true);
    expect(carriesSomething(['text/plain', 'Files'])).toBe(true);
  });

  it('leaves dragged words alone, because moving a word is not attaching one', () => {
    expect(carriesSomething(['text/plain'])).toBe(false);
    expect(carriesSomething(['text/html', 'text/plain'])).toBe(false);
    expect(carriesSomething([])).toBe(false);
  });

  it('says no to a payload that is not a list at all', () => {
    expect(carriesSomething(null)).toBe(false);
    expect(carriesSomething(undefined)).toBe(false);
    expect(carriesSomething('Files' as unknown as readonly string[])).toBe(false);
    expect(carriesSomething({ 0: 'Files' } as unknown as readonly string[])).toBe(false);
  });
});

/* ========================================================================== */
/* The drag counter                                                            */
/* ========================================================================== */

describe('the drag counter', () => {
  it('stays on while the pointer crosses child after child', () => {
    // enter window, enter panel, leave panel, enter thread, leave thread
    let depth = NOT_DRAGGING;
    depth = deeper(depth);
    expect(dragging(depth)).toBe(true);
    depth = deeper(depth);
    depth = shallower(depth);
    expect(dragging(depth)).toBe(true);
    depth = deeper(depth);
    depth = shallower(depth);
    expect(dragging(depth)).toBe(true);
  });

  it('goes off only when the last leave is answered', () => {
    let depth = deeper(deeper(NOT_DRAGGING));
    depth = shallower(depth);
    expect(dragging(depth)).toBe(true);
    depth = shallower(depth);
    expect(dragging(depth)).toBe(false);
    expect(depth).toBe(NOT_DRAGGING);
  });

  it('never goes below nothing, however many leaves arrive', () => {
    let depth = NOT_DRAGGING;
    for (let i = 0; i < 5; i += 1) depth = shallower(depth);
    expect(depth).toBe(NOT_DRAGGING);
    expect(dragging(depth)).toBe(false);
    // And the next drag still turns it on.
    expect(dragging(deeper(depth))).toBe(true);
  });

  it('survives a count that has gone strange', () => {
    expect(deeper(Number.NaN)).toBe(1);
    expect(shallower(Number.NaN)).toBe(NOT_DRAGGING);
    expect(deeper(-4)).toBe(1);
    expect(dragging(Number.NaN)).toBe(false);
    expect(dragging(-1)).toBe(false);
  });
});

/* ========================================================================== */
/* What comes in                                                               */
/* ========================================================================== */

describe('what a drop brings in', () => {
  it('takes pictures and design exports, already sorted into what they are', () => {
    const landed = readDropped({
      files: [picture('shot.png'), { name: 'Brand.pdf', type: 'application/pdf', size: 2 * MB }],
    });
    expect(landed.taken.map((one) => one.kind)).toEqual(['image', 'document']);
    expect(landed.taken.map((one) => one.file.name)).toEqual(['shot.png', 'Brand.pdf']);
    expect(landed.because).toBe(null);
    expect(landed.link).toBe(null);
  });

  it('keeps what it can and explains the rest, rather than dropping both', () => {
    const landed = readDropped({
      files: [picture(), { name: 'contacts.csv', type: 'text/csv', size: 12 * KB }],
    });
    expect(landed.taken).toHaveLength(1);
    expect(landed.because).toContain('.csv');
  });

  it('turns away one that is over the ceiling, with both numbers said', () => {
    const landed = readDropped({ files: [picture('huge.png', 48 * MB)] });
    expect(landed.taken).toHaveLength(0);
    expect(landed.because).toContain('48 MB');
    expect(landed.because).toContain(readableSize(MAX_BYTES));
  });

  it('takes one that is exactly at the ceiling', () => {
    const landed = readDropped({ files: [picture('big.png', MAX_BYTES)] });
    expect(landed.taken).toHaveLength(1);
    expect(landed.because).toBe(null);
  });

  it('says something about a file that came through empty', () => {
    const landed = readDropped({ files: [picture('nothing.png', 0)] });
    expect(landed.taken).toHaveLength(0);
    expect(landed.because).toMatch(/empty/i);
  });

  it('takes a folder of exports up to the point where it is a pile', () => {
    const many = Array.from({ length: MAX_AT_ONCE + 4 }, (_, i) => picture(`frame-${i}.png`));
    const landed = readDropped({ files: many });
    expect(landed.taken).toHaveLength(MAX_AT_ONCE);
    expect(landed.because).toContain(String(MAX_AT_ONCE));
  });

  it('says nothing about the pile when it fits exactly', () => {
    const many = Array.from({ length: MAX_AT_ONCE }, (_, i) => picture(`frame-${i}.png`));
    const landed = readDropped({ files: many });
    expect(landed.taken).toHaveLength(MAX_AT_ONCE);
    expect(landed.because).toBe(null);
  });

  it('leads with the refusal rather than the count when both are true', () => {
    const many = [
      { name: 'notes.csv', type: 'text/csv', size: 2 * KB },
      ...Array.from({ length: MAX_AT_ONCE + 2 }, (_, i) => picture(`frame-${i}.png`)),
    ];
    expect(readDropped({ files: many }).because).toContain('.csv');
  });
});

/* ========================================================================== */
/* A link, dragged rather than pasted                                          */
/* ========================================================================== */

describe('a link dropped on the window', () => {
  it('recognises a Figma link and reads the name out of it', () => {
    const landed = readDropped({ text: 'https://www.figma.com/design/8Kx2/Landing-v4' });
    expect(landed.link).toEqual({
      url: 'https://www.figma.com/design/8Kx2/Landing-v4',
      name: 'Landing v4',
      what: 'Figma file',
    });
    expect(landed.taken).toHaveLength(0);
    expect(landed.because).toBe(null);
  });

  it('recognises the other places a design lives', () => {
    expect(readDropped({ text: 'https://figma.com/proto/abc/Flow' }).link?.what).toBe(
      'Figma prototype',
    );
    expect(readDropped({ text: 'https://figma.com/board/abc/Map' }).link?.what).toBe(
      'FigJam board',
    );
  });

  it('is not fooled by something that merely looks like one', () => {
    const impostors = [
      'https://figma.com.evil.example/design/abc/Landing',
      'https://notfigma.com/design/abc/Landing',
      'https://evil.example/https://figma.com/design/abc',
      'figma.com/design/abc/Landing',
      'https://figma.com/design/',
      'have a look at https://www.figma.com/design/8Kx2/Landing-v4',
    ];
    for (const one of impostors) {
      const landed = readDropped({ text: one });
      expect(landed.link, one).toBe(null);
      expect(landed.because, one).toMatch(/Figma link/);
    }
  });

  it('prefers the files when a drag carries both', () => {
    const landed = readDropped({
      files: [picture()],
      text: 'https://www.figma.com/design/8Kx2/Landing-v4',
    });
    expect(landed.taken).toHaveLength(1);
    expect(landed.link).toBe(null);
  });

  it('trims the whitespace a drag from a browser tab brings along', () => {
    expect(readDropped({ text: '  https://figma.com/file/abc/Old-site \n' }).link?.name).toBe(
      'Old site',
    );
  });
});

/* ========================================================================== */
/* Payloads that make no sense                                                 */
/* ========================================================================== */

describe('a drop that carries nothing usable', () => {
  it('answers a drag with nothing in it', () => {
    const landed = readDropped({ files: [], text: '' });
    expect(landed.taken).toHaveLength(0);
    expect(landed.link).toBe(null);
    expect(landed.because).toMatch(/Nothing came through/);
  });

  it('survives a payload that is missing, empty or the wrong shape', () => {
    for (const payload of [null, undefined, {}, { files: null, text: null }]) {
      const landed = readDropped(payload as never);
      expect(landed.taken).toHaveLength(0);
      expect(landed.link).toBe(null);
      expect(typeof landed.because).toBe('string');
    }
  });

  it('ignores entries that are not files without losing the ones that are', () => {
    const landed = readDropped({
      files: [
        null,
        undefined,
        'hero.png',
        { name: 'no size' },
        { size: 12 },
        picture(),
      ] as unknown as readonly FileFacts[],
    });
    expect(landed.taken).toHaveLength(1);
    expect(landed.taken[0]?.file.name).toBe('hero.png');
  });

  it('does not mistake a list that is not a list for files', () => {
    const landed = readDropped({ files: { length: 1 } as unknown as readonly FileFacts[] });
    expect(landed.taken).toHaveLength(0);
    expect(landed.because).toMatch(/Nothing came through/);
  });

  it('ignores text that is not text', () => {
    const landed = readDropped({ text: 42 as unknown as string });
    expect(landed.link).toBe(null);
    expect(landed.because).toMatch(/Nothing came through/);
  });
});

/* ========================================================================== */
/* The words                                                                   */
/* ========================================================================== */

describe('the sentences a drop can produce', () => {
  const everything = sentencesFrom(
    readDropped({ files: [] }),
    readDropped({ text: 'https://example.com/thing' }),
    readDropped({ files: [{ name: 'contacts.csv', type: 'text/csv', size: 12 * KB }] }),
    readDropped({ files: [picture('huge.png', 48 * MB)] }),
    readDropped({ files: [picture('nothing.png', 0)] }),
    readDropped({ files: Array.from({ length: MAX_AT_ONCE + 1 }, () => picture()) }),
  );

  it('has one for every way a drop can go wrong', () => {
    expect(everything).toHaveLength(6);
  });

  it('speaks no jargon', () => {
    const jargon =
      /\b(git|commit|branch|staged|session|token|API|upload|uploaded|MIME|drag[- ]?and[- ]?drop|payload|blob|buffer|invalid|unsupported|error|failed)\b/i;
    for (const sentence of everything) expect(sentence).not.toMatch(jargon);
  });

  it('never blames the person', () => {
    for (const sentence of everything) {
      expect(sentence).not.toMatch(/\byou (?:cannot|can't|must|should|need to)\b/i);
      expect(sentence).not.toMatch(/\b(sorry|oops)\b/i);
    }
  });

  it('always says what would work instead', () => {
    for (const sentence of everything) {
      expect(sentence).toMatch(/\b(will work|would work|usually|took the first|nothing in it)\b/i);
    }
  });

  it('is written in whole sentences', () => {
    for (const sentence of everything) {
      expect(sentence.trim()).toBe(sentence);
      expect(sentence.charAt(0)).toBe(sentence.charAt(0).toUpperCase());
      expect(sentence).toMatch(/[.!?]$/);
    }
  });
});
