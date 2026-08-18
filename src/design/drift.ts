/** Values written straight into a file that are nearly, but not exactly, one the project already has.
 *
 * Pure. No React, no I/O, no clock — it is handed a file's text and the values
 * the project owns, and hands back findings.
 *
 * Colours are compared in OKLab rather than by distance in RGB: two pairs the
 * same distance apart in RGB can be one indistinguishable pair and one obvious
 * one, and only the perceptual space tells them apart.
 *
 * Two surfaces, as elsewhere: `says` is the sentence a designer reads and it
 * never carries a value; `detail` is the same finding as exact values, for the
 * person who has turned "Show me" on.
 */

export type Rgb = { r: number; g: number; b: number; a: number };
export type Oklab = { L: number; a: number; b: number };
export type Oklch = { L: number; C: number; h: number };

/** One value the project owns. `StyleToken` fits this shape as it stands. */
export type Known = {
  /** The project's own name for it, `--brand-blue` and all. */
  name: string;
  value: string;
  /** Worked out from the value when it is not given. */
  kind?: 'colour' | 'space' | 'size' | 'radius' | 'shadow' | 'other' | 'length';
};

export type Confidence = 'sure' | 'likely' | 'maybe';

export type Finding = {
  /** Stable for a position in a file, so a list can re-render without churn. */
  id: string;
  kind: 'colour' | 'length';
  /** Exactly as the file writes it. */
  wrote: string;
  /** The project's own value it was probably meant to be. */
  mine: { name: string; value: string };
  /** What belongs there instead — the project's name for it where it has one. */
  use: string;
  /** 1-based, as an editor counts. */
  line: number;
  column: number;
  /** OKLab distance for a colour; the share it is off by for a length. */
  distance: number;
  confidence: Confidence;
  says: string;
  /** Exact values. Never reaches a sentence. */
  detail: string;
};

export type DriftOptions = {
  /** How far apart in OKLab two colours can be and still be a near-miss. */
  nearColour?: number;
  /** How far off a size can be, as a share of the project's own. */
  nearLength?: number;
  most?: number;
};

/* -------------------------------------------------------------------------- */
/* Thresholds                                                                  */
/* -------------------------------------------------------------------------- */

/** Above this the difference is a decision, not a slip. In OKLab a stock
 *  blue-500 sits 0.082 from a brand blue-600 — inside — while the step either
 *  side of it is past 0.10 and blue against red is 0.35. */
export const NEAR_COLOUR = 0.09;

/** A tenth off a size is a mistyped size; a fifth off is a different size. */
export const NEAR_LENGTH = 0.1;

/** Hairlines and zero are not on anybody's scale. */
const SMALLEST_LENGTH = 2;

/** Long enough for a real file, short enough that a generated one cannot turn
 *  the panel into a scroll. */
export const MOST_FINDINGS = 50;

const ROOT_PX = 16;

/* -------------------------------------------------------------------------- */
/* Reading a colour                                                            */
/* -------------------------------------------------------------------------- */

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

const HEX = /^#([0-9a-f]+)$/i;
const CALL = /^(rgba?|hsla?)\(([^()]*)\)$/i;
const PLAIN = /^([-+]?(?:\d+\.?\d*|\.\d+))(%?)$/;
const ANGLE = /^([-+]?(?:\d+\.?\d*|\.\d+))(deg|rad|grad|turn)?$/i;

/** Only the three that decide whether something is flagged at all. Any other
 *  name reads as unparseable, which means it is left alone. */
const NAMED: Readonly<Record<string, Rgb>> = {
  transparent: { r: 0, g: 0, b: 0, a: 0 },
  black: { r: 0, g: 0, b: 0, a: 1 },
  white: { r: 255, g: 255, b: 255, a: 1 },
};

function partsOf(inside: string): string[] {
  return inside
    .trim()
    .split(/[\s,/]+/)
    .filter((part) => part !== '');
}

/** A channel written 0–255 or as a percentage. `none` is CSS for zero. */
function channel(part: string): number | null {
  if (part.toLowerCase() === 'none') return 0;
  const match = PLAIN.exec(part);
  if (match === null) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  return clamp(match[2] === '%' ? (amount / 100) * 255 : amount, 0, 255);
}

