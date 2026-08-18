import { useEffect, useState, type ReactNode } from 'react';
import ActivityLine from '../components/ActivityLine';
import AddMore, { type Pack } from '../components/AddMore';
import type { Attachment } from '../components/Attachments';
import Composer from '../components/Composer';
import ConfirmChange from '../components/ConfirmChange';
import ConnectModal from '../components/ConnectModal';
import CostMeter from '../components/CostMeter';
import ErrorCard from '../components/ErrorCard';
import Files from '../components/Files';
import FileView from '../components/FileView';
import HelperRail from '../components/HelperRail';
import InLine from '../components/InLine';
import Message from '../components/Message';
import Steps from '../components/Steps';
import EvidenceReel from '../components/EvidenceReel';
import Inspector from '../components/Inspector';
import type { Reading } from '../preview/inspect';
import SeeFirst from '../components/SeeFirst';
import type { Held } from '../diff/holdshot';
import type { Recording } from '../diff/flow';
import Tabs, { type Tab } from '../components/Tabs';
import type { StepTurn } from '../lib/steps';
import type { HowFar } from '../agent/guard/policy';
import Away from '../components/Away';
import Running from '../components/Running';
import InStep from '../components/InStep';
import Landing from '../components/Landing';
import ProjectMenu from '../components/ProjectMenu';
import ProjectPicker from '../components/ProjectPicker';
import DesignView from '../components/DesignView';
import HistoryView from '../components/HistoryView';
import Overview from '../components/Overview';
import Sidebar from '../components/Sidebar';
import VersionRow from '../components/VersionRow';
import Versions from '../components/Versions';
import Welcome from '../components/Welcome';
import type {
  CarriedExtension,
  ConnectionState,
  FileEntry,
  FoundAccount,
  Away as AwayState,
  Landing as LandingState,
  PutBack,
  RecentProject,
  SavedVersion,
} from '../lib/ipc';
import type { Helper, Reference, ResearchEntry } from '../lib/projects';
import type { SpendView } from '../lib/spend';
import { createLimit } from '../cost/limits';
import { money } from '../cost/money';
import { biggerJob, estimateNote, longConversation } from '../cost/phrasing';
import type { Estimate } from '../cost/estimate';
import { findMoved, saysInStep, type Design } from '../design/moved';
import { readDesign } from '../design/reading';
import { findDrift } from '../design/drift';
import { readMotion } from '../motion/read';
import { behind, realWords } from '../lib/showme';
import './Gallery.css';

/** Every presentational component on one page, in both themes, with the content
 *  this product would actually show. Reachable at /?gallery — it exists to be
 *  screenshotted and looked at, which is the only acceptance test that counts
 *  for an interface. */

const inr = (minor: number) => money(minor, 'INR');
const monthlyLimit = createLimit(inr(200_000), 'month');

/** A real estimate object, so the confirmation below is worded by the same code
 *  the product uses rather than by hand. */
const estimate: Estimate = {
  task: { kind: 'landing-page', size: 'feature' },
  expected: inr(3500),
  low: inr(2000),
  high: inr(6000),
  confidence: 'measured',
  sampleSize: 9,
  expectedDurationMs: 4 * 60_000,
};

const bigJob = biggerJob(estimate);
const bigJobNote = estimateNote(estimate);

type Theme = 'system' | 'light' | 'dark';

/* -------------------------------------------------------------------------- */
/* Copy for the formatting section                                             */
/* -------------------------------------------------------------------------- */

/** A reply with everything in it the agent actually writes: emphasis, a
 *  numbered list, a fenced block, a table, a quote, a link, inline code. */
const FORMATTED = `Done — the hero is built from your Figma frame, and I kept to the spacing scale.

**Two things worth knowing**

1. The frame puts 68px above the headline, which is not a step on your scale. I used **72px**, the nearest one you already use everywhere else.
2. Your \`--text-2xl\` was only defined in the light theme, so dark was falling back to the browser's own size. It is set in both now.

\`\`\`css
.hero__title {
  font-size: var(--text-2xl);
  letter-spacing: -0.02em;
  margin-block: var(--space-5) var(--space-3);
}
\`\`\`

| What | In the frame | Built |
| --- | --- | --- |
| Space above the headline | 68px | 72px |
| Cards | 3 × 320px | 3 × 320px |
| Container | 1024px | 1024px |

> The cards are the only part that does not sit on your 12-column grid at 1024px.

The type scale came from [the file you linked](https://www.figma.com/design/8Kx2/Landing-v4) — say the word and I will widen the container instead.`;

/** The same renderer, mid-sentence, with a fence that has been opened and not
 *  closed. This is what the thread looks like for most of a reply's life. */
const HALF_WRITTEN = `Widening the container to 1200px. Here is the change so far:

\`\`\`css
.hero {
  max-width: 1200px;
  padding-inl`;

/** Stands in for somebody's screenshot. It is drawn here rather than fetched
 *  because the gallery has to render with nothing behind it — and because the
 *  colours in a thumbnail belong to the user's work, not to our chrome. */
const SCREENSHOT = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48">' +
    '<rect width="48" height="48" fill="#efe9e3"/>' +
    '<rect x="6" y="9" width="34" height="7" rx="2" fill="#b8492c"/>' +
    '<rect x="6" y="22" width="24" height="4" rx="2" fill="#cdc6bd"/>' +
    '<rect x="6" y="31" width="30" height="4" rx="2" fill="#cdc6bd"/>' +
    '</svg>',
)}`;

/** A page, drawn, for the cards whose whole point is that the result is a
 *  picture. Same reason as the one above: the gallery has to render with nothing
 *  behind it, and there is no folder here to photograph. */
const PAGE_SHOT = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="260" height="180">' +
    '<rect width="260" height="180" fill="#ffffff"/>' +
    '<rect width="260" height="18" fill="#fbfbfa"/>' +
    '<rect y="17" width="260" height="1" fill="#e4e4e1"/>' +
    '<rect x="14" y="6" width="26" height="5" rx="2" fill="#1a1a19"/>' +
    '<rect x="200" y="7" width="18" height="3" rx="1.5" fill="#9a9a93"/>' +
    '<rect x="226" y="7" width="18" height="3" rx="1.5" fill="#9a9a93"/>' +
    '<rect x="14" y="38" width="120" height="9" rx="3" fill="#1a1a19"/>' +
    '<rect x="14" y="54" width="88" height="9" rx="3" fill="#1a1a19"/>' +
    '<rect x="14" y="74" width="104" height="4" rx="2" fill="#9a9a93"/>' +
    '<rect x="14" y="90" width="52" height="14" rx="4" fill="#b8492c"/>' +
    '<rect x="152" y="34" width="96" height="70" rx="5" fill="#f2f2f0"/>' +
    '<rect x="14" y="120" width="70" height="44" rx="5" fill="#fbfbfa" stroke="#e4e4e1"/>' +
    '<rect x="94" y="120" width="70" height="44" rx="5" fill="#fbfbfa" stroke="#e4e4e1"/>' +
    '<rect x="174" y="120" width="70" height="44" rx="5" fill="#fbfbfa" stroke="#e4e4e1"/>' +
    '</svg>',
)}`;

/** Real tool-call inputs, so the "Show me" lines below are produced by the same
 *  function the app uses rather than typed out to look right. */
const FIGMA_FILE = { path: '/Users/you/Sites/paper-street/design/landing-v4.fig' };
const TOKENS_FILE = { path: '/Users/you/Sites/paper-street/src/styles/tokens.css' };
const BUILD = { command: 'npm run build' };

/** The kind of run that made the folded row worth building: seven reads on the
 *  way to one sentence. */
const CHAIN: readonly StepTurn[] = [
  { kind: 'did', id: 'c1', callId: 'k1', state: 'done', label: 'Reading index.html' },
  { kind: 'did', id: 'c2', callId: 'k2', state: 'done', label: 'Reading about.html' },
  { kind: 'did', id: 'c3', callId: 'k3', state: 'done', label: 'Reading pricing.html' },
  { kind: 'did', id: 'c4', callId: 'k4', state: 'done', label: 'Reading blog.html' },
  { kind: 'did', id: 'c5', callId: 'k5', state: 'failed', label: 'Reading old.html', detail: 'no longer there' },
  { kind: 'did', id: 'c6', callId: 'k6', state: 'done', label: 'Reading tokens.css' },
  {
    kind: 'did',
    id: 'c7',
    callId: 'k7',
    state: 'running',
    label: 'Looking for the type scale',
    detail: 'four sizes so far',
  },
];

/** Three helpers at the three states a helper can be in. The one still working
 *  started a couple of minutes ago, because a rail whose clock reads zero is a
 *  rail nobody can judge. */
const STARTED = Date.now() - 138_000;

