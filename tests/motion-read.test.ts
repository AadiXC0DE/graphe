/** How it moves, read off the page.
 *
 * Two things are tested here and they fail differently. The arithmetic — curves,
 * lengths, what a stylesheet actually says — is either right or it is a
 * confident lie about somebody's own work. The sentences are language: wrong,
 * and the panel reads like a machine lecturing a designer about mechanisms.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  FEELS,
  PLAIN,
  SLOW_HOVER,
  TOO_FAST,
  TOO_SLOW,
  curvePath,
  easingForFeel,
  feelOf,
  groupMoves,
  judgeMotion,
  kindOf,
  previewKind,
  progressAt,
  readEasing,
  readMotion,
  readTime,
  saidEasing,
  sayEasing,
  sayTime,
  sayWhat,
  sample,
  timeSteps,
  writeMotion,
  writeMotionAll,
  type Easing,
  type Move,
  type NoteId,
} from '../src/motion/read';

/* An easing that is definitely a curve, for the places where a type guard would
   otherwise stand in front of the numbers. */
function points(easing: Easing | null): readonly number[] {
  expect(easing?.kind).toBe('curve');
  return easing?.kind === 'curve' ? easing.points : [];
}

/** Deliberately slow and deliberately stupid, so it cannot share a bug with the
 *  implementation: halve the interval until x lands, then read y. */
function bruteForce(
  [x1, y1, x2, y2]: readonly [number, number, number, number],
  x: number,
): number {
  const along = (a: number, b: number, t: number): number =>
    3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t * t * b + t ** 3;
  let low = 0;
  let high = 1;
  let t = 0.5;
  for (let round = 0; round < 200; round += 1) {
    t = (low + high) / 2;
    if (along(x1, x2, t) < x) low = t;
    else high = t;
  }
  return along(y1, y2, t);
}

function moveFor(css: string, what: string): Move | undefined {
  return readMotion(css).moves.find((move) => move.property === what || move.sequence === what);
}

/* ========================================================================== */
/* M-01 every way an easing can be written                                     */
/* ========================================================================== */

describe('M-01 reading an easing', () => {
  it('reads the ones that have names', () => {
    expect(points(readEasing('linear'))).toEqual([0, 0, 1, 1]);
    expect(points(readEasing('ease'))).toEqual([0.25, 0.1, 0.25, 1]);
    expect(points(readEasing('ease-in'))).toEqual([0.42, 0, 1, 1]);
    expect(points(readEasing('ease-out'))).toEqual([0, 0, 0.58, 1]);
    expect(points(readEasing('ease-in-out'))).toEqual([0.42, 0, 0.58, 1]);
  });

  it('keeps the name it was written under', () => {
    const named = readEasing('ease-out');
    expect(named?.kind === 'curve' ? named.named : null).toBe('ease-out');
    const spelled = readEasing('cubic-bezier(0, 0, 0.58, 1)');
    expect(spelled?.kind === 'curve' ? spelled.named : 'x').toBeNull();
  });

  it('does not care about case or the space around it', () => {
    expect(readEasing('  EASE-IN-OUT ')).toEqual(readEasing('ease-in-out'));
    expect(readEasing(' CUBIC-BEZIER( 0.1 , 0.2 , 0.3 , 0.4 ) ')).toEqual(
      readEasing('cubic-bezier(0.1,0.2,0.3,0.4)'),
    );
  });

  it('reads the two stepped names', () => {
    expect(readEasing('step-start')).toEqual({ kind: 'steps', count: 1, jump: 'start' });
    expect(readEasing('step-end')).toEqual({ kind: 'steps', count: 1, jump: 'end' });
  });

  it('reads four numbers however they are spelled', () => {
    expect(points(readEasing('cubic-bezier(.17,.67,.83,.67)'))).toEqual([0.17, 0.67, 0.83, 0.67]);
    expect(points(readEasing('cubic-bezier(0.6, -0.28, 0.735, 0.045)'))).toEqual([
      0.6, -0.28, 0.735, 0.045,
    ]);
    expect(points(readEasing('cubic-bezier(+0.5, 1.5, 0.5, 1)'))).toEqual([0.5, 1.5, 0.5, 1]);
    expect(points(readEasing('cubic-bezier(1e-1, 0, 5e-1, 1)'))).toEqual([0.1, 0, 0.5, 1]);
  });

  it('refuses a curve that would run time backwards', () => {
    expect(readEasing('cubic-bezier(1.2, 0, 0.5, 1)')).toBeNull();
    expect(readEasing('cubic-bezier(0.5, 0, -0.2, 1)')).toBeNull();
  });

  it('refuses a malformed curve rather than guessing at it', () => {
    for (const bad of [
      'cubic-bezier(0, 0, 1)',
      'cubic-bezier(0, 0, 1, 1, 1)',
      'cubic-bezier()',
      'cubic-bezier(a, b, c, d)',
      'cubic-bezier(0, 0, , 1)',
      'cubic-bezier(0 0 1 1)',
      'cubic-bezier(0, 0, 1, 1',
    ]) {
      expect([bad, readEasing(bad)]).toEqual([bad, null]);
    }
  });

  it('reads every stepped spelling', () => {
    expect(readEasing('steps(4)')).toEqual({ kind: 'steps', count: 4, jump: 'end' });
    expect(readEasing('steps(4, end)')).toEqual({ kind: 'steps', count: 4, jump: 'end' });
    expect(readEasing('steps(3,start)')).toEqual({ kind: 'steps', count: 3, jump: 'start' });
    expect(readEasing('steps(6, jump-start)')).toEqual({ kind: 'steps', count: 6, jump: 'start' });
    expect(readEasing('steps(6, jump-end)')).toEqual({ kind: 'steps', count: 6, jump: 'end' });
    expect(readEasing('steps(5, jump-none)')).toEqual({ kind: 'steps', count: 5, jump: 'none' });
    expect(readEasing('steps(5, jump-both)')).toEqual({ kind: 'steps', count: 5, jump: 'both' });
  });

  it('refuses a stepped easing that could not run', () => {
    for (const bad of [
      'steps(0)',
      'steps(-2, end)',
      'steps(2.5)',
      'steps(1, jump-none)',
      'steps(4, sideways)',
      'steps()',
      'steps(4, end, end)',
    ]) {
      expect([bad, readEasing(bad)]).toEqual([bad, null]);
    }
  });

  it('refuses anything that is not an easing at all', () => {
    for (const bad of ['', '   ', 'wobble', 'cubic-bezier', 'steps', '200ms', 'ease-out-quart']) {
      expect([bad, readEasing(bad)]).toEqual([bad, null]);
    }
  });

  it('writes back what it read', () => {
    for (const written of [
      'ease',
      'linear',
      'ease-in-out',
      'steps(4, end)',
      'steps(3, start)',
      'steps(5, jump-both)',
      'steps(5, jump-none)',
      'cubic-bezier(0.34, 1.56, 0.64, 1)',
    ]) {
      const easing = readEasing(written);
      expect(easing).not.toBeNull();
      expect(easing === null ? '' : saidEasing(easing)).toBe(written);
      expect(easing === null ? null : readEasing(saidEasing(easing))).toEqual(easing);
    }
  });
});

