/** The before-and-after.
 *
 * Everything tested here is the part that decides *what is shown*, which is the
 * part that fails quietly. A screenshot that does not get taken is visible
 * immediately; a pair that puts last Tuesday's picture next to this morning's,
 * or an outline drawn around a bit of the page that did not move, looks
 * completely convincing and is a lie about somebody's own work.
 *
 * Rendering is not tested here and cannot be — it is Chromium. The windows are
 * stood in for, so what is tested is the bookkeeping around them: how many are
 * opened, that each one is closed, and what a page's own measurements are
 * turned into.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { saysOverflow, WIDTHS } from '../src/design/widths';
import { lookAtEveryWidth } from '../src/diff/capture';
import { filesWrittenBy } from '../src/diff/changed';
import { couldBeSeen, KEEP, landed, whatCouldBeSeen, type Shot } from '../src/diff/pairing';
import { comparePictures, realSize, type Bitmap, type ChangedArea } from '../src/diff/regions';
import { shotFile, shotName, shotsFolder } from '../src/diff/shots';
import { hasSettled, stepSpring } from '../src/diff/spring';
import { tellWhatHappened, whereItLanded } from '../src/diff/summary';

/* -------------------------------------------------------------------------- */
/* A window nobody has to open                                                 */
/* -------------------------------------------------------------------------- */

/** What each window does, and what it did. `page` is set per test and is asked
 *  the size the window was made at, so a single width can be made to fail. */
const bench = vi.hoisted(() => {
  type Page = {
    loads: boolean;
    /** Null when the page cannot be measured at all. */
    reading: { tall: number; wide: number } | null;
    captures: boolean;
    /** The stylesheets slipped in before the picture was taken. */
    hidden?: string[];
  };

  return {
    page: (width: number, height: number): Page => ({
      loads: true,
      reading: { tall: height, wide: width },
      captures: true,
      hidden: [],
    }),
    opened: [] as { width: number; height: number; destroyed: boolean }[],
  };
});

vi.mock('electron', () => {
  const image = (empty: boolean) => ({
    isEmpty: () => empty,
    toPNG: () => Buffer.from('png'),
    getSize: () => ({ width: 0, height: 0 }),
    toBitmap: () => Buffer.alloc(0),
  });

  class Stand {
    private readonly waiting: Record<string, () => void> = {};
    private readonly page;
    readonly opened;
    readonly webContents;

    constructor(options: { width: number; height: number }) {
      this.page = bench.page(options.width, options.height);
      this.opened = { width: options.width, height: options.height, destroyed: false };
      bench.opened.push(this.opened);

      const { waiting, page } = this;
      this.webContents = {
        once: (event: string, run: () => void) => {
          waiting[event] = run;
        },
        executeJavaScript: () =>
          page.reading === null
            ? Promise.reject(new Error('nothing to measure'))
            : Promise.resolve(page.reading),
        capturePage: () => Promise.resolve(image(!page.captures)),
        // Our own furniture is hidden before every picture — see capture.ts.
        insertCSS: (css: string) => {
          (page.hidden ??= []).push(css);
          return Promise.resolve('');
        },
      };
    }

    loadURL(): Promise<void> {
      queueMicrotask(() => this.waiting[this.page.loads ? 'did-finish-load' : 'did-fail-load']?.());
      return Promise.resolve();
    }

    setContentSize(width: number, height: number): void {
      this.opened.width = width;
      this.opened.height = height;
    }

    isDestroyed(): boolean {
      return this.opened.destroyed;
    }

    destroy(): void {
      this.opened.destroyed = true;
    }
  }

  return { BrowserWindow: Stand, nativeImage: { createFromPath: () => image(true) } };
});

/* -------------------------------------------------------------------------- */
/* Making pictures to compare                                                  */
/* -------------------------------------------------------------------------- */

type Paint = { x: number; y: number; width: number; height: number; shade: number };

/** A flat picture with rectangles painted on it. Four bytes a pixel, like the
 *  real thing, and grey throughout because the comparison is per channel and
 *  colour would only make the fixtures harder to read. */
