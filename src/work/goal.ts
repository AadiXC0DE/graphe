/** Goal Mode — one sentence, kept working toward until it is done.
 *
 * A goal is the one line the session is about. While it stands the agent
 * works with full access (`howFar='doing'`) and verifies after every round
 * whether the objective has been met, starting the next round on its own if
 * not. This file is pure: what a goal looks like, how it is worded, and a
 * simple heuristic for whether it is met.
 */

import type { HowFar } from '../agent/guard/policy';
export type GoalStatus = 'active' | 'paused' | 'done';

/** How many rounds a goal runs unattended before it stops and says so. Not a
 *  cost ceiling — goal mode deliberately runs at full access — but the thing
 *  that keeps "carries on by itself" from meaning "for ever". */
export const ROUNDS = 20;

/** One objective the session is working toward. */
export type Goal = {
  /** Stable for the sitting. */
  id: string;
  /** What "done" means, in the person's own words. */
  objective: string;
  status: GoalStatus;
  /** How many rounds have run toward it. */
  iterations: number;
  /** Seconds since it was set. */
  elapsed: number;
  /** Always 'doing' while a goal is active — full access without asking. */
  howFar: HowFar;
  /** Epoch ms, for elapsed. */
  startedAt: number;
};

export const goalWords = {
  /** Said once, when a goal is set on something with no checklist yet. Asking
   *  somebody to write one before their goal will run is the wrong way round:
   *  breaking the work into steps is the work. */
  workingOutTheSteps: 'Working out the steps for this first.',
  askForTheSteps: (objective: string): string =>
    [
      `Working toward this goal: ${objective}`,
      'There is no checklist on screen for it yet. Break it into the steps it actually takes and put them up with make_checklist, then start on the first one and tick each off with step_done as it lands.',
      'One step per thing that is separately finishable.',
    ].join(' '),
  /** When a round has gone by and there is still no list to check against. */
  noStepsEither:
    'I could not break this goal into steps to check against, so I have written it down as one step and will work toward it. Say what done looks like in a few concrete steps if you would rather be specific.',
  /** When there is nothing on screen to check the goal against yet. */
  noListYet: 'There is no checklist for this goal yet.',

  chip: 'Goal',
  name: 'Work toward a goal',
  note: 'Keep working toward one sentence until it is done — checks after every round and carries on by itself. Full access while it lasts.',
  paused: 'Goal paused',
  resumed: 'Goal resumed',
  cleared: 'Goal cleared',
  met: 'Goal met',
  notMet: 'Goal not yet met',
  show: 'Current goal',
  set: 'Set a goal',
  pause: 'Pause goal',
  resume: 'Resume goal',
  clear: 'Clear goal',
} as const;

let counter = 0;
function nextId(): string {
  counter += 1;
  return `goal-${String(Date.now())}-${String(counter)}`;
}

/** One goal from a sentence, active and counting from now. */
export function createGoal(objective: string, howFar: HowFar = 'doing'): Goal {
  const said = objective.trim();
  return {
    id: nextId(),
    objective: said === '' ? 'Untitled goal' : said,
    status: 'active',
    iterations: 0,
    elapsed: 0,
    howFar,
    startedAt: Date.now(),
  };
}

/** The one-step list a goal gets when the model could not write one for it.
 *  A goal with nothing to check against ran one round and stood down; a list of
 *  one is still a list, and the loop can run against it. */
export function listForGoal(objective: string): readonly string[] {
  return [`Reach: ${objective.trim()}`];
}

/** Seconds since the goal was set. */
export function goalElapsed(goal: Goal): number {
  return Math.max(0, Math.round((Date.now() - goal.startedAt) / 1000));
}

