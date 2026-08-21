import { describe, expect, it } from 'vitest';

import { reviewerTestDecision } from '../src/agent/pi/reviewer-test';

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
    'git status',
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
