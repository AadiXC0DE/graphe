/** Drawing on a picture: where a stroke lands, what gets painted on it, and
 *  what the marks say once somebody sends them.
 *
 *  No DOM here beyond the shape of a canvas context. The component owns the
 *  element, the pointer and the animation frames; everything in this file is
 *  arithmetic, so the part that decides whether a line lands under the cursor
 *  can be read and tested without a browser.
 */

export type Point = { x: number; y: number };
export type Size = { width: number; height: number };
export type Box = { x: number; y: number; width: number; height: number };

/** Where the picture is sitting on screen, in CSS pixels. */
export type Placed = { left: number; top: number; width: number; height: number };

export type Mark =
  | { id: string; kind: 'box'; from: Point; to: Point }
  | { id: string; kind: 'arrow'; from: Point; to: Point }
  | { id: string; kind: 'freehand'; points: readonly Point[] }
  | { id: string; kind: 'note'; at: Point; text: string };

export type Tool = Mark['kind'];

/** Four, in the order a hand reaches for them. A palette of twelve is a palette
 *  nobody learns. */
export const TOOLS: readonly Tool[] = ['box', 'arrow', 'freehand', 'note'];

export type Note = Extract<Mark, { kind: 'note' }>;

/** The marks, and the same marks in words. What a message carries. */
export type Marked = {
  /** The picture with the marks on it, ready to attach. */
  file: File;
  /** The same picture, for anything that wants to show it straight away. */
  dataUrl: string;
  width: number;
  height: number;
  /** What was drawn, in sentences with coordinates. Empty when nothing was. */
  said: string;
  marks: readonly Mark[];
};

/* -------------------------------------------------------------------------- */
/* Colour                                                                      */
/* -------------------------------------------------------------------------- */

/** One ink, warm enough to read on a dark screenshot and saturated enough to
 *  read on a white one. Screenshots are somebody else's palette, so ours is a
 *  single hue that does not pretend to belong to it. */
export const INK = '#ec5a2e';

/** A dark edge carried under every stroke, for the case the ink and the pixels
 *  beneath it happen to be the same colour. Invisible on a dark ground, which
 *  is exactly where the ink itself is brightest. */
export const RIM = 'rgba(0, 0, 0, 0.4)';

/** The number inside a note's pin. Always light, because the pin is always ink. */
const ON_INK = '#ffffff';

const PIN_FONT = "ui-sans-serif, -apple-system, system-ui, 'Segoe UI', sans-serif";

/* -------------------------------------------------------------------------- */
/* Small arithmetic                                                            */
/* -------------------------------------------------------------------------- */

function clamp(value: number, least: number, most: number): number {
  if (!Number.isFinite(value)) return least;
  return Math.min(most, Math.max(least, value));
}

export function clampTo(point: Point, size: Size): Point {
  return {
    x: clamp(point.x, 0, Math.max(0, size.width)),
    y: clamp(point.y, 0, Math.max(0, size.height)),
  };
}

