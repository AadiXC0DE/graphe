// The visual and accessibility matrix from the stabilisation plan, run by a
// machine where a machine can run it.
//
//   node scripts/visual-matrix.mjs                  the packaged app in release/
//   node scripts/visual-matrix.mjs --built          the working tree's dist/
//   node scripts/visual-matrix.mjs --only=zoom      one row, by substring
//
// The plan asks for four window sizes, four zooms, three themes, long titles,
// twenty open conversations, keyboard-only navigation, reduced motion, the
// overlays, the file tree and the terminal, with a screenshot and a recorded
// result for each. This drives the real Electron app on a profile it throws
// away, as `scripts/packaged-smoke.mjs` does, and measures the window from
// inside it: every box that carries the work has to be inside the window, the
// composer has to be hittable, the tab in front has to be inside the strip, and
// nothing that should not scroll sideways may.
//
// The half of a screen reader that is a machine's is read too: the
// accessibility tree through the DevTools protocol, which is where the
// announcement comes from, and the media a person sets at the OS level
// (reduced motion, more contrast, forced colours, both colour schemes) through
// Playwright's emulation. What is left for a person is named at the end of the
// run rather than guessed at: the speech itself, a monitor being unplugged, the
// native file dialog, and whether a ratio that passes the arithmetic reads well.
//
// Nothing here is a substitute for a person at a screen. It is the half of the
// matrix that can be re-run on any commit.

import { execFileSync } from 'node:child_process';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import { _electron as electron } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));

/** How many conversations the plan asks to have open at once. */
const CONVERSATIONS = 20;

const args = process.argv.slice(2);
const has = (name) => args.includes(`--${name}`);
const valueOf = (name) => args.find((one) => one.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;

const built = has('built');
const keep = has('keep');
const only = valueOf('only');
/** The plan asks for twenty. A smaller row is for checking the harness itself
 *  without waiting for twenty turns. */
const conversations = Number(valueOf('conversations') ?? CONVERSATIONS);

/** A profile, a project and a run of screenshots, all thrown away afterwards
 *  unless --keep is passed. */
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const home = mkdtempSync(join(tmpdir(), 'graphe-visual-'));
const profile = join(home, 'profile');
const scratch = join(root, 'results', stamp);
const shots = join(scratch, 'visual-matrix');

/** The plan's three sizes as the window is sized — the same numbers
 *  `createWindow` uses, so 1100×780 is what the app opens at by itself. The
 *  fourth row is whatever this machine's display actually is, measured rather
 *  than assumed. */
const SIZES = [
  { id: '620x520', w: 620, h: 520, what: 'the smallest window the app allows' },
  { id: '800x600', w: 800, h: 600, what: 'a small laptop window' },
  { id: '1100x780', w: 1100, h: 780, what: 'the size the app opens at' },
];

const ZOOMS = [
  { id: 'zoom-100', factor: 1, what: 'the default' },
  { id: 'zoom-125', factor: 1.25, what: 'the first step the plan asks for' },
  { id: 'zoom-150', factor: 1.5, what: 'the second' },
  { id: 'zoom-200', factor: 2, what: 'twice the size' },
];

const THEMES = [
  { id: 'theme-light', choice: 'Light', mark: 'light', what: 'light' },
  { id: 'theme-dark', choice: 'Dark', mark: 'dark', what: 'dark' },
  { id: 'theme-system', choice: 'System', mark: null, what: 'following the computer' },
];

/** Every box that carries the work. Each one has to be inside the window at
 *  every size and zoom: a control half off the edge is a control somebody
 *  cannot press. */
const MUST_FIT = [
  'main.app',
  '.topbar',
  '.shelf',
  '.tabs',
  '.tabs__strip',
  '.composer',
  '.composer__input',
  '.composer__send',
  '.filespanel',
  '.files__tree',
];

/** Containers that must not scroll sideways. `.tabs__strip` is deliberately
 *  absent: a row of twenty tabs is meant to scroll. */
const NO_SIDEWAYS = ['main.app', '.topbar', '.composer', '.filespanel', '.files__tree', '.settings', '.palette'];

/** The text a person reads, and what it is read against. */
const CONTRAST = [
  { sel: '.welcome__title', what: 'the greeting over a project' },
  { sel: '.tabs__title', what: 'a conversation title' },
  { sel: '.composer__input', what: 'what you type' },
  { sel: '.shelf__rowname', what: 'a row in the sidebar' },
  { sel: '.files__row', what: 'a file in the tree' },
  { sel: '.thinking__label', what: 'which model answers' },
];

/* -------------------------------------------------------------------------- */
/* Saying what happened                                                        */
/* -------------------------------------------------------------------------- */

let current = null;
let failed = 0;
const results = [];

function ok(says) {
  if (current !== null) current.checks.push({ ok: true, says });
  console.log(`  ✓ ${says}`);
}
function bad(says) {
  if (current !== null) current.checks.push({ ok: false, says });
  failed += 1;
  console.log(`  ✗ ${says}`);
}
function note(says) {
  if (current !== null) current.notes.push(says);
  console.log(`  note: ${says}`);
}
function verdict(says, is) {
  if (is) ok(says);
  else bad(says);
}

async function row(id, what, run) {
  if (only !== null && !id.includes(only)) return;
  current = { id, what, checks: [], notes: [], shot: null, threw: null };
  results.push(current);
  console.log(`\n▸ ${id} — ${what}`);
  try {
    await run();
  } catch (cause) {
    current.threw = String(cause?.message ?? cause).split('\n').slice(0, 3).join(' | ');
    bad(`the row did not finish: ${current.threw}`);
  }
  if (current.shot !== null) console.log(`  shot: ${current.shot.slice(root.length)}`);
  current = null;
}

const pause = (ms) => new Promise((done) => setTimeout(done, ms));

/** Poll on the clock; everything the app does, it does while this waits. */
async function until(ready, within = 20_000, step = 100) {
  const stop = Date.now() + within;
  for (;;) {
    try {
      if (await ready()) return true;
    } catch {
      // A selector that is not there yet is the ordinary case here.
    }
    if (Date.now() > stop) return false;
    await pause(step);
  }
}

/* -------------------------------------------------------------------------- */
/* What the window is, measured from inside it                                 */
/* -------------------------------------------------------------------------- */

const viewport = (window_) =>
  window_.evaluate(() => ({
    w: window.innerWidth,
    h: window.innerHeight,
    dpr: window.devicePixelRatio,
    rootTheme: document.documentElement.getAttribute('data-theme'),
    scrolls:
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 ||
      document.body.scrollWidth > document.body.clientWidth + 1,
  }));

const boxes = (window_, selectors) =>
  window_.evaluate((list) => {
    const out = [];
    for (const sel of list) {
      const el = document.querySelector(sel);
      if (el === null) {
        out.push({ sel, missing: true });
        continue;
      }
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      out.push({
        sel,
        x: Math.round(r.x * 10) / 10,
        y: Math.round(r.y * 10) / 10,
        w: Math.round(r.width * 10) / 10,
        h: Math.round(r.height * 10) / 10,
        right: Math.round(r.right * 10) / 10,
        bottom: Math.round(r.bottom * 10) / 10,
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
        overflowX: s.overflowX,
      });
    }
    return out;
  }, selectors);

/** Whether the middle of an element is the thing a click would land on. A
 *  control under an overlay, or under a native view, is not reachable however
 *  good its rectangle looks. */
const hits = (window_, selector) =>
  window_.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el === null) return { sel, missing: true };
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return { sel, hidden: true };
    const at = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    if (at === null) return { sel, nothing: true };
    const holder = el.contains(at) || at.contains(el);
    return {
      sel,
      hit: holder,
      landed: `${at.tagName.toLowerCase()}${at.className === '' ? '' : `.${String(at.className).split(' ').join('.')}`}`,
    };
  }, selector);

const inside = (box, view) =>
  box.x >= -0.5 && box.y >= -0.5 && box.right <= view.w + 0.5 && box.bottom <= view.h + 0.5;

/** Everything the window is drawn with that only an icon speaks for. A control
 *  with no name is a control a screen reader announces as "button". */
const nameless = (window_) =>
  window_.evaluate(() => {
    const nameOf = (el) => {
      const labelled = el.getAttribute('aria-labelledby');
      if (labelled !== null && labelled !== '') {
        const text = labelled
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent ?? '')
          .join(' ')
          .trim();
        if (text !== '') return text;
      }
      const direct = el.getAttribute('aria-label');
      if (direct !== null && direct.trim() !== '') return direct.trim();
      const title = el.getAttribute('title');
      if (title !== null && title.trim() !== '') return title.trim();
      const own = (el.textContent ?? '').trim();
      if (own !== '') return own;
      const alt = el.querySelector('img[alt]')?.getAttribute('alt');
      if (alt !== undefined && alt !== null && alt.trim() !== '') return alt.trim();
      return (el.getAttribute('placeholder') ?? el.getAttribute('value') ?? '').trim();
    };
    const describe = (el) => {
      const cls = typeof el.className === 'string' ? el.className.split(' ').filter((one) => one !== '')[0] : '';
      return `${el.tagName.toLowerCase()}${cls === undefined || cls === '' ? '' : `.${cls}`}`;
    };
    const namelessOnes = [];
    for (const el of document.querySelectorAll('button, a[href], [role="tab"], [role="option"], [role="button"]')) {
      if (nameOf(el) === '') namelessOnes.push(describe(el));
    }
    const unlabelled = [];
    for (const el of document.querySelectorAll('input, select, textarea')) {
      if (el.getAttribute('type') === 'hidden') continue;
      // An input taken out of the tree entirely is not a control anybody is
      // asked to read; one that is merely off screen is.
      if (getComputedStyle(el).display === 'none' || el.getAttribute('aria-hidden') === 'true') continue;
      const labelled =
        nameOf(el) !== '' ||
        (el.id !== '' && document.querySelector(`label[for="${CSS.escape(el.id)}"]`) !== null) ||
        el.closest('label') !== null;
      if (!labelled) unlabelled.push(describe(el));
    }
    return { nameless: namelessOnes, unlabelled };
  });

/** The colour a piece of text is, and the colour it sits on, as the browser
 *  resolved them. Translucent ancestors are composited rather than skipped,
 *  because a half-transparent white over black is not white. */
const colours = (window_, selectors) =>
  window_.evaluate((list) => {
    const parsed = (one) => {
      const match = /rgba?\(([^)]+)\)/.exec(one);
      if (match === null) return null;
      const parts = match[1].split(',').map((piece) => Number.parseFloat(piece));
      return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
    };
    const over = (front, back) => ({
      r: front.r * front.a + back.r * (1 - front.a),
      g: front.g * front.a + back.g * (1 - front.a),
      b: front.b * front.a + back.b * (1 - front.a),
      a: 1,
    });
    const out = [];
    for (const sel of list) {
      const el = document.querySelector(sel);
      if (el === null) {
        out.push({ sel, missing: true });
        continue;
      }
      const s = getComputedStyle(el);
      let ground = { r: 255, g: 255, b: 255, a: 1 };
      const layers = [];
      for (let node = el; node !== null; node = node.parentElement) {
        const colour = parsed(getComputedStyle(node).backgroundColor);
        if (colour !== null && colour.a > 0) layers.push(colour);
      }
      for (let at = layers.length - 1; at >= 0; at -= 1) ground = over(layers[at], ground);
      const ink = parsed(s.color);
      const size = Number.parseFloat(s.fontSize);
      const weight = Number.parseInt(s.fontWeight, 10);
      out.push({
        sel,
        ink: s.color,
        ground: `rgb(${String(Math.round(ground.r))}, ${String(Math.round(ground.g))}, ${String(Math.round(ground.b))})`,
        ratio: ink === null ? null : ratioOf(over(ink, ground), ground),
        large: size >= 24 || (size >= 18.66 && weight >= 700),
      });
    }
    function ratioOf(one, other) {
      const lum = (colour) => {
        const channel = (value) => {
          const v = value / 255;
          return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * channel(colour.r) + 0.7152 * channel(colour.g) + 0.0722 * channel(colour.b);
      };
      const a = lum(one);
      const b = lum(other);
      const high = Math.max(a, b);
      const low = Math.min(a, b);
      return Math.round(((high + 0.05) / (low + 0.05)) * 100) / 100;
    }
    return out;
  }, selectors);

/** The state of every element before anything is focused, so a container that
 *  changes when focus lands inside it can be told from one that always looks
 *  that way. A composer whose border lights up while somebody types is an
 *  indicator; a composer that always has a shadow is decoration. */
const ringSnapshot = (window_) =>
  window_.evaluate(() => {
    const rest = {};
    let at = 0;
    for (const el of document.querySelectorAll('main.app, main.app *')) {
      const key = String(at);
      at += 1;
      el.setAttribute('data-vm-ring', key);
      const s = getComputedStyle(el);
      rest[key] = `${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor}|${s.boxShadow}|${s.borderColor}|${s.backgroundColor}`;
    }
    window.__vmRing = rest;
    return at;
  });

/** Whether the thing the keyboard is on is visibly the thing the keyboard is
 *  on: its own outline, a shadow, or a container that changed under it. */
const ringAt = (window_) =>
  window_.evaluate(() => {
    const el = document.activeElement;
    if (el === null || el === document.body) return { none: true };
    const describe = (one) => {
      const cls = typeof one.className === 'string' ? one.className.split(' ').filter((each) => each !== '') : [];
      return `${one.tagName.toLowerCase()}${cls.length === 0 ? '' : `.${cls.join('.')}`}`;
    };
    const styleOf = (one) => {
      const s = getComputedStyle(one);
      return `${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor}|${s.boxShadow}|${s.borderColor}|${s.backgroundColor}`;
    };
    const s = getComputedStyle(el);
    const own =
      (s.outlineStyle !== 'none' && s.outlineStyle !== '' && Number.parseFloat(s.outlineWidth) > 0) ||
      (s.boxShadow !== 'none' && s.boxShadow !== '');
    const r = el.getBoundingClientRect();
    const at = {
      what: describe(el),
      name: (el.getAttribute('aria-label') ?? el.getAttribute('title') ?? el.textContent ?? '').trim().slice(0, 48),
      outline: `${s.outlineStyle} ${s.outlineWidth}`,
      shadow: s.boxShadow === 'none' ? 'no shadow' : 'a shadow',
      focusVisible: el.matches(':focus-visible'),
      inViewport: r.x >= -0.5 && r.y >= -0.5 && r.right <= window.innerWidth + 0.5 && r.bottom <= window.innerHeight + 0.5,
      ring: own,
      where: own ? 'itself' : null,
    };
    if (own) return at;
    // A container that answers for the control inside it.
    for (let node = el.parentElement; node !== null; node = node.parentElement) {
      if (node.getAttribute('data-vm-ring') === null) continue;
      if (!node.matches(':focus-within')) continue;
      const key = node.getAttribute('data-vm-ring');
      const rest = window.__vmRing?.[key];
      if (rest !== undefined && rest !== styleOf(node)) {
        at.ring = true;
        at.where = describe(node);
        at.outline = `the container ${describe(node)} changed`;
        break;
      }
    }
    return at;
  });

/** What the keyboard is standing on, and whether anything on screen says so. */
const standing = (window_) =>
  window_.evaluate(() => {
    const el = document.activeElement;
    if (el === null || el === document.body) return { none: true };
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const cls = typeof el.className === 'string' ? el.className.split(' ').filter((one) => one !== '').join('.') : '';
    const outline = `${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor}`;
    const ring =
      (s.outlineStyle !== 'none' && s.outlineStyle !== '' && Number.parseFloat(s.outlineWidth) > 0) ||
      (s.boxShadow !== 'none' && s.boxShadow !== '');
    return {
      what: `${el.tagName.toLowerCase()}${cls === '' ? '' : `.${cls}`}`,
      name: (el.getAttribute('aria-label') ?? el.getAttribute('title') ?? el.textContent ?? '').trim().slice(0, 48),
      x: Math.round(r.x),
      y: Math.round(r.y),
      right: Math.round(r.right),
      bottom: Math.round(r.bottom),
      outline,
      shadow: s.boxShadow.slice(0, 60),
      ring,
      inViewport: r.x >= -0.5 && r.y >= -0.5 && r.right <= window.innerWidth + 0.5 && r.bottom <= window.innerHeight + 0.5,
      inWindow: (() => {
        const w = document.querySelector('main.app');
        if (w === null) return true;
        const box = w.getBoundingClientRect();
        return r.x >= box.x - 0.5 && r.right <= box.right + 0.5;
      })(),
    };
  });

/* -------------------------------------------------------------------------- */
/* What a screen reader is told                                                */
/* -------------------------------------------------------------------------- */

/** The things a person is meant to act on. A control the tree gives no name is
 *  one a screen reader reads as its role alone: "button". */
const ACTABLE = new Set([
  'button',
  'textbox',
  'searchbox',
  'combobox',
  'link',
  'checkbox',
  'radio',
  'switch',
  'tab',
  'option',
  'menuitem',
  'slider',
  'spinbutton',
]);

/** Roles that carry the row a control belongs to. Four "Add" buttons inside
 *  four listitems read as four rows; four under one anonymous div do not. */
const ROW_ROLES = new Set(['listitem', 'row', 'article', 'treeitem', 'option', 'menuitem']);

/** The protocol session behind the tree. A relaunched app is a new window and
 *  node ids do not survive a reload, so the session is taken again whenever the
 *  window is not the one it was taken from. */
let axClient = null;
let axOn = null;

async function axSession() {
  if (axClient !== null && axOn === window_) return axClient;
  const client = await window_.context().newCDPSession(window_);
  await client.send('Accessibility.enable');
  await client.send('DOM.enable');
  axClient = client;
  axOn = window_;
  return client;
}

async function axBox(client, backend) {
  if (typeof backend !== 'number') return null;
  try {
    const { model } = await client.send('DOM.getBoxModel', { backendNodeId: backend });
    const b = model.border;
    const box = { x: b[0], y: b[1], w: b[2] - b[0], h: b[7] - b[1] };
    return box.w < 0.5 || box.h < 0.5 ? null : box;
  } catch {
    // A node with nothing drawn for it has no box, which is not a finding here.
    return null;
  }
}

/** One surface as the browser hands it to a screen reader, with the box each
 *  control is drawn in. Read through the protocol rather than off attributes,
 *  because the tree is what the screen reader is given: a `title` is a name
 *  here, and a state the tree drops is a state nothing announces. */
async function axSurface(selector) {
  const client = await axSession();
  const { root } = await client.send('DOM.getDocument', { depth: 1 });
  const { nodeId } = await client.send('DOM.querySelector', { nodeId: root.nodeId, selector });
  if (nodeId === 0) return null;
  const { node } = await client.send('DOM.describeNode', { nodeId });
  const { nodes } = await client.send('Accessibility.queryAXTree', { backendNodeId: node.backendNodeId });
  const by = new Map(nodes.map((one) => [one.nodeId, one]));
  const items = [];
  for (const one of nodes) {
    const role = String(one.role?.value ?? '');
    const box = ACTABLE.has(role) ? await axBox(client, one.backendDOMNodeId) : null;
    items.push({
      id: one.nodeId,
      parent: one.parentId ?? null,
      role,
      name: String(one.name?.value ?? ''),
      ignored: one.ignored === true,
      props: Object.fromEntries((one.properties ?? []).map((p) => [p.name, p.value?.value])),
      box,
    });
  }
  const surface = items.find((one) => one.id === nodes[0]?.nodeId);
  const whole =
    surface === undefined ? null : await axBox(client, await client.send('DOM.describeNode', { nodeId }).then((one) => one.node.backendNodeId));
  return { items, by, root: surface, whole };
}

/** The whole tree, for the one question a single surface cannot answer: what
 *  else a screen reader can still reach while a modal sheet is up. */
async function axWhole() {
  const client = await axSession();
  const { nodes } = await client.send('Accessibility.getFullAXTree');
  const by = new Map(nodes.map((one) => [one.nodeId, one]));
  const inside = new Set();
  const walk = (node) => {
    if (node === undefined || inside.has(node.nodeId)) return;
    inside.add(node.nodeId);
    for (const child of node.childIds ?? []) walk(by.get(child));
  };
  return { nodes, by, inside, walk };
}

/** Whether the tree lists what shares a parent in the order the app draws it:
 *  down the page, or across it. A group of one says nothing either way. */
function readingOrder(items) {
  const groups = new Map();
  for (const one of items) {
    if (!ACTABLE.has(one.role) || one.ignored || one.box === null) continue;
    const key = one.parent ?? 'root';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(one);
  }
  const broken = [];
  let roomy = 0;
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    roomy += group.length;
    const down = group.every((one, at) => at === 0 || one.box.y >= group[at - 1].box.y - 4);
    const across = group.every((one, at) => at === 0 || one.box.x >= group[at - 1].box.x - 4);
    if (down || across) continue;
    for (let at = 1; at < group.length; at += 1) {
      const was = group[at - 1];
      const now = group[at];
      const back = now.box.y < was.box.y - 4 || (Math.abs(now.box.y - was.box.y) <= 4 && now.box.x < was.box.x - 4);
      if (!back) continue;
      broken.push({
        was: `${was.role} "${was.name.slice(0, 28)}"`,
        now: `${now.role} "${now.name.slice(0, 28)}"`,
        where: `drawn ${String(Math.round(was.box.x))},${String(Math.round(was.box.y))} then ${String(Math.round(now.box.x))},${String(Math.round(now.box.y))}`,
      });
    }
  }
  return { broken, roomy, groups: groups.size };
}

/** The nearest ancestor that gives a control its row, so a name repeated once
 *  per row is a name a screen reader can still tell apart. */
function rowAncestor(one, by) {
  for (let node = by.get(one.parent); node !== undefined; node = by.get(node.parentId)) {
    const role = String(node.role?.value ?? '');
    if (ROW_ROLES.has(role)) return node.nodeId;
    if (role === 'RootWebArea' || role === 'WebArea') return null;
  }
  return null;
}

/** Names that repeat with no row to tell them apart. A screen reader hears the
 *  name and nothing else, so four buttons called "Add" are one button repeated
 *  four times unless each sits in a row of its own. */