/* ========================================================================== */
/* M-02 the curve, evaluated and drawn                                         */
/* ========================================================================== */

describe('M-02 following a curve', () => {
  const named = ['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out'] as const;

  it('starts at nothing and finishes finished', () => {
    for (const one of named) {
      const easing = readEasing(one);
      expect(easing).not.toBeNull();
      if (easing === null) continue;
      expect(progressAt(easing, 0)).toBeCloseTo(0, 12);
      expect(progressAt(easing, 1)).toBeCloseTo(1, 12);
    }
  });

  it('leaves a straight line straight', () => {
    const linear = readEasing('linear');
    if (linear === null) throw new Error('no linear');
    for (const x of [0, 0.1, 0.25, 0.4, 0.5, 0.75, 0.9, 1]) {
      expect(progressAt(linear, x)).toBeCloseTo(x, 9);
    }
  });

  it('is symmetrical where the curve is symmetrical', () => {
    const easing = readEasing('ease-in-out');
    if (easing === null) throw new Error('no ease-in-out');
    expect(progressAt(easing, 0.5)).toBeCloseTo(0.5, 9);
    expect(progressAt(easing, 0.25) + progressAt(easing, 0.75)).toBeCloseTo(1, 9);
  });

  it('lands on the known values, not on the control numbers', () => {
    const ease = readEasing('ease');
    const out = readEasing('ease-out');
    const into = readEasing('ease-in');
    if (ease === null || out === null || into === null) throw new Error('no easing');
    expect(progressAt(ease, 0.5)).toBeCloseTo(0.802403, 6);
    expect(progressAt(out, 0.5)).toBeCloseTo(0.684643, 6);
    expect(progressAt(into, 0.5)).toBeCloseTo(0.315357, 6);
    expect(progressAt(into, 0.25)).toBeCloseTo(0.093465, 6);
  });

  it('agrees with a slow, stupid solver everywhere', () => {
    const curves: readonly (readonly [number, number, number, number])[] = [
      [0.25, 0.1, 0.25, 1],
      [0.42, 0, 0.58, 1],
      [0.165, 0.84, 0.44, 1],
      [0.19, 1, 0.22, 1],
      [0.34, 1.56, 0.64, 1],
      [0.6, -0.28, 0.735, 0.045],
      [0, 0, 1, 1],
    ];
    for (const curve of curves) {
      const easing = readEasing(`cubic-bezier(${curve.join(',')})`);
      if (easing === null) throw new Error(`unreadable ${curve.join(',')}`);
      for (let step = 0; step <= 40; step += 1) {
        const x = step / 40;
        expect(progressAt(easing, x)).toBeCloseTo(bruteForce(curve, x), 6);
      }
    }
  });

  /* A curve that stalls in the middle: many moments map to almost the same
     instant, which is where a lazy solver drifts. */
  it('holds its nerve where the curve goes flat', () => {
    const easing = readEasing('cubic-bezier(1, 0, 0, 1)');
    if (easing === null) throw new Error('no curve');
    expect(progressAt(easing, 0.5)).toBeCloseTo(0.5, 12);
    expect(progressAt(easing, 0.5) + progressAt(easing, 0.5)).toBeCloseTo(1, 12);
  });

  it('goes past the end when it was asked to overshoot', () => {
    const easing = readEasing('cubic-bezier(0.34, 1.56, 0.64, 1)');
    if (easing === null) throw new Error('no curve');
    expect(progressAt(easing, 0.5)).toBeGreaterThan(1);
    expect(progressAt(easing, 1)).toBeCloseTo(1, 9);
  });

  it('holds still outside the time it was given', () => {
    const easing = readEasing('ease-in');
    if (easing === null) throw new Error('no curve');
    expect(progressAt(easing, -3)).toBe(0);
    expect(progressAt(easing, 4)).toBe(1);
  });

  it('climbs, for a curve that was written to climb', () => {
    const easing = readEasing('ease-in-out');
    if (easing === null) throw new Error('no curve');
    let last = -1;
    for (let step = 0; step <= 100; step += 1) {
      const now = progressAt(easing, step / 100);
      expect(now).toBeGreaterThanOrEqual(last);
      last = now;
    }
  });

  it('jumps, for the stepped ones', () => {
    const end = readEasing('steps(4, end)');
    const start = readEasing('steps(4, start)');
    const none = readEasing('steps(5, jump-none)');
    const both = readEasing('steps(4, jump-both)');
    if (end === null || start === null || none === null || both === null) throw new Error('none');

    expect(progressAt(end, 0)).toBe(0);
    expect(progressAt(end, 0.24)).toBe(0);
    expect(progressAt(end, 0.26)).toBe(0.25);
    expect(progressAt(end, 1)).toBe(1);

    expect(progressAt(start, 0)).toBe(0.25);
    expect(progressAt(start, 0.99)).toBe(1);
    expect(progressAt(start, 1)).toBe(1);

    expect(progressAt(none, 0)).toBe(0);
    expect(progressAt(none, 0.5)).toBeCloseTo(0.5, 9);
    expect(progressAt(none, 1)).toBe(1);

    expect(progressAt(both, 0)).toBeCloseTo(0.2, 9);
    expect(progressAt(both, 1)).toBe(1);
  });

  it('hands over points that can be drawn', () => {
    const easing = readEasing('ease-out');
    if (easing === null) throw new Error('no curve');
    const drawn = sample(easing, 12);
    expect(drawn).toHaveLength(12);
    expect(drawn[0]).toEqual({ x: 0, y: 0 });
    expect(drawn[11]?.x).toBe(1);
    expect(drawn[11]?.y).toBeCloseTo(1, 9);
    for (let at = 1; at < drawn.length; at += 1) {
      expect(drawn[at]?.x ?? 0).toBeGreaterThan(drawn[at - 1]?.x ?? 0);
    }
  });

  it('draws a stepped easing as its own staircase', () => {
    const easing = readEasing('steps(4, end)');
    if (easing === null) throw new Error('no curve');
    const drawn = sample(easing);
    expect(drawn).toHaveLength(9);
    expect(drawn[0]).toEqual({ x: 0, y: 0 });
    expect(drawn[1]).toEqual({ x: 0.25, y: 0 });
    expect(drawn[2]).toEqual({ x: 0.25, y: 0.25 });
    expect(drawn[8]).toEqual({ x: 1, y: 1 });
  });

  it('turns a curve into a line with progress running upwards', () => {
    const easing = readEasing('linear');
    if (easing === null) throw new Error('no curve');
    const drawn = curvePath(easing, 100, 100, 3);
    expect(drawn).toBe('M 0 100 L 50 50 L 100 0');
  });
});

