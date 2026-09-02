/** The page pane as a browser.
 *
 * Tabs with a history, an address bar that knows what is running, a drawer of
 * what the page complained about, and the sizes to look at it in. All of it is
 * state and functions over state, so what is checked here is the behaviour a
 * person would notice: going back after going somewhere else, a warning printed
 * four hundred times reading as one, and a 404 that is somebody's favicon not
 * being offered as work.
 */

import { describe, expect, it } from 'vitest';

import {
  BLANK,
  DEVICES,
  MOST_NOTES,
  MOST_TABS,
  addressIn,
  asAddress,
  back,
  canBack,
  canForward,
  closeTab,
  deviceOf,
  emptyPane,
  forgetTrouble,
  forward,
  goTo,
  loaded,
  noteFailure,
  noteFromPage,
  openDrawer,
  openTab,
  pickDevice,
  pickTab,
  saysFixThis,
  shortAddress,
  suggestions,
  tabAt,
  tabsWords,
  widthIn,
  worthFixing,
  type Failure,
  type Pane,
} from '../src/preview/tabs';

const RUNNING = [
  { label: 'npm run dev', address: 'http://localhost:5173' },
  { label: 'npm run api', address: 'http://localhost:8787' },
  { label: 'a worker', address: null },
];

function at(address: string): Pane {
  return goTo(emptyPane(), address);
}

describe('what counts as an address', () => {
  it('takes what people actually type at a dev server', () => {
    expect(asAddress('localhost:5173')).toBe('http://localhost:5173');
    expect(asAddress(':3000')).toBe('http://localhost:3000');
    expect(asAddress('127.0.0.1:8080/about')).toBe('http://127.0.0.1:8080/about');
    expect(asAddress('example.com')).toBe('https://example.com');
    expect(asAddress('http://localhost:5173/about')).toBe('http://localhost:5173/about');
  });

  it('says no rather than turning a sentence into a search', () => {
    expect(asAddress('fix the header')).toBeNull();
    expect(asAddress('')).toBeNull();
    expect(asAddress('nonsense')).toBeNull();
  });

  it('reads an address without the part nobody looks at', () => {
    expect(shortAddress('http://localhost:5173/')).toBe('localhost:5173');
    expect(shortAddress('https://example.com/about')).toBe('example.com/about');
  });
});

describe('the address bar', () => {
  it('offers the servers that are running before anything is typed', () => {
    const found = suggestions('', RUNNING);
    expect(found.map((one) => one.address)).toEqual([
      'http://localhost:5173',
      'http://localhost:8787',
    ]);
    expect(found[0]?.name).toBe('npm run dev');
    expect(found[0]?.from).toBe('running');
  });

  it('leaves out the ones with nowhere to go', () => {
    expect(suggestions('', RUNNING)).toHaveLength(2);
  });

  it('finds one by its port or by what it is called', () => {
    expect(suggestions('8787', RUNNING).map((one) => one.address)).toEqual([
      'http://localhost:8787',
    ]);
    expect(suggestions('api', RUNNING).map((one) => one.name)).toEqual(['npm run api']);
  });

  it('offers where the pane has already been, after the servers', () => {
    const found = suggestions('', RUNNING, ['http://localhost:5173/about']);
    expect(found[found.length - 1]?.from).toBe('been');
    // And never the same address twice.
    expect(new Set(found.map((one) => one.address)).size).toBe(found.length);
  });
});