const HELPING: readonly Helper[] = [
  {
    id: 'h1',
    task: 'Find every page that loads a font from somewhere other than our own server',
    saying: 'Two pages do.\nThe blog loads Inter from Google.\nThe changelog loads it too.',
    state: 'done',
    startedAt: STARTED,
  },
  {
    id: 'h2',
    task: 'Check the contrast on every button against the background it sits on',
    saying: 'Three fail at the smallest size.',
    state: 'running',
    startedAt: STARTED,
  },
  {
    id: 'h3',
    task: 'Work out which spacing values are used once and only once',
    saying: null,
    state: 'failed',
    startedAt: STARTED,
  },
];

/** Four conversations across three codebases, at the four states a tab can be
 *  in. Two of them share a project, which is the case the underline exists for. */
const OPEN: readonly Tab[] = [
  { id: 't1', title: 'the hero, tighter', project: 'paper-street', projectPath: '/a', state: 'idle' },
  { id: 't2', title: 'pricing page at phone width', project: 'paper-street', projectPath: '/a', state: 'working' },
  { id: 't3', title: 'the sign-in flow', project: 'atlas-studio', projectPath: '/b', state: 'asking' },
  { id: 't4', title: 'docs site', project: 'field-notes', projectPath: '/c', state: 'finished' },
];

/** A walkthrough of the states nobody screenshots, including one that could not
 *  be photographed — a run that quietly read as complete would be the one thing
 *  this feature must never do. */
const WALKED: Recording = {
  id: 'r1',
  says: 'Buying something on a phone',
  startedAt: 0,
  frames: [
    { id: 'f1', says: 'At the start', after: 0, shot: PAGE_SHOT, missing: null },
    { id: 'f2', says: 'After pressing Add to basket', after: 1400, shot: PAGE_SHOT, missing: null },
    { id: 'f3', says: 'After the page changed on its own', after: 2100, shot: PAGE_SHOT, missing: null },
    { id: 'f4', says: 'After typing in Card number', after: 6800, shot: null, missing: 'The window was hidden.' },
    { id: 'f5', says: 'After pressing Pay', after: 9200, shot: PAGE_SHOT, missing: null },
  ],
  note: null,
};

const ATTACHED: readonly Attachment[] = [
  { id: 'a1', kind: 'figma', name: 'Landing v4', note: 'Figma file', url: 'https://figma.com' },
  { id: 'a2', kind: 'image', name: 'hero-sketch.png', note: 'PNG · 1.2 MB', preview: SCREENSHOT },
  { id: 'a3', kind: 'document', name: 'Brand guidelines.pdf', note: 'PDF · 4.8 MB' },
];

/* -------------------------------------------------------------------------- */
/* Projects and versions                                                       */
/* -------------------------------------------------------------------------- */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const NOW = Date.now();

/** Three remembered projects, one of which has been moved or thrown away since
 *  it was last opened — the state the picker has to draw and that nobody would
 *  ever come across by accident. */
const REMEMBERED: readonly RecentProject[] = [
  {
    path: '/Users/you/Sites/paper-street',
    name: 'paper-street',
    lastOpenedAt: NOW - 12 * MINUTE,
    lastSpend: money(62, 'USD'),
    missing: false,
  },
  {
    path: '/Users/you/Sites/atlas-studio',
    name: 'atlas-studio',
    lastOpenedAt: NOW - 26 * HOUR,
    lastSpend: money(214, 'USD'),
    missing: false,
  },
  {
    path: '/Users/you/Sites/field-notes',
    name: 'field-notes',
    lastOpenedAt: NOW - 5 * 24 * HOUR,
    lastSpend: null,
    missing: true,
  },
];

/** A stylesheet with enough in it that every band of the design view has
 *  something real to say: values to move, movement to watch, and two near-misses
 *  written by hand. */
const STYLESHEET = `:root {
  --accent: #b8492c;
  --text: #1a1a19;
  --text-muted: #a3a3a0;
  --bg: #fbfbfa;
  --space-3: 12px;
  --space-4: 16px;
  --radius-md: 10px;
  --dur-ui: 200ms;
}

.card {
  padding: 15px;
  border-radius: var(--radius-md);
  transition: transform 200ms cubic-bezier(0.165, 0.84, 0.44, 1);
}

.card:hover {
  transform: translateY(-2px);
}

.badge {
  background: #b8492d;
  transition: opacity 140ms ease;
}
`;

const STYLES = {
  file: 'src/styles/tokens.css',
  text: STYLESHEET,
  tokens: [
    { name: '--accent', value: '#b8492c', kind: 'colour' as const, line: 2, steps: [] },
    { name: '--text', value: '#1a1a19', kind: 'colour' as const, line: 3, steps: [] },
    { name: '--text-muted', value: '#a3a3a0', kind: 'colour' as const, line: 4, steps: [] },
    { name: '--bg', value: '#fbfbfa', kind: 'colour' as const, line: 5, steps: [] },
    {
      name: '--space-3',
      value: '12px',
      kind: 'space' as const,
      line: 6,
      steps: ['8px', '12px', '16px', '24px'],
    },
    {
      name: '--space-4',
      value: '16px',
      kind: 'space' as const,
      line: 7,
      steps: ['8px', '12px', '16px', '24px'],
    },
    {
      name: '--radius-md',
      value: '10px',
      kind: 'radius' as const,
      line: 8,
      steps: ['6px', '10px', '14px'],
    },
  ],
};

const TIMELINE: readonly SavedVersion[] = [
  {
    id: 'v5',
    shortId: '9c1f4ad',
    at: NOW - 2 * MINUTE,
    title: 'Went back to “before I broke the nav”',
    by: 'you',
    named: false,
    current: true,
    parents: ['v4'],
    refs: ['main'],
    wentBackTo: 'v3',
  },
  {
    id: 'v4',
    shortId: '2b70e19',
    at: NOW - 9 * MINUTE,
    title: 'Hero rebuilt from your Figma frame',
    by: 'graphe',
    named: false,
    current: false,
    parents: ['v3', 'v2b'],
    refs: [],
    wentBackTo: null,
  },
  {
    id: 'v2b',
    shortId: 'e04d773',
    at: NOW - 40 * MINUTE,
    title: 'Tried a wider grid',
    by: 'graphe',
    named: false,
    current: false,
    parents: ['v2'],
    refs: ['wider-grid'],
    wentBackTo: null,
  },
  {
    id: 'v3',
    shortId: '55aa018',
    at: NOW - 55 * MINUTE,
    title: 'before I broke the nav',
    by: 'you',
    named: true,
    current: false,
    parents: ['v2'],
    refs: [],
    wentBackTo: null,
  },
  {
    id: 'v2',
    shortId: '7f3c2d1',
    at: NOW - 3 * HOUR,
    title: 'Cards moved onto the grid',
    by: 'graphe',
    named: false,
    current: false,
    parents: [],
    refs: [],
    wentBackTo: null,
  },
];

/** The timeline nobody would choose: a title somebody typed at length, a title
 *  we wrote that ran long, and one that is three characters. Real rows, so the
 *  rail can be judged at its worst rather than at its tidiest. */
const AWKWARD: readonly SavedVersion[] = [
  {
    id: 'a1',
    shortId: 'd11e900',
    at: NOW - 4 * MINUTE,
    title:
      'Went back to “before I broke the nav on the pricing page and then broke it again on mobile”',
    by: 'you',
    named: true,
    current: true,
    parents: ['a2'],
    refs: ['main'],
    wentBackTo: 'a3',
  },
  {
    id: 'a2',
    shortId: '6ba0c47',
    at: NOW - 3 * HOUR,
    title: 'Rebuilt the whole marketing site from the Figma library, including every component',
    by: 'graphe',
    named: false,
    current: false,
    parents: ['a3'],
    refs: [],
    wentBackTo: null,
  },
  {
    id: 'a3',
    shortId: '0f82b5e',
    at: NOW - 26 * HOUR,
    title: 'wip',
    by: 'you',
    named: true,
    current: false,
    parents: [],
    refs: [],
    wentBackTo: null,
  },
];

const JUST_PUT_BACK: PutBack = {
  title: 'before I broke the nav',
  at: NOW - 55 * MINUTE,
  undoTo: 'v4',
  versions: TIMELINE,
};

/* -------------------------------------------------------------------------- */
/* The overview                                                                */
/* -------------------------------------------------------------------------- */

/** A clean git state, a branch ahead of its remote, and a dirty one — the two
 *  sentences the panel gets to say, in the same words src/App.tsx would give
 *  them. */
const GIT_DIRTY = {
  branch: 'paper-street',
  branches: [
    { name: 'paper-street', current: true, upstream: 'origin/paper-street', ahead: 2, behind: 0, message: 'Ship the new pricing' },
    { name: 'main', current: false, upstream: 'origin/main', ahead: 0, behind: 1, message: 'Tidy the footer' },
  ],
  dirty: true,
  unstaged: 2,
  staged: 1,
  untracked: 1,
  ahead: 0,
  behind: 0,
  files: [
    { path: 'src/components/Hero.tsx', kind: 'changed' },
    { path: 'src/styles/tokens.css', kind: 'changed' },
    { path: 'src/pages/pricing.tsx', kind: 'changed' },
    { path: 'public/hero-bg.svg', kind: 'new' },
  ],
} as const;

