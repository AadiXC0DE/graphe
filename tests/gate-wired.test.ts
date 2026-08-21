/** The gate that did not gate.
 *
 * `src/design/gate.ts` and `src/diff/pixels.ts` were both built, both tested
 * exhaustively, and both had no callers at all: nothing counted a picture,
 * nothing stored what had been agreed to, and nothing handed a verdict to the
 * panel that draws one. Every test of either file passed throughout. A pure
 * function with nobody calling it is a passing test suite and a feature that
 * does not exist.
 *
 * So nothing here tests the arithmetic or the wording — those are covered where
 * they live. Everything here fails when the *join* comes apart: the camera not
 * counting, counting the squashed picture instead of the real one, a blank
 * width becoming the thing the next change is measured against, a project that
 * will not build reading as a project that did not change, the verdict not
 * reaching the panel, or the default meaning one thing in one place and
 * something else in another.
 */

import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { gateOf, nextAccepted, type Change } from '../src/design/gate';
import { holdsBack } from '../src/projects/heldback';
import type { Width } from '../src/design/widths';
import { photographHeld, type Looking } from '../src/diff/holdshot';


/* -------------------------------------------------------------------------- */
/* A picture nobody has to render                                              */
/* -------------------------------------------------------------------------- */

/**
 * A stand-in for a photograph: its size, and four bytes a pixel.
 *
 * Carried as JSON inside a data URL so the fake decoder is three lines and the
 * fixtures are readable. What matters is that squashing it is *lossy in a way
 * the test can see* — a resized one has no pixels in it — because that is the
 * whole point of comparing before the picture is made small.
 */
type Picture = { w: number; h: number; bytes: number[] };

function asShot(picture: Picture): string {
  return `data:image/png;base64,${Buffer.from(JSON.stringify(picture)).toString('base64')}`;
}

/** A flat picture, one shade throughout. */
function flat(w: number, h: number, shade: number): Picture {
  return { w, h, bytes: Array.from({ length: w * h * 4 }, () => shade) };
}

/** The same picture with one row of it repainted, which is a band. */
function withRow(picture: Picture, row: number, shade: number): Picture {
  const bytes = [...picture.bytes];
  for (let at = row * picture.w * 4; at < (row + 1) * picture.w * 4; at += 1) bytes[at] = shade;
  return { ...picture, bytes };
}

/** The same picture with a handful of pixels repainted, which is a tweak. */
function withPixels(picture: Picture, howMany: number, shade: number): Picture {
  const bytes = [...picture.bytes];
  for (let at = 0; at < howMany * 4; at += 1) bytes[at] = shade;
  return { ...picture, bytes };
}

vi.mock('electron', () => {
  const read = (text: string): Picture | null => {
    try {
      const found: unknown = JSON.parse(text);
      return typeof found === 'object' && found !== null ? (found as Picture) : null;
    } catch {
      return null;
    }
  };

  const make = (picture: Picture | null): unknown => ({
    isEmpty: () => picture === null,
    getSize: () => ({ width: picture?.w ?? 0, height: picture?.h ?? 0 }),
    toBitmap: () => Uint8Array.from(picture?.bytes ?? []),
    toPNG: () => Buffer.from(JSON.stringify(picture)),
    crop: (box: { y: number; width: number; height: number }) =>
      make(
        picture === null
          ? null
          : {
              w: box.width,
              h: box.height,
              bytes: picture.bytes.slice(
                box.y * picture.w * 4,
                (box.y + box.height) * picture.w * 4,
              ),
            },
      ),
    // Squashing throws the pixels away, exactly as a real resize-and-re-encode
    // throws away the ability to compare against a full-size picture.
    resize: ({ width }: { width: number }) =>
      make(
        picture === null
          ? null
          : { w: width, h: Math.max(1, Math.round((picture.h * width) / picture.w)), bytes: [] },
      ),
    toJPEG: () => Buffer.from(JSON.stringify(picture === null ? null : { ...picture, bytes: [] })),
  });

  return {
    nativeImage: {
      createFromDataURL: (url: string) => make(read(Buffer.from(url.split('base64,')[1] ?? '', 'base64').toString())),
      createFromBuffer: (buffer: Buffer) => make(read(buffer.toString())),
      createFromPath: () => make(null),
    },
  };
});

