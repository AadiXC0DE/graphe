/** The questions worth stopping somebody for.
 *
 * A model sends whatever it likes; only a few of those are worth a person's
 * attention, and a badly shaped one must never reach the card. So the gate is
 * forgiving about shape — two spellings of the same field, junk in the middle
 * of a good batch — and strict about substance: a choice of one is a decision
 * the agent should have made itself.
 *
 * The other half is the wording. Everything a person reads has to be plain,
 * and everything said back to the model has to end by telling it to carry on:
 * a run that stops because it wanted to ask is the one failure this feature
 * could introduce.
 */

import { describe, expect, it } from 'vitest';

import {
  HEADER_MOST,
  LEAST_CHOICES,
  MOST_CHOICES,
  MOST_QUESTIONS,
  allAnswered,
  askWords,
  cannotAsk,
  saysAnswers,
  tidyQuestions,
  type Question,
} from '../src/agent/asking';

/* ------------------------------------------------------------ scaffolding */

const choice = (label: string, note = 'What it means.') => ({ label, note });

const ask = (question: string, labels: readonly string[] = ['Keep it', 'Change it']) => ({
  question,
  header: 'Direction',
  choices: labels.map((label) => choice(label)),
});

/** Four ordinary questions, exactly as a well-behaved model would send them. */
const ORDINARY = [
  ask('Which of the two headers should I keep?', ['The tall one', 'The compact one']),
  ask('Should the sidebar collapse on a narrow window?', ['Yes', 'No']),
  ask('Which pages get the new colours?', ['All of them', 'The marketing pages']),
  ask('How careful should I be with the old links?', ['Redirect them', 'Leave them']),
];

/* ========================================================================== */

describe('how many questions get through', () => {
  it('asks four when six were sent, because five is a form', () => {
    const raw = Array.from({ length: 6 }, (_, index) => ask(`Question number ${index}?`));
    expect(tidyQuestions(raw)).toHaveLength(MOST_QUESTIONS);
    expect(MOST_QUESTIONS).toBe(4);
  });

  it('keeps the first four, so the model gets the ones it cared about most', () => {
    const raw = Array.from({ length: 6 }, (_, index) => ask(`Question number ${index}?`));
    expect(tidyQuestions(raw).map((one) => one.question)).toEqual([
      'Question number 0?',
      'Question number 1?',
      'Question number 2?',
      'Question number 3?',
    ]);
  });

  it('lets an ordinary batch through untouched', () => {
    const tidied = tidyQuestions(ORDINARY);
    expect(tidied).toHaveLength(4);
    expect(tidied.map((one) => one.question)).toEqual(ORDINARY.map((one) => one.question));
    for (const one of tidied) {
      expect(one.choices).toHaveLength(2);
      expect(one.header).not.toBe('');
      expect(one.many).toBe(false);
    }
  });

  it('keeps the good ones out of a batch that is half rubbish', () => {
    const tidied = tidyQuestions([
      null,
      ORDINARY[0],
      'a string where a question should be',
      { question: 'Only one way to answer this?', choices: [choice('Yes')] },
      ORDINARY[1],
      42,
    ]);
    expect(tidied.map((one) => one.question)).toEqual([
      ORDINARY[0]?.question,
      ORDINARY[1]?.question,
    ]);
  });
});

describe('a question with nothing to choose between', () => {
  it('drops a question offering one thing, because that is a decision not a question', () => {
    expect(tidyQuestions([{ question: 'Shall I use the brand blue?', choices: [choice('Yes')] }])).toEqual([]);
    expect(LEAST_CHOICES).toBe(2);
  });

  it('drops a question with no choices at all', () => {
    expect(tidyQuestions([{ question: 'What now?', choices: [] }])).toEqual([]);
    expect(tidyQuestions([{ question: 'What now?' }])).toEqual([]);
  });

  it('drops a question whose choices are all unusable', () => {
    expect(
      tidyQuestions([{ question: 'Which one?', choices: [null, '', { label: '   ' }, 7] }]),
    ).toEqual([]);
  });

  it('drops a question with no words in it', () => {
    expect(tidyQuestions([{ ...ask('x'), question: '   ' }])).toEqual([]);
    expect(tidyQuestions([{ ...ask('x'), question: 99 }])).toEqual([]);
  });
});

