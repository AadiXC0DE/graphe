/** Where on the page something moved.
 *
 * BACKLOG F2, and the half of it that carries the actual value. A before and an
 * after side by side is already better than a wall of code, but a designer
 * looking at two nearly-identical pictures of their own site still has to hunt
 * for the difference — and hunting is the failure this feature exists to end.
 * So we work out which parts of the picture are not the same and outline them,
 * softly, so the eye lands on what moved without being shouted at.
 *
 * ## Blocks, not pixels
 *
 * Comparing pixel by pixel and drawing a box around every one that differs
 * produces a fog of speckles: text renders a fraction differently between two
 * runs, a gradient dithers, an image resamples. None of that is a change
 * anybody made. So the picture is divided into square blocks, a block counts as
 * changed only when enough of it is different by enough, and touching blocks
 * are joined into one rectangle. What comes out is a handful of areas rather
 * than a thousand dots.
 *
 * Everything here is arithmetic over a byte array. No dependency, no canvas, no
 * image library — the bytes arrive from Electron's own decoder and leave as
 * fractions of the picture's width and height, so whatever draws them can be
 * any size it likes.
 *
 * ## What it costs
 *
 * Measured: 31–53ms for two full-page retina captures, 2360×1772, every pixel
 * looked at. That is the one genuinely blocking stretch in the whole feature,
 * and it is worth knowing the number rather than guessing at it. It runs in the
 * desktop shell once per turn, *after* everything has settled — the reply has
 * finished, the versions have been refreshed, nobody is waiting — so a person
 * typing through it measures a 17ms round trip, unchanged. Sampling every other
 * pixel would roughly halve it and start missing single-pixel seams; at forty
 * milliseconds off the critical path there is nothing to buy.
 */

/** Raw pixels, four bytes each. Channel order does not matter: every comparison
 *  below is a difference between the same channel of two pictures taken the
 *  same way, so BGRA and RGBA give identical answers. */
export type Bitmap = {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray | ArrayLike<number>;
};

/**
 * A rectangle of the picture, as fractions of its width and height.
 *
 * Fractions rather than pixels because the thing that draws these has no idea
 * how big it will be on screen — the same area has to sit correctly over a
 * 200px strip and over a full-width stage.
 */
export type ChangedArea = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type Comparison = {
  areas: readonly ChangedArea[];
  /** How much of the picture changed, 0–1. Whole-page rewrites and one nudged
   *  button want different sentences said about them. */
  fraction: number;
};

export type CompareOptions = {
  /** Side of one block, in pixels. Smaller finds more, and finds more noise. */
  block?: number;
  /** How different one pixel has to be, per channel, 0–255. Below this it is
   *  the same pixel rendered twice. */
  perPixel?: number;
  /** What share of a block's pixels have to differ before the block counts. */
  perBlock?: number;
  /** Areas smaller than this share of the picture are dropped. A one-block
   *  speck outlined in the middle of a page is worse than nothing: it sends
   *  somebody looking for a change that is not there. */
  smallest?: number;
  /** An area has to be at least this many blocks on both sides.
   *
   *  This is the rule that removes the hairline. A page that grew twenty pixels
   *  taller leaves a full-width sliver one block deep along the bottom edge,
   *  and outlining it draws a long red underline across somebody's site for
   *  something they cannot see and did not ask about. The same goes for the
   *  one-pixel seam left when a border shifts. Both are real differences and
   *  neither is worth pointing at. */
  leastSide?: number;
  /** At most this many outlines. Past a handful they stop being a guide and
   *  become a mesh. */
  most?: number;
};

const DEFAULTS = {
  block: 16,
  perPixel: 26,
  perBlock: 0.06,
  smallest: 0.0004,
  leastSide: 2,
  most: 6,
} as const;

const NOTHING: Comparison = { areas: [], fraction: 0 };

function bytesPerPixel(picture: Bitmap): number {
  const pixels = picture.width * picture.height;
  if (pixels <= 0) return 0;
  return Math.floor(picture.data.length / pixels);
}

/**
 * The size a bitmap's bytes actually describe.
 *
 * Electron reports a picture's size in the units the screen uses, and hands
 * over the bytes at whatever density the display has — so a "1200×800" capture
 * on a retina machine arrives as 2400×1600 worth of bytes. Reading the width
 * off the label and the pixels off the buffer would then walk diagonally
 * through the image and report the whole page as changed. Believing the buffer
 * is the only thing that survives moving the app to another monitor.
 */
export function realSize(picture: Bitmap): { width: number; height: number } {
  const claimed = picture.width * picture.height * 4;
  if (claimed <= 0) return { width: 0, height: 0 };
  const scale = Math.sqrt(picture.data.length / claimed);
  const rounded = Math.max(1, Math.round(scale));
  // Only trust a clean whole-number density. Anything else and we are guessing
  // at somebody's display, which is how a picture ends up sheared.
  const exact = Math.abs(scale - rounded) < 0.01;
  const factor = exact ? rounded : 1;
  return { width: picture.width * factor, height: picture.height * factor };
}

/* --------------------------------------------------------- joining up blocks */

type Grid = {
  across: number;
  down: number;
  changed: Uint8Array;
};

