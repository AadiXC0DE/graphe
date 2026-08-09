/** The desktop shell.
 *
 * Two jobs, and it is worth being blunt about why they are in the same file.
 *
 * 1. It owns the window, and everything about that window is a security choice
 *    rather than a preference: context isolation on, Node off, sandbox on,
 *    navigation nailed to our own origin. The renderer will eventually be asked
 *    to display a preview of whatever the agent just built, which is to say
 *    somebody else's HTML. A renderer with Node in it is one `require` away from
 *    the user's home directory.
 *
 * 2. It owns the agent session, because Pi is Node-only and the renderer is not
 *    allowed to know Pi exists (notes/strategy/ARCHITECTURE.md). Everything the
 *    window can ask for is the six verbs in src/lib/ipc.ts, and every answer is
 *    a `Result` — nothing throws across the wire, because an exception crossing
 *    IPC arrives on the other side as "Error invoking remote method", and that
 *    is not a sentence we are willing to show anyone.
 *
 * ## Failing without a model connected
 *
 * The common case for anybody opening this for the first time is that they have
 * not connected an account, so `createSession` throws. That is not an error
 * condition to log; it is the most likely thing that will happen, and it gets a
 * written sentence here rather than a stack trace in the window.
 */

import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  session,
  shell,
  type IpcMainInvokeEvent,
} from 'electron';
import { stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSession, type Decision, type GrapheSession } from '../src/agent/pi/adapter';
import type { AgentEvent } from '../src/agent/types';
import { SpendRecorder } from '../src/cost/recorder';
import { Timeline } from '../src/history/timeline';
import { CHANNEL, type OpenedProject, type Result, type Trouble } from '../src/lib/ipc';
import { knownTrouble, plainMessage, plainTrouble } from './plainly';

/**
 * One missing function in Electron's Node, patched before anything can miss it.
 *
 * Electron 33 ships Node 20.18 without `worker_threads.markAsUncloneable`.
 * undici — which Pi depends on for every network call it makes — reads that
 * function at import time, and gets `undefined`. The result is that
 * `import('@earendil-works/pi-coding-agent')` throws inside Electron and works
 * everywhere else, so the whole agent is unreachable from the desktop app and
 * perfectly fine from the tests. It is worth being precise about how that
 * presents, because it wasted an hour: the adapter catches the failure and says
 * "I could not start the part of me that does the work", which reads exactly
 * like a missing account.
 *
 * The real function marks an object so that structuredClone refuses to copy it.
 * A no-op means such objects can be cloned instead of throwing, which nothing
 * here relies on. Remove this the day Electron ships a Node that has it.
 *
 * It has to run before the first `import()` of Pi. The adapter's import is
 * dynamic and does not happen until somebody opens a project, so module scope
 * here is early enough with room to spare.
 */
function patchWorkerThreads(): void {
  const workers = createRequire(import.meta.url)('node:worker_threads') as {
    markAsUncloneable?: (value: object) => void;
  };
  if (typeof workers.markAsUncloneable !== 'function') {
    workers.markAsUncloneable = () => {};
  }
}
patchWorkerThreads();

const here = fileURLToPath(new URL('.', import.meta.url));
/** Vite in development, the built files in a shipped app. */
const DEV_SERVER = process.env['GRAPHE_DEV_SERVER_URL'] ?? 'http://localhost:5273';
/** A packaged app always loads its own built files. Unpackaged, it loads the dev
 *  server — unless you ask for the build, which is the only way to see the
 *  shipped window (and its content policy) without packaging first:
 *  `npm run build && GRAPHE_LOAD=build npx electron .` */
const isDev = !app.isPackaged && process.env['GRAPHE_LOAD'] !== 'build';

/* -------------------------------------------------------------------------- */
/* What people are told when something does not work                          */
/* -------------------------------------------------------------------------- */

/** The raw text, whole chain of it.
 *
 *  The interesting failure is almost never the one at the top: the adapter wraps
 *  what went wrong in a sentence a person can read, and the sentence a developer
 *  needs is underneath it. Unwrapping `cause` here is the difference between
 *  "Show technical details" being useful and being decoration. */
function detailsOf(cause: unknown, depth = 0): string | undefined {
  if (typeof cause === 'string' && cause !== '') return cause;
  if (!(cause instanceof Error)) return undefined;

  const own = cause.stack ?? `${cause.name}: ${cause.message}`;
  if (depth >= 4) return own;
  const beneath = detailsOf(cause.cause, depth + 1);
  return beneath === undefined ? own : `${own}\n\nCaused by:\n${beneath}`;
}

function fail<T>(trouble: Trouble): Result<T> {
  return { ok: false, trouble };
}

function done<T>(value: T): Result<T> {
  return { ok: true, value };
}

/** By far the most likely failure in this file, and the one most often shown as
 *  a stack trace by everything else on the market. */
function noAccountConnected(cause: unknown): Trouble {
  return {
    what: 'I am not ready to work yet.',
    because:
      'It looks like no account has been connected on this computer, so there is nothing for me to think with. Connect one and open the folder again.',
    actionLabel: 'Got it',
    details: detailsOf(cause),
  };
}

