/** Which code a pull request review actually reads.
 *
 * The folder somebody has open is a line of work like any other, and very often
 * not the one the pull request is about. Told to walk it for context, a review
 * reads whatever happens to be checked out and reports it as the pull request —
 * every finding true of the folder, and wrong about the change. The whole point
 * of what follows is that a review can never be unaware of which it is looking
 * at.
 */

import { describe, expect, it } from 'vitest';

import { reviewPrompt, whereToRead } from '../src/components/ReviewsView';
import type { RepoItem } from '../src/lib/ipc';

const HEAD = 'c5f9607874907e2b1c9a4d3e2f1a0b9c8d7e6f5a';
const OTHER = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';

function pull(over: Partial<RepoItem> = {}): RepoItem {
  return {
    number: 11,
    kind: 'pr',
    title: 'A pull request',
    state: 'OPEN',
    url: 'https://github.com/owner/repo/pull/11',
    description: null,
    author: 'someone',
    updatedAt: '',
    baseRef: 'main',
    headRef: 'image-and-queue',
    headSha: HEAD,
    draft: false,
    ...over,
  };
}

describe('whereToRead — the folder is never assumed to be the pull request', () => {
  it('reads the folder when the folder really is this pull request', () => {
    const said = whereToRead(pull(), { branch: 'image-and-queue', sha: HEAD });
    expect(said).toContain('is this pull request');
    expect(said).not.toContain('not this pull request');
    expect(said).toContain('c5f9607');
  });

  it('refuses the folder when it is on something else, and says what', () => {
    const said = whereToRead(pull(), { branch: 'backlog-4', sha: OTHER });
    // The exact shape of the bug: a review of backlog-4 posted as a review of
    // the pull request.
    expect(said).toContain('not this pull request');
    expect(said).toContain('backlog-4');
    expect(said).toContain('Do not read files from the folder');
    // And a way to read the right ones instead.
    expect(said).toContain('git fetch origin pull/11/head');
    expect(said).toContain(`git show ${HEAD}:`);
  });

  it('refuses the folder when nothing could be read about it', () => {
    const said = whereToRead(pull(), null);
    expect(said).toContain('not this pull request');
    expect(said).toContain('git show');
  });

  it('makes the review check for itself when github did not say', () => {
    const said = whereToRead(pull({ headSha: null }), { branch: 'anything', sha: OTHER });
    expect(said).toContain('may be on a different line of work');
    expect(said).toContain('git rev-parse HEAD');
    expect(said).toContain('headRefOid');
  });

  it('is never silent about where it is reading from', () => {
    for (const here of [null, { branch: 'x', sha: OTHER }, { branch: null, sha: HEAD }]) {
      for (const item of [pull(), pull({ headSha: null }), pull({ headRef: null })]) {
        expect(whereToRead(item, here).trim()).not.toBe('');
      }
    }
  });
});

describe('reviewPrompt carries it', () => {
  it('tells the review the folder is not the pull request', () => {
    const said = reviewPrompt(pull(), 'owner/repo', { branch: 'backlog-4', sha: OTHER });
    expect(said).toContain('not this pull request');
    // The instruction that caused it is gone for good.
    expect(said).not.toContain('walk the checked-out code in this folder');
  });

  it('still asks for the pull request itself, whatever the folder is on', () => {
    const said = reviewPrompt(pull(), 'owner/repo', { branch: 'backlog-4', sha: OTHER });
    expect(said).toContain('gh pr diff 11 -R owner/repo');
  });

  it('says nothing false when the caller knows nothing about the folder', () => {
    const said = reviewPrompt(pull(), 'owner/repo');
    expect(said).toContain('not this pull request');
  });
});
