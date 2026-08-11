/** Which of a project's own colours are worth reading against each other.
 *
 * Pure. It reads names and lightness, never a page, so what comes out is a
 * guess — and the whole design of this module is about when not to make one. A
 * project that has said in its own vocabulary which colours are text and which
 * are surfaces gets those pairings; one that has not gets none. A confident
 * finding about a problem nobody has costs more than a missed one.
 */

import { readable } from './grouping';
import { contrast, lightness, readColour, type Spot, type Tone } from './legibility';

/** A colour with the project's own name on it. */
export type Named = { name: string; value: string };

/** One pairing worth checking, and the two colours behind it — a fix has to
 *  know which of them to move, and the spot on its own cannot say. */
export type Pairing = {
  spot: Spot;
  front: Named;
  back: Named;
};

/* -------------------------------------------------------------------- words */

function wordsIn(name: string): readonly string[] {
  return name
    .replace(/^--/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word !== '');
}

/** Names that say "this is written on something". */
const TEXT_WORDS: ReadonlySet<string> = new Set(['text', 'fg', 'foreground', 'ink']);

/** Names that say "this is what things are written on". */
const SURFACE_WORDS: ReadonlySet<string> = new Set([
  'bg',
  'background',
  'surface',
  'sunken',
  'card',
  'panel',
  'paper',
  'canvas',
]);

/** Neither, ever. A hairline or a shadow is nobody's text, and a disabled
 *  colour is pale on purpose — flagging it is noise about a decision. */
const NEITHER: ReadonlySet<string> = new Set([
  'border',
  'divider',
  'edge',
  'line',
  'outline',
  'ring',
  'rule',
  'stroke',
  'shadow',
  'glow',
  'overlay',
  'scrim',
  'focus',
  'selection',
  'gradient',
  'disabled',
]);

/** Colours a design system fills things with. They are real colours with no
 *  role in a name, so they are kept out of the guess lightness alone makes. */
const FILLS: ReadonlySet<string> = new Set([
  'brand',
  'accent',
  'primary',
  'success',
  'warning',
  'danger',
  'error',
  'info',
  'positive',
  'negative',
]);

/**
 * The words allowed out of a name and into a sentence.
 *
 * Nothing outside this list ever leaves a token name for the screen, which is
 * what keeps `where` a description and stops it becoming a variable read aloud.
 * The generic role words are absent on purpose: "the background" already says
 * `bg`, and "Bg text" says nothing.
 */
const SAID: Readonly<Record<string, string>> = {
  muted: 'muted',
  faint: 'faint',
  subtle: 'subtle',
  soft: 'soft',
  dim: 'dim',
  quiet: 'quiet',
  secondary: 'secondary',
  strong: 'strong',
  inverse: 'inverted',
  inverted: 'inverted',
  placeholder: 'placeholder',
  heading: 'heading',
  body: 'body',
  link: 'link',
  card: 'card',
  panel: 'panel',
  sunken: 'sunken',
  raised: 'raised',
  paper: 'paper',
  canvas: 'canvas',
};

type Role = 'text' | 'surface';

/**
 * What a name says this colour is for, or null when it says nothing.
 *
 * Text beats surface, because `--card-foreground` is text on a card and there
 * is no name that means the reverse. A fill beats both: `--accent-text` is the
 * white that goes on a button, and reading it against the page would find it
 * unreadable on a background it is never on.
 *
 * "Muted" and "faint" are missing from both lists deliberately: half the
 * systems in the world call a pale grey background muted, so on its own the
 * word describes how loud a colour is and not what it is for. It still chooses
 * the wording, once something else has settled a role.
 */
function roleOf(name: string): Role | null {
  if (isNeither(name) || isFill(name)) return null;
  const words = wordsIn(name);
  if (words.some((word) => TEXT_WORDS.has(word))) return 'text';
  if (words.some((word) => SURFACE_WORDS.has(word))) return 'surface';
  return null;
}

function isNeither(name: string): boolean {
  return wordsIn(name).some((word) => NEITHER.has(word));
}

function isFill(name: string): boolean {
  return wordsIn(name).some((word) => FILLS.has(word));
}

/** The one word of a name worth saying, if it has one. */
function qualifier(name: string): string | null {
  for (const word of wordsIn(name)) {
    const said = SAID[word];
    if (said !== undefined) return said;
  }
  return null;
}

