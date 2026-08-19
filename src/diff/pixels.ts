/** Counting how much of a picture moved.
 *
 * The gate decides what a count *means*; this only counts. Kept apart from the
 * camera because the camera needs a browser and this needs nothing — so the
 * arithmetic that decides whether somebody's work is stopped can be tested
 * exhaustively, without a folder, a server or a screen.
 *
 * Two readings come out of one pass. The share of the whole picture that moved
 * answers "did this page change"; the strips answer "did one part of it change
 * a lot" — a component that vanished from a long page is a few per cent of the
 * whole and most of one strip, and only the second reading catches it.
 */

/** Four bytes a pixel, whatever order they arrive in: the comparison is against
 *  the same channel in both pictures, so the order never matters. */
const CHANNELS = 4;

export type Counted = {
  /** Pixels differing by more than the tolerance. */
  changed: number;
  /** Pixels compared. */
  pixels: number;
  /** Changed pixels per strip, top to bottom. */
  bands: readonly number[];
};

/**
 * How much of one picture differs from another.
 *
 * `tolerance` is a share of full channel range: below it, a difference is
 * anti-aliasing and compression ringing rather than the page. Alpha is read
 * like any other channel, so something becoming transparent counts.
 *
 * Two pictures of different sizes are not compared at all — a resize is not a
 * difference anybody wants measured pixel by pixel, and pretending otherwise
 * would report a total rewrite every time a scrollbar appeared. Null says so.
 */
export function countChange(
  before: Uint8Array | Uint8ClampedArray,
  after: Uint8Array | Uint8ClampedArray,
  size: { width: number; height: number },
  tolerance: number,
  bands: number,
): Counted | null {
  const wanted = size.width * size.height * CHANNELS;
  if (size.width <= 0 || size.height <= 0) return null;
  if (before.length !== wanted || after.length !== wanted) return null;
  if (bands <= 0) return null;

  const limit = Math.round(Math.max(0, Math.min(1, tolerance)) * 255);
  const perBand = new Array<number>(bands).fill(0);
  let changed = 0;

  for (let row = 0; row < size.height; row += 1) {
    // Which strip this row falls in. Clamped because the last row of a picture
    // whose height does not divide evenly would otherwise land one past the end.
    const band = Math.min(bands - 1, Math.floor((row * bands) / size.height));
    const start = row * size.width * CHANNELS;
    for (let at = start; at < start + size.width * CHANNELS; at += CHANNELS) {
      const moved =
        Math.abs((before[at] ?? 0) - (after[at] ?? 0)) > limit ||
        Math.abs((before[at + 1] ?? 0) - (after[at + 1] ?? 0)) > limit ||
        Math.abs((before[at + 2] ?? 0) - (after[at + 2] ?? 0)) > limit ||
        Math.abs((before[at + 3] ?? 0) - (after[at + 3] ?? 0)) > limit;
      if (!moved) continue;
      changed += 1;
      perBand[band] = (perBand[band] ?? 0) + 1;
    }
  }

  return { changed, pixels: size.width * size.height, bands: perBand };
}
