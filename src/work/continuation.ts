/** The one thing allowed to send a message the person did not type.
 *
 * A checklist with steps left, a goal not met yet, board pieces that landed, an
 * add-on asking for another turn, a run that fell over — five reasons to carry
 * on, and five separate loops each firing on the same settled reply, none of
 * them aware of the other four. That is how one reply became three, and how a
 * run that should have carried on sat there instead because each loop assumed
 * another had it.
 *
 * So the decision is taken once, here. What matters more than the sending is
 * the stopping: every way out says something out loud, because a run that goes
 * quiet is indistinguishable from the bug this exists to remove.
 *
 * Pure. No clock, no sending, no disk — the owner does that and brings back the
 * facts. Rounds are counted by messages this sent, not by replies that settled,
 * because one settled reply can cover several messages.
 */

import { MOST_ROUNDS, MOST_STUCK, carryOnPrompt, carryOnWords } from './carryon';

export { MOST_ROUNDS, MOST_STUCK };

/** Why a message is being sent on the person's behalf. */
export type Why = 'checklist' | 'goal' | 'board' | 'extension' | 'recovery';

/** How the last run ended. `blocked-by-addon` is an add-on refusing every step;
 *  `asked-person` is a question card, plan card or helper waiting for an
 *  answer, which is holding rather than stalling. */
export type EndedHow = 'finished' | 'stopped' | 'failed' | 'asked-person' | 'blocked-by-addon';

/** Where one conversation has got to. */
export type State = {
  /** Sends made since the person last typed. */
  rounds: number;
  /** Steps done when the last round was sent, so progress can be measured
   *  rather than asserted. -1 before the first round. */
  ticksAtLastRound: number;
  /** Consecutive rounds that ticked nothing off and moved no goal. */
  stuckRounds: number;
  /** The person pressed Escape. */
  stopped: boolean;
  /** A question card, plan card, guard confirmation or helper decision is open. */
  waitingOnPerson: boolean;
};

/** One finished board piece, as much of it as the decision needs. */
export type Piece = { readonly id: string; readonly title: string };

/** Everything the decision is allowed to look at. */
export type Facts = {
  list: { done: number; total: number; next: string | null; finished: boolean } | null;
  /** `objective` is what the goal was asked for in, so a round can name it. */
  goal: { met: boolean; reason: string; objective?: string } | null;
  endedHow: EndedHow;
  /** Pieces that finished since the last decision. The owner clears these once
   *  consumed, which is what keeps one event to one send. */
  boardFinished: readonly Piece[];
  /** An add-on asking for a turn of its own. Cleared by the owner once sent. */
  extensionAsked: { from: string; text: string } | null;
};

export type Move =
  | { kind: 'send'; why: Why; text: string; said: string; state: State }
  | { kind: 'rest'; said?: string; state: State }
  | { kind: 'stop'; said: string; state: State };

function titlesOf(pieces: readonly Piece[]): string {
  return pieces.map((one) => `“${one.title}”`).join(', ');
}

function named(objective: string | undefined): string | null {
  const said = (objective ?? '').trim();
  return said === '' ? null : said;
}

export const continuationWords = {
  /** An add-on that refuses every step has taken the run away from both of us,
   *  so the answer is to say so, not to send it round again. */
  blocked:
    'An add-on refused every step of that run, so I have left it where it is rather than sending it round again. Turn the add-on off in Add-ons, or say what to do instead.',
  spent: (n: number): string =>
    `Stopped after ${String(n)} rounds carrying on by myself. Say carry on to keep going.`,

  listStuck: carryOnWords.stuck,
  listDone: 'The list is finished, so I have stopped there.',

  goalStuck: (reason: string): string =>
    `Two rounds without the goal moving on, so I have stopped rather than going round again. ${reason}`.trim(),
  goalRound: (n: number, objective: string | undefined): string => {
    const said = named(objective);
    return said === null
      ? `Carrying on toward the goal (round ${String(n)})`
      : `Carrying on toward “${said}” (round ${String(n)})`;
  },
  goalPrompt: (objective: string | undefined, reason: string): string => {
    const said = named(objective);
    return [
      said === null ? 'Carry on toward the goal.' : `Carry on toward this goal: ${said}.`,
      `It is not met yet: ${reason}`,
      'Work the next thing that moves it toward done. Do not stop to report progress while it is still unmet.',
    ].join(' ');
  },

  /** Names the add-on, so a turn nobody typed is never mistaken for one of
   *  ours or for the model talking to itself. */
  extensionAsked: (from: string): string => `${from} asked for another turn`,

  boardLanded: (pieces: readonly Piece[]): string =>
    pieces.length === 1
      ? `${pieces[0]?.title ?? 'A piece'} finished on the board · taking it in`
      : `${String(pieces.length)} board pieces finished · taking them in`,
  boardPrompt: (pieces: readonly Piece[]): string =>
    [
      `Finished on the board: ${titlesOf(pieces)}.`,
      'Read what they came back with, take it into the work in hand, and carry on from there.',
    ].join(' '),

  recovery: (n: number): string => `That run stopped on an error · picking it up (round ${String(n)})`,
  recoveryPrompt:
    'That run stopped on an error before the work was done. Pick it up from where it stopped and carry on.',
  recoveryTwice:
    'That failed twice over, so I have stopped rather than trying the same thing again. Say what to try instead.',
} as const;

