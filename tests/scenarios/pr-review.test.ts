/** T12, T13: the checkout a review reads from.
 *
 * A pull request moves while somebody is reading it, and two reviews are asked
 * for at the same moment. Both are about one thing: the folder a review opens is
 * at the head that was fetched for it, and nothing else on disk moves.
 *
 * Real repositories, real pull-request refs published by a bare origin in a
 * scratch folder, exactly as `tests/pr-checkout.test.ts` sets them up. Nothing
 * reaches the network.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* Real repositories and real git, several per test. Under a loaded machine a
   ten second ceiling is the machine talking rather than the code. */
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

import { preparePrWorktree, problemOf, prSnapshot } from '../../electron/prWorktree';

let scratch: string;
let repo: string;

function git(args: string[], cwd = repo): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'graphe-scenario-pr-')));
  repo = join(scratch, 'project');
  mkdirSync(repo);
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'nobody@example.com']);
  git(['config', 'user.name', 'Nobody']);
  writeFileSync(join(repo, 'a.txt'), 'hello\n');
  git(['add', '-A']);
  git(['commit', '-qm', 'first']);
  const origin = join(scratch, 'origin.git');
  execFileSync('git', ['init', '-q', '--bare', origin]);
  git(['remote', 'add', 'origin', origin]);
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/** One commit published as pull request `number`, on top of `from` when it is
 *  given, which is how a head moves. */
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

/* -------------------------------------------------------------------------- */

describe('T12: a head that moves while an old review is still open', () => {
  it('opens the new snapshot and leaves the old checkout where it is', async () => {
    const first = openPullRequest(7, 'a.txt', 'the first head\n');
    const one = await preparePrWorktree(repo, 7);
    expect(one.sha).toBe(first);
    expect(one.reused).toBe(false);
    expect(readFileSync(join(one.folder, 'a.txt'), 'utf8')).toBe('the first head\n');

    // The author pushes again. The head is a different commit, so it is a
    // different snapshot rather than the same folder repointed.
    const second = openPullRequest(7, 'a.txt', 'the second head\n', first);
    const two = await preparePrWorktree(repo, 7);
    expect(two.sha).toBe(second);
    expect(two.sha).not.toBe(one.sha);
    expect(two.folder).not.toBe(one.folder);
    expect(readFileSync(join(two.folder, 'a.txt'), 'utf8')).toBe('the second head\n');

    // And the review somebody is still reading is untouched: its own commit, its
    // own bytes, its own branch.
    expect(existsSync(one.folder)).toBe(true);
    expect(git(['rev-parse', 'HEAD'], one.folder).trim()).toBe(first);
    expect(git(['rev-parse', '--abbrev-ref', 'HEAD'], one.folder).trim()).toBe(one.branch);
    expect(readFileSync(join(one.folder, 'a.txt'), 'utf8')).toBe('the first head\n');
    expect(git(['status', '--porcelain'], one.folder).trim()).toBe('');

    // The one that was left is named rather than silently kept.
    const named = [...two.leftBehind, ...one.leftBehind].map((kept) => kept.folder);
    expect(named).toContain(prSnapshot(repo, 7, first).folder);
    expect(two.leftBehind.map((kept) => kept.because)).toContain('superseded');
  });

  it('never repoints a checkout that holds work', async () => {
    const first = openPullRequest(7, 'a.txt', 'the first head\n');
    const one = await preparePrWorktree(repo, 7);
    writeFileSync(join(one.folder, 'notes-of-mine.md'), 'what I was reading\n');

    const second = openPullRequest(7, 'a.txt', 'the second head\n', first);
    const two = await preparePrWorktree(repo, 7);
    expect(two.sha).toBe(second);

    const old = two.leftBehind.find((kept) => kept.folder === one.folder);
    expect(old?.because).toBe('in-use');
    expect(readFileSync(join(one.folder, 'notes-of-mine.md'), 'utf8')).toBe('what I was reading\n');
    expect(git(['rev-parse', 'HEAD'], one.folder).trim()).toBe(first);
  });
});

