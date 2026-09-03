/** Watching somebody use their own page.
 *
 * The judgement — what counts as a state worth a picture, and what to call the
 * thing it happened to — is one closed function, and the browser script is
 * built from that function's own source. What the page decides and what the
 * tests assert cannot drift apart.
 *
 * Nothing here touches Electron, the disk or a socket. The script is handed to
 * whichever view is showing the page; how it gets there is somebody else's job.
 */

import { isDid, type Did, type Doing } from './flow';

/** An element, flattened, so naming it can be judged without a browser. */
export type Named = {
  tagName: string;
  /** An input's type, lowercased. */
  type?: string | null;
  role?: string | null;
  /** Its own words, or the words of the label pointing at it. */
  text?: string | null;
  ariaLabel?: string | null;
  title?: string | null;
  alt?: string | null;
  placeholder?: string | null;
  name?: string | null;
};

/** What came back from one poll of the page. */
export type Drained = {
  doings: readonly Doing[];
  /** States the page saw and had to throw away before we asked. */
  missed: number;
  /** The page is not carrying the script any more — it has been reloaded, or
   *  moved on to another page, and needs giving it again. */
  gone: boolean;
};

/* -------------------------------------------------------------------------- */
/* The judgement                                                               */
/* -------------------------------------------------------------------------- */

/**
 * One function rather than several, because the script is its own source:
 * anything it reached for outside itself would have to be shipped separately
 * and could then be shipped differently.
 */
function judgement() {
  /** A name longer than this is the page's prose, not a label. */
  const NAME_MAX = 60;

  /** Things a cursor resting on them means something. */
  const TOUCHABLE: readonly string[] = [
    'a',
    'button',
    'input',
    'label',
    'select',
    'summary',
    'textarea',
  ];

  /** Types that are a choice rather than something typed into. */
  const CHOSEN: readonly string[] = ['checkbox', 'radio', 'range', 'color', 'file'];

  function tidy(text: string | null | undefined): string {
    const one = (text ?? '').replace(/\s+/g, ' ').trim();
    return one.length <= NAME_MAX ? one : `${one.slice(0, NAME_MAX - 1).trimEnd()}…`;
  }

  /**
   * What to call it, in the order somebody would read it.
   *
   * The label a screen reader would say comes first, because an icon button
   * with no words has one and nothing else, and because it is the name the page
   * itself has chosen for that control.
   */
  function nameOf(el: Named): string {
    const tag = (el.tagName ?? '').toLowerCase();
    const ordered: (string | null | undefined)[] =
      tag === 'img'
        ? [el.alt, el.ariaLabel, el.title]
        : [el.ariaLabel, el.text, el.placeholder, el.title, el.alt, el.name];
    for (const one of ordered) {
      const said = tidy(one);
      if (said !== '') return said;
    }
    return '';
  }

  /** Whether a cursor coming to rest on this is worth a picture. */
  function worthHovering(el: Named): boolean {
    const tag = (el.tagName ?? '').toLowerCase();
    const role = (el.role ?? '').toLowerCase();
    if (TOUCHABLE.includes(tag)) return true;
    return role === 'button' || role === 'link' || role === 'tab' || role === 'menuitem';
  }

  /** What happened, in the words a frame is written in. Null for an event that
   *  is not a state anybody would ask to see. */
  function didFor(event: string, el: Named): Did | null {
    const tag = (el.tagName ?? '').toLowerCase();
    const type = (el.type ?? '').toLowerCase();
    const choosing = tag === 'select' || (tag === 'input' && CHOSEN.includes(type));

    if (event === 'click' || event === 'press') return choosing ? 'chose' : 'pressed';
    if (event === 'input' || event === 'change') return choosing ? 'chose' : 'typed';
    if (event === 'submit') return 'sent';
    if (event === 'focusin' || event === 'focus') return 'focused';
    if (event === 'hover') return worthHovering(el) ? 'hovered' : null;
    if (event === 'scroll') return 'scrolled';
    if (event === 'opened') return 'opened';
    if (event === 'went') return 'went';
    if (event === 'mutated') return 'changed';
    return null;
  }

  return { limits: { name: NAME_MAX }, nameOf, worthHovering, didFor };
}

const PURE = judgement();

/** What to call an element, in the page's own words. */
export function nameOf(el: Named): string {
  return PURE.nameOf(el);
}

/** Whether a cursor resting on this is a state worth photographing. */
export function worthHovering(el: Named): boolean {
  return PURE.worthHovering(el);
}

/** What an event on an element means, or null when it means nothing. */
export function didFor(event: string, el: Named): Did | null {
  return PURE.didFor(event, el);
}

/* -------------------------------------------------------------------------- */
/* Reading what the page hands back                                            */
/* -------------------------------------------------------------------------- */

