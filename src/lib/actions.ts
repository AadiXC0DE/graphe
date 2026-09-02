/** Everything the window can be told to do, written down once.
 *
 * There were three lists and they did not agree. The key handler in `App.tsx`
 * knew the chords, the palette knew the names and printed chords of its own,
 * and the menus knew a third thing — so `⌘⇧N` opened a new conversation
 * according to the palette and jumped to whatever was waiting according to the
 * keyboard, and `⌘⇧F` was printed next to an action nothing had ever bound.
 *
 * One list fixes that by construction: a name, where it can be reached from,
 * and the chord it ships with. What a chord *is* stays in `lib/keys.ts`, which
 * already knows how to spell one, read a saved one back and find two on top of
 * each other.
 *
 * Pure. Nothing here runs an action — the window supplies the doing.
 */

import { chordOf, clashes, readBindings, type Chord, type Clash, type Press } from './keys';
import { matches, type Command } from './commands';

export type { Chord, Clash } from './keys';

/** How far in you have to be for an action to mean anything. A conversation is
 *  inside a project, so the three nest. */
export type Where = 'anywhere' | 'in a project' | 'in a conversation';

export type Action = {
  id: string;
  /** What it is called, in the words the palette and the menu both show. */
  says: string;
  where: Where;
  /** The chord it ships with, or null for an action with no key of its own. */
  chord: Chord | null;
  /** Other chords that also fire it. Two keys for one action is a habit worth
   *  keeping, not a clash. */
  also?: readonly string[];
};

export const ACTION_WORDS = {
  name: 'Keys',
  note: 'Every action in the window, and the key it answers to. Press a new one to change it.',
  where: {
    anywhere: 'Anywhere',
    'in a project': 'In a project',
    'in a conversation': 'In a conversation',
  },
  unbound: 'No key',
  clash: 'Two actions on one key.',
  nothing: 'Nothing here goes by that name.',
} as const;

/* -------------------------------------------------------------------------- */
/* The list                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Every action the window has, in the order a person meets them.
 *
 * The chords are what the window actually does today, not what it printed.
 */
export const ACTIONS: readonly Action[] = [
  { id: 'ask', says: 'Ask for anything', where: 'anywhere', chord: 'mod+k' },
  { id: 'palette', says: 'Everything this window can do', where: 'anywhere', chord: 'mod+shift+p' },
  { id: 'open', says: 'Open another project', where: 'anywhere', chord: 'mod+o', also: ['mod+shift+t'] },
  { id: 'skills', says: 'Look at the skills', where: 'anywhere', chord: null },
  { id: 'connected', says: 'Other tools', where: 'anywhere', chord: null },
  { id: 'more', says: 'Add more to Graphe', where: 'anywhere', chord: null },
  { id: 'model', says: 'Change which model answers', where: 'anywhere', chord: null },
  { id: 'usage', says: 'See what this cost', where: 'anywhere', chord: null },
  { id: 'settings', says: 'Settings', where: 'anywhere', chord: null },

  { id: 'new', says: 'Start a new conversation', where: 'in a project', chord: 'mod+t' },
  { id: 'close', says: 'Close this conversation', where: 'in a project', chord: 'mod+w' },
  { id: 'next', says: 'Go to the next conversation', where: 'in a project', chord: 'mod+shift+}' },
  { id: 'previous', says: 'Go to the previous conversation', where: 'in a project', chord: 'mod+shift+{' },
  { id: 'needs-you', says: 'Go to what is waiting for you', where: 'in a project', chord: 'mod+shift+n' },
  // One row rather than nine: ⌘1 to ⌘9 are the same action counting.
  {
    id: 'go-nth',
    says: 'Go to a conversation by number',
    where: 'in a project',
    chord: 'mod+1',
    also: ['mod+2', 'mod+3', 'mod+4', 'mod+5', 'mod+6', 'mod+7', 'mod+8', 'mod+9'],
  },
  { id: 'shelf', says: 'Show or hide the shelf', where: 'in a project', chord: 'mod+b' },
  { id: 'files', says: 'Show everything in this project', where: 'in a project', chord: 'mod+shift+f' },
  { id: 'changes', says: 'Review the working diff', where: 'in a project', chord: null },
  { id: 'history', says: 'Look through the history', where: 'in a project', chord: null },
  { id: 'canvas', says: 'Open the canvas', where: 'in a project', chord: null },
  { id: 'reviews', says: 'Read the pull requests', where: 'in a project', chord: null },
  { id: 'design', says: 'Open the design view', where: 'in a project', chord: 'mod+d' },

  { id: 'send', says: 'Send', where: 'in a conversation', chord: 'enter', also: ['mod+enter'] },
  { id: 'stop', says: 'Stop what is running', where: 'in a conversation', chord: 'escape' },
  { id: 'page', says: 'Show the page beside the conversation', where: 'in a conversation', chord: 'mod+j' },
  { id: 'copy', says: 'Copy the conversation', where: 'in a conversation', chord: null },
  { id: 'tidy', says: 'Compact the context', where: 'in a conversation', chord: null },
];