/* -------------------------------------------------------------------------- */

describe('T13: two fetches asked for at once', () => {
  it('gives each review the commit that was fetched for it', async () => {
    const seven = openPullRequest(7, 'seven.txt', 'seven\n');
    const eight = openPullRequest(8, 'eight.txt', 'eight\n');

    const [one, two] = await Promise.all([
      preparePrWorktree(repo, 7),
      preparePrWorktree(repo, 8),
    ]);

    expect(one.sha).toBe(seven);
    expect(two.sha).toBe(eight);
    expect(one.folder).toBe(prSnapshot(repo, 7, seven).folder);
    expect(two.folder).toBe(prSnapshot(repo, 8, eight).folder);
    expect(one.folder).not.toBe(two.folder);

    // Each folder is at the commit that was fetched for it, on its own branch,
    // with the file that head brought.
    expect(git(['rev-parse', 'HEAD'], one.folder).trim()).toBe(seven);
    expect(git(['rev-parse', 'HEAD'], two.folder).trim()).toBe(eight);
    expect(git(['rev-parse', '--abbrev-ref', 'HEAD'], one.folder).trim()).toBe(one.branch);
    expect(git(['rev-parse', '--abbrev-ref', 'HEAD'], two.folder).trim()).toBe(two.branch);
    expect(existsSync(join(one.folder, 'seven.txt'))).toBe(true);
    expect(existsSync(join(two.folder, 'eight.txt'))).toBe(true);
  });

  /* Phase 10.2 requires that two fetches asked for at once each get the SHA
     they asked for, and the same head is a SHA two reviews can ask for. What
     the code does: both calls see no branch for that head and both try to
     create it, so the loser is refused with "I fetched pull request #7 but
     could not point a branch at it" instead of reusing the checkout the winner
     just made. The folder is left alone and the message is typed, so nothing is
     lost; what is missing is the second review (electron/prWorktree.ts:505-514
     reads the branch and creates the checkout without holding anything across
     the two). */
  it.fails('gives two reviews of the same head one verified checkout rather than two', async () => {
    const head = openPullRequest(7, 'a.txt', 'only head\n');
    const [one, two] = await Promise.all([
      preparePrWorktree(repo, 7),
      preparePrWorktree(repo, 7),
    ]);

    expect(one.sha).toBe(head);
    expect(two.sha).toBe(head);
    expect(one.folder).toBe(two.folder);
    // One of them made it and the other found it; neither repointed anything,
    // and the folder is at the fetched commit either way.
    expect([one.reused, two.reused].sort()).toEqual([false, true]);
    expect(git(['worktree', 'list', '--porcelain']).split('\n').filter((line) => line === `worktree ${one.folder}`)).toHaveLength(1);
    expect(git(['rev-parse', 'HEAD'], one.folder).trim()).toBe(head);
  });

  it('reuses the one verified checkout when the reviews are asked for in turn', async () => {
    const head = openPullRequest(7, 'a.txt', 'only head\n');
    const one = await preparePrWorktree(repo, 7);
    const two = await preparePrWorktree(repo, 7);

    expect(one.reused).toBe(false);
    expect(two.reused).toBe(true);
    expect(two.sha).toBe(head);
    expect(two.folder).toBe(one.folder);
    expect(two.leftBehind).toEqual([]);
    expect(git(['rev-parse', 'HEAD'], one.folder).trim()).toBe(head);
    expect(git(['status', '--porcelain'], one.folder).trim()).toBe('');
  });

  it('refuses a pull request the origin does not publish, and says why', async () => {
    const refused = await preparePrWorktree(repo, 99).then(
      () => null,
      (cause: unknown) => cause,
    );
    expect(problemOf(refused)).toBe('fetch');
    expect((refused as Error).message).toContain('99');
  });
});