export function apart(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** A rectangle from two corners, dragged in any direction. */
export function boxOf(from: Point, to: Point): Box {
  return {
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
    width: Math.abs(to.x - from.x),
    height: Math.abs(to.y - from.y),
  };
}

export function centreOf(mark: Mark): Point {
  switch (mark.kind) {
    case 'box': {
      const box = boxOf(mark.from, mark.to);
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    }
    case 'arrow':
      return { x: (mark.from.x + mark.to.x) / 2, y: (mark.from.y + mark.to.y) / 2 };
    case 'note':
      return mark.at;
    case 'freehand': {
      if (mark.points.length === 0) return { x: 0, y: 0 };
      let x = 0;
      let y = 0;
      for (const point of mark.points) {
        x += point.x;
        y += point.y;
      }
      return { x: x / mark.points.length, y: y / mark.points.length };
    }
  }
}

/** The two barbs of an arrow head, splayed either side of the line it ends. */
export function arrowHead(from: Point, to: Point, length: number): readonly [Point, Point] {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const spread = 0.42;
  return [
    { x: to.x - length * Math.cos(angle - spread), y: to.y - length * Math.sin(angle - spread) },
    { x: to.x - length * Math.cos(angle + spread), y: to.y - length * Math.sin(angle + spread) },
  ];
}

/* -------------------------------------------------------------------------- */
/* Where the cursor is                                                         */
/* -------------------------------------------------------------------------- */

/**
 * A pointer position turned into a position in the picture's own pixels.
 *
 * Each axis is scaled by its own measured side rather than by one number taken
 * from the width. Layout rounds, and a single scale is off by a fraction of a
 * pixel at the origin and by a visible amount at the far corner — which is the
 * bug that makes an annotation tool feel broken.
 */
export function pictureAt(where: Placed, natural: Size, clientX: number, clientY: number): Point {
  const across = where.width > 0 ? natural.width / where.width : 1;
  const down = where.height > 0 ? natural.height / where.height : 1;
  return clampTo(
    { x: (clientX - where.left) * across, y: (clientY - where.top) * down },
    natural,
  );
}

/** Past this many pixels a canvas costs more memory than the picture is worth.
 *  Reached only on a very large surface at a very high device ratio. */
export const MOST_PIXELS = 12_000_000;

export type Backing = { width: number; height: number; scaleX: number; scaleY: number };

/**
 * How big the canvas behind the picture has to be, and what to scale drawing by.
 *
 * The scales carry the device ratio and the on-screen fit together, so marks are
 * held in the picture's own pixels everywhere else and this is the only place
 * either of those numbers appears.
 */
export function backingFor(where: Placed, natural: Size, ratio: number): Backing {
  const dpr = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
  const cssWide = Math.max(0, where.width);
  const cssTall = Math.max(0, where.height);

  const asked = cssWide * cssTall * dpr * dpr;
  const used = asked > MOST_PIXELS ? dpr * Math.sqrt(MOST_PIXELS / asked) : dpr;

  const width = Math.max(1, Math.round(cssWide * used));
  const height = Math.max(1, Math.round(cssTall * used));
  return {
    width,
    height,
    scaleX: natural.width > 0 ? width / natural.width : 1,
    scaleY: natural.height > 0 ? height / natural.height : 1,
  };
}

/* -------------------------------------------------------------------------- */
/* How thick                                                                   */
/* -------------------------------------------------------------------------- */

export type Sizes = { stroke: number; head: number; pin: number; text: number };

/** Stroke weights in the picture's own pixels, so a mark on a retina screenshot
 *  is the same mark as one on a small crop rather than a hairline on one and a
 *  bar on the other. */
export function sizesFor(natural: Size): Sizes {
  const across = Math.max(1, natural.width, natural.height);
  const stroke = clamp(Math.round(across / 450), 2, 14);
  return { stroke, head: stroke * 4.5, pin: stroke * 3.4, text: stroke * 3.6 };
}

export type Look = {
  scaleX: number;
  scaleY: number;
  ink: string;
  rim: string;
  sizes: Sizes;
};

export function lookFor(natural: Size, scaleX = 1, scaleY = scaleX, ink = INK): Look {
  return { scaleX, scaleY, ink, rim: RIM, sizes: sizesFor(natural) };
}

/* -------------------------------------------------------------------------- */
/* Keeping a stroke, and thinning it out                                       */
/* -------------------------------------------------------------------------- */

/** Below this a drag is a click that wobbled, not a box. */
export function tooSmall(natural: Size): number {
  return Math.max(3, Math.max(natural.width, natural.height) / 300);
}

/** Whether a mark is worth adding. A stray click should leave nothing behind. */
export function worthKeeping(mark: Mark, natural: Size): boolean {
  const least = tooSmall(natural);
  switch (mark.kind) {
    case 'box':
    case 'arrow':
      return apart(mark.from, mark.to) >= least;
    case 'freehand': {
      if (mark.points.length < 2) return false;
      let run = 0;
      for (let i = 1; i < mark.points.length; i += 1) {
        const before = mark.points[i - 1];
        const now = mark.points[i];
        if (before === undefined || now === undefined) continue;
        run += apart(before, now);
      }
      return run >= least;
    }
    case 'note':
      return mark.text.trim() !== '';
  }
}

/**
 * A hand-drawn line with the points that were only ever hand tremor taken out.
 *
 * Ramer–Douglas–Peucker, done with an explicit stack rather than recursion so a
 * long slow stroke cannot run the call stack out.
 */
export function simplify(points: readonly Point[], tolerance: number): readonly Point[] {
  if (points.length < 3 || tolerance <= 0) return points;

  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;

  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const span = stack.pop();
    if (span === undefined) continue;
    const [first, last] = span;
    const a = points[first];
    const b = points[last];
    if (a === undefined || b === undefined || last - first < 2) continue;

    let worst = -1;
    let at = -1;
    for (let i = first + 1; i < last; i += 1) {
      const point = points[i];
      if (point === undefined) continue;
      const away = offLine(point, a, b);
      if (away > worst) {
        worst = away;
        at = i;
      }
    }

    if (worst > tolerance && at > 0) {
      keep[at] = true;
      stack.push([first, at], [at, last]);
    }
  }

  return points.filter((_, index) => keep[index] === true);
}

