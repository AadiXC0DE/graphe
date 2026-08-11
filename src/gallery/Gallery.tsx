import { useEffect, useState, type ReactNode } from 'react';
import ActivityLine from '../components/ActivityLine';
import type { Attachment } from '../components/Attachments';
import Composer from '../components/Composer';
import ConfirmChange from '../components/ConfirmChange';
import ConnectModal from '../components/ConnectModal';
import CostMeter from '../components/CostMeter';
import ErrorCard from '../components/ErrorCard';
import Message from '../components/Message';
import ProjectMenu from '../components/ProjectMenu';
import ProjectPicker from '../components/ProjectPicker';
import Overview from '../components/Overview';
import Sidebar from '../components/Sidebar';
import VersionRow from '../components/VersionRow';
import Versions from '../components/Versions';
import Welcome from '../components/Welcome';
import type { ConnectionState, FoundAccount, PutBack, RecentProject, SavedVersion } from '../lib/ipc';
import type { Reference, ResearchEntry } from '../lib/projects';
import type { SpendView } from '../lib/spend';
import { createLimit } from '../cost/limits';
import { money } from '../cost/money';
import { biggerJob, estimateNote, longConversation } from '../cost/phrasing';
import type { Estimate } from '../cost/estimate';
import { pagesIn } from '../preview/pages';
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

/** Real tool-call inputs, so the "Show me" lines below are produced by the same
 *  function the app uses rather than typed out to look right. */
const FIGMA_FILE = { path: '/Users/you/Sites/paper-street/design/landing-v4.fig' };
const TOKENS_FILE = { path: '/Users/you/Sites/paper-street/src/styles/tokens.css' };
const BUILD = { command: 'npm run build' };

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

/** The screens of a project with the shape of a real one. */
const GALLERY_PAGES = pagesIn([
  'src/app/page.tsx',
  'src/app/about/page.tsx',
  'src/app/pricing/page.tsx',
  'src/app/(marketing)/case-studies/page.tsx',
  'src/app/work/[slug]/page.tsx',
]);

const TIMELINE: readonly SavedVersion[] = [
  {
    id: 'v5',
    at: NOW - 2 * MINUTE,
    title: 'Went back to “before I broke the nav”',
    by: 'you',
    named: false,
    current: true,
  },
  {
    id: 'v4',
    at: NOW - 9 * MINUTE,
    title: 'Hero rebuilt from your Figma frame',
    by: 'graphe',
    named: false,
    current: false,
  },
  {
    id: 'v3',
    at: NOW - 55 * MINUTE,
    title: 'before I broke the nav',
    by: 'you',
    named: true,
    current: false,
  },
  {
    id: 'v2',
    at: NOW - 3 * HOUR,
    title: 'Cards moved onto the grid',
    by: 'graphe',
    named: false,
    current: false,
  },
];

/** The timeline nobody would choose: a title somebody typed at length, a title
 *  we wrote that ran long, and one that is three characters. Real rows, so the
 *  rail can be judged at its worst rather than at its tidiest. */
const AWKWARD: readonly SavedVersion[] = [
  {
    id: 'a1',
    at: NOW - 4 * MINUTE,
    title:
      'Went back to “before I broke the nav on the pricing page and then broke it again on mobile”',
    by: 'you',
    named: true,
    current: true,
  },
  {
    id: 'a2',
    at: NOW - 3 * HOUR,
    title: 'Rebuilt the whole marketing site from the Figma library, including every component',
    by: 'graphe',
    named: false,
    current: false,
  },
  { id: 'a3', at: NOW - 26 * HOUR, title: 'wip', by: 'you', named: true, current: false },
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
};

/* -------------------------------------------------------------------------- */
/* The connect screen                                                          */
/* -------------------------------------------------------------------------- */

/** The provider list, built with the same shapes src/agent/pi sends: two
 *  connected or connectable accounts with their real method labels, and a
 *  Google that has no account yet and no way to get one from here. */
const CONNECT_STATE: ConnectionState = {
  chosen: null,
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
        { id: 'claude-sonnet-4-5', label: 'Sonnet 4.5', available: true, rates: { input: 3, output: 15 }, contextWindow: 1000000 },
        { id: 'claude-opus-4-5', label: 'Opus 4.5', available: false, rates: { input: 5, output: 25 }, contextWindow: 200000 },
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
  /** Live for the same reason: the connect screen is a moment, not a picture,
   *  and the closest thing to the moment is opening and closing it. */
  const [connectOpen, setConnectOpen] = useState(false);
  /** What the first screen put in the box, so the two can be reviewed as the one
   *  gesture they are rather than as two components that happen to be near each
   *  other. */
  const [draft, setDraft] = useState('');

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
              <CostMeter spent={inr(4000)} onDetails={noop} />
              <CostMeter spent={inr(120_000)} limit={monthlyLimit} onDetails={noop} />
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
                onSend={noop}
                attachments={attached}
                onAttachmentsChange={setAttached}
                draft={draft}
                connection={CONNECT_STATE}
                onSelectModel={noop}
                onConnect={noop}
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
                pages={GALLERY_PAGES}
                onOpenPage={noop}
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
                pages={GALLERY_PAGES}
                onOpenPage={noop}
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
                  putBack: JUST_PUT_BACK,
                  spent: SPENT,
                  busy: true,
                  showMe: false,
                  looks: [],
                  looksSay: '',
                  checkingWidths: false,
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
                    ],
                  },
                }}
                onPutBack={noop}
                onName={noop}
                onDismissPutBack={noop}
                onShowSplit={noop}
                onOpenFile={noop}
                onSave={noop}
                onCheckWidths={noop}
                onShare={noop}
                onNudge={noop}
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
    </main>
  );
}
