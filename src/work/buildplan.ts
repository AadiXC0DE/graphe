/** A build plan: the tasks that turn a document into a shipped change.
 *
 * "Start from a PRD" turns a spec into a list of implementation tasks, each
 * with the acceptance criteria that will prove it done and the test command
 * that should pass before it is. This file is that list, kept on disk so the
 * work survives whatever happens to the window — a plan is a thing the machine
 * can be interrupted mid-way through and resume, not a paragraph in somebody's
 * memory.
 *
 * Everything here is pure. What a plan file looks like is decided once, here,
 * so the window, the shell and a resumed session all read the same shape.
 */

/** One step of the build. */
export type Task = {
  /** Stable across runs. `1.`, `2.`, the number the plan listed it under. */
  n: number;
  title: string;
  /** What "done" means for this step, in a shape a test can check. */
  acceptance: string;
  /** The command that must pass before this step is marked done, if there is
   *  one. Lowercased once so `NPM RUN` and `npm run` are the same answer. */
  test: string | null;
  status: 'pending' | 'doing' | 'done' | 'failed';
  /** What came of the last run, in a sentence. */
  note: string | null;
};

export type PlanProgress = { done: number; total: number };

/** Every word this model can put in front of somebody. */
export const buildWords = {
  heading: 'Here’s the plan',
  done: 'Done',
  doing: 'Working on',
  pending: 'Still to do',
  failed: 'Needs another try',
} as const;

/** A task title trimmed to a length a row can hold. */
function tied(title: string): string {
  const one = title.replace(/\s+/g, ' ').trim();
  return one.length <= 80 ? one : `${one.slice(0, 79)}…`;
}

/** The number a task is listed under: `1.` stays `1`, `1.2` stays `1`.` */
export function numberFrom(section: string): number {
  const match = /^(\d+)/.exec(section.trim());
  return match === null ? 0 : Number(match[1]);
}

/** Turn one numbered line from a plan into a task, or nothing when the line
 *  was commentary rather than a step.
 *
 * A step is a heading — "1. Make the header sticky" — and the line under it can
 * carry the acceptance criteria, often starting "Acceptance:" or "Test:". */
export function taskFrom(line: string, n: number): Task | null {
  const trimmed = line.trim();
  if (trimmed === '' || /^#{1,6}\s/.test(trimmed)) return null;
  const title = tied(trimmed.replace(/^[\d.]+[:)\s]*/, ''));
  if (title === '') return null;
  return { n, title, acceptance: '', test: null, status: 'pending', note: null };
}

/** Whether one task is finished, so a resumed run knows where to begin. */
export function unfinished(plan: readonly Task[]): readonly Task[] {
  return plan.filter((one) => one.status !== 'done');
}

/** Whether there is nothing left to build. A tracker that has finished has said
 *  everything it has to say; kept, it sits above every later conversation in
 *  the project reading 4/4. An empty plan is not finished, it is not a plan. */
export function isFinished(plan: readonly Task[]): boolean {
  return plan.length > 0 && plan.every((one) => one.status === 'done');
}

/** The next task to work on: the first not-yet-done, or nothing. */
export function nextOf(plan: readonly Task[]): Task | null {
  return plan.find((one) => one.status !== 'done') ?? null;
}

/** How far the plan has got. */
export function progress(plan: readonly Task[]): PlanProgress {
  return { done: plan.filter((one) => one.status === 'done').length, total: plan.length };
}

/** Mark one task moving or done, leaving the rest alone. */
export function setStatus(plan: readonly Task[], n: number, status: Task['status']): readonly Task[] {
  return plan.map((one) => (one.n === n ? { ...one, status } : one));
}

/** Record what came of one task's run. */
export function note(plan: readonly Task[], n: number, said: string): readonly Task[] {
  return plan.map((one) => (one.n === n ? { ...one, note: said } : one));
}

/** The first task that is either being worked on now or still to come — the one
 *  a settled turn just finished, or failed. */
export function inHand(plan: readonly Task[]): Task | null {
  return plan.find((one) => one.status === 'doing') ?? nextOf(plan) ?? null;
}

/** Mark the next task as the one being worked on now. A task already in hand is
 *  left alone, so a run that starts twice in a row only marks once. */
