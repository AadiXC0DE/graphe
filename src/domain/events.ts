/** An event, and the owner it belongs to.
 *
 * Renderer selection never determines the target of a mutation. An envelope
 * names its owner, its runtime generation and its position in that owner's
 * stream, so whichever tab, panel or list happens to be in front cannot change
 * where an event lands or which conversation a write applies to.
 */

import {
  newEventId,
  type ConversationId,
  type EventId,
  type RunId,
  type RuntimeEpoch,
  type Sequence,
  type SequenceSource,
  type WorkspaceId,
} from './identity';

/** Who an event is about. Tagged, so a conversation id and a workspace id that
 *  happen to hold the same text are still never the same owner. */
export type OwnerId =
  | { readonly kind: 'conversation'; readonly id: ConversationId }
  | { readonly kind: 'workspace'; readonly id: WorkspaceId }
  | { readonly kind: 'run'; readonly id: RunId };

/** Address an event to a conversation. Chat events carry this, not a tab. */
export function conversationOwner(id: ConversationId): OwnerId {
  return { kind: 'conversation', id };
}

/** Address an event to a workspace: its lease, its head, its verification. */
export function workspaceOwner(id: WorkspaceId): OwnerId {
  return { kind: 'workspace', id };
}

/** Address an event to one run. Stop, cancellation and children belong here. */
export function runOwner(id: RunId): OwnerId {
  return { kind: 'run', id };
}

/** One event, with everything needed to place it: who it is for, which runtime
 *  generation produced it, where it sits in that owner's stream, and when. */
export interface OwnerEnvelope<T> {
  readonly ownerId: OwnerId;
  /** The runtime generation that produced this event. */
  readonly runtimeEpoch: RuntimeEpoch;
  /** Position in this owner's stream, within this generation. */
  readonly sequence: Sequence;
  readonly eventId: EventId;
  /** Milliseconds since the epoch. For reading and logs; it never orders. */
  readonly at: number;
  readonly payload: T;
}

/** What the builder needs to make an envelope. The event body is the only part
 *  the caller chooses; the identity, the position and the timestamp are taken
 *  from the runtime so they cannot be invented at a call site. */
export interface EnvelopeInput<T> {
  readonly ownerId: OwnerId;
  readonly runtimeEpoch: RuntimeEpoch;
  /** The counter for that same generation; a mismatch is a bug, not a heuristic. */
  readonly sequences: SequenceSource;
  readonly payload: T;
  /** A fixed clock, so a test can assert the timestamp. */
  readonly at?: number;
  /** Only when replaying a recorded event, to keep its identity. */
  readonly eventId?: EventId;
}

/** One event, addressed to its owner and marked at the next position. */
export function owned<T>(input: EnvelopeInput<T>): OwnerEnvelope<T> {
  if (input.sequences.epoch !== input.runtimeEpoch) {
    throw new Error('An event cannot carry one runtime generation and a counter from another.');
  }
  return {
    ownerId: input.ownerId,
    runtimeEpoch: input.runtimeEpoch,
    sequence: input.sequences.nextSequence(),
    eventId: input.eventId ?? newEventId(),
    at: input.at ?? Date.now(),
    payload: input.payload,
  };
}

/** Whether two owners are the same thing: same kind, same id. */
export function isSameOwner(left: OwnerId, right: OwnerId): boolean {
  return left.kind === right.kind && left.id === right.id;
}

/** Staleness, exactly:
 *
 *  - Two different owners never compare. A workspace event is never stale
 *    against a conversation event, however the ids read.
 *  - For one owner, a lower runtime generation is stale whatever its sequence:
 *    a restarted runtime begins its counter again, so positions from two
 *    generations are not on the same scale.
 *  - For one owner in the same generation, a lower sequence is stale.
 *  - Same generation and same sequence is not staleness. That is the same
 *    position, and `eventId` is what tells a repeat from a new event.
 *  - `at` never decides any of this: two runtimes can share a clock, and a
 *    stale snapshot can still arrive with a later timestamp.
 */
export function isStale(incoming: OwnerEnvelope<unknown>, current: OwnerEnvelope<unknown>): boolean {
  if (!isSameOwner(incoming.ownerId, current.ownerId)) return false;
  if (incoming.runtimeEpoch !== current.runtimeEpoch) {
    return incoming.runtimeEpoch < current.runtimeEpoch;
  }
  return incoming.sequence < current.sequence;
}

/** The other direction of `isStale`: true when `left` comes after `right` for
 *  the same owner, and false when they are different owners or the same place. */
export function newerThan(left: OwnerEnvelope<unknown>, right: OwnerEnvelope<unknown>): boolean {
  return isStale(right, left);
}
