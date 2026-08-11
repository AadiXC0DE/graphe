/** "Does this work on a phone?" — one button, answered with pictures.
 *
 * Designers think in breakpoints, so the three widths are named the way one
 * would say them out loud rather than after any particular device. Everything
 * here is arithmetic and sentences: the photographs are taken elsewhere.
 */

export type Width = {
  id: string;
  /** What a designer calls it. Never a model number. */
  name: string;
  width: number;
  height: number;
};

/** Three widths, small to large. Current mainstream sizes rather than the
 *  historical 375 / 768 / 1024, which describe hardware nobody is holding. */
export const WIDTHS: readonly Width[] = [
  { id: 'phone', name: 'Phone', width: 390, height: 844 },
  { id: 'tablet', name: 'Tablet', width: 834, height: 1194 },
  { id: 'desktop', name: 'Desktop', width: 1440, height: 900 },
];

/** One of the three, photographed. A missing picture and a picture with
 *  something wrong in it are different things, so they are different fields. */
export type Look = {
  id: string;
  name: string;
  width: number;
  /** The picture, or null when it could not be taken. */
  shot: string | null;
  /** Something worth saying about this width, already a sentence. */
  trouble: string | null;
};

/* -------------------------------------------------------------------- words */

function lower(name: string): string {
  return name.toLowerCase();
}

function listOf(names: readonly string[]): string {
  const said = names.map(lower);
  if (said.length <= 1) return said[0] ?? '';
  return `${said.slice(0, -1).join(', ')} and ${said[said.length - 1] ?? ''}`;
}

function article(name: string): string {
  return /^[aeiou]/i.test(name) ? 'an' : 'a';
}

function fullStop(sentence: string): string {
  return /[.!?]$/.test(sentence.trim()) ? sentence.trim() : `${sentence.trim()}.`;
}

/**
 * The trio in one plain sentence.
 *
 * `ok` is true only when all three came out and none of them had anything wrong
 * with it — a width that failed to render is never quietly counted as a pass.
 */
export function readsWell(shots: readonly Look[]): { ok: boolean; says: string } {
  if (shots.length === 0) return { ok: false, says: responsive.empty };

  const failed = shots.filter((look) => look.shot === null);
  const flagged = shots.filter((look) => look.shot !== null && look.trouble !== null);
  const fine = shots.filter((look) => look.shot !== null && look.trouble === null);

  if (failed.length === 0 && flagged.length === 0) {
    return { ok: true, says: `Looks right on the ${listOf(fine.map((look) => look.name))}.` };
  }

  const parts: string[] = [];
  if (fine.length > 0) parts.push(`Looks right on the ${listOf(fine.map((look) => look.name))}.`);
  for (const look of flagged) parts.push(fullStop(look.trouble ?? ''));
  if (failed.length > 0) {
    const which = listOf(failed.map((look) => look.name));
    parts.push(
      failed.length === 1
        ? `The ${which} one didn’t come out.`
        : `The ${which} ones didn’t come out.`,
    );
  }

  return { ok: false, says: parts.join(' ') };
}

/* ----------------------------------------------------------------- overflow */

/**
 * Is something on the page wider than the screen it is on?
 *
 * The single most useful responsive finding there is, and the one a picture
 * alone will not tell you. Exactly as wide as the screen fits, so the
 * comparison is strict.
 */
export function overflowing(width: number, contentWidth: number): boolean {
  if (!Number.isFinite(width) || !Number.isFinite(contentWidth)) return false;
  if (width <= 0) return false;
  return contentWidth > width;
}

/** How it is said. The number is real, because "it doesn't fit" sends somebody
 *  hunting and "40px wider" tells them what to change. */
export function saysOverflow(name: string, by: number): string {
  const over = Math.max(0, Math.round(by));
  return `Something on the page is ${over}px wider than ${article(name)} ${lower(name)}, so it scrolls sideways.`;
}

/* --------------------------------------------------------------------- copy */

/** The button, and what sits in its place before anybody presses it. */
export const responsive = {
  button: 'Does this work on a phone?',
  working: 'Having a look on a phone, a tablet and a desktop…',
  heading: 'On a phone, a tablet and a desktop',
  empty: 'No pictures yet — ask, and I’ll look at it at all three widths.',
  again: 'Look again',
};
