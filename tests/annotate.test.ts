/** Drawing on a picture.
 *
 * The drawing itself is a hand on a canvas and cannot be tested here. What can
 * be, and what fails silently when it is wrong, is either end of it: where a
 * stroke lands when the picture is scaled and the screen is not one device pixel
 * to the CSS pixel, and what comes out the other side once somebody sends it.
 * A tool whose lines appear an inch from the cursor is the reason annotation
 * features feel broken, so most of what follows is that one sum.
 */

import { describe, expect, it } from 'vitest';

import {
  apart,
  arrowHead,
  backingFor,
  boxOf,
  centreOf,
  clampTo,
  drawMarked,
  drawMarks,
  INK,
  lookFor,
  markedName,
  MOST_PIXELS,
  notesIn,
  pictureAt,
  pinSide,
  RIM,
  saidOn,
  simplify,
  sizesFor,
  TOOLS,
  tooSmall,
  whereabouts,
  worthKeeping,
  type Ink,
  type Mark,
  type Placed,
  type Point,
  type Size,
} from '../src/lib/annotations';

/* -------------------------------------------------------------------------- */
/* A canvas nobody has to open                                                 */
/* -------------------------------------------------------------------------- */

type Called = { did: string; with: readonly unknown[] };

/** Everything a real 2D context would have been asked to do, written down. */
class Written {
  readonly calls: Called[] = [];
  lineWidth = 0;
  lineCap = '';
  lineJoin = '';
  strokeStyle = '';
  fillStyle = '';
  font = '';
  textAlign = '';
  textBaseline = '';

  /** Every stroke, paired with the width and colour in force when it happened. */
  readonly strokes: { width: number; colour: string }[] = [];
  readonly fills: { colour: string }[] = [];
  readonly texts: { said: string; x: number; y: number; colour: string }[] = [];

  private note(did: string, ...rest: unknown[]): void {
    this.calls.push({ did, with: rest });
  }

  save(): void {
    this.note('save');
  }
  restore(): void {
    this.note('restore');
  }
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.note('setTransform', a, b, c, d, e, f);
  }
  clearRect(x: number, y: number, w: number, h: number): void {
    this.note('clearRect', x, y, w, h);
  }
  beginPath(): void {
    this.note('beginPath');
  }
  moveTo(x: number, y: number): void {
    this.note('moveTo', x, y);
  }
  lineTo(x: number, y: number): void {
    this.note('lineTo', x, y);
  }
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void {
    this.note('quadraticCurveTo', cx, cy, x, y);
  }
  rect(x: number, y: number, w: number, h: number): void {
    this.note('rect', x, y, w, h);
  }
  arc(x: number, y: number, r: number): void {
    this.note('arc', x, y, r);
  }
  drawImage(picture: unknown, x: number, y: number, w: number, h: number): void {
    this.note('drawImage', picture, x, y, w, h);
  }
  stroke(): void {
    this.note('stroke');
    this.strokes.push({ width: this.lineWidth, colour: this.strokeStyle });
  }
  fill(): void {
    this.note('fill');
    this.fills.push({ colour: this.fillStyle });
  }
  fillText(said: string, x: number, y: number): void {
    this.note('fillText', said, x, y);
    this.texts.push({ said, x, y, colour: this.fillStyle });
  }

  /** Every call of one kind, in order. */
  every(did: string): readonly Called[] {
    return this.calls.filter((one) => one.did === did);
  }

  first(did: string): Called | undefined {
    return this.calls.find((one) => one.did === did);
  }
}

