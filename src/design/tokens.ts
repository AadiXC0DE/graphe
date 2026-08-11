/** The values a slider can change on its own: colour, spacing, size, radius.
 *
 * Pure text in, pure text out. Nothing here reads a disk, runs a model or saves
 * a version — it finds the custom properties a project declares, replaces one
 * value without disturbing a byte around it, and collapses a drag into the one
 * change it actually made.
 */

export type TokenKind = 'colour' | 'space' | 'size' | 'radius' | 'shadow' | 'other';

export type Token = {
  /** As declared, including the leading dashes: `--space-4`. */
  name: string;
  value: string;
  kind: TokenKind;
  /** 1-based, so a writer can find the declaration again. */
  line: number;
};

/** One change to one token. A drag produces hundreds of these. */
export type Nudge = { name: string; from: string; to: string };

/* ------------------------------------------------------------------ parsing */

type Declaration = {
  name: string;
  value: string;
  line: number;
  /** Offsets into the original css, bounding the value alone. */
  valueStart: number;
  valueEnd: number;
};

/** Comments and string bodies blanked out, offsets and newlines preserved, so
 *  the scanner below cannot be fooled by a brace or a `--fake: red;` inside
 *  either one. Values are always sliced from the original text. */
function mask(css: string): string {
  const out = css.split('');
  let i = 0;
  while (i < css.length) {
    const ch = css[i];
    if (ch === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      const stop = end === -1 ? css.length : end + 2;
      for (let j = i; j < stop; j += 1) if (out[j] !== '\n') out[j] = ' ';
      i = stop;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < css.length && css[j] !== ch && css[j] !== '\n') {
        j += css[j] === '\\' ? 2 : 1;
      }
      for (let k = i + 1; k < j && k < css.length; k += 1) if (out[k] !== '\n') out[k] = 'x';
      i = css[j] === ch ? j + 1 : j;
      continue;
    }
    i += 1;
  }
  return out.join('');
}

function newlinesIn(css: string): number[] {
  const at: number[] = [];
  for (let i = 0; i < css.length; i += 1) if (css[i] === '\n') at.push(i);
  return at;
}

function lineOf(newlines: readonly number[], index: number): number {
  let low = 0;
  let high = newlines.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    const at = newlines[mid];
    if (at !== undefined && at < index) low = mid + 1;
    else high = mid;
  }
  return low + 1;
}

/** `:root`, `:root[data-theme='dark']`, and lists containing one of those.
 *  `:root .card` is a rule about the page, not a place tokens are declared. */
const ROOT_SELECTOR = /^:root(\[[^\]]*\])*$/i;

function isRoot(selector: string): boolean {
  return selector.split(',').some((part) => ROOT_SELECTOR.test(part.trim()));
}

const NAME = /^--[^\s:]+$/;

/** Every custom property declared in a root block, in document order. Survives
 *  nesting, media queries, multi-line values and semicolons inside `var()`. */
function declarations(css: string): Declaration[] {
  const masked = mask(css);
  const newlines = newlinesIn(css);
  const blocks: string[] = [];
  const found: Declaration[] = [];
  let chunkStart = 0;
  let parens = 0;

  const take = (end: number): void => {
    const inside = blocks[blocks.length - 1];
    if (inside === undefined || !isRoot(inside)) return;

    const chunk = masked.slice(chunkStart, end);
    const start = chunkStart + (chunk.length - chunk.trimStart().length);
    if (start >= end) return;

    const colon = masked.indexOf(':', start);
    if (colon === -1 || colon >= end) return;
    const name = masked.slice(start, colon).trim();
    if (!NAME.test(name)) return;

    let valueStart = colon + 1;
    while (valueStart < end && /\s/.test(masked[valueStart] ?? '')) valueStart += 1;
    let valueEnd = end;
    while (valueEnd > valueStart && /\s/.test(masked[valueEnd - 1] ?? '')) valueEnd -= 1;
    if (valueEnd <= valueStart) return;

    found.push({
      name,
      value: css.slice(valueStart, valueEnd),
      line: lineOf(newlines, start),
      valueStart,
      valueEnd,
    });
  };

  for (let i = 0; i < masked.length; i += 1) {
    const ch = masked[i];
    if (ch === '(') parens += 1;
    else if (ch === ')') parens = Math.max(0, parens - 1);
    else if (parens > 0) continue;
    else if (ch === '{') {
      blocks.push(masked.slice(chunkStart, i).trim());
      chunkStart = i + 1;
    } else if (ch === '}') {
      take(i);
      blocks.pop();
      chunkStart = i + 1;
    } else if (ch === ';') {
      take(i);
      chunkStart = i + 1;
    }
  }
  return found;
}

