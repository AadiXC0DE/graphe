/** A build plan — the tasks, the progress, the resume. */

import { describe, expect, it } from 'vitest';

import {
  addTasks,
  buildWords,
  finishTask,
  nextOf,
  note,
  numberFrom,
  progress,
  isFinished,
  readPlan,
  resumeFrom,
  setStatus,
  standing,
  startTask,
  taskFrom,
  toMarkdown,
  unfinished,
} from '../src/work/buildplan';
import { asBuildRequest, BUILD_BRIEF } from '../src/work/buildbrief';

describe('taskFrom — a plan line becomes a task', () => {
  it('reads a numbered step', () => {
    const task = taskFrom('1. Make the header sticky', 1);
    expect(task?.title).toBe('Make the header sticky');
    expect(task?.status).toBe('pending');
  });

  it('drops headings and empty lines', () => {
    expect(taskFrom('# Heading', 1)).toBeNull();
    expect(taskFrom('   ', 1)).toBeNull();
  });
});

describe('numberFrom', () => {
  it('keeps the leading number', () => {
    expect(numberFrom('1.2 Accept: x')).toBe(1);
    expect(numberFrom('12 Make')).toBe(12);
  });
});

describe('progress and next', () => {
  const plan = [
    { n: 1, title: 'One', acceptance: '', test: null, status: 'pending' as const, note: null },
    { n: 2, title: 'Two', acceptance: '', test: null, status: 'pending' as const, note: null },
  ];

  it('knows what is next and how far along', () => {
    expect(nextOf(plan)?.n).toBe(1);
    expect(progress(plan)).toEqual({ done: 0, total: 2 });
    const after = setStatus(plan, 1, 'done' as const);
    expect(nextOf(after)?.n).toBe(2);
    expect(progress(after)).toEqual({ done: 1, total: 2 });
  });

  it('marks done tasks first on a resume', () => {
    expect(resumeFrom(plan)).toBe(1);
    expect(resumeFrom(setStatus(plan, 1, 'done' as const))).toBe(2);
    expect(unfinished(setStatus(plan, 1, 'done' as const)).map((one) => one.n)).toEqual([2]);
    const allDone = setStatus(plan, 1, 'done').map((one) => (one.n === 2 ? { ...one, status: 'done' as const } : one));
    expect(resumeFrom(allDone)).toBe(2);
    expect(unfinished(allDone)).toEqual([]);
  });

  it('keeps a note with a task', () => {
    const said = note(plan, 1, 'tests pass');
    expect(said[0]?.note).toBe('tests pass');
  });

  it('closes off the task a turn just finished', () => {
    expect(finishTask(plan, true)[0]?.status).toBe('done');
    expect(finishTask(plan, false)[0]?.status).toBe('failed');
    // A task mid-work is the one finished, not the first pending.
    const working = setStatus(plan, 1, 'doing' as const);
    expect(finishTask(working, true)[0]?.status).toBe('done');
    expect(finishTask(working, false)[0]?.status).toBe('failed');
    // Once done, a settle disturbs nothing.
    const allDone = plan.map((one) => ({ ...one, status: 'done' as const }));
    expect(finishTask(allDone, true)).toBe(allDone);
  });

  it('adds newly discovered requirements as their own tasks', () => {
    const added = addTasks(plan, ['Three', 'Token cleanup']);
    expect(added.map((one) => one.n)).toEqual([1, 2, 3, 4]);
    expect(added.map((one) => one.title)).toContain('Three');
    expect(added.every((one) => one.status === 'pending')).toBe(true);
    expect(addTasks(plan, [])).toBe(plan);
    expect(addTasks(plan, ['  ']).length).toBe(plan.length);
  });

  it('counts what is done, what remains and what is stuck', () => {
    expect(standing(plan)).toEqual({ done: 0, total: 2, failed: 0 });
    const mixed = [
      { n: 1, title: 'A', acceptance: '', test: null, status: 'done' as const, note: null },
      { n: 2, title: 'B', acceptance: '', test: null, status: 'failed' as const, note: null },
      { n: 3, title: 'C', acceptance: '', test: null, status: 'pending' as const, note: null },
    ];
    expect(standing(mixed)).toEqual({ done: 1, total: 3, failed: 1 });
  });

  it('picks up the next task as the one being worked on', () => {
    const started = startTask(plan);
    expect(started[0]?.status).toBe('doing');
    expect(started[1]?.status).toBe('pending');
    // Already in hand is left alone — a run starting twice marks once.
    expect(startTask(started)).toBe(started);
    // A finished run has nothing left to pick up.
    const allDone = plan.map((one) => ({ ...one, status: 'done' as const }));
    expect(startTask(allDone)).toBe(allDone);
  });

  it('picks up a failed task again, so a retry is the current work', () => {
    const failed = setStatus(plan, 1, 'failed' as const);
    const retried = startTask(failed);
    expect(retried[0]?.status).toBe('doing');
  });
});

describe('toMarkdown / readPlan — a plan that survives a restart', () => {
  it('round-trips through the checklist', () => {
    const plan = [
      { n: 1, title: 'Header', acceptance: '', test: 'npm run typecheck', status: 'done' as const, note: null },
      { n: 2, title: 'Footer', acceptance: '', test: 'npm test', status: 'pending' as const, note: null },
    ];
    const md = toMarkdown(plan);
    expect(md).toContain('- [x] Header');
    expect(md).toContain('- [ ] Footer (runs `npm test`)');

    const back = readPlan(plan);
    expect(back).toHaveLength(2);
    expect(back[0]?.status).toBe('done');
    expect(back[1]?.status).toBe('pending');
  });

  it('forgives a hand-broken entry', () => {
    expect(readPlan('not an array')).toEqual([]);
    expect(readPlan([{ title: 'no number' }])).toEqual([]);
  });
});

describe('buildbrief', () => {
  it('names the document and forbids changing anything while planning', () => {
    const request = asBuildRequest('# Page', 'Use the build plan above');
    expect(request).toContain('# Page');
    expect(request).toContain('using the plan above');
    expect(BUILD_BRIEF).toContain('Change nothing while I look');
  });

  it('buildWords reads as a checklist', () => {
    expect(buildWords.heading).toMatch(/plan/i);
  });
});

describe('isFinished — when the tracker has nothing left to say', () => {
  const at = (status: 'pending' | 'doing' | 'done' | 'failed', n: number) => ({
    n,
    title: `Task ${String(n)}`,
    acceptance: '',
    test: null,
    status,
    note: null,
  });

  it('is finished once every task is built', () => {
    expect(isFinished([at('done', 1), at('done', 2)])).toBe(true);
  });

  it('is not finished while anything is still to do', () => {
    expect(isFinished([at('done', 1), at('pending', 2)])).toBe(false);
    expect(isFinished([at('done', 1), at('doing', 2)])).toBe(false);
  });

  it('is not finished when something did not build', () => {
    // Left up on purpose: a plan that did not finish is unfinished work, and
    // taking the tracker away would be the only place it was said.
    expect(isFinished([at('done', 1), at('failed', 2)])).toBe(false);
  });

  it('is not finished when there is no plan at all', () => {
    // Otherwise every project with no plan reads as one that just completed.
    expect(isFinished([])).toBe(false);
  });
});