/** A header as it was built from, and the same header after somebody spent a
 *  Tuesday on it. The findings under it are not written here: they are what the
 *  comparison makes of these two. */
const BUILT_FROM: Design = {
  frames: [{ id: '1:23', name: 'Header', width: 1440, height: 96 }],
  values: {
    colors: { 'color-brand-primary': '#b8492c', 'color-ink': '#1a1a19' },
    spacing: { 'space-gutter': '24px' },
    text: { 'font-family-heading': 'Söhne' },
  },
};

const IN_FIGMA_NOW: Design = {
  frames: [{ id: '1:23', name: 'Header', width: 1440, height: 128 }],
  values: {
    colors: { 'color-brand-primary': '#8f3620', 'color-ink': '#1a1a19' },
    spacing: { 'space-gutter': '32px' },
    text: { 'font-family-heading': 'Söhne' },
  },
};

const MOVED = findMoved(BUILT_FROM, IN_FIGMA_NOW, { name: 'Header' });

const IN_STEP = {
  following: {
    id: '8Kx2ABcd',
    name: 'Header',
    url: 'https://www.figma.com/design/8Kx2ABcd/Landing-v4?node-id=1-23',
    readAt: NOW - 4 * 60_000,
  },
  moved: MOVED,
  says: saysInStep('Header', MOVED),
  trouble: null,
};

/** A piece of work finished and waiting to be looked at, with both of the
 *  things that can send anywhere reachable. The state worth drawing, because it
 *  is the one where every press in the band means something. */
/** What comes back from pointing at a button on a real React 19 dev server:
 *  the component and the line, its tokens, one value a hair off one of them,
 *  and an honest note about what could not be worked out. */
const POINTED: Reading = {
  title: 'A button — “Start a project”',
  made: {
    how: 'stack',
    sure: 'likely',
    component: 'Welcome',
    where: { file: 'src/components/Welcome.tsx', line: 84, column: 11 },
    alsoIn: ['src/components/Landing.tsx', 'src/gallery/Gallery.tsx'],
    screens: ['/', '/pricing'],
    find: 'Welcome',
    says: 'Made by Welcome, at src/components/Welcome.tsx:84.',
  },
  using: [
    { what: 'the background', name: '--accent', value: '#b8492c', says: 'The background is your --accent.' },
    { what: 'the corners', name: '--radius-sm', value: '6px', says: 'The corners are your --radius-sm.' },
  ],
  adrift: [
    {
      what: 'the space inside',
      wrote: '13px',
      mine: { name: '--space-3', value: '12px' },
      confidence: 'likely',
      says: 'The space inside is 13px, a hair off your --space-3.',
      detail: '13px vs 12px',
    },
  ],
  changed: {
    name: 'Made the first screen ask one question',
    when: NOW - 3 * 3_600_000,
    says: 'Last changed 3 hours ago, in “Made the first screen ask one question”.',
  },
  widths: {
    all: [
      { id: 'phone', name: 'Phone', width: 390, height: 844, here: false },
      { id: 'tablet', name: 'Tablet', width: 834, height: 1112, here: true },
      { id: 'desktop', name: 'Desktop', width: 1440, height: 900, here: false },
    ],
    says: 'Shown at Tablet.',
  },
  unsure: ['I could not tell which of your text sizes this is using.'],
};

/** Work waiting in a copy, photographed before it is let in — including one
 *  width that would not build, because that is half of these. */
const HELD: Held = {
  id: 'held-1',
  doing: 'Make the pricing cards breathe a bit more',
  at: NOW - 90_000,
  sights: [
    { id: 'phone', name: 'Phone', width: 390, now: PAGE_SHOT, changed: PAGE_SHOT, missing: null, trouble: null },
    { id: 'desktop', name: 'Desktop', width: 1440, now: PAGE_SHOT, changed: PAGE_SHOT, missing: null, trouble: null },
    {
      id: 'wide',
      name: 'Wide',
      width: 1920,
      now: null,
      changed: null,
      missing: 'The project would not build at this width.',
      trouble: null,
    },
  ],
  note: null,
};

const LANDING: LandingState = {
  waiting: {
    id: 'held-1',
    doing: 'make the pricing cards breathe a bit more',
    state: 'waiting',
    at: NOW - 90_000,
  },
  held: HELD,
  holdBack: true,
  canHandOver: true,
  handOverSays: 'Everything needed is here.',
  canPutOnline: true,
  onlineSays: 'Everything needed is here.',
};

/**
 * Work that carried on without anybody, in the three states that look nothing
 * alike: one stopped on a question it will not answer for itself, one finished
 * with a picture of what it made, and one still going.
 *
 * The first is the one worth drawing. It is the only thing on the panel that
 * cannot move without a person, and it is the whole safety story of leaving the
 * window shut: a run with nobody watching stops rather than deciding.
 */
const AWAY: AwayState = {
  pieces: [
    {
      id: 'away-1',
      doing: 'Add the pricing table to the home page',
      state: 'needs-you',
      at: NOW - 4 * 60_000,
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
      at: NOW - 22 * 60_000,
      picture: PAGE_SHOT,
      says: 'It builds, and nothing looks different from yesterday.',
      trouble: null,
      spent: inr(2400),
      question: null,
    },
    {
      id: 'away-3',
      doing: 'Match the case study page to the new spacing',
      state: 'running',
      at: NOW - 60_000,
      picture: null,
      says: null,
      trouble: null,
      spent: inr(700),
      after: {
        id: 'away-2',
        doing: 'Check the site still builds',
        says: 'After “Check the site still builds”',
      },
      question: null,
    },
  ],
  repeats: [
    {
      id: 'every-1',
      doing: 'Check the site still builds and tell me if it doesn’t',
      says: 'Every day at 7:00am',
      next: 'Tomorrow at 7:00am',
      on: true,
      lastSaid: 'It builds.',
    },
  ],
  atOnce: 4,
  spent: { minor: 37, currency: 'USD' },
  sinceYouWere: 'One thing waiting on you, one thing ready to look at, one thing still going.',
};

/** A second folder with work of its own, so the board can be seen doing the
 *  thing it exists for: one place for everything, wherever it is running. */
const AWAY_ELSEWHERE: readonly { where: string; project: string; away: AwayState }[] = [
  {
    where: '/work/almanac',
    project: 'almanac',
    away: {
      pieces: [
        {
          id: 'away-b1',
          doing: 'Rebuild the archive page from the new grid',
          state: 'running',
          at: NOW - 9 * 60_000,
          picture: null,
          says: null,
          trouble: null,
          spent: inr(1100),
          question: null,
        },
        {
          id: 'away-b2',
          doing: 'Replace the placeholder photographs',
          state: 'needs-you',
          at: NOW - 30 * 60_000,
          picture: null,
          says: 'I need one more thing before I can carry on.',
          trouble: null,
          question: {
            callId: 'call-9',
            question: 'Use the photographs in “shoot-april” for the archive?',
            detail: 'They are the only ones in the folder at the right size.',
            consequence: 'Nothing else changes.',
          },
        },
      ],
      repeats: [],
      atOnce: 4,
      spent: { minor: 11, currency: 'USD' },
      sinceYouWere: null,
    },
  },
];

const RESEARCH: readonly ResearchEntry[] = [
  { id: 'r1', query: 'css clamp() fluid type best practices', state: 'done' },
  { id: 'r2', query: 'framer motion vs css animations 2026', state: 'done' },
  {
    id: 'r3',
    query: 'how wide should a landing page container be at 1440px',
    state: 'running',
  },
];

const REFERENCES: readonly Reference[] = [
  {
    id: 'ref1',
    kind: 'image',
    name: 'hero-sketch.png',
    note: 'Sent with “build the hero from this”',
    preview: SCREENSHOT,
  },
  {
    id: 'ref2',
    kind: 'figma',
    name: 'Landing v4',
    note: 'Sent with “match the spacing scale”',
  },
];

const SPENT: SpendView = {
  total: inr(4000),
  split: null,
  usage: {
    reusedShare: 0.72,
    mostUsed: 'claude-sonnet-4',
    byModel: [{ name: 'claude-sonnet-4', share: 1 }],
  },
};

/* -------------------------------------------------------------------------- */
/* The connect screen                                                          */
/* -------------------------------------------------------------------------- */

/** The provider list, built with the same shapes src/agent/pi sends: two
 *  connected or connectable accounts with their real method labels, and a
 *  Google that has no account yet and no way to get one from here. */