/** How far a point sits off the line between two others. */
function offLine(point: Point, a: Point, b: Point): number {
  const runX = b.x - a.x;
  const runY = b.y - a.y;
  const length = Math.hypot(runX, runY);
  if (length === 0) return apart(point, a);
  return Math.abs(runY * (point.x - a.x) - runX * (point.y - a.y)) / length;
}

/* -------------------------------------------------------------------------- */
/* Painting                                                                    */
/* -------------------------------------------------------------------------- */

/** The part of a canvas this file touches. A real 2D context satisfies it, and
 *  so can something written down in a test. */
export type Ink = Pick<
  CanvasRenderingContext2D,
  | 'save'
  | 'restore'
  | 'setTransform'
  | 'clearRect'
  | 'beginPath'
  | 'moveTo'
  | 'lineTo'
  | 'quadraticCurveTo'
  | 'rect'
  | 'arc'
  | 'stroke'
  | 'fill'
  | 'fillText'
  | 'drawImage'
  | 'lineWidth'
  | 'lineCap'
  | 'lineJoin'
  | 'strokeStyle'
  | 'fillStyle'
  | 'font'
  | 'textAlign'
  | 'textBaseline'
>;

/** The notes in the order they were made, each with the number on its pin. */
export function notesIn(marks: readonly Mark[]): readonly { note: Note; number: number }[] {
  const found: { note: Note; number: number }[] = [];
  for (const mark of marks) {
    if (mark.kind === 'note') found.push({ note: mark, number: found.length + 1 });
  }
  return found;
}

/** Which side of a pin its words will fit on. */
export function pinSide(at: Point, natural: Size): 'left' | 'right' {
  return natural.width > 0 && at.x / natural.width > 0.62 ? 'left' : 'right';
}

function traceArrow(ink: Ink, from: Point, to: Point, head: number): void {
  ink.moveTo(from.x, from.y);
  ink.lineTo(to.x, to.y);
  const [one, other] = arrowHead(from, to, head);
  ink.moveTo(one.x, one.y);
  ink.lineTo(to.x, to.y);
  ink.lineTo(other.x, other.y);
}

/** Through the midpoints, with the recorded points as the control handles —
 *  the cheapest way to make a sampled drag read as a drawn line. */
function traceFreehand(ink: Ink, points: readonly Point[]): void {
  const first = points[0];
  if (first === undefined) return;
  ink.moveTo(first.x, first.y);

  const last = points[points.length - 1];
  if (last === undefined || points.length === 1) return;

  for (let i = 1; i < points.length - 1; i += 1) {
    const here = points[i];
    const next = points[i + 1];
    if (here === undefined || next === undefined) continue;
    ink.quadraticCurveTo(here.x, here.y, (here.x + next.x) / 2, (here.y + next.y) / 2);
  }
  ink.lineTo(last.x, last.y);
}

/** Once dark and wide, once in ink and narrower. Two passes over one path is
 *  what keeps a stroke legible over pixels of any colour. */
function strokeTwice(ink: Ink, look: Look): void {
  ink.lineWidth = look.sizes.stroke + Math.max(2, look.sizes.stroke * 0.9);
  ink.strokeStyle = look.rim;
  ink.stroke();
  ink.lineWidth = look.sizes.stroke;
  ink.strokeStyle = look.ink;
  ink.stroke();
}

function drawPin(ink: Ink, at: Point, number: number, look: Look): void {
  ink.beginPath();
  ink.arc(at.x, at.y, look.sizes.pin, 0, Math.PI * 2);
  ink.lineWidth = Math.max(2, look.sizes.stroke * 0.9);
  ink.strokeStyle = look.rim;
  ink.stroke();
  ink.fillStyle = look.ink;
  ink.fill();

  ink.fillStyle = ON_INK;
  ink.font = `600 ${String(look.sizes.text)}px ${PIN_FONT}`;
  ink.textAlign = 'center';
  ink.textBaseline = 'middle';
  ink.fillText(String(number), at.x, at.y);
}