/* ========================================================================== */
/* M-03 how long                                                               */
/* ========================================================================== */

describe('M-03 lengths of time', () => {
  it('reads both units', () => {
    expect(readTime('200ms')).toBe(200);
    expect(readTime('0.3s')).toBe(300);
    expect(readTime('.25s')).toBe(250);
    expect(readTime('2s')).toBe(2000);
    expect(readTime(' 1.5S ')).toBe(1500);
    expect(readTime('0')).toBe(0);
    expect(readTime('0s')).toBe(0);
    expect(readTime('-120ms')).toBe(-120);
  });

  it('refuses a number with nothing to say what it is', () => {
    for (const bad of ['200', '', 'fast', '200 ms', 'ms', '3x', '1.2.3s']) {
      expect([bad, readTime(bad)]).toEqual([bad, null]);
    }
  });

  it('says a length the way it would be written', () => {
    expect(sayTime(200)).toBe('200ms');
    expect(sayTime(0)).toBe('0ms');
    expect(sayTime(999)).toBe('999ms');
    expect(sayTime(1000)).toBe('1s');
    expect(sayTime(1200)).toBe('1.2s');
    expect(sayTime(2500)).toBe('2.5s');
  });

  it('goes there and back', () => {
    for (const ms of [0, 80, 200, 320, 1000, 1250]) {
      expect(readTime(sayTime(ms))).toBe(ms);
    }
  });

  it('offers a slider somewhere to stop, including where it already is', () => {
    const steps = timeSteps(215);
    expect(steps).toContain(215);
    expect(steps).toContain(200);
    expect([...steps].sort((a, b) => a - b)).toEqual([...steps]);
    expect(new Set(steps).size).toBe(steps.length);
    expect(timeSteps(200).filter((one) => one === 200)).toHaveLength(1);
  });
});

