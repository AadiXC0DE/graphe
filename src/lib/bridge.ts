/** The window's end of the bridge.
 *
 * Every call the interface makes to the desktop shell goes through here, and
 * nothing in `src/components` or `src/App.tsx` ever touches `window.graphe`
 * directly. Two reasons, and the second is the one that matters day to day:
 *
 *  1. `window.graphe` is absent whenever the app is opened in an ordinary
 *     browser tab — `npm run dev`, the screenshot harness, a designer poking at
 *     the CSS. The interface must not know or care. A missing bridge is not an
 *     error state to render; it is a Tuesday.
 *
 *  2. Nothing in this file mentions Pi, sessions, IPC or channels. The renderer
 *     is not allowed to know Pi exists (notes/strategy/ARCHITECTURE.md), and the
 *     easiest way to keep a rule like that is to make the alternative
 *     unavailable rather than discouraged.
 *
 * The browser fallback below answers honestly rather than pretending. It says
 * what it is, and it says it in a real streamed reply so the conversation view
 * is a real conversation view when it is screenshotted, instead of a mock that
 * drifts away from the thing it is standing in for.
 */

import type { AgentEvent } from '../agent/types';
import { Ledger } from '../cost/ledger';
import { money } from '../cost/money';
import {
  showWords,
  type AgentNotice,
  type Decision,
  type GrapheApi,
  type Hatches,
  type OpenedProject,
  type Preferences,
  type PutBack,
  type RecentProject,
  type Result,
  type SavedVersion,
  type ShowOutcome,
  type ShowProgress,
  type VisualChange,
  type VisualFrames,
  type VisualNotice,
} from './ipc';

declare global {
  interface Window {
    graphe?: GrapheApi;
  }
}

export type Bridge = GrapheApi & {
  /** True when the desktop shell is underneath. False in a browser tab, where
   *  nothing can actually be built and the interface should not offer to. */
  readonly desktop: boolean;
};

function done<T>(value: T): Result<T> {
  return { ok: true, value };
}

/* -------------------------------------------------------------------------- */
/* A browser tab, with nothing underneath it                                   */
/* -------------------------------------------------------------------------- */

const PREVIEW_REPLY = `This is Graphe running in a browser tab, so there are no files here for me to open and nothing I can build for you yet.

**What is real on this page**

- the conversation, streamed the way the desktop app streams it
- the questions I ask before I change anything, and the answers you give
- the meter in the corner, with the same arithmetic behind it

What is not real is anything that would reach a folder. In the app, this is where the work itself would arrive — written in your own tokens, with a version saved before it, so putting it back is one click:

\`\`\`css
.hero__title {
  font-size: var(--text-2xl);
  letter-spacing: -0.02em;
  margin-block: var(--space-5) var(--space-3);
}
\`\`\`

Open the desktop app and I will get to work. If you came to look at the interface rather than to use it, add \`?gallery\` to the address — every piece of it is on one page there, in both themes.`;

/**
 * A couple of words at a time, so the streaming path is genuinely exercised
 * rather than one delta pretending to be many.
 *
 * Small pieces matter more than they look. They are how the formatting gets
 * tested against the state it is nearly always in: a list with one and a half
 * bullets, a code fence that has been opened and not yet closed, a sentence
 * that ends in the middle of a word. Whatever renders a reply has to hold all
 * of those without flinching, and a preview that arrived in one lump would
 * never have shown us.
 */
function inPieces(text: string): string[] {
  const words = text.split(/(?<=\s)/);
  const pieces: string[] = [];
  for (let index = 0; index < words.length; index += 2) {
    pieces.push(words.slice(index, index + 2).join(''));
  }
  return pieces;
}

/**
 * A sitting's worth of spend, for a tab with no shell under it.
 *
 * The numbers are invented — there is no account here and nothing has been
 * billed — but everything about how they travel is real: the same `spend`
 * events the adapter emits, priced in the same currency Pi prices in, recorded
 * in the same `Ledger` the desktop shell uses, and summarised by the same
 * `summary()` call. So the meter in a screenshot is the real meter with real
 * arithmetic behind it, rather than a mock that drifts away from the thing it
 * stands in for.
 *
 * The split is the point of it: a fifth of this went on an attempt that did not
 * work, which is the one number in the product nobody else can print.
 */
const PREVIEW_SPEND: readonly { minor: number; label: string; reason: 'work' | 'retry-after-failure' }[] =
  [
    { minor: 21, label: 'Looking through your files', reason: 'work' },
    { minor: 18, label: 'Changing contact.html', reason: 'work' },
    { minor: 12, label: 'Changing contact.html', reason: 'retry-after-failure' },
    { minor: 11, label: 'Writing styles.css', reason: 'work' },
  ];