function share(part: string): number | null {
  if (part.toLowerCase() === 'none') return 0;
  const match = PLAIN.exec(part);
  if (match === null) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  return clamp(match[2] === '%' ? amount / 100 : amount, 0, 1);
}

function opacity(part: string | undefined): number | null {
  return part === undefined ? 1 : share(part);
}

function angle(part: string): number | null {
  if (part.toLowerCase() === 'none') return 0;
  const match = ANGLE.exec(part);
  if (match === null) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  const unit = (match[2] ?? 'deg').toLowerCase();
  const degrees =
    unit === 'turn'
      ? amount * 360
      : unit === 'rad'
        ? (amount * 180) / Math.PI
        : unit === 'grad'
          ? amount * 0.9
          : amount;
  return ((degrees % 360) + 360) % 360;
}

function fromHsl(h: number, s: number, l: number, a: number): Rgb {
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const stage = h / 60;
  const second = chroma * (1 - Math.abs((stage % 2) - 1));
  const base = l - chroma / 2;
  const trio: readonly [number, number, number] =
    stage < 1
      ? [chroma, second, 0]
      : stage < 2
        ? [second, chroma, 0]
        : stage < 3
          ? [0, chroma, second]
          : stage < 4
            ? [0, second, chroma]
            : stage < 5
              ? [second, 0, chroma]
              : [chroma, 0, second];
  return {
    r: Math.round((trio[0] + base) * 255),
    g: Math.round((trio[1] + base) * 255),
    b: Math.round((trio[2] + base) * 255),
    a,
  };
}

function fromHex(digits: string): Rgb | null {
  const twice = (pair: string) => parseInt(pair, 16);
  if (digits.length === 3 || digits.length === 4) {
    const wide = digits
      .split('')
      .map((one) => one + one)
      .join('');
    return fromHex(wide);
  }
  if (digits.length !== 6 && digits.length !== 8) return null;
  return {
    r: twice(digits.slice(0, 2)),
    g: twice(digits.slice(2, 4)),
    b: twice(digits.slice(4, 6)),
    a: digits.length === 8 ? twice(digits.slice(6, 8)) / 255 : 1,
  };
}

/**
 * A colour as it was written, in any of the ways CSS lets you write one.
 *
 * Hex in three, four, six or eight digits; `rgb()`/`rgba()` and `hsl()`/`hsla()`
 * with commas or with the modern spaces and slash. Anything else is null, which
 * everywhere downstream reads as "leave it alone".
 */
export function readColour(text: string): Rgb | null {
  const value = text.trim();
  if (value === '') return null;

  const named = NAMED[value.toLowerCase()];
  if (named !== undefined) return { ...named };

  const hex = HEX.exec(value);
  if (hex?.[1] !== undefined) return fromHex(hex[1]);

  const call = CALL.exec(value);
  const shape = call?.[1]?.toLowerCase();
  const inside = call?.[2];
  if (shape === undefined || inside === undefined) return null;

  const parts = partsOf(inside);
  if (parts.length < 3 || parts.length > 4) return null;
  const alpha = opacity(parts[3]);
  if (alpha === null) return null;

  if (shape === 'rgb' || shape === 'rgba') {
    const r = channel(parts[0] ?? '');
    const g = channel(parts[1] ?? '');
    const b = channel(parts[2] ?? '');
    if (r === null || g === null || b === null) return null;
    return { r: Math.round(r), g: Math.round(g), b: Math.round(b), a: alpha };
  }

  const h = angle(parts[0] ?? '');
  const s = share(parts[1] ?? '');
  const l = share(parts[2] ?? '');
  if (h === null || s === null || l === null) return null;
  return fromHsl(h, s, l, alpha);
}

export function hexOf(colour: Rgb): string {
  const two = (value: number) =>
    Math.round(clamp(value, 0, 255))
      .toString(16)
      .padStart(2, '0');
  const rgb = `#${two(colour.r)}${two(colour.g)}${two(colour.b)}`;
  return colour.a >= 1 ? rgb : `${rgb}${two(colour.a * 255)}`;
}