function repeatedNames(items, by) {
  const groups = new Map();
  for (const one of items) {
    if (one.ignored || one.name.trim() === '') continue;
    const key = `${one.role}\u0000${one.name}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(one);
  }
  const found = [];
  for (const [key, group] of groups) {
    if (group.length < 2) continue;
    const rows = group.map((one) => rowAncestor(one, by));
    const toldApart = rows.every((row) => row !== null) && new Set(rows).size === rows.length;
    if (toldApart) continue;
    found.push({
      role: key.split('\u0000')[0],
      name: key.split('\u0000')[1],
      n: group.length,
      rowed: rows.filter((row) => row !== null).length,
      where: group
        .map((one) => (one.box === null ? 'off screen' : `${String(Math.round(one.box.x))},${String(Math.round(one.box.y))}`))
        .join(' '),
    });
  }
  return found;
}

/** The three things every surface has to get right, so no row repeats them. */
async function axHolds(what, selector) {
  const surface = await axSurface(selector);
  if (surface === null) {
    bad(`${what} is not in the accessibility tree at all`);
    return null;
  }
  const actable = surface.items.filter((one) => ACTABLE.has(one.role) && !one.ignored);
  const unnamed = actable.filter((one) => one.name.trim() === '');
  verdict(
    `${what}: every control has a role and a name (${String(actable.length)} read, ${String(unnamed.length)} with no name)`,
    unnamed.length === 0,
  );
  for (const one of unnamed.slice(0, 6)) {
    bad(`${what}: a ${one.role} is announced as nothing but "${one.role}"`);
  }
  const repeats = repeatedNames(actable, surface.by);
  verdict(`${what}: a name tells two controls apart where it has to`, repeats.length === 0);
  for (const one of repeats) {
    bad(
      `${what}: ${String(one.n)} × ${one.role} announced only as "${one.name}" (drawn at ${one.where})` +
        `${one.rowed === 0 ? ', with no row around any of them to say which is which' : ''} — a screen reader hears the same word ${String(one.n)} times`,
    );
  }
  const order = readingOrder(surface.items);
  verdict(
    `${what}: the tree reads in the order the app is drawn (${String(order.roomy)} controls in ${String(order.groups)} groups of siblings)`,
    order.broken.length === 0,
  );
  for (const one of order.broken.slice(0, 4)) {
    bad(`${what}: the tree reads ${one.was} before ${one.now}, which are ${one.where}`);
  }
  return surface;
}

/** A few lines of the snapshot Playwright builds from the same tree, so an
 *  evidence folder holds what the announcement looks like and not only a count. */
async function saysYaml(selector, lines = 12) {
  const text = await window_.locator(selector).first().ariaSnapshot().catch(() => '');
  return text.split('\n').slice(0, lines).join('\n');
}

/** The emulated media a person sets at the OS level, cleared before and after
 *  every row that uses it, so no row measures the one before it. */
async function media(features) {
  await window_.emulateMedia({ colorScheme: null, contrast: null, forcedColors: null, reducedMotion: null, ...features });
  await pause(300);
}

/** What a modal sheet does about the window behind it. Kept the standard way:
 *  `aria-modal` on the dialog, plus a Tab trap in the DOM. The controls behind
 *  the sheet stay in the accessibility tree, so a reader that honours the hint
 *  ignores them and one that does not walks the whole window underneath. The
 *  tree can say which the app relies on; it cannot say what VoiceOver does with
 *  it, so that part stays a person's check. */
async function behindSheet(report) {
  const whole = await axWhole();
  const dialog = whole.nodes.find((one) => String(one.role?.value) === 'dialog');
  if (dialog === undefined) return null;
  whole.walk(dialog);
  const outside = whole.nodes.filter(
    (one) => !whole.inside.has(one.nodeId) && ACTABLE.has(String(one.role?.value)) && one.ignored !== true,
  );
  const props = Object.fromEntries((dialog.properties ?? []).map((one) => [one.name, one.value?.value]));
  const modal = props.modal === true;
  /* Whether the window behind is actually gone from the tree, rather than told
     to be ignored: the sheet's own siblings, and the app root they hang off. */
  const gone = await window_.evaluate((selector) => {
    const sheet = document.querySelector(selector);
    const app = document.querySelector('main.app');
    const gone = [];
    for (const el of [app, ...document.querySelectorAll('body > *')]) {
      if (el === null || el === sheet || el.contains(sheet) || sheet?.contains(el) === true) continue;
      if (el.getAttribute('aria-hidden') === 'true' || el.inert === true || el.hasAttribute('inert')) {
        gone.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0] ?? ''}`);
      }
    }
    return { gone, appInert: app === null ? null : app.inert === true || app.getAttribute('aria-hidden') === 'true' };
  }, report);
  const accounted = modal || gone.appInert === true || gone.gone.length > 0;
  verdict(
    `what is behind the sheet is accounted for (${String(outside.length)} controls still in the tree; ${modal ? 'the dialog says it is modal' : 'it does not'})`,
    accounted,
  );
  if (!accounted) {
    bad(
      `the sheet is a dialog with neither aria-modal nor a subtree taken out of the tree, so ${String(outside.length)} controls behind it (${outside
        .slice(0, 4)
        .map((one) => `"${String(one.name?.value ?? '').slice(0, 22)}"`)
        .join(', ')}) are exposed to a screen reader with nothing telling it to ignore them`,
    );
  } else if (outside.length > 0) {
    note(
      `those ${String(outside.length)} controls stay in the accessibility tree and are meant to be ignored because the dialog says it is modal (nothing behind it is inert or hidden); whether a screen reader honours that is a person's check (below)`,
    );
  }
  return { outside, gone, modal, dialog };
}

/* -------------------------------------------------------------------------- */
/* The fixture: one folder, a long name, and enough in it to overflow          */
/* -------------------------------------------------------------------------- */

/** The project everything else runs in, named the way a real folder is. */
const PROJECT = 'shop-front-redesign';

/** A name long enough that nothing can show it whole. Kept as a second project
 *  so the long-name case is one row with one variable in it. */
const LONG_PROJECT = 'a-project-with-a-name-long-enough-that-it-cannot-fit-in-the-shelf';
const LONG_LEAF =
  'AnotherExtremelyLongFileNameThatKeepsGoingAndGoingAndGoingAndGoingAndGoingAndGoing.tsx';

/** A second folder with no stylesheet in it, so the band that reads a project's
 *  own values can be checked as absent rather than as empty. */
const PLAIN_PROJECT = 'a-folder-nothing-is-declared-in';

/** The sheet the tokens band reads. `:root` first, then a rule that reaches for
 *  the values, so the Used column has a number in it rather than a blank. */
const TOKENS_SHEET = `:root {
  --ink: #1c1a18;
  --paper: #fcfaf7;
  --accent: #2f6f4f;
  --space-2: 8px;
  --space-4: 16px;
  --radius-sm: 6px;
  --shadow-card: 0 4px 12px rgba(0, 0, 0, 0.12);
  --text-sm: 13px;
  --font-ui: -apple-system, system-ui, sans-serif;
}

.sheet {
  color: var(--ink);
  background: var(--paper);
  padding: var(--space-4);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-card);
  font-size: var(--text-sm);
}
`;

/** One folder, with enough in it to overflow the panel that lists it. */
function makeProject(name, { deep = false } = {}) {
  const project = join(mkdtempSync(join(tmpdir(), 'graphe-visual-')), name);
  const put = (where, says) => {
    const file = join(project, where);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, says);
  };
  put('README.md', `# ${name}\n`);
  put('package.json', `${JSON.stringify({ name, version: '1.0.0', scripts: {} }, null, 2)}\n`);
  put(
    join('src', 'main', 'components', 'very-long-component-folder-name', 'deeply', 'nested', LONG_LEAF),
    '// a file whose path is wider than the panel\n',
  );
  if (deep) {
    for (let folder = 1; folder <= 24; folder += 1) {
      for (let file = 1; file <= 6; file += 1) {
        put(
          join('src', 'modules', `module-${String(folder).padStart(2, '0')}`, `file-${String(file)}.ts`),
          `export const one${String(folder)}${String(file)} = ${String(folder * file)};\n`,
        );
      }
    }
  }
  const git = (...flags) => execFileSync('git', flags, { cwd: project, stdio: 'pipe' });
  try {
    git('-c', 'init.defaultBranch=main', 'init', '-q');
    git('add', '-A');
    git('-c', 'user.email=visual@example.invalid', '-c', 'user.name=visual', 'commit', '-qm', 'first');
  } catch {
    // A machine without git still gets the layout rows; the folder just has no
    // history in it.
  }
  return project;
}

/** What the shell reads at first paint: the project list, the theme, and the
 *  file panel already on, so the tree is in the picture at every size. */
function seedProfile(projects, theme) {
  mkdirSync(profile, { recursive: true });
  writeFileSync(
    join(profile, 'projects.json'),
    `${JSON.stringify({
      version: 1,
      projects: projects.map((one, index) => ({
        path: one,
        name: one.slice(one.lastIndexOf('/') + 1),
        lastOpenedAt: Date.now() - index,
        lastSpend: null,
      })),
    })}\n`,
  );
  writePreferences({ base: theme });
}

function writePreferences({ base, motion = 'full' }) {
  writeFileSync(
    join(profile, 'preferences.json'),
    `${JSON.stringify({
      version: 1,
      preferences: { showFiles: true, appearance: { base, motion } },
    })}\n`,
  );
}

/** The same folders the app is promised, and nothing of anybody else's: a home
 *  and a profile of its own, so a run cannot read or write a real one. */
function environment(where) {
  const env = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (name === 'GRAPHE_DEV_SERVER_URL' || name === 'GRAPHE_TEST_MODEL') continue;
    if (name === 'ELECTRON_RUN_AS_NODE' || name === 'NODE_OPTIONS') continue;
    env[name] = value;
  }
  env.HOME = where;
  env.GRAPHE_PROFILE = profile;
  env.PI_CODING_AGENT_DIR = join(profile, 'agent');
  return env;
}

/** The built renderer over HTTP, which is where an unpackaged shell looks for
 *  it. A `file://` window would carry the markup and not the workers. */
async function serve(folder) {
  const types = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.woff2': 'font/woff2',
    '.png': 'image/png',
    '.wasm': 'application/wasm',
  };
  const server = createServer((request, response) => {
    const asked = decodeURIComponent((request.url ?? '/').split('?')[0] ?? '/');
    const leaf = normalize(asked === '/' ? 'index.html' : asked).replace(/^(\.\.[/\\])+/, '');
    const file = join(folder, leaf);
    if (!existsSync(file) || !statSync(file).isFile()) {
      response.writeHead(404).end('not built');
      return;
    }
    response.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(response);
  });
  const listening = Promise.withResolvers();
  server.listen(0, '127.0.0.1', () => {
    listening.resolve();
  });
  await listening.promise;
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('the file server has no port');
  return {
    url: `http://127.0.0.1:${String(address.port)}/`,
    stop: () => new Promise((done) => server.close(() => done())),
  };
}

/** Which app this run inspects, said out loud, with the date of the build it
 *  came from — a matrix against a stale bundle is a matrix of the wrong app. */
function target() {
  if (built) {
    const renderer = join(root, 'dist', 'index.html');
    const shell = join(root, 'dist-electron', 'boot.mjs');
    if (!existsSync(renderer) || !existsSync(shell)) {
      console.error(
        '\nNo built app to inspect. Run `npx vite build && npm run app:build` first,\n' +
          'or drop --built to use the packaged bundle in release/.\n',
      );
      process.exit(1);
    }
    return { how: 'built', renderer, shell, at: statSync(renderer).mtime.toISOString() };
  }
  const dir = process.arch === 'x64' ? 'mac' : `mac-${process.arch}`;
  const app = join(root, 'release', dir, 'Graphe.app');
  const binary = join(app, 'Contents/MacOS/Graphe');
  if (!existsSync(binary)) {
    console.error(
      `\nNo packaged app for this machine in release/${dir}. Build one first:\n` +
        '  npm run app:build && npm run package:quick\n' +
        'Or inspect the working tree with --built.\n',
    );
    process.exit(1);
  }
  return { how: 'packaged', app, binary, at: statSync(binary).mtime.toISOString(), renderer: null };
}

/* -------------------------------------------------------------------------- */
/* The run                                                                     */
/* -------------------------------------------------------------------------- */

const found = target();
const longProject = makeProject(LONG_PROJECT);
const project = makeProject(PROJECT, { deep: true });
const plainProject = makeProject(PLAIN_PROJECT);
seedProfile([longProject, project, plainProject], 'light');
rmSync(shots, { recursive: true, force: true });
mkdirSync(shots, { recursive: true });

const served = found.how === 'built' ? await serve(join(root, 'dist')) : null;
const env = environment(home);
if (served !== null) env.GRAPHE_DEV_SERVER_URL = served.url;

console.log(`\nGraphe — ${found.how}${found.how === 'packaged' ? ` (${found.app.slice(root.length)})` : ' (dist/ over http)'}`);
console.log(`  built ${found.at}`);
console.log(`  profile ${profile}`);
console.log(`  screenshots ${shots.slice(root.length)}`);
if (found.how === 'packaged' && existsSync(join(root, 'dist', 'index.html'))) {
  const renderer = statSync(join(root, 'dist', 'index.html')).mtime.toISOString();
  if (renderer > found.at) {
    console.log(
      `  note: the built renderer is newer (${renderer}) — the packaged bundle is behind the tree.` +
        '\n        Run with --built to inspect the current source instead.',
    );
  }
}

const launch = () => {
  const argv = [`--profile=${profile}`, `--user-data-dir=${profile}`];
  if (found.how === 'packaged') {
    return electron.launch({ executablePath: found.binary, args: argv, cwd: home, env, timeout: 60_000 });
  }
  return electron.launch({ args: ['.', ...argv], cwd: root, env, timeout: 60_000 });
};

/** The window, and the page inside it loaded far enough to be measured. */
async function firstWindowOf(started) {
  const page = await started.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  return page;
}

let app = await launch();
let window_ = await firstWindowOf(app);
// Nothing is asked of the shell until it answers something.
await tell(({ app: electronApp }) => electronApp.isReady());

/** Ask the shell something, with a second and third go: a window that is still
 *  coming up can drop one of these, and a dropped answer is not a finding. */
async function tell(said, arg) {
  const waits = [300, 700, 1500, 3000];
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await app.evaluate(said, arg);
    } catch (cause) {
      if (attempt >= waits.length) throw cause;
      // A window that has only just opened can drop one of these; a dropped
      // answer is not a finding, so it is asked again.
      await pause(waits[attempt]);
    }
  }
}

/** Sizes and zooms are applied to the window itself, which is what the plan
 *  names: 620×520 is the window the app refuses to go below, so the content is
 *  a little smaller than that and the check is the stricter one. */
async function sizeWindow(w, h) {
  await tell(({ BrowserWindow }, size) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win === undefined) return true;
    if (win.isFullScreen()) win.setFullScreen(false);
    if (win.isMaximized()) win.unmaximize();
    win.setSize(size.w, size.h, false);
    return true;
  }, { w, h });
  let settled = 0;
  let last = '';
  await until(async () => {
    const now = JSON.stringify(await window_.evaluate(() => [window.innerWidth, window.innerHeight]));
    if (now === last) settled += 1;
    else settled = 0;
    last = now;
    return settled >= 2;
  }, 6_000, 120);
}

async function zoomTo(factor) {
  await tell(({ BrowserWindow }, value) => {
    BrowserWindow.getAllWindows()[0]?.webContents.setZoomFactor(value);
    return true;
  }, factor);
  await pause(200);
}

async function shot(id) {
  const file = join(shots, `${id}.png`);
  await window_.screenshot({ path: file });
  current.shot = file;
  return file;
}

/** What hangs off the edge, so a failure names the thing that caused it rather
 *  than only the box that noticed first. */
const overflowing = (window_) =>
  window_.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width < 1 && r.height < 1) continue;
      const over = Math.max(r.right - window.innerWidth, -r.left);
      if (over <= 1) continue;
      const s = getComputedStyle(el);
      const cls = typeof el.className === 'string' ? el.className.split(' ').filter((one) => one !== '').join('.') : '';
      out.push({
        what: `${el.tagName.toLowerCase()}${cls === '' ? '' : `.${cls}`}`,
        over: Math.round(over),
        left: Math.round(r.left),
        right: Math.round(r.right),
        width: Math.round(r.width),
        minWidth: s.minWidth,
      });
    }
    return out.sort((a, b) => b.over - a.over).slice(0, 10);
  });

/** Text that is cut off rather than wrapped: the numbers a finding needs. */
const truncated = (window_, selectors) =>
  window_.evaluate((list) => {
    const out = [];
    for (const sel of list) {
      for (const el of document.querySelectorAll(sel)) {
        if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) {
          out.push({
            sel,
            text: (el.textContent ?? '').trim().slice(0, 40),
            needs: el.scrollWidth,
            has: el.clientWidth,
          });
        }
      }
    }
    return out;
  }, selectors);

/** Everything that has to fit, at this size, for this row. */
async function layoutHolds(prefix = '', { composer = true } = {}) {
  const view = await viewport(window_);
  const measured = await boxes(window_, MUST_FIT);
  for (const one of measured) {
    if (one.missing === true) continue;
    if (!inside(one, view)) {
      bad(
        `${prefix}${one.sel} is outside the window: ${String(one.x)},${String(one.y)} to ${String(one.right)},${String(one.bottom)} ` +
          `in ${String(view.w)}×${String(view.h)}`,
      );
    }
  }
  const present = measured.filter((one) => one.missing !== true);
  const outside = present.filter((one) => !inside(one, view));
  if (outside.length === 0) {
    ok(`${prefix}every box that carries the work is inside a ${String(view.w)}×${String(view.h)} window (${present.length} checked)`);
  } else {
    const why = await overflowing(window_);
    note(`what hangs off the edge: ${why.map((one) => `${one.what} ${String(one.over)}px over (width ${String(one.width)}, min-width ${one.minWidth})`).join('; ') || 'nothing measurable'}`);
  }
  const sideways = await boxes(window_, NO_SIDEWAYS);
  for (const one of sideways) {
    if (one.missing === true) continue;
    if (one.scrollWidth > one.clientWidth + 1) {
      bad(`${prefix}${one.sel} scrolls sideways: ${String(one.scrollWidth)}px of content in ${String(one.clientWidth)}px`);
    }
  }
  if (sideways.filter((one) => one.missing !== true).every((one) => one.scrollWidth <= one.clientWidth + 1)) {
    ok(`${prefix}nothing that should stay put scrolls sideways`);
  }
  if (view.scrolls) bad(`${prefix}the document itself scrolls sideways`);
  if (!composer) return view;
  const composerHere = await hits(window_, '.composer__input');
  verdict(`${prefix}the composer is reachable`, composerHere.hit === true);
  if (composerHere.hit !== true) {
    note(`a click in the composer would land on ${composerHere.landed ?? JSON.stringify(composerHere)}`);
  }
  const send = await hits(window_, '.composer__send');
  verdict(`${prefix}the send control is reachable`, send.hit === true);
  const cut = await truncated(window_, ['.thinking__label']);
  for (const one of cut) {
    bad(`${prefix}the control that names the model is cut off: "${one.text}" needs ${String(one.needs)}px in ${String(one.has)}px`);
  }
  if (cut.length === 0) ok(`${prefix}the model control shows its whole label`);
  const also = await truncated(window_, ['.shelf__rowname', '.welcome__title', '.files__row', '.topbar__name']);
  if (also.length > 0) {
    note(
      `${prefix}shortened with an ellipsis: ${also
        .slice(0, 5)
        .map((one) => `${one.sel} "${one.text.slice(0, 18)}" (${String(one.has)}px of ${String(one.needs)})`)
        .join('; ')}`,
    );
  }
  const here = await window_.evaluate(() => {
    const tab = document.querySelector('.tabs__tab--here');
    const strip = document.querySelector('.tabs__strip');
    const name = document.querySelector('.topbar__name');
    if (tab === null || strip === null) return null;
    const one = tab.getBoundingClientRect();
    const box = strip.getBoundingClientRect();
    return {
      inside: one.left >= box.left - 1 && one.right <= box.right + 1,
      title: document.querySelector('.tabs__tab--here .tabs__title')?.textContent ?? '',
      scrolled: Math.round(strip.scrollLeft),
      stripWidth: strip.clientWidth,
      stripContent: strip.scrollWidth,
      tabsWidth: Math.round(document.querySelector('.tabs')?.getBoundingClientRect().width ?? 0),
      nameWidth: Math.round(name?.getBoundingClientRect().width ?? 0),
      tabs: document.querySelectorAll('.tabs__tab').length,
    };
  });
  if (here !== null) {
    verdict(
      `${prefix}the tab in front is inside the strip${here.title === '' ? '' : ` ("${here.title.slice(0, 30)}…")`} of ${String(here.tabs)}`,
      here.inside,
    );
    if (!here.inside) {
      note(
        `the strip is ${String(here.stripWidth)}px wide holding ${String(here.stripContent)}px of tabs, next to a ${String(here.nameWidth)}px project name`,
      );
    }
  }
  return view;
}

/* -------------------------------------------------------------------------- */
/* 1. The first screen, and the project list                                   */
/* -------------------------------------------------------------------------- */

await row('project-list', 'the window a stranger meets: a long name and a short one', async () => {
  await window_.locator('.picker .pickerrow__open').first().waitFor({ timeout: 60_000 });
  await window_.locator('.welcome').waitFor({ state: 'detached', timeout: 30_000 });
  const rows = await window_.evaluate(() =>
    [...document.querySelectorAll('.pickerrow')].map((one) => {
      const name = one.querySelector('.pickerrow__name');
      const box = one.getBoundingClientRect();
      return {
        text: (name?.textContent ?? '').trim(),
        overflows: (name?.scrollWidth ?? 0) > (name?.clientWidth ?? 0) + 1,
        fits: box.left >= -0.5 && box.right <= window.innerWidth + 0.5,
      };
    }),
  );
  await shot('project-list');
  if (rows.length === 0) bad('there is no project row to press');
  for (const one of rows) {
    verdict(`"${one.text.slice(0, 24)}…" is drawn inside the window without pushing the row out`, one.fits);
    note(
      `the name is ${String(one.text.length)} characters and is clipped rather than wrapped: ${String(one.overflows)}`,
    );
  }
  const view = await viewport(window_);
  const [picker] = await boxes(window_, ['.picker']);
  if (picker.missing === true) bad('there is no project list on screen');
  else verdict('the project list is inside the window', inside(picker, view));
  await layoutHolds('opening screen: ', { composer: false });
});

