/** How the app looks, as eleven answers rather than a stylesheet.
 *
 * The five finishes in `lib/theme.ts` only ever changed colour. Everything else
 * a person might want to move — how tight the spacing is, how round the corners
 * are, which face the interface wears, how much anything moves — was a literal
 * in `styles/tokens.css` and out of reach.
 *
 * This is the whole of it: a small readable record, and one function that turns
 * it into custom properties the app already reads. Nothing here invents a token
 * name. If a value is not declared in `styles/tokens.css` it cannot be written
 * here either, because a property nothing reads is a control that does nothing.
 *
 * Pure. Injecting the stylesheet and saving the choice both happen at the edge.
 */

import { rgbFrom, surfacesFrom, type Base, type Contrast, type Tone } from './palette-oklch';

export type { Base, Contrast, Tone } from './palette-oklch';

export type Radius = 'sharp' | 'soft' | 'round';
export type Density = 'compact' | 'comfortable' | 'spacious';
export type Motion = 'full' | 'reduced' | 'off';

export type Appearance = {
  /** Any hue, written as hex or `oklch()`. Everything else colour follows it. */
  accent: string;
  tone: Tone;
  contrast: Contrast;
  radius: Radius;
  density: Density;
  uiFont: string;
  codeFont: string;
  ligatures: boolean;
  motion: Motion;
};

/** What ships: the accent the app has always worn, and the spacing every
 *  existing screen was drawn against. Changing a value here re-draws the app
 *  for everybody who has never opened this panel. */
export const defaultAppearance: Appearance = {
  accent: '#b8492c',
  tone: 'warm',
  contrast: 'normal',
  radius: 'soft',
  density: 'comfortable',
  uiFont: 'Satoshi',
  codeFont: 'SF Mono',
  ligatures: true,
  motion: 'full',
};

export const appearanceWords = {
  name: 'Appearance',
  note: 'One colour and a handful of choices. The rest of the palette is worked out from them.',
  accent: {
    name: 'Accent',
    hint: 'Any colour. Surfaces, borders and text are derived from it, and every pair is measured before it lands.',
  },
  tone: {
    name: 'Tone',
    hint: 'How warm the greys underneath are.',
    warm: 'Warm',
    neutral: 'Neutral',
    cool: 'Cool',
  },
  contrast: {
    name: 'Contrast',
    hint: 'Normal clears AA everywhere. High pushes every pair of colours to 7:1.',
    normal: 'Normal',
    high: 'High',
  },
  radius: { name: 'Corners', hint: 'How round every edge is.', sharp: 'Sharp', soft: 'Soft', round: 'Round' },
  density: {
    name: 'Density',
    hint: 'How much room the app gives itself.',
    compact: 'Compact',
    comfortable: 'Comfortable',
    spacious: 'Spacious',
  },
  uiFont: { name: 'Interface font', hint: 'Satoshi comes with Graphe. Name any font on this computer instead.' },
  codeFont: { name: 'Code font', hint: 'What code, paths and commands are set in.' },
  ligatures: { name: 'Ligatures in code', hint: 'Draw → and ≠ as one mark, where the font has them.' },
  motion: {
    name: 'Motion',
    hint: 'Off is instant everywhere. Reduced keeps the direction and drops the distance.',
    full: 'Full',
    reduced: 'Reduced',
    off: 'Off',
  },
  system: 'This computer’s font',
} as const;

/* -------------------------------------------------------------------------- */
/* The scales                                                                  */
/* -------------------------------------------------------------------------- */

/** As declared in `styles/tokens.css`. Deliberately not a uniform ramp — even
 *  padding everywhere reads as a template. */
const SPACE: readonly number[] = [4, 8, 12, 16, 24, 32, 48, 72];

const TEXT: readonly (readonly [string, number])[] = [
  ['2xs', 0.75],
  ['xs', 0.75],
  ['sm', 0.8125],
  ['base', 0.9375],
  ['lg', 1.125],
  ['xl', 1.5],
  ['2xl', 2],
];

const ROOM: Readonly<Record<Density, number>> = { compact: 0.875, comfortable: 1, spacious: 1.15 };

/** Type moves less than space does: 15px of prose at comfortable, 14 compact,
 *  16 spacious. Scaling it as hard as the padding turns compact into a squint. */
const SIZE: Readonly<Record<Density, number>> = { compact: 14 / 15, comfortable: 1, spacious: 16 / 15 };

/** Written out rather than a factor, because sharp is not soft times a number —
 *  it is a decision about what an edge looks like. */
const RADIUS: Readonly<Record<Radius, readonly [number, number, number]>> = {
  sharp: [2, 3, 4],
  soft: [6, 10, 14],
  round: [10, 16, 22],
};

/** Reduced shortens rather than removes: a panel that appears with no direction
 *  at all leaves people looking for where it came from. Off means off. */
const TIMING: Readonly<
  Record<Motion, { micro: number; ui: number; large: number; exit: number; stagger: number }>
> = {
  full: { micro: 120, ui: 200, large: 280, exit: 160, stagger: 40 },
  reduced: { micro: 80, ui: 100, large: 120, exit: 80, stagger: 0 },
  off: { micro: 0, ui: 0, large: 0, exit: 0, stagger: 0 },
};

const UI_FALLBACK =
  "ui-sans-serif, -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', system-ui, sans-serif";
const CODE_FALLBACK = "ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, monospace";

/** The name that means "whatever this computer uses" rather than a face. */
export const SYSTEM_FONT = 'System';

/** A font name goes into a stylesheet, so it is checked rather than escaped:
 *  a family is letters, digits and the three marks families actually use. */
const FONT_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$/;

