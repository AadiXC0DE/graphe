/** Whether a pairing of colours can be read, and what to do about it when it cannot.
 *
 * Pure. No React, no I/O — it is handed colours and text sizes and hands back
 * findings.
 *
 * Two surfaces, deliberately: `says` is the sentence a designer reads, and it
 * never carries a number; `detail` is the same finding as measurements, for the
 * person who has turned "Show me" on. Nothing crosses between them.
 */

export type Rgb = { r: number; g: number; b: number; a?: number };

export type Colour = string | Rgb;

/** A colour the project already uses. A name, where the file gave it one, so a
 *  fix can be offered in the project's own vocabulary. */
export type Tone = string | { name?: string; value: string };

/** The type this colour is painted on, which decides how much contrast it owes. */
export type TextShape = { px: number; weight?: number };

export type Reading = {
  /** Exact, unrounded. Round it where it is shown, not where it is decided. */
  ratio: number;
  needs: number;
  passes: boolean;
  large: boolean;
  /** It sits on the lighter of the two, so the trouble is that it is too pale
   *  rather than too dark. */
  onLight: boolean;
  /** It would read at a headline size, and only fails at this one. */
  onlyBig: boolean;
};

export type Fix = {
  /** As the project writes colours, where it came from theirs; a hex otherwise. */
  colour: string;
  /** The project's own name for it, when it had one. */
  name: string | null;
  /** How far it moved, in the tones of a normal ramp. Never less than one. */
  steps: number;
  direction: 'darker' | 'lighter';
  /** It came from a colour the project already uses. */
  fromScale: boolean;
  ratio: number;
};

/** The finding as measurements. Nothing here ever reaches a sentence. */
export type Detail = {
  ratio: number;
  needs: number;
  large: boolean;
  /** What was actually measured — anything see-through laid on its background. */
  front: string;
  back: string;
  /** One line, for under the sentence, when "Show me" is on. */
  line: string;
};

/** One place on the page, as the app finds it. */
export type Spot = {
  id: string;
  /** What a designer calls it: "The footer links". Never a selector. */
  where: string;
  front: string;
  back: string;
  /** Missing means body text, which is the strictest case. */
  text?: TextShape;
};

export type Finding = {
  id: string;
  where: string;
  /** The colours as the project wrote them, so the swatches show its own values. */
  front: string;
  back: string;
  says: string;
  fix: Fix | null;
  detail: Detail;
};

/* -------------------------------------------------------------------------- */
/* Reading a colour                                                            */
/* -------------------------------------------------------------------------- */

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

const HEX = /^#([0-9a-f]+)$/i;
const CALL = /^(rgba?|hsla?)\(([^()]*)\)$/i;
const ANGLE = /^([-+]?(?:\d+\.?\d*|\.\d+))(deg|rad|grad|turn)?$/i;
const PLAIN = /^([-+]?(?:\d+\.?\d*|\.\d+))(%?)$/;

function partsOf(inside: string): string[] {
  return inside
    .trim()
    .split(/[\s,/]+/)
    .filter((part) => part !== '');
}

/** A channel written as 0–255 or as a percentage. `none` is CSS for zero. */
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

function fromHex(digits: string): Rgb | null {
  const wide = digits.length === 6 || digits.length === 8;
  const short = digits.length === 3 || digits.length === 4;
  if (!wide && !short) return null;

  const size = wide ? 2 : 1;
  const at = (index: number): number => {
    const piece = digits.slice(index * size, index * size + size);
    const value = parseInt(short ? piece + piece : piece, 16);
    return value;
  };

  const alpha = digits.length === 4 || digits.length === 8 ? at(3) / 255 : 1;
  return { r: at(0), g: at(1), b: at(2), a: alpha };
}

function fromHsl(parts: readonly string[]): Rgb | null {
  if (parts.length !== 3 && parts.length !== 4) return null;
  const h = angle(parts[0] ?? '');
  const s = share(parts[1] ?? '');
  const l = share(parts[2] ?? '');
  const a = opacity(parts[3]);
  if (h === null || s === null || l === null || a === null) return null;
  return { ...rgbOfHsl(h, s, l), a };
}

function fromRgb(parts: readonly string[]): Rgb | null {
  if (parts.length !== 3 && parts.length !== 4) return null;
  const r = channel(parts[0] ?? '');
  const g = channel(parts[1] ?? '');
  const b = channel(parts[2] ?? '');
  const a = opacity(parts[3]);
  if (r === null || g === null || b === null || a === null) return null;
  return { r, g, b, a };
}

