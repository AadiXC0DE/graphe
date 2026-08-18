/** Reading a clicked element back to the person who clicked it.
 *
 * `point.ts` gathers; this decides. Everything the page could work out arrives
 * as a pile of unranked evidence, and the judgement about which of it to
 * believe belongs somewhere it can be tested without a browser — so it is here,
 * and it is a function of its arguments and nothing else.
 *
 * The answer is in the vocabulary of a design system: the background, the
 * corners, your brand blue. Not `background-color: rgb(24 24 27)`.
 */

import {
  NEAR_COLOUR,
  NEAR_LENGTH,
  apart,
  hexOf,
  leaveAlone,
  leaveLengthAlone,
  nameFor,
  readColour,
  readLength,
  saysDrift,
  type Confidence,
  type Known,
  type Length,
  type Rgb,
} from '../design/drift';
import { WIDTHS, type Width } from '../design/widths';
import { agoInSentence } from '../lib/when';
import { describePointed, type Pointed, type Trace } from './point';
// Types only: reading a folder pulls the filesystem in with it, and this runs
// beside the card.
import type { Component, Usage } from '../design/usage';

/* -------------------------------------------------------------------------- */
/* What a reading is                                                           */
/* -------------------------------------------------------------------------- */

/** One change, as the history knows it. */
export type Change = { name: string; when: number; id?: string };

/** How much of the answer is evidence and how much is inference. */
export type Sureness = 'exact' | 'likely' | 'guess';

/** Where this element was written, as far as anything could tell. */
export type Made = {
  /** Which rung of the chain answered. */
  how: Trace['how'];
  sure: Sureness;
  component?: string;
  where?: { file: string; line: number; column?: number };
  /** How far a change to it would reach, counted: "34 times in 9 files, on 3
   *  screens." The list below is capped; this is not, and it is the honest
   *  answer to "will this break something else?" */
  reach?: string;
  /** The other files that component turns up in, most-used first. */
  alsoIn?: readonly string[];
  /** The screens it appears on. */
  screens?: readonly string[];
  /** What to go looking for when nothing better was found. Always something. */
  find: string;
  says: string;
};

/** One of the project's own values, in use here. */
export type Using = {
  /** What it affects, said plainly: "the background", "the corners". */
  what: string;
  /** The project's own name for it, `--brand-blue` and all. */
  name: string;
  value: string;
  says: string;
};

/** A value that was nearly one of the project's own. */
export type Adrift = {
  what: string;
  /** Exactly as the page renders it. */
  wrote: string;
  mine: { name: string; value: string };
  confidence: Confidence;
  says: string;
  /** Exact values. Never reaches a sentence. */
  detail: string;
};

/** One size to look at it in. */
export type AtWidth = Width & { here: boolean };

export type Widths = {
  all: readonly AtWidth[];
  says: string;
};

export type Changed = {
  name: string;
  when: number;
  id?: string;
  says: string;
};

/** Everything the card shows. */
export type Reading = {
  /** The element, said plainly. */
  title: string;
  made: Made;
  /** Most telling first: colours before sizes. */
  using: readonly Using[];
  adrift: readonly Adrift[];
  changed: Changed | null;
  widths: Widths;
  /** What could not be worked out, in words. Empty means everything was. */
  unsure: readonly string[];
};

/** What the project knows, for a reading to be made against. Every field is
 *  optional: pointing at a stranger's site is a thinner reading, not a failure. */
export type Material = {
  /** The project's own values, as its stylesheet writes them. */
  tokens?: readonly Known[];
  /** Every component to every place it is used. */
  usage?: Usage | null;
  /** What last touched each file, by project-relative path. */
  changes?: ReadonlyMap<string, Change>;
  /** The sizes this project designs at, when it has said. */
  widths?: readonly Width[];
  now?: number;
};

/* -------------------------------------------------------------------------- */
/* Bounds                                                                      */
/* -------------------------------------------------------------------------- */

/** Enough of a card to read at a glance. Past this it is a list, and a list of
 *  values is the thing a designer already could not read in DevTools. */
const MOST_VALUES = 10;

/** Files beyond this and the card is naming a whole project back at somebody. */
const MOST_PLACES = 6;

/* -------------------------------------------------------------------------- */
/* Which evidence to believe                                                   */
/* -------------------------------------------------------------------------- */

/** The chain, best first. Nothing below `owner` names a component, and nothing
 *  below `stack` names a line — but every rung answers something, which is the
 *  whole point of having six of them. */
