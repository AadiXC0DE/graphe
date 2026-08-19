/** Chords: the shape a held key press is written in, and the shape it is read in.
 *
 * One spelling in the middle — `mod+shift+f` — so a keypress, a saved setting
 * and a hint printed next to a menu item are all the same string. `mod` is the
 * key that machine reaches for: ⌘ on a Mac, Ctrl everywhere else. Writing the
 * platform into the setting is how a saved preference stops working when the
 * person changes machines.
 *
 * Pure. Nothing here listens, saves or renders.
 */

export type Chord = string;

/** What comes off a keyboard. Ours rather than the DOM's, so this can be read
 *  and tested without one; a real KeyboardEvent fits it. */
export type Press = {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
};

export const CHORD_WORDS = {
  off: 'Off',
  /** Held keys, as each platform draws them. */
  mac: { mod: '⌘', ctrl: '⌃', meta: '⌘', shift: '⇧', alt: '⌥', joiner: '' },
  elsewhere: { mod: 'Ctrl', ctrl: 'Ctrl', meta: 'Meta', shift: 'Shift', alt: 'Alt', joiner: '+' },
  /** Keys nobody would recognise spelled out. */
  keys: {
    up: '↑',
    down: '↓',
    left: '←',
    right: '→',
    enter: '⏎',
    escape: 'Esc',
    space: 'Space',
  },
} as const;

/* -------------------------------------------------------------------------- */
/* The one spelling                                                            */
/* -------------------------------------------------------------------------- */

/** Written in this order, always, so two chords that mean the same thing are
 *  the same string — which is what makes a clash findable. */
const MODIFIERS: readonly string[] = ['mod', 'ctrl', 'meta', 'shift', 'alt'];

/** What a hand-written setting is allowed to call them. */
const OTHER_NAMES: Record<string, string> = {
  cmd: 'mod',
  command: 'mod',
  control: 'ctrl',
  option: 'alt',
  opt: 'alt',
};

/** Browser names for keys that have a plainer one. */
const PLAIN_KEYS: Record<string, string> = {
  arrowup: 'up',
  arrowdown: 'down',
  arrowleft: 'left',
  arrowright: 'right',
  ' ': 'space',
  spacebar: 'space',
  esc: 'escape',
  del: 'delete',
  return: 'enter',
};

/** A modifier on its own is somebody on the way to a chord, not at one. */
const HELD_ALONE = new Set(['meta', 'control', 'shift', 'alt', 'altgraph', 'capslock', 'os']);

function keyNamed(raw: string): string {
  const low = raw.toLowerCase();
  if (low === '' || HELD_ALONE.has(low)) return '';
  return PLAIN_KEYS[low] ?? low;
}

/** A press written down. Empty while only modifiers are held. */
export function chordOf(event: Press, onMac: boolean): Chord {
  const key = keyNamed(event.key);
  if (key === '') return '';

  const held: string[] = [];
  if (onMac ? event.metaKey === true : event.ctrlKey === true) held.push('mod');
  // The one that is not this machine's `mod` still has to be told apart, or
  // Ctrl+A on a Mac would fire whatever is bound to a bare A.
  if (onMac ? event.ctrlKey === true : event.metaKey === true) held.push(onMac ? 'ctrl' : 'meta');
  if (event.shiftKey === true) held.push('shift');
  if (event.altKey === true) held.push('alt');

  return [...held, key].join('+');
}

/** A written chord in the one spelling, or nothing if there is no key in it. */
function chordFrom(text: string): Chord | null {
  const pieces = text
    .toLowerCase()
    .split('+')
    .map((piece) => piece.trim())
    .filter((piece) => piece !== '');

  const held = new Set<string>();
  let key = '';
  for (const piece of pieces) {
    const named = OTHER_NAMES[piece] ?? piece;
    if (MODIFIERS.includes(named)) held.add(named);
    else key = PLAIN_KEYS[named] ?? named;
  }
  if (key === '') return null;
  return [...MODIFIERS.filter((one) => held.has(one)), key].join('+');
}

/* -------------------------------------------------------------------------- */
/* Reading it back                                                             */
/* -------------------------------------------------------------------------- */

function saysKey(key: string): string {
  const known = CHORD_WORDS.keys[key as keyof typeof CHORD_WORDS.keys];
  if (known !== undefined) return known;
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/** The chord as somebody reads it: `⌘K` on a Mac, `Ctrl+K` elsewhere. */
export function saysChord(chord: Chord | null, onMac: boolean): string {
  const spelled = chord === null ? null : chordFrom(chord);
  if (spelled === null) return CHORD_WORDS.off;

  const drawn = onMac ? CHORD_WORDS.mac : CHORD_WORDS.elsewhere;
  const pieces = spelled.split('+');
  const key = pieces[pieces.length - 1] ?? '';
  const held = pieces
    .slice(0, -1)
    .map((one) => drawn[one as keyof typeof drawn] ?? one)
    .join(drawn.joiner);
  return held === '' ? saysKey(key) : `${held}${drawn.joiner}${saysKey(key)}`;
}

/* -------------------------------------------------------------------------- */
/* What one person has changed                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Saved bindings laid over the ones that ship.
 *
 * Read defensively: this comes off disk, where anything can have happened to
 * it. Anything unreadable leaves the shipped chord standing, because an action
 * that silently loses its key is worse than one that ignored a bad setting.
 * `null` is the exception — it is somebody turning an action's key off.
 */
export function readBindings(
  raw: unknown,
  defaults: Record<string, Chord | null>,
): Record<string, Chord | null> {
  const bindings: Record<string, Chord | null> = {};
  for (const [id, chord] of Object.entries(defaults)) {
    bindings[id] = chord === null ? null : chordFrom(chord);
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return bindings;

  const saved = raw as Record<string, unknown>;
  // Only actions that exist: a key saved for something long gone can only
  // collide with the ones that are still here.
  for (const id of Object.keys(defaults)) {
    if (!Object.prototype.hasOwnProperty.call(saved, id)) continue;
    const value = saved[id];
    if (value === null) {
      bindings[id] = null;
      continue;
    }
    if (typeof value !== 'string') continue;
    const chord = chordFrom(value);
    if (chord !== null) bindings[id] = chord;
  }
  return bindings;
}

export type Clash = {
  chord: Chord;
  /** Every action that answers to it, in the order they were bound. */
  ids: readonly string[];
};

/** Chords more than one action answers to. Nothing here decides which wins —
 *  that is a question for the person who bound them. */
export function clashes(bindings: Record<string, Chord | null>): readonly Clash[] {
  const byChord = new Map<Chord, string[]>();
  for (const [id, chord] of Object.entries(bindings)) {
    if (chord === null || chord === '') continue;
    const ids = byChord.get(chord);
    if (ids === undefined) byChord.set(chord, [id]);
    else ids.push(id);
  }
  return [...byChord.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([chord, ids]) => ({ chord, ids }));
}
