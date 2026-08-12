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
  type IpcMainInvokeEvent,
} from 'electron';
import { spawn, spawnSync } from 'node:child_process';
import { readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';
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
import type { AgentEvent, ImageCard } from '../src/agent/types';
import { SpendRecorder } from '../src/cost/recorder';
import { Timeline, type Version } from '../src/history/timeline';
import { ProjectHistory } from '../src/history/repo';
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
  type Preferences,
  type PromptOptions,
  type PutBack,
  type RecentProject,
  type Result,
  type SavedVersion,
  type ShowOutcome,
  type ShowProgress,
  type Trouble,
  type VisualChange,
  type VisualFrames,
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
import { keeping, PreferenceFile } from '../src/projects/preferences';
import { Recents } from '../src/projects/recents';
import { Workspaces } from '../src/projects/workspaces';
import { findEditor, type Editor } from '../src/shell/editors';
import { pagesIn, type Page } from '../src/preview/pages';
import { WARNING, askAbout, packageShelf, type Pack } from '../src/agent/pi/packages';
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
import { saysNotice, saysWhileAway, Unattended } from '../src/work/unattended';
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
import { StandingFile } from '../src/projects/standing';
import { HandoverError, handToDeveloper, whatIsHere, type Change } from '../src/share/developer';
import { handoverWords } from '../src/share/handover';
import { OnlineError, putOnline, whatIsHereForOnline } from '../src/share/publish';
import { onlineWords } from '../src/share/online';
import { canPutOnline, canSendItOn } from '../src/share/tools';

import type { Serving } from '../src/preview/serve';
import { makeAndServe, ShowError, showSays } from '../src/preview/show';
import { describePointed, type Pointed } from '../src/preview/point';
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

type Held = {
  timeline: Timeline;
  spend: SpendRecorder;
  /** Null only for the moment between the timeline opening and the session
   *  starting, which is the window in which the session can fail. */
  session: GrapheSession | null;
  /** The finished site being looked at, if "See it" has been pressed here. */
  serving: Serving | null;
  /** The before-and-after (BACKLOG F2). */
  looking: Looking;
  /** Work being checked before it reaches the files, or null when none is. */
  waiting: HeldWork | null;
  /** True while something is being sent off this computer, so a second press
   *  cannot start a second one. */
  sending: boolean;
};

const workspaces = new Workspaces<Held>({
  close: (held) => {
    held.session?.dispose();
    void held.serving?.stop();
    // The copy goes; whatever it made stays reachable, so closing a project
    // while something waits in it cannot be how somebody loses work.
    void held.waiting?.release();
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

function forwardTo(path: string, held: Held): (event: AgentEvent) => void {
  return (event) => {
    // Failures are the one kind of event that can arrive in somebody else's
    // words — see the note at the top of plainly.ts. Everything else in the
    // stream was written by us or by the Guard and goes through untouched.
    const said: AgentEvent =
      event.type === 'error' ? { type: 'error', message: plainMessage(event.message) } : event;
    send(path, said);

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
    if (said.type === 'settled') void look(path, held);

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

/**
 * The same relay, for work being checked in a copy of the project.
 *
 * Everything reaches the conversation exactly as it would, and everything spent
 * is counted exactly as it would be. What is left out is the picture: the
 * change is in the copy, and photographing the folder on screen would produce a
 * before and after of a project nothing has happened to.
 */
function forwardHeld(path: string, held: Held): (event: AgentEvent) => void {
  return (event) => {
    const said: AgentEvent =
      event.type === 'error' ? { type: 'error', message: plainMessage(event.message) } : event;
    send(path, said);
    for (const also of held.spend.observe(said)) {
      send(path, also);
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
    holdBack: chosen.holdBack,
    canHandOver: reach.canHandOver,
    handOverSays: reach.handOverSays,
    canPutOnline: reach.canPutOnline,
    onlineSays: reach.onlineSays,
  };
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
  text: string,
  cards: readonly ImageCard[] | undefined,
  lookFirst: boolean,
): Promise<Result<null>> {
  const held = open.held;
  const history = new ProjectHistory(open.path);

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

  let inside: GrapheSession | null = null;
  try {
    inside = await createSession({
      projectRoot: waiting.folder,
      onEvent: forwardHeld(open.path, held),
      timeline: await Timeline.open(waiting.folder),
      model: (await preferences()).all().model,
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

  try {
    await waiting.settle(saysHeldWork(text));
  } catch (cause) {
    await waiting.release().catch(() => undefined);
    held.waiting = null;
    return fail(historyTrouble(cause));
  }
  if (waiting.waiting.version === null) held.waiting = null;
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
async function styleTokens(
  root: string,
): Promise<
  { file: string; tokens: readonly import('../src/lib/ipc').StyleToken[]; text: string } | null
> {
  let best: {
    file: string;
    tokens: readonly import('../src/lib/ipc').StyleToken[];
    text: string;
  } | null = null;
  for (const candidate of TOKEN_FILES) {
    const css = await readFile(join(root, candidate), 'utf8').catch(() => null);
    if (css === null) continue;
    const found = readTokens(css);
    if (found.length === 0) continue;
    const withSteps = found.map((one) => ({ ...one, steps: steps(one, found) }));
    if (best === null || withSteps.length > best.tokens.length) {
      best = { file: candidate, tokens: withSteps, text: css };
    }
  }
  return best;
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

/** Where every project's conversations are kept. */
function sessionsFolder(): string {
  return join(app.getPath('userData'), 'sessions');
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
    return done({
      path,
      name,
      history: resumed.held.session?.history ?? [],
      conversation: resumed.held.session?.conversation ?? null,
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
    session: null,
    serving: null,
    looking: nothingSeenYet(),
    waiting: null,
    sending: false,
  };

  // A folder opened with nothing chosen is the first-run case, and Pi will not
  // pick later — so pick now, before the session is made and binds it.
  if ((await preferences()).all().model === null) await chooseAModelIfNoneIs();

  try {
    held.session = await createSession({
      projectRoot: path,
      onEvent: forwardTo(path, held),
      timeline,
      model: (await preferences()).all().model,
      // One folder of transcripts for all projects, under the app's own data
      // directory — never inside the user's project, so uninstalling Graphe
      // takes them with it. Opening a project again resumes its most recent
      // conversation (BACKLOG B1.1); Pi tells them apart by the folder each was
      // recorded in, not by where the file sits.
      //
      // Two known limits of that, both accepted for now: a project that is
      // renamed or moved no longer matches, so it opens a fresh conversation and
      // the old file stays behind; and nothing prunes this folder, so a
      // long-lived install accumulates transcripts (pictures included, which are
      // the bulk of it). Both want the "forget this conversation" action B1.1
      // asks for, which is not built yet.
      sessionDir: sessionsFolder(),
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
    history: held.session.history,
    conversation: held.session.conversation,
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
 *  so letting one project's work go can never reach another's. */
function awayFolder(path: string): string {
  const named = basename(path).replace(/[^a-zA-Z0-9-]+/g, '-').slice(0, 24) || 'project';
  let stamp = 0;
  for (const character of path) stamp = (stamp * 31 + character.charCodeAt(0)) >>> 0;
  return join(app.getPath('temp'), 'graphe-away', `${named}-${stamp.toString(36)}`);
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
  runs: Map<string, Run>;
  spend: SpendRecorder;
  /** True once something has landed that nobody has been shown yet. */
  unseen: boolean;
  /** True while copies are being made. Two runs finishing at the same moment
   *  would otherwise both look at the queue before either had taken from it,
   *  and the piece at the front would be started twice. */
  starting: boolean;
  /** A slot freed up while that was happening. Look again when it ends, or the
   *  piece at the front of the queue waits for a turn that never comes. */
  again: boolean;
};

const awayDesks = new Map<string, AwayDesk>();

function deskFor(path: string, name: string): AwayDesk {
  const already = awayDesks.get(path);
  if (already !== undefined) return already;
  const history = new ProjectHistory(path);
  const desk: AwayDesk = {
    path,
    name,
    history,
    bench: new Workbench({ history, under: awayFolder(path), atOnce: AT_A_TIME }),
    runs: new Map(),
    spend: new SpendRecorder(),
    unseen: false,
    starting: false,
    again: false,
  };
  awayDesks.set(path, desk);
  return desk;
}

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

function awayPieces(desk: AwayDesk): readonly AwayPiece[] {
  return desk.bench.pieces.map((piece) => {
    const run = desk.runs.get(piece.id);
    const asked = run?.held.first ?? null;
    return {
      id: piece.id,
      doing: piece.doing,
      state: piece.state,
      at: piece.at,
      picture: piece.picture,
      says: saidBriefly(run?.said ?? ''),
      trouble: piece.trouble,
      question:
        asked === null
          ? null
          : {
              callId: asked.callId,
              question: asked.question,
              detail: asked.detail,
              consequence: asked.consequence,
            },
    };
  });
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

  const hear = (event: AgentEvent): void => {
    held.heard(event, Date.now());
    if (event.type === 'message-delta') run.said = `${run.said}${event.text}`.slice(0, 2000);

    let moved = false;
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

    for (const also of desk.spend.observe(event)) {
      if (also.type === 'spend-summary') {
        void recents().then((list) => list.recordSpend(desk.path, also.summary.total));
      }
    }
    if (moved || event.type === 'error' || event.type === 'settled') pushAway(desk.path);
  };

  try {
    session = await createSession({
      projectRoot: folder,
      onEvent: hear,
      timeline: await Timeline.open(folder),
      model: (await preferences()).all().model,
    });
    run.session = session;
    await session.prompt(piece.doing);
    await desk.bench.settle(piece.id, saysHeldWork(piece.doing));
  } catch (cause) {
    const raw = cause instanceof Error ? cause.message : String(cause);
    desk.bench.stopped(piece.id, plainMessage(raw));
  } finally {
    // Whatever happened, nothing is left parked on a question nobody can reach.
    // Turned down, never up: the run ending is not a person saying yes.
    held.stop();
    session?.dispose();
    run.session = null;
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
  pushAway(desk.path);

  await runWhatCan(desk);
  quitIfNothingIsLeft();
}

/** Start as many as there is room for. Called when one is asked for and again
 *  whenever one finishes. */
async function runWhatCan(desk: AwayDesk): Promise<void> {
  if (desk.starting) {
    desk.again = true;
    return;
  }
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
    for (const piece of desk.bench.pieces) {
      if (piece.state === 'waiting') desk.bench.stopped(piece.id, plainMessage(why));
    }
    pushAway(desk.path);
    return;
  } finally {
    desk.starting = false;
  }
  if (began.length > 0) pushAway(desk.path);
  for (const piece of began) void runOne(desk, piece);
  if (desk.again) {
    desk.again = false;
    await runWhatCan(desk);
  }
}

/** Ask for a piece of work that carries on whether or not anybody is looking. */
async function keepGoing(path: string, name: string, doing: string): Promise<void> {
  const desk = deskFor(path, name);
  desk.bench.ask(doing);
  pushAway(path);
  await runWhatCan(desk);
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
    await workspaces.current?.held.session?.useModel({
      providerId: provider.providerId,
      modelId: first.id,
    });
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
        await desk.bench.clear().catch(() => undefined);
        awayDesks.delete(resolve(path));
      }
      await (await followed()).forget(resolve(path));
      await changeStanding((all) => withoutProject(all, resolve(path)));
      if (!standingNow.some((one) => one.on)) stopWatchingTheClock();
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

  handle<Overview>(CHANNEL.overview, async () => {
    const open = workspaces.current;
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

  handle<readonly SavedVersion[]>(CHANNEL.nudgeToken, async (_event, args) => {
    const [name, value] = args;
    const open = workspaces.current;
    if (open === null) return fail(NOTHING_OPEN);
    if (typeof name !== 'string' || typeof value !== 'string') return fail(NOTHING_OPEN);
    const styles = await styleTokens(open.path);
    if (styles === null) return fail(NOTHING_OPEN);
    const where = join(open.path, styles.file);
    try {
      const css = await readFile(where, 'utf8');
      const next = writeToken(css, name, value);
      if (next === css) return done(await versionsOf(open.held));
      await writeFile(where, next, 'utf8');
      await open.held.timeline.snapshot({ boundary: 'user-asked', by: 'you' });
      return done(await versionsOf(open.held));
    } catch (cause) {
      const raw = cause instanceof Error ? cause.message : String(cause);
      return fail(plainTrouble(raw, detailsOf(cause)));
    }
  });

  handle<readonly SavedVersion[]>(CHANNEL.nudgeMotion, async (_event, args) => {
    const [places, change] = args;
    const open = workspaces.current;
    if (open === null) return fail(NOTHING_OPEN);
    if (!Array.isArray(places) || typeof change !== 'object' || change === null) {
      return fail(NOTHING_OPEN);
    }
    const styles = await styleTokens(open.path);
    if (styles === null) return fail(NOTHING_OPEN);
    const where = join(open.path, styles.file);
    try {
      const css = await readFile(where, 'utf8');
      const next = writeMotionAll(css, places as Parameters<typeof writeMotionAll>[1], change as Parameters<typeof writeMotionAll>[2]);
      if (next === css) return done(await versionsOf(open.held));
      await writeFile(where, next, 'utf8');
      await open.held.timeline.snapshot({ boundary: 'user-asked', by: 'you' });
      return done(await versionsOf(open.held));
    } catch (cause) {
      const raw = cause instanceof Error ? cause.message : String(cause);
      return fail(plainTrouble(raw, detailsOf(cause)));
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

  /** What each version looked like. Empty is a real answer: a project nothing
   *  has been photographed in yet has no pictures, and the rail says so by
   *  drawing words instead. */
  handle<Readonly<Record<string, string>>>(CHANNEL.versionPictures, () => {
    const open = workspaces.current;
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
  handle<readonly FileEntry[]>(CHANNEL.projectFiles, async () => {
    const open = workspaces.current;
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
    const open = workspaces.current;
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
    const open = workspaces.current;
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
    const open = workspaces.current;
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

  handle<readonly SavedVersion[]>(CHANNEL.saveVersion, async (_event, args) => {
    const [name] = args;
    const open = workspaces.current;
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

  handle<{ looks: readonly Look[]; says: string }>(CHANNEL.checkWidths, async () => {
    const open = workspaces.current;
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

  handle<string | null>(CHANNEL.shareReview, async () => {
    const open = workspaces.current;
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

  handle<Landing>(CHANNEL.landing, async () => {
    const open = workspaces.current;
    if (open === null) return fail(NOTHING_OPEN);
    return done(await landingNow(open.path, open.held));
  });

  handle<Preferences>(CHANNEL.setHoldBack, async (_event, args) => {
    const [on] = args;
    if (typeof on !== 'boolean') return fail(NOTHING_OPEN);
    return done(await (await preferences()).change({ holdBack: on }));
  });

  handle<Decided>(CHANNEL.decideOnWork, async (_event, args) => {
    const [letIn] = args;
    const open = workspaces.current;
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
      return done(await asItStands(version));
    }

    try {
      // Anything unfinished in the folder becomes a version first, the same way
      // going back does, so letting work in can never write over it.
      await open.held.timeline.snapshot({ boundary: 'turn-ended' });
      const outcome = await waiting.approve(saysHeldWork(waiting.waiting.doing));
      open.held.waiting = null;
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
    const open = workspaces.current;
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
    const open = workspaces.current;
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

  handle<Away>(CHANNEL.away, async () => {
    const open = workspaces.current;
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
    const [text] = args;
    const open = workspaces.current;
    if (open === null) return fail(NOTHING_OPEN);
    if (typeof text !== 'string' || text.trim() === '') return done(awayNow(open.path));
    await keepGoing(open.path, open.name, text);
    return done(awayNow(open.path));
  });

  handle<Away>(CHANNEL.stopAway, async (_event, args) => {
    const [id] = args;
    const open = workspaces.current;
    if (open === null) return fail(NOTHING_OPEN);
    const desk = awayDesks.get(open.path);
    if (desk === undefined || typeof id !== 'string') return done(awayNow(open.path));
    const run = desk.runs.get(id);
    // Turned down rather than left hanging, and only ever down.
    run?.held.stop();
    void run?.session?.stop();
    run?.session?.dispose();
    desk.runs.delete(id);
    await desk.bench.drop(id);
    await runWhatCan(desk);
    return done(awayNow(open.path));
  });

  handle<Away>(CHANNEL.keepAway, async (_event, args) => {
    const [id] = args;
    const open = workspaces.current;
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
    const open = workspaces.current;
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
    return done(awayNow(open.path));
  });

  handle<Away>(CHANNEL.addRepeat, async (_event, args) => {
    const [doing, every, at, on] = args;
    const open = workspaces.current;
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
    const open = workspaces.current;
    if (open === null) return fail(NOTHING_OPEN);
    if (typeof id === 'string' && typeof on === 'boolean') {
      await changeStanding((all) => switchStanding(all, id, on));
      if (!standingNow.some((one) => one.on)) stopWatchingTheClock();
    }
    return done(awayNow(open.path));
  });

  handle<Away>(CHANNEL.forgetRepeat, async (_event, args) => {
    const [id] = args;
    const open = workspaces.current;
    if (open === null) return fail(NOTHING_OPEN);
    if (typeof id === 'string') await changeStanding((all) => withoutStanding(all, id));
    if (!standingNow.some((one) => one.on)) stopWatchingTheClock();
    return done(awayNow(open.path));
  });

  handle<OpenedProject>(CHANNEL.openConversation, async (_event, args) => {
    const [path] = args;
    const open = workspaces.current;
    if (open === null) return fail(NOTHING_OPEN);
    const held = open.held;
    // The old session goes first: two sessions writing one project's transcripts
    // is the race `opening` exists to prevent, and this is the same hazard.
    held.session?.dispose();
    held.session = null;
    // The ledger belongs to the sitting, not to the conversation, so it stays.
    try {
      held.session = await createSession({
        projectRoot: open.path,
        onEvent: forwardTo(open.path, held),
        timeline: held.timeline,
        model: (await preferences()).all().model,
        ...(typeof path === 'string' && path !== ''
          ? { sessionPath: path }
          : { sessionDir: sessionsFolder() }),
      });
    } catch (cause) {
      const chain = detailsOf(cause);
      return fail(knownTrouble(chain ?? '', chain) ?? noAccountConnected(cause));
    }
    return done({
      path: open.path,
      name: open.name,
      history: held.session.history,
      conversation: held.session.conversation,
    });
  });

  /** One shelf per run. Building it reads settings off disk, and the screen it
   *  feeds is opened over and over. */
  let shelf: Awaited<ReturnType<typeof openShelf>> | null = null;
  const openShelf = async () => {
    const where = workspaces.current?.path ?? app.getPath('home');
    return packageShelf(await packageHost(await defaultAgentDir(), where));
  };
  const theShelf = async () => (shelf ??= await openShelf());

  handle<InStep>(CHANNEL.inStep, async () => {
    const open = workspaces.current;
    if (open === null) return done(inStepOf(null));
    return done(inStepOf((await followed()).for(open.path)));
  });

  handle<InStep>(CHANNEL.followDesign, async (_event, args) => {
    const [address] = args;
    const open = workspaces.current;
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

  handle<InStep>(CHANNEL.lookAgain, async () => {
    const open = workspaces.current;
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

  handle<InStep>(CHANNEL.caughtUp, async () => {
    const open = workspaces.current;
    if (open === null) return fail(NOTHING_OPEN);
    const file = await followed();
    const held = file.for(open.path);
    if (held === null) return done(inStepOf(null));
    return done(inStepOf(await file.keep(open.path, { ...held, design: held.latest })));
  });

  handle<InStep>(CHANNEL.stopFollowing, async () => {
    const open = workspaces.current;
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
    const open = workspaces.current;
    const agent = open?.held.session ?? null;
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

  handle<readonly Conversation[]>(CHANNEL.conversations, async () => {
    const open = workspaces.current;
    if (open === null) return done([]);
    return done(await listConversations(open.path, sessionsFolder()));
  });

  handle<null>(CHANNEL.revealFolder, async () => {
    const open = workspaces.current;
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

  handle<readonly Page[]>(CHANNEL.pages, async () => {
    const open = workspaces.current;
    if (open === null) return done([]);
    return done(pagesIn(await filesUnder(open.path)));
  });

  handle<ShowOutcome>(CHANNEL.show, async (_event, args) => {
    const [at, point] = args;
    const open = workspaces.current;
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
        onPointed: (pointed: Pointed) => {
          if (mainWindow === null || mainWindow.isDestroyed()) return;
          mainWindow.webContents.send(CHANNEL.pointed, describePointed(pointed));
        },
      });
      if (outcome.kind === 'unsure') return done({ kind: 'unsure', question: outcome.question });
      open.held.serving = outcome.serving;
      // Their own browser, not a window of ours. It is the one they already
      // trust, it is where their client will open the link we send later, and
      // the alternative is us drawing somebody else's HTML inside the same app
      // that holds their folder open.
      const address = atPage(outcome.serving.address, at);
      await shell.openExternal(point === true ? `${address}#graphe-point` : address);
      return done({ kind: 'showing', name: open.name });
    } catch (cause) {
      return fail(couldNotShow(cause));
    }
  });

  handle<null>(CHANNEL.prompt, async (_event, args) => {
    const [text, attachments, ways] = args;
    if (typeof text !== 'string' || text.trim() === '') return done(null);
    const open = workspaces.current;
    const agent = open?.held.session ?? null;
    if (open === null || agent === null) return fail(NOTHING_OPEN);
    // Their own words, kept for the sentence beside the pictures. The same
    // sentence the version timeline writes for the same moment — see
    // src/diff/summary.ts.
    open.held.looking.instruction = text;
    try {
      const lookFirst =
        ways !== null && typeof ways === 'object' && (ways as PromptOptions).lookFirst === true;
      // Checked first, when they have asked for that and nothing is already
      // waiting. Two pieces of work waiting at once is a decision nobody made.
      if ((await preferences()).all().holdBack && open.held.waiting === null) {
        return await checkItFirst(open, text, imageCards(attachments), lookFirst);
      }
      await agent.prompt(text, imageCards(attachments), { lookFirst });
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
    return done({ providers, chosen: prefs.all().model });
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
    const saved = await prefs.change({ model: { providerId, modelId } });
    // And on the conversation already in front of somebody, not only on the
    // next one they open. Choosing a model and finding the old one still
    // answering — with no way to tell, because nothing on screen said which was
    // which — was the whole of this bug. A session that will not take the model
    // keeps the one it had; the preference is still saved, so opening the
    // project again picks it up.
    await workspaces.current?.held.session?.useModel({ providerId, modelId });
    return done(saved);
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
    register();
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
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
    stopEverythingAway();
    closeSession();
  });
}