function readDoing(raw: unknown): Doing | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const one = raw as Record<string, unknown>;
  if (!isDid(one['did'])) return null;
  const at = one['at'];
  const what = one['what'];
  return {
    did: one['did'],
    what: typeof what === 'string' ? what : null,
    at: typeof at === 'number' && Number.isFinite(at) ? at : Date.now(),
  };
}

/**
 * One poll's worth, from whatever the page actually returned.
 *
 * Anything unrecognisable is dropped rather than guessed at — a frame labelled
 * with something we invented is worse than a frame that never existed.
 */
export function readDrained(raw: unknown): Drained {
  // Nothing readable at all is a page that cannot answer, which is the same
  // thing as a page that has lost the script.
  if (typeof raw !== 'object' || raw === null) return { doings: [], missed: 0, gone: true };
  const bag = raw as Record<string, unknown>;
  const list = Array.isArray(bag['doings']) ? (bag['doings'] as unknown[]) : [];
  const missed = bag['missed'];
  return {
    doings: list.map(readDoing).filter((one): one is Doing => one !== null),
    missed: typeof missed === 'number' && Number.isFinite(missed) && missed > 0 ? missed : 0,
    gone: bag['gone'] === true,
  };
}

/* -------------------------------------------------------------------------- */
/* The script that runs on their page                                          */
/* -------------------------------------------------------------------------- */

/** How long a cursor has to rest before resting on something is a state. */
const DWELL = 500;
/** A press is photographed for what it did, so reporting waits a beat for the
 *  page to do it. */
const RESPOND = 220;
/** Typing and scrolling report once, after they go quiet. */
const QUIET = 400;
/** Changes that arrive this soon after something somebody did are what that
 *  press did, not a state of their own. */
const OWED = 700;
/** More than a poll could ever be behind by. Past it, states are counted rather
 *  than kept, so the count can be said out loud. */
const HOLD = 200;