/* ========================================================================== */
/* M-04 picking by feel, or by numbers                                         */
/* ========================================================================== */

describe('M-04 a curve and a description, both ways', () => {
  it('comes back as the same feeling it was picked as', () => {
    for (const feel of FEELS) {
      expect([feel.id, feelOf(easingForFeel(feel.id))]).toEqual([feel.id, feel.id]);
    }
  });

  it('survives being written down and read back', () => {
    for (const feel of FEELS) {
      const again = readEasing(saidEasing(easingForFeel(feel.id)));
      expect(again).not.toBeNull();
      expect(again === null ? '' : feelOf(again)).toBe(feel.id);
    }
  });

  it('says the same sentence for the same feeling', () => {
    for (const feel of FEELS) {
      expect(sayEasing(easingForFeel(feel.id))).toBe(feel.says);
    }
  });

  it('reads a curve nobody named off its shape', () => {
    const shapes: readonly [string, string][] = [
      ['cubic-bezier(0.4, 0, 0.2, 1)', 'both-ends'],
      ['cubic-bezier(0.165, 0.84, 0.44, 1)', 'settles'],
      ['cubic-bezier(0.19, 1, 0.22, 1)', 'settles'],
      ['cubic-bezier(0.645, 0.045, 0.355, 1)', 'both-ends'],
      ['cubic-bezier(0.55, 0.085, 0.68, 0.53)', 'winds-up'],
      ['cubic-bezier(0.2, 1.4, 0.5, 1)', 'overshoots'],
      ['cubic-bezier(0.5, -0.4, 0.6, 0.2)', 'pulls-back'],
      ['cubic-bezier(0, 0, 1, 1)', 'even'],
      ['steps(7, start)', 'stepped'],
    ];
    for (const [written, feel] of shapes) {
      const easing = readEasing(written);
      expect(easing).not.toBeNull();
      expect([written, easing === null ? '' : feelOf(easing)]).toEqual([written, feel]);
    }
  });

  it('never describes anything with a number in it', () => {
    for (const feel of FEELS) {
      expect(feel.says).not.toMatch(/\d/);
      expect(feel.name).not.toMatch(/\d/);
      expect(feel.says).toMatch(/\.$/);
    }
  });

  it('keeps the numbers where a technical hand can reach them', () => {
    const easing = easingForFeel('overshoots');
    expect(easing.kind === 'curve' ? easing.points.length : 0).toBe(4);
    expect(saidEasing(easing)).toBe('cubic-bezier(0.34, 1.56, 0.64, 1)');
  });
});

/* ========================================================================== */
/* M-05 what a stylesheet actually says                                        */
/* ========================================================================== */

const SHEET = `
  /* .ghost { transition: opacity 999ms linear; } */
  .card {
    color: red;
    transition: opacity 200ms ease-out, transform 0.3s cubic-bezier(0.4, 0, 0.2, 1) 50ms;
  }
  .card:hover { transition: background-color 400ms; }
  @media (min-width: 600px) {
    .panel {
      transition-property: width, height;
      transition-duration: 120ms, 240ms;
      transition-timing-function: steps(4, end);
    }
  }
  @keyframes fade-in-up {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: none; }
  }
  .toast { animation: fade-in-up 300ms ease-out 80ms infinite; }
  @media (prefers-reduced-motion: reduce) {
    .card { transition: none; }
  }
`;

