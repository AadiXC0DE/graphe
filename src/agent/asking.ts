/** Asking before starting, rather than guessing and being wrong for an hour.
 *
 * Every other coding agent stops once, at the top of a big job, and asks the
 * two or three things it genuinely cannot pick for you: which of these, or that
 * one? Graphe never did. It guessed, and a guess made in the first minute is
 * still being built on in the fortieth.
 *
 * The whole design is in one rule: **it asks before it starts, or it does not
 * ask.** Somebody who has been asked knows work is about to begin and can walk
 * away; somebody who walked away must never come back to find nothing happened
 * because a question was waiting. So the moment the first change is made the
 * asking closes for the rest of the turn, and what would have been a question
 * becomes a decision the agent makes and says out loud.
 *
 * Pure. The shape of a question, what makes one worth asking, and every
 * sentence either side of it. Who is asked, and how the waiting works, is the
 * session's business.
 */

/** One thing that can be picked. `label` is the quick scan; `note` carries the
 *  difference somebody is actually choosing between. */
export type Choice = {
  label: string;
  note: string;
};

export type Question = {
  /** The whole question, as it is put to a person. */
  question: string;
  /** Two or three words over the choices. */
  header: string;
  choices: readonly Choice[];
  /** Whether more than one can be picked. */
  many: boolean;
};

/** Enough to settle a direction, few enough to answer in one sitting. Both
 *  ends matter: one choice is not a question, and five questions is a form. */
export const MOST_QUESTIONS = 4;
export const LEAST_CHOICES = 2;
export const MOST_CHOICES = 4;
/** A heading over a column of choices, not a sentence. */
export const HEADER_MOST = 14;

/** What a person is offered besides the choices themselves. Always there: the
 *  choices are the agent's guesses at the answer, and being unable to say
 *  anything else would make a wrong guess binding. */
export const OWN_WORDS = 'Something else';

export const askWords = {
  /** Over the whole card. It says when this is happening, because that is the
   *  part that makes it worth answering rather than dismissing. */
  heading: 'Before I start',
  /** Under it, once. */
  why: 'A couple of things I would rather not guess. Answer these and I will get going.',
  send: 'Start work',
  /** On the button before anything is picked. */
  needsAnswers: 'Pick one from each',
  /** Somebody would rather it just went. A real answer, and the agent is told
   *  so plainly rather than being handed an empty form. */
  skip: 'Just decide for me',
  skipped:
    'They would rather not answer, so decide these yourself, get on with it, and say in one line what you settled on.',
  ownWords: OWN_WORDS,
  ownWordsPlaceholder: 'Say what you would rather…',
  /** The card, once it has been answered, in the place it was asked. Three
   *  endings, because a card that was answered, one that was waved through and
   *  one the turn ended under are three different things to have happened. */
  answered: 'You answered before it started.',
  wavedThrough: 'You left these to me.',
  ended: 'This ended before you answered.',
} as const;

/** Said to the model when it asks at a moment it may not ask. Every one of
 *  these ends the same way, because the wrong thing to do is stop. */
export const cannotAsk = {
  started:
    'You are past the point where you can ask: work on this has already begun and whoever asked for it may have walked away. Choose the most sensible option yourself, carry on, and say in one line what you settled on and why.',
  away:
    'Nobody is watching this run, so there is nobody to answer. Choose the most sensible option yourself, carry on, and say in one line what you settled on and why.',
  already:
    'You have already asked once this turn. Choose the rest yourself, carry on, and say in one line what you settled on.',
  nothingWorthAsking:
    'That question has only one real answer, so it is not worth stopping for. Carry on and say what you settled on.',
} as const;

/** Names that mean something to every object in the language. */
const RESERVED = new Set(['__proto__', 'constructor', 'prototype']);

function trim(text: unknown, most: number): string {
  return typeof text === 'string' ? text.replace(/\s+/g, ' ').trim().slice(0, most) : '';
}

/** One choice, or null when it is not one. */
function choiceFrom(raw: unknown): Choice | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const source = raw as Record<string, unknown>;
  const label = trim(source['label'], 60);
  if (label === '') return null;
  return { label, note: trim(source['note'] ?? source['description'], 160) };
}

