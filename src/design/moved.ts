/** What a Figma file holds now, against what the work was built from.
 *
 * Pure. No network, no Electron, no clock — it is handed two readings of a file
 * and hands back what differs, each already said in a sentence. The half that
 * asks Figma for a reading lives in `follow.ts` and never comes near this one.
 *
 * Colours are compared in OKLab, on the machinery in `drift.ts`, for the same
 * reason it is there: two pairs the same distance apart in RGB can be one
 * indistinguishable pair and one obvious one. Everything about comparing a
 * colour is imported — there is no second scheme here.
 *
 * Conservative on purpose. Figma keeps colour as floats and we keep it as hex,
 * so the trip out and back moves the last digit; anything inside that is a
 * rounding rather than a decision, and a finding about somebody's design that
 * turns out to be a rounding costs more trust than it is worth.
 */

import { apart, colourWord, nameFor, readColour, readLength, toOklab, type Rgb } from './drift';
import type { TokenSet } from './figma';

/* -------------------------------------------------------------------------- */
/* What a reading amounts to                                                   */
/* -------------------------------------------------------------------------- */

/** One frame, as it stood when the file was read. No picture: a Figma image
 *  address stops working after a while, and a broken one is worse than none. */
export type DesignFrame = {
  id: string;
  name: string;
  width?: number;
  height?: number;
};

/** One reading of a Figma file: the frames it holds and the values it
 *  publishes. Exactly what `follow.ts` brings back, and all this module needs. */
export type Design = {
  frames: readonly DesignFrame[];
  values: TokenSet;
};

/**
 * A Figma file a project is kept in step with.
 *
 * `design` is what the work was built from, and it moves only when somebody
 * says the work has caught up. `latest` is the last reading taken, and it moves
 * every time the file is looked at again. The difference between the two is the
 * whole feature.
 */
export type Held = {
  id: string;
  /** What this is called on screen — the frame, or the file. */
  name: string;
  /** The address it was followed from, so it can be opened again. */
  url: string;
  fileKey: string;
  /** What the work was built from. */
  design: Design;
  /** The last reading taken. */
  latest: Design;
  /** When that reading was taken. Epoch ms, handed in — never read here. */
  readAt: number;
};

/** What kind of thing moved, in the words the panel uses. */
export type MoveKind = 'colour' | 'size' | 'type' | 'frame';

/** What happened to it. */
export type MoveWhat = 'changed' | 'renamed' | 'gone' | 'new';

export type Move = {
  /** Steady for a thing, so a list can re-render without churn. */
  id: string;
  kind: MoveKind;
  what: MoveWhat;
  /** The thing, named as a designer would say it. */
  thing: string;
  /** Exactly as it was, and as it is now. Never reaches a sentence. */
  was: string | null;
  now: string | null;
  /** OKLab distance for a colour, the share it moved by for a size, 0 else. */
  distance: number;
  says: string;
  /** Exact values, for whoever has turned "Show me" on. */
  detail: string;
  /** What would be said to bring the work back in step. Read by the agent, so
   *  it carries the real values the sentence deliberately leaves out. */
  asks: string;
};

export type MovedOptions = {
  /** How far apart two colours can be and still be the same colour rounded. */
  sameColour?: number;
  /** How far apart two sizes can be and still be the same size rounded, px. */
  sameSize?: number;
  most?: number;
  /** What the file is called, for the sentence handed to the agent. */
  name?: string;
};

/* -------------------------------------------------------------------------- */
/* What counts as the same                                                     */
/* -------------------------------------------------------------------------- */

/** Below this in OKLab it is one colour that has been through a rounding. A
 *  hundredth is a difference you would have to be told about; this is half of
 *  that again. */
export const SAME_COLOUR = 0.005;

/** Under half a pixel nobody moved anything. */
export const SAME_SIZE = 0.5;

