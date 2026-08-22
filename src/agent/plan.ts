/** Planning a big job before any of it happens.
 *
 * Pure functions over plain data: no agent, no Pi, no I/O. Which tools are safe
 * to think with is asked of the Guard rather than answered again here, so the
 * two can never drift apart.
 */

import { changesAnything, evaluate } from './guard/policy';
import type { ToolCall } from './types';

/* -------------------------------------------------------------------------- */
/* Tools that cannot change anything                                           */
/* -------------------------------------------------------------------------- */

/** The Guard judges a call, not a name, so the question is put to it as a call
 *  with no arguments. Nothing with an empty input reaches a path check, which is
 *  why any folder does here. */
const PROBE_ROOT = '/';

function probe(name: string): ToolCall {
  return { id: 'plan-probe', name, input: {} };
}

/**
 * The subset of `all` that cannot change anything, as the Guard classifies it.
 *
 * Order and spelling are the caller's own. A name the Guard does not recognise
 * is left out: the deny-by-default floor makes an unknown tool mutating, and an
 * unknown tool is exactly the one not to hand a planning pass. So is one the
 * Guard refuses on sight — a refusal is not the same answer as "changes
 * nothing", and only the second one belongs here.
 */
export function readOnlyTools(all: readonly string[]): readonly string[] {
  const facts = { projectRoot: PROBE_ROOT };
  return all.filter((name) => {
    const call = probe(name);
    return evaluate(call, facts).kind !== 'deny' && !changesAnything(call, facts);
  });
}

/* -------------------------------------------------------------------------- */
/* What the person reads                                                       */
/* -------------------------------------------------------------------------- */

/** Every word this module can put on screen. Two buttons, one sentence while it
 *  looks, one line above the list, and the note when a plan runs long. */
export const PLAN_WORDS = {
  /** Shown while the read-only pass is running. */
  working:
    'This is a bigger job, so I’ll look through your project first and tell you what I’d do. Nothing changes while I look.',
  /** Directly above the numbered steps. */
  heading: 'Here’s what I’d do:',
  confirm: 'Do it',
  /** On the button once some steps have been dropped, so the press names what
   *  it will actually do rather than what was first proposed. */
  confirmSome(kept: number): string {
    return kept === 1 ? 'Do that one' : `Do those ${String(kept)}`;
  },
  alternative: 'Change something first',
  /** Beside each step. Dropping one is a decision, not a deletion — it comes
   *  straight back, so nobody has to be sure before they try it. */
  drop: 'Leave this out',
  undrop: 'Put it back',
  /** Beside each step, for putting them in the order they should happen in. */
  up: 'Move up',
  down: 'Move down',
  /** Said out loud after a move, because the list has shifted under somebody
   *  who may not be able to see that it has. */
  nowAt(at: number, of: number): string {
    return `Now ${String(at)} of ${String(of)}.`;
  },
  /** Beside each step, for saying something about one without striking it. */
  say: 'Say something about this',
  saidLabel: 'What to know about this step',
  sayHint: 'Anything about this step in particular',
  sayDone: 'Done',
  /** Under the list once anything is dropped. */
  dropped(many: number): string {
    return many === 1 ? 'One step left out.' : `${String(many)} steps left out.`;
  },
  /** When every step has been dropped there is nothing to agree to. */
  nothingLeft: 'Nothing left to do. Put a step back, or ask for something else.',
  /** Handed back to the model when it reaches for something that would change
   *  the project while it is only supposed to be looking. */
  withheld:
    'Not yet — this is the looking-around pass. Do not change anything. Say what you would do, as a short numbered list, and it will be put to the person to approve.',
  /** Sent when somebody agreed to some of the plan but not all of it. The
   *  dropped ones are named as well as the kept ones: a model told only what to
   *  do will helpfully do the rest of what it proposed. */
  doThese(kept: readonly string[], dropped: readonly string[] = []): string {
    const list = kept.map((step, at) => `${String(at + 1)}. ${step}`).join('\n');
    if (dropped.length === 0) return `Do these, and only these:\n\n${list}`;
    const not = dropped.map((step) => `- ${step}`).join('\n');
    return `Do these, and only these:\n\n${list}\n\nLeave these out — I do not want them:\n\n${not}`;
  },
  /** Sent when the steps were put in a different order to the one proposed. The
   *  numbered list already carries the order; this says the order is deliberate
   *  rather than a list rewritten carelessly. */
  inThisOrder: 'That order is deliberate — do them in it.',
  /** Above what was said about particular steps. */
  notesOn: 'About some of them:',
  /** Above the answers to what was asked before the plan ran. */
  answersTo: 'Answers to what you asked:',
  /** Added under the person's own words on a looking-around pass. */
  asked:
    'Before doing any of this: look through the project and answer with a short numbered list of the steps you would take. Change nothing yet. If — and only if — something you cannot settle from the project would change that list, finish with a line reading "Questions:" and at most three of them, one per line. Most requests need none, and a question whose answer would not change the list is not worth asking.',
  /** Above the questions, before the list. Two sharp ones beat a plan built on
   *  a guess; a page of them is worse than either, which is why there are never
   *  more than three. */
  questions(many: number): string {
    const counted = many === 2 ? 'Two' : many === 3 ? 'Three' : String(many);
    return many === 1
      ? 'One thing I’d want to know first:'
      : `${counted} things I’d want to know first:`;
  },
  /** Under the questions. Answering is worth the twenty seconds and skipping it
   *  is allowed, so both have to be said. */
  questionsHint: 'Answer what you like — anything left blank, I’ll use my best guess.',
  /** A plan longer than the list shows says so rather than ending mid-thought. */
  more(extra: number): string {
    return extra === 1
      ? 'There is one more step after these.'
      : `There are ${extra} more steps after these.`;
  },
} as const;

