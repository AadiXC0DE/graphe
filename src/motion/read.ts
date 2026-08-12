/** The movement a project already has, read out of stylesheet text.
 *
 * Pure text in, plain values out. Nothing here renders, reads a disk or asks a
 * model, so movement can be judged, drawn and rewritten without a screen.
 */

/* ------------------------------------------------------------------- curves */

export type Jump = 'start' | 'end' | 'none' | 'both';

export type Curve = {
  readonly kind: 'curve';
  /** The four control numbers, in the order they are written. */
  readonly points: readonly [number, number, number, number];
  /** The name it was written under, when it had one. */
  readonly named: string | null;
};

export type Stepped = {
  readonly kind: 'steps';
  readonly count: number;
  readonly jump: Jump;
};

export type Easing = Curve | Stepped;

export type Point = { readonly x: number; readonly y: number };

const NAMED: Readonly<Record<string, readonly [number, number, number, number]>> = {
  linear: [0, 0, 1, 1],
  ease: [0.25, 0.1, 0.25, 1],
  'ease-in': [0.42, 0, 1, 1],
  'ease-out': [0, 0, 0.58, 1],
  'ease-in-out': [0.42, 0, 0.58, 1],
};

const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;

function curve(points: readonly [number, number, number, number], named: string | null): Curve {
  return { kind: 'curve', points, named };
}

/** The default when a stylesheet says how long but not how it starts and stops. */
export const PLAIN: Easing = curve(NAMED['ease'] ?? [0.25, 0.1, 0.25, 1], 'ease');

function readNumbers(inside: string): number[] | null {
  const found: number[] = [];
  for (const piece of inside.split(',')) {
    const flat = piece.trim();
    if (!NUMBER.test(flat)) return null;
    const amount = Number(flat);
    if (!Number.isFinite(amount)) return null;
    found.push(amount);
  }
  return found;
}

const JUMPS: Readonly<Record<string, Jump>> = {
  start: 'start',
  end: 'end',
  'jump-start': 'start',
  'jump-end': 'end',
  'jump-none': 'none',
  'jump-both': 'both',
};

/** Both ways of writing it: the names, and the numbers behind them. */
export function readEasing(text: string): Easing | null {
  const flat = text.trim().toLowerCase();
  const named = NAMED[flat];
  if (named) return curve(named, flat);
  if (flat === 'step-start') return { kind: 'steps', count: 1, jump: 'start' };
  if (flat === 'step-end') return { kind: 'steps', count: 1, jump: 'end' };

  const bezier = /^cubic-bezier\(([^()]*)\)$/.exec(flat);
  if (bezier) {
    const numbers = readNumbers(bezier[1] ?? '');
    if (numbers === null || numbers.length !== 4) return null;
    const [x1, y1, x2, y2] = numbers as [number, number, number, number];
    /* Time cannot run backwards, so the two x values have to stay in range. */
    if (x1 < 0 || x1 > 1 || x2 < 0 || x2 > 1) return null;
    return curve([x1, y1, x2, y2], null);
  }

  const stepped = /^steps\(([^()]*)\)$/.exec(flat);
  if (stepped) {
    const parts = (stepped[1] ?? '').split(',').map((one) => one.trim());
    const count = Number(parts[0]);
    if (parts.length > 2 || !NUMBER.test(parts[0] ?? '')) return null;
    if (!Number.isInteger(count) || count < 1) return null;
    const jump = parts.length === 2 ? JUMPS[parts[1] ?? ''] : 'end';
    if (jump === undefined) return null;
    if (jump === 'none' && count < 2) return null;
    return { kind: 'steps', count, jump };
  }

  return null;
}

function tidy(amount: number): string {
  return String(Math.round(amount * 10000) / 10000);
}

/** Back to the text a stylesheet holds. */
export function saidEasing(easing: Easing): string {
  if (easing.kind === 'steps') {
    const jump = easing.jump === 'start' || easing.jump === 'end' ? easing.jump : `jump-${easing.jump}`;
    return `steps(${String(easing.count)}, ${jump})`;
  }
  if (easing.named !== null) return easing.named;
  return `cubic-bezier(${easing.points.map(tidy).join(', ')})`;
}

/* ------------------------------------------------------------- the drawing */

function valueAt(a: number, b: number, t: number): number {
  const rest = 1 - t;
  return 3 * rest * rest * t * a + 3 * rest * t * t * b + t * t * t;
}

function slopeAt(a: number, b: number, t: number): number {
  const rest = 1 - t;
  return 3 * rest * rest * a + 6 * rest * t * (b - a) + 3 * t * t * (1 - b);
}

/** Solve for the moment that lands on this fraction of the way across. Newton
 *  first, halving after, because the shallow curves defeat Newton alone. */
