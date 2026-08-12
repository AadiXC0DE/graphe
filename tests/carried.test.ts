/** The extensions somebody said yes to, and the two promises that answer holds.
 *
 *  1. **One project's yes is not another's.** The same extension arriving in two
 *     cloned folders is two decisions, and the tests below are the reason to
 *     keep it keyed by folder when somebody later reaches for a flat list.
 *  2. **A yes covers the code it was given for.** The id carries a fingerprint
 *     of the file, so code that changed after the answer is a stranger again.
 *     That is the whole point of the thing and most of what is proved here.
 */

import { describe, expect, it } from 'vitest';

import { asTrusted, idFor, isTrusted, sameTrusted, trusting } from '../src/projects/carried';

const PAPER = '/Users/you/Sites/paper-street';
const ATLAS = '/Users/you/Sites/atlas-studio';

const FORMATTER = 'export function run() { return "tidy"; }';

describe('saying yes to an extension', () => {
  it('adds and takes back, and says the same thing twice', () => {
    const one = trusting({}, PAPER, 'tidy@a1', true);
    expect(one[PAPER]).toEqual(['tidy@a1']);

    // Saying yes to what is already trusted is not a second copy of it.
    expect(trusting(one, PAPER, 'tidy@a1', true)[PAPER]).toEqual(['tidy@a1']);

    const two = trusting(one, PAPER, 'notes@b2', true);
    expect(two[PAPER]).toEqual(['tidy@a1', 'notes@b2']);

    const back = trusting(two, PAPER, 'tidy@a1', false);
    expect(back[PAPER]).toEqual(['notes@b2']);
  });

  it('leaves nothing behind when the last one is taken back', () => {
    const trusted = trusting({}, PAPER, 'tidy@a1', true);
    expect(Object.keys(trusting(trusted, PAPER, 'tidy@a1', false))).toEqual([]);
  });

  it('never changes the store it was given', () => {
    const before = trusting({}, PAPER, 'tidy@a1', true);
    trusting(before, PAPER, 'notes@b2', true);
    expect(before[PAPER]).toEqual(['tidy@a1']);
  });

  it('takes back something nobody said yes to without complaining', () => {
    expect(trusting({}, PAPER, 'gone@zz', false)).toEqual({});
    const trusted = trusting({}, PAPER, 'tidy@a1', true);
    expect(trusting(trusted, PAPER, 'gone@zz', false)[PAPER]).toEqual(['tidy@a1']);
  });

  /* The whole reason it is keyed by folder. */
  it('keeps each project apart', () => {
    let trusted = trusting({}, PAPER, 'tidy@a1', true);
    trusted = trusting(trusted, ATLAS, 'tidy@a1', true);
    trusted = trusting(trusted, ATLAS, 'notes@b2', true);

    expect(trusted[PAPER]).toEqual(['tidy@a1']);
    expect(trusted[ATLAS]).toEqual(['tidy@a1', 'notes@b2']);

    // The same extension in two folders is two separate answers.
    trusted = trusting(trusted, PAPER, 'tidy@a1', false);
    expect(isTrusted(trusted, PAPER, 'tidy@a1')).toBe(false);
    expect(isTrusted(trusted, ATLAS, 'tidy@a1')).toBe(true);
  });

  it('ignores a nameless folder or a nameless extension', () => {
    expect(trusting({}, '', 'tidy@a1', true)).toEqual({});
    expect(trusting({}, PAPER, '', true)).toEqual({});
  });
});

describe('asking whether it may load', () => {
  it('answers no until somebody has answered yes', () => {
    const trusted = trusting({}, PAPER, 'tidy@a1', true);
    expect(isTrusted(trusted, PAPER, 'tidy@a1')).toBe(true);
    expect(isTrusted(trusted, PAPER, 'tidy@a2')).toBe(false);
    expect(isTrusted(trusted, ATLAS, 'tidy@a1')).toBe(false);
    expect(isTrusted({}, PAPER, 'tidy@a1')).toBe(false);
  });

  it('answers no to a nameless folder or a nameless extension', () => {
    const trusted = trusting({}, PAPER, 'tidy@a1', true);
    expect(isTrusted(trusted, '', 'tidy@a1')).toBe(false);
    expect(isTrusted(trusted, PAPER, '')).toBe(false);
  });
});

