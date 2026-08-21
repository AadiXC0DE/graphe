/** Counting how much of a picture moved.
 *
 * This is the arithmetic that decides whether somebody's work is stopped, so
 * the failures worth guarding are the ones that would make a gate untrustworthy
 * in either direction: a count that misses a change waves work through, and a
 * count that invents one stops work for nothing — and a gate that stops work
 * for nothing is a gate that gets switched off.
 *
 * The strips exist for one case the whole-picture share cannot see: a component
 * that vanished from a long page is a few per cent of the total and most of one
 * strip. That case is tested directly.
 */

import { describe, expect, it } from 'vitest';

import { countChange } from '../src/diff/pixels';

/** A picture of one flat colour, four bytes a pixel. */
function flat(width: number, height: number, value: number): Uint8Array {
  return new Uint8Array(width * height * 4).fill(value);
}

const SIZE = { width: 4, height: 8 };

describe('reading one picture against another', () => {
  it('finds nothing when nothing moved', () => {
    const said = countChange(flat(4, 8, 10), flat(4, 8, 10), SIZE, 0.06, 8);
    expect(said?.changed).toBe(0);
    expect(said?.pixels).toBe(32);
    expect(said?.bands.every((one) => one === 0)).toBe(true);
  });

  it('counts every pixel when the whole picture moved', () => {
    const said = countChange(flat(4, 8, 0), flat(4, 8, 255), SIZE, 0.06, 8);
    expect(said?.changed).toBe(32);
    expect(said?.pixels).toBe(32);
  });

  /** Below the tolerance a difference is anti-aliasing and compression
   *  ringing, not the page. Counting it would stop work on every turn. */
  it('ignores a difference too small to be the page', () => {
    // 0.06 of full range is about 15, so a shift of 10 is under the line.
    const said = countChange(flat(4, 8, 100), flat(4, 8, 110), SIZE, 0.06, 8);
    expect(said?.changed).toBe(0);
  });

  it('counts a difference just over the line', () => {
    const said = countChange(flat(4, 8, 100), flat(4, 8, 130), SIZE, 0.06, 8);
    expect(said?.changed).toBe(32);
  });

  /** Something becoming transparent is a real change to what somebody sees. */
  it('reads the fourth channel like any other', () => {
    const before = flat(4, 8, 200);
    const after = flat(4, 8, 200);
    for (let at = 3; at < after.length; at += 4) after[at] = 0;
    expect(countChange(before, after, SIZE, 0.06, 8)?.changed).toBe(32);
  });
});

describe('the strips, which are the point', () => {
  /** One block of a long page changing is a small share of the whole and a
   *  large share of one strip. Only the strips can see it, and it is exactly
   *  the case somebody needs stopping for. */
  it('puts a change where it happened rather than spreading it', () => {
    const before = flat(4, 8, 0);
    const after = flat(4, 8, 0);
    // The last two rows only — a quarter of this picture, all in the last strip.
    for (let at = 4 * 6 * 4; at < after.length; at += 1) after[at] = 255;

    const said = countChange(before, after, SIZE, 0.06, 4);
    expect(said?.changed).toBe(8);
    // Four strips over eight rows: the change is entirely in the last.
    expect(said?.bands).toEqual([0, 0, 0, 8]);
  });

  it('adds up to the same number the whole picture gave', () => {
    const before = flat(4, 8, 0);
    const after = flat(4, 8, 0);
    for (let at = 0; at < 4 * 3 * 4; at += 1) after[at] = 255;
    const said = countChange(before, after, SIZE, 0.06, 8);
    expect(said?.bands.reduce((sum, one) => sum + one, 0)).toBe(said?.changed);
  });

  /** A height that does not divide evenly used to put the last row one strip
   *  past the end, where it was counted into nothing and quietly lost. */
  it('keeps the last row when the strips do not divide evenly', () => {
    const before = flat(2, 5, 0);
    const after = flat(2, 5, 255);
    const said = countChange(before, after, { width: 2, height: 5 }, 0.06, 3);
    expect(said?.changed).toBe(10);
    expect(said?.bands.length).toBe(3);
    expect(said?.bands.reduce((sum, one) => sum + one, 0)).toBe(10);
  });
});

describe('what it refuses to guess about', () => {
  /** A resize is not a difference anybody wants measured pixel by pixel.
   *  Comparing anyway would report a total rewrite whenever a scrollbar
   *  appeared, and the gate would fire on nothing. */
  it('will not compare two pictures of different sizes', () => {
    expect(countChange(flat(4, 8, 0), flat(4, 9, 0), SIZE, 0.06, 8)).toBeNull();
    expect(countChange(flat(4, 8, 0), flat(4, 8, 0), { width: 4, height: 9 }, 0.06, 8)).toBeNull();
  });

  it('says nothing rather than dividing by nothing', () => {
    expect(countChange(new Uint8Array(0), new Uint8Array(0), { width: 0, height: 0 }, 0.06, 8)).toBeNull();
    expect(countChange(flat(4, 8, 0), flat(4, 8, 0), SIZE, 0.06, 0)).toBeNull();
  });
});