const PREVIEW_CURRENCY = 'USD';

/* -------------------------------------------------------------------------- */
/* Two projects and their versions, so the picker and the rail have something  */
/* to be                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * A browser tab has no folders in it, and the two regions that appear only when
 * there is something to say — the project picker and the version rail — would
 * therefore never appear at all. That would make them unreviewable: the only
 * acceptance test that counts for an interface is looking at it.
 *
 * So the preview has two projects with different histories. Different on
 * purpose: switching between them is how you see, in one glance, that a project
 * carries its own versions and its own spend rather than the window's.
 */
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const started = Date.now();

const PREVIEW_PROJECTS: readonly { path: string; name: string; ago: number; spent: number | null }[] =
  [
    { path: '/Users/you/Sites/paper-street', name: 'paper-street', ago: 12 * MINUTE, spent: 62 },
    { path: '/Users/you/Sites/atlas-studio', name: 'atlas-studio', ago: 26 * HOUR, spent: 214 },
    { path: '/Users/you/Sites/field-notes', name: 'field-notes', ago: 5 * 24 * HOUR, spent: null },
  ];

type PreviewVersion = { title: string; ago: number; by: 'you' | 'graphe'; named?: boolean };

const PREVIEW_VERSIONS: Readonly<Record<string, readonly PreviewVersion[]>> = {
  '/Users/you/Sites/paper-street': [
    { title: 'Hero rebuilt from your Figma frame', ago: 2 * MINUTE, by: 'graphe' },
    { title: 'Spacing matched to your scale', ago: 18 * MINUTE, by: 'graphe' },
    { title: 'before I broke the nav', ago: 55 * MINUTE, by: 'you', named: true },
    { title: 'Cards moved onto the grid', ago: 3 * HOUR, by: 'graphe' },
    { title: 'First pass at the landing page', ago: 26 * HOUR, by: 'graphe' },
  ],
  '/Users/you/Sites/atlas-studio': [
    { title: 'Made the header sticky', ago: 26 * HOUR, by: 'graphe' },
    { title: 'Added the case study page', ago: 2 * 24 * HOUR, by: 'graphe' },
  ],
  '/Users/you/Sites/field-notes': [{ title: 'Started the project', ago: 5 * 24 * HOUR, by: 'you' }],
};

function previewVersions(path: string): SavedVersion[] {
  const list = PREVIEW_VERSIONS[path] ?? [];
  return list.map((one, index) => ({
    id: `${path}#${index}`,
    at: started - one.ago,
    title: one.title,
    by: one.by,
    named: one.named ?? false,
    current: index === 0,
  }));
}

/* -------------------------------------------------------------------------- */
/* A before and after, for a tab with no folder behind it                      */
/* -------------------------------------------------------------------------- */

/**
 * Two pictures of a page, drawn rather than photographed.
 *
 * The desktop app photographs the user's own site. A browser tab has no site,
 * and the alternative to this would be the strip never appearing at all — which
 * would make the one component in the product with a gesture in it the one
 * component nobody can review. So the preview draws a plain page twice, with one
 * real difference between them: the button is 8px lower and wearing the accent
 * colour, which is the exact example DIFFERENTIATORS §5 uses.
 *
 * Drawn as pictures rather than mocked as markup on purpose. Everything
 * downstream — the wipe, the outlines, the piece-lifting in "just what changed"
 * — treats these as opaque images, so what gets reviewed here is the real
 * component doing its real job on a real pair.
 */
