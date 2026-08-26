/** Pointing at the thing you mean.
 *
 * Describing *where* is the hardest sentence a designer has to write. Clicking
 * the element should be the whole of it — so this file holds the judgement
 * behind a click: how an element gets named for a machine, what it gets called
 * out loud, and the browser script that does both on the page itself.
 *
 * No files, no sockets, no React. The script is assembled from the very source
 * the tests run, so what the page decides and what we assert cannot drift.
 */

import { copyable, WORTH_COPYING, type Copyable, type TidyOptions } from './copyable';

/** Where an element sits on the page, in page pixels. */
export type Rect = { x: number; y: number; width: number; height: number };

/** What the element is made of, for handing somebody its code. Gathered on a
 *  click and not on every movement of the cursor — it is not free. */
export type PointedSource = {
  html: string;
  styles: Record<string, string>;
  /** The project's own values in scope on this element, as the page resolves
   *  them. Present only where the browser will hand them over. */
  vars?: Record<string, string>;
};

/**
 * One way the page worked out where an element came from.
 *
 * Every rung it can fill in is sent, in no particular order — which of them is
 * worth believing is a judgement, and judgement lives in `inspect.ts` where it
 * can be tested. A page that answers none of them still answers the last two,
 * which is why pointing at somebody else's site is never a failure.
 */
export type Trace =
  | { how: 'stamp'; file: string; line: number; column?: number; component?: string }
  | { how: 'stack'; file: string; line: number; column?: number; mapped?: boolean }
  | { how: 'owner'; component: string }
  | { how: 'selector'; selector: string }
  | { how: 'markup'; html: string }
  | { how: 'text'; text: string };

/** One element somebody clicked. */
export type Pointed = {
  selector: string;
  label: string;
  rect: Rect;
  /** What it is, said plainly: `button`, `heading`, `image`. */
  kind?: string;
  /** Which one of how many, and what it sits inside. */
  place?: { nth: number; of: number; within?: string };
  /** Present on a click, absent while the cursor is only passing over. */
  source?: PointedSource;
  /** Everything the page could work out about where this came from. */
  origin?: readonly Trace[];
  /** How wide the page was being looked at, so the other widths can be named. */
  view?: { width: number; height: number };
  /** What somebody wrote about it, on the page, at the spot they wrote it.
   *  Absent when they picked something and said nothing. */
  said?: string;
};

/** As long as a note beside a button ever needs to be. Past this it is not a
 *  note, and the box on the page is the wrong place to be writing it. */
export const SAID_MAX = 600;

/** A line of somebody's code, as a stack frame gives it. */
export type Frame = { name: string | null; file: string; line: number; column: number };

/** Where a generated line came from, once a source map has been read. */
export type Origin = { file: string; line: number; column: number };

/** A source map, in the only three fields anything here reads. */
export type SourceMap = {
  mappings: string;
  sources: readonly string[];
  sourceRoot?: string;
  sections?: unknown;
};

/** An element described flatly, so the naming can be judged without a browser.
 *  `nth` counts siblings of the same tag, from one. */
export type ElementFacts = {
  id?: string;
  tagName: string;
  classList: readonly string[];
  nth: number;
  parent?: ElementFacts | null;
};

/** Everything an element offers towards being called something. */
export type ElementWords = {
  tagName: string;
  role?: string;
  text?: string;
  ariaLabel?: string;
  alt?: string;
  title?: string;
  value?: string;
  placeholder?: string;
};

/** The app's own accent, so the highlight belongs to us on somebody else's page. */
const ACCENT = '#b8492c';

/** On the page itself, where the thing being pointed at is.
 *
 * The old wording named the gesture and not the outcome, so nobody could tell
 * what pressing it would do. What it does is put whatever you click — its file,
 * its component, the values in scope on it — into the message you are writing. */
const ASK = 'Comment on this page';
const PICKING = 'Click anything · Esc to stop';
/** Said on the launcher once a note has gone. The conversation it lands in may
 *  be behind this page, so the page says so itself. */
const TOOK = 'Sent';
/** In the note box, where somebody is about to write. */
const WRITE = 'What should change here?';
const SEND = 'Send';

/**
 * The whole judgement, as one closed function.
 *
 * One function rather than several because the browser script is built from its
 * own source: anything it reached for outside itself would have to be shipped
 * separately and could then be shipped differently.
 */