await row('empty-state', 'a project with nothing said in it yet', async () => {
  await window_.locator('.picker .pickerrow__open', { hasText: PROJECT }).first().click();
  await window_.locator('.welcome').waitFor({ timeout: 60_000 });
  await sizeWindow(620, 520);
  const said = await window_.locator('.welcome__title').innerText();
  verdict(`the greeting names the project`, said.includes(PROJECT));
  const list = await window_.locator('.welcome__example').count();
  note(`${String(list)} ways to start are offered under the greeting`);
  await shot('empty-state');
  await layoutHolds('empty state: ');
  await sizeWindow(1100, 780);
});

/* -------------------------------------------------------------------------- */
/* 2. Twenty conversations with long titles                                    */
/* -------------------------------------------------------------------------- */

const titles = [];
for (let n = 1; n <= conversations; n += 1) {
  titles.push(`Conversation ${String(n)} about a subject long enough to run past the strip`);
}

/** What the strip holds, and which conversation is in front. Read in one go,
 *  because a count taken a moment before a click is a count of a different
 *  screen. */
const stripState = (window_) =>
  window_.evaluate(() => ({
    titles: [...document.querySelectorAll('.tabs__title')].map((one) => one.textContent ?? ''),
    here: document.querySelector('.tabs__tab--here .tabs__title')?.textContent ?? '',
    tabs: document.querySelectorAll('.tabs__tab').length,
  }));

/** Start another conversation from the sidebar, and wait until it is really
 *  there: one more row, with the new conversation in front. */
async function newConversation() {
  const before = await stripState(window_);
  /* The sidebar's own control, the plus in the strip, and the row's own button
     when there is nothing open at all: whichever of them this window is
     offering. */
  const starters = ['.shelf__new', '.tabs__add', '.tabs__empty'];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await dismissConnect();
    for (const sel of starters) {
      const button = window_.locator(sel).first();
      if ((await button.count()) === 0) continue;
      await button.click({ timeout: 5_000 }).catch(() => undefined);
      const fresh = await until(async () => {
        const now = await stripState(window_);
        return now.tabs === before.tabs + 1 && now.here === 'New conversation';
      }, 8_000);
      if (fresh) return true;
    }
    await pause(500);
  }
  return false;
}

/** The picker and the topbar menu both draw `.pickerrow__open`, so the project
 *  list is only ever pressed through `.picker`. */
async function ensureProjectOpen() {
  const ready = await until(
    async () =>
      (await window_.locator('.composer__input').count()) > 0 ||
      (await window_.locator('.picker .pickerrow__open').count()) > 0,
    60_000,
  );
  if (!ready) throw new Error('neither the project list nor a conversation appeared');
  if ((await window_.locator('.composer__input').count()) === 0) {
    await window_.locator('.picker .pickerrow__open', { hasText: PROJECT }).first().click();
    await window_.locator('.composer__input').waitFor({ timeout: 60_000 });
  }
  /* The sheet that asks for a model is opened by a send and arrives a moment
     after it, so a row that opens one can leave it over the next row's
     composer. Every row that needs a usable window starts here, so this is
     where it is taken away. */
  await dismissConnect();
}

await row('twenty-tabs', `${String(conversations)} open conversations, each with a long title`, async () => {
  // A run of one row still needs a project open; the picker is the way in.
  await ensureProjectOpen();
  const made = [];
  window_.on('load', () => note('the window reloaded'));
  for (const [index, title] of titles.entries()) {
    if (!(await dismissConnect())) {
      note('the sheet asking for a model would not close, so no more conversations could be opened');
      break;
    }
    if (index > 0) {
      // Each conversation is named by the first thing asked in it, so a new one
      // is started before the ask rather than after: a profile with no account
      // refuses the second ask in the same conversation.
      if (!(await newConversation())) {
        note(`the sidebar stopped opening conversations after ${String(made.length)}`);
        break;
      }
    }
    const ready = await hits(window_, '.composer__input');
    if (ready.hit !== true) {
      note(`the composer could not be reached: a click would land on ${ready.landed ?? JSON.stringify(ready)}`);
      break;
    }
    const step = await stripState(window_);
    note(`step ${String(index)}: in front "${step.here.slice(0, 22)}", ${String(step.tabs)} open`);
    await window_.locator('.composer__input').fill(title);
    await window_.locator('.composer__send').first().click();
    /* The app cuts a conversation's name to 39 characters and an ellipsis, and
       the strip, the tooltip and the accessible name all carry that same
       shortened string, so the check is against its first characters. */
    const stem = title.slice(0, 30);
    const named = await until(async () => {
      const labels = await window_
        .locator('.tabs__open')
        .evaluateAll((all) => all.map((one) => one.getAttribute('aria-label') ?? ''));
      return labels.some((one) => one.includes(stem));
    }, 20_000);
    if (!named) {
      const state = await window_.evaluate(() => ({
        titles: [...document.querySelectorAll('.tabs__title')].map((one) => one.textContent),
        draft: (document.querySelector('.composer__input')?.value ?? '(no composer)').slice(0, 40),
        modal: document.querySelector('.connectmodal') !== null,
      }));
      note(`the ask did not name a conversation: ${JSON.stringify(state)}`);
      break;
    }
    made.push(title);
  }
  await dismissConnect();
  const shown = await window_.locator('.tabs__title').allTextContents();
  const drawn = await window_.evaluate(() => {
    const one = document.querySelector('.tabs__tab--here .tabs__title');
    const tab = document.querySelector('.tabs__tab--here .tabs__open');
    return {
      drawn: (one?.textContent ?? '').length,
      asked: (tab?.getAttribute('aria-label') ?? '').length,
      title: tab?.getAttribute('title') ?? '',
      shortened: one?.textContent?.endsWith('…') === true,
    };
  });
  note(
    `an asked-for title of ${String(drawn.asked)} characters is drawn as ${String(drawn.drawn)}${drawn.shortened ? ' with an ellipsis' : ''}; its tooltip is "${drawn.title.slice(0, 40)}…"`,
  );
  await shot('twenty-tabs');
  verdict(`${String(shown.length)} conversations are open`, shown.length >= conversations);
  if (shown.length < conversations) {
    note(`only ${String(shown.length)} could be opened: ${shown.map((one) => one.slice(0, 24)).join(' | ')}`);
  }
  const strip = await window_.evaluate(() => {
    const one = document.querySelector('.tabs__strip');
    if (one === null) return null;
    return { scrollWidth: one.scrollWidth, clientWidth: one.clientWidth, more: document.querySelector('.tabs__more') !== null };
  });
  if (strip === null) bad('the tab strip is not there');
  else {
    verdict(
      `the strip holds the row without pushing the window wider (${String(strip.scrollWidth)}px of tabs in ${String(strip.clientWidth)}px)`,
      strip.scrollWidth > strip.clientWidth,
    );
    verdict('the overflow listing is offered once tabs are out of sight', strip.more);
  }
  await layoutHolds('twenty tabs: ');
});

/* -------------------------------------------------------------------------- */
/* 3. Titles that collide                                                      */
/* -------------------------------------------------------------------------- */

await row('same-prefix-titles', 'two conversations whose names start the same way', async () => {
  const pair = [
    'A conversation about the checkout flow, which will be redesigned in the spring',
    'A conversation about the checkout flow, which will be redesigned in the autumn',
  ];
  for (const title of pair) {
    if (!(await newConversation())) {
      bad('a third and fourth conversation could not be started');
      return;
    }
    await window_.locator('.composer__input').fill(title);
    await window_.locator('.composer__send').first().click();
    await until(
      async () =>
        (
          await window_.locator('.tabs__open').evaluateAll((all) => all.map((one) => one.getAttribute('aria-label') ?? ''))
        ).some((one) => one.includes(title.slice(0, 30))),
      20_000,
    );
    // The sheet arrives a moment after the rename, so it is waited for before
    // it is dismissed: dismissing too early leaves it over the next row.
    await until(async () => (await window_.locator('.connectmodal').count()) > 0, 3_000);
    await dismissConnect();
  }
  await dismissConnect();
  await shot('same-prefix-titles');
  const told = await window_.evaluate(() => {
    const names = [...document.querySelectorAll('.tabs__open')].map((one) => ({
      label: one.getAttribute('aria-label') ?? '',
      tooltip: one.getAttribute('title') ?? '',
      drawn: (one.querySelector('.tabs__title')?.textContent ?? '').trim(),
    }));
    const mine = names.filter((one) => one.label.includes('A conversation about the checkout'));
    return {
      mine,
      sameLabel: mine.length === 2 && mine[0].label === mine[1].label,
      sameTooltip: mine.length === 2 && mine[0].tooltip === mine[1].tooltip,
      sameDrawn: mine.length === 2 && mine[0].drawn === mine[1].drawn,
    };
  });
  note(`the two rows read: ${told.mine.map((one) => `"${one.drawn}"`).join(' and ')}`);
  note(
    `where they differ is after character ${String(
      [...pair[0]].findIndex((one, at) => one !== pair[1][at]) + 1,
    )}, and the app cuts a name at 39`,
  );
  verdict('two conversations with different names have different accessible names', !told.sameLabel);
  if (told.sameLabel) {
    bad(
      `both tabs are announced as "${told.mine[0]?.label ?? ''}", so a screen reader cannot tell them apart`,
    );
  }
  verdict('and different tooltips', !told.sameTooltip);
  if (told.sameTooltip) bad(`both tooltips read "${told.mine[0]?.tooltip ?? ''}"`);
  if (told.sameDrawn) {
    note('the two tabs are also drawn identically, which is the same thing a person sees');
  }
});



/* -------------------------------------------------------------------------- */
/* 4. The sizes                                                                */
/* -------------------------------------------------------------------------- */

const display = await app.evaluate(({ screen }) => {
  const { workArea } = screen.getPrimaryDisplay();
  return { w: workArea.width, h: workArea.height, scale: screen.getPrimaryDisplay().scaleFactor };
});
note(`this display's work area is ${String(display.w)}×${String(display.h)} at scale ${String(display.scale)}`);

for (const one of [...SIZES, { id: 'display', w: display.w, h: display.h, what: "this machine's whole display" }]) {
  await row(one.id, `${one.what} — ${String(one.w)}×${String(one.h)}`, async () => {
    await ensureProjectOpen();
    await sizeWindow(one.w, one.h);
    await shot(one.id);
    const view = await layoutHolds();
    note(`the window is ${String(one.w)}×${String(one.h)}; the page inside it is ${String(view.w)}×${String(view.h)}`);
    const shelf = await window_.evaluate(() =>
      document.querySelector('.shelf--closed') === null ? 'open' : 'collapsed',
    );
    note(`the sidebar is ${shelf} at this size`);
    const widths = await window_.evaluate(() => {
      const strip = document.querySelector('.tabs__strip');
      const name = document.querySelector('.topbar__name');
      return {
        strip: strip?.clientWidth ?? -1,
        tabs: strip?.scrollWidth ?? -1,
        name: Math.round(name?.getBoundingClientRect().width ?? 0),
        column: Math.round(document.querySelector('.app__column')?.getBoundingClientRect().width ?? 0),
      };
    });
    note(
      `the conversation column is ${String(widths.column)}px: ${String(widths.name)}px to the project name, ${String(widths.strip)}px left for ${String(widths.tabs)}px of tabs`,
    );
  });
}

await row('long-project-name', 'the same window with a name that cannot fit', async () => {
  await ensureProjectOpen();
  await sizeWindow(1100, 780);
  const stripHere = async () =>
    window_.evaluate(() => {
      const strip = document.querySelector('.tabs__strip');
      const tab = document.querySelector('.tabs__tab--here');
      const name = document.querySelector('.topbar__name');
      const box = strip?.getBoundingClientRect();
      const one = tab?.getBoundingClientRect();
      return {
        strip: strip?.clientWidth ?? -1,
        content: strip?.scrollWidth ?? -1,
        name: Math.round(name?.getBoundingClientRect().width ?? 0),
        nameText: (name?.textContent ?? '').trim(),
        inside: box !== undefined && one !== undefined && one.left >= box.left - 1 && one.right <= box.right + 1,
        tabs: document.querySelectorAll('.tabs__tab').length,
      };
    });
  const here = await stripHere();
  note(`in ${PROJECT}: the name takes ${String(here.name)}px, the strip has ${String(here.strip)}px for ${String(here.content)}px of tabs`);

  // The switcher in the strip is how somebody moves between folders.
  await window_.locator('.topbar__name').first().click();
  await window_.locator('.topbar__switcher .pickerrow__open', { hasText: LONG_PROJECT.slice(0, 30) }).first().waitFor({ timeout: 20_000 });
  await window_.locator('.topbar__switcher .pickerrow__open', { hasText: LONG_PROJECT.slice(0, 30) }).first().click();
  const arrived = await until(async () => (await window_.locator('.topbar__name').innerText()).includes(LONG_PROJECT.slice(0, 30)), 20_000);
  await shot('long-project-name');
  verdict('the switcher opens the other folder', arrived);
  const there = await stripHere();
  note(`in the long-named project: the name takes ${String(there.name)}px, the strip has ${String(there.strip)}px for ${String(there.content)}px of tabs (${String(there.tabs)} open)`);
  verdict(
    `with a name that cannot fit, the conversation in front is still in sight (strip ${String(there.strip)}px, next to a ${String(there.name)}px name)`,
    there.inside,
  );
  if (!there.inside) {
    bad(
      `a ${String(LONG_PROJECT.length)}-character project name takes ${String(there.name)}px of the strip along the top and leaves ${String(there.strip)}px for the tabs`,
    );
  }
  await layoutHolds('long name: ');

  // And back, which is also the check that tabs belong to a project. Counted
  // rather than assumed: rows above this one open conversations of their own, so
  // a fixed number here would be measuring the row order, not the app.
  const mine = here.tabs;
  await window_.locator('.topbar__name').first().click();
  await window_.locator('.topbar__switcher .pickerrow__open', { hasText: PROJECT }).first().click();
  const back = await until(async () => (await window_.locator('.tabs__title').count()) === mine, 20_000);
  await pause(400);
  const again = await stripHere();
  verdict(
    `coming back shows that project's own ${String(mine)} conversations (the other project had ${String(there.tabs)})`,
    back,
  );
  await shot('back-to-the-first-project');
  if (again.tabs !== mine) note(`the strip shows ${String(again.tabs)} conversations after coming back`);
});

/* -------------------------------------------------------------------------- */
/* 5. Zoom                                                                     */
/* -------------------------------------------------------------------------- */

for (const one of ZOOMS) {
  await row(one.id, `zoom ${String(one.factor * 100)}% at 800×600 — ${one.what}`, async () => {
    await ensureProjectOpen();
    await sizeWindow(800, 600);
    await zoomTo(one.factor);
    await shot(one.id);
    const view = await layoutHolds();
    note(`at ${String(one.factor * 100)}% the page sees ${String(view.w)}×${String(view.h)} CSS pixels`);
  });
}

await row('620x520-zoom-200', 'the smallest window at twice the size — the worst case there is', async () => {
  await ensureProjectOpen();
  await sizeWindow(620, 520);
  await zoomTo(2);
  await shot('620x520-zoom-200');
  await layoutHolds();
  const clipped = await boxes(window_, MUST_FIT);
  const out = clipped.filter((one) => one.missing !== true).length;
  note(`${String(out)} of the ${String(MUST_FIT.length)} boxes the window is built from are drawn here`);
});

await zoomTo(1);
await sizeWindow(1100, 780);

await row('panel-away', 'the same windows with the file panel put away', async () => {
  await ensureProjectOpen();
  const measure = async () =>
    window_.evaluate(() => {
      const app = document.querySelector('main.app');
      const strip = document.querySelector('.tabs__strip');
      const name = document.querySelector('.topbar__name');
      const chip = document.querySelector('.thinking__label');
      return {
        app: Math.round(app?.getBoundingClientRect().width ?? 0),
        appContent: app?.scrollWidth ?? 0,
        strip: strip?.clientWidth ?? -1,
        tabs: strip?.scrollWidth ?? -1,
        name: Math.round(name?.getBoundingClientRect().width ?? 0),
        chip: chip === null ? null : [chip.clientWidth, chip.scrollWidth],
      };
    });

  await sizeWindow(1100, 780);
  const atDefault = await measure();
  note(
    `1100×780 with the panel: the app is ${String(atDefault.app)}px wide in an 1100px window, the strip has ${String(atDefault.strip)}px for ${String(atDefault.tabs)}px of tabs`,
  );

  const collapse = window_.locator('.filespanel__collapse').first();
  if ((await collapse.count()) === 0) {
    bad('there is no way to put the file panel away from the panel itself');
    return;
  }
  await collapse.click();
  await until(async () => (await window_.locator('.filespanel').count()) === 0, 10_000);
  await pause(300);
  const atDefaultAway = await measure();
  note(
    `1100×780 without it: the app is ${String(atDefaultAway.app)}px wide, the strip has ${String(atDefaultAway.strip)}px for ${String(atDefaultAway.tabs)}px of tabs`,
  );
  await shot('1100x780-without-the-panel');
  await layoutHolds('at 1100 without the panel: ');

  await sizeWindow(620, 520);
  const atSmallest = await measure();
  note(
    `620×520 without it: the app is ${String(atSmallest.app)}px wide in a 620px window, the strip has ${String(atSmallest.strip)}px`,
  );
  await shot('620x520-without-the-panel');
  await layoutHolds('at 620 without the panel: ');

  // Put it back the way somebody brings it back, so the rows after this see the
  // window they expect.
  const place = window_.locator('.shelf__row', { hasText: 'Project files' });
  if ((await place.count()) > 0) {
    await place.first().click();
    const back = await until(async () => (await window_.locator('.filespanel').count()) > 0, 10_000);
    verdict('the file panel comes back from the sidebar', back);
  } else {
    bad('nothing in the sidebar brings the file panel back');
  }
  await sizeWindow(1100, 780);
});

/* -------------------------------------------------------------------------- */
/* 6. The themes, and what can be read in them                                 */
/* -------------------------------------------------------------------------- */

/** Escape, until the named overlay is gone. Every row starts from a known
 *  state rather than from whatever the row before it left open. */
async function escapeFrom(...selectors) {
  for (const sel of selectors) {
    if ((await window_.locator(sel).count()) === 0) continue;
    await window_.keyboard.press('Escape');
    await until(async () => (await window_.locator(sel).count()) === 0, 8_000);
  }
}

/** The sheet that asks for a model is modal and does not answer Escape in every
 *  state, so it is closed the way the sheet offers: its own close control. */
async function dismissConnect() {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if ((await window_.locator('.connectmodal').count()) === 0) return true;
    const close = window_.locator('.connectmodal__close');
    if ((await close.count()) > 0) await close.first().click({ timeout: 5_000 }).catch(() => undefined);
    else await window_.keyboard.press('Escape');
    if (await until(async () => (await window_.locator('.connectmodal').count()) === 0, 5_000)) return true;
    await pause(400);
  }
  return false;
}

const openSettings = async () => {
  await escapeFrom('.settings', '.palette', '.askanything');
  await dismissConnect();
  if ((await window_.locator('.settings').count()) > 0) return;
  await window_.locator('.shelf__more--last').first().click();
  await window_.locator('.settings').waitFor({ timeout: 30_000 });
};

const chooseTheme = async (choice) => {
  await openSettings();
  await window_.locator('.settings__bases .settings__system', { hasText: new RegExp(`^${choice}$`) }).first().click();
  await pause(200);
};

/** What each theme resolved to, so following the computer can be compared with
 *  the palette a person chose. */
const palette = {};

const tokenSet = (window_) =>
  window_.evaluate(() => {
    const s = getComputedStyle(document.documentElement);
    return {
      bg: s.getPropertyValue('--bg').trim(),
      text: s.getPropertyValue('--text').trim(),
      raised: s.getPropertyValue('--bg-raised').trim(),
      dark: window.matchMedia('(prefers-color-scheme: dark)').matches,
      mark: document.documentElement.getAttribute('data-theme'),
      painted: getComputedStyle(document.body).backgroundColor,
    };
  });

for (const one of THEMES) {
  await row(one.id, `${one.what} — chosen the way somebody chooses it`, async () => {
    await chooseTheme(one.choice);
    await until(
      async () => (await window_.evaluate(() => document.documentElement.getAttribute('data-theme'))) === one.mark,
      5_000,
    );
    // "Match this computer" paints whichever palette the system is set to, so
    // the renderer is told the computer is dark. The stylesheet's own
    // prefers-color-scheme block is what has to answer that.
    await window_.emulateMedia({ colorScheme: one.mark === 'dark' ? 'dark' : 'light' });
    await pause(250);
    const tokens = await tokenSet(window_);
    await shot(one.id);
    verdict(
      one.mark === null
        ? `no theme is stamped on the document, so the computer decides (${String(tokens.mark)})`
        : `the document is stamped ${one.mark}`,
      tokens.mark === one.mark,
    );
    note(
      `${one.what}: --bg ${tokens.bg}, --text ${tokens.text}, the page painted ${tokens.painted}, the computer is read as ${tokens.dark ? 'dark' : 'light'}`,
    );
    if (one.mark !== null) palette[one.mark] = tokens;
    await escapeFrom('.settings');
    await layoutHolds(`${one.what}: `);
  });
}

