/** Whether a change looks different enough to stop for.
 *
 * Pure. No React, no camera, no clock — handed what a comparison found at each
 * width, it hands back a decision, the sentences that go with it, and which
 * pictures become the ones the next change is measured against.
 *
 * The comparison is against the last picture somebody agreed to, not against
 * the project as it stands. Five changes nobody looked at pile up against one
 * picture, and that is the whole difference between a gate and a
 * before-and-after: the second asks every time and so gets switched off, the
 * first asks when the page has drifted away from what was agreed.
 *
 * Nothing here reads an image. Counting pixels needs a decoder and a browser;
 * deciding what the count means does not, so the counting is handed in.
 */

/* -------------------------------------------------------------------------- */
/* What the comparison hands in                                                */
/* -------------------------------------------------------------------------- */

/**
 * How different two pixels have to be to count, as a share of full range.
 *
 * Two photographs of the same page are never identical: text is anti-aliased
 * differently between renders, and the pictures are squashed on their way to
 * the window, which rings around every hard edge. Below this the difference is
 * the camera, not the page.
 */
export const TOLERANCE = 0.06;

/**
 * How many strips a picture is read in, top to bottom.
 *
 * A whole component can go missing and still be a small share of a long page.
 * Reading the page in strips catches that: one strip almost entirely different
 * is a block that moved, however quiet the rest of the page stayed.
 */
export const BANDS = 8;

/** What one width came back with. The three cases are genuinely different
 *  answers, so they are three shapes rather than one with holes in it. */
export type Change =
  | {
      kind: 'compared';
      id: string;
      name: string;
      width: number;
      /** Pixels differing by more than `TOLERANCE`. */
      changed: number;
      /** Pixels compared. */
      pixels: number;
      /** Changed pixels per strip, top to bottom. Left out when the picture
       *  was read whole. */
      bands?: readonly number[];
    }
  /** Never agreed to at this width before, so there is nothing to compare. */
  | { kind: 'first'; id: string; name: string; width: number }
  /** No picture at this width. `why` is already a sentence. */
  | { kind: 'nopicture'; id: string; name: string; width: number; why?: string | null };

/* -------------------------------------------------------------------------- */
/* How much counts                                                             */
/* -------------------------------------------------------------------------- */

/** Where the line sits. `moved` is a share of the whole picture, `deepest` a
 *  share of one strip of it. */
export type HowMuch = {
  id: string;
  /** What a designer picks. */
  name: string;
  moved: number;
  deepest: number;
};

/**
 * The three anybody would want, and the numbers behind each.
 *
 * The middle one is the default. A tenth of the page different from what was
 * agreed to is a change somebody has not seen rather than a tweak; a strip a
 * third different is a block that went somewhere even when the rest of the page
 * held still. Tighter than that and a reflowed paragraph stops the work, which
 * is how a gate gets switched off.
 */
export const HOW_MUCH: readonly HowMuch[] = [
  { id: 'any', name: 'Anything', moved: 0.01, deepest: 0.05 },
  { id: 'usual', name: 'A real change', moved: 0.1, deepest: 0.35 },
  { id: 'big', name: 'Only a big one', moved: 0.3, deepest: 0.6 },
];

export const USUAL: HowMuch = HOW_MUCH[1] ?? {
  id: 'usual',
  name: 'A real change',
  moved: 0.1,
  deepest: 0.35,
};

/** The one somebody picked, or the default when they have not. */
export function howMuchBy(id: string | null | undefined): HowMuch {
  return HOW_MUCH.find((one) => one.id === id) ?? USUAL;
}

/* -------------------------------------------------------------------------- */
/* Words                                                                       */
/* -------------------------------------------------------------------------- */

/** Every sentence the gate can put in front of somebody. */
export const gateWords = {
  /** Over the pictures, when something moved past the line. */
  heading: 'Have a look at this first',
  /** The one control, sitting with the pictures rather than in a settings
   *  screen. Pressing it shows the three below. */
  howMuch: 'How much counts as different?',
  /** Beside a width that moved. Never colour on its own. */
  moved: 'Different',
  /** Beside a width nobody could photograph. */
  missing: 'Not checked',
  /** The answer that takes the work and moves the mark it is measured against,
   *  so the same change is never questioned twice. */
  take: 'That’s right, let it in',
  letIn: 'Let it in',
  setAside: 'Set it aside',
  /** Said under the pictures when the gate stopped the work. */
  held: 'Nothing reaches your project until you answer.',
  first:
    'Nothing to check this against yet. Let it in and it becomes the picture I measure the next change against.',
  clear: 'Nothing has moved much since the one you last said yes to.',
  /** What accepting does to the mark, for anybody wondering why they are not
   *  asked again. */
  moves: 'Letting it in makes these the pictures I measure against next time.',
} as const;

