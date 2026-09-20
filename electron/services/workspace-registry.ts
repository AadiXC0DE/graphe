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

/**
 * A conversation, as the registry keeps it.
 *
 * Pi owns what was said; this owns the relationships and the facts a window
 * needs before anything has been said — which folder it is in, what it was
 * called, where it came from, and what somebody last chose for it. A draft with
 * no transcript yet is a real record here, not a null id: "new" is a thing that
 * exists from the moment somebody presses it.
 */
export type ConversationRecord = {
  conversationId: string;
  projectId: string;
  workspaceId: string;
  /** Pi's own id and file, once it has written one. */
  sessionId: string | null;
  sessionFile: string | null;
  title: string;
  createdAt: number;
  updatedAt: number;
  archived: boolean;
  /** Where this came from, when it was made by continuing or forking another
   *  conversation, or opened by a canvas lane. A link, never a copy of its
   *  history. */
  lineage: { from: string; kind: 'continue' | 'fork' | 'flow' } | null;
  /** The transcript branch somebody was last looking at. */
  branchLeaf: string | null;
  /** What this conversation chose for itself, over the global defaults. */
  overrides: {
    model: { providerId: string; modelId: string } | null;
    thinking: string | null;
    plan: boolean | null;
  };
  version: 1;
};

/**
 * A view: a tab or pane showing one conversation, remembered across a restart.
 *
 * A conversation is not a view. The same chat shown in two panes is one
 * conversation with two views, and closing one of them is not closing the chat
 * — so the view needs a record of its own, and the record has to be durable or
 * restarting the app silently rearranges somebody's window. `pane` is which of
 * the two the view sits in, because a view that came back in the other one
 * would be a different window.
 */
export type ViewRecord = {
  viewId: string;
  conversation: string;
  pane: 0 | 1;
};

export type WorkspaceIndex = {
  version: 2;
  projects: Readonly<Record<string, ProjectRecord>>;
  /** Canonical path to project id. Paths are how a person names a project;
   *  the id is what everything else is keyed by. */
  byRoot: Readonly<Record<string, string>>;
  workspaces: Readonly<Record<string, WorkspaceRecord>>;
  /** Conversation id to its record. The one line that answers "which files am
   *  I changing" without asking which tab is in front. */
  conversations: Readonly<Record<string, ConversationRecord>>;
  /** View id to the view. What the window was showing, in which pane. Empty on
   *  a profile written before views were recorded, which reads as an ordinary
   *  single-pane window rather than as an error. */
  views: Readonly<Record<string, ViewRecord>>;
};

export const INDEX_VERSION = 2;

/** The oldest index this build still reads. Version 1 had no views and filed a
 *  conversation's workspace link as a bare string; both are upgraded on read. */
export const FIRST_INDEX_VERSION = 1;