const BELIEF: Readonly<Record<Trace['how'], number>> = {
  stamp: 6,
  stack: 5,
  owner: 4,
  selector: 3,
  markup: 2,
  text: 1,
};

function rank(trace: Trace): number {
  return BELIEF[trace.how] ?? 0;
}

function best(origin: readonly Trace[]): Trace | null {
  let found: Trace | null = null;
  for (const trace of origin) {
    if (found === null || rank(trace) > rank(found)) found = trace;
  }
  return found;
}

function firstOf<T extends Trace['how']>(
  origin: readonly Trace[],
  how: T,
): Extract<Trace, { how: T }> | null {
  for (const trace of origin) {
    if (trace.how === how) return trace as Extract<Trace, { how: T }>;
  }
  return null;
}

function surenessOf(trace: Trace): Sureness {
  if (trace.how === 'stamp') return 'exact';
  if (trace.how === 'stack') return trace.mapped === true ? 'exact' : 'likely';
  if (trace.how === 'owner') return 'likely';
  return 'guess';
}

/** A file said the way somebody would say it: the name, not the whole path. */
function fileWord(file: string): string {
  const parts = file.split('/');
  return parts[parts.length - 1] ?? file;
}

function shorten(text: string, most: number): string {
  const tidy = text.replace(/\s+/g, ' ').trim();
  return tidy.length <= most ? tidy : `${tidy.slice(0, most - 1)}…`;
}

/** What to hand somebody, or an agent, when the line is not known. Its own
 *  words first, because those are what a person can find on the page. */
function findFrom(origin: readonly Trace[], pointed: Pointed): string {
  const text = firstOf(origin, 'text');
  if (text !== null && text.text.trim() !== '') return shorten(text.text, 60);
  const selector = firstOf(origin, 'selector');
  if (selector !== null) return selector.selector;
  if (pointed.selector !== '') return pointed.selector;
  const markup = firstOf(origin, 'markup');
  return markup === null ? pointed.label : shorten(markup.html, 60);
}

function placesOf(component: Component): readonly string[] {
  return component.used
    .filter((place) => place.file !== component.file)
    .slice(0, MOST_PLACES)
    .map((place) => place.file);
}

function screensOf(component: Component): readonly string[] {
  return component.screens.map((screen) => screen.name);
}

/** Every component of that name, whichever file wrote it. The one that is
 *  shared is the one somebody meant. */
function componentNamed(usage: Usage | null | undefined, name: string): Component | null {
  if (usage === null || usage === undefined) return null;
  const wanted = name.toLowerCase();
  const all = usage.components.filter((one) => one.name.toLowerCase() === wanted);
  return all.find((one) => one.shared) ?? all[0] ?? null;
}

function whereSays(component: string | undefined, file: string, line: number): string {
  const where = `${fileWord(file)}, line ${line}`;
  return component === undefined
    ? `Written in ${where}.`
    : `${component} made this — ${where}.`;
}

function madeFrom(pointed: Pointed, material: Material, unsure: string[]): Made {
  const origin = pointed.origin ?? [];
  const find = findFrom(origin, pointed);
  const winner = best(origin);

  if (winner === null) {
    unsure.push('I could not work out which component made this, or where it was written.');
    return {
      how: 'selector',
      sure: 'guess',
      find,
      says: `I could not work out which component made this. Look for ${find}.`,
    };
  }

  // A stack names the line but rarely the component, and an owner names the
  // component and never the line. Together they are one answer.
  const named = firstOf(origin, 'owner');
  const component =
    (winner.how === 'stamp' ? winner.component : undefined) ?? named?.component ?? undefined;

  const made: Made = { how: winner.how, sure: surenessOf(winner), find, says: '' };
  if (component !== undefined) made.component = component;

  if (winner.how === 'stamp' || winner.how === 'stack') {
    const where: Made['where'] = { file: winner.file, line: winner.line };
    if (winner.column !== undefined) where.column = winner.column;
    made.where = where;
    made.says = whereSays(component, winner.file, winner.line);
    if (winner.how === 'stack' && winner.mapped !== true) {
      unsure.push('That file is the one the page is running, not the one you wrote.');
    }
  } else if (winner.how === 'owner') {
    made.says = `${winner.component} made this. I could not work out which line.`;
    unsure.push('I could not work out which line of that component made this.');
  } else {
    made.says = `I could not work out which component made this. Look for ${find}.`;
    unsure.push('I could not work out which component made this.');
  }

  if (component === undefined) {
    if (made.how === 'stamp' || made.how === 'stack') {
      unsure.push('I could not work out what that component is called.');
    }
    return made;
  }

  const known = componentNamed(material.usage, component);
  if (known === null) return made;

  if (made.where === undefined) {
    made.where = { file: known.file, line: known.line };
    made.says = whereSays(component, known.file, known.line);
    made.sure = 'likely';
  }
  made.reach = known.says;
  const alsoIn = placesOf(known);
  if (alsoIn.length > 0) made.alsoIn = alsoIn;
  const screens = screensOf(known);
  if (screens.length > 0) made.screens = screens;
  if (known.unsure.length > 0) {
    unsure.push(`Some uses of ${component} were not visible to me, so this may not be all of them.`);
  }
  return made;
}

