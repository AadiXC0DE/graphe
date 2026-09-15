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
 *  here turns it into a retry — but a question whose run ended is over, which is
 *  why the wait reaches `idle` as well as back to `running`. The
 *  interrupted/failed/archived states end an attempt and reach `opening` only
 *  because the user asked again.
 */
export const TRANSITIONS: Readonly<Record<SessionState, readonly SessionState[]>> = {
  unloaded: ['opening', 'archived'],
  opening: ['idle', 'stopping', 'interrupted', 'failed', 'archived'],
  idle: ['queued', 'running', 'compacting', 'opening', 'stopping', 'interrupted', 'failed', 'archived', 'unloaded'],
  queued: ['running', 'idle', 'stopping', 'interrupted', 'failed', 'archived'],
  running: ['idle', 'queued', 'waiting-input', 'compacting', 'stopping', 'interrupted', 'failed', 'archived'],
  'waiting-input': ['running', 'idle', 'stopping', 'interrupted', 'failed', 'archived'],
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
  return {
    state: inFlight(facts.status) ? 'interrupted' : facts.status,
    runtimeEpoch: null,
    ownerId: null,
  };
}

/** Whether a process dying right now would have been in the middle of
 *  something. These are the states a restart interrupts, and the ones nothing
 *  may put down: ending one of them ends work somebody asked for. */
export function inFlight(state: SessionState): boolean {
  return (
    state === 'opening' ||
    state === 'queued' ||
    state === 'running' ||
    state === 'waiting-input' ||
    state === 'compacting' ||
    state === 'stopping'
  );
}

/**
 * What a conversation's runtime shows on a row: a run going, a run that was cut
 * off, or nothing worth a mark.
 *
 * `interrupted` is not `inFlight` — nothing is running — and it is not idle
 * either: something was asked for and did not finish, which is the one thing a
 * row must not present as a chat sitting still. That is the whole reason this
 * is a predicate of its own rather than an `inFlight` test at the call site,
 * which is what left a killed run reading as a timestamp.
 */
export function runMark(state: SessionState): 'working' | 'interrupted' | null {
  if (inFlight(state)) return 'working';
  return state === 'interrupted' ? 'interrupted' : null;
}

/**
 * The things a run does that stop it being `running` without ending it.
 *
 * Both are the run's own to say and neither is visible from the shell
 * otherwise: a question on screen (`asked`) and Pi's tidying of a long
 * conversation. `tidying` is Pi's own compaction — ours to narrate, never to
 * perform — and it arrives whether the app asked for it or Pi decided on its
 * own.
 */
export type WorkEvent = 'asked' | 'unasked' | 'tidying' | 'tidied';

/**
 * Where one of those leaves a conversation, or null when it says nothing about
 * where the conversation is.
 *
 * A question only ever interrupts a run that is going, and it is answered by
 * the run picking up again (`running`) or by the run ending under it (`idle`),
 * which is why the answer comes from `working` rather than from a guess. A
 * tidying pass is entered from wherever the conversation was and left the same
 * way. Anything else — a question withdrawing on a conversation that was never
 * waiting, a tidy finishing on one that never started — is null, so the caller
 * invents nothing.
 */
export function movedByWork(
  from: SessionState,
  event: WorkEvent,
  working: boolean,
): SessionState | null {
  switch (event) {
    case 'asked':
      return from === 'running' ? 'waiting-input' : null;
    case 'unasked':
      return from === 'waiting-input' ? (working ? 'running' : 'idle') : null;
    case 'tidying':
      return from === 'running' || from === 'idle' ? 'compacting' : null;
    case 'tidied':
      return from === 'compacting' ? (working ? 'running' : 'idle') : null;
  }
}

/**
 * The state to report for a conversation, with the archive flag taken into
 * account.
 *
 * Archive is a durable fact the registry owns rather than something a runtime
 * is doing, so it cannot be read off the runtime states alone: a conversation
 * put away in an earlier sitting has no runtime here at all, and no note about
 * it survives either, because only a run still in flight is written down. So
 * the flag decides for anything that is not in flight — a run really going is
 * reported as going, whoever put the conversation away — and it is not invented
 * for a conversation nobody archived.
 */
export function reportedState(state: SessionState, archived: boolean): SessionState {
  return archived && !inFlight(state) ? 'archived' : state;
}

