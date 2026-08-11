/** A page you can hand to a client.
 *
 * One self-contained HTML file: what changed, why, and the pictures either side
 * of it. Nothing is fetched when it opens — no address in the markup points off
 * the machine it was written on — so it survives being emailed, dropped in a
 * folder, or opened a year later with no network.
 *
 * Pure. Same review in, same bytes out.
 */

import { evaluate } from '../agent/guard/policy';
import { clockTime } from '../lib/when';

/** One change, with its pictures already carried as bytes rather than links. */
export type Shown = {
  title: string;
  when: number;
  /** The plain sentence beside the pictures. */
  says: string;
  before: string | null;
  after: string | null;
};

export type Review = {
  project: string;
  /** When the page itself was put together. */
  made: number;
  changes: readonly Shown[];
  /** Already written as money, or null to leave it off the page. */
  spent: string | null;
};

const ENTITIES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Everything that reaches the page goes through here first. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => ENTITIES[character] ?? character);
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

function dayOf(at: number): string {
  const date = new Date(at);
  return `${date.getDate()} ${MONTHS[date.getMonth()] ?? ''} ${date.getFullYear()}`;
}

function momentOf(at: number): string {
  return `${dayOf(at)} at ${clockTime(new Date(at))}`;
}

/** Pictures are only ever drawn from bytes we are already holding. A link would
 *  make the page phone home the first time somebody opened it. */
function picture(source: string | null): string | null {
  if (source === null) return null;
  return source.startsWith('data:image/') ? source : null;
}

const COUNTS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six'] as const;

function counted(many: number): string {
  return COUNTS[many] ?? String(many);
}

/** The one-line answer somebody gets before they scroll. */
function opening(changes: readonly Shown[]): string {
  if (changes.length === 0) return 'Nothing has changed yet.';
  const days = changes.map((change) => change.when);
  const first = dayOf(Math.min(...days));
  const last = dayOf(Math.max(...days));
  if (changes.length === 1) return `One change, made on ${last}.`;
  if (first === last) return `${counted(changes.length)} changes, all made on ${last}.`;
  return `${counted(changes.length)} changes, made between ${first} and ${last}.`;
}

function frame(source: string, label: string, title: string): string {
  const which = label.toLowerCase();
  return `<figure class="frame ${which}">
        <img src="${escapeHtml(source)}" alt="${escapeHtml(title)} — ${escapeHtml(which)}">
        <figcaption>${escapeHtml(label)}</figcaption>
      </figure>`;
}

/** The three ways of looking, when there are two pictures to look at. */
function picker(index: number): string {
  const name = `show-${index}`;
  const choice = (suffix: string, className: string, label: string, checked: boolean): string =>
    `<input class="pick ${className}" type="radio" name="${name}" id="${name}-${suffix}"${
      checked ? ' checked' : ''
    }><label for="${name}-${suffix}">${label}</label>`;
  return `<div class="picks" role="group" aria-label="How to show the pictures">${choice(
    'both',
    'both',
    'Side by side',
    true,
  )}${choice('before', 'only-before', 'Before', false)}${choice(
    'after',
    'only-after',
    'After',
    false,
  )}</div>`;
}

function pictures(change: Shown, index: number): string {
  const before = picture(change.before);
  const after = picture(change.after);

  if (before !== null && after !== null) {
    return `<div class="pair">
      ${picker(index)}
      <div class="frames">
        ${frame(before, 'Before', change.title)}
        ${frame(after, 'After', change.title)}
      </div>
    </div>`;
  }
  if (after !== null) {
    return `<div class="pair">
      <div class="frames one">${frame(after, 'After', change.title)}</div>
      <p class="aside">This part is new — there was nothing here before it.</p>
    </div>`;
  }
  if (before !== null) {
    return `<div class="pair">
      <div class="frames one">${frame(before, 'Before', change.title)}</div>
      <p class="aside">This is how it looked before. There is no picture of it afterwards.</p>
    </div>`;
  }
  return '<p class="aside">There is no picture of this one.</p>';
}

function section(change: Shown, index: number): string {
  return `<section class="change" id="change-${index}" aria-labelledby="change-${index}-title">
    <h2 id="change-${index}-title">${escapeHtml(change.title)}</h2>
    <p class="when">${escapeHtml(momentOf(change.when))}</p>
    <p class="says">${escapeHtml(change.says)}</p>
    ${pictures(change, index)}
  </section>`;
}

function contents(changes: readonly Shown[]): string {
  const items = changes
    .map(
      (change, at) => `<li>
        <a href="#change-${at + 1}">${escapeHtml(change.title)}</a>
        <span class="says">${escapeHtml(change.says)}</span>
      </li>`,
    )
    .join('\n      ');
  return `<ol class="contents">
      ${items}
    </ol>`;
}

