/** Where a conversation's files actually are, written down.
 *
 * A path is an attribute of a workspace, never an identity. Every record here
 * carries an opaque id, so a folder that moves, a symlink that points at the
 * same place, or two projects that happen to share a basename are three
 * different questions with three different answers instead of one guess.
 *
 * The index is deliberately small and deliberately not a transcript: Pi owns
 * what was said, this owns which folder it was said in, which conversations
 * belong to it, and whether it is still where it was left.
 *
 * Pure: everything here takes an index and returns a new one. Reading it from
 * disk, and writing it back atomically, belongs to the caller that knows where
 * the profile lives.
 */

import { randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

export type WorkspaceKind = 'local' | 'worktree';

/** A failed verification cannot return `ready`. See `verifyWorkspace`. */
export type WorkspaceState =
  | 'creating'
  | 'ready'
  | 'missing'
  | 'recovery-required'
  | 'deleting'
  | 'deleted';

export type WorkspaceRecord = {
  workspaceId: string;
  projectId: string;
  kind: WorkspaceKind;
  /** The folder work happens in, canonicalised. */
  cwd: string;
  /** What to show somebody. Kept as it was first seen, not re-derived. */
  displayPath: string;
  /** The repository's common git directory. The same for every worktree of one
   *  repository, which is what makes it an identity rather than a location. */
  repoKey: string | null;
  /** Created by us, so we may clean it up. Imported or external worktrees are
   *  valid and are never deleted automatically. */
  managed: boolean;
  /** The commit a worktree branched from. Null for a local workspace. */
  baseSha: string | null;
  /** The branch it was last verified on, or null when detached. A detached
   *  checkout stores a SHA in `detachedAt`, never the literal `HEAD`. */
  branch: string | null;
  detachedAt: string | null;
  state: WorkspaceState;
  /** The operation that made it, for tracing a failure back to its cause. */
  createdBy: string | null;
  createdAt: number;
  verifiedAt: number | null;
};

export type ProjectRecord = {
  projectId: string;
  /** Canonical root of the project as it is now. */
  root: string;
  /** Other paths that mean this project: an old location, a symlink. */
  aliases: readonly string[];
  workspaces: readonly string[];
};

export type WorkspaceIndex = {
  version: 1;
  projects: Readonly<Record<string, ProjectRecord>>;
  /** Canonical path to project id. Paths are how a person names a project;
   *  the id is what everything else is keyed by. */
  byRoot: Readonly<Record<string, string>>;
  workspaces: Readonly<Record<string, WorkspaceRecord>>;
  /** Conversation id to workspace id. The one line that answers "which files
   *  am I changing" without asking which tab is in front. */
  conversations: Readonly<Record<string, string>>;
};

export const INDEX_VERSION = 1;

export function emptyIndex(): WorkspaceIndex {
  return { version: INDEX_VERSION, projects: {}, byRoot: {}, workspaces: {}, conversations: {} };
}

/** Follow symlinks when the path is there, and fall back to the plain absolute
 *  path when it is not. Two symlinks to one folder are one workspace; a folder
 *  that has gone is still the folder it was. */
export function canonical(path: string): string {
  const absolute = resolvePath(path);
  try {
    return realpathSync(absolute);
  } catch {
    return absolute;
  }
}

/**
 * Read an index off the wire.
 *
 * Anything unreadable comes back as an empty index with the reason attached
 * rather than as a throw: losing the registry is bad, and refusing to start is
 * worse. The caller is expected to quarantine the file it could not read.
 */
export function parseIndex(text: string): { index: WorkspaceIndex; problem: string | null } {
  let held: unknown;
  try {
    held = JSON.parse(text);
  } catch (cause) {
    return { index: emptyIndex(), problem: `not JSON: ${String(cause)}` };
  }
  const one = held as Partial<WorkspaceIndex> | null;
  if (one === null || typeof one !== 'object' || one.version !== INDEX_VERSION) {
    return { index: emptyIndex(), problem: `not a version ${String(INDEX_VERSION)} index` };
  }
  // Field by field: a half-written index costs the rows it lost, not the ones
  // it kept. A record without an id or a folder is not a workspace.
  const workspaces: Record<string, WorkspaceRecord> = {};
  for (const [id, value] of Object.entries(asRecord(one.workspaces))) {
    const record = readWorkspace(value);
    if (record !== null) workspaces[id] = record;
  }
  const projects: Record<string, ProjectRecord> = {};
  for (const [id, value] of Object.entries(asRecord(one.projects))) {
    const record = readProject(value);
    if (record !== null) projects[id] = record;
  }
  const byRoot: Record<string, string> = {};
  for (const [root, id] of Object.entries(asRecord(one.byRoot))) {
    if (typeof id === 'string' && projects[id] !== undefined) byRoot[root] = id;
  }
  const conversations: Record<string, string> = {};
  for (const [conversation, workspace] of Object.entries(asRecord(one.conversations))) {
    if (typeof workspace === 'string' && workspaces[workspace] !== undefined) {
      conversations[conversation] = workspace;
    }
  }
  return { index: { version: INDEX_VERSION, projects, byRoot, workspaces, conversations }, problem: null };
}

export function serializeIndex(index: WorkspaceIndex): string {
  return `${JSON.stringify(index, null, 2)}\n`;
}

/* -------------------------------------------------------------------------- */
/* Projects                                                                    */
/* -------------------------------------------------------------------------- */

/** The project a folder belongs to, by canonical path or by any alias. Does not
 *  fall back to a basename: two folders called `site` are two projects. */
export function projectAtPath(index: WorkspaceIndex, path: string): ProjectRecord | null {
  const id = index.byRoot[canonical(path)];
  return id === undefined ? null : (index.projects[id] ?? null);
}

/**
 * The project record for a folder, made if this is the first time it is seen.
 *
 * Idempotent: opening the same folder twice returns the same project id, and a
 * symlink to a known folder resolves to the record already there. A folder that
 * moved is a separate, explicit decision (`relinkProject`) — two unrelated
 * folders with the same name are two projects, and nothing here guesses which
 * one somebody meant.
 */
export function ensureProject(
  index: WorkspaceIndex,
  path: string,
): { index: WorkspaceIndex; project: ProjectRecord; made: boolean } {
  const here = canonical(path);
  const existing = projectAtPath(index, here);
  if (existing !== null) return { index, project: existing, made: false };
  const project: ProjectRecord = {
    projectId: randomUUID(),
    root: here,
    aliases: [],
    workspaces: [],
  };
  return {
    index: {
      ...index,
      projects: { ...index.projects, [project.projectId]: project },
      byRoot: { ...index.byRoot, [here]: project.projectId },
    },
    project,
    made: true,
  };
}

/**
 * The same project, now living somewhere else.
 *
 * Moving a folder is something a person does and something the app is told
 * about, never something inferred: this is the one operation that keeps the
 * project id, and therefore every conversation attached to it, while the path
 * changes. The old path stays as an alias so history recorded there still finds
 * this project.
 */
export function relinkProject(
  index: WorkspaceIndex,
  projectId: string,
  path: string,
): WorkspaceIndex {
  const project = index.projects[projectId];
  if (project === undefined) throw new Error('no such project');
  const here = canonical(path);
  const moved: ProjectRecord = {
    ...project,
    root: here,
    aliases: [...new Set([...project.aliases, project.root, ...Object.keys(index.byRoot).filter((root) => index.byRoot[root] === projectId)])].filter(
      (one) => one !== here,
    ),
  };
  return {
    ...index,
    projects: { ...index.projects, [projectId]: moved },
    byRoot: { ...index.byRoot, [here]: projectId },
  };
}

/* -------------------------------------------------------------------------- */
/* Workspaces                                                                  */
/* -------------------------------------------------------------------------- */

/** The workspace for a folder, if this project already knows it. A symlink to a
 *  workspace's folder resolves to the same record. */
export function workspaceAtPath(
  index: WorkspaceIndex,
  projectId: string,
  path: string,
): WorkspaceRecord | null {
  const here = canonical(path);
  for (const id of index.projects[projectId]?.workspaces ?? []) {
    const record = index.workspaces[id];
    if (record !== undefined && record.cwd === here && record.state !== 'deleted') return record;
  }
  return null;
}

export function workspaceById(index: WorkspaceIndex, id: string): WorkspaceRecord | null {
  const record = index.workspaces[id];
  return record === undefined || record.state === 'deleted' ? null : record;
}

export type NewWorkspace = {
  projectId: string;
  path: string;
  displayPath?: string;
  kind: WorkspaceKind;
  managed: boolean;
  repoKey?: string | null;
  baseSha?: string | null;
  branch?: string | null;
  createdBy?: string | null;
  state?: WorkspaceState;
  now: number;
};

/**
 * Write a workspace down. Returns the existing record when this folder is
 * already one, so a retry after a crash cannot make two.
 */
export function addWorkspace(
  index: WorkspaceIndex,
  wanted: NewWorkspace,
): { index: WorkspaceIndex; workspace: WorkspaceRecord; made: boolean } {
  const project = index.projects[wanted.projectId];
  if (project === undefined) throw new Error('no such project');
  const known = workspaceAtPath(index, wanted.projectId, wanted.path);
  if (known !== null) return { index, workspace: known, made: false };

  const cwd = canonical(wanted.path);
  const record: WorkspaceRecord = {
    workspaceId: randomUUID(),
    projectId: wanted.projectId,
    kind: wanted.kind,
    cwd,
    displayPath: wanted.displayPath ?? cwd,
    repoKey: wanted.repoKey ?? null,
    managed: wanted.managed,
    baseSha: wanted.baseSha ?? null,
    branch: wanted.branch ?? null,
    detachedAt: null,
    state: wanted.state ?? 'ready',
    createdBy: wanted.createdBy ?? null,
    createdAt: wanted.now,
    verifiedAt: wanted.now,
  };
  return {
    index: {
      ...index,
      projects: {
        ...index.projects,
        [wanted.projectId]: { ...project, workspaces: [...project.workspaces, record.workspaceId] },
      },
      workspaces: { ...index.workspaces, [record.workspaceId]: record },
    },
    workspace: record,
    made: true,
  };
}

/** What looking at the folder on disk found. */
export type WorkspaceFacts = {
  /** The folder is there. */
  present: boolean;
  /** It is a checkout of the repository it claims. */
  repository: boolean;
  /** Its branch, or null when detached or unknown. */
  branch: string | null;
  /** Its commit when it is detached; null when it is on a branch. */
  detachedAt?: string | null;
  /** Git still registers it as a worktree of that repository. */
  registered?: boolean;
};

/**
 * The state a workspace is in, given what was actually found.
 *
 * A workspace whose folder is gone is `missing`, not `ready`: the difference is
 * the difference between an agent editing the project and an agent editing
 * nothing. A folder that is there but is not the repository it was, or is not a
 * registered worktree any more, is `recovery-required` rather than usable.
 */
export function verifyWorkspace(
  record: WorkspaceRecord,
  facts: WorkspaceFacts,
  now: number,
): WorkspaceRecord {
  const verifiedAt = now;
  if (!facts.present) return { ...record, state: 'missing', verifiedAt };
  if (record.kind === 'worktree' && (facts.repository !== true || facts.registered === false)) {
    return { ...record, state: 'recovery-required', verifiedAt };
  }
  if (record.kind === 'local' && facts.repository !== true && record.repoKey !== null) {
    return { ...record, state: 'recovery-required', verifiedAt };
  }
  const detached = facts.branch === null;
  return {
    ...record,
    state: 'ready',
    branch: facts.branch,
    detachedAt: detached ? (facts.detachedAt ?? record.detachedAt) : null,
    verifiedAt,
  };
}

/** Written down as gone. The record stays, so a conversation pointing at it
 *  still knows which workspace it meant. */
export function markDeleted(index: WorkspaceIndex, workspaceId: string): WorkspaceIndex {
  const record = index.workspaces[workspaceId];
  if (record === undefined) return index;
  return {
    ...index,
    workspaces: { ...index.workspaces, [workspaceId]: { ...record, state: 'deleted' } },
  };
}

/* -------------------------------------------------------------------------- */
/* Conversations                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Which workspace a conversation works in.
 *
 * Null is a real answer and the caller must treat it as one: a conversation
 * whose workspace cannot be established does not get to fall back to whichever
 * folder is in front.
 */
export function workspaceForConversation(
  index: WorkspaceIndex,
  conversationId: string,
): WorkspaceRecord | null {
  const id = index.conversations[conversationId];
  return id === undefined ? null : workspaceById(index, id);
}

export function attachConversation(
  index: WorkspaceIndex,
  conversationId: string,
  workspaceId: string,
): WorkspaceIndex {
  if (index.workspaces[workspaceId] === undefined) throw new Error('no such workspace');
  const was = index.conversations[conversationId];
  if (was === workspaceId) return index;
  return { ...index, conversations: { ...index.conversations, [conversationId]: workspaceId } };
}

/** Conversations filed under a workspace, for the "what would I lose" question
 *  a deletion has to answer before it deletes. */
export function conversationsIn(index: WorkspaceIndex, workspaceId: string): readonly string[] {
  return Object.entries(index.conversations)
    .filter(([, id]) => id === workspaceId)
    .map(([conversation]) => conversation)
    .sort();
}

/* -------------------------------------------------------------------------- */
/* Reading a stored index defensively                                          */
/* -------------------------------------------------------------------------- */

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/** Every state a stored index may carry. Anything else is treated as needing
 *  recovery rather than as usable. */
const KNOWN_STATES: Readonly<Record<WorkspaceState, true>> = {
  creating: true,
  ready: true,
  missing: true,
  'recovery-required': true,
  deleting: true,
  deleted: true,
};

function readWorkspace(value: unknown): WorkspaceRecord | null {
  const one = asRecord(value);
  const workspaceId = text(one['workspaceId']);
  const projectId = text(one['projectId']);
  const cwd = text(one['cwd']);
  if (workspaceId === null || projectId === null || cwd === null) return null;
  const kind = one['kind'] === 'worktree' ? 'worktree' : 'local';
  const held = one['state'] as WorkspaceState;
  return {
    workspaceId,
    projectId,
    kind,
    cwd,
    displayPath: text(one['displayPath']) ?? cwd,
    repoKey: text(one['repoKey']),
    managed: one['managed'] === true,
    baseSha: text(one['baseSha']),
    branch: text(one['branch']),
    detachedAt: text(one['detachedAt']),
    state: KNOWN_STATES[held] === true ? held : 'recovery-required',
    createdBy: text(one['createdBy']),
    createdAt: typeof one['createdAt'] === 'number' ? one['createdAt'] : 0,
    verifiedAt: typeof one['verifiedAt'] === 'number' ? one['verifiedAt'] : null,
  };
}

function readProject(value: unknown): ProjectRecord | null {
  const one = asRecord(value);
  const projectId = text(one['projectId']);
  const root = text(one['root']);
  if (projectId === null || root === null) return null;
  const named = (part: unknown): part is string => typeof part === 'string' && part !== '';
  const aliases = Array.isArray(one['aliases']) ? one['aliases'].filter(named) : [];
  const workspaces = Array.isArray(one['workspaces']) ? one['workspaces'].filter(named) : [];
  return { projectId, root, aliases, workspaces };
}