function picture(width: number, height: number, paints: readonly Paint[] = []): Bitmap {
  const data = new Uint8Array(width * height * 4).fill(255);
  for (const paint of paints) {
    for (let y = paint.y; y < paint.y + paint.height && y < height; y += 1) {
      for (let x = paint.x; x < paint.x + paint.width && x < width; x += 1) {
        const at = (y * width + x) * 4;
        data[at] = paint.shade;
        data[at + 1] = paint.shade;
        data[at + 2] = paint.shade;
        data[at + 3] = 255;
      }
    }
  }
  return { width, height, data };
}

/** Does an area cover this point, in fractions of the picture? */
function covers(area: ChangedArea, x: number, y: number): boolean {
  return (
    x >= area.x && x <= area.x + area.width && y >= area.y && y <= area.y + area.height
  );
}

/* ========================================================================== */
/* V-01 finding what moved                                                     */
/* ========================================================================== */

describe('V-01 what moved between two pictures', () => {
  it('says nothing about two pictures that are the same', () => {
    const one = picture(320, 240, [{ x: 20, y: 20, width: 80, height: 40, shade: 30 }]);
    const same = picture(320, 240, [{ x: 20, y: 20, width: 80, height: 40, shade: 30 }]);

    expect(comparePictures(one, same)).toEqual({ areas: [], fraction: 0 });
  });

  it('finds the one thing that moved, and outlines only that', () => {
    const before = picture(320, 240, [{ x: 40, y: 40, width: 64, height: 32, shade: 20 }]);
    // The same block, 32px further down. Nothing else on the page changed.
    const after = picture(320, 240, [{ x: 40, y: 72, width: 64, height: 32, shade: 20 }]);

    const found = comparePictures(before, after);
    expect(found.areas.length).toBeGreaterThan(0);
    expect(found.fraction).toBeGreaterThan(0);

    // The block's old home and its new one are both different, and they touch,
    // so this is one area — which is also how a person would describe it.
    expect(found.areas).toHaveLength(1);
    const area = found.areas[0] as ChangedArea;
    expect(covers(area, 60 / 320, 50 / 240)).toBe(true);
    expect(covers(area, 60 / 320, 88 / 240)).toBe(true);
    // Nowhere near the bottom of the page, which never changed.
    expect(covers(area, 60 / 320, 220 / 240)).toBe(false);
  });

  it('keeps two changes in different places apart', () => {
    const before = picture(320, 240);
    const after = picture(320, 240, [
      { x: 16, y: 16, width: 48, height: 32, shade: 0 },
      { x: 240, y: 190, width: 48, height: 32, shade: 0 },
    ]);

    const found = comparePictures(before, after);
    expect(found.areas).toHaveLength(2);
  });

  it('ignores the speckle that comes of rendering the same page twice', () => {
    const before = picture(320, 240);
    const after = picture(320, 240);
    // A handful of pixels a shade off, scattered — a font hinted differently, a
    // gradient dithered. Nobody moved anything.
    for (let index = 0; index < 400; index += 4) {
      const at = index * 97 * 4;
      if (at + 2 < after.data.length) {
        (after.data as Uint8Array)[at] = 245;
        (after.data as Uint8Array)[at + 1] = 245;
        (after.data as Uint8Array)[at + 2] = 245;
      }
    }

    expect(comparePictures(after, before).areas).toEqual([]);
  });

  it('treats a page that grew taller as a change, without falling over', () => {
    const before = picture(320, 200);
    const after = picture(320, 320);

    const found = comparePictures(before, after);
    expect(found.areas.length).toBeGreaterThan(0);
    // The new ground is at the bottom, because that is where it was added.
    const lowest = Math.max(...found.areas.map((area) => area.y + area.height));
    expect(lowest).toBeCloseTo(1, 1);
  });

  it('does not draw a long underline for a page that got taller', () => {
    // The real one this rule exists for: a button moves down twelve pixels, the
    // page grows by twelve, and a full-width hairline along the bottom edge is
    // technically different and not worth pointing at.
    const before = picture(320, 240);
    const after = picture(320, 240, [{ x: 0, y: 236, width: 320, height: 4, shade: 0 }]);

    expect(comparePictures(before, after).areas).toEqual([]);
    // It is still reported as a difference, so the two pictures are still
    // shown — it simply gets no outline.
    expect(comparePictures(before, after).fraction).toBeGreaterThan(0);
  });

  it('never reports more outlines than a person can follow', () => {
    const before = picture(400, 400);
    const spots: Paint[] = [];
    for (let index = 0; index < 40; index += 1) {
      spots.push({ x: (index % 8) * 48 + 4, y: Math.floor(index / 8) * 48 + 4, width: 32, height: 32, shade: 0 });
    }
    const after = picture(400, 400, spots);

    expect(comparePictures(before, after).areas.length).toBeLessThanOrEqual(6);
  });

  it('reads the size off the bytes, not off the label', () => {
    // What a retina capture looks like: a picture that calls itself 100×50 and
    // arrives with four times as many pixels. Believing the label would walk
    // diagonally through the image and report the whole page as changed.
    const dense: Bitmap = { width: 100, height: 50, data: new Uint8Array(200 * 100 * 4).fill(255) };
    expect(realSize(dense)).toEqual({ width: 200, height: 100 });

    const plain: Bitmap = { width: 100, height: 50, data: new Uint8Array(100 * 50 * 4).fill(255) };
    expect(realSize(plain)).toEqual({ width: 100, height: 50 });
  });

  it('answers honestly about a picture with nothing in it', () => {
    const nothing: Bitmap = { width: 0, height: 0, data: new Uint8Array(0) };
    expect(comparePictures(nothing, nothing)).toEqual({ areas: [], fraction: 0 });
  });
});

