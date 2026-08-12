/** A set of recipes travelling between two people.
 *
 * The file arrives from somewhere else, so it is read the way anything from
 * outside is read: it may name things, and it may not decide where anything
 * goes. The other half is that a file somebody mangled has to come back as a
 * sentence they can act on — never as a crash, and never as silence where one
 * of their own recipes used to be.
 */

import { describe, expect, it } from 'vitest';

import {
  fileNameFor,
  filesFor,
  merge,
  parseTemplate,
  readSet,
  STARTERS,
  writeSet,
  type Recipe,
} from '../src/lib/recipes';

const mine = (name: string, prompt = 'Do the thing, please.'): Recipe => ({
  id: `yours:${name}`,
  name,
  prompt,
  from: 'yours',
});

function opened(text: string, existing: readonly Recipe[] = []) {
  const out = readSet(text, existing);
  if (!out.ok) throw new Error(`expected a set, got: ${out.problem}`);
  return out;
}

/* ========================================================================== */
/* S-01 there and back                                                         */
/* ========================================================================== */

describe('sending a set and reading it back', () => {
  const set: readonly Recipe[] = [
    mine('Check the contrast', 'Only AA, and only the body text.'),
    mine('Tidy the spacing', 'Bring everything back onto the nearest step.'),
  ];

  it('comes back the same', () => {
    const back = opened(writeSet(set)).recipes;
    expect(back.map((recipe) => [recipe.name, recipe.prompt])).toEqual([
      ['Check the contrast', 'Only AA, and only the body text.'],
      ['Tidy the spacing', 'Bring everything back onto the nearest step.'],
    ]);
  });

  it('is a file somebody could read without us', () => {
    const text = writeSet(set);
    expect(text.startsWith('# Recipes')).toBe(true);
    expect(text).toContain('## Check the contrast');
    expect(text).toContain('Only AA, and only the body text.');
    expect(text.endsWith('\n')).toBe(true);
  });

  it('takes a title from whoever is sending it', () => {
    expect(writeSet(set, { title: 'How we work here' }).startsWith('# How we work here')).toBe(true);
  });

  it('survives the whole set we ship with', () => {
    const back = opened(writeSet(STARTERS)).recipes;
    expect(back.map((recipe) => recipe.name)).toEqual(STARTERS.map((recipe) => recipe.name));
    expect(back.map((recipe) => recipe.prompt)).toEqual(STARTERS.map((recipe) => recipe.prompt));
  });

  it('keeps a heading somebody wrote inside their own words', () => {
    const long = mine('Audit', '# Heading\n\n## Another\n\n- one\n- two');
    expect(opened(writeSet([long])).recipes).toHaveLength(1);
    expect(opened(writeSet([long])).recipes[0]?.prompt).toBe('# Heading\n\n## Another\n\n- one\n- two');
  });

  it('reads a file written on a machine that ends lines differently', () => {
    const text = writeSet(set).replace(/\n/g, '\r\n');
    expect(opened(text).recipes.map((recipe) => recipe.name)).toEqual([
      'Check the contrast',
      'Tidy the spacing',
    ]);
  });

  it('reads a file that opens with a byte order mark', () => {
    expect(opened(`\uFEFF${writeSet(set)}`).recipes).toHaveLength(2);
  });

  it('everything that comes in belongs to the person who opened it', () => {
    for (const recipe of opened(writeSet(set)).recipes) {
      expect(recipe.from).toBe('yours');
      expect(recipe.id.startsWith('yours:')).toBe(true);
    }
  });

  it('gives every one its own name to be keyed by', () => {
    const same = opened(writeSet([mine('One'), mine('One'), mine('One')]));
    expect(new Set(same.recipes.map((recipe) => recipe.id)).size).toBe(same.recipes.length);
  });

  it('drops in beside the ones already there', () => {
    const back = opened(writeSet(set)).recipes;
    const shown = merge(back);
    expect(shown[0]?.name).toBe('Check the contrast');
    expect(shown.some((recipe) => recipe.from === 'graphe')).toBe(true);
  });
});

/* ========================================================================== */
/* S-02 a set with nothing in it                                               */
/* ========================================================================== */

