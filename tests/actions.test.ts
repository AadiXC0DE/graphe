/** One list of actions, and what having one list is worth.
 *
 * The bug this replaces was three lists disagreeing: a chord printed in the
 * palette that nothing had bound, and one chord meaning two different things
 * depending on whether you read the menu or pressed it. So the tests that
 * matter are the ones about agreement — every action has a name and a place,
 * no two answer to the same key, and what the palette prints is what the
 * keyboard does.
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  ACTIONS,
  ACTION_WORDS,
  DEFAULT_BINDINGS,
  actionAt,
  actionsFor,
  chordFor,
  clashesIn,
  matching,
  readActions,
  type Where,
} from '../src/lib/actions';
import { saysChord } from '../src/lib/keys';

const press = (key: string, held: Partial<Record<'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey', boolean>> = {}) => ({
  key,
  ...held,
});

/* ========================================================================== */
/* AC-01 the list itself                                                       */
/* ========================================================================== */

describe('AC-01 what is in the registry', () => {
  it('holds every action once', () => {
    const ids = ACTIONS.map((one) => one.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every action a name and somewhere to be reached from', () => {
    for (const one of ACTIONS) {
      expect(one.says.length, one.id).toBeGreaterThan(0);
      expect(['anywhere', 'in a project', 'in a conversation']).toContain(one.where);
    }
  });

  /* A chord written any other way would never match a press, because a press is
     spelled by keys.ts and compared as a string. */
  it('writes every shipped chord in the one spelling', () => {
    for (const one of ACTIONS) {
      if (one.chord === null) continue;
      expect(saysChord(one.chord, true), one.id).not.toBe(ACTION_WORDS.unbound);
      for (const also of one.also ?? []) expect(saysChord(also, true), one.id).not.toBe(ACTION_WORDS.unbound);
    }
  });
});

/* ========================================================================== */
/* AC-02 no two on one key                                                     */
/* ========================================================================== */

describe('AC-02 clashes', () => {
  it('ships with none', () => {
    expect(clashesIn()).toEqual([]);
  });

  it('finds one the moment somebody makes it', () => {
    const found = clashesIn(readActions({ history: 'mod+d' }));
    expect(found).toHaveLength(1);
    expect(found[0]?.chord).toBe('mod+d');
    expect([...(found[0]?.ids ?? [])].sort()).toEqual(['design', 'history']);
  });

  /* A second key for one action is a habit, not a clash — but a second key that
     somebody else's action already answers to is. */
  it('counts an action’s other keys too', () => {
    expect(clashesIn(readActions({ canvas: 'mod+shift+t' }))).toEqual([
      { chord: 'mod+shift+t', ids: ['open', 'canvas'] },
    ]);
    expect(clashesIn(readActions({ open: 'mod+shift+t' }))).toEqual([]);
  });

  it('is quiet about the actions with no key at all', () => {
    expect(clashesIn(readActions({ changes: null, history: null }))).toEqual([]);
  });
});

/* ========================================================================== */
/* AC-03 where an action can be reached from                                   */
/* ========================================================================== */

describe('AC-03 reach', () => {
  it('nests: a conversation is inside a project', () => {
    const anywhere = actionsFor('anywhere').map((one) => one.id);
    const project = actionsFor('in a project').map((one) => one.id);
    const conversation = actionsFor('in a conversation').map((one) => one.id);

    expect(anywhere).toContain('open');
    expect(anywhere).not.toContain('design');
    expect(project).toEqual(expect.arrayContaining(anywhere));
    expect(conversation).toEqual(expect.arrayContaining(project));
    expect(conversation).toContain('tidy');
    expect(project).not.toContain('tidy');
  });

  it('hands back the chord that is bound now, not the one that shipped', () => {
    const bindings = readActions({ design: 'mod+shift+d' });
    expect(actionsFor('in a project', bindings).find((one) => one.id === 'design')?.chord).toBe('mod+shift+d');
    expect(chordFor('design', bindings)).toBe('mod+shift+d');
    expect(chordFor('design')).toBe(DEFAULT_BINDINGS['design']);
  });

  it('lets somebody turn a key off without losing the action', () => {
    const bindings = readActions({ shelf: null });
    expect(chordFor('shelf', bindings)).toBeNull();
    expect(actionsFor('in a project', bindings).map((one) => one.id)).toContain('shelf');
  });

  it('leaves the shipped chord standing when the saved file is nonsense', () => {
    for (const raw of [null, 'keys', 42, ['mod+k']]) {
      expect(chordFor('ask', readActions(raw))).toBe('mod+k');
    }
    expect(chordFor('ask', readActions({ ask: 17 }))).toBe('mod+k');
  });
});

/* ========================================================================== */
/* AC-04 a press means one thing                                               */
/* ========================================================================== */

describe('AC-04 what a press does', () => {
  it('finds the action on both machines', () => {
    expect(actionAt(press('k', { metaKey: true }), true, 'anywhere')?.id).toBe('ask');
    expect(actionAt(press('k', { ctrlKey: true }), false, 'anywhere')?.id).toBe('ask');
  });

  it('is nothing when the action cannot be reached from here', () => {
    expect(actionAt(press('d', { metaKey: true }), true, 'anywhere')).toBeNull();
    expect(actionAt(press('d', { metaKey: true }), true, 'in a project')?.id).toBe('design');
  });

  it('answers to an action’s other keys as well as its own', () => {
    expect(actionAt(press('o', { metaKey: true }), true, 'anywhere')?.id).toBe('open');
    expect(actionAt(press('t', { metaKey: true, shiftKey: true }), true, 'anywhere')?.id).toBe('open');
  });

  /* ⌘1 through ⌘9 are one action counting, not nine rows in the palette. */
  it('treats the numbered conversations as one action', () => {
    for (const number of ['1', '5', '9']) {
      expect(actionAt(press(number, { metaKey: true }), true, 'in a project')?.id).toBe('go-nth');
    }
  });

  it('follows a rebinding', () => {
    const bindings = readActions({ palette: 'mod+shift+space' });
    expect(actionAt(press('p', { metaKey: true, shiftKey: true }), true, 'anywhere', bindings)).toBeNull();
    expect(actionAt(press(' ', { metaKey: true, shiftKey: true }), true, 'anywhere', bindings)?.id).toBe('palette');
  });

  it('is nothing while only a modifier is held', () => {
    expect(actionAt(press('Meta', { metaKey: true }), true, 'in a conversation')).toBeNull();
  });
});

/* ========================================================================== */
/* AC-05 finding one by typing                                                 */
/* ========================================================================== */

describe('AC-05 the search', () => {
  const everything = actionsFor('in a conversation');

  it('is the whole list when nothing has been typed', () => {
    expect(matching('', everything)).toHaveLength(everything.length);
    expect(matching('   ', everything).map((one) => one.id)).toEqual(everything.map((one) => one.id));
  });

  it('puts what somebody half-remembers at the top', () => {
    expect(matching('canvas', everything)[0]?.id).toBe('canvas');
    expect(matching('pull request', everything)[0]?.id).toBe('reviews');
  });

  it('finds nothing rather than everything for a word nobody used', () => {
    expect(matching('refspec', everything)).toEqual([]);
  });

  it('only offers what can be reached from where you are', () => {
    expect(matching('canvas', actionsFor('anywhere'))).toEqual([]);
  });
});

describe('AC-06 the words', () => {
  it('names every reach a row can be filed under', () => {
    for (const where of ['anywhere', 'in a project', 'in a conversation'] as Where[]) {
      expect(ACTION_WORDS.where[where].length).toBeGreaterThan(0);
    }
  });
});

/* The registry exists because the palette and the keyboard were two lists that
   could disagree, and did. These are the three disagreements it settles, kept
   as tests so they cannot come back. */
describe('the palette and the keyboard agree', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');

  it('reads every chord it prints from the registry', () => {
    // Not one hard-coded `keys: 'mod+…'` left in the palette's own list.
    const from = app.indexOf('const everyCommand = useMemo');
    const to = app.indexOf('\n  }, [', from);
    expect(from).toBeGreaterThan(-1);
    expect(app.slice(from, to)).not.toMatch(/keys: '[a-z+0-9]+'/);
    expect(app.slice(from, to)).toContain('keysFor(');
  });

  /* The palette printed ⌘⇧N for a new conversation; the keyboard binds ⌘T to
     it, and ⌘⇧N to going to what is waiting. */
  it('says the key that new conversations really answer to', () => {
    expect(chordFor('new')).toBe('mod+t');
    expect(chordFor('needs-you')).toBe('mod+shift+n');
  });

  /* ⌘⇧F was advertised in the palette and answered by nothing. */
  it('has a handler for the key it promises for the file tree', () => {
    expect(chordFor('files')).toBe('mod+shift+f');
    expect(app).toContain('event.key.toLowerCase() === "f"');
  });

  it('has no two actions answering to one chord', () => {
    expect(clashesIn({})).toEqual([]);
  });
});