function judgement() {
  /** Four ancestors is enough to be unambiguous and short enough to still read
   *  as a place on a page. */
  const LEVELS = 4;
  /** A label longer than this is a paragraph, not a name. */
  const LABEL_MAX = 40;
  /** Past this, an element's text is its children's text, not its own. */
  const OWN_TEXT_MAX = 120;

  /** Usable in a selector without escaping. Anything else is passed over. */
  const PLAIN = /^[A-Za-z_][A-Za-z0-9_-]*$/;

  /** Names a build tool invented. They change with the next build, so a
   *  selector resting on one stops matching tomorrow. */
  const MADE_UP: readonly RegExp[] = [
    /^(?:css|sc|emotion|jsx|svelte|styled|hash)[-_][A-Za-z0-9]{4,}$/,
    /^[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)*__[A-Za-z0-9]{4,}$/,
    /^_+[A-Za-z0-9]{4,}$/,
  ];

  /** The head of a utility class. These say how something looks, never which
   *  one it is, so they rank below a name somebody chose. */
  const UTILITY: readonly string[] = [
    'absolute', 'align', 'antialiased', 'aspect', 'backdrop', 'basis', 'bg', 'block', 'blur',
    'border', 'bottom', 'box', 'break', 'capitalize', 'clear', 'col', 'container', 'content',
    'cursor', 'delay', 'divide', 'duration', 'ease', 'fill', 'filter', 'fixed', 'flex', 'float',
    'font', 'gap', 'grid', 'grow', 'h', 'hidden', 'inline', 'inset', 'invisible', 'italic',
    'items', 'justify', 'leading', 'left', 'list', 'm', 'max', 'mb', 'min', 'ml', 'mr', 'mt',
    'mx', 'my', 'object', 'opacity', 'order', 'overflow', 'p', 'pb', 'pl', 'place', 'pointer',
    'pr', 'pt', 'px', 'py', 'relative', 'resize', 'right', 'ring', 'rotate', 'rounded', 'row',
    'scale', 'select', 'self', 'shadow', 'shrink', 'space', 'sr', 'static', 'sticky', 'stroke',
    'table', 'text', 'top', 'tracking', 'transition', 'translate', 'truncate', 'underline',
    'uppercase', 'visible', 'w', 'whitespace', 'z',
  ];

  /** Where the walk up stops. Naming the page itself says nothing. */
  const ROOT: readonly string[] = ['body', 'html'];

  const LANDMARK: Readonly<Record<string, string>> = {
    header: 'header',
    nav: 'navigation',
    footer: 'footer',
    main: 'main area',
    aside: 'sidebar',
    form: 'form',
    section: 'section',
    article: 'article',
  };

  const BY_ROLE: Readonly<Record<string, string>> = {
    button: 'button',
    link: 'link',
    heading: 'heading',
    img: 'image',
    textbox: 'field',
    searchbox: 'field',
    checkbox: 'checkbox',
    radio: 'choice',
    list: 'list',
    listitem: 'item',
    navigation: 'navigation',
    banner: 'header',
    contentinfo: 'footer',
    dialog: 'dialog',
    menu: 'menu',
    tab: 'tab',
  };

  const BY_TAG: Readonly<Record<string, string>> = {
    a: 'link',
    article: 'article',
    aside: 'sidebar',
    blockquote: 'quote',
    button: 'button',
    canvas: 'drawing',
    div: 'block',
    figure: 'image',
    footer: 'footer',
    form: 'form',
    h1: 'heading',
    h2: 'heading',
    h3: 'heading',
    h4: 'heading',
    h5: 'heading',
    h6: 'heading',
    header: 'header',
    img: 'image',
    input: 'field',
    label: 'label',
    li: 'item',
    main: 'main area',
    nav: 'navigation',
    ol: 'list',
    p: 'paragraph',
    picture: 'image',
    section: 'section',
    select: 'dropdown',
    span: 'text',
    svg: 'image',
    table: 'table',
    textarea: 'field',
    ul: 'list',
    video: 'video',
  };

  function isRoot(tagName: string): boolean {
    return ROOT.indexOf(tagName.toLowerCase()) !== -1;
  }

  function madeUp(name: string): boolean {
    for (const pattern of MADE_UP) if (pattern.test(name)) return true;
    // Emotion's `e1a2b3c40`: letters and digits with no word shape to them.
    const digits = name.match(/[0-9]/g);
    return /^[A-Za-z]{0,4}[0-9][A-Za-z0-9]{4,}$/.test(name) && digits !== null && digits.length >= 3;
  }

  function utilityish(name: string): boolean {
    if (name.indexOf(':') !== -1 || name.indexOf('/') !== -1 || name.indexOf('[') !== -1) {
      return true;
    }
    const head = name.replace(/^-/, '').split('-')[0] ?? '';
    return UTILITY.indexOf(head) !== -1;
  }

  /** The best class to name an element by: one somebody chose, else a utility
   *  one as a hint, else nothing. */
  function classFor(
    classList: readonly string[],
  ): { name: string; chosen: boolean } | null {
    let fallback: string | null = null;
    for (const name of classList) {
      if (!PLAIN.test(name) || madeUp(name)) continue;
      if (!utilityish(name)) return { name, chosen: true };
      if (fallback === null) fallback = name;
    }
    return fallback === null ? null : { name: fallback, chosen: false };
  }

  function usableId(el: ElementFacts): string | null {
    const id = el.id ?? '';
    return id !== '' && PLAIN.test(id) && !madeUp(id) ? id : null;
  }

  /** One element's own piece of a selector. `only` means it identifies the
   *  element on its own, so nothing above it needs saying. */
  function partFor(el: ElementFacts): { text: string; only: boolean } {
    const tag = el.tagName.toLowerCase();
    const id = usableId(el);
    if (id !== null) return { text: `#${id}`, only: true };

    const nth = Number.isFinite(el.nth) ? Math.max(1, Math.round(el.nth)) : 1;
    const pick = classFor(el.classList);
    if (pick === null) return { text: `${tag}:nth-of-type(${nth})`, only: false };
    if (pick.chosen) return { text: `${tag}.${pick.name}`, only: false };
    return { text: `${tag}.${pick.name}:nth-of-type(${nth})`, only: false };
  }

  function stableSelector(el: ElementFacts): string {
    const parts: string[] = [];
    let at: ElementFacts | null | undefined = el;
    let up = 0;
    while (at !== null && at !== undefined && !isRoot(at.tagName)) {
      const part = partFor(at);
      parts.unshift(part.text);
      if (part.only || up >= LEVELS) break;
      at = at.parent;
      up++;
    }
    return parts.length === 0 ? el.tagName.toLowerCase() : parts.join(' > ');
  }

  /** `hero-section` and `heroSection` both come out as words. */
  function saidPlainly(name: string): string {
    return name
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/[-_]+/g, ' ')
      .trim()
      .toLowerCase();
  }

  /** The nearest ancestor worth naming — "in the hero", "in the header". */
  function whereIn(el: ElementFacts): string | null {
    let at = el.parent;
    let up = 0;
    while (at !== null && at !== undefined && up < LEVELS) {
      if (!isRoot(at.tagName)) {
        const id = usableId(at);
        if (id !== null) return saidPlainly(id);
        const pick = classFor(at.classList);
        if (pick !== null && pick.chosen) return saidPlainly(pick.name);
        const landmark = LANDMARK[at.tagName.toLowerCase()];
        if (landmark !== undefined) return landmark;
      }
      at = at.parent;
      up++;
    }
    return null;
  }

  function tidy(text: string | undefined): string {
    return (text ?? '').replace(/\s+/g, ' ').trim();
  }

  /** Trimmed at a word where there is one to trim at. */
  function shorten(text: string): string {
    if (text.length <= LABEL_MAX) return text;
    const cut = text.slice(0, LABEL_MAX);
    const space = cut.lastIndexOf(' ');
    const kept = space >= LABEL_MAX / 2 ? cut.slice(0, space) : cut.slice(0, LABEL_MAX - 1);
    return `${kept.replace(/[\s,;:.–—-]+$/, '')}…`;
  }

  function kindOf(el: { tagName: string; role?: string }): string {
    const role = tidy(el.role).toLowerCase();
    const byRole = role === '' ? undefined : BY_ROLE[role];
    if (byRole !== undefined) return byRole;
    return BY_TAG[el.tagName.toLowerCase()] ?? 'element';
  }

  function labelFor(el: ElementWords): string {
    const said = [el.ariaLabel, el.text, el.alt, el.value, el.title, el.placeholder]
      .map(tidy)
      .find((one) => one !== '');
    return said === undefined ? `the ${kindOf(el)}` : shorten(said);
  }

  /** The sentence that goes in the composer. No CSS in it — the selector is for
   *  the machine, this is for the person who clicked. */
  function describePointed(pointed: Pointed): string {
    const label = tidy(pointed.label);
    const kind = tidy(pointed.kind);
    const noun = kind === '' ? 'element' : kind;

    // A label of "the button" is already the plain description; anything else
    // is the element's own words and gets quoted beside what it is.
    let head = `The ${noun}`;
    if (label.startsWith('the ')) head = `The ${label.slice(4)}`;
    else if (label !== '') head = `The ${noun} "${label}"`;

    const place = pointed.place;
    const notes: string[] = [];
    if (place !== undefined && place.of > 1 && place.nth >= 1) {
      notes.push(`${place.nth} of ${place.of}`);
    }
    const within = tidy(place?.within);
    if (within !== '') notes.push(`in the ${within}`);
    return notes.length === 0 ? head : `${head} · ${notes.join(' ')}`;
  }

  return {
    limits: { ownText: OWN_TEXT_MAX, label: LABEL_MAX, levels: LEVELS },
    stableSelector,
    whereIn,
    labelFor,
    kindOf,
    describePointed,
  };
}