describe('a set with nothing in it', () => {
  it('writes a file rather than nothing at all', () => {
    expect(writeSet([])).toBe('# Recipes\n');
  });

  it('says there was nothing in it rather than pretending it worked', () => {
    const out = readSet(writeSet([]));
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.problem).toContain('couldn’t find any recipes');
  });

  it('leaves out a recipe with no name or nothing to send', () => {
    const text = writeSet([mine('   '), mine('Real one'), mine('Empty', '   ')]);
    expect(opened(text).recipes.map((recipe) => recipe.name)).toEqual(['Real one']);
  });

  it('says so for a heading with nothing under it', () => {
    const out = readSet('# Recipes\n\n## All label\n\n## And another\n');
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.problem.length).toBeLessThan(160);
  });
});

/* ========================================================================== */
/* S-03 a file that is not one of ours                                         */
/* ========================================================================== */

describe('a file that makes no sense', () => {
  const problems = [
    '',
    '   \n\t\n',
    'Just a sentence somebody typed.',
    '# A heading and nothing else',
    '<html><body>Not this either</body></html>',
    '{"name": "not this shape"}',
  ];

  for (const text of problems) {
    it(`says something a person can act on for ${JSON.stringify(text.slice(0, 24))}`, () => {
      const out = readSet(text);
      expect(out.ok).toBe(false);
      if (out.ok === false) {
        expect(out.problem.length).toBeGreaterThan(10);
        expect(out.problem.length).toBeLessThan(160);
        expect(out.problem).not.toMatch(/\b(parse|token|JSON|invalid|error|null|undefined)\b/i);
      }
    });
  }

  it('never throws, whatever it is handed', () => {
    for (const odd of [null, undefined, 42, {}, [], () => 1]) {
      expect(() => readSet(odd as unknown as string)).not.toThrow();
      expect(readSet(odd as unknown as string).ok).toBe(false);
    }
  });

  it('takes control characters out of a name rather than passing them on', () => {
    const back = opened('## Odd\u0000 name\u001f here\n\nBody.');
    expect(back.recipes[0]?.name).toBe('Odd name here');
  });

  it('reads a set even when there is no title above it', () => {
    expect(opened('## One\n\nBody.\n').recipes[0]?.name).toBe('One');
  });
});

/* ========================================================================== */
/* S-04 a file that is too much                                                */
/* ========================================================================== */

describe('a file that is too much to take in', () => {
  it('turns down one that is enormous', () => {
    const huge = `# Recipes\n\n## One\n\n${'x'.repeat(400_001)}`;
    const out = readSet(huge);
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.problem).toContain('too big');
  });

  it('turns down one holding more than anybody shares at once', () => {
    const many = Array.from({ length: 201 }, (_, index) => `## Recipe ${index}\n\nBody.`);
    const out = readSet(`# Recipes\n\n${many.join('\n\n')}`);
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.problem).toContain('more recipes');
  });

  it('takes a set that sits just inside', () => {
    const many = Array.from({ length: 200 }, (_, index) => `## Recipe ${index}\n\nBody.`);
    expect(opened(`# Recipes\n\n${many.join('\n\n')}`).recipes).toHaveLength(200);
  });

  it('shortens one very long recipe rather than turning the set down', () => {
    const back = opened(`## One\n\n${'word '.repeat(4000)}`);
    expect(back.recipes[0]?.prompt.length).toBeLessThanOrEqual(8000);
  });

  it('shortens a name too long to sit on a button', () => {
    expect(opened(`## ${'n'.repeat(300)}\n\nBody.`).recipes[0]?.name.length).toBe(80);
  });
});

/* ========================================================================== */
/* S-05 two of the same name                                                   */
/* ========================================================================== */