/* -------------------------------------------------------------------------- */
/* A folder nobody has to build                                                */
/* -------------------------------------------------------------------------- */

const bench = vi.hoisted(() => ({
  /** What the camera sees, per width id. Undefined is a width that would not
   *  photograph. */
  sees: new Map<string, string | null>(),
  /** Set to refuse to serve the folder at all. */
  refuses: null as string | null,
}));

vi.mock('../src/preview/show', () => {
  class ShowError extends Error {}
  return {
    ShowError,
    showSays: { didNotFinish: 'It did not finish.' },
    makeAndServe: () =>
      Promise.resolve(
        bench.refuses === null
          ? {
              kind: 'showing',
              serving: { address: 'http://here', stop: () => Promise.resolve() },
            }
          : { kind: 'asking', question: bench.refuses },
      ),
  };
});

vi.mock('../src/diff/capture', () => ({
  lookAtEveryWidth: (_address: string, sizes: readonly Width[]) =>
    Promise.resolve(
      sizes.map((size) => ({
        id: size.id,
        name: size.name,
        width: size.width,
        shot: bench.sees.get(size.id) ?? null,
        trouble: null,
      })),
    ),
}));

/* Imported after the mocks, because it reaches for all three of them. */
const { dropShots, holdCamera, keepShots } = await import('../src/diff/holdcamera');

const SIZES: readonly Width[] = [
  { id: 'phone', name: 'Phone', width: 390, height: 844 },
  { id: 'desktop', name: 'Desktop', width: 1440, height: 900 },
];

/** Wide enough that keeping it for the window squashes it, which is the case
 *  that used to be compared by mistake. */
const PAGE = flat(1000, 8, 100);

let agreed = '';

beforeEach(async () => {
  agreed = await mkdtemp(join(tmpdir(), 'graphe-agreed-'));
  bench.sees.clear();
  bench.refuses = null;
});

afterEach(async () => {
  await rm(agreed, { recursive: true, force: true });
});

/** One run of the camera over a copy, comparing against what was agreed. */
async function lookAtCopy(): Promise<Looking> {
  return holdCamera(SIZES, agreed).look('/copy', true);
}

function found(changes: readonly Change[], id: string): Change {
  const one = changes.find((change) => change.id === id);
  if (one === undefined) throw new Error(`no reading for ${id}`);
  return one;
}

/* -------------------------------------------------------------------------- */
/* Counting the change                                                         */
/* -------------------------------------------------------------------------- */