function noSafetyNet(cause: unknown): Trouble {
  return {
    what: 'I could not set up a way to undo things in that folder.',
    because:
      'I save a restore point before every risky change, and I could not start doing that here. I will not work in a folder I cannot put back.',
    actionLabel: 'Got it',
    details: detailsOf(cause),
  };
}

const NOT_A_FOLDER: Trouble = {
  what: 'I could not open that.',
  because: 'It is not a folder I can find on this computer any more.',
  actionLabel: 'Got it',
};

const NOTHING_OPEN: Trouble = {
  what: 'I do not have a folder to work in yet.',
  because: 'Pick the folder your project lives in and I will start there.',
  actionLabel: 'Got it',
};

const PICKER_FAILED: Trouble = {
  what: 'I could not open the folder picker.',
  because: 'Something on this computer would not let the window open.',
  actionLabel: 'Got it',
};

/* -------------------------------------------------------------------------- */
/* The window                                                                  */
/* -------------------------------------------------------------------------- */

let mainWindow: BrowserWindow | null = null;

/**
 * What has been spent, kept here rather than in the window.
 *
 * This process is the one that sees every spend, so it is the one that keeps
 * the book. The window is told each entry as it happens — that is what the
 * meter in the corner counts — and the split between real work and our own
 * retries once a sitting settles. Nothing is kept between projects: opening a
 * different folder starts a fresh sitting, and so a fresh ledger.
 */
let spend = new SpendRecorder();

function send(event: AgentEvent): void {
  if (mainWindow === null || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(CHANNEL.event, event);
}

function forward(event: AgentEvent): void {
  // Failures are the one kind of event that can arrive in somebody else's
  // words — see the note at the top of plainly.ts. Everything else in the
  // stream was written by us or by the Guard and goes through untouched.
  const said: AgentEvent =
    event.type === 'error' ? { type: 'error', message: plainMessage(event.message) } : event;
  send(said);
  // Recorded whether or not there is a window to tell: a reload must not lose
  // money that was already spent.
  for (const also of spend.observe(said)) send(also);
}

/** Ours, or somebody else's? Everything not served by our own dev server or
 *  loaded off our own disk is somebody else's, including a link the agent wrote
 *  into a page. Those open in the user's real browser, where they belong. */
function isOurs(target: string): boolean {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return false;
  }
  if (isDev && url.origin === new URL(DEV_SERVER).origin) return true;
  if (url.protocol !== 'file:') return false;
  return fileURLToPath(url).startsWith(resolve(here, '..', 'dist') + sep);
}

function guardNavigation(contents: Electron.WebContents): void {
  contents.on('will-navigate', (event, target) => {
    if (!isOurs(target)) event.preventDefault();
  });
  contents.setWindowOpenHandler(({ url }) => {
    // Never a second Electron window. A link is a link: hand it to the browser
    // the person already trusts, and only if it is the kind of link a browser
    // understands.
    if (url.startsWith('https://') || url.startsWith('http://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });
}

/**
 * What the window is allowed to load, enforced by the browser engine rather than
 * by us remembering.
 *
 * Only in a shipped app. Vite's dev server needs inline scripts and eval for
 * hot reloading, and a policy loose enough for that is not a policy — better an
 * honest absence in development and a real one in the build people actually run.
 * `connect-src 'self'` is the load-bearing line: the agent's own network calls
 * happen in this process, over Node, and nothing the renderer displays has any
 * business reaching the internet.
 */
function applyContentPolicy(): void {
  if (isDev) return;
  session.defaultSession.webRequest.onHeadersReceived((details, respond) => {
    respond({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          [
            "default-src 'self'",
            "script-src 'self'",
            // Vite inlines the stylesheet as a <style> tag in the built page.
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: blob:",
            "font-src 'self' data:",
            "connect-src 'self'",
            "object-src 'none'",
            "frame-src 'none'",
            "base-uri 'none'",
            "form-action 'none'",
          ].join('; '),
        ],
      },
    });
  });
}

/** The dev server may not be listening yet — `npm run app` starts Vite and
 *  Electron at the same time. Retrying quietly for a few seconds is nicer than
 *  either a race or a blank window. */
async function load(win: BrowserWindow): Promise<void> {
  if (!isDev) {
    await win.loadFile(resolve(here, '..', 'dist', 'index.html'));
    return;
  }
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      await win.loadURL(DEV_SERVER);
      return;
    } catch {
      await new Promise((wake) => setTimeout(wake, 250));
    }
  }
  await win.loadURL(DEV_SERVER);
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1100,
    height: 780,
    minWidth: 620,
    minHeight: 520,
    // The window is painted before React is, and a white flash on a dark desktop
    // is the first impression. Matches --bg in src/styles/tokens.css.
    backgroundColor: '#131312',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: process.platform === 'darwin' ? { x: 18, y: 20 } : undefined,
    show: false,
    webPreferences: {
      preload: resolve(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      spellcheck: false,
    },
  });

  mainWindow = win;
  guardNavigation(win.webContents);
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
    closeSession();
  });

  void load(win);
}