/**
 * A written colour as channels, or null when it is not one we can measure.
 *
 * Hex in all four lengths, `rgb()`/`rgba()`, `hsl()`/`hsla()`, in both the comma
 * and the space spelling. A `var(--x)` is not a colour until something resolves
 * it, and saying nothing is better than guessing at one.
 */
export function readColour(value: string): Rgb | null {
  if (typeof value !== 'string') return null;
  const one = value.trim().replace(/\s*!important$/i, '').replace(/\s+/g, ' ');
  if (one === '') return null;

  const hex = HEX.exec(one);
  if (hex !== null) return fromHex(hex[1] ?? '');

  const call = CALL.exec(one);
  if (call === null) return null;
  const kind = (call[1] ?? '').toLowerCase();
  const parts = partsOf(call[2] ?? '');
  return kind.startsWith('hsl') ? fromHsl(parts) : fromRgb(parts);
}

function toRgb(colour: Colour): Rgb | null {
  if (typeof colour === 'string') return readColour(colour);
  if (colour === null || typeof colour !== 'object') return null;
  const { r, g, b } = colour;
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return null;
  const a = colour.a ?? 1;
  if (!Number.isFinite(a)) return null;
  return { r: clamp(r, 0, 255), g: clamp(g, 0, 255), b: clamp(b, 0, 255), a: clamp(a, 0, 1) };
}

function pair(digit: number): string {
  return Math.round(clamp(digit, 0, 255)).toString(16).padStart(2, '0');
}

/** `#rrggbb`. Opacity is dropped: a fix is a colour to paste, not a layer. */
export function hexOf(colour: Colour): string {
  const rgb = toRgb(colour);
  if (rgb === null) return '';
  return `#${pair(rgb.r)}${pair(rgb.g)}${pair(rgb.b)}`;
}

/* -------------------------------------------------------------------------- */
/* The maths                                                                   */
/* -------------------------------------------------------------------------- */

/** sRGB is stored bent so that the steps look even; every measurement has to
 *  straighten it first. An average of the three channels is not this. */
