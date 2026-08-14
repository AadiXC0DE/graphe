/** A build plan — the tasks, the progress, the resume. */

import { describe, expect, it } from 'vitest';

import {
  buildWords,
  nextOf,
  note,
  numberFrom,
  progress,
  readPlan,
  resumeFrom,
  setStatus,
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
});

describe('toMarkdown / readPlan — a plan that survives a restart', () => {
  it('round-trips through the checklist', () => {
    const plan = [
      { n: 1, title: 'Header', acceptance: '', test: 'npm run typecheck', status: 'done' as const, note: null },
      { n: 2, title: 'Footer', acceptance: '', test: 'npm test', status: 'pending' as const, note: null },
    ];
    const md = toMarkdown(plan);
    expect(md).toContain('- [x] Header');
    expect(md).toContain('- [ ] Footer — runs `npm test`');

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
