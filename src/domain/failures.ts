/** Why an operation refused, in a shape the caller has to handle.
 *
 * A typed refusal rather than a message, because the caller decides what to do
 * from `kind`, and because a half-finished operation must not be readable as a
 * success. Only the partial case carries effects, so the compiler will not let a
 * caller cover unknown work with a cheerful branch.
 */

import type { OwnerId } from './events';
import type { RuntimeEpoch, WorkspaceId } from './identity';

/** Every refusal an operation can report, so a caller switches on a closed set
 *  rather than on a message it has to read. */
export type FailureKind =
  | 'not-found'
  | 'stale-owner'
  | 'workspace-unavailable'
  | 'operation-cancelled'
  | 'partial-failure';

/** What an operation may already have done when it stopped halfway. `happened`
 *  is confirmed; `unknown` is exactly that, and neither is success. */
export interface PartialEffects {
  readonly happened: readonly string[];
  readonly unknown: readonly string[];
}

/** The target is gone: a record was deleted, or the id was never one. */
export interface NotFoundFailure {
  readonly kind: 'not-found';
  /** What was looked for: project, workspace, conversation, view, run. */
  readonly entity: string;
  /** The id as it was asked for. It may not even be a well formed id. */
  readonly id: string;
  readonly detail: string;
}

/** The work was made for an owner or a generation that no longer holds it, so
 *  applying it would write into whatever owns that id now. */
export interface StaleOwnerFailure {
  readonly kind: 'stale-owner';
  /** The owner the work was made for. */
  readonly ownerId: OwnerId;
  /** The generation that owner belonged to. */
  readonly epoch: RuntimeEpoch;
  /** The generation serving that owner now, when it is known. */
  readonly currentEpoch: RuntimeEpoch | null;
  readonly detail: string;
}

/** The recorded folder cannot be used: gone, no longer a repository, or now a
 *  different one. Never resolved to another folder that happens to exist. */
export interface WorkspaceUnavailableFailure {
  readonly kind: 'workspace-unavailable';
  readonly workspaceId: WorkspaceId;
  readonly detail: string;
}

/** The user, or a bound, stopped this. Distinct from a failure: nothing went
 *  wrong, and a late result for it must be dropped rather than applied. */
export interface OperationCancelledFailure {
  readonly kind: 'operation-cancelled';
  /** The operation that was stopped, so a late result can be matched to it. */
  readonly operationId: string;
  readonly detail: string;
}

/** The operation stopped halfway. The only variant that carries effects, so a
 *  caller has to handle it before it can read what may have happened. */
export interface PartialFailure {
  readonly kind: 'partial-failure';
  readonly effects: PartialEffects;
  readonly detail: string;
}

/** Every refusal, as one union a caller switches on. `PartialEffects` is
 *  reachable through `PartialFailure` alone. */
export type OperationFailure =
  | NotFoundFailure
  | StaleOwnerFailure
  | WorkspaceUnavailableFailure
  | OperationCancelledFailure
  | PartialFailure;

/** True only for the case that carries effects. */
export function isPartialFailure(failure: OperationFailure): failure is PartialFailure {
  return failure.kind === 'partial-failure';
}

/** The refusal in words a person reads. `detail` is for the log, not for this:
 *  it is written by the operation and can hold plumbing a user should not see. */
export function describeFailure(failure: OperationFailure): string {
  switch (failure.kind) {
    case 'not-found':
      return `There is no ${failure.entity} with that id any more.`;
    case 'stale-owner':
      return 'Something else is in charge of this work now, so nothing was changed.';
    case 'workspace-unavailable':
      return 'The folder this work runs in is not available right now.';
    case 'operation-cancelled':
      return 'This was stopped before it finished.';
    case 'partial-failure':
      return saysPartial(failure.effects);
  }
}

function saysPartial(effects: PartialEffects): string {
  const done = effects.happened.length;
  const unsure = effects.unknown.length;
  const did = `${String(done)} ${done === 1 ? 'step' : 'steps'}`;
  if (unsure === 0) {
    return `Part of this finished (${did}) and the rest did not.`;
  }
  const maybe = `${String(unsure)} ${unsure === 1 ? 'step' : 'steps'}`;
  return `Part of this finished (${did}), and ${maybe} may or may not have happened. Check before carrying on.`;
}
