// The product shots on the landing page, captured from the real interface.
//
//   node site/scripts/shots.mjs
//
// Every picture on the site is the app itself, taken at 2x against the dev
// server, so a shot can never drift from what the app actually looks like.
// Run it again after an interface change and the site is up to date.

import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { chromium } from 'playwright';

const PORT = 5273;
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const VITE = join(ROOT, 'node_modules/vite/bin/vite.js');
const OUT = join(ROOT, 'site/assets/shots');
const HOME = `http://localhost:${PORT}`;

/** The fixture project the mock bridge always carries. Naming it in the
 *  address opens it, so a capture never walks the recent list. */
const PROJECT = 'paper-street';

/** Where the dev server's pid is kept. A run that is killed rather than
 *  finished leaves its server holding the port for ever, and every run after
 *  it reads that port as somebody else's and leaves it alone. This file is
 *  what tells ours apart from one somebody else started. */
const PIDFILE = join(ROOT, 'site/.shots-server.pid');

/** Both loopback addresses — on macOS `localhost` resolves to ::1, and a check
 *  that only tries 127.0.0.1 reports a busy port free. */
const LOOPBACK = ['::1', '127.0.0.1'];

function listening(host, port) {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host });
    const answer = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.once('connect', () => answer(true));
    socket.once('error', () => answer(false));
    socket.setTimeout(600, () => answer(false));
  });
}

async function serving() {
  return (await Promise.all(LOOPBACK.map((host) => listening(host, PORT)))).includes(true);
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let ours = null;

/** The pid a previous run wrote down, or null when none did. */
async function leftBehind() {
  try {
    const pid = Number.parseInt(await readFile(PIDFILE, 'utf8'), 10);
    return Number.isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

function alive(pid) {
  if (pid === null) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function forgetPid() {
  try {
    await rm(PIDFILE, { force: true });
  } catch {
    /* nothing to clear */
  }
}

/** Take back the server a killed run stranded. Only ever the pid we wrote
 *  down, and only while our port is actually held — a pidfile naming a process
 *  that has since been cleaned up, or a port somebody else's server took over,
 *  is left alone. */
async function reclaim() {
  const pid = await leftBehind();
  await forgetPid();
  if (!alive(pid)) return;
  if (!(await serving())) return;
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    return;
  }
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (!(await serving())) return;
    await pause(250);
  }
}

async function ensureServer() {
  await reclaim();
  if (await serving()) return false;
  /* Not detached: this way a Ctrl-C reaches vite along with this script, and
     the pidfile covers the kill that no signal can reach. */
  const child = spawn(process.execPath, [VITE, '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    stdio: 'ignore',
  });
  child.unref();
  ours = child.pid;
  await writeFile(PIDFILE, String(child.pid));
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await serving()) return true;
    await pause(250);
  }
  // This exit is above the caller's `finally`, so the server it just started
  // is put down here rather than left holding the port.
  await letGo();
  throw new Error('the dev server never came up');
}

/** What `ensureServer` started, in the one place both exits can reach it. */
async function letGo() {
  if (ours === null) return;
  try {
    process.kill(ours, 'SIGTERM');
  } catch {
    /* already gone */
  }
  ours = null;
  await forgetPid();
}

/** The pieces of the interface the page shows, by the heading they sit under in
 *  the gallery. Each becomes one picture per theme. */
const PIECES = [
  ['versions', 'Version timeline'],
  ['background-work', 'Background work'],
  ['canvas', 'Canvas'],
  ['cost', 'Cost'],
  ['helpers', 'Who else is working'],
  ['show-me', 'Show me'],
  ['history-lines', 'History, as lines'],
  ['doing', 'What it is doing, while it does it'],
];

async function shootGallery(browser, theme) {
  const page = await browser.newPage({
    viewport: { width: 1180, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: theme,
  });
  await page.goto(`${HOME}?gallery`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);

  for (const [slug, heading] of PIECES) {
    const section = page
      .locator('.gsection')
      .filter({ has: page.locator('.gsection__title', { hasText: heading }) })
      .first();
    const body = section.locator('.gsection__body');
    if ((await body.count()) === 0) {
      console.warn(`no section called "${heading}" — skipped`);
      continue;
    }
    await body.scrollIntoViewIfNeeded();
    await page.waitForTimeout(220);
    const file = join(OUT, `${slug}-${theme}.png`);
    await body.screenshot({ path: file });
    console.log(`captured ${file}`);
  }
  await page.close();
}

/** A whole window with the fixture project already open. `?open=` is the app's
 *  own way in, and it does not depend on what happened to be in somebody's
 *  recent list, which a press on the picker would. */
async function opened(browser, theme) {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: theme,
  });
  await page.goto(`${HOME}?open=${PROJECT}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1600);
  return page;
}

/** The whole window, mid-session: something asked, something made, a version
 *  saved beside it. The one picture the top of the page is built around, and
 *  the one `og.mjs` draws the share card from — so it is captured under the
 *  name the page and the card both read. */
async function shootWindow(browser, theme) {
  const page = await opened(browser, theme);

  const composer = page.getByRole('textbox', { name: 'What do you want to make?' });
  if ((await composer.count()) === 0) throw new Error('no composer — the project never opened');
  await composer.first().click();
  await composer.first().fill('Rebuild the hero from our Figma frame, using our own tokens');
  await page.keyboard.press('Enter');
  // The mock bridge streams its answer the way the desktop app does.
  await page.waitForTimeout(6000);
  await page.mouse.move(0, 0);
  const file = join(OUT, `app-start-${theme}.png`);
  await page.screenshot({ path: file });
  console.log(`captured ${file}`);
  await page.close();
}

/** The band under "Send it away", which the page shows full width. One light
 *  window, wider than the rest, because the picture is about the rail's
 *  columns and a narrow one would cut two of them off. */
async function shootBand(browser) {
  const page = await browser.newPage({
    viewport: { width: 1600, height: 950 },
    deviceScaleFactor: 2,
    colorScheme: 'light',
  });
  await page.goto(`${HOME}?open=${PROJECT}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1800);
  await page.mouse.move(0, 0);
  const file = join(OUT, 'band-start.png');
  await page.screenshot({ path: file });
  console.log(`captured ${file}`);
  await page.close();
}