function pad(): { ink: Ink; wrote: Written } {
  const wrote = new Written();
  return { ink: wrote as unknown as Ink, wrote };
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

const PAGE: Size = { width: 1440, height: 900 };

function placed(left: number, top: number, width: number, height: number): Placed {
  return { left, top, width, height };
}

function box(from: Point, to: Point): Mark {
  return { id: 'b', kind: 'box', from, to };
}

function arrow(from: Point, to: Point): Mark {
  return { id: 'a', kind: 'arrow', from, to };
}

function drawn(points: readonly Point[]): Mark {
  return { id: 'f', kind: 'freehand', points };
}

function note(at: Point, text: string, id = 'n'): Mark {
  return { id, kind: 'note', at, text };
}

/* -------------------------------------------------------------------------- */
/* Where the stroke lands                                                      */
/* -------------------------------------------------------------------------- */

describe('a pointer turned into a place in the picture', () => {
  it('puts the top left corner of the element at the top left of the picture', () => {
    const at = pictureAt(placed(100, 60, 720, 450), PAGE, 100, 60);
    expect(at).toEqual({ x: 0, y: 0 });
  });

  it('scales up when the picture is shown smaller than it is', () => {
    /* Half size on screen, so one CSS pixel across is two picture pixels. */
    const at = pictureAt(placed(0, 0, 720, 450), PAGE, 360, 225);
    expect(at).toEqual({ x: 720, y: 450 });
  });

  it('lands on the far corner exactly, not near it', () => {
    const at = pictureAt(placed(37, 91, 720, 450), PAGE, 37 + 720, 91 + 450);
    expect(at).toEqual({ x: 1440, y: 900 });
  });

  it('carries the element offset out of the sum', () => {
    const at = pictureAt(placed(240, 120, 1440, 900), PAGE, 340, 220);
    expect(at).toEqual({ x: 100, y: 100 });
  });

  it('scales each side by its own measurement', () => {
    /* Layout rounds. A box measured 721 wide for a 1440-wide picture is off by
       a third of a pixel at the origin and by a visible amount at the far edge
       if one scale is taken from the width and used for both. */
    const where = placed(0, 0, 721, 449);
    const corner = pictureAt(where, PAGE, 721, 449);
    expect(corner).toEqual({ x: 1440, y: 900 });

    const middle = pictureAt(where, PAGE, 360.5, 224.5);
    expect(middle.x).toBeCloseTo(720, 6);
    expect(middle.y).toBeCloseTo(450, 6);
  });

  it('keeps a stroke inside the picture however far the pointer goes', () => {
    const off = pictureAt(placed(0, 0, 1440, 900), PAGE, -400, 4000);
    expect(off).toEqual({ x: 0, y: 900 });
  });

  it('does not divide by a measurement of nothing', () => {
    const at = pictureAt(placed(0, 0, 0, 0), PAGE, 10, 10);
    expect(Number.isFinite(at.x)).toBe(true);
    expect(Number.isFinite(at.y)).toBe(true);
  });

  it('clamps on its own too', () => {
    expect(clampTo({ x: -5, y: 1e9 }, PAGE)).toEqual({ x: 0, y: 900 });
  });
});

describe('the canvas behind the picture', () => {
  it('is one backing pixel per CSS pixel on an ordinary screen', () => {
    const back = backingFor(placed(0, 0, 1440, 900), PAGE, 1);
    expect(back).toMatchObject({ width: 1440, height: 900, scaleX: 1, scaleY: 1 });
  });

  it('doubles on a retina screen without moving where anything is drawn', () => {
    const back = backingFor(placed(0, 0, 720, 450), PAGE, 2);
    expect(back.width).toBe(1440);
    expect(back.height).toBe(900);
    /* Shown at half size on a doubled screen is one backing pixel per picture
       pixel — which is exactly the case a single naive scale gets wrong. */
    expect(back.scaleX).toBe(1);
    expect(back.scaleY).toBe(1);
  });

  it('handles the ratios that are not whole numbers', () => {
    const back = backingFor(placed(0, 0, 720, 450), PAGE, 1.5);
    expect(back.width).toBe(1080);
    expect(back.height).toBe(675);
    expect(back.scaleX).toBeCloseTo(0.75, 6);
    expect(back.scaleY).toBeCloseTo(0.75, 6);
  });

  it('a mark at the far corner still comes out at the far corner of the canvas', () => {
    for (const ratio of [1, 1.25, 1.5, 2, 3]) {
      const where = placed(0, 0, 683, 427);
      const back = backingFor(where, PAGE, ratio);
      const corner = pictureAt(where, PAGE, 683, 427);
      expect(corner.x * back.scaleX).toBeCloseTo(back.width, 6);
      expect(corner.y * back.scaleY).toBeCloseTo(back.height, 6);
    }
  });

  it('treats a nonsense device ratio as one', () => {
    for (const ratio of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(backingFor(placed(0, 0, 400, 300), PAGE, ratio).width).toBe(400);
    }
  });

  it('never asks for a canvas nothing can hold', () => {
    const back = backingFor(placed(0, 0, 4000, 3000), PAGE, 4);
    expect(back.width * back.height).toBeLessThanOrEqual(MOST_PIXELS + 4000);
    /* Still the right shape, so nothing lands askew when it is capped. */
    expect(back.width / back.height).toBeCloseTo(4000 / 3000, 3);
  });

  it('is never zero by zero', () => {
    const back = backingFor(placed(0, 0, 0, 0), PAGE, 2);
    expect(back.width).toBeGreaterThan(0);
    expect(back.height).toBeGreaterThan(0);
  });
});

/* -------------------------------------------------------------------------- */
/* The shapes themselves                                                       */
/* -------------------------------------------------------------------------- */

describe('the geometry', () => {
  it('makes a rectangle out of two corners dragged any way round', () => {
    const wanted = { x: 10, y: 20, width: 90, height: 60 };
    expect(boxOf({ x: 10, y: 20 }, { x: 100, y: 80 })).toEqual(wanted);
    expect(boxOf({ x: 100, y: 80 }, { x: 10, y: 20 })).toEqual(wanted);
    expect(boxOf({ x: 100, y: 20 }, { x: 10, y: 80 })).toEqual(wanted);
  });

  it('puts an arrow head symmetrically either side of the line', () => {
    const [one, other] = arrowHead({ x: 0, y: 0 }, { x: 100, y: 0 }, 20);
    expect(one.x).toBeCloseTo(other.x, 6);
    expect(one.y).toBeCloseTo(-other.y, 6);
    /* Behind the tip, not past it. */
    expect(one.x).toBeLessThan(100);
    expect(apart(one, { x: 100, y: 0 })).toBeCloseTo(20, 6);
    expect(apart(other, { x: 100, y: 0 })).toBeCloseTo(20, 6);
  });

  it('turns the head with the arrow', () => {
    const [one, other] = arrowHead({ x: 0, y: 0 }, { x: 0, y: 100 }, 20);
    expect(one.y).toBeLessThan(100);
    expect(other.y).toBeLessThan(100);
    expect(one.x).toBeCloseTo(-other.x, 6);
  });

  it('finds the middle of every kind of mark', () => {
    expect(centreOf(box({ x: 0, y: 0 }, { x: 100, y: 50 }))).toEqual({ x: 50, y: 25 });
    expect(centreOf(arrow({ x: 0, y: 0 }, { x: 100, y: 50 }))).toEqual({ x: 50, y: 25 });
    expect(centreOf(note({ x: 7, y: 9 }, 'here'))).toEqual({ x: 7, y: 9 });
    expect(
      centreOf(drawn([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }])),
    ).toEqual({ x: 5, y: 5 });
  });

  it('does not fall over on a line with no points in it', () => {
    expect(centreOf(drawn([]))).toEqual({ x: 0, y: 0 });
  });
});

