/** "Does this work on a phone?" — one button, answered with pictures.
 *
 * Designers think in breakpoints, so the widths are named the way one would say
 * them out loud rather than after any particular device. Everything here is
 * arithmetic and sentences: the photographs are taken elsewhere.
 *
 * The sizes below are the fallback. A project that has said which sizes it
 * designs at, in its own stylesheets, is looked at those instead — reading them
 * out of the file is the rest of this module.
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

/** How far past the edge, rounded. Zero when it fits. */
export function overflowsBy(width: number, contentWidth: number): number {
  return overflowing(width, contentWidth) ? Math.round(contentWidth - width) : 0;
}

export type Degree = 'fits' | 'slightly' | 'badly';

/** A few pixels is somebody's shadow or a rounding error in a margin; more than
 *  that is an element that has never met this width. */
const A_HAIR = 8;
const A_HAIR_OF = 0.02;

export function howBadly(width: number, contentWidth: number): Degree {
  const over = overflowsBy(width, contentWidth);
  if (over <= 0) return 'fits';
  return over > Math.max(A_HAIR, width * A_HAIR_OF) ? 'badly' : 'slightly';
}

/** The whole finding in one sentence, or null when there is nothing to say. */
export function saysHowItHolds(
  name: string,
  width: number,
  contentWidth: number,
): string | null {
  const degree = howBadly(width, contentWidth);
  if (degree === 'fits') return null;
  const over = overflowsBy(width, contentWidth);
  if (degree === 'badly') return saysOverflow(name, over);
  return `Something on the page sits ${over}px past the edge of ${article(name)} ${lower(name)}: a hair, but it scrolls sideways.`;
}

/** What goes on the picture itself. A width nobody could photograph and a width
 *  photographed with a fault in it read differently, so they carry a tone. */
export type Flag = {
  tone: 'fine' | 'trouble' | 'missing';
  /** Two or three words, over the corner of the picture. */
  badge: string | null;
  /** The finding in full, or null when the badge has said all of it. */
  says: string | null;
};

export function flagOf(look: Look): Flag {
  if (look.shot === null) return { tone: 'missing', badge: responsive.missing, says: null };
  const trouble = (look.trouble ?? '').trim();
  if (trouble === '') return { tone: 'fine', badge: null, says: null };
  return { tone: 'trouble', badge: responsive.flagged, says: fullStop(trouble) };
}

/* ------------------------------------------------------- the project's sizes */

/** What a browser calls one of ours when the page has not said otherwise. */
const ROOT_PX = 16;

/** Under this is a phone, and so on up. The names are the ones a designer says
 *  out loud; nothing here is a device. */
const BANDS: readonly { under: number; id: string; name: string; height: number }[] = [
  { under: 520, id: 'phone', name: 'Phone', height: 844 },
  { under: 900, id: 'tablet', name: 'Tablet', height: 1194 },
  { under: 1280, id: 'laptop', name: 'Laptop', height: 900 },
  { under: Number.POSITIVE_INFINITY, id: 'desktop', name: 'Desktop', height: 900 },
];

const FALLBACK = BANDS[BANDS.length - 1] ?? {
  under: Number.POSITIVE_INFINITY,
  id: 'desktop',
  name: 'Desktop',
  height: 900,
};

function bandFor(width: number): (typeof BANDS)[number] {
  return BANDS.find((band) => width < band.under) ?? FALLBACK;
}

/** Two widths this close apart are the same size twice — 767 and 768 are the
 *  two halves of one breakpoint, not two things to look at. */
const NEARBY = 16;
/** Outside this a number in a query is a guard rail, not a size anybody designs
 *  at: `min-width: 1px`, `max-width: 5000px`. */
const SMALLEST = 240;
const LARGEST = 2560;
/** More pictures than this and each one is too small to read. */
const MOST = 4;
/** A size at or under this counts as answering "does it work on a phone". */
const HANDHELD = 520;
/** And one at or over this is the full-width layout. */
const ROOMY = 1200;

/** What a designer calls a page this wide. */
export function nameForWidth(width: number): string {
  return bandFor(Number.isFinite(width) ? width : 0).name;
}

/** One width, ready to be photographed. */
export function sizeAt(width: number): Width {
  const wide = Number.isFinite(width) ? Math.max(1, Math.round(width)) : SMALLEST;
  const band = bandFor(wide);
  return { id: band.id, name: band.name, width: wide, height: band.height };
}

/* ------------------------------------------------------------------- reading */

const UNITS: Readonly<Record<string, number>> = {
  px: 1,
  pt: 96 / 72,
  pc: 16,
  in: 96,
  cm: 96 / 2.54,
  mm: 96 / 25.4,
  q: 96 / 101.6,
};