/* ========================================================================== */
/* V-02 which two pictures go together                                         */
/* ========================================================================== */

function shot(id: string, at: number): Shot {
  return { id, at, file: `/tmp/${id}.png`, width: 1180, height: 820 };
}

describe('V-02 pairing', () => {
  it('has nothing to compare the very first picture against', () => {
    const first = landed([], shot('one', 1));
    expect(first.pair).toBeNull();
    expect(first.kept).toEqual([shot('one', 1)]);
    expect(first.forget).toEqual([]);
  });

  it('pairs a new picture with the one before it', () => {
    const history = [shot('one', 1)];
    const next = landed(history, shot('two', 2));

    expect(next.pair).toEqual({ before: shot('one', 1), after: shot('two', 2) });
  });

  it('always compares against the most recent, never the oldest', () => {
    const history = [shot('one', 1), shot('two', 2), shot('three', 3)];
    const next = landed(history, shot('four', 4));

    expect(next.pair?.before.id).toBe('three');
  });

  it('replaces a picture taken twice under the same name rather than stacking it', () => {
    const history = [shot('one', 1), shot('two', 2)];
    const again = landed(history, { ...shot('two', 9), file: '/tmp/two-again.png' });

    expect(again.kept.map((one) => one.id)).toEqual(['one', 'two']);
    expect(again.pair).toEqual({
      before: shot('one', 1),
      after: { ...shot('two', 9), file: '/tmp/two-again.png' },
    });
  });

  it('lets the oldest pictures go rather than filling somebody’s disk', () => {
    let history: readonly Shot[] = [];
    let dropped: string[] = [];
    for (let index = 0; index < 10; index += 1) {
      const result = landed(history, shot(`s${String(index)}`, index), 4);
      history = result.kept;
      dropped = [...dropped, ...result.forget.map((one) => one.id)];
    }

    expect(history).toHaveLength(4);
    expect(history.map((one) => one.id)).toEqual(['s6', 's7', 's8', 's9']);
    expect(dropped).toEqual(['s0', 's1', 's2', 's3', 's4', 's5']);
  });

  it('holds a project to its ceiling however long the sitting runs', () => {
    // The retention policy, as a number. A hundred turns in one afternoon still
    // leaves twelve pictures on the disk, and every one that falls off the end
    // comes back in `forget` so it can actually be deleted rather than merely
    // dropped from a list.
    let history: readonly Shot[] = [];
    let deleted = 0;
    for (let index = 0; index < 100; index += 1) {
      const result = landed(history, shot(`s${String(index)}`, index));
      history = result.kept;
      deleted += result.forget.length;
    }

    expect(history).toHaveLength(KEEP);
    expect(deleted).toBe(100 - KEEP);
  });

  it('never keeps fewer than a pair, however small it is asked to be', () => {
    const result = landed([shot('one', 1)], shot('two', 2), 0);
    expect(result.kept).toHaveLength(2);
    expect(result.pair).not.toBeNull();
  });
});