await row('theme-follows-the-computer', 'whether "match this computer" actually matches it', async () => {
  const light = palette.light;
  const dark = palette.dark;
  verdict(
    `light and dark are drawn differently (--bg ${light.bg} against ${dark.bg})`,
    light.bg !== dark.bg,
  );
  // Following the computer with the computer dark has to land on the dark
  // palette. This is the whole meaning of the setting, and the appearance's own
  // stylesheet is written last in the head, so it is the one that decides.
  await chooseTheme('System');
  await window_.emulateMedia({ colorScheme: 'dark' });
  await pause(250);
  const darker = await tokenSet(window_);
  await shot('theme-follows-dark');
  verdict(`the renderer is told the computer is dark`, darker.dark === true);
  verdict(
    `a dark computer draws the dark palette (--bg ${darker.bg}, against dark ${dark.bg} and light ${light.bg})`,
    darker.bg === dark.bg,
  );
  if (darker.bg !== dark.bg) {
    bad(
      `with no theme stamped and a dark computer, --bg is ${darker.bg}${darker.bg === light.bg ? ' — the light palette' : ''}, and the page is painted ${darker.painted}`,
    );
  }
  await chooseTheme('System');
  await window_.emulateMedia({ colorScheme: 'light' });
  await pause(250);
  const lighter = await tokenSet(window_);
  verdict(
    `and a light computer draws the light palette (--bg ${lighter.bg})`,
    lighter.bg === light.bg,
  );
  await escapeFrom('.settings');
  await shot('theme-follows-light');
});

await row('contrast', 'what can be read, measured against what it sits on', async () => {
  await ensureProjectOpen();
  for (const one of THEMES) {
    await chooseTheme(one.choice);
    await escapeFrom('.settings');
    await window_.emulateMedia({ colorScheme: one.mark === 'dark' ? 'dark' : 'light' });
    await pause(200);
    const measured = await colours(window_, CONTRAST.map((each) => each.sel));
    const said = [];
    for (const [index, each] of measured.entries()) {
      const label = CONTRAST[index].what;
      if (each.missing === true) {
        note(`${one.what}: ${each.sel} is not on screen, so it was not measured`);
        continue;
      }
      const needed = each.large === true ? 3 : 4.5;
      const pass = each.ratio !== null && each.ratio >= needed;
      said.push(`${label} ${String(each.ratio)}:1 (needs ${String(needed)})`);
      verdict(`${one.what}: ${label} reads at ${String(each.ratio)}:1`, pass);
      if (!pass) note(`${each.sel}: ${each.ink} on ${each.ground}`);
    }
    note(said.join('; '));
  }
  await shot('contrast');
});

/* -------------------------------------------------------------------------- */
/* 7. Keyboard only                                                            */
/* -------------------------------------------------------------------------- */

await row('keyboard-tab-order', 'Tab, from the composer, to the end of the window and back', async () => {
  await ensureProjectOpen();
  await window_.locator('.composer__input').click();
  await window_.keyboard.press('Tab');
  await window_.keyboard.press('Shift+Tab');
  await window_.locator('.composer__input').blur().catch(() => undefined);
  const tagged = await ringSnapshot(window_);
  note(`${String(tagged)} elements were recorded before anything was focused`);
  await window_.locator('.composer__input').click();
  const stops = [];
  for (let step = 0; step < 40; step += 1) {
    await window_.keyboard.press('Tab');
    const at = await ringAt(window_);
    if (at.none === true) break;
    stops.push(at);
  }
  const named = stops.filter((one) => one.name !== '').length;
  verdict(`every stop the keyboard reaches has a name (${String(named)} of ${String(stops.length)})`, named === stops.length);
  const ringless = stops.filter((one) => one.ring !== true);
  verdict(
    `every stop shows something when it is focused (${String(stops.length - ringless.length)} of ${String(stops.length)})`,
    ringless.length === 0,
  );
  for (const one of ringless.slice(0, 6)) {
    bad(`nothing on screen says the keyboard is on ${one.what}${one.name === '' ? '' : ` "${one.name}"`} (outline ${one.outline}, ${one.shadow})`);
  }
  const offscreen = stops.filter((one) => one.inViewport !== true);
  verdict(`every stop is on screen where it can be seen (${String(stops.length - offscreen.length)} of ${String(stops.length)})`, offscreen.length === 0);
  for (const one of offscreen.slice(0, 5)) {
    bad(`focus went to ${one.what}, outside the window`);
  }
  note(`the order was: ${stops.slice(0, 12).map((one) => one.what).join(' → ')}${stops.length > 12 ? ' → …' : ''}`);
  note(`where each stop shows its focus: ${stops.slice(0, 12).map((one) => one.where ?? 'nothing').join(' | ')}`);
  await window_.locator('.composer__input').click();
  await window_.keyboard.press('Escape');
});

await row('keyboard-tabs', 'Arrow, Home, End and close, in the tab strip', async () => {
  await ensureProjectOpen();
  /* Positions rather than titles: the strip draws a shortened name, and twenty
     rows can read the same while being different conversations, so an index is
     the only thing that says which one moved. */
  const whereNow = () =>
    window_.evaluate(() => {
      const open = [...document.querySelectorAll('.tabs__open')];
      const strip = document.querySelector('.tabs__strip');
      const tab = document.querySelector('.tabs__tab--here');
      const focused = document.activeElement;
      const a = tab?.getBoundingClientRect();
      const b = strip?.getBoundingClientRect();
      const labels = open.map((one) => (one.getAttribute('aria-label') ?? '').slice(0, 22));
      return {
        count: open.length,
        front: open.findIndex((one) => one.getAttribute('aria-selected') === 'true'),
        focused: open.findIndex((one) => one === focused),
        focusedWhat: typeof focused?.className === 'string' ? focused.className.split(' ')[0] : String(focused?.tagName ?? 'nothing'),
        focusedName: (focused?.getAttribute?.('aria-label') ?? focused?.getAttribute?.('title') ?? '').slice(0, 30),
        labels,
        tabBox: a === undefined ? null : [Math.round(a.left), Math.round(a.right)],
        stripBox: b === undefined ? null : [Math.round(b.left), Math.round(b.right)],
        inside: a !== undefined && b !== undefined && a.left >= b.left - 1 && a.right <= b.right + 1,
        scrolled: Math.round(strip?.scrollLeft ?? 0),
      };
    });

  await window_.locator('.tabs__open[aria-selected="true"]').first().click();
  await window_.locator('.tabs__open[aria-selected="true"]').first().focus();
  const start = await whereNow();
  verdict(`exactly one Tab stop, and it is the conversation in front (${String(start.count)} open)`, start.count > 1);
  note(`before any key: ${String(start.count)} open, the front one at ${String(start.front)}, the keyboard on ${String(start.focusedWhat)}`);

  /* A key is pressed and the conversation in front is waited for. The app
     switches conversation through an async resume, so reading the strip on the
     next line reads it before the key has landed — which is how the same run
     reported two different positions for the same press. */
  const press = async (key, aim) => {
    /* Each key is measured on its own. A key above may have handed the keyboard
       to the composer — which is a finding in itself, reported below — and an
       End pressed in a text box moves a caret, not a conversation, so the hand
       is put back on the strip before the next key rather than measuring the
       consequence of the one before it. */
    const held = await whereNow();
    if (!held.focusedWhat.includes('tabs__')) {
      note(`the keyboard is on ${held.focusedWhat} before ${key}, so it is put back on a tab first`);
      await window_.locator('.tabs__open[aria-selected="true"]').first().focus();
    }
    const before = await whereNow();
    const want = aim(before);
    await window_.keyboard.press(key);
    const arrived = await until(async () => (await whereNow()).front === want, 6_000);
    const after = await whereNow();
    verdict(
      `${key} moves to position ${String(want)} in the strip (at ${String(after.front)} of ${String(after.count)})`,
      arrived,
    );
    if (!arrived) {
      bad(`${key} left the conversation at position ${String(after.front)} of ${String(after.count)}, not ${String(want)}`);
    }
    const inStrip = after.focusedWhat.includes('tabs__open') || after.focusedWhat.includes('tabs__close');
    verdict(
      `${key} leaves the keyboard in the strip (on ${after.focusedWhat}${after.focusedName === '' ? '' : ` "${after.focusedName}"`})`,
      inStrip,
    );
    if (!inStrip) {
      bad(`${key} moved the keyboard out of the tab strip, onto ${after.focusedWhat}`);
    }
    verdict(
      `${key} keeps it in sight (tab ${String(after.tabBox?.join('-'))} in strip ${String(after.stripBox?.join('-'))}, scrolled ${String(after.scrolled)}px)`,
      after.inside,
    );
    if (!after.inside) {
      bad(
        `${key} left the conversation in front drawn outside the strip: tab ${String(after.tabBox?.join('-'))}, strip ${String(after.stripBox?.join('-'))}, scrolled ${String(after.scrolled)}px`,
      );
    }
    return after;
  };

  await press('ArrowRight', (before) => (before.front + 1) % before.count);
  await press('End', (before) => before.count - 1);
  await shot('keyboard-tabs-end');
  await press('Home', () => 0);

  // Alt+Arrow is the keyboard's answer to dragging a tab somewhere else. The
  // keyboard is put back on a tab first, because a key above may have moved it.
  if (start.count >= 2) {
    await window_.locator('.tabs__open').nth(1).focus();
    await window_.keyboard.down('Alt');
    await window_.keyboard.press('ArrowRight');
    await window_.keyboard.up('Alt');
    const after = await whereNow();
    verdict(
      `Alt+Arrow moves a conversation along the row (${after.labels[1]} → ${after.labels[2]})`,
      after.labels[1] !== start.labels[1] || after.labels[2] !== start.labels[2],
    );
  } else {
    note('only one conversation is open, so there is nothing to move along the row');
  }

  // Closing from the keyboard has to leave the hand somewhere sensible.
  await window_.locator('.tabs__open[aria-selected="true"]').first().focus();
  await window_.keyboard.press('Tab');
  const onClose = await standing(window_);
  verdict(`Tab from a tab reaches its close control (${onClose.what})`, onClose.what.includes('tabs__close'));
  const was = (await whereNow()).count;
  await window_.keyboard.press('Enter');
  await until(async () => (await window_.locator('.tabs__open').count()) === was - 1, 10_000);
  const now = (await whereNow()).count;
  verdict(`Enter on it closes the conversation (${String(was)} → ${String(now)})`, now === was - 1);
  const where = await standing(window_);
  verdict(
    `the keyboard lands somewhere it can carry on from (${where.what}${where.name === '' ? '' : ` "${where.name}"`})`,
    where.what.includes('tabs__') || where.what.includes('composer'),
  );
  if (!where.what.includes('tabs__')) {
    bad(
      `after closing a conversation the keyboard is on ${where.what}, not on the strip the close handler aims at (Tabs.tsx sets returnTo to the neighbour and focuses it)`,
    );
  }

  // And the row is left as it was found: a named conversation first, because a
  // second empty one is not offered.
  await window_.locator('.tabs__open').first().click();
  const restored = await newConversation();
  if (restored) ok('another conversation can be started from the sidebar');
  else note('a second empty conversation was not offered, so the row ends one short');
});

await row('focus-indicator', 'what the keyboard sees on the controls it lands on', async () => {
  await ensureProjectOpen();
  /* Focus is moved the way a keyboard moves it. Calling `.focus()` from script
     is not the same thing: `:focus-visible` is decided from how the focus
     arrived, and an indicator drawn for the keyboard never appears for a script
     that focuses an element itself. */
  const wanted = [
    ['.composer__input', 'what you type'],
    ['.composer__send', 'send'],
    ['.tabs__open', 'a conversation'],
    ['.tabs__add', 'new conversation'],
    ['.shelf__more--last', 'settings'],
  ];
  await window_.locator('.composer__input').click();
  await window_.keyboard.press('Tab');
  await window_.keyboard.press('Shift+Tab');
  await window_.locator('.composer__input').blur().catch(() => undefined);
  await ringSnapshot(window_);
  await window_.locator('.composer__input').click();
  const seen = new Map();
  for (let step = 0; step < 40; step += 1) {
    await window_.keyboard.press('Tab');
    const at = await ringAt(window_);
    if (at.none === true) break;
    for (const [sel, what] of wanted) {
      const name = sel.slice(1);
      if (at.what.includes(name) && !seen.has(what)) seen.set(what, at);
    }
  }
  await shot('focus-indicator');
  /* The composer is where the keyboard already is when a conversation opens, so
     Tab never lands on it: it is measured here by putting the hand there. */
  await window_.locator('.composer__input').click();
  const typed = await ringAt(window_);
  note(`.composer__input, clicked into: ${typed.where ?? 'nothing'} — outline ${typed.outline}, ${typed.shadow}`);
  verdict(
    `where you type shows something when the keyboard is in it (${typed.where ?? 'nothing'})`,
    typed.ring === true,
  );
  if (typed.ring !== true) bad('the box somebody types in is focused with nothing on screen to say so');
  for (const [sel, what] of wanted) {
    const at = seen.get(what);
    if (at === undefined) {
      note(`${sel} was not reached by forty presses of Tab`);
      continue;
    }
    verdict(
      `${what} shows something when the keyboard lands on it${at.ring ? ` (${at.where ?? 'nothing'})` : ''}`,
      at.ring === true,
    );
    if (at.ring !== true) {
      bad(`${what} (${sel}) is focused with nothing on screen to say so: outline ${at.outline}, ${at.shadow}`);
    }
    note(`${sel}: ${at.where ?? 'nothing'} — outline ${at.outline}, ${at.shadow}${at.focusVisible ? ', :focus-visible' : ''}`);
  }
  await window_.locator('.composer__input').click();
});

await row('keyboard-disabled', 'a disabled action must not look like an available one', async () => {
  await ensureProjectOpen();
  const styleOf = (sel) =>
    window_.evaluate((one) => {
      const el = document.querySelector(one);
      if (el === null) return null;
      const s = getComputedStyle(el);
      return {
        disabled: el.disabled === true,
        background: s.backgroundColor,
        colour: s.color,
        opacity: s.opacity,
        cursor: s.cursor,
        border: s.borderColor,
      };
    }, sel);
  const input = window_.locator('.composer__input');
  await input.fill('');
  await dismissConnect();
  const off = await styleOf('.composer__send');
  // The button's colours are transitioned (--dur-micro), so a sample taken on
  // the same frame as the draft change reads the colour it is leaving.
  await pause(400);
  const settledOff = await styleOf('.composer__send');
  await input.fill('something to send');
  // The button answers the draft through React, so it is waited for rather than
  // sampled the instant the text lands: a sample taken too early reads the
  // disabled state and calls it a finding.
  await until(async () => (await window_.locator('.composer__send').first().isEnabled()), 5_000);
  await pause(400);
  const on = await styleOf('.composer__send');
  await input.fill('');
  await shot('keyboard-disabled');
  if (off === null || on === null) {
    bad('there is no send control to compare');
    return;
  }
  verdict(`the send control is disabled with nothing to send (${String(off.disabled)})`, off.disabled);
  Object.assign(off, settledOff);
  verdict(`and available once there is something to send (${String(on.disabled)})`, on.disabled === false);
  /* How it looks, not whether the attribute is there, and without the cursor:
     a pointer shape is not something a person using a trackpad or the keyboard
     ever sees, so it cannot be the whole difference. */
  const looks = ({ background, colour, opacity, border }) => `${background}|${colour}|${opacity}|${border}`;
  const said = `disabled: ground ${off.background}, ink ${off.colour}, opacity ${off.opacity}, border ${off.border} — available: ground ${on.background}, ink ${on.colour}, opacity ${on.opacity}, border ${on.border}`;
  verdict(`the two are drawn differently (${said})`, looks(off) !== looks(on));
  if (looks(off) === looks(on)) {
    bad(
      `a disabled Send is drawn exactly like an available one (${said}); the only difference is the cursor, ${off.cursor} against ${on.cursor}`,
    );
  }
  note(`the cursor is ${off.cursor} when disabled and ${on.cursor} when available`);
  const others = await window_.evaluate(() => {
    const off = [];
    for (const el of document.querySelectorAll('button[disabled], button[aria-disabled="true"]')) {
      const s = getComputedStyle(el);
      const box = el.getBoundingClientRect();
      if (box.width < 1) continue;
      const cls = typeof el.className === 'string' ? el.className.split(' ').filter((one) => one !== '')[0] : '';
      off.push(`${el.tagName.toLowerCase()}${cls === undefined || cls === '' ? '' : `.${cls}`} "${(el.textContent ?? '').trim().slice(0, 24)}" — opacity ${s.opacity}, cursor ${s.cursor}`);
    }
    return off;
  });
  note(
    others.length === 0
      ? 'nothing else in this state is disabled'
      : `disabled here: ${others.join('; ')}`,
  );
});

/* -------------------------------------------------------------------------- */
/* 8. Overlays                                                                 */
/* -------------------------------------------------------------------------- */

/* A sheet is a chunk, and a chunk takes a frame or two. What is drawn in that
   frame is the one screen nobody can press for, so it is held open on purpose
   and looked at — and only the --built run serves the renderer over http, which
   is what makes holding a chunk possible at all. */
await row('loading-layout', 'the rectangle held where a sheet is still on its way', async () => {
  await ensureProjectOpen();
  await escapeFrom('.settings', '.palette', '.askanything');
  if (found.how !== 'built') {
    note('only the --built run serves the renderer over http, so a chunk cannot be held back here');
    return;
  }
  const held = '**/assets/*Settings*.js';
  await window_.route(held, async (route) => {
    await pause(3000);
    await route.continue();
  });
  await window_.reload();
  await ensureProjectOpen();
  await window_.locator('.shelf__more--last').first().click();
  const drawn = await until(
    async () => (await window_.locator('.sheet--arriving').count()) > 0,
    5_000,
  );
  verdict('the rectangle is drawn while the sheet is on its way', drawn);
  if (!drawn) {
    await window_.unrouteAll({ behavior: 'wait' });
    note('the sheet arrived too quickly to catch its own placeholder');
    return;
  }
  await shot('loading-layout');
  const said = await window_
    .locator('.sheet--arriving')
    .first()
    .evaluate((el) => {
      const s = getComputedStyle(el);
      return {
        role: el.getAttribute('role'),
        busy: el.getAttribute('aria-busy'),
        name: el.getAttribute('aria-label'),
        ground: s.backgroundColor,
        w: Math.round(el.getBoundingClientRect().width),
        h: Math.round(el.getBoundingClientRect().height),
      };
    });
  verdict(
    `the rectangle says what is busy rather than nothing (role ${String(said.role)}, name "${String(said.name)}")`,
    said.role === 'status' && said.name !== null && said.name !== '',
  );
  if (said.role !== 'status' || said.name === null || said.name === '') {
    bad(`the arriving rectangle is unnamed, so a screen reader announces a blank panel (role ${String(said.role)}, aria-busy ${String(said.busy)}, name ${String(said.name)})`);
  }
  note(`the rectangle is ${String(said.w)}×${String(said.h)} on ${said.ground}`);
  const view = await viewport(window_);
  const [box] = await boxes(window_, ['.sheet--arriving']);
  verdict('the rectangle is inside the window', inside(box, view));

  await window_.unrouteAll({ behavior: 'wait' });
  await window_.locator('.settings').waitFor({ timeout: 30_000 });
  const replaced = await window_.locator('.sheet--arriving').count();
  verdict('the rectangle is gone once the sheet itself arrives', replaced === 0);
  await window_.keyboard.press('Escape');
  await until(async () => (await window_.locator('.settings').count()) === 0, 10_000);
});

await row('overlay-settings', 'the settings sheet, over the conversation', async () => {
  await ensureProjectOpen();
  await openSettings();
  await shot('overlay-settings');
  const view = await viewport(window_);
  const [sheet] = await boxes(window_, ['.settings']);
  verdict('.settings is inside the window', inside(sheet, view));
  const hit = await hits(window_, '.settings');
  verdict('a click in the middle of the sheet lands on the sheet', hit.hit === true);
  note(`the sheet begins ${String(sheet.x)},${String(sheet.y)} and is ${String(sheet.w)}×${String(sheet.h)}`);

  // A modal sheet that is announced as one has to keep the keyboard too.
  await window_.locator('.settings__close').first().focus();
  let escaped = null;
  for (let step = 0; step < 40 && escaped === null; step += 1) {
    await window_.keyboard.press('Tab');
    const insideSheet = await window_.evaluate(() => document.activeElement?.closest('.settings') !== null);
    if (!insideSheet) escaped = await standing(window_);
  }
  verdict(
    escaped === null
      ? 'Tab stays inside the sheet for forty presses'
      : `the keyboard stays inside the sheet (it left after ${String(escaped.what)}${escaped.name === '' ? '' : ` "${escaped.name}"`})`,
    escaped === null,
  );
  if (escaped !== null) {
    bad(`focus escapes the modal sheet to ${escaped.what}${escaped.name === '' ? '' : ` "${escaped.name}"`} — the sheet is aria-modal but not trapping`);
    await shot('overlay-settings-focus-escaped');
  }
  await window_.keyboard.press('Escape');
  await until(async () => (await window_.locator('.settings').count()) === 0, 10_000);
  verdict('Escape closes the sheet', (await window_.locator('.settings').count()) === 0);
});

await row('overlay-composer-popover', 'the composer popover, with the conversation behind it', async () => {
  await ensureProjectOpen();
  const input = window_.locator('.composer__input');
  await input.click();
  // `@` offers the files and skills this project can use; `/` offers its
  // workflows, and this fixture has none.
  await input.fill('@');
  const opened = await until(async () => (await window_.locator('.composer__skills').count()) > 0, 15_000);
  await input.fill('/');
  const slashes = await until(async () => (await window_.locator('.composer__skills').count()) > 0, 4_000);
  note(
    slashes
      ? 'both @ and / open a list here'
      : 'the / list is empty on this profile: a project with no workflows of its own has none to offer',
  );
  await input.fill('@');
  await window_.locator('.composer__skills').first().waitFor({ timeout: 15_000 });
  verdict('the @ list opens over the conversation', opened);
  await shot('overlay-composer-popover');
  const view = await viewport(window_);
  const [popover] = await boxes(window_, ['.composer__skills']);
  const [box] = await boxes(window_, ['.composer__input']);
  verdict('the popover is inside the window', inside(popover, view));
  verdict('it opens above the box rather than over it', popover.bottom <= box.y + 1);
  const hit = await hits(window_, '.composer__skills');
  verdict('a click in the middle of it lands on it, not on the conversation behind it', hit.hit === true);
  if (hit.hit !== true) note(`a click would land on ${hit.landed ?? JSON.stringify(hit)}`);
  const options = await window_.locator('.composer__skills [role="option"]').count();
  verdict(`it is a listbox with ${String(options)} rows in it`, options > 0);
  if (options > 0) {
    const first = (await window_.locator('.composer__skills [role="option"]').first().innerText()).split('\n')[0] ?? '';
    await window_.keyboard.press('ArrowDown');
    await window_.keyboard.press('Enter');
    const filled = await input.inputValue();
    verdict(
      `the keyboard can choose from it without a mouse (typing "@" then Enter put "${filled.slice(0, 30)}" in the box, first row "${first.slice(0, 24)}")`,
      filled !== '@' && filled !== '',
    );
    await input.fill('');
  }
  await layoutHolds('composer popover: ');
});