function lengthIn(value: string, rootPx: number): number | null {
  const found = /^(-?\d*\.?\d+)(px|rem|em|pt|pc|in|cm|mm|q)?$/i.exec(value.trim());
  if (found === null) return null;
  const size = Number(found[1]);
  if (!Number.isFinite(size)) return null;
  const unit = (found[2] ?? '').toLowerCase();
  if (unit === '') return size === 0 ? 0 : null;
  if (unit === 'rem' || unit === 'em') return size * rootPx;
  return size * (UNITS[unit] ?? 1);
}

/** Comments and quoted text blanked, offsets kept, so a `@media` inside either
 *  one is not mistaken for a size the project designs at. */
function blankOut(css: string): string {
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
      while (j < css.length && css[j] !== ch && css[j] !== '\n') j += css[j] === '\\' ? 2 : 1;
      const stop = Math.min(j, css.length - 1);
      for (let k = i; k <= stop; k += 1) if (out[k] !== '\n') out[k] = ' ';
      i = j + 1;
      continue;
    }
    i += 1;
  }
  return out.join('');
}

/** The root size the project has set, which is what its rem breakpoints mean. */
function rootPixels(css: string): number {
  let root = ROOT_PX;
  for (const rule of css.matchAll(/(?:^|[},;])\s*(?::root|html)\b[^{}]*\{([^{}]*)\}/g)) {
    const declared = /font-size\s*:\s*([^;}]+)/i.exec(rule[1] ?? '');
    if (declared === null) continue;
    const value = (declared[1] ?? '').trim();
    const percent = /^(-?\d*\.?\d+)%$/.exec(value);
    const read =
      percent === null ? lengthIn(value, ROOT_PX) : (Number(percent[1]) / 100) * ROOT_PX;
    if (read !== null && read >= 4 && read <= 64) root = read;
  }
  return root;
}

/** Everything between `@media` and the block it opens. Nesting needs no special
 *  handling: an inner one is another `@media` with a condition of its own. */
function conditions(css: string): string[] {
  const out: string[] = [];
  for (const at of css.matchAll(/@media\b/gi)) {
    const start = (at.index ?? 0) + at[0].length;
    let depth = 0;
    let i = start;
    // A bracket somebody never closed would otherwise swallow the whole file,
    // so the first brace is the fallback end of the condition.
    let brace = -1;
    for (; i < css.length; i += 1) {
      const ch = css[i];
      if (ch === '(') depth += 1;
      else if (ch === ')') depth = Math.max(0, depth - 1);
      else if (ch === '{' || ch === ';') {
        if (depth === 0) break;
        if (brace === -1) brace = i;
      }
    }
    out.push(css.slice(start, depth > 0 && brace !== -1 ? brace : i));
  }
  return out;
}

function splitOnCommas(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (ch === ',' && depth === 0) {
      out.push(text.slice(from, i));
      from = i + 1;
    }
  }
  out.push(text.slice(from));
  return out;
}

/** Every parenthesised part, however deeply `and`/`or` have nested them. */
function everyGroup(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '(') {
      if (depth === 0) start = i + 1;
      depth += 1;
    } else if (ch === ')') {
      depth = Math.max(0, depth - 1);
      if (depth === 0 && start >= 0) {
        out.push(text.slice(start, i));
        start = -1;
      }
    }
  }
  // An unclosed bracket is still worth reading — a half-typed file is a file.
  if (depth > 0 && start >= 0) out.push(text.slice(start));
  return out.flatMap((group) => (group.includes('(') ? everyGroup(group) : [group]));
}

/** Paper and screen readers have no width worth photographing. */
function forPaper(query: string): boolean {
  const spoken = query.replace(/\([^()]*\)/g, ' ').toLowerCase();
  return /\b(print|speech)\b/.test(spoken);
}

/** The widths one condition names. Strict comparisons step a pixel inward, so
 *  the number is always inside the design the query is guarding. */
function widthsInFeature(text: string, rootPx: number): number[] {
  const one = text.trim().toLowerCase();
  if (one === '') return [];

  const bounded = /^(.+?)\s*(<=|<)\s*width\s*(<=|<)\s*(.+)$/.exec(one);
  if (bounded !== null) {
    const low = lengthIn(bounded[1] ?? '', rootPx);
    const high = lengthIn(bounded[4] ?? '', rootPx);
    const out: number[] = [];
    if (low !== null) out.push(bounded[2] === '<' ? low + 1 : low);
    if (high !== null) out.push(bounded[3] === '<' ? high - 1 : high);
    return out;
  }

  const named = /^(min|max)-width\s*:\s*(.+)$/.exec(one);
  if (named !== null) {
    const px = lengthIn(named[2] ?? '', rootPx);
    return px === null ? [] : [px];
  }

  const exact = /^width\s*:\s*(.+)$/.exec(one);
  if (exact !== null) {
    const px = lengthIn(exact[1] ?? '', rootPx);
    return px === null ? [] : [px];
  }

  const after = /^width\s*(<=|>=|<|>|=)\s*(.+)$/.exec(one);
  if (after !== null) {
    const px = lengthIn(after[2] ?? '', rootPx);
    return px === null ? [] : [stepIn(px, after[1] ?? '=')];
  }

  const before = /^(.+?)\s*(<=|>=|<|>|=)\s*width$/.exec(one);
  if (before !== null) {
    const px = lengthIn(before[1] ?? '', rootPx);
    return px === null ? [] : [stepIn(px, flip(before[2] ?? '='))];
  }

  return [];
}