/* -------------------------------------------------------------------------- */
/* Reading a proposal                                                          */
/* -------------------------------------------------------------------------- */

export type Proposal = {
  /** The plan as a numbered list, in order. Empty when nothing was proposed. */
  steps: readonly string[];
  /** Anything alongside the list worth reading before saying yes. */
  caveats: readonly string[];
  /** What it would want to know before starting, when the answer would change
   *  the list above. Usually empty. */
  questions: readonly string[];
};

/** Long enough to be a plan, short enough to be read. */
const MAX_STEPS = 12;

/** Three at the very most. Past that it stops being two sharp questions and
 *  becomes a form, and a form is worse than a plan built on a guess. */
const MAX_QUESTIONS = 3;

/** The line that hands the rest of the reply over to questions. */
const QUESTIONS_OPEN = /^[ \t]*(?:#{1,6}[ \t]*)?(?:\*\*)?questions?(?:\*\*)?[ \t]*[:：]?[ \t]*$/im;

/** The questions off the end of a proposal, and the proposal without them.
 *
 *  Split off before the steps are read, so a question is never counted as a
 *  step somebody could be asked to agree to. */
function splitQuestions(text: string): { rest: string; questions: readonly string[] } {
  const open = QUESTIONS_OPEN.exec(text);
  if (open?.index === undefined) return { rest: text, questions: [] };
  const asked = text
    .slice(open.index + open[0].length)
    .split(/\r?\n/)
    .map((line) => plain(line.replace(LIST_ITEM, '$1')))
    .filter((line) => line !== '')
    .slice(0, MAX_QUESTIONS);
  return { rest: text.slice(0, open.index), questions: asked };
}

const LIST_ITEM = /^[ \t]*(?:[-*•]|\d+[.)])[ \t]+(.*)$/;
const HAS_LIST = /^[ \t]*(?:[-*•]|\d+[.)])[ \t]+\S/m;
const CHECKBOX = /^\[[ xX]\][ \t]*/;

/** Sentences that qualify the plan rather than describe a step. */
const HEDGE =
  /\b(?:caveat|note|however|unless|might|maybe|assume|assuming|depends|not sure|can’t|can't|cannot|won’t|won't|would need|before I)\b/i;

/** Markdown out, sentence in. Underscores only lose their meaning between
 *  non-word characters, so a file name survives intact. */