function timeAt(x1: number, x2: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;

  let t = x;
  for (let round = 0; round < 8; round += 1) {
    const off = valueAt(x1, x2, t) - x;
    if (Math.abs(off) < 1e-9) return t;
    const slope = slopeAt(x1, x2, t);
    if (Math.abs(slope) < 1e-6) break;
    const next = t - off / slope;
    if (next < 0 || next > 1) break;
    t = next;
  }

  let low = 0;
  let high = 1;
  t = x;
  for (let round = 0; round < 64; round += 1) {
    const here = valueAt(x1, x2, t);
    if (Math.abs(here - x) < 1e-12) return t;
    if (here < x) low = t;
    else high = t;
    t = (low + high) / 2;
  }
  return t;
}

function steppedAt(easing: Stepped, x: number): number {
  const count = easing.count;
  const done = Math.floor(x * count);
  switch (easing.jump) {
    case 'start':
      return Math.min(done + 1, count) / count;
    case 'both':
      return (Math.min(done, count) + 1) / (count + 1);
    case 'none':
      return Math.min(done, count - 1) / (count - 1);
    default:
      return Math.min(done, count) / count;
  }
}

/** How far along the movement is, a given fraction of the way through its
 *  time. Above one and below zero are real answers: that is an overshoot. */
export function progressAt(easing: Easing, at: number): number {
  const x = Math.min(1, Math.max(0, at));
  if (easing.kind === 'steps') return steppedAt(easing, x);
  const [x1, y1, x2, y2] = easing.points;
  return valueAt(y1, y2, timeAt(x1, x2, x));
}

/** Points to draw. A stepped easing comes back as its own staircase rather
 *  than as an even sampling of one. */
export function sample(easing: Easing, count = 25): readonly Point[] {
  if (easing.kind === 'steps') {
    const points: Point[] = [];
    for (let step = 0; step < easing.count; step += 1) {
      const y = steppedAt(easing, (step + 0.5) / easing.count);
      points.push({ x: step / easing.count, y }, { x: (step + 1) / easing.count, y });
    }
    points.push({ x: 1, y: 1 });
    return points;
  }

  const many = Math.max(2, Math.floor(count));
  const points: Point[] = [];
  for (let at = 0; at < many; at += 1) {
    const x = at / (many - 1);
    points.push({ x, y: progressAt(easing, x) });
  }
  return points;
}

/** The same points as a line for a graph, with progress running upwards. */
export function curvePath(easing: Easing, width = 100, height = 100, count = 25): string {
  return sample(easing, count)
    .map(
      (point, at) =>
        `${at === 0 ? 'M' : 'L'} ${tidy(point.x * width)} ${tidy((1 - point.y) * height)}`,
    )
    .join(' ');
}

/* --------------------------------------------------------------- how it feels */

export type Feel =
  | 'even'
  | 'gentle'
  | 'winds-up'
  | 'settles'
  | 'both-ends'
  | 'overshoots'
  | 'pulls-back'
  | 'stepped';

export type Feeling = {
  readonly id: Feel;
  /** What it is called where somebody picks one. */
  readonly name: string;
  /** What it does, in a sentence with no numbers in it. */
  readonly says: string;
  readonly easing: Easing;
};

export const FEELS: readonly Feeling[] = [
  {
    id: 'even',
    name: 'Even',
    says: 'Runs at one speed the whole way and stops dead.',
    easing: curve(NAMED['linear'] ?? [0, 0, 1, 1], 'linear'),
  },
  {
    id: 'settles',
    name: 'Settles',
    says: 'Starts fast and settles gently, the way something arriving should.',
    easing: curve(NAMED['ease-out'] ?? [0, 0, 0.58, 1], 'ease-out'),
  },
  {
    id: 'winds-up',
    name: 'Winds up',
    says: 'Starts slowly and speeds away, the way something leaving should.',
    easing: curve(NAMED['ease-in'] ?? [0.42, 0, 1, 1], 'ease-in'),
  },
  {
    id: 'both-ends',
    name: 'Eased at both ends',
    says: 'Starts slowly, hurries through the middle and slows into place.',
    easing: curve(NAMED['ease-in-out'] ?? [0.42, 0, 0.58, 1], 'ease-in-out'),
  },
  {
    id: 'gentle',
    name: 'Gentle',
    says: 'Soft at both ends, and mild enough that it reads as no choice at all.',
    easing: curve(NAMED['ease'] ?? [0.25, 0.1, 0.25, 1], 'ease'),
  },
  {
    id: 'overshoots',
    name: 'Overshoots',
    says: 'Goes past where it is heading and comes back.',
    easing: curve([0.34, 1.56, 0.64, 1], null),
  },
  {
    id: 'pulls-back',
    name: 'Pulls back',
    says: 'Draws back before it goes, like winding up to throw.',
    easing: curve([0.6, -0.28, 0.735, 0.045], null),
  },
  {
    id: 'stepped',
    name: 'Stepped',
    says: 'Jumps from one position to the next instead of sliding between them.',
    easing: { kind: 'steps', count: 4, jump: 'end' },
  },
];

