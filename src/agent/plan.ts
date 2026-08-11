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
  alternative: 'Change something first',
  /** Handed back to the model when it reaches for something that would change
   *  the project while it is only supposed to be looking. */
  withheld:
    'Not yet — this is the looking-around pass. Do not change anything. Say what you would do, as a short numbered list, and it will be put to the person to approve.',
  /** Added under the person's own words on a looking-around pass. */
  asked:
    'Before doing any of this: look through the project and answer with a short numbered list of the steps you would take. Change nothing yet.',
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
};

/** Long enough to be a plan, short enough to be read. */
const MAX_STEPS = 12;

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
  const lines = text.split(/\r?\n/);
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
    return { steps: whole === '' ? [] : [whole], caveats: [] };
  }

  const steps = items.slice(0, MAX_STEPS);
  const extra = items.length - steps.length;
  return { steps, caveats: extra > 0 ? [...asides, PLAN_WORDS.more(extra)] : asides };
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
] as const;

const ENDING = '(?:s|d|es|ed|ing)?';
const ACTION_ANYWHERE = ACTIONS.map((verb) => new RegExp(`\\b${verb}${ENDING}\\b`, 'i'));
const ACTION_FIRST = new RegExp(`^(?:${ACTIONS.join('|')})${ENDING}\\b`, 'i');
const POLITE = /^(?:and|then|also|please|maybe|can you|could you|would you|i(?:’|')d like you to|i want you to)\s+/i;
const JOINERS = /\band then\b|\bafter that\b|\bas well as\b|\band\b|\bthen\b|\balso\b|\bplus\b|;/gi;

function distinctActions(text: string): number {
  return ACTION_ANYWHERE.filter((pattern) => pattern.test(text)).length;
}

function joiners(text: string): number {
  return text.match(JOINERS)?.length ?? 0;
}

/** "Swap the hero, fix the footer, and make the nav sticky" is three jobs in one
 *  sentence. Counted by fragments that open with a doing word, so an ordinary
 *  aside between commas is not mistaken for an item. */
function commaItems(text: string): number {
  let count = 0;
  for (const fragment of text.split(',')) {
    let part = fragment.trim();
    for (let strip = 0; strip < 3; strip += 1) {
      const shorter = part.replace(POLITE, '');
      if (shorter === part) break;
      part = shorter;
    }
    if (ACTION_FIRST.test(part)) count += 1;
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
 */
export function worthPlanning(text: string): boolean {
  const said = text.trim();
  if (said === '') return false;

  const words = said.split(/\s+/).length;
  const long = words >= 45;
  const actions = distinctActions(said);
  const clauses = joiners(said);
  const items = Math.max(listedItems(said), commaItems(said));

  if (BIG_JOB.test(said)) return true;
  if (items >= 3) return true;
  if (BREADTH.test(said) && (actions >= 2 || items >= 2 || clauses >= 2 || long)) return true;
  if (actions >= 3 && clauses >= 1) return true;
  if (long && actions >= 2 && clauses >= 2) return true;
  return false;
}
