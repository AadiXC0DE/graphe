/** What survives between one sitting and the next.
 *
 * The folder a conversation works in is given back whenever nobody is in it, so
 * the index is read at a moment when the folder it names is usually not there.
 * Reading that as a broken row is how a conversation comes back on a fresh
 * branch with its work orphaned, which is the one outcome none of this is
 * allowed to produce.
 */

import { describe, expect, it } from 'vitest';

import { checkoutRow, readCheckoutIndex } from '../src/history/checkouts';
import { branchFor } from '../src/history/worktree';

const anywhere = () => true;

describe('checkoutRow', () => {
  it('reads a row that names its branch', () => {
    expect(checkoutRow({ folder: '/w/conversation-2', branch: 'graphe/conversation-2' })).toEqual({
      folder: '/w/conversation-2',
      branch: 'graphe/conversation-2',
    });
  });

  it('reads a row from before the branch was kept, from the name that made it', () => {
    expect(checkoutRow('/w/conversation-2')).toEqual({
      folder: '/w/conversation-2',
      branch: 'graphe/conversation-2',
    });
  });

  it('agrees with the branch the checkout was actually created on', () => {
    // The migration is only safe while these two stay the same function.
    const row = checkoutRow('/somewhere/worktrees/proj/conversation-7');
    expect(row?.branch).toBe(branchFor('conversation-7'));
  });

  it('turns anything else down rather than inventing a branch', () => {
    expect(checkoutRow(null)).toBeNull();
    expect(checkoutRow(42)).toBeNull();
    expect(checkoutRow([])).toBeNull();
    expect(checkoutRow('')).toBeNull();
    expect(checkoutRow({ folder: '/w/one' })).toBeNull();
    expect(checkoutRow({ branch: 'graphe/one' })).toBeNull();
    expect(checkoutRow({ folder: '/w/one', branch: '' })).toBeNull();
  });
});

describe('readCheckoutIndex', () => {
  it('keeps a row whose folder is not on disk, because that is a checkout put away', () => {
    const found = readCheckoutIndex(
      { '/sessions/a.jsonl': { folder: '/w/conversation-2', branch: 'graphe/conversation-2' } },
      anywhere,
    );
    expect(found.get('/sessions/a.jsonl')).toEqual({
      folder: '/w/conversation-2',
      branch: 'graphe/conversation-2',
    });
  });

  it('carries a conversation from the older shape without losing its branch', () => {
    const found = readCheckoutIndex({ 'new-1': '/w/conversation-3' }, anywhere);
    expect(found.get('new-1')?.branch).toBe('graphe/conversation-3');
  });

  it('leaves out folders that belong to somewhere else', () => {
    const found = readCheckoutIndex(
      {
        mine: { folder: '/w/mine/conversation-1', branch: 'graphe/conversation-1' },
        theirs: { folder: '/elsewhere/conversation-1', branch: 'graphe/conversation-1' },
      },
      (folder) => folder.startsWith('/w/mine/'),
    );
    expect([...found.keys()]).toEqual(['mine']);
  });

  it('is empty for anything that is not an index', () => {
    for (const bad of [null, undefined, 'nonsense', 7, [1, 2]]) {
      expect(readCheckoutIndex(bad, anywhere).size).toBe(0);
    }
  });

  it('drops one unreadable row without losing the rest', () => {
    const found = readCheckoutIndex(
      {
        good: { folder: '/w/conversation-1', branch: 'graphe/conversation-1' },
        bad: { folder: 12 },
        '': '/w/conversation-9',
      },
      anywhere,
    );
    expect([...found.keys()]).toEqual(['good']);
  });

  it('round-trips what the app writes, folder away or not', () => {
    // What `saveCheckouts` writes: the conversation's transcript, then the row.
    const written = {
      '/sessions/one.jsonl': { folder: '/w/conversation-1', branch: 'graphe/conversation-1' },
      '/sessions/two.jsonl': { folder: '/w/conversation-2', branch: 'graphe/conversation-2' },
    };
    const back = readCheckoutIndex(JSON.parse(JSON.stringify(written)), anywhere);
    expect(back.size).toBe(2);
    expect(back.get('/sessions/two.jsonl')).toEqual(written['/sessions/two.jsonl']);
  });
});
