/** A project's own values, read out of its stylesheets.
 *
 * Pure text in, values out. Nothing here reads a disk, runs a model or changes
 * a byte — it finds the custom properties a project declares in a `:root`
 * block, says what kind of thing each one is and where it is written, and
 * counts how many places reach for it.
 */

export type TokenKind = 'colour' | 'space' | 'size' | 'radius' | 'shadow' | 'other';

export type Token = {
  /** As declared, including the leading dashes: `--space-4`. */
  name: string;
  value: string;
  kind: TokenKind;
  /** 1-based, so a reader can point at the declaration. */
  line: number;
};

/* ------------------------------------------------------------------ parsing */

type Declaration = {
  name: string;
  value: string;
  line: number;
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

/** Tailwind 4 declares the same values in `@theme { … }`, with `inline` or
 *  `static` after the word to change how the framework emits them. A project
 *  written that way keeps its tokens there and nowhere else. */
const THEME_AT_RULE = /^@theme(?:\s+[a-z][a-z-]*)*$/i;

function isRoot(selector: string): boolean {
  return selector
    .split(',')
    .some((part) => ROOT_SELECTOR.test(part.trim()) || THEME_AT_RULE.test(part.trim()));
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

/** Every token a project declares in a root block, including the ones repeated
 *  per theme, so a reader can see all of them. */
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

const VAR_USE = /var\(\s*(--[A-Za-z0-9_-]+)/g;

/** How many times each name is reached for with `var()`, across every sheet a
 *  project keeps. Counted over the masked text, so a `var()` in a comment or a
 *  string is not a use of anything. */
export function usesIn(sheets: readonly string[]): ReadonlyMap<string, number> {
  const found = new Map<string, number>();
  for (const sheet of sheets) {
    for (const match of mask(sheet).matchAll(VAR_USE)) {
      const name = match[1];
      if (name === undefined) continue;
      found.set(name, (found.get(name) ?? 0) + 1);
    }
  }
  return found;
}