describe('M-05 reading movement out of a stylesheet', () => {
  const found = readMotion(SHEET);

  it('reads every part of a shorthand written with commas', () => {
    const fade = found.moves.find((move) => move.property === 'opacity');
    expect(fade).toMatchObject({ kind: 'fade', duration: 200, delay: 0 });
    expect(fade === undefined ? '' : saidEasing(fade.easing)).toBe('ease-out');

    const slide = found.moves.find((move) => move.property === 'transform');
    expect(slide).toMatchObject({ kind: 'movement', duration: 300, delay: 50 });
    expect(slide === undefined ? '' : saidEasing(slide.easing)).toBe('cubic-bezier(0.4, 0, 0.2, 1)');
  });

  it('fills in what a shorthand left out', () => {
    const colour = found.moves.find((move) => move.property === 'background-color');
    expect(colour).toMatchObject({ kind: 'colour', duration: 400, delay: 0 });
    expect(colour === undefined ? null : colour.easing).toEqual(PLAIN);
  });

  it('puts the long way of writing it back together, cycling the shorter lists', () => {
    const width = found.moves.find((move) => move.property === 'width');
    const height = found.moves.find((move) => move.property === 'height');
    expect(width).toMatchObject({ duration: 120, kind: 'size' });
    expect(height).toMatchObject({ duration: 240, kind: 'size' });
    expect(width === undefined ? '' : saidEasing(width.easing)).toBe('steps(4, end)');
    expect(height === undefined ? '' : saidEasing(height.easing)).toBe('steps(4, end)');
  });

  it('reads a named movement and how it is run', () => {
    const named = found.moves.find((move) => move.sequence === 'fade-in-up');
    expect(named).toMatchObject({
      kind: 'sequence',
      property: null,
      duration: 300,
      delay: 80,
      repeats: Infinity,
    });
  });

  it('reads the named movement itself, and what it changes', () => {
    expect(found.sequences).toHaveLength(1);
    expect(found.sequences[0]).toMatchObject({ name: 'fade-in-up', stops: 2, kind: 'everything' });
    expect([...(found.sequences[0]?.properties ?? [])].sort()).toEqual(['opacity', 'transform']);
  });

  it('says whether anybody who asked for less movement was answered', () => {
    expect(found.stillness).toBe(true);
    expect(readMotion('.a { transition: opacity 200ms ease; }').stillness).toBe(false);
  });

  it('keeps hold of where each one was written', () => {
    const colour = found.moves.find((move) => move.property === 'background-color');
    expect(colour?.places[0]?.selector).toBe('.card:hover');
    expect(colour?.places[0]?.line).toBe(7);
    const width = found.moves.find((move) => move.property === 'width');
    expect(width?.places.map((place) => place.property).sort()).toEqual([
      'transition-duration',
      'transition-property',
      'transition-timing-function',
    ]);
  });

  it('is not fooled by a comment', () => {
    expect(found.moves.some((move) => move.duration === 999)).toBe(false);
  });

  it('says nothing about a movement that does not happen', () => {
    expect(readMotion('.a { transition: none; }').moves).toEqual([]);
    expect(readMotion('.a { transition: opacity 0s ease; }').moves).toEqual([]);
    expect(readMotion('.a { transition-property: opacity; }').moves).toEqual([]);
    expect(readMotion('.a { animation: 300ms ease-out; }').moves).toEqual([]);
    expect(readMotion('').moves).toEqual([]);
    expect(readMotion('.a { color: red; }').moves).toEqual([]);
  });

  it('reads a stepped easing inside a shorthand without splitting on its comma', () => {
    const move = moveFor('.a { transition: transform 200ms steps(4, jump-both) 10ms; }', 'transform');
    expect(move).toMatchObject({ duration: 200, delay: 10 });
    expect(move === undefined ? '' : saidEasing(move.easing)).toBe('steps(4, jump-both)');
  });

  it('counts the same movement written in three places once', () => {
    const css = `
      .a { transition: opacity 200ms ease-out; }
      .b { transition: opacity 200ms ease-out; }
      .c:hover { transition: opacity 200ms ease-out; }
    `;
    const moves = readMotion(css).moves;
    expect(moves).toHaveLength(1);
    expect(moves[0]?.places).toHaveLength(3);
    expect(moves[0]?.places.map((place) => place.selector)).toEqual(['.a', '.b', '.c:hover']);
  });

  it('keeps two lengths of the same thing apart', () => {
    const moves = readMotion(`
      .a { transition: opacity 200ms ease-out; }
      .b { transition: opacity 600ms ease-out; }
    `).moves;
    expect(moves).toHaveLength(2);
    expect(moves.map((move) => move.duration)).toEqual([200, 600]);
  });

  it('lets a later declaration win inside the same rule', () => {
    const move = moveFor(
      '.a { transition: opacity 200ms ease-out; transition-duration: 400ms; }',
      'opacity',
    );
    expect(move?.duration).toBe(400);
  });

  it('lets a shorthand wipe out what came before it', () => {
    const moves = readMotion(
      '.a { transition-duration: 900ms; transition: opacity 200ms ease-out; }',
    ).moves;
    expect(moves).toHaveLength(1);
    expect(moves[0]?.duration).toBe(200);
  });

  it('reads a bare length as everything moving', () => {
    const moves = readMotion('.a { transition: 200ms; }').moves;
    expect(moves[0]).toMatchObject({ kind: 'everything', property: 'all', duration: 200 });
  });

  it('does not mistake the inside of a named movement for a rule', () => {
    const found2 = readMotion(`
      @keyframes spin {
        from { transform: rotate(0deg); animation-timing-function: linear; }
        50% { transform: rotate(180deg); }
        to { transform: rotate(360deg); }
      }
    `);
    expect(found2.moves).toEqual([]);
    expect(found2.sequences[0]).toMatchObject({ name: 'spin', stops: 3, kind: 'movement' });
  });

  it('reads a named movement written for one make of browser', () => {
    const found2 = readMotion('@-webkit-keyframes pulse { from { opacity: 0; } to { opacity: 1; } }');
    expect(found2.sequences[0]).toMatchObject({ name: 'pulse', stops: 2, kind: 'fade' });
  });

  it('reads the shorthand in any order it was written', () => {
    const move = moveFor('.a { animation: 2s linear 1s infinite alternate slide; }', 'slide');
    expect(move).toMatchObject({ duration: 2000, delay: 1000, repeats: Infinity });
  });

  it('sorts what it found onto shelves', () => {
    const shelves = groupMoves(found.moves);
    expect(shelves.map((shelf) => shelf.id)).toEqual(['movement', 'fade', 'colour', 'size', 'sequence']);
    expect(shelves.map((shelf) => shelf.title)).toEqual([
      'Movement',
      'Fades',
      'Colour',
      'Size and shape',
      'Named movements',
    ]);
    expect(groupMoves([])).toEqual([]);
  });

  it('knows what kind of thing each property is', () => {
    expect(kindOf('opacity')).toBe('fade');
    expect(kindOf('TRANSFORM')).toBe('movement');
    expect(kindOf('box-shadow')).toBe('colour');
    expect(kindOf('border-radius')).toBe('size');
    expect(kindOf('all')).toBe('everything');
    expect(kindOf('clip-path')).toBe('other');
  });

  it('names what moved without naming a mechanism', () => {
    const said = found.moves.map(sayWhat);
    expect(said).toContain('Fade');
    expect(said).toContain('Movement');
    expect(said).toContain('Background');
    expect(said).toContain('Fade in up');
    expect(sayWhat({ ...(found.moves[0] as Move), property: 'border-color', sequence: null })).toBe(
      'Border colour',
    );
  });

  it('borrows a demonstration for a named movement from what it changes', () => {
    const named = found.moves.find((move) => move.sequence === 'fade-in-up');
    if (named === undefined) throw new Error('no named movement');
    expect(previewKind(named, found.sequences)).toBe('everything');
    expect(previewKind(named, [])).toBe('everything');
    const fade = found.moves.find((move) => move.property === 'opacity');
    expect(fade === undefined ? '' : previewKind(fade, found.sequences)).toBe('fade');
  });

  it('says the same thing twice, and changes nothing it was handed', () => {
    const once = readMotion(SHEET);
    const twice = readMotion(SHEET);
    expect(once).toEqual(twice);
    expect(SHEET).toContain('transition: opacity 200ms ease-out');
  });
});

