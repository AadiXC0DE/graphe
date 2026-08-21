/** The camera pointed at work that is waiting to be let in.
 *
 * Everything about it that needs a browser is here, so `holdshot.ts` — the part
 * that decides what somebody is shown at the moment they say yes — stays
 * runnable without one. A folder that will not build comes back as no pictures
 * and the sentence saying why, never as a throw.
 *
 * It also counts, because this is the only place the full-size photograph
 * exists. `src/design/gate.ts` decides what a count means and `src/diff/pixels.ts`
 * does the arithmetic; both are pure and neither is reached from anywhere else.
 */

import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { nativeImage, type NativeImage } from 'electron';
import { BANDS, TOLERANCE, type Change } from '../design/gate';
import type { Look, Width } from '../design/widths';
import { makeAndServe, ShowError, showSays } from '../preview/show';
import { lookAtEveryWidth } from './capture';
import type { Looking, Photographer } from './holdshot';
import { countChange, type Counted } from './pixels';

/** How wide a picture is kept. Two of these per width cross to the window at
 *  once, and a full-size pair of every width is several megabytes of decision. */
const KEPT_WIDTH = 900;

/** A photograph rather than a pixel comparison, so it compresses like one. */
function smaller(shot: string): string {
  try {
    const image = nativeImage.createFromDataURL(shot);
    if (image.isEmpty()) return shot;
    const size = image.getSize();
    const fitted =
      size.width > KEPT_WIDTH ? image.resize({ width: KEPT_WIDTH, quality: 'good' }) : image;
    return `data:image/jpeg;base64,${fitted.toJPEG(74).toString('base64')}`;
  } catch {
    return shot;
  }
}

function lighter(look: Look): Look {
  return look.shot === null ? look : { ...look, shot: smaller(look.shot) };
}

/* -------------------------------------------------------------------------- */
/* The pictures that were agreed to                                            */
/* -------------------------------------------------------------------------- */

/** A picture waiting on an answer, told apart from one already agreed to by its
 *  name alone, so nothing has to be remembered across a quit. */
const WAITING = '.waiting.png';
const AGREED = '.png';

/** A width's id comes out of somebody's stylesheet, so it is not a file name
 *  until it is made into one. */
function fileFor(id: string): string {
  const clean = id.replace(/[^a-zA-Z0-9-]+/g, '-').slice(0, 32);
  return clean === '' ? 'width' : clean;
}

/** The picture this width was last agreed at, or null when there is none. */
async function agreedShot(folder: string, id: string): Promise<Buffer | null> {
  try {
    return await readFile(join(folder, `${fileFor(id)}${AGREED}`));
  } catch {
    return null;
  }
}

/**
 * Keep this width's fresh picture where an answer can promote it.
 *
 * Written now because now is the only moment the full-size photograph exists —
 * what crosses to the window has been squashed, and squashed is not something
 * the next change can be measured against. Straight from the picture's own
 * bytes rather than decoded and encoded again, because this is on the path
 * every turn takes.
 */
async function waitingShot(folder: string, id: string, shot: string): Promise<void> {
  const payload = shot.split('base64,')[1] ?? '';
  if (payload === '') return;
  try {
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, `${fileFor(id)}${WAITING}`), Buffer.from(payload, 'base64'));
  } catch {
    // The next change is measured against the older picture. Nothing is lost
    // but the re-basing, and a decision nobody can make is worse.
  }
}

/**
 * Make these widths the ones the next change is measured against.
 *
 * Only the ids handed in, and only where a picture was actually taken: a width
 * that came back blank has no waiting picture to promote, so "no picture" can
 * never become the thing to measure against.
 */
export async function keepShots(folder: string, ids: readonly string[]): Promise<void> {
  const wanted = new Set(ids.map(fileFor));
  let found: string[];
  try {
    found = await readdir(folder);
  } catch {
    return;
  }
  for (const name of found) {
    if (!name.endsWith(WAITING)) continue;
    const at = join(folder, name);
    const stem = name.slice(0, -WAITING.length);
    if (!wanted.has(stem)) {
      await rm(at, { force: true }).catch(() => undefined);
      continue;
    }
    await rename(at, join(folder, `${stem}${AGREED}`)).catch(() => undefined);
  }
}

/** Nothing was agreed, so nothing moves. */
export async function dropShots(folder: string): Promise<void> {
  let found: string[];
  try {
    found = await readdir(folder);
  } catch {
    return;
  }
  for (const name of found) {
    if (name.endsWith(WAITING)) await rm(join(folder, name), { force: true }).catch(() => undefined);
  }
}