describe('the camera counts what it photographed', () => {
  it('compares the picture it took, not the one it kept for the window', async () => {
    bench.sees.set('phone', asShot(PAGE));
    bench.sees.set('desktop', asShot(PAGE));
    // Both widths have been agreed at exactly this picture.
    await writeFile(join(agreed, 'phone.png'), JSON.stringify(PAGE));
    await writeFile(join(agreed, 'desktop.png'), JSON.stringify(PAGE));

    const looking = await lookAtCopy();

    // The picture that crosses to the window really was squashed, so a pass
    // here is not a pass because nothing was squashed at all.
    expect(looking.looks[0]?.shot).toContain('image/jpeg');

    const phone = found(looking.changes ?? [], 'phone');
    expect(phone.kind).toBe('compared');
    // Every pixel of the full-size picture was compared. Comparing what the
    // window gets instead leaves nothing to count, because it has been
    // resized and re-encoded — which is how a page nobody touched stops work.
    expect(phone.kind === 'compared' ? phone.pixels : 0).toBe(1000 * 8);
    expect(phone.kind === 'compared' ? phone.changed : -1).toBe(0);

    expect(gateOf(looking.changes ?? []).standing).toBe('clear');
  });

  it('has nothing to compare the first time it sees a width', async () => {
    bench.sees.set('phone', asShot(PAGE));
    bench.sees.set('desktop', asShot(PAGE));

    const looking = await lookAtCopy();
    expect(found(looking.changes ?? [], 'phone').kind).toBe('first');
    expect(gateOf(looking.changes ?? []).standing).toBe('first');
  });

  it('stops the work when a band of the page has moved', async () => {
    bench.sees.set('phone', asShot(withRow(PAGE, 3, 250)));
    bench.sees.set('desktop', asShot(PAGE));
    await writeFile(join(agreed, 'phone.png'), JSON.stringify(PAGE));
    await writeFile(join(agreed, 'desktop.png'), JSON.stringify(PAGE));

    const verdict = gateOf((await lookAtCopy()).changes ?? []);
    expect(verdict.standing).toBe('stopped');
    expect(verdict.stops).toBe(true);
    expect(verdict.open).toBe('phone');
  });

  it('lets a tweak through without asking', async () => {
    bench.sees.set('phone', asShot(withPixels(PAGE, 40, 250)));
    bench.sees.set('desktop', asShot(PAGE));
    await writeFile(join(agreed, 'phone.png'), JSON.stringify(PAGE));
    await writeFile(join(agreed, 'desktop.png'), JSON.stringify(PAGE));

    // Forty pixels of eight thousand, all in one band of eight. Under both
    // lines, so nobody is asked — which is what earns the gate being on.
    expect(gateOf((await lookAtCopy()).changes ?? []).standing).toBe('clear');
  });

  it('never reads a width it could not photograph as one that stayed the same', async () => {
    bench.sees.set('phone', null);
    bench.sees.set('desktop', asShot(PAGE));
    await writeFile(join(agreed, 'desktop.png'), JSON.stringify(PAGE));

    const looking = await lookAtCopy();
    expect(found(looking.changes ?? [], 'phone').kind).toBe('nopicture');
    // Asked about, and never quietly counted as a pass.
    expect(gateOf(looking.changes ?? []).standing).toBe('unchecked');
  });

  it('counts what a page grew as change rather than refusing to look', async () => {
    // A page that got taller is the ordinary shape of a real change. Refusing
    // to compare two different heights would let every one of them through.
    bench.sees.set('phone', asShot(flat(1000, 16, 100)));
    bench.sees.set('desktop', asShot(PAGE));
    await writeFile(join(agreed, 'phone.png'), JSON.stringify(PAGE));
    await writeFile(join(agreed, 'desktop.png'), JSON.stringify(PAGE));

    const verdict = gateOf((await lookAtCopy()).changes ?? []);
    expect(verdict.standing).toBe('stopped');
    expect(verdict.readings[0]?.id).toBe('phone');
  });
});

/* -------------------------------------------------------------------------- */
/* The mark                                                                    */
/* -------------------------------------------------------------------------- */