const CONNECT_STATE: ConnectionState = {
  chosen: null,
  chosenThinking: 'off',
  providers: [
    {
      providerId: 'anthropic',
      name: 'Anthropic',
      methods: ['oauth', 'api-key'],
      oauthLabel: 'Sign in with Claude Pro or Max',
      apiKeyLabel: 'Anthropic API key',
      connected: true,
      available: true,
      subscription: false,
      models: [
        { id: 'claude-sonnet-4-5', label: 'Sonnet 4.5', available: true, rates: { input: 3, output: 15 }, contextWindow: 1000000, thinking: ['off', 'minimal', 'low', 'medium', 'high'] },
        { id: 'claude-opus-4-5', label: 'Opus 4.5', available: false, rates: { input: 5, output: 25 }, contextWindow: 200000, thinking: ['off', 'minimal', 'low', 'medium', 'high'] },
      ],
    },
    {
      providerId: 'openai',
      name: 'OpenAI',
      methods: ['oauth', 'api-key'],
      oauthLabel: 'Sign in with ChatGPT',
      apiKeyLabel: 'OpenAI API key',
      connected: false,
      available: false,
      subscription: false,
      models: [
        { id: 'gpt-5', label: 'GPT-5', available: true, rates: { input: 1.25, output: 10 }, contextWindow: 400000 },
        { id: 'gpt-5-mini', label: 'GPT-5 mini', available: true, rates: { input: 0.25, output: 2 }, contextWindow: 400000 },
      ],
    },
    {
      providerId: 'opencode-go',
      name: 'OpenCode Go',
      methods: ['api-key'],
      oauthLabel: null,
      apiKeyLabel: 'OpenCode Go API key',
      connected: false,
      available: false,
      subscription: false,
      models: [{ id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash', available: true, rates: { input: 0.14, output: 0.28 }, contextWindow: 1000000 }],
    },
    {
      providerId: 'google',
      name: 'Google',
      methods: ['oauth', 'api-key'],
      oauthLabel: 'Sign in with Google AI',
      apiKeyLabel: 'Gemini API key',
      connected: false,
      available: false,
      subscription: false,
      models: [
        { id: 'gemini-3', label: 'Gemini 3', available: true, rates: { input: 2, output: 12 }, contextWindow: 1048576 },
        { id: 'gemini-3-flash', label: 'Gemini 3 Flash', available: true, rates: { input: 0.5, output: 3 }, contextWindow: 1048576 },
      ],
    },
  ],
};

/** What opencode and Codex have saved on this machine — the two rows that
 *  appear above the list, with the same words the app writes about them. */
const FOUND_ACCOUNTS: readonly FoundAccount[] = [
  { providerId: 'opencode-go', name: 'OpenCode Go', kind: 'api-key', source: 'opencode' },
  { providerId: 'openai', name: 'OpenAI', kind: 'sign-in', source: 'codex' },
];

/** Enough of the shelf for the band above it to have something to sit on: one
 *  of ours, already added, and one of somebody else's. */
const PACKS: readonly Pack[] = [
  {
    id: '@graphe/figma',
    name: 'Figma',
    kind: 'extension',
    summary: 'Build from a frame you link, keeping to the spacing scale you already use.',
    downloads: 24_000,
    version: '1.4.0',
    installed: true,
    curated: true,
  },
  {
    id: 'pi-page-weight',
    name: 'pi-page-weight',
    kind: 'skill',
    summary: 'Reads a page for the things that make it slow to open, before it goes out.',
    downloads: 1_840,
    version: '0.6.2',
    installed: false,
    curated: false,
  },
];

const VOUCHED_FOR: Readonly<Record<string, string>> = {
  '@graphe/figma': 'Lets it build from a Figma frame you paste in.',
};

/** Two that came down with a clone rather than being chosen: one answered yes
 *  already, one never answered, and a path long enough to prove the row breaks
 *  rather than pushing the panel wider. */
const CARRIED: readonly CarriedExtension[] = [
  {
    id: 'brand-check-4f21c9',
    name: 'Brand check',
    where: '.pi/extensions/brand-check.js',
    trusted: true,
  },
  {
    id: 'preview-deploy-9ab30e',
    name: 'Preview deploy',
    where: '.pi/extensions/vendor/@acme-design-systems/preview-deploy/dist/node/index.mjs',
    trusted: false,
  },
];

/** A project with folders inside folders and three files moved in the version
 *  being looked at, so the tree has both of the things it draws. */
const PROJECT_FILES: readonly FileEntry[] = [
  { path: 'README.md', size: 2_310 },
  { path: 'package.json', size: 1_842 },
  { path: 'package-lock.json', size: 214_006 },
  { path: '.gitignore', size: 128 },
  { path: 'public/hero-bg.svg', size: 4_820, changed: true },
  { path: 'public/favicon.ico', size: 15_086 },
  { path: 'src/app/page.tsx', size: 3_140 },
  { path: 'src/app/pricing/page.tsx', size: 2_640 },
  { path: 'src/components/Hero.tsx', size: 1_664, changed: true },
  { path: 'src/components/Nav.tsx', size: 1_120 },
  { path: 'src/components/Footer.tsx', size: 890 },
  { path: 'src/styles/tokens.css', size: 3_408, changed: true },
  { path: 'src/styles/palette.css', size: 1_206 },
];

const FILE_TEXT: Readonly<Record<string, string>> = {
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
};

function Section({ title, note, children }: { title: string; note: string; children: ReactNode }) {
  return (
    <section className="gsection">
      <div className="gsection__head">
        <h2 className="gsection__title">{title}</h2>
        <p className="gsection__note">{note}</p>
      </div>
      <div className="gsection__body">{children}</div>
    </section>
  );
}

function noop() {}

export default function Gallery() {
  const [theme, setTheme] = useState<Theme>('system');
  const [attached, setAttached] = useState<readonly Attachment[]>(ATTACHED);
  /** Live, so the switch can be turned on here and the sections below it change
   *  — which is the only way to review "quiet and secondary" as a claim. */
  const [showMe, setShowMe] = useState(false);
  /** Live too: the row in the menu and the panel it opens are one gesture, and
   *  the only way to review that is to press it. */
  const [showFiles, setShowFiles] = useState(true);
  const [openFile, setOpenFile] = useState<string | null>('src/components/Hero.tsx');
  /** Live for the same reason: the connect screen is a moment, not a picture,
   *  and the closest thing to the moment is opening and closing it. */
  const [connectOpen, setConnectOpen] = useState(false);
  /** Live, and the switches move: the band is a decision somebody makes one row
   *  at a time, and a picture of it cannot be reviewed as one. */
  const [addMoreOpen, setAddMoreOpen] = useState(false);
  const [carried, setCarried] = useState(CARRIED);
  /** What the first screen put in the box, so the two can be reviewed as the one
   *  gesture they are rather than as two components that happen to be near each
   *  other. */
  const [draft, setDraft] = useState('');
  const [howFar, setHowFar] = useState<HowFar>('asking');

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
  }, [theme]);

  return (
    <main className="gallery">
      <header className="gallery__head">
        <div>
          <h1 className="gallery__title">Graphe interface kit</h1>
          <p className="gallery__sub">
            Every presentational piece of the conversation, with real copy. Motion follows
            notes/strategy/UI-DESIGN.md — most of what is on this page deliberately does not move.
          </p>
        </div>
        <div className="gallery__themes" role="group" aria-label="Theme">
          {(['system', 'light', 'dark'] as const).map((option) => (
            <button
              key={option}
              type="button"
              className={`gallery__theme ${theme === option ? 'is-on' : ''}`}
              aria-pressed={theme === option}
              onClick={() => setTheme(option)}
            >
              {option[0]!.toUpperCase() + option.slice(1)}
            </button>
          ))}
        </div>
      </header>

      <div className="gallery__grid">
        <div className="gallery__col">
          <Section
            title="The first screen"
            note="One sentence, three real ones somebody could send, and the other way in — which sits on the list's own left margin wearing the composer's paperclip, because somebody holding a Figma file was never going to read fine print centred under a list. No cards, no illustration, no tour, and nothing on it moves: this is the screen every launch begins on."
          >
            <div className="welcome-sample">
              <Welcome onUse={setDraft} />
            </div>
            <p className="gallery__caption">
              Press one and it lands in the composer on the right, ready to be edited. It is never
              sent for you: an example is a starting point, and a click that spends money on a
              sentence you did not write is the exact surprise this product exists not to have.
            </p>
          </Section>

          <Section
            title="Conversation"
            note="Never animates — it is the thing people see a hundred times a day. Streaming text simply appears, with no fade and no typewriter."
          >
            <div className="thread-sample">
              <Message from="you">
                Build the hero from this file, keeping our spacing scale:
                figma.com/file/8Kx2/Landing-v4
              </Message>
              <Message from="graphe" aside="This one’s fiddly, so I took the Careful route.">
                It’s built. One thing worth knowing: the frame puts 68px above the headline, which
                isn’t on your spacing scale, so I used 72px — the nearest step you already use
                everywhere else. It reads identically and it won’t drift next time.
              </Message>
              <Message from="you">Good. What about the three cards under it?</Message>
              <Message from="graphe" streaming>
                They’re the only part that doesn’t fit your 12-column grid at 1024px. I can widen
                the container to 1200px, or drop the card
              </Message>
            </div>
          </Section>

          <Section
            title="Formatting"
            note="Graphe's turns are read as Markdown; yours are left exactly as typed, so asterisks around a measurement stay asterisks. Code is plain first and gains its colour a moment later — the highlighter is a large thing to load and no reply waits for it."
          >
            <div className="thread-sample">
              <Message from="you">
                Make the space above the headline *roughly* 40px — I’ll fine-tune it after.
              </Message>
              <Message from="graphe">{FORMATTED}</Message>
              <Message from="graphe" streaming>
                {HALF_WRITTEN}
              </Message>
            </div>
            <p className="gallery__caption">
              The last one is mid-sentence, with a fence opened and not yet closed. That is the state
              a reply is in for most of its life, so it is the state worth looking at: the block
              simply grows a line at a time, and nothing flickers as it does.
            </p>
          </Section>

          <Section
            title="What it is doing, while it does it"
            note="Read-only, never an input. A spinner never appears without a sentence beside it, and the state is a shape as well as a colour. Consecutive steps are joined by a hairline, so a glance answers “how far in is it” without anything claiming a percentage it does not know."
          >
            <div className="activity-feed">
              <ActivityLine
                state="done"
                label="Read your Figma file"
                detail="12 frames, 3 with variants"
                meta="6s"
                real={showMe ? realWords({ id: '1', name: 'read', input: FIGMA_FILE }) : undefined}
              />
              <ActivityLine state="done" label="Got your project ready" meta="3s" />
              <ActivityLine
                state="done"
                label="Matched the type scale to the sizes you already use"
                detail="4 sizes"
                meta="11s"
                real={showMe ? realWords({ id: '2', name: 'edit', input: TOKENS_FILE }) : undefined}
              />
              <ActivityLine
                state="failed"
                label="Ran your build"
                detail="stopped on one file"
                real={showMe ? realWords({ id: '3', name: 'bash', input: BUILD }) : undefined}
              />
              <ActivityLine
                state="running"
                label="Checking it against your design system"
                detail="Comparing the built page with the frame you linked"
              />
            </div>
            <p className="gallery__caption">
              The step happening now is the one the eye lands on, and it gets there by weight rather
              than by anything moving: the line is darker and slightly heavier, and the only thing
              in the feed that turns is the ring beside it. There is no bar filling up, because
              nothing here knows how many steps are left — and a progress bar that is guessing is
              worse than no progress bar.
            </p>
          </Section>

          <Section
            title="A long chain, folded"
            note="A turn that reads eleven files is eleven lines, and by the time the answer arrives the sentence somebody wanted is off the top of the screen. Consecutive steps gather into one row carrying the newest of them, with the rest a click away. Nothing is summarised and nothing is dropped."
          >
            <div className="thread-sample">
              <Steps steps={CHAIN} showMe={showMe} />
            </div>
            <p className="gallery__caption">
              The row carries the <em>last</em> step rather than a description of all of them, which
              is what keeps “never a spinner without a sentence” true while the chain is still
              running: the newest thing is the thing being done now.
            </p>
          </Section>

          <Section
            title="Point at anything and be told what it is"
            note="A click already knew the selector, the label, the markup and the computed styles — and threw all of it away into one sentence. This is the designer's version of DevTools: which component made it, which of your tokens it is using, which values are a hair off one of them, when it last changed, and what it looks like at the other sizes."
          >
            <div className="gallery__rail">
              <Inspector reading={POINTED} onAsk={noop} onWidth={noop} />
            </div>
            <p className="gallery__caption">
              The chain degrades rather than failing: on a React 19 dev server it names the component
              and the line; on a production build it falls back through the selector, the markup and
              the visible text until it has something the agent can go and find. What it could not
              work out is written down rather than left out.
            </p>
          </Section>

          <Section
            title="See it before you say yes"
            note="We already show a before-and-after after a change lands, and the timeline can take you back — but both of those are recovery. The designer's version of reading a diff is seeing the rendered result before approving it. The work happens in a copy, the copy gets photographed, and the decision arrives with the picture attached."
          >
            <div className="thread-sample">
              <SeeFirst waiting={LANDING.waiting} held={HELD} onDecide={noop} />
            </div>
            <p className="gallery__caption">
              This turns the safest mode in the app from something you switch on out of caution into
              the one you want, because it is the only one that shows you what you are agreeing to.
              A width that would not build says so and is still decidable — never a blank frame.
            </p>
          </Section>

          <Section
            title="Evidence, not a diff"
            note="Everything the app photographs otherwise is a page at rest. Real interface work lives in the states nobody screenshots — hover, focus, loading, empty, error, the third step of a form, the toast that lasts two seconds. Click through your own app with this watching and every state is captured with the thing that produced it."
          >
            <div className="thread-sample">
              <EvidenceReel recording={WALKED} openAtFirst width={260} height={180} />
            </div>
            <p className="gallery__caption">
              With one agent you read the diff. With five you cannot, and this is the only review
              artifact that scales with the number of them: recordings can be watched side by side,
              diffs cannot. A state that could not be photographed keeps its place in the run and
              says why, so a recording never quietly reads as complete.
            </p>
          </Section>

          <Section
            title="What you have open"
            note="A tab is a conversation, not a project — that is the unit of work people switch between, and it is the only shape in which “two agents in one codebase” can be said at all. Two lines each: the conversation, and under it the project in quieter type. The 2px underline groups by codebase without nesting anything."
          >
            <Tabs tabs={OPEN} at="t2" onOpen={noop} onClose={noop} onNew={noop} />
            <p className="gallery__caption">
              The state mark is the point. Switching away from something still working and having
              the tab tell you when it needs you is the whole reason tabs exist here — and the
              question mark is the loudest thing in the strip, because it is the only state that
              cannot move on without a person.
            </p>
          </Section>

          <Section
            title="Who else is working"
            note="Helpers used to live in a band in the right-hand panel. That panel is a reading of what has already happened; a helper is now, and it is the only thing in the app still working while you read something else. So it sits above the composer, where the eye already is. A chip opens the whole of what one was asked and everything it said."
          >
            <div className="thread-sample">
              <HelperRail helpers={HELPING} onOpen={noop} />
            </div>
            <p className="gallery__caption">
              The state is a shape, not a colour: a ring that turns while it works, a tick when it
              is finished, a bar when it stopped. A helper that has come back recedes — the record
              is worth keeping on screen, and it is not worth as much as the one still going.
            </p>
          </Section>

          <Section
            title="Waiting in line"
            note="A second thought typed while something is still running. It joins a line instead of being swallowed by a box that will not take it, and goes out on its own the moment the one before it is finished."
          >
            <div className="thread-sample">
              <InLine
                waiting={[
                  { id: 'w1', text: 'and make the footer links the same size' },
                  { id: 'w2', text: 'then show me the pricing page at phone width' },
                ]}
                onTake={noop}
              />
            </div>
            <p className="gallery__caption">
              Directly above the composer, because that is where the words were typed. Each can be
              taken back out — the words return to the box, so a second thought can be changed
              rather than only cancelled.
            </p>
          </Section>

          <Section
            title="When there is barely anything to say"
            note="The other end of “when everything is too long”, and the one that catches interfaces out more often: one word, one step, one version. Nothing here is padded out to look substantial."
          >
            <div className="thread-sample">
              <Message from="you">Undo that</Message>
              <Message from="graphe">Done.</Message>
            </div>
            <div className="activity-feed">
              <ActivityLine state="done" label="Put it back" meta="1s" />
            </div>
            {/* Two is the whole rail on the day it first appears — it arrives
                with the second version, so this is the state every project
                passes through and nobody screenshots. */}
            <div className="gallery__rail">
              <Versions
                versions={TIMELINE.slice(0, 2)}
                putBack={null}
                onPutBack={noop}
                onName={noop}
                onDismissPutBack={noop}
              />
            </div>
            <p className="gallery__caption">
              A one-word reply keeps the same label above it and the same left edge as a reply forty
              lines long, so a conversation of mixed lengths still reads as one column. A single
              step draws no spine, because a line joining one thing to nothing is a line about
              nothing. And the rail with two rows in it is a timeline rather than a stub: the line
              runs between the two nodes and stops at both, instead of trailing off past the last
              one.
            </p>
          </Section>

          <Section
            title="Show me"
            note="Off by default, sticky once set, and it lives under the project’s name — the same place you go to switch projects or open the folder. Turn it on here and the sections on this page change with it."
          >
            <div className="gallery__menu">
              <ProjectMenu
                projects={REMEMBERED}
                openPath="/Users/you/Sites/paper-street"
                onOpen={noop}
                onForget={noop}
                onBrowse={noop}
                editor="VS Code"
                onOpenInEditor={noop}
                onRevealFolder={noop}
                onPreview={noop}
                onAccount={noop}
                onAddMore={noop}
                showMe={showMe}
                onShowMe={setShowMe}
                showFiles={showFiles}
                onShowFiles={setShowFiles}
              />
            </div>
            <p className="gallery__caption">
              One menu, everything under the project's name: where you were, the way out, the
              preview, the account, and the switch. The escape hatches are never conditional and
              never further away than this — the project is an ordinary folder in ordinary git, and
              a product that makes that hard has quietly become a walled garden. What the button
              says is whatever editor the machine actually has; with none installed there is one
              row here, not a button that opens nothing.
            </p>
          </Section>

          <Section
            title="Everything in this project"
            note="The escape hatch that makes this credible to somebody technical without turning it into a tool for them. It is the one region nobody is given: it appears because it was asked for, in the same menu as the folder and the editor, and it stays until it is turned off again."
          >
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 264px) minmax(0, 1fr)',
                gap: 'var(--space-4)',
                alignItems: 'start',
              }}
            >
              <div style={{ display: 'grid', height: '320px' }}>
                <Files
                  files={PROJECT_FILES}
                  selected={openFile}
                  onSelect={setOpenFile}
                />
              </div>
              <div style={{ display: 'grid', maxHeight: '320px' }}>
                <FileView
                  path={openFile ?? 'src/components/Hero.tsx'}
                  text={FILE_TEXT[openFile ?? ''] ?? null}
                  trouble={
                    openFile !== null && FILE_TEXT[openFile] === undefined
                      ? 'This one is not text, so there is nothing to read here.'
                      : null
                  }
                  onClose={noop}
                />
              </div>
            </div>
            <p className="gallery__caption">
              It opens on what changed, with everything else folded away, because a version is the
              one thing a file tree cannot know about — and the chips that change that sit in the
              panel's own band rather than in a settings screen. “Every file” is the way back to the
              whole folder, machinery and all, for somebody who came to check our working. Nothing
              here can be edited: the way to change a file is to ask for the change, and a box that
              looked editable and was not would be a worse lie than no box at all.
            </p>
          </Section>

          <Section
            title="Who should I think with?"
            note="The one screen that appears before the work does, so it is the rare moment that gets the dark treatment. Every provider and every model on the table at once — nothing is gated behind a second click, because there is no smaller step worth hiding behind. It is live: open it, close it, look again."
          >
            <button
              type="button"
              className="gallery__live"
              onClick={() => setConnectOpen(true)}
            >
              Open the connect screen
            </button>
            <p className="gallery__caption">
              At the top, before the list, the accounts opencode and Codex have saved on this
              machine — “Already on this computer” — because pasting a key that is already on the
              disk is the first friction this screen exists to remove, and the sentence under the
              name says which tool saved it and what kind of account it is. One click brings it
              over; the credential is copied between the tool's own files by the shell and never
              crosses to this window, which only ever sees the name, the kind, and the source. The
              provider then flips to “working on this machine” below. Below that, the sign-in
              options lead through the provider's own site, and a model is a plain row you can
              pick whenever you like — “now working with this” is the same row, turned on.
            </p>
          </Section>

          <Section
            title="Adding more, and what the project brought with it"
            note="Two different things on one screen, in the order somebody meets them. The band at the top is about the folder in front of you: extensions that arrived with it, which nobody chose and which run as part of Graphe rather than being checked as they go. Searching for something to add is the general errand, so it waits below."
          >
            <button type="button" className="gallery__live" onClick={() => setAddMoreOpen(true)}>
              Open the add-more screen
            </button>
            <p className="gallery__caption">
              The switches are real — turn one on and off. Each row is the name, the file it loads
              set as a path, and one switch; the second path is long enough to break over two lines
              rather than push the panel wider. The line about starting a fresh conversation sits
              above the switches, once, because the cost of saying yes should be read before the
              hand gets to the control rather than repeated beside every one of them.
            </p>
          </Section>

          <Section
            title="A long conversation, tidied"
            note="One sentence, said once, in the place it happened. Behind it is the agent runtime’s own tidying — we do not summarise anything ourselves."
          >
            <div className="activity-feed">
              <ActivityLine
                state="running"
                label={longConversation.tidying}
                real={showMe ? behind.tidying : undefined}
              />
              <ActivityLine
                state="done"
                label={longConversation.tidying}
                real={showMe ? behind.tidying : undefined}
              />
            </div>
            <p className="gallery__caption">
              Running and finished. Nothing is lost either way, and the full conversation is still
              there to scroll back through — which is the fear that keeps people in bloated
              conversations in the first place, so it is the half of the sentence that matters.
            </p>
          </Section>

          <Section
            title="Cost"
            note="Small, glanceable, corner-mounted, and it never animates — a number that moves turns awareness into anxiety."
          >
            <div className="gallery__meters">
              <CostMeter spent={inr(4000)} onDetails={noop} onLimit={noop} />
              <CostMeter spent={inr(120_000)} limit={monthlyLimit} onDetails={noop} onLimit={noop} />
              <CostMeter spent={inr(163_000)} limit={monthlyLimit} onDetails={noop} />
              <CostMeter spent={inr(200_000)} limit={monthlyLimit} onDetails={noop} />
            </div>
            <p className="gallery__caption">
              No ceiling set · well inside it · getting close · reached. Every word comes from
              src/cost/phrasing.ts, which is the one file the language audit sweeps.
            </p>
          </Section>

          <Section
            title="What moves, and when"
            note="Motion is spent on the rare moments and withheld from the frequent ones. Everything below has a prefers-reduced-motion counterpart; with motion reduced, this page is identical at rest."
          >
            <dl className="motion-table">
              {[
                ['A turn of conversation, streaming or not', 'Nothing. Ever.'],
                ['The cost meter changing', 'Nothing. Ever.'],
                ['The first screen', 'Nothing. Ever.'],
                ['A spinner beside a sentence', 'Rotation · the only linear'],
                ['A confirmation arriving', 'Up 12px + fade · 200ms'],
                ['Something going wrong', 'Up 6px + fade · 280ms'],
                ['The project menu opening', 'Up 4px + 0.97 → 1 · 200ms'],
                ['An attachment arriving', 'Up 4px + fade · 200ms'],
                ['An attachment removed', '1 → 0.96 + fade · 160ms'],
                ['Jump to latest, going away', 'Fade + 4px · 160ms'],
                ['Hovering a version', 'Colour only · 120ms'],
                ['Pressing any button', 'scale(0.97) · 120ms'],
              ].map(([what, how]) => (
                <div className="motion-table__row" key={what}>
                  <dt className="motion-table__what">{what}</dt>
                  <dd className="motion-table__how">{how}</dd>
                </div>
              ))}
            </dl>
          </Section>
        </div>

        <div className="gallery__col">
          <Section
            title="The composer"
            note="Drag a file onto it, paste a screenshot, paste a Figma link, or press the paperclip. Being dropped on turns the box it is already in into the target — no dashed rectangle drawn inside a solid one, nothing that bounces."
          >
            <div className="composer-sample">
              <Composer
                anywhere={false}
                outLoud={false}
                onSend={noop}
                attachments={attached}
                onAttachmentsChange={setAttached}
                draft={draft}
                connection={CONNECT_STATE}
                onSelectModel={noop}
                onConnect={noop}
                room={{ used: 128_000, total: 200_000, part: 0.64 }}
                onTidy={noop}
                howFar={howFar}
                onHowFar={setHowFar}
              />
            </div>
            <p className="gallery__caption">
              The chip on the left of the row says which model is answering, and opens the whole
              list of models that account can actually use. It is the one piece of the machinery
              the composer shows on purpose: a model decides what a reply costs and how good it
              is, and it is the setting people change most often.
            </p>
            <p className="gallery__caption">
              A Figma link keeps its own chip and its own name, because it is a place rather than a
              copy. This composer is live — drop something on it. Nothing is sent anywhere: the
              chips stay put after a message goes, and the hint says so instead of letting anyone
              believe a picture went along with their sentence.
            </p>
          </Section>

          <Section
            title="Before something risky"
            note="Rises 12px with a fade over 200ms and then stays put, beside the work. Never a modal over the preview — a dimmed backdrop is the grammar of an error, and being asked a question is ordinary."
          >
            <ConfirmChange
              question="Replace the colour styles in your design system?"
              /* "the new values", not "the new tokens": the language sweep in
                 COST-DESIGN §C-01 looks for that word and does not stop to ask
                 whether this one meant the design-system kind. */
              detail="The eleven styles in Brand / Core would point at the new values instead of the old hexes."
              consequence="I’ll save a version first, so putting it back is one click."
              technical={showMe ? realWords({ id: '4', name: 'edit', input: TOKENS_FILE }) : undefined}
              cancelLabel="Leave them as they are"
              confirmLabel="Replace them"
              onCancel={noop}
              onConfirm={noop}
            />
            {/* Composed exactly as src/App.tsx composes it, so what is reviewed
                here is what ships: the question, the number and the minutes,
                and then how much of that number is a measurement. */}
            <ConfirmChange
              question={bigJob.title}
              detail={bigJob.body}
              consequence={bigJobNote ?? undefined}
              cancelLabel={bigJob.alternative}
              confirmLabel={bigJob.confirm}
              onCancel={noop}
              onConfirm={noop}
            />
            <p className="gallery__caption">
              The option that changes something is the quiet one. Safe comes first in the DOM, so it
              is also first for the keyboard.
            </p>
          </Section>

          <Section
            title="Version timeline"
            note="Hovering moves nothing. Scrubbing has to feel like Figma’s version history — immediate, weightless, consequence-free. Every row used to draw a grey rectangle standing in for a thumbnail nothing had rendered; five of those down a rail is a skeleton screen that never finished loading, so the row shows the honest thing instead — where this moment sits on the line."
          >
            <ul className="version-list">
              <VersionRow
                title="Hero rebuilt from Figma"
                time="2 minutes ago"
                current
                onOpen={noop}
              />
              <VersionRow
                title="Spacing matched to your scale"
                time="18 minutes ago"
                onOpen={noop}
                onRestore={noop}
              />
              <VersionRow
                title="Cards moved onto the grid"
                time="1 hour ago"
                onOpen={noop}
                onRestore={noop}
              />
              <VersionRow
                title="First pass at the landing page"
                time="Yesterday, 6:12pm"
                onOpen={noop}
                onRestore={noop}
              />
            </ul>
            <p className="gallery__caption">
              “Put back”, not “restore to commit”. Every action is reversible from a picture.
            </p>
          </Section>

          <Section
            title="The rail, as it is mounted"
            note="Appears the first time there is a second version and then stays — a fade, 200ms, once. Fixed to the right-hand edge in the app; shown here in the flow of the page so it can be read beside everything else."
          >
            <div className="gallery__rail">
              <Versions
                versions={TIMELINE}
                putBack={JUST_PUT_BACK}
                onPutBack={noop}
                onName={noop}
                onDismissPutBack={noop}
                showMe={showMe}
              />
            </div>
            <p className="gallery__caption">
              Going back is itself a version, so it can be undone like anything else. The strip says
              which moment you are looking at and offers to take it back — and it goes away when it
              stops being true. Clicking a row opens a field to name it.
            </p>
          </Section>

          <Section
            title="Coming back to a project"
            note="The first screen of every launch after the first one. A list and one link, and nothing that moves — a list of places is not an event."
          >
            <ProjectPicker
              projects={REMEMBERED}
              onOpen={noop}
              onForget={noop}
              onBrowse={noop}
              openPath="/Users/you/Sites/paper-street"
            />
            <p className="gallery__caption">
              A folder that has been moved or thrown away stays on the list, says so in words as
              well as in colour, and offers the only useful thing left to do with it. It is not an
              error card, because nothing has gone wrong with the app.
            </p>
          </Section>

          <Section
            title="The shelf"
            note="Appears the day a folder opens and then stays, against the left edge, under the top bar. It is the navigation — the list of places this machine remembers — so it is allowed to be a permanent region while the first screen stays one sentence. Collapsing it (the mark, or ⌘B) gives the conversation the whole window; there is no animation either way, because toggling a sidebar is a thing people do constantly."
          >
            <div className="shelf-sample">
              <Sidebar
                projects={REMEMBERED}
                openPath="/Users/you/Sites/paper-street"
                onOpen={noop}
                onBrowse={noop}
                pinned={REFERENCES}
                conversations={[]}
                openConversation={null}
                onOpenConversation={noop}
                onNewConversation={noop}
                open
                onToggle={noop}
              />
              <Sidebar
                projects={REMEMBERED}
                openPath="/Users/you/Sites/paper-street"
                onOpen={noop}
                onBrowse={noop}
                pinned={REFERENCES}
                conversations={[]}
                openConversation={null}
                onOpenConversation={noop}
                onNewConversation={noop}
                open={false}
                onToggle={noop}
              />
            </div>
            <p className="gallery__caption">
              Expanded and reduced. The strip keeps the mark at the top, so the way back is in the
              place the expanded shelf used it. Everything else about the project — the way out,
              the machinery switch — stays under the project's name in the top bar, where a person
              who wants the wheel already knows where to look.
            </p>
          </Section>

          <Section
            title="Back to the work"
            note="Floats over the right edge of the conversation from the moment there is an address to go to — it earns its place only when the work is actually being served. Disabled while the serving is still on its way, so it can never be asked twice."
          >
            <div className="gallery__pillframe">
              <button type="button" className="previewpill">
                Open preview
              </button>
              <button type="button" className="previewpill" disabled>
                Preparing…
              </button>
            </div>
            <p className="gallery__caption">
              Ready, and still getting there. It is the same row the menu offers under the
              project's name — one destination, two doors, both reachable with the keyboard. Near
              the words about the work, not the housekeeping of the top bar: the preview is the
              point, and the pill lives beside it.
            </p>
          </Section>

          <Section
            title="The overview"
            note="Folded against the right edge, the same place the version rail used to live — the rail is now its bottom half. It appears the first time there is anything to tell and then stays: a git state the shell has seen, a search, a reference, or a second version. Everything in it is a reading of things that happened elsewhere; nothing here is a new event to respond to."
          >
            <div className="gallery__overview">
              <Overview
                view={{
                  now: {
                    step: { label: 'Changing pricing.tsx', detail: 'the second card' },
                    helpers: [
                      {
                        id: 'h1',
                        task: 'check the contrast on every button',
                        saying: 'Reading Button.tsx',
                        state: 'running' as const,
                        startedAt: NOW - 40_000,
                      },
                    ],
                    filesRead: 14,
                  },
                  git: GIT_DIRTY,
                  research: RESEARCH,
                  references: REFERENCES,
                  versions: TIMELINE,
                  pictures: {},
                  kept: [],
                  putBack: JUST_PUT_BACK,
                  spent: SPENT,
                  onAPlan: false,
                  ceiling: monthlyLimit,
                  busy: true,
                  showMe: false,
                  artifacts: [
                    { path: 'public/hero-bg.svg', name: 'hero-bg.svg', kind: 'vector' as const, note: 'SVG · a drawing' },
                  ],
                  swatches: [
                    { name: 'brand', value: '#b8492c' },
                    { name: 'ink', value: '#1a1a19' },
                  ],
                  styles: {
                    file: 'src/styles/tokens.css',
                    tokens: [
                      { name: '--space-4', value: '16px', kind: 'space' as const, line: 42, steps: ['8px', '12px', '16px', '24px'] },
                      { name: '--accent', value: '#b8492c', kind: 'colour' as const, line: 95, steps: [] },
                      { name: '--text', value: '#1a1a19', kind: 'colour' as const, line: 96, steps: [] },
                      { name: '--text-muted', value: '#a3a3a0', kind: 'colour' as const, line: 97, steps: [] },
                      { name: '--bg', value: '#fbfbfa', kind: 'colour' as const, line: 98, steps: [] },
                    ],
                    text: ':root { --accent: #b8492c; }',
                  },
                  reading: readDesign(null),
                  inStep: IN_STEP,
                  landing: LANDING,
                  going: null,
                  landed: null,
                  decided: null,
                  away: AWAY,
                  elsewhere: AWAY_ELSEWHERE,
                  project: 'paper-street',
                  clock: NOW,
                }}
                onPutBack={noop}
                onName={noop}
                onKeep={noop}
                onDismissPutBack={noop}
                onShowSplit={noop}
            onLimit={noop}
            onSave={noop}
                onOpenDesign={noop}
                onSwitchBranch={() => {}}
