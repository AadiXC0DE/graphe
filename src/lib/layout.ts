/** How the window is divided, and what happens when there is not enough of it.
 *
 * The widths in `styles/tokens.css` are the shipped composition and nothing
 * could move them. A person working in a diff wants the rail wide; a person
 * writing wants everything else gone. Both are one drag away once the sizes are
 * a value rather than a constant.
 *
 * The arithmetic is most of this file, and it exists for one rule: the
 * conversation is never squeezed to nothing. Panes give room back in the order
 * somebody would give it back themselves — the page, then the rail, then the
 * shelf — and a pane closes rather than becoming a sliver nobody can grab.
 *
 * Pure, and no React. A hook that remembers this per project comes later.
 */

export type Pane = 'shelf' | 'thread' | 'rail' | 'browser' | 'terminal';

/** Everything but the thread, which takes whatever is left. */
export type Sized = Exclude<Pane, 'thread'>;

export type Layout = {
  open: Readonly<Record<Pane, boolean>>;
  /** What each pane was last dragged to, in pixels. */
  size: Readonly<Record<Sized, number>>;
};

export type Sizes = Readonly<Record<Pane, number>>;

export const LAYOUT_WORDS = {
  name: 'Layout',
  note: 'Drag any edge. Three arrangements are one press away.',
  panes: {
    shelf: 'Shelf',
    thread: 'Conversation',
    rail: 'Panel',
    browser: 'Page',
    terminal: 'Terminal',
  },
  focus: 'Focus',
  focusNote: 'The conversation and nothing else.',
  review: 'Review',
  reviewNote: 'The panel and the page, for reading what changed.',
  ops: 'Ops',
  opsNote: 'The shelf, the panel and a terminal, for watching work run.',
} as const;

/* -------------------------------------------------------------------------- */
/* How small is too small                                                      */
/* -------------------------------------------------------------------------- */

/** Least, most, and what it ships at. The shipped numbers are the ones already
 *  in `styles/tokens.css`, so an untouched window is the window as drawn. */
const ROOM: Readonly<Record<Sized, { least: number; most: number; from: number }>> = {
  shelf: { least: 180, most: 420, from: 232 },
  rail: { least: 240, most: 560, from: 328 },
  browser: { least: 320, most: 1200, from: 560 },
  terminal: { least: 120, most: 800, from: 240 },
};

/** Under this the conversation stops being prose and starts being a column of
 *  broken lines, so nothing is allowed to take it below. */
export const THREAD_LEAST = 420;

/** Who gives room back first. The page can be reopened with one key; the shelf
 *  is how somebody finds their way around, so it goes last. */
const GIVES_WAY: readonly Sized[] = ['browser', 'rail', 'shelf'];

function clamp(value: number, least: number, most: number): number {
  return value < least ? least : value > most ? most : value;
}

/* -------------------------------------------------------------------------- */
/* Arrangements                                                                */
/* -------------------------------------------------------------------------- */

function layoutOf(open: Partial<Record<Pane, boolean>>): Layout {
  return {
    open: {
      shelf: open.shelf === true,
      thread: true,
      rail: open.rail === true,
      browser: open.browser === true,
      terminal: open.terminal === true,
    },
    size: {
      shelf: ROOM.shelf.from,
      rail: ROOM.rail.from,
      browser: ROOM.browser.from,
      terminal: ROOM.terminal.from,
    },
  };
}

export type Preset = { id: 'focus' | 'review' | 'ops'; says: string; note: string; layout: Layout };

export const PRESETS: readonly Preset[] = [
  {
    id: 'focus',
    says: LAYOUT_WORDS.focus,
    note: LAYOUT_WORDS.focusNote,
    layout: layoutOf({}),
  },
  {
    id: 'review',
    says: LAYOUT_WORDS.review,
    note: LAYOUT_WORDS.reviewNote,
    layout: layoutOf({ rail: true, browser: true }),
  },
  {
    id: 'ops',
    says: LAYOUT_WORDS.ops,
    note: LAYOUT_WORDS.opsNote,
    layout: layoutOf({ shelf: true, rail: true, terminal: true }),
  },
];