/* -------------------------------------------------------------------------- */
/* The state of every conversation's runtime                                    */
/* -------------------------------------------------------------------------- */

/**
 * Where each conversation's runtime is, and what was last written down about
 * it.
 *
 * The two are held together because they are the same question asked twice:
 * `stateOf` is what is true now and dies with the process, `factsOf` is what a
 * restart reads back. Nothing else decides a state, so a conversation cannot be
 * reported as running by one caller and idle by another.
 *
 * Keyed by conversation, not by tab: two views of one conversation are one
 * runtime, and closing a view is not closing a conversation.
 */
export class Sessions {
  readonly #now = new Map<ConversationId, RuntimeState>();
  readonly #written = new Map<ConversationId, DurableFacts>();
  readonly #wrote: (facts: DurableFacts) => void;

  /** `wrote` is told about every note as it changes, so the caller can put the
   *  in-flight ones on disk without this class knowing about files. */
  constructor(options: { wrote?: (facts: DurableFacts) => void } = {}) {
    this.#wrote = options.wrote ?? (() => undefined);
  }

  /** Where a conversation's runtime is. One nothing has opened is `unloaded`,
   *  which is a real answer rather than a missing one. */
  stateOf(conversation: ConversationId): SessionState {
    return this.#now.get(conversation)?.state ?? 'unloaded';
  }

  /** The last state written down for it, or null when nothing was. */
  factsOf(conversation: ConversationId): DurableFacts | null {
    return this.#written.get(conversation) ?? null;
  }

  /** Every note, in the order they were written: what a launch walks through. */
  facts(): readonly DurableFacts[] {
    return [...this.#written.values()].sort((one, two) => one.writtenAt - two.writtenAt);
  }

  /**
   * A note read back off disk, before anything has opened the conversation.
   *
   * What a launch does with it is `recovered`'s to say; this is only the fact
   * that it was written, and it is what makes `factsOf` answer after a restart
   * with what the last process knew rather than with nothing.
   */
  remembered(facts: DurableFacts): DurableFacts {
    this.#written.set(facts.conversationId, facts);
    return facts;
  }

  /**
   * Move a conversation.
   *
   * A move the table does not allow is refused rather than stored and repaired
   * later, and the state it is in afterwards comes back either way — so a
   * caller that guessed wrong learns where it really is. Asking for the state
   * it is already in is not a move at all: it is the same writer saying the
   * same thing, and `TRANSITIONS` refuses it because two *different* opens are
   * two writers for one transcript.
   */
  move(
    conversation: ConversationId,
    to: SessionState,
    at: number,
    options: { ownerId?: OwnerId | null; workspaceId?: WorkspaceId | null } = {},
  ): SessionState {
    const from = this.stateOf(conversation);
    if (from === to) return from;
    if (!canTransition(from, to)) return from;
    const facts: DurableFacts = {
      conversationId: conversation,
      // The workspace a conversation works in belongs to the registry, not to
      // the runtime; null here means "this layer does not know", not "none".
      workspaceId: options.workspaceId ?? null,
      status: to,
      ownerId: options.ownerId ?? null,
      runtimeEpoch: this.#now.get(conversation)?.runtimeEpoch ?? null,
      writtenAt: at,
    };
    this.#written.set(conversation, facts);
    this.#now.set(conversation, {
      state: to,
      runtimeEpoch: facts.runtimeEpoch,
      ownerId: facts.ownerId,
    });
    this.#wrote(facts);
    return to;
  }

  /**
   * What a restart made of one conversation's note.
   *
   * `alive` is the supervisor's finding, and it is only true for a runtime this
   * launch actually reattached to; a launch that has reattached nothing passes
   * false, which is what turns a note left mid-run into `interrupted`. Called
   * with no note at all it leaves the conversation where it was: nothing was
   * written down, so nothing was interrupted.
   */
  recovered(conversation: ConversationId, alive = false): RuntimeState {
    const facts = this.#written.get(conversation);
    if (facts === undefined) {
      return this.#now.get(conversation) ?? { state: 'unloaded', runtimeEpoch: null, ownerId: null };
    }
    const back = recoverAfterRestart(facts, alive);
    this.#now.set(conversation, back);
    return back;
  }

  /** Take a conversation's runtime away. Its note stays: the note is what the
   *  next launch reads, and forgetting a conversation is a different act. */
  forget(conversation: ConversationId): void {
    this.#now.delete(conversation);
  }
}