/* ========================================================================== */
/* M-06 what a designer would say about it                                     */
/* ========================================================================== */

function noteIds(css: string): readonly NoteId[] {
  return judgeMotion(readMotion(css)).map((note) => note.id);
}

describe('M-06 judging it', () => {
  it('calls out something over before it can be seen', () => {
    expect(noteIds('.a { transition: opacity 40ms ease-out; } @media (prefers-reduced-motion: reduce) { .a { transition: none; } }')).toContain(
      'blink',
    );
    expect(TOO_FAST).toBeLessThan(TOO_SLOW);
  });

  it('calls out something you have to wait for', () => {
    expect(noteIds('.a { transition: opacity 1200ms ease-out; } @media (prefers-reduced-motion: reduce) {}')).toContain(
      'waiting',
    );
  });

  it('holds a hover to a tighter standard than everything else', () => {
    const notes = noteIds('.a:hover { transition: background-color 400ms ease; }');
    expect(notes).toContain('slow-hover');
    expect(notes).not.toContain('waiting');
    expect(noteIds('.a:hover { transition: background-color 200ms ease; }')).not.toContain(
      'slow-hover',
    );
    expect(SLOW_HOVER).toBeLessThan(TOO_SLOW);
  });

  it('catches an easing pulling against the way something is going', () => {
    expect(noteIds('.panel.is-open { transition: transform 200ms ease-in; }')).toContain(
      'against-arriving',
    );
    expect(noteIds('.panel.is-hidden { transition: transform 200ms ease-out; }')).toContain(
      'against-leaving',
    );
    expect(noteIds('@keyframes fade-in { from { opacity: 0; } } .a { animation: fade-in 200ms ease-in; }')).toContain(
      'against-arriving',
    );
  });

  it('does not read a direction into a name that has none', () => {
    const notes = noteIds('.close-button { transition: transform 200ms ease-out; }');
    expect(notes).not.toContain('against-leaving');
    expect(noteIds('.card { transition: transform 200ms ease-in; }')).not.toContain(
      'against-arriving',
    );
  });

  it('calls out a bounce on something that only fades', () => {
    expect(
      noteIds('.a { transition: opacity 200ms cubic-bezier(0.34, 1.56, 0.64, 1); }'),
    ).toContain('bounce-on-a-fade');
    expect(
      noteIds('.a { transition: transform 200ms cubic-bezier(0.34, 1.56, 0.64, 1); }'),
    ).not.toContain('bounce-on-a-fade');
  });

  it('calls out moving everything at once', () => {
    expect(noteIds('.a { transition: all 200ms ease; }')).toContain('everything');
  });

  it('says something when nobody who asked for less movement was answered', () => {
    expect(noteIds('.a { transition: opacity 200ms ease-out; }')).toContain('no-stillness');
    expect(
      noteIds(
        '.a { transition: opacity 200ms ease-out; } @media (prefers-reduced-motion: reduce) { .a { transition: none; } }',
      ),
    ).not.toContain('no-stillness');
    expect(noteIds('.a { color: red; }')).toEqual([]);
  });

  it('keeps the numbers beside the sentence rather than inside it', () => {
    const notes = judgeMotion(readMotion('.a { transition: opacity 1200ms ease-out; }'));
    for (const note of notes) {
      expect(note.says).not.toMatch(/\d/);
      expect(note.says).toMatch(/\.$/);
    }
    const waiting = notes.find((note) => note.id === 'waiting');
    expect(waiting?.numbers).toEqual({ duration: 1200, delay: 0 });
    expect(waiting?.move?.property).toBe('opacity');
    expect(notes.find((note) => note.id === 'no-stillness')?.move).toBeNull();
  });

  it('does not say two contradictory things about one movement', () => {
    const notes = noteIds('.a { transition: opacity 40ms ease-out; }');
    expect(notes.filter((id) => id === 'blink' || id === 'waiting')).toHaveLength(1);
  });
});

