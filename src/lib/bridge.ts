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
import {
  findMoved,
  nameOfDesign,
  saysInStep,
  NOTHING_FOLLOWED,
  type Design,
} from '../design/moved';
import { pagesIn, type Page } from '../preview/pages';
import { keeping } from '../projects/kept';
import { Ledger } from '../cost/ledger';
import { money } from '../cost/money';
import { nextRun, saysNext, saysRepeat, type Repeat } from '../work/schedule';
import {
  showWords,
  type AgentNotice,
  type Away,
  type AwayPiece,
  type EveryKind,
  type Repeating,
  type ConnectOutcome,
  type ConnectStep,
  type Conversation,
  type ConnectionState,
  type Decided,
  type Decision,
  type FileEntry,
  type HandedOver,
  type Landing,
  type WentOnline,
  type FoundAccount,
  type GrapheApi,
  type Hatches,
  type InStep,
  type ModelChoice,
  type OpenedProject,
  type Look,
  type Overview,
  type Pack,
  type Preferences,
  type PromptAttachment,
  type ProviderMethod,
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

/** A few things somebody could add, so the screen can be seen in a browser. */
const PREVIEW_PACKS: readonly Pack[] = [
  { id: 'pi-web-access', name: 'Web access', kind: 'extension', summary: 'Read pages on the web while working.', downloads: 222_000, version: '1.4.0', installed: true, curated: true },
  { id: 'pi-lens', name: 'Lens', kind: 'extension', summary: 'Tells the agent when code it wrote does not compile.', downloads: 40_900, version: '2.1.0', installed: false, curated: true },
  { id: 'pi-subagents', name: 'Helpers', kind: 'mixed', summary: 'Send parts of a job to helpers working at once.', downloads: 214_000, version: '3.0.1', installed: false, curated: true },
  { id: 'pi-schedule', name: 'Schedule', kind: 'skill', summary: 'Run something on a timer.', downloads: 9_100, version: '0.4.2', installed: false, curated: false },
];

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

/**
 * Which of the made-up versions have a picture, and which do not.
 *
 * Deliberately not all of them. The rail's two most interesting states only
 * exist when the pictures are uneven: a version with none falls back to its own
 * title, and two in a row that look identical are what "only when it changed"
 * is for. Indexes not listed here have no picture, which is the honest answer
 * rather than a stand-in.
 */
const PREVIEW_PICTURES: Readonly<Record<string, Readonly<Record<number, boolean>>>> = {
  '/Users/you/Sites/paper-street': { 0: true, 1: false, 2: false, 3: true },
  '/Users/you/Sites/atlas-studio': { 0: true },
};

/* -------------------------------------------------------------------------- */
/* A project's own files, for a tab with no project behind it                  */
/* -------------------------------------------------------------------------- */

/** What this made-up project has changed since its last version. Written once
 *  and used twice — by the overview and by the file panel — because the two
 *  disagreeing about which files moved is exactly the sort of thing nobody
 *  notices until it is on a screenshot. */
const PREVIEW_CHANGED: readonly string[] = [
  'src/components/Hero.tsx',
  'src/styles/tokens.css',
  'src/pages/pricing.tsx',
  'public/hero-bg.svg',
];

/**
 * Everything the made-up project holds.
 *
 * Enough of it to be a real tree: folders inside folders, a couple of things
 * beginning with a dot and a lock file nobody wrote, so "Every file" has
 * something to reveal rather than being a chip that does nothing here.
 */
const PREVIEW_FILES: readonly FileEntry[] = [
  { path: 'README.md', size: 2_310 },
  { path: 'package.json', size: 1_842 },
  { path: 'package-lock.json', size: 214_006 },
  { path: '.gitignore', size: 128 },
  { path: '.prettierrc', size: 64 },
  { path: 'public/hero-bg.svg', size: 4_820 },
  { path: 'public/favicon.ico', size: 15_086 },
  { path: 'public/fonts/soehne-buch.woff2', size: 41_204 },
  { path: 'src/app/page.tsx', size: 3_140 },
  { path: 'src/app/about/page.tsx', size: 1_980 },
  { path: 'src/app/pricing/page.tsx', size: 2_640 },
  { path: 'src/app/(marketing)/case-studies/page.tsx', size: 3_912 },
  { path: 'src/app/work/[slug]/page.tsx', size: 2_204 },
  { path: 'src/components/Hero.tsx', size: 1_664 },
  { path: 'src/components/Nav.tsx', size: 1_120 },
  { path: 'src/components/Footer.tsx', size: 890 },
  { path: 'src/pages/pricing.tsx', size: 2_512 },
  { path: 'src/styles/tokens.css', size: 3_408 },
  { path: 'src/styles/palette.css', size: 1_206 },
].map((one) => (PREVIEW_CHANGED.includes(one.path) ? { ...one, changed: true } : one));

/** A few of them, written out, so opening one shows a file rather than a
 *  sentence about there not being one. */
const PREVIEW_TEXT: Readonly<Record<string, string>> = {
  'src/components/Hero.tsx': `import './Hero.css';

type Props = {
  title: string;
  blurb: string;
};

export default function Hero({ title, blurb }: Props) {
  return (
    <section className="hero">
      <h1 className="hero__title">{title}</h1>
      <p className="hero__blurb">{blurb}</p>
      <a className="hero__cta" href="/pricing">
        See what it costs
      </a>
    </section>
  );
}
`,
  'src/styles/tokens.css': `:root {
  --space-4: 16px;
  --radius-md: 10px;
  --accent: #b8492c;
  --text: #1a1a19;
  --bg: #fbfbfa;
}

.hero__cta {
  background: #bd4b2f;
  padding: 15px;
}
`,
  'README.md': `# paper-street

A small site, made in Graphe.

Everything in here is ordinary: a folder of pages, a folder of components and
one stylesheet holding the values the rest of it borrows from.
`,
};

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
  inDesignWords: 'Spacing on three cards, from 16 to 24.',
  where: 'One area changed, near the top on the left.',
  areas: [{ x: 0.045, y: 0.305, width: 0.155, height: 0.08 }],
  beforeThumb: samplePage(false),
  afterThumb: samplePage(true),
  width: 1180,
  height: 820,
};

