/** Plan before doing.
 *
 * Three things are protected here. That the read-only toolset is the Guard's
 * own answer and not a second list that can rot. That a proposal survives every
 * shape a model writes one in, including the shapes that are not lists at all.
 * And that "worth planning" stays hard to trigger: the whole feature is a
 * default, so a wrong yes lands on somebody who only wanted the header bigger.
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  CARD_STEPS,
  MAX_STEPS,
  PLAN_WORDS,
  decideOn,
  decidedMessage,
  forTheCard,
  moved,
  parseProposal,
  readOnlyTools,
  worthPlanning,
} from '../src/agent/plan';
import { grapheTools } from '../src/agent/pi/tools';

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

  it('keeps looking through code and drops the rename that writes it', () => {
    expect(readOnlyTools(['lsp', 'lsp_rename'])).toEqual(['lsp']);
  });

  /**
   * The regression this whole set exists to catch, swept rather than listed.
   *
   * A tool that renamed a symbol across every file was classed as a read, so
   * the looking-around pass rewrote the project it was only supposed to look
   * at. The evidence is each tool's own words to the model, never the Guard's
   * own lists — a check made of the same set it is checking agrees with itself
   * however wrong both are.
   */
  it('leaves out anything that tells the model it writes', () => {
    const registered = grapheTools('/tmp/agent', 'a-figma-token', null, undefined, '/work/site');
    const reads = new Set(readOnlyTools(registered.map((one) => one.name)));
    const writing = registered.filter((one) => {
      if (!reads.has(one.name)) return false;
      const words = [one.description, one.promptSnippet ?? '', ...(one.promptGuidelines ?? [])].join(' ');
      return /\bwrites?\b|\brewrit/i.test(words);
    });
    expect(writing.map((one) => one.name), 'writes, and the Guard calls it a read').toEqual([]);
  });
});