describe('tabs', () => {
  it('starts as one blank tab', () => {
    const pane = emptyPane();
    expect(pane.tabs).toHaveLength(1);
    expect(addressIn(pane)).toBeNull();
    expect(tabAt(pane)?.title).toBe(tabsWords.blank);
  });

  it('opens another and puts it in front', () => {
    const pane = openTab(at('http://localhost:5173'), 'http://localhost:8787');
    expect(pane.tabs).toHaveLength(2);
    expect(addressIn(pane)).toBe('http://localhost:8787');
  });

  it('stops at as many tabs as fit', () => {
    let pane = emptyPane();
    for (let n = 0; n < MOST_TABS + 4; n += 1) pane = openTab(pane, `http://localhost:${String(5000 + n)}`);
    expect(pane.tabs).toHaveLength(MOST_TABS);
  });

  it('leaves a blank tab rather than an empty pane', () => {
    const pane = at('http://localhost:5173');
    const closed = closeTab(pane, tabAt(pane)?.id ?? '');
    expect(closed.tabs).toHaveLength(1);
    expect(addressIn(closed)).toBeNull();
  });

  it('puts the next tab in front when the one in front closes', () => {
    let pane = at('http://localhost:5173');
    pane = openTab(pane, 'http://localhost:8787');
    const second = tabAt(pane)?.id ?? '';
    pane = closeTab(pane, second);
    expect(addressIn(pane)).toBe('http://localhost:5173');
  });

  it('switches between them', () => {
    let pane = at('http://localhost:5173');
    const first = tabAt(pane)?.id ?? '';
    pane = openTab(pane, 'http://localhost:8787');
    expect(addressIn(pickTab(pane, first))).toBe('http://localhost:5173');
  });

  it('takes the page’s own title once it has one', () => {
    const pane = at('http://localhost:5173');
    const named = loaded(pane, tabAt(pane)?.id ?? '', 'Paper Street');
    expect(tabAt(named)?.title).toBe('Paper Street');
    expect(tabAt(named)?.loading).toBe(false);
  });
});

describe('back and forward', () => {
  it('walks back through where it has been', () => {
    let pane = at('http://localhost:5173');
    pane = goTo(pane, 'http://localhost:5173/about');
    pane = goTo(pane, 'http://localhost:5173/pricing');
    expect(canBack(pane)).toBe(true);
    expect(canForward(pane)).toBe(false);

    pane = back(pane);
    expect(addressIn(pane)).toBe('http://localhost:5173/about');
    expect(canForward(pane)).toBe(true);

    pane = forward(pane);
    expect(addressIn(pane)).toBe('http://localhost:5173/pricing');
  });

  it('has nowhere to go back to on a fresh tab', () => {
    const pane = at('http://localhost:5173');
    expect(canBack(pane)).toBe(false);
    expect(back(pane)).toBe(pane);
    expect(forward(pane)).toBe(pane);
  });

  /* Going back and then somewhere else makes the branch you did not take
     unreachable, which is what every browser does and what a hand expects. */
  it('drops what was ahead once it goes somewhere else', () => {
    let pane = at('http://localhost:5173');
    pane = goTo(pane, 'http://localhost:5173/about');
    pane = back(pane);
    pane = goTo(pane, 'http://localhost:5173/pricing');
    expect(canForward(pane)).toBe(false);
    expect(tabAt(pane)?.been).toEqual(['http://localhost:5173', 'http://localhost:5173/pricing']);
  });

  it('reads going to the same place again as loading it again', () => {
    let pane = at('http://localhost:5173');
    pane = goTo(pane, 'http://localhost:5173');
    expect(tabAt(pane)?.been).toHaveLength(1);
    expect(tabAt(pane)?.loading).toBe(true);
  });

  it('tidies an address typed short', () => {
    const pane = goTo(emptyPane(), 'localhost:5173');
    expect(addressIn(pane)).toBe('http://localhost:5173');
  });
});

describe('what the page said', () => {
  it('counts a repeat rather than printing it again', () => {
    let pane = at('http://localhost:5173');
    for (let n = 0; n < 400; n += 1) {
      pane = noteFromPage(pane, 'warning', 'Each child needs a key', 'App.tsx:12');
    }
    expect(pane.said).toHaveLength(1);
    expect(pane.said[0]?.many).toBe(400);
  });

  it('keeps the last few dozen and no more', () => {
    let pane = at('http://localhost:5173');
    for (let n = 0; n < MOST_NOTES + 40; n += 1) {
      pane = noteFromPage(pane, 'note', `line ${String(n)}`);
    }
    expect(pane.said).toHaveLength(MOST_NOTES);
    expect(pane.said[pane.said.length - 1]?.text).toBe(`line ${String(MOST_NOTES + 39)}`);
  });

  it('forgets the last page’s complaints when it goes somewhere else', () => {
    let pane = noteFromPage(at('http://localhost:5173'), 'problem', 'boom');
    pane = noteFailure(pane, 500, 'http://localhost:5173/api/me');
    pane = goTo(pane, 'http://localhost:5173/about');
    expect(pane.said).toEqual([]);
    expect(pane.failed).toEqual([]);
  });

  it('forgets them on request too', () => {
    const pane = noteFromPage(at('http://localhost:5173'), 'problem', 'boom');
    expect(forgetTrouble(pane).said).toEqual([]);
  });

  it('opens and closes the drawer', () => {
    expect(openDrawer(emptyPane(), true).drawer).toBe(true);
    expect(openDrawer(openDrawer(emptyPane(), true), false).drawer).toBe(false);
  });
});

