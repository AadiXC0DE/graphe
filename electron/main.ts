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
  Notification,
  session,
  shell,
  WebContentsView,
  type IpcMainInvokeEvent,
} from 'electron';
import { execFile, spawn, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';
import * as path from 'node:path';
import { dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { patchWorkerThreads } from '../src/agent/pi/node-shim';
import {
  connectToProvider,
  connection as readConnection,
  createSession,
  defaultAgentDir,
  disconnectProvider,
  discoveredAccounts,
  importAccount,
  type Decision,
  type FoundAccount,
  type GrapheSession,
  listConversations,
  packageHost,
  type Conversation,
  type OurAuthInteraction,
} from '../src/agent/pi/adapter';
import type { AgentEvent, ImageCard, Money } from '../src/agent/types';
import { fleet, readCeiling } from '../src/cost/fleet';
import { getReady } from '../src/history/newcopy';
import { watchWhileUsed, type Watching } from '../src/diff/capture';
import { createLimit } from '../src/cost/limits';
import { limitReached } from '../src/cost/phrasing';
import { SpendRecorder } from '../src/cost/recorder';
import { Timeline, type Version } from '../src/history/timeline';
import { ProjectHistory, type LastChange } from '../src/history/repo';
import {
  cannotOpen,
  everythingIn,
  looksBinary,
  markChanged,
  tooBig,
  type Found,
} from '../src/files/listing';
import { containsPath, isCredentialPath } from '../src/agent/guard/paths';
import {
  CHANNEL,
  type Away,
  type AwayAfter,
  type AwayPiece,
  type EveryKind,
  type Repeating,
  type ConnectOutcome,
  type ConnectStep,
  type ConnectionState,
  type Decided,
  type FileEntry,
  type GitSnapshot,
  type HandedOver,
  type Hatches,
  type InStep,
  type Landing,
  type OpenedProject,
  type WentOnline,
  type Overview,
  type PointedAt,
  type Preferences,
  type PromptOptions,
  type PutBack,
  type RecentProject,
  type Result,
  type RepoItem,
  type RepoLook,
  type CarriedExtension,
  type Room,
  type Skill,
  type Workflow,
  type SavedVersion,
  type DesignChange,
  type ShowOutcome,
  type VariationSpec,
  type VariationsOutcome,
  type HowFar,
  type Recording,
  type ShowProgress,
  type SpendLimit,
  type SpendSummary,
  type ThinkingLevel,
  modelKey,
  type Trouble,
  type VisualChange,
  type VisualFrames,
  type Where,
  setDownWords,
  whereIn,
} from '../src/lib/ipc';
import { parseGitStatus } from '../src/lib/gitstatus';
import {
  capture,
  forget,
  forgetEverything,
  readPicture,
  readShot,
  whatMoved,
} from '../src/diff/capture';
import { filesWrittenBy } from '../src/diff/changed';
import { KEEP, landed, whatCouldBeSeen, type Shot } from '../src/diff/pairing';
import type { Bitmap } from '../src/diff/regions';
import { tellWhatHappened } from '../src/diff/summary';
import { inDesignWords, readChanges, NOTHING_TO_SAY, type Edit } from '../src/design/words';
import { isTrusted, trusting } from '../src/projects/carried';
import { keeping, PreferenceFile } from '../src/projects/preferences';
import { Recents } from '../src/projects/recents';
import { addressed, Workspaces, type Workspace } from '../src/projects/workspaces';
import { findEditor, type Editor } from '../src/shell/editors';
import { pagesIn, type Page } from '../src/preview/pages';
import { WARNING, askAbout, packageShelf, type Pack } from '../src/agent/pi/packages';
import { availableSkills, selectedSkills, skillContents, skillNamed } from '../src/agent/pi/skills';
import { availableWorkflows, workflowNamed } from '../src/agent/pi/workflows';
import { promptFor } from '../src/work/workflows';
import {
  bringBack,
  createWorktree,
  dropWorktree,
  landWorktree,
  type RunGit,
} from '../src/history/worktree';
import {
  addTasks,
  finishTask,
  readPlan,
  startTask,
  type Task,
} from '../src/work/buildplan';
import { openingFor, type Opening } from '../src/agent/pi/conversations';
import { artifactsAmong, paletteFrom } from '../src/design/artifacts';
import { readTokens, steps, writeToken } from '../src/design/tokens';
import { writeMotionAll } from '../src/motion/read';
import { createReader, parseFigmaUrl } from '../src/design/figma';
import { follow, throughFigma, type ReadDesign } from '../src/design/follow';
import { findMoved, saysInStep, NOTHING_FOLLOWED, type Held as HeldDesign } from '../src/design/moved';
import { FollowedFile } from '../src/projects/followed';
import { lookAtEveryWidth } from '../src/diff/capture';
import { readsWell, sizesFor, type Look } from '../src/design/widths';
import { reviewPage, safeToShare, type Review, type Shown } from '../src/share/review';
import { HeldWork, holdWords, Workbench, type PieceOfWork } from '../src/history/attempts';
import { AT_A_TIME } from '../src/work/board';
import { awayWords, saysNotice, saysWhileAway, Unattended } from '../src/work/unattended';
import {
  addStanding,
  dueNow,
  ranStanding,
  saysStanding,
  standingFor,
  switchStanding,
  withoutProject,
  withoutStanding,
  type Standing,
} from '../src/work/standing';
import type { Repeat, TimeOfDay, Weekday } from '../src/work/schedule';
import { keyFor, Notebook } from '../src/work/notebook';
import { afterWords, Following } from '../src/work/after';
import { endStrays } from '../src/work/strays';
import {
  addSpend,
  asPiece,
  noteOf,
  onComingBack,
  writtenWords,
  type Owner,
  type Written,
} from '../src/work/written';
import { StandingFile } from '../src/projects/standing';
import { HandoverError, handToDeveloper, whatIsHere, type Change } from '../src/share/developer';
import { handoverWords } from '../src/share/handover';
import { OnlineError, putOnline, whatIsHereForOnline } from '../src/share/publish';
import { onlineWords } from '../src/share/online';
import { canPutOnline, canSendItOn } from '../src/share/tools';

import type { Serving } from '../src/preview/serve';
import { makeAndServe, ShowError, showSays } from '../src/preview/show';
import { POINTER_SCRIPT, type Pointed } from '../src/preview/point';
import {
  read as readPointed,
  saysReading,
  type Material,
  type Change as Touched,
} from '../src/preview/inspect';
import { readUsage } from '../src/design/usage';
import { photographHeld, type Held as HeldPictures } from '../src/diff/holdshot';
import { holdCamera } from '../src/diff/holdcamera';
import { knownTrouble, plainMessage, plainTrouble } from './plainly';

/**
 * One missing function in Electron's Node, patched before anything can miss it
 * (and, in the helper processes the `task` tool spawns, patched there too).
 *
 * Electron 33 ships Node 20.18 without `worker_threads.markAsUncloneable`.
 * undici — which Pi depends on for every network call it makes — reads that
 * function at import time, and gets `undefined`. The result is that
 * `import('@earendil-works/pi-coding-agent')` throws inside Electron and works
 * everywhere else, so the whole agent is unreachable from the desktop app and
 * perfectly fine from the tests. The patch lives in src/agent/pi/node-shim.ts
 * with the full story; here it just has to run first. Remove the moment
 * Electron ships a Node that has it.
 */
patchWorkerThreads();

/**
 * The PATH a Finder-launched app inherits is `/usr/bin:/bin:/usr/sbin:/sbin`,
 * which does not contain a Homebrew, nvm or mise node. Adding packages spawns
 * `npm`, so without this it fails with a spawn error on most developers'
 * machines and on nobody's terminal. Asked of the login shell once, at startup.
 */
function widenPath(): void {
  if (process.platform === 'win32') return;
  try {
    const shell = process.env['SHELL'] ?? '/bin/zsh';
    const asked = spawnSync(shell, ['-lic', 'printf %s "$PATH"'], {
      encoding: 'utf8',
      timeout: 4000,
    });
    const found = asked.stdout?.trim() ?? '';
    if (found === '' || !found.includes('/')) return;
    const already = new Set((process.env['PATH'] ?? '').split(':'));
    const added = found.split(':').filter((one) => one !== '' && !already.has(one));
    if (added.length > 0) process.env['PATH'] = [...already, ...added].join(':');
  } catch {
    // The narrow PATH still works for everything except adding packages, and
    // that failure already says something a person can act on.
  }
}

widenPath();

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

/** A window-typed `FoundAccount` checked at the door: only a handful of
 *  fields, each of them a short string from a closed set. The one field a
 *  person could mistype is `providerId`, and a wrong one simply finds no
 *  credential to carry. */
function isFoundAccount(value: unknown): value is FoundAccount {
  if (typeof value !== 'object' || value === null) return false;
  const one = value as Record<string, unknown>;
  return (
    typeof one.providerId === 'string' &&
    one.providerId !== '' &&
    typeof one.name === 'string' &&
    one.name.length <= 40 &&
    (one.kind === 'api-key' || one.kind === 'sign-in') &&
    (one.source === 'opencode' || one.source === 'codex')
  );
}

/** By far the most likely failure in this file, and the one most often shown as
 *  a stack trace by everything else on the market. The marker is what turns
 *  this from a card into the connect screen: a first-time user's job is not to
 *  read about the missing account, it is to connect one. */
function noAccountConnected(cause: unknown): Trouble {
  return {
    what: 'I am not ready to work yet.',
    because:
      'It looks like no account has been connected on this computer, so there is nothing for me to think with. Connect one and open the folder again.',
    actionLabel: 'Got it',
    details: detailsOf(cause),
    marker: 'connect',
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

const COULD_NOT_TIDY: Trouble = {
  what: 'I could not tidy this conversation just now.',
  because: 'There is not enough settled conversation to shorten yet, or it is already being tidied.',
  actionLabel: 'Got it',
};

/** A wait that could never come round. The sentence is src/work/after.ts's; all
 *  this does is put it where the window already knows to draw one. */
function couldNotWait(because: string): Trouble {
  return { what: 'I did not set that up.', because, actionLabel: 'Got it' };
}

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

/** The before-and-after has been cleared away — a long conversation keeps only
 *  the last dozen pictures. Nothing has gone wrong and nothing of theirs is
 *  missing, so it says what it is rather than apologising. */
const NO_SUCH_PICTURE: Trouble = {
  what: 'I do not have those pictures any more.',
  because: 'I keep the last few before-and-afters and let the older ones go.',
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

/** Every event carries the folder and the conversation it belongs to. A reply
 *  that was still arriving when somebody switched belongs where it started, and
 *  this is what lets the window put it there — see `AgentNotice`. */
function send(project: string | null, event: AgentEvent, conversation?: string): void {
  if (mainWindow === null || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(CHANNEL.event, { project, conversation: conversation ?? null, event });
}

function tell(progress: ShowProgress): void {
  if (mainWindow === null || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(CHANNEL.showProgress, progress);
}

function showChange(project: string, change: VisualChange): void {
  if (mainWindow === null || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(CHANNEL.visualChange, { project, change });
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

/**
 * What the window is allowed to ask this computer for.
 *
 * Only the microphone, and only because saying a change out loud is easier than
 * writing one. Everything else — camera, location, notifications from the page,
 * anything added to the web platform after this was written — is refused
 * without being asked about, which is the reason the list in
 * electron-builder.yml was pinned in the first place: nothing acquires
 * something quietly by turning up as a dependency.
 */
function applyPermissionPolicy(): void {
  session.defaultSession.setPermissionRequestHandler((_contents, permission, decide) => {
    decide(permission === 'media');
  });
  // Asked for by anything that checks before requesting, and answered the same
  // way — two answers that disagree is how a control ends up dead on press.
  session.defaultSession.setPermissionCheckHandler(
    (_contents, permission) => permission === 'media',
  );
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

/* -------------------------------------------------------------------------- */
/* The project's own page, held inside the window                              */
/* -------------------------------------------------------------------------- */

/**
 * The page beside the conversation.
 *
 * A native view rather than a `<webview>`: that tag is off in this app on
 * purpose and stays off. It paints *above* the window's own contents, so
 * anything that would sit over it — a sheet, a menu, a modal — has to hide it
 * first, and the window says when.
 *
 * Its own store, so a site the person visits here can never see, set or reuse
 * anything belonging to the app itself.
 */
let pageView: WebContentsView | null = null;
let pageWatching: Watching | null = null;
/** Which project the page belongs to, so a click in it is read against the
 *  right folder. */
let pageProject: string | null = null;

function pageStore(): Electron.Session {
  return session.fromPartition('persist:graphe-page');
}

/** Run once per document, however the page got here. A page we served already
 *  carries the script, and a second copy would put a second button on it. */
const POINTER_ONCE = `if (!window.__graphePointer) { ${POINTER_SCRIPT} }`;

function makePageView(): WebContentsView | null {
  if (mainWindow === null || mainWindow.isDestroyed()) return null;
  if (pageView !== null) return pageView;
  const view = new WebContentsView({
    webPreferences: {
      session: pageStore(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      // Carries a click back out. It exposes nothing: the page can say what was
      // clicked and cannot ask for anything.
      preload: resolve(here, 'pagepreload.cjs'),
    },
  });
  // Nothing the page does opens a second window, and nothing it links to takes
  // the app somewhere. It is somebody's own site, not a browser.
  view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // Every document, because the page is somebody's own site and they navigate
  // around it. Inert until the button it puts on the page is pressed.
  view.webContents.on('dom-ready', () => {
    void view.webContents.executeJavaScript(POINTER_ONCE, true).catch(() => undefined);
  });
  mainWindow.contentView.addChildView(view);
  pageView = view;
  return view;
}

function dropPageView(): void {
  const view = pageView;
  pageView = null;
  pageProject = null;
  void pageWatching?.stop().catch(() => undefined);
  pageWatching = null;
  if (view === null) return;
  if (mainWindow !== null && !mainWindow.isDestroyed()) {
    mainWindow.contentView.removeChildView(view);
  }
  view.webContents.close();
}

/** A click in the page beside the conversation. It arrives from the page's own
 *  world, so it is only listened to while that view is the one that sent it. */
ipcMain.on(CHANNEL.pagePointed, (event, pointed: Pointed) => {
  if (pageView === null || event.sender !== pageView.webContents) return;
  if (pageProject === null) return;
  sayPointed(pageProject, pointed);
});

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

  // In full screen macOS takes the traffic lights away, so the room reserved
  // for them is room wasted. The window says which it is and the stylesheet
  // does the rest.
  const sayHowItSits = (): void => {
    if (win.isDestroyed()) return;
    win.webContents.send(CHANNEL.windowState, { fullScreen: win.isFullScreen() });
  };
  win.on('enter-full-screen', sayHowItSits);
  win.on('leave-full-screen', sayHowItSits);
  win.webContents.on('did-finish-load', sayHowItSits);
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
    // Only when there is nothing left going. A run holding a copy of somebody's
    // project open must not lose its session because a window was shut.
    if (!mustStayUp()) closeSession();
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
/**
 * What this project's before-and-after needs to remember between turns.
 *
 * All of it per project, like everything else on a `Held` — a picture taken in
 * one folder must never be offered as the "before" of a change in another.
 */
type Looking = {
  /** Pictures taken here, oldest last. */
  shots: Shot[];
  /** The newest picture's pixels, held so the next comparison does not have to
   *  read a megabyte back off the disk to find out that one button moved. */
  pixels: Bitmap | null;
  /** The newest picture, small, for the strip's "before" half. */
  thumbnail: string | null;
  /** What was asked for this turn, in their words. */
  instruction: string | null;
  /** Everything written since the last picture. A set, because an agent that
   *  edits one file six times has changed one file. */
  files: Set<string>;
  /** True once a picture has been attempted here, however it went.
   *
   *  Not "we have one" — "we have tried". The difference matters for a project
   *  that cannot be built: without it, every single turn would keep trying for
   *  a first picture, including the turns that only touched the notes file. */
  tried: boolean;
  /** True while a picture is being taken. Nothing waits on it. */
  busy: boolean;
  /** Something else changed while we were busy. Take another when this ends. */
  again: boolean;
  /** Change id → the two files behind it, for `visualFrames`. */
  frames: Map<string, { before: string; after: string }>;
  /** The same changes in the words already written beside them, kept so handing
   *  the work to somebody else does not have to describe it a second time in a
   *  second voice. */
  told: Map<string, Change>;
  /** Version id → what the project looked like at it, small, ready to draw.
   *  Small pictures rather than paths so the rail never waits on a disk. */
  pictures: Map<string, string>;
  counter: number;
};

function nothingSeenYet(): Looking {
  return {
    shots: [],
    pixels: null,
    thumbnail: null,
    instruction: null,
    files: new Set(),
    tried: false,
    busy: false,
    again: false,
    frames: new Map(),
    told: new Map(),
    pictures: new Map(),
    counter: 0,
  };
}

/** As many changes as a person will read in one sitting before approving them.
 *  Past this it is an archive, and nobody approves an archive. */
const TOLD = 12;

/** File a picture under the version it shows, oldest let go once there are more
 *  than the folder itself keeps. Same ceiling as the pictures on disk, so the
 *  rail never claims to remember more than there is. */
function rememberPicture(looking: Looking, versionId: string, picture: string): void {
  looking.pictures.delete(versionId);
  looking.pictures.set(versionId, picture);
  for (const oldest of looking.pictures.keys()) {
    if (looking.pictures.size <= KEEP) break;
    looking.pictures.delete(oldest);
  }
}

/**
 * How many conversations one project may have live at once.
 *
 * Each one is a whole context window sitting in memory, so this is a product
 * decision rather than a detail: three is as many as anybody holds in their head
 * at once, and the fourth is better put down and picked up again than paid for
 * all afternoon. Putting one down loses nothing — it is written down, and
 * opening it again carries on.
 */
const CONVERSATIONS = 3;

type Held = {
  timeline: Timeline;
  spend: SpendRecorder;
  /** The conversations live in this project, in front first. Empty only for the
   *  moment between the timeline opening and the first session starting, which
   *  is the window in which that session can fail. */
  sessions: Workspaces<GrapheSession>;
  /** The finished site being looked at, if "See it" has been pressed here. */
  serving: Serving | null;
  /** Every variation in the set in front, each served on its own address. */
  variations: readonly Serving[];
  /** The before-and-after (BACKLOG F2). */
  looking: Looking;
  /** A conversation's own checkout, by its address. Present only for the ones
   *  running isolated in a worktree — the primary conversation works directly
   *  on the project folder. */
  checkouts: Map<string, { folder: string }>;
  /** Work being checked before it reaches the files, or null when none is. */
  waiting: HeldWork | null;
  /** What that work would look like, photographed in the copy while the copy
   *  still existed. Null until it has been, or when nothing came out. */
  pictures: HeldPictures | null;
  /** True while something is being sent off this computer, so a second press
   *  cannot start a second one. */
  sending: boolean;
};

/** Every conversation in one project, with the one that has waited longest put
 *  down when there are too many — and said out loud where it was happening. */
function conversationsIn(project: string): Workspaces<GrapheSession> {
  return new Workspaces<GrapheSession>({
    limit: CONVERSATIONS,
    close: (session) => session.dispose(),
    evicted: (one) => {
      send(project, { type: 'message-delta', text: setDownWords.said }, one.path);
      send(project, { type: 'message-end' }, one.path);
    },
  });
}

const workspaces = new Workspaces<Held>({
  close: (held) => {
    held.sessions.closeAll();
    void held.serving?.stop();
    for (const served of held.variations) void served.stop();
    // The copy goes; whatever it made stays reachable, so closing a project
    // while something waits in it cannot be how somebody loses work.
    void held.waiting?.release();
  },
});

/* -------------------------------------------------------------------------- */
/* Which project, which conversation                                          */
/* -------------------------------------------------------------------------- */

/** The project named, or the one in front. Never the nearest one: a project that
 *  is not open is nothing, the same way `Workspaces.find` says it. */
function projectAt(where: Where): Workspace<Held> | null {
  return addressed(workspaces, where.project === undefined ? undefined : resolve(where.project));
}

/** The conversation named, or the one in front of this project. */
function conversationAt(held: Held, where: Where): Workspace<GrapheSession> | null {
  return addressed(held.sessions, where.conversation, (session) => session.conversation);
}

function sessionAt(open: Workspace<Held>, where: Where): GrapheSession | null {
  return conversationAt(open.held, where)?.held ?? null;
}

/** The same one, counted as the one being worked in — so the conversation
 *  somebody keeps coming back to is never the one put down. */
function workingAt(open: Workspace<Held>, where: Where): GrapheSession | null {
  const found = conversationAt(open.held, where);
  if (found === null) return null;
  open.held.sessions.resume(found.path);
  return found.held;
}

/** What a conversation answers to for as long as it is open. The file it is
 *  written down in, or a name of its own until there is one. */
let unwritten = 0;
function addressOf(session: GrapheSession): string {
  return session.conversation ?? `new-${String(++unwritten)}`;
}

/** Put a conversation in front of its project. Whatever it is called on the
 *  shelf, so the sentence about one being put down names a thing, not an id. */
function keepConversation(held: Held, address: string, session: GrapheSession): void {
  held.sessions.adopt({ path: address, name: session.name ?? address, held: session });
}

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

/**
 * What this person has chosen about the app itself, and what this machine has
 * to offer them.
 *
 * Both are opened once and held, for the same reason `recents` is: `app.getPath`
 * cannot be asked before the app is ready, and looking through every
 * Applications folder on every click would be a search for an answer that
 * cannot change while the app is open.
 */
let preferencesPromise: Promise<PreferenceFile> | null = null;

function preferences(): Promise<PreferenceFile> {
  preferencesPromise ??= PreferenceFile.open(join(app.getPath('userData'), 'preferences.json'));
  return preferencesPromise;
}

let editorPromise: Promise<Editor | null> | null = null;

function editor(): Promise<Editor | null> {
  editorPromise ??= findEditor().catch(() => null);
  return editorPromise;
}

const NO_EDITOR: Trouble = {
  what: 'I could not find a code editor on this computer.',
  because:
    'Nothing I recognise is installed, so there is nothing for me to open your folder in. You can still open the folder itself.',
  actionLabel: 'Got it',
};

function couldNotOpenEditor(name: string, cause: unknown): Trouble {
  return {
    what: `I could not open ${name}.`,
    because:
      'It is installed, but this computer would not start it just now. Opening the folder and dragging it in does the same thing.',
    actionLabel: 'Got it',
    details: detailsOf(cause),
  };
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

/** Which of a project's own extensions somebody has said yes to. Read at the
 *  moment a session is built, so a decision taken a minute ago counts. */
async function trustsIn(path: string): Promise<(id: string) => boolean> {
  const { trusted } = (await preferences()).all();
  return (id: string) => isTrusted(trusted, path, id);
}

/** What the window is told about a version. */
function asSaved(version: Version, currentId: string | null): SavedVersion {
  return {
    id: version.id,
    shortId: version.shortId,
    at: version.at,
    title: version.title,
    by: version.by,
    named: version.named,
    current: version.id === currentId,
    parents: version.parents,
    refs: version.refs,
    wentBackTo: version.wentBackTo,
  };
}

/** The whole timeline of the project in front, newest first. No project open is
 *  an empty list rather than a failure: the rail simply has nothing to draw, and
 *  a card saying so would be a card about us. */
async function versionsOf(held: Held): Promise<readonly SavedVersion[]> {
  const [versions, current] = await Promise.all([held.timeline.versions(), held.timeline.currentVersion()]);
  return versions.map((version) => asSaved(version, current?.id ?? null));
}

/* -------------------------------------------------------------------------- */
/* The pictures and the folder's saved state                                   */
/* -------------------------------------------------------------------------- */

/**
 * What arrived over the wire as attachments, checked into the picture cards the
 * session knows. Anything that does not look like a real image is let go rather
 * than refused: one odd entry should cost the whole message nothing.
 */
function imageCards(value: unknown): readonly ImageCard[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const cards: ImageCard[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== 'object') continue;
    const picture = entry as Record<string, unknown>;
    if (picture['kind'] !== 'image') continue;
    const bytes = picture['bytes'];
    const mimeType = picture['mimeType'];
    if (typeof bytes !== 'string' || bytes === '' || typeof mimeType !== 'string' || mimeType === '') {
      continue;
    }
    cards.push({ bytes, mimeType });
  }
  return cards.length === 0 ? undefined : cards;
}

/**
 * The folder's saved state, in the window's words.
 *
 * The overview panel lives or dies on this being a folder fact, not a process
 * fact: a folder that is not a repository, or a machine without git, is "git:
 * null" — a fact about the folder, shown as an empty history rather than a
 * failure. Read with a short timeout so a folder that will not answer (a
 * network drive, a locked machine) costs the panel the section, not the window.
 */
/** A git runner, for the worktree work. The working directory comes with each call. */
function gitRunHereFor(): RunGit {
  return (args, options) => gitRun(options.cwd, args);
}

/** Run git in a folder and say whether it worked, with what it said. */
async function gitRun(cwd: string, args: string[]): Promise<{ code: number; out?: string }> {
  try {
    const made = await execFileAsync('git', args, { cwd, encoding: 'utf8' });
    return { code: 0, out: made.stdout };
  } catch (cause) {
    const failed = cause as { code?: number };
    return { code: typeof failed.code === 'number' ? failed.code : 1, out: '' };
  }
}

/** The checkouts this project has opened, main one excluded. */
async function listWorktrees(repo: string): Promise<string[]> {
  const { code, out } = await gitRun(repo, ['worktree', 'list', '--porcelain']);
  if (code !== 0 || out === undefined) return [];
  const folders: string[] = [];
  for (const line of out.split('\n')) {
    if (!line.startsWith('worktree ')) continue;
    const folder = line.slice('worktree '.length).trim();
    if (path.resolve(folder) !== path.resolve(repo)) folders.push(folder);
  }
  return folders;
}

function firstWorktree(list: string[]): string | null {
  return list[0] ?? null;
}

/** A mistake to hold the window by, in the shape a reading makes. */
function worktreeTrouble(because: string): Trouble {
  return { what: 'This conversation needs its own checkout.', because, actionLabel: 'Got it' };
}

function readGitStatus(cwd: string): Promise<GitSnapshot | null> {
  return new Promise((resolve) => {
    const child = spawn('git', ['status', '--porcelain=v2', '--branch'], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      out += chunk;
    });
    // stderr is drained and thrown away: a folder that is not a repository
    // answers on the exit code, and the error text belongs to git, not to the
    // window.
    child.stderr.setEncoding('utf8');
    child.stderr.resume();
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      resolve(null);
    }, 4000);
    child.on('error', () => {
      clearTimeout(timeout);
      resolve(null);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        resolve(null);
        return;
      }
      resolve(parseGitStatus(out));
    });
  });
}

/* -------------------------------------------------------------------------- */
/* A project's github repository, read through the terminal's own `gh`         */
/* -------------------------------------------------------------------------- */

/** Run `gh` in cwd and give back its JSON stdout, or null when it is not there
 *  or not logged in. `gh` reads the person's own credentials from their keyring,
 *  so no token has to be stored, refreshed or guarded here.
 */
function ghJSON(cwd: string, args: readonly string[]): Promise<unknown | null> {
  return new Promise((resolve) => {
    const child = spawn('gh', [...args, '--json', 'number,title,state,url,body,author,updatedAt'], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      out += chunk;
    });
    child.stderr.resume();
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      resolve(null);
    }, 8000);
    child.on('error', () => {
      clearTimeout(timeout);
      resolve(null);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(out));
      } catch {
        resolve(null);
      }
    });
  });
}

/** Which github repository this folder answers to, or `owner/name`. Read from a
 *  remote the folder already knows about, so a project with no remote or a
 *  remote that is not github is simply not a github repository.
 */
function githubRepo(cwd: string): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn(
      'git',
      ['config', '--get', 'remote.origin.url'],
      { cwd, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let out = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => out += chunk);
    child.stderr.resume();
    child.on('close', (code) => {
      if (code !== 0) {
        resolve(null);
        return;
      }
      const url = out.trim();
      // Accept https://github.com/o/r, git@github.com:o/r, and ssh variants.
      const m = /github\.com[/:]([^/]+)\/([^/.]+)(?:\.git)?$/.exec(url);
      const full = m === null ? null : `${m[1]}/${m[2]}`;
      resolve(full);
    });
  });
}

