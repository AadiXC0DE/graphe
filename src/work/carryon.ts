/** Carrying on through a checklist without being asked again.
 *
 * A list of twelve steps is a list of twelve steps. The model does one, the
 * reply ends, and the person types "continue" — eleven times. That is not a
 * plan being worked, it is a person hand-cranking one.
 *
 * So a settled reply with steps still unticked asks for the next one. What
 * stops it is here too, and matters more than what starts it: a loop that
 * cannot see it is getting nowhere is worse than no loop at all.
 *
 * Pure. The window decides when to ask; this decides whether to.
 */

/** As many rounds as one list is worth before somebody should look at it. Well
 *  past any real checklist, and short of a night's spending. */
export const MOST_ROUNDS = 24;

/** Rounds that tick nothing off before it stops. One is ordinary — a step can
 *  take two replies. Two in a row is a model going round rather than through. */
export const MOST_STUCK = 2;

/** Where one conversation has got to. */
export type CarryOn = {
  /** Auto-continues sent since the person last said anything. */
  rounds: number;
  /** Consecutive rounds that ticked nothing off. */
  stuck: number;
  /** How many were done when the last round was asked for, so progress can be
   *  measured rather than asserted. */
  wasDone: number;
};

export const carryOnWords = {
  /** Said each round, so the loop is visible and not a mystery second reply. */
  round: (n: number, done: number, total: number, next: string): string =>
    `Step ${String(done)} of ${String(total)} · carrying on with “${next}” (round ${String(n)})`,
  /** Said when it gives up rather than going round again. */
  stuck:
    'Two rounds without a step ticked off, so I have stopped rather than going round again. Say what to do next.',
  spent: (n: number): string =>
    `Stopped after ${String(n)} rounds with steps still on the list. Say carry on to keep going.`,
} as const;

export function freshCarryOn(): CarryOn {
  return { rounds: 0, stuck: 0, wasDone: -1 };
}

/** What to do once a reply has settled and the list has been advanced. */
export type NextMove =
  | { kind: 'ask'; state: CarryOn; said: string }
  | { kind: 'stop'; said: string }
  | { kind: 'rest' };

/**
 * Whether to ask for another round.
 *
 * `done`/`total` are the list as it stands now, `next` the step that would be
 * picked up. Everything that ends the loop ends it out loud: a run that stops
 * silently is indistinguishable from the bug this exists to fix.
 */
export function nextMove(
  state: CarryOn,
  plan: { done: number; total: number; next: string | null },
): NextMove {
  // Nothing left, or nothing to work on. The list has finished on its own.
  if (plan.next === null || plan.total === 0 || plan.done >= plan.total) return { kind: 'rest' };

  // Progress is the count moving, not the model saying it did.
  const moved = state.wasDone < 0 || plan.done > state.wasDone;
  const stuck = moved ? 0 : state.stuck + 1;
  if (stuck >= MOST_STUCK) return { kind: 'stop', said: carryOnWords.stuck };

  const rounds = state.rounds + 1;
  if (rounds > MOST_ROUNDS) return { kind: 'stop', said: carryOnWords.spent(state.rounds) };

  return {
    kind: 'ask',
    state: { rounds, stuck, wasDone: plan.done },
    said: carryOnWords.round(rounds, plan.done, plan.total, plan.next),
  };
}

/** What the next round is asked for in. Names the step rather than saying
 *  "continue", so a model reading only the last message still knows the job. */
export function carryOnPrompt(next: string, done: number, total: number): string {
  return [
    `Carry on with the checklist. ${String(done)} of ${String(total)} are done and the next is “${next}”.`,
    'Work through the rest of the list. Call step_done as each one lands.',
    'Do not stop to report progress while steps are still unticked: a summary is not a step, and an advisor’s verdict is a second opinion on the work, not permission to leave the list unfinished.',
  ].join(' ');
}