describe('what is worth keeping', () => {
  it('throws away a click that wobbled', () => {
    expect(worthKeeping(box({ x: 100, y: 100 }, { x: 101, y: 100 }), PAGE)).toBe(false);
    expect(worthKeeping(arrow({ x: 100, y: 100 }, { x: 100, y: 100 }), PAGE)).toBe(false);
    expect(worthKeeping(drawn([{ x: 5, y: 5 }]), PAGE)).toBe(false);
    expect(worthKeeping(drawn([]), PAGE)).toBe(false);
  });

  it('keeps a real one', () => {
    expect(worthKeeping(box({ x: 100, y: 100 }, { x: 300, y: 200 }), PAGE)).toBe(true);
    expect(worthKeeping(arrow({ x: 0, y: 0 }, { x: 200, y: 200 }), PAGE)).toBe(true);
    expect(
      worthKeeping(drawn([{ x: 0, y: 0 }, { x: 30, y: 4 }, { x: 60, y: 10 }]), PAGE),
    ).toBe(true);
  });

  it('a note is worth keeping only once something is written on it', () => {
    expect(worthKeeping(note({ x: 10, y: 10 }, '   '), PAGE)).toBe(false);
    expect(worthKeeping(note({ x: 10, y: 10 }, 'tighter'), PAGE)).toBe(true);
  });

  it('asks for more of a wobble on a bigger picture', () => {
    expect(tooSmall({ width: 400, height: 300 })).toBeLessThan(
      tooSmall({ width: 3200, height: 2000 }),
    );
  });
});

