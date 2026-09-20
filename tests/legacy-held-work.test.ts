// @vitest-environment jsdom
/** A row of finished work with no conversation behind it.
 *
 * Held work used to be recorded once per project rather than once per run, so a
 * row can outlive any record of which chat it came from. The plan's rule is
 * that it is kept and shown rather than dropped — the files behind it are still
 * on disk — with nothing offering to carry it over, because there is no copy to
 * carry it from. Both halves of that are held here: the reading keeps the row
 * and marks it, and the screen draws no decision for it.
 */

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import ReviewQueue from '../src/components/ReviewQueue';
import { reviewIndexText, readReviewIndex, reviewRow } from '../electron/services/review-record';
import { reviewWords, saysEntry, type Entry } from '../src/work/reviewqueue';
import type { ReviewEntry } from '../src/lib/ipc';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});

/** A row as an older version wrote it: everything a review needs except which
 *  conversation the work came out of. */
const OLDER = {
  id: 'legacy-1',
  from: 'conversation',
  title: 'A change from an older version',
  files: [{ path: 'src/app.ts', added: 4, removed: 1 }],
  at: 1_700_000_000_000,
  read: false,
};

describe('a row that cannot be attributed', () => {
  it('is kept rather than dropped, and marked as having no chat behind it', () => {
    const kept = reviewRow({ ...OLDER, address: '' });
    expect(kept).not.toBeNull();
    expect(kept?.unattributed).toBe(true);
    expect(kept?.address).toBe('');
    // Its files are what make it worth keeping: they are still on disk, and
    // they are what somebody would be looking at.
    expect(kept?.files).toEqual([{ path: 'src/app.ts', added: 4, removed: 1 }]);

    // Written down as missing rather than as empty, which is the same thing an
    // older version's file would hold.
    const missing = reviewRow({ ...OLDER });
    expect(missing?.unattributed).toBe(true);

    // A row that does name its conversation is not marked, and is untouched.
    const known = reviewRow({ ...OLDER, address: '/chats/atlas.jsonl' });
    expect(known?.unattributed).toBeUndefined();
    expect(known?.address).toBe('/chats/atlas.jsonl');
  });

  it('is still dropped when there is nothing to look at, attributed or not', () => {
    // Nothing to look at is not a review: a row with no files draws a card
    // with no files in it.
    expect(reviewRow({ ...OLDER, address: '', files: [] })).toBeNull();
    expect(reviewRow({ ...OLDER, address: '/chats/atlas.jsonl' })).not.toBeNull();
    expect(reviewRow(null)).toBeNull();
    expect(reviewRow('half a row')).toBeNull();
  });

  it('survives the round trip to disk and back', () => {
    const text = reviewIndexText({
      entries: [
        { id: 'legacy-1', from: 'conversation', title: 'Older', address: '', files: [], at: 1, read: false, unattributed: true },
      ],
      mirroring: [],
    });
    // An empty one is not stored at all; one with files is.
    const stored = reviewIndexText({
      entries: [
        {
          id: 'legacy-1',
          from: 'conversation',
          title: 'Older',
          address: '',
          files: [{ path: 'src/app.ts', added: 1, removed: 0 }],
          at: 1,
          read: false,
          unattributed: true,
        },
      ],
      mirroring: [],
    });
    expect(readReviewIndex(text).entries).toEqual([]);
    const back = readReviewIndex(stored).entries;
    expect(back).toHaveLength(1);
    expect(back[0]?.unattributed).toBe(true);
    expect(back[0]?.address).toBe('');
    // A file that will not parse is an empty queue rather than a throw.
    expect(readReviewIndex('half a file')).toEqual({ entries: [], mirroring: [] });
  });

  it('names where it came from in the words for it', () => {
    const one: Entry = {
      id: 'legacy-1',
      from: 'conversation',
      title: 'Older',
      address: '',
      files: [{ path: 'src/app.ts', added: 1, removed: 0 }],
      at: 1,
      read: false,
      unattributed: true,
    };
    expect(saysEntry(one)).toContain(reviewWords.older);
    expect(saysEntry({ ...one, unattributed: undefined, address: '/chats/a.jsonl' })).toContain(
      reviewWords.froms.conversation,
    );
  });
});

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  if (root !== null) act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
});

/** The screen with one entry on it, drawn the way `App` draws it. */
function draw(entry: ReviewEntry): HTMLDivElement {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root?.render(
      createElement(ReviewQueue, {
        entries: [entry],
        chosen: entry.id,
        diff: '',
        busy: false,
        onChoose: () => undefined,
        onFile: () => undefined,
        onDecide: () => undefined,
        onLand: () => undefined,
        onOpenPr: () => undefined,
        onRefresh: () => undefined,
        onClose: () => undefined,
        onExplain: () => undefined,
        onFix: () => undefined,
      }),
    );
  });
  return host;
}

const RE = (one: Entry): ReviewEntry => ({ ...one, branch: '' });

describe('the review screen, for a row with no chat behind it', () => {
  it('offers nothing that would carry its files over', () => {
    const drawn = draw(
      RE({
        id: 'legacy-1',
        from: 'conversation',
        title: 'A change from an older version',
        address: '',
        files: [{ path: 'src/app.ts', added: 4, removed: 1 }],
        at: 1_700_000_000_000,
        read: false,
        unattributed: true,
      }),
    );
    const words = drawn.textContent ?? '';
    expect(words).toContain(reviewWords.olderWhy);
    // Not one of the four decisions, and not the press that would land them.
    expect(words).not.toContain(reviewWords.take);
    expect(words).not.toContain(reviewWords.mine);
    expect(words).not.toContain(reviewWords.land);
    expect(drawn.querySelectorAll('.reviewq__verdict')).toHaveLength(0);
    expect(drawn.querySelectorAll('.reviewq__do')).toHaveLength(0);
    expect(drawn.querySelectorAll('.reviewq__second')).toHaveLength(0);
  });

  it('draws the ordinary four decisions for a row that does name its chat', () => {
    const drawn = draw(
      RE({
        id: '/chats/atlas.jsonl',
        from: 'conversation',
        title: 'A change from a conversation',
        address: '/chats/atlas.jsonl',
        files: [{ path: 'src/app.ts', added: 4, removed: 1 }],
        at: 1_700_000_000_000,
        read: false,
      }),
    );
    const words = drawn.textContent ?? '';
    expect(words).toContain(reviewWords.take);
    expect(words).toContain(reviewWords.mine);
    expect(drawn.querySelectorAll('.reviewq__verdict')).toHaveLength(4);
    expect(drawn.querySelectorAll('.reviewq__do')).toHaveLength(1);
  });
});