/* -------------------------------------------------------------------------- */
/* The session                                                                 */
/* -------------------------------------------------------------------------- */

let agent: GrapheSession | null = null;
let project: OpenedProject | null = null;

function closeSession(): void {
  agent?.dispose();
  agent = null;
  project = null;
  spend = new SpendRecorder();
}

async function openProject(folder: string): Promise<Result<OpenedProject>> {
  const path = resolve(folder);

  const found = await stat(path).catch(() => null);
  if (found === null || !found.isDirectory()) return fail(NOT_A_FOLDER);

  closeSession();

  let timeline: Timeline;
  try {
    timeline = await Timeline.open(path);
  } catch (cause) {
    return fail(noSafetyNet(cause));
  }

  try {
    agent = await createSession({ projectRoot: path, onEvent: forward, timeline });
  } catch (cause) {
    // The adapter wraps whatever went wrong in a sentence of its own, so the
    // reason worth reading is down the `cause` chain rather than on top of it.
    // Search the whole chain before falling back to the likeliest explanation.
    const chain = detailsOf(cause);
    return fail(knownTrouble(chain ?? '', chain) ?? noAccountConnected(cause));
  }

  project = { path, name: basename(path) === '' ? path : basename(path) };
  return done(project);
}

/* -------------------------------------------------------------------------- */
/* The six verbs                                                               */
/* -------------------------------------------------------------------------- */

/** Only the window we made. A handler that answers anyone is a handler that
 *  answers an iframe. */
function fromOurWindow(event: IpcMainInvokeEvent): boolean {
  return mainWindow !== null && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents;
}

const IGNORED: Trouble = {
  what: 'I ignored that.',
  because: 'It did not come from this window.',
  actionLabel: 'Got it',
};

function handle<T>(channel: string, run: (event: IpcMainInvokeEvent, args: unknown[]) => Promise<Result<T>>): void {
  ipcMain.handle(channel, async (event, ...args: unknown[]): Promise<Result<T>> => {
    if (!fromOurWindow(event)) return fail<T>(IGNORED);
    try {
      return await run(event, args);
    } catch (cause) {
      // Nothing below is expected to throw. If one does, the window still gets a
      // sentence rather than a rejected promise it has no way to describe.
      return fail<T>({
        what: 'Something went wrong on my side.',
        because: 'I have stopped where I was. Nothing else has been changed.',
        actionLabel: 'Got it',
        details: detailsOf(cause),
      });
    }
  });
}

function register(): void {
  handle<OpenedProject>(CHANNEL.openProject, async (_event, args) => {
    const [path] = args;
    if (typeof path !== 'string' || path.trim() === '') return fail(NOT_A_FOLDER);
    return openProject(path);
  });

  handle<null>(CHANNEL.prompt, async (_event, args) => {
    const [text] = args;
    if (typeof text !== 'string' || text.trim() === '') return done(null);
    if (agent === null) return fail(NOTHING_OPEN);
    try {
      await agent.prompt(text);
      return done(null);
    } catch (cause) {
      // The adapter has already relayed this as an `error` event, worded by the
      // same translation, so the window sees the same sentence twice and shows
      // one card — see the note on duplicate troubles in src/App.tsx. This one
      // is the copy carrying the raw text, and the window keeps the richer of
      // the two.
      const raw = cause instanceof Error ? cause.message : String(cause);
      return fail(plainTrouble(raw, detailsOf(cause)));
    }
  });

  handle<null>(CHANNEL.stop, async () => {
    await agent?.stop();
    return done(null);
  });

  handle<boolean>(CHANNEL.answer, async (_event, args) => {
    const [callId, decision] = args;
    if (typeof callId !== 'string' || (decision !== 'yes' && decision !== 'no')) return done(false);
    return done(agent?.answer(callId, decision as Decision) ?? false);
  });

  handle<string | null>(CHANNEL.chooseFolder, async () => {
    if (mainWindow === null || mainWindow.isDestroyed()) return fail(PICKER_FAILED);
    const picked = await dialog.showOpenDialog(mainWindow, {
      title: 'Which folder should I work in?',
      buttonLabel: 'Work here',
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: project?.path ?? app.getPath('home'),
    });
    if (picked.canceled) return done(null);
    return done(picked.filePaths[0] ?? null);
  });
}

/* -------------------------------------------------------------------------- */
/* Start                                                                       */
/* -------------------------------------------------------------------------- */

// One copy of the app, so two windows cannot hold sessions on the same folder.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow === null || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  // Belt and braces: the rules in guardNavigation are applied to every web
  // contents that ever exists, not only the one we remembered to wire up.
  app.on('web-contents-created', (_event, contents) => guardNavigation(contents));

  void app.whenReady().then(() => {
    applyContentPolicy();
    register();
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    closeSession();
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => closeSession());
}
