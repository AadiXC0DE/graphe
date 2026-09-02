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
  /** Only the model writes this. `skipped` is settled work the model decided
   *  not to do; `failed` is work still owed. */
  status: 'pending' | 'doing' | 'done' | 'failed' | 'skipped';
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
  skipped: 'Skipped',
} as const;

/** Settled work: done, or deliberately skipped. Both are off the list of what
 *  is still owed, and only these two count towards a finished plan. */
function settled(one: Task): boolean {
  return one.status === 'done' || one.status === 'skipped';
}

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

/** What is still owed, so a resumed run knows where to begin. */
export function unfinished(plan: readonly Task[]): readonly Task[] {
  return plan.filter((one) => !settled(one));
}

/** Whether there is nothing left to build. A tracker that has finished has said
 *  everything it has to say; kept, it sits above every later conversation in
 *  the project reading 4/4. An empty plan is not finished, it is not a plan. */
export function isFinished(plan: readonly Task[]): boolean {
  return plan.length > 0 && plan.every(settled);
}

/** The next task to work on: the first still owed, or nothing. */
export function nextOf(plan: readonly Task[]): Task | null {
  return plan.find((one) => !settled(one)) ?? null;
}

/** How far the plan has got. A skipped step counts towards the total settled,
 *  or a finished list would read 4 of 5. */
