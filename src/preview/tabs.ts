/** The page pane as a browser: tabs, where each has been, and what went wrong.
 *
 * The pane shows one address today, so going back means retyping and a page that
 * printed an error printed it to nobody. Everything a person actually does with
 * a browser while building a site — open the other page, go back, see what the
 * console said, look at it on a phone, notice the request that 404'd — is state,
 * and all of it is here as plain data with plain functions over it.
 *
 * The address bar suggests the servers that are running, because those are the
 * addresses that exist. Nobody should have to remember a port.
 *
 * Pure. The native view is driven from what these return; nothing here loads
 * anything.
 */

import { WIDTHS, type Width } from '../design/widths';

/* -------------------------------------------------------------------------- */
/* The shape of it                                                             */
/* -------------------------------------------------------------------------- */

export type Level = 'note' | 'warning' | 'problem';

/** One tab, and everywhere it has been. `step` is where in `been` it is
 *  standing, so back and forward are moving an index rather than keeping two
 *  stacks that can disagree. */
export type PageTab = {
  id: string;
  /** What the tab says. The page's own title once it has one, the address
   *  until then. */
  title: string;
  /** Everywhere it has been, oldest first. */
  been: readonly string[];
  step: number;
  loading: boolean;
};

/** Something the page printed. Repeats are counted rather than repeated: a
 *  React warning in a render loop is one problem, not four hundred. */
export type Said = {
  id: string;
  level: Level;
  text: string;
  /** The file and line it came from, where the page said. */
  where: string | null;
  many: number;
};

/** A request the page made that did not come back with a page. */
export type Failure = {
  id: string;
  /** Null when the request never reached anything at all. */
  status: number | null;
  url: string;
  many: number;
};

export type Pane = {
  tabs: readonly PageTab[];
  /** Which tab is in front. */
  at: string | null;
  said: readonly Said[];
  failed: readonly Failure[];
  /** Which device preset the page is drawn at. */
  device: string;
  /** Whether the console drawer is open. */
  drawer: boolean;
};

/** How many of each to keep. A page in a loop prints thousands, and the last
 *  few dozen are the ones anybody reads. */
export const MOST_NOTES = 60;
export const MOST_FAILURES = 40;
/** More tabs than this and the strip is a scroll bar with words on it. */
export const MOST_TABS = 8;

export const tabsWords = {
  newTab: 'New tab',
  close: 'Close this tab',
  back: 'Back',
  forward: 'Forward',
  reload: 'Load it again',
  address: 'Address',
  addressHint: 'Type an address, or pick one of the servers running here',
  console: 'What the page said',
  consoleEmpty: 'The page has not complained about anything.',
  network: 'Requests that did not come back',
  fixThis: 'Fix this',
  fixAll: 'Fix these',
  blank: 'New tab',
  /** Over the drawer, when there is something worth handing to the agent. */
  worth: (many: number): string =>
    many === 1 ? 'One problem on this page.' : `${String(many)} problems on this page.`,
  /** On a failure chip. */
  saysFailure: (one: Failure): string =>
    one.status === null ? `Never answered: ${one.url}` : `${String(one.status)}: ${one.url}`,
  full: `That is ${String(MOST_TABS)} tabs, which is as many as fit. Close one first.`,
} as const;

/* -------------------------------------------------------------------------- */
/* Addresses                                                                   */
/* -------------------------------------------------------------------------- */

/** What was typed, as an address — or null when it is not one.
 *
 *  `localhost:3000` and `:3000` are what people actually type at a dev server,
 *  and neither is a URL until something puts a scheme on the front. Anything
 *  with a space in it, or no dot and no port, is not an address and is not
 *  quietly turned into a search: there is no search here. */