await row('overlay-palette', 'the command palette, over everything', async () => {
  await ensureProjectOpen();
  await window_.keyboard.press('Meta+Shift+P');
  await window_.locator('.palette').first().waitFor({ timeout: 20_000 });
  await shot('overlay-palette');
  const view = await viewport(window_);
  const [palette] = await boxes(window_, ['.palette']);
  verdict('the palette is inside the window', inside(palette, view));
  const hit = await hits(window_, '.palette__input');
  verdict('a click in its field lands on its field', hit.hit === true);
  const focused = await window_.evaluate(() => document.activeElement?.className ?? '');
  verdict('it takes the keyboard when it opens', String(focused).includes('palette__input'));
  await window_.keyboard.press('Escape');
  await until(async () => (await window_.locator('.palette').count()) === 0, 10_000);
  verdict('Escape closes it', (await window_.locator('.palette').count()) === 0);
});

await row('overlay-ask', 'the find-anything bar, over everything', async () => {
  await ensureProjectOpen();
  // Not from inside the box somebody is typing in: there the key is a letter.
  await window_.locator('.welcome__title').first().click().catch(() => undefined);
  await window_.keyboard.press('Meta+K');
  let viaKey = await until(async () => (await window_.locator('.askanything').count()) > 0, 10_000);
  if (!viaKey) {
    // The same panel from the row that names it, which is how somebody who has
    // not learnt the key reaches it.
    await window_.locator('.shelf__row', { hasText: 'Find anything' }).first().click();
    viaKey = await until(async () => (await window_.locator('.askanything').count()) > 0, 15_000);
    note('the keyboard shortcut did not open it; the sidebar row did');
  }
  verdict('it opens', viaKey);
  if (!viaKey) {
    await shot('overlay-ask');
    return;
  }
  await shot('overlay-ask');
  const view = await viewport(window_);
  const [bar] = await boxes(window_, ['.askanything']);
  verdict('it is inside the window', inside(bar, view));
  const hit = await hits(window_, '.askanything');
  verdict('a click in the middle of it lands on it', hit.hit === true);
  const role = await window_.locator('.askanything').first().getAttribute('role');
  note(`it announces itself as ${String(role)}`);
  await window_.keyboard.press('Escape');
  await until(async () => (await window_.locator('.askanything').count()) === 0, 10_000);
  verdict('Escape closes it', (await window_.locator('.askanything').count()) === 0);
});

await row('overlay-connect', 'what the app says when nothing can answer', async () => {
  await ensureProjectOpen();
  const input = window_.locator('.composer__input');
  await input.click();
  await input.fill('something with no model to answer it');
  await window_.locator('.composer__send').first().click();
  await window_.locator('.connectmodal').first().waitFor({ timeout: 30_000 });
  await shot('overlay-connect');
  const view = await viewport(window_);
  const [sheet] = await boxes(window_, ['.connectmodal']);
  verdict('the sheet that asks for a model is inside the window', inside(sheet, view));
  const hit = await hits(window_, '.connectmodal');
  verdict('a click in the middle of it lands on it', hit.hit === true);
  const text = await window_.locator('.connectmodal').first().innerText();
  verdict('it says what it wants', /model|account|connect/i.test(text));
  await window_.keyboard.press('Escape');
  await until(async () => (await window_.locator('.connectmodal').count()) === 0, 10_000);
  verdict('Escape closes it', (await window_.locator('.connectmodal').count()) === 0);
  await input.fill('');
});

/* -------------------------------------------------------------------------- */
/* 8b. What the accessibility tree actually says                               */
/* -------------------------------------------------------------------------- */

/** A person with a screen reader is answered by the tree and by nothing else:
 *  not the drawn text, not the tooltip, not the class. These rows read that
 *  tree through the DevTools protocol, which is where the announcement comes
 *  from, rather than reading attributes by hand. What is still a person's — the
 *  speech itself — is named at the end of the run. */

await row('a11y-first-screen', 'the tree a screen reader is given on the opening screen', async () => {
  await escapeFrom('.settings', '.palette', '.askanything');
  await dismissConnect();
  if ((await window_.locator('.picker').count()) === 0) {
    // Back to the opening screen the way the app offers: the project menu's own
    // way out is a reload into the picker.
    await tell(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.webContents.reload();
      return true;
    });
    await window_.waitForLoadState('domcontentloaded');
    await until(async () => (await window_.locator('.picker .pickerrow__open').count()) > 0, 60_000);
  }
  await shot('a11y-first-screen');
  const surface = await axHolds('the opening screen', '.picker');
  if (surface === null) return;
  const row = surface.items.find((one) => one.role === 'listitem');
  note(`the first row is announced as: ${JSON.stringify(surface.items.filter((one) => ACTABLE.has(one.role)).map((one) => `${one.role} "${one.name}"`).slice(0, 4))}`);
  verdict('the folder list is announced as a list somebody can walk', row !== undefined);
  const list = surface.items.find((one) => one.role === 'list');
  verdict(
    `and it is named (${JSON.stringify(list?.name ?? 'no list name')})`,
    list !== undefined && String(list.name).trim() !== '',
  );
  note(`what the surface reads as:\n${await saysYaml('.picker', 10)}`);
});

await row('a11y-conversation', 'an open conversation: the transcript, the strip and the composer', async () => {
  await ensureProjectOpen();
  await escapeFrom('.settings', '.palette', '.askanything');
  await dismissConnect();
  if ((await window_.locator('.tabs__open').count()) === 0) {
    bad('no conversation is open, so there is nothing to read');
    return;
  }
  await shot('a11y-conversation');
  await axHolds('the composer', '.composer');

  /* The tab strip, read as a tablist: one selected tab, and a name for each
     that tells two differs-apart-by-a-tail conversations apart. */
  const strip = await axSurface('.tabs__strip');
  if (strip === null) {
    bad('the tab strip is not in the accessibility tree');
    return;
  }
  const list = strip.items.find((one) => one.role === 'tablist');
  verdict('the strip is announced as a tablist', list !== undefined);
  if (list !== undefined) {
    verdict(
      `the tablist is named (${JSON.stringify(list.name)})`,
      String(list.name).trim() !== '',
    );
    note(`the tablist says: ${JSON.stringify(list.props)}`);
  }
  const tabs = strip.items.filter((one) => one.role === 'tab' && !one.ignored);
  const chosen = tabs.filter((one) => one.props.selected === true);
  verdict(
    `exactly one of the ${String(tabs.length)} tabs is reported selected (${String(chosen.length)})`,
    tabs.length > 0 && chosen.length === 1,
  );
  if (chosen.length !== 1) {
    bad(`the strip reports ${String(chosen.length)} selected tabs, so a screen reader cannot say which conversation is in front`);
  }
  const front = await window_.evaluate(() => document.querySelector('.tabs__tab--here .tabs__open')?.getAttribute('aria-label') ?? '');
  if (front !== '' && chosen.length === 1) {
    verdict(
      `the tab reported selected is the one drawn in front ("${chosen[0].name.slice(0, 40)}")`,
      chosen[0].name === front,
    );
  }
  const named = tabs.filter((one) => one.name.trim() === '');
  verdict(`every tab carries its conversation's name (${String(tabs.length - named.length)} of ${String(tabs.length)})`, named.length === 0);
  const same = tabs.filter((one) => one.name === tabs[0]?.name).length;
  verdict(
    `no two tabs are announced identically (${String(same)} of ${String(tabs.length)} share the first name)`,
    tabs.length < 2 || same < tabs.length,
  );
  note(`the strip reads as:\n${await saysYaml('.tabs', 8)}`);
});

await row('a11y-two-titles', 'two conversations whose names differ only near the end', async () => {
  await ensureProjectOpen();
  const pair = [
    'A conversation about the checkout flow, which will be redesigned in the spring and shipped in June',
    'A conversation about the checkout flow, which will be redesigned in the spring and shipped in July',
  ];
  const open = () =>
    window_.locator('.tabs__open').evaluateAll((all) => all.map((one) => one.getAttribute('aria-label') ?? ''));
  const labels = await open();
  const missing = pair.filter((title) => !labels.includes(title));
  if (missing.length > 0) {
    /* The app will not open a second conversation on top of an untouched one,
       so the first ask of the run has to be made before another is started.
       The pair is only made when this profile does not already hold it. */
    if (!labels.some((one) => one !== '' && one !== 'New conversation')) {
      await window_.locator('.composer__input').fill('a first conversation, so the next one can be started');
      await window_.locator('.composer__send').first().click();
      await until(async () => (await open()).some((one) => one !== '' && one !== 'New conversation'), 20_000);
      await until(async () => (await window_.locator('.connectmodal').count()) > 0, 3_000);
      await dismissConnect();
    }
    for (const title of missing) {
      if (!(await newConversation())) {
        bad(`a conversation could not be started, so the collision between two names that differ only at the end could not be made`);
        return;
      }
      await window_.locator('.composer__input').fill(title);
      await window_.locator('.composer__send').first().click();
      await until(async () => (await open()).includes(title), 20_000);
      await until(async () => (await window_.locator('.connectmodal').count()) > 0, 3_000);
      await dismissConnect();
    }
  }
  await shot('a11y-two-titles');
  const strip = await axSurface('.tabs__strip');
  if (strip === null) {
    bad('the tab strip is not in the accessibility tree');
    return;
  }
  const tabs = strip.items.filter((one) => one.role === 'tab' && !one.ignored);
  const mine = tabs.filter((one) => one.name.includes('A conversation about the checkout flow'));
  verdict(`both asks are in the strip (${String(mine.length)} found)`, mine.length >= 2);
  if (mine.length >= 2) {
    const names = new Set(mine.map((one) => one.name));
    verdict(
      `the tree gives them different names, so a screen reader can tell them apart after 80 characters`,
      names.size === mine.length,
    );
    if (names.size !== mine.length) {
      const one = mine[0].name;
      bad(
        `both are announced as "${one.slice(0, 60)}", which is the same words until the last word: a screen reader reads one conversation twice`,
      );
    }
    note(`the two names differ at character ${String(Math.max(...mine.map((one) => {
      const other = mine.find((each) => each !== one)?.name ?? '';
      let at = 0;
      while (at < one.name.length && one.name[at] === other[at]) at += 1;
      return at + 1;
    })))}`);
  }
  const chosen = tabs.filter((one) => one.props.selected === true);
  verdict(`and the one in front is still reported selected (${String(chosen.length)})`, chosen.length === 1);
});

await row('a11y-settings-sheet', 'the settings sheet as a dialog, and what it hides', async () => {
  await ensureProjectOpen();
  await openSettings();
  await pause(400);
  await shot('a11y-settings-sheet');
  const whole = await axWhole();
  const dialog = whole.nodes.find((one) => String(one.role?.value) === 'dialog');
  verdict('the sheet is announced as a dialog', dialog !== undefined);
  if (dialog === undefined) {
    bad('the settings sheet is drawn but is not a dialog in the tree');
    await escapeFrom('.settings');
    return;
  }
  verdict(
    `it is named (${JSON.stringify(String(dialog.name?.value ?? ''))})`,
    String(dialog.name?.value ?? '').trim() !== '',
  );
  verdict(
    'it is reported modal',
    (dialog.properties ?? []).some((one) => one.name === 'modal' && one.value?.value === true),
  );
  await behindSheet('.settings');
  const found = await axHolds('the sheet', '.settings');
  if (found !== null) {
    const tablist = found.items.filter((one) => one.role === 'tab' || one.role === 'tablist');
    note(`the sheet holds ${String(tablist.length)} tablist nodes; its pages are reached from the navigation: ${JSON.stringify(found.items.find((one) => one.role === 'navigation')?.name ?? 'unnamed')}`);
  }
  await escapeFrom('.settings');
});

await row('a11y-add-ons', 'the add-ons screen: every row and the button that adds it', async () => {
  await ensureProjectOpen();
  await escapeFrom('.settings', '.palette', '.askanything');
  await dismissConnect();
  const opener = window_.locator('.shelf__more', { hasText: /^Add more$/ }).first();
  if ((await opener.count()) === 0) {
    bad('the sidebar offers no way to the add-ons screen');
    return;
  }
  await opener.click();
  const arrived = await until(async () => (await window_.locator('.addmore').count()) > 0, 20_000);
  if (!arrived) {
    bad('pressing Add more did not draw the screen');
    return;
  }
  await pause(700);
  await shot('a11y-add-ons');
  const whole = await axWhole();
  const dialog = whole.nodes.find((one) => String(one.role?.value) === 'dialog' && /add more/i.test(String(one.name?.value ?? '')));
  verdict('the screen is announced as a dialog with its own name', dialog !== undefined);
  await behindSheet('.addmore');
  const surface = await axHolds('the add-ons screen', '.addmore');
  if (surface === null) return;
  /* What a screen reader hears on each add button: the name, and the row it
     sits in. Four "Add" buttons are four rows only if the tree says so. */
  const adds = surface.items.filter((one) => one.role === 'button' && /^(Add|Remove)/.test(one.name));
  for (const one of adds.slice(0, 6)) {
    const row = rowAncestor(one, surface.by);
    const beside = row === null ? [] : surface.items.filter((each) => each.parent === row);
    const said = beside.map((each) => `${each.role} "${each.name.slice(0, 28)}"`).join(', ');
    note(`"${one.name}" is announced inside: ${said === '' ? 'nothing — it has no row' : said}`);
  }
  note(`the screen reads as:\n${await saysYaml('.addmore', 14)}`);
  await window_.keyboard.press('Escape');
  await until(async () => (await window_.locator('.addmore').count()) === 0, 10_000);
});

await row('a11y-disabled-and-states', 'a disabled control, and the state marks, as the tree reports them', async () => {
  await ensureProjectOpen();
  await escapeFrom('.settings', '.palette', '.askanything');
  await dismissConnect();
  const input = window_.locator('.composer__input');
  await input.fill('');
  await pause(400);
  const client = await axSession();
  const { root } = await client.send('DOM.getDocument', { depth: 1 });
  const findSend = async () => {
    const { nodeId } = await client.send('DOM.querySelector', { nodeId: root.nodeId, selector: '.composer__send' });
    if (nodeId === 0) return null;
    const { node } = await client.send('DOM.describeNode', { nodeId });
    const { nodes } = await client.send('Accessibility.getPartialAXTree', { backendNodeId: node.backendNodeId, fetchRelatives: false });
    const one = nodes[0];
    return {
      role: String(one?.role?.value ?? ''),
      name: String(one?.name?.value ?? ''),
      disabled: (one?.properties ?? []).find((each) => each.name === 'disabled')?.value?.value,
    };
  };
  const off = await findSend();
  await shot('a11y-disabled');
  if (off === null) {
    bad('there is no send control to read');
    return;
  }
  verdict(
    `the Send control with nothing to send is reported disabled (${String(off.role)} "${off.name}", disabled=${String(off.disabled)})`,
    off.disabled === true,
  );
  if (off.disabled !== true) {
    bad('Send is inert and looks inert, and the tree does not say so: a screen reader announces an available button that does nothing');
  }
  const domOff = await window_.evaluate(() => document.querySelector('.composer__send')?.disabled === true);
  verdict('and it is really inert, so the two agree', domOff === true);
  await input.fill('a sentence that gives Send something to do');
  await pause(300);
  const on = await findSend();
  verdict(
    `with a sentence in the box it is reported available (disabled=${String(on?.disabled)})`,
    on?.disabled !== true,
  );
  if (on?.disabled === true) {
    bad('Send has something to send and the tree still calls it disabled, so a screen reader is told the button cannot be used');
  }
  await input.fill('');
  await pause(300);

  /* Every control the DOM has switched off anywhere on this screen, checked
     against the tree one by one: a control that is inert but announced as
     available is the same defect as one that is disabled and looks enabled. */
  const marked = await window_.evaluate(() => {
    const out = [];
    let at = 0;
    for (const el of document.querySelectorAll(
      'button, input, select, textarea, [role="button"], [role="tab"], [role="option"], [role="radio"], [role="checkbox"], [role="switch"], [role="menuitem"]',
    )) {
      const off = el.disabled === true || el.getAttribute('aria-disabled') === 'true';
      if (!off) continue;
      el.setAttribute('data-vm-off', String(at));
      out.push({ key: String(at), what: `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0] ?? ''}` });
      at += 1;
    }
    return out;
  });
  let agreed = 0;
  for (const one of marked) {
    const { nodeId } = await client.send('DOM.querySelector', { nodeId: root.nodeId, selector: `[data-vm-off="${one.key}"]` });
    if (nodeId === 0) continue;
    const { node } = await client.send('DOM.describeNode', { nodeId });
    const { nodes } = await client.send('Accessibility.getPartialAXTree', { backendNodeId: node.backendNodeId, fetchRelatives: false });
    const said = (nodes[0]?.properties ?? []).find((each) => each.name === 'disabled')?.value?.value;
    if (said === true) agreed += 1;
    else bad(`${one.what} is switched off and the tree does not say so`);
  }
  await window_.evaluate(() => {
    for (const el of document.querySelectorAll('[data-vm-off]')) el.removeAttribute('data-vm-off');
  });
  verdict(
    `every control switched off on this screen is announced as such (${String(agreed)} of ${String(marked.length)})`,
    agreed === marked.length,
  );

  /* The state marks on a tab. A conversation waiting on somebody is the one
     state that cannot move on by itself, so it has to be more than a colour. */
  const marks = await window_.evaluate(() =>
    [...document.querySelectorAll('.tabs__mark')].map((one) => ({
      label: one.getAttribute('aria-label') ?? '',
      role: one.getAttribute('role') ?? '',
      colour: getComputedStyle(one).backgroundColor,
    })),
  );
  if (marks.length === 0) {
    note('no tab carries a state mark on this screen, so none was read');
  } else {
    const silent = marks.filter((one) => one.label.trim() === '');
    verdict(
      `every state mark on a tab says what it means (${String(marks.length - silent.length)} of ${String(marks.length)})`,
      silent.length === 0,
    );
    for (const one of silent) bad(`a tab's state is drawn in ${one.colour} and announced as nothing`);
    note(`the marks read: ${marks.map((one) => `"${one.label}" as a ${one.role}`).join(', ')}`);
  }
});

await row('a11y-order-versus-drawing', 'the order the tree reads against the order the window is drawn', async () => {
  await ensureProjectOpen();
  await escapeFrom('.settings', '.palette', '.askanything');
  await dismissConnect();
  // Nothing focused: a focus ring is a difference the eye sees, and this row is
  // about the eye's order, so the comparison is made with the page at rest.
  await window_.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await pause(300);
  await shot('a11y-order-versus-drawing');
  await axHolds('the whole column', '.app__column');
  await axHolds('the sidebar', '.shelf');
  await axHolds('the file panel', '.filespanel');
  const composer = await axHolds('the composer', '.composer');
  if (composer !== null) {
    /* Down the box, then across the row of controls: the reading order is the
       box first, and only then what acts on it. */
    const read = composer.items.filter((one) => ACTABLE.has(one.role) && !one.ignored);
    const firstIsBox = read[0]?.role === 'textbox';
    verdict(
      `the box is read before the controls that act on it (first is ${String(read[0]?.role ?? 'nothing')})`,
      firstIsBox,
    );
    if (!firstIsBox) {
      bad(`a screen reader reaches ${String(read[0]?.role ?? 'nothing')} before the box somebody types in`);
    }
    note(`the composer reads: ${read.map((one) => `${one.role} "${one.name.slice(0, 22)}"`).join(' → ')}`);
  }
});

/* -------------------------------------------------------------------------- */
/* 8c. The media a person sets at the OS level                                 */
/* -------------------------------------------------------------------------- */

