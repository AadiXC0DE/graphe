/** Keyboard chords: one spelling for a press, a setting and a printed hint.
 *
 * The failure this guards against is a shortcut that works on one machine and
 * not another. Everything turns on `mod` staying the platform's own key on the
 * way in and on the way out, so a press round-trips to the same string on a Mac
 * and on a PC, and a setting written on one opens on the other. After that:
 * a saved file that has been edited by hand or corrupted must not cost somebody
 * their keys, and two actions on one chord must be findable rather than a
 * mystery about which one fires.
 */

import { describe, expect, it } from 'vitest';

import { CHORD_WORDS, chordOf, clashes, readBindings, saysChord } from '../src/lib/keys';

const press = (key: string, held: Partial<Record<'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey', boolean>> = {}) => ({
  key,
  ...held,
});

/* ========================================================================== */
/* KB-01 a press, written down                                                 */
/* ========================================================================== */

describe('KB-01 what a press is called', () => {
  /* The same chord on both machines, from the key each one actually holds.
     Writing ⌘ into the setting is what breaks somebody who changes laptop. */
  it('writes the platform key as the same `mod` on either machine', () => {
    expect(chordOf(press('k', { metaKey: true }), true)).toBe('mod+k');
    expect(chordOf(press('k', { ctrlKey: true }), false)).toBe('mod+k');
  });

  it('spells the held keys in one settled order', () => {
    expect(chordOf(press('F', { metaKey: true, shiftKey: true }), true)).toBe('mod+shift+f');
    expect(chordOf(press('F', { ctrlKey: true, shiftKey: true }), false)).toBe('mod+shift+f');
  });

  it('gives the keys nobody types plain names', () => {
    expect(chordOf(press('ArrowUp', { altKey: true }), true)).toBe('alt+up');
    expect(chordOf(press('Enter', { shiftKey: true }), true)).toBe('shift+enter');
    expect(chordOf(press('Escape'), false)).toBe('escape');
    expect(chordOf(press(' '), false)).toBe('space');
  });

  /* Ctrl is a key of its own on a Mac. Dropping it would turn Ctrl+A in a text
     box into whatever a bare A is bound to. */
  it('tells the other machine’s key apart from this one’s', () => {
    expect(chordOf(press('a', { ctrlKey: true }), true)).toBe('ctrl+a');
    expect(chordOf(press('a', { metaKey: true }), false)).toBe('meta+a');
  });

  it('is not a chord while only a modifier is down', () => {
    expect(chordOf(press('Meta', { metaKey: true }), true)).toBe('');
    expect(chordOf(press('Shift', { shiftKey: true }), false)).toBe('');
  });
});

/* ========================================================================== */
/* KB-02 the same chord, read back                                             */
/* ========================================================================== */

describe('KB-02 how a chord reads', () => {
  it('draws it the way each machine draws it', () => {
    expect(saysChord('mod+k', true)).toBe('⌘K');
    expect(saysChord('mod+k', false)).toBe('Ctrl+K');
    expect(saysChord('mod+shift+f', true)).toBe('⌘⇧F');
    expect(saysChord('mod+shift+f', false)).toBe('Ctrl+Shift+F');
  });

  it('uses the symbols people already read', () => {
    expect(saysChord('alt+up', true)).toBe('⌥↑');
    expect(saysChord('shift+enter', true)).toBe('⇧⏎');
    expect(saysChord('escape', false)).toBe('Esc');
    expect(saysChord('mod+left', false)).toBe('Ctrl+←');
  });

  /* Round trip: what came off the keyboard is what gets printed next to the
     menu item, on both machines. */
  it('reads back the press it was written from', () => {
    const onMac = chordOf(press('K', { metaKey: true, shiftKey: true }), true);
    const elsewhere = chordOf(press('K', { ctrlKey: true, shiftKey: true }), false);
    expect(onMac).toBe(elsewhere);
    expect(saysChord(onMac, true)).toBe('⌘⇧K');
    expect(saysChord(elsewhere, false)).toBe('Ctrl+Shift+K');
  });

  it('says an action has no key rather than printing an empty hint', () => {
    expect(saysChord(null, true)).toBe(CHORD_WORDS.off);
    expect(saysChord('', false)).toBe(CHORD_WORDS.off);
  });
});

/* ========================================================================== */
/* KB-03 what somebody has changed                                             */
/* ========================================================================== */

describe('KB-03 reading saved keys over the ones that ship', () => {
  const defaults = { palette: 'mod+k', send: 'enter', find: 'mod+shift+f' };

  it('takes the saved key and leaves the rest alone', () => {
    expect(readBindings({ palette: 'mod+p' }, defaults)).toEqual({
      palette: 'mod+p',
      send: 'enter',
      find: 'mod+shift+f',
    });
  });

  /* Turning a key off is a real choice, and the only one that may leave an
     action unbound. */
  it('lets somebody turn an action’s key off', () => {
    expect(readBindings({ send: null }, defaults).send).toBeNull();
  });

  /* Off disk, so it can be anything. None of it may cost somebody the keys
     that shipped. */
  it('keeps the shipped key when what was saved is not a chord', () => {
    const read = readBindings({ palette: 7, send: {}, find: ['mod+f'] }, defaults);
    expect(read).toEqual({ palette: 'mod+k', send: 'enter', find: 'mod+shift+f' });
  });

  it('survives a file that is not even a set of settings', () => {
    for (const raw of [null, undefined, 'mod+k', 42, ['mod+k']]) {
      expect(readBindings(raw, defaults)).toEqual({
        palette: 'mod+k',
        send: 'enter',
        find: 'mod+shift+f',
      });
    }
  });

  /* Hand-written settings come in whatever order and whatever names the person
     had in mind; two spellings of one chord would read as two chords. */
  it('settles a hand-written chord into the one spelling', () => {
    expect(readBindings({ palette: 'Shift+Cmd+P' }, defaults).palette).toBe('mod+shift+p');
    expect(readBindings({ send: ' Option + Enter ' }, defaults).send).toBe('alt+enter');
  });

  it('ignores a key saved for an action that no longer exists', () => {
    expect(readBindings({ ancient: 'mod+j' }, defaults)).not.toHaveProperty('ancient');
  });

  it('carries through an action that ships with no key at all', () => {
    expect(readBindings({}, { ...defaults, quiet: null }).quiet).toBeNull();
  });
});

/* ========================================================================== */
/* KB-04 two actions, one chord                                                */
/* ========================================================================== */

describe('KB-04 finding a chord that is spoken for twice', () => {
  /* Silent loss: one of them simply never fires, and nothing says why. */
  it('names the chord and everything bound to it', () => {
    const found = clashes({ palette: 'mod+k', kill: 'mod+k', send: 'enter' });
    expect(found).toEqual([{ chord: 'mod+k', ids: ['palette', 'kill'] }]);
  });

  it('says nothing when every action has its own', () => {
    expect(clashes({ palette: 'mod+k', send: 'enter' })).toEqual([]);
  });

  /* Two actions that are both off are not fighting over anything. */
  it('does not count actions with no key as clashing', () => {
    expect(clashes({ one: null, two: null })).toEqual([]);
  });

  it('finds a clash a saved setting has just created', () => {
    const read = readBindings({ find: 'mod+k' }, { palette: 'mod+k', find: 'mod+shift+f' });
    expect(clashes(read).map((one) => one.ids)).toEqual([['palette', 'find']]);
  });
});