/** The chords as shipped, which is what a saved file is laid over. */
export const DEFAULT_BINDINGS: Readonly<Record<string, Chord | null>> = Object.fromEntries(
  ACTIONS.map((one) => [one.id, one.chord]),
);

export type Bindings = Record<string, Chord | null>;

/** A saved `keybindings.json`, read the forgiving way: a line nobody can parse
 *  leaves the shipped chord standing. */
export function readActions(raw: unknown): Bindings {
  return readBindings(raw, { ...DEFAULT_BINDINGS });
}

/* -------------------------------------------------------------------------- */
/* Asking the list                                                             */
/* -------------------------------------------------------------------------- */

const REACH: Readonly<Record<Where, readonly Where[]>> = {
  anywhere: ['anywhere'],
  'in a project': ['anywhere', 'in a project'],
  'in a conversation': ['anywhere', 'in a project', 'in a conversation'],
};

/** What can be done from here, each carrying the chord it answers to now. */
export function actionsFor(where: Where, bindings: Bindings = {}): readonly Action[] {
  const reachable = REACH[where];
  return ACTIONS.filter((one) => reachable.includes(one.where)).map((one) => ({
    ...one,
    chord: chordFor(one.id, bindings),
  }));
}

/** The chord for one action: what was bound, or what shipped. */
export function chordFor(id: string, bindings: Bindings = {}): Chord | null {
  if (Object.prototype.hasOwnProperty.call(bindings, id)) return bindings[id] ?? null;
  return DEFAULT_BINDINGS[id] ?? null;
}

/** The action a press means here, or nothing. */
export function actionAt(press: Press, onMac: boolean, where: Where, bindings: Bindings = {}): Action | null {
  const pressed = chordOf(press, onMac);
  if (pressed === '') return null;
  for (const one of actionsFor(where, bindings)) {
    if (one.chord === pressed) return one;
    if (one.also?.includes(pressed) === true) return one;
  }
  return null;
}

/**
 * Chords more than one action answers to.
 *
 * The extra chords count too — `⌘⇧T` is as much a way to open a project as
 * `⌘O`, and a clash on it is as confusing. They are folded into one record so
 * `keys.ts` can do the finding, then folded back out so a clash names actions
 * rather than the trick used to look for it.
 */
export function clashesIn(bindings: Bindings = {}): readonly Clash[] {
  const spread: Record<string, Chord | null> = {};
  for (const one of ACTIONS) {
    spread[one.id] = chordFor(one.id, bindings);
    (one.also ?? []).forEach((chord, at) => {
      spread[`${one.id} ${String(at)}`] = chord;
    });
  }
  return clashes(spread)
    .map((found) => ({
      chord: found.chord,
      ids: [...new Set(found.ids.map((id) => id.split(' ')[0] ?? id))],
    }))
    .filter((found) => found.ids.length > 1);
}

/** The actions a typed word means, best first. The palette's ranking, borrowed
 *  rather than written twice. */
export function matching(query: string, actions: readonly Action[]): readonly Action[] {
  const asCommands: Command[] = actions.map((one) => ({
    id: one.id,
    name: one.says,
    where: ACTION_WORDS.where[one.where],
    run: () => undefined,
  }));
  const byId = new Map(actions.map((one) => [one.id, one]));
  return matches(asCommands, query)
    .map((one) => byId.get(one.id))
    .filter((one): one is Action => one !== undefined);
}
