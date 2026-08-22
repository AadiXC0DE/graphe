/** The card that goes up before the work starts.
 *
 * It asks before it starts, or it does not ask. So the card has exactly two
 * honest endings: somebody answers it, or it is taken away — and taken away
 * has to be visible, because a form still drawn after the run has stopped is a
 * form whose answer goes nowhere.
 *
 * The last few cases are about the ending nobody chose: a run that failed, and
 * a run that finished. What the thread does with an open card at that moment is
 * written down here as it actually is.
 */

import { describe, expect, it } from 'vitest';

import { applyEvent, askingYou, said, type Turn } from '../src/lib/thread';
import type { AgentEvent } from '../src/agent/types';
import { tidyQuestions } from '../src/agent/asking';

function fold(events: readonly AgentEvent[]): readonly Turn[] {
  return events.reduce<readonly Turn[]>((turns, event) => applyEvent(turns, event), []);
}

const cards = (turns: readonly Turn[]) => turns.filter((turn) => turn.kind === 'asked-first');

const QUESTIONS = tidyQuestions([
  {
    question: 'Which header should I keep?',
    header: 'Header',
    choices: [
      { label: 'The tall one', note: 'More room for the words.' },
      { label: 'The compact one', note: 'Fits above the fold.' },
    ],
  },
]);

const asks = (id: string): AgentEvent => ({ type: 'asked-first', id, questions: QUESTIONS });

describe('a handful of things it would rather not guess', () => {
  it('puts one card in the thread, with the questions on it', () => {
    const turns = fold([{ type: 'user-said', text: 'redo the header' }, asks('q1')]);
    expect(cards(turns)).toHaveLength(1);
    expect(cards(turns)[0]).toMatchObject({ id: 'q1', questions: QUESTIONS, answered: null });
  });

  it('starts with nothing picked, rather than a shape somebody has to clear', () => {
    const [card] = cards(fold([asks('q1')]));
    if (card?.kind !== 'asked-first') return;
    expect(card.answers).toEqual({});
  });

  it('leaves everything already in the thread alone', () => {
    const before = fold([{ type: 'user-said', text: 'redo the header' }]);
    const after = applyEvent(before, asks('q1'));
    expect(after.slice(0, before.length)).toEqual(before);
  });

  it('draws two separate cards when it asks twice', () => {
    const turns = fold([asks('q1'), asks('q2')]);
    expect(cards(turns).map((one) => one.id)).toEqual(['q1', 'q2']);
  });
});

describe('a card nobody can answer any more', () => {
  it('marks it taken away rather than removing it', () => {
    const turns = fold([asks('q1'), { type: 'asking-withdrawn', ids: ['q1'] }]);
    // Removed, and somebody is left wondering whether their answer went through.
    expect(cards(turns)).toHaveLength(1);
    expect(cards(turns)[0]).toMatchObject({ answered: 'withdrawn' });
  });

  it('takes away only the card it was told about', () => {
    const turns = fold([asks('q1'), asks('q2'), { type: 'asking-withdrawn', ids: ['q2'] }]);
    expect(cards(turns).map((one) => one.kind === 'asked-first' && one.answered)).toEqual([
      null,
      'withdrawn',
    ]);
  });

  it('takes away several at once', () => {
    const turns = fold([asks('q1'), asks('q2'), { type: 'asking-withdrawn', ids: ['q1', 'q2'] }]);
    for (const card of cards(turns)) expect(card).toMatchObject({ answered: 'withdrawn' });
  });

  it('leaves a card somebody already answered exactly as it was', () => {
    const answered: Turn = {
      kind: 'asked-first',
      id: 'q1',
      questions: QUESTIONS,
      answers: { 'Which header should I keep?': ['The tall one'] },
      answered: 'answered',
    };
    const after = applyEvent([answered], { type: 'asking-withdrawn', ids: ['q1'] });
    expect(after[0]).toEqual(answered);
  });

  it('leaves a card somebody waved through alone too', () => {
    const waved: Turn = {
      kind: 'asked-first',
      id: 'q1',
      questions: QUESTIONS,
      answers: {},
      answered: 'waved-through',
    };
    const after = applyEvent([waved], { type: 'asking-withdrawn', ids: ['q1'] });
    expect(after[0]).toMatchObject({ answered: 'waved-through' });
  });

  it('changes nothing when the card it names is not there', () => {
    const before = fold([asks('q1')]);
    expect(applyEvent(before, { type: 'asking-withdrawn', ids: ['q9'] })).toEqual(before);
    expect(applyEvent(before, { type: 'asking-withdrawn', ids: [] })).toEqual(before);
  });

  it('changes nothing when there was no card at all', () => {
    const before = fold([{ type: 'user-said', text: 'hello' }]);
    expect(applyEvent(before, { type: 'asking-withdrawn', ids: ['q1'] })).toEqual(before);
  });

  it('does not take a card away twice', () => {
    const once = fold([asks('q1'), { type: 'asking-withdrawn', ids: ['q1'] }]);
    expect(applyEvent(once, { type: 'asking-withdrawn', ids: ['q1'] })).toEqual(once);
  });

  it('keeps the questions and the answers on a card it takes away', () => {
    const half: Turn = {
      kind: 'asked-first',
      id: 'q1',
      questions: QUESTIONS,
      answers: { 'Which header should I keep?': ['The tall one'] },
      answered: null,
    };
    const [after] = applyEvent([half], { type: 'asking-withdrawn', ids: ['q1'] });
    expect(after).toEqual({ ...half, answered: 'withdrawn' });
  });
});

/* -------------------------------------------------------------------------- */

describe('an ending nobody chose', () => {
  /* The shell withdraws the card itself when a turn ends. This is the window's
     own reckoning underneath that, and it has to hold even when the shell
     cannot say anything — otherwise a failure leaves an answerable form whose
     answer goes nowhere, and it comes back with the history. */
  it('closes the card when the run fails under it', () => {
    const turns = fold([asks('q1'), { type: 'error', message: 'The service stopped.' }]);
    expect(cards(turns)[0]).toMatchObject({ answered: 'withdrawn' });
  });

  it('still says what went wrong beside it', () => {
    const turns = fold([asks('q1'), { type: 'error', message: 'The service stopped.' }]);
    expect(turns.some((turn) => turn.kind === 'trouble')).toBe(true);
  });

  it('closes the card once everything settles', () => {
    const turns = fold([asks('q1'), { type: 'settled' }]);
    expect(cards(turns)[0]).toMatchObject({ answered: 'withdrawn' });
  });

  it('leaves a card that was answered before the ending alone', () => {
    const answered: Turn = {
      kind: 'asked-first',
      id: 'q1',
      questions: QUESTIONS,
      answers: { 'Which header should I keep?': ['The tall one'] },
      answered: 'answered',
    };
    const after = applyEvent([answered], { type: 'error', message: 'The service stopped.' });
    expect(after[0]).toEqual(answered);
  });

  /* The turn really is parked on this. Without it, a message typed underneath
     goes out as though nothing were pending, and the answer it was waiting for
     arrives second. */
  it('counts as the conversation waiting on somebody', () => {
    expect(askingYou(fold([asks('q1')]))).toBe(true);
    expect(askingYou([said('you', 'hello')])).toBe(false);
  });

  it('stops counting once it has been answered or withdrawn', () => {
    expect(askingYou(fold([asks('q1'), { type: 'settled' }]))).toBe(false);
    expect(askingYou(fold([asks('q1'), { type: 'asking-withdrawn', ids: ['q1'] }]))).toBe(false);
  });
});