/**
 * The questions worth putting in front of somebody, out of whatever was asked.
 *
 * Forgiving about shape and strict about substance. A model that sends five
 * questions gets four asked; a model that sends a question with one choice gets
 * it dropped, because a choice of one is a decision it should have made itself.
 * Empty when nothing survives, which the caller reads as "do not stop".
 */
export function tidyQuestions(raw: unknown): readonly Question[] {
  if (!Array.isArray(raw)) return [];
  const out: Question[] = [];
  const seen = new Set<string>();

  for (const one of raw) {
    if (out.length >= MOST_QUESTIONS) break;
    if (typeof one !== 'object' || one === null) continue;
    const source = one as Record<string, unknown>;

    const question = trim(source['question'], 300);
    if (question === '') continue;
    // Answers are filed against the question's own words, so a "question"
    // whose words name a property every object already has is not one — it
    // reads back as something nobody picked.
    if (RESERVED.has(question)) continue;
    // The same question twice is a model repeating itself, not two questions.
    const already = question.toLowerCase();
    if (seen.has(already)) continue;

    const choices: Choice[] = [];
    const labels = new Set<string>();
    for (const candidate of Array.isArray(source['choices'])
      ? source['choices']
      : Array.isArray(source['options'])
        ? source['options']
        : []) {
      if (choices.length >= MOST_CHOICES) break;
      const choice = choiceFrom(candidate);
      if (choice === null) continue;
      const key = choice.label.toLowerCase();
      if (labels.has(key)) continue;
      labels.add(key);
      choices.push(choice);
    }
    // One choice is not a question. Nor is none.
    if (choices.length < LEAST_CHOICES) continue;

    seen.add(already);
    const header = trim(source['header'], HEADER_MOST);
    out.push({
      question,
      header: header === '' ? headerFrom(question) : header,
      choices,
      many: source['many'] === true || source['multiSelect'] === true,
    });
  }
  return out;
}

/** A heading for a question that arrived without one. The first few words are
 *  wrong often enough that it is worth having, and right often enough to beat
 *  a blank. */
function headerFrom(question: string): string {
  const words = question.replace(/[^\w\s]/g, ' ').split(/\s+/).filter(Boolean);
  const skip = new Set([
    'what', 'which', 'how', 'should', 'would', 'do', 'you', 'i',
    'the', 'a', 'an', 'to', 'for', 'of', 'in', 'on', 'with', 'and', 'or',
  ]);
  const kept = words.filter((word) => !skip.has(word.toLowerCase()));
  const said = (kept.length > 0 ? kept : words).slice(0, 2).join(' ');
  return said.slice(0, HEADER_MOST) || 'This';
}

/** What somebody picked, question by question. The key is the question's own
 *  text, so an answer can never be filed against the wrong one. */
export type Answers = Readonly<Record<string, readonly string[]>>;

/**
 * The answers, as the one thing the model reads.
 *
 * Written as a person's own words rather than a record of a form being filled
 * in: what comes back has to read like being told, or the model treats it as
 * data about a question instead of an instruction about the work.
 */
export function saysAnswers(questions: readonly Question[], answers: Answers): string {
  const lines: string[] = [];
  for (const one of questions) {
    const picked = answers[one.question] ?? [];
    if (picked.length === 0) continue;
    lines.push(`- ${one.question} → ${picked.join(', ')}`);
  }
  if (lines.length === 0) return cannotAsk.nothingWorthAsking;
  return `They answered before you started:\n${lines.join('\n')}\n\nWork to those answers. Do not ask again — get on with it, and only say what you assumed for anything they did not settle.`;
}

/** Whether every question has something against it, which is what the button
 *  waits for. A question somebody genuinely has no view on is what the plain
 *  "decide for me" is there for. */
export function allAnswered(questions: readonly Question[], answers: Answers): boolean {
  // No questions is not "all answered". Nothing draws an empty card, and a
  // button that goes live over nothing is how it would first be noticed.
  if (questions.length === 0) return false;
  return questions.every((one) => (answers[one.question]?.length ?? 0) > 0);
}