describe('how many choices a question offers', () => {
  it('shows four when six were sent', () => {
    const many = tidyQuestions([
      { question: 'Which font?', choices: ['A', 'B', 'C', 'D', 'E', 'F'].map((one) => choice(one)) },
    ]);
    expect(many[0]?.choices).toHaveLength(MOST_CHOICES);
    expect(many[0]?.choices.map((one) => one.label)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('does not let a repeat eat one of the four places', () => {
    const many = tidyQuestions([
      {
        question: 'Which font?',
        choices: ['A', 'a', 'B', 'C', 'D', 'E'].map((one) => choice(one)),
      },
    ]);
    expect(many[0]?.choices.map((one) => one.label)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('collapses the same choice said twice', () => {
    const many = tidyQuestions([
      { question: 'Which font?', choices: [choice('Inter'), choice('INTER'), choice('Georgia')] },
    ]);
    expect(many[0]?.choices.map((one) => one.label)).toEqual(['Inter', 'Georgia']);
  });
});

describe('two spellings of the same thing', () => {
  it('takes choices under either name', () => {
    const ours = tidyQuestions([{ question: 'Which?', choices: [choice('A'), choice('B')] }]);
    const theirs = tidyQuestions([{ question: 'Which?', options: [choice('A'), choice('B')] }]);
    expect(theirs).toEqual(ours);
  });

  it('takes the words under a choice under either name', () => {
    const tidied = tidyQuestions([
      {
        question: 'Which?',
        options: [
          { label: 'Tall', description: 'More room for the words.' },
          { label: 'Compact', note: 'Fits above the fold.' },
        ],
      },
    ]);
    expect(tidied[0]?.choices).toEqual([
      { label: 'Tall', note: 'More room for the words.' },
      { label: 'Compact', note: 'Fits above the fold.' },
    ]);
  });

  it('prefers the choices it was given when both names are present', () => {
    const tidied = tidyQuestions([
      { question: 'Which?', choices: [choice('A'), choice('B')], options: [choice('X'), choice('Y')] },
    ]);
    expect(tidied[0]?.choices.map((one) => one.label)).toEqual(['A', 'B']);
  });

  it('takes more than one answer under either name', () => {
    const [ours] = tidyQuestions([{ ...ask('Which pages?'), many: true }]);
    const [theirs] = tidyQuestions([{ ...ask('Which pages?'), multiSelect: true }]);
    expect(ours?.many).toBe(true);
    expect(theirs?.many).toBe(true);
  });

  it('takes one answer unless it was actually told otherwise', () => {
    expect(tidyQuestions([ask('Which page?')])[0]?.many).toBe(false);
    expect(tidyQuestions([{ ...ask('Which page?'), many: 'yes' }])[0]?.many).toBe(false);
    expect(tidyQuestions([{ ...ask('Which page?'), multiSelect: 1 }])[0]?.many).toBe(false);
  });
});

describe('the same question twice', () => {
  it('asks it once, whatever the capitals', () => {
    const tidied = tidyQuestions([
      ask('Which header should I keep?'),
      ask('WHICH HEADER SHOULD I KEEP?'),
      ask('Which footer should I keep?'),
    ]);
    expect(tidied.map((one) => one.question)).toEqual([
      'Which header should I keep?',
      'Which footer should I keep?',
    ]);
  });

  it('treats spacing as the same question too', () => {
    const tidied = tidyQuestions([ask('Which   header?'), ask('Which header?')]);
    expect(tidied).toHaveLength(1);
  });
});

describe('the heading over the choices', () => {
  it('cuts a heading somebody wrote a sentence in', () => {
    const tidied = tidyQuestions([
      { ...ask('Which header?'), header: 'A heading that runs on and on and on' },
    ]);
    expect(tidied[0]?.header).toHaveLength(HEADER_MOST);
    expect(HEADER_MOST).toBe(14);
  });

  it('makes one up when the question arrived without it', () => {
    const tidied = tidyQuestions([
      { question: 'Which header should I keep?', choices: [choice('A'), choice('B')] },
    ]);
    expect(tidied[0]?.header).toBe('header keep');
  });

  it('skips the words every question starts with', () => {
    const heading = (question: string) =>
      tidyQuestions([{ question, choices: [choice('A'), choice('B')] }])[0]?.header;
    expect(heading('What should the spacing be?')).toBe('spacing be');
    expect(heading('Would you like a footer?')).toBe('like footer');
    expect(heading('How do I handle the old links?')).toBe('handle old');
  });

  it('never leaves the heading blank, even when there is nothing to make one from', () => {
    const heading = (question: string) =>
      tidyQuestions([{ question, choices: [choice('A'), choice('B')] }])[0]?.header;
    expect(heading('???')).toBe('This');
    expect(heading('the a to for')).not.toBe('');
    expect(heading('!!! ... ???')).toBe('This');
  });

  it('keeps a made-up heading short too', () => {
    const tidied = tidyQuestions([
      { question: 'Which internationalisation approach fits?', choices: [choice('A'), choice('B')] },
    ]);
    expect(tidied[0]?.header.length).toBeLessThanOrEqual(HEADER_MOST);
    expect(tidied[0]?.header).not.toBe('');
  });

  it('ignores a heading that is only spaces', () => {
    const tidied = tidyQuestions([{ ...ask('Which header should I keep?'), header: '  \n ' }]);
    expect(tidied[0]?.header).toBe('header keep');
  });
});

describe('whatever was actually sent', () => {
  it('survives nothing at all', () => {
    for (const junk of [null, undefined, {}, '', 'questions', 0, 7, true, NaN, () => 1]) {
      expect(tidyQuestions(junk)).toEqual([]);
    }
    expect(tidyQuestions([])).toEqual([]);
  });

  it('survives an array of nothing at all', () => {
    expect(tidyQuestions([null, undefined, '', 0, [], {}, [[[{}]]]])).toEqual([]);
  });

  it('survives nonsense nested where the choices should be', () => {
    const tidied = tidyQuestions([
      { question: 'Which?', choices: { not: 'an array' } },
      { question: 'Which one?', choices: [{ label: { deep: [{ deeper: true }] } }, choice('B')] },
      { question: 'Which other?', choices: [[choice('A')], choice('B'), choice('C')] },
    ]);
    // Only the last survives: its two real choices are enough, the nested one is not.
    expect(tidied.map((one) => one.question)).toEqual(['Which other?']);
    expect(tidied[0]?.choices.map((one) => one.label)).toEqual(['B', 'C']);
  });

  it('cuts text nobody could read rather than carrying it', () => {
    const huge = 'x'.repeat(5000);
    const tidied = tidyQuestions([
      { question: huge, header: huge, choices: [{ label: huge, note: huge }, choice('B')] },
    ]);
    expect(tidied[0]?.question).toHaveLength(300);
    expect(tidied[0]?.header).toHaveLength(HEADER_MOST);
    expect(tidied[0]?.choices[0]?.label).toHaveLength(60);
    expect(tidied[0]?.choices[0]?.note).toHaveLength(160);
  });

  it('tidies the spacing in everything a person reads', () => {
    const tidied = tidyQuestions([
      {
        question: '  Which\n\n header   should I keep?  ',
        header: '  Two   words  ',
        choices: [{ label: '  The\ttall  one ', note: ' More\n room. ' }, choice('B')],
      },
    ]);
    expect(tidied[0]?.question).toBe('Which header should I keep?');
    expect(tidied[0]?.header).toBe('Two words');
    expect(tidied[0]?.choices[0]).toEqual({ label: 'The tall one', note: 'More room.' });
  });

  it('gives a choice with no words beside it an empty note rather than nothing', () => {
    const tidied = tidyQuestions([{ question: 'Which?', choices: [{ label: 'A' }, { label: 'B' }] }]);
    expect(tidied[0]?.choices).toEqual([
      { label: 'A', note: '' },
      { label: 'B', note: '' },
    ]);
  });

  it('never hands back a half-made question', () => {
    const tidied = tidyQuestions([
      { question: 'Which?', choices: [choice('A'), choice('B')] },
      { question: 'Which two?', options: [choice('C'), choice('D')], multiSelect: true },
      { junk: true },
      ...ORDINARY,
    ]);
    for (const one of tidied) {
      expect(typeof one.question).toBe('string');
      expect(one.question.trim()).not.toBe('');
      expect(one.header.trim()).not.toBe('');
      expect(one.choices.length).toBeGreaterThanOrEqual(LEAST_CHOICES);
      expect(one.choices.length).toBeLessThanOrEqual(MOST_CHOICES);
      expect(typeof one.many).toBe('boolean');
      for (const pick of one.choices) {
        expect(pick.label.trim()).not.toBe('');
        expect(typeof pick.note).toBe('string');
      }
    }
  });
});

/* ========================================================================== */

describe('what comes back to the model', () => {
  const questions = tidyQuestions([
    ask('Which header should I keep?', ['The tall one', 'The compact one']),
    { ...ask('Which pages get the new colours?', ['Home', 'Pricing', 'About']), many: true },
  ]);

  it('names each question and what was picked against it', () => {
    const said = saysAnswers(questions, {
      'Which header should I keep?': ['The tall one'],
      'Which pages get the new colours?': ['Home'],
    });
    expect(said).toContain('Which header should I keep?');
    expect(said).toContain('The tall one');
    expect(said).toContain('Which pages get the new colours?');
  });

  it('joins several picks into one answer', () => {
    const said = saysAnswers(questions, { 'Which pages get the new colours?': ['Home', 'Pricing'] });
    expect(said).toContain('Home, Pricing');
  });

  it('leaves an unanswered question out rather than reporting it blank', () => {
    const said = saysAnswers(questions, { 'Which header should I keep?': ['The tall one'] });
    expect(said).toContain('Which header should I keep?');
    expect(said).not.toContain('Which pages get the new colours?');
  });

  it('treats a question answered with nothing as unanswered', () => {
    const said = saysAnswers(questions, {
      'Which header should I keep?': [],
      'Which pages get the new colours?': ['Home'],
    });
    expect(said).not.toContain('Which header should I keep?');
  });

  it('says it was not worth stopping for when nothing was answered', () => {
    expect(saysAnswers(questions, {})).toBe(cannotAsk.nothingWorthAsking);
    expect(saysAnswers(questions, { 'Which header should I keep?': [] })).toBe(
      cannotAsk.nothingWorthAsking,
    );
    expect(saysAnswers([], {})).toBe(cannotAsk.nothingWorthAsking);
  });

  it('ignores an answer filed against a question nobody asked', () => {
    expect(saysAnswers(questions, { 'Some other question': ['Yes'] })).toBe(
      cannotAsk.nothingWorthAsking,
    );
  });

  /* Load-bearing: without the last line the answers read as notes about a
     question rather than an instruction about the work, and it asks again. */
  it('ends by telling it to get on with it, and not to ask again', () => {
    const said = saysAnswers(questions, { 'Which header should I keep?': ['The tall one'] });
    expect(said).toMatch(/do not ask again/i);
    expect(said).toMatch(/get on with it/i);
  });
});

describe('whether the button can go yet', () => {
  const questions = tidyQuestions([ask('Which header?'), ask('Which footer?')]);

  it('waits until every question has something against it', () => {
    expect(allAnswered(questions, { 'Which header?': ['Keep it'] })).toBe(false);
    expect(
      allAnswered(questions, { 'Which header?': ['Keep it'], 'Which footer?': ['Change it'] }),
    ).toBe(true);
  });

  it('does not count a question answered with nothing', () => {
    expect(allAnswered(questions, { 'Which header?': ['Keep it'], 'Which footer?': [] })).toBe(false);
  });

  it('does not count an answer filed against a question that was not asked', () => {
    expect(allAnswered(questions, { 'Which header?': ['Keep it'], 'Which other?': ['x'] })).toBe(
      false,
    );
  });

  /* No questions is not "all answered". Vacuous truth from `every` would put the
     button live over an empty card, which is how it would first be noticed. */
  it('says no when there are no questions at all', () => {
    expect(allAnswered([], {})).toBe(false);
  });
  it('files an answer by the question\u2019s own words, so it cannot land on the wrong one', () => {
    const one: Question = { question: 'Which header?', header: 'Header', choices: [], many: false };
    expect(allAnswered([one], { 'Which footer?': ['Keep it'] })).toBe(false);
    expect(allAnswered([one], { 'Which header?': ['Keep it'] })).toBe(true);
  });
});

/* ========================================================================== */

describe('the words either side of a question', () => {
  const everything = [...Object.values(askWords), ...Object.values(cannotAsk)].join(' ').toLowerCase();

  it('never names the machinery', () => {
    for (const banned of [
      'tool',
      'token',
      'api',
      'prompt',
      'model',
      'llm',
      'subagent',
      'context window',
      'parameter',
      'json',
    ]) {
      expect(everything).not.toContain(banned);
    }
  });

  it('says when it is happening, because that is what makes it worth answering', () => {
    expect(askWords.heading.toLowerCase()).toContain('before');
    expect(askWords.answered.toLowerCase()).toContain('before it started');
  });

  it('offers a way out that is a real answer rather than an empty form', () => {
    expect(askWords.skip).toBe('Just decide for me');
    expect(askWords.skipped).toMatch(/decide these yourself/i);
    expect(askWords.skipped).toMatch(/get on with it/i);
  });

  /* The property that stops this deadlocking a long run: whenever the agent is
     told it may not ask, it is told in the same breath to keep going. */
  it('tells the agent to carry on every time it is turned down', () => {
    for (const sentence of Object.values(cannotAsk)) {
      expect(sentence, sentence).toMatch(/carry on/i);
      expect(sentence, sentence).toMatch(/yourself|settled on/i);
    }
  });

  it('never tells the agent to stop or wait instead', () => {
    for (const sentence of Object.values(cannotAsk)) {
      expect(sentence, sentence).not.toMatch(/\b(wait for|stop and|do nothing|abort)\b/i);
    }
  });
});