describe('thinning a hand-drawn line', () => {
  it('takes the middle out of a straight run', () => {
    const straight = Array.from({ length: 40 }, (_, i) => ({ x: i * 5, y: 100 }));
    const thinner = simplify(straight, 1);
    expect(thinner).toHaveLength(2);
    expect(thinner[0]).toEqual({ x: 0, y: 100 });
    expect(thinner[thinner.length - 1]).toEqual({ x: 195, y: 100 });
  });

  it('keeps the corner of a line that turns', () => {
    const bent = [
      { x: 0, y: 0 },
      { x: 25, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 40 },
      { x: 50, y: 80 },
    ];
    const thinner = simplify(bent, 1);
    expect(thinner).toContainEqual({ x: 50, y: 0 });
    expect(thinner).toHaveLength(3);
  });

  it('always keeps both ends', () => {
    const wiggly = Array.from({ length: 200 }, (_, i) => ({
      x: i,
      y: Math.sin(i / 3) * 20,
    }));
    const thinner = simplify(wiggly, 4);
    expect(thinner.length).toBeLessThan(wiggly.length);
    expect(thinner[0]).toEqual(wiggly[0]);
    expect(thinner[thinner.length - 1]).toEqual(wiggly[wiggly.length - 1]);
  });

  it('leaves a short line alone', () => {
    const two = [{ x: 0, y: 0 }, { x: 4, y: 4 }];
    expect(simplify(two, 2)).toEqual(two);
    expect(simplify(two, 0)).toEqual(two);
  });

  it('does not run the call stack out on a long slow stroke', () => {
    const long = Array.from({ length: 6000 }, (_, i) => ({ x: i * 0.1, y: (i % 7) * 3 }));
    expect(() => simplify(long, 0.5)).not.toThrow();
  });
});

/* -------------------------------------------------------------------------- */
/* What gets painted                                                           */
/* -------------------------------------------------------------------------- */