/* ========================================================================== */
/* V-03 whether there is anything to photograph                                */
/* ========================================================================== */

describe('V-03 changes that could be seen', () => {
  it('counts the things a page is made of', () => {
    for (const file of [
      'index.html',
      'src/styles/tokens.css',
      'src/components/Hero.tsx',
      'content/site.json',
      'public/hero.png',
      'public/fonts/Grotesk.woff2',
      'about.md',
    ]) {
      expect(couldBeSeen(file)).toBe(true);
    }
  });

  it('does not count the things nobody looks at', () => {
    for (const file of [
      'README.md',
      'package-lock.json',
      '.gitignore',
      '.env',
      'node_modules/react/index.js',
      'dist/assets/index.js',
      '.next/server/page.js',
      'src/components/Hero.test.tsx',
      'coverage/lcov.info',
    ]) {
      expect(couldBeSeen(file)).toBe(false);
    }
  });

  it('reads a path however it is written', () => {
    expect(couldBeSeen('./src/app/page.tsx')).toBe(true);
    expect(couldBeSeen('src\\app\\page.tsx')).toBe(true);
    expect(couldBeSeen('')).toBe(false);
    expect(couldBeSeen('   ')).toBe(false);
  });

  it('sifts a turn’s worth of changes and keeps each one once', () => {
    const kept = whatCouldBeSeen([
      'src/index.html',
      './src/index.html',
      'package-lock.json',
      'node_modules/left-pad/index.js',
      'styles.css',
    ]);

    expect(kept).toEqual(['src/index.html', 'styles.css']);
  });

  it('says there is nothing to photograph when only the setup changed', () => {
    expect(whatCouldBeSeen(['package-lock.json', 'README.md'])).toEqual([]);
  });
});

/* ========================================================================== */
/* V-04 which files a step wrote                                               */
/* ========================================================================== */

describe('V-04 reading the steps', () => {
  it('takes the path off a write', () => {
    expect(filesWrittenBy({ id: '1', name: 'write', input: { path: 'src/index.html' } })).toEqual([
      'src/index.html',
    ]);
  });

  it('understands the spellings different tools use', () => {
    expect(
      filesWrittenBy({ id: '1', name: 'edit', input: { file_path: '/p/styles.css' } }),
    ).toEqual(['/p/styles.css']);
    expect(filesWrittenBy({ id: '2', name: 'str_replace', input: { filePath: 'a.tsx' } })).toEqual([
      'a.tsx',
    ]);
  });

  it('finds both ends of a move', () => {
    const moved = filesWrittenBy({
      id: '1',
      name: 'move',
      input: { old_path: 'a/one.html', new_path: 'b/one.html' },
    });
    expect(moved).toContain('a/one.html');
    expect(moved).toContain('b/one.html');
  });

  it('reads a step that edits several files at once', () => {
    const many = filesWrittenBy({
      id: '1',
      name: 'multiedit',
      input: { edits: [{ path: 'one.css' }, { path: 'two.css' }] },
    });
    expect(many).toEqual(['one.css', 'two.css']);
  });

  it('says nothing about a step that only reads', () => {
    expect(filesWrittenBy({ id: '1', name: 'read', input: { path: 'src/index.html' } })).toEqual([]);
    expect(filesWrittenBy({ id: '2', name: 'grep', input: { pattern: 'hero' } })).toEqual([]);
  });

  it('does not guess at what a command did', () => {
    // Working out which files `npm run build` touched is a confident wrong
    // answer waiting to happen. A picture we did not take costs a nicety; a
    // picture of the wrong thing costs the feature its credibility.
    expect(filesWrittenBy({ id: '1', name: 'bash', input: { command: 'rm -rf dist' } })).toEqual([]);
  });

  it('says nothing about a step it has never heard of', () => {
    expect(filesWrittenBy({ id: '1', name: 'summon', input: { path: 'a.html' } })).toEqual([]);
  });
});

/* ========================================================================== */
/* V-05 the sentence beside the pictures                                       */
/* ========================================================================== */

