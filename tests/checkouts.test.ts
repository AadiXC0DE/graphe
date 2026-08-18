/** Naming a parallel checkout.
 *
 * One test here is a data-loss test: two live conversations handed the same name
 * write the same folder, which is the exact thing parallel checkouts exist to
 * prevent. Pure — the caller says what exists, so no disk is touched.
 */

import { describe, expect, it } from 'vitest';

import { nextCheckoutName } from '../src/history/worktree';

describe('naming a parallel checkout', () => {
  it('counts up, one name per checkout', () => {
    const first = nextCheckoutName(0, () => false);
    expect(first).toEqual({ name: 'conversation-1', made: 1 });
    expect(nextCheckoutName(first.made, () => false).name).toBe('conversation-2');
  });

  /* The bug this replaces. Open three, close the second, open another: counting
     the open ones says two, and conversation three is still working. */
  it('never hands a live conversation’s name to a new one', () => {
    const live = new Set(['conversation-1', 'conversation-3']);
    let made = 3;

    const next = nextCheckoutName(made, (name) => live.has(name));
    made = next.made;

    expect(next.name).toBe('conversation-4');
    expect(live.has(next.name)).toBe(false);
  });

  it('steps over what an earlier sitting left on disk', () => {
    const onDisk = new Set(['conversation-1', 'conversation-2', 'conversation-3']);
    expect(nextCheckoutName(0, (name) => onDisk.has(name)).name).toBe('conversation-4');
  });

  it('gives every checkout of one sitting a name of its own', () => {
    const taken = new Set<string>();
    let made = 0;
    for (let i = 0; i < 25; i += 1) {
      const next = nextCheckoutName(made, (name) => taken.has(name));
      expect(taken.has(next.name)).toBe(false);
      taken.add(next.name);
      made = next.made;
    }
    expect(taken.size).toBe(25);
  });

  it('takes the moment rather than looping when counting cannot win', () => {
    const next = nextCheckoutName(0, () => true, 1_700_000_000_000);
    expect(next.name).toBe(`conversation-${(1_700_000_000_000).toString(36)}`);
    expect(next.name).not.toMatch(/conversation-\d+$/);
  });
});
