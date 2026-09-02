/** One colour in, a whole palette out — and every pair measured on the way.
 *
 * A person picks an accent and expects surfaces, borders and three weights of
 * text to follow. Doing that in hex is guesswork: the same nudge that keeps one
 * hue readable washes another one out. OKLCH has a lightness axis that matches
 * what an eye reports, so "move this until it can be read" is a search along
 * one number rather than a hunt.
 *
 * So nothing here is chosen by eye. Every colour a person reads is solved for
 * the ratio it owes — 4.5:1 normally, 7:1 at high contrast — against the
 * hardest surface it can land on, which is what makes a theme somebody built
 * themselves as legible as the five that ship.
 *
 * The conversions are written out rather than installed. They are two matrices
 * and a cube root, and a palette is not worth a dependency.
 *
 * Pure. No files, no document, no preferences.
 */

/** 0–255 a channel, as a screen takes it. */
export type Rgb = { r: number; g: number; b: number };

/** Lightness 0–1, chroma from 0, hue in degrees. */
export type Oklch = { l: number; c: number; h: number };

export type Tone = 'warm' | 'neutral' | 'cool';
export type Contrast = 'normal' | 'high';
/** Which way round the palette runs. Light and dark are different ladders, not
 *  one ladder read backwards. */
export type Base = 'light' | 'dark';

/** The colours a theme is made of. One name per custom property in
 *  `styles/tokens.css`, so nothing here can be emitted that nothing reads. */
export type Surfaces = {
  bg: string;
  bgRaised: string;
  bgSunken: string;
  border: string;
  borderStrong: string;
  borderControl: string;
  text: string;
  textMuted: string;
  textFaint: string;
  accent: string;
  accentText: string;
  accentSoft: string;
  accentInk: string;
  danger: string;
};

/* -------------------------------------------------------------------------- */
/* sRGB                                                                        */
/* -------------------------------------------------------------------------- */

function toLinear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function toSrgb(channel: number): number {
  return channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055;
}

function clamp(value: number, least: number, most: number): number {
  return value < least ? least : value > most ? most : value;
}

function twoDigits(channel: number): string {
  return Math.round(clamp(channel, 0, 1) * 255)
    .toString(16)
    .padStart(2, '0');
}

export function hexOf(rgb: Rgb): string {
  return `#${twoDigits(rgb.r / 255)}${twoDigits(rgb.g / 255)}${twoDigits(rgb.b / 255)}`;
}

/** A written colour as channels, or nothing if it is not one we can read.
 *  Hex in three or six digits, and the `oklch()` a stylesheet may already say. */
export function rgbFrom(text: string): Rgb | null {
  const said = text.trim().toLowerCase();

  const oklch = oklchFromText(said);
  if (oklch !== null) return rgbOf(oklch);

  const digits = said.startsWith('#') ? said.slice(1) : said;
  if (!/^[0-9a-f]+$/.test(digits)) return null;
  if (digits.length === 3) {
    const [r = '', g = '', b = ''] = [...digits];
    return {
      r: Number.parseInt(`${r}${r}`, 16),
      g: Number.parseInt(`${g}${g}`, 16),
      b: Number.parseInt(`${b}${b}`, 16),
    };
  }
  if (digits.length !== 6) return null;
  return {
    r: Number.parseInt(digits.slice(0, 2), 16),
    g: Number.parseInt(digits.slice(2, 4), 16),
    b: Number.parseInt(digits.slice(4, 6), 16),
  };
}

function oklchFromText(said: string): Oklch | null {
  const found = /^oklch\(\s*([0-9.]+)(%?)\s+([0-9.]+)\s+([0-9.]+)(?:deg)?\s*\)$/.exec(said);
  if (found === null) return null;
  const lightness = Number.parseFloat(found[1] ?? '');
  const chroma = Number.parseFloat(found[3] ?? '');
  const hue = Number.parseFloat(found[4] ?? '');
  if (!Number.isFinite(lightness) || !Number.isFinite(chroma) || !Number.isFinite(hue)) return null;
  return {
    l: clamp(found[2] === '%' ? lightness / 100 : lightness, 0, 1),
    c: Math.max(0, chroma),
    h: ((hue % 360) + 360) % 360,
  };
}

/* -------------------------------------------------------------------------- */
/* OKLab                                                                       */
/* -------------------------------------------------------------------------- */

/** Björn Ottosson's matrices, as published. Linear sRGB to the three cone
 *  responses OKLab is built on, and back. */
function oklchOfLinear(r: number, g: number, b: number): Oklch {
  const long = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const middle = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const short = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  const lightness = 0.2104542553 * long + 0.793617785 * middle - 0.0040720468 * short;
  const green = 1.9779984951 * long - 2.428592205 * middle + 0.4505937099 * short;
  const blue = 0.0259040371 * long + 0.7827717662 * middle - 0.808675766 * short;

  const hue = (Math.atan2(blue, green) * 180) / Math.PI;
  return {
    l: lightness,
    c: Math.hypot(green, blue),
    h: ((hue % 360) + 360) % 360,
  };
}