export function startTask(plan: readonly Task[]): readonly Task[] {
  const current = inHand(plan);
  if (current === null || current.status === 'doing') return plan;
  return setStatus(plan, current.n, 'doing');
}

/** Close off the task a turn just finished: `ok` marks the current one done,
 *  otherwise failed. Nothing left to do leaves the plan alone, so a turn that
 *  settles with the build already finished disturbs nothing. */
export function finishTask(plan: readonly Task[], ok: boolean): readonly Task[] {
  const current = inHand(plan);
  if (current === null) return plan;
  return setStatus(plan, current.n, ok ? 'done' : 'failed');
}

/** New requirements found while building get their own rows, appended after the
 *  existing ones (the plan's own numbering keeps them ordered). */
export function addTasks(plan: readonly Task[], titles: readonly string[]): readonly Task[] {
  if (titles.length === 0) return plan;
  const nextN = plan.reduce((most, one) => Math.max(most, one.n), 0) + 1;
  const added = titles
    .filter((title) => title.trim() !== '')
    .map((title, index) => ({
      n: nextN + index,
      title: tied(title),
      acceptance: '',
      test: null,
      status: 'pending' as const,
      note: null,
    }));
  return [...plan, ...added];
}

/** How many are done and how many are stuck, for the one line under the open
 *  panel. */
export function standing(plan: readonly Task[]): { done: number; total: number; failed: number } {
  return {
    done: plan.filter((one) => one.status === 'done').length,
    total: plan.length,
    failed: plan.filter((one) => one.status === 'failed').length,
  };
}

/** The plan as one markdown document, `- [ ]` boxes and all, so it reads as a
 *  checklist a person can edit by hand and the resume can scrape. */
export function toMarkdown(plan: readonly Task[]): string {
  const lines = plan.map((one) => {
    const box = one.status === 'done' ? '[x]' : '[ ]';
    const test = one.test === null ? '' : ` (runs \`${one.test}\`)`;
    return `- ${box} ${one.title}${test}`;
  });
  return lines.join('\n');
}

/**
 * The plan as it stands, said into the turn that is about to run.
 *
 * The list is kept outside the project, so nothing that reads the working tree
 * finds it — the advisor included, which is why a run could be signed off with
 * a step still unticked. Saying it puts the checklist in the conversation both
 * of them read.
 *
 * Null when there is nothing left to build.
 */
export function planStanding(plan: readonly Task[]): string | null {
  if (plan.length === 0 || isFinished(plan)) return null;
  const { done, total } = progress(plan);
  return [
    `<build-plan done="${String(done)}" total="${String(total)}">`,
    toMarkdown(plan),
    '</build-plan>',
    'An unticked step is a step that is not done. Call step_done as each one lands, and do not call the work finished while any of them is still unticked.',
    'Work through the whole list in this reply rather than stopping after one. A progress report is not a step. A second opinion — an advisor verdict, a review, a list of what is not yet proven — is advice on the work, never permission to leave the list unfinished.',
  ].join('\n');
}

/** The first done task after a resume — a machine-readable answer to "where
 *  were we?" A plan file is the truth; the conversation is disposable. */
export function resumeFrom(plan: readonly Task[]): number {
  const next = nextOf(plan);
  return next === null ? plan.length : next.n;
}

/** Re-read a plan file, forgiving anything a hand edit broke. */
export function readPlan(raw: unknown): readonly Task[] {
  if (!Array.isArray(raw)) return [];
  const out: Task[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const one = entry as Record<string, unknown>;
    const n = typeof one['n'] === 'number' ? one['n'] : numberFrom(String(one['n'] ?? ''));
    const title = typeof one['title'] === 'string' ? one['title'] : '';
    if (n <= 0 || title === '') continue;
    const status =
      one['status'] === 'done' || one['status'] === 'doing' || one['status'] === 'failed'
        ? one['status']
        : 'pending';
    out.push({
      n,
      title,
      acceptance: typeof one['acceptance'] === 'string' ? one['acceptance'] : '',
      test: typeof one['test'] === 'string' ? one['test'].toLowerCase() : null,
      status,
      note: typeof one['note'] === 'string' ? one['note'] : null,
    });
  }
  return out;
}