/** A step in alpha smaller than one part in 255 cannot survive being written as
 *  hex, so anything under it is the same transparency. */
const SAME_ALPHA = 1 / 255;

/** Lightness has to move this far in OKLab before "deeper" or "lighter" is the
 *  honest word for it rather than a way of dressing up a rounding. */
const NOTICEABLY_LIGHTER = 0.02;

/** Long enough for a real design system, short enough that the panel stays a
 *  list somebody reads rather than one they scroll past. */
export const MOST_MOVES = 40;

/* -------------------------------------------------------------------------- */
/* Words                                                                       */
/* -------------------------------------------------------------------------- */

/** Words this interface never says, wherever they came from. A file that names
 *  a value `token/gap` is still not a reason to put that word on screen. */
const NEVER = new Set([
  'api',
  'commit',
  'css',
  'endpoint',
  'git',
  'json',
  'mcp',
  'node',
  'server',
  'session',
  'sync',
  'token',
  'tokens',
  'var',
  'vars',
]);

/** The name with the words we do not say taken out of it. */
function keepable(name: string): string {
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((word) => word !== '' && !NEVER.has(word))
    .join('-');
}

const FALLBACK: Readonly<Record<MoveKind, string>> = {
  colour: 'colour',
  size: 'spacing',
  type: 'type',
  frame: 'frame',
};

/**
 * A value's own name, as it would be said out loud.
 *
 * Colours go through `nameFor`, which already knows that `--color-500` says
 * nothing and that the colour itself says more. Sizes and type keep the name
 * the designer gave them, because their own word for a size is the only thing
 * about it worth saying.
 */
export function said(name: string, kind: MoveKind, colour: Rgb | null = null): string {
  const clean = keepable(name);
  if (colour !== null) return nameFor({ name: clean, value: '', kind: 'colour' }, colour);
  const words = clean.split('-').filter((word) => word !== '');
  return words.length === 0 ? FALLBACK[kind] : words.join(' ');
}

function upper(text: string): string {
  return text === '' ? text : `${text[0]?.toUpperCase() ?? ''}${text.slice(1)}`;
}

const COUNTS: readonly string[] = [
  'no',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
];

function counted(many: number): string {
  return COUNTS[many] ?? String(many);
}

/** Which way a thing went, when that is the whole of the news. */
export type Way =
  | 'deeper'
  | 'lighter'
  | 'more see-through'
  | 'less see-through'
  | 'bigger'
  | 'smaller'
  | 'taller'
  | 'shorter'
  | 'wider'
  | 'narrower';

/** A move, up to the sentence: everything `saysMoved` needs and nothing else. */
export type Moved = {
  kind: MoveKind;
  what: MoveWhat;
  /** The thing, said out loud. */
  thing: string;
  /** What it is called now, for a rename. */
  called?: string;
  /** Which way it went, when it went one way. */
  way?: Way | null;
  /** The colour it is now and the colour it was, when it has changed family
   *  altogether and no direction covers it. */
  becomes?: string | null;
  from?: string | null;
};

/**
 * One thing that moved, in a sentence.
 *
 * Never a value. What a designer needs is that Figma has gone somewhere the
 * work has not; the two swatches beside the sentence make that case better than
 * a pair of hexes would, and the exact pair sits under "Show me" for anybody
 * who wants it.
 */
export function saysMoved(moved: Moved): string {
  const thing = moved.thing;

  if (moved.what === 'gone') return `${upper(thing)} is not in Figma any more.`;
  if (moved.what === 'new') return `${upper(thing)} is new in Figma since this was built.`;
  if (moved.what === 'renamed') {
    return `${upper(thing)} is called ${moved.called ?? ''} in Figma now.`;
  }

  if (moved.becomes != null && moved.becomes !== '' && moved.from != null && moved.from !== '') {
    return `Your ${thing} in Figma is ${moved.becomes} now, where this was built from ${moved.from}.`;
  }
  // A frame wears its own name, so "your Header" would be one word too many.
  if (moved.way != null) {
    const whose = moved.kind === 'frame' ? upper(thing) : `Your ${thing} in Figma`;
    return `${whose} is ${moved.way} than this was built from.`;
  }
  if (moved.kind === 'colour') {
    return `Your ${thing} in Figma is a shade off what this was built from.`;
  }
  return `Your ${thing} in Figma has changed since this was built.`;
}