const PURE = judgement();

/** A selector stable enough to still find the element after a rebuild.
 *  `#id` first, then a class somebody chose, then position among its kind. */
export function stableSelector(el: ElementFacts): string {
  return PURE.stableSelector(el);
}

/** The nearest ancestor worth naming out loud, or null. */
export function whereIn(el: ElementFacts): string | null {
  return PURE.whereIn(el);
}

/** What to call an element: its own words, else what it is. */
export function labelFor(el: ElementWords): string {
  return PURE.labelFor(el);
}

/** What an element is, said plainly. */
export function kindOf(el: { tagName: string; role?: string }): string {
  return PURE.kindOf(el);
}

/** The sentence a designer reads after clicking. */
export function describePointed(pointed: Pointed): string {
  return PURE.describePointed(pointed);
}

/**
 * A note somebody wrote on the page, as a message to work from.
 *
 * Their words first, because that is the instruction. Then one line saying which
 * element it was about, and where it was written when the page could tell us —
 * enough to go and change it, and short enough that the instruction is still the
 * first thing read. Everything else the page knows is a reading, and a reading
 * is an answer to a question nobody asked here.
 */
export function asksAbout(pointed: Pointed): string {
  const said = (pointed.said ?? '').replace(/\s+/g, ' ').trim();
  const what = describePointed(pointed);
  const written = (pointed.origin ?? []).find(
    (trace): trace is Extract<Trace, { file: string; line: number }> =>
      (trace.how === 'stamp' || trace.how === 'stack') && typeof trace.file === 'string',
  );
  const where = written === undefined ? '' : `, in ${written.file}:${String(written.line)}`;
  const about = `About ${what.charAt(0).toLowerCase()}${what.slice(1)}${where}`;
  return said === '' ? about : `${said}\n\n${about}`;
}

/**
 * Working out where a rendered element was written.
 *
 * Closed for the same reason as `judgement`: the browser gets this as its own
 * source, so the frames a page parses and the frames a test parses are the same
 * code. Nothing here touches the DOM — that stays in the script, so all of the
 * fiddly parts (stacks, base64, source maps) can be tested without a browser.
 */
