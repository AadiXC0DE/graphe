/** The checkout a pull request review reads from.
 *
 *  It is a second copy of the project sitting inside the project, which is two
 *  promises worth holding: it never becomes part of somebody's commit, and when
 *  it cannot be made the sentence says what actually went wrong rather than
 *  "could not fetch".
 *
 *  Real repositories in a scratch folder. Origin is another folder on disk with
 *  pull requests published the way GitHub publishes them, so the fetch a review
 *  makes is the fetch a real one makes, and nothing reaches the network.
 */

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  EXCLUDE_LINE,
  keepCheckoutsOutOfCommits,
  preparePrWorktree,
  prSnapshot,
  problemOf,
  removePrCheckout,
} from '../electron/prWorktree';

let scratch: string;
let repo: string;

function git(args: string[], cwd = repo): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

beforeEach(() => {
  // Resolved, because macOS hands out `/var/folders` paths that are really
  // `/private/var`, and git reports the resolved name.
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'graphe-pr-')));
  repo = join(scratch, 'project');
  mkdirSync(repo);
  git(['init', '-q']);
  git(['config', 'user.email', 'nobody@example.com']);
  git(['config', 'user.name', 'Nobody']);
  writeFileSync(join(repo, 'a.txt'), 'hello\n');
  git(['add', '-A']);
  git(['commit', '-qm', 'first']);
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/** A remote publishing pull requests the way GitHub does. */
function withOrigin(): void {
  const origin = join(scratch, 'origin.git');
  execFileSync('git', ['init', '-q', '--bare', origin]);
  git(['remote', 'add', 'origin', origin]);
}

/** One commit, published as pull request `number`. Committing on top of an
 *  earlier head is how a pull request moves, so `from` starts there. */