/** Human words for elapsed. */
export function elapsedWords(seconds: number): string {
  if (seconds < 60) return `${String(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins < 60) return secs === 0 ? `${String(mins)}m` : `${String(mins)}m ${String(secs)}s`;
  const hours = Math.floor(mins / 60);
  const remain = mins % 60;
  return remain === 0 ? `${String(hours)}h` : `${String(hours)}h ${String(remain)}m`;
}

/** What `/goal ...` means, or null when it is not a goal command. */
export type ParsedGoal =
  | { kind: 'show' }
  | { kind: 'pause' }
  | { kind: 'resume' }
  | { kind: 'clear' }
  | { kind: 'set'; objective: string }
  | { kind: 'replace'; objective: string };

export function parseGoalCommand(text: string): ParsedGoal | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/goal')) return null;
  const rest = trimmed.slice(5).trim();
  if (rest === '') return { kind: 'show' };
  const lower = rest.toLowerCase();
  if (lower === 'pause') return { kind: 'pause' };
  if (lower === 'resume') return { kind: 'resume' };
  if (lower === 'clear') return { kind: 'clear' };
  if (lower.startsWith('replace ')) {
    const objective = rest.slice(8).trim();
    return { kind: 'replace', objective: objective === '' ? '' : objective };
  }
  // "/goal Fix all TypeScript errors" — the ordinary form.
  return { kind: 'set', objective: rest };
}

/**
 * Is the objective met?
 *
 * Two things, both of them evidence rather than assertion: every step of the
 * conversation's checklist settled, and the project's own checks passing. A
 * model saying it is done is neither.
 *
 * The list is the conversation's own now, so there is no baseline to skip past
 * — a list belonging to a different tab cannot reach this one.
 */
export function verifyGoal(
  plan: { done: number; total: number; next: string | null } | null,
  checks: { passed: boolean; reason: string } | null,
  objective: string,
): { met: boolean; reason: string } {
  const said = objective.trim();
  // A blank objective has not been met — nothing was asked for, so nothing can
  // report done and finish the goal on its own.
  if (said === '') return { met: false, reason: 'No objective set, so there is nothing to check.' };

  if (plan === null || plan.total === 0) {
    return { met: false, reason: goalWords.noListYet };
  }
  if (plan.done < plan.total) {
    const next = plan.next === null ? '' : ` Next: ${plan.next}.`;
    return {
      met: false,
      reason: `${String(plan.done)} of ${String(plan.total)} steps settled.${next}`.trim(),
    };
  }
  // Every step settled. The checks are what turn that into done.
  if (checks === null) {
    return { met: true, reason: `All ${String(plan.total)} steps settled; no checks to run.` };
  }
  if (!checks.passed) return { met: false, reason: `Checks failed: ${checks.reason}` };
  return { met: true, reason: `All ${String(plan.total)} steps settled and ${checks.reason}` };
}

/** Update elapsed in place, for display. */
export function withElapsed(goal: Goal): Goal {
  return { ...goal, elapsed: goalElapsed(goal) };
}

const RUNGS: readonly HowFar[] = ['looking', 'asking', 'changing', 'doing'];

function isHowFar(value: unknown): value is HowFar {
  return typeof value === 'string' && (RUNGS as readonly string[]).includes(value);
}

/** Read a Goal back from storage, defensively. Null when not a goal. */
export function readStoredGoal(raw: unknown): Goal | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const g = raw as Record<string, unknown>;
  if (typeof g['id'] !== 'string' || typeof g['objective'] !== 'string') return null;
  if (g['status'] !== 'active' && g['status'] !== 'paused' && g['status'] !== 'done') return null;
  if (typeof g['iterations'] !== 'number' || typeof g['startedAt'] !== 'number') return null;
  return {
    id: g['id'] as string,
    objective: g['objective'] as string,
    status: g['status'] as GoalStatus,
    iterations: Math.max(0, Math.floor(g['iterations'] as number)),
    elapsed: typeof g['elapsed'] === 'number' ? Math.max(0, g['elapsed'] as number) : 0,
    howFar: isHowFar(g['howFar']) ? g['howFar'] : 'doing',
    startedAt: g['startedAt'] as number,
  };
}

/** Key for localStorage. One goal per conversation, so the fallback store is
 *  addressed the same way the file on disk is. */
export function goalStorageKey(project: string, address = ''): string {
  return address === '' ? `graphe:goal:${project}` : `graphe:goal:${project}\u0000${address}`;
}