function flip(operator: string): string {
  if (operator === '<') return '>';
  if (operator === '<=') return '>=';
  if (operator === '>') return '<';
  if (operator === '>=') return '<=';
  return operator;
}

function stepIn(px: number, operator: string): number {
  if (operator === '>') return px + 1;
  if (operator === '<') return px - 1;
  return px;
}

/** Rounded, sane, in order, and never the same size twice. */
function tidy(widths: readonly number[]): number[] {
  const sane = widths
    .filter((width) => Number.isFinite(width))
    .map((width) => Math.round(width))
    .filter((width) => width >= SMALLEST && width <= LARGEST)
    .sort((one, other) => one - other);

  const kept: number[] = [];
  for (const width of sane) {
    const last = kept[kept.length - 1];
    if (last === undefined || width - last > NEARBY) kept.push(width);
  }
  return kept;
}

/** The sizes a stylesheet says the project designs at. */
export function widthsInCss(css: string): readonly number[] {
  if (typeof css !== 'string' || css.trim() === '') return [];
  const text = blankOut(css);
  const rootPx = rootPixels(text);
  const found: number[] = [];
  for (const condition of conditions(text)) {
    for (const query of splitOnCommas(condition)) {
      if (forPaper(query)) continue;
      for (const group of everyGroup(query)) found.push(...widthsInFeature(group, rootPx));
    }
  }
  return tidy(found);
}

/** Keep the ends and thin the middle: the narrowest and widest are the two that
 *  answer the question, and the ones between are a sample. */
function spread(widths: readonly number[], most: number): number[] {
  if (widths.length <= most) return [...widths];
  const out: number[] = [];
  for (let i = 0; i < most; i += 1) {
    const at = Math.round((i * (widths.length - 1)) / (most - 1));
    const width = widths[at];
    if (width !== undefined && !out.includes(width)) out.push(width);
  }
  return out;
}

/** Two sizes in the same band share a name, so the id carries the difference. */
function named(widths: readonly number[]): Width[] {
  const seen = new Map<string, number>();
  return widths.map((width) => {
    const size = sizeAt(width);
    const already = (seen.get(size.id) ?? 0) + 1;
    seen.set(size.id, already);
    return already === 1 ? size : { ...size, id: `${size.id}-${already}` };
  });
}

/**
 * Which sizes to look at, given the project's own stylesheets.
 *
 * A project that has never written a media query still gets the three defaults.
 * One that has gets its own, plus a phone and a full-width look if its queries
 * never reach that far — the question is whether the page holds up everywhere,
 * not only where somebody remembered to think about it.
 */
export function sizesFor(sheets: readonly string[]): readonly Width[] {
  const found = tidy(sheets.flatMap((sheet) => [...widthsInCss(sheet)]));
  if (found.length === 0) return WIDTHS;

  const all = [...found];
  const phone = WIDTHS[0]?.width ?? 390;
  const desktop = WIDTHS[WIDTHS.length - 1]?.width ?? 1440;
  if (!all.some((width) => width <= HANDHELD)) all.push(phone);
  if (!all.some((width) => width >= ROOMY)) all.push(desktop);

  return named(spread(tidy(all), MOST));
}

/* --------------------------------------------------------------------- copy */

/** The button, and what sits in its place before anybody presses it. */
export const responsive = {
  button: 'Does this work on a phone?',
  working: 'Having a look at every size…',
  empty: 'No pictures yet. Ask, and I’ll look at it at all three widths.',
  again: 'Check again',
  /** What the press does, said before anybody presses it: a button with no
   *  sentence over it is a button nobody presses twice. */
  what:
    'Serves the project, opens the page at every width you design for and photographs each one. Anything sitting past the edge of the screen comes back flagged, with how many pixels over it is.',
  /** And where the widths come from, for somebody who wants different ones. */
  where:
    'The widths are the ones your own stylesheets already ask for: at most four, and always with a phone and a full-width look among them. Write another into the stylesheet and the next look uses it.',
  /** On the picture, where the fault is. */
  flagged: 'Doesn’t fit',
  missing: 'Didn’t come out',
  /** What clicking a size does. It marks the one being read and nothing more,
   *  so it does not promise work nobody is doing at that width. */
  pick: 'Look at this one',
  picked: 'Looking at this one',
};