function openPullRequest(number: number, file: string, text: string, from?: string): string {
  const base = git(['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  const branch = `pull-${String(number)}`;
  git(from === undefined ? ['checkout', '-q', '-b', branch] : ['checkout', '-q', '-b', branch, from]);
  writeFileSync(join(repo, file), text);
  git(['add', '-A']);
  git(['commit', '-qm', `pull request ${String(number)}`]);
  const sha = git(['rev-parse', 'HEAD']).trim();
  git(['push', '-q', 'origin', `HEAD:refs/pull/${String(number)}/head`]);
  git(['checkout', '-q', base]);
  git(['branch', '-D', branch]);
  return sha;
}

describe('a review checkout inside the project', () => {
  /* `git add -A` stages a worktree folder as an embedded repository, so without
     this the review checkout lands in the next commit somebody makes. */
  it('is never staged by an add of everything', async () => {
    await keepCheckoutsOutOfCommits(repo);
    git(['worktree', 'add', '--force', '-q', join(repo, '.graphe/worktrees/pr-1'), 'HEAD']);

    git(['add', '-A']);

    expect(git(['status', '--porcelain'])).not.toContain('.graphe');
  });

  it('is staged when nothing keeps it out, which is what this stops', () => {
    git(['worktree', 'add', '--force', '-q', join(repo, '.graphe/worktrees/pr-1'), 'HEAD']);

    git(['-c', 'advice.addEmbeddedRepo=false', 'add', '-A']);

    expect(git(['status', '--porcelain'])).toContain('.graphe');
  });

  it('leaves the project\'s own .gitignore alone', async () => {
    writeFileSync(join(repo, '.gitignore'), 'dist\n');
    git(['add', '-A']);
    git(['commit', '-qm', 'ignore']);

    await keepCheckoutsOutOfCommits(repo);

    expect(readFileSync(join(repo, '.gitignore'), 'utf8')).toBe('dist\n');
    expect(git(['status', '--porcelain']).trim()).toBe('');
  });

  it('keeps whatever the exclude file already held, and says it once', async () => {
    const exclude = join(repo, '.git', 'info', 'exclude');
    writeFileSync(exclude, '# mine\nscratch/\n');

    await keepCheckoutsOutOfCommits(repo);
    await keepCheckoutsOutOfCommits(repo);

    const text = readFileSync(exclude, 'utf8');
    expect(text).toContain('scratch/');
    expect(text.split('\n').filter((line) => line.trim() === EXCLUDE_LINE)).toHaveLength(1);
  });

  it('answers false where there is no repository to exclude anything in', async () => {
    const plain = join(scratch, 'not-a-repo');
    mkdirSync(plain);
    expect(await keepCheckoutsOutOfCommits(plain)).toBe(false);
  });
});

describe('when the checkout cannot be made', () => {
  it('says the remote is not GitHub rather than "could not fetch"', async () => {
    const other = join(scratch, 'origin.git');
    execFileSync('git', ['init', '-q', '--bare', other]);
    git(['remote', 'add', 'origin', other]);

    const failed = await preparePrWorktree(repo, 7).then(
      () => null,
      (cause: unknown) => cause as Error,
    );

    expect(failed).toBeInstanceOf(Error);
    expect(failed?.message).toContain('pull request #7');
    expect(failed?.message).toContain('GitHub');
    // What git said is kept for the details, not dropped on the floor.
    expect((failed?.cause as Error | undefined)?.message ?? '').not.toBe('');
  });

  it('refuses a number that is not one', async () => {
    await expect(preparePrWorktree(repo, 0)).rejects.toThrow();
    await expect(preparePrWorktree(repo, -3)).rejects.toThrow();
  });
});

describe('a review checkout of one pull request head', () => {
  beforeEach(() => {
    withOrigin();
  });

  /* `FETCH_HEAD` is one file for the whole repository and every fetch writes
     it, so a commit read from it later is whichever fetch ran last. */
  it('reads the head it asked for, not whichever fetch ran last', async () => {
    const first = openPullRequest(1, 'one.txt', 'first\n');
    const second = openPullRequest(2, 'two.txt', 'second\n');

    const one = await preparePrWorktree(repo, 1);
    // Another fetch — a second review, a pull in a terminal — moves it.
    git(['fetch', '-q', 'origin', 'pull/2/head']);
    expect(git(['rev-parse', 'FETCH_HEAD']).trim()).toBe(second);

    const again = await preparePrWorktree(repo, 1);
    const two = await preparePrWorktree(repo, 2);

    expect(again.folder).toBe(one.folder);
    expect(again.reused).toBe(true);
    expect(two.folder).not.toBe(one.folder);
    expect(git(['rev-parse', 'HEAD'], one.folder).trim()).toBe(first);
    expect(git(['rev-parse', 'HEAD'], two.folder).trim()).toBe(second);
    expect(readFileSync(join(one.folder, 'one.txt'), 'utf8')).toBe('first\n');
    expect(existsSync(join(one.folder, 'two.txt'))).toBe(false);
    expect(readFileSync(join(two.folder, 'two.txt'), 'utf8')).toBe('second\n');
    // The ref the fetch went into is ours alone and does not outlive the call.
    expect(git(['for-each-ref', 'refs/graphe/pr-fetch']).trim()).toBe('');
  });

  it('leaves a review that is being read exactly where it is', async () => {
    const head = openPullRequest(1, 'one.txt', 'first\n');
    const one = await preparePrWorktree(repo, 1);
    writeFileSync(join(one.folder, 'reading.md'), 'what I think so far\n');

    const refused = await preparePrWorktree(repo, 1).then(
      () => null,
      (cause: unknown) => cause,
    );

    expect(problemOf(refused)).toBe('in-use');
    expect(readFileSync(join(one.folder, 'reading.md'), 'utf8')).toBe('what I think so far\n');
    expect(git(['rev-parse', 'HEAD'], one.folder).trim()).toBe(head);
    expect(git(['rev-parse', `refs/heads/${one.branch}`]).trim()).toBe(head);
  });

  it('makes a new snapshot when the pull request moves, and names the old one', async () => {
    const before = openPullRequest(1, 'one.txt', 'first\n');
    const one = await preparePrWorktree(repo, 1);
    writeFileSync(join(one.folder, 'reading.md'), 'notes\n');
    const after = openPullRequest(1, 'one.txt', 'first, changed\n', before);

    const two = await preparePrWorktree(repo, 1);

    expect(two.folder).not.toBe(one.folder);
    expect(two.sha).toBe(after);
    expect(git(['rev-parse', 'HEAD'], two.folder).trim()).toBe(after);
    expect(readFileSync(join(two.folder, 'one.txt'), 'utf8')).toBe('first, changed\n');
    // The review somebody was reading is untouched, and said to be there.
    expect(existsSync(join(one.folder, 'reading.md'))).toBe(true);
    expect(git(['rev-parse', 'HEAD'], one.folder).trim()).toBe(before);
    expect(two.leftBehind).toEqual([{ folder: one.folder, sha: before, because: 'in-use' }]);
  });

  /* The branch name carries the commit, so a branch already at another commit
     is somebody else's and must not be force-moved onto this head. */
  it('reports a branch that is already at an unexpected commit', async () => {
    const head = openPullRequest(1, 'one.txt', 'first\n');
    const snapshot = prSnapshot(repo, 1, head);
    const elsewhere = git(['rev-parse', 'HEAD']).trim();
    git(['branch', snapshot.branch, elsewhere]);

    const refused = await preparePrWorktree(repo, 1).then(
      () => null,
      (cause: unknown) => cause,
    );

    expect(problemOf(refused)).toBe('collision');
    expect(git(['rev-parse', `refs/heads/${snapshot.branch}`]).trim()).toBe(elsewhere);
    expect(existsSync(snapshot.folder)).toBe(false);
  });

  it('will not repoint a checkout that sits at another commit', async () => {
    const head = openPullRequest(1, 'one.txt', 'first\n');
    const snapshot = prSnapshot(repo, 1, head);
    const elsewhere = git(['rev-parse', 'HEAD']).trim();
    git(['branch', snapshot.branch, head]);
    git(['worktree', 'add', '-q', '--force', snapshot.folder, snapshot.branch]);
    git(['checkout', '-q', '--detach', elsewhere], snapshot.folder);

    const refused = await preparePrWorktree(repo, 1).then(
      () => null,
      (cause: unknown) => cause,
    );

    expect(problemOf(refused)).toBe('in-use');
    expect(git(['rev-parse', 'HEAD'], snapshot.folder).trim()).toBe(elsewhere);
    expect(git(['rev-parse', `refs/heads/${snapshot.branch}`]).trim()).toBe(head);
  });

  it('will not reuse a checkout that is on somebody else\'s branch', async () => {
    const head = openPullRequest(1, 'one.txt', 'first\n');
    const snapshot = prSnapshot(repo, 1, head);
    git(['branch', 'somebody-else', head]);
    git(['worktree', 'add', '-q', '--force', snapshot.folder, 'somebody-else']);

    const refused = await preparePrWorktree(repo, 1).then(
      () => null,
      (cause: unknown) => cause,
    );

    expect(problemOf(refused)).toBe('collision');
    expect(git(['rev-parse', '--abbrev-ref', 'HEAD'], snapshot.folder).trim()).toBe('somebody-else');
  });

  it('will not touch a folder that is not a checkout of this project', async () => {
    const head = openPullRequest(1, 'one.txt', 'first\n');
    const snapshot = prSnapshot(repo, 1, head);
    mkdirSync(snapshot.folder, { recursive: true });
    writeFileSync(join(snapshot.folder, 'somebody-elses.txt'), 'mine\n');

    const refused = await preparePrWorktree(repo, 1).then(
      () => null,
      (cause: unknown) => cause,
    );

    expect(problemOf(refused)).toBe('collision');
    expect(readFileSync(join(snapshot.folder, 'somebody-elses.txt'), 'utf8')).toBe('mine\n');
  });

  /* No forced add: a checkout that cannot be made where it belongs is reported,
     with what is still there, rather than put there anyway. */
  it('reports a partial result rather than forcing the checkout in', async () => {
    const head = openPullRequest(1, 'one.txt', 'first\n');
    const snapshot = prSnapshot(repo, 1, head);
    mkdirSync(join(repo, '.graphe'), { recursive: true });
    writeFileSync(join(repo, '.graphe', 'worktrees'), 'not a folder\n');

    const refused = await preparePrWorktree(repo, 1).then(
      () => null,
      (cause: unknown) => cause,
    );

    expect(problemOf(refused)).toBe('partial');
    expect(readFileSync(join(repo, '.graphe', 'worktrees'), 'utf8')).toBe('not a folder\n');
    expect(git(['rev-parse', `refs/heads/${snapshot.branch}`]).trim()).toBe(head);
  });
});

describe('taking a review checkout away', () => {
  beforeEach(() => {
    withOrigin();
  });

  /* A locked checkout is somebody's: removal refuses rather than forcing, and
     says what is still there instead of claiming it went. */
  it('refuses while something has hold of it, and leaves it there', async () => {
    const head = openPullRequest(1, 'one.txt', 'first\n');
    const one = await preparePrWorktree(repo, 1);
    git(['worktree', 'lock', one.folder]);

    const removed = await removePrCheckout(repo, 1, head);

    expect(removed.ok).toBe(false);
    expect(removed.ok ? '' : removed.because).toContain(one.folder);
    expect(existsSync(one.folder)).toBe(true);
    expect(git(['worktree', 'list', '--porcelain'])).toContain(one.folder);
    expect(git(['rev-parse', `refs/heads/${one.branch}`]).trim()).toBe(head);
  });

  it('will not take away a checkout that holds work', async () => {
    const head = openPullRequest(1, 'one.txt', 'first\n');
    const one = await preparePrWorktree(repo, 1);
    writeFileSync(join(one.folder, 'reading.md'), 'notes\n');

    const removed = await removePrCheckout(repo, 1, head);

    expect(removed.ok).toBe(false);
    expect(readFileSync(join(one.folder, 'reading.md'), 'utf8')).toBe('notes\n');
  });

  it('takes away only the checkout it wrote down, and keeps the branch', async () => {
    const head = openPullRequest(1, 'one.txt', 'first\n');
    const one = await preparePrWorktree(repo, 1);

    // A commit it was not made for is not this snapshot, so nothing goes.
    const wrong = await removePrCheckout(repo, 1, git(['rev-parse', 'HEAD']).trim());
    expect(wrong.ok).toBe(false);
    expect(existsSync(one.folder)).toBe(true);

    const removed = await removePrCheckout(repo, 1, head);

    expect(removed).toEqual({ ok: true });
    expect(existsSync(one.folder)).toBe(false);
    expect(git(['worktree', 'list', '--porcelain'])).not.toContain(one.folder);
    // The branch is where the head is kept, so it stays.
    expect(git(['rev-parse', `refs/heads/${one.branch}`]).trim()).toBe(head);
  });
});