/* ----------------------------------------------------------- classification */

const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const COLOUR_FUNCTION =
  /^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark)\s*\(/i;
const NAMED_COLOURS = new Set([
  'transparent',
  'currentcolor',
  'black',
  'white',
  'red',
  'green',
  'blue',
  'yellow',
  'orange',
  'purple',
  'pink',
  'brown',
  'grey',
  'gray',
  'silver',
  'gold',
  'beige',
  'ivory',
  'navy',
  'teal',
  'olive',
  'maroon',
  'lime',
  'aqua',
  'cyan',
  'magenta',
  'fuchsia',
  'coral',
  'salmon',
  'khaki',
  'crimson',
  'indigo',
  'violet',
  'turquoise',
  'lavender',
  'plum',
  'tan',
  'wheat',
  'linen',
  'snow',
  'azure',
  'mintcream',
  'seashell',
  'whitesmoke',
  'gainsboro',
  'lightgrey',
  'lightgray',
  'darkgrey',
  'darkgray',
  'slategrey',
  'slategray',
  'rebeccapurple',
]);

const LENGTH = /^-?(?:\d+\.?\d*|\.\d+)(px|rem|em|%|ch|ex|vw|vh|vmin|vmax|pt|pc|cm|mm|in)$/i;
const NUMBER = /^(-?(?:\d+\.?\d*|\.\d+))([a-z%]*)$/i;
const VAR_REFERENCE = /^var\(\s*(--[^\s,)]+)/;

const RADIUS_WORDS = new Set(['radius', 'radii', 'rounding', 'corner', 'corners', 'round']);
const SPACE_WORDS = new Set([
  'space',
  'spacing',
  'gap',
  'gutter',
  'pad',
  'padding',
  'margin',
  'inset',
  'indent',
  'stack',
  'step',
]);
const SIZE_WORDS = new Set([
  'size',
  'sizes',
  'text',
  'font',
  'type',
  'leading',
  'width',
  'height',
  'measure',
  'icon',
  'avatar',
  'thumb',
  'track',
  'rail',
  'bar',
  'line',
]);
const SHADOW_WORDS = new Set(['shadow', 'shadows', 'elevation', 'glow']);
const TEXT_WORDS = new Set(['text', 'font', 'type', 'leading', 'copy', 'body', 'heading']);

function wordsIn(name: string): string[] {
  return name
    .replace(/^--/, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0);
}

function mentions(name: string, words: ReadonlySet<string>): boolean {
  return wordsIn(name).some((word) => words.has(word));
}

/** Follows `var(--other)` to whatever it points at, so a token that borrows a
 *  colour is classified as a colour rather than as prose. */
function resolve(value: string, lookup: ReadonlyMap<string, string>): string {
  let current = value.trim();
  const seen = new Set<string>();
  for (let hop = 0; hop < 8; hop += 1) {
    const reference = VAR_REFERENCE.exec(current)?.[1];
    if (!reference || seen.has(reference)) return current;
    seen.add(reference);
    const next = lookup.get(reference);
    if (next === undefined) return current;
    current = next.trim();
  }
  return current;
}

function isColour(value: string): boolean {
  const flat = value.trim();
  return HEX.test(flat) || COLOUR_FUNCTION.test(flat) || NAMED_COLOURS.has(flat.toLowerCase());
}

/** Two or more lengths followed by a colour, which is what a shadow is. */
function looksLikeShadow(value: string): boolean {
  const flat = value.trim();
  const lengths = flat.match(/-?(?:\d+\.?\d*|\.\d+)(?:px|rem|em)\b/g) ?? [];
  return lengths.length >= 2 && /(#|rgba?\(|hsla?\(|color-mix\(|currentcolor)/i.test(flat);
}

function classify(name: string, value: string, lookup?: ReadonlyMap<string, string>): TokenKind {
  const resolved = lookup ? resolve(value, lookup) : value.trim();
  if (mentions(name, SHADOW_WORDS) || looksLikeShadow(resolved)) return 'shadow';
  if (isColour(resolved)) return 'colour';
  if (LENGTH.test(resolved) || resolved === '0') {
    if (mentions(name, RADIUS_WORDS)) return 'radius';
    if (mentions(name, SPACE_WORDS)) return 'space';
    if (mentions(name, SIZE_WORDS)) return 'size';
  }
  return 'other';
}

/* ------------------------------------------------------------------ reading */

/** Every token a project declares on `:root`, including the ones repeated in a
 *  theme block — a writer needs to know those exist to leave them alone. */
export function readTokens(css: string): readonly Token[] {
  const found = declarations(css);
  const lookup = new Map<string, string>();
  for (const declaration of found) {
    if (!lookup.has(declaration.name)) lookup.set(declaration.name, declaration.value);
  }
  return found.map((declaration) => ({
    name: declaration.name,
    value: declaration.value,
    kind: classify(declaration.name, declaration.value, lookup),
    line: declaration.line,
  }));
}

/* ------------------------------------------------------------------ writing */

function fullName(name: string): string {
  const trimmed = name.trim();
  return trimmed.startsWith('--') ? trimmed : `--${trimmed}`;
}

/** Replace one token's value in place. The first declaration wins, which is the
 *  one on `:root`; the same name inside a theme block belongs to that theme and
 *  is left alone. Unknown token, unchanged file. */
export function writeToken(css: string, name: string, value: string): string {
  const wanted = fullName(name);
  const target = declarations(css).find((declaration) => declaration.name === wanted);
  if (!target) return css;
  return css.slice(0, target.valueStart) + value + css.slice(target.valueEnd);
}

/* -------------------------------------------------------------------- steps */

type Measure = { amount: number; unit: string };

function measure(value: string): Measure | null {
  const match = NUMBER.exec(value.trim());
  const amount = match?.[1];
  if (amount === undefined) return null;
  const parsed = Number(amount);
  return Number.isFinite(parsed) ? { amount: parsed, unit: match?.[2] ?? '' } : null;
}

function say(amount: number, unit: string): string {
  return `${Math.round(amount * 10000) / 10000}${unit}`;
}

/** Where a slider should snap when the project has no scale of its own. */
const RAMPS: Readonly<Record<string, readonly number[]>> = {
  'space:px': [0, 2, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96],
  'radius:px': [0, 2, 4, 6, 8, 10, 12, 16, 20, 24, 32],
  'size:px': [10, 11, 12, 13, 14, 16, 18, 20, 24, 28, 32, 40, 48, 64],
  rem: [0.625, 0.75, 0.875, 1, 1.125, 1.25, 1.5, 2, 2.5, 3],
  '%': [0, 10, 25, 33, 50, 66, 75, 90, 100],
};

/** Enough same-kind values to be a decision somebody made rather than a coincidence. */
const A_SCALE = 3;

function ramp(kind: TokenKind, here: Measure): number[] {
  const unit = here.unit.toLowerCase();
  if (unit === 'rem' || unit === 'em') return [...(RAMPS['rem'] ?? [])];
  if (unit === '%') return [...(RAMPS['%'] ?? [])];
  if (unit === 'px' || unit === '') {
    return [...(RAMPS[`${kind}:px`] ?? RAMPS['space:px'] ?? [])];
  }
  // An unfamiliar unit still gets a slider, just one measured from where it is.
  if (here.amount === 0) return [];
  return [0.5, 0.75, 1, 1.25, 1.5, 2].map((factor) => here.amount * factor);
}

/**
 * The values a slider should snap to for a numeric token.
 *
 * Pass the rest of the file's tokens and a project that thinks in 4/8/12/16
 * snaps to its own scale rather than to our idea of a nice number. Empty for
 * anything a slider cannot move, such as a colour or a font stack.
 */
export function steps(token: Token, family: readonly Token[] = []): readonly string[] {
  const here = measure(token.value);
  if (!here) return [];

  const scale: number[] = [];
  for (const other of family) {
    if (other.kind !== token.kind || other.name === token.name) continue;
    const size = measure(other.value);
    if (size && size.unit.toLowerCase() === here.unit.toLowerCase()) scale.push(size.amount);
  }

  const values = new Set(scale.length >= A_SCALE ? scale : ramp(token.kind, here));
  values.add(here.amount);
  return [...values].sort((a, b) => a - b).map((amount) => say(amount, here.unit));
}

/* ------------------------------------------------------------------ settling */

/**
 * A burst of edits collapsed to the net change per token, in the order each
 * token was first touched. Three seconds of dragging is one change, and a
 * value dragged back to where it started is no change at all.
 */
export function settle(nudges: readonly Nudge[]): readonly Nudge[] {
  const order: string[] = [];
  const net = new Map<string, Nudge>();

  for (const nudge of nudges) {
    const key = fullName(nudge.name);
    const running = net.get(key);
    if (running) net.set(key, { ...running, to: nudge.to });
    else {
      order.push(key);
      net.set(key, { name: nudge.name, from: nudge.from, to: nudge.to });
    }
  }

  const settled: Nudge[] = [];
  for (const key of order) {
    const nudge = net.get(key);
    if (nudge && nudge.from.trim() !== nudge.to.trim()) settled.push(nudge);
  }
  return settled;
}

/* ------------------------------------------------------------------- saying */

function direction(nudge: Nudge): 'up' | 'down' | null {
  const from = measure(nudge.from);
  const to = measure(nudge.to);
  if (!from || !to || from.unit.toLowerCase() !== to.unit.toLowerCase()) return null;
  if (to.amount === from.amount) return null;
  return to.amount > from.amount ? 'up' : 'down';
}

/** The version title for a settled burst. One clause, past tense, and about the
 *  design rather than about the file it lives in. */
export function saysNudge(nudges: readonly Nudge[]): string {
  const settled = settle(nudges);
  if (settled.length === 0) return 'Adjusted the styling';

  const kinds = new Set(settled.map((nudge) => classify(nudge.name, nudge.to)));
  const kind = kinds.size === 1 ? ([...kinds][0] ?? null) : null;
  const only = settled.length === 1 ? settled[0] : undefined;
  const way = only ? direction(only) : null;

  switch (kind) {
    case 'colour':
      return only ? 'Changed a colour' : 'Changed a few colours';
    case 'space':
      if (way === 'up') return 'Loosened the spacing';
      if (way === 'down') return 'Tightened the spacing';
      return 'Adjusted the spacing';
    case 'radius':
      if (way === 'up') return 'Rounded the corners a little more';
      if (way === 'down') return 'Rounded the corners a little less';
      return 'Adjusted the corner rounding';
    case 'size': {
      const text = settled.every((nudge) => mentions(nudge.name, TEXT_WORDS));
      if (!text) return 'Adjusted the sizing';
      if (way === 'up') return 'Made the text a little bigger';
      if (way === 'down') return 'Made the text a little smaller';
      return 'Adjusted the text size';
    }
    case 'shadow':
      return only ? 'Adjusted the shadow' : 'Adjusted the shadows';
    default:
      return 'Adjusted the styling';
  }
}