export function progress(plan: readonly Task[]): PlanProgress {
  return { done: plan.filter(settled).length, total: plan.length };
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
export function standing(plan: readonly Task[]): {
  done: number;
  total: number;
  failed: number;
  skipped: number;
} {
  return {
    done: plan.filter((one) => one.status === 'done').length,
    total: plan.length,
    failed: plan.filter((one) => one.status === 'failed').length,
    skipped: plan.filter((one) => one.status === 'skipped').length,
  };
}

/** The plan as one markdown document, `- [ ]` boxes and all, so it reads as a
 *  checklist a person can edit by hand and the resume can scrape. */
export function toMarkdown(plan: readonly Task[]): string {
  const lines = plan.map((one) => {
    const box = one.status === 'done' ? '[x]' : one.status === 'skipped' ? '[-]' : '[ ]';
    const test = one.test === null ? '' : ` (runs \`${one.test}\`)`;
    // The number is how the model names the step it is changing, so it is on
    // every row rather than left to be counted.
    return `- ${box} ${String(one.n)}. ${one.title}${test}`;
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
      one['status'] === 'done' ||
      one['status'] === 'doing' ||
      one['status'] === 'failed' ||
      one['status'] === 'skipped'
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

/* -------------------------------------------------------------------------- */
/* The model's own hand on the list                                            */
/* -------------------------------------------------------------------------- */

/**
 * The list as it was stored, whole.
 *
 * `finished` rather than a missing file: a list that reads as finished used to
 * be deleted on the spot, so a list falsely completed mid-job vanished with
 * nothing to resume from. It stays until somebody clears it.
 */
export type StoredPlan = {
  source: string;
  tasks: readonly Task[];
  finished: boolean;
};

/** Whether the model must say which step it means. One step still owed can only
 *  be that one; two or more and a bare tick is a guess. */
export function needsWhich(plan: readonly Task[]): boolean {
  return unfinished(plan).length > 1;
}

/** The step a number names, or nothing. */
function stepAt(plan: readonly Task[], n: number): Task | null {
  return plan.find((one) => one.n === n) ?? null;
}

/** Where the list stands, in the sentence a step tool answers with. A tool that
 *  answers "ok" teaches the model nothing about the list it is working. */
export function saysList(plan: readonly Task[], touched: Task | null, what: string): string {
  const how = progress(plan);
  const next = nextOf(plan);
  const named = touched === null ? '' : `“${touched.title}” ${what}. `;
  if (isFinished(plan)) {
    return `${named}That was the last of ${String(how.total)} — the list is finished.`;
  }
  return `${named}${String(how.done)} of ${String(how.total)} settled.${
    next === null ? '' : ` Next on the list: ${String(next.n)}. “${next.title}”.`
  }`;
}

/** What every step operation answers with: the list as it now stands, and the
 *  sentence that says what moved. */
export type Moved = { plan: readonly Task[]; said: string };

/** No such step. Said rather than silently ignored, or a model that mistypes a
 *  number believes it ticked something. */
function noSuchStep(plan: readonly Task[], n: number): Moved {
  const owed = unfinished(plan)
    .map((one) => String(one.n))
    .join(', ');
  return {
    plan,
    said: `There is no step ${String(n)} on this checklist.${
      owed === '' ? '' : ` Still open: ${owed}.`
    }`,
  };
}

function moveTo(
  plan: readonly Task[],
  n: number,
  status: Task['status'],
  what: string,
  why: string | null,
): Moved {
  const was = stepAt(plan, n);
  if (was === null) return noSuchStep(plan, n);
  let next = setStatus(plan, n, status);
  if (why !== null && why.trim() !== '') next = note(next, n, why.trim());
  return { plan: next, said: saysList(next, was, what) };
}

/** The model ticks one off, by number. */
export function tickStep(plan: readonly Task[], n: number, why?: string | null): Moved {
  return moveTo(plan, n, 'done', 'is ticked off', why ?? null);
}

/** The model says one is being worked on now. */
export function startStep(plan: readonly Task[], n: number): Moved {
  return moveTo(plan, n, 'doing', 'is the one in hand', null);
}

/** The model says one did not work. Still owed: a failed step is one to try
 *  again, which is why it does not count towards a finished list. */
export function failStep(plan: readonly Task[], n: number, why: string): Moved {
  return moveTo(plan, n, 'failed', 'did not work', why);
}

/** The model says one is not going to be done, and why. Settled, not owed. */
export function skipStep(plan: readonly Task[], n: number, why: string): Moved {
  return moveTo(plan, n, 'skipped', 'is skipped', why);
}

/** Take one off the list entirely. The numbers of the rest are left as they
 *  were: a step somebody has been reading as "7" must not become "6" under
 *  them. */
export function dropStep(plan: readonly Task[], n: number, why: string): Moved {
  const was = stepAt(plan, n);
  if (was === null) return noSuchStep(plan, n);
  const next = plan.filter((one) => one.n !== n);
  const because = why.trim() === '' ? '' : ` (${why.trim()})`;
  return {
    plan: next,
    said: `“${was.title}” is off the list${because}. ${saysList(next, null, '')}`.trim(),
  };
}

/** Put a new step in after another, with a number of its own. */
export function insertStep(plan: readonly Task[], after: number, title: string): Moved {
  const clean = tied(title);
  if (clean === '') return { plan, said: 'A step needs a title.' };
  const at = plan.findIndex((one) => one.n === after);
  if (at < 0 && plan.length > 0) return noSuchStep(plan, after);
  const free = plan.reduce((most, one) => Math.max(most, one.n), 0) + 1;
  const added: Task = {
    n: free,
    title: clean,
    acceptance: '',
    test: null,
    status: 'pending',
    note: null,
  };
  const next = [...plan.slice(0, at + 1), added, ...plan.slice(at + 1)];
  return { plan: next, said: `“${clean}” is on the list as step ${String(free)}. ${saysList(next, null, '')}`.trim() };
}

/**
 * Write the list again, keeping what has already been settled.
 *
 * Matched on the words: a step that was ticked and is still on the new list is
 * still ticked, and a title reused for different work does not inherit one. A
 * failed step comes back as still to do, because a failure is work owed.
 */
export function replaceKeepingTicks(
  plan: readonly Task[],
  titles: readonly string[],
): readonly Task[] {
  const wanted = titles.map((one) => tied(one)).filter((one) => one !== '');
  return wanted.map((title, index) => {
    const was = plan.find((one) => one.title.trim() === title.trim());
    const status: Task['status'] =
      was?.status === 'done' || was?.status === 'skipped' ? was.status : 'pending';
    return {
      n: index + 1,
      title,
      acceptance: was?.acceptance ?? '',
      test: was?.test ?? null,
      status,
      note: status === 'pending' ? null : (was?.note ?? null),
    };
  });
}

/**
 * A stored list read back off disk.
 *
 * An empty list is a list being worked out, not the absence of one — returning
 * nothing for it is why "make the checklist" could overwrite the name of the
 * thing being built. A finished list is returned finished rather than as
 * nothing, so it stays on screen until somebody clears it.
 */
export function readStored(raw: unknown): StoredPlan | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const stored = raw as { source?: unknown; tasks?: unknown };
  if (typeof stored.source !== 'string') return null;
  const tasks = readPlan(stored.tasks);
  return { source: stored.source, tasks, finished: isFinished(tasks) };
}
