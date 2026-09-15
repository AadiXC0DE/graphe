/** A workspace: the folder a conversation actually writes in.
 *
 * Identity is the generated id, never the path. A folder can be chosen by two
 * conversations and stay two workspaces in the registry, because the registry
 * owns the relationship and the filesystem only validates it. Verification
 * reads what is on disk and either confirms the record or refuses it; it never
 * resolves a missing target to whichever folder is currently selected.
 */

import type { OperationFailure } from './failures';
import type { ConversationId, ProjectId, WorkspaceId } from './identity';

/** Shared main folder, or a folder made for one conversation. Isolation is
 *  requested explicitly and never inferred from a new chat. */
export type WorkspaceKind = 'local' | 'worktree';

/** Lifecycle of the record. `missing` and `recovery-required` are reachable
 *  outcomes of verification, not errors to hide. */
export type WorkspaceState =
  | 'creating'
  | 'ready'
  | 'missing'
  | 'recovery-required'
  | 'deleting'
  | 'deleted';

/** The branch or the commit a checkout was last verified on. A detached head
 *  stores its SHA: `HEAD` is Git saying it could not name one, and storing that
 *  literal is how a detached checkout lost the commit it was on. */
export type WorkspaceHead =
  | { readonly kind: 'branch'; readonly branch: string }
  | { readonly kind: 'detached'; readonly sha: string };

/** What the registry keeps about one workspace. Every path in here is an
 *  attribute for display and for reopening; the id is the identity, so a folder
 *  that moves or is recreated keeps its record and only its paths change. */
export interface WorkspaceRecord {
  readonly workspaceId: WorkspaceId;
  readonly projectId: ProjectId;
  readonly kind: WorkspaceKind;
  /** The canonical working directory. An attribute of this workspace, never its
   *  identity, which is why the path may move without the id changing. */
  readonly cwd: string;
  /** The path as it was chosen: a project root for a managed worktree. */
  readonly originalPath: string;
  /** The short form shown in a header or a picker. */
  readonly displayPath: string;
  /** The repository or common git directory this folder belongs to. */
  readonly repositoryIdentity: string;
  readonly managed: boolean;
  /** The commit the folder was created from, for a managed worktree. */
  readonly baseSha: string | null;
  /** Last verified head, null until the first successful verification. */
  readonly head: WorkspaceHead | null;
  readonly creationOperationId: string;
  readonly state: WorkspaceState;
}

/** What one look at the folder found. Reading it is the caller's job so this
 *  module stays pure and testable without a disk. */
export interface WorkspaceObservation {
  readonly exists: boolean;
  /** Git's answer: a branch name, a commit SHA, or the literal `HEAD` when it
   *  could not resolve one. Null when there is no repository there any more. */
  readonly head: string | null;
  /** The repository identity read at that path now. */
  readonly repositoryIdentity: string | null;
}

/** The folder checked out and agreed with the record. */
export interface Verified {
  readonly ok: true;
  readonly state: 'ready';
  /** The record with the head exactly as it was just verified. */
  readonly record: WorkspaceRecord;
}

/** The folder did not agree, or could not be read. The state names what has to
 *  happen next, and it is never `ready`. */
export interface FailedVerification {
  readonly ok: false;
  /** Never `ready`. A check that failed cannot claim the folder is usable. */
  readonly state: Exclude<WorkspaceState, 'ready'>;
  readonly record: WorkspaceRecord;
  readonly failure: OperationFailure;
}

/** The answer to one check. Narrowed by `ok`, so `ready` is only reachable on
 *  the branch where the check actually succeeded. */
export type Verification = Verified | FailedVerification;

const SHA = /^[0-9a-f]{7,40}$/i;

/** Confirm a record against what the folder says now.
 *
 * A moved head is recorded rather than refused, because committing is what the
 * user does in a workspace and verification is meant to notice, not to block.
 * Everything else that disagrees is refused, and the new state names what has
 * to happen: a folder that is gone is `missing`, a folder that is now a
 * different repository needs recovery. */
export function verify(record: WorkspaceRecord, seen: WorkspaceObservation): Verification {
  const refuse = (state: Exclude<WorkspaceState, 'ready'>, detail: string): FailedVerification => ({
    ok: false,
    state,
    record,
    failure: { kind: 'workspace-unavailable', workspaceId: record.workspaceId, detail },
  });

  if (record.state === 'deleted' || record.state === 'deleting') {
    return refuse(record.state, 'This folder has been removed, so there is nothing to verify.');
  }
  if (!seen.exists) {
    return refuse('missing', 'The folder this workspace records is not there.');
  }
  if (seen.repositoryIdentity === null) {
    return refuse('recovery-required', 'The folder is no longer inside a Git repository.');
  }
  if (seen.repositoryIdentity !== record.repositoryIdentity) {
    return refuse('recovery-required', 'The folder now belongs to a different repository.');
  }

  const raw = seen.head === null ? '' : seen.head.trim();
  if (raw === '' || raw === 'HEAD') {
    return refuse('recovery-required', 'Git did not name a branch or a commit for this folder.');
  }
  return {
    ok: true,
    state: 'ready',
    record: { ...record, head: SHA.test(raw) ? { kind: 'detached', sha: raw } : { kind: 'branch', branch: raw } },
  };
}

/** The relationships, which the index owns rather than the filesystem. */
export interface WorkspaceIndex {
  readonly byProject: ReadonlyMap<ProjectId, readonly WorkspaceId[]>;
  /** One conversation uses one workspace. A second entry would be a bug. */
  readonly byConversation: ReadonlyMap<ConversationId, WorkspaceId>;
}

/** An index with nothing in it. Rebuilt from the records rather than carried
 *  forward, so a deleted record cannot leave a stale entry behind. */
export function emptyIndex(): WorkspaceIndex {
  return { byProject: new Map(), byConversation: new Map() };
}

/** Add or move a workspace. Re-indexing one replaces its project entry instead
 *  of listing it twice, and a project left with nothing drops out entirely. */
export function indexWorkspace(index: WorkspaceIndex, record: WorkspaceRecord): WorkspaceIndex {
  const byProject = new Map<ProjectId, readonly WorkspaceId[]>();
  for (const [projectId, ids] of index.byProject) {
    const kept = ids.filter((id) => id !== record.workspaceId);
    if (kept.length > 0) byProject.set(projectId, kept);
  }
  const mine = byProject.get(record.projectId) ?? [];
  byProject.set(record.projectId, [...mine, record.workspaceId]);
  return { byProject, byConversation: index.byConversation };
}

/** Point a conversation at its workspace. The renderer never gets to do this. */
export function bindConversation(
  index: WorkspaceIndex,
  conversationId: ConversationId,
  workspaceId: WorkspaceId,
): WorkspaceIndex {
  const byConversation = new Map(index.byConversation);
  byConversation.set(conversationId, workspaceId);
  return { byProject: index.byProject, byConversation };
}

/** The workspace one conversation uses, or null when the index does not know it.
 *  Null is answered as null: a missing link is never filled in from a selection. */
export function workspaceFor(index: WorkspaceIndex, conversationId: ConversationId): WorkspaceId | null {
  return index.byConversation.get(conversationId) ?? null;
}
