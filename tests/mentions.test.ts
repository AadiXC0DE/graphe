/** What `@` offers, from one list.
 *
 * Typing `@` offered skills and nothing else, so naming a file — the most
 * obvious thing somebody wants to do — meant typing a path correctly from
 * memory. A path typed by hand is a path the Guard has to refuse when it is
 * wrong, and a refusal for a typo is the app arguing about spelling.
 */

import { describe, expect, it } from 'vitest';

import {
  draftWith,
  mentionAt,
  MOST_OFFERED,
  offerFor,
  scoreOf,
  withMention,
  type Entry,
  type Skill,
} from '../src/lib/mentions';

const files: readonly Entry[] = [
  { path: 'src/components/Button.tsx', folder: false },
  { path: 'src/components/Composer.tsx', folder: false },
  { path: 'src/components', folder: true },
  { path: 'README.md', folder: false },
  { path: 'src/app/deeply/nested/Button.tsx', folder: false },
];

const skills: readonly Skill[] = [
  { name: 'Design review', handle: 'design-review', says: 'Look at it like a designer' },
];

describe('finding the `@` somebody is typing', () => {
  it('finds one at the start of a word', () => {
    expect(mentionAt('look at @But', 12)).toEqual({ from: 8, query: 'But' });
    expect(mentionAt('@', 1)).toEqual({ from: 0, query: '' });
  });

  /* An email address in the middle of a sentence is not somebody reaching for
     a file. */
  it('is not an email address', () => {
    expect(mentionAt('write to sam@example.com', 23)).toBeNull();
  });

  it('ends at a space, because a sentence is not a path', () => {
    expect(mentionAt('@Button and then some more', 26)).toBeNull();
  });

  it('reads from the caret, not the end of the line', () => {
    expect(mentionAt('@But something after', 4)).toEqual({ from: 0, query: 'But' });
  });

  it('is nothing when there is no `@` at all', () => {
    expect(mentionAt('just words', 10)).toBeNull();
  });
});

describe('how well a candidate answers', () => {
  /* The whole reason to have this rather than a filter. */
  it('finds letters in order, not only together', () => {
    expect(scoreOf('app/Button.tsx', 'apbtn')).toBeGreaterThanOrEqual(0);
  });

  it('scores a run of letters above the same letters scattered', () => {
    expect(scoreOf('Button.tsx', 'button')).toBeGreaterThan(scoreOf('app/Button.tsx', 'apbtn'));
  });

  it('is -1 when the letters are not there at all', () => {
    expect(scoreOf('Button.tsx', 'zzz')).toBe(-1);
  });

  it('does not care about case', () => {
    expect(scoreOf('Button.tsx', 'BUTTON')).toBeGreaterThanOrEqual(0);
  });
});

describe('the list it offers', () => {
  it('puts what was asked for first', () => {
    const offered = offerFor('button', { files, skills });
    expect(offered[0]?.name).toBe('Button.tsx');
  });

  /* A shallow file is more often the one meant than a deep one with the same
     name. */
  it('prefers the shallower of two files with the same name', () => {
    const offered = offerFor('button', { files, skills }).filter((one) => one.kind === 'file');
    expect(offered[0]?.insert).toBe('src/components/Button.tsx');
    expect(offered[1]?.insert).toBe('src/app/deeply/nested/Button.tsx');
  });

  it('offers skills and files as one gesture', () => {
    const offered = offerFor('design', { files, skills });
    expect(offered[0]?.kind).toBe('skill');
    expect(offered[0]?.insert).toBe('@design-review');
  });

  it('says which are folders, so a folder is never mistaken for a file', () => {
    const offered = offerFor('components', { files, skills });
    expect(offered.some((one) => one.kind === 'folder')).toBe(true);
  });

  it('inserts a real path, which is the whole point', () => {
    const offered = offerFor('composer', { files, skills });
    expect(offered[0]?.insert).toBe('src/components/Composer.tsx');
  });

  it('offers everything when nothing has been typed yet', () => {
    expect(offerFor('', { files, skills }).length).toBeGreaterThan(0);
  });

  it('offers nothing at all rather than everything for a query nothing matches', () => {
    expect(offerFor('zzzzzz', { files, skills })).toEqual([]);
  });

  it('stops before it stops being a list', () => {
    const many = Array.from({ length: 200 }, (_, at) => ({
      path: `src/thing${String(at)}.ts`,
      folder: false,
    }));
    expect(offerFor('thing', { files: many, skills: [] }).length).toBe(MOST_OFFERED);
  });
});

describe('putting one in the message', () => {
  it('replaces what was typed and leaves the caret after it', () => {
    const text = 'look at @But';
    const where = mentionAt(text, text.length);
    expect(where).not.toBeNull();
    const put = withMention(text, where!, {
      kind: 'file',
      name: 'Button.tsx',
      note: 'src/components',
      insert: 'src/components/Button.tsx',
    });
    expect(put.text).toBe('look at src/components/Button.tsx ');
    expect(put.caret).toBe(put.text.length);
  });

  it('keeps whatever came after it', () => {
    const text = '@But and the rest';
    const put = withMention(text, { from: 0, query: 'But' }, {
      kind: 'file',
      name: 'Button.tsx',
      note: '',
      insert: 'src/components/Button.tsx',
    });
    expect(put.text).toBe('src/components/Button.tsx  and the rest');
  });
});

describe('handing something to the box from another screen', () => {
  it('puts it where the caret is, with a space in front where one is needed', () => {
    expect(draftWith('', '@drift')).toBe('@drift ');
    expect(draftWith('use ', '@drift')).toBe('use @drift ');
    expect(draftWith('use', '@drift')).toBe('use @drift ');
  });

  it('replaces a half-typed mention rather than adding a second one', () => {
    expect(draftWith('look at @dri', '@drift')).toBe('look at @drift ');
  });

  it('keeps what comes after the caret', () => {
    expect(draftWith('one two', '@drift', 3)).toBe('one @drift  two');
  });

  it('leaves a half-typed mention alone when a command is being inserted', () => {
    expect(draftWith('@dri', '/ship')).toBe('@dri /ship ');
  });
});