/** The one line above the list. */
export function saysInStep(name: string, moves: readonly Move[]): string {
  if (moves.length === 0) return `Nothing in ${name} has moved since this was built.`;
  const many = moves.length === 1 ? 'one thing differs' : `${counted(moves.length)} things differ`;
  return `Your ${name} in Figma has moved on since this was built — ${many}.`;
}

/** Nothing is being followed yet, and this is how you would say so. */
export const NOTHING_FOLLOWED =
  'Point me at a Figma file and I will tell you when it moves on without you.';

/* -------------------------------------------------------------------------- */
/* The name of the thing being followed                                        */
/* -------------------------------------------------------------------------- */

const UNNAMED = 'that Figma file';

const NAMED_AFTER = /\/(?:file|design|proto|board|slides|deck)\/[\w-]+\/([^/?#]+)/i;

/**
 * What to call the file on screen.
 *
 * A frame gives the best name there is — it is the thing somebody pointed at,
 * and "your header has moved on" is the sentence this whole feature exists to
 * say. Failing that, Figma writes the file's own name into the address, which
 * is where the hyphens come from.
 */
export function nameOfDesign(url: string, frames: readonly DesignFrame[] = []): string {
  const only = frames.length === 1 ? frames[0] : undefined;
  if (only !== undefined && only.name.trim() !== '') return only.name.trim();

  // .../design/KEY/Name — the name sits one past the key, and is often missing.
  const slug = NAMED_AFTER.exec(url)?.[1] ?? '';
  if (slug === '') return UNNAMED;

  let readable = slug;
  try {
    readable = decodeURIComponent(slug);
  } catch {
    // Already readable, or readable enough.
  }
  const words = readable.replace(/[-_]+/g, ' ').trim();
  return words === '' ? UNNAMED : words;
}

/* -------------------------------------------------------------------------- */
/* Reading what was kept                                                       */
/* -------------------------------------------------------------------------- */

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function group(raw: unknown): Record<string, string> {
  const found: Record<string, string> = {};
  const map = record(raw);
  if (map === null) return found;
  for (const [name, value] of Object.entries(map)) {
    if (typeof value === 'string' && value.trim() !== '' && name.trim() !== '') {
      found[name] = value.trim();
    }
  }
  return found;
}

function measurement(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

/** One reading, read back. Nothing here throws: a row that cannot be read is a
 *  reading with less in it, never a failure somebody has to see. */
export function readDesign(raw: unknown): Design {
  const held = record(raw);
  const rows = Array.isArray(held?.['frames']) ? (held['frames'] as unknown[]) : [];
  const frames: DesignFrame[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const frame = record(row);
    const id = text(frame?.['id']);
    if (id === '' || seen.has(id)) continue;
    seen.add(id);
    const width = measurement(frame?.['width']);
    const height = measurement(frame?.['height']);
    const name = text(frame?.['name']);
    frames.push({
      id,
      name: name === '' ? id : name,
      ...(width === undefined ? {} : { width }),
      ...(height === undefined ? {} : { height }),
    });
  }

  const kept = record(held?.['values']);
  return {
    frames,
    values: {
      colors: group(kept?.['colors']),
      spacing: group(kept?.['spacing']),
      text: group(kept?.['text']),
    },
  };
}

/** One followed file, read back. Null when there is not enough of it to be
 *  worth showing — a row with no file behind it can do nothing at all. */
export function readHeld(raw: unknown): Held | null {
  const held = record(raw);
  if (held === null) return null;
  const fileKey = text(held['fileKey']);
  if (fileKey === '') return null;

  const design = readDesign(held['design']);
  const at = held['readAt'];
  const name = text(held['name']);
  const id = text(held['id']);
  return {
    id: id === '' ? fileKey : id,
    name: name === '' ? UNNAMED : name,
    url: text(held['url']),
    fileKey,
    design,
    latest: held['latest'] === undefined ? design : readDesign(held['latest']),
    readAt: typeof at === 'number' && Number.isFinite(at) ? at : 0,
  };
}

/* -------------------------------------------------------------------------- */
/* Comparing                                                                   */
/* -------------------------------------------------------------------------- */

type ColourMove = { way: Way | null; becomes: string | null; from: string | null; distance: number };

/**
 * Two colours, compared the way an eye compares them.
 *
 * Null when they are the same colour: identical, or apart by less than the
 * rounding a trip through hex costs. Alpha is checked on its own, because OKLab
 * has nothing to say about it and an overlay going from a half to
 * three-quarters is a real change nobody would otherwise hear about.
 */
function colourMove(was: Rgb, now: Rgb, same: number): ColourMove | null {
  const distance = apart(was, now);
  const alpha = now.a - was.a;

  if (distance <= same) {
    if (Math.abs(alpha) <= SAME_ALPHA) return null;
    return {
      way: alpha < 0 ? 'more see-through' : 'less see-through',
      becomes: null,
      from: null,
      distance: 0,
    };
  }

  const wasWord = colourWord(was);
  const nowWord = colourWord(now);
  if (wasWord !== nowWord) {
    return { way: null, becomes: nowWord, from: wasWord, distance };
  }

  const lightness = toOklab(now).L - toOklab(was).L;
  if (Math.abs(lightness) > NOTICEABLY_LIGHTER) {
    return { way: lightness > 0 ? 'lighter' : 'deeper', becomes: null, from: null, distance };
  }
  return { way: null, becomes: null, from: null, distance };
}

const RANK_WHAT: Readonly<Record<MoveWhat, number>> = {
  changed: 0,
  renamed: 1,
  gone: 2,
  new: 3,
};

const RANK_KIND: Readonly<Record<MoveKind, number>> = {
  frame: 0,
  colour: 1,
  size: 2,
  type: 3,
};

function detailOf(name: string, was: string | null, now: string | null): string {
  if (was !== null && now !== null) return `${name}: ${was} → ${now}`;
  if (now !== null) return `${name}: ${now}`;
  return `${name}: ${was ?? ''}`;
}

/**
 * What would be said to bring the work back in step.
 *
 * The one place exact values belong: nothing here is read by a designer, and an
 * instruction to change a colour without saying which colour is not an
 * instruction.
 */
function asksFor(move: Omit<Move, 'asks'>, name: string): string {
  const where = `In ${name} in Figma`;
  if (move.what === 'gone') {
    return `${where}, ${move.thing} is gone — it was ${move.was ?? ''}. Find where this project still uses it and tell me what should take its place.`;
  }
  if (move.what === 'new') {
    return `${where}, ${move.thing} is new — it is ${move.now ?? ''}. Add it to this project's own values where it belongs.`;
  }
  if (move.what === 'renamed') {
    return `${where}, ${move.was ?? ''} is called ${move.now ?? ''} now. Rename it through this project so the two agree.`;
  }
  return `${where}, ${move.thing} is ${move.now ?? ''} now — it was ${move.was ?? ''} when this was built. Find where this project uses it and update it to match.`;
}

type Row = {
  kind: MoveKind;
  what: MoveWhat;
  thing: string;
  name: string;
  was: string | null;
  now: string | null;
  distance: number;
  says: string;
};

function bucketOf(kind: MoveKind, tokens: TokenSet): Record<string, string> {
  if (kind === 'colour') return tokens.colors;
  if (kind === 'size') return tokens.spacing;
  return tokens.text;
}

/** One group of values, before and after. Anything unreadable on either side is
 *  left alone rather than guessed at. */
function movedValues(
  kind: MoveKind,
  built: TokenSet,
  now: TokenSet,
  sameColour: number,
  sameSize: number,
): Row[] {
  const before = bucketOf(kind, built);
  const after = bucketOf(kind, now);
  const rows: Row[] = [];

  for (const [name, valueWas] of Object.entries(before)) {
    const valueNow = after[name];
    const colourWas = kind === 'colour' ? readColour(valueWas) : null;

    if (valueNow === undefined) {
      const thing = said(name, kind, colourWas);
      rows.push({
        kind,
        what: 'gone',
        thing,
        name,
        was: valueWas,
        now: null,
        distance: 0,
        says: saysMoved({ kind, what: 'gone', thing }),
      });
      continue;
    }
    if (valueNow === valueWas) continue;

    if (kind === 'colour') {
      const colourNow = readColour(valueNow);
      if (colourWas === null || colourNow === null) continue;
      const move = colourMove(colourWas, colourNow, sameColour);
      if (move === null) continue;
      const thing = said(name, kind, colourWas);
      rows.push({
        kind,
        what: 'changed',
        thing,
        name,
        was: valueWas,
        now: valueNow,
        distance: move.distance,
        says: saysMoved({
          kind,
          what: 'changed',
          thing,
          way: move.way,
          becomes: move.becomes,
          from: move.from,
        }),
      });
      continue;
    }

    const lengthWas = readLength(valueWas);
    const lengthNow = readLength(valueNow);
    const thing = said(name, kind);

    if (lengthWas !== null && lengthNow !== null) {
      const moved = lengthNow.px - lengthWas.px;
      if (Math.abs(moved) < sameSize) continue;
      rows.push({
        kind,
        what: 'changed',
        thing,
        name,
        was: valueWas,
        now: valueNow,
        distance: lengthWas.px === 0 ? 1 : Math.abs(moved) / lengthWas.px,
        says: saysMoved({ kind, what: 'changed', thing, way: moved > 0 ? 'bigger' : 'smaller' }),
      });
      continue;
    }

    // Two plain words. Spelt differently is not written differently.
    if (sameWords(valueWas, valueNow)) continue;
    rows.push({
      kind,
      what: 'changed',
      thing,
      name,
      was: valueWas,
      now: valueNow,
      distance: 0,
      says: saysMoved({ kind, what: 'changed', thing }),
    });
  }

  for (const [name, valueNow] of Object.entries(after)) {
    if (name in before) continue;
    const thing = said(name, kind, kind === 'colour' ? readColour(valueNow) : null);
    rows.push({
      kind,
      what: 'new',
      thing,
      name,
      was: null,
      now: valueNow,
      distance: 0,
      says: saysMoved({ kind, what: 'new', thing }),
    });
  }

  return rows;
}

function sameWords(one: string, other: string): boolean {
  const flat = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase();
  return flat(one) === flat(other);
}

function shapeOf(frame: DesignFrame): string {
  const width = frame.width === undefined ? '?' : String(Math.round(frame.width));
  const height = frame.height === undefined ? '?' : String(Math.round(frame.height));
  return `${width}×${height}`;
}

/** Taller before wider: a frame that grew both ways is usually a page that
 *  gained a section, and height is the half somebody notices. */
function shapeMove(was: DesignFrame, now: DesignFrame, sameSize: number): Way | null {
  if (was.height !== undefined && now.height !== undefined) {
    const moved = now.height - was.height;
    if (Math.abs(moved) >= sameSize) return moved > 0 ? 'taller' : 'shorter';
  }
  if (was.width !== undefined && now.width !== undefined) {
    const moved = now.width - was.width;
    if (Math.abs(moved) >= sameSize) return moved > 0 ? 'wider' : 'narrower';
  }
  return null;
}

/** The frames, matched by the id Figma gives them rather than by name — a frame
 *  that has been renamed is the same frame, and saying one went and another
 *  arrived would be two wrong findings in place of one right one. */
function movedFrames(
  built: readonly DesignFrame[],
  now: readonly DesignFrame[],
  sameSize: number,
): Row[] {
  const after = new Map(now.map((frame) => [frame.id, frame]));
  const before = new Map(built.map((frame) => [frame.id, frame]));
  const rows: Row[] = [];

  for (const frame of built) {
    const there = after.get(frame.id);
    if (there === undefined) {
      rows.push({
        kind: 'frame',
        what: 'gone',
        thing: frame.name,
        name: frame.id,
        was: frame.name,
        now: null,
        distance: 0,
        says: saysMoved({ kind: 'frame', what: 'gone', thing: frame.name }),
      });
      continue;
    }

    if (!sameWords(frame.name, there.name)) {
      rows.push({
        kind: 'frame',
        what: 'renamed',
        thing: frame.name,
        name: frame.id,
        was: frame.name,
        now: there.name,
        distance: 0,
        says: saysMoved({
          kind: 'frame',
          what: 'renamed',
          thing: frame.name,
          called: there.name,
        }),
      });
      continue;
    }

    const way = shapeMove(frame, there, sameSize);
    if (way === null) continue;
    rows.push({
      kind: 'frame',
      what: 'changed',
      thing: frame.name,
      name: frame.id,
      was: shapeOf(frame),
      now: shapeOf(there),
      distance: 0,
      says: saysMoved({ kind: 'frame', what: 'changed', thing: frame.name, way }),
    });
  }

  for (const frame of now) {
    if (before.has(frame.id)) continue;
    rows.push({
      kind: 'frame',
      what: 'new',
      thing: frame.name,
      name: frame.id,
      was: null,
      now: frame.name,
      distance: 0,
      says: saysMoved({ kind: 'frame', what: 'new', thing: frame.name }),
    });
  }

  return rows;
}

/**
 * Everything that has moved in a Figma file since the work was built from it.
 *
 * Both readings arrive as plain data and nothing is read from anywhere. A value
 * that cannot be read on either side is left out rather than guessed at, and so
 * is one that differs only by the rounding a trip through hex costs.
 */
export function findMoved(
  built: Design,
  now: Design,
  options: MovedOptions = {},
): readonly Move[] {
  const sameColour = options.sameColour ?? SAME_COLOUR;
  const sameSize = options.sameSize ?? SAME_SIZE;
  const most = options.most ?? MOST_MOVES;
  const name = options.name ?? 'that file';

  const from = readDesign(built);
  const here = readDesign(now);

  const rows = [
    ...movedFrames(from.frames, here.frames, sameSize),
    ...movedValues('colour', from.values, here.values, sameColour, sameSize),
    ...movedValues('size', from.values, here.values, sameColour, sameSize),
    ...movedValues('type', from.values, here.values, sameColour, sameSize),
  ];

  rows.sort(
    (one, other) =>
      RANK_WHAT[one.what] - RANK_WHAT[other.what] ||
      RANK_KIND[one.kind] - RANK_KIND[other.kind] ||
      other.distance - one.distance ||
      one.name.localeCompare(other.name),
  );

  const kept = most >= 0 ? rows.slice(0, most) : rows;
  return kept.map((row) => {
    const bare: Omit<Move, 'asks'> = {
      id: `${row.kind}-${row.what}-${row.name}`,
      kind: row.kind,
      what: row.what,
      thing: row.thing,
      was: row.was,
      now: row.now,
      distance: Math.round(row.distance * 10_000) / 10_000,
      says: row.says,
      detail: detailOf(row.name, row.was, row.now),
    };
    return { ...bare, asks: asksFor(bare, name) };
  });
}