describe('reading the store back', () => {
  it('is empty for anything that is not a store', () => {
    expect(asTrusted(undefined)).toEqual({});
    expect(asTrusted(null)).toEqual({});
    expect(asTrusted('all of them')).toEqual({});
    expect(asTrusted(['tidy@a1'])).toEqual({});
  });

  it('drops what it cannot use and keeps the rest', () => {
    expect(
      asTrusted({
        [PAPER]: ['tidy@a1', 42, '', 'notes@b2', 'tidy@a1'],
        [ATLAS]: 'tidy@a1',
        '': ['tidy@a1'],
        '/Users/you/Sites/empty': [],
      }),
    ).toEqual({ [PAPER]: ['tidy@a1', 'notes@b2'] });
  });

  it('agrees with itself, and notices when it should not', () => {
    expect(sameTrusted({}, {})).toBe(true);
    expect(sameTrusted({ [PAPER]: ['tidy@a1'] }, { [PAPER]: ['tidy@a1'] })).toBe(true);
    expect(sameTrusted({ [PAPER]: ['tidy@a1'] }, { [PAPER]: ['tidy@a2'] })).toBe(false);
    expect(sameTrusted({ [PAPER]: ['tidy@a1'] }, { [PAPER]: ['tidy@a1', 'notes@b2'] })).toBe(false);
    expect(sameTrusted({ [PAPER]: ['tidy@a1'] }, { [ATLAS]: ['tidy@a1'] })).toBe(false);
    expect(sameTrusted({ [PAPER]: ['tidy@a1'] }, {})).toBe(false);
    expect(sameTrusted({}, { [PAPER]: ['tidy@a1'] })).toBe(false);
  });
});

describe('the id a yes is keyed by', () => {
  it('is the same every time for the same file', () => {
    expect(idFor('tidy', FORMATTER)).toBe(idFor('tidy', FORMATTER));
    expect(idFor('tidy', FORMATTER)).toContain('tidy@');
  });

  /* The reason the fingerprint is in there at all. */
  it('is a different id once the code changes', () => {
    const answered = idFor('tidy', FORMATTER);
    const edited = idFor('tidy', `${FORMATTER}\nrunSomethingElse();`);
    expect(edited).not.toBe(answered);
    expect(isTrusted(trusting({}, PAPER, answered, true), PAPER, edited)).toBe(false);

    // Down to a single character, or the edit walks in on the old answer.
    expect(idFor('tidy', 'a')).not.toBe(idFor('tidy', 'b'));
    expect(idFor('tidy', 'ab')).not.toBe(idFor('tidy', 'ba'));
  });

  it('is a different id for a different extension carrying the same code', () => {
    expect(idFor('notes', FORMATTER)).not.toBe(idFor('tidy', FORMATTER));
  });

  it('has nothing to key on without a name or a file', () => {
    expect(idFor('', FORMATTER)).toBe('');
    expect(idFor('   ', FORMATTER)).toBe('');
    expect(idFor('@@@', FORMATTER)).toBe('');
    expect(idFor('tidy', '')).toBe('');
    expect(idFor('', '')).toBe('');
  });

  /* An id nothing can be keyed by is not a yes anybody gave. */
  it('cannot be said yes to when there is nothing to key on', () => {
    const trusted = trusting({}, PAPER, idFor('', FORMATTER), true);
    expect(trusted).toEqual({});
    expect(isTrusted({ [PAPER]: ['tidy@a1'] }, PAPER, idFor('tidy', ''))).toBe(false);
  });

  it('cannot smuggle a separator or a space into the name half', () => {
    const sneaky = idFor('tidy@0000000000000000 x', FORMATTER);
    expect(sneaky.split('@')).toHaveLength(2);
    expect(sneaky).not.toContain(' ');
    expect(sneaky).not.toBe(idFor('tidy', FORMATTER));
  });

  it('is short, printable, and the same after a trip through the file', () => {
    const id = idFor('tidy', FORMATTER);
    expect(id.length).toBeLessThan(64);
    expect(id).toMatch(/^[A-Za-z0-9._-]+@[0-9a-f]+$/);
    expect(JSON.parse(JSON.stringify({ id })) as { id: string }).toEqual({ id });
    expect(JSON.parse(JSON.stringify(id)) as string).toBe(id);
  });
});
