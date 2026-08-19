/** The rules a project carries, and the three moments they get a say.
 *
 * The Guard decides what is safe. This decides what a team has agreed to on top
 * of that — "check with me before touching the design system", "nothing is
 * handed back while the tests are red" — written in a file the project carries,
 * so everybody working in it gets the same answers.
 *
 * ## A rule can only tighten
 *
 * It can turn a yes into a question, or a question into a no. It can never go
 * the other way, and that is designed in twice.
 *
 * First, the vocabulary has no word for letting something through: `ask`,
 * `refuse` and `keep a way back` are the only answers a rule may give, and a
 * file that tries any other word is reported rather than obeyed. Second, every
 * answer is folded into the Guard's through `stricter`, which keeps whichever
 * of the two is harder. So a rules file cannot say yes, and would not be
 * believed if it did.
 *
 * The field is split on this and it is the split worth being on the right side
 * of. Cursor, OpenCode and Amp all let a rule answer "allow" and skip the gate
 * outright; Cursor additionally lets one through when its own script crashes.
 * Cline, Windsurf and Gemini's hooks have no way to say yes at all, and that is
 * where this sits. Here the Guard is a floor and nothing above it digs.
 *
 * ## Pure and synchronous, like the Guard
 *
 * No disk, no clock, no module state. The caller reads the file and hands the
 * text in. A rule that needs to know something about the world — whether the
 * tests pass — is answered from `World`, which the caller fills in, and a check
 * nobody has run is never treated as one that passed.
 */

import { toPosix } from './guard/paths';
import type { CallDoes, CallShape } from './guard/policy';
import { describeCall, stricter } from './guard/policy';
import type { ToolCall, Verdict } from './types';

/* -------------------------------------------------------------------------- */
/* What the user reads                                                         */
/* -------------------------------------------------------------------------- */

export const RULE_WORDS = {
  where: 'They live in this project, in .pi/rules.json.',
  none: 'This project has no rules of its own yet.',
  /** Asked because the project said to ask, not because the Guard was unsure. */
  askQuestion: 'Go ahead with this?',
  houseRule: (name: string): string => `This project's own rules say to check first, under "${name}".`,
  refused: (name: string, because: string): string =>
    `${because} That is this project's own rule, "${name}", so I have left it alone.`,
  wayBack: (name: string, because: string): string => `${because} ("${name}")`,
  /** After the fact: the thing happened, and a rule has something to say about it. */
  afterwards: (name: string, because: string): string => `${because} ("${name}")`,
  /** A named check nobody has run yet. Not knowing is not the same as passing. */
  notCheckedYet: (check: string): string =>
    `I do not know yet whether "${check}" passes, and this project's rules want it passing first.`,
  /** A named check that did run, and did not come back clear. */
  notPassing: (check: string): string =>
    `"${check}" is not passing, and this project's rules want it passing first.`,
  /** The turn wanted to end and a rule would not let it. */
  held: (name: string, because: string): string => `${because} I am not done yet — "${name}".`,

  /** When the file itself is wrong. Mirrors how the connected tools say it. */
  fileTrouble: (because: string): string =>
    `I could not read this project's own rules: ${because} Only my usual care is being applied until it reads.`,
  notJson: (said: string): string => `the file is there but not valid JSON — ${said}`,
  notAnObject: 'the file does not hold a list of rules.',
  noList: 'the file has no "rules" list in it.',
  notAList: '"rules" is there but is not a list.',

  /** One entry that could not be used, and why. Every one of these is said out
   *  loud: a rule silently dropped is a rule somebody thinks is protecting them. */
  notARule: (which: string): string => `${which} is not a rule.`,
  needsName: (which: string): string => `${which} has no name.`,
  needsBecause: (name: string): string => `"${name}" does not say why, so nobody would know what it meant.`,
  badMoment: (name: string, said: string): string =>
    `"${name}" happens "${said}", which is not a moment. Use "before", "after" or "at the end".`,
  badAnswer: (name: string, said: string): string =>
    `"${name}" answers "${said}", which is not something a rule may say. A rule may only ask, refuse, or keep a way back — it cannot let something through.`,
  badDoing: (name: string, said: string): string =>
    `"${name}" is about "${said}", which is not a kind of thing I do.`,
  endNeedsCheck: (name: string): string =>
    `"${name}" happens at the end but names nothing to check, so it would stop every turn.`,
} as const;

