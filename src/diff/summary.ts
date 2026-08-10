/** The sentence beside the pictures.
 *
 * DIFFERENTIATORS §5: *"Moved the button 8px down, made it your brand blue,
 * added a gentle hover."* Not "modified Button.tsx, updated Tailwind classes."
 * The headline half of that is already written — `src/history/titles.ts` turns
 * what somebody asked for and what changed on disk into exactly that sentence,
 * and it is swept for retired vocabulary by a test. Rewriting it here would
 * mean two voices, one of them unaudited.
 *
 * So this module adds the one thing titles cannot know, because titles never
 * see a picture: **where on the page it happened.** "Made the header sticky"
 * plus "one area changed, across the top" is a designer's whole answer to "what
 * did that do?" — the intent and the evidence, in two short clauses.
 *
 * Pure, like the titles it leans on. Same change, same words, every time.
 */

import { titleFor } from '../history/titles';
import type { ChangedArea } from './regions';

export type Told = {
  /** One line, past tense: "Made the header sticky". */
  headline: string;
  /** Where it landed: "Two areas changed, near the top." Null when the picture
   *  has nothing to add — an honest silence rather than a filler clause. */
  where: string | null;
};

export type WhatHappened = {
  /** Project-relative paths that changed. */
  files: readonly string[];
  /** What the person asked for, in their own words. */
  instruction?: string | undefined;
  areas: readonly ChangedArea[];
  /** How much of the picture is different, 0–1. */
  fraction: number;
};

/** Past this much of the page, naming areas is silly — it is not "three areas
 *  near the top", it is a different page. */
const REDRAWN = 0.55;

const COUNTS = ['no', 'One', 'Two', 'Three', 'Four', 'Five', 'Six'] as const;

function counted(many: number): string {
  return COUNTS[many] ?? String(many);
}

/** Down the page, in the three bands anybody would describe. */
function band(area: ChangedArea): 'top' | 'middle' | 'bottom' {
  const middle = area.y + area.height / 2;
  if (middle < 0.34) return 'top';
  if (middle < 0.67) return 'middle';
  return 'bottom';
}

/** Across the page. Only ever mentioned for a single narrow area — for
 *  anything wider it is noise, and for several areas it is a paragraph. */
function side(area: ChangedArea): 'left' | 'right' | null {
  if (area.width > 0.5) return null;
  const middle = area.x + area.width / 2;
  if (middle < 0.34) return 'left';
  if (middle > 0.66) return 'right';
  return null;
}

const BANDS: Readonly<Record<'top' | 'middle' | 'bottom', string>> = {
  top: 'near the top',
  middle: 'in the middle',
  bottom: 'near the bottom',
};

/** One area, described the way somebody would point at it. */
function placeOf(area: ChangedArea): string {
  const across = area.width > 0.75 ? 'right across' : null;
  const where = BANDS[band(area)];
  if (across !== null) return `${across} ${where.replace(/^near /, '')}`;
  const which = side(area);
  return which === null ? where : `${where} on the ${which}`;
}

/**
 * Where the change landed, in one clause, or null.
 *
 * Null in the two cases where a picture cannot say anything useful: nothing
 * measurably moved, or so much of it moved that pointing at parts of it would
 * be misleading. Both get an honest sentence from the caller instead of a
 * confident one from here.
 */
export function whereItLanded(areas: readonly ChangedArea[], fraction: number): string | null {
  if (areas.length === 0) return null;
  if (fraction >= REDRAWN) return 'Most of the page looks different.';

  const first = areas[0];
  if (first === undefined) return null;
  if (areas.length === 1) return `One area changed, ${placeOf(first)}.`;

  // Several areas in the same band read as one region of the page, which is
  // both true and easier to look for than a list of coordinates.
  const bands = new Set(areas.map(band));
  if (bands.size === 1) {
    return `${counted(areas.length)} areas changed, ${BANDS[band(first)]}.`;
  }
  return `${counted(areas.length)} areas changed, down the page.`;
}

/**
 * What to say beside the pictures.
 *
 * The headline is `titleFor`'s, unchanged — same words the version timeline
 * uses for the same moment, which is deliberate: the strip in the conversation
 * and the entry in the rail are the same event, and reading two different
 * descriptions of it is how somebody starts to wonder which one is true.
 */
export function tellWhatHappened(what: WhatHappened): Told {
  return {
    headline: titleFor({
      files: what.files.map((path) => ({ path })),
      instruction: what.instruction,
      boundary: 'turn-ended',
    }),
    where: whereItLanded(what.areas, what.fraction),
  };
}
