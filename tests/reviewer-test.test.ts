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
