/** Where a conversation is, and what survives a restart.
 *
 * Two questions kept apart on purpose. `SessionState` is where the live runtime
 * is right now; `DurableFacts` is what was written down before the app stopped.
 * A restart rebuilds the first from the second and never the other way round,
 * which is how a process that died stops being reported as still running.
 */

import type { OwnerId } from './events';
import type { ConversationId, RuntimeEpoch, WorkspaceId } from './identity';

/** Where one conversation's runtime is. Held by the session service, written
 *  down only as `DurableFacts`, and never inferred from a tab. */
export type SessionState =
  | 'unloaded'
  | 'opening'
  | 'idle'
  | 'queued'
  | 'running'
  | 'waiting-input'
  | 'compacting'
  | 'stopping'
  | 'interrupted'
  | 'failed'
  | 'archived';

/** Every state, in the order a conversation usually meets them. */
export const SESSION_STATES: readonly SessionState[] = [
  'unloaded',
  'opening',
  'idle',
  'queued',
  'running',
  'waiting-input',
  'compacting',
  'stopping',
  'interrupted',
  'failed',
  'archived',
];

/** The allowed moves, as data. Anything absent is refused rather than guessed at.
 *
 *  `unloaded` is where a conversation sits before any runtime holds it. A second
 *  `opening` while one is in flight is not allowed: two opens would be two
 *  writers for one transcript. `waiting-input` is a wait, not a stall, so nothing
 *  here turns it into a retry. The interrupted/failed/archived states end an
 *  attempt and reach `opening` only because the user asked again.
 */
export const TRANSITIONS: Readonly<Record<SessionState, readonly SessionState[]>> = {
  unloaded: ['opening', 'archived'],
  opening: ['idle', 'stopping', 'interrupted', 'failed', 'archived'],
  idle: ['queued', 'running', 'compacting', 'opening', 'stopping', 'interrupted', 'failed', 'archived', 'unloaded'],
  queued: ['running', 'idle', 'stopping', 'interrupted', 'failed', 'archived'],
  running: ['idle', 'queued', 'waiting-input', 'compacting', 'stopping', 'interrupted', 'failed', 'archived'],
  'waiting-input': ['running', 'stopping', 'interrupted', 'failed', 'archived'],
  compacting: ['running', 'idle', 'stopping', 'interrupted', 'failed', 'archived'],
  stopping: ['idle', 'interrupted', 'failed', 'archived'],
  interrupted: ['opening', 'archived'],
  failed: ['opening', 'archived'],
  archived: ['opening'],
};

/** Whether the move is allowed. Asked before a state is written, so an illegal
 *  move is refused rather than stored and repaired later. */
export function canTransition(from: SessionState, to: SessionState): boolean {
  return TRANSITIONS[from].includes(to);
}

/** The states where an attempt has ended: nothing is running, and nothing moves
 *  without the user asking again, so a late event from the stopped generation
 *  cannot restart one. `unloaded` is not one of these; it is where a
 *  conversation waits to be opened, not where an attempt finished. */
export function isTerminal(state: SessionState): boolean {
  return state === 'interrupted' || state === 'failed' || state === 'archived';
}

/** What was written down, and therefore what is still true after a restart. */
export interface DurableFacts {
  readonly conversationId: ConversationId;
  readonly workspaceId: WorkspaceId | null;
  /** The last state written down, not the state anybody hoped for. */
  readonly status: SessionState;
  /** The run that owned the last write, if one did. */
  readonly ownerId: OwnerId | null;
  /** The generation that was serving this conversation. */
  readonly runtimeEpoch: RuntimeEpoch | null;
  readonly writtenAt: number;
}

/** The live position of one conversation. Nothing here is expected to survive. */
export interface RuntimeState {
  readonly state: SessionState;
  /** The runtime serving this conversation; null when nothing is attached. */
  readonly runtimeEpoch: RuntimeEpoch | null;
  readonly ownerId: OwnerId | null;
}

/** The state a conversation comes back in.
 *
 * `interrupted` is the default for work that was in flight, because a restart
 * killed the process that was doing it. It is not the default for everything:
 * a conversation that was idle, failed or archived keeps what it had, since
 * nothing was running that a restart could have interrupted. `alive` is a fact
 * the supervisor establishes by reattaching, and it needs a recorded generation
 * to mean anything, so `alive: true` with no generation is still interrupted. */
export function recoverAfterRestart(facts: DurableFacts, alive: boolean): RuntimeState {
  if (alive && facts.runtimeEpoch !== null) {
    return { state: facts.status, runtimeEpoch: facts.runtimeEpoch, ownerId: facts.ownerId };
  }
  const inFlight =
    facts.status === 'opening' ||
    facts.status === 'queued' ||
    facts.status === 'running' ||
    facts.status === 'waiting-input' ||
    facts.status === 'compacting' ||
    facts.status === 'stopping';
  return {
    state: inFlight ? 'interrupted' : facts.status,
    runtimeEpoch: null,
    ownerId: null,
  };
}