/** One issue or pull request, narrowed from gh's JSON to what the screen needs. */
function repoItem(raw: Record<string, unknown>, kind: 'issue' | 'pr'): RepoItem {
  const author =
    (raw['author'] as Record<string, unknown> | null)?.['login'] ?? 'unknown';
  const number = typeof raw['number'] === 'number' ? raw['number'] : 0;
  return {
    number,
    kind,
    title: typeof raw['title'] === 'string' ? raw['title'] : '',
    state: typeof raw['state'] === 'string' ? raw['state'] : '',
    url: typeof raw['url'] === 'string' ? raw['url'] : '',
    description:
      typeof raw['body'] === 'string' && raw['body'].trim() !== '' ? raw['body'] : null,
    author: typeof author === 'string' ? author : 'unknown',
    updatedAt: typeof raw['updatedAt'] === 'string' ? raw['updatedAt'] : '',
    baseRef: null,
  };
}

/** Everything the reviews screen asks about a project's repository, fetched in
 *  one call. Null when this folder is not a github repo, or gh is not ready —
 *  both are "nothing to show" rather than a failure.
 */
async function readRepo(open: { path: string }): Promise<RepoLook> {
  try {
    const full = await githubRepo(open.path);
    if (full === null) return null;
    const split = full.split('/');
    const owner = split[0] ?? '';
    const name = split[1] ?? '';
    const issues = (await ghJSON(open.path, ['issue', 'list', '-R', full, '--limit', '50'])) as
      | readonly Record<string, unknown>[]
      | null;
    const prs = (await ghJSON(open.path, ['pr', 'list', '-R', full, '--limit', '50'])) as
      | readonly Record<string, unknown>[]
      | null;
    return {
      full,
      owner,
      name,
      url: `https://github.com/${full}`,
      issues: (issues ?? []).map((one) => repoItem(one, 'issue')),
      prs: (prs ?? []).map((one) => repoItem(one, 'pr')),
    };
  } catch {
    return null;
  }
}

/** Post a review as a comment on a pull request, speaking as the person whose
 *  terminal `gh` is logged in as. The body is written to a temp file first so
 *  a long review survives gh's argv and needs no shell quoting. The exit code
 *  is what answers: 0 is the comment landed.
 */
async function ghComment(
  cwd: string,
  full: string,
  number: number,
  body: string,
): Promise<number> {
  return new Promise((resolve) => {
    const dir = tmpdir();
    const file = join(dir, `graphe-review-${String(Date.now())}.md`);
    void writeFile(file, body, 'utf8')
      .then(() => {
        const child = spawn(
          'gh',
          ['pr', 'comment', String(number), '-R', full, '--body-file', file],
          { cwd, stdio: ['ignore', 'ignore', 'pipe'] },
        );
        let err = '';
        child.stderr.setEncoding('utf8');
        child.stderr.on('data', (chunk: string) => (err += chunk));
        const timeout = setTimeout(() => child.kill('SIGKILL'), 20000);
        child.on('close', (code) => {
          clearTimeout(timeout);
          void rm(file, { force: true }).catch(() => {});
          resolve(code ?? 1);
        });
        child.on('error', () => {
          clearTimeout(timeout);
          void rm(file, { force: true }).catch(() => {});
          resolve(1);
        });
      })
      .catch(() => resolve(1));
  });
}

/* -------------------------------------------------------------------------- */
/* The before and after                                                        */
/* -------------------------------------------------------------------------- */

/**
 * A picture of the project, and what it says next to the one before it.
 *
 * BACKLOG F2, and the README's oldest unkept promise: *"You see what changed,
 * as a picture. A before and after of the page itself, plus a sentence
 * describing what moved."*
 *
 * ## Nothing waits on this
 *
 * Not one caller awaits it. It starts after a turn has already settled — after
 * the reply has finished streaming, after the versions have been refreshed —
 * and the conversation is usable throughout. Getting a project ready can take
 * half a minute on a cold folder, and a person who has to wait half a minute to
 * be told what they can already see on screen would rightly turn this off.
 *
 * ## And nothing is said when it fails
 *
 * Every failure here is silence. A project that will not build, a page that
 * never loads, a folder we cannot write into: none of that is something the
 * person did, none of it changed anything, and a card saying "I could not take
 * a screenshot" is an app talking about itself in the middle of somebody's
 * work.
 */
async function look(project: string, held: Held): Promise<void> {
  const looking = held.looking;
  // Held onto out here: the block below declares a `held` of its own for the
  // older picture, and the timeline is still wanted after it.
  const timeline = held.timeline;
  if (looking.busy) {
    looking.again = true;
    return;
  }

  looking.busy = true;
  try {
    // Taken now and cleared now, so a turn that arrives while the picture is
    // being taken starts its own list rather than inheriting this one.
    const changed = whatCouldBeSeen(looking.files);
    const instruction = looking.instruction;
    const first = !looking.tried;
    looking.files = new Set();
    looking.instruction = null;
    looking.tried = true;

    // Nothing that could move a pixel. The picture we already have is still
    // true, so there is nothing to take and nothing to say.
    if (!first && changed.length === 0) return;

    // On the way in, everything left over from last time goes. A pairing is
    // "the picture before this one" and that only exists in memory, so nothing
    // already in the folder can ever be compared against anything — and left
    // alone it would grow by one picture per launch, forever.
    if (first) await forgetEverything(project);

    const id = `${Date.now().toString(36)}-${looking.counter}`;
    looking.counter += 1;

    const taken = await capture({ folder: project, id });
    if (taken === null) return;

    const shelved = landed(looking.shots, taken.picture);
    looking.shots = [...shelved.kept];
    void forget(shelved.forget.map((one) => one.file));

    // The picture is of the project as it now stands, which is the version it
    // now stands at. That is the only moment the two are known to match.
    const at = await timeline.currentVersion().catch(() => null);
    if (at !== null) rememberPicture(looking, at.id, taken.thumbnail);

    // The older half. Usually still in hand from last time; read back off the
    // disk only when it is not, which is the case where the project was opened,
    // photographed, and then left alone long enough for nothing else to happen.
    const before = shelved.pair === null ? null : shelved.pair.before;
    const held =
      before !== null && (looking.pixels === null || looking.thumbnail === null)
        ? await readShot(before.file)
        : null;
    const beforePixels = before === null ? null : (looking.pixels ?? held?.bitmap ?? null);
    const beforeThumb = before === null ? null : (looking.thumbnail ?? held?.thumbnail ?? null);

    // Whatever happens next, this is the picture the following turn compares
    // itself against.
    looking.pixels = taken.bitmap;
    looking.thumbnail = taken.thumbnail;

    if (before === null || beforePixels === null || beforeThumb === null) return;

    const moved = whatMoved(beforePixels, taken.bitmap);
    // Two pictures the same. It happens — a change to a file that only shows on
    // a page we did not photograph, or below where the picture stops. Showing a
    // before and after with nothing between them teaches people that the strip
    // is noise, and then they stop opening the ones that matter.
    if (moved.fraction === 0) return;

    const told = tellWhatHappened({
      files: changed,
      instruction: instruction ?? undefined,
      areas: moved.areas,
      fraction: moved.fraction,
    });

    looking.frames.set(id, { before: before.file, after: taken.picture.file });

    const said = await saidInDesignWords(timeline, project, changed);
    // The same words the strip shows, kept for whoever this work is handed to.
    // Two descriptions of one change is how somebody starts wondering which is
    // true, so there is only ever the one.
    looking.told.set(id, {
      title: told.headline,
      says: said ?? told.headline,
      where: told.where,
      before: before.file,
      after: taken.picture.file,
    });
    for (const oldest of looking.told.keys()) {
      if (looking.told.size <= TOLD) break;
      looking.told.delete(oldest);
    }

    showChange(project, {
      id,
      at: taken.picture.at,
      headline: told.headline,
      inDesignWords: said,
      where: told.where,
      areas: moved.areas,
      beforeThumb,
      afterThumb: taken.thumbnail,
      width: taken.picture.width,
      height: taken.picture.height,
    });
  } catch {
    // Silence, deliberately. See the note above.
  } finally {
    looking.busy = false;
    if (looking.again) {
      looking.again = false;
      void look(project, held);
    }
  }
}

/**
 * What changed, in the vocabulary of design rather than of files.
 *
 * "Spacing on three cards, from 16 to 24" instead of "edited Card.tsx". The
 * before is the last saved version of each file and the after is what is on
 * disk now; anything unreadable is simply left out of the comparison.
 */
async function saidInDesignWords(
  timeline: Timeline,
  root: string,
  files: readonly string[],
): Promise<string | null> {
  const current = await timeline.currentVersion().catch(() => null);
  if (current === null) return null;
  const edits: Edit[] = [];
  for (const file of files.slice(0, 20)) {
    const [before, after] = await Promise.all([
      timeline.fileAt(current.id, file).catch(() => null),
      readFile(join(root, file), 'utf8').catch(() => null),
    ]);
    if (before === null || after === null || before === after) continue;
    edits.push({ file, before, after });
  }
  if (edits.length === 0) return null;
  const said = inDesignWords(readChanges(edits));
  return said === NOTHING_TO_SAY ? null : said;
}

/** Which conversation a relay is speaking for. Filled the moment the session
 *  exists, which is before anything it says can arrive. */
type Speaking = { address: string | null };

function forwardTo(path: string, held: Held, from: Speaking): (event: AgentEvent) => void {
  return (event) => {
    // Failures are the one kind of event that can arrive in somebody else's
    // words — see the note at the top of plainly.ts. Everything else in the
    // stream was written by us or by the Guard and goes through untouched.
    const said: AgentEvent =
      event.type === 'error' ? { type: 'error', message: plainMessage(event.message) } : event;
    send(path, said, from.address ?? undefined);

    // Which files a turn wrote, collected as it goes. Read off the same stream
    // the conversation is drawn from rather than by asking the folder
    // afterwards: the folder cannot say what this turn did, only what is
    // different from the last saved version, and the two stop being the same
    // thing the moment anything is saved mid-turn.
    if (said.type === 'tool-start') {
      for (const file of filesWrittenBy(said.call)) held.looking.files.add(file);
    }
    // Everything has stopped. The right moment for a picture, and the only one
    // where taking it cannot slow anything down.
    // A conversation's work runs in its own checkout; the one in front is the
    // one the folder the window reads belongs to, so when its turn settles the
    // work is carried home (Apply) before the screenshots take it in. A tab
    // running in the background is NOT brought back — that is what keeps two
    // parallel tabs from silently overwriting each other's files.
    if (said.type === 'settled') {
      const inFront = held.sessions.current?.path === from.address;
      const checkout =
        !inFront || from.address === null ? null : held.checkouts.get(from.address) ?? null;
      const applied =
        checkout === null ? Promise.resolve() : bringBack(gitRunHereFor(), path, checkout.folder);
      void applied.then(() => look(path, held));
    }

    // Against the ceiling as well as into the ledger. This is the conversation
    // somebody is sitting in front of, so it is never registered as something
    // the ceiling may stop — it finishes and is saved, and what is refused is
    // the next thing asked for.
    if (said.type === 'spend') fleet.spent(null, said.amount);

    // Recorded whether or not there is a window to tell: a reload must not lose
    // money that was already spent.
    for (const also of held.spend.observe(said)) {
      send(path, also, from.address ?? undefined);
      // What a sitting came to is worth keeping beside the project's name, so
      // opening it again is not the first time anybody finds out.
      if (also.type === 'spend-summary') {
        void recents().then((list) => list.recordSpend(path, also.summary.total));
      }
    }
  };
}

/**
 * The same relay, for work being checked in a copy of the project.
 *
 * Everything reaches the conversation exactly as it would, and everything spent
 * is counted exactly as it would be. What is left out is the picture: the
 * change is in the copy, and photographing the folder on screen would produce a
 * before and after of a project nothing has happened to.
 */
function forwardHeld(path: string, held: Held, from: Speaking): (event: AgentEvent) => void {
  return (event) => {
    const said: AgentEvent =
      event.type === 'error' ? { type: 'error', message: plainMessage(event.message) } : event;
    send(path, said, from.address ?? undefined);
    if (said.type === 'spend') fleet.spent(null, said.amount);
    for (const also of held.spend.observe(said)) {
      send(path, also, from.address ?? undefined);
      if (also.type === 'spend-summary') {
        void recents().then((list) => list.recordSpend(path, also.summary.total));
      }
    }
  };
}

/* -------------------------------------------------------------------------- */
/* Landing it                                                                  */
/* -------------------------------------------------------------------------- */

/** Where copies of a project live while work is being checked in them. Outside
 *  the project, so nothing they write can appear in the folder on screen. */
function workFolder(): string {
  return join(app.getPath('temp'), 'graphe-work');
}

/** One line for the version a held piece of work ends at. Their own words, so
 *  the timeline reads the same whether work was checked first or not. */
function saysHeldWork(doing: string): string {
  const one = doing.replace(/\s+/g, ' ').trim();
  return one === '' ? holdWords.label : one.length > 72 ? `${one.slice(0, 71)}…` : one;
}

/**
 * What this computer can reach, remembered for a while.
 *
 * Finding out means running two or three helpers and, for one of them, asking
 * an account over the network. That is fine once; it is not fine every time a
 * panel redraws. None of these answers change in the middle of an afternoon.
 */
type Reach = { at: number; canHandOver: boolean; handOverSays: string; canPutOnline: boolean; onlineSays: string };

const reached = new Map<string, Reach>();
const STILL_TRUE = 5 * 60_000;

async function whatCanBeReached(folder: string): Promise<Reach> {
  const already = reached.get(folder);
  if (already !== undefined && Date.now() - already.at < STILL_TRUE) return already;

  const [found, online, shared] = await Promise.all([
    whatIsHere(folder).catch(() => ({ helper: false, signedIn: false, home: null, theProjectItself: null })),
    whatIsHereForOnline(folder).catch(() => ({ helper: false, signedIn: false })),
    new ProjectHistory(folder).sharedCopy().catch(() => null),
  ]);
  const send = canSendItOn({ ...found, home: shared === null ? null : found.home });
  const up = canPutOnline(online);
  const fresh: Reach = {
    at: Date.now(),
    canHandOver: send.all,
    handOverSays: send.says,
    canPutOnline: up.all,
    onlineSays: up.says,
  };
  reached.set(folder, fresh);
  return fresh;
}

async function landingNow(folder: string, held: Held): Promise<Landing> {
  const chosen = (await preferences()).all();
  const reach = await whatCanBeReached(folder);
  return {
    waiting: held.waiting === null ? null : { ...held.waiting.waiting },
    // Only ever beside the work it is of. Nothing is waiting, so there is
    // nothing for a picture to be a picture of.
    held: held.waiting === null ? null : held.pictures,
    holdBack: chosen.heldBack[folder] === true,
    canHandOver: reach.canHandOver,
    handOverSays: reach.handOverSays,
    canPutOnline: reach.canPutOnline,
    onlineSays: reach.onlineSays,
  };
}

/**
 * The copy, and the project it would replace, at every width.
 *
 * Both halves are rendered and photographed, so this is the slowest thing in a
 * held turn by a distance. It is also the only thing that turns "some work
 * finished" into a decision somebody can actually make, so it is not optional
 * and it is not backgrounded.
 */
