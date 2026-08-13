/** Long runs of steps, gathered into one row.
 *
 * A turn that reads eleven files unfolds as eleven lines, and by the time the
 * answer arrives the sentence somebody actually wanted is off the top of the
 * screen. The information is the same either way; the difference is whether the
 * conversation still reads as a conversation.
 *
 * Only *consecutive* steps gather, and only when there are enough of them to be
 * a chain rather than a step or two. Everything else — messages, questions,
 * plans, pictures — passes through untouched and breaks the run, because those
 * are the things the steps happened between.
 */

import type { Turn } from './thread';

export type StepTurn = Extract<Turn, { kind: 'did' }>;

export type Row =
  | { kind: 'one'; turn: Turn }
  /** Several steps in a row, drawn as one line with the rest behind it. */
  | { kind: 'steps'; id: string; steps: readonly StepTurn[] };

/** Fewer than this and there is nothing to gain: two lines are two lines
 *  whether they are behind a disclosure or not. */
export const ENOUGH_TO_GATHER = 3;

/**
 * The most steps one row will ever hold.
 *
 * A fold that swallows a hundred and fifty steps is not a fold, it is a
 * trapdoor: opening it by accident drops somebody into a list they now have to
 * scroll to the end of to get back where they were. A long run becomes several
 * rows of this size, so opening one is always a small, recoverable move — and
 * the run still reads as a run, because the rows sit together.
 */
export const MOST_IN_A_ROW = 15;

/**
 * The conversation as rows to draw.
 *
 * `keepApart` names turns that must stay on their own — the ones something else
 * is pinned under, so a picture cannot end up filed beneath a row that is no
 * longer there.
 */
export function rows(
  turns: readonly Turn[],
  keepApart: ReadonlySet<string> = new Set(),
): readonly Row[] {
  const out: Row[] = [];
  let run: StepTurn[] = [];

  const flush = (): void => {
    if (run.length === 0) return;
    const steps = run;
    run = [];
    if (steps.length < ENOUGH_TO_GATHER) {
      for (const turn of steps) out.push({ kind: 'one', turn });
      return;
    }
    // Cut into rows nobody has to scroll out of. The last piece joins the one
    // before it when it would be a stub — a row of one behind a disclosure is
    // the fold costing a press and saving nothing.
    for (let from = 0; from < steps.length; from += MOST_IN_A_ROW) {
      const rest = steps.length - from;
      const piece =
        rest > MOST_IN_A_ROW && rest - MOST_IN_A_ROW < ENOUGH_TO_GATHER
          ? steps.slice(from)
          : steps.slice(from, from + MOST_IN_A_ROW);
      // The first step's id names the row, so the row keeps its identity — and
      // therefore whether it is open — as more steps join the end of it.
      out.push({ kind: 'steps', id: `steps-${piece[0]?.id ?? ''}`, steps: piece });
      if (piece.length > MOST_IN_A_ROW) break;
    }
  };

  for (const turn of turns) {
    if (turn.kind === 'did' && !keepApart.has(turn.id)) {
      run.push(turn);
      continue;
    }
    flush();
    out.push({ kind: 'one', turn });
  }
  flush();

  return out;
}

/** How a gathered row reads as a whole: still going if any step is, stopped if
 *  any stopped and none is still going, finished otherwise. */
export function howItWent(steps: readonly StepTurn[]): 'running' | 'done' | 'failed' {
  if (steps.some((step) => step.state === 'running')) return 'running';
  return steps.some((step) => step.state === 'failed') ? 'failed' : 'done';
}