function fontStack(name: string, fallback: string): string {
  const said = name.trim();
  if (said === '' || said.toLowerCase() === SYSTEM_FONT.toLowerCase()) return fallback;
  if (!FONT_NAME.test(said)) return fallback;
  return `'${said}', ${fallback}`;
}

function rem(size: number): string {
  return `${String(Math.round(size * 10000) / 10000)}rem`;
}

/* -------------------------------------------------------------------------- */
/* Tokens                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The custom properties this appearance sets.
 *
 * `on` is which way the colour ladder runs, because light and dark stays a
 * choice of its own — the accent decides everything else about the palette.
 */
export function tokensFor(one: Appearance, on: Base = 'light'): Readonly<Record<string, string>> {
  const surfaces = surfacesFrom(one.accent, one.tone, one.contrast, on);
  const room = ROOM[one.density];
  const size = SIZE[one.density];
  const [small, medium, large] = RADIUS[one.radius];
  const timing = TIMING[one.motion];

  const tokens: Record<string, string> = {
    '--bg': surfaces.bg,
    '--bg-raised': surfaces.bgRaised,
    '--bg-sunken': surfaces.bgSunken,
    '--border': surfaces.border,
    '--border-strong': surfaces.borderStrong,
    '--border-control': surfaces.borderControl,
    '--text': surfaces.text,
    '--text-muted': surfaces.textMuted,
    '--text-faint': surfaces.textFaint,
    '--accent': surfaces.accent,
    '--accent-text': surfaces.accentText,
    '--accent-soft': surfaces.accentSoft,
    '--accent-ink': surfaces.accentInk,
    '--danger': surfaces.danger,

    '--radius-sm': `${String(small)}px`,
    '--radius-md': `${String(medium)}px`,
    '--radius-lg': `${String(large)}px`,

    '--dur-micro': `${String(timing.micro)}ms`,
    '--dur-ui': `${String(timing.ui)}ms`,
    '--dur-large': `${String(timing.large)}ms`,
    '--dur-exit': `${String(timing.exit)}ms`,
    '--stagger': `${String(timing.stagger)}ms`,

    '--font-ui': fontStack(one.uiFont, UI_FALLBACK),
    '--font-mono': fontStack(one.codeFont, CODE_FALLBACK),
  };

  SPACE.forEach((step, at) => {
    tokens[`--space-${String(at + 1)}`] = `${String(Math.round(step * room))}px`;
  });
  for (const [name, step] of TEXT) {
    tokens[`--text-${name}`] = rem(step * size);
  }

  return tokens;
}

/** The block to put in front of the stylesheet's own. `:root` by default, so a
 *  dark palette can be written under a `[data-theme]` selector instead. */
export function asCss(tokens: Readonly<Record<string, string>>, selector = ':root'): string {
  const lines = Object.entries(tokens).map(([name, value]) => `  ${name}: ${value};`);
  return `${selector} {\n${lines.join('\n')}\n}`;
}

/** Everything this appearance changes, ready to inject.
 *
 * Ligatures are a property rather than a value, so they are the one thing that
 * cannot be a token — they land on the elements a code font is set on. */
/**
 * The whole appearance as one stylesheet.
 *
 * Matched at `:root, :root[data-theme]` rather than a bare `:root`, because a
 * theme's own block is `:root[data-theme='graphe']` and beats a plain `:root`
 * on specificity — a token that loses that tie is a control that does nothing.
 */
export function cssFor(one: Appearance, on: Base = 'light'): string {
  const root = asCss(tokensFor(one, on), ':root, :root[data-theme]');
  if (one.ligatures) return root;
  return `${root}\ncode, pre, kbd, samp {\n  font-variant-ligatures: none;\n}`;
}

/* -------------------------------------------------------------------------- */
/* Reading it back                                                             */
/* -------------------------------------------------------------------------- */

const TONES: readonly Tone[] = ['warm', 'neutral', 'cool'];
const CONTRASTS: readonly Contrast[] = ['normal', 'high'];
const RADII: readonly Radius[] = ['sharp', 'soft', 'round'];
const DENSITIES: readonly Density[] = ['compact', 'comfortable', 'spacious'];
const MOTIONS: readonly Motion[] = ['full', 'reduced', 'off'];

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

/** Anything unreadable is the shipped answer for that one setting and nothing
 *  more: a file somebody hand-edited badly should cost them the line they got
 *  wrong, not the whole appearance. */
export function readAppearance(raw: unknown): Appearance {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { ...defaultAppearance };
  const saved = raw as Record<string, unknown>;

  const accent = saved['accent'];
  const uiFont = saved['uiFont'];
  const codeFont = saved['codeFont'];
  const ligatures = saved['ligatures'];

  return {
    accent:
      typeof accent === 'string' && rgbFrom(accent) !== null ? accent.trim() : defaultAppearance.accent,
    tone: oneOf(saved['tone'], TONES, defaultAppearance.tone),
    contrast: oneOf(saved['contrast'], CONTRASTS, defaultAppearance.contrast),
    radius: oneOf(saved['radius'], RADII, defaultAppearance.radius),
    density: oneOf(saved['density'], DENSITIES, defaultAppearance.density),
    uiFont: readFont(uiFont, defaultAppearance.uiFont),
    codeFont: readFont(codeFont, defaultAppearance.codeFont),
    ligatures: typeof ligatures === 'boolean' ? ligatures : defaultAppearance.ligatures,
    motion: oneOf(saved['motion'], MOTIONS, defaultAppearance.motion),
  };
}

function readFont(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const said = value.trim();
  if (said.toLowerCase() === SYSTEM_FONT.toLowerCase()) return SYSTEM_FONT;
  return FONT_NAME.test(said) ? said : fallback;
}