export function freshContinuation(): State {
  return { rounds: 0, ticksAtLastRound: -1, stuckRounds: 0, stopped: false, waitingOnPerson: false };
}

/** The person typed something, so the budget starts again and whatever they
 *  were being asked has been answered. */
export function personSpoke(state: State): State {
  return {
    ...state,
    rounds: 0,
    ticksAtLastRound: -1,
    stuckRounds: 0,
    stopped: false,
    waitingOnPerson: false,
  };
}

/** One send, or the ceiling saying no. Every reason spends from the same
 *  budget, so five reasons cannot add up to five times the rounds. */
function sending(
  state: State,
  why: Why,
  text: string,
  said: string,
  next: { stuckRounds: number; ticksAtLastRound: number },
): Move {
  const rounds = state.rounds + 1;
  if (rounds > MOST_ROUNDS) {
    return {
      kind: 'stop',
      said: continuationWords.spent(state.rounds),
      state: { ...state, stopped: true },
    };
  }
  return { kind: 'send', why, text, said, state: { ...state, ...next, rounds } };
}

function halt(state: State, said: string, stuckRounds = state.stuckRounds): Move {
  return { kind: 'stop', said, state: { ...state, stuckRounds, stopped: true } };
}

/**
 * An add-on's turn has already begun by the time anything hears about it, so
 * its round is checked as it arrives rather than on the settle. Null while
 * there is budget left, and then the ordinary path counts it.
 */
export function extensionOverBudget(state: State): { said: string; state: State } | null {
  if (state.stopped || state.rounds < MOST_ROUNDS) return null;
  return { said: continuationWords.spent(state.rounds), state: { ...state, stopped: true } };
}

/**
 * Whether to send, rest or stop.
 *
 * The order is the point: stopped and waiting come before every reason to
 * carry on, because a person mid-question must never be nudged, and a person
 * who pressed Escape has already been answered.
 */
export function decide(state: State, facts: Facts): Move {
  // They pressed it. Saying so back to them is noise.
  if (state.stopped) return { kind: 'rest', state };

  if (facts.endedHow === 'blocked-by-addon') return halt(state, continuationWords.blocked);

  // Never nudge somebody who is being asked a question.
  if (facts.endedHow === 'asked-person' || state.waitingOnPerson) return { kind: 'rest', state };

  if (facts.endedHow === 'stopped') return { kind: 'rest', state };

  const keep = { stuckRounds: state.stuckRounds, ticksAtLastRound: state.ticksAtLastRound };

  if (facts.extensionAsked !== null) {
    return sending(
      state,
      'extension',
      facts.extensionAsked.text,
      continuationWords.extensionAsked(facts.extensionAsked.from),
      keep,
    );
  }

  if (facts.boardFinished.length > 0) {
    return sending(
      state,
      'board',
      continuationWords.boardPrompt(facts.boardFinished),
      continuationWords.boardLanded(facts.boardFinished),
      keep,
    );
  }

  const list = facts.list;
  if (
    list !== null &&
    !list.finished &&
    list.total > 0 &&
    list.done < list.total &&
    list.next !== null
  ) {
    // Progress is the count moving, not the model saying it did.
    const moved = state.ticksAtLastRound < 0 || list.done > state.ticksAtLastRound;
    const stuckRounds = moved ? 0 : state.stuckRounds + 1;
    if (stuckRounds >= MOST_STUCK) return halt(state, continuationWords.listStuck, stuckRounds);
    return sending(
      state,
      'checklist',
      carryOnPrompt(list.next, list.done, list.total),
      carryOnWords.round(state.rounds + 1, list.done, list.total, list.next),
      { stuckRounds, ticksAtLastRound: list.done },
    );
  }

  const goal = facts.goal;
  if (goal !== null && !goal.met) {
    // Ticks are the only progress there is to count. Without a list there is
    // nothing to measure, so the round budget is the only brake.
    const ticks = list === null ? -1 : list.done;
    const moved = ticks < 0 || state.ticksAtLastRound < 0 || ticks > state.ticksAtLastRound;
    const stuckRounds = moved ? 0 : state.stuckRounds + 1;
    if (stuckRounds >= MOST_STUCK)
      return halt(state, continuationWords.goalStuck(goal.reason), stuckRounds);
    return sending(
      state,
      'goal',
      continuationWords.goalPrompt(goal.objective, goal.reason),
      continuationWords.goalRound(state.rounds + 1, goal.objective),
      { stuckRounds, ticksAtLastRound: ticks < 0 ? state.ticksAtLastRound : ticks },
    );
  }

  if (facts.endedHow === 'failed') {
    // Never twice in a row: the second identical retry is a loop, not a fix.
    if (state.stuckRounds !== 0)
      return { kind: 'rest', said: continuationWords.recoveryTwice, state };
    return sending(state, 'recovery', continuationWords.recoveryPrompt, continuationWords.recovery(state.rounds + 1), {
      stuckRounds: 1,
      ticksAtLastRound: state.ticksAtLastRound,
    });
  }

  if (list !== null && (list.finished || (list.total > 0 && list.done >= list.total)))
    return { kind: 'rest', said: continuationWords.listDone, state };

  return { kind: 'rest', state };
}