/* -------------------------------------------------------------------------- */
/* Counting                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * How much of this width moved since the picture that was agreed to.
 *
 * Two photographs of one page are rarely the same height — anything added to a
 * page makes it taller — so the rows they share are counted properly and the
 * rows only one of them has are counted as changed, because they are. Refusing
 * to compare on a height difference would let every change that reflows a page
 * through unread, which is most of them.
 */
function countAgainst(was: NativeImage, now: NativeImage): Counted | null {
  const before = was.getSize();
  const after = now.getSize();
  if (before.width !== after.width || before.width <= 0) return null;

  const shared = Math.min(before.height, after.height);
  if (shared <= 0) return null;
  const box = { x: 0, y: 0, width: before.width, height: shared };
  const counted = countChange(
    (before.height === shared ? was : was.crop(box)).toBitmap(),
    (after.height === shared ? now : now.crop(box)).toBitmap(),
    { width: before.width, height: shared },
    TOLERANCE,
    BANDS,
  );
  if (counted === null) return null;

  const extra = (Math.max(before.height, after.height) - shared) * before.width;
  if (extra === 0) return counted;
  // Whatever the page grew or lost is at the bottom of it.
  const bands = [...counted.bands];
  const last = bands.length - 1;
  bands[last] = (bands[last] ?? 0) + extra;
  return { changed: counted.changed + extra, pixels: counted.pixels + extra, bands };
}

/** Every width, against what was agreed at it. One comparison each, whatever
 *  the answer turns out to be. */
async function changesSince(folder: string, looks: readonly Look[]): Promise<readonly Change[]> {
  const changes: Change[] = [];
  for (const look of looks) {
    const named = { id: look.id, name: look.name, width: look.width };
    if (look.shot === null) {
      changes.push({ kind: 'nopicture', ...named, why: look.trouble });
      continue;
    }
    await waitingShot(folder, look.id, look.shot);

    const before = await agreedShot(folder, look.id);
    if (before === null) {
      changes.push({ kind: 'first', ...named });
      continue;
    }
    const was = nativeImage.createFromBuffer(before);
    const now = nativeImage.createFromDataURL(look.shot);
    const counted = was.isEmpty() || now.isEmpty() ? null : countAgainst(was, now);
    // Nothing counted is not nothing changed. A comparison with no pixels in it
    // reads as a width nobody could check, which asks and never blocks.
    changes.push(
      counted === null
        ? { kind: 'compared', ...named, changed: 0, pixels: 0 }
        : {
            kind: 'compared',
            ...named,
            changed: counted.changed,
            pixels: counted.pixels,
            bands: counted.bands,
          },
    );
  }
  return changes;
}

/* -------------------------------------------------------------------------- */
/* The camera                                                                  */
/* -------------------------------------------------------------------------- */

async function photograph(
  folder: string,
  sizes: readonly Width[] | undefined,
  against: string | null,
): Promise<Looking> {
  // Asked to compare and unable to is a reading of its own, and an empty one
  // says so. No comparison asked for says nothing at all, which is different.
  const nothing = (trouble: string): Looking =>
    against === null ? { looks: [], trouble } : { looks: [], trouble, changes: [] };

  let ready;
  try {
    ready = await makeAndServe({ folder, says: () => undefined });
  } catch (cause) {
    return nothing(cause instanceof ShowError ? cause.message : showSays.didNotFinish);
  }
  if (ready.kind !== 'showing') return nothing(ready.question);

  try {
    const looks = await lookAtEveryWidth(ready.serving.address, sizes);
    // Before `lighter`: it squashes to 900px and re-encodes, and the ringing
    // that leaves around hard edges is regularly wider than the tolerance, so
    // comparing squashed pictures stops work that never moved.
    const changes = against === null ? undefined : await changesSince(against, looks);
    return changes === undefined
      ? { looks: looks.map(lighter) }
      : { looks: looks.map(lighter), changes };
  } catch {
    return nothing(showSays.didNotFinish);
  } finally {
    await ready.serving.stop().catch(() => undefined);
  }
}

/** `sizes` are the ones the project designs at, where the shell has read them
 *  out of its stylesheets; the three defaults otherwise. `against` is where this
 *  project's agreed pictures are kept — left out, nothing is compared. */
export function holdCamera(sizes?: readonly Width[], against?: string): Photographer {
  return {
    look: (folder, compare) =>
      photograph(folder, sizes, compare === true && against !== undefined ? against : null),
  };
}