describe('when a name is already taken', () => {
  it('keeps the one already here and numbers the new one', () => {
    const here = [mine('Check the contrast', 'Mine, and I want to keep it.')];
    const out = opened(writeSet([mine('Check the contrast', 'Theirs.')]), here);
    expect(out.recipes).toHaveLength(1);
    expect(out.recipes[0]?.name).toBe('Check the contrast (2)');
    expect(out.recipes[0]?.prompt).toBe('Theirs.');
    expect(here[0]?.prompt).toBe('Mine, and I want to keep it.');
  });

  it('keeps counting when the numbered one is taken as well', () => {
    const here = [mine('Audit'), mine('Audit (2)')];
    expect(opened('## Audit\n\nBody.', here).recipes[0]?.name).toBe('Audit (3)');
  });

  it('spots the clash however it was capitalised or spaced, and keeps their wording', () => {
    const here = [mine('Check the contrast')];
    expect(opened('##   check   THE contrast  \n\nBody.', here).recipes[0]?.name).toBe(
      'check THE contrast (2)',
    );
  });

  it('keeps two of the same name inside one file, rather than losing one', () => {
    const out = opened('## Same\n\nFirst.\n\n## Same\n\nSecond.');
    expect(out.recipes.map((recipe) => recipe.name)).toEqual(['Same', 'Same (2)']);
    expect(out.recipes.map((recipe) => recipe.prompt)).toEqual(['First.', 'Second.']);
  });

  it('says what it did, in one line a person would read', () => {
    const here = [mine('Check the contrast')];
    const one = opened(writeSet([mine('Check the contrast')]), here);
    expect(one.note).toContain('already had');
    expect(one.note.length).toBeLessThan(200);

    const two = opened(writeSet([mine('Check the contrast'), mine('Tidy the spacing')]), [
      mine('Check the contrast'),
      mine('Tidy the spacing'),
    ]);
    expect(two.note).toContain('2 of them');
  });

  it('names the one when only one came in', () => {
    expect(opened(writeSet([mine('Check the contrast')])).note).toContain('Check the contrast');
  });

  it('counts them when several came in', () => {
    expect(opened(writeSet([mine('One'), mine('Two'), mine('Three')])).note).toContain('3 recipes');
  });

  it('changes nothing it was given', () => {
    const here = [mine('Audit')];
    readSet('## Audit\n\nBody.', here);
    expect(here).toHaveLength(1);
    expect(here[0]?.name).toBe('Audit');
  });
});

/* ========================================================================== */
/* S-06 a file may name a recipe, never a place                                 */
/* ========================================================================== */

describe('where an arriving recipe is allowed to be written', () => {
  const hostile = [
    '../../etc/passwd',
    '../../../.ssh/authorized_keys',
    '..\\..\\Windows\\System32\\drivers',
    '/etc/shadow',
    'C:\\Windows\\notepad',
    './../secret',
    '~/.zshrc',
    'a/b/c',
    '....//....//x',
  ];

  for (const name of hostile) {
    it(`cannot reach outside with ${name}`, () => {
      const file = fileNameFor(name);
      expect(file).not.toContain('/');
      expect(file).not.toContain('\\');
      expect(file).not.toContain('..');
      expect(file.startsWith('.')).toBe(false);
      expect(file.endsWith('.md')).toBe(true);
      expect(/^[a-z0-9][a-z0-9-]*\.md$/.test(file)).toBe(true);
    });
  }

  it('still gives a file a name when there is nothing usable in it', () => {
    expect(fileNameFor('')).toBe('recipe.md');
    expect(fileNameFor('....')).toBe('recipe.md');
    expect(fileNameFor('नमस्ते')).toBe('recipe.md');
  });

  it('keeps a name a person would recognise when there is one', () => {
    expect(fileNameFor('Check the contrast')).toBe('check-the-contrast.md');
    expect(fileNameFor('  Tidy   the  spacing ')).toBe('tidy-the-spacing.md');
  });

  it('keeps the name short enough for any machine', () => {
    expect(fileNameFor('n'.repeat(300)).length).toBeLessThanOrEqual(63);
  });

  it('steps around the names Windows will not give a file', () => {
    expect(fileNameFor('con')).toBe('recipe-con.md');
    expect(fileNameFor('LPT1')).toBe('recipe-lpt1.md');
  });

  it('gives two recipes with the same name two files', () => {
    const files = filesFor([mine('Audit', 'First.'), mine('Audit', 'Second.')]);
    expect(files.map((one) => one.file)).toEqual(['audit.md', 'audit-2.md']);
  });

  it('gives two hostile names two harmless files', () => {
    const files = filesFor([mine('../../etc/passwd', 'a'), mine('..\\..\\etc\\passwd', 'b')]);
    expect(files.map((one) => one.file)).toEqual(['etc-passwd.md', 'etc-passwd-2.md']);
  });

  it('writes each one so it reads back as the recipe it was', () => {
    const files = filesFor([mine('Check the contrast', 'Only AA.')]);
    const read = parseTemplate(files[0]!.file, files[0]!.contents);
    expect(read?.name).toBe('Check the contrast');
    expect(read?.prompt).toBe('Only AA.');
  });

  it('leaves out anything with no name or nothing to send', () => {
    expect(filesFor([mine('  '), mine('Nothing', '   ')])).toEqual([]);
  });
});