/* -------------------------------------------------------------------------- */
/* Which of the project's own values are in play                               */
/* -------------------------------------------------------------------------- */

/** The properties worth naming. Everything else a browser resolves is layout
 *  mechanics, not a decision anybody made about how this looks. */
const PLAINLY: Readonly<Record<string, string>> = {
  color: 'the text',
  'background-color': 'the background',
  'border-color': 'the border',
  'border-width': 'the border',
  'border-radius': 'the corners',
  'box-shadow': 'the shadow',
  'font-family': 'the typeface',
  'font-size': 'the text size',
  'font-weight': 'the weight',
  'line-height': 'the line height',
  'letter-spacing': 'the letter spacing',
  gap: 'the gap',
  'padding-top': 'the padding above',
  'padding-right': 'the padding to the right',
  'padding-bottom': 'the padding below',
  'padding-left': 'the padding to the left',
  'margin-top': 'the space above',
  'margin-right': 'the space to the right',
  'margin-bottom': 'the space below',
  'margin-left': 'the space to the left',
};

/** Four sides at the same value is one decision, and reading it back as four
 *  lines is how a panel becomes a wall. */
const SIDES: readonly { of: readonly string[]; as: string }[] = [
  { of: ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'], as: 'the padding' },
  { of: ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'], as: 'the space around it' },
];

/** Colours first: a colour off the palette is the thing somebody sees. */
const FIRST = new Set(['the text', 'the background', 'the border', 'the shadow']);

type Seen = { what: string; property: string; value: string };

function styleFacts(styles: Readonly<Record<string, string>>): readonly Seen[] {
  const collapsed = new Set<string>();
  const out: Seen[] = [];

  for (const group of SIDES) {
    const values = group.of.map((one) => (styles[one] ?? '').trim());
    const first = values[0] ?? '';
    if (first === '' || !values.every((value) => value === first)) continue;
    for (const one of group.of) collapsed.add(one);
    out.push({ what: group.as, property: group.of[0] ?? '', value: first });
  }

  for (const [property, what] of Object.entries(PLAINLY)) {
    if (collapsed.has(property)) continue;
    const value = (styles[property] ?? '').trim();
    if (value !== '') out.push({ what, property, value });
  }

  return out.sort((one, other) => Number(FIRST.has(other.what)) - Number(FIRST.has(one.what)));
}

type Mine = { known: Known; colour: Rgb | null; length: Length | null };

/** A colour that carries alpha is compared as it renders. `apart` already
 *  refuses see-through values, so this only has to normalise the notation. */
function sameColour(one: Rgb, other: Rgb): boolean {
  return hexOf(one) === hexOf(other) && Math.abs(one.a - other.a) < 0.004;
}

function readMine(tokens: readonly Known[]): readonly Mine[] {
  const out: Mine[] = [];
  for (const known of tokens) {
    const value = (known.value ?? '').trim();
    if (value === '') continue;
    const colour = readColour(value);
    out.push({ known, colour, length: colour === null ? readLength(value) : null });
  }
  return out;
}

/** The project's own values, whether we read its stylesheet or the page told
 *  us. What the page resolves wins nothing it does not already say better. */
export function tokensFor(material: Material, pointed: Pointed): readonly Known[] {
  const out: Known[] = [];
  const seen = new Set<string>();
  for (const token of material.tokens ?? []) {
    if (seen.has(token.name)) continue;
    seen.add(token.name);
    out.push(token);
  }
  for (const [name, value] of Object.entries(pointed.source?.vars ?? {})) {
    if (seen.has(name) || value.trim() === '') continue;
    seen.add(name);
    out.push({ name, value: value.trim() });
  }
  return out;
}

function nearestColour(colour: Rgb, mine: readonly Mine[]): { one: Mine; distance: number } | null {
  let found: { one: Mine; distance: number } | null = null;
  for (const one of mine) {
    if (one.colour === null) continue;
    const distance = apart(colour, one.colour);
    if (found === null || distance < found.distance) found = { one, distance };
  }
  return found;
}

function nearestLength(
  length: Length,
  mine: readonly Mine[],
): { one: Mine; distance: number } | null {
  let found: { one: Mine; distance: number } | null = null;
  for (const one of mine) {
    if (one.length === null || one.length.px === 0) continue;
    const distance = Math.abs(length.px - one.length.px) / one.length.px;
    if (found === null || distance < found.distance) found = { one, distance };
  }
  return found;
}

function confidenceOf(distance: number, near: number): Confidence {
  if (distance <= near / 3) return 'sure';
  if (distance <= (near * 2) / 3) return 'likely';
  return 'maybe';
}

/**
 * What to call one of the project's own values in a sentence.
 *
 * Colours get the name `drift` gives them. Everything else is said by its own
 * words rather than by the scale it sits on: "your space 4" is what a designer
 * would say, and the sentence is a positive one with the name beside it.
 */
function saidAs(known: Known, colour: Rgb | null): string {
  if (colour !== null) return nameFor(known, colour);
  const words = known.name.replace(/^--/, '').replace(/[-_]+/g, ' ').trim();
  return words === '' ? nameFor(known, null) : words;
}

function usingSays(what: string, yours: string): string {
  return `${what.charAt(0).toUpperCase()}${what.slice(1)} is your ${yours}.`;
}

type Values = { using: readonly Using[]; adrift: readonly Adrift[] };

/**
 * Which of the project's own values this element uses, and which it nearly
 * uses.
 *
 * Read off what the browser resolved rather than off the stylesheet, because
 * that is the only place the cascade has finished happening — a token six
 * overrides deep still arrives here as the value on screen.
 */
export function valuesIn(
  styles: Readonly<Record<string, string>>,
  tokens: readonly Known[],
): Values {
  const mine = readMine(tokens);
  const using: Using[] = [];
  const adrift: Adrift[] = [];

  for (const seen of styleFacts(styles)) {
    if (using.length + adrift.length >= MOST_VALUES * 2) break;

    const exact = mine.find((one) => one.known.value.trim() === seen.value);
    if (exact !== undefined) {
      const yours = saidAs(exact.known, exact.colour);
      using.push({
        what: seen.what,
        name: exact.known.name,
        value: exact.known.value,
        says: usingSays(seen.what, yours),
      });
      continue;
    }

    const colour = readColour(seen.value);
    if (colour !== null) {
      if (leaveAlone(colour)) continue;
      const near = nearestColour(colour, mine);
      if (near === null) continue;
      if (sameColour(colour, near.one.colour as Rgb)) {
        using.push({
          what: seen.what,
          name: near.one.known.name,
          value: near.one.known.value,
          says: usingSays(seen.what, saidAs(near.one.known, near.one.colour)),
        });
        continue;
      }
      if (near.distance > NEAR_COLOUR) continue;
      const confidence = confidenceOf(near.distance, NEAR_COLOUR);
      adrift.push({
        what: seen.what,
        wrote: seen.value,
        mine: { name: near.one.known.name, value: near.one.known.value },
        confidence,
        says: saysDrift({
          kind: 'colour',
          confidence,
          yours: nameFor(near.one.known, near.one.colour),
        }),
        detail: `${seen.property}: ${seen.value} · yours is ${near.one.known.value}`,
      });
      continue;
    }

    const length = readLength(seen.value);
    if (length === null || leaveLengthAlone(length)) continue;
    const near = nearestLength(length, mine);
    if (near === null) continue;
    if (near.distance === 0) {
      using.push({
        what: seen.what,
        name: near.one.known.name,
        value: near.one.known.value,
        says: usingSays(seen.what, saidAs(near.one.known, null)),
      });
      continue;
    }
    if (near.distance > NEAR_LENGTH) continue;
    const confidence = confidenceOf(near.distance, NEAR_LENGTH);
    adrift.push({
      what: seen.what,
      wrote: seen.value,
      mine: { name: near.one.known.name, value: near.one.known.value },
      confidence,
      says: saysDrift({ kind: 'length', confidence, yours: nameFor(near.one.known, null) }),
      detail: `${seen.property}: ${seen.value} · yours is ${near.one.known.value}`,
    });
  }

  return { using: using.slice(0, MOST_VALUES), adrift: adrift.slice(0, MOST_VALUES) };
}

/* -------------------------------------------------------------------------- */
/* The other widths                                                            */
/* -------------------------------------------------------------------------- */

function listOf(names: readonly string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1] ?? ''}`;
}

/** The sizes to look at it in, with the one being looked at now marked. */
export function widthsFor(material: Material, pointed: Pointed): Widths {
  const sizes = material.widths ?? WIDTHS;
  const seen = pointed.view?.width;

  // The closest size rather than an exact match: nobody has their window at
  // precisely 1440, and the picture at the nearest one is the same picture.
  let closest: string | null = null;
  if (seen !== undefined && Number.isFinite(seen)) {
    let apartBy = Infinity;
    for (const size of sizes) {
      const distance = Math.abs(size.width - seen);
      if (distance < apartBy) {
        apartBy = distance;
        closest = size.id;
      }
    }
  }

  const all = sizes.map((size) => ({ ...size, here: size.id === closest }));
  const others = all.filter((size) => !size.here).map((size) => size.name);
  const here = all.find((size) => size.here);

  if (here === undefined) {
    return { all, says: `Here it is on ${listOf(others)}.` };
  }
  return {
    all,
    says: `You are looking at this on ${here.name}. Here it is on ${listOf(others)}.`,
  };
}

/* -------------------------------------------------------------------------- */
/* When it last changed                                                        */
/* -------------------------------------------------------------------------- */

function changedFrom(made: Made, material: Material, unsure: string[]): Changed | null {
  const file = made.where?.file;
  if (file === undefined) return null;

  const change = material.changes?.get(file);
  if (change === undefined) {
    unsure.push('I could not work out when this last changed.');
    return null;
  }

  const when = agoInSentence(change.when, material.now ?? Date.now());
  const found: Changed = {
    name: change.name,
    when: change.when,
    says: `Last changed ${when}, in "${change.name}".`,
  };
  if (change.id !== undefined) found.id = change.id;
  return found;
}

/* -------------------------------------------------------------------------- */
/* The whole card                                                              */
/* -------------------------------------------------------------------------- */

/**
 * One click, read.
 *
 * Nothing here throws and nothing comes back empty: a page that answered none
 * of the six rungs still gets a title, a thing to go looking for, the widths to
 * see it at, and a plain list of what could not be worked out. Degrading is the
 * feature, not the error path.
 */
export function read(pointed: Pointed, material: Material = {}): Reading {
  const unsure: string[] = [];
  const made = madeFrom(pointed, material, unsure);
  const styles = pointed.source?.styles;

  let using: readonly Using[] = [];
  let adrift: readonly Adrift[] = [];
  if (styles === undefined) {
    unsure.push('This came from a pass of the cursor rather than a click, so it has no values yet.');
  } else {
    const tokens = tokensFor(material, pointed);
    if (tokens.length === 0) {
      unsure.push('I could not find any of your own values to compare this against.');
    } else {
      const found = valuesIn(styles, tokens);
      using = found.using;
      adrift = found.adrift;
    }
  }

  return {
    title: describePointed(pointed),
    made,
    using,
    adrift,
    changed: changedFrom(made, material, unsure),
    widths: widthsFor(material, pointed),
    unsure,
  };
}

/* -------------------------------------------------------------------------- */
/* Saying it                                                                   */
/* -------------------------------------------------------------------------- */

/** The one line above the values. */
export function saysValues(reading: Reading): string {
  const { using, adrift } = reading;
  if (using.length === 0 && adrift.length === 0) {
    return 'Nothing here matches one of your own values.';
  }
  if (adrift.length === 0) return 'Everything here uses your own values.';
  if (using.length === 0) return 'None of this is quite one of your own values.';
  return adrift.length === 1
    ? 'One value here is not quite yours.'
    : `${adrift.length} values here are not quite yours.`;
}

/**
 * The reading as something to hand a model.
 *
 * The card is for a person; this is the same reading written out for the agent
 * that gets asked to change it, so a message about "this button" arrives with
 * the file, the component and the values already attached.
 */
export function saysReading(reading: Reading): string {
  const lines: string[] = [reading.title, reading.made.says];

  if (reading.made.reach !== undefined) {
    lines.push(`Used ${reading.made.reach.charAt(0).toLowerCase()}${reading.made.reach.slice(1)}`);
  }
  if (reading.made.alsoIn !== undefined) {
    lines.push(`Also used in ${listOf([...reading.made.alsoIn])}.`);
  }
  if (reading.made.screens !== undefined) {
    lines.push(`Appears on ${listOf([...reading.made.screens])}.`);
  }
  if (reading.changed !== null) lines.push(reading.changed.says);
  for (const one of reading.using) lines.push(one.says);
  for (const one of reading.adrift) lines.push(`${one.says} (${one.detail})`);
  for (const one of reading.unsure) lines.push(one);

  return lines.join('\n');
}
