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
};

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

/** On the page itself, where the thing being pointed at is. */
const ASK = 'Point at something';
const PICKING = 'Click anything · Esc to stop';

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

/** Tells us a document has already been given the script. */
export const POINTER_MARK = 'data-graphe="pointer"';

function pointerScript(): string {
  return `(function () {
  if (window.__graphePointer) return;

  var G = (${String(judgement)})();
  var WORTH = ${JSON.stringify(WORTH_COPYING)};
  var ACCENT = '${ACCENT}';
  var ASK = '${ASK}';
  var PICKING = '${PICKING}';
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
    try {
      var resolved = window.getComputedStyle ? window.getComputedStyle(el) : null;
      if (resolved) {
        for (var i = 0; i < WORTH.length; i++) {
          var value = resolved.getPropertyValue(WORTH[i]);
          if (value) styles[WORTH[i]] = String(value).trim();
        }
      }
    } catch (e) {}
    return { html: el.outerHTML || '', styles: styles };
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
    if (whole) pointed.source = materialOf(el);
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

  function clicked(event) {
    var el = event.target;
    if (!el || el.nodeType !== 1 || ours(el)) return;
    swallow(event);
    send(pointedFrom(el, true));
    stop();
  }

  function key(event) {
    if (event.key === 'Escape') { swallow(event); stop(); }
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
          body: JSON.stringify(pointed),
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
  window.__graphePointer = { start: start, stop: stop };

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