/** A place in the rail, or false and a word when this build has no way in.
 *  Half of these are drawn only once a project is open, and a capture that
 *  stopped at the first absent control would never reach the rest. */
async function pressPlace(page, name) {
  const place = page.getByRole('button', { name, exact: true }).first();
  if ((await place.count()) === 0) {
    console.warn(`no way in to "${name}" — skipped`);
    return false;
  }
  await place.click();
  await page.waitForTimeout(1500);
  return true;
}

/** The views somebody opens on purpose, and how each is reached. Every one is
 *  a whole window, because the point of all of them is that it is the same
 *  window. `shot` is the whole stem, so the ones the page names exactly —
 *  `commands-terminal`, not `commands-terminal-view` — come out as asked.
 *
 *  Each reach says whether it got there. A view that could not be opened is
 *  skipped rather than photographed anyway, because a picture filed under the
 *  wrong name is worse than a missing one. */
const VIEWS = [
  /* The hero's History and Skills tabs read these two by name, and the masters
     under `shots/` are kept only as `app-*` or `crop-*`, so a view the page
     itself shows is captured under the page's own name rather than a second
     one that only the encoder would ever see. */
  ['app-history', (page) => pressPlace(page, 'History')],
  ['app-skills', (page) => pressPlace(page, 'Skills')],
  ['files-view', (page) => pressPlace(page, 'Project files')],
  ['review-view', (page) => pressPlace(page, 'Review')],
  ['canvas-view', (page) => pressPlace(page, 'Canvas')],
  [
    'split-view',
    async (page) => {
      /* The picture the page asks for is a chat beside the canvas, so the
         canvas goes in first when there is one; a window with two of the same
         chat is the fallback, not the subject. */
      await pressPlace(page, 'Canvas');
      const split = page.getByRole('button', { name: 'Split', exact: true }).first();
      if ((await split.count()) === 0) {
        console.warn('no way in to "Split" — skipped');
        return false;
      }
      await split.click();
      await page.waitForTimeout(1500);
      return true;
    },
  ],
  [
    'commands-terminal',
    async (page) => {
      /* The drawer even without a pty: the pane says there is no terminal in
       * this build, which is the honest thing to photograph when there is
       * not one. */
      if (!(await pressPlace(page, 'Commands'))) return false;
      const terminal = page.getByRole('button', { name: 'Terminal', exact: true }).first();
      if ((await terminal.count()) === 0) {
        console.warn('no terminal switch in this build — skipped');
        return false;
      }
      await terminal.click();
      await page.waitForTimeout(1500);
      return true;
    },
  ],
  [
    'storage-view',
    async (page) => {
      if (!(await pressPlace(page, 'Settings'))) return false;
      const storage = page.getByRole('button', { name: 'Storage', exact: true }).first();
      if ((await storage.count()) === 0) {
        console.warn('no Storage page in this build — skipped');
        return false;
      }
      await storage.click();
      await page.waitForTimeout(1500);
      return true;
    },
  ],
];

async function shootViews(browser, theme) {
  // The empty conversation, with the things it offers to start from.
  const start = await opened(browser, theme);
  await start.mouse.move(0, 0);
  await start.screenshot({ path: join(OUT, `start-${theme}.png`) });
  console.log(`captured start-${theme}.png`);
  await start.close();

  for (const [shot, reach] of VIEWS) {
    // One window each, so nothing a view left open is photographed as part of
    // the next one.
    const page = await opened(browser, theme);
    if (await reach(page)) {
      await page.mouse.move(0, 0);
      await page.screenshot({ path: join(OUT, `${shot}-${theme}.png`) });
      console.log(`captured ${shot}-${theme}.png`);
    }
    await page.close();
  }
}

await ensureServer();
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
try {
  for (const theme of ['light', 'dark']) {
    await shootWindow(browser, theme);
    await shootViews(browser, theme);
    await shootGallery(browser, theme);
  }
  await shootBand(browser);
} finally {
  await browser.close();
  await letGo();
}

console.log('done');
process.exit(0);