export function asAddress(typed: string): string | null {
  const said = typed.trim();
  if (said === '' || /\s/.test(said)) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(said)) return said;
  if (/^:\d{2,5}(\/|$)/.test(said)) return `http://localhost${said}`;
  if (/^localhost(:\d{2,5})?(\/|$)/i.test(said)) return `http://${said}`;
  if (/^\d{1,3}(\.\d{1,3}){3}(:\d{2,5})?(\/|$)/.test(said)) return `http://${said}`;
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d{2,5})?(\/|$)/i.test(said)) return `https://${said}`;
  return null;
}

/** How an address reads on a tab or in the bar: no scheme, no trailing slash.
 *  The scheme is never the thing anybody is looking at. */
export function shortAddress(address: string): string {
  return address
    .replace(/^https?:\/\//i, '')
    .replace(/\/$/, '');
}

export type Suggestion = {
  /** The address to go to. */
  address: string;
  /** What it is called — a server's own name, or the address itself. */
  name: string;
  /** Where it came from, so the list can say. */
  from: 'running' | 'been';
};

/** What a server on the shelf looks like from here. */
export type ServerHere = { label: string; address: string | null };

/**
 * What to offer under the address bar.
 *
 * The running servers first, always, and whether or not anything has been
 * typed: they are the addresses that exist right now, and the whole point is
 * that nobody has to remember a port. Then wherever this pane has already been.
 */
export function suggestions(
  typed: string,
  servers: readonly ServerHere[],
  been: readonly string[] = [],
): readonly Suggestion[] {
  const wanted = typed.trim().toLowerCase();
  const seen = new Set<string>();
  const out: Suggestion[] = [];

  const add = (address: string, name: string, from: Suggestion['from']): void => {
    if (seen.has(address)) return;
    seen.add(address);
    out.push({ address, name, from });
  };

  for (const server of servers) {
    if (server.address === null) continue;
    add(server.address, server.label, 'running');
  }
  for (const address of been) add(address, shortAddress(address), 'been');

  if (wanted === '') return out;
  return out.filter(
    (one) =>
      one.address.toLowerCase().includes(wanted) || one.name.toLowerCase().includes(wanted),
  );
}

/* -------------------------------------------------------------------------- */
/* Tabs and history                                                            */
/* -------------------------------------------------------------------------- */

export const BLANK = '';

function tabId(tabs: readonly PageTab[]): string {
  const numbers = tabs.map((one) => Number(/^page-(\d+)$/.exec(one.id)?.[1] ?? 0));
  return `page-${String(Math.max(0, ...numbers) + 1)}`;
}

/** A pane with one empty tab in it, which is what an unopened pane is. */
export function emptyPane(): Pane {
  const first: PageTab = { id: 'page-1', title: tabsWords.blank, been: [], step: -1, loading: false };
  return { tabs: [first], at: first.id, said: [], failed: [], device: 'fit', drawer: false };
}

export function tabAt(pane: Pane): PageTab | null {
  return pane.tabs.find((one) => one.id === pane.at) ?? null;
}

/** Where a tab is pointed, or null while it is blank. */
export function addressOf(tab: PageTab | null): string | null {
  if (tab === null) return null;
  return tab.been[tab.step] ?? null;
}

/** Where the pane is pointed. */
export function addressIn(pane: Pane): string | null {
  return addressOf(tabAt(pane));
}

/** Open a tab. A blank one when no address is given, which is what the plus
 *  button does. */
export function openTab(pane: Pane, address: string | null = null): Pane {
  if (pane.tabs.length >= MOST_TABS) return pane;
  const id = tabId(pane.tabs);
  const tab: PageTab = {
    id,
    title: address === null ? tabsWords.blank : shortAddress(address),
    been: address === null ? [] : [address],
    step: address === null ? -1 : 0,
    loading: address !== null,
  };
  return { ...pane, tabs: [...pane.tabs, tab], at: id };
}

/** Close one. The last tab closing leaves a blank one rather than an empty
 *  pane: a pane with no tabs is a pane with nothing to press. */
export function closeTab(pane: Pane, id: string): Pane {
  const at = pane.tabs.findIndex((one) => one.id === id);
  if (at === -1) return pane;
  const left = pane.tabs.filter((one) => one.id !== id);
  if (left.length === 0) return { ...emptyPane(), device: pane.device, drawer: pane.drawer };
  const front = pane.at !== id ? pane.at : (left[at] ?? left[at - 1] ?? left[0])?.id ?? null;
  return { ...pane, tabs: left, at: front };
}

export function pickTab(pane: Pane, id: string): Pane {
  return pane.tabs.some((one) => one.id === id) ? { ...pane, at: id } : pane;
}

/**
 * Go somewhere in the tab that is in front.
 *
 * Anything forward of where it is standing is dropped, because that is what a
 * browser does and what a person expects: going back and then somewhere else
 * makes the branch you did not take unreachable. Going to where it already is
 * is a reload, not a second entry in the history.
 */
export function goTo(pane: Pane, address: string): Pane {
  const tab = tabAt(pane);
  if (tab === null) return pane;
  const where = asAddress(address) ?? address;
  const here = addressOf(tab);
  const been = here === where ? tab.been : [...tab.been.slice(0, tab.step + 1), where];
  const step = here === where ? tab.step : been.length - 1;
  return {
    ...pane,
    tabs: pane.tabs.map((one) =>
      one.id === tab.id
        ? { ...one, been, step, loading: true, title: shortAddress(where) }
        : one,
    ),
    // A new page starts with nothing against it: the last page's errors are
    // not this page's.
    said: [],
    failed: [],
  };
}

export function canBack(pane: Pane): boolean {
  const tab = tabAt(pane);
  return tab !== null && tab.step > 0;
}

export function canForward(pane: Pane): boolean {
  const tab = tabAt(pane);
  return tab !== null && tab.step < tab.been.length - 1;
}

function stepBy(pane: Pane, by: number): Pane {
  const tab = tabAt(pane);
  if (tab === null) return pane;
  const step = tab.step + by;
  if (step < 0 || step >= tab.been.length) return pane;
  return {
    ...pane,
    tabs: pane.tabs.map((one) =>
      one.id === tab.id
        ? { ...one, step, loading: true, title: shortAddress(one.been[step] ?? '') }
        : one,
    ),
    said: [],
    failed: [],
  };
}

export function back(pane: Pane): Pane {
  return stepBy(pane, -1);
}

export function forward(pane: Pane): Pane {
  return stepBy(pane, 1);
}

/** The page finished loading, and said what it is called. */
export function loaded(pane: Pane, id: string, title?: string): Pane {
  return {
    ...pane,
    tabs: pane.tabs.map((one) =>
      one.id === id
        ? {
            ...one,
            loading: false,
            title: (title ?? '').trim() === '' ? one.title : (title ?? '').trim(),
          }
        : one,
    ),
  };
}

/* -------------------------------------------------------------------------- */
/* The console drawer                                                          */
/* -------------------------------------------------------------------------- */

function sameNote(one: Said, level: Level, text: string, where: string | null): boolean {
  return one.level === level && one.text === text && one.where === where;
}

/**
 * Something the page printed.
 *
 * The same message arriving again bumps a count rather than adding a row —
 * a warning inside a render is printed on every render, and sixty copies of one
 * sentence is a drawer with nothing readable in it.
 */
export function noteFromPage(
  pane: Pane,
  level: Level,
  text: string,
  where: string | null = null,
): Pane {
  const said = text.trim();
  if (said === '') return pane;
  const already = pane.said.findIndex((one) => sameNote(one, level, said, where));
  if (already !== -1) {
    return {
      ...pane,
      said: pane.said.map((one, at) => (at === already ? { ...one, many: one.many + 1 } : one)),
    };
  }
  const one: Said = { id: `said-${String(pane.said.length + 1)}`, level, text: said, where, many: 1 };
  const kept = [...pane.said, one];
  return { ...pane, said: kept.slice(Math.max(0, kept.length - MOST_NOTES)) };
}

/** A request that came back wrong, or never came back. */
export function noteFailure(pane: Pane, status: number | null, url: string): Pane {
  const where = url.trim();
  if (where === '') return pane;
  const already = pane.failed.findIndex((one) => one.status === status && one.url === where);
  if (already !== -1) {
    return {
      ...pane,
      failed: pane.failed.map((one, at) => (at === already ? { ...one, many: one.many + 1 } : one)),
    };
  }
  const one: Failure = { id: `failed-${String(pane.failed.length + 1)}`, status, url: where, many: 1 };
  const kept = [...pane.failed, one];
  return { ...pane, failed: kept.slice(Math.max(0, kept.length - MOST_FAILURES)) };
}

/** Everything against this page thrown away — it navigated, and the last page's
 *  complaints are not this one's. */
export function forgetTrouble(pane: Pane): Pane {
  return { ...pane, said: [], failed: [] };
}

export function openDrawer(pane: Pane, open: boolean): Pane {
  return { ...pane, drawer: open };
}

/** Noise a browser prints about itself, or about somebody else's script, which
 *  nothing in this project can fix. */
const NOT_OURS =
  /(favicon\.ico|DevTools|chrome-extension:|Download the React DevTools|\[HMR\]|\[vite\] connect(ing|ed))/i;

/**
 * Which of these are worth handing to the agent.
 *
 * Problems, and warnings that name a file — those are the page telling you
 * about your own code. A note is a `console.log` somebody left in, and a
 * warning with no source is usually a library talking about itself; neither is
 * a thing to go and fix.
 */
export function worthFixing(entries: readonly Said[]): readonly Said[] {
  return entries.filter((one) => {
    if (NOT_OURS.test(one.text)) return false;
    if (one.level === 'problem') return true;
    return one.level === 'warning' && one.where !== null;
  });
}

/** The sentence "Fix this" puts in the composer. Names what the page said and
 *  where, and asks for nothing else — the agent has the page open. */
export function saysFixThis(
  entries: readonly Said[],
  failures: readonly Failure[] = [],
): string | null {
  const worth = worthFixing(entries);
  if (worth.length === 0 && failures.length === 0) return null;
  const lines = [
    ...worth.map(
      (one) => `- ${one.text}${one.where === null ? '' : ` (${one.where})`}${one.many > 1 ? ` (${String(one.many)} times)` : ''}`,
    ),
    ...failures.map((one) => `- ${tabsWords.saysFailure(one)}`),
  ];
  return [
    'The page open beside this conversation is complaining about these. Find out why and fix them:',
    ...lines,
  ].join('\n');
}

/* -------------------------------------------------------------------------- */
/* Device presets                                                              */
/* -------------------------------------------------------------------------- */

/** `fit` is the pane itself, which is what somebody is looking at until they
 *  ask a question about a size. The rest are the widths the design view already
 *  photographs at, so "it looked fine on the phone" means the same width in
 *  both places. */
export type Device = { id: string; name: string; width: number | null; height: number | null };

export const DEVICES: readonly Device[] = [
  { id: 'fit', name: 'Fit the window', width: null, height: null },
  ...WIDTHS.map((one: Width) => ({
    id: one.id,
    name: one.name,
    width: one.width,
    height: one.height,
  })),
];

export function deviceOf(id: string): Device {
  return DEVICES.find((one) => one.id === id) ?? (DEVICES[0] as Device);
}

export function pickDevice(pane: Pane, id: string): Pane {
  return DEVICES.some((one) => one.id === id) ? { ...pane, device: id } : pane;
}

/** How wide to draw the page in a pane this wide. `fit` and anything wider than
 *  the room fills it, so a desktop preset in a narrow pane is the pane rather
 *  than a page cut off at the edge. */
export function widthIn(pane: Pane, room: number): number {
  const device = deviceOf(pane.device);
  if (device.width === null) return room;
  return Math.min(device.width, room);
}