/** Blocks that touch are one area. Four-connected on purpose: a diagonal touch
 *  is two things near each other, not one thing. */
function joinUp(grid: Grid): { left: number; top: number; right: number; bottom: number }[] {
  const { across, down, changed } = grid;
  const seen = new Uint8Array(changed.length);
  const found: { left: number; top: number; right: number; bottom: number }[] = [];
  const queue: number[] = [];

  for (let start = 0; start < changed.length; start += 1) {
    if (changed[start] !== 1 || seen[start] === 1) continue;

    seen[start] = 1;
    queue.length = 0;
    queue.push(start);

    let left = across;
    let right = -1;
    let top = down;
    let bottom = -1;

    while (queue.length > 0) {
      const at = queue.pop() as number;
      const column = at % across;
      const row = (at - column) / across;

      if (column < left) left = column;
      if (column > right) right = column;
      if (row < top) top = row;
      if (row > bottom) bottom = row;

      const neighbours = [
        column > 0 ? at - 1 : -1,
        column < across - 1 ? at + 1 : -1,
        row > 0 ? at - across : -1,
        row < down - 1 ? at + across : -1,
      ];
      for (const next of neighbours) {
        if (next < 0 || seen[next] === 1 || changed[next] !== 1) continue;
        seen[next] = 1;
        queue.push(next);
      }
    }

    found.push({ left, top, right: right + 1, bottom: bottom + 1 });
  }

  return found;
}

/* --------------------------------------------------------------- the compare */

/**
 * Which parts of the second picture are not the same as the first.
 *
 * Two pictures of different sizes are not a failure — a page that grew taller
 * is one of the commonest changes there is. The overlap is compared properly
 * and whatever hangs off the end is reported as changed, because it is: it was
 * not there before.
 */
export function comparePictures(
  before: Bitmap,
  after: Bitmap,
  options: CompareOptions = {},
): Comparison {
  const settings = { ...DEFAULTS, ...options };
  const block = Math.max(2, Math.floor(settings.block));

  const beforeSize = realSize(before);
  const afterSize = realSize(after);
  if (afterSize.width <= 0 || afterSize.height <= 0) return NOTHING;
  if (bytesPerPixel(before) < 3 || bytesPerPixel(after) < 3) return NOTHING;

  const across = Math.ceil(afterSize.width / block);
  const down = Math.ceil(afterSize.height / block);
  const changed = new Uint8Array(across * down);

  const sharedWidth = Math.min(beforeSize.width, afterSize.width);
  const sharedHeight = Math.min(beforeSize.height, afterSize.height);

  for (let row = 0; row < down; row += 1) {
    const fromY = row * block;
    const toY = Math.min(fromY + block, afterSize.height);

    for (let column = 0; column < across; column += 1) {
      const fromX = column * block;
      const toX = Math.min(fromX + block, afterSize.width);

      // Off the end of the older picture entirely: new ground, and new ground
      // is always a change.
      if (fromX >= sharedWidth || fromY >= sharedHeight) {
        changed[row * across + column] = 1;
        continue;
      }

      let looked = 0;
      let different = 0;

      for (let y = fromY; y < toY; y += 1) {
        if (y >= sharedHeight) break;
        const beforeRow = y * beforeSize.width * 4;
        const afterRow = y * afterSize.width * 4;
        for (let x = fromX; x < toX; x += 1) {
          if (x >= sharedWidth) break;
          const a = beforeRow + x * 4;
          const b = afterRow + x * 4;
          looked += 1;
          const one = Math.abs((before.data[a] ?? 0) - (after.data[b] ?? 0));
          const two = Math.abs((before.data[a + 1] ?? 0) - (after.data[b + 1] ?? 0));
          const three = Math.abs((before.data[a + 2] ?? 0) - (after.data[b + 2] ?? 0));
          const most = one > two ? (one > three ? one : three) : two > three ? two : three;
          if (most >= settings.perPixel) different += 1;
        }
      }

      if (looked > 0 && different / looked >= settings.perBlock) {
        changed[row * across + column] = 1;
      }
    }
  }

  let changedBlocks = 0;
  for (const one of changed) changedBlocks += one;
  if (changedBlocks === 0) return NOTHING;

  const boxes = joinUp({ across, down, changed });
  const smallest = settings.smallest * across * down;

  const side = Math.max(1, Math.floor(settings.leastSide));
  const areas = boxes
    .filter((box) => box.right - box.left >= side && box.bottom - box.top >= side)
    .map((box) => ({
      blocks: (box.right - box.left) * (box.bottom - box.top),
      area: {
        x: (box.left * block) / afterSize.width,
        y: (box.top * block) / afterSize.height,
        width: Math.min(1, (box.right * block) / afterSize.width) - (box.left * block) / afterSize.width,
        height:
          Math.min(1, (box.bottom * block) / afterSize.height) - (box.top * block) / afterSize.height,
      },
    }))
    .filter((one) => one.blocks >= smallest)
    .sort((one, other) => other.blocks - one.blocks)
    .slice(0, Math.max(1, settings.most))
    .map((one) => one.area);

  return { areas, fraction: changedBlocks / changed.length };
}
