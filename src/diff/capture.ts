/** Taking the picture.
 *
 * The only file in `src/diff/` that touches Electron, for the same reason
 * `src/preview/` touches `node:http`: this runs in the desktop shell and
 * nowhere else. The window never sees it, never imports it and could not use it
 * if it did.
 *
 * ## Why not Playwright, which is already here
 *
 * It is a *development* dependency. `npm run shot` drives it to review our own
 * interface, and it comes with a browser download measured in hundreds of
 * megabytes that electron-builder does not put in the app — so a feature built
 * on it works perfectly for us and does nothing at all for anybody who installs
 * the DMG. Adding it as a runtime dependency instead would mean shipping a
 * second browser inside an app that already contains one, and asking every user
 * to download Chromium twice.
 *
 * Electron's own offscreen rendering is the second browser we already have.
 * `BrowserWindow({ webPreferences: { offscreen: true } })` composites without a
 * screen attached, and `webContents.capturePage()` hands back the pixels. It is
 * core Electron, it ships in the packaged app by construction, and it costs
 * nothing on disk.
 *
 * ## Making the site first, the same way "See it" does
 *
 * `makeAndServe` already knows how to read a folder, get it ready and serve the
 * finished pages over the loopback address — including the rule from
 * notes/strategy/SHARING.md §1 that we never start the server a developer runs
 * while working. Screenshotting the same thing the user would look at means
 * that rule holds here too, without this file having an opinion about it.
 *
 * ## It is allowed to fail, quietly
 *
 * Every path out of here is a picture or `null`. A project that will not build,
 * a page that never finishes loading, a folder we cannot write to — none of
 * that is worth a card in somebody's conversation. They asked for a change, not
 * for a screenshot; a missing picture costs them a nicety, and an error card
 * about it costs them their confidence in the change itself.
 */

import { BrowserWindow, nativeImage, type NativeImage } from 'electron';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';

import { overflowing, saysOverflow, WIDTHS, type Look, type Width } from '../design/widths';
import { makeAndServe } from '../preview/show';
import { comparePictures, realSize, type Bitmap, type ChangedArea } from './regions';
import { shotFile, shotsFolder } from './shots';

/** Wide enough to be the desktop layout, short enough that a long page does not
 *  become a picture nobody can see the top of. */
const VIEWPORT = { width: 1180, height: 820 } as const;
/** However tall the page is, up to this. Past it we are photographing a scroll
 *  rather than a page. */
const TALLEST = 2400;

/** A page that has not finished in this long is not going to. */
const PATIENCE = 20_000;
/** After the last byte arrives: fonts swapping, images decoding, the one
 *  entrance animation everybody puts on a hero. Long enough to settle, short
 *  enough that nobody notices this happening. */
const SETTLE = 450;

/** How wide the little pictures in the collapsed strip are. */
const THUMB = 260;

export type Picture = {
  id: string;
  at: number;
  file: string;
  /** Size of the picture as written, in real pixels. */
  width: number;
  height: number;
};

export type Difference = {
  areas: readonly ChangedArea[];
  fraction: number;
};

function bitmapOf(image: NativeImage): Bitmap {
  const size = image.getSize();
  return { width: size.width, height: size.height, data: image.getBitmap() };
}

/** Small, and cheap enough to send with every strip. JPEG rather than PNG: a
 *  260px-wide thumbnail of a web page is a photograph as far as a compressor is
 *  concerned, and the PNG of it is roughly eight times the size for a
 *  difference nobody can see at that scale. */
function thumbnailOf(image: NativeImage): string {
  const small = image.resize({ width: THUMB, quality: 'good' });
  return `data:image/jpeg;base64,${small.toJPEG(72).toString('base64')}`;
}

export function pictureAsDataUri(bytes: Buffer): string {
  return `data:image/png;base64,${bytes.toString('base64')}`;
}

/** A picture off the disk, as a data URI the window can draw.
 *
 *  Data rather than a `file://` address because the shipped window runs under a
 *  content policy that allows `img-src 'self' data: blob:` and nothing else —
 *  see `applyContentPolicy` in electron/main.ts. Handing the renderer a path
 *  into somebody's project folder would also be handing it a path into
 *  somebody's project folder. */