/** Every mark, in the picture's own coordinates. The caller clears first. */
export function drawMarks(ink: Ink, marks: readonly Mark[], look: Look): void {
  ink.save();
  ink.setTransform(look.scaleX, 0, 0, look.scaleY, 0, 0);
  ink.lineCap = 'round';
  ink.lineJoin = 'round';

  let numbered = 0;
  for (const mark of marks) {
    if (mark.kind === 'note') {
      numbered += 1;
      drawPin(ink, mark.at, numbered, look);
      continue;
    }

    ink.beginPath();
    if (mark.kind === 'box') {
      const box = boxOf(mark.from, mark.to);
      ink.rect(box.x, box.y, box.width, box.height);
    } else if (mark.kind === 'arrow') {
      traceArrow(ink, mark.from, mark.to, look.sizes.head);
    } else {
      traceFreehand(ink, mark.points);
    }
    strokeTwice(ink, look);
  }

  ink.restore();
}

/** The picture at its own size with the marks on top — what gets sent. */
export function drawMarked(
  ink: Ink,
  picture: CanvasImageSource,
  natural: Size,
  marks: readonly Mark[],
): void {
  ink.setTransform(1, 0, 0, 1, 0, 0);
  ink.clearRect(0, 0, natural.width, natural.height);
  ink.drawImage(picture, 0, 0, natural.width, natural.height);
  drawMarks(ink, marks, lookFor(natural));
}

/* -------------------------------------------------------------------------- */
/* Saying it                                                                   */
/* -------------------------------------------------------------------------- */

const WHERE: readonly (readonly string[])[] = [
  ['top left', 'top', 'top right'],
  ['left', 'middle', 'right'],
  ['bottom left', 'bottom', 'bottom right'],
];

function third(fraction: number): 0 | 1 | 2 {
  if (!Number.isFinite(fraction) || fraction < 1 / 3) return 0;
  return fraction < 2 / 3 ? 1 : 2;
}

/** A position in the words somebody would use for it. */
export function whereabouts(at: Point, natural: Size): string {
  const down = WHERE[third(natural.height > 0 ? at.y / natural.height : 0)];
  return down?.[third(natural.width > 0 ? at.x / natural.width : 0)] ?? 'middle';
}

function spot(point: Point): string {
  return `${String(Math.round(point.x))}, ${String(Math.round(point.y))}`;
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * The marks as sentences, with the numbers still in them.
 *
 * This is the half a model reads: it gets the marked-up picture *and* this, so a
 * box in the corner arrives with the words that were written beside it rather
 * than as a rectangle it has to guess the meaning of.
 */
export function saidOn(marks: readonly Mark[], natural: Size): string {
  if (marks.length === 0) return '';

  const lines: string[] = [
    `Drawn on a picture ${String(Math.round(natural.width))} by ${String(
      Math.round(natural.height),
    )}. Positions are in pixels from the top left.`,
    '',
  ];

  let numbered = 0;
  for (const mark of marks) {
    switch (mark.kind) {
      case 'box': {
        const box = boxOf(mark.from, mark.to);
        lines.push(
          `A box around ${spot({ x: box.x, y: box.y })} to ${spot({
            x: box.x + box.width,
            y: box.y + box.height,
          })}, in the ${whereabouts(centreOf(mark), natural)}.`,
        );
        break;
      }
      case 'arrow':
        lines.push(
          `An arrow from ${spot(mark.from)} to ${spot(mark.to)}, pointing at the ${whereabouts(
            mark.to,
            natural,
          )}.`,
        );
        break;
      case 'freehand': {
        const middle = centreOf(mark);
        lines.push(`A line drawn by hand around ${spot(middle)}, in the ${whereabouts(middle, natural)}.`);
        break;
      }
      case 'note': {
        numbered += 1;
        const said = oneLine(mark.text);
        lines.push(
          said === ''
            ? `Note ${String(numbered)}, at ${spot(mark.at)} in the ${whereabouts(mark.at, natural)}, with nothing written on it.`
            : `Note ${String(numbered)}, at ${spot(mark.at)} in the ${whereabouts(
                mark.at,
                natural,
              )}: “${said}”`,
        );
        break;
      }
    }
  }

  return lines.join('\n');
}

/** What the marked-up copy is called. Keeps the original name, so a chip in the
 *  composer still reads as the picture somebody recognises. */
export function markedName(name: string | undefined): string {
  const given = (name ?? '').trim();
  if (given === '') return 'Drawn on.png';
  const dot = given.lastIndexOf('.');
  const stem = dot > 0 ? given.slice(0, dot) : given;
  return `${stem} drawn on.png`;
}