/* -------------------------------------------------------------------------- */
/* OKLab                                                                       */
/* -------------------------------------------------------------------------- */

/** sRGB carries a transfer curve; undoing it is the step a naive comparison
 *  skips, and it is why mid greys come out wrong without it. */
function linear(channelValue: number): number {
  const unit = clamp(channelValue, 0, 255) / 255;
  return unit <= 0.04045 ? unit / 12.92 : Math.pow((unit + 0.055) / 1.055, 2.4);
}

const CUBE = (value: number) => Math.cbrt(value);

/** Ottosson's OKLab: linear sRGB through the LMS cone response, cube-rooted,
 *  then into a space where equal steps look like equal steps. */
export function toOklab(colour: Rgb): Oklab {
  const r = linear(colour.r);
  const g = linear(colour.g);
  const b = linear(colour.b);

  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;

  const l_ = CUBE(l);
  const m_ = CUBE(m);
  const s_ = CUBE(s);

  return {
    L: 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  };
}

/** The same space in the shape a designer thinks in: lightness, how colourful,
 *  and which colour. */
export function toOklch(colour: Rgb): Oklch {
  const lab = toOklab(colour);
  const C = Math.sqrt(lab.a * lab.a + lab.b * lab.b);
  const h = ((((Math.atan2(lab.b, lab.a) * 180) / Math.PI) % 360) + 360) % 360;
  return { L: lab.L, C, h: C < 1e-6 ? 0 : h };
}

/** How far apart two colours look. Zero is the same colour; a hundredth is a
 *  difference you would have to be told about. */
export function apart(one: Rgb, other: Rgb): number {
  const a = toOklab(one);
  const b = toOklab(other);
  const dL = a.L - b.L;
  const da = a.a - b.a;
  const db = a.b - b.b;
  return Math.sqrt(dL * dL + da * da + db * db);
}

/* -------------------------------------------------------------------------- */
/* Reading a size                                                              */
/* -------------------------------------------------------------------------- */

export type Length = { amount: number; unit: string; px: number };

const SIZE = /^([-+]?(?:\d+\.?\d*|\.\d+))(px|rem|em)$/i;

/** A size in a unit that can be compared to another size. Percentages, `auto`
 *  and bare numbers are none of our business and come back null. */
export function readLength(text: string): Length | null {
  const match = SIZE.exec(text.trim());
  if (match?.[1] === undefined) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  const unit = (match[2] ?? 'px').toLowerCase();
  return { amount, unit, px: unit === 'px' ? amount : amount * ROOT_PX };
}

/* -------------------------------------------------------------------------- */
/* What is left alone                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Colours that are legitimately not on a palette.
 *
 * Black, white and anything see-through are the ones every project writes on
 * purpose. Translucency is left alone entirely: an overlay at six percent is a
 * decision, and comparing it to a solid brand colour would flag every one.
 */
export function leaveAlone(colour: Rgb): boolean {
  if (colour.a < 0.999) return true;
  const black = colour.r === 0 && colour.g === 0 && colour.b === 0;
  const white = colour.r === 255 && colour.g === 255 && colour.b === 255;
  return black || white;
}

/** Zero, hairlines and borders sit under every scale rather than on one. */
export function leaveLengthAlone(length: Length): boolean {
  return !(length.px >= SMALLEST_LENGTH);
}

/* -------------------------------------------------------------------------- */
/* The project's own values                                                    */
/* -------------------------------------------------------------------------- */

type Mine = { known: Known; colour: Rgb | null; length: Length | null };

function readKnown(known: Known): Mine {
  const wantsColour = known.kind === undefined || known.kind === 'colour';
  const wantsLength =
    known.kind === undefined ||
    known.kind === 'space' ||
    known.kind === 'size' ||
    known.kind === 'radius' ||
    known.kind === 'length';

  const colour = wantsColour ? readColour(known.value) : null;
  const length = wantsLength && colour === null ? readLength(known.value) : null;
  return { known, colour, length };
}

/* -------------------------------------------------------------------------- */
/* Words                                                                       */
/* -------------------------------------------------------------------------- */

/** Names that describe the file rather than the colour, and so say nothing out
 *  loud. `token` is also a word this app never puts on screen. */