function tracing() {
  /** React writes this at the bottom of every owner stack it captures. A stack
   *  without it belongs to somebody else and says nothing about our JSX. */
  const SENTINEL = 'react_stack_bottom_frame';
  const TOP = 'Error: react-stack-top-frame\n';

  const DIGITS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

  /** `at Name (url:12:9)` and the bare `at url:12:9`, as V8 writes them. */
  const V8 = /^\s*at\s+(?:(.+?)\s+\()?([^()\s]+?):(\d+):(\d+)\)?\s*$/;
  /** `Name@url:12:9`, as everything else does. */
  const OTHER = /^\s*(?:(.*?)@)?([^@\s]+?):(\d+):(\d+)\s*$/;

  const MAP_COMMENT = /\/\/[#@]\s*sourceMappingURL=([^\s'"]+)/g;
  const DATA_MAP = /^data:application\/json[^,]*?(;base64)?,(.*)$/i;

  /** Attributes a build tool leaves behind saying where JSX was written. Ours
   *  first, then the two a project is most likely to already have. */
  const STAMPS: readonly {
    file: string;
    line?: string;
    column?: string;
    component?: string;
  }[] = [
    { file: 'data-graphe-source', component: 'data-graphe-name' },
    {
      file: 'data-inspector-relative-path',
      line: 'data-inspector-line',
      column: 'data-inspector-column',
      component: 'data-inspector-name',
    },
    { file: 'data-lov-id', component: 'data-lov-name' },
  ];

  /**
   * A path an editor can open.
   *
   * A source map whose sources still carry `://` is one React DevTools gives up
   * on, and an agent handed the same string would hit the same wall. Vite's HMR
   * query goes too: `App.tsx?t=1712` is not a file anybody has.
   */
  function plainPath(text: string): string {
    let out = String(text ?? '').split('?')[0]?.split('#')[0] ?? '';
    out = out.replace(/^file:\/\//i, '');
    out = out.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, '');
    out = out.replace(/^\/@fs\//, '/');
    out = out.replace(/^\/@id\/(?:__x00__)?/, '');

    const parts: string[] = [];
    for (const part of out.split('/')) {
      if (part === '' || part === '.') continue;
      if (part === '..') parts.pop();
      else parts.push(part);
    }
    return parts.join('/');
  }

  /** base64 VLQ, the one encoding every source map is written in. */
  function vlq(text: string): number[] {
    const out: number[] = [];
    let value = 0;
    let shift = 0;
    for (let i = 0; i < text.length; i++) {
      const digit = DIGITS.indexOf(text.charAt(i));
      if (digit === -1) return [];
      value += (digit & 31) << shift;
      if ((digit & 32) !== 0) {
        shift += 5;
        continue;
      }
      const negative = (value & 1) === 1;
      value = value >>> 1;
      out.push(negative ? -value : value);
      value = 0;
      shift = 0;
    }
    return shift === 0 ? out : [];
  }

  /**
   * The frames a designer's own code wrote, and nothing below them.
   *
   * Follows React's own cut exactly: drop the header, drop the JSX frame, stop
   * at the sentinel. No sentinel is a bail rather than a guess — half a stack
   * pointing at the wrong file is worse than admitting we do not know.
   */
  function ownerStack(stack: string): string {
    let text = typeof stack === 'string' ? stack : '';
    if (text === '') return '';
    if (text.indexOf(TOP) === 0) text = text.slice(TOP.length);
    const first = text.indexOf('\n');
    if (first === -1) return '';
    text = text.slice(first + 1);
    const at = text.indexOf(SENTINEL);
    if (at === -1) return '';
    const cut = text.lastIndexOf('\n', at);
    return cut === -1 ? '' : text.slice(0, cut);
  }

  function framesFrom(stack: string): Frame[] {
    const out: Frame[] = [];
    for (const line of String(stack ?? '').split('\n')) {
      const match = V8.exec(line) ?? OTHER.exec(line);
      if (match === null) continue;
      const file = match[2] ?? '';
      const at = Number(match[3]);
      const column = Number(match[4]);
      if (file === '' || !Number.isFinite(at) || !Number.isFinite(column)) continue;
      const name = (match[1] ?? '').trim();
      out.push({ name: name === '' ? null : name, file, line: at, column });
    }
    return out;
  }

  type Section = { offset?: { line: number; column: number }; map?: SourceMap };

  function sourceAt(map: SourceMap, index: number): string {
    const raw = map.sources?.[index] ?? '';
    if (raw === '') return '';
    const root = map.sourceRoot ?? '';
    const joined =
      root === '' ? raw : `${root.replace(/\/+$/, '')}/${String(raw).replace(/^\/+/, '')}`;
    return plainPath(joined);
  }

  /** An indexed map: the last section starting at or before the position owns
   *  it, and the position is asked again in that section's own coordinates. */
  function inSections(
    sections: readonly Section[],
    line: number,
    column: number,
  ): Origin | null {
    let chosen: { map: SourceMap; line: number; column: number } | null = null;
    for (const section of sections) {
      const offset = section?.offset;
      const inner = section?.map;
      if (offset === undefined || inner === undefined) continue;
      const startLine = offset.line + 1;
      const startColumn = offset.column + 1;
      if (startLine > line || (startLine === line && startColumn > column)) continue;
      chosen = { map: inner, line: startLine, column: startColumn };
    }
    if (chosen === null) return null;
    return originIn(
      chosen.map,
      line - chosen.line + 1,
      line === chosen.line ? column - chosen.column + 1 : column,
    );
  }

  /** Where a generated line and column came from. Both are 1-based going in and
   *  coming out, because that is how an editor counts and how a stack reads. */
  function originIn(map: SourceMap, line: number, column: number): Origin | null {
    if (map === null || typeof map !== 'object') return null;
    const sections = map.sections;
    if (Array.isArray(sections)) return inSections(sections as readonly Section[], line, column);
    if (typeof map.mappings !== 'string') return null;

    const rows = map.mappings.split(';');
    if (line < 1 || line > rows.length) return null;

    const wanted = column - 1;
    let file = 0;
    let at = 0;
    let start = 0;
    let best: Origin | null = null;
    let first: Origin | null = null;

    for (let row = 0; row < line; row++) {
      let generated = 0;
      for (const segment of (rows[row] ?? '').split(',')) {
        if (segment === '') continue;
        const numbers = vlq(segment);
        if (numbers.length === 0) continue;
        generated += numbers[0] ?? 0;
        if (numbers.length < 4) continue;
        file += numbers[1] ?? 0;
        at += numbers[2] ?? 0;
        start += numbers[3] ?? 0;
        if (row !== line - 1) continue;
        const found = { file: sourceAt(map, file), line: at + 1, column: start + 1 };
        if (first === null) first = found;
        if (generated <= wanted) best = found;
      }
    }

    const found = best ?? first;
    return found === null || found.file === '' ? null : found;
  }

  /** The map a module carries, or the address of the one it points at. */
  function mapIn(text: string): { map: SourceMap | null; url: string | null } {
    let last: string | null = null;
    MAP_COMMENT.lastIndex = 0;
    let found = MAP_COMMENT.exec(text);
    while (found !== null) {
      last = found[1] ?? null;
      found = MAP_COMMENT.exec(text);
    }
    if (last === null) return { map: null, url: null };

    const inline = DATA_MAP.exec(last);
    if (inline === null) return { map: null, url: last };
    try {
      const body = inline[2] ?? '';
      const json = inline[1] === undefined ? decodeURIComponent(body) : atob(body);
      return { map: JSON.parse(json) as SourceMap, url: null };
    } catch {
      return { map: null, url: null };
    }
  }

  function numberFrom(text: string | undefined): number | null {
    const value = Number(text);
    return text !== undefined && text !== '' && Number.isFinite(value) ? value : null;
  }

  /** `src/App.tsx:12:9`, taken from the right so a Windows drive letter and a
   *  URL scheme both survive. */
  function splitStamp(text: string): { file: string; line: number; column?: number } | null {
    const parts = String(text ?? '').split(':');
    if (parts.length < 2) return null;
    const column = numberFrom(parts[parts.length - 1]);
    const line = numberFrom(parts[parts.length - 2]);
    if (line !== null && column !== null) {
      return { file: plainPath(parts.slice(0, -2).join(':')), line, column };
    }
    if (column !== null) return { file: plainPath(parts.slice(0, -1).join(':')), line: column };
    return null;
  }

  /** What a build tool stamped on an element, if any of them did. */
  function stampIn(attributes: Readonly<Record<string, string>>): Trace | null {
    const component =
      attributes['data-graphe-name'] ??
      attributes['data-inspector-name'] ??
      attributes['data-lov-name'] ??
      attributes['data-component-name'];

    for (const stamp of STAMPS) {
      const raw = attributes[stamp.file];
      if (raw === undefined || raw === '') continue;

      const line = stamp.line === undefined ? null : numberFrom(attributes[stamp.line]);
      if (line !== null) {
        const column = stamp.column === undefined ? null : numberFrom(attributes[stamp.column]);
        const trace: Trace = { how: 'stamp', file: plainPath(raw), line };
        if (column !== null) trace.column = column;
        if (component !== undefined) trace.component = component;
        return trace;
      }

      const split = splitStamp(raw);
      if (split === null) continue;
      const trace: Trace = { how: 'stamp', file: split.file, line: split.line };
      if (split.column !== undefined) trace.column = split.column;
      if (component !== undefined) trace.component = component;
      return trace;
    }

    if (component !== undefined && component !== '') return { how: 'owner', component };
    return null;
  }

  /** A component's name off whatever React hung on the fiber — a function, a
   *  memo, a forwardRef. Host elements have no name worth saying. */
  function nameOfType(type: unknown, depth = 0): string | null {
    if (type === null || type === undefined || depth > 3) return null;
    if (typeof type === 'string') return null;
    const holder = type as { displayName?: string; name?: string; render?: unknown; type?: unknown };
    if (typeof holder.displayName === 'string' && holder.displayName !== '') {
      return holder.displayName;
    }
    if (typeof type === 'function') {
      return typeof holder.name === 'string' && holder.name !== '' ? holder.name : null;
    }
    return nameOfType(holder.render, depth + 1) ?? nameOfType(holder.type, depth + 1);
  }

  /** Something a person wrote, rather than a minifier. */
  function looksNamed(name: string | null): boolean {
    return name !== null && /^[A-Z][A-Za-z0-9_$.]*$/.test(name) && name.length > 1;
  }

  return {
    plainPath,
    vlq,
    ownerStack,
    framesFrom,
    originIn,
    mapIn,
    stampIn,
    nameOfType,
    looksNamed,
  };
}

const TRACE = tracing();

/** A path an editor can open: no scheme, no host, no build-tool query. */
export function plainPath(text: string): string {
  return TRACE.plainPath(text);
}

/** The frames somebody's own code wrote, cut the way React cuts them. Empty
 *  when the sentinel is missing, because then the stack is not ours to read. */
export function ownerStack(stack: string): string {
  return TRACE.ownerStack(stack);
}

/** A stack, as lines somebody can act on. */
export function framesFrom(stack: string): readonly Frame[] {
  return TRACE.framesFrom(stack);
}

/** Where a generated position came from, per a source map. */
export function originIn(map: SourceMap, line: number, column: number): Origin | null {
  return TRACE.originIn(map, line, column);
}

/** The map a module carries inline, or the address of the one beside it. */
export function mapIn(text: string): { map: SourceMap | null; url: string | null } {
  return TRACE.mapIn(text);
}

/** What a build tool stamped on an element, in the three shapes anybody uses. */
export function stampIn(attributes: Readonly<Record<string, string>>): Trace | null {
  return TRACE.stampIn(attributes);
}

/** The same click, as code somebody can paste. Null when the click did not
 *  bring the element along with it. */
export function copyOf(pointed: Pointed, options: TidyOptions = {}): Copyable | null {
  const source = pointed.source;
  if (source === undefined) return null;
  return copyable({ html: source.html, styles: source.styles }, options);
}

/* -------------------------------------------------------------------------- */
/* The script that runs on their page                                          */
/* -------------------------------------------------------------------------- */

/** Where the page hands a click back. The server owns this path; it is never a
 *  file, so it can never be one. */
export const POINT_PATH = '/__graphe/point';

/** The attributes a stamp could be hiding in, read off the element itself. */
export const STAMP_ATTRIBUTES: readonly string[] = [
  'data-graphe-source',
  'data-graphe-name',
  'data-inspector-relative-path',
  'data-inspector-line',
  'data-inspector-column',
  'data-inspector-name',
  'data-lov-id',
  'data-lov-name',
  'data-component-name',
];

/** How long a click waits for a source map before reporting what it has. Long
 *  enough for a file off a dev server, short enough not to feel like a lag. */
const TRACE_WAIT = 700;

/** As many custom properties as are worth carrying. Every one on `:root` is in
 *  scope on every element, so a real design system fits and a generated one is
 *  cut off rather than allowed to become the message. */
const MOST_VARS = 240;

/** What the POST back can hold, under the server's own limit. A message has no
 *  limit and carries the whole reading. */
export const POINTED_BUDGET = 7 * 1024;

/** Tells us a document has already been given the script. */
export const POINTER_MARK = 'data-graphe="pointer"';

function pointerScript(): string {
  return `(function () {
  if (window.__graphePointer) return;

  var G = (${String(judgement)})();
  var T = (${String(tracing)})();
  var WORTH = ${JSON.stringify(WORTH_COPYING)};
  var STAMPED = ${JSON.stringify(STAMP_ATTRIBUTES)};
  var WAIT = ${TRACE_WAIT};
  var BUDGET = ${POINTED_BUDGET};
  var ACCENT = '${ACCENT}';
  var ASK = '${ASK}';
  var PICKING = '${PICKING}';
  var TOOK = '${TOOK}';
  var WRITE = '${WRITE}';
  var SEND = '${SEND}';
  var SAID_MAX = ${SAID_MAX};
  var noting = null;
  var pins = 0;
  var live = false;
  var box = null;
  var chip = null;
  var over = null;
  var launcher = null;
  var wasCursor = '';

  function nthOf(el) {
    var n = 1;
    var sibling = el.previousElementSibling;
    while (sibling) {
      if (sibling.tagName === el.tagName) n++;
      sibling = sibling.previousElementSibling;
    }
    return n;
  }

  function factsOf(el) {
    var first = null, last = null, at = el, up = 0;
    while (at && at.nodeType === 1 && up <= 6) {
      var node = {
        tagName: at.tagName,
        classList: Array.prototype.slice.call(at.classList || []),
        nth: nthOf(at),
        parent: null
      };
      if (at.id) node.id = at.id;
      if (last) last.parent = node; else first = node;
      last = node;
      at = at.parentElement;
      up++;
    }
    return first;
  }

  function attr(el, name) {
    var value = el.getAttribute ? el.getAttribute(name) : null;
    return value ? value : undefined;
  }

  function wordsOf(el) {
    var text = (el.innerText || el.textContent || '').trim();
    return {
      tagName: el.tagName,
      role: attr(el, 'role'),
      text: text.length > 0 && text.length <= G.limits.ownText ? text : undefined,
      ariaLabel: attr(el, 'aria-label'),
      alt: attr(el, 'alt'),
      title: attr(el, 'title'),
      value: typeof el.value === 'string' && el.value ? el.value : undefined,
      placeholder: attr(el, 'placeholder')
    };
  }

  /* The element as it stands, for putting on somebody's clipboard. Only the
     values worth carrying across are read; everything a browser resolves is
     hundreds of properties and unreadable pasted. */
  function materialOf(el) {
    var styles = {};
    var vars = {};
    var any = false;
    try {
      var resolved = window.getComputedStyle ? window.getComputedStyle(el) : null;
      if (resolved) {
        for (var i = 0; i < WORTH.length; i++) {
          var value = resolved.getPropertyValue(WORTH[i]);
          if (value) styles[WORTH[i]] = String(value).trim();
        }
        /* The project's own values as the page resolves them. Reading them here
           means an inspector can name a token on a page we never built. */
        var kept = 0;
        for (var n = 0; n < resolved.length && kept < ${MOST_VARS}; n++) {
          var name = resolved[n];
          if (!name || name.indexOf('--') !== 0) continue;
          var own = resolved.getPropertyValue(name);
          if (!own) continue;
          vars[name] = String(own).trim();
          kept++;
          any = true;
        }
      }
    } catch (e) {}
    var material = { html: el.outerHTML || '', styles: styles };
    if (any) material.vars = vars;
    return material;
  }

  /* ---------------------------------------------------------------- origin */

  function fiberOf(el) {
    try {
      var keys = Object.keys(el);
      for (var i = 0; i < keys.length; i++) {
        if (/^__reactFiber\\$/.test(keys[i])) return el[keys[i]];
      }
    } catch (e) {}
    return null;
  }

  /* Who wrote the JSX, preferred over who happens to be rendering it. */
  function ownerOf(fiber) {
    var at = fiber;
    var up = 0;
    while (at && up < 12) {
      var name = T.nameOfType(at.type);
      if (up > 0 && T.looksNamed(name)) return name;
      at = at._debugOwner || at.return;
      up++;
    }
    return null;
  }

  function stampOn(el) {
    var at = el;
    var up = 0;
    while (at && at.nodeType === 1 && up < 4) {
      var attributes = {};
      var found = false;
      for (var i = 0; i < STAMPED.length; i++) {
        var value = at.getAttribute ? at.getAttribute(STAMPED[i]) : null;
        if (value) { attributes[STAMPED[i]] = value; found = true; }
      }
      if (found) {
        var trace = T.stampIn(attributes);
        if (trace) return trace;
      }
      at = at.parentElement;
      up++;
    }
    return null;
  }

  var maps = {};

  function mapFor(url) {
    if (maps[url]) return maps[url];
    maps[url] = new Promise(function (done) {
      if (!window.fetch) { done(null); return; }
      window.fetch(url, { credentials: 'omit', cache: 'force-cache' })
        .then(function (reply) { return reply.ok ? reply.text() : ''; })
        .then(function (text) {
          var found = T.mapIn(text);
          if (found.map) { done(found.map); return; }
          if (!found.url) { done(null); return; }
          var beside = new URL(found.url, url).href;
          return window.fetch(beside, { credentials: 'omit', cache: 'force-cache' })
            .then(function (reply) { return reply.ok ? reply.json() : null; })
            .then(done);
        })
        .catch(function () { done(null); });
    });
    return maps[url];
  }

  /* The first frame of the owner stack, put back into the designer's own file
     where the module carries a map to do it with. */
  function fromStack(fiber) {
    var stack = fiber && fiber._debugStack;
    var text = stack && typeof stack === 'object' ? stack.stack : stack;
    var frames = T.framesFrom(T.ownerStack(text || ''));
    var frame = frames[0];
    if (!frame) return Promise.resolve(null);

    var flat = { how: 'stack', file: T.plainPath(frame.file), line: frame.line, column: frame.column, mapped: false };
    if (!/^https?:/i.test(frame.file)) return Promise.resolve(flat);

    return mapFor(frame.file).then(function (map) {
      if (!map) return flat;
      var origin = T.originIn(map, frame.line, frame.column);
      return origin
        ? { how: 'stack', file: origin.file, line: origin.line, column: origin.column, mapped: true }
        : flat;
    }).catch(function () { return flat; });
  }

  /* Every rung the page can reach, gathered at once. The last two never fail,
     which is why pointing at somebody else's site still answers. */
  function originOf(el, pointed) {
    var traces = [];
    var stamp = stampOn(el);
    if (stamp) traces.push(stamp);

    var fiber = fiberOf(el);
    var owner = fiber ? ownerOf(fiber) : null;
    if (owner) traces.push({ how: 'owner', component: owner });

    traces.push({ how: 'selector', selector: pointed.selector });
    var html = el.outerHTML || '';
    if (html) traces.push({ how: 'markup', html: html.length > 400 ? html.slice(0, 400) : html });
    var text = (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
    if (text && text.length <= 200) traces.push({ how: 'text', text: text });

    if (!fiber) return Promise.resolve(traces);
    var waited = new Promise(function (done) { setTimeout(function () { done(null); }, WAIT); });
    return Promise.race([fromStack(fiber), waited]).then(function (stack) {
      if (stack) traces.push(stack);
      return traces;
    }).catch(function () { return traces; });
  }

  function pointedFrom(el, whole) {
    var facts = factsOf(el);
    var words = wordsOf(el);
    var r = el.getBoundingClientRect();
    var kin = el.parentElement
      ? Array.prototype.filter.call(el.parentElement.children, function (one) {
          return one.tagName === el.tagName;
        })
      : [el];
    var place = { nth: Array.prototype.indexOf.call(kin, el) + 1, of: kin.length };
    var within = facts ? G.whereIn(facts) : null;
    if (within) place.within = within;
    var pointed = {
      selector: facts ? G.stableSelector(facts) : el.tagName.toLowerCase(),
      label: G.labelFor(words),
      kind: G.kindOf(words),
      rect: {
        x: Math.round(r.left + (window.scrollX || 0)),
        y: Math.round(r.top + (window.scrollY || 0)),
        width: Math.round(r.width),
        height: Math.round(r.height)
      },
      place: place
    };
    if (whole) {
      pointed.source = materialOf(el);
      pointed.view = {
        width: window.innerWidth || document.documentElement.clientWidth || 0,
        height: window.innerHeight || document.documentElement.clientHeight || 0
      };
    }
    return pointed;
  }

  function frame() {
    if (box) return box;
    box = document.createElement('div');
    box.setAttribute('data-graphe', 'pointer');
    box.style.cssText =
      'position:fixed;z-index:2147483646;pointer-events:none;box-sizing:border-box;' +
      'border:2px solid ' + ACCENT + ';border-radius:3px;background:rgba(184,73,44,0.07);' +
      'transition:left 70ms ease-out,top 70ms ease-out,width 70ms ease-out,height 70ms ease-out;';
    chip = document.createElement('div');
    chip.setAttribute('data-graphe', 'label');
    chip.style.cssText =
      'position:absolute;left:-2px;top:-23px;max-width:24rem;overflow:hidden;' +
      'text-overflow:ellipsis;white-space:nowrap;padding:2px 7px;border-radius:3px;' +
      'background:' + ACCENT + ';color:#fff;' +
      'font:500 11px/1.6 ui-sans-serif,system-ui,-apple-system,sans-serif;';
    box.appendChild(chip);
    (document.body || document.documentElement).appendChild(box);
    return box;
  }

  function draw(el) {
    var r = el.getBoundingClientRect();
    var shown = frame();
    shown.style.left = r.left + 'px';
    shown.style.top = r.top + 'px';
    shown.style.width = r.width + 'px';
    shown.style.height = r.height + 'px';
    chip.textContent = G.describePointed(pointedFrom(el));
  }

  function ours(el) {
    if (box !== null && (el === box || box.contains(el))) return true;
    if (noting !== null && (el === noting || noting.contains(el))) return true;
    return launcher !== null && (el === launcher || launcher.contains(el));
  }

  /* The way in. A button in the app beside an identical one taught nobody what
     pointing was; the control belongs on the page it acts on. */
  function mount() {
    if (launcher) return;
    launcher = document.createElement('button');
    launcher.type = 'button';
    launcher.setAttribute('data-graphe', 'launcher');
    launcher.textContent = ASK;
    launcher.style.cssText =
      'position:fixed;right:16px;bottom:16px;z-index:2147483647;border:0;cursor:pointer;' +
      'padding:9px 14px;border-radius:999px;background:' + ACCENT + ';color:#fff;' +
      'box-shadow:0 2px 10px rgba(0,0,0,0.22);opacity:0.92;' +
      'font:500 12px/1.2 ui-sans-serif,system-ui,-apple-system,sans-serif;';
    launcher.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      if (live) stop(); else start();
    });
    (document.body || document.documentElement).appendChild(launcher);
  }

  function moved(event) {
    var el = event.target;
    if (!el || el.nodeType !== 1 || ours(el) || el === over) return;
    over = el;
    draw(el);
  }

  function redraw() {
    if (over && over.isConnected !== false) draw(over);
  }

  function swallow(event) {
    event.preventDefault();
    event.stopPropagation();
    if (event.stopImmediatePropagation) event.stopImmediatePropagation();
  }

  /* Our own controls stay clickable while pointing is live — swallowing their
     presses at the capture phase would leave no way to switch it back off. */
  function block(event) {
    if (ours(event.target)) return;
    swallow(event);
  }

  /* The highlight comes off at once and the report follows: working out where
     an element was written can need a file fetched, and nobody should watch a
     cursor sit on a page while that happens. */
  function clicked(event) {
    var el = event.target;
    if (!el || el.nodeType !== 1 || ours(el)) return;
    swallow(event);
    var pointed = pointedFrom(el, true);
    var at = { x: event.clientX, y: event.clientY };
    stop();
    // The source map takes a moment. Ask for it now so it is ready by the time
    // anybody has finished typing, and open the box straight away either way.
    var found = originOf(el, pointed).then(function (traces) {
      if (traces && traces.length) pointed.origin = traces;
      return pointed;
    }, function () { return pointed; });
    note(pointed, at, found);
  }

  /* A note, written where it is about.
     
     The alternative was putting what was clicked into the message box and
     leaving somebody to describe the rest — which meant looking away from the
     thing they were looking at, and reading a paragraph of measurements to find
     out we already knew which button they meant. A box on the spot asks the only
     question worth asking, and what was clicked travels with the answer. */
  function note(pointed, at, found) {
    closeNote();
    var pin = document.createElement('div');
    pin.setAttribute('data-graphe', 'note');
    var left = Math.min(Math.max(at.x, 12), window.innerWidth - 292);
    var top = Math.min(at.y + 12, window.innerHeight - 150);
    pin.style.cssText =
      'position:fixed;left:' + left + 'px;top:' + top + 'px;z-index:2147483647;' +
      'width:280px;box-sizing:border-box;padding:10px;border-radius:10px;' +
      'background:#fff;color:#1a1a19;box-shadow:0 8px 30px rgba(0,0,0,0.28);' +
      'font:400 13px/1.45 ui-sans-serif,system-ui,-apple-system,sans-serif;';

    var what = document.createElement('div');
    what.setAttribute('data-graphe', 'note-what');
    what.textContent = G.describePointed(pointed);
    what.style.cssText =
      'font-size:11px;color:#6e6e68;margin-bottom:7px;overflow:hidden;' +
      'text-overflow:ellipsis;white-space:nowrap;';

    var box = document.createElement('textarea');
    box.setAttribute('data-graphe', 'note-box');
    box.placeholder = WRITE;
    box.rows = 2;
    box.maxLength = SAID_MAX;
    box.style.cssText =
      'width:100%;box-sizing:border-box;resize:none;border:1px solid #e4e4e1;' +
      'border-radius:7px;padding:7px 8px;font:inherit;color:inherit;outline:none;';
    box.addEventListener('focus', function () { box.style.borderColor = ACCENT; });
    box.addEventListener('blur', function () { box.style.borderColor = '#e4e4e1'; });

    var go = document.createElement('button');
    go.setAttribute('data-graphe', 'note-send');
    go.type = 'button';
    go.textContent = SEND;
    go.style.cssText =
      'margin-top:7px;float:right;border:0;cursor:pointer;padding:6px 13px;' +
      'border-radius:7px;background:' + ACCENT + ';color:#fff;font:500 12px/1.2 inherit;';

    var send_ = function () {
      var said = (box.value || '').trim();
      if (said === '') { box.focus(); return; }
      closeNote();
      leaveMark(at);
      took();
      found.then(function (ready) {
        ready.said = said;
        send(ready);
      });
    };

    go.addEventListener('click', function (event) { swallow(event); send_(); });
    box.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') { swallow(event); closeNote(); return; }
      if (event.key === 'Enter' && !event.shiftKey) { swallow(event); send_(); }
    });

    pin.appendChild(what);
    pin.appendChild(box);
    pin.appendChild(go);
    (document.body || document.documentElement).appendChild(pin);
    noting = pin;
    box.focus();
  }

  function closeNote() {
    if (!noting) return;
    if (noting.parentNode) noting.parentNode.removeChild(noting);
    noting = null;
  }

  /** What is left behind: a small numbered mark, so a page somebody has walked
   *  over shows where they have already said something. */
  function leaveMark(at) {
    pins += 1;
    var mark = document.createElement('div');
    mark.setAttribute('data-graphe', 'mark');
    mark.textContent = String(pins);
    mark.style.cssText =
      'position:fixed;left:' + (at.x - 11) + 'px;top:' + (at.y - 11) + 'px;' +
      'z-index:2147483646;width:22px;height:22px;border-radius:50% 50% 50% 2px;' +
      'display:flex;align-items:center;justify-content:center;pointer-events:none;' +
      'background:' + ACCENT + ';color:#fff;box-shadow:0 2px 8px rgba(0,0,0,0.3);' +
      'font:600 11px/1 ui-sans-serif,system-ui,-apple-system,sans-serif;';
    (document.body || document.documentElement).appendChild(mark);
  }

  /** Say it landed, then go back to offering. The message box is in the window
   *  behind this page, and something that answers with nothing visible reads as
   *  a button that did not work. */
  function took() {
    if (!launcher) return;
    launcher.textContent = TOOK;
    setTimeout(function () {
      if (launcher && !live) launcher.textContent = ASK;
    }, 1800);
  }

  function key(event) {
    if (event.key === 'Escape') { swallow(event); stop(); closeNote(); }
  }

  /* The POST back has a small body limit and a message does not. A click that
     answers nothing because it was too big is worse than one that answers less,
     so the least valuable parts are shed until it fits. */
  function fitted(pointed) {
    var body = JSON.stringify(pointed);
    if (body.length <= BUDGET) return body;
    var trimmed = JSON.parse(body);
    var steps = [
      function () { if (trimmed.source) delete trimmed.source.vars; },
      function () {
        if (trimmed.origin) {
          trimmed.origin = trimmed.origin.filter(function (one) { return one.how !== 'markup'; });
        }
      },
      function () { if (trimmed.source) trimmed.source.html = ''; },
      function () { if (trimmed.source) trimmed.source.styles = {}; }
    ];
    for (var i = 0; i < steps.length; i++) {
      steps[i]();
      body = JSON.stringify(trimmed);
      if (body.length <= BUDGET) break;
    }
    return body;
  }

  function send(pointed) {
    var note = { graphe: 'pointed', pointed: pointed };
    try { window.postMessage(note, '*'); } catch (e) {}
    var up = window.opener || (window.parent !== window ? window.parent : null);
    if (up) { try { up.postMessage(note, '*'); } catch (e) {} }
    try {
      if (window.fetch) {
        window.fetch('${POINT_PATH}', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: fitted(pointed),
          keepalive: true,
          credentials: 'omit',
          cache: 'no-store'
        }).catch(function () {});
      }
    } catch (e) {}
  }

  function start() {
    if (live) return;
    live = true;
    mount();
    if (launcher) launcher.textContent = PICKING;
    wasCursor = document.documentElement.style.cursor;
    document.documentElement.style.cursor = 'crosshair';
    document.addEventListener('mousemove', moved, true);
    document.addEventListener('mousedown', block, true);
    document.addEventListener('pointerdown', block, true);
    document.addEventListener('click', clicked, true);
    document.addEventListener('keydown', key, true);
    window.addEventListener('scroll', redraw, true);
    window.addEventListener('resize', redraw, true);
  }

  function stop() {
    if (!live) return;
    live = false;
    if (launcher) launcher.textContent = ASK;
    document.documentElement.style.cursor = wasCursor;
    document.removeEventListener('mousemove', moved, true);
    document.removeEventListener('mousedown', block, true);
    document.removeEventListener('pointerdown', block, true);
    document.removeEventListener('click', clicked, true);
    document.removeEventListener('keydown', key, true);
    window.removeEventListener('scroll', redraw, true);
    window.removeEventListener('resize', redraw, true);
    if (box && box.parentNode) box.parentNode.removeChild(box);
    box = null;
    chip = null;
    over = null;
  }

  window.addEventListener('message', function (event) {
    var data = event.data;
    if (!data || typeof data !== 'object' || data.graphe !== 'point') return;
    if (data.on === false) stop(); else start();
  });
  window.addEventListener('pagehide', stop);
  /** Take the whole overlay off: any note being written, and every mark left
   *  behind. Called when the work a note asked for has been done — a pin that
   *  outlives what it asked about is a page covered in old questions. */
  function clear() {
    stop();
    closeNote();
    pins = 0;
    var marks = document.querySelectorAll('[data-graphe="mark"]');
    for (var i = 0; i < marks.length; i++) {
      if (marks[i].parentNode) marks[i].parentNode.removeChild(marks[i]);
    }
  }

  window.__graphePointer = { start: start, stop: stop, clear: clear };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }

  // The preview opens in the designer's own browser, where nothing can post a
  // message in. Asking for it in the address is the other way to switch it on.
  if (/(^|[#&])graphe-point(&|$)/.test(window.location.hash)) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', start);
    } else {
      start();
    }
  }
})();`;
}

/** Inert on arrival. It highlights what the cursor is over, and reports the one
 *  element that gets clicked, only once something switches it on. */
export const POINTER_SCRIPT: string = pointerScript();

/* -------------------------------------------------------------------------- */
/* Putting it in a page                                                        */
/* -------------------------------------------------------------------------- */

/** Element contents that are text rather than markup. A `</body>` written
 *  inside one closes nothing. */
const OPAQUE: readonly string[] = ['script', 'style', 'textarea', 'title'];

function closes(after: string | undefined): boolean {
  return after === '>' || after === ' ' || after === '\t' || after === '\n' || after === '\r';
}

/**
 * Where the document's real `</body>` starts, or -1.
 *
 * Scanned rather than searched: half the pages a designer builds carry the
 * string inside a script, and injecting there would put our code in the middle
 * of theirs.
 */
function bodyEndsAt(html: string): number {
  const lower = html.toLowerCase();
  let at = 0;
  let found = -1;

  while (at < lower.length) {
    const angle = lower.indexOf('<', at);
    if (angle === -1) break;

    if (lower.startsWith('<!--', angle)) {
      const end = lower.indexOf('-->', angle + 4);
      at = end === -1 ? lower.length : end + 3;
      continue;
    }

    const opaque = OPAQUE.find(
      (tag) => lower.startsWith(`<${tag}`, angle) && closes(lower[angle + 1 + tag.length]),
    );
    if (opaque !== undefined) {
      const end = lower.indexOf(`</${opaque}`, angle);
      at = end === -1 ? lower.length : end + opaque.length + 2;
      continue;
    }

    if (lower.startsWith('</body', angle) && closes(lower[angle + 6])) found = angle;
    at = angle + 1;
  }

  return found;
}

/**
 * Give a document the pointer script, without disturbing anything in it.
 *
 * Before `</body>` where there is one, appended where there is not — a fragment
 * or a hand-written page with no body tag is still a page somebody is looking
 * at. Injecting twice adds it once.
 */
export function injectPointer(html: string): string {
  if (html.includes(POINTER_MARK)) return html;

  const block = `\n<script ${POINTER_MARK}>\n${POINTER_SCRIPT}\n</script>\n`;
  const at = bodyEndsAt(html);
  return at === -1 ? html + block : html.slice(0, at) + block + html.slice(at);
}