function plain(text: string): string {
  return text
    .replace(/^[ \t]*#+[ \t]*/, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(?<!\w)__([^_]+)__(?!\w)/g, '$1')
    .replace(/\*([^*\s][^*]*)\*/g, '$1')
    .replace(/(?<!\w)_([^_]+)_(?!\w)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A model's plain-text plan as a numbered list.
 *
 * Numbered lists, bullets, a heading above them, or none of that at all — prose
 * with no list in it is one step, because a plan of one thing is still a plan.
 */
export function parseProposal(text: string): Proposal {
  const { rest, questions } = splitQuestions(text);
  const lines = rest.split(/\r?\n/);
  const items: string[] = [];
  const asides: string[] = [];
  let inList = false;

  for (const line of lines) {
    const match = LIST_ITEM.exec(line);
    if (match !== null) {
      inList = true;
      const item = plain((match[1] ?? '').replace(CHECKBOX, ''));
      if (item !== '') items.push(item);
      continue;
    }

    if (line.trim() === '') continue;

    // Indented text under an item is the rest of that item's sentence.
    const previous = items[items.length - 1];
    if (inList && previous !== undefined && /^[ \t]{2,}/.test(line)) {
      items[items.length - 1] = `${previous} ${plain(line)}`.trim();
      continue;
    }

    inList = false;
    const aside = plain(line);
    if (aside !== '' && HEDGE.test(aside)) asides.push(aside);
  }

  if (items.length === 0) {
    const whole = plain(lines.join(' '));
    return { steps: whole === '' ? [] : [whole], caveats: [], questions };
  }

  const steps = items.slice(0, MAX_STEPS);
  const extra = items.length - steps.length;
  return {
    steps,
    caveats: extra > 0 ? [...asides, PLAN_WORDS.more(extra)] : asides,
    questions,
  };
}

/* -------------------------------------------------------------------------- */
/* Arguing with it before it runs                                              */
/* -------------------------------------------------------------------------- */

/** One step as it was left: what was proposed, and anything said about it. */
export type PlanStep = {
  step: string;
  /** Said about this one step without striking it out. */
  note?: string;
};

/** A plan as somebody left it, ready to be turned into a sentence. */
export type PlanDecision = {
  /** What to do, in the order decided. */
  kept: readonly PlanStep[];
  /** What was struck out, in the order it was proposed. */
  dropped: readonly string[];
  /** True when the kept steps are not in the order they were proposed in. */
  reordered: boolean;
  /** What was said back to the questions asked, questions left blank left out. */
  answers: readonly { question: string; answer: string }[];
};

/**
 * One step, one place.
 *
 * The order is held as where each proposed step now sits, so the steps
 * themselves are never rewritten and a step put back where it started is
 * identical to one never moved. At either end nothing happens and the same
 * order comes back, which is how the caller knows not to move the focus.
 */
export function moved(order: readonly number[], at: number, by: -1 | 1): readonly number[] {
  const to = at + by;
  if (at < 0 || at >= order.length || to < 0 || to >= order.length) return order;
  const next = [...order];
  const one = next[at];
  if (one === undefined) return order;
  next.splice(at, 1);
  next.splice(to, 0, one);
  return next;
}

/** A note worth carrying: written by a person, not whitespace they left behind. */
function said(text: string | undefined): string | undefined {
  const trimmed = (text ?? '').trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * Everything somebody did to a plan, as one thing to send.
 *
 * Kept apart from the card so the rules can be read here: the kept steps come
 * back in the order they were left in, the struck ones in the order they were
 * proposed in, and "reordered" is measured rather than remembered — striking
 * the second of four is not a reorder, and nobody should have to explain a
 * change of order they did not make.
 */
export function decideOn(
  steps: readonly string[],
  order: readonly number[],
  dropped: ReadonlySet<number>,
  notes: Readonly<Record<number, string>>,
  asked: readonly string[] = [],
  answers: Readonly<Record<number, string>> = {},
): PlanDecision {
  const walk = order.filter((at) => steps[at] !== undefined);
  const keptAt = walk.filter((at) => !dropped.has(at));
  return {
    kept: keptAt.map((at) => {
      const note = said(notes[at]);
      return note === undefined ? { step: steps[at] as string } : { step: steps[at] as string, note };
    }),
    dropped: steps.filter((_, at) => dropped.has(at)),
    reordered: keptAt.some((at, index) => index > 0 && at < (keptAt[index - 1] as number)),
    answers: asked.flatMap((question, at) => {
      const answer = said(answers[at]);
      return answer === undefined ? [] : [{ question, answer }];
    }),
  };
}

/**
 * What to send back with "Do it", or null when there is nothing to add.
 *
 * Null is the ordinary case: a plan agreed exactly as proposed needs no
 * covering letter, and their own sentence already says everything. Only what
 * they changed is worth a word — and a model told what to do without being
 * told what to leave alone will helpfully do the rest of what it proposed.
 */
export function decidedMessage(decision: PlanDecision): string | null {
  const notes = decision.kept.flatMap((one, at) =>
    one.note === undefined ? [] : [`- ${String(at + 1)}: ${one.note}`],
  );
  const changed = decision.dropped.length > 0 || decision.reordered || notes.length > 0;
  const parts: string[] = [];

  if (changed) {
    parts.push(PLAN_WORDS.doThese(decision.kept.map((one) => one.step), decision.dropped));
    if (decision.reordered) parts.push(PLAN_WORDS.inThisOrder);
    if (notes.length > 0) parts.push(`${PLAN_WORDS.notesOn}\n\n${notes.join('\n')}`);
  }
  if (decision.answers.length > 0) {
    const lines = decision.answers.map((one) => `- ${one.question} ${one.answer}`);
    parts.push(`${PLAN_WORDS.answersTo}\n\n${lines.join('\n')}`);
  }
  return parts.length === 0 ? null : parts.join('\n\n');
}

/* -------------------------------------------------------------------------- */
/* Is this big enough to plan first?                                           */
/* -------------------------------------------------------------------------- */

/** Words that reach past one thing. Common enough on their own that they only
 *  count alongside a second signal. */
const BREADTH = /\b(?:every|all|each|across|whole|entire|everywhere|throughout|site-?wide)\b/i;

/** Words nobody uses for a small change. */
const BIG_JOB =
  /\b(?:rebuild|rebuilding|redesign|redesigning|re-design|revamp|overhaul|restructure|rewrite|rewriting|migrate|migrating|from scratch|start over|start again)\b/i;

/** A fragment that reads as a thing being complained about rather than a verb
 *  heard. "The button is broken" is a task to someone reading a list of them,
 *  and needs no doing word to be one. Deliberately only words nobody uses
 *  about something that is fine — and every one still needs to sit in its own
 *  fragment, so three complaints are needed before this counts at all. */
const PROBLEM_FRAGMENT =
  /\b(?:broken|broke|misaligned|overlapping|overlaps?|wrong|ugly|cramped|squished|stretched|cut off|glitchy|blurry|pixelated|missing|too small|too big|too large|too long|too short|doesn’?t work|does not work|isn’?t working|is not working|not working|nothing works|needs?|wants?|should be|should have)\b/i;

/** Doing words, in the vocabulary people actually type. */
const ACTIONS = [
  'add',
  'remove',
  'delete',
  'change',
  'update',
  'move',
  'make',
  'build',
  'create',
  'replace',
  'rename',
  'fix',
  'swap',
  'resize',
  'restyle',
  'redesign',
  'rebuild',
  'rewrite',
  'migrate',
  'convert',
  'split',
  'merge',
  'connect',
  'tidy',
  'tighten',
  'clean',
  'sort',
  'reorder',
  'align',
  'crop',
  'shrink',
  'export',
  'import',
  'apply',
  'translate',
  'write',
  'publish',
  'set up',
  'hook up',
  // The vocabulary of everyday requests, added as they were noticed missing:
  // "tweak the header, adjust the footer, polish the nav" is three jobs whose
  // doing words used to be invisible.
  'tweak',
  'adjust',
  'polish',
  'improve',
  'review',
  'check',
  'look',
  'debug',
  'refactor',
  'optimise',
  'optimize',
  'ensure',
  'verify',
  'upgrade',
  'simplify',
  'shorten',
  'extend',
  'expand',
  'drop',
  'straighten',
  'reduce',
  'give',
  'put',
  'wire up',
  'integrate',
  'disable',
  'enable',
  'increase',
  'decrease',
  'rework',
  'modernise',
  'modernize',
  'streamline',
  'restore',
  'revise',
] as const;

const ENDING = '(?:s|d|es|ed|ing)?';
const ACTION_ANYWHERE = ACTIONS.map((verb) => new RegExp(`\\b${verb}${ENDING}\\b`, 'i'));
const ACTION_FIRST = new RegExp(`^(?:${ACTIONS.join('|')})${ENDING}\\b`, 'i');
/** Ways a sentence can open that are asking, not doing. Everything here strips
 *  away so the doing word underneath can be heard; each stays a prefix, never
 *  a whole request. */
const POLITE =
  /^(?:and|then|also|please|maybe|can you|could you|would you|do you think you could|i was hoping you could|i need to|i need you to|we need to|i want to|i wanted you to|i(?:’|')d like to|i(?:’|')d like you to|i would like to|i would like you to|i have to|would it be possible to|is it possible to)\s+/i;
const JOINERS = /\band then\b|\bafter that\b|\bas well as\b|\band\b|\bthen\b|\balso\b|\bplus\b|;/gi;

function distinctActions(text: string): number {
  return ACTION_ANYWHERE.filter((pattern) => pattern.test(text)).length;
}

function joiners(text: string): number {
  return text.match(JOINERS)?.length ?? 0;
}

/** "Swap the hero, fix the footer, and make the nav sticky" is three jobs in
 *  one sentence — and so are "Swap the hero. Fix the footer. Make the nav
 *  sticky." and three lines with no punctuation at all. Counted by fragments
 *  that open with a doing word, whatever boundary separates them, so an
 *  ordinary aside between commas is not mistaken for an item. */
function verbItems(text: string): number {
  let count = 0;
  for (const fragment of text.split(/[,\n;.!?]+/)) {
    let part = fragment.trim();
    if (part === '') continue;
    for (let strip = 0; strip < 3; strip += 1) {
      const shorter = part.replace(POLITE, '');
      if (shorter === part) break;
      part = shorter.trim();
    }
    // "2. change the footer" and "do these: 3. update the nav" both hide the
    // doing word behind a number. The first numbered token ends whatever the
    // preamble was, so it is cut too — a sentence naturally begins after a
    // number, and a number that does not head an item is followed by prose
    // that still has to pass the doing-word test.
    const numbered = /\b\d+[.):]\s+/.exec(part);
    if (numbered !== null) part = part.slice(numbered.index + numbered[0].length);
    for (let strip = 0; strip < 2; strip += 1) {
      const shorter = part.replace(POLITE, '');
      if (shorter === part) break;
      part = shorter.trim();
    }
    if (part !== '' && (ACTION_FIRST.test(part) || PROBLEM_FRAGMENT.test(part))) count += 1;
  }
  return count;
}

function listedItems(text: string): number {
  return HAS_LIST.test(text) ? parseProposal(text).steps.length : 0;
}

/**
 * Does this request look big enough to say what we'd do before doing it?
 *
 * Read only from the person's own sentence, and deliberately hard to trigger: a
 * wrong yes costs them a round trip, so one common word is never enough on its
 * own. A wrong no costs nothing — the work happens the way it always has.
 *
 * The things counted as items are the ways people actually write a list of
 * jobs: a marked list, a comma run, sentences closed with a full stop, lines
 * with no punctuation at all, and numbers dropped into prose ("1. fix the
 * header, 2. …"). Whatever their doing word, three of them are a plan.
 */
export function worthPlanning(text: string): boolean {
  const said = text.trim();
  if (said === '') return false;

  const words = said.split(/\s+/).length;
  const long = words >= 45;
  const actions = distinctActions(said);
  const clauses = joiners(said);
  const items = Math.max(listedItems(said), verbItems(said));
  // Four or more distinct fragments is a list of jobs however it is written —
  // even without a doing word in each (“sidebar popups hidden behind rail,
  // star not aligned in circle …”). This is the “as much as possible” rule
  // for the build tracker: a long task should always get its checklist.
  const fragments = said
    .split(/[\n]+|[.!?]+\s+|;\s*|,\s*(?=[^,]{8,})/)
    .map((part) => part.replace(/^\s*\d+[.):]\s*/, '').trim())
    .filter((part) => part.length >= 12);
  if (fragments.length >= 4) return true;
  // Very huge/medium tasks with two jobs and a long description should also plan —
  // user reported even huge tasks not creating a todo. Keep threshold high so single polite asks stay non-planning.
  if (words >= 60 && actions >= 2 && items >= 2) return true;

  if (BIG_JOB.test(said)) return true;
  if (items >= 3) return true;
  if (BREADTH.test(said) && (actions >= 2 || items >= 2 || clauses >= 2 || long)) return true;
  if (actions >= 3 && clauses >= 1) return true;
  if (long && actions >= 2 && clauses >= 2) return true;
  return false;
}