const NOISE = new Set([
  'color',
  'colour',
  'colors',
  'colours',
  'clr',
  'token',
  'tokens',
  'var',
  'vars',
  'theme',
  'palette',
  'css',
  'ds',
]);

function wordsIn(name: string): string[] {
  return name
    .replace(/^--/, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((word) => word.length > 0);
}

/** Bands in OKLCh degrees, checked against where the obvious colours actually
 *  land: pure red at 29, a stock orange at 48, green at 150, blue at 260. */
const HUES: readonly { upTo: number; word: string }[] = [
  { upTo: 40, word: 'red' },
  { upTo: 75, word: 'orange' },
  { upTo: 105, word: 'yellow' },
  { upTo: 175, word: 'green' },
  { upTo: 235, word: 'teal' },
  { upTo: 290, word: 'blue' },
  { upTo: 330, word: 'purple' },
  { upTo: 355, word: 'pink' },
];

/** What somebody would call this colour across a room. */
export function colourWord(colour: Rgb): string {
  const { L, C, h } = toOklch(colour);
  if (C < 0.03) {
    if (L > 0.93) return 'white';
    if (L < 0.15) return 'black';
    return 'grey';
  }
  for (const band of HUES) {
    if (h < band.upTo) return band.word;
  }
  return 'red';
}

const SCALE_WORDS: Readonly<Record<string, string>> = {
  space: 'spacing',
  radius: 'corner rounding',
  size: 'sizing',
  length: 'sizing',
};

/**
 * The project's own name for a value, as it would be said out loud.
 *
 * `--brand-blue` is "brand blue" and carries the whole sentence on its own; a
 * name that only describes the file — `--color-500` — falls back to the colour
 * itself, because "your 500" tells nobody anything.
 *
 * Sizes never use the name: every real one is `--space-4` or `--radius-md`,
 * which is a label rather than a phrase. The scale is what the sentence means
 * anyway, and both amounts are shown beside it.
 */
export function nameFor(known: Known, colour?: Rgb | null): string {
  if (colour == null) return SCALE_WORDS[known.kind ?? 'length'] ?? 'sizing';

  const words = wordsIn(known.name).filter((word) => !NOISE.has(word));
  const said = words.join(' ');
  const word = colourWord(colour);
  if (said === '') return word;
  if (words.every((one) => /^\d+$/.test(one))) return `${word} ${said}`;
  return said;
}

const COUNTS: readonly string[] = [
  'No',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
];

/** A finding, up to the sentence: everything `saysDrift` needs and nothing else. */
export type Near = {
  kind: 'colour' | 'length';
  confidence: Confidence;
  /** The project's value as it would be said out loud — see `nameFor`. */
  yours: string;
};

/**
 * One finding, in a sentence.
 *
 * Never a value: what a designer needs is that this was meant to be theirs and
 * is not, and the two swatches beside the sentence make that case better than
 * any number would. "Nearly" is kept for the ones too close to see, which is
 * exactly when the sentence is doing the work on its own.
 */
export function saysDrift(near: Near): string {
  const yours = near.yours;
  if (near.kind === 'colour') {
    if (near.confidence === 'sure') return `This is nearly your ${yours}, but not quite.`;
    if (near.confidence === 'likely') return `This is a shade off your ${yours}.`;
    return `This is close to your ${yours}, but not the same.`;
  }
  if (near.confidence === 'sure') return `This is a hair off your ${yours}.`;
  if (near.confidence === 'likely') return `This is nearly your ${yours}, but not quite.`;
  return `This is close to your ${yours}, but not the same.`;
}

/** The section's one line, above the list. */
export function saysAll(findings: readonly Finding[]): string {
  if (findings.length === 0) return 'Everything here uses your own values.';
  if (findings.length === 1) return 'One value here is not quite yours.';
  const count = COUNTS[findings.length] ?? String(findings.length);
  return `${count} values here are not quite yours.`;
}

/**
 * The instruction behind "Use yours": put the project's own value where a hand
 * -written near-miss is.
 *
 * Named exactly — file, line and both values — because a near-miss is by
 * definition almost the same as three other things in the file, and "make the
 * blue right" would be acted on somewhere else.
 */
export function saysUseYours(finding: Finding, file: string): string {
  const where = file === '' ? `line ${String(finding.line)}` : `${file}, line ${String(finding.line)}`;
  return `In ${where} the value ${finding.wrote} is written by hand. Put ${finding.use} there instead — it is this project's own ${finding.mine.name} (${finding.mine.value}). Change only that one value, and leave every other ${finding.wrote} in the project alone.`;
}

/* -------------------------------------------------------------------------- */
/* Where to look                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The file with everything that is not a written value blanked out.
 *
 * Comments, quoted text and `url(...)` keep their length so positions stay
 * true. The head of an at-rule goes too — a breakpoint at 640px is a width, not
 * a size off somebody's spacing scale.
 */
function scannable(source: string): string {
  const out = source.split('');
  const blank = (from: number, to: number) => {
    for (let at = from; at < to && at < out.length; at += 1) {
      if (out[at] !== '\n') out[at] = ' ';
    }
  };

  let at = 0;
  while (at < source.length) {
    const here = source[at];
    const next = source[at + 1];

    if (here === '/' && next === '*') {
      const end = source.indexOf('*/', at + 2);
      const stop = end === -1 ? source.length : end + 2;
      blank(at, stop);
      at = stop;
      continue;
    }

    if (here === '/' && next === '/') {
      const end = source.indexOf('\n', at);
      const stop = end === -1 ? source.length : end;
      blank(at, stop);
      at = stop;
      continue;
    }

    if (here === '"' || here === "'" || here === '`') {
      let end = at + 1;
      while (end < source.length && source[end] !== here) {
        if (source[end] === '\\') end += 1;
        end += 1;
      }
      const stop = Math.min(end + 1, source.length);
      blank(at, stop);
      at = stop;
      continue;
    }

    if (here === 'u' && source.slice(at, at + 4).toLowerCase() === 'url(') {
      const end = source.indexOf(')', at);
      const stop = end === -1 ? source.length : end + 1;
      blank(at, stop);
      at = stop;
      continue;
    }

    if (here === '@' && /[a-z]/i.test(next ?? '')) {
      let end = at;
      while (end < source.length && source[end] !== '{' && source[end] !== ';') end += 1;
      blank(at, end);
      at = end;
      continue;
    }

    at += 1;
  }

  return out.join('');
}

const COLOUR_AT =
  /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{4}|[0-9a-f]{3})(?![0-9a-f])|\b(?:rgba?|hsla?)\([^()]*\)/gi;