await row('media-reduced-motion', 'prefers-reduced-motion: reduce, asked for the way the OS asks', async () => {
  await ensureProjectOpen();
  await escapeFrom('.settings', '.palette', '.askanything');
  await dismissConnect();
  const read = () =>
    window_.evaluate(() => {
      const moving = [];
      for (const el of document.querySelectorAll('main.app, main.app *')) {
        const s = getComputedStyle(el);
        for (const value of [s.transitionDuration, s.animationDuration]) {
          for (const piece of value.split(',')) {
            const seconds = piece.trim().endsWith('ms') ? Number.parseFloat(piece) / 1000 : Number.parseFloat(piece);
            if (Number.isFinite(seconds) && seconds > 0.001) {
              moving.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0] ?? ''} ${piece}`);
              break;
            }
          }
        }
      }
      return {
        matches: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
        moving: moving.length,
        sample: moving.slice(0, 6),
        tokens: getComputedStyle(document.documentElement).getPropertyValue('--dur-ui').trim(),
      };
    });
  const before = await read();
  verdict(`nothing asked for yet: the renderer is not told (${String(before.matches)})`, before.matches === false);
  note(`${String(before.moving)} elements carry a duration of their own before the request`);
  await media({ reducedMotion: 'reduce' });
  const after = await read();
  await shot('media-reduced-motion');
  verdict('the renderer is told reduced motion is wanted', after.matches === true);
  verdict(
    `everything that was moving stops (${String(before.moving)} moving → ${String(after.moving)})`,
    after.moving === 0,
  );
  if (after.moving > 0) {
    bad(`${String(after.moving)} elements still animate under reduced motion: ${after.sample.join(', ')}`);
  }
  note(`the app's own timing tokens are untouched (--dur-ui ${after.tokens}); the switch is the media query, not the setting`);
  await media({});
});

await row('media-contrast', 'prefers-contrast: more, measured against what the app already does with it', async () => {
  await ensureProjectOpen();
  await escapeFrom('.settings', '.palette', '.askanything');
  await dismissConnect();
  /* Every piece of text on screen at the ratio it actually reads at, against
     the colour it actually sits on, including what has been drawn over
     something translucent. The faintest one is the one this row is about. */
  const faintest = () =>
    window_.evaluate(() => {
      const lum = (rgb) => {
        const match = /rgba?\(([^)]+)\)/.exec(rgb);
        if (match === null) return null;
        const parts = match[1].split(',').map(Number);
        const channel = (value) => {
          const v = value / 255;
          return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * channel(parts[0]) + 0.7152 * channel(parts[1]) + 0.0722 * channel(parts[2]);
      };
      const groundSeen = (el) => {
        const layers = [];
        for (let node = el; node !== null; node = node.parentElement) {
          const match = /rgba?\(([^)]+)\)/.exec(getComputedStyle(node).backgroundColor);
          if (match === null) continue;
          const parts = match[1].split(',').map(Number);
          const alpha = parts.length > 3 ? parts[3] : 1;
          if (alpha > 0) layers.push({ r: parts[0], g: parts[1], b: parts[2], a: alpha });
        }
        let base = { r: 255, g: 255, b: 255 };
        for (let at = layers.length - 1; at >= 0; at -= 1) {
          const front = layers[at];
          base = {
            r: front.r * front.a + base.r * (1 - front.a),
            g: front.g * front.a + base.g * (1 - front.a),
            b: front.b * front.a + base.b * (1 - front.a),
          };
        }
        return base;
      };
      const out = [];
      for (const el of document.querySelectorAll('main.app *')) {
        const text = (el.textContent ?? '').trim();
        if (text === '' || el.children.length > 0) continue;
        const s = getComputedStyle(el);
        if (s.visibility === 'hidden' || s.display === 'none' || Number.parseFloat(s.opacity) < 0.1) continue;
        const box = el.getBoundingClientRect();
        if (box.width < 4 || box.height < 4) continue;
        const ink = (() => {
          const match = /rgba?\(([^)]+)\)/.exec(s.color);
          if (match === null) return null;
          const parts = match[1].split(',').map(Number);
          return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
        })();
        if (ink === null || ink.a < 0.05) continue;
        const back = groundSeen(el);
        const over = {
          r: ink.r * ink.a + back.r * (1 - ink.a),
          g: ink.g * ink.a + back.g * (1 - ink.a),
          b: ink.b * ink.a + back.b * (1 - ink.a),
        };
        const a = lum(`rgb(${String(over.r)}, ${String(over.g)}, ${String(over.b)})`);
        const b = lum(`rgb(${String(back.r)}, ${String(back.g)}, ${String(back.b)})`);
        if (a === null || b === null) continue;
        const size = Number.parseFloat(s.fontSize);
        const weight = Number.parseInt(s.fontWeight, 10);
        out.push({
          what: `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0] ?? ''}`,
          text: text.slice(0, 28),
          ratio: Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100,
          needs: size >= 24 || (size >= 18.66 && weight >= 700) ? 3 : 4.5,
          ink: s.color,
        });
      }
      return out.sort((one, two) => one.ratio - two.ratio);
    });

  const plain = await faintest();
  const worstPlain = plain[0];
  const tokens = () =>
    window_.evaluate(() => {
      const s = getComputedStyle(document.documentElement);
      return {
        bg: s.getPropertyValue('--bg').trim(),
        border: s.getPropertyValue('--border').trim(),
        faint: s.getPropertyValue('--text-faint').trim(),
      };
    });
  const before = await tokens();
  await media({ contrast: 'more' });
  const asking = await window_.evaluate(() => window.matchMedia('(prefers-contrast: more)').matches);
  verdict('the renderer is told more contrast is wanted', asking === true);
  await shot('media-contrast');
  const more = await faintest();
  const worstMore = more[0];
  const answered = await tokens();
  /* What the app does with the request: the media query reaches it and the
     palette does not move. Its own Contrast setting is what pushes every pair
     to 7:1, so a person who asked the OS for more contrast gets nothing. */
  const unchanged =
    answered.bg === before.bg && answered.border === before.border && answered.faint === before.faint;
  verdict(
    `the app answers the request (${unchanged ? 'it does not: --bg stays ' + before.bg : '--bg ' + before.bg + ' → ' + answered.bg})`,
    !unchanged,
  );
  if (unchanged) {
    bad(
      `a person who turned on Increase Contrast in System Settings gets the same palette as before (--bg ${answered.bg}, --text-faint ${answered.faint}): nothing in the stylesheet answers prefers-contrast, so the app's own Contrast setting is the only way to ask`,
    );
  }
  const harder = worstMore !== undefined && worstPlain !== undefined && worstMore.ratio < worstPlain.ratio - 0.01;
  verdict(
    `and asking for more contrast never makes anything harder to read (faintest ${String(worstPlain?.ratio)}:1 → ${String(worstMore?.ratio)}:1)`,
    !harder,
  );
  if (harder) {
    bad(
      `the faintest text (${String(worstMore.what)} "${worstMore.text}") reads at ${String(worstMore.ratio)}:1 with more contrast asked for, against ${String(worstPlain.ratio)}:1 without it`,
    );
  }
  const fails = more.filter((one) => one.ratio < one.needs);
  verdict(
    `with more contrast asked for, nothing on this screen is under the ratio it needs (${String(fails.length)} of ${String(more.length)} below)`,
    fails.length === 0,
  );
  for (const one of fails.slice(0, 6)) {
    bad(`${one.what} "${one.text}" reads at ${String(one.ratio)}:1 where ${String(one.needs)}:1 is needed, with more contrast asked for`);
  }
  /* The mechanism the app does have, so the gap above is a gap and not a
     missing feature: its own Contrast setting does move the palette. */
  await openSettings();
  const high = window_.locator('[role="radio"]', { hasText: /^High$/ }).first();
  if ((await high.count()) === 0) {
    note('the appearance band offers no Contrast setting, so there is nothing to compare against');
  } else {
    await high.click();
    await pause(300);
    const raised = await tokens();
    verdict(
      `the app's own High contrast does move the palette (--bg ${before.bg} → ${raised.bg}, --text-faint ${before.faint} → ${raised.faint})`,
      raised.bg !== before.bg || raised.faint !== before.faint,
    );
    const normal = window_.locator('[role="radio"]', { hasText: /^Normal$/ }).first();
    if ((await normal.count()) > 0) await normal.click();
    await pause(200);
  }
  await escapeFrom('.settings');
  note(`the app's own answer to more contrast is the Contrast setting in Appearance (7:1 everywhere); ${String(more.length)} pieces of text were measured.`);
  await media({});
});

await row('media-forced-colors', 'forced-colors: active, where a state that was a colour is taken away', async () => {
  await ensureProjectOpen();
  await escapeFrom('.settings', '.palette', '.askanything');
  await dismissConnect();
  const state = () =>
    window_.evaluate(() => {
      const groundSeen = (el) => {
        for (let node = el; node !== null; node = node.parentElement) {
          const match = /rgba?\(([^)]+)\)/.exec(getComputedStyle(node).backgroundColor);
          if (match === null) continue;
          const parts = match[1].split(',').map(Number);
          if ((parts.length > 3 ? parts[3] : 1) > 0) return `${String(parts[0])},${String(parts[1])},${String(parts[2])}`;
        }
        return '255,255,255';
      };
      const read = (el) => {
        if (el === null) return null;
        const s = getComputedStyle(el);
        // Appearance only: whether the attribute is there is what the tree row
        // checks. This one is about what the eye gets.
        return `${s.color} on ${groundSeen(el)}, border ${s.borderColor}, ${s.boxShadow === 'none' ? 'no shadow' : 'a shadow'}, weight ${s.fontWeight}, opacity ${s.opacity}`;
      };
      const here = document.querySelector('.tabs__tab--here .tabs__open');
      const away = document.querySelector('.tabs__tab:not(.tabs__tab--here) .tabs__open');
      return {
        matches: window.matchMedia('(forced-colors: active)').matches,
        tabs: document.querySelectorAll('.tabs__tab').length,
        send: read(document.querySelector('.composer__send')),
        tabHere: read(here),
        tabAway: read(away),
        tabHereBox: read(document.querySelector('.tabs__tab--here')),
        tabAwayBox: read(document.querySelector('.tabs__tab:not(.tabs__tab--here)')),
      };
    });
  /* Two conversations, because the strip can only say which one is in front if
     there is another one to be behind it. */
  await window_.locator('.composer__input').fill('');
  const already = await window_.locator('.tabs__tab').count();
  if (already < 2) {
    await window_.locator('.composer__input').fill('a first conversation, so the strip has something to compare');
    await window_.locator('.composer__send').first().click();
    await until(async () => (await window_.locator('.tabs__tab').count()) > 0, 20_000);
    await until(async () => (await window_.locator('.connectmodal').count()) > 0, 3_000);
    await dismissConnect();
    if (!(await newConversation())) {
      bad('a second conversation could not be started, so the strip has nothing to say which tab is in front');
      return;
    }
  }
  await window_.locator('.composer__input').fill('');
  await pause(400);
  const plain = await state();
  note(`with no colour forced: the tab in front reads ${String(plain.tabHereBox)} against ${String(plain.tabAwayBox)}`);
  await media({ forcedColors: 'active' });
  await window_.locator('.composer__input').fill('');
  await pause(300);
  const forced = await state();
  await shot('media-forced-colors');
  verdict('the renderer is told colour has been forced', forced.matches === true);
  verdict(`the strip holds more than one conversation to compare (${String(forced.tabs)})`, forced.tabs > 1);

  /* Two things have to survive a palette the app does not control: the control
     in front in the strip, and the difference between a control that can be
     used and one that cannot. */
  verdict(
    `the tab in front still reads differently from the rest (here ${String(forced.tabHere)}, away ${String(forced.tabAway)})`,
    forced.tabHere !== forced.tabAway || forced.tabHereBox !== forced.tabAwayBox,
  );
  if (forced.tabHere === forced.tabAway && forced.tabHereBox === forced.tabAwayBox) {
    bad('with colour forced, the conversation in front is drawn exactly like the others; nothing on screen says which one is open');
  } else if (forced.tabHere.replace(/weight \d+/, '') === forced.tabAway.replace(/weight \d+/, '')) {
    note('under forced colours the tab in front keeps no surface of its own: what tells it apart is the weight of its name and nothing else');
  }
  await window_.locator('.composer__input').fill('a sentence');
  await pause(350);
  const busy = await state();
  await window_.locator('.composer__input').fill('');
  await pause(350);
  const idle = await state();
  verdict(
    `an available Send still reads differently from an inert one (available ${String(busy.send)}, inert ${String(idle.send)})`,
    busy.send !== idle.send,
  );
  if (busy.send === idle.send) {
    bad('with colour forced, Send with a sentence and Send with nothing are drawn identically: the disabled state is carried by colour alone');
  }
  note(`under forced colours the app's own tokens are unchanged (--bg is the palette's), and the platform paints the surfaces: what is measured here is the renderer's answer to the emulation, not what macOS itself draws.`);
  await media({});
});

await row('media-color-scheme-live', 'the computer changing its mind while the window is open', async () => {
  await ensureProjectOpen();
  await escapeFrom('.settings', '.palette', '.askanything');
  await dismissConnect();
  await chooseTheme('System');
  const palette = () =>
    window_.evaluate(() => ({
      asked: window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
      bg: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
      painted: getComputedStyle(document.body).backgroundColor,
      mark: document.documentElement.getAttribute('data-theme'),
    }));
  await media({ colorScheme: 'light' });
  const light = await palette();
  await media({ colorScheme: 'dark' });
  const dark = await palette();
  await shot('media-color-scheme-live');
  verdict('following the computer: nothing is stamped on the document', dark.mark === null && light.mark === null);
  verdict(`a light computer draws the light palette (${light.bg})`, light.bg !== dark.bg);
  verdict(
    `and a dark computer draws the dark one, without a relaunch (${dark.bg})`,
    dark.bg !== light.bg && dark.asked === 'dark',
  );
  if (dark.bg === light.bg) {
    bad(`the computer was told dark and the palette is still ${dark.bg}, so a change at the OS level needs a relaunch to be seen`);
  }
  /* And a choice somebody made is not overridden by the computer. */
  await chooseTheme('Light');
  await media({ colorScheme: 'dark' });
  const kept = await palette();
  verdict(
    `a palette somebody chose holds against a dark computer (marked ${String(kept.mark)}, --bg ${kept.bg})`,
    kept.mark === 'light' && kept.bg === light.bg,
  );
  if (kept.mark !== 'light') {
    bad(`the computer was told dark and a hand-picked Light became ${String(kept.mark)}: the choice was not kept`);
  }
  await chooseTheme('System');
  await media({});
  await escapeFrom('.settings');
});

/* -------------------------------------------------------------------------- */
/* 9. The file tree, the terminal, named things                                */
/* -------------------------------------------------------------------------- */

await row('file-tree', 'the project tree, scrolled to the bottom, with names longer than it is', async () => {
  await ensureProjectOpen();
  await window_.locator('.files__tree').first().waitFor({ timeout: 30_000 });
  // Folders come folded. Two of them opened is what puts a column of rows in
  // front of the panel that has to scroll them.
  for (const name of ['src', 'modules']) {
    const folder = window_.locator('.files__row', { hasText: new RegExp(`^${name}$`) }).first();
    if ((await folder.count()) > 0) {
      await folder.click();
      await pause(300);
    }
  }
  const before = await window_.evaluate(() => {
    const tree = document.querySelector('.files__tree');
    const rows = [...document.querySelectorAll('.files__row')];
    const box = tree?.getBoundingClientRect();
    const widest = rows
      .map((one) => ({ text: (one.textContent ?? '').trim().slice(0, 60), right: one.getBoundingClientRect().right }))
      .reduce((most, one) => (box === undefined || one.right > most.right ? one : most), { text: '', right: 0 });
    return {
      rows: rows.length,
      scrollHeight: tree?.scrollHeight ?? 0,
      clientHeight: tree?.clientHeight ?? 0,
      scrollWidth: tree?.scrollWidth ?? 0,
      clientWidth: tree?.clientWidth ?? 0,
      treeRight: box?.right ?? 0,
      widest,
    };
  });
  verdict(`the tree lists the project (${String(before.rows)} rows)`, before.rows > 20);
  verdict(
    `it scrolls up and down (${String(before.scrollHeight)}px of rows in ${String(before.clientHeight)}px)`,
    before.scrollHeight > before.clientHeight,
  );
  verdict(
    `it does not scroll sideways (${String(before.scrollWidth)}px of content in ${String(before.clientWidth)}px)`,
    before.scrollWidth <= before.clientWidth + 1,
  );
  verdict(
    `no row is drawn past the edge of the panel (widest ends at ${String(Math.round(before.widest.right))}, panel at ${String(Math.round(before.treeRight))})`,
    before.widest.right <= before.treeRight + 1,
  );
  const longName = await window_.evaluate(() => {
    const rows = [...document.querySelectorAll('.files__row')];
    const longest = rows.map((one) => (one.textContent ?? '').trim()).sort((a, b) => b.length - a.length)[0] ?? '';
    return longest;
  });
  note(`the longest name in the tree is ${String(longName.length)} characters: ${longName.slice(0, 60)}`);
  await window_.evaluate(() => {
    const tree = document.querySelector('.files__tree');
    if (tree !== null) tree.scrollTop = tree.scrollHeight;
  });
  await pause(300);
  await shot('file-tree-bottom');
  const after = await window_.evaluate(() => {
    const tree = document.querySelector('.files__tree');
    return { top: Math.round(tree?.scrollTop ?? 0), at: tree?.scrollTop !== undefined && tree.scrollTop + tree.clientHeight >= tree.scrollHeight - 2 };
  });
  verdict(`it scrolled to the bottom (${String(after.top)}px)`, after.at);
  await layoutHolds('file tree: ');
});

await row('terminal', 'the terminal, and what happens when the window changes size', async () => {
  await ensureProjectOpen();
  await sizeWindow(1100, 780);
  await window_.keyboard.press('Meta+`');
  await window_.locator('.commands').first().waitFor({ timeout: 20_000 });
  const press = window_.locator('.commands__press', { hasText: /^Terminal$/ });
  if ((await press.count()) === 0) {
    bad('the commands drawer offers no Terminal to open');
    await shot('terminal');
    return;
  }
  await press.first().click();
  const arrived = await until(async () => (await window_.locator('.termpane').count()) > 0, 30_000);
  if (!arrived) {
    bad('pressing Terminal did not draw a terminal');
    await shot('terminal');
    return;
  }
  await pause(1_500);
  const [pane] = await boxes(window_, ['.termpane']);
  const view = await viewport(window_);
  await shot('terminal');
  verdict('the terminal is inside the window', inside(pane, view));
  const trouble = await window_.locator('.termpane__trouble').count();
  const ended = await window_.locator('.termpane__ended').count();
  note(`trouble shown: ${String(trouble)}, ended: ${String(ended)}`);
  const screenBefore = await window_.evaluate(() => {
    const one = document.querySelector('.termpane__screen');
    if (one === null) return null;
    const box = one.getBoundingClientRect();
    return { w: Math.round(box.width), h: Math.round(box.height) };
  });
  await sizeWindow(800, 600);
  await pause(1_200);
  const screenAfter = await window_.evaluate(() => {
    const one = document.querySelector('.termpane__screen');
    if (one === null) return null;
    const box = one.getBoundingClientRect();
    return { w: Math.round(box.width), h: Math.round(box.height) };
  });
  await shot('terminal-resized');
  if (screenBefore === null || screenAfter === null) {
    bad('the terminal has no screen to measure');
  } else {
    verdict(
      `the terminal follows the window (${String(screenBefore.w)}×${String(screenBefore.h)} → ${String(screenAfter.w)}×${String(screenAfter.h)})`,
      screenBefore.w !== screenAfter.w || screenBefore.h !== screenAfter.h,
    );
  }
  const [after] = await boxes(window_, ['.termpane']);
  verdict('and it is still inside the window afterwards', inside(after, await viewport(window_)));
  const closed = await window_.locator('.termpane__close').count();
  if (closed > 0) {
    await window_.locator('.termpane__close').first().click();
    await window_.keyboard.press('Escape');
  }
  await sizeWindow(1100, 780);
});

await row('named-controls', 'every control a screen reader would have to announce', async () => {
  await ensureProjectOpen();
  const said = await nameless(window_);
  verdict(
    said.nameless.length === 0
      ? 'every button in the window has a name'
      : `every button has a name (${String(said.nameless.length)} do not: ${said.nameless.slice(0, 8).join(', ')})`,
    said.nameless.length === 0,
  );
  verdict(
    said.unlabelled.length === 0
      ? 'every input is tied to a label'
      : `every input is tied to a label (${String(said.unlabelled.length)} are not: ${said.unlabelled.slice(0, 8).join(', ')})`,
    said.unlabelled.length === 0,
  );
  const tooltips = await window_.evaluate(() => {
    const all = [...document.querySelectorAll('[title]')];
    return {
      count: all.length,
      sample: all.slice(0, 6).map((one) => `${one.className.toString().split(' ')[0]}: ${one.getAttribute('title') ?? ''}`),
    };
  });
  note(`${String(tooltips.count)} controls carry a title attribute; the native tooltip itself is drawn by the OS: ${tooltips.sample.join(' | ')}`);
});

await row('error-state', 'what a turn that could not run looks like', async () => {
  await escapeFrom('.settings', '.palette', '.askanything');
  await dismissConnect();
  // Asked here rather than borrowed from an earlier row: a profile with no
  // account answers a turn by stopping part way through, and that is the state
  // this row is about.
  if ((await window_.locator('.errorcard').count()) === 0) {
    await window_.locator('.composer__input').fill('a turn that nothing can answer');
    await window_.locator('.composer__send').first().click();
    await dismissConnect();
  }
  const there = await until(async () => (await window_.locator('.errorcard').count()) > 0, 20_000);
  if (there === 0) {
    bad('a turn that could not run left no error on screen');
    await shot('error-state');
    return;
  }
  await window_.locator('.errorcard').first().scrollIntoViewIfNeeded();
  await shot('error-state');
  const view = await viewport(window_);
  const [card] = await boxes(window_, ['.errorcard']);
  verdict('the error is inside the window', inside(card, view));
  const said = await window_.locator('.errorcard').first().innerText();
  note(`it says: ${said.replace(/\s+/g, ' ').slice(0, 170)}`);
  const role = await window_.locator('.errorcard').first().getAttribute('role');
  verdict('it is announced as an alert, not left silent', role === 'alert');
  const act = window_.locator('.errorcard button').first();
  if ((await act.count()) > 0) {
    const hit = await act.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const at = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return at === el || el.contains(at);
    });
    verdict(`its action is reachable ("${(await act.innerText()).trim()}")`, hit === true);
  }
});

await row('missing-project', 'a project whose folder has gone', async () => {
  // The folder is taken away under the app, which is what happens when somebody
  // moves or deletes one. Nothing is written into the list behind its back.
  rmSync(longProject, { recursive: true, force: true });
  await tell(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.reload();
    return true;
  });
  await window_.waitForLoadState('domcontentloaded');
  const arrived = await until(async () => (await window_.locator('.picker .pickerrow__open').count()) > 0, 30_000);
  if (!arrived) {
    bad('the project list did not come back after reloading');
    return;
  }
  const marked = await until(async () => (await window_.locator('.picker .pickerrow--missing').count()) > 0, 15_000);
  await shot('missing-project');
  verdict('a folder that has gone is marked in the list before it is pressed', marked);
  if (marked) {
    const row = window_.locator('.picker .pickerrow--missing').first();
    const says = (await row.innerText()).replace(/\s+/g, ' ').trim();
    const hit = await hits(window_, '.picker .pickerrow--missing .pickerrow__open');
    note(`the row reads: ${says}`);
    verdict('the marked row is still reachable, so it can be taken off the list', hit.hit === true);
    await row.locator('.pickerrow__open').click();
    const gone = await until(async () => (await window_.locator('.picker .pickerrow--missing').count()) === 0, 10_000);
    verdict('pressing it answers by taking it off the list', gone);
    const stillThere = (await window_.locator('.picker .pickerrow__open').count()) > 0;
    verdict('and the rest of the list is left alone', stillThere);
  } else {
    bad('a folder that has gone is not marked: it is listed as if it were there');
  }
});

