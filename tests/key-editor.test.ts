/** One registry, read by the keyboard as well as by the palette.
 *
 * The palette read `lib/actions.ts` and the keyboard was a hand-written chain
 * of key comparisons beside it, which is the same two-lists-that-disagree bug
 * one press further in: a chord changed in the registry would have moved the
 * palette's label and left the keyboard exactly where it was.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ACTIONS, actionAt, chordFor, clashesIn, readActions } from '../src/lib/actions';

const app = readFileSync(fileURLToPath(new URL('../src/App.tsx', import.meta.url)), 'utf8');
const settings = readFileSync(
  fileURLToPath(new URL('../src/components/Settings.tsx', import.meta.url)),
  'utf8',
);

const press = (key: string, over: { shiftKey?: boolean } = {}) => ({
  key,
  metaKey: true,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...over,
});

describe('the keyboard reads the registry', () => {
  it('asks the registry what a press means, rather than comparing keys', () => {
    expect(app).toContain('const action = actionAt(');
    expect(app).toContain('bindingsNow.current,');
    // Not one `event.key === "b"` chain left behind it.
    expect(app).not.toContain('if (event.key === "b" && desk !== null)');
    expect(app).not.toContain('if (event.key === "j" && desk !== null)');
  });

  it('leaves the three keys that belong to somebody else alone', () => {
    expect(app).toContain(
      "if (action.id === 'ask' || action.id === 'send' || action.id === 'stop') return;",
    );
  });

  it('answers every action the registry says has a key in a conversation', () => {
    const owed = ACTIONS.filter(
      (one) => one.chord !== null && !['ask', 'send', 'stop'].includes(one.id),
    );
    for (const one of owed) {
      expect(app, `nothing does ${one.id}`).toContain(`case '${one.id}':`);
    }
  });

  it('still means what it meant: the shipped chords are unchanged', () => {
    expect(actionAt(press('b'), true, 'in a conversation')?.id).toBe('shelf');
    expect(actionAt(press('j'), true, 'in a conversation')?.id).toBe('page');
    expect(actionAt(press('f'), true, 'in a conversation')?.id).toBe('find');
    expect(actionAt(press('f', { shiftKey: true }), true, 'in a conversation')?.id).toBe('files');
    expect(actionAt(press('t'), true, 'in a conversation')?.id).toBe('new');
  });

  it('means nothing outside a project for an action that needs one', () => {
    expect(actionAt(press('b'), true, 'anywhere')).toBeNull();
    expect(actionAt(press('o'), true, 'anywhere')?.id).toBe('open');
  });

  it('answers the chord somebody bound rather than the one that shipped', () => {
    const bound = { shelf: 'mod+e' as const };
    expect(actionAt(press('e'), true, 'in a conversation', bound)?.id).toBe('shelf');
    expect(actionAt(press('b'), true, 'in a conversation', bound)).toBeNull();
  });

  it('answers nothing at all for an action somebody cleared', () => {
    expect(actionAt(press('b'), true, 'in a conversation', { shelf: null })).toBeNull();
  });
});

describe('changing one', () => {
  it('is the row itself, because nobody can spell a chord into a field', () => {
    expect(settings).toContain('className={`settings__chordset');
    expect(settings).toContain('onKeyDown={(event) => {');
    expect(settings).toContain('const pressed = chordOf(');
  });

  it('leaves it alone on Escape and clears it on Backspace', () => {
    expect(settings).toContain("if (event.key === 'Escape') {");
    expect(settings).toContain("if (event.key === 'Backspace' || event.key === 'Delete') {");
  });

  it('ignores a modifier held on its own, which is somebody still reaching', () => {
    expect(settings).toContain("if (pressed === '') return;");
  });

  it('says where two actions have landed on one chord', () => {
    const both = clashesIn({ shelf: 'mod+j' });
    expect(both.some((one) => one.ids.includes('shelf') && one.ids.includes('page'))).toBe(true);
    expect(settings).toContain('clashesIn(bindings)');
  });

  it('is kept on this machine, and read the forgiving way', () => {
    expect(app).toContain("const KEYS_STORE = 'graphe:keys';");
    expect(app).toContain('readActions(JSON.parse(raw))');
    // A line nobody can parse leaves the shipped chord standing.
    expect(chordFor('shelf', readActions({ shelf: 42 }))).toBe(chordFor('shelf'));
    expect(chordFor('shelf', readActions({ shelf: 'mod+e' }))).toBe('mod+e');
  });
});
