/** The checkout a pull request review reads from.
 *
 *  It is a second copy of the project sitting inside the project, which is two
 *  promises worth holding: it never becomes part of somebody's commit, and when
 *  it cannot be made the sentence says what actually went wrong rather than
 *  "could not fetch".
 *
 *  Real repositories in a scratch folder, and no network: origin is another
 *  folder on disk, which is exactly the case — a remote that is not GitHub —
 *  the message has to get right.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { EXCLUDE_LINE, keepCheckoutsOutOfCommits, preparePrWorktree } from '../electron/prWorktree';

let scratch: string;
let repo: string;

function git(args: string[], cwd = repo): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'graphe-pr-'));
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