/* -------------------------------------------------------------------------- */
/* 10. Layout and settings that have to survive a relaunch                      */
/* -------------------------------------------------------------------------- */

await row('persistence', 'the size, the theme and the panels, after quitting and coming back', async () => {
  await ensureProjectOpen();
  await chooseTheme('Dark');
  await escapeFrom('.settings');
  await sizeWindow(900, 640);
  await pause(600);
  await tell(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.close();
    return true;
  });
  await until(() => app.windows().length === 0, 10_000);
  const written = JSON.parse(readFileSync(join(profile, 'window.json'), 'utf8'));
  verdict(
    `the window's size and place were written down (${String(written.width)}×${String(written.height)} at ${String(written.x)},${String(written.y)})`,
    typeof written.width === 'number' && typeof written.height === 'number',
  );
  const preferences = JSON.parse(readFileSync(join(profile, 'preferences.json'), 'utf8'));
  const held = preferences.preferences ?? {};
  verdict(`the theme is in the file, not only in the window (${String(held.appearance?.base)})`, held.appearance?.base === 'dark');
  verdict('the file panel is remembered', held.showFiles === true);

  /* The process has to end before another can start: the app takes a single
     instance lock, so a second copy of it would quit on the way up. */
  await app.close().catch(() => undefined);
  app = await launch();
  window_ = await firstWindowOf(app);
  await window_.locator('.picker .pickerrow__open').first().waitFor({ timeout: 60_000 });
  const back = await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    return { ...win.getNormalBounds(), zoom: win.webContents.getZoomFactor() };
  });
  verdict(
    `the window came back at the size it was left (${String(back.width)}×${String(back.height)})`,
    Math.abs(back.width - 900) <= 2 && Math.abs(back.height - 640) <= 2,
  );
  note(`zoom on the way back in: ${String(back.zoom)}`);
  await window_.locator('.pickerrow__open', { hasText: PROJECT }).first().click();
  await window_.locator('.welcome').first().waitFor({ timeout: 60_000 });
  const mark = await window_.evaluate(() => document.documentElement.getAttribute('data-theme'));
  verdict(`the theme survived the relaunch (${String(mark)})`, mark === 'dark');
  const files = await window_.locator('.filespanel').count();
  verdict('the file panel came back with it', files > 0);
  await shot('persistence');
});

await row('offscreen-restore', 'a window remembered on a monitor that is no longer there', async () => {
  const real = JSON.parse(readFileSync(join(profile, 'window.json'), 'utf8'));
  writeFileSync(
    join(profile, 'window.json'),
    `${JSON.stringify({ ...real, x: 9000, y: 9000, width: 1000, height: 700 })}\n`,
  );
  await tell(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.close();
    return true;
  });
  await until(() => app.windows().length === 0, 10_000);
  await app.close().catch(() => undefined);
  app = await launch();
  window_ = await firstWindowOf(app);
  await window_.locator('.picker .pickerrow__open').first().waitFor({ timeout: 60_000 });
  const where = await app.evaluate(({ BrowserWindow, screen }) => {
    const win = BrowserWindow.getAllWindows()[0];
    const bounds = win.getBounds();
    const on = screen.getDisplayMatching(bounds).workArea;
    const overlaps = Math.min(bounds.x + bounds.width, on.x + on.width) - Math.max(bounds.x, on.x);
    const down = Math.min(bounds.y + bounds.height, on.y + on.height) - Math.max(bounds.y, on.y);
    return { bounds, work: on, overlaps, down };
  });
  await shot('offscreen-restore');
  verdict(
    `a window remembered off the screen comes back where it can be reached (${String(Math.round(where.overlaps))}×${String(Math.round(where.down))}px of it on a display that is here)`,
    where.overlaps > 200 && where.down > 100,
  );
  note(`it was put at 9000,9000 ×1000×700 and came back at ${String(where.bounds.x)},${String(where.bounds.y)}`);
});

/* -------------------------------------------------------------------------- */
/* 11. Reduced motion                                                          */
/* -------------------------------------------------------------------------- */

await row('reduced-motion', 'less movement, as the renderer is told to want it', async () => {
  await ensureProjectOpen();
  const before = await window_.evaluate(() => {
    const s = getComputedStyle(document.querySelector('.composer') ?? document.body);
    return { matches: window.matchMedia('(prefers-reduced-motion: reduce)').matches, transition: s.transitionDuration };
  });
  await window_.emulateMedia({ reducedMotion: 'reduce' });
  await pause(250);
  const after = await window_.evaluate(() => {
    const s = getComputedStyle(document.querySelector('.composer') ?? document.body);
    return {
      matches: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      transition: s.transitionDuration,
      animation: s.animationDuration,
      tokens: {
        ui: getComputedStyle(document.documentElement).getPropertyValue('--dur-ui').trim(),
        micro: getComputedStyle(document.documentElement).getPropertyValue('--dur-micro').trim(),
      },
    };
  });
  await shot('reduced-motion');
  verdict('the renderer is told reduced motion is wanted', after.matches === true);
  verdict(
    `transitions are cut to nothing (${before.transition} → ${after.transition})`,
    after.transition !== before.transition,
  );
  note(`animations are ${after.animation}, and the app's own timings are still --dur-ui ${after.tokens.ui}, --dur-micro ${after.tokens.micro}`);
  await window_.emulateMedia({ reducedMotion: 'no-preference' });
});

await row('motion-off', "the app's own setting: instant everywhere", async () => {
  await ensureProjectOpen();
  await openSettings();
  const choice = window_.locator('.appearance__choices [role="radio"]', { hasText: /^Off$/ });
  if ((await choice.count()) === 0) {
    bad('the appearance band offers no Motion setting');
    await window_.keyboard.press('Escape');
    return;
  }
  await choice.first().click();
  await pause(250);
  const tokens = await window_.evaluate(() => {
    const s = getComputedStyle(document.documentElement);
    return {
      ui: s.getPropertyValue('--dur-ui').trim(),
      large: s.getPropertyValue('--dur-large').trim(),
      stagger: s.getPropertyValue('--dur-stagger').trim(),
    };
  });
  await shot('motion-off');
  verdict(
    `with motion off every duration is zero (--dur-ui ${tokens.ui}, --dur-large ${tokens.large}, --dur-stagger ${tokens.stagger})`,
    tokens.ui === '0s' || tokens.ui === '0ms',
  );
  const chosen = window_.locator('.appearance__choices [role="radio"]', { hasText: /^Full$/ });
  await chosen.first().click();
  await window_.keyboard.press('Escape');
  await until(async () => (await window_.locator('.settings').count()) === 0, 10_000);
});

/* -------------------------------------------------------------------------- */
/* 12. The canvas, and the project's own values                                 */
/* -------------------------------------------------------------------------- */

/* A canvas is a flow file the shell owns, and a run is driven by the shell: the
   window is only ever the drawing. These rows put a flow where the shell reads
   it and reload the window rather than pressing Start — the packaged app is what
   runs here by default and a real Start needs a model. What is under test is
   what the window does with the flow it is handed. */

/** Where the shell keeps a project's canvases, and the id it files them under.
 *  The id is minted the first time a folder is opened, so nothing can be seeded
 *  before the app has opened it once.
 *
 *  Looked up by the folder's last segment as well as by the path itself: the
 *  index is keyed by the folder resolved through its symlinks, and on this
 *  machine `/var` is one, so the path this script made is not always the path
 *  the registry wrote down. */
function flowFileFor(projectPath) {
  const index = JSON.parse(readFileSync(join(profile, 'workspaces.json'), 'utf8'));
  const byRoot = index.byRoot ?? {};
  const leaf = projectPath.slice(projectPath.lastIndexOf('/') + 1);
  const key =
    Object.keys(byRoot).find((one) => one === projectPath) ??
    Object.keys(byRoot).find((one) => one.endsWith(`/${leaf}`));
  const projectId = key === undefined ? undefined : byRoot[key];
  if (typeof projectId !== 'string' || projectId === '') return null;
  return join(profile, 'flows', `${projectId}.json`);
}

/** One canvas, written where the shell will read it. The file is read once per
 *  project open, so a rewrite only counts after a reload. */
function seedCanvas(projectPath, flows) {
  const file = flowFileFor(projectPath);
  if (file === null) return false;
  mkdirSync(join(profile, 'flows'), { recursive: true });
  writeFileSync(file, `${JSON.stringify(flows, null, 2)}\n`);
  return true;
}

/** Reload the window and come back in with the project open: a flow list is read
 *  per project open, so nothing seeded after that is seen without this. */
async function reloadIntoProject() {
  await tell(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.reload();
    return true;
  });
  await window_.waitForLoadState('domcontentloaded');
  const listed = await until(async () => (await window_.locator('.picker .pickerrow__open').count()) > 0, 60_000);
  if (!listed) return false;
  await window_.locator('.picker .pickerrow__open', { hasText: PROJECT }).first().click();
  const open = await until(async () => (await window_.locator('.composer__input').count()) > 0, 60_000);
  if (!open) return false;
  await dismissConnect();
  return true;
}

/** The canvas, from the row in the sidebar that names it. Pressing that row is
 *  what it is for, and it is also how somebody who has never seen a canvas finds
 *  one; the folded strip's mark is the same press. */
async function openTheCanvas() {
  await escapeFrom('.settings', '.palette', '.askanything');
  await dismissConnect();
  if ((await window_.locator('.canvas').count()) > 0) return true;
  const listed = window_.locator('.shelf__more', { hasText: /^Canvas$/ }).first();
  if ((await listed.count()) > 0) {
    await listed.click();
  } else {
    const folded = window_.locator('.shelf__act[aria-label="Canvas"]').first();
    if ((await folded.count()) === 0) return false;
    await folded.click();
  }
  return until(async () => (await window_.locator('.canvas').count()) > 0, 30_000);
}

/** What the canvas is showing, read in one go: a count taken beside a press is a
 *  count of a different screen. */
const canvasState = (window_) =>
  window_.evaluate(() => {
    const text = (sel) => (document.querySelector(sel)?.textContent ?? '').trim();
    return {
      titleLabel: document.querySelector('.canvas__title')?.getAttribute('aria-label') ?? null,
      count: text('.canvas__count'),
      start: text('.canvas__start'),
      stop: text('.canvas__stop'),
      marks: [...document.querySelectorAll('.canvas__face')].map((one) => one.getAttribute('aria-label') ?? ''),
      cards: document.querySelectorAll('.canvas__card').length,
      swept: document.querySelectorAll('.canvas__sweep').length,
      lines: document.querySelectorAll('.canvas__line').length,
      passed: document.querySelectorAll('.canvas__line--passed').length,
      flow: document.querySelectorAll('.canvas__flow').length,
      press: [...document.querySelectorAll('.canvas__press')].map((one) => one.textContent.trim()),
      nothing: text('.canvas__nothingtitle'),
      loops: document.querySelectorAll('.canvas__loop').length,
      goes: text('.canvas__goingsaid'),
      going: document.querySelectorAll('.canvas__going').length,
      ended: document.querySelectorAll('.canvas__ended').length,
      whole: document.querySelectorAll('.canvas__ended--whole').length,
      endword: text('.canvas__endword'),
      endcount: text('.canvas__endcount'),
      endsaid: text('.canvas__endsaid'),
      endopen: [...document.querySelectorAll('.canvas__endopen')].map((one) => one.textContent.trim()),
      branches: document.querySelectorAll('.canvas__branch').length,
      live: text('.canvas__live'),
      railWidth: Math.round(document.querySelector('.canvas__rail')?.getBoundingClientRect().width ?? 0),
      picktext: document.querySelector('.canvas__picktext')
        ? getComputedStyle(document.querySelector('.canvas__picktext')).display
        : null,
      loopband: document.querySelector('.canvas__loopband')
        ? getComputedStyle(document.querySelector('.canvas__loopband')).display
        : null,
      picks: document.querySelectorAll('.canvas__pick').length,
      bandsWidth: Math.round(document.querySelector('.canvas__bands')?.getBoundingClientRect().width ?? 0),
      tabs: [...document.querySelectorAll('.tabs__open')].map((one) => one.getAttribute('aria-label') ?? ''),
      glyphs: document.querySelectorAll('.tabs__kind').length,
      column: (() => {
        const column = document.querySelector('.app__column');
        return column === null ? 'gone' : getComputedStyle(column).display;
      })(),
    };
  });

/** One run of a flow, written rather than run: nothing in this run has a model
 *  to answer it. `entries` is each block's state and what it came to. */
function runOf(id, state, entries, lanes) {
  const startedAt = SEED_AT;
  const blocks = {};
  for (const [block, one] of Object.entries(entries)) {
    blocks[block] = {
      state: one.state,
      lane: 'lane-0',
      startedAt,
      endedAt: one.state === 'running' ? null : startedAt + 60_000,
      said: one.said ?? null,
      turns: one.turns ?? 0,
      spent: one.spent ?? null,
      rounds: 0,
      result: null,
      failure: one.failure ?? null,
    };
  }
  const over = state === 'running' || state === 'needs-you';
  return {
    id,
    state,
    startedAt,
    endedAt: over ? null : startedAt + 300_000,
    lanes: lanes ?? [{ id: 'lane-0', workspaceId: 'w-1', conversationId: null, branch: null }],
    blocks,
    spent: SPENT,
  };
}

const SEED_AT = 1_750_000_000_000;
const SPENT = { minor: 412, currency: 'USD' };

/** Three blocks in a line: an ask, the checks, and a gate to stop at. The same
 *  shape in every row, so what changes between them is the run and nothing
 *  else. */
const SEED_BLOCKS = [
  { id: 'block-1', kind: 'ask', name: 'Ask', says: 'Ship the empty state.', after: [], retries: 0 },
  {
    id: 'block-2',
    kind: 'checks',
    name: 'Checks',
    says: 'Run this project’s checks. Fix anything that fails.',
    after: ['block-1'],
    retries: 2,
  },
  { id: 'block-3', kind: 'gate', name: 'Gate', says: '', after: ['block-2'], retries: 0 },
];

/** The one canvas a row puts down, under the id the row is about. */
function oneCanvas(id, runs, updatedAt) {
  return [
    {
      id,
      name: 'Seed the canvas',
      blocks: SEED_BLOCKS,
      howFar: 'doing',
      lanes: 'in-turn',
      runs,
      createdAt: SEED_AT,
      updatedAt,
    },
  ];
}

/** A lane that opened a conversation, so Watch and Open have something to reach
 *  for: the press is only drawn when the lane has one. */
const A_LANE = [{ id: 'lane-0', workspaceId: 'w-1', conversationId: 'c-1', branch: null }];

/** The shell's own sentence, said where the press was made rather than in a
 *  sheet over the drawing. The press is only made when the pointer can reach it:
 *  the strip along the top is fixed and sits over the canvas's own bar, and a
 *  row that clicks through it would time out instead of saying so. */
async function saidInside(says, expected, role) {
  const reach = await hits(window_, '.canvas__start');
  if (reach.hit !== true) {
    bad(
      `${says}: the press cannot be reached at all — a click at its centre lands on ${reach.landed ?? JSON.stringify(reach)}`,
    );
    note(
      `${says}: so whether a refused Start says its sentence in the foot rather than in a sheet is not reachable through the window at this size; the refusal was checked by reading canStart`,
    );
    return;
  }
  await window_.locator('.canvas__start').first().click();
  const there = await until(async () => (await window_.locator('.canvas__refused').count()) > 0, 6_000);
  verdict(`${says}: the press says why rather than doing nothing`, there);
  if (!there) {
    bad(`${says}: pressing Start left nothing on screen`);
    return;
  }
  const words = (await window_.locator('.canvas__refused').first().innerText()).trim();
  note(`it says: ${words}`);
  verdict(`${says}: and it is the sentence canStart gives ("${expected}")`, words === expected);
  const seen = await window_.locator('.canvas__refused').first().getAttribute('role');
  verdict(`${says}: the sentence is announced rather than only drawn (role ${String(seen)})`, seen === role);
  verdict(
    `${says}: it is not a sheet over the drawing`,
    (await window_.locator('.sheet, .settings, .connectmodal').count()) === 0,
  );
}

/** Every press the canvas's own bar carries, and whether the pointer can reach
 *  it. The bar is drawn from the top of the column, and the strip along the top
 *  is fixed over it, so this is the one arrangement where a control that looks
 *  available is not. */
const barReach = (window_) =>
  window_.evaluate(() => {
    const out = [];
    for (const sel of [
      '.canvas__title',
      '.canvas__quietbtn',
      '.canvas__lanespick',
      '.canvas__start',
      '.canvas__fillbtn',
    ]) {
      const el = document.querySelector(sel);
      if (el === null) {
        out.push({ sel, missing: true });
        continue;
      }
      const r = el.getBoundingClientRect();
      const at = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      out.push({
        sel,
        y: Math.round(r.y),
        over: at === el || el.contains(at) === true ? null : String(at?.className ?? '').split(' ')[0] ?? '',
      });
    }
    return out;
  });

await row('canvas-empty', 'a canvas with nothing drawn on it, and the three ways to start one', async () => {
  await ensureProjectOpen();
  await sizeWindow(1100, 780);
  if (!seedCanvas(project, [])) {
    bad('the project has no id in the registry, so no canvas could be put where the shell reads one');
    return;
  }
  if (!(await reloadIntoProject())) {
    bad('the project did not come back after reloading, so the canvas was never reached');
    return;
  }
  const opened = await openTheCanvas();
  verdict('the row in the sidebar opens the canvas', opened);
  if (!opened) {
    await shot('canvas-empty');
    return;
  }
  await pause(700);
  await shot('canvas-empty');
  const said = await canvasState(window_);
  verdict(
    `a canvas with nothing on it says so rather than drawing a blank board ("${said.nothing}")`,
    said.nothing === 'Build a flow',
  );
  verdict(`it offers the templates somebody already worked out (${String(said.loops)})`, said.loops === 3);
  verdict('and the board itself is empty', said.cards === 0 && said.lines === 0);
  verdict(`the bar says there is nothing placed yet ("${said.count}")`, said.count === 'Nothing placed yet.');
  verdict('Start is offered, and Stop is not', said.start === 'Start' && said.stop === '');
  verdict(
    `the foot says what to do about it ("${said.live}")`,
    said.live === 'Place the steps, join them up, then start.',
  );
  verdict('the card that names the canvas is named for what it is', said.titleLabel === 'What this canvas is called');
  const view = await viewport(window_);
  const [canvasBox] = await boxes(window_, ['.canvas']);
  verdict('the canvas is inside the window', inside(canvasBox, view));
  const [rail] = await boxes(window_, ['.canvas__rail']);
  note(
    `the palette takes ${String(rail.w)}px of a ${String(said.bandsWidth)}px band; the words beside its marks are ${String(said.picktext)} at this width`,
  );
  await saidInside('nothing placed', 'Nothing to start. Place a block first.', 'status');
  await layoutHolds('canvas, nothing drawn: ', { composer: false });
});

await row('canvas-drawn', 'a flow drawn and never started: the cards, the lines, and Start', async () => {
  await ensureProjectOpen();
  await sizeWindow(1100, 780);
  if (!seedCanvas(project, oneCanvas('flow-seeded-drawn', [], SEED_AT + 3))) {
    bad('no canvas could be seeded');
    return;
  }
  if (!(await reloadIntoProject())) {
    bad('the project did not come back after reloading');
    return;
  }
  if (!(await openTheCanvas())) {
    bad('the row in the sidebar did not open the canvas');
    return;
  }
  await pause(900);
  await shot('canvas-drawn');
  const said = await canvasState(window_);
  verdict(`every block somebody placed is drawn (${String(said.cards)} cards)`, said.cards === 3);
  verdict(
    `each card carries its own name and the state it is in (${said.marks.join(' | ')})`,
    said.marks.length === 3 &&
      said.marks.every((one) => /, (Ready|Waiting|Running|Needs you|Done|Failed|Stopped)$/.test(one)),
  );
  verdict(`a flow nothing has run is all Ready (${said.marks.join(' | ')})`, said.marks.every((one) => one.endsWith(', Ready')));
  verdict(`every wait is drawn once, as one curve (${String(said.lines)} lines for two waits)`, said.lines === 2);
  verdict('nothing has been through, so no line is drawn as passed', said.passed === 0);
  verdict('and nothing is in flight on the board', said.flow === 0 && said.swept === 0);
  verdict(`the bar counts the blocks and says none has started ("${said.count}")`, said.count === '3 blocks · not started');
  verdict('Start is offered and Stop is not', said.start === 'Start' && said.stop === '');
  verdict(
    `the foot says what to do with it ("${said.live}")`,
    said.live === 'Place the steps, join them up, then start.',
  );
  const view = await viewport(window_);
  const [canvasBox] = await boxes(window_, ['.canvas']);
  verdict('the canvas is inside the window', inside(canvasBox, view));
  /* The bar is the one part of the canvas the strip along the top is drawn over,
     because the strip is fixed and starts at the window's own top edge. A control
     that looks available and is not is worse than one that is not drawn, so every
     press on the bar is asked whether a pointer can reach it. */
  const covered = (await barReach(window_)).filter((one) => one.missing !== true && one.over !== null);
  verdict(
    covered.length === 0
      ? 'every press on the canvas’s own bar is reachable'
      : `every press on the canvas's own bar is reachable (${String(covered.length)} are covered)`,
    covered.length === 0,
  );
  for (const one of covered) {
    bad(`${one.sel} at y=${String(one.y)} is covered by .${one.over}: a press there lands on the strip along the top`);
  }
  if (covered.length > 0) {
    note(
      `the strip along the top is fixed and .canvas is drawn from the window's own top edge, so the bar has no room of its own here; the board below it is unaffected`,
    );
  }
  await window_.locator('.canvas__face').first().click();
  const panel = await until(async () => (await window_.locator('.canvas__panel').count()) > 0, 10_000);
  verdict('pressing a card opens the panel that says what it does', panel);
  if (panel) {
    const body = (await window_.locator('.canvas__panel').first().innerText()).replace(/\s+/g, ' ');
    note(`the panel reads: ${body.slice(0, 170)}`);
    verdict('the panel is about the block that was pressed', /Ask/.test(body));
    /* The words live in a textarea, so they are the field's value rather than
       anything the panel's own text contains. */
    const words = await window_.locator('#canvas-block-says').inputValue();
    verdict(`and it shows the words that would be sent ("${words}")`, words === 'Ship the empty state.');
    verdict('which are editable in a field tied to a label', (await window_.locator('#canvas-block-says').count()) === 1);
  }
  await window_.keyboard.press('Escape');
  await until(async () => (await window_.locator('.canvas__panel').count()) === 0, 6_000);
  await layoutHolds('canvas, drawn: ', { composer: false });
});

