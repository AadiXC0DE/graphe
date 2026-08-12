/** Recipes: what a template file turns into, which ones reach the row of
 *  buttons, and which of them arrived with the folder rather than the person. */

import { describe, expect, it } from 'vitest';
import {
  merge,
  needsReview,
  parseTemplate,
  reviewWarning,
  STARTERS,
  type Recipe,
  type Untrusted,
} from '../src/lib/recipes';

const mine = (name: string, prompt = 'Do the thing.'): Recipe => ({
  id: `yours:${name}`,
  name,
  prompt,
  from: 'yours',
});

describe('the set we ship with', () => {
  it('is a short row of real sentences', () => {
    expect(STARTERS.length).toBeGreaterThanOrEqual(5);
    expect(STARTERS.length).toBeLessThanOrEqual(8);
    for (const recipe of STARTERS) {
      expect(recipe.from).toBe('graphe');
      expect(recipe.name.length).toBeGreaterThan(0);
      expect(recipe.prompt.split(' ').length).toBeGreaterThan(8);
    }
  });

  it('covers the three the product promises', () => {
    const names = STARTERS.map((recipe) => recipe.name.toLowerCase());
    expect(names.some((name) => name.includes('phone'))).toBe(true);
    expect(names.some((name) => name.includes('contrast'))).toBe(true);
    expect(names.some((name) => name.includes('colour'))).toBe(true);
  });

  it('has no two ids or names the same', () => {
    expect(new Set(STARTERS.map((recipe) => recipe.id)).size).toBe(STARTERS.length);
    expect(new Set(STARTERS.map((recipe) => recipe.name)).size).toBe(STARTERS.length);
  });

  it('never says any of the words the interface does not use', () => {
    const forbidden = /\b(git|commit|branch|staged|session|token|API|prompt)\b/i;
    for (const recipe of STARTERS) {
      expect(recipe.name).not.toMatch(forbidden);
      expect(recipe.prompt).not.toMatch(forbidden);
    }
  });
});

