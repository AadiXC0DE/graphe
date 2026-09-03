/** What the pull request screen decides before it draws anything.
 *
 * The bugs this exists to prevent: a merged pull request shown under Open
 * because the state word arrived in a different case; a draft counted as
 * something waiting to be merged; a line of checks that says everything passed
 * while one of them is red; and a comment landing under the wrong file because
 * two files changed the same line number.
 */

import { describe, expect, it } from 'vitest';

import type { PullCheck, PullComment, RepoItem } from '../src/lib/ipc';
import {
  byLine,
  checkLine,
  chipsFor,
  commentsAt,
  firstFilter,
  issuePrompt,
  listFor,
  markOf,
  moveBy,
  rowSub,
  underFilter,
} from '../src/work/pulls';

function pull(over: Partial<RepoItem> = {}): RepoItem {
  return {
    number: 7,
    kind: 'pr',
    title: 'A pull request',
    state: 'OPEN',
    url: 'https://github.com/owner/repo/pull/7',
    description: null,
    author: 'someone',
    updatedAt: '',
    baseRef: 'main',
    headRef: 'a-branch',
    headSha: null,
    draft: false,
    ...over,
  };
}

function issue(over: Partial<RepoItem> = {}): RepoItem {
  return pull({ kind: 'issue', state: 'OPEN', baseRef: null, headRef: null, ...over });
}

function check(over: Partial<PullCheck> = {}): PullCheck {
  return { name: 'tests', state: 'passed', link: null, ...over };
}

function comment(over: Partial<PullComment> = {}): PullComment {
  return {
    id: '1',
    path: 'src/app.ts',
    line: 12,
    author: 'someone',
    body: 'This reads oddly.',
    at: '2026-01-01T00:00:00Z',
    ...over,
  };
}

describe('markOf gives every row a shape as well as a colour', () => {
  it('reads the state whatever case github sent it in', () => {
    expect(markOf(pull({ state: 'MERGED' }))).toBe('merged');
    expect(markOf(pull({ state: 'merged' }))).toBe('merged');
    expect(markOf(pull({ state: 'Closed' }))).toBe('closed');
  });

  it('marks a draft apart from an open pull request', () => {
    expect(markOf(pull({ draft: true }))).toBe('draft');
    expect(markOf(pull({ draft: false }))).toBe('open');
  });

  it('marks an issue as an issue whatever its state says', () => {
    expect(markOf(issue({ state: 'CLOSED' }))).toBe('issue');
  });
});

describe('the chips filter by state, and issues are one more state', () => {
  it('keeps a draft under Open, because it is still in front of you', () => {
    expect(underFilter(pull({ draft: true }), 'open')).toBe(true);
    expect(underFilter(pull({ draft: true }), 'closed')).toBe(false);
  });

  it('never shows an issue under a pull request chip', () => {
    expect(underFilter(issue(), 'open')).toBe(false);
    expect(underFilter(issue(), 'issues')).toBe(true);
  });

  it('counts each chip over the whole list', () => {
    const items = [
      pull({ number: 1 }),
      pull({ number: 2, draft: true }),
      pull({ number: 3, state: 'MERGED' }),
      issue({ number: 4 }),
    ];
    const counts = Object.fromEntries(chipsFor(items).map((one) => [one.id, one.count]));
    expect(counts).toEqual({ open: 2, merged: 1, closed: 0, issues: 1 });
  });

  it('keeps every chip even at zero, so the row does not move', () => {
    expect(chipsFor([]).map((one) => one.id)).toEqual(['open', 'merged', 'closed', 'issues']);
  });

  it('lists only what the chip asked for', () => {
    const items = [pull({ number: 1 }), pull({ number: 2, state: 'CLOSED' })];
    expect(listFor(items, 'closed').map((one) => one.number)).toEqual([2]);
  });
});