/* ========================================================================== */
/* M-07 nudging it back into the file                                          */
/* ========================================================================== */

describe('M-07 writing a change back', () => {
  it('changes a length in a shorthand and nothing else', () => {
    const css = '.a { transition: opacity 200ms ease-out, transform 300ms ease-in; }';
    const move = moveFor(css, 'opacity');
    if (move === undefined) throw new Error('no move');
    const next = writeMotionAll(css, move.places, { duration: 320 });
    expect(next).toBe('.a { transition: opacity 320ms ease-out, transform 300ms ease-in; }');
  });

  it('changes the shape by name', () => {
    const css = '.a { transition: opacity 200ms ease-out; }';
    const move = moveFor(css, 'opacity');
    if (move === undefined) throw new Error('no move');
    const next = writeMotionAll(css, move.places, { easing: easingForFeel('both-ends') });
    expect(next).toBe('.a { transition: opacity 200ms ease-in-out; }');
  });

  it('writes a shape into a part that never had one', () => {
    const css = '.a { transition: opacity 200ms; }';
    const move = moveFor(css, 'opacity');
    if (move === undefined) throw new Error('no move');
    const next = writeMotionAll(css, move.places, { easing: easingForFeel('overshoots') });
    expect(next).toBe('.a { transition: opacity 200ms cubic-bezier(0.34, 1.56, 0.64, 1); }');
    expect(moveFor(next, 'opacity')?.easing).toEqual(easingForFeel('overshoots'));
  });

  it('changes the long way of writing it too', () => {
    const css = '.a { transition-property: width; transition-duration: 120ms; }';
    const move = moveFor(css, 'width');
    if (move === undefined) throw new Error('no move');
    expect(writeMotionAll(css, move.places, { duration: 240 })).toBe(
      '.a { transition-property: width; transition-duration: 240ms; }',
    );
  });

  it('changes every place the same movement was written, from the back forwards', () => {
    const css = '.a { transition: opacity 200ms ease; }\n.b { transition: opacity 200ms ease; }';
    const move = moveFor(css, 'opacity');
    if (move === undefined) throw new Error('no move');
    const next = writeMotionAll(css, move.places, { duration: 500 });
    expect(next).toBe('.a { transition: opacity 500ms ease; }\n.b { transition: opacity 500ms ease; }');
    expect(moveFor(next, 'opacity')?.duration).toBe(500);
  });

  it('leaves a place alone when it cannot hold the change', () => {
    const css = '.a { transition-property: width; transition-duration: 120ms; }';
    const move = moveFor(css, 'width');
    if (move === undefined) throw new Error('no move');
    expect(writeMotionAll(css, move.places, { easing: easingForFeel('even') })).toBe(css);
    const place = move.places.find((one) => one.property === 'transition-property');
    if (place === undefined) throw new Error('no place');
    expect(writeMotion(css, place, { duration: 400 })).toBe(css);
  });

  it('writes a delay only where a length already is', () => {
    const css = '.a { transition: opacity 200ms ease; }';
    const move = moveFor(css, 'opacity');
    if (move === undefined) throw new Error('no move');
    expect(writeMotionAll(css, move.places, { delay: 80 })).toBe(
      '.a { transition: opacity 200ms ease 80ms; }',
    );
    expect(moveFor(writeMotionAll(css, move.places, { delay: 80 }), 'opacity')?.delay).toBe(80);
  });

  it('changes nothing when there is nothing to change', () => {
    const css = '.a { transition: opacity 200ms ease; }';
    const move = moveFor(css, 'opacity');
    if (move === undefined) throw new Error('no move');
    expect(writeMotionAll(css, move.places, {})).toBe(css);
    expect(writeMotionAll(css, move.places, { duration: 200 })).toBe(css);
    expect(writeMotionAll(css, [], { duration: 900 })).toBe(css);
  });
});