function samplePage(moved: boolean): string {
  const buttonY = moved ? 268 : 260;
  const buttonFill = moved ? '#b8492c' : '#3d3d3a';
  const page = `<svg xmlns="http://www.w3.org/2000/svg" width="1180" height="820" viewBox="0 0 1180 820">
<rect width="1180" height="820" fill="#ffffff"/>
<rect x="0" y="0" width="1180" height="64" fill="#fbfbfa"/>
<rect x="0" y="63" width="1180" height="1" fill="#e4e4e1"/>
<rect x="64" y="26" width="92" height="12" rx="3" fill="#1a1a19"/>
<rect x="820" y="28" width="60" height="8" rx="3" fill="#9a9a93"/>
<rect x="906" y="28" width="60" height="8" rx="3" fill="#9a9a93"/>
<rect x="992" y="28" width="60" height="8" rx="3" fill="#9a9a93"/>
<rect x="1078" y="22" width="38" height="20" rx="6" fill="#e4e4e1"/>
<rect x="64" y="150" width="520" height="26" rx="4" fill="#1a1a19"/>
<rect x="64" y="188" width="420" height="26" rx="4" fill="#1a1a19"/>
<rect x="64" y="232" width="470" height="9" rx="3" fill="#9a9a93"/>
<rect x="64" y="${String(buttonY)}" width="168" height="44" rx="8" fill="${buttonFill}"/>
<rect x="92" y="${String(buttonY + 18)}" width="88" height="8" rx="3" fill="#ffffff"/>
<rect x="660" y="140" width="456" height="248" rx="12" fill="#f2f2f0"/>
<rect x="64" y="470" width="336" height="180" rx="12" fill="#fbfbfa" stroke="#e4e4e1"/>
<rect x="422" y="470" width="336" height="180" rx="12" fill="#fbfbfa" stroke="#e4e4e1"/>
<rect x="780" y="470" width="336" height="180" rx="12" fill="#fbfbfa" stroke="#e4e4e1"/>
<rect x="96" y="504" width="130" height="11" rx="3" fill="#1a1a19"/>
<rect x="454" y="504" width="150" height="11" rx="3" fill="#1a1a19"/>
<rect x="812" y="504" width="118" height="11" rx="3" fill="#1a1a19"/>
<rect x="96" y="534" width="252" height="8" rx="3" fill="#9a9a93"/>
<rect x="454" y="534" width="252" height="8" rx="3" fill="#9a9a93"/>
<rect x="812" y="534" width="252" height="8" rx="3" fill="#9a9a93"/>
<rect x="96" y="556" width="200" height="8" rx="3" fill="#9a9a93"/>
<rect x="454" y="556" width="220" height="8" rx="3" fill="#9a9a93"/>
<rect x="812" y="556" width="180" height="8" rx="3" fill="#9a9a93"/>
<rect x="0" y="720" width="1180" height="100" fill="#f2f2f0"/>
<rect x="64" y="756" width="150" height="8" rx="3" fill="#9a9a93"/>
</svg>`;
  // Base64 rather than percent-encoding: the same string is used as a CSS
  // `url()` in "just what changed", and raw SVG in a url() is a quoting
  // argument nobody wins.
  return `data:image/svg+xml;base64,${globalThis.btoa(page)}`;
}

const PREVIEW_CHANGE: VisualChange = {
  id: 'preview-change',
  at: started,
  headline: 'Moved the button down and used your brand blue',
  where: 'One area changed, near the top on the left.',
  areas: [{ x: 0.045, y: 0.305, width: 0.155, height: 0.08 }],
  beforeThumb: samplePage(false),
  afterThumb: samplePage(true),
  width: 1180,
  height: 820,
};