const EMPTY = `<p class="aside">There is nothing to show here yet. When something changes, it will
      appear on this page with a picture of it before and after.</p>`;

/* The palette, type and spacing are the app's own, written out as literals
   because this file has to stand on its own once it leaves the machine. */
const STYLE = `:root {
      color-scheme: light;
      --bg: #fbfbfa;
      --bg-raised: #ffffff;
      --bg-sunken: #f2f2f0;
      --border: #e4e4e1;
      --border-strong: #d2d2ce;
      --text: #1a1a19;
      --text-muted: #6b6b66;
      --text-faint: #6e6e68;
      --accent: #b8492c;
      --accent-soft: #f6e9e4;
      --accent-ink: #ad4529;
      --shadow-sm: 0 1px 2px rgb(0 0 0 / 0.04), 0 1px 3px rgb(0 0 0 / 0.06);
      --font-ui: ui-sans-serif, -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI',
        system-ui, sans-serif;
      --text-2xs: 0.6875rem;
      --text-xs: 0.75rem;
      --text-sm: 0.8125rem;
      --text-base: 0.9375rem;
      --text-lg: 1.125rem;
      --text-xl: 1.5rem;
      --text-2xl: 2rem;
      --space-1: 4px;
      --space-2: 8px;
      --space-3: 12px;
      --space-4: 16px;
      --space-5: 24px;
      --space-6: 32px;
      --space-7: 48px;
      --space-8: 72px;
      --radius-sm: 6px;
      --radius-md: 10px;
      --radius-lg: 14px;
      --measure: 680px;
      --ease-hover: ease;
      --dur-micro: 120ms;
    }

    @media (prefers-color-scheme: dark) {
      :root {
        color-scheme: dark;
        --bg: #131312;
        --bg-raised: #1c1c1a;
        --bg-sunken: #0e0e0d;
        --border: #2b2b28;
        --border-strong: #3a3a36;
        --text: #f2f2ef;
        --text-muted: #9a9a93;
        --text-faint: #87877f;
        --accent: #e0714d;
        --accent-soft: #2a1c17;
        --accent-ink: #e0714d;
        --shadow-sm: 0 1px 2px rgb(0 0 0 / 0.3);
        --shadow-md: 0 4px 20px rgb(0 0 0 / 0.4);
      }
    }

    * { box-sizing: border-box; }

    html {
      max-width: 100%;
      overflow-x: hidden;
    }

    body {
      margin: 0;
      padding: var(--space-7) var(--space-4) var(--space-8);
      max-width: 100%;
      overflow-x: hidden;
      background: var(--bg);
      color: var(--text);
      font-family: var(--font-ui);
      font-size: var(--text-base);
      line-height: 1.55;
      -webkit-font-smoothing: antialiased;
    }

    ::selection { background: color-mix(in srgb, var(--accent) 22%, var(--bg)); }

    .sheet {
      max-width: var(--measure);
      margin: 0 auto;
    }

    h1, h2 {
      margin: 0;
      font-weight: 600;
      letter-spacing: -0.01em;
      overflow-wrap: anywhere;
    }

    h1 { font-size: var(--text-2xl); line-height: 1.2; }
    h2 { font-size: var(--text-lg); }
    p { overflow-wrap: anywhere; }

    .who {
      margin: 0 0 var(--space-2);
      color: var(--accent-ink);
      font-size: var(--text-xs);
      font-weight: 600;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }

    .made {
      margin: var(--space-3) 0 0;
      color: var(--text-faint);
      font-size: var(--text-sm);
    }

    .summary {
      margin: var(--space-6) 0 var(--space-7);
      padding: var(--space-5);
      background: var(--bg-raised);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-sm);
    }

    .summary h2 { font-size: var(--text-base); color: var(--text-muted); }
    .summary .lead { margin: var(--space-2) 0 0; font-size: var(--text-lg); }

    .contents {
      margin: var(--space-4) 0 0;
      padding: 0 0 0 var(--space-4);
      display: grid;
      gap: var(--space-3);
    }

    .contents li::marker { color: var(--text-faint); font-size: var(--text-sm); }
    .contents a {
      color: var(--text);
      font-weight: 550;
      text-decoration-color: var(--border-strong);
      text-underline-offset: 3px;
      transition: color var(--dur-micro) var(--ease-hover);
    }
    .contents a:hover { color: var(--accent-ink); }
    .contents .says { display: block; color: var(--text-muted); font-size: var(--text-sm); }

    .change { scroll-margin-top: var(--space-4); }

    .change + .change {
      padding-top: var(--space-6);
      margin-top: var(--space-6);
      border-top: 1px solid var(--border);
    }

    .when {
      margin: var(--space-1) 0 0;
      color: var(--text-faint);
      font-size: var(--text-xs);
    }

    .says { margin: var(--space-3) 0 0; color: var(--text-muted); }

    .pair { margin-top: var(--space-4); }

    .picks {
      position: relative;
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-1);
      margin-bottom: var(--space-3);
    }

    .picks input {
      position: absolute;
      width: 1px;
      height: 1px;
      opacity: 0;
      pointer-events: none;
    }

    .picks label {
      padding: var(--space-1) var(--space-3);
      border: 1px solid var(--border);
      border-radius: 999px;
      background: var(--bg-raised);
      color: var(--text-muted);
      font-size: var(--text-xs);
      cursor: pointer;
      transition:
        color var(--dur-micro) var(--ease-hover),
        background var(--dur-micro) var(--ease-hover),
        border-color var(--dur-micro) var(--ease-hover);
    }

    .picks label:hover { color: var(--text); }

    .picks input:checked + label {
      background: var(--accent-soft);
      border-color: var(--accent);
      color: var(--accent-ink);
    }

    .picks input:focus-visible + label {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }

    .frames {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--space-3);
    }

    .frames.one { grid-template-columns: minmax(0, 1fr); }

    .frame {
      margin: 0;
      min-width: 0;
      background: var(--bg-sunken);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      overflow: hidden;
    }

    .frame img {
      display: block;
      width: 100%;
      height: auto;
      max-width: 100%;
    }

    .frame figcaption {
      padding: var(--space-2) var(--space-3);
      border-top: 1px solid var(--border);
      color: var(--text-faint);
      font-size: var(--text-2xs);
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }

    .aside { margin: var(--space-3) 0 0; color: var(--text-faint); font-size: var(--text-sm); }

    .foot {
      margin-top: var(--space-7);
      padding-top: var(--space-4);
      border-top: 1px solid var(--border);
      color: var(--text-faint);
      font-size: var(--text-xs);
    }

    /* One picture at a time, in the same frame, so small moves are easy to spot. */
    .pair:has(.only-before:checked) .frames,
    .pair:has(.only-after:checked) .frames {
      grid-template-columns: minmax(0, 1fr);
    }
    .pair:has(.only-before:checked) .after { display: none; }
    .pair:has(.only-after:checked) .before { display: none; }

    @media (max-width: 640px) {
      body { padding: var(--space-5) var(--space-3) var(--space-7); }
      h1 { font-size: var(--text-xl); }
      .frames { grid-template-columns: minmax(0, 1fr); }
    }

    @media print {
      body { background: #ffffff; }
      .picks { display: none; }
      .change { break-inside: avoid; }
    }`;