/* -------------------------------------------------------------------------- */
/* The rules themselves                                                        */
/* -------------------------------------------------------------------------- */

/** When a rule gets its say. */
export type Moment = 'before' | 'after' | 'at the end';

/** What a rule is about. `anything` is the matcher's own word; the rest are the
 *  Guard's, so the two always mean the same calls. */
export type Doing = CallDoes | 'anything';

/** The only three things a rule may answer. There is deliberately no fourth. */
export type Answer = 'ask' | 'refuse' | 'keep a way back';

export type Rule = {
  /** What to call it on screen when it speaks. */
  name: string;
  when: Moment;
  it: Doing;
  /** Locations it is about. A folder covers everything under it. */
  under: readonly string[];
  /** Words that have to appear in the command or in what is being written. */
  mentions: readonly string[];
  /** A check that has to be passing. Absent, the rule is about the call alone. */
  needs: string | null;
  then: Answer;
  /** The sentence the person reads. Written by whoever wrote the rule. */
  because: string;
};

export type Rules = {
  rules: readonly Rule[];
  /** Why the whole file could not be read, when it could not. */
  trouble: string | null;
  /** Entries that were in the file but could not be used, and why. */
  skipped: readonly string[];
};

/** What a named check last said. A check nobody has run is simply absent, which
 *  is not the same as one that passed. */
export type Checked = { passing: boolean; said?: string };

/** The bits of the world a rule may need. The impure caller fills this in; this
 *  module never goes looking. */
export type World = {
  checks?: Readonly<Record<string, Checked>>;
};

export function rulesFile(projectRoot: string): string {
  return `${projectRoot}/.pi/rules.json`;
}

/* -------------------------------------------------------------------------- */
/* Reading the file                                                            */
/* -------------------------------------------------------------------------- */

const MOMENTS: readonly Moment[] = ['before', 'after', 'at the end'];
const ANSWERS: readonly Answer[] = ['ask', 'refuse', 'keep a way back'];
const DOINGS: readonly Doing[] = [
  'anything',
  'reads',
  'changes files',
  'deletes something',
  'runs a command',
  'reaches the internet',
  'something else',
];

const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];

function ordinal(position: number): string {
  return ORDINALS[position - 1] ?? `${String(position)}th`;
}

function words(value: unknown): string[] {
  if (typeof value === 'string') return value.trim() === '' ? [] : [value];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '');
}

const empty: Rules = { rules: [], trouble: null, skipped: [] };

/**
 * The rules a project carries, from the text of its file.
 *
 * A missing file — `null` — is no rules, which is the ordinary case and says
 * nothing. A file that is *there and wrong* is a different thing entirely, and
 * has to say so: a rule somebody wrote and believes is protecting them, dropped
 * because of a misplaced comma, is worse than no rule at all.
 *
 * When the file will not read, the Guard's own answers stand unchanged. Nothing
 * here can lower them, so a broken file costs the project its extra care and
 * never its floor.
 */
