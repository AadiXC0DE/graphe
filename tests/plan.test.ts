/** Plan before doing.
 *
 * Three things are protected here. That the read-only toolset is the Guard's
 * own answer and not a second list that can rot. That a proposal survives every
 * shape a model writes one in, including the shapes that are not lists at all.
 * And that "worth planning" stays hard to trigger: the whole feature is a
 * default, so a wrong yes lands on somebody who only wanted the header bigger.
 */

import { describe, expect, it } from 'vitest';

import { PLAN_WORDS, parseProposal, readOnlyTools, worthPlanning } from '../src/agent/plan';

describe('readOnlyTools', () => {
  it('keeps the reads and drops everything that can change a project', () => {
    expect(readOnlyTools(['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls'])).toEqual([
      'read',
      'grep',
      'find',
      'ls',
    ]);
  });

  it('drops deleting, moving and renaming', () => {
    expect(readOnlyTools(['delete', 'rm', 'move', 'rename', 'mkdir', 'applyPatch'])).toEqual([]);
  });

  it('keeps looking things up, which changes nothing', () => {
    expect(readOnlyTools(['websearch', 'webfetch', 'glob', 'codebaseSearch'])).toEqual([
      'websearch',
      'webfetch',
      'glob',
      'codebaseSearch',
    ]);
  });

  it('drops a tool it has never heard of', () => {
    expect(readOnlyTools(['read', 'frobnicate', 'deployEverything'])).toEqual(['read']);
  });

  it('drops anything reaching for the guard itself', () => {
    expect(readOnlyTools(['read', 'setPermissions', 'bypassPolicy'])).toEqual(['read']);
  });

  it('does not care how a name is spelled', () => {
    expect(readOnlyTools(['Read', 'READFILE', 'Write', 'strReplace'])).toEqual(['Read', 'READFILE']);
  });

  it('gives back the caller’s own spelling and order', () => {
    expect(readOnlyTools(['ls', 'write', 'Grep', 'read'])).toEqual(['ls', 'Grep', 'read']);
  });

  it('has nothing to say about an empty list', () => {
    expect(readOnlyTools([])).toEqual([]);
  });
});

describe('parseProposal', () => {
  it('reads a markdown numbered list', () => {
    const { steps, caveats } = parseProposal(
      ['1. Look at the three pages that share the header', '2. Change the logo on all of them', '3. Check the spacing on a phone'].join('\n'),
    );
    expect(steps).toEqual([
      'Look at the three pages that share the header',
      'Change the logo on all of them',
      'Check the spacing on a phone',
    ]);
    expect(caveats).toEqual([]);
  });

  it('reads a numbered list written with brackets', () => {
    expect(parseProposal('1) Swap the hero image\n2) Move the caption under it').steps).toEqual([
      'Swap the hero image',
      'Move the caption under it',
    ]);
  });

  it('reads dashes, stars and bullets alike', () => {
    expect(parseProposal('- Tidy the footer\n* Fix the links\n• Check both on a phone').steps).toEqual([
      'Tidy the footer',
      'Fix the links',
      'Check both on a phone',
    ]);
  });

  it('drops a heading above the list', () => {
    const { steps } = parseProposal(
      ['## What I would do', 'Here is how I would approach it:', '', '1. Read the contact page', '2. Add the new field'].join('\n'),
    );
    expect(steps).toEqual(['Read the contact page', 'Add the new field']);
  });

  it('turns prose with no list into a single step', () => {
    const { steps, caveats } = parseProposal(
      'I would change the colour of the button on the contact page and leave everything else alone.',
    );
    expect(steps).toEqual([
      'I would change the colour of the button on the contact page and leave everything else alone.',
    ]);
    expect(caveats).toEqual([]);
  });

  it('joins prose spread over several lines into that one step', () => {
    const { steps } = parseProposal('I would change the button colour.\n\nThen check it on a phone.');
    expect(steps).toEqual(['I would change the button colour. Then check it on a phone.']);
  });

  it('trims markdown emphasis', () => {
    expect(
      parseProposal('- **Change** the *header* on `index.html`\n- Update __the footer__ too').steps,
    ).toEqual(['Change the header on index.html', 'Update the footer too']);
  });

  it('leaves underscores inside a file name alone', () => {
    expect(parseProposal('- Replace hero_image_large.png').steps).toEqual([
      'Replace hero_image_large.png',
    ]);
  });

  it('ignores empty items', () => {
    expect(parseProposal('1. Read the page\n2.   \n-\n3. Change the title').steps).toEqual([
      'Read the page',
      'Change the title',
    ]);
  });

  it('has no steps for empty text', () => {
    expect(parseProposal('')).toEqual({ steps: [], caveats: [] });
    expect(parseProposal('   \n\n  ')).toEqual({ steps: [], caveats: [] });
  });

  it('takes the tick boxes off a checklist', () => {
    expect(parseProposal('- [ ] Read the page\n- [x] Change the title').steps).toEqual([
      'Read the page',
      'Change the title',
    ]);
  });

  it('keeps a wrapped item in one piece', () => {
    const { steps } = parseProposal(
      ['1. Change the header on every page', '   so the logo sits on the left', '2. Check it on a phone'].join('\n'),
    );
    expect(steps).toEqual([
      'Change the header on every page so the logo sits on the left',
      'Check it on a phone',
    ]);
  });

  it('caps the list at twelve and says how many are left', () => {
    const long = Array.from({ length: 15 }, (_, index) => `${index + 1}. Step ${index + 1}`).join('\n');
    const { steps, caveats } = parseProposal(long);
    expect(steps).toHaveLength(12);
    expect(steps[11]).toBe('Step 12');
    expect(caveats).toEqual(['There are 3 more steps after these.']);
  });

  it('says "one more step" when exactly one is left over', () => {
    const long = Array.from({ length: 13 }, (_, index) => `- Step ${index + 1}`).join('\n');
    expect(parseProposal(long).caveats).toEqual(['There is one more step after these.']);
  });

  it('keeps a sentence that qualifies the plan', () => {
    const { steps, caveats } = parseProposal(
      [
        'Here is what I would do:',
        '1. Change the header on the three pages that share it',
        '2. Check the spacing',
        '',
        'The about page might use its own copy of the header, so it may need doing separately.',
      ].join('\n'),
    );
    expect(steps).toHaveLength(2);
    expect(caveats).toEqual([
      'The about page might use its own copy of the header, so it may need doing separately.',
    ]);
  });

  it('does not mistake ordinary prose around the list for a caveat', () => {
    const { caveats } = parseProposal('Here is the plan.\n\n1. Read the page\n2. Change the title\n\nThat is all of it.');
    expect(caveats).toEqual([]);
  });
});

