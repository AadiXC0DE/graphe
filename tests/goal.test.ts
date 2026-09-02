import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  createGoal,
  goalWords,
  listForGoal,
  parseGoalCommand,
  readStoredGoal,
  ROUNDS,
  verifyGoal,
  withElapsed,
} from '../src/work/goal';

type Plan = { done: number; total: number; next: string | null };

function planWith(total: number, done: number): Plan {
  return { done, total, next: done >= total ? null : `Task ${String(done + 1)}` };
}

const passed = { passed: true, reason: 'the typecheck passed.' };
const failed = { passed: false, reason: 'two type errors' };

describe('an objective that says nothing', () => {
  it('is never met, with or without a list', () => {
    for (const blank of ['', '   ', '\n\t']) {
      expect(verifyGoal(null, null, blank).met).toBe(false);
      expect(verifyGoal(planWith(3, 3), passed, blank).met).toBe(false);
      expect(verifyGoal(null, null, blank).reason).toContain('No objective');
    }
  });
});

describe('a goal with no list to check against', () => {
  it('is not met, and says why rather than going quiet', () => {
    const verdict = verifyGoal(null, null, 'make the tests pass');
    expect(verdict.met).toBe(false);
    expect(verdict.reason).toBe(goalWords.noListYet);
  });

  it('is not met when the list is there but empty', () => {
    expect(verifyGoal({ done: 0, total: 0, next: null }, null, 'ship it').met).toBe(false);
  });

  it('has a one-step list written for it, so the loop has something to work', () => {
    expect(listForGoal('  make the tests pass  ')).toEqual(['Reach: make the tests pass']);
  });
});

describe('a goal with steps still owed', () => {
  it('is not met, and names how far along it is', () => {
    const verdict = verifyGoal(planWith(5, 2), null, 'ship the release');
    expect(verdict.met).toBe(false);
    expect(verdict.reason).toContain('2 of 5');
    expect(verdict.reason).toContain('Task 3');
  });

  it('is not met even when the checks pass, because the work is not done', () => {
    expect(verifyGoal(planWith(4, 3), passed, 'ship it').met).toBe(false);
  });
});

describe('a goal whose steps are all settled', () => {
  it('is met when the checks pass', () => {
    const verdict = verifyGoal(planWith(4, 4), passed, 'ship it');
    expect(verdict.met).toBe(true);
    expect(verdict.reason).toContain('4 steps settled');
  });

  it('is not met when the checks fail, and says what failed', () => {
    const verdict = verifyGoal(planWith(4, 4), failed, 'ship it');
    expect(verdict.met).toBe(false);
    expect(verdict.reason).toContain('two type errors');
  });

  it('is met when there are no checks to run, and says so rather than claiming they passed', () => {
    const verdict = verifyGoal(planWith(2, 2), null, 'ship it');
    expect(verdict.met).toBe(true);
    expect(verdict.reason).toContain('no checks');
  });
});

describe('one goal from a sentence', () => {
  it('starts active, at nought rounds, with full access', () => {
    const goal = createGoal('make the tests pass');
    expect(goal.status).toBe('active');
    expect(goal.iterations).toBe(0);
    expect(goal.howFar).toBe('doing');
    expect(goal.objective).toBe('make the tests pass');
  });

  it('never carries a blank objective', () => {
    expect(createGoal('   ').objective).toBe('Untitled goal');
  });

  it('reads back off disk as what it was', () => {
    const goal = withElapsed(createGoal('ship the release'));
    const read = readStoredGoal(JSON.parse(JSON.stringify(goal)) as unknown);
    expect(read?.objective).toBe('ship the release');
    expect(read?.status).toBe('active');
  });

  it('refuses anything that is not a goal', () => {
    expect(readStoredGoal(null)).toBeNull();
    expect(readStoredGoal({ id: 'x' })).toBeNull();
    expect(readStoredGoal({ id: 'x', objective: 'y', status: 'nonsense' })).toBeNull();
  });
});

describe('what /goal means', () => {
  it('reads each form', () => {
    expect(parseGoalCommand('/goal')).toEqual({ kind: 'show' });
    expect(parseGoalCommand('/goal pause')).toEqual({ kind: 'pause' });
    expect(parseGoalCommand('/goal resume')).toEqual({ kind: 'resume' });
    expect(parseGoalCommand('/goal clear')).toEqual({ kind: 'clear' });
    expect(parseGoalCommand('/goal replace ship it')).toEqual({
      kind: 'replace',
      objective: 'ship it',
    });
    expect(parseGoalCommand('/goal make the tests pass')).toEqual({
      kind: 'set',
      objective: 'make the tests pass',
    });
    expect(parseGoalCommand('not a goal')).toBeNull();
  });
});

describe('the round budget', () => {
  it('is a number a person could sit through, not a machine', () => {
    expect(ROUNDS).toBeGreaterThan(4);
    expect(ROUNDS).toBeLessThanOrEqual(30);
  });

  it('no longer skips past somebody else’s list', () => {
    // A goal used to be verified against a project-wide checklist, so it had to
    // remember which steps were already there. Lists belong to one conversation
    // now, so there is nothing to skip past and nothing to get wrong.
    const source = readFileSync('src/work/goal.ts', 'utf8');
    expect(source).not.toContain('planBaselineN');
    expect(source).not.toContain('baselineFor');
  });
});
