/** Which shelf of the styles panel a value belongs on.
 *
 * Sorting, naming and ordering only — nothing here renders, reads a disk or
 * holds state, so the shape of the panel can be tested without a screen.
 */

import type { StyleToken } from '../lib/ipc';

export type GroupId = 'colour' | 'type' | 'spacing' | 'corners' | 'shadow' | 'size' | 'other';

/** How a value is changed: a picker, a slider along the project's own scale, or
 *  nothing at all for something that can only be looked at. */
export type Control = 'colour' | 'steps' | 'none';

export type StyleGroup = {
  id: GroupId;
  /** What a designer calls this shelf. */
  title: string;
  tokens: readonly StyleToken[];
  /** Left off the end of a very long group. */
  hidden: number;
};

/** Colour first because it is what anybody came here for; the leftovers last. */
const SHELVES: readonly { id: GroupId; title: string }[] = [
  { id: 'colour', title: 'Colour' },
  { id: 'type', title: 'Type' },
  { id: 'spacing', title: 'Spacing' },
  { id: 'corners', title: 'Corners' },
  { id: 'shadow', title: 'Shadow' },
  { id: 'size', title: 'Sizes' },
  { id: 'other', title: 'Other' },
];

export const GROUP_ORDER: readonly GroupId[] = SHELVES.map((shelf) => shelf.id);

/** Long enough that a real palette arrives whole, short enough that a generated
 *  file cannot turn the panel into a scroll. */
export const MOST_IN_A_GROUP = 36;

/* -------------------------------------------------------------------- words */

const TEXT_WORDS = new Set([
  'text',
  'font',
  'type',
  'leading',
  'copy',
  'body',
  'heading',
  'title',
  'display',
  'label',
  'caption',
  'prose',
]);

function wordsIn(name: string): string[] {
  return name
    .replace(/^--/, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0);
}

/** `--accent-soft` as somebody would say it out loud. */
export function readable(name: string): string {
  const said = wordsIn(name).join(' ');
  return said.length > 0 ? said : name.trim();
}

/* --------------------------------------------------------------- measuring */

const AMOUNT = /^(-?(?:\d+\.?\d*|\.\d+))\s*([a-z%]*)$/i;
const ROOT_PX = 16;

type Measure = { amount: number; unit: string };

function measure(value: string): Measure | null {
  const match = AMOUNT.exec(value.trim());
  const amount = match?.[1];
  if (amount === undefined) return null;
  const parsed = Number(amount);
  if (!Number.isFinite(parsed)) return null;
  return { amount: parsed, unit: (match?.[2] ?? '').toLowerCase() };
}

/** Comparable pixels, or null for a unit that cannot be compared to one. */
function inPixels(value: string): number | null {
  const here = measure(value);
  if (!here) return null;
  if (here.unit === '' || here.unit === 'px') return here.amount;
  if (here.unit === 'rem' || here.unit === 'em') return here.amount * ROOT_PX;
  if (here.unit === 'pt') return (here.amount * 4) / 3;
  return null;
}

/** Small enough to stay in a narrow panel, large enough that the step between
 *  two sizes is visible. Null when the value is not a size at all. */
export function specimenSize(value: string, smallest = 9, biggest = 34): number | null {
  const px = inPixels(value);
  if (px === null || px <= 0) return null;
  return Math.round(Math.min(biggest, Math.max(smallest, px)) * 10) / 10;
}

/* ---------------------------------------------------------- classification */

export function controlFor(token: StyleToken): Control {
  if (token.kind === 'colour') return 'colour';
  return token.steps.length > 0 ? 'steps' : 'none';
}

/** A shadow is worth drawing even though no slider can move it; a font stack
 *  with nothing to nudge is still the answer to “what type is this?” and must
 *  be shown, not hidden — the design system is where somebody comes to read
 *  fonts. Everything else a slider cannot move, we do not need. */
export function canShow(token: StyleToken): boolean {
  if (token.kind === 'shadow' || controlFor(token) !== 'none') return true;
  return wordsIn(token.name).some((word) => TEXT_WORDS.has(word));
}

export function groupOf(token: StyleToken): GroupId {
  switch (token.kind) {
    case 'colour':
      return 'colour';
    case 'shadow':
      return 'shadow';
    case 'radius':
      return 'corners';
    case 'space':
      return 'spacing';
    case 'size':
      return wordsIn(token.name).some((word) => TEXT_WORDS.has(word)) ? 'type' : 'size';
    default:
      /* A font stack reads as part of the type system, not as an 'other'. */
      return wordsIn(token.name).some((word) => TEXT_WORDS.has(word)) ? 'type' : 'other';
  }
}

/* ------------------------------------------------------------------ sorting */

/** A scale reads as a scale when it climbs. A palette reads as the file, so
 *  colours and shadows keep the order somebody wrote them in. */
const CLIMBS: ReadonlySet<GroupId> = new Set<GroupId>(['type', 'spacing', 'corners', 'size']);

function climbing(tokens: readonly StyleToken[]): readonly StyleToken[] {
  /* Anything unmeasurable sits after the scale rather than inside it. */
  return tokens
    .map((token, at) => ({ token, at, px: inPixels(token.value) ?? Infinity }))
    .sort((a, b) => (a.px === b.px ? a.at - b.at : a.px - b.px))
    .map((one) => one.token);
}

/* ---------------------------------------------------------------- grouping */

/**
 * Every value the panel can offer, on its shelf.
 *
 * A name declared more than once — the same colour restated per theme — keeps
 * its first declaration, which is the one a nudge writes back to. Empty shelves
 * do not come back at all.
 */
export function groupTokens(
  tokens: readonly StyleToken[],
  most: number = MOST_IN_A_GROUP,
): readonly StyleGroup[] {
  const seen = new Set<string>();
  const bins = new Map<GroupId, StyleToken[]>();

  for (const token of tokens) {
    if (!canShow(token) || seen.has(token.name)) continue;
    seen.add(token.name);
    const id = groupOf(token);
    const bin = bins.get(id);
    if (bin) bin.push(token);
    else bins.set(id, [token]);
  }

  const groups: StyleGroup[] = [];
  for (const shelf of SHELVES) {
    const bin = bins.get(shelf.id);
    if (bin === undefined || bin.length === 0) continue;
    const ordered = CLIMBS.has(shelf.id) ? climbing(bin) : bin;
    const kept = ordered.slice(0, Math.max(0, most));
    groups.push({
      id: shelf.id,
      title: shelf.title,
      tokens: kept,
      hidden: ordered.length - kept.length,
    });
  }
  return groups;
}

/** How many the panel would draw in total, cap and all. */
export function countShown(groups: readonly StyleGroup[]): number {
  return groups.reduce((sum, group) => sum + group.tokens.length, 0);
}