describe('the picture the next change is measured against', () => {
  it('moves only when the work is let in, and only where there was a picture', async () => {
    bench.sees.set('phone', asShot(withRow(PAGE, 3, 250)));
    bench.sees.set('desktop', null);

    const first = await lookAtCopy();
    const changes = first.changes ?? [];
    await keepShots(agreed, nextAccepted(changes, true));

    const kept = await readdir(agreed);
    // The width that came out is now the mark. The one that did not is not:
    // recording "no picture" would make the next change look like a rewrite
    // and stop the work every time from then on.
    expect(kept).toContain('phone.png');
    expect(kept).not.toContain('desktop.png');
    // Nothing is left waiting on an answer that has been given.
    expect(kept.filter((name) => name.endsWith('.waiting.png'))).toEqual([]);

    // The same change again is not a change any more.
    const again = await lookAtCopy();
    expect(gateOf(again.changes ?? []).stops).toBe(false);
    expect(found(again.changes ?? [], 'phone').kind).toBe('compared');
  });

  it('leaves the mark where it was when the work is set aside', async () => {
    bench.sees.set('phone', asShot(PAGE));
    bench.sees.set('desktop', asShot(PAGE));
    await lookAtCopy();
    await dropShots(agreed);

    expect(await readdir(agreed)).toEqual([]);
    // Still nothing to measure against, because nothing was ever agreed to.
    expect(found((await lookAtCopy()).changes ?? [], 'phone').kind).toBe('first');
  });

  it('moves nothing for a width somebody did not let in', async () => {
    bench.sees.set('phone', asShot(PAGE));
    bench.sees.set('desktop', asShot(PAGE));
    await lookAtCopy();
    await keepShots(agreed, ['phone']);

    const kept = await readdir(agreed);
    expect(kept).toContain('phone.png');
    expect(kept).not.toContain('desktop.png');
  });

  it('cannot be made out of a width that was never photographed', async () => {
    bench.sees.set('phone', asShot(PAGE));
    bench.sees.set('desktop', null);
    await lookAtCopy();

    // Asked for by name, and still refused: the only mark that can be made is
    // one there is a picture for.
    await keepShots(agreed, ['phone', 'desktop']);
    expect(await readdir(agreed)).toEqual(['phone.png']);
  });

  it('moves nothing at all when the answer was no', async () => {
    bench.sees.set('phone', asShot(PAGE));
    bench.sees.set('desktop', asShot(PAGE));
    const changes = (await lookAtCopy()).changes ?? [];
    await keepShots(agreed, nextAccepted(changes, false));
    expect(await readdir(agreed)).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* A folder that will not build                                                */
/* -------------------------------------------------------------------------- */

describe('a project with no pictures in it', () => {
  const eye = (looking: Looking) => ({ look: () => Promise.resolve(looking) });

  it('reads as every width unchecked, never as every width agreed', async () => {
    bench.refuses = 'I could not work out how to run this project.';
    const looking = await lookAtCopy();

    const held = await photographHeld({
      photographer: eye(looking),
      copy: '/copy',
      project: '/project',
      id: 'held-1',
      doing: 'make the header stick',
      sizes: SIZES,
      clock: () => 1000,
    });

    // One reading per width somebody can see, not an empty set — an empty set
    // reads as "nothing moved" and would let a broken project straight in.
    expect(held.changes).toHaveLength(SIZES.length);
    expect(held.changes.every((one) => one.kind === 'nopicture')).toBe(true);
    expect(gateOf(held.changes).standing).toBe('unchecked');
    expect(gateOf(held.changes).stops).toBe(false);
  });

  it('says nothing at all when nothing was asked to be compared', async () => {
    bench.sees.set('phone', asShot(PAGE));
    bench.sees.set('desktop', asShot(PAGE));
    // No folder of agreed pictures: the camera is not comparing.
    const looking = await holdCamera(SIZES).look('/copy', true);
    expect(looking.changes).toBeUndefined();

    const held = await photographHeld({
      photographer: eye(looking),
      copy: '/copy',
      id: 'held-1',
      doing: 'x',
      sizes: SIZES,
      clock: () => 1000,
    });
    // Empty, and the window reads empty as "no gate" rather than as a verdict.
    expect(held.changes).toEqual([]);
  });

  it('asks the camera for the copy and only the copy', async () => {
    const asked: (boolean | undefined)[] = [];
    await photographHeld({
      photographer: {
        look: (_folder: string, compare?: boolean) => {
          asked.push(compare);
          return Promise.resolve({ looks: [], trouble: 'nothing came out' });
        },
      },
      copy: '/copy',
      project: '/project',
      id: 'held-1',
      doing: 'x',
      sizes: SIZES,
      clock: () => 1000,
    });
    // Counting the project against its own marks would be a second render of
    // somebody's site for a reading nobody uses.
    expect(asked[0]).toBe(true);
    expect(asked.slice(1).every((one) => one !== true)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Getting the verdict to the panel                                            */
/* -------------------------------------------------------------------------- */

const source = (path: string): string =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

describe('the verdict reaches the panel', () => {
  it('has the window read the pictures into a verdict', () => {
    const app = source('src/App.tsx');
    expect(app).toContain('gateOf(changes, howMuchBy(preferences.howMuch))');
    // An empty set is the absence of a reading, and reading it as one would
    // let every project that cannot be photographed straight in.
    expect(app).toContain('changes.length === 0 ? null');
  });

  it('hands the verdict, the line and the way to move it all the way down', () => {
    const app = source('src/App.tsx');
    expect(app).toMatch(/\bgate,/);
    expect(app).toContain('onHowMuch={changeHowMuch}');

    const overview = source('src/components/Overview.tsx');
    expect(overview).toContain('gate={view.gate}');
    expect(overview).toContain('howMuch={view.howMuch}');
    expect(overview).toContain('onHowMuch={onHowMuch}');

    const landing = source('src/components/Landing.tsx');
    // The panel took these props and nobody passed them, so it fell back to
    // the old behaviour silently for as long as that was true.
    for (const given of ['gate={gate}', 'howMuch={howMuch}', 'onHowMuch={onHowMuch}']) {
      expect(landing, `Landing.tsx does not give SeeFirst ${given}`).toContain(given);
    }
  });

  it('has the shell point the camera at what was agreed, and move it on a yes', () => {
    const main = source('electron/main.ts');
    // The camera compares nothing unless it is told where the agreed pictures
    // are, and it was told nowhere for as long as this was missing.
    expect(main).toContain('holdCamera(sizes, agreedFolder(project))');
    expect(main).toContain('keepShots(agreed, nextAccepted(changes, true))');
    expect(main).toContain('dropShots(agreed)');
    // Read before either answer clears the pictures, or there is nothing left
    // to move the mark with.
    const read = main.indexOf('const changes = open.held.pictures?.changes ?? []');
    expect(read).toBeGreaterThan(-1);
    expect(read).toBeLessThan(main.indexOf('open.held.pictures = null'));
  });

  /** Keyed to the gate's own `stops`, not to `clear`. A project that cannot be
   *  served as a page has every width unchecked — nothing to compare, nothing
   *  moved — and reading that as "not clear" made every turn of every such
   *  project end waiting for a press, which is the interruption this exists to
   *  end. `unchecked` asks; only `stopped` holds. */
  it('draws no panel unless something actually moved', () => {
    const landing = source('src/components/Landing.tsx');
    expect(landing).toContain('gate !== null && !gate.stops ? null : (');
    expect(landing).not.toContain("gate?.standing === 'clear'");

    const app = source('src/App.tsx');
    expect(app).toContain('if (gate === null || gate.stops) return;');
    expect(app).toContain('decideOnWork(true);');
  });
});

/* -------------------------------------------------------------------------- */
/* The default                                                                 */
/* -------------------------------------------------------------------------- */

describe('work happens as it is asked for, unless somebody says otherwise', () => {
  it('does not hold back a project nobody has said anything about', () => {
    expect(holdsBack({}, '/project')).toBe(false);
    // Turned on is turned on, and stays on across a launch.
    expect(holdsBack({ '/project': true }, '/project')).toBe(true);
    expect(holdsBack({ '/project': false }, '/project')).toBe(false);
    // Another project's answer is not this one's.
    expect(holdsBack({ '/other': true }, '/project')).toBe(false);
    // No folder open is nothing to hold anything back from.
    expect(holdsBack({}, null)).toBe(false);
  });

  it('is read the same way everywhere it is read', () => {
    const guilty: string[] = [];
    for (const path of [
      'src/App.tsx',
      'src/lib/bridge.ts',
      'electron/main.ts',
      'src/components/Overview.tsx',
      'src/components/Settings.tsx',
    ]) {
      source(path)
        .split('\n')
        .forEach((line, at) => {
          // A yes/no worked out on the spot is a place the default can differ.
          if (/heldBack\[[^\]]+\]\s*(===|!==)/.test(line)) guilty.push(`${path}:${String(at + 1)}`);
        });
    }
    expect(guilty, `these decide the default for themselves: ${guilty.join(', ')}`).toEqual([]);
  });
});