describe('reading one template file', () => {
  it('takes the name from frontmatter when there is one', () => {
    const recipe = parseTemplate(
      'rs.md',
      ['---', 'name: Make it work on a phone', '---', 'Check every breakpoint.'].join('\n'),
    );
    expect(recipe).toEqual({
      id: 'yours:rs',
      name: 'Make it work on a phone',
      prompt: 'Check every breakpoint.',
      from: 'yours',
    });
  });

  it('falls back to the description when there is no name', () => {
    const recipe = parseTemplate(
      'contrast.md',
      ['---', 'description: Check the contrast', 'argument-hint: "<page>"', '---', 'Look at it.'].join(
        '\n',
      ),
    );
    expect(recipe?.name).toBe('Check the contrast');
    expect(recipe?.prompt).toBe('Look at it.');
  });

  it('prefers the name over the description when both are there', () => {
    const recipe = parseTemplate(
      'x.md',
      ['---', 'description: A description', 'name: A name', '---', 'Body.'].join('\n'),
    );
    expect(recipe?.name).toBe('A name');
  });

  it('unquotes frontmatter values and ignores comments and blank lines', () => {
    const recipe = parseTemplate(
      'x.md',
      ['---', '# a comment', '', "name: 'Tidy the spacing'", '---', 'Body.'].join('\n'),
    );
    expect(recipe?.name).toBe('Tidy the spacing');
  });

  it('keeps the whole body, including its own dashes and headings', () => {
    const recipe = parseTemplate(
      'x.md',
      ['---', 'name: Audit', '---', '# Heading', '', '- one', '- two', ''].join('\n'),
    );
    expect(recipe?.prompt).toBe('# Heading\n\n- one\n- two');
  });

  it('reads frontmatter written with carriage returns', () => {
    const recipe = parseTemplate('x.md', '---\r\nname: Windows\r\n---\r\nBody.\r\n');
    expect(recipe?.name).toBe('Windows');
    expect(recipe?.prompt).toBe('Body.');
  });

  it('reads frontmatter after a byte order mark', () => {
    const recipe = parseTemplate('x.md', '\uFEFF---\nname: Marked\n---\nBody.');
    expect(recipe?.name).toBe('Marked');
  });

  describe('with no usable frontmatter', () => {
    it('names it from the filename', () => {
      expect(parseTemplate('check-the-contrast.md', 'Look at the text.')?.name).toBe(
        'Check the contrast',
      );
      expect(parseTemplate('match_brand_colours.md', 'Use the palette.')?.name).toBe(
        'Match brand colours',
      );
    });

    it('collapses runs of separators and ignores the ones at the ends', () => {
      expect(parseTemplate('--make__it--responsive_.md', 'Body.')?.name).toBe(
        'Make it responsive',
      );
    });

    it('leaves the capitals in a filename alone', () => {
      expect(parseTemplate('Figma-import.md', 'Body.')?.name).toBe('Figma import');
      expect(parseTemplate('iOS-spacing.md', 'Body.')?.name).toBe('iOS spacing');
    });

    it('takes the directory off, and the extension in any case', () => {
      expect(parseTemplate('/home/me/.pi/prompts/tidy-spacing.MD', 'Body.')?.id).toBe(
        'yours:tidy-spacing',
      );
      expect(parseTemplate('C:\\me\\prompts\\tidy-spacing.md', 'Body.')?.name).toBe(
        'Tidy spacing',
      );
    });

    it('uses the first real line when there is no filename to use', () => {
      const recipe = parseTemplate('.md', '\n\n# Check the grid\n\nEverything, please.');
      expect(recipe?.name).toBe('Check the grid');
      expect(recipe?.id).toBe('yours:check-the-grid');
    });
  });

  describe('when the frontmatter is malformed', () => {
    it('reads an unclosed fence as ordinary text rather than losing the file', () => {
      const recipe = parseTemplate('half-written.md', '---\nname: Never closed\nBody.');
      expect(recipe?.name).toBe('Half written');
      expect(recipe?.prompt).toBe('---\nname: Never closed\nBody.');
    });

    it('skips lines with no key and values that are empty', () => {
      const recipe = parseTemplate(
        'fallback-name.md',
        ['---', 'just a sentence', 'name:', ': nothing', '---', 'Body.'].join('\n'),
      );
      expect(recipe?.name).toBe('Fallback name');
      expect(recipe?.prompt).toBe('Body.');
    });

    it('ignores frontmatter that does not start the file', () => {
      const recipe = parseTemplate('later.md', 'A first line.\n---\nname: Too late\n---\n');
      expect(recipe?.name).toBe('Later');
      expect(recipe?.prompt.startsWith('A first line.')).toBe(true);
    });
  });

  describe('when there is nothing to send', () => {
    it('returns null for an empty file', () => {
      expect(parseTemplate('empty.md', '')).toBeNull();
    });

    it('returns null for a file of whitespace', () => {
      expect(parseTemplate('blank.md', '\n\n   \t\n')).toBeNull();
    });

    it('returns null for frontmatter with no body under it', () => {
      expect(parseTemplate('x.md', '---\nname: All label\n---\n')).toBeNull();
    });
  });

  it('never collides with one of ours', () => {
    const theirs = parseTemplate('contrast.md', 'Mine, not yours.');
    expect(theirs?.id).not.toBe(STARTERS.find((recipe) => recipe.id === 'contrast')?.id);
    expect(theirs?.from).toBe('yours');
  });
});