describe('V-05 what gets said about it', () => {
  it('points at one area the way a person would', () => {
    expect(whereItLanded([{ x: 0.05, y: 0.05, width: 0.14, height: 0.08 }], 0.02)).toBe(
      'One area changed, near the top on the left.',
    );
    expect(whereItLanded([{ x: 0.7, y: 0.8, width: 0.12, height: 0.08 }], 0.02)).toBe(
      'One area changed, near the bottom on the right.',
    );
  });

  it('does not mention a side for something that spans the page', () => {
    const said = whereItLanded([{ x: 0, y: 0.02, width: 1, height: 0.09 }], 0.05);
    expect(said).toBe('One area changed, right across the top.');
  });

  it('gathers several areas in one band into one sentence', () => {
    const said = whereItLanded(
      [
        { x: 0.05, y: 0.05, width: 0.1, height: 0.05 },
        { x: 0.6, y: 0.08, width: 0.1, height: 0.05 },
      ],
      0.03,
    );
    expect(said).toBe('Two areas changed, near the top.');
  });

  it('stops naming places once most of the page is different', () => {
    expect(whereItLanded([{ x: 0, y: 0, width: 1, height: 1 }], 0.9)).toBe(
      'Most of the page looks different.',
    );
  });

  it('says nothing when nothing measurably moved', () => {
    expect(whereItLanded([], 0)).toBeNull();
  });

  it('takes its headline from what the person asked for', () => {
    const told = tellWhatHappened({
      files: ['src/components/Header.tsx'],
      instruction: 'make the header sticky',
      areas: [{ x: 0, y: 0.01, width: 1, height: 0.08 }],
      fraction: 0.06,
    });

    expect(told.headline).toBe('Made the header sticky');
    expect(told.where).toBe('One area changed, right across the top.');
  });

  it('falls back to what changed when nothing was asked for', () => {
    const told = tellWhatHappened({
      files: ['src/styles/tokens.css'],
      areas: [],
      fraction: 0,
    });

    expect(told.headline).toBe('Updated the styling');
    expect(told.where).toBeNull();
  });

  it('never says a word we have retired', () => {
    // The headline comes from the timeline's own writer, which is swept for
    // jargon by its own test — this is the seam holding, not a second sweep.
    const told = tellWhatHappened({
      files: ['index.html'],
      instruction: 'revert the commit on that branch',
      areas: [],
      fraction: 0,
    });

    expect(told.headline).toBe('Updated the home page');
  });
});

/* ========================================================================== */
/* V-06 where the pictures are kept                                            */
/* ========================================================================== */

describe('V-06 keeping the pictures out of the project', () => {
  it('puts them inside the machinery, never beside the work', () => {
    expect(shotsFolder('/Users/me/Sites/paper-street')).toBe(
      '/Users/me/Sites/paper-street/.git/graphe/shots',
    );
    expect(shotsFolder('/Users/me/Sites/paper-street/')).toBe(
      '/Users/me/Sites/paper-street/.git/graphe/shots',
    );
  });

  it('cannot be talked out of that folder by an id', () => {
    expect(shotName('../../../etc/passwd')).toBe('etc-passwd');
    expect(shotName('a/b')).toBe('a-b');
    expect(shotName('')).toBe('shot');
    expect(shotFile('/p', '../secrets')).toBe('/p/.git/graphe/shots/secrets.png');
  });

  it('leaves an ordinary id alone', () => {
    expect(shotName('lx8f2k-3')).toBe('lx8f2k-3');
  });
});

/* ========================================================================== */
/* V-07 the same page at three widths                                          */
/* ========================================================================== */