function capital(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/** The pairing as a designer would point at it. Built out of the two names, but
 *  never out of their letters. */
function whereFor(front: Named, back: Named): string {
  const above = qualifier(front.name);
  const below = qualifier(back.name);
  return `${above === null ? 'The text' : `${capital(above)} text`} on ${
    below === null ? 'the background' : `the ${below} background`
  }`;
}

/* ------------------------------------------------------------------ colours */

type Level = { one: Named; level: number };

function levelsOf(colours: readonly Named[]): readonly Level[] {
  return colours
    .map((one) => ({ one, level: lightness(one.value) }))
    .filter((found) => Number.isFinite(found.level));
}

/** Two and a half tones of a normal ramp. Nearer than this and a colour is
 *  another shade of the surface rather than something written on it. */
const A_GAP = 20;

/**
 * The other half of the pairing, when only one half was named.
 *
 * Lightness is the only evidence left, so it is asked for a lot: a colour has
 * to sit clear of every colour on the named side before it is taken for the
 * opposite one. Anything nearer is a second surface, or a border somebody
 * forgot to call a border.
 */
function byLightness(spare: readonly Named[], named: readonly Named[]): readonly Named[] {
  const anchors = levelsOf(named);
  if (anchors.length === 0) return [];
  return levelsOf(spare)
    .filter((found) => anchors.every((anchor) => Math.abs(found.level - anchor.level) >= A_GAP))
    .map((found) => found.one);
}

function sameColour(one: string, other: string): boolean {
  const here = readColour(one);
  const there = readColour(other);
  if (here === null || there === null) return false;
  return (
    Math.round(here.r) === Math.round(there.r) &&
    Math.round(here.g) === Math.round(there.g) &&
    Math.round(here.b) === Math.round(there.b) &&
    Math.round((here.a ?? 1) * 255) === Math.round((there.a ?? 1) * 255)
  );
}

/**
 * One name, once — the first time the file said it.
 *
 * A stylesheet that carries a light and a dark set writes every name twice, and
 * the light text read against the dark page is a fault in neither of them. The
 * first block is what the project looks like unless something says otherwise,
 * so it is the one set that can safely be read against itself.
 */
function firstOfEachName(colours: readonly Named[]): readonly Named[] {
  const seen = new Set<string>();
  return colours.filter((one) => {
    const name = one.name.toLowerCase();
    if (seen.has(name)) return false;
    seen.add(name);
    return true;
  });
}

/** One colour twice under two names is one colour. */
function distinct(colours: readonly Named[]): readonly Named[] {
  const kept: Named[] = [];
  for (const one of colours) {
    if (!kept.some((other) => sameColour(one.value, other.value))) kept.push(one);
  }
  return kept;
}

/* -------------------------------------------------------------------- pairs */

/** Enough of each side to cover a palette, few enough that the list under them
 *  stays a list. Their product is the most pairings there can ever be. */
const MOST_TEXT = 4;
const MOST_SURFACES = 3;

/**
 * Every pairing of this project's colours worth reading, in its own words.
 *
 * Both sides come from the names where the names say anything. Where only one
 * does, lightness fills the other and is made to work for it. Where neither
 * does, this is empty — there is nothing here to be right about.
 */
export function pairsToCheck(tokens: readonly Named[]): readonly Pairing[] {
  const colours = firstOfEachName(tokens.filter((one) => readColour(one.value) !== null));

  const named = new Map<Named, Role | null>(colours.map((one) => [one, roleOf(one.name)]));
  const texts = colours.filter((one) => named.get(one) === 'text');
  const surfaces = colours.filter((one) => named.get(one) === 'surface');
  if (texts.length === 0 && surfaces.length === 0) return [];

  const spare = colours.filter(
    (one) => named.get(one) === null && !isNeither(one.name) && !isFill(one.name),
  );
  const fronts = distinct(texts.length > 0 ? texts : byLightness(spare, surfaces)).slice(
    0,
    MOST_TEXT,
  );
  const backs = distinct(surfaces.length > 0 ? surfaces : byLightness(spare, texts)).slice(
    0,
    MOST_SURFACES,
  );

  const pairs: Pairing[] = [];
  for (const front of fronts) {
    for (const back of backs) {
      if (front.name === back.name || sameColour(front.value, back.value)) continue;
      pairs.push({
        spot: {
          id: `${front.name} on ${back.name}`,
          where: whereFor(front, back),
          front: front.value,
          back: back.value,
        },
        front,
        back,
      });
    }
  }
  return worstOfEach(pairs);
}

/**
 * One pairing per sentence, and the hardest to read of them.
 *
 * Names run out before pairings do — a project with `--text-1` and `--text-2`
 * has one way of saying both, and two identical rows is a panel arguing with
 * itself. Keeping the worst of a group loses nothing: anything it outranks
 * reads better than it does, so a group whose worst is comfortable is a group
 * with nothing in it to report.
 */
function worstOfEach(pairs: readonly Pairing[]): readonly Pairing[] {
  const best = new Map<string, Pairing>();
  for (const pair of pairs) {
    const already = best.get(pair.spot.where);
    if (
      already === undefined ||
      contrast(pair.spot.front, pair.spot.back) < contrast(already.spot.front, already.spot.back)
    ) {
      best.set(pair.spot.where, pair);
    }
  }
  return [...best.values()];
}

/** The project's own colours, so a repair can be offered out of them rather
 *  than invented. Named as somebody would say them, because the name is shown. */
export function paletteFrom(tokens: readonly Named[]): readonly Tone[] {
  return tokens
    .filter((one) => readColour(one.value) !== null)
    .map((one) => ({ name: readable(one.name), value: one.value }));
}