describe('painting the marks', () => {
  it('draws in the picture’s own coordinates, whatever the screen is doing', () => {
    const { ink, wrote } = pad();
    drawMarks(ink, [box({ x: 100, y: 50 }, { x: 300, y: 250 })], lookFor(PAGE, 0.5, 0.5));

    expect(wrote.first('setTransform')?.with).toEqual([0.5, 0, 0, 0.5, 0, 0]);
    /* The rectangle is still stated in picture pixels — the transform is the
       only place the screen's scale appears. */
    expect(wrote.first('rect')?.with).toEqual([100, 50, 200, 200]);
  });

  it('lays a dark edge under every stroke so it reads on a light screenshot and a dark one', () => {
    const { ink, wrote } = pad();
    drawMarks(ink, [box({ x: 0, y: 0 }, { x: 10, y: 10 })], lookFor(PAGE));

    expect(wrote.strokes).toHaveLength(2);
    const [rim, colour] = wrote.strokes;
    expect(rim?.colour).toBe(RIM);
    expect(colour?.colour).toBe(INK);
    /* The edge is wider, or it is not an edge. */
    expect(rim?.width).toBeGreaterThan(colour?.width ?? 0);
  });

  it('draws an arrow as a shaft and two barbs', () => {
    const { ink, wrote } = pad();
    drawMarks(ink, [arrow({ x: 0, y: 0 }, { x: 100, y: 0 })], lookFor(PAGE));

    expect(wrote.every('moveTo')).toHaveLength(2);
    expect(wrote.every('lineTo')).toHaveLength(3);
  });

  it('draws a hand-drawn line as curves rather than corners', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 10, y: 5 },
      { x: 20, y: 0 },
      { x: 30, y: 5 },
      { x: 40, y: 0 },
    ];
    const { ink, wrote } = pad();
    drawMarks(ink, [drawn(points)], lookFor(PAGE));

    expect(wrote.every('quadraticCurveTo')).toHaveLength(points.length - 2);
    expect(wrote.first('moveTo')?.with).toEqual([0, 0]);
  });

  it('numbers the pins in the order the notes were made', () => {
    const { ink, wrote } = pad();
    drawMarks(
      ink,
      [
        note({ x: 10, y: 10 }, 'first', 'n1'),
        box({ x: 0, y: 0 }, { x: 50, y: 50 }),
        note({ x: 80, y: 80 }, 'second', 'n2'),
      ],
      lookFor(PAGE),
    );

    expect(wrote.texts.map((one) => one.said)).toEqual(['1', '2']);
    expect(wrote.texts[0]).toMatchObject({ x: 10, y: 10 });
    expect(wrote.texts[1]).toMatchObject({ x: 80, y: 80 });
  });

  it('fills a pin with the ink and writes the number on top of it', () => {
    const { ink, wrote } = pad();
    drawMarks(ink, [note({ x: 10, y: 10 }, 'hello')], lookFor(PAGE));

    expect(wrote.fills[0]?.colour).toBe(INK);
    expect(wrote.texts[0]?.colour).not.toBe(INK);
  });

  it('puts the state back the way it found it', () => {
    const { ink, wrote } = pad();
    drawMarks(ink, [box({ x: 0, y: 0 }, { x: 5, y: 5 })], lookFor(PAGE));
    expect(wrote.every('save')).toHaveLength(1);
    expect(wrote.every('restore')).toHaveLength(1);
  });

  it('draws nothing at all when nothing has been drawn', () => {
    const { ink, wrote } = pad();
    drawMarks(ink, [], lookFor(PAGE));
    expect(wrote.strokes).toHaveLength(0);
    expect(wrote.fills).toHaveLength(0);
  });

  it('scales the stroke to the picture, so a retina screenshot gets no hairlines', () => {
    expect(sizesFor({ width: 320, height: 200 }).stroke).toBeLessThan(
      sizesFor({ width: 3200, height: 2000 }).stroke,
    );
    expect(sizesFor({ width: 8, height: 8 }).stroke).toBeGreaterThanOrEqual(2);
    expect(sizesFor({ width: 40000, height: 40000 }).stroke).toBeLessThanOrEqual(14);
  });
});

describe('the picture that gets sent', () => {
  it('is the picture at its own size with the marks on top', () => {
    const { ink, wrote } = pad();
    const picture = { itIs: 'the screenshot' };
    drawMarked(
      ink,
      picture as unknown as CanvasImageSource,
      PAGE,
      [box({ x: 100, y: 100 }, { x: 400, y: 300 })],
    );

    expect(wrote.first('clearRect')?.with).toEqual([0, 0, 1440, 900]);
    expect(wrote.first('drawImage')?.with).toEqual([picture, 0, 0, 1440, 900]);
    /* One to one, so the marks land on the pixels they were drawn over. */
    const transforms = wrote.every('setTransform');
    expect(transforms[0]?.with).toEqual([1, 0, 0, 1, 0, 0]);
    expect(transforms[1]?.with).toEqual([1, 0, 0, 1, 0, 0]);
  });

  it('puts the picture down before the marks', () => {
    const { ink, wrote } = pad();
    drawMarked(
      ink,
      {} as unknown as CanvasImageSource,
      PAGE,
      [box({ x: 0, y: 0 }, { x: 10, y: 10 })],
    );
    const order = wrote.calls.map((one) => one.did);
    expect(order.indexOf('drawImage')).toBeLessThan(order.indexOf('rect'));
  });
});

/* -------------------------------------------------------------------------- */
/* What it says                                                                */
/* -------------------------------------------------------------------------- */

describe('saying where things are', () => {
  it('uses the words a person uses', () => {
    expect(whereabouts({ x: 50, y: 50 }, PAGE)).toBe('top left');
    expect(whereabouts({ x: 720, y: 450 }, PAGE)).toBe('middle');
    expect(whereabouts({ x: 1400, y: 880 }, PAGE)).toBe('bottom right');
    expect(whereabouts({ x: 720, y: 20 }, PAGE)).toBe('top');
    expect(whereabouts({ x: 20, y: 450 }, PAGE)).toBe('left');
  });

  it('answers for a picture with no size rather than saying nothing', () => {
    expect(whereabouts({ x: 0, y: 0 }, { width: 0, height: 0 })).toBe('top left');
  });
});