/**
 * Work carrying on without anybody, for a tab where nothing carries on at all.
 *
 * Three pieces on purpose, because the three states that matter look completely
 * different: one stopped on a question it will not answer for itself, one
 * finished with a picture of what it made, and one still going. A browser tab
 * would otherwise only ever draw the empty one.
 */
function previewAway(): Away {
  const pieces: readonly AwayPiece[] = [
    {
      id: 'away-1',
      doing: 'Add the pricing table to the home page',
      state: 'needs-you',
      at: started - 4 * MINUTE,
      picture: null,
      says: 'I need one more thing before I can carry on.',
      trouble: null,
      question: {
        callId: 'call-1',
        question: 'Add “stripe” to your project?',
        detail:
          'This comes from the internet, and pieces like this are allowed to run their own setup steps the moment they arrive.',
        consequence: 'That setup can read and change files in your project.',
      },
    },
    {
      id: 'away-2',
      doing: 'Check the site still builds',
      state: 'done',
      at: started - 22 * MINUTE,
      picture: samplePage(true),
      says: 'It builds, and nothing looks different from yesterday.',
      trouble: null,
      question: null,
    },
    {
      id: 'away-3',
      doing: 'Match the case study page to the new spacing',
      state: 'running',
      at: started - MINUTE,
      picture: null,
      says: null,
      trouble: null,
      question: null,
    },
  ];
  const repeats: readonly Repeating[] = [
    {
      id: 'every-1',
      doing: 'Check the site still builds and tell me if it doesn’t',
      says: 'Every day at 7:00am',
      next: 'Tomorrow at 7:00am',
      on: true,
      lastSaid: 'It builds.',
    },
  ];
  return {
    pieces,
    repeats,
    atOnce: 4,
    spent: money(37, PREVIEW_CURRENCY),
    sinceYouWere: 'One thing waiting on you, one thing ready to look at, one thing still going.',
  };
}