export function emptyIndex(): WorkspaceIndex {
  return {
    version: INDEX_VERSION,
    projects: {},
    byRoot: {},
    workspaces: {},
    conversations: {},
    views: {},
  };
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
 * worse. `verdictOn` says what the caller does with that: a damaged file is
 * kept aside, a file from a newer app is left alone.
 */
export type IndexReading = {
  index: WorkspaceIndex;
  /** Why it could not be read, when it could not. */
  problem: string | null;
  /**
   * True when the file is a profile written by a *newer* version of this app.
   *
   * That is not corruption and must not be treated as it: an older build that
   * meets a newer index has to refuse to write rather than move somebody's
   * record of where their work was out of the way and start empty. The caller
   * decides what to do, and the only safe answer is to leave the file alone.
   */
  future: boolean;
};

export function parseIndex(text: string): IndexReading {
  let held: unknown;
  try {
    held = JSON.parse(text);
  } catch (cause) {
    return { index: emptyIndex(), problem: `not JSON: ${String(cause)}`, future: false };
  }
  const one = held as { version?: unknown } | null;
  if (
    typeof one === 'object' &&
    one !== null &&
    typeof one.version === 'number' &&
    Number.isFinite(one.version) &&
    one.version > INDEX_VERSION
  ) {
    return {
      index: emptyIndex(),
      problem: `written by a newer version (index ${String(one.version)})`,
      future: true,
    };
  }
  /* Every version this app has written, read forward. An older one is not an
     error: it is a profile somebody has been using, and the only thing a bump
     may cost it is the fields that did not exist when it was written. */
  const written = one === null || typeof one !== 'object' ? null : one.version;
  if (
    typeof written !== 'number' ||
    !Number.isInteger(written) ||
    written < FIRST_INDEX_VERSION ||
    written > INDEX_VERSION
  ) {
    return { index: emptyIndex(), problem: `not a version ${String(INDEX_VERSION)} index`, future: false };
  }
  const asIndex = one as Partial<WorkspaceIndex>;
  // Field by field: a half-written index costs the rows it lost, not the ones
  // it kept. A record without an id or a folder is not a workspace.
  const workspaces: Record<string, WorkspaceRecord> = {};
  for (const [id, value] of Object.entries(asRecord(asIndex.workspaces))) {
    const record = readWorkspace(value);
    if (record !== null) workspaces[id] = record;
  }
  const projects: Record<string, ProjectRecord> = {};
  for (const [id, value] of Object.entries(asRecord(asIndex.projects))) {
    const record = readProject(value);
    if (record !== null) projects[id] = record;
  }
  const byRoot: Record<string, string> = {};
  for (const [root, id] of Object.entries(asRecord(asIndex.byRoot))) {
    if (typeof id === 'string' && projects[id] !== undefined) byRoot[root] = id;
  }
  const conversations: Record<string, ConversationRecord> = {};
  for (const [conversation, held] of Object.entries(asRecord(asIndex.conversations))) {
    // The first version of this index stored the workspace id alone. A profile
    // written by it opens with the same link and nothing else known.
    if (typeof held === 'string') {
      if (workspaces[held] !== undefined) {
        conversations[conversation] = {
          conversationId: conversation,
          projectId: workspaces[held]?.projectId ?? '',
          workspaceId: held,
          sessionId: null,
          sessionFile: null,
          title: '',
          createdAt: 0,
          updatedAt: 0,
          archived: false,
          lineage: null,
          branchLeaf: null,
          overrides: { model: null, thinking: null, plan: null },
          version: 1,
        };
      }
      continue;
    }
    const record = readConversation(conversation, held, workspaces);
    if (record !== null) conversations[conversation] = record;
  }
  const views: Record<string, ViewRecord> = {};
  for (const [viewId, held] of Object.entries(asRecord(asIndex.views))) {
    const view = readView(viewId, held, conversations);
    if (view !== null) views[viewId] = view;
  }
  return {
    index: { version: INDEX_VERSION, projects, byRoot, workspaces, conversations, views },
    problem: null,
    future: false,
  };
}

/** What a reader should do with what it found: use it, keep it out of the way,
 *  or leave it exactly where it is because an older app cannot judge it. */
export type IndexVerdict = 'use' | 'quarantine' | 'leave-alone';

export function verdictOn(read: IndexReading): IndexVerdict {
  if (read.problem === null) return 'use';
  return read.future ? 'leave-alone' : 'quarantine';
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
 *  workspace's folder resolves to the same record.
 *
 * `repoKey` is the repository that folder actually holds now, when the caller
 * has looked. Given one, a record that was written against a different
 * repository is not a match: the path is an attribute, and the same path
 * holding somebody else's repository is a different workspace, not this one. */
export function workspaceAtPath(
  index: WorkspaceIndex,
  projectId: string,
  path: string,
  repoKey?: string | null,
): WorkspaceRecord | null {
  const here = canonical(path);
  for (const id of index.projects[projectId]?.workspaces ?? []) {
    const record = index.workspaces[id];
    if (record === undefined || record.cwd !== here || record.state === 'deleted') continue;
    if (repoKey != null && record.repoKey !== null && record.repoKey !== repoKey) continue;
    return record;
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
  const known = workspaceAtPath(index, wanted.projectId, wanted.path, wanted.repoKey);
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
  /** The repository's own identity, read from the folder. Null for a folder
   *  that is not a repository, and absent when nobody looked. */
  repoKey?: string | null;
  /** Its branch, or null when detached or unknown. */
  branch: string | null;
  /** Its commit when it is detached; null when it is on a branch. */
  detachedAt?: string | null;
  /** Git still registers it as a worktree of that repository. */
  registered?: boolean;
};

/**
 * Where the repository's identity goes once somebody has read it.
 *
 * Written rather than derived on each use: reading it costs a git command, and
 * the answer is only interesting at the moments a workspace is made, reopened
 * or verified. A record without one cannot be matched against a folder that has
 * one, so leaving it null is a gap rather than a neutral value.
 */
export function setRepoKey(
  index: WorkspaceIndex,
  workspaceId: string,
  repoKey: string | null,
  now: number,
): WorkspaceIndex {
  const record = index.workspaces[workspaceId];
  if (record === undefined || record.repoKey === repoKey) return index;
  return {
    ...index,
    workspaces: {
      ...index.workspaces,
      [workspaceId]: { ...record, repoKey, verifiedAt: now },
    },
  };
}

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
  // A folder holding a different repository is not the workspace that was
  // written down, however much it looks like the same place.
  const held = facts.repository === true ? (facts.repoKey ?? record.repoKey) : null;
  const elsewhere = record.repoKey !== null && held !== null && held !== record.repoKey;
  if (elsewhere) return { ...record, state: 'recovery-required', verifiedAt };
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
    repoKey: held ?? record.repoKey,
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
  const record = recordFor(index, conversationId);
  return record === null ? null : workspaceById(index, record.workspaceId);
}

export function conversationById(
  index: WorkspaceIndex,
  conversationId: string,
): ConversationRecord | null {
  return index.conversations[conversationId] ?? conversationInFile(index, conversationId);
}

/**
 * The conversation written down against a Pi session file.
 *
 * A conversation's own id is minted, so the transcript it ends up in is an
 * attribute rather than its identity — and the two have to be joined the one
 * way round that works: by the file, because that is what a listing, a resume
 * and a checkout row all carry.
 */
export function conversationInFile(
  index: WorkspaceIndex,
  sessionFile: string,
): ConversationRecord | null {
  for (const one of Object.values(index.conversations)) {
    if (one.sessionFile !== null && one.sessionFile === sessionFile) return one;
  }
  return null;
}

/**
 * One conversation's record, by either name it can carry.
 *
 * Its own id is what everything new is written under. The file it is written
 * in is the other name, and it is not going away: a listing, a saved
 * conversation the window names, and every row on disk from before ids existed
 * all carry that. Resolving both in one place is what keeps one conversation
 * one row.
 */
function recordFor(index: WorkspaceIndex, asked: string): ConversationRecord | null {
  return index.conversations[asked] ?? conversationInFile(index, asked);
}

/** Every conversation of a project, archived ones included: hiding is the
 *  window's decision, not the store's. */
export function conversationsOfProject(
  index: WorkspaceIndex,
  projectId: string,
): readonly ConversationRecord[] {
  return Object.values(index.conversations)
    .filter((one) => one.projectId === projectId)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export type NewConversation = {
  conversationId: string;
  workspaceId: string;
  title?: string;
  lineage?: { from: string; kind: 'continue' | 'fork' | 'flow' } | null;
  now: number;
};

/**
 * Write a conversation down.
 *
 * Made before the first word, so the folder it will work in is answerable from
 * the moment it exists rather than from the moment Pi writes a transcript. An
 * id that is already known keeps everything it had: pressing New twice is two
 * conversations, but re-opening one is not a second record.
 */
export function addConversation(
  index: WorkspaceIndex,
  wanted: NewConversation,
): { index: WorkspaceIndex; conversation: ConversationRecord; made: boolean } {
  const workspace = index.workspaces[wanted.workspaceId];
  if (workspace === undefined) throw new Error('no such workspace');
  const known = index.conversations[wanted.conversationId];
  if (known !== undefined) return { index, conversation: known, made: false };
  const record: ConversationRecord = {
    conversationId: wanted.conversationId,
    projectId: workspace.projectId,
    workspaceId: wanted.workspaceId,
    sessionId: null,
    sessionFile: null,
    title: wanted.title ?? '',
    createdAt: wanted.now,
    updatedAt: wanted.now,
    archived: false,
    lineage: wanted.lineage ?? null,
    branchLeaf: null,
    overrides: { model: null, thinking: null, plan: null },
    version: 1,
  };
  return {
    index: { ...index, conversations: { ...index.conversations, [record.conversationId]: record } },
    conversation: record,
    made: true,
  };
}

export function attachConversation(
  index: WorkspaceIndex,
  conversationId: string,
  workspaceId: string,
): WorkspaceIndex {
  if (index.workspaces[workspaceId] === undefined) throw new Error('no such workspace');
  const known = recordFor(index, conversationId);
  const projectId = index.workspaces[workspaceId]?.projectId ?? '';
  if (known === undefined || known === null) {
    return {
      ...index,
      conversations: {
        ...index.conversations,
        [conversationId]: {
          conversationId,
          projectId,
          workspaceId,
          sessionId: null,
          sessionFile: null,
          title: '',
          createdAt: 0,
          updatedAt: 0,
          archived: false,
          lineage: null,
          branchLeaf: null,
          overrides: { model: null, thinking: null, plan: null },
          version: 1,
        },
      },
    };
  }
  if (known.workspaceId === workspaceId) return index;
  // Always written under the record's own id, however it was asked for: a file
  // name is a way of naming a conversation, never a second row for it.
  return {
    ...index,
    conversations: {
      ...index.conversations,
      [known.conversationId]: { ...known, workspaceId, projectId },
    },
  };
}

/** Change part of a conversation's record. Unknown ids are left alone: a
 *  conversation nobody wrote down is not one to invent. */
export function updateConversation(
  index: WorkspaceIndex,
  conversationId: string,
  change: Partial<Omit<ConversationRecord, 'conversationId' | 'version'>>,
): WorkspaceIndex {
  const known = recordFor(index, conversationId);
  if (known === null) return index;
  return {
    ...index,
    conversations: {
      ...index.conversations,
      [known.conversationId]: { ...known, ...change },
    },
  };
}

/** Conversations filed under a workspace, for the "what would I lose" question
 *  a deletion has to answer before it deletes. */
export function conversationsIn(index: WorkspaceIndex, workspaceId: string): readonly string[] {
  return Object.entries(index.conversations)
    .filter(([, one]) => one.workspaceId === workspaceId)
    .map(([conversation]) => conversation)
    .sort();
}

/* -------------------------------------------------------------------------- */
/* Views                                                                       */
/* -------------------------------------------------------------------------- */

/** What a pane is showing, or null when nothing is written down for it.
 *
 * Found by the pane's own number rather than by view id, because that is the
 * question a window asks at launch: "what was in the left one". `noteView`
 * keeps one view per pane; a hand-edited file that holds two gets the first one
 * written, since two views in one pane is not a window anybody can draw. */
export function viewInPane(index: WorkspaceIndex, pane: 0 | 1): ViewRecord | null {
  for (const view of Object.values(index.views)) {
    if (view.pane === pane) return view;
  }
  return null;
}

/** Whether a view belongs to the project that owns its conversation. Views are
 *  stored in one profile-wide index, but pane numbers are local to each open
 *  project window; callers must not let one project's panes replace another's.
 */
export function viewInProject(
  index: WorkspaceIndex,
  view: ViewRecord,
  projectId: string,
): boolean {
  return index.conversations[view.conversation]?.projectId === projectId;
}

/** The view in one pane of one project. */
export function viewInPaneForProject(
  index: WorkspaceIndex,
  pane: 0 | 1,
  projectId: string,
): ViewRecord | null {
  return Object.values(index.views).find(
    (view) => view.pane === pane && viewInProject(index, view, projectId),
  ) ?? null;
}

/**
 * Write down that a view is showing a conversation in a pane.
 *
 * The conversation has to be one this index knows: a view onto a chat nobody
 * has written down is a row the window cannot open, so it is refused rather
 * than stored and repaired later. Idempotent — a pane already showing this
 * conversation is left exactly as it was, view id and all, so re-opening the
 * same chat in the same pane does not mint a second view.
 */
export function noteView(
  index: WorkspaceIndex,
  wanted: { viewId: string; conversation: string; pane: 0 | 1 },
): { index: WorkspaceIndex; view: ViewRecord | null; made: boolean } {
  if (wanted.viewId === '' || wanted.conversation === '') return { index, view: null, made: false };
  if (index.conversations[wanted.conversation] === undefined) return { index, view: null, made: false };
  const known = index.views[wanted.viewId];
  if (
    known !== undefined &&
    known.conversation === wanted.conversation &&
    known.pane === wanted.pane
  ) {
    return { index, view: known, made: false };
  }
  // One view per pane: showing another chat in it moves the view rather than
  // adding a second, which is what makes the pair of them the window.
  const views: Record<string, ViewRecord> = {};
  for (const [id, view] of Object.entries(index.views)) {
    if (id !== wanted.viewId && view.pane !== wanted.pane) views[id] = view;
  }
  const view: ViewRecord = { ...wanted };
  views[wanted.viewId] = view;
  return { index: { ...index, views }, view, made: true };
}

/** Write a view without touching another project's panes. The profile index is
 *  shared by all projects, while pane 0/1 are window-local. A foreign view id
 *  is refused rather than overwritten, and a foreign conversation is never
 *  accepted from the wire. */
export function noteViewForProject(
  index: WorkspaceIndex,
  wanted: { viewId: string; conversation: string; pane: 0 | 1 },
  projectId: string,
): { index: WorkspaceIndex; view: ViewRecord | null; made: boolean } {
  if (!viewInProject(index, { ...wanted }, projectId)) {
    return { index, view: null, made: false };
  }
  const known = index.views[wanted.viewId];
  if (known !== undefined && !viewInProject(index, known, projectId)) {
    return { index, view: null, made: false };
  }
  if (
    known !== undefined &&
    known.conversation === wanted.conversation &&
    known.pane === wanted.pane
  ) {
    return { index, view: known, made: false };
  }
  const views: Record<string, ViewRecord> = {};
  for (const [id, view] of Object.entries(index.views)) {
    if (viewInProject(index, view, projectId) && (id === wanted.viewId || view.pane === wanted.pane)) {
      continue;
    }
    views[id] = view;
  }
  const view: ViewRecord = { ...wanted };
  views[wanted.viewId] = view;
  return { index: { ...index, views }, view, made: true };
}

/**
 * Take a view away, because the pane was closed.
 *
 * The conversation is untouched: closing a view is not closing the chat, and
 * what is left of a pair is the other one.
 */
export function dropView(index: WorkspaceIndex, viewId: string): WorkspaceIndex {
  if (index.views[viewId] === undefined) return index;
  const views = { ...index.views };
  delete views[viewId];
  return { ...index, views };
}

/**
 * Forget every view onto a conversation that is gone.
 *
 * Deleting a chat leaves nothing to open, so a view of it is a pane that fails
 * the moment somebody presses it. Called with the conversation, which is what
 * the caller has: the views are found rather than named.
 */
export function dropViewsOf(index: WorkspaceIndex, conversationId: string): WorkspaceIndex {
  const views: Record<string, ViewRecord> = {};
  let dropped = false;
  for (const [id, view] of Object.entries(index.views)) {
    if (view.conversation === conversationId) dropped = true;
    else views[id] = view;
  }
  return dropped ? { ...index, views } : index;
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

function readConversation(
  conversationId: string,
  value: unknown,
  workspaces: Readonly<Record<string, WorkspaceRecord>>,
): ConversationRecord | null {
  const one = asRecord(value);
  const workspaceId = text(one['workspaceId']);
  if (workspaceId === null || workspaces[workspaceId] === undefined) return null;
  const overrides = asRecord(one['overrides']);
  const model = asRecord(overrides['model']);
  const providerId = text(model['providerId']);
  const modelId = text(model['modelId']);
  const lineage = asRecord(one['lineage']);
  const from = text(lineage['from']);
  const kind =
    lineage['kind'] === 'fork'
      ? 'fork'
      : lineage['kind'] === 'continue'
        ? 'continue'
        : lineage['kind'] === 'flow'
          ? 'flow'
          : null;
  return {
    conversationId,
    projectId: text(one['projectId']) ?? workspaces[workspaceId]?.projectId ?? '',
    workspaceId,
    sessionId: text(one['sessionId']),
    sessionFile: text(one['sessionFile']),
    title: typeof one['title'] === 'string' ? one['title'] : '',
    createdAt: typeof one['createdAt'] === 'number' ? one['createdAt'] : 0,
    updatedAt: typeof one['updatedAt'] === 'number' ? one['updatedAt'] : 0,
    archived: one['archived'] === true,
    lineage: from !== null && kind !== null ? { from, kind } : null,
    branchLeaf: text(one['branchLeaf']),
    overrides: {
      model: providerId !== null && modelId !== null ? { providerId, modelId } : null,
      thinking: text(overrides['thinking']),
      plan: typeof overrides['plan'] === 'boolean' ? overrides['plan'] : null,
    },
    version: 1,
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

/** One stored view, or null when it is not one.
 *
 * A view onto a conversation that is not in this index is dropped rather than
 * kept: there would be nothing to open at launch, and a pane that fails on the
 * press is worse than a window that comes back single. */
function readView(
  viewId: string,
  value: unknown,
  conversations: Readonly<Record<string, ConversationRecord>>,
): ViewRecord | null {
  const one = asRecord(value);
  const conversation = text(one['conversation']);
  if (conversation === null || conversations[conversation] === undefined) return null;
  if (one['pane'] !== 0 && one['pane'] !== 1) return null;
  return { viewId, conversation, pane: one['pane'] };
}
