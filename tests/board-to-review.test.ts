/** A board piece that finishes has to be seen.
 *
 * With the review queue as the default, work no longer arrives in the folder on
 * its own. A conversation's checkout reached the list; a board piece did not,
 * so a piece that finished had nowhere at all to be looked at.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { landsAsOneCommit, queueFrom, type Arriving } from '../src/work/reviewqueue';

const main = readFileSync(fileURLToPath(new URL('../electron/main.ts', import.meta.url)), 'utf8');

const arriving = (over: Partial<Arriving> = {}): Arriving => ({
  id: 'work-1',
  from: 'board',
  title: 'rewrite the header',
  address: 'work-1',
  files: [{ path: 'src/hero.css', added: 12, removed: 0 }],
  at: 1,
  ...over,
});

describe('a piece that lands on the board', () => {
  it('is told to the authority and put on the list, in that order', () => {
    const at = main.indexOf('function tellTheConversation(');
    const block = main.slice(at, main.indexOf('\n}', at));
    expect(block).toContain('continuations.landed(');
    expect(block).toContain("noteForReview(desk.path, open.held, piece.id, checkout, false, 'board', piece.doing)");
    expect(block.indexOf('continuations.landed(')).toBeLessThan(block.indexOf('noteForReview('));
  });

  it('says where it came from, so the row can be marked as its own kind', () => {
    expect(main).toContain("from: Arriving['from'] = 'conversation',");
    expect(queueFrom([], [arriving()])[0]?.from).toBe('board');
  });

  /* Its copy is detached and kept on the board rather than in the checkout
     index, so nothing that reads the index alone can find it. */
  it('is found by the review even though it is not a conversation checkout', () => {
    const at = main.indexOf('async function checkoutForReview(');
    const block = main.slice(at, main.indexOf('\n}', at));
    expect(block).toContain('awayDesks.get(project)?.bench.pieces.find(');
    expect(block).toContain("return { folder: piece.folder, branch: '' };");
  });
});

describe('what a branchless copy cannot do', () => {
  it('cannot keep every version, because there is no branch to bring across', () => {
    expect(landsAsOneCommit(queueFrom([], [arriving()])[0]!)).toBe(true);
  });

  it('can still keep every version when it came from a conversation', () => {
    expect(landsAsOneCommit(queueFrom([], [arriving({ from: 'conversation' })])[0]!)).toBe(false);
  });

  it('says plainly that there is nothing to push, rather than failing at git', () => {
    expect(main).toContain("if (checkout.branch === '') {");
    expect(main).toContain("what: 'This work is not on a branch.',");
  });

  it('carries its files rather than merging a branch that is not there', () => {
    expect(main).toContain("if (taking.length === entry.files.length && checkout.branch !== '') {");
  });
});
