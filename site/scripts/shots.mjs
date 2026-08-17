// The product shots on the landing page, captured from the real interface.
//
//   node site/scripts/shots.mjs
//
// Every picture on the site is the app itself, taken at 2x against the dev
// server, so a shot can never drift from what the app actually looks like.
// Run it again after an interface change and the site is up to date.

import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { chromium } from 'playwright';

const PORT = 5273;
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const VITE = join(ROOT, 'node_modules/vite/bin/vite.js');
const OUT = join(ROOT, 'site/assets/shots');
const HOME = `http://localhost:${PORT}`;

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

let ours = null;

async function ensureServer() {
  if (await serving()) return false;
  const child = spawn(process.execPath, [VITE, '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    stdio: 'ignore',
    detached: true,
  });
  child.unref();
  ours = child.pid;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await serving()) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('the dev server never came up');
}

/** The pieces of the interface the page shows, by the heading they sit under in
 *  the gallery. Each becomes one picture per theme. */
const PIECES = [
  ['see-it-before-you-say-yes', 'See it before you say yes'],
  ['evidence', 'Evidence, not a diff'],
  ['versions', 'Version timeline'],
  ['background-work', 'Background work'],
  ['design', 'Design'],
  ['ready-to-ship', 'Ready to ship'],
  ['cost', 'Cost'],
  ['helpers', 'Who else is working'],
  ['show-me', 'Show me'],
  ['history-lines', 'History, as lines'],
  ['in-step-with-figma', 'In step with Figma'],
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

/** The whole window, mid-sitting: something asked, something made, a version
 *  saved beside it. The one picture the top of the page is built around. */
async function shootWindow(browser, theme) {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: theme,
  });
  await page.goto(HOME, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);

  // The app opens on "Where were we?" — pick a project up, the way anybody
  // starting a sitting does, or there is no window to photograph.
  const project = page.getByText('paper-street', { exact: true }).first();
  if (await project.count()) {
    await project.click();
    await page.waitForTimeout(1200);
  }

  const composer = page.getByRole('textbox', { name: 'What do you want to make?' });
  if ((await composer.count()) === 0) throw new Error('no composer — the project never opened');
  await composer.first().click();
  await composer.first().fill('Rebuild the hero from our Figma frame, using our own tokens');
  await page.keyboard.press('Enter');
  // The mock bridge streams its answer the way the desktop app does.
  await page.waitForTimeout(6000);
  await page.mouse.move(0, 0);
  const file = join(OUT, `window-${theme}.png`);
  await page.screenshot({ path: file });
  console.log(`captured ${file}`);
  await page.close();
}

/** The views somebody opens on purpose. Each is a whole window, because the
 *  point of every one of them is that it is part of the same window. */
const VIEWS = [
  ['design', 'Design'],
  ['history', 'History'],
  ['skills', 'Skills'],
  ['files', 'Project files'],
];

async function shootViews(browser, theme) {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: theme,
  });
  await page.goto(HOME, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const project = page.getByText('paper-street', { exact: true }).first();
  if (await project.count()) {
    await project.click();
    await page.waitForTimeout(1200);
  }

  // The empty conversation, with the things it offers to start from.
  await page.mouse.move(0, 0);
  await page.screenshot({ path: join(OUT, `start-${theme}.png`) });
  console.log(`captured start-${theme}.png`);

  for (const [slug, label] of VIEWS) {
    const open = page.getByRole('button', { name: label, exact: true }).first();
    if ((await open.count()) === 0) {
      console.warn(`no way in to "${label}" — skipped`);
      continue;
    }
    await open.click();
    await page.waitForTimeout(1400);
    await page.mouse.move(0, 0);
    await page.screenshot({ path: join(OUT, `${slug}-view-${theme}.png`) });
    console.log(`captured ${slug}-view-${theme}.png`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }
  await page.close();
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
} finally {
  await browser.close();
  if (ours !== null) {
    try {
      process.kill(ours, 'SIGTERM');
    } catch {
      /* already gone */
    }
  }
}

console.log('done');
process.exit(0);