describe('firstFilter lands somewhere there is something to read', () => {
  it('opens on Open when anything is open', () => {
    expect(firstFilter([pull(), pull({ number: 2, state: 'MERGED' })])).toBe('open');
  });

  it('falls through to the first chip that has rows', () => {
    expect(firstFilter([pull({ state: 'MERGED' })])).toBe('merged');
    expect(firstFilter([issue()])).toBe('issues');
  });

  it('stays on Open when there is nothing at all', () => {
    expect(firstFilter([])).toBe('open');
  });
});

describe('rowSub leaves out what is not known yet', () => {
  it('joins the three parts when all three are there', () => {
    expect(rowSub('someone', '2h ago', 3)).toBe('someone · 2h ago · 3 files');
  });

  it('says one file rather than 1 files', () => {
    expect(rowSub('someone', '2h ago', 1)).toBe('someone · 2h ago · 1 file');
  });

  it('drops the file count before the diff has been read', () => {
    expect(rowSub('someone', '2h ago', null)).toBe('someone · 2h ago');
  });

  it('drops the time when github did not say', () => {
    expect(rowSub('someone', '', null)).toBe('someone');
  });
});

describe('checkLine says the worst thing first', () => {
  it('says nothing at all when github reported no checks', () => {
    expect(checkLine([])).toBeNull();
  });

  it('names the failing check and hands over its link', () => {
    const said = checkLine([
      check({ name: 'lint' }),
      check({ name: 'tests', state: 'failed', link: 'https://github.com/run/1' }),
    ]);
    expect(said).toEqual({ good: false, says: 'tests failed', link: 'https://github.com/run/1' });
  });

  it('does not claim everything passed while one is still running', () => {
    const said = checkLine([check({ name: 'lint' }), check({ name: 'tests', state: 'pending' })]);
    expect(said?.good).toBe(true);
    expect(said?.says).toBe('1 check running');
  });

  it('counts only what actually passed, not what was skipped', () => {
    const said = checkLine([
      check({ name: 'lint' }),
      check({ name: 'tests' }),
      check({ name: 'deploy', state: 'skipped' }),
    ]);
    expect(said?.says).toBe('2 checks passed');
  });
});

describe('comments belong to a file and a line, not a line', () => {
  it('never returns another file’s comment on the same line number', () => {
    const all = [comment(), comment({ id: '2', path: 'src/other.ts' })];
    expect(commentsAt(all, 'src/app.ts', 12).map((one) => one.id)).toEqual(['1']);
  });

  it('returns nothing for a line nobody wrote on', () => {
    expect(commentsAt([comment()], 'src/app.ts', 40)).toEqual([]);
  });

  it('groups a thread in the order it was written', () => {
    const grouped = byLine([
      comment({ id: 'b', at: '2026-01-02T00:00:00Z' }),
      comment({ id: 'a', at: '2026-01-01T00:00:00Z' }),
    ]);
    expect(grouped.get('src/app.ts:12')?.map((one) => one.id)).toEqual(['a', 'b']);
  });
});

describe('moveBy wraps rather than sticking', () => {
  it('goes round the bottom and the top', () => {
    expect(moveBy(3, 2, 1)).toBe(0);
    expect(moveBy(3, 0, -1)).toBe(2);
  });

  it('answers zero for an empty list rather than a negative index', () => {
    expect(moveBy(0, 0, -1)).toBe(0);
  });
});

describe('issuePrompt starts from what was actually asked for', () => {
  it('carries the issue title and body into the first message', () => {
    const said = issuePrompt(issue({ number: 9, title: 'Rows jump', description: 'On refresh.' }), 'owner/repo');
    expect(said).toContain('issue #9 in owner/repo');
    expect(said).toContain('Rows jump');
    expect(said).toContain('On refresh.');
  });

  it('says so plainly when an issue has no description', () => {
    expect(issuePrompt(issue({ description: '  ' }), 'owner/repo')).toContain('no description');
  });
});