async function photographWaiting(project: string, work: HeldWork): Promise<HeldPictures | null> {
  const sizes = await styleSheets(project)
    .then(sizesFor)
    .catch(() => undefined);
  return photographHeld({
    photographer: holdCamera(sizes),
    copy: work.folder,
    project,
    id: work.waiting.id,
    doing: work.waiting.doing,
    ...(sizes === undefined ? {} : { sizes }),
  });
}

/**
 * Do this piece of work in a copy, and leave it waiting.
 *
 * The conversation is unbroken — every event goes to the same place it always
 * does — and the folder on screen is untouched throughout. What the work made
 * is an ordinary version of the project, kept reachable, so both answers to it
 * are undoable.
 */
async function checkItFirst(
  open: { path: string; name: string; held: Held },
  from: Speaking,
  text: string,
  cards: readonly ImageCard[] | undefined,
  lookFirst: boolean,
): Promise<Result<null>> {
  const held = open.held;
  const history = new ProjectHistory(open.path);
  held.pictures = null;

  // Work starts from a version. Anything unfinished becomes one first, silently
  // and without a question, exactly as going back does.
  await held.timeline.snapshot({ boundary: 'turn-ended' }).catch(() => null);

  let waiting: HeldWork;
  try {
    waiting = await HeldWork.start({
      history,
      under: workFolder(),
      id: `held-${Date.now().toString(36)}`,
      doing: text,
    });
  } catch (cause) {
    return fail(historyTrouble(cause));
  }
  held.waiting = waiting;

  // A copy with no pieces in it fails on the first test command, which reads as
  // the work being wrong rather than the copy being empty.
  const fresh = await getReady(open.path, waiting.folder);
  if (!fresh.ready) {
    return fail({
      what: 'I could not get the copy ready.',
      because: fresh.trouble ?? 'Something went wrong setting it up.',
      actionLabel: 'Got it',
    });
  }

  let inside: GrapheSession | null = null;
  try {
    inside = await createSession({
      projectRoot: waiting.folder,
      onEvent: forwardHeld(open.path, held, from),
      timeline: await Timeline.open(waiting.folder),
      model: (await preferences()).all().model,
      thinking: thinkingFor((await preferences()).all()),
      sessionDir: sessionsFolder(),
    });
    await inside.prompt(text, cards, { lookFirst });
  } catch (cause) {
    inside?.dispose();
    await waiting.release().catch(() => undefined);
    held.waiting = null;
    const raw = cause instanceof Error ? cause.message : String(cause);
    return fail(plainTrouble(raw, detailsOf(cause)));
  }
  inside.dispose();

  // Before settling, because settling deletes the copy and the copy is the only
  // place what the work made exists. A picture that could not be taken is a
  // thinner decision, never a failed one.
  held.pictures = await photographWaiting(open.path, waiting).catch(() => null);

  try {
    await waiting.settle(saysHeldWork(text));
  } catch (cause) {
    await waiting.release().catch(() => undefined);
    held.waiting = null;
    held.pictures = null;
    return fail(historyTrouble(cause));
  }
  // Nothing was changed, so there is nothing waiting and nothing to look at.
  if (waiting.waiting.version === null) {
    held.waiting = null;
    held.pictures = null;
  }
  return done(null);
}

/**
 * What this project's work looks like, for whoever it is handed to.
 *
 * The pictures and the sentences beside them, exactly as the person has already
 * seen them. A project that cannot be photographed falls back to the version
 * titles, which is less but is still theirs and still plain.
 */
async function whatChanged(open: { name: string; held: Held }): Promise<readonly Change[]> {
  const told = [...open.held.looking.told.values()];
  if (told.length > 0) return told.slice(-6);

  const versions = await versionsOf(open.held).catch(() => []);
  return versions
    .slice(0, 6)
    .reverse()
    .map((one) => ({ title: one.title, says: '', where: null, before: null, after: null }));
}

/** The likeliest places a project keeps its own design tokens. */
const TOKEN_FILES = [
  'src/styles/tokens.css',
  'src/styles/variables.css',
  'src/tokens.css',
  'styles/tokens.css',
  'app/globals.css',
  'src/app/globals.css',
  'src/index.css',
  'styles/globals.css',
];

/**
 * The project's own tokens, and where they live.
 *
 * Whichever candidate file holds the most of them wins — a project with both a
 * token file and a globals file keeps its tokens in one of them, and counting
 * is a better guess than an ordering we made up.
 */
/** Every stylesheet the project keeps, with its name, so a read can say which
 *  file a token came from. Token files first, then the style folders — the same
 *  breadcrumb `styleSheets` follows, but paired with names for aggregation. */
async function tokenSheets(root: string): Promise<readonly { name: string; css: string }[]> {
  const names = [...TOKEN_FILES];
  for (const folder of STYLE_FOLDERS) {
    const inside = await readdir(join(root, folder)).catch(() => [] as string[]);
    for (const name of inside) {
      if (name.toLowerCase().endsWith('.css')) names.push(`${folder}/${name}`);
    }
  }
  const out: { name: string; css: string }[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    if (out.length >= MOST_SHEETS || seen.has(name)) continue;
    seen.add(name);
    const css = await readFile(join(root, name), 'utf8').catch(() => null);
    if (css !== null) out.push({ name, css });
  }
  return out;
}

/**
 * The project's design tokens, gathered from every stylesheet it keeps.
 *
 * A project's visual language is rarely one file — tokens live in `globals.css`
 * and `variables.css` and the component sheets together. This reads them all,
 * keeps the first declaration of each name (which is the one that wins on
 * `:root`), and remembers which file each came from so an edit to it lands in
 * the right place. `file`/`text` name the sheet with the most tokens, which is
 * where the live editing preview writes.
 */
async function styleTokens(
  root: string,
): Promise<
  { file: string; tokens: readonly import('../src/lib/ipc').StyleToken[]; text: string } | null
> {
  const sheets = await tokenSheets(root);
  // Raw reads named by file, then the first declaration of each name kept — the
  // one that wins on :root — so a value restated per theme is not repeated.
  const byName = new Map<string, { raw: ReturnType<typeof readTokens>[number]; file: string }>();
  for (const sheet of sheets) {
    for (const raw of readTokens(sheet.css)) {
      if (byName.has(raw.name)) continue;
      byName.set(raw.name, { raw, file: sheet.name });
    }
  }
  if (byName.size === 0) return null;
  const raws = [...byName.values()].map((one) => one.raw);
  const withSteps: import('../src/lib/ipc').StyleToken[] = [...byName.values()].map((one) => ({
    ...one.raw,
    steps: steps(one.raw, raws),
    file: one.file,
  }));
  // The sheet holding the most tokens is the one the panel edits live.
  const counts = new Map<string, number>();
  for (const one of withSteps) counts.set(one.file ?? '', (counts.get(one.file ?? '') ?? 0) + 1);
  let bestName = withSteps[0]?.file ?? '';
  let bestCount = -1;
  for (const [name, count] of counts) {
    if (name !== '' && count > bestCount) {
      bestName = name;
      bestCount = count;
    }
  }
  const text = sheets.find((one) => one.name === bestName)?.css ?? '';
  return { file: bestName, tokens: withSteps, text };
}

/** Folders a project keeps its stylesheets in, looked in one level down. */
const STYLE_FOLDERS = ['src/styles', 'styles', 'src/css', 'css', 'app', 'src'];

/** Enough to find the sizes a project designs at, few enough that asking costs
 *  nothing. A project with more stylesheets than this has them in a folder. */
const MOST_SHEETS = 16;

/**
 * The project's stylesheets, as text.
 *
 * The token files first, because a project that names its sizes anywhere names
 * them there, then whatever else is sitting in its style folders. Bounded on
 * purpose: this runs before every look, and a folder of somebody else's build
 * output is not worth reading.
 */
async function styleSheets(root: string): Promise<readonly string[]> {
  const names = [...TOKEN_FILES];
  for (const folder of STYLE_FOLDERS) {
    const inside = await readdir(join(root, folder)).catch(() => [] as string[]);
    for (const name of inside) {
      if (name.toLowerCase().endsWith('.css')) names.push(`${folder}/${name}`);
    }
  }

  const texts: string[] = [];
  const read = new Set<string>();
  for (const name of names) {
    if (texts.length >= MOST_SHEETS) break;
    if (read.has(name)) continue;
    read.add(name);
    const css = await readFile(join(root, name), 'utf8').catch(() => null);
    if (css !== null) texts.push(css);
  }
  return texts;
}

/* -------------------------------------------------------------------------- */
/* Pointing at something                                                       */
/* -------------------------------------------------------------------------- */

/**
 * What the project knows, for a click to be read against.
 *
 * Only this process can answer any of it — the project's own values, every
 * place each component is used, what last touched each file — and reading the
 * components alone is a few hundred milliseconds of somebody's folder. A click
 * is answered while they watch, and none of this changes between two clicks in
 * the same minute.
 */
const knows = new Map<string, { at: number; material: Material }>();
const STILL_KNOWN = 60_000;

/**
 * The same change under both spellings a page can hand back.
 *
 * A file arrives from the page as its address there, and the two shapes that
 * come out of that are the project-relative path and the whole path with the
 * leading slash gone. History knows only the first, so the second is written
 * down beside it rather than guessed at afterwards.
 */
function changesByPath(root: string, changes: ReadonlyMap<string, LastChange>): Map<string, Touched> {
  const whole = root.split(sep).filter((one) => one !== '').join('/');
  const found = new Map<string, Touched>();
  for (const [path, one] of changes) {
    const change: Touched = { name: one.name, when: one.when, id: one.id };
    found.set(path, change);
    found.set(`${whole}/${path}`, change);
  }
  return found;
}

async function whatIsKnown(folder: string): Promise<Material> {
  const already = knows.get(folder);
  if (already !== undefined && Date.now() - already.at < STILL_KNOWN) return already.material;

  const [styles, sheets, usage, changes] = await Promise.all([
    styleTokens(folder).catch(() => null),
    styleSheets(folder).catch(() => [] as readonly string[]),
    readUsage(folder).catch(() => null),
    new ProjectHistory(folder).lastChangeByFile().catch(() => new Map<string, LastChange>()),
  ]);

  const material: Material = {
    tokens: styles?.tokens ?? [],
    usage,
    changes: changesByPath(folder, changes),
    widths: sizesFor(sheets),
  };
  knows.set(folder, { at: Date.now(), material });
  return material;
}

/** One click, read against the project it came out of. `says` is the same click
 *  as the one line the composer would have made somebody type. */
async function readingOf(folder: string, pointed: Pointed): Promise<PointedAt | null> {
  try {
    const material = await whatIsKnown(folder);
    const reading = readPointed(pointed, material);
    return { pointed, reading, says: saysReading(reading) };
  } catch {
    return null;
  }
}

function sayPointed(folder: string, pointed: Pointed): void {
  void readingOf(folder, pointed).then((at) => {
    if (at === null || mainWindow === null || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send(CHANNEL.pointed, at);
  });
}

/** Where every project's conversations are kept. */
function sessionsFolder(): string {
  return join(app.getPath('userData'), 'sessions');
}

/** Where a project's conversation checkouts live — outside the project, like a
 *  copy, so nothing the worktree writes ever appears in the folder the person
 *  is looking at. Keyed by the project's own path so repos never collide. */
function worktreesFolder(project: string): string {
  const key = project.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-');
  return join(app.getPath('userData'), 'worktrees', key);
}

/** Where a project's build plan lives, so it survives the window closing. */
function buildPlanFile(project: string): string {
  const key = project.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-');
  return join(app.getPath('userData'), 'builds', `${key}.json`);
}

/** Opens asked for and not yet answered, by folder. Two requests for the same
 *  folder inside the window between the "already open" check and `adopt` would
 *  build two sessions appending to one transcript; the second caller waits for
 *  the first instead. */
const opening = new Map<string, Promise<Result<OpenedProject>>>();

function openProject(folder: string): Promise<Result<OpenedProject>> {
  const path = resolve(folder);
  const already = opening.get(path);
  if (already !== undefined) return already;
  const attempt = openTheProject(path).finally(() => opening.delete(path));
  opening.set(path, attempt);
  return attempt;
}

/**
 * Start a conversation in a project, and put it in front of the others.
 *
 * What `how` means is `openingFor`'s to decide; what this adds is that one
 * already live at that address is handed straight back rather than built again.
 * Two sessions writing one transcript is the race `opening` exists to prevent,
 * and it would also throw away the half-typed thought in the live one.
 */
async function startConversation(
  open: { path: string; held: Held },
  how: Opening,
  keep?: string,
): Promise<Result<{ session: GrapheSession; address: string }>> {
  const held = open.held;
  const asked = how.kind === 'carry-on' ? how.path : undefined;
  if (asked !== undefined) {
    const already = conversationAt(held, { conversation: asked });
    if (already !== null) {
      held.sessions.resume(already.path);
      return done({ session: already.held, address: already.path });
    }
  }

  const from: Speaking = { address: null };
  const prefs = (await preferences()).all();
  // The first conversation of a project is the one on the folder the person is
  // looking at; any further one is a parallel tab and works in its own checkout
  // rather than writing the same files the first one is writing.
  const primary = held.sessions.open.length === 0;
  let checkout: { folder: string } | null = null;
  if (!primary) {
    const made = await createWorktree(
      gitRunHereFor(),
      open.path,
      `conversation-${held.sessions.open.length + 1}`,
      null,
      { folder: join(worktreesFolder(open.path), `conversation-${held.sessions.open.length + 1}`) },
    );
    if (made.ok && made.value !== null) checkout = { folder: made.value.folder };
  }
  let session: GrapheSession;
  try {
    session = await createSession({
      projectRoot: checkout?.folder ?? open.path,
      onEvent: forwardTo(open.path, held, from),
      timeline: held.timeline,
      model: prefs.model,
      thinking: thinkingFor(prefs),
      trusts: await trustsIn(open.path),
      // One folder of transcripts for all projects, under the app's own data
      // directory — never inside the user's project, so uninstalling Graphe
      // takes them with it. Pi tells them apart by the folder each was recorded
      // in, not by where the file sits.
      //
      // Two known limits of that, both accepted for now: a project that is
      // renamed or moved no longer matches, so it opens a fresh conversation and
      // the old file stays behind; and nothing prunes this folder, so a
      // long-lived install accumulates transcripts (pictures included, which are
      // the bulk of it). Both want the "forget this conversation" action B1.1
      // asks for, which is not built yet.
      ...(asked !== undefined
        ? { sessionPath: asked }
        : { sessionDir: sessionsFolder(), ...(how.kind === 'fresh' ? { fresh: true } : {}) }),
    });
  } catch (cause) {
    // The adapter wraps whatever went wrong in a sentence of its own, so the
    // reason worth reading is down the `cause` chain rather than on top of it.
    // Search the whole chain before falling back to the likeliest explanation.
    const chain = detailsOf(cause);
    return fail(knownTrouble(chain ?? '', chain) ?? noAccountConnected(cause));
  }

  // `keep` is a conversation rebuilt in place — the window is already calling it
  // something, and a new name for the same thread would lose it.
  const address = keep ?? addressOf(session);
  from.address = address;
  if (checkout !== null) held.checkouts.set(address, checkout);
  keepConversation(held, address, session);
  return done({ session, address });
}

async function openTheProject(path: string): Promise<Result<OpenedProject>> {
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
  const resumed = workspaces.resume(path);
  if (resumed !== null) {
    await (await recents()).remember({ path, name });
    const front = resumed.held.sessions.current;
    return done({
      path,
      name,
      history: front?.held.history ?? [],
      conversation: front?.held.conversation ?? null,
      ...(front === null ? {} : { address: front.path }),
    });
  }

  let timeline: Timeline;
  try {
    timeline = await Timeline.open(path);
  } catch (cause) {
    return fail(noSafetyNet(cause));
  }

  const held: Held = {
    timeline,
    spend: new SpendRecorder(),
    sessions: conversationsIn(path),
    serving: null,
    variations: [],
    looking: nothingSeenYet(),
    checkouts: new Map(),
    waiting: null,
    pictures: null,
    sending: false,
  };

  // A folder opened with nothing chosen is the first-run case, and Pi will not
  // pick later — so pick now, before the session is made and binds it.
  if ((await preferences()).all().model === null) await chooseAModelIfNoneIs();

  // Opening a project carries on its most recent conversation (BACKLOG B1.1).
  const started = await startConversation({ path, held }, openingFor(null));
  if (!started.ok) return started;

  workspaces.adopt({ path, name, held });
  await (await recents()).remember({ path, name });

  // The picture of the project as it stands, taken before anybody asks for
  // anything. Without it the first change of a sitting has nothing to be
  // compared against, and the one change people most want to see is usually the
  // first one they made. Nothing waits on it — `openProject` has already
  // returned by the time this gets anywhere near a browser window.
  void look(path, held);

  // The conversation this folder left behind, if there is one — the window
  // turns it back into the desk it was (BACKLOG B1.1).
  return done({
    path,
    name,
    history: started.value.session.history,
    conversation: started.value.session.conversation,
    address: started.value.address,
  });
}

function closeSession(): void {
  workspaces.closeAll();
}

/** Folders a page never lives in, skipped before they are opened — a project
 *  with node_modules in it is otherwise most of a minute of reading. */
const NOT_WORTH_WALKING = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  '.next',
  '.svelte-kit',
  'coverage',
  '.cache',
]);

/** Six levels is deeper than any route anybody nests, and it bounds the walk on
 *  a folder that turns out to be somebody's home directory. */
const DEPTH = 6;
const MOST_FILES = 4000;

/** Every file under a folder, relative to it. Unreadable folders are skipped
 *  rather than fatal: a project with one locked directory still has pages. */
async function filesUnder(root: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (folder: string, prefix: string, depth: number): Promise<void> => {
    if (depth > DEPTH || found.length >= MOST_FILES) return;
    let entries;
    try {
      entries = await readdir(folder, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (found.length >= MOST_FILES) return;
      const name = entry.name;
      if (name.startsWith('.') && name !== '.') continue;
      if (entry.isDirectory()) {
        if (NOT_WORTH_WALKING.has(name)) continue;
        await walk(join(folder, name), `${prefix}${name}/`, depth + 1);
      } else if (entry.isFile()) {
        found.push(`${prefix}${name}`);
      }
    }
  };
  await walk(root, '', 0);
  return found;
}

/* -------------------------------------------------------------------------- */
/* Everything in this project                                                  */
/* -------------------------------------------------------------------------- */

/** One folder, read. Anything that will not open is an empty answer: a project
 *  with one locked folder in it still has the rest of itself. */
async function insideFolder(where: string): Promise<readonly Found[]> {
  let entries;
  try {
    entries = await readdir(where, { withFileTypes: true });
  } catch {
    return [];
  }
  const found: Found[] = [];
  for (const entry of entries) {
    // A link can point anywhere, and following one is how a walk leaves the
    // folder it was given.
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      found.push({ name: entry.name, kind: 'folder', size: 0 });
      continue;
    }
    if (!entry.isFile()) continue;
    const size = (await stat(join(where, entry.name)).catch(() => null))?.size ?? 0;
    found.push({ name: entry.name, kind: 'file', size });
  }
  return found;
}

/** Where a file the window asked for really is, or why it is not somewhere we
 *  will read from. Checked as written and again as resolved, so a link out of
 *  the project is refused rather than followed. */
async function fileInProject(
  root: string,
  asked: string,
): Promise<{ full: string; because?: undefined } | { full?: undefined; because: string }> {
  const check = containsPath(root, asked);
  if (!check.inside || check.resolved === null) {
    return { because: check.reason ?? cannotOpen.outside };
  }
  if (isCredentialPath(check.resolved)) return { because: cannotOpen.secret };
  const [real, realRoot] = await Promise.all([
    realpath(check.resolved).catch(() => null),
    realpath(root).catch(() => root),
  ]);
  if (real === null) return { because: cannotOpen.gone };
  if (!containsPath(realRoot, real).inside) return { because: cannotOpen.outside };
  return { full: real };
}

/** A file that cannot be shown. One sentence, and nothing about machinery. */
function cannotShowFile(because: string): Trouble {
  return { what: 'I could not open that file.', because, actionLabel: 'Got it' };
}

/** One path inside a project, or null when it tries to leave. */
function inside(root: string, file: string): string | null {
  const full = resolve(root, file);
  return full === root || full.startsWith(root + sep) ? full : null;
}

/** The served address, pointed at one page of it. */
function atPage(address: string, at: unknown): string {
  if (typeof at !== 'string' || !at.startsWith('/')) return address;
  return `${address.replace(/\/$/, '')}${at}`;
}

/* -------------------------------------------------------------------------- */
/* The ceiling                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * A limit that binds, rather than one that counts.
 *
 * Every run that can spend on its own registers with `fleet` — a helper in its
 * own process, a piece of work carrying on unwatched — and this is where the
 * shell hands it what it needs: what has been spent, and somewhere for the
 * answer to land. Three things follow from it and nothing else in this file
 * decides them:
 *
 *  - Nothing new starts once the remainder cannot cover a run's share.
 *  - What is going is stopped, and only what loses nothing by stopping.
 *  - Money a helper spent in its own process reaches the ledger the meter
 *    reads, so a fan-out to six of them is not six numbers nobody saw.
 *
 * The ceiling is whatever was set on the meter last time, and `GRAPHE_SPEND_LIMIT`
 * ("20 USD") sets one for a run without touching what is remembered — the same
 * setting reached two ways, which is what every control here owes both
 * audiences.
 */