export async function readPicture(file: string): Promise<string | null> {
  try {
    return pictureAsDataUri(await readFile(file));
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* One window, offscreen                                                       */
/* -------------------------------------------------------------------------- */

function waitFor<T>(work: Promise<T>, patience: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    work.catch(() => null),
    new Promise<null>((give) => {
      timer = setTimeout(() => give(null), patience);
    }),
  ]).finally(() => clearTimeout(timer));
}

function rest(howLong: number): Promise<void> {
  return new Promise((wake) => setTimeout(wake, howLong));
}

type Size = { width: number; height: number };

type Photographed = {
  image: NativeImage;
  /** How wide the page turned out to be, or null when it could not be measured. */
  contentWidth: number | null;
};

/** One finite number off the object the page handed back. */
function measured(reading: unknown, key: string): number | null {
  if (typeof reading !== 'object' || reading === null) return null;
  const found = (reading as Record<string, unknown>)[key];
  return typeof found === 'number' && Number.isFinite(found) ? found : null;
}

/**
 * Load an address in a window nobody can see, and photograph it.
 *
 * Its own session partition, and that is not incidental. The shipped app
 * installs a content policy on the *default* session (electron/main.ts), which
 * is right for our own window and wrong for somebody else's site: a designer's
 * page with a web font or an inline script would be photographed with the font
 * missing and the script blocked, and they would be looking at a picture of
 * their site being broken by us. A partition of its own keeps our policy on our
 * window and off theirs. It is in memory rather than persisted, so nothing from
 * their site is written to disk.
 *
 * `size` defaults to the desktop viewport; the three widths pass their own.
 */
async function photograph(
  address: string,
  size: Size = VIEWPORT,
): Promise<Photographed | null> {
  const window = new BrowserWindow({
    show: false,
    width: size.width,
    height: size.height,
    useContentSize: true,
    webPreferences: {
      offscreen: true,
      partition: 'graphe-visual-diff',
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      javascript: true,
      spellcheck: false,
      // Their own site, animating itself. A page photographed a beat too early
      // is a picture of a fade halfway through, and two of those in a row are
      // a "change" nobody made.
      backgroundThrottling: false,
    },
  });

  try {
    const arrived = await waitFor(
      new Promise<boolean>((loaded, failed) => {
        window.webContents.once('did-finish-load', () => loaded(true));
        window.webContents.once('did-fail-load', () => failed(new Error('did not load')));
        void window.loadURL(address).catch(() => failed(new Error('did not load')));
      }),
      PATIENCE,
    );
    if (arrived !== true) return null;

    // Our own furniture never appears in a picture of somebody's work. The
    // preview carries a way to point at things; a photograph of the page must
    // not, or every before-and-after would show it. A page that will not take
    // the stylesheet still photographs fine.
    try {
      await window.webContents.insertCSS('[data-graphe]{display:none !important}');
    } catch {
      /* nothing to hide, or nothing that would take it */
    }

    await rest(SETTLE);

    // As tall as the page, within reason. A screenshot of the first screenful
    // is a screenshot of the header, and almost nothing anybody asks for is in
    // the header. How wide the page came out is asked in the same breath,
    // because it can only be known while it is still loaded.
    const reading = await waitFor(
      window.webContents.executeJavaScript(
        `(() => { const d = document.documentElement, b = document.body;
          return {
            tall: Math.max(d.scrollHeight, d.offsetHeight, b ? b.scrollHeight : 0, ${size.height}),
            wide: d.scrollWidth,
          }; })()`,
        true,
      ) as Promise<unknown>,
      4000,
    );
    const tall = measured(reading, 'tall');
    const height =
      tall === null ? size.height : Math.min(TALLEST, Math.max(size.height, Math.round(tall)));

    if (height !== size.height) {
      window.setContentSize(size.width, height);
      // A resize is a relayout, and a relayout is a repaint. Let it land.
      await rest(SETTLE);
    }

    const image = await waitFor(window.webContents.capturePage(), 8000);
    if (image === null || image.isEmpty()) return null;
    return { image, contentWidth: measured(reading, 'wide') };
  } catch {
    return null;
  } finally {
    if (!window.isDestroyed()) window.destroy();
  }
}

/* -------------------------------------------------------------------------- */
/* The whole errand                                                            */
/* -------------------------------------------------------------------------- */

export type CaptureRequest = {
  /** The project folder. */
  folder: string;
  /** What to file this picture under. */
  id: string;
};

export type Captured = {
  picture: Picture;
  /** The little version, ready to draw. */
  thumbnail: string;
  /** Kept so the next comparison does not have to read it back off the disk. */
  bitmap: Bitmap;
};

