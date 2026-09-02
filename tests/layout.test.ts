/** Panes, and the rule that the conversation never disappears.
 *
 * Every other question here is arithmetic, and the arithmetic only exists to
 * hold one line: whatever somebody drags, whatever the window is resized to,
 * there is still a readable column of conversation. The failure it guards
 * against is a pane dragged to nothing — a two-pixel strip that cannot be
 * grabbed again is a pane somebody has lost.
 */

import { describe, expect, it } from 'vitest';

import {
  LAYOUT_WORDS,
  PRESETS,
  THREAD_LEAST,
  defaultLayout,
  presetNamed,
  readLayout,
  showingPreset,
  sizesFor,
  type Layout,
} from '../src/lib/layout';

const like = (over: Partial<Layout>): Layout => ({
  open: { ...defaultLayout.open, ...over.open },
  size: { ...defaultLayout.size, ...over.size },
});

/* ========================================================================== */
/* LY-01 the arrangements                                                      */
/* ========================================================================== */

describe('LY-01 three arrangements', () => {
  it('offers focus, review and ops, each with a name and a line', () => {
    expect(PRESETS.map((one) => one.id)).toEqual(['focus', 'review', 'ops']);
    for (const one of PRESETS) {
      expect(one.says.length).toBeGreaterThan(0);
      expect(one.note.length).toBeGreaterThan(0);
    }
  });

  it('means the conversation and nothing else by focus', () => {
    const focus = presetNamed('focus');
    expect(focus?.open).toEqual({ shelf: false, thread: true, rail: false, browser: false, terminal: false });
  });

  it('keeps the conversation open in every one of them', () => {
    for (const one of PRESETS) expect(one.layout.open.thread).toBe(true);
  });

  it('knows which one is on screen, however the edges have been dragged', () => {
    const review = presetNamed('review') ?? defaultLayout;
    expect(showingPreset(review)).toBe('review');
    expect(showingPreset({ ...review, size: { ...review.size, rail: 500 } })).toBe('review');
    expect(showingPreset(defaultLayout)).toBeNull();
  });

  it('is nothing for a name nobody offers', () => {
    expect(presetNamed('zen')).toBeNull();
  });
});

/* ========================================================================== */
/* LY-02 fitting                                                               */
/* ========================================================================== */

describe('LY-02 how the width is shared out', () => {
  it('gives the conversation everything nothing else took', () => {
    const sizes = sizesFor(defaultLayout, 1440);
    expect(sizes.shelf).toBe(232);
    expect(sizes.rail).toBe(328);
    expect(sizes.thread).toBe(1440 - 232 - 328);
    expect(sizes.browser).toBe(0);
  });

  it('is the whole window when nothing else is open', () => {
    expect(sizesFor(presetNamed('focus') ?? defaultLayout, 1200).thread).toBe(1200);
  });

  /* The page goes first, then the panel, then the shelf — the order somebody
     would give room back in themselves. */
  it('takes room back from the page before the panel', () => {
    const three = like({ open: { ...defaultLayout.open, browser: true } });
    const sizes = sizesFor(three, 1300);
    expect(sizes.thread).toBeGreaterThanOrEqual(THREAD_LEAST);
    expect(sizes.browser).toBeLessThan(560);
    expect(sizes.rail).toBe(328);
    expect(sizes.shelf).toBe(232);
  });

  it('closes a pane rather than leaving a strip nobody can grab', () => {
    const three = like({ open: { ...defaultLayout.open, browser: true } });
    const sizes = sizesFor(three, 900);
    expect(sizes.browser).toBe(0);
    expect(sizes.thread).toBeGreaterThanOrEqual(THREAD_LEAST);
  });

  it('keeps the conversation readable down to a small window', () => {
    for (const width of [1600, 1280, 1100, 900, 760]) {
      const sizes = sizesFor(like({ open: { ...defaultLayout.open, browser: true } }), width);
      expect(sizes.thread, `at ${String(width)}`).toBeGreaterThanOrEqual(THREAD_LEAST);
    }
  });

  /* Below the conversation's own minimum there is nothing left to protect, so
     the answer is the whole window and no negative numbers anywhere. */
  it('does not go negative in a window nothing fits in', () => {
    const sizes = sizesFor(defaultLayout, 300);
    for (const value of Object.values(sizes)) expect(value).toBeGreaterThanOrEqual(0);
    expect(sizes.thread).toBe(300);
  });

  it('measures the terminal down the window rather than across it', () => {
    const ops = presetNamed('ops') ?? defaultLayout;
    expect(sizesFor(ops, 1440).terminal).toBe(240);
    expect(sizesFor(ops, 1440).thread).toBe(1440 - 232 - 328);
    // A short window gives the conversation its rows back.
    expect(sizesFor(ops, 1440, 500).terminal).toBeLessThan(240);
    expect(sizesFor(defaultLayout, 1440, 900).terminal).toBe(0);
  });
});

/* ========================================================================== */
/* LY-03 clamping                                                              */
/* ========================================================================== */

describe('LY-03 a pane can never be dragged to nothing', () => {
  it('holds a dragged edge inside what the pane can be', () => {
    const tiny = like({ size: { ...defaultLayout.size, rail: 4, shelf: 9000 } });
    const sizes = sizesFor(tiny, 2400);
    expect(sizes.rail).toBe(240);
    expect(sizes.shelf).toBe(420);
  });

  it('clamps on the way in as well as on the way out', () => {
    expect(readLayout({ size: { rail: 2 } }).size.rail).toBe(240);
    expect(readLayout({ size: { rail: 9000 } }).size.rail).toBe(560);
  });
});

/* ========================================================================== */
/* LY-04 reading a saved one                                                   */
/* ========================================================================== */

describe('LY-04 a saved layout', () => {
  it('is the shipped one when there is nothing to read', () => {
    for (const raw of [null, undefined, 7, 'layout', []]) {
      expect(readLayout(raw)).toEqual(defaultLayout);
    }
  });

  it('keeps what it can read and ships the rest', () => {
    const read = readLayout({ open: { browser: true, shelf: 'yes' }, size: { browser: 700 } });
    expect(read.open.browser).toBe(true);
    expect(read.open.shelf).toBe(defaultLayout.open.shelf);
    expect(read.size.browser).toBe(700);
    expect(read.size.rail).toBe(defaultLayout.size.rail);
  });

  it('will not let a saved file close the conversation', () => {
    expect(readLayout({ open: { thread: false } }).open.thread).toBe(true);
  });

  it('reads what it writes', () => {
    const one = presetNamed('review') ?? defaultLayout;
    expect(readLayout(JSON.parse(JSON.stringify(one)))).toEqual(one);
  });
});

describe('LY-05 the words', () => {
  it('names every pane a person can drag', () => {
    for (const name of Object.values(LAYOUT_WORDS.panes)) expect(name.length).toBeGreaterThan(0);
  });
});