/* -------------------------------------------------------------------------- */
/* Sentences with numbers in them                                              */
/* -------------------------------------------------------------------------- */

function lower(name: string): string {
  return name.toLowerCase();
}

function listOf(names: readonly string[]): string {
  const said = names.map(lower);
  if (said.length <= 1) return said[0] ?? '';
  return `${said.slice(0, -1).join(', ')} and ${said[said.length - 1] ?? ''}`;
}

/** Never "0%" for something that did change: the number is there to be trusted. */
function share(part: number): string {
  const percent = part * 100;
  if (percent > 0 && percent < 1) return 'less than 1%';
  return `${Math.round(percent)}%`;
}

/** One width, with the number, because "it looks different" sends somebody
 *  hunting and "38% of it" tells them how much of it to look at. */
export function saysMoved(name: string, moved: number): string {
  return `${share(moved)} of the ${lower(name)} picture is different from the one you last said yes to.`;
}

export function saysBand(name: string, deepest: number): string {
  return `A band across the ${lower(name)} is ${share(deepest)} different, so something in it has moved.`;
}

/** The line itself, for whoever wants to know where it sits. */
export function saysHowMuch(one: HowMuch): string {
  return `More than ${share(one.moved)} of the page, or a band of it ${share(one.deepest)} different.`;
}

function saysStopped(names: readonly string[]): string {
  const which = listOf(names);
  return names.length === 1
    ? `The ${which} looks different from the one you last said yes to.`
    : `The ${which} look different from the ones you last said yes to.`;
}

function saysUnchecked(names: readonly string[], why: string | null): string {
  const which = listOf(names);
  const head =
    names.length === 1
      ? `I couldn’t check the ${which} against the one you last said yes to.`
      : `I couldn’t check the ${which} against the ones you last said yes to.`;
  return why === null ? head : `${head} ${why}`;
}

/* -------------------------------------------------------------------------- */
/* Reading one width                                                           */
/* -------------------------------------------------------------------------- */

export type Reading = {
  id: string;
  name: string;
  width: number;
  /** Share of the picture that differs, 0..1. */
  moved: number;
  /** The most different strip, 0..1. Same as `moved` when the picture was read
   *  whole. */
  deepest: number;
  /** How far past the line, 1 being exactly on it. */
  past: number;
  /** True when this width on its own is enough to stop. */
  stops: boolean;
  says: string;
};