describe('V-07 photographing every width', () => {
  beforeEach(() => {
    bench.opened = [];
    bench.page = (width, height) => ({
      loads: true,
      reading: { tall: height, wide: width },
      captures: true,
    });
  });

  it('takes one picture per width, at the size that width is', async () => {
    const looks = await lookAtEveryWidth('http://127.0.0.1:4321/');

    expect(looks).toHaveLength(WIDTHS.length);
    expect(looks.map((one) => one.id)).toEqual(WIDTHS.map((one) => one.id));
    expect(looks.map((one) => one.width)).toEqual(WIDTHS.map((one) => one.width));
    for (const look of looks) {
      expect(look.shot).toMatch(/^data:image\/png;base64,/);
      expect(look.trouble).toBeNull();
    }

    expect(bench.opened.map((one) => one.width)).toEqual(WIDTHS.map((one) => one.width));
  });

  it('loses only the width that failed', async () => {
    const tablet = WIDTHS[1]?.width;
    bench.page = (width, height) => ({
      loads: width !== tablet,
      reading: { tall: height, wide: width },
      captures: true,
    });

    const looks = await lookAtEveryWidth('http://127.0.0.1:4321/');

    expect(looks).toHaveLength(3);
    expect(looks[0]?.shot).not.toBeNull();
    expect(looks[1]?.shot).toBeNull();
    expect(looks[2]?.shot).not.toBeNull();
  });

  it('closes every window it opened, including the one that went wrong', async () => {
    const phone = WIDTHS[0]?.width;
    bench.page = (width, height) => ({
      loads: true,
      reading: { tall: height, wide: width },
      captures: width !== phone,
    });

    await lookAtEveryWidth('http://127.0.0.1:4321/');

    expect(bench.opened).toHaveLength(3);
    expect(bench.opened.every((one) => one.destroyed)).toBe(true);
  });

  it('turns a page wider than the screen into something worth saying', async () => {
    const phone = WIDTHS[0];
    bench.page = (width, height) => ({
      loads: true,
      reading: { tall: height, wide: width === phone?.width ? width + 40 : width },
      captures: true,
    });

    const looks = await lookAtEveryWidth('http://127.0.0.1:4321/');

    expect(looks[0]?.trouble).toBe(saysOverflow(phone?.name ?? '', 40));
    expect(looks[0]?.shot).not.toBeNull();
    expect(looks[1]?.trouble).toBeNull();
    expect(looks[2]?.trouble).toBeNull();
  });

  it('says nothing about a width it could not measure', async () => {
    bench.page = () => ({ loads: true, reading: null, captures: true });

    const looks = await lookAtEveryWidth('http://127.0.0.1:4321/');

    for (const look of looks) {
      expect(look.shot).not.toBeNull();
      expect(look.trouble).toBeNull();
    }
  });
});

/* ========================================================================== */
/* V-08 the handle                                                             */
/* ========================================================================== */

describe('V-08 the spring under the wipe handle', () => {
  it('arrives, and then stops', () => {
    let state = { position: 0, velocity: 0 };
    for (let frame = 0; frame < 120; frame += 1) {
      state = stepSpring(state, 1, 16);
    }

    expect(state.position).toBe(1);
    expect(hasSettled(state, 1)).toBe(true);
  });

  it('does not bounce past where it was going', () => {
    // "Bounce on ordinary UI: playful once, irritating by the fiftieth time."
    let state = { position: 0, velocity: 0 };
    let furthest = 0;
    for (let frame = 0; frame < 120; frame += 1) {
      state = stepSpring(state, 1, 16);
      furthest = Math.max(furthest, state.position);
    }

    expect(furthest).toBeLessThanOrEqual(1.002);
  });

  it('bends towards a target that moves under it, rather than finishing first', () => {
    // The whole reason it is a spring: a gesture cannot be told to wait for an
    // animation to run its course.
    let state = { position: 0, velocity: 0 };
    for (let frame = 0; frame < 6; frame += 1) state = stepSpring(state, 1, 16);
    const mid = state.position;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);

    // Somebody grabs it and drags the other way.
    for (let frame = 0; frame < 60; frame += 1) state = stepSpring(state, 0, 16);
    expect(state.position).toBe(0);
  });

  it('resumes rather than lurching after the window has been away', () => {
    const before = { position: 0.2, velocity: 0 };
    const long = stepSpring(before, 1, 5000);
    const capped = stepSpring(before, 1, 64);

    expect(long.position).toBeCloseTo(capped.position, 6);
    expect(long.position).toBeLessThan(1);
  });

  it('stays where it is when it is already there', () => {
    expect(stepSpring({ position: 0.5, velocity: 0 }, 0.5, 16)).toEqual({
      position: 0.5,
      velocity: 0,
    });
  });
});
