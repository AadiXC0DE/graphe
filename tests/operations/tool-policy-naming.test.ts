/** A tool cannot get a different answer by being called something else.
 *
 * 9.5 names the ways round a permission policy: an unknown name, a duplicate
 * registration, a wrapper, a child process, and terminal mode. The policy's own
 * rows are proven case by case in `tests/guard.test.ts`; what is here is the
 * naming question underneath all of them — `normalizeToolName` throws away
 * every character that is not a letter or a digit, so the name a tool is
 * registered under is not a lever, and a helper's role cannot be picked by the
 * model either.
 *
 * Pure: a call in, a verdict out, and no disk.
 */

import { describe, expect, it } from 'vitest';

import { evaluate, type GuardFacts } from '../../src/agent/guard/policy';
import { HELPER_DECLINED, mayRun, roleSpec, ROLES } from '../../src/agent/pi/child';

const ROOT = '/tmp/graphe-ops-policy';
const facts: GuardFacts = { projectRoot: ROOT };

function kind(name: string, input: Record<string, unknown>): string {
  return evaluate({ id: 'call-1', name, input }, facts).kind;
}

/* ========================================================================== */

describe('a name is not a way round the policy', () => {
  /* One implementation, eleven spellings. `normalizeToolName` strips everything
     that is not a letter or a digit, which is what makes a second registration
     under a decorated name a second name for the same row rather than a way to
     reach a different one. */
  const SHELL_NAMES = [
    'bash',
    'Bash',
    'B A S H',
    'b-a-s-h',
    'bash!',
    'sh',
    'shell',
    'terminal',
    'exec',
    'run_command',
    'runcommand',
    'command',
    'keep_running',
    'keepRunning',
  ];

  it('judges terminal mode exactly as it judges bash', () => {
    for (const name of SHELL_NAMES) {
      const said = kind(name, { command: 'rm -rf /' });
      expect(said, name).toBe('deny');
    }
  });

  it('leaves nothing that runs a command allowed on its own', () => {
    for (const name of SHELL_NAMES) {
      expect(kind(name, { command: 'npm run deploy' }), name).not.toBe('allow');
    }
  });

  it('gives a decorated duplicate the same verdict as the plain one', () => {
    const input = { path: 'src/App.tsx', content: 'x' };
    expect(kind('WRITE', input)).toBe(kind('write', input));
    expect(kind('w-r-i-t-e', input)).toBe(kind('write', input));
    expect(kind('write_file', input)).toBe(kind('write', input));
  });

  it('refuses a name that reaches for the Guard’s own switches', () => {
    for (const name of ['disable_guard', 'setPermissions', 'approvalMode', 'bypass_safety', 'yolo']) {
      expect(kind(name, { command: 'ls' }), name).toBe('deny');
    }
  });

  it('asks about a name that says nothing at all', () => {
    for (const name of ['', '   ', '!!!', '123', 'do_the_thing']) {
      expect(kind(name, { anything: true }), JSON.stringify(name)).toBe('confirm');
    }
  });
});

describe('a child process is held to the same policy', () => {
  it('cannot reach a shell by capitalising one', () => {
    expect(ROLES.helper.tools).not.toContain('bash');
    expect(mayRun(ROLES.helper, { name: 'Bash' }, { kind: 'allow' }, true, ROOT)).toBeDefined();
    expect(mayRun(ROLES.helper, { name: 'BASH' }, { kind: 'allow' }, true, ROOT)).toBeDefined();
  });

  it('cannot be handed more powers by the name the model asks for', () => {
    // A role the model invented is the plain helper; it does not come back as a
    // spec with no rules, and it does not inherit one from the prototype.
    for (const asked of ['omniscient', 'toString', 'constructor', 'builder ', 'BUILDER']) {
      const spec = roleSpec(asked as never);
      expect(spec.name, asked).toBe('helper');
      expect(spec.mayChange, asked).toBe(false);
      expect(spec.tools, asked).toEqual(ROLES.helper.tools);
    }
  });

  it('is stopped by a question the same as by a refusal', () => {
    const guarded = { name: 'bash', input: { command: 'npm run build' } };
    expect(mayRun(ROLES.builder, guarded, { kind: 'confirm' }, true, ROOT)?.reason).toBe(
      HELPER_DECLINED.building,
    );
    expect(mayRun(ROLES.builder, guarded, { kind: 'deny', reason: 'no' }, true, ROOT)?.reason).toBe('no');
  });
});
