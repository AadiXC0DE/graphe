/** The palette panel: what the arrow keys walk, and what Enter is allowed to run.
 *
 * The failure this guards against is the eye and the keyboard disagreeing. The
 * ranked list is re-bucketed into bands before it is drawn, so the row somebody
 * is looking at is not the row `matches` put in that position — if the numbers
 * are handed out anywhere but on the drawn list, ↓↓↵ runs the wrong thing and
 * nothing on screen says so.
 *
 * After that: an action that cannot run right now has to stay walkable and
 * stay readable, because the row is the only place its reason is written; and
 * the printed chord has to be the key this machine actually holds.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { KEY_WORDS, type Command } from '../src/lib/commands';
import {
  blankWords,
  chosenAt,
  litRow,
  movedTo,
  onMacHere,
  shownBands,
  walkOrder,
  whyNotOf,
} from '../src/components/Palette';

const command = (id: string, name: string, where?: string, rest: Partial<Command> = {}): Command => ({
  id,
  name,
  where,
  run: () => {},
  ...rest,
});

/** Two bands, interleaved on the way in — the arrangement that tells apart a
 *  number handed out on the ranked list from one handed out on the drawn one. */
const SOME: readonly Command[] = [
  command('undo', 'Undo the last change', 'Conversation'),
  command('open', 'Open a project folder', 'Project'),
  command('clear', 'Clear the conversation', 'Conversation'),
  command('rename', 'Rename this project', 'Project'),
];

const names = (commands: readonly Command[]) => commands.map((one) => one.name);

/* ========================================================================== */
/* PL-01 the order the eye reads                                               */
/* ========================================================================== */

describe('PL-01 the rows, in bands', () => {
  it('shows everything when nothing has been typed', () => {
    expect(walkOrder(shownBands(SOME, '')).length).toBe(4);
  });

  /* The whole reason the numbering lives here: grouping pulls the third command
     up beside the first, so its place on screen is 1 and its place in the
     ranked list is 2. */
  it('numbers the rows down the panel, not down the ranked list', () => {
    const bands = shownBands(SOME, '');
    expect(bands.map((band) => band.where)).toEqual(['Conversation', 'Project']);
    expect(bands[0]?.rows.map((row) => ({ id: row.command.id, at: row.at }))).toEqual([
      { id: 'undo', at: 0 },
      { id: 'clear', at: 1 },
    ]);
    expect(bands[1]?.rows.map((row) => ({ id: row.command.id, at: row.at }))).toEqual([
      { id: 'open', at: 2 },
      { id: 'rename', at: 3 },
    ]);
  });

  /* Every row is numbered once, and the numbers run 0..n-1 with no gaps — a gap
     is a row the arrows cannot reach and a repeat is two rows lit at once. */
  it('gives each row one place, with no gaps', () => {
    const bands = shownBands(SOME, '');
    const places = bands.flatMap((band) => band.rows.map((row) => row.at));
    expect(places).toEqual([0, 1, 2, 3]);
  });

  it('walks the rows in the order they are drawn', () => {
    expect(walkOrder(shownBands(SOME, '')).map((one) => one.id)).toEqual([
      'undo',
      'clear',
      'open',
      'rename',
    ]);
  });

  /* Typing narrows the panel to the bands that still have something in them.
     An empty heading left behind reads as a list that failed to load. */
  it('drops a band once nothing in it is left', () => {
    const bands = shownBands(SOME, 'project');
    expect(bands.map((band) => band.where)).toEqual(['Project']);
    expect(names(walkOrder(bands))).toEqual(['Open a project folder', 'Rename this project']);
  });

  /* A command with no band of its own still has to be somewhere; it goes under
     the one plain heading rather than under no heading at all. */
  it('puts a command with no band under the general heading', () => {
    const loose = [...SOME, command('about', 'About Graphe')];
    const bands = shownBands(loose, '');
    expect(bands[2]?.where).toBe(KEY_WORDS.ungrouped);
    expect(bands[2]?.rows[0]?.at).toBe(4);
  });
});

/* ========================================================================== */
/* PL-02 where the highlight lands                                             */
/* ========================================================================== */

