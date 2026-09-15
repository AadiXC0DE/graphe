/** The one door a turn this app starts has to come through.
 *
 * Six kinds of turn arrive at a conversation: something the person typed, a
 * line they pushed into a run already going, the app carrying on, a goal round,
 * a finished child coming back, and an add-on starting one of its own. Each is a
 * named request here, and the questions asked of it — which run it belongs to,
 * whether that run was stopped, whether somebody is being asked something,
 * whether there is anything for a line to land in, who is writing in the
 * folder, whether anything can answer, and what the round budget says — are
 * asked in one place rather than wherever that turn happens to begin.
 *
 * One of the six is not the host's to admit. Pi lets an add-on start a run from
 * inside itself, and Graphe hears about the message once the run has begun, so
 * there is no moment at which it could be refused: it is counted against the
 * same budget and watched, and a conversation that is over ends it. That is the
 * limit, stated here rather than covered by a check that looks like a cap and
 * is not — trusted add-on code calling the provider directly is invisible to
 * every seam this file can reach, and a hard ceiling over that would be a lie
 * in the shape of a guard.
 *
 * Pi's own hooks before a request are why there is nothing better to reach for:
 * `before_provider_request` hands the payload to a handler and takes whatever
 * it returns as the next payload, and a handler that throws is recorded as an
 * error and the call goes on. Nothing in that event's result means "do not make
 * this call", so a turn begun inside an add-on can be watched and ended, never
 * declined before it starts.
 *
 * Pure. No clock, no sending, no disk.
 */

import { continuationWords } from './continuation';

/** Where a turn came from, in the words the request is made in. */
export type TurnOrigin =
  | 'user'
  | 'steer'
  | 'follow-up'
  | 'explicit-goal'
  | 'child-result'
  | 'extension';

/** One request to begin a turn. */
export type TurnRequest = {
  origin: TurnOrigin;
  /** The run this was made in, where the seam keeps a queue of its own. A
   *  request made before Stop cannot open the run after it. Left off at a seam
   *  where the request is the run's own beginning, which is the person's. */
  epoch?: number;
  /** Who asked, when an add-on did. */
  from?: string;
};

/** What the conversation is, at the moment the request arrives.
 *
 * Every fact is optional, and a seam leaves off what it cannot see rather than
 * guessing: a session knows whether a run is in flight but not what this
 * conversation's round budget has come to, and the owner of that budget knows
 * the reverse. What is unknown admits — a fact nobody can see may not stop
 * somebody's work.
 */
export type TurnState = {
  /** The run in hand, where the seam keeps a queue of its own. */
  run?: { epoch: number; stopped: boolean };
  /** Whether a run is in flight, where a seam can see that. A steered line has
   *  nothing to land in without one. */
  going?: boolean;
  /** Whether a question card, plan card, guard confirmation or helper decision
   *  is open: somebody is being asked something. */
  waitingOnPerson?: boolean;
  /** Who is writing in the folder this conversation works in. The shell's
   *  workspace lock knows; a session does not. */
  lease?: 'free' | 'somebody-else';
  /** Whether anything can answer here. */
  model?: 'ready' | 'unavailable';
  /** Rounds sent on the person's behalf since they last typed, against the
   *  ceiling those rounds spend from. */
  budget?: { rounds: number; most: number };
};

export type Refusal =
  | 'stale-epoch'
  | 'stopped'
  | 'waiting-on-person'
  | 'budget-spent'
  | 'no-model'
  | 'folder-busy'
  | 'not-going';

export type Admission =
  | { verdict: 'admitted' }
  /** An add-on's own turn: Pi began it before anything here could look. */
  | { verdict: 'watched' }
  /** `said` is what the person is told. Empty where saying it would only be
   *  noise: a stop they pressed themselves, a question they are reading. */
  | { verdict: 'refused'; because: Refusal; said: string };

/** Every word this decision puts on screen. Short, and each one says what to do
 *  instead, because a turn that did not start is otherwise indistinguishable
 *  from one that started and did nothing. */
export const admissionWords = {
  noModel: 'There is nothing set up to answer in this conversation, so that turn has not begun.',
  folderBusy: 'Another conversation is writing in this folder, so that turn has not begun.',
  notGoing:
    'Nothing is running to steer, so that line was not sent. Send it as an ordinary message instead.',
} as const;

/**
 * Whether this turn may begin.
 *
 * The person comes before every rule of automation: a message they type and a
 * line they steer are the run, not something to be argued with, so the checks
 * that apply to them are the two that are about the machine rather than about
 * anybody's intent — nothing to answer with, and a folder somebody else is
 * writing in. Everything the app decided for itself is held to the rest.
 */
export function admit(request: TurnRequest, state: TurnState): Admission {
  if (state.model === 'unavailable')
    return { verdict: 'refused', because: 'no-model', said: admissionWords.noModel };
  if (state.lease === 'somebody-else')
    return { verdict: 'refused', because: 'folder-busy', said: admissionWords.folderBusy };

  const run = state.run;
  const stopped = run !== undefined && run.stopped;
  const stale = request.epoch !== undefined && run !== undefined && request.epoch !== run.epoch;
  const budget = state.budget;
  const overBudget = budget !== undefined && budget.rounds >= budget.most;
  const spentWords = budget === undefined ? '' : continuationWords.spent(budget.rounds);

  // Already going, whoever began it. Ending it is the most that can be done, so
  // the budget is what this answers with.
  if (request.origin === 'extension') {
    if (overBudget)
      return { verdict: 'refused', because: 'budget-spent', said: spentWords };
    if (stale) return { verdict: 'refused', because: 'stale-epoch', said: '' };
    if (stopped) return { verdict: 'refused', because: 'stopped', said: '' };
    return { verdict: 'watched' };
  }

  if (request.origin === 'user') return { verdict: 'admitted' };

  if (request.origin === 'steer') {
    // A steered line joins a run in flight. With nothing running the queue
    // below loses it quietly, so answering here is the difference between a
    // line that was lost and a line somebody was told about.
    if (state.going === false)
      return { verdict: 'refused', because: 'not-going', said: admissionWords.notGoing };
    return { verdict: 'admitted' };
  }

  if (stale) return { verdict: 'refused', because: 'stale-epoch', said: '' };
  if (stopped) return { verdict: 'refused', because: 'stopped', said: '' };
  if (state.waitingOnPerson === true)
    return { verdict: 'refused', because: 'waiting-on-person', said: '' };
  if (overBudget) return { verdict: 'refused', because: 'budget-spent', said: spentWords };
  return { verdict: 'admitted' };
}