describe('what is worth fixing', () => {
  it('takes the problems, and the warnings that name a file', () => {
    let pane = at('http://localhost:5173');
    pane = noteFromPage(pane, 'problem', 'Cannot read properties of undefined', 'App.tsx:12');
    pane = noteFromPage(pane, 'warning', 'Each child needs a key', 'List.tsx:30');
    pane = noteFromPage(pane, 'warning', 'something a library says about itself');
    pane = noteFromPage(pane, 'note', 'here');
    expect(worthFixing(pane.said).map((one) => one.text)).toEqual([
      'Cannot read properties of undefined',
      'Each child needs a key',
    ]);
  });

  it('leaves out what nothing in this project can fix', () => {
    let pane = at('http://localhost:5173');
    pane = noteFromPage(pane, 'problem', 'Failed to load resource: favicon.ico');
    pane = noteFromPage(pane, 'problem', 'Download the React DevTools for a better experience');
    expect(worthFixing(pane.said)).toEqual([]);
  });

  it('has nothing to send when the page is quiet', () => {
    expect(saysFixThis([])).toBeNull();
    expect(saysFixThis(emptyPane().said, emptyPane().failed)).toBeNull();
  });

  it('names what it saw and where, in the sentence it sends', () => {
    let pane = at('http://localhost:5173');
    pane = noteFromPage(pane, 'problem', 'boom', 'App.tsx:12');
    pane = noteFromPage(pane, 'problem', 'boom', 'App.tsx:12');
    pane = noteFailure(pane, 500, 'http://localhost:5173/api/me');
    const says = saysFixThis(pane.said, pane.failed) ?? '';
    expect(says).toContain('boom');
    expect(says).toContain('App.tsx:12');
    expect(says).toContain('2 times');
    expect(says).toContain('500');
  });
});

describe('requests that did not come back', () => {
  it('keeps one chip per address and counts the rest', () => {
    let pane = at('http://localhost:5173');
    pane = noteFailure(pane, 404, 'http://localhost:5173/img/hero.png');
    pane = noteFailure(pane, 404, 'http://localhost:5173/img/hero.png');
    expect(pane.failed).toHaveLength(1);
    expect(pane.failed[0]?.many).toBe(2);
  });

  it('says a request that never answered differently from one that answered wrong', () => {
    let pane = noteFailure(at('http://localhost:5173'), null, 'http://localhost:9999/api');
    pane = noteFailure(pane, 503, 'http://localhost:5173/api');
    expect(tabsWords.saysFailure(pane.failed[0] as Failure)).toContain('Never answered');
    expect(tabsWords.saysFailure(pane.failed[1] as Failure)).toContain('503');
  });
});

describe('the sizes to look at it in', () => {
  it('offers fitting the window and the widths the design view uses', () => {
    expect(DEVICES.map((one) => one.id)).toEqual(['fit', 'phone', 'tablet', 'desktop']);
    expect(deviceOf('phone').width).toBe(390);
  });

  it('falls back to fitting the window for a size nobody has', () => {
    expect(deviceOf('watch').id).toBe('fit');
    expect(pickDevice(emptyPane(), 'watch').device).toBe('fit');
  });

  it('picks one', () => {
    expect(pickDevice(emptyPane(), 'tablet').device).toBe('tablet');
  });

  it('never draws a page wider than the room it has', () => {
    const pane = pickDevice(emptyPane(), 'desktop');
    expect(widthIn(pane, 900)).toBe(900);
    expect(widthIn(pane, 1800)).toBe(1440);
    expect(widthIn(emptyPane(), 640)).toBe(640);
  });
});

describe('a blank tab', () => {
  it('is an empty address, not a made-up one', () => {
    expect(BLANK).toBe('');
    expect(addressIn(openTab(emptyPane()))).toBeNull();
  });
});