describe('the marks in words', () => {
  it('says nothing when nothing was drawn', () => {
    expect(saidOn([], PAGE)).toBe('');
  });

  it('names the picture size, so the numbers mean something', () => {
    const said = saidOn([box({ x: 0, y: 0 }, { x: 10, y: 10 })], PAGE);
    expect(said).toContain('1440 by 900');
    expect(said.toLowerCase()).toContain('pixels from the top left');
  });

  it('gives a box its corners and its whereabouts', () => {
    const said = saidOn([box({ x: 320, y: 180 }, { x: 640, y: 260 })], PAGE);
    expect(said).toContain('A box around 320, 180 to 640, 260');
    expect(said).toContain('top left');
  });

  it('says which end of an arrow is the point', () => {
    const said = saidOn([arrow({ x: 1200, y: 700 }, { x: 300, y: 200 })], PAGE);
    expect(said).toContain('from 1200, 700 to 300, 200');
    expect(said).toContain('pointing at the top left');
  });

  it('numbers the notes the same way the pins are numbered', () => {
    const marks = [
      note({ x: 100, y: 100 }, 'this, but tighter', 'n1'),
      box({ x: 0, y: 0 }, { x: 50, y: 50 }),
      note({ x: 1300, y: 800 }, 'and this is too dark', 'n2'),
    ];
    const said = saidOn(marks, PAGE);
    expect(said).toContain('Note 1, at 100, 100');
    expect(said).toContain('this, but tighter');
    expect(said).toContain('Note 2, at 1300, 800');
    expect(said).toContain('and this is too dark');
    expect(notesIn(marks).map((one) => one.number)).toEqual([1, 2]);
  });

  it('keeps a note on one line however it was typed', () => {
    const said = saidOn([note({ x: 10, y: 10 }, '  tighter\n\n  and darker  ')], PAGE);
    expect(said).toContain('tighter and darker');
    expect(said.split('\n').filter((line) => line.includes('Note 1'))).toHaveLength(1);
  });

  it('keeps every mark, in the order it was drawn', () => {
    const said = saidOn(
      [
        box({ x: 0, y: 0 }, { x: 10, y: 10 }),
        arrow({ x: 0, y: 0 }, { x: 10, y: 10 }),
        drawn([{ x: 400, y: 700 }, { x: 500, y: 780 }]),
        note({ x: 10, y: 10 }, 'here'),
      ],
      PAGE,
    );
    const lines = said.split('\n').filter((line) => line !== '');
    expect(lines).toHaveLength(5);
    expect(lines[1]).toContain('A box');
    expect(lines[2]).toContain('An arrow');
    expect(lines[3]).toContain('drawn by hand');
    expect(lines[4]).toContain('Note 1');
  });

  it('says so plainly when a pin was left blank', () => {
    const said = saidOn([note({ x: 10, y: 10 }, '')], PAGE);
    expect(said).toContain('nothing written');
  });

  it('rounds, because half a pixel is not a thing anybody means', () => {
    const said = saidOn([note({ x: 100.4, y: 99.6 }, 'here')], PAGE);
    expect(said).toContain('100, 100');
  });
});

describe('the small decisions', () => {
  it('offers four tools and no more', () => {
    expect(TOOLS).toEqual(['box', 'arrow', 'freehand', 'note']);
  });

  it('puts a note’s words on the side of the pin they will fit', () => {
    expect(pinSide({ x: 100, y: 100 }, PAGE)).toBe('right');
    expect(pinSide({ x: 1400, y: 100 }, PAGE)).toBe('left');
  });

  it('keeps the picture’s name on the copy', () => {
    expect(markedName('Landing v4.png')).toBe('Landing v4 drawn on.png');
    expect(markedName('shot.jpeg')).toBe('shot drawn on.png');
    expect(markedName('no extension')).toBe('no extension drawn on.png');
    expect(markedName(undefined)).toBe('Drawn on.png');
    expect(markedName('   ')).toBe('Drawn on.png');
  });
});
