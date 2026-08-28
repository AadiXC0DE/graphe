import { describe, expect, it } from 'vitest';
import { createGoal, verifyGoal } from '../src/work/goal';
import type { BuildPlan } from '../src/lib/ipc';

function planWith(n: number, done: number): BuildPlan {
  const tasks = Array.from({ length: n }, (_, i) => ({
    n: i + 1,
    title: `Task ${i + 1}`,
    acceptance: '',
    test: null,
    status: i < done ? 'done' : 'pending',
    note: null,
  }));
  return { tasks, total: n, done } as unknown as BuildPlan;
}

describe('verifyGoal baseline binding', () => {
  it('leftover incomplete plan does not drive a new goal', () => {
    const leftover = planWith(8, 3); // 3/8 from earlier work
    const goal = createGoal('rename the login button', 'doing', 8); // baseline = max n at goal creation
    // With baseline 8, owned = 0, so verify should say no checklist, not 3/8
    const verdict = verifyGoal(leftover, [], goal.objective, goal.planBaselineN);
    expect(verdict.met).toBe(false);
    expect(verdict.reason).toContain('No checklist for this goal');
  });

  it('leftover complete plan does not mark a new goal as done', () => {
    const leftoverComplete = planWith(4, 4);
    const goal = createGoal('rename the login button', 'doing', 4);
    const verdict = verifyGoal(leftoverComplete, [], goal.objective, goal.planBaselineN);
    expect(verdict.met).toBe(false);
    expect(verdict.reason).toContain('No checklist for this goal');
  });

  it('new goal tasks can complete in the first round', () => {
    const baseline = 4;
    const goal = createGoal('rename the login button', 'doing', baseline);
    // New tasks 5..8, all done
    const newPlan: BuildPlan = {
      tasks: [
        ...Array.from({ length: 4 }, (_, i) => ({
          n: i + 1,
          title: `Old ${i + 1}`,
          acceptance: '',
          test: null,
          status: 'done',
          note: null,
        })),
        ...Array.from({ length: 4 }, (_, i) => ({
          n: baseline + 1 + i,
          title: `New ${i + 1}`,
          acceptance: '',
          test: null,
          status: 'done',
          note: null,
        })),
      ],
      total: 8,
      done: 8,
    } as unknown as BuildPlan;
    const verdict = verifyGoal(newPlan, [], goal.objective, goal.planBaselineN);
    expect(verdict.met).toBe(true);
    expect(verdict.reason).toContain('for this goal done');
  });

  it('incomplete new plan is not met', () => {
    const baseline = 4;
    const goal = createGoal('rename', 'doing', baseline);
    const newPlan: BuildPlan = {
      tasks: [
        ...Array.from({ length: 4 }, (_, i) => ({
          n: i + 1,
          title: `Old ${i + 1}`,
          acceptance: '',
          test: null,
          status: 'done',
          note: null,
        })),
        { n: 5, title: 'New 1', acceptance: '', test: null, status: 'done', note: null },
        { n: 6, title: 'New 2', acceptance: '', test: null, status: 'pending', note: null },
      ],
      total: 6,
      done: 5,
    } as unknown as BuildPlan;
    const verdict = verifyGoal(newPlan, [], goal.objective, goal.planBaselineN);
    expect(verdict.met).toBe(false);
    expect(verdict.reason).toContain('1/2 tasks done');
  });
});