/**
 * The whole page, as one string.
 *
 * Every value from the review is escaped on its way in, and the only pictures
 * drawn are ones already carried as bytes.
 */
export function reviewPage(review: Review): string {
  const project = escapeHtml(review.project);
  const body = review.changes.map((change, at) => section(change, at + 1)).join('\n\n    ');
  const spent =
    review.spent === null
      ? ''
      : `\n      <p class="made">Cost of the work so far: ${escapeHtml(review.spent)}</p>`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex">
    <title>${project} — what changed</title>
    <style>
    ${STYLE}
    </style>
  </head>
  <body>
    <main class="sheet">
      <p class="who">${project}</p>
      <h1>Here&#39;s what changed</h1>
      <p class="made">Put together on ${escapeHtml(momentOf(review.made))}</p>${spent}

      <section class="summary" aria-labelledby="summary-title">
        <h2 id="summary-title">What changed, and why</h2>
        <p class="lead">${escapeHtml(opening(review.changes))}</p>
        ${review.changes.length === 0 ? EMPTY : contents(review.changes)}
      </section>

      ${body}

      <p class="foot">This page is a picture of the work at one moment. It is only for reading —
      nothing on it can be changed from here.</p>
    </main>
  </body>
</html>
`;
}

/** The plain sentence somebody gets instead of a page with their key in it. */
const REFUSAL =
  'One of your private keys is written in this. I have not made the page, so nothing has left your machine. Take the key out and ask again.';

/** Every word the page would put in front of a reader. Pictures are left out —
 *  they are bytes, and only text can carry a key. */
function everyWord(review: Review): string {
  const lines = [review.project, review.spent ?? ''];
  for (const change of review.changes) lines.push(change.title, change.says);
  return lines.join('\n');
}

/**
 * Would this page be safe to hand to somebody else?
 *
 * The judgement is the Guard's own — the same one that stops a copy of a
 * conversation leaving with a key in it — so there is one place that decides
 * what a key looks like, not two.
 */
export function safeToShare(review: Review): { ok: true } | { ok: false; because: string } {
  const verdict = evaluate(
    { id: 'review', name: 'share', input: { text: everyWord(review) } },
    { projectRoot: '' },
  );
  return verdict.kind === 'deny' ? { ok: false, because: REFUSAL } : { ok: true };
}