function watchTheCeiling(): void {
  const fromTheEnvironment = readCeiling(process.env['GRAPHE_SPEND_LIMIT'] ?? '');
  if (fromTheEnvironment !== null) fleet.hold(fromTheEnvironment);
  else {
    void preferences().then((file) => {
      const remembered = file.all().ceiling;
      if (remembered !== null) fleet.hold(createLimit(remembered, 'session'));
    });
  }

  // A helper is a separate process, so its spend has been seen by nothing: not
  // the ledger the meter reads, not the project's own total. Filed under the
  // folder it ran in, which is the project that asked for it.
  fleet.onUnseenSpend((spend) => {
    const event: AgentEvent = {
      type: 'spend',
      amount: spend.amount,
      label: spend.label,
      reason: spend.reason,
    };
    const open = workspaces.find(resolve(spend.project));
    if (open !== null) {
      send(open.path, event);
      for (const also of open.held.spend.observe(event)) send(open.path, also);
      return;
    }
    // A run that carries on unwatched works in a copy, so the folder is the
    // copy's rather than the project's.
    for (const desk of awayDesks.values()) {
      if (!desk.bench.pieces.some((piece) => piece.folder === spend.project)) continue;
      desk.spend.observe(event);
      pushAway(desk.path);
      return;
    }
    // A helper is told which folder to work in and does not always say. Filed
    // where the person is working rather than dropped: it is their money either
    // way, and a number nobody is shown is the thing being fixed here.
    const here = workspaces.current;
    if (here === null) return;
    send(here.path, event);
    for (const also of here.held.spend.observe(event)) send(here.path, also);
  });

  // Said once, when it is first reached, and after everything has actually been
  // stopped. The window may be shut — this is exactly the case where somebody
  // has left something running — so it goes to the screen rather than into a
  // conversation nobody is looking at.
  fleet.onReached((status) => {
    const said = limitReached(status);
    for (const desk of awayDesks.values()) pushAway(desk.path);
    const open = workspaces.current;
    if (open !== null) send(open.path, { type: 'error', message: `${said.title}. ${said.body}` });
    const where = open?.path ?? [...awayDesks.keys()][0] ?? null;
    if (where !== null) tellThem(said.title, said.body, where);
  });
}

/* -------------------------------------------------------------------------- */
/* Work that carries on without you                                            */
/* -------------------------------------------------------------------------- */

/**
 * ## The whole shape of it
 *
 * Nothing here runs in a data centre. Every piece of work is a copy of the
 * project on this disk, made by the same `Workbench` the board already uses, and
 * the only thing that ever leaves the machine is the model call that was always
 * going to. What comes back is what a designer can read: a picture, a sentence
 * and what it cost, filed on the contact sheet with a way to keep it or let it
 * go.
 *
 * ## The rule that matters
 *
 * A run with nobody watching cannot answer its own questions. `Unattended` holds
 * them, and the only thing that resolves one is a person pressing a button — see
 * src/work/unattended.ts, where that is one small class with one guarded exit.
 * When a run stops on a question it says so, on the board and on screen, and it
 * waits for however long that takes.
 */

/** Where copies of a project live while work carries on in them. Per project,
 *  so letting one project's work go can never reach another's — and beside the
 *  rest of what this app keeps rather than in a temporary folder, because work
 *  that is meant to outlive a quit cannot live somewhere the machine tidies. */
function awayFolder(path: string): string {
  return join(app.getPath('userData'), 'copies', keyFor(path));
}

/** Which run of the app this is, so a note left by an earlier one is told apart
 *  from a note we wrote ourselves a moment ago. */
const us: Owner = { pid: process.pid, since: Date.now() };

/** The notes about work in flight, so it is all still here next launch. */
let notebook: Notebook | null = null;

function notes(): Notebook {
  notebook ??= new Notebook(join(app.getPath('userData'), 'work'));
  return notebook;
}

/** One piece of work in flight, and the questions it has left standing. */
type Run = {
  /** Nothing in here answers a question. It only remembers them. */
  held: Unattended;
  session: GrapheSession | null;
  /** What it said, kept for the sentence beside its picture. */
  said: string;
};

/** Everything one project has going whether or not anybody is looking. Kept
 *  apart from `workspaces` on purpose: a repeat coming round for a project that
 *  is not in front must not quietly change which project is in front. */
type AwayDesk = {
  path: string;
  name: string;
  history: ProjectHistory;
  bench: Workbench;
  /** What is waiting for something else to finish before it starts. Nothing in
   *  here is on the board yet, and nothing in here has a copy of the project. */
  chain: Following;
  /** What each piece of work was asked to come after, kept once it has started
   *  so its card still says what the plan was. */
  after: Map<string, string>;
  /** How many have been asked for here, so no two are ever given one name. */
  asked: number;
  runs: Map<string, Run>;
  spend: SpendRecorder;
  /** What each piece of work has cost on its own, kept past the end of the run
   *  so a board read back off the disk still says what it cost. */
  costs: Map<string, Money>;
  /** The last sentence each one said, for the same reason. */
  saids: Map<string, string>;
  /** True once something has landed that nobody has been shown yet. */
  unseen: boolean;
  /** True while copies are being made. Two runs finishing at the same moment
   *  would otherwise both look at the queue before either had taken from it,
   *  and the piece at the front would be started twice. */
  starting: boolean;
  /** A slot freed up while that was happening. Look again when it ends, or the
   *  piece at the front of the queue waits for a turn that never comes. */
  again: boolean;
  /** Pieces started as "until it's done" — full access, no questions, and a
   *  wall-clock ceiling so a stuck loop cannot burn a night. */
  goals: Set<string>;
};

const awayDesks = new Map<string, AwayDesk>();

function deskFor(path: string, name: string): AwayDesk {
  const already = awayDesks.get(path);
  if (already !== undefined) return already;
  const history = new ProjectHistory(path);
  const bench = new Workbench({ history, under: awayFolder(path), atOnce: AT_A_TIME });
  const desk: AwayDesk = {
    path,
    name,
    history,
    bench,
    chain: new Following({
      ask: (doing, where) => {
        bench.ask(doing, where);
      },
      stopped: (id, trouble) => {
        bench.stopped(id, trouble);
      },
      stateOf: (id) => bench.pieces.find((one) => one.id === id)?.state ?? null,
    }),
    after: new Map(),
    asked: 0,
    runs: new Map(),
    spend: new SpendRecorder(),
    costs: new Map(),
    saids: new Map(),
    unseen: false,
    starting: false,
    again: false,
    goals: new Set(),
  };
  awayDesks.set(path, desk);
  return desk;
}

/** Four hours is long enough for a real overnight job and short enough that a
 *  stuck loop cannot empty an account. Goal runs get this wall clock; ordinary
 *  background work keeps the ordinary command ceilings. */
const GOAL_WALL_MS = 4 * 60 * 60 * 1000;

/** The list of repeats, mirrored here so drawing the panel never waits on a
 *  disk. The file is the truth; this is the copy the window is told about. */
let standingNow: readonly Standing[] = [];
let standingPromise: Promise<StandingFile> | null = null;

function standingFile(): Promise<StandingFile> {
  standingPromise ??= StandingFile.open(join(app.getPath('userData'), 'standing.json')).then(
    (file) => {
      standingNow = file.all();
      return file;
    },
  );
  return standingPromise;
}

async function changeStanding(
  change: (all: readonly Standing[]) => readonly Standing[],
): Promise<void> {
  const file = await standingFile();
  standingNow = await file.change(change);
  watchTheClock();
}

/** One line about what a piece of work did, out of what it actually said. */
function saidBriefly(text: string): string | null {
  const one = text.replace(/\s+/g, ' ').trim();
  if (one === '') return null;
  const stop = one.search(/[.!?](\s|$)/);
  const sentence = stop === -1 ? one : one.slice(0, stop + 1);
  return sentence.length > 160 ? `${sentence.slice(0, 159)}…` : sentence;
}

/** The last thing one said, whether it is still going or was read back off the
 *  disk after a quit. */
function lastSaidBy(desk: AwayDesk, id: string): string {
  const live = desk.runs.get(id)?.said ?? '';
  return live === '' ? desk.saids.get(id) ?? '' : live;
}

/** One piece of work, whether it is on the board or still waiting for another to
 *  finish. One waiting has no copy and no result, which is exactly a piece of
 *  work that has not had its turn. */
function pieceFor(desk: AwayDesk, id: string): PieceOfWork | null {
  const on = desk.bench.pieces.find((one) => one.id === id);
  if (on !== undefined) return on;
  const held = desk.chain.one(id);
  if (held === null) return null;
  return {
    id: held.id,
    doing: held.doing,
    state: 'waiting',
    folder: null,
    version: null,
    picture: null,
    at: held.at,
    trouble: null,
  };
}

/** Write down where one piece of work stands. Called wherever it moves, so the
 *  note on the disk is never behind the board on the screen by more than the
 *  write itself. */
function noteDown(desk: AwayDesk, id: string): void {
  const piece = pieceFor(desk, id);
  if (piece === null) return;
  void notes().note(
    noteOf(piece, {
      project: desk.path,
      name: desk.name,
      owner: us,
      says: saidBriefly(lastSaidBy(desk, id)),
      spent: desk.costs.get(id) ?? null,
      after: desk.after.get(id) ?? null,
    }),
  );
}

function noteEveryone(desk: AwayDesk): void {
  for (const piece of desk.bench.pieces) noteDown(desk, piece.id);
  for (const held of desk.chain.waiting) noteDown(desk, held.id);
}

function forgetNote(desk: AwayDesk, id: string): void {
  desk.costs.delete(id);
  desk.saids.delete(id);
  desk.after.delete(id);
  void notes().forget(desk.path, id);
}

/** A name nothing else here has, on the board or waiting behind it. */
function nextName(desk: AwayDesk): string {
  const taken = new Set<string>([
    ...desk.bench.pieces.map((one) => one.id),
    ...desk.chain.waiting.map((one) => one.id),
  ]);
  let number = desk.asked;
  let name = '';
  do {
    number += 1;
    name = `work-${String(number)}`;
  } while (taken.has(name));
  desk.asked = number;
  return name;
}

/** What one is waiting for, as its card reads it. Null once the one it followed
 *  has been let go — there is nothing left to point at. */
function afterFor(desk: AwayDesk, id: string): AwayAfter | null {
  const which = desk.after.get(id);
  if (which === undefined) return null;
  const doing = pieceFor(desk, which)?.doing;
  if (doing === undefined) return null;
  return { id: which, doing, says: afterWords.waits(doing) };
}

function awayPieces(desk: AwayDesk): readonly AwayPiece[] {
  const on: AwayPiece[] = desk.bench.pieces.map((piece) => {
    const run = desk.runs.get(piece.id);
    const asked = run?.held.first ?? null;
    return {
      id: piece.id,
      doing: piece.doing,
      state: piece.state,
      at: piece.at,
      picture: piece.picture,
      says: saidBriefly(lastSaidBy(desk, piece.id)),
      trouble: piece.trouble,
      spent: desk.costs.get(piece.id) ?? null,
      question:
        asked === null
          ? null
          : {
              callId: asked.callId,
              question: asked.question,
              detail: asked.detail,
              consequence: asked.consequence,
            },
      after: afterFor(desk, piece.id),
    };
  });
  // Waiting for another is waiting, so it is drawn in the same band as anything
  // else that has not had its turn — with the one line saying what it is for.
  for (const held of desk.chain.waiting) {
    on.push({
      id: held.id,
      doing: held.doing,
      state: 'waiting',
      at: held.at,
      picture: null,
      says: null,
      trouble: null,
      spent: null,
      question: null,
      after: afterFor(desk, held.id),
    });
  }
  return on;
}

function awayRepeats(path: string, now: number): readonly Repeating[] {
  return standingFor(standingNow, path).map((one) => {
    const said = saysStanding(one, now);
    return {
      id: one.id,
      doing: one.doing,
      says: said.says,
      next: said.next,
      on: one.on,
      lastSaid: one.lastSaid,
    };
  });
}

/** Everything this project has going, as the window draws it. */
function awayNow(path: string): Away {
  const repeats = awayRepeats(path, Date.now());
  const desk = awayDesks.get(path);
  if (desk === undefined) {
    return { pieces: [], repeats, atOnce: AT_A_TIME, spent: null, sinceYouWere: null };
  }
  const pieces = awayPieces(desk);
  return {
    pieces,
    repeats,
    atOnce: desk.bench.atOnce,
    spent: desk.spend.ledger?.total() ?? null,
    sinceYouWere: desk.unseen ? saysWhileAway(pieces) : null,
  };
}

