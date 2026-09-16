import { describe, expect, it } from 'vitest';
import { mayApproveWithoutAsking } from '../src/agent/plan';

describe('automatic plan approval authorization', () => {
  it.each(['looking', 'asking', 'changing'] as const)('requires a person to approve in %s mode', (mode) => {
    expect(mayApproveWithoutAsking(mode, false)).toBe(false);
  });
  it('never executes read-only planning even with full access selected', () => {
    expect(mayApproveWithoutAsking('doing', true)).toBe(false);
  });
  it('allows an explicitly authorized full-access session', () => {
    expect(mayApproveWithoutAsking('doing', false)).toBe(true);
  });
});
