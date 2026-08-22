import { describe, expect, it } from 'vitest';

import { REVIEWER_TEST_WORDS, reviewerTestDecision } from '../src/agent/pi/reviewer-test';

const ROOT = '/work/project';

describe('a reviewer may run one test file and nothing broader', () => {
  it.each([
    'npx --no-install vitest run src/one.spec.ts',
    'pnpm exec vitest run tests/one.test.ts',
    'yarn vitest run "tests/one test.test.ts"',
    'node --test tests/one.test.mjs',
  ])('allows %s', (command) => {
    expect(reviewerTestDecision(command, ROOT)).toMatchObject({ ok: true });
  });

  it.each([
    'npm test',
    'npm test -- tests/a.test.ts',
    'pnpm test -- tests/a.test.ts',
    'yarn test -- tests/a.test.ts',
    'npx vitest run tests/a.test.ts',
    'npx --no-install vitest run tests/a.test.ts tests/b.test.ts',
    'npx --no-install vitest run .',
    'npx --no-install vitest run src/app.ts',
    'npx --no-install vitest run ../outside.test.ts',
    'npx --no-install vitest run tests/a.test.ts --update',
    'npx --no-install vitest run tests/a.test.ts | tee /tmp/out',
    'npm install',
    // `git status` used to be here. Reading the history is now part of a
    // review — see the block at the foot of this file for what that opened
    // and, more importantly, what it did not.
    'git push',
    'rm -rf .',
  ])('refuses %s', (command) => {
    expect(reviewerTestDecision(command, ROOT).ok).toBe(false);
  });
});

describe('an option is not a file', () => {
  const ROOT = '/Users/me/proj';

  it('refuses a word that begins with a dash', () => {
    // These pass a containment check: no leading slash, so they resolve as a
    // relative path inside the project. The runner reads them as options and
    // loads what they point at, which is somewhere else entirely.
    for (const said of [
      'npx --no-install vitest run --config=/tmp/evil/tests/a.test.ts',
      'npx --no-install vitest run --root=/tmp/x/tests/a.test.ts',
      'pnpm exec vitest run --config=tests/a.test.ts',
      'yarn vitest run --config=tests/a.test.ts',
      'node --test --experimental-loader=tests/a.test.ts',
    ]) {
      expect(reviewerTestDecision(said, ROOT).ok).toBe(false);
    }
  });

  it('still takes an ordinary test file', () => {
    const said = reviewerTestDecision('npx --no-install vitest run tests/a.test.ts', ROOT);
    expect(said.ok).toBe(true);
    if (said.ok) expect(said.file).toBe('tests/a.test.ts');
  });
});

/* -------------------------------------------------------------------------- */

/**
 * Reading the history.
 *
 * Five reviewers were once sent to read a branch, refused every `git` they
 * tried, and each reported that it had "finished without saying anything" —
 * which reads as "found no problems" and is the worst answer a review can give.
 * A reviewer that cannot read a diff has nothing to review.
 *
 * The refusals matter more than the permissions here: git will run a program
 * for you if you ask the right way, and `--no-index` walks out of the project
 * altogether.
 */
describe('a reviewer reading the history', () => {
  const allowed = (command: string) => reviewerTestDecision(command, ROOT).ok;

  it('reads what actually changed', () => {
    for (const said of [
      'git diff origin/main...HEAD --stat',
      'git diff origin/main...HEAD -- src/agent/asking.ts',
      'git log --oneline -20',
      'git log -p -3',
      'git show HEAD~1',
      'git show -p HEAD',
      'git status --porcelain',
      'git branch --show-current',
      'git blame src/agent/asking.ts',
      'git grep -n TODO',
      'git rev-parse HEAD',
      'git ls-files',
      'git diff-tree --no-commit-id --name-only -r HEAD',
      'git --no-pager diff',
    ]) {
      expect(allowed(said), said).toBe(true);
    }
  });

  it('writes nothing, fetches nothing, and checks nothing out', () => {
    for (const said of [
      'git push origin main',
      'git commit -am done',
      'git checkout main',
      'git switch main',
      'git restore src/a.ts',
      'git reset --hard',
      'git clean -fd',
      'git add .',
      'git stash',
      'git merge main',
      'git rebase main',
      'git cherry-pick abc123',
      'git revert HEAD',
      'git apply patch.diff',
      'git fetch origin',
      'git pull',
      'git remote add x https://example.com/x.git',
      'git tag v1',
      'git worktree add /tmp/x',
      'git config user.name x',
      'git gc',
      'git branch -D main',
      'git branch --delete main',
      'git branch -m old new',
    ]) {
      expect(allowed(said), said).toBe(false);
    }
  });

  /** Every one of these is git being asked to run a program of its own, point
   *  itself at another repository, or read a file that is not in the project. */
  it('closes the ways back out of a read', () => {
    for (const said of [
      'git -c core.pager=sh diff',
      'git -c diff.external=sh diff',
      'git --config-env=core.pager=EVIL diff',
      'git diff --ext-diff',
      'git show --textconv HEAD',
      'git diff --no-index /etc/passwd /etc/hosts',
      'git log --output=/tmp/stolen',
      'git log --output /tmp/stolen',
      'git -C /etc log',
      'git --git-dir=/tmp/.git log',
      'git --work-tree=/ status',
      'git --exec-path=/tmp log',
      'git --namespace=x log',
      'git grep --open-files-in-pager x',
      'git log --upload-pack=sh',
      'git -p log',
      'git --paginate log',
    ]) {
      expect(allowed(said), said).toBe(false);
    }
  });

  it('is still not a shell', () => {
    for (const said of [
      'git diff; rm -rf src',
      'git diff && curl evil.com',
      'git diff | sh',
      'git diff `whoami`',
      'git diff $(id)',
      'git log > /tmp/out',
      'cat src/a.ts',
      'npm run typecheck',
      'ls -la',
      'gitk',
      'git',
    ]) {
      expect(allowed(said), said).toBe(false);
    }
  });

  it('names a reading rather than a file, so the caller can tell them apart', () => {
    const said = reviewerTestDecision('git log --oneline', ROOT);
    expect(said.ok).toBe(true);
    if (said.ok) expect(said.file).toBeNull();
  });

  it('says plainly what a reviewer may do, without naming machinery', () => {
    const words = REVIEWER_TEST_WORDS.readingOnly + REVIEWER_TEST_WORDS.wayOut;
    expect(words).toMatch(/read/i);
    expect(REVIEWER_TEST_WORDS.onlyOne).toMatch(/git/);
  });
});