function pushAway(path: string): void {
  if (mainWindow === null || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(CHANNEL.awayChanged, { project: path, away: awayNow(path) });
}

/* ------------------------------------------------------------ being told */

/** Bring the window back, making one if it has been closed. Somebody already
 *  looking at it is left alone — taking focus from a person mid-sentence is not
 *  bringing them to anything. */
function showTheWindow(): void {
  if (mainWindow !== null && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    return;
  }
  createWindow();
}

/** There is a window to be answered in. Made only when there is not. */
function makeSureThereIsAWindow(): void {
  if (mainWindow !== null && !mainWindow.isDestroyed()) return;
  createWindow();
}

/** One sentence on somebody's screen. Pressing it brings them back to the thing
 *  it is about. Silent where the system has no way to show one. */
function tellThem(title: string, body: string, path: string): void {
  if (!Notification.isSupported()) return;
  try {
    const notice = new Notification({ title, body });
    notice.on('click', () => {
      showTheWindow();
      pushAway(path);
    });
    notice.show();
  } catch {
    // A machine that will not show one is not a reason to stop the work.
  }
}

/* ------------------------------------------------------------- doing one */

/**
 * One piece of work, from its own copy of the project to its picture.
 *
 * The session is in memory only: an unattended run has no business writing into
 * the conversation somebody left open, and nothing it says belongs in a
 * transcript they did not ask for.
 */
async function runOne(desk: AwayDesk, piece: PieceOfWork): Promise<void> {
  const folder = piece.folder;
  if (folder === null) return;

  let session: GrapheSession | null = null;
  // The one way this run can ever be answered, and it takes the decision as an
  // argument. `Unattended` never calls it of its own accord.
  const held = new Unattended((callId, decision) => session?.answer(callId, decision) ?? false);
  const run: Run = { held, session: null, said: '' };
  desk.runs.set(piece.id, run);

  // Its share of the ceiling, taken before there is a session to spend
  // anything. Stopping one of these loses nothing: it works in its own copy of
  // the project and whatever it reached is saved on the way out.
  let stopped = false;
  const admitted = fleet.begin({
    id: piece.id,
    kind: 'away',
    stop: () => {
      stopped = true;
      held.stop();
      void run.session?.stop();
    },
  });
  if (!admitted.ok) {
    desk.bench.stopped(piece.id, awayWords.overTheLimit);
    desk.runs.delete(piece.id);
    noteDown(desk, piece.id);
    stopWhatFollows(desk, piece.id, afterWords.broke);
    pushAway(desk.path);
    return;
  }

  const hear = (event: AgentEvent): void => {
    held.heard(event, Date.now());
    if (event.type === 'message-delta') run.said = `${run.said}${event.text}`.slice(0, 2000);

    // Two different things: whether the card moved, and whether anything worth
    // writing down changed. What it has cost is the second without the first.
    let moved = false;
    let changed = false;
    if (event.type === 'needs-confirmation') {
      piece.state = 'needs-you';
      desk.unseen = true;
      moved = true;
      // A question needs a person, and a person needs a window. Made if there
      // is none; never pulled in front of one somebody is already using.
      makeSureThereIsAWindow();
      const notice = saysNotice(desk.name, { doing: piece.doing, state: 'needs-you' });
      tellThem(notice.title, notice.body, desk.path);
    }
    if ((event.type === 'tool-start' || event.type === 'blocked') && piece.state === 'needs-you') {
      if (!held.isWaiting) {
        piece.state = 'running';
        moved = true;
      }
    }

    if (event.type === 'spend') {
      fleet.spent(piece.id, event.amount);
      const running = addSpend(desk.costs.get(piece.id) ?? null, event.amount);
      if (running !== null) desk.costs.set(piece.id, running);
      changed = true;
    }
    for (const also of desk.spend.observe(event)) {
      if (also.type === 'spend-summary') {
        void recents().then((list) => list.recordSpend(desk.path, also.summary.total));
      }
    }
    if (moved || changed || event.type === 'error' || event.type === 'settled') {
      noteDown(desk, piece.id);
      pushAway(desk.path);
    }
  };

  // A copy with no pieces in it fails on the first test command, which reads as
  // the work being wrong rather than the copy being empty. Stopped properly, so
  // it does not sit on the board claiming to be running.
  const fresh = await getReady(desk.path, folder);
  if (!fresh.ready) {
    desk.bench.stopped(piece.id, fresh.trouble ?? 'I could not get the copy ready.');
    fleet.ended(piece.id);
    noteDown(desk, piece.id);
    stopWhatFollows(desk, piece.id, afterWords.broke);
    pushAway(desk.path);
    return;
  }

  try {
    session = await createSession({
      projectRoot: folder,
      onEvent: hear,
      timeline: await Timeline.open(folder),
      model: (await preferences()).all().model,
      thinking: thinkingFor((await preferences()).all()),
    });
    run.session = session;
    // "Until it's done": full access for this run, no questions, and a wall
    // clock so a stuck loop cannot burn the night. Ordinary background work
    // keeps asking when it should.
    const untilDone = desk.goals.has(piece.id);
    if (untilDone) session.goAsFarAs('doing');
    let goalTimer: ReturnType<typeof setTimeout> | undefined;
    if (untilDone) {
      goalTimer = setTimeout(() => {
        held.stop();
        void session?.stop();
        desk.bench.stopped(
          piece.id,
          'I stopped after four hours so a stuck loop could not keep going overnight.',
        );
        pushAway(desk.path);
      }, GOAL_WALL_MS);
    }
    // The ceiling can be reached while this was being built, when there was no
    // session yet for it to stop.
    if (stopped) await session.stop();
    else {
      await session.prompt(piece.doing);
      // Goal timer may already have marked it stopped; only settle a live run.
      const still = desk.bench.pieces.find((one) => one.id === piece.id);
      if (still?.state === 'running') {
        await desk.bench.settle(piece.id, saysHeldWork(piece.doing));
      }
    }
    if (goalTimer !== undefined) clearTimeout(goalTimer);
  } catch (cause) {
    const raw = cause instanceof Error ? cause.message : String(cause);
    desk.bench.stopped(piece.id, plainMessage(raw));
  } finally {
    desk.goals.delete(piece.id);
    // Whatever happened, nothing is left parked on a question nobody can reach.
    // Turned down, never up: the run ending is not a person saying yes.
    held.stop();
    session?.dispose();
    run.session = null;
    // Kept past the run itself, so the sentence beside the picture is still
    // there on a board read back off the disk.
    desk.saids.set(piece.id, run.said);
    // What it did not use goes back to whatever runs next.
    fleet.ended(piece.id);
    noteDown(desk, piece.id);
  }

  // What it made, as a picture. Quiet when it cannot be taken — a project that
  // will not build is what half of these runs are about.
  try {
    const taken = await capture({ folder, id: `away-${piece.id}` });
    if (taken !== null) desk.bench.showPicture(piece.id, taken.thumbnail);
  } catch {
    // The sentence is still true without it.
  }

  // Only if it is still on the board. One somebody stopped on their way past
  // does not get a notice saying it landed.
  const landed = desk.bench.pieces.find((one) => one.id === piece.id);
  if (landed !== undefined) {
    desk.unseen = true;
    const notice = saysNotice(
      desk.name,
      { doing: landed.doing, state: landed.state },
      saidBriefly(run.said),
    );
    tellThem(notice.title, notice.body, desk.path);
  }
  noteDown(desk, piece.id);
  whatFollows(desk, piece.id);
  pushAway(desk.path);

  await runWhatCan(desk);
  quitIfNothingIsLeft();
}

/**
 * What was waiting for this one.
 *
 * It landed, so what comes next is asked for — asked for, not started: it goes
 * on the board as waiting and takes its turn behind everything else, which is
 * what keeps a plan from being a way round the ceiling or round the number that
 * can go at once.
 *
 * It did not land, so nothing behind it does either. Carrying on would mean
 * working against a project that was never changed and reporting on it as
 * though it had been, which is the one answer worse than stopping.
 */
function whatFollows(desk: AwayDesk, id: string): void {
  const moved = desk.chain.finished(id);
  for (const one of [...moved.started, ...moved.stopped]) noteDown(desk, one);
}

/** Everything behind this one, however far back, on the board saying why it will
 *  never start. */
function stopWhatFollows(desk: AwayDesk, id: string, because: string): void {
  for (const one of desk.chain.stopFollowing(id, because)) noteDown(desk, one);
}

/** Start as many as there is room for. Called when one is asked for and again
 *  whenever one finishes. */
async function runWhatCan(desk: AwayDesk): Promise<void> {
  if (desk.starting) {
    desk.again = true;
    return;
  }
  // Nothing new starts at the ceiling, and nothing is copied for it either.
  // What is waiting stays waiting: a limit is not a reason to throw away what
  // somebody asked for.
  if (!fleet.allowsNewWork) return;
  desk.starting = true;
  let began: readonly PieceOfWork[];
  try {
    // Work starts from a version. Anything unfinished becomes one first,
    // silently and without a question, exactly as going back does.
    if (await desk.history.hasUnsavedChanges()) {
      await desk.history.snapshot('Saved before working on its own');
    }
    began = await desk.bench.begin();
  } catch (cause) {
    const why = cause instanceof Error ? cause.message : String(cause);
    const stopped: string[] = [];
    for (const piece of desk.bench.pieces) {
      if (piece.state !== 'waiting') continue;
      desk.bench.stopped(piece.id, plainMessage(why));
      stopped.push(piece.id);
    }
    for (const id of stopped) stopWhatFollows(desk, id, afterWords.broke);
    noteEveryone(desk);
    pushAway(desk.path);
    return;
  } finally {
    desk.starting = false;
  }
  if (began.length > 0) {
    noteEveryone(desk);
    pushAway(desk.path);
  }
  for (const piece of began) void runOne(desk, piece);
  if (desk.again) {
    desk.again = false;
    await runWhatCan(desk);
  }
}

/**
 * Ask for a piece of work that carries on whether or not anybody is looking.
 *
 * With something to come after, the answer can be a refusal — asked to wait for
 * something that is waiting for it, there would be nothing left to start. Said
 * as a sentence rather than thrown: it is a decision, not a failure.
 */
async function keepGoing(
  path: string,
  name: string,
  doing: string,
  after: string | null = null,
  untilDone = false,
): Promise<string | null> {
  const desk = deskFor(path, name);
  const id = nextName(desk);
  const at = Date.now();
  if (untilDone) desk.goals.add(id);

  if (after !== null) {
    const asked = desk.chain.hold({ id, doing, at, after });
    if (!asked.ok) return asked.because;
    desk.after.set(id, after);
    if (asked.waits) {
      // Written down straight away, so a quit leaves the whole plan behind and
      // not only the half of it that had already started.
      const held = pieceFor(desk, id);
      if (held !== null) {
        await notes().note(noteOf(held, { project: path, name, owner: us, after }));
      }
      pushAway(path);
      return null;
    }
  }

  const piece = desk.bench.ask(doing, { id, at });
  // Written down before it starts, so a machine that loses power between the
  // asking and the first word still comes back to something waiting its turn.
  await notes().note(
    noteOf(piece, { project: path, name, owner: us, after: desk.after.get(id) ?? null }),
  );
  pushAway(path);
  await runWhatCan(desk);
  return null;
}

/* --------------------------------------------------------- picking it up */

/**
 * Everything that was going last time, back on its board.
 *
 * Read once, before anything is started, and the decision for each note is
 * src/work/written.ts. The two that matter: something that never got its turn
 * simply takes it now, and something that was mid-thought when the app went
 * away says so and keeps its copy — the thinking was never on the disk, and
 * pretending it can be resumed would be worse than saying it stopped.
 *
 * Everything is put back on the board before any of it is wired up again, so a
 * plan reads the same whichever order its notes came off the disk.
 */
async function pickUpWhereWeLeftOff(): Promise<void> {
  let byProject: ReadonlyMap<string, readonly Written[]>;
  try {
    byProject = await notes().everything();
  } catch {
    return;
  }

  for (const [path, written] of byProject) {
    if (!existsSync(path)) {
      // The project itself has been moved or thrown away. Its notes go with it.
      for (const one of written) await notes().forget(path, one.id);
      continue;
    }
    const desk = deskFor(path, written[0]?.name ?? basename(path));
    let start = false;
    for (const one of written) {
      // Nothing else is looking after these. One copy of the app runs at a
      // time, so at this moment every note that is not ours is left over.
      const next = onComingBack(one, {
        ours: us,
        alive: () => false,
        copyThere: (folder) => existsSync(folder),
      });
      if (next.do === 'leave' || next.do === 'carry-on') continue;

      const piece = desk.bench.ask(one.doing, { id: one.id, at: one.at });
      Object.assign(piece, asPiece(one));
      if (one.spent !== null) desk.costs.set(piece.id, one.spent);
      if (one.says !== null) desk.saids.set(piece.id, one.says);
      if (next.do === 'pick-up') {
        piece.state = 'waiting';
        piece.folder = null;
        start = true;
      }
      if (next.do === 'cut-short') {
        piece.state = 'failed';
        piece.trouble = next.trouble;
      }
      if (one.after !== null) desk.after.set(piece.id, one.after);
      noteDown(desk, piece.id);
    }
    putPlansBack(desk, written);
    await letGoOfCopiesNobodyClaims(desk);
    if (desk.bench.pieces.length === 0 && desk.chain.waiting.length === 0) {
      awayDesks.delete(path);
      continue;
    }
    desk.unseen = true;
    pushAway(path);
    if (start) await runWhatCan(desk);
  }
}

/**
 * The waits between them, put back once they are all on the board.
 *
 * Only work that never got its turn can still be waiting for something: one
 * that was going when the app closed has already been dealt with. The one it
 * was waiting for may have landed while it sat there, in which case it is
 * simply next; may have gone; or may never have run, and then this never runs
 * either and says so.
 */
function putPlansBack(desk: AwayDesk, written: readonly Written[]): void {
  for (const one of written) {
    if (one.after === null) continue;
    const piece = desk.bench.pieces.find((on) => on.id === one.id);
    if (piece === undefined || piece.state !== 'waiting') continue;

    const asked = desk.chain.hold({ id: one.id, doing: one.doing, at: one.at, after: one.after });
    if (asked.ok && !asked.waits) continue;
    if (!asked.ok) {
      desk.bench.stopped(one.id, afterWords.broke);
      noteDown(desk, one.id);
      continue;
    }
    // Held rather than queued: it must not take a copy of the project until the
    // one in front of it has landed.
    void desk.bench.drop(one.id);
    noteDown(desk, one.id);
  }
}

/**
 * Copies of a project with nothing on the board pointing at them.
 *
 * A whole checkout each, so a handful of these is somebody's disk. Only ever
 * from inside the room this project's copies are made in, and only ever ones no
 * piece of work claims — which at this moment means ones whose notes did not
 * survive whatever ended the last run.
 */
async function letGoOfCopiesNobodyClaims(desk: AwayDesk): Promise<void> {
  const room = awayFolder(desk.path);
  const claimed = new Set(desk.bench.pieces.map((one) => one.folder));
  let there: string[];
  try {
    there = await readdir(room);
  } catch {
    return;
  }
  for (const name of there) {
    const folder = join(room, name);
    if (claimed.has(folder)) continue;
    await desk.history.removeWorkspace(folder).catch(() => undefined);
    await rm(folder, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** On the way out, every run still going is written down as cut short. The next
 *  launch would work this out from the number the machine gave us, but numbers
 *  come round again and a note that says so plainly cannot be misread. */
function writeDownWhatWasGoing(): void {
  if (notebook === null) return;
  for (const desk of awayDesks.values()) {
    for (const piece of desk.bench.pieces) {
      if (piece.state !== 'running' && piece.state !== 'needs-you') continue;
      notebook.noteNow(
        noteOf(
          { ...piece, state: 'failed', trouble: writtenWords.cutShort },
          {
            project: desk.path,
            name: desk.name,
            owner: us,
            says: saidBriefly(lastSaidBy(desk, piece.id)),
            spent: desk.costs.get(piece.id) ?? null,
            after: desk.after.get(piece.id) ?? null,
          },
        ),
      );
    }
  }
}

/* ------------------------------------------------------- over and over */

/** Often enough that a morning is not missed by much, seldom enough that a
 *  laptop's battery never notices. */
const LOOK_EVERY = 30_000;

let clock: ReturnType<typeof setInterval> | null = null;

function watchTheClock(): void {
  if (clock !== null) return;
  if (!standingNow.some((one) => one.on)) return;
  clock = setInterval(() => void whatIsDue(), LOOK_EVERY);
  void whatIsDue();
}

function stopWatchingTheClock(): void {
  if (clock === null) return;
  clearInterval(clock);
  clock = null;
}

/** True while one round is being worked out, so a slow project cannot have two
 *  rounds asking for the same thing twice. */
let looking = false;

async function whatIsDue(): Promise<void> {
  if (looking) return;
  looking = true;
  try {
    const file = await standingFile();
    const now = Date.now();
    for (const one of dueNow(file.all(), now)) {
      // Written down before anything happens. A machine that loses power
      // half-way through must come back to a repeat that has been done, not one
      // that looks overdue and runs a second time.
      standingNow = await file.change((all) => ranStanding(all, one.id, { at: now }));
      const name = basename(one.project) === '' ? one.project : basename(one.project);
      await keepGoing(one.project, name, one.doing);
    }
  } catch {
    // A round that could not be worked out is a round missed, and the next one
    // is thirty seconds away.
  } finally {
    looking = false;
  }
}

/* ------------------------------------------------------------- the end */

/** True while something is actually in flight. One stopped on a question is
 *  deliberately not counted: it is not going anywhere, and the window it needs
 *  has already been opened for it. */
function stillGoing(): boolean {
  for (const desk of awayDesks.values()) {
    if (desk.bench.pieces.some((one) => one.state === 'running' || one.state === 'waiting')) {
      return true;
    }
  }
  return false;
}

/**
 * Whether the app has a reason to outlive its window.
 *
 * Work in flight, always: closing the window is not the same as changing your
 * mind, and stopping a run half-way leaves a copy of somebody's project behind
 * with nothing to show for it.
 *
 * A repeat waiting for its morning, only on macOS, where closing the window has
 * never meant quitting and the app is visibly still there in the Dock. Anywhere
 * else, closing the last window means done — the repeats pick up the next time
 * it is opened, and one missed morning is done once rather than counted up.
 * Nobody is left with a process they cannot see and cannot end.
 */
function mustStayUp(): boolean {
  if (stillGoing()) return true;
  return process.platform === 'darwin' && standingNow.some((one) => one.on);
}

/** Called when a piece of work finishes. With no window and nothing left to do,
 *  the app lets itself go rather than sitting there invisibly. */
function quitIfNothingIsLeft(): void {
  if (mainWindow !== null && !mainWindow.isDestroyed()) return;
  if (mustStayUp()) return;
  closeSession();
  if (process.platform !== 'darwin') app.quit();
}

/** What the window asked for, as a rhythm. Null when it is not one of the four,
 *  which is a stale window rather than something to say a sentence about. */
function asRepeat(every: unknown, at: unknown, on: unknown): Repeat | null {
  const known: readonly EveryKind[] = ['day', 'weekday', 'week', 'month'];
  if (typeof every !== 'string' || !known.includes(every as EveryKind)) return null;
  if (typeof at !== 'object' || at === null) return null;
  const time = at as Record<string, unknown>;
  if (typeof time['hour'] !== 'number' || typeof time['minute'] !== 'number') return null;
  const when: TimeOfDay = { hour: time['hour'], minute: time['minute'] };
  const which = typeof on === 'number' ? on : 1;
  if (every === 'week') return { every: 'week', on: which as Weekday, at: when };
  if (every === 'month') return { every: 'month', on: which, at: when };
  return { every: every as 'day' | 'weekday', at: when };
}

/** Everything in flight, let go. Every question still standing is turned down —
 *  which changes nothing, because a question is asked before the thing happens. */
function stopEverythingAway(): void {
  stopWatchingTheClock();
  for (const desk of awayDesks.values()) {
    for (const run of desk.runs.values()) {
      run.held.stop();
      void run.session?.stop();
      run.session?.dispose();
      run.session = null;
    }
  }
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

/* -------------------------------------------------------------------------- */
/* Connecting an account                                                       */
/* -------------------------------------------------------------------------- */

/**
 * After connecting: make sure something is actually chosen to think with.
 *
 * Pi binds a model when the session is made and will not pick one later, so an
 * account connected with no model chosen leaves the agent with nothing — and
 * the failure it raises then is "no model selected", which reads to everybody
 * as the account not having worked. Connecting is somebody saying "use this";
 * picking the first thing it offers is what they meant.
 *
 * Only ever fills a blank. A choice already made is never overwritten, and a
 * choice whose provider is still offering it is a choice already made.
 */
function thinkingFor(preferences: Preferences): ThinkingLevel | undefined {
  const choice = preferences.model;
  return choice === null ? undefined : preferences.thinking[modelKey(choice)];
}

async function chooseAModelIfNoneIs(): Promise<void> {
  const prefs = await preferences();
  const providers = await readConnection(await defaultAgentDir());

  const chosen = prefs.all().model;
  const stillGood =
    chosen !== null &&
    providers.some(
      (provider) =>
        provider.providerId === chosen.providerId &&
        provider.connected &&
        provider.models.some((model) => model.id === chosen.modelId && model.available),
    );
  if (stillGood) return;

  for (const provider of providers) {
    if (!provider.connected) continue;
    const first = provider.models.find((model) => model.available);
    if (first === undefined) continue;
    await prefs.change({ model: { providerId: provider.providerId, modelId: first.id } });
    // Every conversation live in the project in front, not only the one on
    // screen: a model chosen once is the model chosen for all of them.
    for (const one of workspaces.current?.held.sessions.open ?? []) {
      await one.held.useModel({ providerId: provider.providerId, modelId: first.id });
    }
    return;
  }
}

/** The window hears about every step of a connection as it happens. */
function sendConnectStep(step: ConnectStep): void {
  if (mainWindow === null || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(CHANNEL.connectStep, step);
}

/** One question asked while connecting, waiting on the window's answer. */
type PendingPrompt = {
  resolve: (value: string) => void;
  reject: (error: Error) => void;
};

const pendingPrompts = new Map<string, PendingPrompt>();

/** The connection in progress, if any. One at a time: two browser sign-ins
 *  would be two windows nobody is watching. */
let connecting: AbortController | null = null;

/**
 * The bridge between Pi's login flow and this window.
 *
 * `auth_url` and `device_code` are told to the window *and* opened here, so
 * the browser appears even if the window is busy; the window's paste field is
 * the fallback for when the redirect never makes it back. Every prompt is
 * parked until the window answers with `connectAnswer`.
 */
function dialogueFor(controller: AbortController): OurAuthInteraction {
  let serial = 0;
  return {
    signal: controller.signal,
    prompt: (prompt) =>
      new Promise<string>((resolve, reject) => {
        const promptId = `prompt-${++serial}`;
        const pending: PendingPrompt = { resolve, reject };
        pendingPrompts.set(promptId, pending);

        // A prompt Pi races against something else (a callback server) comes
        // with its own signal; when it fires, the prompt is over and the race
        // has been decided elsewhere. "Cancelled" either way, and the login
        // continues without this branch.
        let detach: (() => void) | undefined;
        const cancel = () => reject(new Error('Login cancelled'));
        if (prompt.signal !== undefined) {
          if (prompt.signal.aborted) {
            pendingPrompts.delete(promptId);
            cancel();
            return;
          }
          prompt.signal.addEventListener('abort', cancel, { once: true });
          detach = () => prompt.signal?.removeEventListener('abort', cancel);
        }
        // The resolution path owns the cleanup, whichever side it came from.
        pendingPrompts.set(promptId, {
          resolve: (value) => {
            detach?.();
            pendingPrompts.delete(promptId);
            resolve(value);
          },
          reject: (error) => {
            detach?.();
            pendingPrompts.delete(promptId);
            reject(error);
          },
        });

        sendConnectStep({
          type: 'prompt',
          promptId,
          kind: prompt.type,
          message: prompt.message,
          ...(prompt.type === 'select' || prompt.placeholder === undefined
            ? {}
            : { placeholder: prompt.placeholder }),
          ...(prompt.type === 'select'
            ? { options: prompt.options.map((one) => ({ id: one.id, label: one.label })) }
            : {}),
        });
      }),
    notify: (event) => {
      if (event.type === 'auth_url') {
        sendConnectStep({ type: 'auth-url', url: event.url, ...(event.instructions === undefined ? {} : { instructions: event.instructions }) });
        void shell.openExternal(event.url);
      } else if (event.type === 'device_code') {
        sendConnectStep({
          type: 'device-code',
          userCode: event.userCode,
          verificationUri: event.verificationUri,
          ...(event.expiresInSeconds === undefined ? {} : { expiresInSeconds: event.expiresInSeconds }),
        });
        void shell.openExternal(event.verificationUri);
      } else if (event.type === 'info' || event.type === 'progress') {
        sendConnectStep({ type: 'progress', message: event.message });
      }
    },
  };
}

/** Every open question is answered no when a connection ends, whichever way
 *  it ended. An unanswered prompt must never outlive the attempt. */
function abandonPrompts(): void {
  for (const { reject } of pendingPrompts.values()) reject(new Error('Login cancelled'));
  pendingPrompts.clear();
}

/* -------------------------------------------------------------------------- */
/* Staying in step with Figma                                                  */
/* -------------------------------------------------------------------------- */

/** Which Figma file each project follows. Opened on demand, for the same
 *  reason `recents` is: `app.getPath` cannot be asked before the app is ready. */
let followedPromise: Promise<FollowedFile> | null = null;

function followed(): Promise<FollowedFile> {
  followedPromise ??= FollowedFile.open(join(app.getPath('userData'), 'followed.json'));
  return followedPromise;
}

/**
 * What a reading of a Figma file is made with, or null when there is nothing to
 * make one with.
 *
 * The shelf's Figma entry is the way in for everybody else; until that
 * connection can be asked for a file from here, an environment value is the one
 * hand-hold somebody who knows their way around has. Null is answered honestly
 * rather than papered over — an invented finding about somebody's design is
 * worse than no finding at all.
 */
function figmaReading(): ReadDesign | null {
  const credential = (process.env['FIGMA_TOKEN'] ?? process.env['FIGMA_ACCESS_TOKEN'] ?? '').trim();
  return credential === '' ? null : throughFigma(createReader({ token: credential }));
}

const NO_FIGMA: Trouble = {
  what: 'I have no way into Figma yet.',
  because:
    'Nothing on this computer is connected to Figma, so there is no file for me to open. Connect Figma and point me at it again.',
  actionLabel: 'Got it',
};

/** Whatever went wrong asking Figma, said as it was said. Those sentences are
 *  already written for the person who pasted the link. */
function figmaTrouble(cause: unknown): Trouble {
  const said = cause instanceof Error ? cause.message.trim() : '';
  return {
    what: said === '' ? 'I could not read that Figma file.' : said,
    because: 'Nothing here has changed, so it is worth trying again once that is sorted.',
    actionLabel: 'Got it',
  };
}

function saidBy(cause: unknown): string {
  const said = cause instanceof Error ? cause.message.trim() : '';
  return said === '' ? 'I could not read that Figma file.' : said;
}

/** The whole band, worked out from what is kept. The comparison itself is pure
 *  and lives in src/design/moved.ts. */
function inStepOf(held: HeldDesign | null, trouble: string | null = null): InStep {
  if (held === null) {
    return { following: null, moved: [], says: NOTHING_FOLLOWED, trouble };
  }
  const moved = findMoved(held.design, held.latest, { name: held.name });
  return {
    following: { id: held.id, name: held.name, url: held.url, readAt: held.readAt },
    moved,
    says: saysInStep(held.name, moved),
    trouble,
  };
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
      // The list, and only the list. Nothing of theirs on disk is touched, ever.
      await (await recents()).forget(path);
      workspaces.close(resolve(path));
      // Ours, though, goes. Somebody who has just said "I am done with this
      // project" should not be left holding a folder of our screenshots of it.
      await forgetEverything(resolve(path));
      // And nothing of theirs goes on happening on its own for a project they
      // have just put down.
      const desk = awayDesks.get(resolve(path));
      if (desk !== undefined) {
        for (const run of desk.runs.values()) {
          run.held.stop();
          run.session?.dispose();
        }
        for (const piece of desk.bench.pieces) forgetNote(desk, piece.id);
        for (const held of desk.chain.waiting) forgetNote(desk, held.id);
        await desk.bench.clear().catch(() => undefined);
        awayDesks.delete(resolve(path));
      }
      await (await followed()).forget(resolve(path));
      await changeStanding((all) => withoutProject(all, resolve(path)));
      if (!standingNow.some((one) => one.on)) stopWatchingTheClock();
    }
    return done(await rememberedProjects());
  });

  handle<readonly SavedVersion[]>(CHANNEL.versions, async (_event, args) => {
    const open = projectAt(whereIn(args));
    if (open === null) return done([]);
    try {
      return done(await versionsOf(open.held));
    } catch (cause) {
      return fail(historyTrouble(cause));
    }
  });

  handle<RepoLook>(CHANNEL.repoLook, async (_event, args) => {
    const open = projectAt(whereIn(args));
    if (open === null) return done(null);
    try {
      return done(await readRepo(open));
    } catch (cause) {
      return fail(plainTrouble(
        'I could not read the github folder.',
        detailsOf(cause),
      ));
    }
  });

  handle<null>(CHANNEL.repoComment, async (_event, args) => {
    const [number, body] = args;
    const open = projectAt(whereIn(args));
    if (open === null) return fail(NOTHING_OPEN);
    if (typeof number !== 'number' || number <= 0 || typeof body !== 'string' || body.trim() === '') {
      return fail(plainTrouble('There was nothing to post.'));
    }
    const full = await githubRepo(open.path);
    if (full === null) return fail(plainTrouble('This folder does not look like a github repository.'));
    const exit = await ghComment(open.path, full, number, body);
    return exit === 0 ? done(null) : fail(plainTrouble('The comment did not reach github.'));
  });

  handle<Overview>(CHANNEL.overview, async (_event, args) => {
    const open = projectAt(whereIn(args));
    if (open === null) {
      return done({ git: null, preview: null, artifacts: [], swatches: [], styles: null });
    }
    const made = artifactsAmong([...open.held.looking.files]);
    // A palette is only a palette once its colours have been read, and it is the
    // one artifact worth opening a file for.
    const palette = made.find((one) => one.kind === 'palette') ?? null;
    const swatches =
      palette === null
        ? []
        : paletteFrom(await readFile(join(open.path, palette.path), 'utf8').catch(() => ''));
    return done({
      git: await readGitStatus(open.path),
      preview: open.held.serving?.address ?? null,
      artifacts: made,
      swatches,
      styles: await styleTokens(open.path),
    });
  });

  handle<readonly SavedVersion[]>(CHANNEL.designCommit, async (_event, args) => {
    const [changes] = args;
    const open = projectAt(whereIn(args));
    if (open === null) return fail(NOTHING_OPEN);
    if (typeof changes !== 'object' || changes === null) return fail(NOTHING_OPEN);
    const given = changes as Partial<DesignChange>;
    const tokens = Array.isArray(given.tokens)
      ? given.tokens.filter((one) => typeof one.name === 'string' && typeof one.value === 'string')
      : [];
    const motions = Array.isArray(given.motions)
      ? given.motions.filter(
          (one) => Array.isArray(one.places) && typeof one.change === 'object' && one.change !== null,
        )
      : [];
    // The whole design view is one saved moment. Anything sent here is written
    // back where each token lived and then kept as a single version — the
    // window holds the edits so nothing is committed on a slide.
    const styles = await styleTokens(open.path);
    if (styles === null && tokens.length === 0 && motions.length === 0) return fail(NOTHING_OPEN);
    try {
      // Apply edits per file, so a token that came from a component sheet is
      // written where it lives, not into whichever sheet holds the most. The
      // source is looked up by name from the read, because the window only
      // sends a name and a value.
      const perFile = new Map<string, string>();
      const edits = new Map<string, { name: string; value: string }[]>();
      const whereLives = new Map<string, string>();
      if (styles !== null) {
        for (const one of styles.tokens) whereLives.set(one.name, one.file ?? styles.file);
      }
      for (const one of tokens) {
        const file = whereLives.get(one.name) ?? styles?.file;
        if (file === undefined) continue;
        edits.set(file, [...(edits.get(file) ?? []), { name: one.name, value: one.value }]);
      }
      const writeFileEdits = async (
        file: string,
        list: readonly { name: string; value: string }[],
      ): Promise<void> => {
        const where = join(open.path, file);
        let css = await readFile(where, 'utf8');
        let wrote = false;
        for (const one of list) {
          const next = writeToken(css, one.name, one.value);
          if (next !== css) {
            css = next;
            wrote = true;
          }
        }
        if (wrote) perFile.set(where, css);
      };
      for (const [file, list] of edits) await writeFileEdits(file, list);
      // Motion edits land in the primary stylesheet.
      if (styles !== null && motions.length > 0) {
        const where = join(open.path, styles.file);
        let css = perFile.get(where) ?? (await readFile(where, 'utf8'));
        for (const one of motions) {
          const next = writeMotionAll(css, one.places as Parameters<typeof writeMotionAll>[1], one.change as Parameters<typeof writeMotionAll>[2]);
          if (next !== css) {
            css = next;
            perFile.set(where, css);
          }
        }
      }
      for (const [where, css] of perFile) await writeFile(where, css, 'utf8');
      await open.held.timeline.snapshot({ boundary: 'user-asked', by: 'you' });
      return done(await versionsOf(open.held));
    } catch (cause) {
      const raw = cause instanceof Error ? cause.message : String(cause);
      return fail(plainTrouble(raw, detailsOf(cause)));
    }
  });

  handle<PutBack>(CHANNEL.putBack, async (_event, args) => {
    const [versionId] = args;
    const open = projectAt(whereIn(args));
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
    const open = projectAt(whereIn(args));
    if (open === null) return fail(NOTHING_OPEN);
    if (typeof versionId !== 'string' || typeof name !== 'string') return fail(NO_SUCH_VERSION);
    try {
      await open.held.timeline.nameVersion(versionId, name);
      return done(await versionsOf(open.held));
    } catch (cause) {
      return fail(historyTrouble(cause));
    }
  });

  /** What each version looked like. Empty is a real answer: a project nothing
   *  has been photographed in yet has no pictures, and the rail says so by
   *  drawing words instead. */
  handle<Readonly<Record<string, string>>>(CHANNEL.versionPictures, (_event, args) => {
    const open = projectAt(whereIn(args));
    return Promise.resolve(done(open === null ? {} : Object.fromEntries(open.held.looking.pictures)));
  });

  handle<Preferences>(CHANNEL.preferences, async () => done((await preferences()).all()));

  handle<Preferences>(CHANNEL.setShowMe, async (_event, args) => {
    const [on] = args;
    if (typeof on !== 'boolean') return done((await preferences()).all());
    return done(await (await preferences()).change({ showMe: on }));
  });

  handle<Preferences>(CHANNEL.setShowFiles, async (_event, args) => {
    const [on] = args;
    if (typeof on !== 'boolean') return done((await preferences()).all());
    return done(await (await preferences()).change({ showFiles: on }));
  });

  /** Everything the project holds. Nothing open is an empty list rather than a
   *  failure: the panel simply has nothing to draw. */
  handle<readonly FileEntry[]>(CHANNEL.projectFiles, async (_event, args) => {
    const open = projectAt(whereIn(args));
    if (open === null) return done([]);
    const [walked, git] = await Promise.all([
      everythingIn(open.path, insideFolder),
      readGitStatus(open.path),
    ]);
    return done(markChanged(walked.files, git?.files ?? []));
  });

  /** One file, to read. Everything that could go wrong here — a location
   *  outside the folder, a file that is bytes rather than words, one too big
   *  for a screen — comes back as a sentence instead of as content. */
  handle<string>(CHANNEL.fileText, async (_event, args) => {
    const [path] = args;
    const open = projectAt(whereIn(args));
    if (open === null) return fail(NOTHING_OPEN);
    if (typeof path !== 'string' || path.trim() === '') {
      return fail(cannotShowFile(cannotOpen.gone));
    }
    const where = await fileInProject(open.path, path);
    if (where.full === undefined) return fail(cannotShowFile(where.because));

    const found = await stat(where.full).catch(() => null);
    if (found === null || !found.isFile()) return fail(cannotShowFile(cannotOpen.gone));
    if (tooBig(found.size)) return fail(cannotShowFile(cannotOpen.tooBig));

    const bytes = await readFile(where.full).catch(() => null);
    if (bytes === null) return fail(cannotShowFile(cannotOpen.gone));
    if (looksBinary(bytes)) return fail(cannotShowFile(cannotOpen.notText));
    return done(bytes.toString('utf8'));
  });

  /** Against the project in front, so the window never has to name a folder to
   *  keep something in it. Nothing open means nothing to keep, said by leaving
   *  the preferences as they were. */
  handle<Preferences>(CHANNEL.keepVersion, async (_event, args) => {
    const [versionId, keep] = args;
    const prefs = await preferences();
    const open = projectAt(whereIn(args));
    if (open === null || typeof versionId !== 'string' || typeof keep !== 'boolean') {
      return done(prefs.all());
    }
    return done(await prefs.change({ kept: keeping(prefs.all().kept, open.path, versionId, keep) }));
  });

  handle<Hatches>(CHANNEL.hatches, async () => done({ editor: (await editor())?.name ?? null }));

  /**
   * The escape hatch, D2.
   *
   * `open -a` rather than a CLI shim, and the folder rather than a file: an app
   * launched from the Dock has none of a shell's PATH, so `code` is missing on
   * machines that plainly have VS Code — see src/shell/editors.ts.
   *
   * `shell.openPath` is deliberately not used for the editor case, because it
   * would open the folder in whatever the *system* has associated with folders,
   * which is the Finder, which is the other button.
   */
  handle<null>(CHANNEL.openInEditor, async (_event, args) => {
    const [file] = args;
    const open = projectAt(whereIn(args));
    if (open === null) return fail(NOTHING_OPEN);
    const found = await editor();
    if (found === null) return fail(NO_EDITOR);
    // One file when one was named, and only ever one inside the project — a
    // path from the window is not a path to trust with `open -a`.
    const target = typeof file === 'string' && file !== '' ? inside(open.path, file) : open.path;
    if (target === null) return fail(NOTHING_OPEN);
    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn('open', ['-a', found.bundle, target], { stdio: 'ignore' });
        child.on('error', reject);
        child.on('exit', (code) =>
          code === 0 ? resolve() : reject(new Error(`open exited with ${String(code)}`)),
        );
      });
      return done(null);
    } catch (cause) {
      return fail(couldNotOpenEditor(found.name, cause));
    }
  });

  /** How full the conversation is. Null rather than a failure when there is no
   *  session yet or the model has not answered once — the ring simply has
   *  nothing to draw, which is not something to put a card in front of. */
  handle<Room | null>(CHANNEL.room, async (_event, args) => {
    const where = whereIn(args);
    const open = projectAt(where);
    return done(open === null ? null : sessionAt(open, where)?.room ?? null);
  });

  /** Shorten it now. The window hears about the tidying itself through the
   *  ordinary event stream; this answers with the room there is afterwards. */
  handle<Room | null>(CHANNEL.tidyNow, async (_event, args) => {
    const where = whereIn(args);
    const open = projectAt(where);
    if (open === null) return fail(NOTHING_OPEN);
    const session = workingAt(open, where);
    if (session === null) return done(null);
    const didTidy = await session.tidyNow();
    if (!didTidy) return fail(COULD_NOT_TIDY);
    return done(session.room);
  });

  /** Stop asking, or start again. Session-scoped on purpose: it is not written
   *  down anywhere, so a window opened tomorrow asks again. */
  handle<boolean>(CHANNEL.stopAsking, async (_event, args) => {
    const [on] = args;
    const where = whereIn(args);
    const open = projectAt(where);
    if (open === null) return fail(NOTHING_OPEN);
    if (typeof on !== 'boolean') return fail(NOTHING_OPEN);
    const session = sessionAt(open, where);
    session?.stopAsking(on);
    return done(session?.quiet === true);
  });

  handle<HowFar>(CHANNEL.goAsFarAs, (_event, args) => {
    const [howFar] = args;
    const where = whereIn(args);
    const open = projectAt(where);
    if (open === null) return Promise.resolve(fail(NOTHING_OPEN));
    const rungs: readonly HowFar[] = ['looking', 'asking', 'changing', 'doing'];
    const rung = rungs.find((one) => one === howFar);
    if (rung === undefined) return Promise.resolve(fail(NOTHING_OPEN));
    const session = sessionAt(open, where);
    session?.goAsFarAs(rung);
    return Promise.resolve(done(session?.howFar ?? 'asking'));
  });

  /** What the open project brought with it. Read off the session that is
   *  already running: the list is worked out while its extensions load, so
   *  there is nothing here to go and look up. */
  handle<readonly CarriedExtension[]>(CHANNEL.carried, async (_event, args) => {
    const where = whereIn(args);
    const open = projectAt(where);
    return done(open === null ? [] : sessionAt(open, where)?.carried ?? []);
  });

  /**
   * Say yes to one of them, or take it back.
   *
   * Extensions are decided when a session is built, so the session is built
   * again — the conversation on screen is reopened by its own path, which is
   * the same door "start a new conversation" goes through. Without that the
   * switch would be a promise about the next time somebody opened the folder.
   */
  handle<readonly CarriedExtension[]>(CHANNEL.trustCarried, async (_event, args) => {
    const [id, trust] = args;
    const open = projectAt(whereIn(args));
    if (open === null) return fail(NOTHING_OPEN);
    if (typeof id !== 'string' || id === '' || typeof trust !== 'boolean') return fail(NOTHING_OPEN);

    const file = await preferences();
    await file.change({ trusted: trusting(file.all().trusted, open.path, id, trust) });

    const held = open.held;
    const was = conversationAt(held, whereIn(args));
    const carryOn = was?.held.conversation ?? null;
    if (was !== null) held.sessions.close(was.path);
    const started = await startConversation(open, openingFor(carryOn), was?.path);
    if (!started.ok) return started;
    return done(started.value.session.carried);
  });

  handle<readonly SavedVersion[]>(CHANNEL.saveVersion, async (_event, args) => {
    const [name] = args;
    const open = projectAt(whereIn(args));
    if (open === null) return fail(NOTHING_OPEN);
    try {
      await open.held.timeline.snapshot({
        boundary: 'user-asked',
        by: 'you',
        name: typeof name === 'string' && name.trim() !== '' ? name.trim() : undefined,
        evenIfNothingChanged: true,
      });
      return done(await versionsOf(open.held));
    } catch (cause) {
      const raw = cause instanceof Error ? cause.message : String(cause);
      return fail(plainTrouble(raw, detailsOf(cause)));
    }
  });

  handle<{ looks: readonly Look[]; says: string }>(CHANNEL.checkWidths, async (_event, args) => {
    const open = projectAt(whereIn(args));
    if (open === null) return fail(NOTHING_TO_SHOW);
    let ready;
    try {
      ready = await makeAndServe({ folder: open.path, says: () => undefined });
    } catch (cause) {
      return fail(couldNotShow(cause));
    }
    if (ready.kind !== 'showing') return done({ looks: [], says: ready.question });
    try {
      // The sizes this project designs at, out of its own stylesheets. Three
      // sizes it has never written a line about answer somebody else's question.
      const sizes = sizesFor(await styleSheets(open.path));
      const looks = await lookAtEveryWidth(ready.serving.address, sizes);
      return done({ looks, says: readsWell(looks).says });
    } finally {
      await ready.serving.stop().catch(() => undefined);
    }
  });

  handle<string | null>(CHANNEL.shareReview, async (_event, args) => {
    const open = projectAt(whereIn(args));
    if (open === null) return fail(NOTHING_OPEN);
    const versions = await versionsOf(open.held);
    const changes: Shown[] = versions.slice(0, 12).map((version) => ({
      title: version.title,
      when: version.at,
      says: '',
      before: null,
      after: null,
    }));
    const review: Review = {
      project: open.name,
      made: Date.now(),
      changes,
      spent: null,
    };
    const safe = safeToShare(review);
    if (!safe.ok) {
      return fail({ what: 'I have not made that page.', because: safe.because, actionLabel: 'Got it' });
    }
    const where = await dialog.showSaveDialog(mainWindow ?? undefined!, {
      defaultPath: join(app.getPath('desktop'), `${open.name} — what changed.html`),
      filters: [{ name: 'Web page', extensions: ['html'] }],
    });
    if (where.canceled || where.filePath === undefined) return done(null);
    try {
      await writeFile(where.filePath, reviewPage(review), 'utf8');
      shell.showItemInFolder(where.filePath);
      return done(where.filePath);
    } catch (cause) {
      const raw = cause instanceof Error ? cause.message : String(cause);
      return fail(plainTrouble(raw, detailsOf(cause)));
    }
  });

  /* ------------------------------------------------------------ landing it */

  handle<Landing>(CHANNEL.landing, async (_event, args) => {
    const open = projectAt(whereIn(args));
    if (open === null) return fail(NOTHING_OPEN);
    return done(await landingNow(open.path, open.held));
  });

  handle<Preferences>(CHANNEL.setHoldBack, async (_event, args) => {
    const [on] = args;
    if (typeof on !== 'boolean') return fail(NOTHING_OPEN);
    const open = projectAt(whereIn(args));
    if (open === null) return fail(NOTHING_OPEN);
    const held = (await preferences()).all().heldBack;
    return done(await (await preferences()).change({ heldBack: { ...held, [open.path]: on } }));
  });

  handle<Decided>(CHANNEL.decideOnWork, async (_event, args) => {
    const [letIn] = args;
    const open = projectAt(whereIn(args));
    if (open === null) return fail(NOTHING_OPEN);
    const waiting = open.held.waiting;

    const asItStands = async (undoTo: string | null): Promise<Decided> => ({
      landing: await landingNow(open.path, open.held),
      versions: await versionsOf(open.held).catch(() => []),
      letIn: letIn === true,
      undoTo,
    });

    if (waiting === null || waiting.waiting.version === null) {
      return done(await asItStands(null));
    }

    if (letIn !== true) {
      // Nothing moves. The work is kept reachable rather than thrown away, so
      // "bring it back" is the ordinary put-back and nothing special.
      const version = waiting.setAside();
      open.held.waiting = null;
      open.held.pictures = null;
      return done(await asItStands(version));
    }

    try {
      // Anything unfinished in the folder becomes a version first, the same way
      // going back does, so letting work in can never write over it.
      await open.held.timeline.snapshot({ boundary: 'turn-ended' });
      const outcome = await waiting.approve(saysHeldWork(waiting.waiting.doing));
      open.held.waiting = null;
      open.held.pictures = null;
      return done(await asItStands(outcome?.undoTo ?? null));
    } catch (cause) {
      return fail(historyTrouble(cause));
    }
  });

  /** Composed once: both of the verbs below are the only two in this file that
   *  can put something on the internet, and they refuse identically. */
  const notPressed: Trouble = {
    what: 'Nothing has left this computer.',
    because: 'This only ever happens from a press, and I did not get one.',
    actionLabel: 'Got it',
  };
  const alreadyGoing: Trouble = {
    what: 'I am already sending something.',
    because: 'Let this one finish and then ask again.',
    actionLabel: 'Got it',
  };

  handle<HandedOver>(CHANNEL.handToDeveloper, async (_event, args) => {
    const [confirmed] = args;
    if (confirmed !== true) return fail(notPressed);
    const open = projectAt(whereIn(args));
    if (open === null) return fail(NOTHING_OPEN);
    if (open.held.sending) return fail(alreadyGoing);

    open.held.sending = true;
    try {
      const changes = await whatChanged(open);
      const newest = await open.held.timeline.currentVersion().catch(() => null);
      const handed = await handToDeveloper({
        history: new ProjectHistory(open.path),
        folder: open.path,
        name: open.name,
        under: workFolder(),
        title: newest?.title ?? changes[changes.length - 1]?.title ?? open.name,
        changes,
        at: Date.now(),
      });
      // What this computer can reach may well have changed by doing it.
      reached.delete(open.path);
      return done(handed);
    } catch (cause) {
      if (cause instanceof HandoverError) {
        return fail({
          what: handoverWords.couldNotSend,
          because: cause.message,
          actionLabel: 'Got it',
          ...(cause.details.trim() === '' ? {} : { details: cause.details }),
        });
      }
      return fail(historyTrouble(cause));
    } finally {
      open.held.sending = false;
    }
  });

  handle<WentOnline>(CHANNEL.putOnline, async (_event, args) => {
    const [confirmed] = args;
    if (confirmed !== true) return fail(notPressed);
    const open = projectAt(whereIn(args));
    if (open === null) return fail(NOTHING_OPEN);
    if (open.held.sending) return fail(alreadyGoing);

    open.held.sending = true;
    try {
      return done(await putOnline({ folder: open.path, says: tell }));
    } catch (cause) {
      if (cause instanceof OnlineError) {
        return fail({
          what: onlineWords.couldNotPut,
          because: cause.message,
          actionLabel: 'Got it',
          ...(cause.details.trim() === '' ? {} : { details: cause.details }),
        });
      }
      return fail(couldNotShow(cause));
    } finally {
      open.held.sending = false;
      tell({ says: showSays.ready, done: true });
    }
  });

  /* ------------------------------------------- while you are not looking */

  handle<Away>(CHANNEL.away, async (_event, args) => {
    const open = projectAt(whereIn(args));
    if (open === null) return fail(NOTHING_OPEN);
    // Read before answering, so the first ask of a launch is not told there are
    // no repeats when there are.
    await standingFile().catch(() => null);
    // Asking is coming back to it, so whatever was waiting has now been seen.
    const answer = awayNow(open.path);
    const desk = awayDesks.get(open.path);
    if (desk !== undefined) desk.unseen = false;
    return done(answer);
  });

  handle<Away>(CHANNEL.keepGoing, async (_event, args) => {
    const [text, untilDone] = args;
    const open = projectAt(whereIn(args));
    if (open === null) return fail(NOTHING_OPEN);
    if (typeof text !== 'string' || text.trim() === '') return done(awayNow(open.path));
    await keepGoing(open.path, open.name, text, null, untilDone === true);
    return done(awayNow(open.path));
  });

  handle<Away>(CHANNEL.startAfter, async (_event, args) => {
    const [text, after] = args;
    const open = projectAt(whereIn(args));
    if (open === null) return fail(NOTHING_OPEN);
    if (typeof text !== 'string' || text.trim() === '' || typeof after !== 'string') {
      return done(awayNow(open.path));
    }
    const because = await keepGoing(open.path, open.name, text, after);
    if (because !== null) return fail(couldNotWait(because));
    return done(awayNow(open.path));
  });

  /** Change what one waits for, or let it off its wait. Only work that has not
   *  started: what is already going cannot be made to wait for anything. */
  handle<Away>(CHANNEL.putAfter, async (_event, args) => {
    const [id, after] = args;
    const open = projectAt(whereIn(args));
    if (open === null) return fail(NOTHING_OPEN);
    const desk = awayDesks.get(open.path);
    if (desk === undefined || typeof id !== 'string') return done(awayNow(open.path));

    if (after === null) {
      const held = desk.chain.take(id);
      if (held === null) return done(awayNow(open.path));
      desk.after.delete(id);
      desk.bench.ask(held.doing, { id: held.id, at: held.at });
      noteDown(desk, id);
      pushAway(open.path);
      await runWhatCan(desk);
      return done(awayNow(open.path));
    }
    if (typeof after !== 'string') return done(awayNow(open.path));

    const allowed = desk.chain.could(id, after);
    if (!allowed.ok) return fail(couldNotWait(allowed.because));

    const was = pieceFor(desk, id);
    if (was === null) return done(awayNow(open.path));
    desk.chain.take(id);
    void desk.bench.drop(id);

    // Nothing left to wait for, or nothing that would hold: either way it goes
    // back on the board and takes its turn there.
    const asked = desk.chain.hold({ id, doing: was.doing, at: was.at, after });
    if (asked.ok) desk.after.set(id, after);
    if (!asked.ok || !asked.waits) desk.bench.ask(was.doing, { id, at: was.at });
    noteDown(desk, id);
    pushAway(open.path);
    if (!asked.ok) return fail(couldNotWait(asked.because));
    if (!asked.waits) await runWhatCan(desk);
    return done(awayNow(open.path));
  });

  handle<Away>(CHANNEL.stopAway, async (_event, args) => {
    const [id] = args;
    const open = projectAt(whereIn(args));
    if (open === null) return fail(NOTHING_OPEN);
    const desk = awayDesks.get(open.path);
    if (desk === undefined || typeof id !== 'string') return done(awayNow(open.path));
    const run = desk.runs.get(id);
    // Turned down rather than left hanging, and only ever down.
    run?.held.stop();
    void run?.session?.stop();
    run?.session?.dispose();
    desk.runs.delete(id);
    desk.chain.take(id);
    await desk.bench.drop(id);
    forgetNote(desk, id);
    // Nothing that was waiting for this one can happen now, so it says so rather
    // than sitting on the board waiting for something that will never come.
    stopWhatFollows(desk, id, afterWords.thrownAway);
    await runWhatCan(desk);
    return done(awayNow(open.path));
  });

  handle<Away>(CHANNEL.keepAway, async (_event, args) => {
    const [id] = args;
    const open = projectAt(whereIn(args));
    if (open === null) return fail(NOTHING_OPEN);
    const desk = awayDesks.get(open.path);
    if (desk === undefined || typeof id !== 'string') return done(awayNow(open.path));
    const piece = desk.bench.pieces.find((one) => one.id === id);
    if (piece === undefined) return done(awayNow(open.path));
    try {
      // Anything unfinished in the folder becomes a version first, the same way
      // going back does, so keeping this can never write over it.
      await open.held.timeline.snapshot({ boundary: 'turn-ended' }).catch(() => null);
      await desk.bench.keep(id, saysHeldWork(piece.doing));
      desk.runs.delete(id);
      forgetNote(desk, id);
    } catch (cause) {
      return fail(historyTrouble(cause));
    }
    return done(awayNow(open.path));
  });

  /**
   * A person answering a question one of those runs stopped on.
   *
   * The only door. Everything else about an unattended run either records a
   * question or turns it down; nothing else can say yes, and this cannot say
   * yes without a person having pressed the button that sends it.
   */
  handle<Away>(CHANNEL.answerAway, async (_event, args) => {
    const [id, callId, decision] = args;
    const open = projectAt(whereIn(args));
    if (open === null) return fail(NOTHING_OPEN);
    if (
      typeof id !== 'string' ||
      typeof callId !== 'string' ||
      (decision !== 'yes' && decision !== 'no')
    ) {
      return done(awayNow(open.path));
    }
    const desk = awayDesks.get(open.path);
    const run = desk?.runs.get(id);
    const piece = desk?.bench.pieces.find((one) => one.id === id);
    if (run === undefined || desk === undefined || piece === undefined) {
      return done(awayNow(open.path));
    }
    run.held.answer(callId, decision as Decision);
    if (!run.held.isWaiting && piece.state === 'needs-you') piece.state = 'running';
    noteDown(desk, id);
    return done(awayNow(open.path));
  });

  handle<Away>(CHANNEL.addRepeat, async (_event, args) => {
    const [doing, every, at, on] = args;
    const open = projectAt(whereIn(args));
    if (open === null) return fail(NOTHING_OPEN);
    const repeat = asRepeat(every, at, on);
    if (typeof doing !== 'string' || doing.trim() === '' || repeat === null) {
      return done(awayNow(open.path));
    }
    let because: string | null = null;
    await changeStanding((all) => {
      const asked = addStanding(all, {
        id: `every-${Date.now().toString(36)}`,
        project: open.path,
        doing,
        repeat,
        at: Date.now(),
      });
      because = asked.because;
      return asked.all;
    });
    if (because !== null) {
      return fail({ what: 'I did not add that.', because, actionLabel: 'Got it' });
    }
    return done(awayNow(open.path));
  });

  handle<Away>(CHANNEL.switchRepeat, async (_event, args) => {
    const [id, on] = args;
    const open = projectAt(whereIn(args));
    if (open === null) return fail(NOTHING_OPEN);
    if (typeof id === 'string' && typeof on === 'boolean') {
      await changeStanding((all) => switchStanding(all, id, on));
      if (!standingNow.some((one) => one.on)) stopWatchingTheClock();
    }
    return done(awayNow(open.path));
  });

  handle<Away>(CHANNEL.forgetRepeat, async (_event, args) => {
    const [id] = args;
    const open = projectAt(whereIn(args));
    if (open === null) return fail(NOTHING_OPEN);
    if (typeof id === 'string') await changeStanding((all) => withoutStanding(all, id));
    if (!standingNow.some((one) => one.on)) stopWatchingTheClock();
    return done(awayNow(open.path));
  });

  handle<OpenedProject>(CHANNEL.openConversation, async (_event, args) => {
    const [path] = args;
    const open = projectAt(whereIn(args));
    if (open === null) return fail(NOTHING_OPEN);
    // The one already open stays open. Moving between conversations is moving
    // between things that are both still going on, and the ledger belongs to the
    // sitting rather than to either of them, so it stays too.
    //
    // No path is somebody pressing "new" — a conversation started, not the last
    // one carried on, which is what opening the project already does.
    const started = await startConversation(open, openingFor(path, true));
    if (!started.ok) return started;
    // Making a checkout conversation the one in front brings its work home so
    // the folder the window reads is the work it has done so far. If it cannot
    // come home (a conflict with the folder's own version), the conversation
    // still opens and its work stays in its checkout until it settles.
    const checkout = open.held.checkouts.get(started.value.address) ?? null;
    if (checkout !== null) {
      await bringBack(gitRunHereFor(), open.path, checkout.folder).catch(() => undefined);
    }
    return done({
      path: open.path,
      name: open.name,
      history: started.value.session.history,
      conversation: started.value.session.conversation,
      address: started.value.address,
    });
  });

  /**
   * Put a conversation down.
   *
   * Closing is closing a view. Nothing is thrown away — it stays written down
   * exactly as it was, and opening it again carries on from the last word.
   */
  handle<null>(CHANNEL.closeConversation, (_event, args) => {
    const where = whereIn(args);
    const open = projectAt(where);
    if (open === null) return Promise.resolve(fail(NOTHING_OPEN));
    const found = conversationAt(open.held, where);
    if (found !== null) open.held.sessions.close(found.path);
    return Promise.resolve(done(null));
  });

  /** Throw a conversation away. Closing only puts the view down; this removes
   *  the file so a long-lived install does not fill the disk with old ones. */
  handle<readonly Conversation[]>(CHANNEL.deleteConversation, async (_event, args) => {
    const [path] = args;
    const open = projectAt(whereIn(args));
    if (open === null) return fail(NOTHING_OPEN);
    if (typeof path !== 'string' || path.trim() === '') {
      return fail({
        what: 'I could not tell which conversation you meant.',
        because: 'Nothing was named.',
        actionLabel: 'Got it',
      });
    }
    const target = resolve(path);
    // Only files under the app's own transcript folder. A path that points
    // somewhere else is not a conversation of ours, and deleting it would be.
    const root = resolve(sessionsFolder());
    if (target !== root && !target.startsWith(`${root}${sep}`)) {
      return fail({
        what: 'That is not one of your conversations.',
        because: 'I only throw away files I wrote myself.',
        actionLabel: 'Got it',
      });
    }
    // Drop any live session on this file first so nothing is still writing it.
    for (const one of open.held.sessions.open) {
      const file = one.held.conversation;
      if (one.path === target || (file !== null && resolve(file) === target)) {
        await one.held.stop().catch(() => undefined);
        open.held.sessions.close(one.path);
      }
    }
    try {
      await rm(target, { force: true });
      await rm(`${target}.bak`, { force: true }).catch(() => undefined);
    } catch (cause) {
      return fail({
        what: 'I could not throw that conversation away.',
        because: 'This computer would not let me remove the file.',
        actionLabel: 'Got it',
        details: detailsOf(cause),
      });
    }
    return done(await listConversations(open.path, sessionsFolder()));
  });

  /** One shelf per run. Building it reads settings off disk, and the screen it
   *  feeds is opened over and over. */
  let shelf: Awaited<ReturnType<typeof openShelf>> | null = null;
  const openShelf = async () => {
    const folder = workspaces.current?.path ?? app.getPath('home');
    return packageShelf(await packageHost(await defaultAgentDir(), folder));
  };
  const theShelf = async () => (shelf ??= await openShelf());

  handle<InStep>(CHANNEL.inStep, async (_event, args) => {
    const open = projectAt(whereIn(args));
    if (open === null) return done(inStepOf(null));
    return done(inStepOf((await followed()).for(open.path)));
  });

  handle<InStep>(CHANNEL.followDesign, async (_event, args) => {
    const [address] = args;
    const open = projectAt(whereIn(args));
    if (open === null) return fail(NOTHING_OPEN);
    if (typeof address !== 'string' || address.trim() === '') return fail(NOTHING_OPEN);

    const read = figmaReading();
    if (read === null) return fail(NO_FIGMA);

    try {
      const following = await follow(address, read);
      // What is there when somebody points at it is what the work is built
      // from. Everything after this is measured against this moment.
      const held: HeldDesign = {
        id: following.fileKey,
        name: following.name,
        url: following.url,
        fileKey: following.fileKey,
        design: following.design,
        latest: following.design,
        readAt: Date.now(),
      };
      return done(inStepOf(await (await followed()).keep(open.path, held)));
    } catch (cause) {
      return fail(figmaTrouble(cause));
    }
  });

  handle<InStep>(CHANNEL.lookAgain, async (_event, args) => {
    const open = projectAt(whereIn(args));
    if (open === null) return fail(NOTHING_OPEN);
    const file = await followed();
    const held = file.for(open.path);
    if (held === null) return done(inStepOf(null));

    const read = figmaReading();
    if (read === null) return done(inStepOf(held, NO_FIGMA.because));

    try {
      const latest = await read({
        fileKey: held.fileKey,
        nodeId: parseFigmaUrl(held.url)?.nodeId ?? null,
      });
      const next: HeldDesign = { ...held, latest, readAt: Date.now() };
      return done(inStepOf(await file.keep(open.path, next)));
    } catch (cause) {
      // The band is already on screen and can say why the look did not happen.
      return done(inStepOf(held, saidBy(cause)));
    }
  });

  handle<InStep>(CHANNEL.caughtUp, async (_event, args) => {
    const open = projectAt(whereIn(args));
    if (open === null) return fail(NOTHING_OPEN);
    const file = await followed();
    const held = file.for(open.path);
    if (held === null) return done(inStepOf(null));
    return done(inStepOf(await file.keep(open.path, { ...held, design: held.latest })));
  });

  handle<InStep>(CHANNEL.stopFollowing, async (_event, args) => {
    const open = projectAt(whereIn(args));
    if (open === null) return done(inStepOf(null));
    await (await followed()).forget(open.path);
    return done(inStepOf(null));
  });

  handle<readonly Pack[]>(CHANNEL.packages, async (_event, args) => {
    const [term] = args;
    try {
      const asked = typeof term === 'string' ? term.trim() : '';
      const found = await (await theShelf())[asked === '' ? 'mine' : 'browse'](asked);
      return done(found);
    } catch (cause) {
      const raw = cause instanceof Error ? cause.message : String(cause);
      return fail(plainTrouble(raw, detailsOf(cause)));
    }
  });

  handle<readonly Pack[]>(CHANNEL.addPackage, async (_event, args) => {
    const [id] = args;
    if (typeof id !== 'string' || id === '') return fail(NOTHING_OPEN);
    const shelved = await theShelf();
    const added = await shelved.add(id);
    if (!added.ok) {
      return fail({ what: 'I could not add that.', because: added.why, actionLabel: 'Got it' });
    }
    return done(await shelved.mine());
  });

  handle<readonly Pack[]>(CHANNEL.removePackage, async (_event, args) => {
    const [id] = args;
    if (typeof id !== 'string' || id === '') return fail(NOTHING_OPEN);
    const shelved = await theShelf();
    await shelved.remove(id);
    return done(await shelved.mine());
  });

  handle<string>(CHANNEL.explainPackage, async (_event, args) => {
    const [id] = args;
    if (typeof id !== 'string' || id === '') return fail(NOTHING_OPEN);
    const where = whereIn(args);
    const open = projectAt(where);
    const agent = open === null ? null : sessionAt(open, where);
    if (agent === null) {
      return done(
        'Open a project first and I will read this one and tell you what it does.',
      );
    }
    const found = (await (await theShelf()).mine()).find((one) => one.id === id) ?? null;
    if (found === null) return done(WARNING);
    // Asked and answered inside the conversation, because that is where the
    // model already is. The window shows it beside the row it asked about.
    await agent.prompt(askAbout(found));
    return done('Asked — the answer is in the conversation.');
  });

  handle<readonly Conversation[]>(CHANNEL.conversations, async (_event, args) => {
    const open = projectAt(whereIn(args));
    if (open === null) return done([]);
    return done(await listConversations(open.path, sessionsFolder()));
  });

  handle<null>(CHANNEL.revealFolder, async (_event, args) => {
    const open = projectAt(whereIn(args));
    if (open === null) return fail(NOTHING_OPEN);
    // Opens the folder itself rather than selecting it in its parent. Somebody
    // asking to see their project wants to be inside it.
    const trouble = await shell.openPath(open.path);
    if (trouble !== '') {
      return fail({
        what: 'I could not open that folder.',
        because: 'This computer would not show it to me just now.',
        actionLabel: 'Got it',
        details: trouble,
      });
    }
    return done(null);
  });

  handle<readonly Page[]>(CHANNEL.pages, async (_event, args) => {
    const open = projectAt(whereIn(args));
    if (open === null) return done([]);
    return done(pagesIn(await filesUnder(open.path)));
  });

  handle<ShowOutcome>(CHANNEL.show, async (_event, args) => {
    const [at] = args;
    const open = projectAt(whereIn(args));
    if (open === null) return fail(NOTHING_TO_SHOW);

    // One at a time per project. Pressing it again means "show me what it looks
    // like now", so the old one goes and a new one takes its place.
    await open.held.serving?.stop();
    open.held.serving = null;

    try {
      const outcome = await makeAndServe({
        folder: open.path,
        says: tell,
        // Every serving can be pointed at; the page only listens once the
        // address says so, which is what the button does.
        onPointed: (pointed: Pointed) => sayPointed(open.path, pointed),
      });
      if (outcome.kind === 'unsure') return done({ kind: 'unsure', question: outcome.question });
      open.held.serving = outcome.serving;
      // The page belongs inside this app now, drawn in the pane beside the
      // conversation. The window points the pane at the served address and
      // opens it; nothing opens in a separate browser window. Pointing is
      // already wired into the pane's view, so only the address needs to
      // travel back.
      const address = atPage(outcome.serving.address, at);
      return done({ kind: 'showing', name: open.name, address });
    } catch (cause) {
      return fail(couldNotShow(cause));
    }
  });

  /* Several designs of the same thing, each served on its own address so the
     pane can switch between them. Every folder is read and served the way a
     single “See it” is — nothing here invents a server or opens a project wide. */
  handle<VariationsOutcome>(CHANNEL.variationsServe, async (_event, args) => {
    const open = projectAt(whereIn(args));
    if (open === null) return fail(NOTHING_TO_SHOW);
    const spec = Array.isArray(args) ? (args[0] as { subject?: unknown; variations?: unknown } ?? null) : null;
    const subject = typeof spec?.subject === 'string' ? spec.subject : '';
    const variations =
      Array.isArray(spec?.variations) && subject !== ''
        ? (spec.variations as VariationSpec[]).filter(
            (one) => one && typeof one.folder === 'string' && one.folder !== '' &&
              typeof one.id === 'string' && typeof one.name === 'string',
          )
        : [];
    if (variations.length === 0) {
      return fail({
        what: 'There are no variations to look at.',
        because: 'Tell me you want a few designs of something, and it can make them.',
        actionLabel: 'Got it',
      });
    }

    // Make ready the earlier set — a new set replaces the old, like “See it”.
    for (const served of open.held.variations) await served.stop().catch(() => undefined);
    open.held.variations = [];

    const ready: { id: string; name: string; address: string }[] = [];
    for (const one of variations) {
      try {
        const outcome = await makeAndServe({
          folder: one.folder,
          says: tell,
          onPointed: (pointed: Pointed) => sayPointed(open.path, pointed),
        });
        if (outcome.kind === 'unsure') {
          // One variation that cannot be read holds nothing up: it is skipped,
          // and the rest still show.
          continue;
        }
        open.held.variations = [...open.held.variations, outcome.serving];
        ready.push({ id: one.id, name: one.name, address: outcome.serving.address });
      } catch {
        // Keep going past one that will not build. A comparison never needs
        // every frame to be useful.
        continue;
      }
    }
    return done({ kind: 'showing', subject, variations: ready });
  });

  handle<readonly Skill[]>(CHANNEL.skills, async (_event, args) => {
    const open = projectAt(whereIn(args));
    const skills = await availableSkills(open?.path ?? null, await defaultAgentDir());
    return done(skills);
  });

  /* The `/word` ways of working. The body stays here — the window gets only
     what it needs to list them in a `/` menu and to hold the typed words. */
  handle<readonly Workflow[]>(CHANNEL.workflows, async (_event, args) => {
    const open = projectAt(whereIn(args));
    const all = await availableWorkflows(open?.path ?? null, await defaultAgentDir());
    return done(
      all.map(({ command, name, description, hint, source }) => ({ command, name, description, hint, source })),
    );
  });

  /* One conversation, its own checkout. These run the front project's own git,
     so a technical user can keep parallel work in its own branch and merge it
     back — and the guards (never flatten a dirty checkout) are the same ones
     the parallel-session wiring will lean on. */

  handle<{ folder: string; branch: string }>(CHANNEL.worktreeStart, async (_event, args) => {
    const open = projectAt(whereIn(args));
    if (open === null) return fail(NOTHING_OPEN);
    const made = await createWorktree(
      gitRunHereFor(),
      open.path,
      `conversation-${Date.now().toString(36)}`,
      null,
    );
    if (!made.ok) return fail(worktreeTrouble(made.because));
    return made.value === null ? fail(worktreeTrouble('Could not make a checkout.')) : done(made.value);
  });

  handle<null>(CHANNEL.worktreeLand, async (_event, args) => {
    const open = projectAt(whereIn(args));
    if (open === null) return fail(NOTHING_OPEN);
    const folder = firstWorktree(await listWorktrees(open.path));
    if (folder === null) return fail(worktreeTrouble('No checkout of this project to bring back.'));
    const landed = await landWorktree(gitRunHereFor(), open.path, folder);
    return landed.ok ? done(null) : fail(worktreeTrouble(landed.because));
  });

  handle<null>(CHANNEL.worktreeDrop, async (_event, args) => {
    const open = projectAt(whereIn(args));
    if (open === null) return fail(NOTHING_OPEN);
    const folder = firstWorktree(await listWorktrees(open.path));
    if (folder === null) return fail(worktreeTrouble('No checkout of this project to throw away.'));
    const dropped = await dropWorktree(gitRunHereFor(), open.path, folder);
    return dropped.ok ? done(null) : fail(worktreeTrouble(dropped.because));
  });

  /* -------------------------------------------------- document to build */
  /* The document that started a build, kept so a resumed session knows what it
     was building, and the plan that turns it into tasks. Stored outside the
     project so nothing it contains appears in the folder the person watches. */
  async function readBuildPlan(project: string): Promise<import('../src/lib/ipc').BuildPlan | null> {
    const raw = await readFile(buildPlanFile(project), 'utf8').catch(() => null);
    if (raw === null) return null;
    try {
      const stored = JSON.parse(raw) as {
        source: string;
        tasks?: unknown;
      };
      if (typeof stored?.source !== 'string') return null;
      const tasks = readPlan(stored.tasks);
      const next = tasks.find((one) => one.status !== 'done')?.n ?? null;
      return {
        source: stored.source,
        tasks: tasks.map(toWindowTask),
        next,
        done: tasks.filter((one) => one.status === 'done').length,
        total: tasks.length,
      };
    } catch {
      return null;
    }
  }

  /** The stored plan whole: its source name and the real task list, so a step
   *  can be advanced and written back without losing anything the window shape
   *  leaves out. */
  async function readStoredTasks(project: string): Promise<{ source: string; tasks: readonly Task[] } | null> {
    const raw = await readFile(buildPlanFile(project), 'utf8').catch(() => null);
    if (raw === null) return null;
    try {
      const stored = JSON.parse(raw) as { source?: unknown; tasks?: unknown };
      if (typeof stored?.source !== 'string') return null;
      const tasks = readPlan(stored.tasks);
      if (tasks.length === 0) return null;
      return { source: stored.source, tasks };
    } catch {
      return null;
    }
  }

  async function writeBuildPlan(project: string, source: string, tasks: readonly Task[]): Promise<void> {
    const file = buildPlanFile(project);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, `${JSON.stringify({ source, tasks }, null, 2)}\n`, 'utf8');
  }

  function toWindowTask(one: Task): import('../src/lib/ipc').BuildTask {
    return {
      n: one.n,
      title: one.title,
      acceptance: one.acceptance,
      test: one.test,
      status: one.status,
      note: one.note,
    };
  }

  handle<import('../src/lib/ipc').BuildPlan | null>(CHANNEL.buildPlan, async (_event, args) => {
    const open = projectAt(whereIn(args));
    return done(open === null ? null : await readBuildPlan(open.path));
  });

  handle<{ name: string; text: string } | null>(CHANNEL.chooseDocument, async (_event, _args) => {
    if (mainWindow === null || mainWindow.isDestroyed()) return fail(PICKER_FAILED);
    const picked = await dialog.showOpenDialog(mainWindow, {
      title: 'Which requirements document?',
      buttonLabel: 'Build from this',
      properties: ['openFile'],
      filters: [
        { name: 'Documents', extensions: ['md', 'txt', 'markdown', 'rst', 'html'] },
      ],
    });
    const file = picked.filePaths[0];
    if (picked.canceled || file === undefined) return done(null);
    const text = await readFile(file, 'utf8').catch(() => '');
    if (text === '') return fail({ what: 'I could not read that document.', because: 'It may be empty or not plain text.', actionLabel: 'Got it' });
    return done({ name: basename(file), text });
  });

  handle<import('../src/lib/ipc').BuildPlan>(CHANNEL.buildStart, async (_event, args) => {
    const [sourceRaw] = args;
    const open = projectAt(whereIn(args));
    if (open === null) return fail(NOTHING_OPEN);
    if (typeof sourceRaw !== 'object' || sourceRaw === null) return fail(NOTHING_OPEN);
    const source = sourceRaw as { name?: unknown; text?: unknown; instruction?: unknown };
    const name = typeof source.name === 'string' ? source.name : 'A document';
    if (typeof source.text !== 'string') return fail(NOTHING_OPEN);
    // Start the plan empty — the planning turn that fills it runs in the
    // conversation, where its steps show themselves before anything changes.
    await writeBuildPlan(open.path, name, []);
    const read = await readBuildPlan(open.path);
    return done(read ?? { source: name, tasks: [], next: null, done: 0, total: 0 });
  });

  handle<import('../src/lib/ipc').BuildPlan | null>(CHANNEL.buildSave, async (_event, args) => {
    const [stepsRaw] = args;
    const open = projectAt(whereIn(args));
    if (open === null) return fail(NOTHING_OPEN);
    // A document-to-build brings its own plan; a plan approved in the
    // conversation creates one of its own when there is none yet — a normal
    // long task gets the same checklist above the box.
    const prior = await readBuildPlan(open.path);
    const source = prior?.source ?? 'The plan';
    const steps = Array.isArray(stepsRaw)
      ? (stepsRaw as { title?: unknown; acceptance?: unknown }[])
      : [];
    const tasks: Task[] = steps
      .map((one, index) => ({
        n: index + 1,
        title: typeof one.title === 'string' ? one.title : 'A step',
        acceptance:
          typeof one.acceptance === 'string' ? one.acceptance : '',
        test: null,
        status: 'pending' as const,
        note: null,
      }))
      .filter((one) => one.title.trim() !== '');
    if (tasks.length === 0) return done(prior);
    await writeBuildPlan(open.path, source, tasks);
    return done(await readBuildPlan(open.path));
  });

  /* The tracker's own step, as the run goes: close the task a settled turn
     finished, or add tasks for requirements found while building. */
  handle<import('../src/lib/ipc').BuildPlan | null>(CHANNEL.buildAdvance, async (_event, args) => {
    const [opRaw] = args;
    const open = projectAt(whereIn(args));
    if (open === null) return fail(NOTHING_OPEN);
    const stored = await readStoredTasks(open.path);
    if (stored === null) return fail(NOTHING_OPEN);
    const op = opRaw as import('../src/lib/ipc').BuildAdvance | null;
    if (op === null || typeof op !== 'object') return fail(NOTHING_OPEN);
    let tasks: readonly Task[] = stored.tasks;
    if (op.kind === 'start') {
      tasks = startTask(stored.tasks);
    } else if (op.kind === 'finish') {
      tasks = finishTask(stored.tasks, op.ok !== false);
    } else if (op.kind === 'add' && Array.isArray(op.titles)) {
      tasks = addTasks(stored.tasks, op.titles.filter((one) => typeof one === 'string'));
    }
    await writeBuildPlan(open.path, stored.source, tasks);
    return done(await readBuildPlan(open.path));
  });

  handle<string>(CHANNEL.skillText, async (_event, args) => {
    const [id] = args;
    if (typeof id !== 'string' || id === '') return fail(NOTHING_OPEN);
    const open = projectAt(whereIn(args));
    const skill = await skillNamed(open?.path ?? null, await defaultAgentDir(), id);
    if (skill === null) {
      return fail({
        what: 'That skill is no longer installed.',
        because: 'The library changed since it was opened, so I did not read a different file by mistake.',
        actionLabel: 'Refresh skills',
      });
    }
    try {
      return done(await skillContents(skill));
    } catch (cause) {
      return fail(plainTrouble('I could not open that skill.', detailsOf(cause)));
    }
  });

  handle<null>(CHANNEL.prompt, async (_event, args) => {
    const [textIn, attachments, ways] = args;
    if (typeof textIn !== 'string' || textIn.trim() === '') return done(null);
    let text = textIn;
    const where = whereIn(args);
    const open = projectAt(where);
    const conversation = open === null ? null : conversationAt(open.held, where);
    if (open === null || conversation === null) return fail(NOTHING_OPEN);
    // Saying something is the clearest sign of which conversation is being
    // worked in, so it is the one that keeps its place.
    open.held.sessions.resume(conversation.path);
    const agent = conversation.held;
    // A `/word` at the start is a workflow, not a sentence. Turn it into the
    // workflow's own prompt before it goes anywhere, so a workflow is exactly
    // the file that named it and the words somebody typed after it. Anything
    // that is not a known `/word` is left as the plain message it looks like.
    const leadingSlash = /^\/([a-z][a-z0-9-]*)(?:\s|$)/i.exec(text);
    if (leadingSlash !== null) {
      const workflow = await workflowNamed(
        open.path,
        await defaultAgentDir(),
        leadingSlash[1] ?? '',
      );
      if (workflow !== null) {
        const rest = text.slice((leadingSlash[1]?.length ?? 0) + 1).trim();
        if (workflow.hint !== null && rest === '') {
          return fail({
            what: `Say what you want ${workflow.command} to do.`,
            because: workflow.hint,
            actionLabel: 'Got it',
          });
        }
        text = promptFor(workflow, rest);
      }
    }
    // A new turn is a new thing started, which is the one thing the ceiling
    // refuses. Whatever was running finished and was saved to get here.
    const ceiling = fleet.status;
    if (ceiling !== null && !ceiling.allowsNewWork) {
      const said = limitReached(ceiling);
      return fail({ what: said.title, because: said.body, actionLabel: 'Got it' });
    }
    // Their own words, kept for the sentence beside the pictures. The same
    // sentence the version timeline writes for the same moment — see
    // src/diff/summary.ts.
    open.held.looking.instruction = text;
    try {
      const lookFirst =
        ways !== null && typeof ways === 'object' && (ways as PromptOptions).lookFirst === true;
      const queue =
        ways !== null && typeof ways === 'object' && (ways as PromptOptions).queue === 'followUp'
          ? ('followUp' as const)
          : undefined;
      // Checked first, when they have asked for that and nothing is already
      // waiting. Two pieces of work waiting at once is a decision nobody made.
      if ((await preferences()).all().heldBack[open.path] === true && open.held.waiting === null) {
        return await checkItFirst(
          open,
          { address: conversation.path },
          text,
          imageCards(attachments),
          lookFirst,
        );
      }
      // `@name` is a deliberate, per-turn selection — stronger than hoping a
      // model notices a description in the system prompt. Keep the original
      // words visible in the thread, but give the agent the selected complete
      // instructions. This also makes a project-local skill safe to use without
      // turning on passive loading of every instruction a cloned folder carries.
      const selected = await selectedSkills(open.path, await defaultAgentDir(), text);
      const loaded = await Promise.all(
        selected.map(async (skill) => ({ skill, text: await skillContents(skill).catch(() => '') })),
      );
      const chosen = loaded.filter((one) => one.text !== '').slice(0, 4);
      const withSkills =
        chosen.length === 0
          ? text
          : `${text}\n\n<graphe-selected-skills>\n${chosen
              .map(
                ({ skill, text: instructions }) =>
                  `The user explicitly selected @${skill.handle}. Follow these instructions for this request:\n<skill name="${skill.name}">\n${instructions.slice(0, 50000)}\n</skill>`,
              )
              .join('\n\n')}\n</graphe-selected-skills>`;
      await agent.prompt(withSkills, imageCards(attachments), { lookFirst, queue });
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

  handle<null>(CHANNEL.steer, async (_event, args) => {
    const [text] = args;
    if (typeof text !== 'string' || text.trim() === '') return done(null);
    const where = whereIn(args);
    const open = projectAt(where);
    if (open === null) return fail(NOTHING_OPEN);
    const session = sessionAt(open, where);
    if (session === null) return fail(NOTHING_OPEN);
    try {
      await session.steer(text);
      return done(null);
    } catch (cause) {
      const raw = cause instanceof Error ? cause.message : String(cause);
      return fail(plainTrouble(raw, detailsOf(cause)));
    }
  });

  handle<null>(CHANNEL.stop, async (_event, args) => {
    const where = whereIn(args);
    const open = projectAt(where);
    if (open !== null) await sessionAt(open, where)?.stop();
    return done(null);
  });

  handle<boolean>(CHANNEL.answer, async (_event, args) => {
    const [callId, decision] = args;
    if (typeof callId !== 'string' || (decision !== 'yes' && decision !== 'no')) return done(false);
    const where = whereIn(args);
    const open = projectAt(where);
    const agent = open === null ? null : sessionAt(open, where);
    return done(agent?.answer(callId, decision as Decision) ?? false);
  });

  /**
   * The full-size pair, fetched at the moment somebody opens a strip.
   *
   * Two pictures of a web page are the better part of a megabyte once they are
   * text rather than bytes, and a long conversation can hold a dozen strips. So
   * the thumbnails travel with the change and the real thing waits to be asked
   * for — which it usually never is, because the strip stays shut unless
   * somebody wants a closer look.
   *
   * Looked for across every open project rather than only the one in front: a
   * change can arrive for a folder somebody has just switched away from, and
   * the window is perfectly entitled to draw it when they switch back.
   */
  handle<VisualFrames>(CHANNEL.visualFrames, async (_event, args) => {
    const [changeId] = args;
    if (typeof changeId !== 'string' || changeId.trim() === '') return fail(NO_SUCH_PICTURE);
    const held = workspaces.open.find((one) => one.held.looking.frames.has(changeId))?.held;
    const pair = held?.looking.frames.get(changeId);
    if (pair === undefined) return fail(NO_SUCH_PICTURE);

    const [before, after] = await Promise.all([readPicture(pair.before), readPicture(pair.after)]);
    if (before === null || after === null) return fail(NO_SUCH_PICTURE);
    return done({ before, after });
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

  /* -------------------------------------------------------------- connecting */

  handle<ConnectionState>(CHANNEL.connection, async () => {
    const [providers, prefs] = await Promise.all([
      readConnection(await defaultAgentDir()),
      preferences(),
    ]);
    const all = prefs.all();
    const selected = all.model;
    const model =
      selected === null
        ? null
        : providers
            .find((provider) => provider.providerId === selected.providerId)
            ?.models.find((one) => one.id === selected.modelId) ?? null;
    const chosenThinking =
      selected === null
        ? 'off'
        : all.thinking[modelKey(selected)] ?? model?.thinking[0] ?? 'off';
    return done({ providers, chosen: selected, chosenThinking });
  });

  handle<ConnectOutcome>(CHANNEL.connect, async (_event, args) => {
    const [providerId, method] = args;
    if (typeof providerId !== 'string' || providerId.trim() === '') {
      return done({ kind: 'failed', because: 'I could not tell which provider you meant.' });
    }
    if (method !== 'oauth' && method !== 'api-key') {
      return done({ kind: 'failed', because: 'I could not tell how you wanted to connect.' });
    }
    if (connecting !== null) {
      return done({ kind: 'failed', because: 'A connection is already in progress.' });
    }

    const controller = new AbortController();
    connecting = controller;
    try {
      await connectToProvider(await defaultAgentDir(), providerId, method, dialogueFor(controller));
      await chooseAModelIfNoneIs();
      return done({ kind: 'connected' });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      if (cause instanceof Error && (cause.name === 'AbortError' || message === 'Login cancelled')) {
        return done({ kind: 'cancelled' });
      }
      return done({ kind: 'failed', because: message });
    } finally {
      connecting = null;
      abandonPrompts();
    }
  });

  handle<null>(CHANNEL.connectAnswer, async (_event, args) => {
    const [promptId, value] = args;
    const pending =
      typeof promptId === 'string' && promptId !== '' ? pendingPrompts.get(promptId) : undefined;
    if (pending === undefined) return done(null);
    if (typeof value === 'string' && value.trim() !== '') pending.resolve(value);
    else pending.reject(new Error('Login cancelled'));
    return done(null);
  });

  handle<null>(CHANNEL.cancelConnect, async () => {
    connecting?.abort();
    return done(null);
  });

  handle<null>(CHANNEL.disconnect, async (_event, args) => {
    const [providerId] = args;
    if (typeof providerId === 'string' && providerId.trim() !== '') {
      try {
        await disconnectProvider(await defaultAgentDir(), providerId);
      } catch {
        // Forgetting an account that was already gone is not worth a sentence.
      }
      const prefs = await preferences();
      if (prefs.all().model?.providerId === providerId) {
        await prefs.change({ model: null });
      }
    }
    return done(null);
  });

  handle<Preferences>(CHANNEL.selectModel, async (_event, args) => {
    const [providerId, modelId] = args;
    const prefs = await preferences();
    if (typeof providerId !== 'string' || typeof modelId !== 'string') return done(prefs.all());
    // A model that does not exist is not a preference. The list the window
    // drew is the list the shell reads, so a stray id means a stale window —
    // the shell's answer is to keep what was already chosen.
    const providers = await readConnection(await defaultAgentDir());
    const known = providers.some(
      (provider) => provider.providerId === providerId && provider.models.some((model) => model.id === modelId),
    );
    if (!known) return done(prefs.all());
    const choice = { providerId, modelId };
    const model = providers
      .find((provider) => provider.providerId === providerId)
      ?.models.find((one) => one.id === modelId);
    const current = prefs.all();
    const remembered = current.thinking[modelKey(choice)];
    const level =
      remembered !== undefined && model?.thinking.includes(remembered)
        ? remembered
        : model?.thinking[0] ?? 'off';
    const saved = await prefs.change({
      model: choice,
      thinking: { ...current.thinking, [modelKey(choice)]: level },
    });
    // And on the conversation already in front of somebody, not only on the
    // next one they open. Choosing a model and finding the old one still
    // answering — with no way to tell, because nothing on screen said which was
    // which — was the whole of this bug. A session that will not take the model
    // keeps the one it had; the preference is still saved, so opening the
    // project again picks it up.
    const where = whereIn(args);
    const open = projectAt(where);
    const session = open === null ? null : sessionAt(open, where);
    await session?.useModel(choice);
    session?.setThinking(level);
    return done(saved);
  });

  handle<Preferences>(CHANNEL.setThinking, async (_event, args) => {
    const [providerId, modelId, level] = args;
    const prefs = await preferences();
    if (
      typeof providerId !== 'string' ||
      typeof modelId !== 'string' ||
      !['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(level as string)
    ) {
      return done(prefs.all());
    }
    const choice = { providerId, modelId };
    const providers = await readConnection(await defaultAgentDir());
    const model = providers
      .find((provider) => provider.providerId === providerId)
      ?.models.find((one) => one.id === modelId);
    if (model === undefined || !model.thinking.includes(level as ThinkingLevel)) return done(prefs.all());
    const saved = await prefs.change({
      thinking: { ...prefs.all().thinking, [modelKey(choice)]: level as ThinkingLevel },
    });
    const where = whereIn(args);
    const open = projectAt(where);
    const session = open === null ? null : sessionAt(open, where);
    if (session?.model?.providerId === providerId && session.model.modelId === modelId) {
      session.setThinking(level as ThinkingLevel);
    }
    return done(saved);
  });

  /* Read when it is asked for, not when a sitting happens to settle. The window
     only ever heard the split as an aside to a `spend-summary`, so "See where
     it went" was dead for the whole of the first sitting and after any reload. */
  handle<SpendSummary | null>(CHANNEL.spendSplit, (_event, args) => {
    const open = projectAt(whereIn(args));
    return Promise.resolve(done(open?.held.spend.ledger?.summary() ?? null));
  });

  /* Where the window has drawn its placeholder, in window coordinates. The
     native view is glued to it: nothing here guesses the rectangle, because a
     view that drifts from the space kept for it is worse than none. */
  handle<null>(CHANNEL.pageAt, async (_event, args) => {
    const [address, bounds] = args;
    const box = bounds as { x?: unknown; y?: unknown; width?: unknown; height?: unknown } | null;
    if (typeof address !== 'string' || address.trim() === '' || box === null) {
      dropPageView();
      return done(null);
    }
    if (
      typeof box.x !== 'number' ||
      typeof box.y !== 'number' ||
      typeof box.width !== 'number' ||
      typeof box.height !== 'number'
    ) {
      return done(null);
    }
    const view = makePageView();
    if (view === null) return done(null);
    pageProject = projectAt(whereIn(args))?.path ?? null;
    view.setBounds({
      x: Math.round(box.x),
      y: Math.round(box.y),
      width: Math.max(0, Math.round(box.width)),
      height: Math.max(0, Math.round(box.height)),
    });
    // Asking for the address it is already on is asking for it again — which is
    // what a reload is, and the only thing a person means by pressing it.
    if (view.webContents.getURL() === address) view.webContents.reload();
    else await view.webContents.loadURL(address).catch(() => undefined);
    return done(null);
  });

  /* A sheet, a menu or a modal would be painted under a native view, so the
     window says when one is open and the page steps out of the way. */
  handle<null>(CHANNEL.pageHidden, (_event, args) => {
    const [hidden] = args;
    pageView?.setVisible(hidden !== true);
    return Promise.resolve(done(null));
  });

  handle<null>(CHANNEL.watchStart, async (_event, args) => {
    const [says] = args;
    const view = pageView;
    if (view === null) {
      return fail({
        what: 'There is no page open to watch.',
        because: 'Open the project’s page first, then press it again.',
        actionLabel: 'Got it',
      });
    }
    // A window nobody can see hands back the last thing it composited, so a run
    // started behind something else would be a run of stale pictures.
    if (mainWindow === null || mainWindow.isDestroyed() || mainWindow.isMinimized()) {
      return fail({
        what: 'I can only watch a window that is on screen.',
        because: 'Bring Graphe to the front and press it again.',
        actionLabel: 'Got it',
      });
    }
    await pageWatching?.stop().catch(() => undefined);
    pageWatching = await watchWhileUsed(
      view.webContents,
      typeof says === 'string' && says.trim() !== '' ? { says } : {},
    );
    return done(null);
  });

  handle<Recording | null>(CHANNEL.watchStop, async () => {
    const run = (await pageWatching?.stop().catch(() => null)) ?? null;
    pageWatching = null;
    return done(run);
  });

  handle<SpendLimit | null>(CHANNEL.spendLimit, () => Promise.resolve(done(fleet.ceiling)));

  /* The technical audience reaches in through GRAPHE_SPEND_LIMIT; this is the
     same ceiling, set from the meter where the hand already is. */
  handle<SpendLimit | null>(CHANNEL.setSpendLimit, async (_event, args) => {
    const [ceiling] = args;
    if (ceiling === null) {
      fleet.hold(null);
      await (await preferences()).change({ ceiling: null });
      return done(null);
    }
    const money = ceiling as { minor?: unknown; currency?: unknown };
    if (
      typeof money.minor !== 'number' ||
      !Number.isFinite(money.minor) ||
      money.minor <= 0 ||
      typeof money.currency !== 'string' ||
      money.currency === ''
    ) {
      return done(fleet.ceiling);
    }
    const held = createLimit({ minor: Math.round(money.minor), currency: money.currency }, 'session');
    fleet.hold(held);
    await (await preferences()).change({ ceiling: held.ceiling });
    return done(fleet.ceiling);
  });

  handle<null>(CHANNEL.openLink, async (_event, args) => {
    const [url] = args;
    // https only, and nothing else: this window must never become somebody's
    // browser. The one thing it may open is a link a person asked for.
    if (typeof url !== 'string' || !/^https:\/\//.test(url)) return done(null);
    await shell.openExternal(url);
    return done(null);
  });

  handle<readonly FoundAccount[]>(CHANNEL.discoveredAccounts, async () => {
    try {
      return done(await discoveredAccounts(await defaultAgentDir()));
    } catch {
      // A machine without opencode or Codex is not a failure — it is a list of
      // nothing. Only a broken Pi runtime would get here, and that is better
      // left unspoken than announced as if the person had done something.
      return done([]);
    }
  });

  handle<null>(CHANNEL.importAccount, async (_event, args) => {
    const [raw] = args;
    const account = isFoundAccount(raw) ? raw : null;
    if (account === null) {
      return fail({
        what: 'I could not tell which account you meant.',
        because: 'The window asked for an account that does not make sense, so I left it alone.',
        actionLabel: 'Got it',
      });
    }
    try {
      await importAccount(await defaultAgentDir(), account);
      await chooseAModelIfNoneIs();
      return done(null);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      return fail({
        what: 'I could not bring that account over.',
        because: message,
        actionLabel: 'Got it',
      });
    }
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

  void app.whenReady().then(async () => {
    applyContentPolicy();
    applyPermissionPolicy();
    watchTheCeiling();
    register();
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
    // Before anything of ours starts: helpers left running by a copy of the app
    // that went away. Nothing above them to report to, nothing to stop them, and
    // they spend until they are done.
    await endStrays().catch(() => 0);
    // Work that was going when this last closed, back on its board.
    await pickUpWhereWeLeftOff().catch(() => undefined);
    // What somebody asked for over and over, picked up where it left off. One
    // that came round while this was shut is done once — see whenNext.
    await standingFile().catch(() => null);
    watchTheClock();
  });

  /**
   * The last window has gone.
   *
   * Work that was asked to carry on carries on: closing the window is not the
   * same as changing your mind, and stopping a run half-way would leave a copy
   * of somebody's project behind with nothing to show for it. When it lands they
   * are told, and pressing that brings the window back.
   *
   * Nothing here is ever an app you cannot end. Quitting is never prevented,
   * anywhere; and off macOS, where a windowless app is not a thing people
   * expect, the moment the work is done the app lets itself go.
   */
  app.on('window-all-closed', () => {
    if (mustStayUp()) return;
    closeSession();
    if (process.platform !== 'darwin') app.quit();
  });

  // Quitting is allowed at any moment, and this is what it costs: anything
  // still waiting on an answer is turned down, which changes nothing, because a
  // question is always asked before the thing it is about happens.
  app.on('before-quit', () => {
    writeDownWhatWasGoing();
    stopEverythingAway();
    closeSession();
  });
}