export function easingForFeel(feel: Feel): Easing {
  return (FEELS.find((one) => one.id === feel) ?? FEELS[0])?.easing ?? PLAIN;
}

const CLOSE = 1e-6;
/** Far enough from a straight line to be a decision rather than rounding. */
const LEAD = 0.02;

function same(easing: Easing, other: Easing): boolean {
  if (easing.kind !== other.kind) return false;
  if (easing.kind === 'steps' || other.kind === 'steps') {
    return (
      easing.kind === 'steps' &&
      other.kind === 'steps' &&
      easing.count === other.count &&
      easing.jump === other.jump
    );
  }
  return easing.points.every((amount, at) => Math.abs(amount - (other.points[at] ?? 0)) < CLOSE);
}

/**
 * Which of the named feelings this is.
 *
 * The ones we offer are matched by their numbers so a pick comes back as
 * itself; anything else is read off the shape of the curve.
 */
export function feelOf(easing: Easing): Feel {
  const known = FEELS.find((one) => same(one.easing, easing));
  if (known) return known.id;
  if (easing.kind === 'steps') return 'stepped';

  const [, y1, , y2] = easing.points;
  if (y1 < -CLOSE || y2 < -CLOSE) return 'pulls-back';
  if (y1 > 1 + CLOSE || y2 > 1 + CLOSE) return 'overshoots';

  const early = progressAt(easing, 0.15) - 0.15;
  const late = progressAt(easing, 0.85) - 0.85;
  const slowStart = early < -LEAD;
  const softEnd = late > LEAD;

  if (slowStart && softEnd) return 'both-ends';
  if (slowStart) return 'winds-up';
  if (softEnd) return 'settles';
  return 'even';
}

/** What a curve does, said the way somebody would say it out loud. */
export function sayEasing(easing: Easing): string {
  const feel = feelOf(easing);
  return FEELS.find((one) => one.id === feel)?.says ?? '';
}

/* --------------------------------------------------------------------- time */

const TIME = /^([+-]?(?:\d+\.?\d*|\.\d+))(ms|s)?$/i;

/** Milliseconds, whichever unit it was written in. */
export function readTime(text: string): number | null {
  const found = TIME.exec(text.trim());
  if (!found) return null;
  const amount = Number(found[1]);
  if (!Number.isFinite(amount)) return null;
  const unit = (found[2] ?? '').toLowerCase();
  if (unit === '') return amount === 0 ? 0 : null;
  return Math.round((unit === 's' ? amount * 1000 : amount) * 1000) / 1000;
}

export function sayTime(ms: number): string {
  const amount = Math.round(ms * 1000) / 1000;
  if (Math.abs(amount) < 1000) return `${tidy(amount)}ms`;
  return `${tidy(Math.round(amount / 10) / 100)}s`;
}

/** Where a slider should snap. Familiar lengths, plus wherever it is now. */
const LENGTHS: readonly number[] = [
  0, 60, 80, 100, 120, 150, 180, 200, 240, 280, 320, 400, 500, 650, 800, 1000, 1500, 2000,
];

export function timeSteps(ms: number): readonly number[] {
  const values = new Set(LENGTHS);
  values.add(Math.max(0, Math.round(ms * 1000) / 1000));
  return [...values].sort((first, second) => first - second);
}

/* ------------------------------------------------------------------ reading */

export type MotionKind =
  | 'movement'
  | 'fade'
  | 'colour'
  | 'size'
  | 'sequence'
  | 'everything'
  | 'other';

export type Place = {
  /** The rule it was written on, as written. */
  readonly selector: string;
  /** 1-based, so a writer can find it again. */
  readonly line: number;
  /** The property that declared it, which decides what can be rewritten here. */
  readonly property: string;
  readonly start: number;
  readonly end: number;
};

export type Move = {
  /** Same movement, same id, wherever it was written. */
  readonly id: string;
  readonly kind: MotionKind;
  /** What is being moved, or null when this is a named sequence. */
  readonly property: string | null;
  readonly sequence: string | null;
  /** Milliseconds. */
  readonly duration: number;
  readonly delay: number;
  readonly easing: Easing;
  /** How many times it runs; Infinity for one that never stops. */
  readonly repeats: number;
  readonly places: readonly Place[];
};

export type Sequence = {
  readonly name: string;
  readonly kind: MotionKind;
  readonly line: number;
  /** How many positions it is written through. */
  readonly stops: number;
  readonly properties: readonly string[];
};

export type Motion = {
  readonly moves: readonly Move[];
  readonly sequences: readonly Sequence[];
  /** Whether the project answers somebody who asked for less movement. */
  readonly stillness: boolean;
};

