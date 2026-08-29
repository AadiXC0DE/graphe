import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createGoal, readStoredGoal, ROUNDS, verifyGoal, withElapsed } from '../src/work/goal';
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

describe('an objective that says nothing', () => {
  it('is never met, with or without a plan', () => {
    const plan = planWith(3, 3);
    for (const blank of ['', '   ', '\n\t']) {
      expect(verifyGoal(null, [], blank).met).toBe(false);
      expect(verifyGoal(plan, [], blank, 0).met).toBe(false);
      expect(verifyGoal(null, [], blank).reason).toContain('No objective');
    }
  });
});

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


/* ========================================================================== */
/* Reading one back off the disk                                              */
/* ========================================================================== */

describe('reading a stored goal', () => {
  const stored = {
    id: 'goal-1',
    objective: 'Fix every compile error',
    status: 'paused',
    iterations: 4,
    elapsed: 90,
    howFar: 'asking',
    startedAt: 1_700_000_000_000,
    planBaselineN: 2,
  };

  it('keeps the rung it was written down with', () => {
    expect(readStoredGoal(stored)?.howFar).toBe('asking');
  });

  it('falls back to full access when the rung is nonsense', () => {
    expect(readStoredGoal({ ...stored, howFar: 'sideways' })?.howFar).toBe('doing');
    expect(readStoredGoal({ ...stored, howFar: undefined })?.howFar).toBe('doing');
  });

  it('round-trips a goal it made itself', () => {
    const made = withElapsed(createGoal('Ship the pricing page', 'doing', 3));
    const back = readStoredGoal(JSON.parse(JSON.stringify(made)) as unknown);
    expect(back?.objective).toBe(made.objective);
    expect(back?.status).toBe('active');
    expect(back?.planBaselineN).toBe(3);
  });

  it('answers null for anything that is not a goal', () => {
    expect(readStoredGoal(null)).toBeNull();
    expect(readStoredGoal('a goal')).toBeNull();
    expect(readStoredGoal({ ...stored, status: 'finished' })).toBeNull();
    expect(readStoredGoal({ ...stored, iterations: 'four' })).toBeNull();
  });

  it('never brings back a negative round count', () => {
    expect(readStoredGoal({ ...stored, iterations: -3 })?.iterations).toBe(0);
  });
});

describe('the round budget', () => {
  it('is a number the window can count against', () => {
    expect(Number.isInteger(ROUNDS)).toBe(true);
    expect(ROUNDS).toBeGreaterThan(0);
  });
});

describe('one parse, both sides of the wire', () => {
  it('the shell reads a goal file exactly as strictly as the window does', () => {
    // A goal missing planBaselineN used to pass the shell's own check and fail
    // the window's, so a half-written file could drive a resume.
    const half = {
      id: 'g1',
      objective: 'ship it',
      status: 'active',
      iterations: 2,
      startedAt: 1,
    };
    expect(readStoredGoal(half)).toBeNull();
    expect(readStoredGoal({ ...half, planBaselineN: 0 })).not.toBeNull();

    const goals = readFileSync(new URL('../src/projects/goals.ts', import.meta.url), 'utf8');
    expect(goals).toContain('readStoredGoal(JSON.parse(raw) as unknown)');
    expect(goals).not.toContain('function isGoal');

    const main = readFileSync(new URL('../electron/main.ts', import.meta.url), 'utf8');
    expect(main).toContain('const goal = readStoredGoal(raw);');
  });
});