/** A plan of `many` steps, written the way a model writes one. */
function numbered(many: number): string {
  return Array.from({ length: many }, (_, at) => `${String(at + 1)}. Step ${String(at + 1)}`).join(
    '\n',
  );
}

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
    expect(parseProposal('')).toEqual({ steps: [], caveats: [], questions: [] });
    expect(parseProposal('   \n\n  ')).toEqual({ steps: [], caveats: [], questions: [] });
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

  /* A twenty-step plan used to arrive as twelve steps and a sentence nobody
     acted on, and the checklist finished with eight steps of the job undone.
     What the card can hold and what the plan is are two different numbers. */
  it('reads all twenty steps of a twenty-step plan', () => {
    const long = numbered(20);
    const { steps, caveats } = parseProposal(long);
    expect(steps).toHaveLength(20);
    expect(steps[19]).toBe('Step 20');
    expect(caveats).toEqual([]);
  });

  it('caps a plan nobody wrote on purpose, and says how much it is not holding', () => {
    const { steps, caveats } = parseProposal(numbered(70));
    expect(steps).toHaveLength(MAX_STEPS);
    expect(steps[59]).toBe('Step 60');
    expect(caveats).toEqual(['There are 10 more steps after these.']);
  });

  it('says "one more step" when exactly one is past the cap', () => {
    expect(parseProposal(numbered(MAX_STEPS + 1)).caveats).toEqual([
      'There is one more step after these.',
    ]);
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

/* ========================================================================== */
/* The card is short; the plan is not                                          */
/* ========================================================================== */

describe('what the card shows of a long plan', () => {
  it('shows a screenful and reports the rest, without losing any of it', () => {
    const { steps } = parseProposal(numbered(20));
    const { shown, more } = forTheCard(steps);

    expect(shown).toHaveLength(CARD_STEPS);
    expect(shown[11]).toBe('Step 12');
    expect(more).toBe(8);
    // The steps themselves are untouched: what runs is all twenty.
    expect(steps).toHaveLength(20);
  });

  it('shows a short plan whole and reports nothing', () => {
    const { steps } = parseProposal(numbered(3));
    expect(forTheCard(steps)).toEqual({ shown: steps, more: 0 });
    expect(forTheCard([])).toEqual({ shown: [], more: 0 });
  });

  it('shows exactly the card’s worth without offering more', () => {
    const { steps } = parseProposal(numbered(CARD_STEPS));
    expect(forTheCard(steps).more).toBe(0);
  });

  it('keeps the card shorter than the cap, or the split does nothing', () => {
    expect(CARD_STEPS).toBeLessThan(MAX_STEPS);
  });
});

describe('a reply with no plan in it', () => {
  it('has nothing to show, rather than a card of one empty step', () => {
    expect(parseProposal('').steps).toEqual([]);
    expect(parseProposal('   \n\n  ').steps).toEqual([]);
    // Everything the model said was a question, so there is nothing to agree to.
    expect(parseProposal('Questions:\n- Which page?\n- Which colour?').steps).toEqual([]);
  });

  it('has the words for the card that says so, and the way out of it', () => {
    expect(PLAN_WORDS.noSteps).toBe('I couldn’t read a plan out of that.');
    expect(PLAN_WORDS.askAgain).toBe('Ask me to lay it out as a numbered list');
  });

  /* One sentence describing one change is a plan of one thing, and always has
     been. The no-plan card is for a reply with nothing in it at all. */
  it('still reads a single sentence as a plan of one step', () => {
    expect(parseProposal('I would change the button colour.').steps).toHaveLength(1);
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

  /* The ways a list of jobs can hide from the old counting: nothing but full
     stops between them, nothing but newlines, doing words outside the old
     vocabulary, and numbers dropped into prose. All of them are how people
     actually write "here are eight things". */
  it('counts jobs separated by full stops as a list', () => {
    expect(
      worthPlanning(
        'Fix the header. Change the footer colour. Update the nav links. Add a contact button. Rename the about page. Tighten the margins. Swap the logo. Clean up the CSS.',
      ),
    ).toBe(true);
  });

  it('counts jobs separated only by newlines as a list', () => {
    expect(
      worthPlanning(['Fix the header', 'Change the footer', 'Update the nav'].join('\n')),
    ).toBe(true);
  });

  it('knows the doing words people type that the old list did not', () => {
    expect(worthPlanning('tweak the header, adjust the footer spacing, polish the nav hover')).toBe(true);
    expect(
      worthPlanning('Tweak the header. Adjust the footer spacing. Polish the nav hover. Review the button colours.'),
    ).toBe(true);
  });

  it('counts numbers dropped into prose as items', () => {
    expect(
      worthPlanning('can you do these: 1. fix the header, 2. change the footer, 3. update the nav'),
    ).toBe(true);
  });

  it('already opens with a plan when every task is described politely', () => {
    expect(
      worthPlanning(
        'I need you to fix the header. I also need the footer tightening. Could you update the nav links too?',
      ),
    ).toBe(true);
  });

  it('still hears one real task behind a paragraph and a half', () => {
    expect(
      worthPlanning(
        'Please fix the header so it does not overlap the nav on mobile. It clips on narrow screens and looks broken.',
      ),
    ).toBe(false);
  });

  it('still hears one question about one thing', () => {
    expect(worthPlanning('Can you check the header? It looks off.')).toBe(false);
  });

  it('still hears a single polite ask', () => {
    expect(worthPlanning('I need to make the logo a bit smaller.')).toBe(false);
    expect(worthPlanning('I wanted you to give each card a subtle shadow.')).toBe(false);
  });

  it('hears three complaints as three tasks, but one complaint plus its fix as one', () => {
    expect(
      worthPlanning('The button is broken, the footer needs a new colour, and the logo looks wrong.'),
    ).toBe(true);
    expect(
      worthPlanning('Please fix the header so it does not overlap the nav on mobile. It clips on narrow screens.'),
    ).toBe(false);
    expect(worthPlanning('The header looks broken — can you fix it?')).toBe(false);
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
    PLAN_WORDS.showRest(1),
    PLAN_WORDS.showRest(8),
    PLAN_WORDS.showFewer,
    PLAN_WORDS.noSteps,
    PLAN_WORDS.askAgain,
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

/* ========================================================================== */
/* Agreeing to some of a plan                                                  */
/* ========================================================================== */

describe('a plan somebody edited before agreeing to it', () => {
  it('says what to do and what not to, because a model finishes what it proposed', () => {
    const said = PLAN_WORDS.doThese(['Move the button', 'Match the spacing'], ['Rewrite the nav']);
    expect(said).toContain('1. Move the button');
    expect(said).toContain('2. Match the spacing');
    expect(said).toContain('Rewrite the nav');
    expect(said).toMatch(/only these/i);
    expect(said).toMatch(/Leave these out/i);
  });

  it('numbers what is kept from one, not from where it used to sit', () => {
    // The third and fourth steps of a plan, agreed on their own, are this
    // person's first and second — anything else invites "step 3" to mean two
    // different things in one conversation.
    const said = PLAN_WORDS.doThese(['Third thing', 'Fourth thing'], ['First', 'Second']);
    expect(said).toContain('1. Third thing');
    expect(said).toContain('2. Fourth thing');
    expect(said).not.toContain('3. Third thing');
  });

  it('counts what is left out, and what will be done', () => {
    expect(PLAN_WORDS.dropped(1)).toBe('One step left out.');
    expect(PLAN_WORDS.dropped(3)).toBe('3 steps left out.');
    expect(PLAN_WORDS.confirmSome(1)).toBe('Do that one');
    expect(PLAN_WORDS.confirmSome(4)).toBe('Do those 4');
  });

  it('has somewhere to go when every step is struck out', () => {
    expect(PLAN_WORDS.nothingLeft).toMatch(/Put a step back/);
    expect(PLAN_WORDS.nothingLeft).toMatch(/[.!]$/);
  });

  it('keeps the machinery out of every one of them', () => {
    for (const said of [
      PLAN_WORDS.drop,
      PLAN_WORDS.undrop,
      PLAN_WORDS.nothingLeft,
      PLAN_WORDS.dropped(2),
      PLAN_WORDS.confirmSome(2),
    ]) {
      expect(said).not.toMatch(/\b(commit|branch|token|prompt|context|API)\b/i);
    }
  });
});

/* ========================================================================== */
/* Putting the steps in a different order                                      */
/* ========================================================================== */

describe('moving a step before it runs', () => {
  it('moves one step one place and leaves the rest where they were', () => {
    expect(moved([0, 1, 2, 3], 2, -1)).toEqual([0, 2, 1, 3]);
    expect(moved([0, 1, 2, 3], 1, 1)).toEqual([0, 2, 1, 3]);
  });

  /* The same list back, by identity — the card reads that to know nothing
     happened, and a control that reports a move it did not make would take the
     focus off the step somebody is trying to move. */
  it('does nothing at either end, and says so by handing the same list back', () => {
    const order = [0, 1, 2];
    expect(moved(order, 0, -1)).toBe(order);
    expect(moved(order, 2, 1)).toBe(order);
    expect(moved(order, 9, -1)).toBe(order);
  });

  it('never loses or duplicates a step, however far one is walked', () => {
    let order: readonly number[] = [0, 1, 2, 3, 4];
    for (let at = 4; at > 0; at -= 1) order = moved(order, at, -1);
    expect([...order].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
    expect(order).toEqual([4, 0, 1, 2, 3]);
  });
});

/* ========================================================================== */
/* What somebody left behind, as one decision                                  */
/* ========================================================================== */

const THREE = ['Move the button', 'Match the spacing', 'Rewrite the nav'];

describe('a plan somebody reordered, struck and wrote on', () => {
  it('hands the kept steps back in the order they were left in', () => {
    const decision = decideOn(THREE, [2, 0, 1], new Set(), {});
    expect(decision.kept.map((one) => one.step)).toEqual([
      'Rewrite the nav',
      'Move the button',
      'Match the spacing',
    ]);
    expect(decision.reordered).toBe(true);
  });

  /* Striking the middle of three is not a reorder, and nobody should be told to
     mind an order they never changed. */
  it('does not call striking a step a change of order', () => {
    const decision = decideOn(THREE, [0, 1, 2], new Set([1]), {});
    expect(decision.reordered).toBe(false);
    expect(decision.dropped).toEqual(['Match the spacing']);
  });

  it('carries what was said about a step without striking it', () => {
    const decision = decideOn(THREE, [0, 1, 2], new Set(), { 1: '  8px, not 12  ', 2: '   ' });
    expect(decision.kept[1]?.note).toBe('8px, not 12');
    expect(decision.kept[2]?.note).toBeUndefined();
  });

  it('keeps only the questions that were actually answered', () => {
    const decision = decideOn(THREE, [0, 1, 2], new Set(), {}, ['Which pages?', 'Dark too?'], {
      1: 'Yes, both.',
    });
    expect(decision.answers).toEqual([{ question: 'Dark too?', answer: 'Yes, both.' }]);
  });
});

describe('the sentence a decided plan sends back', () => {
  /* The ordinary case by far. A plan agreed exactly as proposed needs no
     covering letter — their own sentence already said it. */
  it('says nothing at all when the plan was agreed as proposed', () => {
    expect(decidedMessage(decideOn(THREE, [0, 1, 2], new Set(), {}))).toBeNull();
  });

  it('sends the order it was left in, and says the order is deliberate', () => {
    const said = decidedMessage(decideOn(THREE, [2, 0, 1], new Set(), {})) ?? '';
    expect(said).toContain('1. Rewrite the nav');
    expect(said).toContain('2. Move the button');
    expect(said).toContain(PLAN_WORDS.inThisOrder);
  });

  /* A note numbered against where the step used to sit points at the wrong
     step the moment anything is moved or struck. */
  it('numbers a note against where the step ended up, not where it started', () => {
    const said = decidedMessage(decideOn(THREE, [2, 0, 1], new Set(), { 0: 'Keep the label' })) ?? '';
    expect(said).toContain(PLAN_WORDS.notesOn);
    expect(said).toContain('- 2: Keep the label');
    expect(said).not.toContain('- 1: Keep the label');
  });

  it('sends the answers on their own when that is all that changed', () => {
    const said =
      decidedMessage(decideOn(THREE, [0, 1, 2], new Set(), {}, ['Which pages?'], { 0: 'All of them.' })) ?? '';
    expect(said).toContain(PLAN_WORDS.answersTo);
    expect(said).toContain('Which pages? All of them.');
    expect(said).not.toContain('1. Move the button');
  });

  it('still names what to leave out, because a model finishes what it proposed', () => {
    const said = decidedMessage(decideOn(THREE, [0, 1, 2], new Set([2]), {})) ?? '';
    expect(said).toMatch(/Leave these out/i);
    expect(said).toContain('Rewrite the nav');
  });
});

/* ========================================================================== */
/* The questions asked before the plan                                         */
/* ========================================================================== */

describe('questions before the plan', () => {
  const PROPOSED = `1. Rebuild the header
2. Match the spacing

Questions:
- Every page, or only the marketing ones?
- Should the dark one change too?`;

  it('reads them off the end without counting one as a step', () => {
    const { steps, questions } = parseProposal(PROPOSED);
    expect(steps).toEqual(['Rebuild the header', 'Match the spacing']);
    expect(questions).toEqual([
      'Every page, or only the marketing ones?',
      'Should the dark one change too?',
    ]);
  });

  /* Two sharp questions beat a plan built on a guess; a page of them is worse
     than either. */
  it('never asks more than three, however many were written', () => {
    const many = parseProposal(`1. Do it\n\n## Questions\n- a?\n- b?\n- c?\n- d?\n- e?`);
    expect(many.questions).toHaveLength(3);
  });

  it('asks none at all when the model wrote none, which is the usual reply', () => {
    expect(parseProposal('1. Rebuild the header\n2. Match the spacing').questions).toEqual([]);
  });

  it('asks for them only when the answer would change the list', () => {
    expect(PLAN_WORDS.asked).toMatch(/would change that list/i);
    expect(PLAN_WORDS.asked).toMatch(/at most three/i);
  });
});

/* ========================================================================== */
/* The card itself                                                             */
/* ========================================================================== */

const CARD = readFileSync(new URL('../src/components/PlanCard.tsx', import.meta.url), 'utf8');
const CARD_CSS = readFileSync(new URL('../src/components/PlanCard.css', import.meta.url), 'utf8');

describe('what the plan card is allowed to do', () => {
  /* Moving a step three places is three presses in a row, sometimes held down.
     A control that flinches under that reads as broken, so the row's controls
     move colour and nothing else. */
  it('never moves anything under a press that gets repeated', () => {
    const row = /\.plan__(?:move|drop|note-open)[^{]*\{[^}]*\}/g;
    for (const rule of CARD_CSS.match(row) ?? []) expect(rule).not.toMatch(/transform/);
    expect(CARD_CSS).not.toMatch(/transition:\s*all/);
  });

  it('turns every moving part off for somebody who asked for that', () => {
    const quiet = CARD_CSS.slice(CARD_CSS.indexOf('prefers-reduced-motion'));
    for (const name of ['plan__move', 'plan__note-open', 'plan__writing', 'plan__done']) {
      expect(quiet).toContain(name);
    }
  });

  /* Every colour in this app is a token, and the palette has no green in it.
     A literal here is how one arrives. */
  it('takes every colour from the palette rather than writing one down', () => {
    expect(CARD_CSS).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(CARD_CSS).not.toMatch(/\b(?:green|rgb|rgba|hsl)\(/i);
  });

  /* A label written into the markup is a label nothing can check the language
     of, and this app checks the language of all of them. */
  it('reads every word it says out of the words object', () => {
    for (const word of [
      'PLAN_WORDS.up',
      'PLAN_WORDS.down',
      'PLAN_WORDS.say',
      'PLAN_WORDS.questions(',
      'PLAN_WORDS.showRest(',
      'PLAN_WORDS.showFewer',
      'PLAN_WORDS.noSteps',
      'PLAN_WORDS.askAgain',
    ]) {
      expect(CARD).toContain(word);
    }
    for (const inline of ['Move up', 'Move down', 'Say something about this']) {
      expect(CARD).not.toContain(`'${inline}'`);
      expect(CARD).not.toContain(`>${inline}<`);
    }
  });

  /* An arrow that goes `disabled` at the end of the list hands the focus back
     to the page, and the next step somebody wants to move has to be found
     again with the keyboard. */
  it('dims the arrow at the end of the list rather than disabling it', () => {
    expect(CARD).toMatch(/className="plan__move"[\s\S]{0,220}aria-disabled=/);
    expect(CARD).not.toMatch(/className="plan__move"[\s\S]{0,220}(?<![-\w])disabled=/);
    expect(CARD_CSS).toContain("[aria-disabled='true']");
  });

  /* "Put it back" is wide, and beside three arrows it drags that row's controls
     out of line with every other row. A step that is out is not going to run,
     so there is nothing to move it above or write on it about. */
  it('leaves a struck step nothing but the way back', () => {
    expect(CARD_CSS).toMatch(/\.plan__step--out \.plan__move[\s\S]{0,80}display: none/);
    expect(CARD_CSS).toMatch(/\.plan__step--out \.plan__note-open[\s\S]{0,60}display: none/);
  });

  it('leaves every decision to the pure side rather than deciding here', () => {
    expect(CARD).toContain('decideOn(');
    expect(CARD).toContain('moved(');
    expect(CARD).toContain('forTheCard(');
    expect(CARD).not.toMatch(/\.splice\(/);
    // How much fits on a card is one number, and it is not written down here.
    expect(CARD).not.toMatch(/slice\(0,\s*\d/);
  });
});

describe('the words on the card', () => {
  const said = [
    PLAN_WORDS.up,
    PLAN_WORDS.down,
    PLAN_WORDS.say,
    PLAN_WORDS.sayDone,
    PLAN_WORDS.sayHint,
    PLAN_WORDS.questions(2),
    PLAN_WORDS.questionsHint,
    PLAN_WORDS.notesOn,
    PLAN_WORDS.answersTo,
    PLAN_WORDS.inThisOrder,
    PLAN_WORDS.nowAt(2, 4),
    PLAN_WORDS.showRest(8),
    PLAN_WORDS.showFewer,
    PLAN_WORDS.noSteps,
    PLAN_WORDS.askAgain,
  ];

  it('uses no word a designer has no reason to know', () => {
    const jargon =
      /\b(commit|repo|repository|branch|token|API|prompt|agent|context|tool|subagent|session|reorder|annotate|index)\b/i;
    for (const line of said) expect(line).not.toMatch(jargon);
  });

  it('never raises its voice', () => {
    for (const line of said) expect(line).not.toContain('!');
  });

  it('counts the questions in words, because there are never more than three', () => {
    expect(PLAN_WORDS.questions(1)).toContain('One');
    expect(PLAN_WORDS.questions(2)).toContain('Two');
    expect(PLAN_WORDS.questions(3)).toContain('Three');
  });
});