function previewBridge(): Bridge {
  const listeners = new Set<(notice: AgentNotice) => void>();
  const watching = new Set<(progress: ShowProgress) => void>();
  const looking = new Set<(notice: VisualNotice) => void>();

  /** Whatever project the tab has open. Every event is stamped with it, the way
   *  the shell stamps its own — the window's routing is then exercised here
   *  rather than only in the app. */
  let openPath: string | null = null;

  const send = (event: AgentEvent): void => {
    for (const listener of listeners) listener({ project: openPath, event });
  };

  const versions = new Map<string, SavedVersion[]>();
  const versionsFor = (path: string): SavedVersion[] => {
    const already = versions.get(path);
    if (already !== undefined) return already;
    const made = previewVersions(path);
    versions.set(path, made);
    return made;
  };

  const forgotten = new Set<string>();
  const remembered = (): readonly RecentProject[] =>
    PREVIEW_PROJECTS.filter((one) => !forgotten.has(one.path)).map((one) => ({
      path: one.path,
      name: one.name,
      lastOpenedAt: started - one.ago,
      lastSpend: one.spent === null ? null : money(one.spent, PREVIEW_CURRENCY),
      // One of them has gone missing, because "a folder that is not there any
      // more" is a state the picker has to draw and nobody would ever see it by
      // accident.
      missing: one.path === '/Users/you/Sites/field-notes',
    }));

  /** Once, shortly after the interface starts listening. It is the one thing a
   *  browser tab cannot show by waiting for it to happen: money is spent by an
   *  agent doing work, and there is no agent here. Everything else in this
   *  preview waits to be asked for. */
  /** The preview's own copy of what a person has chosen. Real state, so the
   *  switch in the project menu can be turned on and its effect looked at. */
  let preferred: Preferences = { showMe: false };

  let spendAnnounced = false;
  const announceSpend = (): void => {
    if (spendAnnounced) return;
    spendAnnounced = true;

    const ledger = new Ledger(PREVIEW_CURRENCY);
    // Entry by entry, as it arrives from the shell, then the split once
    // everything has settled — the same two things, in the same order.
    for (const entry of PREVIEW_SPEND) {
      const amount = money(entry.minor, PREVIEW_CURRENCY);
      ledger.record({ amount, reason: entry.reason, label: entry.label });
      send({ type: 'spend', amount, label: entry.label, reason: entry.reason });
    }
    send({ type: 'settled' });
    send({ type: 'spend-summary', summary: ledger.summary() });
  };

  return {
    desktop: false,

    openProject(path: string): Promise<Result<OpenedProject>> {
      const known = PREVIEW_PROJECTS.find((one) => one.path === path);
      const name = known?.name ?? path.split('/').filter(Boolean).pop() ?? path;
      openPath = path;
      // A beat after the folder is open, so the strip lands in a conversation
      // that exists. In the app this arrives when a turn has finished and the
      // pictures have been taken; here it is on a timer, because there is no
      // folder to photograph.
      setTimeout(() => {
        for (const one of looking) one({ project: path, change: PREVIEW_CHANGE });
      }, 500);
      return Promise.resolve(done({ path, name }));
    },

    async prompt(): Promise<Result<null>> {
      for (const piece of inPieces(PREVIEW_REPLY)) {
        await new Promise((wake) => setTimeout(wake, 40));
        send({ type: 'message-delta', text: piece });
      }
      send({ type: 'message-end' });
      return done(null);
    },

    stop(): Promise<Result<null>> {
      return Promise.resolve(done(null));
    },

    answer(_callId: string, _decision: Decision): Promise<Result<boolean>> {
      return Promise.resolve(done(true));
    },

    /** The third project, as though somebody had gone and found it. A browser
     *  tab has no folder picker to open, and answering "you closed it" would
     *  leave the one control on the empty picker doing nothing at all. */
    chooseFolder(): Promise<Result<string | null>> {
      const unopened = PREVIEW_PROJECTS.find((one) => one.path !== openPath);
      return Promise.resolve(done(unopened?.path ?? null));
    },

    recentProjects(): Promise<Result<readonly RecentProject[]>> {
      return Promise.resolve(done(remembered()));
    },

    forgetProject(path: string): Promise<Result<readonly RecentProject[]>> {
      forgotten.add(path);
      return Promise.resolve(done(remembered()));
    },

    versions(): Promise<Result<readonly SavedVersion[]>> {
      return Promise.resolve(done(openPath === null ? [] : versionsFor(openPath)));
    },

    putBack(versionId: string): Promise<Result<PutBack>> {
      if (openPath === null) return Promise.resolve(done(emptyPutBack()));
      const list = versionsFor(openPath);
      const target = list.find((one) => one.id === versionId) ?? list[0];
      if (target === undefined) return Promise.resolve(done(emptyPutBack()));

      // Going back is itself a version, exactly as it is in the app.
      const wentBack: SavedVersion = {
        id: `${openPath}#back-${list.length}`,
        at: Date.now(),
        title: `Went back to “${target.title}”`,
        by: 'you',
        named: false,
        current: true,
      };
      const next = [wentBack, ...list.map((one) => ({ ...one, current: false }))];
      versions.set(openPath, next);
      return Promise.resolve(
        done({
          title: target.title,
          at: target.at,
          undoTo: list[0]?.id ?? target.id,
          versions: next,
        }),
      );
    },

    nameVersion(versionId: string, name: string): Promise<Result<readonly SavedVersion[]>> {
      if (openPath === null) return Promise.resolve(done([]));
      const named = versionsFor(openPath).map((one) =>
        one.id === versionId ? { ...one, title: name.trim() || one.title, named: true } : one,
      );
      versions.set(openPath, named);
      return Promise.resolve(done(named));
    },

    /** Remembered for as long as the tab is open, and no longer. A browser tab
     *  has nowhere of its own to keep a preference, and writing one into
     *  somebody's browser storage from a preview would be a surprise. */
    preferences(): Promise<Result<Preferences>> {
      return Promise.resolve(done({ ...preferred }));
    },

    setShowMe(on: boolean): Promise<Result<Preferences>> {
      preferred = { ...preferred, showMe: on };
      return Promise.resolve(done({ ...preferred }));
    },

    /** Named, so the escape hatches can be looked at and reviewed. Pressing
     *  either one says so rather than pretending it opened something. */
    hatches(): Promise<Result<Hatches>> {
      return Promise.resolve(done({ editor: 'VS Code' }));
    },

    openInEditor(): Promise<Result<null>> {
      send({
        type: 'error',
        message:
          'This is Graphe running in a browser tab, so there is no folder underneath and nothing to open. In the app this opens your project in your own editor.',
      });
      return Promise.resolve(done(null));
    },

    revealFolder(): Promise<Result<null>> {
      send({
        type: 'error',
        message:
          'This is Graphe running in a browser tab, so there is no folder underneath to show you. In the app this opens it in the Finder.',
      });
      return Promise.resolve(done(null));
    },

    /** The two sentences, in order, and then the honest answer: there is no
     *  folder behind a browser tab, so there is nothing to get ready. */
    async show(): Promise<Result<ShowOutcome>> {
      for (const progress of watching) {
        progress({ says: showWords.puttingTogether, done: false });
      }
      await new Promise((wake) => setTimeout(wake, 900));
      for (const progress of watching) progress({ says: showWords.ready, done: true });
      return done({
        kind: 'unsure',
        question:
          'This is Graphe running in a browser tab, so there is no folder underneath and nothing for me to get ready. Open the desktop app and this button will show you your own site.',
      });
    },

    onShowProgress(listener: (progress: ShowProgress) => void): () => void {
      watching.add(listener);
      return () => {
        watching.delete(listener);
      };
    },

    onEvent(listener: (notice: AgentNotice) => void): () => void {
      listeners.add(listener);
      // A beat, so the interface is mounted and the meter arrives the way it
      // does in the desktop app — as something that appears, not as part of the
      // first paint.
      setTimeout(announceSpend, 60);
      return () => {
        listeners.delete(listener);
      };
    },

    /** The same two pictures every time. They are drawn rather than
     *  photographed — see `samplePage` — but everything the component does with
     *  them is the real thing. */
    visualFrames(): Promise<Result<VisualFrames>> {
      return Promise.resolve(
        done({ before: PREVIEW_CHANGE.beforeThumb, after: PREVIEW_CHANGE.afterThumb }),
      );
    },

    onVisualChange(listener: (notice: VisualNotice) => void): () => void {
      looking.add(listener);
      return () => {
        looking.delete(listener);
      };
    },
  };
}