export function readRules(raw: string | null): Rules {
  if (raw === null) return empty;

  let parsed: { rules?: unknown };
  try {
    parsed = JSON.parse(raw) as { rules?: unknown };
  } catch (cause) {
    const said = cause instanceof Error ? cause.message : 'it is not readable.';
    return { ...empty, trouble: RULE_WORDS.notJson(said) };
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ...empty, trouble: RULE_WORDS.notAnObject };
  }
  if (parsed.rules === undefined) return { ...empty, trouble: RULE_WORDS.noList };
  if (!Array.isArray(parsed.rules)) return { ...empty, trouble: RULE_WORDS.notAList };

  const rules: Rule[] = [];
  const skipped: string[] = [];

  for (const [at, entry] of parsed.rules.entries()) {
    const which = `the ${ordinal(at + 1)} one`;
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      skipped.push(RULE_WORDS.notARule(which));
      continue;
    }
    const record = entry as Record<string, unknown>;

    const name = typeof record.name === 'string' ? record.name.trim() : '';
    if (name === '') {
      skipped.push(RULE_WORDS.needsName(which));
      continue;
    }

    const when = typeof record.when === 'string' ? record.when.trim() : '';
    if (!MOMENTS.includes(when as Moment)) {
      skipped.push(RULE_WORDS.badMoment(name, when));
      continue;
    }

    // Where "allow" is turned away. The vocabulary has no word for letting
    // something through, and a file reaching for one is told so by name.
    const then = typeof record.then === 'string' ? record.then.trim() : '';
    if (!ANSWERS.includes(then as Answer)) {
      skipped.push(RULE_WORDS.badAnswer(name, then));
      continue;
    }

    const it = record.it === undefined ? 'anything' : typeof record.it === 'string' ? record.it.trim() : '';
    if (!DOINGS.includes(it as Doing)) {
      skipped.push(RULE_WORDS.badDoing(name, it));
      continue;
    }

    const because = typeof record.because === 'string' ? record.because.trim() : '';
    if (because === '') {
      skipped.push(RULE_WORDS.needsBecause(name));
      continue;
    }

    const needs = typeof record.needs === 'string' && record.needs.trim() !== '' ? record.needs.trim() : null;
    if (when === 'at the end' && needs === null) {
      skipped.push(RULE_WORDS.endNeedsCheck(name));
      continue;
    }

    rules.push({
      name,
      when: when as Moment,
      it: it as Doing,
      under: words(record.under),
      mentions: words(record.mentions),
      needs,
      then: then as Answer,
      because,
    });
  }

  return { rules, trouble: null, skipped };
}

/* -------------------------------------------------------------------------- */
/* Matching                                                                    */
/* -------------------------------------------------------------------------- */

/** Segment-wise containment, so `src/design` covers `src/design/tokens.css`
 *  however the call spelt the path, and never matches `src/designer`. A `*.css`
 *  entry matches by ending instead, because that is the one thing people write
 *  that is not a folder. */
