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
import { basename, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSession, type Decision, type GrapheSession } from '../src/agent/pi/adapter';
import type { AgentEvent } from '../src/agent/types';
import { SpendRecorder } from '../src/cost/recorder';
import { Timeline, type Version } from '../src/history/timeline';
import {
  CHANNEL,
  type OpenedProject,
  type PutBack,
  type RecentProject,
  type Result,
  type SavedVersion,
  type ShowOutcome,
  type ShowProgress,
  type Trouble,
} from '../src/lib/ipc';
import { Recents } from '../src/projects/recents';
import { Workspaces } from '../src/projects/workspaces';
import type { Serving } from '../src/preview/serve';
import { makeAndServe, ShowError, showSays } from '../src/preview/show';
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

/** The one the picker hits: a project that was here last time and is not here
 *  now. It is worth its own sentence, because "I could not open that" reads as
 *  our failure and this one is a fact about their computer — and because the
 *  useful thing to offer is taking it off the list, not trying again. */
function movedOrGone(name: string): Trouble {
  return {
    what: `I cannot find ${name} any more.`,
    because:
      'The folder has been moved, renamed or thrown away since you last opened it. Nothing of yours has been touched — I just do not know where to look.',
    actionLabel: 'Take it off the list',
  };
}

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

const NOTHING_TO_SHOW: Trouble = {
  what: 'There is nothing to look at yet.',
  because: 'Open the folder your project lives in and I will get it ready for you.',
  actionLabel: 'Got it',
};

const NO_SUCH_VERSION: Trouble = {
  what: 'I could not find that version of your project.',
  because: 'It is not one of the versions I have saved for this folder.',
  actionLabel: 'Got it',
};

/**
 * Something the timeline could not do, in its own words.
 *
 * `HistoryError` messages are already written for a person — that module exists
 * so git is never spoken aloud — so the sentence comes straight through and only
 * the raw output is tucked away. Anything else is a failure we did not plan for,
 * and it gets the generic card rather than whatever text happened to be on it.
 */
function historyTrouble(cause: unknown): Trouble {
  const details = detailsOf(cause);
  if (cause instanceof Error && cause.name === 'HistoryError') {
    const raw = (cause as Error & { details?: string }).details ?? details ?? '';
    return {
      what: cause.message,
      because: 'Nothing in your project has been changed.',
      actionLabel: 'Got it',
      ...(raw.trim() === '' ? {} : { details: raw }),
    };
  }
  return {
    what: 'I could not do that to your project’s versions.',
    because: 'I have stopped where I was. Nothing has been changed.',
    actionLabel: 'Got it',
    ...(details === undefined ? {} : { details }),
  };
}

/** A failure while getting a project ready. The reason goes through the shell's
 *  own translation first — a project that could not fetch what it needs usually
 *  failed for a reason we already have words for — and falls back to the
 *  sentence the preview module wrote. The raw output never leaves `details`. */
function couldNotShow(cause: unknown): Trouble {
  const said = cause instanceof ShowError ? cause.message : showSays.didNotFinish;
  const raw = cause instanceof ShowError ? cause.details : detailsOf(cause) ?? '';
  return (
    knownTrouble(raw, raw) ?? {
      what: said,
      because:
        'Something in your project stopped part way through, so there is nothing finished to look at yet. Tell me what you were expecting and I will take a look.',
      actionLabel: 'Got it',
      ...(raw.trim() === '' ? {} : { details: raw }),
    }
  );
}

/* -------------------------------------------------------------------------- */
/* The window                                                                  */
/* -------------------------------------------------------------------------- */

let mainWindow: BrowserWindow | null = null;

/** Every event carries the folder it belongs to. A reply that was still
 *  arriving when somebody switched projects belongs to the project it started
 *  in, and this is what lets the window put it there — see `AgentNotice`. */