/** What the window opens as. The shelf and the panel, which is the composition
 *  every screenshot of this app has ever shown. */
export const defaultLayout: Layout = layoutOf({ shelf: true, rail: true });

export function presetNamed(id: string): Layout | null {
  return PRESETS.find((one) => one.id === id)?.layout ?? null;
}

/** Which arrangement is on screen, by what is open rather than by size — a
 *  dragged edge does not stop it being Review. */
export function showingPreset(layout: Layout): Preset['id'] | null {
  const found = PRESETS.find((one) =>
    (Object.keys(one.layout.open) as Pane[]).every((pane) => one.layout.open[pane] === layout.open[pane]),
  );
  return found?.id ?? null;
}

/* -------------------------------------------------------------------------- */
/* Fitting it in the window                                                    */
/* -------------------------------------------------------------------------- */

/**
 * What each pane actually gets, in this much window.
 *
 * A closed pane is 0 rather than absent, so a caller can write the number
 * straight into a style without asking whether it is there. `height` is
 * optional because the terminal is the only pane measured down the window; with
 * no height it keeps its own size and only its own limits.
 */
export function sizesFor(layout: Layout, width: number, height?: number): Sizes {
  const room = Math.max(0, Math.floor(width));
  const beside: Record<Sized, number> = {
    shelf: 0,
    rail: 0,
    browser: 0,
    terminal: 0,
  };
  for (const pane of GIVES_WAY) {
    if (!layout.open[pane]) continue;
    beside[pane] = clamp(layout.size[pane], ROOM[pane].least, ROOM[pane].most);
  }

  const taken = (): number => GIVES_WAY.reduce((sum, pane) => sum + beside[pane], 0);

  // Give room back before closing anything: a narrower page is still a page.
  for (const pane of GIVES_WAY) {
    const over = room - taken() - THREAD_LEAST;
    if (over >= 0) break;
    if (beside[pane] === 0) continue;
    beside[pane] = Math.max(ROOM[pane].least, beside[pane] + over);
  }
  // Still short, so something has to go. In the same order, and all of it.
  for (const pane of GIVES_WAY) {
    if (room - taken() - THREAD_LEAST >= 0) break;
    beside[pane] = 0;
  }

  const terminal = layout.open.terminal
    ? clamp(
        layout.size.terminal,
        ROOM.terminal.least,
        height === undefined ? ROOM.terminal.most : Math.max(ROOM.terminal.least, Math.min(ROOM.terminal.most, height - THREAD_LEAST)),
      )
    : 0;

  return {
    shelf: beside.shelf,
    rail: beside.rail,
    browser: beside.browser,
    terminal,
    thread: Math.max(0, room - taken()),
  };
}

/* -------------------------------------------------------------------------- */
/* Reading it back                                                             */
/* -------------------------------------------------------------------------- */

function readSize(value: unknown, pane: Sized): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return ROOM[pane].from;
  return clamp(Math.round(value), ROOM[pane].least, ROOM[pane].most);
}

function readOpen(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

/** A saved layout, read the forgiving way. A pane whose size is gibberish opens
 *  at the size it ships at rather than costing somebody the whole arrangement. */
export function readLayout(raw: unknown): Layout {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return defaultLayout;
  const saved = raw as Record<string, unknown>;
  const readable = asRecord(saved['open']);
  const sizes = asRecord(saved['size']);

  return {
    open: {
      shelf: readOpen(readable['shelf'], defaultLayout.open.shelf),
      // The conversation is the app. There is no arrangement without it.
      thread: true,
      rail: readOpen(readable['rail'], defaultLayout.open.rail),
      browser: readOpen(readable['browser'], defaultLayout.open.browser),
      terminal: readOpen(readable['terminal'], defaultLayout.open.terminal),
    },
    size: {
      shelf: readSize(sizes['shelf'], 'shelf'),
      rail: readSize(sizes['rail'], 'rail'),
      browser: readSize(sizes['browser'], 'browser'),
      terminal: readSize(sizes['terminal'], 'terminal'),
    },
  };
}
