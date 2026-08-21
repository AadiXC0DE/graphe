import { describe, expect, it } from 'vitest';

import { HELPER_DECLINED, mayRun, ROLES } from '../src/agent/pi/child';

const allow = { kind: 'allow' as const };

describe('reviewer one-file test capability', () => {
  it('holds bash but only for one allowlisted test file inside the project', () => {
    expect(ROLES.reviewer.tools).toContain('bash');
    expect(
      mayRun(
        ROLES.reviewer,
        { name: 'bash', input: { command: 'npx --no-install vitest run tests/one.test.ts' } },
        allow,
        false,
        '/work/project',
      ),
    ).toBeUndefined();
    expect(
      mayRun(
        ROLES.reviewer,
        { name: 'bash', input: { command: 'npm test -- tests/one.test.ts' } },
        allow,
        false,
        '/work/project',
      ),
    ).toBeDefined();
  });

  it('cannot use the exception to mutate or leave the project', () => {
    expect(
      mayRun(
        ROLES.reviewer,
        { name: 'bash', input: { command: 'npx --no-install vitest run ../outside.test.ts' } },
        allow,
        false,
        '/work/project',
      ),
    ).toBeDefined();
    expect(mayRun(ROLES.reviewer, { name: 'write' }, allow, true, '/work/project')?.reason).toBe(
      HELPER_DECLINED.reading,
    );
  });
});