await row('canvas-running', 'a run in flight: the sweep, the line carrying the work, and the foot', async () => {
  await ensureProjectOpen();
  await sizeWindow(1100, 780);
  const run = runOf(
    'run-1',
    'running',
    {
      'block-1': { state: 'done', said: 'The empty state is in.', turns: 2, spent: SPENT },
      'block-2': { state: 'done', said: 'Checks pass.', turns: 1, spent: SPENT },
      'block-3': { state: 'running' },
    },
    A_LANE,
  );
  if (!seedCanvas(project, oneCanvas('flow-seeded-running', [run], SEED_AT + 6))) {
    bad('no canvas could be seeded');
    return;
  }
  if (!(await reloadIntoProject())) {
    bad('the project did not come back after reloading');
    return;
  }
  if (!(await openTheCanvas())) {
    bad('the row in the sidebar did not open the canvas');
    return;
  }
  // Persisted Running records without a driver are recovered as Interrupted.
  // This fixture checks live rendering; real execution has Electron coverage.
  const canonicalProject = await window_.evaluate(async () => {
    const answer = await window.graphe.recentProjects();
    return answer.ok ? answer.value.find((one) => !one.missing)?.path ?? null : null;
  });
  const liveFlow = await window_.evaluate(async (project) => {
    const answer = await window.graphe.flowList({ project });
    if (!answer.ok) throw new Error(answer.trouble.because);
    const flow = answer.value.find((one) => one.id === 'flow-seeded-running');
    if (flow === undefined) throw new Error('running canvas fixture is missing');
    return flow;
  }, canonicalProject);
  await tell(({ BrowserWindow }, notice) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('graphe:flow-changed', notice);
    return true;
  }, { project: canonicalProject, flow: { ...liveFlow, runs: [run] } });
  note('live rendering uses a synthetic shell notice; actual execution is covered by Electron smoke');
  await pause(900);
  await shot('canvas-running');
  const said = await canvasState(window_);
  verdict(`the block being worked on is drawn as running (${String(said.swept)} sweep)`, said.swept === 1);
  verdict(
    `the line feeding it carries the work, and the two behind it have been through (${String(said.flow)} live, ${String(said.passed)} passed)`,
    said.flow === 1 && said.passed === 1,
  );
  verdict(`a run in flight offers Stop where Start was ("${said.stop}")`, said.stop === 'Stop' && said.start === '');
  verdict(
    `the block that is going is offered a way to read it ("${said.press.join(' | ')}")`,
    said.press.includes('Watch'),
  );
  verdict(`the foot says what is happening rather than only turning a ring ("${said.goes}")`, said.goes !== '');
  verdict(
    `the two blocks that finished say so on their cards (${said.marks.join(' | ')})`,
    said.marks.filter((one) => one.endsWith(', Done')).length === 2,
  );
  verdict(
    `the live region says exactly the sentence the foot draws ("${said.live.slice(0, 40)}")`,
    said.live === said.goes,
  );
  verdict('nothing has ended, so no ending is drawn', said.ended === 0 && said.going === 1);
  verdict(`the bar counts what is done and what is running ("${said.count}")`, said.count === '3 blocks · 2 done, 1 running');
  verdict(`the canvas wears its own glyph in the strip (${String(said.glyphs)})`, said.glyphs === 1);
  /* A canvas rides the same row as a conversation under its own name, so the tab
     is asked for by that name rather than by the word "Canvas". */
  verdict(
    `and the tab is named for the canvas ("${said.tabs.join(' | ')}")`,
    said.tabs.includes('Seed the canvas'),
  );
  if (!said.tabs.includes('Seed the canvas')) {
    bad(`the canvas is in front and no tab carries its name: the strip reads ${said.tabs.join(' | ')}`);
  }
  note(`a canvas in front is drawn in place of the conversation: the column is ${said.column}`);
  await layoutHolds('canvas, running: ', { composer: false });
});

await row('canvas-ended', 'a run that finished whole: the ending, the counts and the money', async () => {
  await ensureProjectOpen();
  await sizeWindow(1100, 780);
  const run = runOf(
    'run-2',
    'done',
    {
      'block-1': { state: 'done', said: 'The empty state is in.', turns: 2, spent: SPENT },
      'block-2': { state: 'done', said: 'Checks pass.', turns: 1, spent: SPENT },
      'block-3': { state: 'done', said: 'Stopped here.', turns: 0, spent: SPENT },
    },
    A_LANE,
  );
  if (!seedCanvas(project, oneCanvas('flow-seeded-ended', [run], SEED_AT + 9))) {
    bad('no canvas could be seeded');
    return;
  }
  if (!(await reloadIntoProject())) {
    bad('the project did not come back after reloading');
    return;
  }
  if (!(await openTheCanvas())) {
    bad('the row in the sidebar did not open the canvas');
    return;
  }
  await pause(900);
  await shot('canvas-ended');
  const said = await canvasState(window_);
  verdict(
    `a run every block finished is drawn as whole (${String(said.whole)} whole of ${String(said.ended)} endings)`,
    said.whole === 1 && said.ended === 1,
  );
  verdict(`the ending is named ("${said.endword}")`, said.endword === 'Finished');
  verdict(
    `the foot counts what ran, what it took and what it cost ("${said.endcount}")`,
    /^3 blocks · 3 turns · \$4\.12$/.test(said.endcount),
  );
  verdict(`and names the last thing the run came to ("${said.endsaid.slice(0, 56)}")`, said.endsaid !== '');
  verdict(
    `the conversation is one press away, in the app's own words (${said.endopen.join(' | ')})`,
    said.endopen.includes('Open the conversation'),
  );
  verdict('a lane that made no branch offers no branch to review', said.branches === 0);
  verdict('nothing is in flight, so the foot has no going line', said.goes === '' && said.going === 0);
  verdict(`the live region says the same word the ending does ("${said.live}")`, said.live === said.endword);
  verdict('Start is offered again rather than Stop', said.start === 'Start' && said.stop === '');
  verdict(
    `every card is done (${String(said.marks.filter((one) => one.endsWith(', Done')).length)} of ${String(said.cards)})`,
    said.marks.filter((one) => one.endsWith(', Done')).length === 3,
  );
  verdict(`every line has been through (${String(said.passed)} of ${String(said.lines)})`, said.passed === said.lines && said.lines === 2);
  await layoutHolds('canvas, ended: ', { composer: false });
});

await row('canvas-drawn-dark', 'the same canvas in the dark palette, where nothing may be left on paper', async () => {
  await ensureProjectOpen();
  await sizeWindow(1100, 780);
  const run = runOf(
    'run-3',
    'running',
    {
      'block-1': { state: 'done', said: 'The empty state is in.', turns: 2, spent: SPENT },
      'block-2': { state: 'done', said: 'Checks pass.', turns: 1, spent: SPENT },
      'block-3': { state: 'running' },
    },
    A_LANE,
  );
  if (!seedCanvas(project, oneCanvas('flow-seeded-dark', [run], SEED_AT + 12))) {
    bad('no canvas could be seeded');
    return;
  }
  if (!(await reloadIntoProject())) {
    bad('the project did not come back after reloading');
    return;
  }
  await chooseTheme('Dark');
  await escapeFrom('.settings');
  await window_.emulateMedia({ colorScheme: 'dark' });
  await pause(400);
  if (!(await openTheCanvas())) {
    bad('the row in the sidebar did not open the canvas');
    return;
  }
  await pause(900);
  await shot('canvas-drawn-dark');
  const mark = await window_.evaluate(() => document.documentElement.getAttribute('data-theme'));
  verdict(`the document is stamped dark (${String(mark)})`, mark === 'dark');
  const said = await canvasState(window_);
  verdict(
    `the board is drawn the same way in the dark palette (${String(said.cards)} cards, ${String(said.swept)} running)`,
    said.cards === 3 && said.swept === 1,
  );
  /* Nothing on the board may be written in a colour that only works on paper:
     the ink has to be a palette token, which is what a ratio against the ground
     it really sits on catches. */
  const looked = [
    { sel: '.canvas__name', what: "a block's name" },
    { sel: '.canvas__state', what: 'the state beside it' },
    { sel: '.canvas__says', what: 'the first line of what it does' },
    { sel: '.canvas__title', what: 'what the canvas is called' },
  ];
  const measured = await colours(window_, looked.map((one) => one.sel));
  for (const [index, each] of measured.entries()) {
    const label = looked[index].what;
    if (each.missing === true) {
      bad(`dark: ${label} is not on screen, so nothing about it could be measured`);
      continue;
    }
    const needed = each.large === true ? 3 : 4.5;
    verdict(
      `dark: ${label} reads at ${String(each.ratio)}:1 (needs ${String(needed)})`,
      each.ratio !== null && each.ratio >= needed,
    );
    if (each.ratio === null || each.ratio < needed) {
      bad(`dark: ${label} is ${each.ink} on ${each.ground} — a colour that was chosen for paper`);
    }
  }
  // And back, because the renderer keeps a hand-picked theme between loads and
  // every row after this one would inherit it.
  await chooseTheme('Light');
  await escapeFrom('.settings');
  await window_.emulateMedia({ colorScheme: null });
  await until(
    async () => (await window_.evaluate(() => document.documentElement.getAttribute('data-theme'))) === 'light',
    6_000,
  );
  await layoutHolds('canvas, dark: ', { composer: false });
});

await row('canvas-drawn-900', 'the same canvas at a 900px window, where the palette folds to its marks', async () => {
  await ensureProjectOpen();
  if (!seedCanvas(project, oneCanvas('flow-seeded-narrow', [], SEED_AT + 15))) {
    bad('no canvas could be seeded');
    return;
  }
  await sizeWindow(900, 700);
  if (!(await reloadIntoProject())) {
    bad('the project did not come back after reloading');
    return;
  }
  if (!(await openTheCanvas())) {
    bad('the row in the sidebar did not open the canvas');
    return;
  }
  await pause(900);
  await shot('canvas-drawn-900');
  const said = await canvasState(window_);
  const view = await viewport(window_);
  note(`at a ${String(view.w)}×${String(view.h)} page the canvas band is ${String(said.bandsWidth)}px wide`);
  verdict(
    `the palette folds to its marks rather than squeezing the board (${String(said.railWidth)}px of rail, the words beside them are ${String(said.picktext)})`,
    said.railWidth === 56 && said.picktext === 'none',
  );
  if (said.railWidth !== 56) {
    bad(`the palette is still ${String(said.railWidth)}px wide at ${String(said.bandsWidth)}px of board, so the drawing lost room it did not have to`);
  }
  verdict(`every kind still has its mark to press (${String(said.picks)})`, said.picks === 10);
  /* A folded template is four marks nobody can tell apart from a block, so the
     templates keep their words or they are not drawn at all. */
  verdict(`the folded template list is not drawn (${String(said.loopband)})`, said.loopband === 'none');
  verdict(`the board still holds every card it was given (${String(said.cards)})`, said.cards === 3);
  /* The board is wider than the room at this size, and the surface is what
     holds it: a card that hangs off is one the board pans to reach, and a card
     that hangs off the *window* is one nothing can reach. */
  const [canvasBox] = await boxes(window_, ['.canvas']);
  const [rail] = await boxes(window_, ['.canvas__rail']);
  const [surface] = await boxes(window_, ['.canvas__surface']);
  const [firstCard] = await boxes(window_, ['.canvas__card']);
  verdict('the canvas is inside the window', inside(canvasBox, view));
  verdict('and so is the folded palette', inside(rail, view));
  verdict('and the board that clips and pans the drawing', inside(surface, view));
  verdict(
    'with the first card drawn inside the board, so there is something to take hold of',
    firstCard.missing !== true && firstCard.x >= surface.x - 1 && firstCard.y >= surface.y - 1,
  );
  note(`the board is ${String(surface.w)}px wide holding ${String(said.lines)} lines and ${String(said.cards)} cards`);
  await layoutHolds('canvas at 900: ', { composer: false });
  await sizeWindow(1100, 780);
});

await row('tokens', "the project's own values, read off its stylesheets and drawn read-only", async () => {
  await ensureProjectOpen();
  mkdirSync(join(project, 'src', 'styles'), { recursive: true });
  writeFileSync(join(project, 'src', 'styles', 'tokens.css'), TOKENS_SHEET);
  if (!(await reloadIntoProject())) {
    bad('the project did not come back after reloading, so the sheet was never read');
    return;
  }
  // Wide enough that the panel still has a column of its own: it gives way at
  // 1067px with the shelf open.
  await sizeWindow(1400, 900);
  const band = await until(async () => (await window_.locator('.tokens').count()) > 0, 30_000);
  if (!band) {
    bad('the panel draws no Tokens band for a project whose stylesheet declares values in :root');
    await shot('tokens');
    return;
  }
  await shot('tokens');
  const read = await window_.evaluate(() => {
    const rows = [...document.querySelectorAll('.tokens__row')];
    return {
      rows: rows.length,
      shelves: [...document.querySelectorAll('.tokens__caption')].map((one) =>
        // The caption carries its own count in a span, so the title is the
        // caption's first text node rather than all of it.
        (one.firstChild?.textContent ?? one.textContent ?? '').trim(),
      ),
      cells: rows.map((row) => ({
        name: (row.querySelector('.tokens__name')?.textContent ?? '').trim(),
        value: (row.querySelector('.tokens__value')?.textContent ?? '').trim(),
        well: row.querySelector('.tokens__well') !== null,
        used: (row.querySelector('.tokens__used')?.textContent ?? '').trim(),
        place: (row.querySelector('.tokens__place')?.textContent ?? '').trim(),
        label: row.querySelector('.tokens__place')?.getAttribute('aria-label') ?? '',
        title: row.querySelector('.tokens__place')?.getAttribute('title') ?? '',
      })),
      from: (document.querySelector('.tokens__from')?.textContent ?? '').trim(),
      count: (document.querySelector('.tokens__count')?.textContent ?? '').trim(),
      find: document.querySelector('.tokens__find')?.getAttribute('aria-label') ?? null,
      width: Math.round(document.querySelector('.tokens')?.getBoundingClientRect().width ?? 0),
      height: Math.round(document.querySelector('.tokens')?.getBoundingClientRect().height ?? 0),
    };
  });
  const names = read.cells.map((one) => one.name);
  verdict(`every value the stylesheet declares is a row (${String(read.rows)} rows, ${String(read.count)})`, read.rows >= 9);
  verdict(
    `read off the file rather than invented (${names.join(', ')})`,
    ['--ink', '--paper', '--accent', '--space-2', '--radius-sm', '--shadow-card', '--text-sm', '--font-ui'].every((one) =>
      names.includes(one),
    ),
  );
  verdict(
    `and sorted onto shelves somebody can read down (${read.shelves.join(', ')})`,
    read.shelves.includes('Colour') && read.shelves.includes('Spacing') && read.shelves.length >= 3,
  );
  const colour = read.cells.find((one) => one.name === '--accent');
  verdict(
    `a colour gets a swatch as well as its value (--accent ${String(colour?.value ?? 'missing')})`,
    colour !== undefined && colour.well === true,
  );
  if (colour === undefined) bad('no --accent row was drawn, so the swatch could not be checked');
  const used = read.cells.find((one) => one.name === '--ink');
  verdict(
    `a value the project reaches for says how often (--ink used ${String(used?.used ?? '')} times)`,
    used !== undefined && Number(used.used) > 0,
  );
  if (used === undefined || Number(used.used) === 0) {
    bad('the Used column is blank for a value the sheet reaches for with var(), so nothing counted the uses');
  }
  verdict(`the reading says how wide it was ("${read.from}")`, /^From \d+ stylesheets?$/.test(read.from));
  const place = read.cells.find((one) => one.place !== '');
  verdict(
    `every row says where the value is written ("${String(place?.place ?? '')}")`,
    place !== undefined && /^.+\.css:\d+$/.test(place.place),
  );
  verdict(
    `and that is a press, named for what it does ("${String(place?.label.slice(0, 44) ?? '')}")`,
    place !== undefined && /^Open .+ in your editor$/.test(place.label) && place.title === 'Open in editor',
  );
  verdict(`the band has a search field named for what it finds ("${String(read.find)}")`, read.find === 'Find a value');
  note(`the band is ${String(read.width)}×${String(read.height)}px inside the panel`);
  verdict('and nothing in it edits anything', (await window_.locator('.tokens button:not(.tokens__place)').count()) === 0);

  // The field filters, and a term that matches nothing says so rather than
  // leaving a blank table behind.
  const find = window_.locator('.tokens__find').first();
  await find.fill('accent');
  await pause(400);
  const narrowed = await window_.locator('.tokens__row').count();
  verdict(`typing narrows the table (${String(read.rows)} rows → ${String(narrowed)})`, narrowed > 0 && narrowed < read.rows);
  await find.fill('nothing-is-called-this');
  const none = await until(async () => (await window_.locator('.tokens__none').count()) > 0, 6_000);
  verdict('a term that matches nothing says so rather than drawing a blank table', none);
  if (none) note(`it says: ${(await window_.locator('.tokens__none').first().innerText()).trim()}`);
  await find.fill('');
  await pause(300);
  await shot('tokens-filtered');
  await layoutHolds('tokens band: ', { composer: false });

  /* And absent rather than empty: a folder whose stylesheets declare nothing has
     no design system to show, and a heading over a blank table would say only
     that something is missing. Reached from the sidebar, which is where the
     folders are listed. */
  const elsewhere = window_.locator('.shelf__list .shelf__row', { hasText: PLAIN_PROJECT.slice(0, 30) }).first();
  if ((await elsewhere.count()) === 0) {
    bad('the folder with nothing declared in it is not in the sidebar, so absence could not be reached');
    return;
  }
  await elsewhere.click();
  const arrived = await until(
    async () => (await window_.locator('.topbar__name').innerText()).includes(PLAIN_PROJECT.slice(0, 30)),
    30_000,
  );
  verdict('the sidebar opens a folder with no stylesheet in it', arrived);
  if (!arrived) return;
  await until(async () => (await window_.locator('.overview').count()) > 0, 30_000);
  await pause(900);
  await shot('tokens-absent');
  verdict(
    `and the band is absent there rather than empty (${String(await window_.locator('.tokens').count())} bands)`,
    (await window_.locator('.tokens').count()) === 0,
  );
  await window_.locator('.shelf__list .shelf__row', { hasText: PROJECT }).first().click();
  await until(async () => (await window_.locator('.topbar__name').innerText()).includes(PROJECT), 30_000);
  await sizeWindow(1100, 780);
});

/* -------------------------------------------------------------------------- */
/* What was found, and what only a person can find                             */
/* -------------------------------------------------------------------------- */

writeFileSync(
  join(scratch, 'visual-matrix.json'),
  `${JSON.stringify(
    {
      at: new Date().toISOString(),
      app: found,
      display,
      node: process.version,
      platform: `${process.platform} ${process.arch}`,
      electron: await app.evaluate(({ app: electronApp }) => electronApp.getVersion()),
      rows: results.map((one) => ({
        id: one.id,
        what: one.what,
        shot: one.shot === null ? null : one.shot.slice(root.length),
        checks: one.checks,
        notes: one.notes,
      })),
      failed,
    },
    null,
    2,
  )}\n`,
);

await app.close().catch(() => undefined);
if (served !== null) await served.stop();
if (!keep) rmSync(home, { recursive: true, force: true });

const rows = results.length;
const checks = results.reduce((all, one) => all + one.checks.length, 0);
console.log(`\n${String(rows)} rows, ${String(checks)} checks, ${String(failed)} failed.`);
const broken = results.filter((one) => one.checks.some((each) => !each.ok));
if (broken.length > 0) {
  console.log('\nWhat failed, by row:');
  for (const one of broken) {
    const first = one.checks.find((each) => !each.ok);
    const count = one.checks.filter((each) => !each.ok).length;
    console.log(`  ${one.id} (${String(count)}): ${first === undefined ? '' : first.says}`);
  }
}
console.log(`Screenshots and results: ${scratch.slice(root.length)}`);
console.log(
  '\nA machine cannot check, and this run does not claim:\n' +
    '  · what a screen reader says out loud. The tree is read above — roles, names, order, selected,\n' +
    '    disabled, and what a modal accounts for — but the speech, the verbosity and the rotor are\n' +
    "    VoiceOver's, and a name that reads badly is a person's judgement.\n" +
    '  · a monitor being unplugged while the window is open (the off-screen restore is above).\n' +
    '  · the OS switches themselves: the settings in System Settings are emulated through the protocol,\n' +
    '    which is the same signal the CSS and the renderer see, but not the act of changing them.\n' +
    '  · the native file dialog, and a native page view under an overlay.\n' +
    '  · whether a ratio that passes the arithmetic reads well to an eye.\n' +
    '  · the platform\'s own high-contrast palette: forced-colors is emulated, so what is measured is the\n' +
    '    renderer\'s answer to it, not what macOS draws.\n',
);
process.exit(failed === 0 ? 0 : 1);