function sane(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

/** Never divide by a line somebody set to zero. */
function over(part: number, line: number): number {
  return part / Math.max(line, 1e-6);
}

function deepestOf(changed: number, pixels: number, bands: readonly number[] | undefined): number {
  const whole = changed / pixels;
  if (bands === undefined || bands.length === 0) return whole;
  const each = pixels / bands.length;
  if (each <= 0) return whole;
  return bands.reduce((worst, count) => Math.max(worst, Math.min(1, sane(count) / each)), 0);
}

/** One width, read. Null for a width that was never compared — a first look and
 *  a missing picture are answered elsewhere, not folded into a number. */
export function readChange(change: Change, limits: HowMuch = USUAL): Reading | null {
  if (change.kind !== 'compared') return null;
  const pixels = sane(change.pixels);
  if (pixels === 0) return null;
  // A count that is not a number is not a count of zero.
  if (!Number.isFinite(change.changed) || change.changed < 0) return null;

  const moved = Math.min(1, sane(change.changed) / pixels);
  const deepest = deepestOf(sane(change.changed), pixels, change.bands);
  const past = Math.max(over(moved, limits.moved), over(deepest, limits.deepest));
  const stops = moved >= limits.moved || deepest >= limits.deepest;

  return {
    id: change.id,
    name: change.name,
    width: change.width,
    moved,
    deepest,
    past,
    stops,
    // The strip is only worth naming when the whole page did not already say it.
    says:
      stops && deepest >= limits.deepest && moved < limits.moved
        ? saysBand(change.name, deepest)
        : saysMoved(change.name, moved),
  };
}

/* -------------------------------------------------------------------------- */
/* The gate                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Where a set of widths leaves somebody.
 *
 * `clear` is the one that earns the rest: the work goes in without anybody
 * being asked, which is what makes a gate that is on by default bearable.
 * `first` and `unchecked` ask but never block — a picture that could not be
 * taken is not evidence of anything. Only `stopped` holds the work.
 */
export type Standing = 'clear' | 'first' | 'unchecked' | 'stopped';

export type Verdict = {
  standing: Standing;
  /** True when nothing reaches the project until somebody answers. */
  stops: boolean;
  /** True when somebody is asked at all. */
  asks: boolean;
  /** Every width that was compared, furthest past the line first. */
  readings: readonly Reading[];
  /** Which width to open on, or null when there is none to open. */
  open: string | null;
  /** The set in one sentence. */
  says: string;
  /** What the answer that proceeds should say. */
  proceed: string;
  /** Widths nobody could check. */
  unchecked: readonly { id: string; name: string }[];
  /** The line these were read against. */
  limits: HowMuch;
};

function tidy(sentence: string | null | undefined): string | null {
  const one = (sentence ?? '').trim();
  return one === '' ? null : one;
}

/** The reason shared by every width that has one, when they all agree — a
 *  project that will not build is one reason, not three. */
function sharedWhy(missing: readonly Change[]): string | null {
  const reasons = new Set(
    missing.map((one) => (one.kind === 'nopicture' ? tidy(one.why) : null)).filter((one) => one !== null),
  );
  return reasons.size === 1 ? ([...reasons][0] ?? null) : null;
}

/**
 * What to do about a whole set of widths.
 *
 * Any one width past the line stops the lot: a change that only breaks the
 * phone is exactly the one worth stopping for, and it is the one a desktop
 * screen never shows.
 */
export function gateOf(changes: readonly Change[], limits: HowMuch = USUAL): Verdict {
  const readings = changes
    .map((change) => readChange(change, limits))
    .filter((one): one is Reading => one !== null)
    .sort((one, other) => other.past - one.past);

  const stopped = readings.filter((one) => one.stops);
  const read = new Set(readings.map((one) => one.id));
  // A comparison that came back with nothing to count is not a pass. Anything
  // that did not produce a reading is a width nobody checked.
  const missing = changes.filter(
    (one) => one.kind === 'nopicture' || (one.kind === 'compared' && !read.has(one.id)),
  );
  const firsts = changes.filter((one) => one.kind === 'first');

  const standing: Standing =
    stopped.length > 0
      ? 'stopped'
      : missing.length > 0
        ? 'unchecked'
        : firsts.length > 0
          ? 'first'
          : 'clear';

  const says =
    standing === 'stopped'
      ? `${saysStopped(stopped.map((one) => one.name))} ${gateWords.held}`
      : standing === 'unchecked'
        ? saysUnchecked(
            missing.map((one) => one.name),
            sharedWhy(missing),
          )
        : standing === 'first'
          ? gateWords.first
          : gateWords.clear;

  const open =
    (standing === 'stopped' ? (stopped[0]?.id ?? null) : null) ??
    readings[0]?.id ??
    firsts[0]?.id ??
    missing[0]?.id ??
    null;

  return {
    standing,
    stops: standing === 'stopped',
    asks: standing !== 'clear',
    readings,
    open,
    says,
    proceed: standing === 'stopped' ? gateWords.take : gateWords.letIn,
    unchecked: missing.map((one) => ({ id: one.id, name: one.name })),
    limits,
  };
}

/* -------------------------------------------------------------------------- */
/* Moving the mark                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Which widths get a new picture to be measured against.
 *
 * The override and the mark are the same press: somebody who has looked at a
 * change and said yes to it is never asked about it again. Setting it aside
 * moves nothing, and neither does a width that came back without a picture —
 * recording "no picture" as the thing to measure against would make the next
 * change look like a total rewrite.
 */
export function nextAccepted(changes: readonly Change[], letIn: boolean): readonly string[] {
  if (!letIn) return [];
  return changes.filter((one) => one.kind !== 'nopicture').map((one) => one.id);
}