function watchingScript(): string {
  return `(function () {
  if (window.__grapheWatching) return;

  var W = (${String(judgement)})();
  var DWELL = ${String(DWELL)};
  var RESPOND = ${String(RESPOND)};
  var QUIET = ${String(QUIET)};
  var OWED = ${String(OWED)};
  var HOLD = ${String(HOLD)};

  var buffer = [];
  var missed = 0;
  var live = false;
  var reportedAt = 0;
  var pressedAt = 0;
  var pressed = null;
  var timers = { typed: 0, scrolled: 0, mutated: 0, hover: 0 };
  var hovering = null;
  var watcher = null;

  /* Never our own furniture. The preview carries controls of ours, and a
     recording of somebody's work must not be a recording of our buttons. */
  function ours(el) {
    var at = el;
    while (at && at.nodeType === 1) {
      if (at.hasAttribute && at.hasAttribute('data-graphe')) return true;
      at = at.parentElement;
    }
    return false;
  }

  function labelText(el) {
    try {
      var labels = el.labels;
      if (labels && labels.length) return labels[0].textContent || '';
    } catch (e) {}
    return '';
  }

  function factsOf(el) {
    if (!el || el.nodeType !== 1) return { tagName: '' };
    var tag = el.tagName ? el.tagName.toLowerCase() : '';
    var own = tag === 'input' || tag === 'select' || tag === 'textarea'
      ? labelText(el)
      : (el.textContent || '');
    return {
      tagName: tag,
      type: el.getAttribute ? el.getAttribute('type') : null,
      role: el.getAttribute ? el.getAttribute('role') : null,
      text: own,
      ariaLabel: el.getAttribute ? el.getAttribute('aria-label') : null,
      title: el.getAttribute ? el.getAttribute('title') : null,
      alt: el.getAttribute ? el.getAttribute('alt') : null,
      placeholder: el.getAttribute ? el.getAttribute('placeholder') : null,
      name: el.getAttribute ? el.getAttribute('name') : null
    };
  }

  function push(did, what) {
    if (!live || !did) return;
    if (buffer.length >= HOLD) { missed++; return; }
    reportedAt = Date.now();
    buffer.push({ did: did, what: what || '', at: reportedAt });
  }

  function report(event, el) {
    var facts = factsOf(el);
    push(W.didFor(event, facts), W.nameOf(facts));
  }

  function nearest(el) {
    var at = el;
    while (at && at.nodeType === 1) {
      var tag = at.tagName ? at.tagName.toLowerCase() : '';
      var role = at.getAttribute ? (at.getAttribute('role') || '') : '';
      if (tag === 'a' || tag === 'button' || tag === 'summary' || tag === 'label' ||
          role === 'button' || role === 'link' || role === 'tab' || role === 'menuitem') {
        return at;
      }
      at = at.parentElement;
    }
    return el;
  }

  function onClick(event) {
    var el = event.target;
    if (!el || el.nodeType !== 1 || ours(el)) return;
    var subject = nearest(el);
    pressed = subject;
    pressedAt = Date.now();
    window.setTimeout(function () { report('click', subject); }, RESPOND);
  }

  function onFocus(event) {
    var el = event.target;
    if (!el || el.nodeType !== 1 || ours(el)) return;
    /* A press moves the focus. Saying both would be one action twice. */
    if (pressed === el && Date.now() - pressedAt < OWED) return;
    report('focusin', el);
  }

  function onInput(event) {
    var el = event.target;
    if (!el || el.nodeType !== 1 || ours(el)) return;
    window.clearTimeout(timers.typed);
    timers.typed = window.setTimeout(function () { report('input', el); }, QUIET);
  }

  function onChange(event) {
    var el = event.target;
    if (!el || el.nodeType !== 1 || ours(el)) return;
    window.clearTimeout(timers.typed);
    report('change', el);
  }

  function onSubmit(event) {
    var el = event.target;
    if (!el || el.nodeType !== 1 || ours(el)) return;
    report('submit', el);
  }

  function onScroll() {
    window.clearTimeout(timers.scrolled);
    timers.scrolled = window.setTimeout(function () {
      push('scrolled', '');
    }, QUIET);
  }

  /* A cursor crossing a nav bar is not six states. One that comes to rest on a
     control is somebody looking at what it does under the cursor. */
  function onOver(event) {
    var el = event.target;
    if (!el || el.nodeType !== 1 || ours(el)) return;
    var subject = nearest(el);
    if (subject === hovering) return;
    hovering = subject;
    window.clearTimeout(timers.hover);
    timers.hover = window.setTimeout(function () {
      if (hovering === subject) report('hover', subject);
    }, DWELL);
  }

  function onOut() {
    hovering = null;
    window.clearTimeout(timers.hover);
  }

  function onWent() {
    push('went', document.title || '');
  }

  function onMutation() {
    window.clearTimeout(timers.mutated);
    timers.mutated = window.setTimeout(function () {
      /* Something that happens on its own: a message, a spinner finishing, a
         panel arriving. Anything close behind a press is what that press did. */
      if (Date.now() - reportedAt < OWED) return;
      push('changed', '');
    }, QUIET);
  }

  function start() {
    if (live) return;
    live = true;
    push('opened', document.title || '');
    document.addEventListener('click', onClick, true);
    document.addEventListener('focusin', onFocus, true);
    document.addEventListener('input', onInput, true);
    document.addEventListener('change', onChange, true);
    document.addEventListener('submit', onSubmit, true);
    document.addEventListener('pointerover', onOver, true);
    document.addEventListener('pointerout', onOut, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('popstate', onWent);
    window.addEventListener('hashchange', onWent);
    try {
      watcher = new MutationObserver(onMutation);
      watcher.observe(document.documentElement, {
        childList: true, subtree: true, attributes: true, characterData: true
      });
    } catch (e) { watcher = null; }
  }

  function stop() {
    if (!live) return;
    live = false;
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('focusin', onFocus, true);
    document.removeEventListener('input', onInput, true);
    document.removeEventListener('change', onChange, true);
    document.removeEventListener('submit', onSubmit, true);
    document.removeEventListener('pointerover', onOver, true);
    document.removeEventListener('pointerout', onOut, true);
    window.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('popstate', onWent);
    window.removeEventListener('hashchange', onWent);
    window.clearTimeout(timers.typed);
    window.clearTimeout(timers.scrolled);
    window.clearTimeout(timers.mutated);
    window.clearTimeout(timers.hover);
    if (watcher) { watcher.disconnect(); watcher = null; }
  }

  function drain() {
    var out = { doings: buffer, missed: missed };
    buffer = [];
    missed = 0;
    return out;
  }

  window.addEventListener('pagehide', stop);
  window.__grapheWatching = { start: start, stop: stop, drain: drain };
})();`;
}

/** Inert on arrival: it reports nothing until something calls `start`. */
export const WATCHING_SCRIPT: string = watchingScript();

/** Switch it on, and take the first state with it. */
export const START_WATCHING = 'window.__grapheWatching && window.__grapheWatching.start()';

/** Everything seen since the last ask. A page that has never been given the
 *  script, or has been reloaded since, says so rather than looking idle. */
export const DRAIN_WATCHING =
  'window.__grapheWatching ? window.__grapheWatching.drain()' +
  ' : { doings: [], missed: 0, gone: true }';

export const STOP_WATCHING = 'window.__grapheWatching && window.__grapheWatching.stop()';