const FADES = new Set(['opacity', 'visibility', 'filter', 'backdrop-filter']);
const MOVES = new Set([
  'transform',
  'translate',
  'rotate',
  'scale',
  'top',
  'left',
  'right',
  'bottom',
  'inset',
  'offset',
  'offset-distance',
  'transform-origin',
]);
const COLOURS = new Set([
  'color',
  'background',
  'background-color',
  'border-color',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'outline-color',
  'fill',
  'stroke',
  'box-shadow',
  'text-shadow',
  'text-decoration-color',
  'accent-color',
]);
const SIZES = new Set([
  'width',
  'height',
  'min-width',
  'min-height',
  'max-width',
  'max-height',
  'padding',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'margin',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'gap',
  'row-gap',
  'column-gap',
  'border-radius',
  'border-width',
  'font-size',
  'line-height',
  'letter-spacing',
  'flex-basis',
  'flex-grow',
]);

export function kindOf(property: string): MotionKind {
  const flat = property.trim().toLowerCase();
  if (flat === 'all') return 'everything';
  if (FADES.has(flat)) return 'fade';
  if (MOVES.has(flat)) return 'movement';
  if (COLOURS.has(flat)) return 'colour';
  if (SIZES.has(flat)) return 'size';
  return 'other';
}

/* ------------------------------------------------------------------ scanning */

/** Comments and string bodies blanked out, offsets and newlines kept, so a
 *  brace or a semicolon inside either cannot fool the scanner below. */
function mask(css: string): string {
  const out = css.split('');
  let at = 0;
  while (at < css.length) {
    const ch = css[at];
    if (ch === '/' && css[at + 1] === '*') {
      const end = css.indexOf('*/', at + 2);
      const stop = end === -1 ? css.length : end + 2;
      for (let each = at; each < stop; each += 1) if (out[each] !== '\n') out[each] = ' ';
      at = stop;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let end = at + 1;
      while (end < css.length && css[end] !== ch && css[end] !== '\n') {
        end += css[end] === '\\' ? 2 : 1;
      }
      for (let each = at + 1; each < end && each < css.length; each += 1) {
        if (out[each] !== '\n') out[each] = 'x';
      }
      at = css[end] === ch ? end + 1 : end;
      continue;
    }
    at += 1;
  }
  return out.join('');
}

function newlinesIn(css: string): number[] {
  const at: number[] = [];
  for (let index = 0; index < css.length; index += 1) if (css[index] === '\n') at.push(index);
  return at;
}

function lineOf(newlines: readonly number[], index: number): number {
  let low = 0;
  let high = newlines.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    const at = newlines[mid];
    if (at !== undefined && at < index) low = mid + 1;
    else high = mid;
  }
  return low + 1;
}

type Piece = { text: string; start: number; end: number };

function split(value: string, base: number, isBoundary: (ch: string) => boolean): Piece[] {
  const out: Piece[] = [];
  let depth = 0;
  let from = 0;

  const take = (to: number): void => {
    let start = from;
    let end = to;
    while (start < end && /\s/.test(value[start] ?? '')) start += 1;
    while (end > start && /\s/.test(value[end - 1] ?? '')) end -= 1;
    if (end > start) out.push({ text: value.slice(start, end), start: base + start, end: base + end });
  };

  for (let at = 0; at < value.length; at += 1) {
    const ch = value[at] ?? '';
    if (ch === '(') depth += 1;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (depth === 0 && isBoundary(ch)) {
      take(at);
      from = at + 1;
    }
  }
  take(value.length);
  return out;
}

const byComma = (ch: string): boolean => ch === ',';
const bySpace = (ch: string): boolean => /\s/.test(ch);

const MOTION_PROPERTIES = new Set([
  'transition',
  'transition-property',
  'transition-duration',
  'transition-timing-function',
  'transition-delay',
  'animation',
  'animation-name',
  'animation-duration',
  'animation-timing-function',
  'animation-delay',
  'animation-iteration-count',
]);

type Declaration = {
  property: string;
  value: string;
  line: number;
  start: number;
  end: number;
  block: number;
  selector: string;
};

type Frame = { name: string; line: number; stops: number; properties: Set<string> };

type Scanned = { declarations: Declaration[]; frames: Frame[]; stillness: boolean };

const KEYFRAMES = /^@(?:-[a-z]+-)?keyframes\s+(.+)$/i;