function coversPath(entry: string, path: string): boolean {
  const wanted = toPosix(entry).replace(/^\.\//, '').replace(/\/+$/, '').toLowerCase();
  const actual = toPosix(path).replace(/^\.\//, '').replace(/\/+$/, '').toLowerCase();
  if (wanted === '') return false;
  if (wanted.startsWith('*.')) return actual.endsWith(wanted.slice(1));
  if (wanted === actual) return true;
  const parts = actual.split('/');
  const run = wanted.split('/');
  for (let start = 0; start + run.length <= parts.length; start += 1) {
    if (run.every((piece, offset) => parts[start + offset] === piece)) return true;
  }
  return false;
}

/** A command keeps its locations inside itself rather than in a field of its
 *  own, so a call that named none falls back to the words. That is the
 *  tightening direction: a rule fires that would otherwise have looked past. */
function touches(rule: Rule, shape: CallShape): boolean {
  if (rule.under.length === 0) return true;
  if (shape.paths.length > 0) {
    return rule.under.some((entry) => shape.paths.some((path) => coversPath(entry, path)));
  }
  const haystack = toPosix(shape.text).toLowerCase();
  return rule.under.some((entry) => haystack.includes(toPosix(entry).replace(/^\.\//, '').toLowerCase()));
}

function saysAny(rule: Rule, text: string): boolean {
  if (rule.mentions.length === 0) return true;
  const haystack = text.toLowerCase();
  return rule.mentions.some((word) => haystack.includes(word.toLowerCase()));
}

/** A check's name, reduced to what two people writing it down would agree on.
 *  Case and punctuation are not part of what somebody meant by "tests", so
 *  `needs: "tests"` finds a check filed as `tests.md` or called "Tests". */
function sameName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** What a named check last said, under every name it might have been filed as.
 *  A rule and a check file are written by different hands on different days. */
function lookUp(check: string, world: World): readonly Checked[] {
  const wanted = sameName(check);
  if (wanted === '') return [];
  return Object.entries(world.checks ?? {})
    .filter(([name]) => sameName(name) === wanted)
    .map(([, checked]) => checked);
}

/** Whether a named check is known to be passing. Absent is not passing: a rule
 *  that wants the tests green has no business assuming they are. Where a name
 *  found more than one answer, every one of them has to be clear. */
function passing(check: string, world: World): boolean {
  const found = lookUp(check, world);
  return found.length > 0 && found.every((one) => one.passing);
}

/** Why a rule is speaking: nobody has run the check, or somebody did and it did
 *  not come back clear. Two different things to be told. */
function whyNotPassing(check: string, world: World): string {
  return lookUp(check, world).length === 0
    ? RULE_WORDS.notCheckedYet(check)
    : RULE_WORDS.notPassing(check);
}

function matches(rule: Rule, moment: Moment, shape: CallShape): boolean {
  if (rule.when !== moment) return false;
  if (rule.it !== 'anything' && rule.it !== shape.does) return false;
  return touches(rule, shape) && saysAny(rule, shape.text);
}

/* -------------------------------------------------------------------------- */
/* Before                                                                      */
/* -------------------------------------------------------------------------- */

export type Beforehand = {
  /** The Guard's answer, or something harder. Never something softer. */
  verdict: Verdict;
  /** The rules that spoke, by name, in the order they are written. */
  spoke: readonly string[];
  /** Said on screen when the file itself would not read. */
  trouble: string | null;
};

function asVerdict(rule: Rule, why: string): Verdict {
  if (rule.then === 'refuse') return { kind: 'deny', reason: RULE_WORDS.refused(rule.name, why) };
  if (rule.then === 'keep a way back') {
    return { kind: 'snapshot-first', reason: RULE_WORDS.wayBack(rule.name, why) };
  }
  return {
    kind: 'confirm',
    question: RULE_WORDS.askQuestion,
    detail: why,
    consequence: RULE_WORDS.houseRule(rule.name),
  };
}

/**
 * The project's own rules, on top of the Guard's answer.
 *
 * `guarded` goes in first and stays on the left of every fold, so a rule can
 * only make it harder and a refusal the Guard wrote keeps the Guard's words.
 * There is no argument to this function that can produce a verdict softer than
 * the one it was given — including a file that has been tampered with, and
 * including no file at all.
 */
export function beforeCall(call: ToolCall, guarded: Verdict, rules: Rules, world: World = {}): Beforehand {
  const shape = describeCall(call);
  let verdict = guarded;
  const spoke: string[] = [];

  for (const rule of rules.rules) {
    if (!matches(rule, 'before', shape)) continue;
    if (rule.needs !== null && passing(rule.needs, world)) continue;
    const why =
      rule.needs === null ? rule.because : `${whyNotPassing(rule.needs, world)} ${rule.because}`;
    verdict = stricter(verdict, asVerdict(rule, why));
    spoke.push(rule.name);
  }

  return { verdict, spoke, trouble: rules.trouble ?? null };
}

/* -------------------------------------------------------------------------- */
/* After                                                                       */
/* -------------------------------------------------------------------------- */

export type Afterwards = {
  /** Sentences to hand the model, so it puts right what it just did. */
  sayBack: readonly string[];
  /** Checks a rule wants an answer from now. The caller runs these. */
  run: readonly string[];
  spoke: readonly string[];
  trouble: string | null;
};

/**
 * What the project has to say about something that already happened.
 *
 * Nothing here can undo it — the moment for that was `beforeCall`. What it can
 * do is name the check that now needs running, and hand the model a sentence
 * about what it just broke, which is the loop behind "before anything is saved,
 * run the tests": the change goes through, the tests get run, and the next call
 * or the end of the turn is where that answer bites.
 */
export function afterCall(call: ToolCall, rules: Rules, world: World = {}): Afterwards {
  const shape = describeCall(call);
  const sayBack: string[] = [];
  const run: string[] = [];
  const spoke: string[] = [];

  for (const rule of rules.rules) {
    if (!matches(rule, 'after', shape)) continue;
    if (rule.needs !== null && !run.includes(rule.needs)) run.push(rule.needs);
    if (rule.needs !== null && passing(rule.needs, world)) continue;
    sayBack.push(RULE_WORDS.afterwards(rule.name, rule.because));
    spoke.push(rule.name);
  }

  return { sayBack, run, spoke, trouble: rules.trouble ?? null };
}

/* -------------------------------------------------------------------------- */
/* At the end                                                                  */
/* -------------------------------------------------------------------------- */

export type Ending = {
  /** Empty when the turn may be handed back. Sentences when it may not. */
  hold: readonly string[];
  /** Worth mentioning, but not worth holding the turn over. */
  mention: readonly string[];
  /** Checks the end of a turn depends on, so the caller knows to run them. */
  run: readonly string[];
  spoke: readonly string[];
  trouble: string | null;
};

/**
 * Whether the turn may be handed back.
 *
 * Every rule here names a check, because one that did not would stop every turn
 * forever; the reader turns those away. A check nobody has run holds the turn
 * exactly as a failing one does — "I do not know" is not "it is fine", and this
 * is the same deny-by-default the Guard is built on.
 */
export function atTheEnd(rules: Rules, world: World = {}): Ending {
  const hold: string[] = [];
  const mention: string[] = [];
  const run: string[] = [];
  const spoke: string[] = [];

  for (const rule of rules.rules) {
    if (rule.when !== 'at the end' || rule.needs === null) continue;
    if (!run.includes(rule.needs)) run.push(rule.needs);
    if (passing(rule.needs, world)) continue;
    const said = RULE_WORDS.held(rule.name, rule.because);
    if (rule.then === 'refuse') hold.push(said);
    else mention.push(said);
    spoke.push(rule.name);
  }

  return { hold, mention, run, spoke, trouble: rules.trouble ?? null };
}

/* -------------------------------------------------------------------------- */
/* Reading a rule back                                                         */
/* -------------------------------------------------------------------------- */

const ANSWER_WORDS: Record<Answer, string> = {
  ask: 'I check with you',
  refuse: 'I stop and say so',
  'keep a way back': 'I save a way back first',
};

const DOING_WORDS: Record<Doing, string> = {
  anything: 'I do anything',
  reads: 'I read something',
  'changes files': 'I change a file',
  'deletes something': 'I delete something',
  'runs a command': 'I run a command',
  'reaches the internet': 'I reach the internet',
  'something else': 'I do something I cannot name',
};

/**
 * One rule as a sentence, for the panel that lists them.
 *
 * The file is meant to be readable on its own, but the person who has to live
 * with a rule is rarely the person who wrote it, and a list of sentences is the
 * only version of this a designer reads without being taught the fields.
 */
export function inWords(rule: Rule): string {
  if (rule.when === 'at the end') {
    const check = rule.needs ?? '';
    return `Before I hand anything back, ${check} has to pass, or ${ANSWER_WORDS[rule.then]}. ${rule.because}`;
  }
  const parts: string[] = [rule.when === 'before' ? 'Before' : 'After', DOING_WORDS[rule.it]];
  if (rule.under.length > 0) parts.push(`in ${rule.under.join(' or ')}`);
  if (rule.mentions.length > 0) parts.push(`mentioning ${rule.mentions.join(' or ')}`);
  const opening = parts.join(' ');
  const unless = rule.needs === null ? '' : `, unless ${rule.needs} is passing`;
  return `${opening}${unless}, ${ANSWER_WORDS[rule.then]}. ${rule.because}`;
}
