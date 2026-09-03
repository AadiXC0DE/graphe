// Screenshots the interface and gets out of the way, in one terminating run.
//
//   node scripts/screenshot.mjs <name> [url]
//
// The whole workflow must finish for real — an agent's shell waits on it and a
// run that never returns hangs until somebody kills the agent. So this starts
// the dev server if nothing is serving yet, waits until it answers, captures
// both themes, then takes down the server it started. If a server was already
// running (the normal way to work on the interface), it is left alone.

import { spawn } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const PORT = 5273;
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const PID_FILE = fileURLToPath(new URL('../dist/.dev-server.pid', import.meta.url));
const VITE = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));

const name = process.argv[2] ?? 'app';
const url = process.argv[3] ?? `http://localhost:${PORT}`;
const outDir = fileURLToPath(new URL('../.screenshots/', import.meta.url));

/** Both loopback addresses, because Vite binds to whichever `localhost`
 *  resolves to on the machine — on macOS that is ::1, and a check that only
 *  tries 127.0.0.1 reports the port free and then fails to bind it. */
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
    socket.setTimeout(500, () => answer(false));
  });
}

async function serving() {
  const answers = await Promise.all(LOOPBACK.map((host) => listening(host, PORT)));
  return answers.includes(true);
}

function startVite() {
  const child = spawn(process.execPath, [VITE, '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    stdio: 'ignore',
    detached: true,
  });
  child.unref();
  // The pid the stop step will look up — without this the server we started
  // would be unreachable once the run is over.
  writeFileSync(PID_FILE, `${child.pid}\n`);
  return child.pid;
}

function stopVite() {
  try {
    const pid = Number(readFileSync(PID_FILE, 'utf8').trim());
    if (Number.isInteger(pid) && pid > 0) process.kill(pid, 'SIGTERM');
  } catch {
    /* no pid file — nothing we started to stop */
  }
  try {
    rmSync(PID_FILE, { force: true });
  } catch {
    /* already gone */
  }
}

/** Wait until the page answers, so the capture is not a blank white window. */
async function waitForServer(attempts = 40) {
  for (let try_ = 0; try_ < attempts; try_ += 1) {
    if (await serving()) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

const started = !(await serving());
if (started) {
  console.log(`starting dev server (pid ${startVite()})`);
  if (!(await waitForServer())) {
    console.error('dev server never came up — check that vite installed and the port is free');
    stopVite();
    process.exit(1);
  }
} else {
  console.log(`using the server already serving http://localhost:${PORT}`);
}

await mkdir(outDir, { recursive: true });

const browser = await chromium.launch();
try {
  for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 820 },
      deviceScaleFactor: 2,
      colorScheme: theme,
    });
    // Said outright rather than left to the media query. The window follows the
    // computer by default, and a capture that has to win a race with that is a
    // capture that is sometimes the other one.
    await page.addInitScript(
      (want) => {
        try {
          localStorage.setItem('graphe:theme', want);
        } catch {
          /* private mode: the media query is the fallback */
        }
      },
      theme,
    );
    await page.goto(url, { waitUntil: 'networkidle' });
    // Let entrance transitions settle so the capture is the resting state.
    await page.waitForTimeout(400);
    const file = join(outDir, `${name}-${theme}.png`);
    // Full page: the gallery is taller than the viewport, and a review that
    // only ever sees the top of a page is not a review.
    await page.screenshot({ path: file, fullPage: true });
    console.log(`captured ${file}`);
    await page.close();
  }
} finally {
  await browser.close();
  // Only take down a server we started. A dev server somebody is running with
  // their own terminal stays up, or the person has to restart it to look again.
  if (started) {
    stopVite();
    console.log('dev server stopped (started only for this run)');
  }
}

console.log('done');
process.exit(0);