function scan(css: string): Scanned {
  const masked = mask(css);
  const newlines = newlinesIn(css);
  const declarations: Declaration[] = [];
  const frames: Frame[] = [];
  const stack: { selector: string; frame: Frame | null; block: number }[] = [];
  let blocks = 0;
  let chunkStart = 0;
  let parens = 0;

  const take = (end: number): void => {
    const inside = stack[stack.length - 1];
    if (inside === undefined) return;

    const chunk = masked.slice(chunkStart, end);
    const start = chunkStart + (chunk.length - chunk.trimStart().length);
    if (start >= end) return;
    const colon = masked.indexOf(':', start);
    if (colon === -1 || colon >= end) return;

    const property = masked.slice(start, colon).trim().toLowerCase();
    if (property === '' || property.startsWith('--')) return;

    let valueStart = colon + 1;
    while (valueStart < end && /\s/.test(masked[valueStart] ?? '')) valueStart += 1;
    let valueEnd = end;
    while (valueEnd > valueStart && /\s/.test(masked[valueEnd - 1] ?? '')) valueEnd -= 1;
    if (valueEnd <= valueStart) return;

    if (inside.frame) {
      inside.frame.properties.add(property);
      return;
    }
    if (!MOTION_PROPERTIES.has(property)) return;

    declarations.push({
      property,
      value: css.slice(valueStart, valueEnd),
      line: lineOf(newlines, start),
      start: valueStart,
      end: valueEnd,
      block: inside.block,
      selector: inside.selector,
    });
  };

  for (let at = 0; at < masked.length; at += 1) {
    const ch = masked[at];
    if (ch === '(') parens += 1;
    else if (ch === ')') parens = Math.max(0, parens - 1);
    else if (parens > 0) continue;
    else if (ch === '{') {
      const raw = masked.slice(chunkStart, at);
      const prelude = raw.trim();
      const parent = stack[stack.length - 1];
      const named = KEYFRAMES.exec(prelude)?.[1]?.trim().replace(/^['"]|['"]$/g, '');
      blocks += 1;
      if (named !== undefined && named !== '') {
        const frame: Frame = {
          name: named,
          line: lineOf(newlines, chunkStart + (raw.length - raw.trimStart().length)),
          stops: 0,
          properties: new Set<string>(),
        };
        frames.push(frame);
        stack.push({ selector: parent?.selector ?? '', frame, block: blocks });
      } else {
        if (parent?.frame) parent.frame.stops += 1;
        stack.push({
          selector: prelude.startsWith('@') ? (parent?.selector ?? '') : prelude,
          frame: parent?.frame ?? null,
          block: blocks,
        });
      }
      chunkStart = at + 1;
    } else if (ch === '}') {
      take(at);
      stack.pop();
      chunkStart = at + 1;
    } else if (ch === ';') {
      take(at);
      chunkStart = at + 1;
    }
  }

  return { declarations, frames, stillness: /prefers-reduced-motion/i.test(masked) };
}

/* -------------------------------------------------------------- composing */

type Item<T> = { value: T; place: Place };

type Spec = {
  names: Item<string>[];
  durations: Item<number>[];
  easings: Item<Easing>[];
  delays: Item<number>[];
  repeats: Item<number>[];
};

function emptySpec(): Spec {
  return { names: [], durations: [], easings: [], delays: [], repeats: [] };
}

const ANIMATION_WORDS = new Set([
  'none',
  'normal',
  'reverse',
  'alternate',
  'alternate-reverse',
  'forwards',
  'backwards',
  'both',
  'running',
  'paused',
  'initial',
  'inherit',
  'unset',
]);

function placeOf(declaration: Declaration, piece: Piece): Place {
  return {
    selector: declaration.selector,
    line: declaration.line,
    property: declaration.property,
    start: piece.start,
    end: piece.end,
  };
}

/** One comma-separated part of a shorthand, filled out with the defaults it
 *  resets, so a nudge always has somewhere to write. */
function readPart(declaration: Declaration, piece: Piece, spec: Spec): void {
  const place = placeOf(declaration, piece);
  const words = split(piece.text, piece.start, bySpace);
  const animation = declaration.property === 'animation';

  const times: number[] = [];
  let easing: Easing | null = null;
  let name: string | null = null;
  let repeats: number | null = null;

  for (const word of words) {
    const flat = word.text.toLowerCase();
    const time = readTime(flat);
    if (time !== null && times.length < 2) {
      times.push(time);
      continue;
    }
    const felt = readEasing(flat);
    if (felt && easing === null) {
      easing = felt;
      continue;
    }
    if (animation) {
      if (flat === 'infinite') {
        repeats = Infinity;
        continue;
      }
      if (NUMBER.test(flat)) {
        repeats = Number(flat);
        continue;
      }
      if (ANIMATION_WORDS.has(flat)) continue;
    }
    if (name === null) name = word.text;
  }

  spec.names.push({ value: name ?? (animation ? '' : 'all'), place });
  spec.durations.push({ value: times[0] ?? 0, place });
  spec.delays.push({ value: times[1] ?? 0, place });
  spec.easings.push({ value: easing ?? PLAIN, place });
  if (animation) spec.repeats.push({ value: repeats ?? 1, place });
}

function readList<T>(
  declaration: Declaration,
  read: (text: string) => T | null,
): Item<T>[] | null {
  const items: Item<T>[] = [];
  for (const piece of split(declaration.value, declaration.start, byComma)) {
    const value = read(piece.text);
    if (value === null) return null;
    items.push({ value, place: placeOf(declaration, piece) });
  }
  return items.length > 0 ? items : null;
}

function readRepeat(text: string): number | null {
  const flat = text.trim().toLowerCase();
  if (flat === 'infinite') return Infinity;
  return NUMBER.test(flat) ? Number(flat) : null;
}

function at<T>(items: readonly Item<T>[], index: number): Item<T> | undefined {
  return items.length === 0 ? undefined : items[index % items.length];
}

function keyFor(place: Place): string {
  return `${place.property}:${String(place.start)}:${String(place.end)}`;
}

function gather(...items: (Item<unknown> | undefined)[]): readonly Place[] {
  const seen = new Set<string>();
  const places: Place[] = [];
  for (const item of items) {
    if (item === undefined) continue;
    const key = keyFor(item.place);
    if (seen.has(key)) continue;
    seen.add(key);
    places.push(item.place);
  }
  return places;
}

function specsFor(declarations: readonly Declaration[], family: 'transition' | 'animation') {
  const byBlock = new Map<number, Spec>();
  const order: number[] = [];

  for (const declaration of declarations) {
    if (declaration.property !== family && !declaration.property.startsWith(`${family}-`)) continue;
    let spec = byBlock.get(declaration.block);
    if (spec === undefined) {
      spec = emptySpec();
      byBlock.set(declaration.block, spec);
      order.push(declaration.block);
    }

    if (declaration.property === family) {
      /* A shorthand resets everything it can hold, as it does on the page. */
      const fresh = emptySpec();
      for (const piece of split(declaration.value, declaration.start, byComma)) {
        readPart(declaration, piece, fresh);
      }
      byBlock.set(declaration.block, fresh);
      continue;
    }

    const slot = declaration.property.slice(family.length + 1);
    if (slot === 'property' || slot === 'name') {
      spec.names = readList(declaration, (text) => text.trim()) ?? spec.names;
    } else if (slot === 'duration') {
      spec.durations = readList(declaration, readTime) ?? spec.durations;
    } else if (slot === 'delay') {
      spec.delays = readList(declaration, readTime) ?? spec.delays;
    } else if (slot === 'timing-function') {
      spec.easings = readList(declaration, readEasing) ?? spec.easings;
    } else if (slot === 'iteration-count') {
      spec.repeats = readList(declaration, readRepeat) ?? spec.repeats;
    }
  }

  return order.map((block) => byBlock.get(block) ?? emptySpec());
}

function idFor(move: Omit<Move, 'id' | 'places'>): string {
  return [
    move.kind,
    move.property ?? '',
    move.sequence ?? '',
    String(move.duration),
    String(move.delay),
    saidEasing(move.easing),
    String(move.repeats),
  ].join('|');
}

function collect(
  declarations: readonly Declaration[],
  family: 'transition' | 'animation',
  into: Map<string, { move: Move; places: Place[] }>,
): void {
  for (const spec of specsFor(declarations, family)) {
    const count = family === 'transition' ? Math.max(1, spec.names.length) : spec.names.length;
    for (let index = 0; index < count; index += 1) {
      const name = at(spec.names, index);
      const duration = at(spec.durations, index);
      const delay = at(spec.delays, index);
      const easing = at(spec.easings, index);
      const repeats = at(spec.repeats, index);

      const what = (name?.value ?? 'all').trim();
      if (what === '' || what.toLowerCase() === 'none') continue;
      const howLong = duration?.value ?? 0;
      if (howLong <= 0) continue;

      const bare: Omit<Move, 'id' | 'places'> = {
        kind: family === 'animation' ? 'sequence' : kindOf(what),
        property: family === 'animation' ? null : what,
        sequence: family === 'animation' ? what : null,
        duration: howLong,
        delay: delay?.value ?? 0,
        easing: easing?.value ?? PLAIN,
        repeats: repeats?.value ?? 1,
      };
      const id = idFor(bare);
      const places = gather(name, duration, delay, easing, repeats);
      const running = into.get(id);
      if (running) {
        const seen = new Set(running.places.map(keyFor));
        for (const place of places) if (!seen.has(keyFor(place))) running.places.push(place);
      } else {
        into.set(id, { move: { ...bare, id, places: [] }, places: [...places] });
      }
    }
  }
}

function sequenceKind(properties: readonly string[]): MotionKind {
  const kinds = new Set(properties.map(kindOf));
  kinds.delete('other');
  if (kinds.size === 1) return [...kinds][0] ?? 'other';
  return kinds.size === 0 ? 'other' : 'everything';
}

/** Everything a stylesheet says about how it moves. */
export function readMotion(css: string): Motion {
  const { declarations, frames, stillness } = scan(css);
  const found = new Map<string, { move: Move; places: Place[] }>();
  collect(declarations, 'transition', found);
  collect(declarations, 'animation', found);

  const moves = [...found.values()].map(({ move, places }) => ({ ...move, places }));
  const sequences = frames.map((frame) => ({
    name: frame.name,
    kind: sequenceKind([...frame.properties]),
    line: frame.line,
    stops: frame.stops,
    properties: [...frame.properties],
  }));

  return { moves, sequences, stillness };
}

/* ------------------------------------------------------------------ shelves */

export type MoveGroup = {
  readonly id: MotionKind;
  readonly title: string;
  readonly moves: readonly Move[];
};

const SHELVES: readonly { id: MotionKind; title: string }[] = [
  { id: 'movement', title: 'Movement' },
  { id: 'fade', title: 'Fades' },
  { id: 'colour', title: 'Colour' },
  { id: 'size', title: 'Size and shape' },
  { id: 'sequence', title: 'Named movements' },
  { id: 'everything', title: 'Everything at once' },
  { id: 'other', title: 'Other' },
];

export function groupMoves(moves: readonly Move[]): readonly MoveGroup[] {
  const groups: MoveGroup[] = [];
  for (const shelf of SHELVES) {
    const mine = moves.filter((move) => move.kind === shelf.id);
    if (mine.length > 0) groups.push({ id: shelf.id, title: shelf.title, moves: mine });
  }
  return groups;
}

const PLAINLY: Readonly<Record<string, string>> = {
  opacity: 'Fade',
  visibility: 'Fade',
  transform: 'Movement',
  translate: 'Movement',
  color: 'Text colour',
  background: 'Background',
  'background-color': 'Background',
  'box-shadow': 'Shadow',
  'border-radius': 'Corners',
  'font-size': 'Text size',
  filter: 'Blur and tint',
  'backdrop-filter': 'Blur behind',
  all: 'Everything',
};

/** What moved, said out loud. */
export function sayWhat(move: Move): string {
  if (move.sequence !== null) {
    const words = move.sequence.replace(/[-_]+/g, ' ').trim();
    return words === '' ? 'A named movement' : words[0]?.toUpperCase() + words.slice(1);
  }
  const property = (move.property ?? '').toLowerCase();
  const known = PLAINLY[property];
  if (known !== undefined) return known;
  const words = property.replace(/-/g, ' ').replace(/\bcolor\b/g, 'colour').trim();
  return words === '' ? 'Something' : (words[0]?.toUpperCase() ?? '') + words.slice(1);
}

/** Which demonstration stands in for a move — a named one borrows the shape of
 *  whatever its positions actually change. */
export function previewKind(move: Move, sequences: readonly Sequence[] = []): MotionKind {
  if (move.sequence === null) return move.kind;
  const found = sequences.find((one) => one.name === move.sequence);
  return found === undefined || found.kind === 'other' ? 'everything' : found.kind;
}

/* ------------------------------------------------------------------ judging */

/** Under this, it is over before the eye has followed it. */
export const TOO_FAST = 80;
/** Over this, the interface reads as waiting rather than answering. */
export const TOO_SLOW = 500;
/** A hover has to keep up with the hand. */
export const SLOW_HOVER = 250;

export type NoteId =
  | 'blink'
  | 'waiting'
  | 'slow-hover'
  | 'against-arriving'
  | 'against-leaving'
  | 'bounce-on-a-fade'
  | 'everything'
  | 'no-stillness';

export type Note = {
  readonly id: NoteId;
  /** Designer-legible, and never a number — those are beside it. */
  readonly says: string;
  /** Which movement it is about, or null when it is about the whole project. */
  readonly move: Move | null;
  readonly numbers: Readonly<Record<string, number>>;
};

const NOTES: Readonly<Record<NoteId, string>> = {
  blink: 'Over before the eye can follow it, so it reads as a jump rather than a movement.',
  waiting: 'Long enough that you wait for it to finish before you can get on.',
  'slow-hover': 'A hover this slow lags behind the hand it is answering.',
  'against-arriving':
    'This arrives by speeding up, so it looks shoved into place. Something coming in should land gently.',
  'against-leaving':
    'This leaves by slowing down, so it lingers on the way out. Something going away should get on with it.',
  'bounce-on-a-fade':
    'A bounce on something that only fades has nothing to bounce against; it just flickers past.',
  everything:
    'This moves everything at once, so anything that changes later will animate whether you meant it to or not.',
  'no-stillness':
    'Nothing here answers somebody who has asked for less movement, and some people need that.',
};

const ARRIVING = new Set([
  'in',
  'enter',
  'entering',
  'open',
  'opening',
  'opened',
  'show',
  'showing',
  'shown',
  'appear',
  'appearing',
  'reveal',
]);
const LEAVING = new Set([
  'out',
  'exit',
  'exiting',
  'close',
  'closing',
  'closed',
  'hide',
  'hiding',
  'hidden',
  'leave',
  'leaving',
  'dismiss',
]);

function wordsIn(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0);
}

/**
 * Whether this is something arriving or something going away.
 *
 * Only the last word of a selector counts, so `.is-open` is a state and
 * `.close-button` is a button. A guess that is wrong is worse than no guess.
 */
function travel(move: Move): 'arriving' | 'leaving' | null {
  const said = new Set<string>();
  if (move.sequence !== null) for (const word of wordsIn(move.sequence)) said.add(word);
  for (const place of move.places) {
    const words = wordsIn(place.selector);
    const last = words[words.length - 1];
    if (last !== undefined) said.add(last);
  }
  const arriving = [...said].some((word) => ARRIVING.has(word));
  const leaving = [...said].some((word) => LEAVING.has(word));
  if (arriving === leaving) return null;
  return arriving ? 'arriving' : 'leaving';
}

function note(id: NoteId, move: Move | null, numbers: Readonly<Record<string, number>> = {}): Note {
  return { id, says: NOTES[id], move, numbers };
}

/** What a designer would say about this movement, looking at it. */
export function judgeMotion(motion: Motion): readonly Note[] {
  const notes: Note[] = [];

  for (const move of motion.moves) {
    const numbers = { duration: move.duration, delay: move.delay };
    const hovered = move.places.some((place) => /:hover\b/i.test(place.selector));

    if (move.duration < TOO_FAST) notes.push(note('blink', move, numbers));
    else if (move.duration > TOO_SLOW) notes.push(note('waiting', move, numbers));
    else if (hovered && move.duration > SLOW_HOVER) notes.push(note('slow-hover', move, numbers));

    const feel = feelOf(move.easing);
    const way = travel(move);
    if (way === 'arriving' && (feel === 'winds-up' || feel === 'pulls-back')) {
      notes.push(note('against-arriving', move, numbers));
    }
    if (way === 'leaving' && feel === 'settles') {
      notes.push(note('against-leaving', move, numbers));
    }
    if (move.kind === 'fade' && (feel === 'overshoots' || feel === 'pulls-back')) {
      notes.push(note('bounce-on-a-fade', move, numbers));
    }
    if (move.kind === 'everything') notes.push(note('everything', move, numbers));
  }

  if (!motion.stillness && motion.moves.length > 0) notes.push(note('no-stillness', null));
  return notes;
}

/* ------------------------------------------------------------------ writing */

export type Change = {
  readonly duration?: number;
  readonly delay?: number;
  readonly easing?: Easing;
};

function rewriteShorthand(text: string, change: Change): string | null {
  const words = split(text, 0, bySpace);
  const times = words.filter((word) => readTime(word.text) !== null);
  const eased = words.find((word) => readEasing(word.text) !== null);
  const edits: { start: number; end: number; text: string }[] = [];
  const added: string[] = [];

  if (change.duration !== undefined) {
    const slot = times[0];
    if (slot) edits.push({ start: slot.start, end: slot.end, text: sayTime(change.duration) });
    else added.push(sayTime(change.duration));
  }
  if (change.easing !== undefined) {
    const said = saidEasing(change.easing);
    if (eased) edits.push({ start: eased.start, end: eased.end, text: said });
    else added.push(said);
  }
  if (change.delay !== undefined) {
    const slot = times[1];
    if (slot) edits.push({ start: slot.start, end: slot.end, text: sayTime(change.delay) });
    /* A delay written where no length is cannot be told from a length. */
    else if (times[0] || change.duration !== undefined) added.push(sayTime(change.delay));
  }
  if (edits.length === 0 && added.length === 0) return null;

  let out = text;
  for (const edit of [...edits].sort((first, second) => second.start - first.start)) {
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  }
  return added.length === 0 ? out : `${out} ${added.join(' ')}`;
}

/** One place, rewritten. Anything the place cannot hold is left alone. */
export function writeMotion(css: string, place: Place, change: Change): string {
  const text = css.slice(place.start, place.end);
  let next: string | null = null;

  if (place.property === 'transition' || place.property === 'animation') {
    next = rewriteShorthand(text, change);
  } else if (place.property.endsWith('-duration')) {
    next = change.duration === undefined ? null : sayTime(change.duration);
  } else if (place.property.endsWith('-delay')) {
    next = change.delay === undefined ? null : sayTime(change.delay);
  } else if (place.property.endsWith('-timing-function')) {
    next = change.easing === undefined ? null : saidEasing(change.easing);
  }

  if (next === null || next === text) return css;
  return css.slice(0, place.start) + next + css.slice(place.end);
}

/** Every place a movement was written, changed together. Back to front, so the
 *  offsets ahead of each edit stay true. */
export function writeMotionAll(
  css: string,
  places: readonly Place[],
  change: Change,
): string {
  const seen = new Set<string>();
  const ordered = [...places]
    .filter((place) => {
      const key = keyFor(place);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((first, second) => second.start - first.start);

  let out = css;
  for (const place of ordered) out = writeMotion(out, place, change);
  return out;
}