/**
 * Get the project ready, photograph it, and write the picture down.
 *
 * Null for every kind of failure there is, on purpose — see the note at the top
 * of the file. The server is stopped whatever happens: a preview left listening
 * because a screenshot went wrong is a port held open for the rest of the
 * afternoon.
 */
export async function capture(request: CaptureRequest): Promise<Captured | null> {
  let stop: (() => Promise<void>) | null = null;
  try {
    const ready = await makeAndServe({ folder: request.folder, says: () => {} });
    if (ready.kind !== 'showing') return null;
    stop = () => ready.serving.stop();

    const taken = await photograph(ready.serving.address);
    if (taken === null) return null;
    const image = taken.image;

    const file = shotFile(request.folder, request.id);
    await mkdir(shotsFolder(request.folder), { recursive: true });
    await writeFile(file, image.toPNG());

    const bitmap = bitmapOf(image);
    const size = realSize(bitmap);

    return {
      picture: { id: request.id, at: Date.now(), file, width: size.width, height: size.height },
      thumbnail: thumbnailOf(image),
      bitmap,
    };
  } catch {
    return null;
  } finally {
    await stop?.().catch(() => {});
  }
}

/* -------------------------------------------------------------------------- */
/* The same page, three times                                                  */
/* -------------------------------------------------------------------------- */

/** One width, photographed and measured. Failure is this width's own: it comes
 *  back as a `Look` with no picture rather than as a thrown error, so the two
 *  that did come out are still worth showing. */
async function lookAt(address: string, size: Width): Promise<Look> {
  const named = { id: size.id, name: size.name, width: size.width };
  try {
    const taken = await photograph(address, { width: size.width, height: size.height });
    if (taken === null) return { ...named, shot: null, trouble: null };

    const wide = taken.contentWidth;
    return {
      ...named,
      shot: pictureAsDataUri(taken.image.toPNG()),
      trouble:
        wide !== null && overflowing(size.width, wide)
          ? saysOverflow(size.name, wide - size.width)
          : null,
    };
  } catch {
    return { ...named, shot: null, trouble: null };
  }
}

/**
 * The same address at all three widths.
 *
 * One window at a time rather than three at once: each is somebody else's site
 * rendering offscreen, and holding three of them open to save a second is the
 * kind of saving that shows up as a fan.
 */
export async function lookAtEveryWidth(address: string): Promise<readonly Look[]> {
  const looks: Look[] = [];
  for (const size of WIDTHS) looks.push(await lookAt(address, size));
  return looks;
}

/** A picture as it is on disk, read back into pixels and a thumbnail. Used for
 *  the older half of a pair when the app has been restarted, or the project
 *  reopened, since it was taken. */
export async function readShot(
  file: string,
): Promise<{ bitmap: Bitmap; thumbnail: string } | null> {
  try {
    const image = nativeImage.createFromPath(file);
    if (image.isEmpty()) return null;
    return { bitmap: bitmapOf(image), thumbnail: thumbnailOf(image) };
  } catch {
    return null;
  }
}

/** What moved between two pictures. Empty when either of them cannot be read,
 *  which reads downstream as "nothing to point at" rather than as a failure. */
export function whatMoved(before: Bitmap | null, after: Bitmap | null): Difference {
  if (before === null || after === null) return { areas: [], fraction: 0 };
  return comparePictures(before, after);
}

/** Pictures nobody needs any more. Failing to delete one is not worth a word:
 *  it is a file in a folder the user never opens. */
export async function forget(files: Iterable<string>): Promise<void> {
  for (const file of files) {
    await rm(file, { force: true }).catch(() => {});
  }
}

/**
 * Everything left over from last time, on the way in.
 *
 * A pairing only exists in memory — it is "the picture before this one", and
 * the app has no memory of that across a restart. So at the moment a project is
 * opened, every picture already in the folder is an orphan: nothing will ever be
 * compared against it, and it cannot be, because we have no idea what has
 * happened to the project since. Left alone they accumulate one per launch
 * forever, which is a hundred kilobytes a day of somebody's disk for nothing.
 */
export async function forgetEverything(projectFolder: string): Promise<void> {
  const folder = shotsFolder(projectFolder);
  try {
    const left = await readdir(folder);
    await forget(left.map((name) => `${folder}/${name}`));
  } catch {
    // No folder yet, which is the ordinary case the first time.
  }
}