describe('PL-02 moving the highlight', () => {
  /* Down at the bottom returns to the top. Somebody holding the key is looking
     for a name; stopping dead at the end makes them let go and look. */
  it('wraps round both ends', () => {
    expect(movedTo(3, 1, 4)).toBe(0);
    expect(movedTo(0, -1, 4)).toBe(3);
  });

  it('steps one at a time in the middle', () => {
    expect(movedTo(1, 1, 4)).toBe(2);
    expect(movedTo(2, -1, 4)).toBe(1);
  });

  /* An arrow key pressed at an empty list must not produce a place that a row
     could later appear at. */
  it('stays at the top when there is nothing to move through', () => {
    expect(movedTo(0, 1, 0)).toBe(0);
    expect(movedTo(0, -1, 0)).toBe(0);
  });

  /* The list shortens under the fingers as the query grows, so the remembered
     highlight is routinely past the end by the time it is drawn. */
  it('pulls a stale highlight back onto the list', () => {
    expect(litRow(7, 3)).toBe(2);
    expect(litRow(-2, 3)).toBe(0);
  });

  it('lights nothing when nothing was found', () => {
    expect(litRow(0, 0)).toBe(-1);
  });
});

/* ========================================================================== */
/* PL-03 the ones that cannot go                                               */
/* ========================================================================== */

describe('PL-03 an action that is stopped', () => {
  const stopped: readonly Command[] = [
    command('undo', 'Undo the last change', 'Conversation', {
      ready: false,
      whyNot: 'Nothing has changed yet.',
    }),
    command('clear', 'Clear the conversation', 'Conversation'),
  ];

  /* It keeps its place in the walk. Skipping it would take the reason off the
     keyboard's path — and the reason is why it is still on the list. */
  it('is still walked by the arrow keys', () => {
    const rows = walkOrder(shownBands(stopped, ''));
    expect(rows.map((one) => one.id)).toEqual(['undo', 'clear']);
    expect(movedTo(0, 1, rows.length)).toBe(1);
    expect(movedTo(1, 1, rows.length)).toBe(0);
  });

  it('is never dropped by a search that matches it', () => {
    expect(names(walkOrder(shownBands(stopped, 'undo')))).toEqual(['Undo the last change']);
  });

  /* Enter on it does nothing at all — not run, and not close either, because a
     panel that shuts without acting reads as having acted. */
  it('gives Enter nothing to run', () => {
    const rows = walkOrder(shownBands(stopped, ''));
    expect(chosenAt(rows, 0)).toBe(null);
    expect(chosenAt(rows, 1)?.id).toBe('clear');
  });

  it('gives Enter nothing when the highlight is off the list', () => {
    expect(chosenAt(walkOrder(shownBands(stopped, '')), -1)).toBe(null);
    expect(chosenAt([], 0)).toBe(null);
  });

  it('says its own reason, and a general one when it has none', () => {
    expect(whyNotOf(stopped[0] as Command)).toBe('Nothing has changed yet.');
    expect(whyNotOf(command('a', 'A', 'B', { ready: false }))).toBe(KEY_WORDS.notReady);
    expect(whyNotOf(command('a', 'A', 'B', { ready: false, whyNot: '  ' }))).toBe(
      KEY_WORDS.notReady,
    );
  });
});

/* ========================================================================== */
/* PL-04 an empty panel                                                        */
/* ========================================================================== */

describe('PL-04 when there is no row to draw', () => {
  /* Two different problems. Only one of them is answered by typing less, so
     they cannot share a sentence. */
  it('tells a bad search apart from an empty window', () => {
    expect(blankWords(0, 0)).toBe(KEY_WORDS.empty);
    expect(blankWords(12, 0)).toBe(KEY_WORDS.nothing);
  });

  it('says nothing while there are rows on screen', () => {
    expect(blankWords(12, 3)).toBe(null);
  });
});

/* ========================================================================== */
/* PL-05 which key this machine holds                                          */
/* ========================================================================== */

describe('PL-05 the machine underneath', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /* Printing ⌘ on a PC is a hint that cannot be followed. */
  it('knows a Mac from anything else', () => {
    vi.stubGlobal('navigator', { platform: 'MacIntel', userAgent: 'Mozilla/5.0 (Macintosh)' });
    expect(onMacHere()).toBe(true);

    vi.stubGlobal('navigator', { platform: 'Win32', userAgent: 'Mozilla/5.0 (Windows NT 10.0)' });
    expect(onMacHere()).toBe(false);
  });

  /* `platform` is on its way out of the browsers; the agent string is the
     fallback, and neither being there is not a crash. */
  it('falls back to the agent string, and to no when there is neither', () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' });
    expect(onMacHere()).toBe(true);

    vi.stubGlobal('navigator', undefined);
    expect(onMacHere()).toBe(false);
  });
});