function send(project: string | null, event: AgentEvent): void {
  if (mainWindow === null || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(CHANNEL.event, { project, event });
}

function tell(progress: ShowProgress): void {
  if (mainWindow === null || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(CHANNEL.showProgress, progress);
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

/**
 * Everything the shell holds for one project.
 *
 * All of it per project, none of it shared. The ledger especially: this process
 * is the one that sees every spend, so it keeps the book — and a book kept per
 * window rather than per folder would have quietly billed one project for
 * another's afternoon the first time somebody switched.
 */
type Held = {
  timeline: Timeline;
  spend: SpendRecorder;
  /** Null only for the moment between the timeline opening and the session
   *  starting, which is the window in which the session can fail. */
  session: GrapheSession | null;
  /** The finished site being looked at, if "See it" has been pressed here. */
  serving: Serving | null;
};

const workspaces = new Workspaces<Held>({
  close: (held) => {
    held.session?.dispose();
    void held.serving?.stop();
  },
});

/**
 * The list of projects this computer remembers.
 *
 * Opened on demand rather than at module scope because `app.getPath` is not
 * answerable before the app is ready, and this file is imported long before it
 * is. One promise, so two calls in the same tick cannot make two readers of the
 * same file.
 */
let recentsPromise: Promise<Recents> | null = null;

function recents(): Promise<Recents> {
  recentsPromise ??= Recents.open(join(app.getPath('userData'), 'projects.json'));
  return recentsPromise;
}

/** The remembered list, with "is that folder still there?" answered now rather
 *  than stored. A folder can go away while the app is not looking, and a picker
 *  that only finds out when you click it is a picker that greets you with a
 *  failure. */
async function rememberedProjects(): Promise<readonly RecentProject[]> {
  const list = (await recents()).list();
  return Promise.all(
    list.map(async (one) => {
      const found = await stat(one.path).catch(() => null);
      return { ...one, missing: found === null || !found.isDirectory() };
    }),
  );
}

/** What the window is told about a version. */
function asSaved(version: Version, currentId: string | null): SavedVersion {
  return {
    id: version.id,
    at: version.at,
    title: version.title,
    by: version.by,
    named: version.named,
    current: version.id === currentId,
  };
}

/** The whole timeline of the project in front, newest first. No project open is
 *  an empty list rather than a failure: the rail simply has nothing to draw, and
 *  a card saying so would be a card about us. */
async function versionsOf(held: Held): Promise<readonly SavedVersion[]> {
  const [versions, current] = await Promise.all([held.timeline.versions(), held.timeline.currentVersion()]);
  return versions.map((version) => asSaved(version, current?.id ?? null));
}

function forwardTo(path: string, held: Held): (event: AgentEvent) => void {
  return (event) => {
    // Failures are the one kind of event that can arrive in somebody else's
    // words — see the note at the top of plainly.ts. Everything else in the
    // stream was written by us or by the Guard and goes through untouched.
    const said: AgentEvent =
      event.type === 'error' ? { type: 'error', message: plainMessage(event.message) } : event;
    send(path, said);
    // Recorded whether or not there is a window to tell: a reload must not lose
    // money that was already spent.
    for (const also of held.spend.observe(said)) {
      send(path, also);
      // What a sitting came to is worth keeping beside the project's name, so
      // opening it again is not the first time anybody finds out.
      if (also.type === 'spend-summary') {
        void recents().then((list) => list.recordSpend(path, also.summary.total));
      }
    }
  };
}

async function openProject(folder: string): Promise<Result<OpenedProject>> {
  const path = resolve(folder);
  const name = basename(path) === '' ? path : basename(path);

  const found = await stat(path).catch(() => null);
  if (found === null || !found.isDirectory()) {
    // Only a project we already knew about gets the "take it off the list"
    // wording — for anything else, being handed a path that is not a folder is
    // an ordinary mistake and not a list to be tidied.
    const known = (await recents()).list().some((one) => one.path === path);
    return fail(known ? movedOrGone(name) : NOT_A_FOLDER);
  }

  // Already open: come straight back to it. The session, the ledger and the
  // history are all exactly where they were left, which is the whole of B2.
  if (workspaces.resume(path) !== null) {
    await (await recents()).remember({ path, name });
    return done({ path, name });
  }

  let timeline: Timeline;
  try {
    timeline = await Timeline.open(path);
  } catch (cause) {
    return fail(noSafetyNet(cause));
  }

  const held: Held = { timeline, spend: new SpendRecorder(), session: null, serving: null };

  try {
    held.session = await createSession({
      projectRoot: path,
      onEvent: forwardTo(path, held),
      timeline,
    });
  } catch (cause) {
    // The adapter wraps whatever went wrong in a sentence of its own, so the
    // reason worth reading is down the `cause` chain rather than on top of it.
    // Search the whole chain before falling back to the likeliest explanation.
    const chain = detailsOf(cause);
    return fail(knownTrouble(chain ?? '', chain) ?? noAccountConnected(cause));
  }

  workspaces.adopt({ path, name, held });
  await (await recents()).remember({ path, name });
  return done({ path, name });
}

function closeSession(): void {
  workspaces.closeAll();
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

  handle<readonly RecentProject[]>(CHANNEL.recentProjects, async () =>
    done(await rememberedProjects()),
  );

  handle<readonly RecentProject[]>(CHANNEL.forgetProject, async (_event, args) => {
    const [path] = args;
    if (typeof path === 'string' && path.trim() !== '') {
      // The list, and only the list. Nothing on disk is touched, ever.
      await (await recents()).forget(path);
      workspaces.close(resolve(path));
    }
    return done(await rememberedProjects());
  });

  handle<readonly SavedVersion[]>(CHANNEL.versions, async () => {
    const open = workspaces.current;
    if (open === null) return done([]);
    try {
      return done(await versionsOf(open.held));
    } catch (cause) {
      return fail(historyTrouble(cause));
    }
  });

  handle<PutBack>(CHANNEL.putBack, async (_event, args) => {
    const [versionId] = args;
    const open = workspaces.current;
    if (open === null) return fail(NOTHING_OPEN);
    if (typeof versionId !== 'string' || versionId.trim() === '') return fail(NO_SUCH_VERSION);
    try {
      const restored = await open.held.timeline.restoreTo(versionId);
      return done({
        title: restored.wentBackTo.title,
        at: restored.wentBackTo.at,
        undoTo: restored.undoTo,
        versions: await versionsOf(open.held),
      });
    } catch (cause) {
      return fail(historyTrouble(cause));
    }
  });

  handle<readonly SavedVersion[]>(CHANNEL.nameVersion, async (_event, args) => {
    const [versionId, name] = args;
    const open = workspaces.current;
    if (open === null) return fail(NOTHING_OPEN);
    if (typeof versionId !== 'string' || typeof name !== 'string') return fail(NO_SUCH_VERSION);
    try {
      await open.held.timeline.nameVersion(versionId, name);
      return done(await versionsOf(open.held));
    } catch (cause) {
      return fail(historyTrouble(cause));
    }
  });

  handle<ShowOutcome>(CHANNEL.show, async () => {
    const open = workspaces.current;
    if (open === null) return fail(NOTHING_TO_SHOW);

    // One at a time per project. Pressing it again means "show me what it looks
    // like now", so the old one goes and a new one takes its place.
    await open.held.serving?.stop();
    open.held.serving = null;

    try {
      const outcome = await makeAndServe({ folder: open.path, says: tell });
      if (outcome.kind === 'unsure') return done({ kind: 'unsure', question: outcome.question });
      open.held.serving = outcome.serving;
      // Their own browser, not a window of ours. It is the one they already
      // trust, it is where their client will open the link we send later, and
      // the alternative is us drawing somebody else's HTML inside the same app
      // that holds their folder open.
      await shell.openExternal(outcome.serving.address);
      return done({ kind: 'showing', name: open.name });
    } catch (cause) {
      return fail(couldNotShow(cause));
    }
  });

  handle<null>(CHANNEL.prompt, async (_event, args) => {
    const [text] = args;
    if (typeof text !== 'string' || text.trim() === '') return done(null);
    const agent = workspaces.current?.held.session ?? null;
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
    await workspaces.current?.held.session?.stop();
    return done(null);
  });

  handle<boolean>(CHANNEL.answer, async (_event, args) => {
    const [callId, decision] = args;
    if (typeof callId !== 'string' || (decision !== 'yes' && decision !== 'no')) return done(false);
    const agent = workspaces.current?.held.session ?? null;
    return done(agent?.answer(callId, decision as Decision) ?? false);
  });

  handle<string | null>(CHANNEL.chooseFolder, async () => {
    if (mainWindow === null || mainWindow.isDestroyed()) return fail(PICKER_FAILED);
    const picked = await dialog.showOpenDialog(mainWindow, {
      title: 'Which folder should I work in?',
      buttonLabel: 'Work here',
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: workspaces.current?.path ?? app.getPath('home'),
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