function previewBridge(): Bridge {
  const listeners = new Set<(notice: AgentNotice) => void>();
  const watching = new Set<(progress: ShowProgress) => void>();
  const looking = new Set<(notice: VisualNotice) => void>();
  const connecting = new Set<(step: ConnectStep) => void>();

  /** What is going on without anybody. Real state, for as long as the tab is
   *  open, so the band can be pressed rather than only looked at. */
  let atWork: Away = previewAway();

  /** What the tab is keeping in step with. Nothing, until somebody pastes
   *  something into the band. */
  let figmaHere: InStep = NOT_FOLLOWING;

  /** Whatever project the tab has open. Every event is stamped with it, the way
   *  the shell stamps its own — the window's routing is then exercised here
   *  rather than only in the app. */
  let openPath: string | null = null;

  /** The preview's own copy of what a person has chosen. Real state, so the
   *  switch in the project menu can be turned on and its effect looked at. */
  /** `showFiles` starts on here and nowhere else, for the same reason the
   *  version rail has versions: a region that has to be asked for is a region
   *  a browser tab would never draw, and one nobody could look at. */
  let preferred: Preferences = {
    showMe: false,
    model: null,
    kept: {},
    showFiles: true,
    holdBack: false,
  };

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
      // No saved conversation in a browser tab — there is no disk. The window
      // therefore greets the folder the way it greets a new one (B1.1).
      return Promise.resolve(done({ path, name, history: [], conversation: null }));
    },

    async prompt(
      _text: string,
      _attachments?: readonly PromptAttachment[],
    ): Promise<Result<null>> {
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

  /** The preview's folder is a folder somebody made up, but its git is real
   *  enough to draw the section: a branch, an uncommitted change, something
   *  waiting on the other side. Nothing is being served for it, so there is no
   *  preview to offer — a button that opens nothing is worse than no button. */
  overview(): Promise<Result<Overview>> {
    return Promise.resolve(
      done({
        git: {
          branch: 'main',
          dirty: true,
          unstaged: 2,
          staged: 1,
          untracked: 1,
          ahead: 0,
          behind: 2,
          files: PREVIEW_CHANGED.map((path) => ({
            path,
            kind: path.startsWith('public/') ? ('new' as const) : ('changed' as const),
          })),
        },
        preview: null,
        artifacts: [
          { path: 'public/hero-bg.svg', name: 'hero-bg.svg', kind: 'vector', note: 'SVG · a drawing' },
          { path: 'src/styles/palette.css', name: 'palette.css', kind: 'palette', note: 'your colour tokens' },
        ],
        swatches: [
          { name: 'brand', value: '#b8492c' },
          { name: 'ink', value: '#1a1a19' },
          { name: 'paper', value: '#fbfbfa' },
          { name: 'edge', value: '#e4e4e1' },
        ],
        styles: {
          file: 'src/styles/tokens.css',
          tokens: [
            { name: '--space-4', value: '16px', kind: 'space', line: 42, steps: ['4px', '8px', '12px', '16px', '24px', '32px'] },
            { name: '--radius-md', value: '10px', kind: 'radius', line: 49, steps: ['4px', '6px', '10px', '14px'] },
            { name: '--accent', value: '#b8492c', kind: 'colour', line: 95, steps: [] },
            // Named the way a project names things, so the readability band has
            // real pairings: the muted grey is too pale on either surface.
            { name: '--text', value: '#1a1a19', kind: 'colour', line: 96, steps: [] },
            { name: '--text-muted', value: '#a3a3a0', kind: 'colour', line: 97, steps: [] },
            { name: '--bg', value: '#fbfbfa', kind: 'colour', line: 98, steps: [] },
            { name: '--bg-sunken', value: '#f1f1ee', kind: 'colour', line: 99, steps: [] },
          ],
          // Two near-misses on purpose, so the drift band has something to say
          // in the preview: a hair off the accent, and a hair off --space-4.
          text: [
            ':root {',
            '  --space-4: 16px;',
            '  --radius-md: 10px;',
            '  --accent: #b8492c;',
            '}',
            '.hero__cta { background: #bd4b2f; padding: 15px; }',
          ].join('\n'),
        },
      }),
    );
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

    /** Drawn rather than photographed, like the before-and-after above: a
     *  browser tab has no folder to point a camera at, and a rail with no
     *  pictures in it is the one state nobody could review. */
    versionPictures(): Promise<Result<Readonly<Record<string, string>>>> {
      if (openPath === null) return Promise.resolve(done({}));
      const which = PREVIEW_PICTURES[openPath] ?? {};
      const pictures: Record<string, string> = {};
      for (const [index, moved] of Object.entries(which)) {
        pictures[`${openPath}#${index}`] = samplePage(moved);
      }
      return Promise.resolve(done(pictures));
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

    setShowFiles(on: boolean): Promise<Result<Preferences>> {
      preferred = { ...preferred, showFiles: on };
      return Promise.resolve(done({ ...preferred }));
    },

    /** A whole project, made up, so the panel can be opened and reviewed in a
     *  browser tab — folders inside folders, and the same files the overview
     *  says have moved. */
    projectFiles(): Promise<Result<readonly FileEntry[]>> {
      return Promise.resolve(done(PREVIEW_FILES));
    },

    /** Three of them are written out; the rest say so rather than inventing a
     *  file somebody might believe. */
    fileText(path: string): Promise<Result<string>> {
      const text = PREVIEW_TEXT[path];
      if (text !== undefined) return Promise.resolve(done(text));
      return Promise.resolve({
        ok: false,
        trouble: {
          what: 'I could not open that file.',
          because:
            'This is Graphe running in a browser tab, so there is no folder underneath and only a few of these have anything in them.',
          actionLabel: 'Got it',
        },
      });
    },

    keepVersion(versionId: string, keep: boolean): Promise<Result<Preferences>> {
      const project = openPath ?? '';
      preferred = { ...preferred, kept: keeping(preferred.kept, project, versionId, keep) };
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

    nudgeToken(): Promise<Result<readonly SavedVersion[]>> {
      const path = openPath ?? PREVIEW_PROJECTS[0]?.path ?? '';
      return Promise.resolve(done(previewVersions(path)));
    },
    nudgeMotion(): Promise<Result<readonly SavedVersion[]>> {
      const path = openPath ?? PREVIEW_PROJECTS[0]?.path ?? '';
      return Promise.resolve(done(previewVersions(path)));
    },


    saveVersion(name?: string): Promise<Result<readonly SavedVersion[]>> {
      const saved: SavedVersion = {
        id: `v-${String(Date.now())}`,
        at: Date.now(),
        title: name === undefined || name.trim() === '' ? 'Saved where you were' : name.trim(),
        by: 'you',
        named: name !== undefined && name.trim() !== '',
        current: true,
      };
      const path = openPath ?? PREVIEW_PROJECTS[0]?.path ?? '';
      const already = previewVersions(path).map((one) => ({ ...one, current: false }));
      return Promise.resolve(done([saved, ...already]));
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

    /** A folder somebody made up, with the shape of a real one, so the rail's
     *  Pages band can be seen and reviewed in a browser tab. */
    pages(): Promise<Result<readonly Page[]>> {
      return Promise.resolve(
        done(
          pagesIn([
            'src/app/page.tsx',
            'src/app/about/page.tsx',
            'src/app/pricing/page.tsx',
            'src/app/(marketing)/case-studies/page.tsx',
            'src/app/work/[slug]/page.tsx',
            'src/components/Hero.tsx',
          ]),
        ),
      );
    },

    /** A browser tab is never full screen in the sense that matters here — it
     *  has no traffic lights to make room for. */
    onWindowState(): () => void {
      return () => {};
    },

    /** Nothing is being served behind a browser tab, so nothing can be
     *  pointed at. */
    onPointed(): () => void {
      return () => {};
    },

    shareReview(): Promise<Result<string | null>> {
      send({
        type: 'error',
        message:
          'This is Graphe running in a browser tab, so there is nothing on disk to make a page out of. In the app this writes a page you can send to somebody.',
      });
      return Promise.resolve(done(null));
    },

    checkWidths(): Promise<Result<{ looks: readonly Look[]; says: string }>> {
      return Promise.resolve(
        done({
          // The sizes a project like this one designs at rather than three
          // stock ones, which is what the app finds in its stylesheets.
          looks: [
            { id: 'phone', name: 'Phone', width: 390, shot: null, trouble: null },
            { id: 'tablet', name: 'Tablet', width: 768, shot: null, trouble: null },
            { id: 'laptop', name: 'Laptop', width: 1024, shot: null, trouble: null },
            { id: 'desktop', name: 'Desktop', width: 1440, shot: null, trouble: null },
          ],
          says: 'There is no folder underneath a browser tab, so there is nothing to photograph.',
        }),
      );
    },

    conversations(): Promise<Result<readonly Conversation[]>> {
      return Promise.resolve(
        done([
          { id: 'c1', path: 'a', title: 'Make the pricing page work on a phone', at: started - 4 * MINUTE, messages: 12 },
          { id: 'c2', path: 'b', title: 'Rebuild the hero from the Figma frame', at: started - 3 * HOUR, messages: 31 },
          { id: 'c3', path: 'c', title: 'Yesterday afternoon', at: started - 26 * HOUR, messages: 6 },
        ]),
      );
    },

    openConversation(): Promise<Result<OpenedProject>> {
      const first = PREVIEW_PROJECTS[0];
      return Promise.resolve(
        done({ path: first?.path ?? '', name: first?.name ?? '', history: [], conversation: null }),
      );
    },

    packages(): Promise<Result<readonly Pack[]>> {
      return Promise.resolve(done(PREVIEW_PACKS));
    },

    addPackage(id: string): Promise<Result<readonly Pack[]>> {
      return Promise.resolve(
        done(PREVIEW_PACKS.map((one) => (one.id === id ? { ...one, installed: true } : one))),
      );
    },

    removePackage(id: string): Promise<Result<readonly Pack[]>> {
      return Promise.resolve(
        done(PREVIEW_PACKS.map((one) => (one.id === id ? { ...one, installed: false } : one))),
      );
    },

    explainPackage(): Promise<Result<string>> {
      return Promise.resolve(
        done('It lets Graphe read pages on the web while it works, so it can check something rather than guess at it.'),
      );
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

    /** The sample connection above, with whatever model the visitor chose
     *  worn over it. */
    connection(): Promise<Result<ConnectionState>> {
      return Promise.resolve(done({ ...PREVIEW_CONNECTION, chosen: preferred.model }));
    },

    /** A pretend connection: the steps are real, the browser tab is not. The
     *  window follows along exactly as it would in the app, which is the point
     *  of the exercise. */
    async connect(
      _providerId: string,
      _method: ProviderMethod,
    ): Promise<Result<ConnectOutcome>> {
      for (const listener of connecting) {
        listener({ type: 'progress', message: 'Checking what this account can do…' });
      }
      await new Promise((wake) => setTimeout(wake, 700));
      for (const listener of connecting) {
        listener({ type: 'progress', message: 'Connected.' });
      }
      return Promise.resolve(done({ kind: 'connected' }));
    },

    connectAnswer(_promptId: string, _value: string | null): Promise<Result<null>> {
      return Promise.resolve(done(null));
    },

    cancelConnect(): Promise<Result<null>> {
      return Promise.resolve(done(null));
    },

    disconnect(_providerId: string): Promise<Result<null>> {
      return Promise.resolve(done(null));
    },

    /** Remembered for as long as the tab is open, exactly like the switch. */
    selectModel(choice: ModelChoice): Promise<Result<Preferences>> {
      preferred = { ...preferred, model: choice };
      return Promise.resolve(done({ ...preferred }));
    },

    onConnectStep(listener: (step: ConnectStep) => void): () => void {
      connecting.add(listener);
      return () => {
        connecting.delete(listener);
      };
    },

    /** A browser tab has no shell and no other tool's files; there is nothing
     *  to find, honestly. */
    discoveredAccounts(): Promise<Result<readonly FoundAccount[]>> {
      return Promise.resolve(done([]));
    },

    importAccount(_account: FoundAccount): Promise<Result<null>> {
      return Promise.resolve(done(null));
    },

    openLink(_url: string): Promise<Result<null>> {
      return Promise.resolve(done(null));
    },

    /* Landing work somewhere needs a folder, a computer and somebody's account.
       A browser tab has none of the three, so the band draws itself and says
       exactly why each thing is out of reach rather than pretending. */
    landing(): Promise<Result<Landing>> {
      return Promise.resolve(
        done({
          waiting: null,
          holdBack: preferred.holdBack,
          canHandOver: false,
          handOverSays: PREVIEW_LANDING,
          canPutOnline: false,
          onlineSays: PREVIEW_LANDING,
        }),
      );
    },

    setHoldBack(on: boolean): Promise<Result<Preferences>> {
      preferred = { ...preferred, holdBack: on };
      return Promise.resolve(done({ ...preferred }));
    },

    decideOnWork(letIn: boolean): Promise<Result<Decided>> {
      return Promise.resolve(
        done({
          landing: {
            waiting: null,
            holdBack: preferred.holdBack,
            canHandOver: false,
            handOverSays: PREVIEW_LANDING,
            canPutOnline: false,
            onlineSays: PREVIEW_LANDING,
          },
          versions: [],
          letIn,
          undoTo: null,
        }),
      );
    },

    handToDeveloper(_confirmed: boolean): Promise<Result<HandedOver>> {
      return Promise.resolve(
        done({ sent: false, name: '', address: null, says: PREVIEW_LANDING, steps: [] }),
      );
    },

    putOnline(_confirmed: boolean): Promise<Result<WentOnline>> {
      return Promise.resolve(done({ address: null, pages: 0, says: PREVIEW_LANDING, steps: [] }));
    },

    /* Real state for as long as the tab is open: pressing the buttons moves the
       board, so what a person does to one of these can actually be looked at. */
    away(): Promise<Result<Away>> {
      return Promise.resolve(done(atWork));
    },

    keepGoing(text: string): Promise<Result<Away>> {
      atWork = {
        ...atWork,
        pieces: [
          {
            id: `away-${String(atWork.pieces.length + 1)}`,
            doing: text,
            state: 'running',
            at: Date.now(),
            picture: null,
            says: null,
            trouble: null,
            question: null,
          },
          ...atWork.pieces,
        ],
      };
      return Promise.resolve(done(atWork));
    },

    stopAway(id: string): Promise<Result<Away>> {
      atWork = { ...atWork, pieces: atWork.pieces.filter((one) => one.id !== id) };
      return Promise.resolve(done(atWork));
    },

    keepAway(id: string): Promise<Result<Away>> {
      atWork = { ...atWork, pieces: atWork.pieces.filter((one) => one.id !== id) };
      return Promise.resolve(done(atWork));
    },

    /* The same rule a browser tab can still demonstrate: nothing answers itself,
       and answering moves that one on. */
    answerAway(id: string, _callId: string, decision: Decision): Promise<Result<Away>> {
      atWork = {
        ...atWork,
        pieces: atWork.pieces.map((one) =>
          one.id !== id
            ? one
            : {
                ...one,
                question: null,
                state: decision === 'yes' ? 'running' : 'done',
                says:
                  decision === 'yes'
                    ? 'Carrying on now.'
                    : 'You said no, so I left it and carried on without it.',
              },
        ),
      };
      return Promise.resolve(done(atWork));
    },

    addRepeat(
      doing: string,
      every: EveryKind,
      at: { hour: number; minute: number },
      on?: number,
    ): Promise<Result<Away>> {
      const repeat: Repeat =
        every === 'week'
          ? { every, on: ((on ?? 1) % 7) as 0 | 1 | 2 | 3 | 4 | 5 | 6, at }
          : every === 'month'
            ? { every, on: on ?? 1, at }
            : { every, at };
      atWork = {
        ...atWork,
        repeats: [
          ...atWork.repeats,
          {
            id: `every-${String(atWork.repeats.length + 1)}`,
            doing,
            says: saysRepeat(repeat),
            next: saysNext(nextRun(repeat, Date.now()), Date.now()),
            on: true,
            lastSaid: null,
          },
        ],
      };
      return Promise.resolve(done(atWork));
    },

    switchRepeat(id: string, on: boolean): Promise<Result<Away>> {
      atWork = {
        ...atWork,
        repeats: atWork.repeats.map((one) => (one.id === id ? { ...one, on } : one)),
      };
      return Promise.resolve(done(atWork));
    },

    forgetRepeat(id: string): Promise<Result<Away>> {
      atWork = { ...atWork, repeats: atWork.repeats.filter((one) => one.id !== id) };
      return Promise.resolve(done(atWork));
    },

    /* Nothing lands on its own behind a browser tab, so nothing is ever pushed
       at the window here. It asks, and it is answered. */
    onAway(): () => void {
      return () => {};
    },

    inStep(): Promise<Result<InStep>> {
      return Promise.resolve(done(figmaHere));
    },

    /* A browser tab has no account to read a real file with, so the invented
       project follows an invented file. The findings under it are not invented:
       they are what the comparison makes of the two readings below. */
    followDesign(address: string): Promise<Result<InStep>> {
      figmaHere = inStepPreview(address);
      return Promise.resolve(done(figmaHere));
    },

    lookAgain(): Promise<Result<InStep>> {
      return Promise.resolve(done(figmaHere));
    },

    caughtUp(): Promise<Result<InStep>> {
      figmaHere = {
        ...figmaHere,
        moved: [],
        says: saysInStep(figmaHere.following?.name ?? 'that file', []),
      };
      return Promise.resolve(done(figmaHere));
    },

    stopFollowing(): Promise<Result<InStep>> {
      figmaHere = NOT_FOLLOWING;
      return Promise.resolve(done(figmaHere));
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Staying in step, in a browser tab                                           */
/* -------------------------------------------------------------------------- */

const NOT_FOLLOWING: InStep = {
  following: null,
  moved: [],
  says: NOTHING_FOLLOWED,
  trouble: null,
};

/** The header as it was built, and the header as somebody left it on Tuesday. */
const PREVIEW_BUILT: Design = {
  frames: [{ id: '1:23', name: 'Header', width: 1440, height: 96 }],
  values: {
    colors: { 'color-brand-primary': '#b8492c', 'color-ink': '#1a1a19' },
    spacing: { 'space-gutter': '24px' },
    text: { 'font-family-heading': 'Söhne' },
  },
};

const PREVIEW_NOW: Design = {
  frames: [{ id: '1:23', name: 'Header', width: 1440, height: 128 }],
  values: {
    colors: { 'color-brand-primary': '#8f3620', 'color-ink': '#1a1a19' },
    spacing: { 'space-gutter': '32px' },
    text: { 'font-family-heading': 'Söhne' },
  },
};

function inStepPreview(address: string): InStep {
  const name = nameOfDesign(address, PREVIEW_NOW.frames);
  const moved = findMoved(PREVIEW_BUILT, PREVIEW_NOW, { name });
  return {
    following: { id: 'preview', name, url: address.trim(), readAt: Date.now() },
    moved,
    says: saysInStep(name, moved),
    trouble: null,
  };
}

/** What a browser tab can honestly say about landing work anywhere. */
const PREVIEW_LANDING =
  'This is Graphe in a browser tab, so there is no project folder here to send anywhere.';

/** Nothing to go back to. Only reachable in the preview, where a person can
 *  press the button before anything has been opened. */
function emptyPutBack(): PutBack {
  return { title: '', at: Date.now(), undoTo: '', versions: [] };
}

/* -------------------------------------------------------------------------- */
/* An account and some models, for a tab with no shell under it                */
/* -------------------------------------------------------------------------- */

/**
 * Who can think for this tab: the same three providers a real computer offers,
 * in the same shape — Anthropic with an account already there, the other two
 * waiting. The numbers are invented, but the states are the real states: what
 * "connected" looks like against "not yet", and how a chosen model reads when
 * it is the only thing wearing the accent.
 */
const PREVIEW_CONNECTION: ConnectionState = {
  providers: [
    {
      providerId: 'anthropic',
      name: 'Anthropic',
      methods: ['oauth', 'api-key'],
      oauthLabel: 'Sign in with Claude Pro or Max',
      apiKeyLabel: 'Anthropic API key',
      connected: true,
      available: true,
      models: [
        { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5', available: true, rates: { input: 3, output: 15 }, contextWindow: 1000000 },
        { id: 'claude-opus-4-5', label: 'Claude Opus 4.5', available: true, rates: { input: 5, output: 25 }, contextWindow: 200000 },
        { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', available: true, rates: { input: 1, output: 5 }, contextWindow: 200000 },
      ],
    },
    {
      providerId: 'openai-codex',
      name: 'OpenAI Codex',
      methods: ['oauth'],
      oauthLabel: 'Sign in with ChatGPT Plus or Pro',
      apiKeyLabel: null,
      connected: false,
      available: false,
      models: [
        { id: 'gpt-5', label: 'GPT-5', available: false, rates: { input: 1.25, output: 10 }, contextWindow: 400000 },
        { id: 'gpt-5-mini', label: 'GPT-5 mini', available: false, rates: { input: 0.25, output: 2 }, contextWindow: 400000 },
      ],
    },
    {
      providerId: 'opencode',
      name: 'OpenCode Zen',
      methods: ['api-key'],
      oauthLabel: null,
      apiKeyLabel: 'OpenCode API key',
      connected: false,
      available: false,
      models: [
        { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5', available: false, rates: { input: 3, output: 15 }, contextWindow: 1000000 },
        { id: 'deepseek-v3.1', label: 'DeepSeek V3.1', available: false, rates: { input: 0.435, output: 0.87 }, contextWindow: 1000000 },
        { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', available: false, rates: { input: 1.25, output: 10 }, contextWindow: 1048576 },
      ],
    },
  ],
  chosen: { providerId: 'anthropic', modelId: 'claude-sonnet-4-5' },
};

/* -------------------------------------------------------------------------- */
/* The one the app uses                                                        */
/* -------------------------------------------------------------------------- */

function connect(): Bridge {
  const api = typeof window === 'undefined' ? undefined : window.graphe;
  if (api === undefined) return previewBridge();

  return {
    desktop: true,
    openProject: (path) => api.openProject(path),
    prompt: (text, attachments) => api.prompt(text, attachments),
    stop: () => api.stop(),
    answer: (callId, decision) => api.answer(callId, decision),
    chooseFolder: () => api.chooseFolder(),
    recentProjects: () => api.recentProjects(),
    overview: () => api.overview(),
    forgetProject: (path) => api.forgetProject(path),
    versions: () => api.versions(),
    putBack: (versionId) => api.putBack(versionId),
    nameVersion: (versionId, name) => api.nameVersion(versionId, name),
    versionPictures: () => api.versionPictures(),
    preferences: () => api.preferences(),
    setShowMe: (on) => api.setShowMe(on),
    keepVersion: (versionId, keep) => api.keepVersion(versionId, keep),
    setShowFiles: (on) => api.setShowFiles(on),
    projectFiles: () => api.projectFiles(),
    fileText: (path) => api.fileText(path),
    hatches: () => api.hatches(),
    openInEditor: (file) => api.openInEditor(file),
    saveVersion: (name) => api.saveVersion(name),
    revealFolder: () => api.revealFolder(),
    show: (at, point) => api.show(at, point),
    onPointed: (listener) => api.onPointed(listener),
    pages: () => api.pages(),
    shareReview: () => api.shareReview(),
    checkWidths: () => api.checkWidths(),
    conversations: () => api.conversations(),
    openConversation: (path) => api.openConversation(path),
    packages: (term) => api.packages(term),
    nudgeToken: (name, value) => api.nudgeToken(name, value),
    nudgeMotion: (places, change) => api.nudgeMotion(places, change),
    addPackage: (id) => api.addPackage(id),
    removePackage: (id) => api.removePackage(id),
    explainPackage: (id) => api.explainPackage(id),
    onWindowState: (listener) => api.onWindowState(listener),
    onShowProgress: (listener) => api.onShowProgress(listener),
    onEvent: (listener) => api.onEvent(listener),
    visualFrames: (changeId) => api.visualFrames(changeId),
    onVisualChange: (listener) => api.onVisualChange(listener),
    connection: () => api.connection(),
    connect: (providerId, method) => api.connect(providerId, method),
    connectAnswer: (promptId, value) => api.connectAnswer(promptId, value),
    cancelConnect: () => api.cancelConnect(),
    disconnect: (providerId) => api.disconnect(providerId),
    selectModel: (choice) => api.selectModel(choice),
    onConnectStep: (listener) => api.onConnectStep(listener),
    discoveredAccounts: () => api.discoveredAccounts(),
    importAccount: (account) => api.importAccount(account),
    openLink: (url) => api.openLink(url),
    landing: () => api.landing(),
    setHoldBack: (on) => api.setHoldBack(on),
    decideOnWork: (letIn) => api.decideOnWork(letIn),
    handToDeveloper: (confirmed) => api.handToDeveloper(confirmed),
    putOnline: (confirmed) => api.putOnline(confirmed),
    away: () => api.away(),
    keepGoing: (text) => api.keepGoing(text),
    stopAway: (id) => api.stopAway(id),
    keepAway: (id) => api.keepAway(id),
    answerAway: (id, callId, decision) => api.answerAway(id, callId, decision),
    addRepeat: (doing, every, at, on) => api.addRepeat(doing, every, at, on),
    switchRepeat: (id, on) => api.switchRepeat(id, on),
    forgetRepeat: (id) => api.forgetRepeat(id),
    onAway: (listener) => api.onAway(listener),
    inStep: () => api.inStep(),
    followDesign: (address) => api.followDesign(address),
    lookAgain: () => api.lookAgain(),
    caughtUp: () => api.caughtUp(),
    stopFollowing: () => api.stopFollowing(),
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