describe('what reaches the row of buttons', () => {
  it('puts the user’s own first', () => {
    const merged = merge([mine('My own thing')]);
    expect(merged[0]?.name).toBe('My own thing');
    expect(merged.slice(1).every((recipe) => recipe.from === 'graphe')).toBe(true);
  });

  it('is the starters alone when the user has none', () => {
    expect(merge([])).toEqual(STARTERS.slice(0, 8));
  });

  it('lets the user’s own win over a starter of the same name', () => {
    const ownContrast = mine('Check the contrast', 'Only AA, and only the body text.');
    const merged = merge([ownContrast]);
    const contrast = merged.filter((recipe) => recipe.name === 'Check the contrast');
    expect(contrast).toHaveLength(1);
    expect(contrast[0]?.prompt).toBe('Only AA, and only the body text.');
    expect(contrast[0]?.from).toBe('yours');
  });

  it('matches names regardless of case and stray spacing', () => {
    const merged = merge([mine('  check   THE contrast  ')]);
    expect(merged.filter((recipe) => recipe.name.trim().toLowerCase().includes('contrast'))).toHaveLength(
      1,
    );
  });

  it('keeps the first of two of the user’s own with the same name', () => {
    const merged = merge([mine('Same', 'first'), mine('Same', 'second')], []);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.prompt).toBe('first');
  });

  it('never shows more than eight', () => {
    const many = Array.from({ length: 20 }, (_, index) => mine(`Recipe ${index}`));
    expect(merge(many)).toHaveLength(8);
    expect(merge(many, STARTERS)).toHaveLength(8);
  });

  it('spends the whole cap on the user’s own before showing ours', () => {
    const many = Array.from({ length: 8 }, (_, index) => mine(`Recipe ${index}`));
    expect(merge(many).every((recipe) => recipe.from === 'yours')).toBe(true);
  });

  it('gives the rest of the cap to the starters', () => {
    const merged = merge([mine('One of mine'), mine('Another of mine')]);
    expect(merged).toHaveLength(Math.min(8, 2 + STARTERS.length));
    expect(merged.filter((recipe) => recipe.from === 'graphe').length).toBe(
      Math.min(6, STARTERS.length),
    );
  });

  it('drops anything with no name to put on a button', () => {
    expect(merge([mine('   ')], [])).toEqual([]);
  });

  it('takes a different starter set when given one', () => {
    const merged = merge([], [{ id: 'a', name: 'Only this', prompt: 'Body.', from: 'graphe' }]);
    expect(merged.map((recipe) => recipe.name)).toEqual(['Only this']);
  });

  it('changes nothing it was given', () => {
    const ours = [mine('Mine')];
    merge(ours);
    expect(ours).toHaveLength(1);
    expect(STARTERS).toHaveLength(8);
  });
});

describe('the ones worth a look first', () => {
  const sources: readonly Untrusted[] = [
    { name: 'Brand palette', where: 'home' },
    { name: 'Deploy helper', where: 'project' },
    { name: 'Contrast check', where: 'home' },
    { name: 'Read the env file', where: 'project' },
  ];

  it('picks out the ones that came with the folder', () => {
    expect(needsReview(sources).map((source) => source.name)).toEqual([
      'Deploy helper',
      'Read the env file',
    ]);
  });

  it('trusts the ones the user put in their own home', () => {
    expect(needsReview([{ name: 'Mine', where: 'home' }])).toEqual([]);
  });

  it('says nothing when there is nothing to say', () => {
    expect(needsReview([])).toEqual([]);
    expect(reviewWarning([])).toBeNull();
    expect(reviewWarning([{ name: 'Mine', where: 'home' }])).toBeNull();
  });

  it('names the one when there is only one', () => {
    const line = reviewWarning([{ name: 'Deploy helper', where: 'project' }]);
    expect(line).toContain('Deploy helper');
    expect(line).toContain('the folder you opened');
  });

  it('says it once for several', () => {
    const line = reviewWarning(sources);
    expect(line).not.toContain('Deploy helper');
    expect(line).toContain('the folder you opened');
  });

  it('is one sentence a person could read, in plain words', () => {
    for (const line of [reviewWarning([{ name: 'One', where: 'project' }]), reviewWarning(sources)]) {
      expect(line).not.toBeNull();
      expect(line?.length ?? 0).toBeLessThan(160);
      expect(line).not.toMatch(/\b(prompt|inject|untrusted|attacker|malicious|API)\b/i);
    }
  });
});