/** Nothing to go back to. Only reachable in the preview, where a person can
 *  press the button before anything has been opened. */
function emptyPutBack(): PutBack {
  return { title: '', at: Date.now(), undoTo: '', versions: [] };
}

/* -------------------------------------------------------------------------- */
/* The one the app uses                                                        */
/* -------------------------------------------------------------------------- */

function connect(): Bridge {
  const api = typeof window === 'undefined' ? undefined : window.graphe;
  if (api === undefined) return previewBridge();

  return {
    desktop: true,
    openProject: (path) => api.openProject(path),
    prompt: (text) => api.prompt(text),
    stop: () => api.stop(),
    answer: (callId, decision) => api.answer(callId, decision),
    chooseFolder: () => api.chooseFolder(),
    recentProjects: () => api.recentProjects(),
    forgetProject: (path) => api.forgetProject(path),
    versions: () => api.versions(),
    putBack: (versionId) => api.putBack(versionId),
    nameVersion: (versionId, name) => api.nameVersion(versionId, name),
    preferences: () => api.preferences(),
    setShowMe: (on) => api.setShowMe(on),
    hatches: () => api.hatches(),
    openInEditor: () => api.openInEditor(),
    revealFolder: () => api.revealFolder(),
    show: () => api.show(),
    onShowProgress: (listener) => api.onShowProgress(listener),
    onEvent: (listener) => api.onEvent(listener),
    visualFrames: (changeId) => api.visualFrames(changeId),
    onVisualChange: (listener) => api.onVisualChange(listener),
  };
}

/** Read once. Whether there is a shell underneath cannot change while the page
 *  is open, and re-checking on every render would only invite the interface to
 *  behave differently at two moments for no reason. */
export const bridge: Bridge = connect();

// The desktop window hides its title bar, so the layout needs to know to leave
// room for the traffic lights. A stylesheet is the right place for that, and an
// attribute is how a stylesheet finds out.
if (typeof document !== 'undefined' && bridge.desktop) {
  document.documentElement.dataset['shell'] = 'desktop';
}