function linearOfOklch(one: Oklch): { r: number; g: number; b: number } {
  const radians = (one.h * Math.PI) / 180;
  const green = Math.cos(radians) * one.c;
  const blue = Math.sin(radians) * one.c;

  const long = (one.l + 0.3963377774 * green + 0.2158037573 * blue) ** 3;
  const middle = (one.l - 0.1055613458 * green - 0.0638541728 * blue) ** 3;
  const short = (one.l - 0.0894841775 * green - 1.291485548 * blue) ** 3;

  return {
    r: 4.0767416621 * long - 3.3077115913 * middle + 0.2309699292 * short,
    g: -1.2684380046 * long + 2.6097574011 * middle - 0.3413193965 * short,
    b: -0.0041960863 * long - 0.7034186147 * middle + 1.7076147010 * short,
  };
}

export function oklchOf(rgb: Rgb): Oklch {
  return oklchOfLinear(toLinear(rgb.r / 255), toLinear(rgb.g / 255), toLinear(rgb.b / 255));
}

const NEARLY = 1e-5;

function fits(one: Oklch): boolean {
  const linear = linearOfOklch(one);
  return (
    linear.r >= -NEARLY && linear.r <= 1 + NEARLY &&
    linear.g >= -NEARLY && linear.g <= 1 + NEARLY &&
    linear.b >= -NEARLY && linear.b <= 1 + NEARLY
  );
}

/** Chroma is what gives way first, because lightness and hue are the two a
 *  person actually asked for. */
export function rgbOf(one: Oklch): Rgb {
  const wanted: Oklch = { l: clamp(one.l, 0, 1), c: Math.max(0, one.c), h: one.h };
  let chroma = wanted.c;
  if (!fits(wanted)) {
    let low = 0;
    let high = wanted.c;
    for (let step = 0; step < 24; step += 1) {
      const middle = (low + high) / 2;
      if (fits({ ...wanted, c: middle })) low = middle;
      else high = middle;
    }
    chroma = low;
  }
  const linear = linearOfOklch({ ...wanted, c: chroma });
  return {
    r: Math.round(clamp(toSrgb(clamp(linear.r, 0, 1)), 0, 1) * 255),
    g: Math.round(clamp(toSrgb(clamp(linear.g, 0, 1)), 0, 1) * 255),
    b: Math.round(clamp(toSrgb(clamp(linear.b, 0, 1)), 0, 1) * 255),
  };
}

export function hexFrom(one: Oklch): string {
  return hexOf(rgbOf(one));
}

/* -------------------------------------------------------------------------- */
/* How well it reads                                                           */
/* -------------------------------------------------------------------------- */

export function luminanceOf(rgb: Rgb): number {
  return (
    0.2126 * toLinear(rgb.r / 255) +
    0.7152 * toLinear(rgb.g / 255) +
    0.0722 * toLinear(rgb.b / 255)
  );
}

/** WCAG, both ways round — the caller should not have to know which is lighter.
 *  A colour nobody can read is 1, the ratio of a thing against itself, so an
 *  unreadable setting fails a check rather than passing one by accident. */
export function contrastRatio(a: string | Rgb, b: string | Rgb): number {
  const front = typeof a === 'string' ? rgbFrom(a) : a;
  const back = typeof b === 'string' ? rgbFrom(b) : b;
  if (front === null || back === null) return 1;
  const one = luminanceOf(front);
  const other = luminanceOf(back);
  const lighter = Math.max(one, other);
  const darker = Math.min(one, other);
  return (lighter + 0.05) / (darker + 0.05);
}

/** What each contrast setting owes: AA for text, and WCAG 1.4.11 for the edge
 *  of a control that is only identified by its edge. */
export const READS: Readonly<Record<Contrast, number>> = { normal: 4.5, high: 7 };
export const OUTLINES: Readonly<Record<Contrast, number>> = { normal: 3, high: 4.5 };

/**
 * The colour at this hue and chroma that just clears `target` against `on`.
 *
 * "Just" is the point: on a light ground the answer is the lightest colour that
 * still reads, so a palette keeps whatever softness the ratio allows instead of
 * collapsing to black. Lightness is searched because in OKLCH it is the only
 * axis contrast moves along.
 */
function readableOn(on: string, target: number, hue: number, chroma: number, base: Base): string {
  const darker = base === 'light';
  let low = 0;
  let high = 1;
  for (let step = 0; step < 24; step += 1) {
    const middle = (low + high) / 2;
    const passes = contrastRatio(hexFrom({ l: middle, c: chroma, h: hue }), on) >= target;
    if (darker === passes) low = middle;
    else high = middle;
  }
  const answer = hexFrom({ l: darker ? low : high, c: chroma, h: hue });
  if (contrastRatio(answer, on) >= target) return answer;
  // The hue cannot reach it at any lightness — the ratio wins over the hue.
  return darker ? '#000000' : '#ffffff';
}

