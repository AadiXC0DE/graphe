/** Goal Mode — one sentence, kept working toward until it is done.
 *
 * A goal is the one line the session is about. While it stands the agent
 * works with full access (`howFar='doing'`) and verifies after every round
 * whether the objective has been met, starting the next round on its own if
 * not. This file is pure: what a goal looks like, how it is worded, and a
 * simple heuristic for whether it is met.
 */

import type { HowFar } from '../agent/guard/policy';
import type { BuildPlan } from '../lib/ipc';
import type { Turn } from '../lib/thread';

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
  /** Max task n of the build plan at creation — only tasks with larger n belong to this goal. */
  planBaselineN: number;
};

export const goalWords = {
  chip: 'Goal',
  name: 'Work toward a goal',
  note: 'Keep working toward one sentence until it is done — checks after every round and carries on by itself. Full access while it lasts.',
  paused: 'Goal paused',
  resumed: 'Goal resumed',
  cleared: 'Goal cleared',
  met: 'Goal met',
  notMet: 'Goal not yet met',
  howFarNote: 'Full access — doesn’t stop to ask.',
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
export function createGoal(objective: string, howFar: HowFar = 'doing', planBaselineN = 0): Goal {
  const said = objective.trim();
  return {
    id: nextId(),
    objective: said === '' ? 'Untitled goal' : said,
    status: 'active',
    iterations: 0,
    elapsed: 0,
    howFar,
    startedAt: Date.now(),
    planBaselineN,
  };
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

/** Is the objective met?
 *
 * Hard rule: only tasks created for this goal count — leftover plans from
 * earlier work are ignored via planBaselineN. Without a plan belonging to this
 * goal, no heuristic string match counts as done.
 */
export function verifyGoal(
  plan: BuildPlan | null,
  turns: readonly Turn[],
  objective: string,
  planBaselineN = 0,
): { met: boolean; reason: string } {
  const said = objective.trim();
  if (said === '') return { met: true, reason: 'No objective.' };

  if (plan !== null) {
    // Only tasks with n > baseline belong to this goal
    const owned = plan.tasks.filter((t) => t.n > planBaselineN);
    if (owned.length === 0) {
      return { met: false, reason: 'No checklist for this goal yet — add tasks to the build plan or say /goal clear when done.' };
    }
    const total = owned.length;
    const done = owned.filter((t) => t.status === 'done').length;
    if (done < total) {
      const next = owned.find((t) => t.status !== 'done');
      const hint = next !== undefined ? `Next: ${next.title}.` : '';
      return { met: false, reason: `${String(done)}/${String(total)} tasks done. ${hint}`.trim() };
    }
    return { met: true, reason: `All ${String(total)} tasks for this goal done.` };
  }

  void turns;
  return { met: false, reason: 'No checklist for this goal — add tasks to the build plan or say /goal clear when done.' };
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
  if (typeof g['planBaselineN'] !== 'number') return null;
  return {
    id: g['id'] as string,
    objective: g['objective'] as string,
    status: g['status'] as GoalStatus,
    iterations: Math.max(0, Math.floor(g['iterations'] as number)),
    elapsed: typeof g['elapsed'] === 'number' ? Math.max(0, g['elapsed'] as number) : 0,
    howFar: isHowFar(g['howFar']) ? g['howFar'] : 'doing',
    startedAt: g['startedAt'] as number,
    planBaselineN: Math.max(0, Math.floor(g['planBaselineN'] as number)),
  };
}

/** Key for localStorage per project. */
export function goalStorageKey(project: string): string {
  return `graphe:goal:${project}`;
}