/** Leading `-` and `#` are excluded rather than handled: a negative margin and a
 *  run of hex digits are both places a size is not. */
const LENGTH_AT = /(?<![\w.#-])(?:\d+\.?\d*|\.\d+)(?:px|rem|em)\b/gi;

function lineStarts(source: string): number[] {
  const starts = [0];
  for (let at = 0; at < source.length; at += 1) {
    if (source[at] === '\n') starts.push(at + 1);
  }
  return starts;
}

function placeOf(starts: readonly number[], at: number): { line: number; column: number } {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if ((starts[mid] ?? 0) <= at) low = mid;
    else high = mid - 1;
  }
  return { line: low + 1, column: at - (starts[low] ?? 0) + 1 };
}

/* -------------------------------------------------------------------------- */
/* The findings                                                                */
/* -------------------------------------------------------------------------- */

const RANK: Readonly<Record<Confidence, number>> = {
  sure: 0,
  likely: 1,
  maybe: 2,
};

function sameColour(one: Rgb, other: Rgb): boolean {
  return (
    Math.round(one.r) === Math.round(other.r) &&
    Math.round(one.g) === Math.round(other.g) &&
    Math.round(one.b) === Math.round(other.b) &&
    Math.abs(one.a - other.a) < 0.004
  );
}

function inUse(known: Known): string {
  return known.name.startsWith('--') ? `var(${known.name})` : known.value;
}

function round(value: number, places: number): number {
  const scale = Math.pow(10, places);
  return Math.round(value * scale) / scale;
}

function nearestColour(colour: Rgb, mine: readonly Mine[]): { one: Mine; distance: number } | null {
  let best: { one: Mine; distance: number } | null = null;
  for (const candidate of mine) {
    const theirs = candidate.colour;
    if (theirs === null || leaveAlone(theirs)) continue;
    // A value the project already has, written out in full, is not drift.
    if (sameColour(colour, theirs)) return null;
    const distance = apart(colour, theirs);
    if (best === null || distance < best.distance) best = { one: candidate, distance };
  }
  return best;
}

function nearestLength(
  length: Length,
  mine: readonly Mine[],
): { one: Mine; distance: number } | null {
  let best: { one: Mine; distance: number } | null = null;
  for (const candidate of mine) {
    const theirs = candidate.length;
    if (theirs === null || leaveLengthAlone(theirs)) continue;
    if (Math.abs(theirs.px - length.px) < 0.001) return null;
    const distance = Math.abs(theirs.px - length.px) / theirs.px;
    if (best === null || distance < best.distance) best = { one: candidate, distance };
  }
  return best;
}

/** Thirds of whatever the threshold is, so moving the threshold moves the
 *  wording with it rather than leaving the two disagreeing. */
function confidenceOf(distance: number, near: number): Confidence {
  if (distance <= near / 3) return 'sure';
  return distance <= (near * 2) / 3 ? 'likely' : 'maybe';
}

/**
 * Every value in a file that was nearly one of the project's own.
 *
 * Conservative on purpose. A value that matches something the project has is
 * never a finding, which is also why a palette file does not flag its own
 * neighbouring steps: each of them is one of the project's values already.
 */
export function findDrift(
  source: string,
  known: readonly Known[],
  options: DriftOptions = {},
): readonly Finding[] {
  const nearColour = options.nearColour ?? NEAR_COLOUR;
  const nearLength = options.nearLength ?? NEAR_LENGTH;
  const most = options.most ?? MOST_FINDINGS;
  if (typeof source !== 'string' || source === '' || known.length === 0) return [];

  const mine = known.map(readKnown);
  if (!mine.some((one) => one.colour !== null || one.length !== null)) return [];

  const text = scannable(source);
  const starts = lineStarts(source);
  const found: Finding[] = [];

  for (const match of text.matchAll(COLOUR_AT)) {
    const wrote = match[0];
    const colour = readColour(wrote);
    if (colour === null || leaveAlone(colour)) continue;

    const best = nearestColour(colour, mine);
    if (best === null || best.distance > nearColour) continue;

    const place = placeOf(starts, match.index);
    const confidence = confidenceOf(best.distance, nearColour);
    const theirs = best.one.known;
    found.push({
      id: `colour-${place.line}-${place.column}`,
      kind: 'colour',
      wrote,
      mine: { name: theirs.name, value: theirs.value },
      use: inUse(theirs),
      line: place.line,
      column: place.column,
      distance: round(best.distance, 4),
      confidence,
      says: saysDrift({
        kind: 'colour',
        confidence,
        yours: nameFor(theirs, best.one.colour),
      }),
      detail: `${wrote} · yours is ${theirs.name} ${theirs.value}`,
    });
  }

  for (const match of text.matchAll(LENGTH_AT)) {
    const wrote = match[0];
    const length = readLength(wrote);
    if (length === null || leaveLengthAlone(length)) continue;

    const best = nearestLength(length, mine);
    if (best === null || best.distance > nearLength) continue;

    const place = placeOf(starts, match.index);
    const confidence = confidenceOf(best.distance, nearLength);
    const theirs = best.one.known;
    found.push({
      id: `length-${place.line}-${place.column}`,
      kind: 'length',
      wrote,
      mine: { name: theirs.name, value: theirs.value },
      use: inUse(theirs),
      line: place.line,
      column: place.column,
      distance: round(best.distance, 4),
      confidence,
      says: saysDrift({ kind: 'length', confidence, yours: nameFor(theirs) }),
      detail: `${wrote} · yours is ${theirs.name} ${theirs.value}`,
    });
  }

  found.sort(
    (one, other) =>
      RANK[one.confidence] - RANK[other.confidence] ||
      one.line - other.line ||
      one.column - other.column,
  );

  return most >= 0 ? found.slice(0, most) : found;
}