onCreateBranch={() => {}}
          onOpenGraph={noop}
                onShare={noop}
                onDecide={noop}
                onHandOver={noop}
                onOpenLink={noop}
                onKeepGoing={noop}
                onStartAfter={noop}
                onKeepAway={noop}
                onDropAway={noop}
                onAnswerAway={noop}
                onAddRepeat={noop}
                onSwitchRepeat={noop}
                onForgetRepeat={noop}
              />
            </div>
            <p className="gallery__caption">
              Git says it in a designer's words — “2 files changed, 1 new” — and the branch in
              mono, because names are not translated. A search that worked leaves nothing but its
              question; only a failure says “stopped”. The meter docks into the foot, the way it
              docked into the foot of the rail.
            </p>
          </Section>

          <Section
            title="In step with Figma"
            note="Every other tool reads a Figma file once, on the way in, and never looks again — the design moves on a Tuesday and nobody finds out until somebody opens the site and winces. This band holds what was read and says, in design's own words, what differs now. Each row carries the one press that puts the work back in step."
          >
            <div className="gallery__overview">
              <InStep
                state={IN_STEP}
                detail
                onFollow={noop}
                onLookAgain={noop}
                onBuildIn={noop}
                onCaughtUp={noop}
                onStop={noop}
              />
            </div>
            <p className="gallery__caption">
              The two colours meet along one seam, the way the near-miss rows meet: a shade you
              cannot see is exactly when the sentence has to do the work. Nothing here is read on a
              timer — a tool that opens somebody's Figma file every ten minutes without being asked
              is a different product.
            </p>
          </Section>

          <Section
            title="Running now"
            note="Servers, watchers, anything started to stay up. It sits above the composer rather than in the conversation, because it outlives the sentence that started it — a server filed under that sentence is out of reach the moment the conversation moves on. Several at once is ordinary: a front end and two back ends. The dot pulses only while one is still coming up, which is the only moment the question is “waiting or stuck?”."
          >
            <Running
              pieces={[
                {
                  id: 'run-1',
                  label: 'npm run dev',
                  command: 'npm run dev',
                  folder: '/a',
                  address: 'http://localhost:5173',
                  state: 'running',
                  since: Date.now(),
                  exitCode: null,
                },
                {
                  id: 'run-2',
                  label: 'the API',
                  command: 'npm run api',
                  folder: '/a',
                  address: 'http://localhost:8787',
                  state: 'running',
                  since: Date.now(),
                  exitCode: null,
                },
                {
                  id: 'run-3',
                  label: 'the stylesheets',
                  command: 'npm run watch:css',
                  folder: '/a',
                  address: null,
                  state: 'starting',
                  since: Date.now(),
                  exitCode: null,
                },
              ]}
              onOpen={noop}
              onStop={noop}
            />
          </Section>

          <Section
            title="Background work"
            note="Work carries on with the window closed, on this machine — nothing is sent anywhere to be built. What comes back is a picture, a sentence and what it cost, on the same contact sheet the board already draws. A run that hits a question stops there and waits: nothing answers its own, ever, and that card is the loudest thing in the band because it is the only thing here that cannot move without a person."
          >
            <div className="gallery__overview">
              <Away
                away={AWAY}
                now={NOW}
                busy={false}
                onKeepGoing={noop}
                onStartAfter={noop}
                onKeep={noop}
                onDrop={noop}
                onAnswer={noop}
                onAddRepeat={noop}
                onSwitchRepeat={noop}
                onForgetRepeat={noop}
              />
            </div>
            <p className="gallery__caption">
              The question first, whole, in the Guard's own words. Under it the sheet, then one box
              that gets on with something whether or not this window stays open, then the things
              asked for over and over — each with when it happens next and a way to stop it. Nothing
              runs here that a person cannot see and end.
            </p>
          </Section>

          <Section
            title="Ready to ship"
            note="The foot of the overview. Work checked in a copy sits until somebody answers it; both answers are undoable. Handing work to a developer never does it on one press — the confirmation says what is about to leave, in the same sentences the shell would use. Putting something online is a conversation with the agent, not a button that only works for one host."
          >
            <div className="gallery__overview">
              <Landing
                state={LANDING}
                busy={false}
                showMe={false}
                going={null}
                outcome={null}
                decided={null}
                onDecide={noop}
                onUndo={noop}
                onHandOver={noop}
                onShare={noop}
                onOpenLink={noop}
              />
            </div>
            <p className="gallery__caption">
              Nothing here is named after how it works. "Work in a copy, and ask me first" rather than
              anything about sandboxes; "Let it in" and "Set it aside" rather than approve and reject.
              What is waiting says what it was asked for, in the person's own words.
            </p>
          </Section>

          <Section
            title="When it goes wrong"
            note="Slower than everything else: 280ms, no shake, no red flash. Colour carries the severity; motion stays gentle."
          >
            <ErrorCard
              what="The build stopped before it finished."
              because="It looks like the icon package didn’t install properly — everything else compiled."
              actionLabel="Install it again and retry"
              onAction={noop}
              technicalDetails={`npm ERR! code ERESOLVE
npm ERR! Could not resolve dependency:
npm ERR! peer react@"^18.0.0" from lucide-react@0.263.1
npm ERR! Found: react@19.0.0

vite v6.0.5 building for production...
✗ Failed to resolve import "lucide-react" from "src/components/Toolbar.tsx"`}
            />
            <ErrorCard
              what="I couldn’t open that Figma file."
              because="The link is fine, but the file sits in a team the connected account can’t see — it probably needs sharing."
              actionLabel="Show me how to share it"
              onAction={noop}
            />
            {/* Being offline is not a broken app, and it does not get its own
                red screen. It is one more thing that went wrong, said in the
                same shape as the others — with the one fact that matters most
                first: your work is still here. */}
            <ErrorCard
              what="I’ve lost the connection."
              because="Everything you’ve made is still on this machine and nothing is lost. I just can’t think until the network is back."
              actionLabel="Try again"
              onAction={noop}
            />
            <p className="gallery__caption">
              Three failures, one shape. The first sentence is what happened, the second is the
              likeliest reason and admits to being a guess, and the button is the single most
              useful thing left to do. No card here ever says “error”, and none of them shakes.
            </p>
          </Section>

          <Section
            title="Design"
            note="Everything about how the project looks, over the conversation rather than squeezed into a 328px column. A grid, so a palette is a palette and a hundred movements are a list you can find something in. ⌘D opens it; Esc leaves."
          >
            <div className="gallery__sheet">
              <DesignView
                at="styles"
                data={{
                  styles: STYLES,
                  motion: readMotion(STYLESHEET),
                  drifted: findDrift(STYLESHEET, STYLES.tokens),
                  unreadable: readDesign(STYLES).unreadable,
                  fixing: null,
                  looks: [],
                  looksSay: '',
                  checkingWidths: false,
                  workingAt: null,
                  inStep: IN_STEP,
                  lookingAtFigma: false,
                  busy: false,
                  showMe: false,
                }}
                dirty={false}
                onSave={noop}
                onDiscard={noop}
                onClose={noop}
                onNudge={noop}
                onNudgeMotion={noop}
                onFixColour={noop}
                onCheckWidths={noop}
                onWorkAt={noop}
                onFollowDesign={noop}
                onLookAgain={noop}
                onBuildIn={noop}
                onCaughtUp={noop}
                onStopFollowing={noop}
              />
            </div>
            <p className="gallery__caption">
              Each band keeps its own empty state rather than disappearing, so pressing a chip
              never lands on nothing. The two long ones — every movement, every near-miss — draw a
              screenful and offer the rest, because each row here is a live demonstration.
            </p>
          </Section>

          <Section
            title="History, as lines"
            note="The rail beside the conversation says what the project looked like then. This says how the work actually ran: what came after what, where two goes at the same thing were tried side by side, and where they came back together. Every row carries the short id, so anybody who wants to go and do something with it elsewhere can."
          >
            <div className="gallery__sheet">
              <HistoryView
                versions={TIMELINE}
                pictures={{}}
                git={GIT_DIRTY}
                onClose={noop}
                onPutBack={noop}
                onOpenFile={noop}
              />
            </div>
            <p className="gallery__caption">
              The lines are one drawing behind the rows rather than a fragment per row — a line
              runs between two rows and belongs to neither. The column beside it is the row you
              have chosen, whole: who, when, what it came after, and what has moved since.
            </p>
          </Section>

          <Section
            title="The very first launch"
            note="Nothing remembered is a different screen, not the same screen with an empty list in the middle of it. “Where were we?” over nothing is the app asking a question it already knows the answer to."
          >
            <ProjectPicker projects={[]} onOpen={noop} onForget={noop} onBrowse={noop} />
            <p className="gallery__caption">
              One heading, one sentence about what the app will and will not touch, one control. The
              sentence is there because handing a folder to something that edits files is the moment
              somebody hesitates, and the honest answer to that hesitation is short.
            </p>
          </Section>

          <Section
            title="When everything is too long"
            note="The states nobody designs, drawn on purpose: a title that will not fit, a name nobody would type, a log with no end, and a link with no spaces in it."
          >
            <div className="gallery__rail gallery__rail--tight">
              <Versions
                versions={AWKWARD}
                putBack={null}
                onPutBack={noop}
                onName={noop}
                onDismissPutBack={noop}
              />
            </div>
            <p className="gallery__caption">
              The rail at its narrowest, with the worst titles it will ever be given. Two lines and
              then an ellipsis, the time and the action on one line under it, and the spine running
              straight through all of it whatever height the rows end up.
            </p>

            <div className="thread-sample">
              <Message from="you">
                https://www.figma.com/design/8Kx2VqPZmN4LrT9wBcDfGh/Landing-v4?node-id=1204-58317&amp;t=QmZxLpKr9NvB2Yh-4
              </Message>
              <Message from="graphe">
                {'That is the frame with the three cards in it. Widening the container now.'}
              </Message>
            </div>
            <p className="gallery__caption">
              An address with nothing to break on wraps rather than pushing the conversation wider
              than the window.
            </p>
          </Section>
        </div>
      </div>

      {/* Mounted exactly as the app mounts it, so what is reviewed here is what
          ships: the backdrop, the panel, the found rows, the whole thing. */}
      <ConnectModal
        open={connectOpen}
        onClose={() => setConnectOpen(false)}
        state={CONNECT_STATE}
        step={null}
        busy={false}
        failure={null}
        discovered={FOUND_ACCOUNTS}
        importing={null}
        onConnect={noop}
        onAnswer={noop}
        onCancel={noop}
        onImport={noop}
        onSelect={noop}
        onDisconnect={noop}
      />

      <AddMore
        open={addMoreOpen}
        packs={PACKS}
        vouchedFor={VOUCHED_FOR}
        busy={null}
        warning="Made by people we do not know. Ask what one does before you add it."
        explaining={null}
        explanations={{}}
        onClose={() => setAddMoreOpen(false)}
        onSearch={noop}
        onAdd={noop}
        onRemove={noop}
        onExplain={noop}
        carried={carried}
        onTrustCarried={(id, trust) =>
          setCarried((was) => was.map((one) => (one.id === id ? { ...one, trusted: trust } : one)))
        }
      />
    </main>
  );
}