/* -------------------------------------------------------------------------- */
/* The palette                                                                 */
/* -------------------------------------------------------------------------- */

/** Where the three grounds sit on the lightness axis. Measured off the shipped
 *  themes, so a built palette lands in the same room as `light` and `graphe`. */
const GROUNDS: Readonly<Record<Base, Readonly<Record<Contrast, readonly [number, number, number]>>>> = {
  light: { normal: [0.985, 1, 0.96], high: [0.99, 1, 0.965] },
  dark: { normal: [0.19, 0.23, 0.16], high: [0.15, 0.195, 0.12] },
};

/** A trace of colour in the greys, and nothing more — a ground with hue in it
 *  reads as a mistake long before it reads as warm. */
const GROUND_CHROMA: Readonly<Record<Tone, number>> = { warm: 0.005, neutral: 0.002, cool: 0.005 };

/** Neutral keeps the accent's own hue; the other two commit to a direction. */
function groundHue(accent: Oklch, tone: Tone): number {
  if (tone === 'warm') return 70;
  if (tone === 'cool') return 250;
  return accent.h;
}

/** Text at full strength. Not solved against a ratio like the rest: body text
 *  wants to be as far from its ground as the palette allows. */
const BODY: Readonly<Record<Contrast, number>> = { normal: 13, high: 16 };

/** A hairline at 1.23:1 is a hairline nobody can see. */
const EDGES = { hair: 1.45, strong: 2.1 } as const;

/** The ground a colour has the least room against: the darkest under dark text,
 *  the lightest under light text. */
function worstGround(grounds: readonly string[], base: Base): string {
  let worst = grounds[0] ?? '#ffffff';
  for (const one of grounds) {
    const here = luminanceOf(rgbFrom(one) ?? { r: 0, g: 0, b: 0 });
    const worstYet = luminanceOf(rgbFrom(worst) ?? { r: 0, g: 0, b: 0 });
    if (base === 'light' ? here < worstYet : here > worstYet) worst = one;
  }
  return worst;
}

/** Every colour a theme needs, from one accent.
 *
 * `base` is which way the ladder runs, because a person still chooses light or
 * dark; the accent decides everything else.
 */
export function surfacesFrom(
  accent: string,
  tone: Tone,
  contrast: Contrast,
  base: Base = 'light',
): Surfaces {
  const asked = rgbFrom(accent);
  const chosen = asked === null ? { l: 0.55, c: 0.15, h: 30 } : oklchOf(asked);
  const hue = chosen.h;
  // A grey accent would leave the palette with nothing to be coloured with.
  const chroma = Math.max(chosen.c, 0.02);

  const [groundL, raisedL, sunkenL] = GROUNDS[base][contrast];
  const greyHue = groundHue(chosen, tone);
  const greyChroma = GROUND_CHROMA[tone];
  const grey = (lightness: number): string => hexFrom({ l: lightness, c: greyChroma, h: greyHue });

  const bg = grey(groundL);
  const bgRaised = grey(raisedL);
  const bgSunken = grey(sunkenL);
  const accentSoft = hexFrom({
    l: base === 'light' ? sunkenL - 0.015 : raisedL + 0.005,
    c: base === 'light' ? 0.045 : 0.05,
    h: hue,
  });

  // Everything read is solved against the worst ground it can land on, so one
  // measurement covers all four rather than four that each nearly pass.
  const hardest = worstGround([bg, bgRaised, bgSunken, accentSoft], base);

  const reads = READS[contrast];
  const text = readableOn(hardest, BODY[contrast], greyHue, greyChroma * 2, base);
  const accentOn = readableOn(hardest, reads, hue, chroma, base);
  const white = '#ffffff';
  const black = '#000000';

  return {
    bg,
    bgRaised,
    bgSunken,
    border: readableOn(bg, EDGES.hair, greyHue, greyChroma * 2, base),
    borderStrong: readableOn(bg, EDGES.strong, greyHue, greyChroma * 2, base),
    borderControl: readableOn(hardest, OUTLINES[contrast], greyHue, greyChroma * 2, base),
    text,
    textMuted: readableOn(hardest, reads + 1.4, greyHue, greyChroma * 3, base),
    textFaint: readableOn(hardest, reads, greyHue, greyChroma * 3, base),
    accent: accentOn,
    accentText: contrastRatio(white, accentOn) >= contrastRatio(black, accentOn) ? white : black,
    accentSoft,
    accentInk: readableOn(hardest, reads + 1.2, hue, chroma, base),
    danger: readableOn(hardest, reads, 27, 0.16, base),
  };
}