function linear(digit: number): number {
  const value = clamp(digit, 0, 255) / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/** How much light comes off it, 0 to 1. NaN when the colour cannot be read —
 *  no real colour measures NaN, so it cannot be mistaken for an answer. */
export function luminance(colour: Colour): number {
  const rgb = toRgb(colour);
  if (rgb === null) return Number.NaN;
  return 0.2126 * linear(rgb.r) + 0.7152 * linear(rgb.g) + 0.0722 * linear(rgb.b);
}

/** A see-through background still has to land on something, and short of being
 *  told otherwise the page underneath it is white. */
const PAPER: Rgb = { r: 255, g: 255, b: 255, a: 1 };

/** Anything see-through is only as readable as what shows through it, and the
 *  screen mixes it in the bent space rather than the straightened one. */
function over(front: Rgb, back: Rgb): Rgb {
  const a = front.a ?? 1;
  if (a >= 1) return { r: front.r, g: front.g, b: front.b, a: 1 };
  return {
    r: front.r * a + back.r * (1 - a),
    g: front.g * a + back.g * (1 - a),
    b: front.b * a + back.b * (1 - a),
    a: 1,
  };
}

function ratioOf(front: Rgb, back: Rgb): number {
  const one = luminance(front);
  const other = luminance(back);
  const high = Math.max(one, other);
  const low = Math.min(one, other);
  return (high + 0.05) / (low + 0.05);
}

/**
 * How far apart two colours are, 1 to 21.
 *
 * A see-through front is measured as it lands on that background. NaN when
 * either colour cannot be read.
 */
export function contrast(front: Colour, back: Colour): number {
  const one = toRgb(front);
  const other = toRgb(back);
  if (one === null || other === null) return Number.NaN;
  const ground = over(other, PAPER);
  return ratioOf(over(one, ground), ground);
}

/* ------------------------------------------------------------------ lightness */

const LAB_E = 216 / 24389;
const LAB_K = 24389 / 27;

function bend(part: number): number {
  return part > LAB_E ? Math.cbrt(part) : (LAB_K * part + 16) / 116;
}

/**
 * Perceived lightness, 0 to 100.
 *
 * Luminance is what a meter reads; this is what an eye reads, and it is the one
 * to step along when a colour has to move by an even-looking amount.
 */
export function lightness(colour: Colour): number {
  const light = luminance(colour);
  return Number.isFinite(light) ? 116 * bend(light) - 16 : Number.NaN;
}

type Lab = { L: number; a: number; b: number };

/**
 * Oklab, used for judging how near two colours are and whether they are the
 * same colour. The older Lab swings a blue's hue by thirty degrees on the way
 * from pale to deep, which would tell us a palette's own two blues are
 * unrelated; this one holds a hue steady as the lightness moves.
 */
function labOf(colour: Rgb): Lab {
  const r = linear(colour.r);
  const g = linear(colour.g);
  const b = linear(colour.b);

  const long = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const middle = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const short = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  return {
    L: 0.2104542553 * long + 0.793617785 * middle - 0.0040720468 * short,
    a: 1.9779984951 * long - 2.428592205 * middle + 0.4505937099 * short,
    b: 0.0259040371 * long + 0.7827717662 * middle - 0.808675766 * short,
  };
}

function apart(one: Lab, other: Lab): number {
  return Math.hypot(one.L - other.L, one.a - other.a, one.b - other.b);
}

/** Below this the eye calls it grey, and its hue is noise rather than a choice. */
const GREY = 0.02;

/** Past this much of a turn round the wheel, a replacement has stopped being
 *  the same colour and started being a different one, however well it reads. */
const SAME_HUE = 30;

/** How far round the wheel, the short way. */
function turn(one: Lab, other: Lab): number {
  const degrees =
    Math.abs(Math.atan2(one.b, one.a) - Math.atan2(other.b, other.a)) * (180 / Math.PI);
  return degrees > 180 ? 360 - degrees : degrees;
}

/**
 * Whether swapping one for the other still leaves the same colour on the page.
 *
 * Lightness is free to move — that is the whole repair. Hue is not: a grey that
 * comes back blue is a different design, however well it reads.
 */
function sameColour(one: Lab, other: Lab): boolean {
  const here = Math.hypot(one.a, one.b);
  const there = Math.hypot(other.a, other.b);
  if (here < GREY || there < GREY) return here < GREY && there < GREY;
  return turn(one, other) <= SAME_HUE;
}

/* ---------------------------------------------------------------------- hsl */

function hslOf(colour: Rgb): { h: number; s: number; l: number } {
  const r = clamp(colour.r, 0, 255) / 255;
  const g = clamp(colour.g, 0, 255) / 255;
  const b = clamp(colour.b, 0, 255) / 255;
  const high = Math.max(r, g, b);
  const low = Math.min(r, g, b);
  const l = (high + low) / 2;
  const span = high - low;
  if (span === 0) return { h: 0, s: 0, l };

  const s = span / (1 - Math.abs(2 * l - 1));
  const h =
    high === r
      ? ((g - b) / span) % 6
      : high === g
        ? (b - r) / span + 2
        : (r - g) / span + 4;
  return { h: ((h * 60) % 360 + 360) % 360, s, l };
}

function rgbOfHsl(h: number, s: number, l: number): Rgb {
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const sixth = h / 60;
  const second = chroma * (1 - Math.abs((sixth % 2) - 1));
  const lift = l - chroma / 2;

  const [r, g, b] =
    sixth < 1
      ? [chroma, second, 0]
      : sixth < 2
        ? [second, chroma, 0]
        : sixth < 3
          ? [0, chroma, second]
          : sixth < 4
            ? [0, second, chroma]
            : sixth < 5
              ? [second, 0, chroma]
              : [chroma, 0, second];

  return { r: (r + lift) * 255, g: (g + lift) * 255, b: (b + lift) * 255, a: 1 };
}

/** What the file will actually hold, so a fix is checked as the colour it will
 *  become rather than as the one the arithmetic reached. */
function settled(colour: Rgb): Rgb {
  return {
    r: Math.round(clamp(colour.r, 0, 255)),
    g: Math.round(clamp(colour.g, 0, 255)),
    b: Math.round(clamp(colour.b, 0, 255)),
    a: 1,
  };
}

/* -------------------------------------------------------------------------- */
/* What a pairing owes                                                         */
/* -------------------------------------------------------------------------- */

const BODY: Required<TextShape> = { px: 16, weight: 400 };

/** Big type carries itself: the strokes are wide enough that less separation
 *  still reads. 24px, or 19px once it is bold. */
const BIG_PX = 24;
const BIG_BOLD_PX = 18.66;
const BOLD = 700;

const NEEDS_BIG = 3;
const NEEDS_BODY = 4.5;

export function isLarge(text?: TextShape): boolean {
  const px = text?.px ?? BODY.px;
  const weight = text?.weight ?? BODY.weight;
  if (!Number.isFinite(px)) return false;
  return px >= BIG_PX || (px >= BIG_BOLD_PX && Number.isFinite(weight) && weight >= BOLD);
}

/** How far apart this type has to be from what it sits on. */
export function needsFor(text?: TextShape): number {
  return isLarge(text) ? NEEDS_BIG : NEEDS_BODY;
}

/**
 * Whether this pairing is comfortable, and everything the words and the
 * measurements need to know. Null when either colour cannot be read.
 */
export function reads(front: Colour, back: Colour, text?: TextShape): Reading | null {
  const one = toRgb(front);
  const other = toRgb(back);
  if (one === null || other === null) return null;

  const ground = over(other, PAPER);
  const facing = over(one, ground);
  const ratio = ratioOf(facing, ground);
  const needs = needsFor(text);
  const large = isLarge(text);

  return {
    ratio,
    needs,
    passes: ratio >= needs,
    large,
    onLight: luminance(ground) >= luminance(facing),
    onlyBig: !large && ratio < NEEDS_BODY && ratio >= NEEDS_BIG,
  };
}

/* -------------------------------------------------------------------------- */
/* The nearest colour that works                                               */
/* -------------------------------------------------------------------------- */

/** One tone of a normal ramp, in perceived lightness. Two of these is the gap
 *  between neighbouring greys in most palettes. */
const A_STEP = 8;

/** Enough passes to land on a colour the rounding cannot undo. */
const TRIES = 40;

function stepsBetween(from: Rgb, to: Rgb): number {
  const moved = Math.abs(lightness(to) - lightness(from));
  return Math.max(1, Math.round(moved / A_STEP));
}

function wayFrom(from: Rgb, to: Rgb): 'darker' | 'lighter' {
  return lightness(to) < lightness(from) ? 'darker' : 'lighter';
}

/** The furthest this colour can go in one direction while keeping its hue. */
function moved(front: Rgb, back: Rgb, needs: number, up: boolean): Rgb | null {
  const { h, s, l } = hslOf(front);
  const at = (level: number): Rgb => settled(rgbOfHsl(h, s, clamp(level, 0, 1)));
  const end = up ? 1 : 0;
  if (ratioOf(at(end), back) < needs) return null;

  let short = l;
  let far = end;
  for (let pass = 0; pass < TRIES; pass += 1) {
    const middle = (short + far) / 2;
    if (ratioOf(at(middle), back) >= needs) far = middle;
    else short = middle;
  }
  return at(far);
}

function toneParts(tone: Tone): { name: string | null; value: string } {
  if (typeof tone === 'string') return { name: null, value: tone };
  return { name: tone.name ?? null, value: tone.value };
}

/** The project's own nearest colour that reads, if it has one that is still
 *  recognisably this colour. */
function fromScale(
  front: Rgb,
  back: Rgb,
  needs: number,
  scale: readonly Tone[],
): Fix | null {
  const here = labOf(front);
  let best: { fix: Fix; near: number } | null = null;

  for (const tone of scale) {
    const { name, value } = toneParts(tone);
    const parsed = readColour(value);
    if (parsed === null) continue;

    const solid = settled({ ...parsed, a: 1 });
    const ratio = ratioOf(solid, back);
    if (ratio < needs) continue;

    const there = labOf(solid);
    if (!sameColour(here, there)) continue;

    const near = apart(here, there);
    if (best !== null && near >= best.near) continue;
    best = {
      near,
      fix: {
        colour: value.trim(),
        name,
        steps: stepsBetween(front, solid),
        direction: wayFrom(front, solid),
        fromScale: true,
        ratio,
      },
    };
  }

  return best?.fix ?? null;
}

/**
 * The nearest colour that can be read, given one that cannot.
 *
 * A colour the project already uses wins over one we invent — a palette with a
 * darker grey in it does not need a new grey. Failing that, the colour is moved
 * away from its background in perceived steps, keeping its hue, and stops at
 * the first shade that holds up once it is written into a file.
 *
 * Null when the pairing already reads, or when either colour cannot be read.
 */
export function suggest(
  front: Colour,
  back: Colour,
  options: { text?: TextShape; scale?: readonly Tone[] } = {},
): Fix | null {
  const one = toRgb(front);
  const other = toRgb(back);
  if (one === null || other === null) return null;

  const ground = over(other, PAPER);
  const facing = over(one, ground);
  const needs = needsFor(options.text);
  if (ratioOf(facing, ground) >= needs) return null;

  const mine = fromScale(facing, ground, needs, options.scale ?? []);
  if (mine !== null) return mine;

  // Usually only one way gains anything; when a colour sits close to its own
  // background both do, and the shorter move is the one to offer.
  const here = lightness(facing);
  const ends = [moved(facing, ground, needs, true), moved(facing, ground, needs, false)]
    .filter((one): one is Rgb => one !== null)
    .sort((one, other) => Math.abs(lightness(one) - here) - Math.abs(lightness(other) - here));

  const found = ends[0];
  if (found === undefined) return null;

  return {
    colour: hexOf(found),
    name: null,
    steps: stepsBetween(facing, found),
    direction: wayFrom(facing, found),
    fromScale: false,
    ratio: ratioOf(found, ground),
  };
}

/* -------------------------------------------------------------------------- */
/* Saying it                                                                   */
/* -------------------------------------------------------------------------- */

/** The fixed words of the section, in one place so the language sweep has one
 *  file to read. */
export const legible = {
  heading: 'Hard to read',
  empty: 'Everything here reads clearly.',
  fine: 'Comfortable to read.',
  fix: 'Fix it',
  fixing: 'Changing it…',
  /** Beside a fix that came out of the project's own colours. */
  own: 'From your own colours',
  now: 'Now',
  instead: 'Instead',
} as const;

const STEPS = ['', 'a step', 'two steps', 'three steps', 'four steps'] as const;

const COUNTS = [
  '',
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
  'Eleven',
  'Twelve',
] as const;

/**
 * One finding, in a sentence a designer can act on.
 *
 * Never a number and never a rule: the person who chose the colour needs to
 * know it is too pale and roughly how far to move it, and everything else
 * belongs in `detail`.
 */
export function saysPair(reading: Reading, fix?: Fix | null): string {
  if (reading.passes) return legible.fine;

  // On a light background the complaint is that it is washed out; on a dark one
  // that it disappears into it. Same failure, opposite word.
  const pale = reading.onLight;
  const way = fix?.direction ?? (pale ? 'darker' : 'lighter');
  const steps = fix?.steps ?? 0;
  const move =
    steps === 1
      ? `a step ${way}`
      : steps >= 2 && steps < STEPS.length
        ? `about ${STEPS[steps]} ${way}`
        : null;

  if (reading.onlyBig) {
    const size = `Fine for a headline, but too ${pale ? 'pale' : 'dark'} at this size`;
    return move === null ? `${size}.` : `${size} — ${move} would do it.`;
  }

  const trouble = pale
    ? 'Too pale to read on this background'
    : 'Too dark to read on this background';

  if (steps === 1) return `Nearly there — a step ${way} would do it.`;
  if (move !== null) return `${trouble} — ${move} would do it.`;
  if (steps >= STEPS.length) return `${trouble} — it needs to be much ${way}.`;
  return `${trouble}.`;
}

/** The section's one line, above the list. */
export function saysFindings(findings: readonly Finding[]): string {
  if (findings.length === 0) return legible.empty;
  if (findings.length === 1) return 'One thing here is hard to read.';
  const count = COUNTS[findings.length] ?? String(findings.length);
  return `${count} things here are hard to read.`;
}

/* -------------------------------------------------------------------------- */
/* The whole page                                                              */
/* -------------------------------------------------------------------------- */

function twoPlaces(value: number): number {
  return Math.round(value * 100) / 100;
}

function detailOf(reading: Reading, front: Rgb, back: Rgb): Detail {
  const ratio = twoPlaces(reading.ratio);
  const one = hexOf(front);
  const other = hexOf(back);
  return {
    ratio,
    needs: reading.needs,
    large: reading.large,
    front: one,
    back: other,
    line: `${one} on ${other} · measures ${ratio.toFixed(2)}, needs ${reading.needs}`,
  };
}

/**
 * Everything on the page that cannot be read, worst first.
 *
 * A spot whose colours we cannot measure is dropped rather than guessed at —
 * a list that invents a problem costs more trust than one that misses it.
 */
export function findTrouble(
  spots: readonly Spot[],
  scale: readonly Tone[] = [],
): readonly Finding[] {
  const found: Finding[] = [];

  for (const spot of spots) {
    const reading = reads(spot.front, spot.back, spot.text);
    if (reading === null || reading.passes) continue;

    const one = toRgb(spot.front);
    const other = toRgb(spot.back);
    if (one === null || other === null) continue;

    const ground = over(other, PAPER);
    const facing = over(one, ground);
    const fix = suggest(spot.front, spot.back, { text: spot.text, scale });

    found.push({
      id: spot.id,
      where: spot.where,
      front: spot.front,
      back: spot.back,
      says: saysPair(reading, fix),
      fix,
      detail: detailOf(reading, facing, ground),
    });
  }

  return found.sort((one, other) => one.detail.ratio - other.detail.ratio);
}