/* ========================================================================== */
/* M-08 how any of it sounds                                                   */
/* ========================================================================== */

const JARGON = [
  'css',
  'stylesheet',
  'keyframe',
  'cubic-bezier',
  'bezier',
  'transition',
  'property',
  'selector',
  'dom',
  'api',
  'token',
  'commit',
  'git',
  'session',
  'branch',
  'class',
  'file',
  'variable',
  'function',
  'parameter',
  'render',
  'browser',
  'runtime',
  'component',
  'value',
];

function noJargon(said: string, where: string): void {
  for (const word of JARGON) {
    const found = new RegExp(`\\b${word}(s|es)?\\b`).exec(said.toLowerCase());
    expect(found === null ? '' : `${where} says “${found[0]}”`).toBe('');
  }
}

describe('M-08 the words on the screen', () => {
  it('never names a mechanism in a judgement', () => {
    const said = judgeMotion(
      readMotion(`
        .a { transition: opacity 40ms cubic-bezier(0.34, 1.56, 0.64, 1); }
        .b { transition: all 1200ms ease; }
        .c:hover { transition: color 400ms ease; }
        .d.is-open { transition: transform 200ms ease-in; }
        .e.is-hidden { transition: transform 200ms ease-out; }
      `),
    );
    expect(said.length).toBeGreaterThan(5);
    for (const note of said) noJargon(note.says, note.id);
  });

  it('never names a mechanism in a description of a shape', () => {
    for (const feel of FEELS) {
      noJargon(feel.says, feel.id);
      noJargon(feel.name, feel.id);
    }
  });

  it('never names a mechanism on a shelf', () => {
    for (const shelf of groupMoves(readMotion(SHEET).moves)) noJargon(shelf.title, shelf.id);
  });

  it('never names a mechanism on the screen that draws them', () => {
    const source = readFileSync(new URL('../src/components/Motion.tsx', import.meta.url), 'utf8');
    const copy = /export const SAYS = \{[\s\S]*?\n\} as const;/.exec(source)?.[0];
    expect(copy).toBeDefined();
    for (const said of (copy ?? '').matchAll(/'([^']*)'|`([^`]*)`/g)) {
      noJargon(said[1] ?? said[2] ?? '', 'SAYS');
    }
  });

  /* The band is a table of lengths and curves now. Nothing in it performs, so
     there is nothing to hold still for somebody who asked for less movement. */
  it('does not perform anything of its own', () => {
    const source = readFileSync(new URL('../src/components/Motion.css', import.meta.url), 'utf8');
    expect(source).not.toMatch(/^\s*animation:/m);
    expect(source).not.toContain('@keyframes');
  });
});