describe('worthPlanning', () => {
  const big = [
    'Redesign the whole site so it works properly on phones.',
    'Can you rebuild the pricing page from scratch?',
    'Change every page to use the new logo and update the footer links.',
    'Go through all the pages and make the spacing consistent, then export new screenshots.',
    'Swap the hero image, fix the footer links and make the nav sticky.',
    'Move the logo, resize the hero image, and change the footer colour.',
    'Add a testimonials section and move the pricing table above it and then update the nav.',
    ['Can you do these:', '- swap the hero image', '- fix the footer links', '- make the nav sticky'].join('\n'),
    "I've been looking at the site on my phone and a lot of it feels cramped. Could you go through the homepage, the about page and the contact page, tighten up the spacing so it matches the desktop version, make the headings a bit smaller, and swap the stock photos for the ones in the new folder?",
  ];

  const small = [
    'Make the header a bit bigger.',
    'Change the button colour to blue.',
    'The footer text is too small on my phone, can you fix it?',
    'Add a contact form to the about page.',
    'Move the logo to the left and make it smaller.',
    'Can you make the homepage hero image full width and add a caption under it?',
    'Make the heading text all caps.',
    'Delete all the placeholder images.',
    'Undo that.',
    'Hey, when you get a chance, could you make the little text under the hero image on the homepage a bit smaller? It looks kind of cramped on my laptop screen and I think it would breathe better.',
    '',
    '   ',
  ];

  for (const sentence of big) {
    it(`plans first: ${sentence.slice(0, 48)}…`, () => {
      expect(worthPlanning(sentence)).toBe(true);
    });
  }

  for (const sentence of small) {
    it(`just does it: ${sentence.slice(0, 48) || '(nothing)'}`, () => {
      expect(worthPlanning(sentence)).toBe(false);
    });
  }

  it('needs more than one everyday word to trigger', () => {
    expect(worthPlanning('Make the text all caps and bold.')).toBe(false);
    expect(worthPlanning('Give each card a shadow.')).toBe(false);
  });

  it('treats a list of three as a plan whatever the words are', () => {
    expect(worthPlanning('1. new logo\n2. new colours\n3. new footer')).toBe(true);
  });
});

describe('PLAN_WORDS', () => {
  it('offers the two answers by name', () => {
    expect(PLAN_WORDS.confirm).toBe('Do it');
    expect(PLAN_WORDS.alternative).toBe('Change something first');
  });

  it('says something above the list and something while it looks', () => {
    expect(PLAN_WORDS.heading.length).toBeGreaterThan(0);
    expect(PLAN_WORDS.working).toContain('Nothing changes');
  });

  const everything = [
    PLAN_WORDS.working,
    PLAN_WORDS.heading,
    PLAN_WORDS.confirm,
    PLAN_WORDS.alternative,
    PLAN_WORDS.more(1),
    PLAN_WORDS.more(4),
  ];

  it('never raises its voice', () => {
    for (const line of everything) expect(line).not.toContain('!');
  });

  it('uses no word a designer has no reason to know', () => {
    const jargon =
      /\b(commit|repo|repository|branch|token|API|prompt|agent|context|tool|read-only|subagent|session)\b/i;
    for (const line of everything) expect(line).not.toMatch(jargon);
  });
});
