/** Bringing the checkouts an older profile wrote into the workspace registry.
 *
 * Discovery reads the legacy indexes and decides, row by row, whether the folder
 * a chat was filed under is still the folder it was. Commit writes those
 * decisions down. Both work over plain data: the only filesystem this module can
 * reach is the probe the caller injects, and nothing here renames, moves or
 * deletes a legacy folder or file. A row that cannot be placed is returned to
 * the caller, never dropped.
 *
 * The caller owns the disk: the lock, the backup copy, writing the index, and
 * writing the marker afterwards. This owns the decisions and their order.
 */

import { createHash } from 'node:crypto';
import { isAbsolute, sep } from 'node:path';

import { checkoutRow, type Checkout } from '../../src/history/checkouts';
import {
  addWorkspace,
  attachConversation,
  canonical,
  ensureProject,
  verifyWorkspace,
  workspaceById,
  type WorkspaceFacts,
  type WorkspaceIndex,
  type WorkspaceKind,
  type WorkspaceRecord,
  type ConversationRecord,
  type WorkspaceState,
} from './workspace-registry';

/** Bumped when a manifest or marker written by an older version must not be
 *  read as this one. */
export const MIGRATION_VERSION = 1;

/** What the caller writes after the index, and checks before the next run. */
export const MARKER_FILE = 'workspace-migration.json';
/** Held for the length of a run, so two windows cannot migrate at once. */
export const LOCK_FILE = 'workspace-migration.lock';

/** Records the migration made, so a later verification knows what it may revise. */
const MIGRATED_BY = 'migration.3.5';

/* -------------------------------------------------------------------------- */
/* Discovery                                                                   */
/* -------------------------------------------------------------------------- */

/** What looking at the recorded folder found. The verdict is about the folder
 *  and the branch, never about whether somebody's work was any good. */
export type Verdict =
  /** Folder there, and it is this project's own managed folder. */
  | 'verified'
  /** Folder gone, branch recorded: the work survives, the copy does not. */
  | 'missing'
  /** Neither folder nor branch: nothing to point at. */
  | 'gone'
  /** Folder there but not under this project's managed root, so adopting it
   *  would be handing a conversation somebody else's files. */
  | 'foreign';

/** Why the verdict came out that way, for a person to read and act on. */
export type VerdictReason =
  | 'project-root'
  | 'folder-and-branch'
  | 'branch-survives'
  | 'folder-and-branch-gone'
  | 'outside-managed-root'
  | 'shared-managed-root';

/** A conversation as its session header remembers it, before any checkout row. */
export type LegacyChat = {
  conversationId: string;
  /** Where its own files were, when the header records one. */
  folder?: string | null;
  branch?: string | null;
  /** The revision the header records, when it records one. */
  sha?: string | null;
};

/** One remembered project, with the legacy files that describe it. */
export type LegacyProject = {
  path: string;
  /** The legacy per-project checkout index: where it is and what it held. */
  checkoutFile?: string;
  checkouts?: unknown;
  /** The conversations this project's session headers remember. */
  chats?: readonly LegacyChat[];
  /** The folder legacy code spread this project's copies into. Absent means the
   *  caller does not know it, which is not the same as "the project root". */
  managedRoot?: string | null;
};

export type DiscoverInputs = {
  projects: readonly LegacyProject[];
  /** The remembered-project file, for the backup list. */
  recentsFile?: string;
  /** Is this folder there? Read-only, and the only thing discovery asks a disk. */
  exists: (path: string) => boolean;
};

/** One source record, resolved. */
export type ManifestRecord = {
  /** The project it belongs to, canonical. */
  projectPath: string;
  /** The id this project will get. A prediction: commit adopts it when it made
   *  the project itself, and keeps the existing id when the app already had one. */
  projectId: string;
  /** The id this workspace will get. Null only for an isolated row with neither
   *  folder nor branch, which becomes unlinked rather than an empty workspace. */
  workspaceId: string | null;
  conversationId: string;
  kind: WorkspaceKind;
  /** The folder as it was recorded, not as this run resolves it. */
  folder: string;
  branch: string | null;
  sha: string | null;
  verdict: Verdict;
  reason: VerdictReason;
  /** The legacy file this row was read from, when it came from one. */
  source: string | null;
  /** The legacy row recorded its copy as put away. Kept for recovery. */
  away: boolean;
};

/** A row that could not be read, kept with where it came from and why. */
export type Quarantined = {
  projectPath: string;
  source: string | null;
  address: string;
  problem: string;
};

/** A file to copy aside before the new index is written over anything. */
export type Backup = { path: string; backup: string };

/** Two projects whose legacy copies shared one folder. No row there can be
 *  attributed to either, so none of them is adopted. */
export type RootCollision = { root: string; projects: readonly string[] };

export type ProjectPlan = { path: string; projectId: string; managedRoot: string | null };

export type Manifest = {
  version: 1;
  projects: readonly ProjectPlan[];
  records: readonly ManifestRecord[];
  quarantined: readonly Quarantined[];
  collisions: readonly RootCollision[];
  /** Every legacy file this manifest was read from. */
  sources: readonly string[];
};

type Held = { folder: string | null; branch: string | null; sha: string | null; source: string | null; away: boolean };

function digest(...parts: readonly string[]): string {
  return createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 32);
}

/** Every row in one legacy checkout index, with the unreadable ones kept aside.
 *  One bad row costs its own row and nothing else. */
function rowsOf(
  parsed: unknown,
  projectPath: string,
  source: string | null,
  quarantine: Quarantined[],
): Map<string, Checkout> {
  const found = new Map<string, Checkout>();
  if (parsed === null || parsed === undefined) return found;
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    quarantine.push({ projectPath, source, address: '', problem: 'not a row map' });
    return found;
  }
  for (const [address, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (address.trim() === '') {
      quarantine.push({ projectPath, source, address, problem: 'empty address' });
      continue;
    }
    const row = checkoutRow(value);
    if (row === null) {
      quarantine.push({ projectPath, source, address, problem: 'not a folder and branch row' });
      continue;
    }
    if (!isAbsolute(row.folder)) {
      quarantine.push({ projectPath, source, address, problem: 'folder is not absolute' });
      continue;
    }
    found.set(address, row);
  }
  return found;
}

/** Which projects share one legacy copies folder. The sanitized leaf paths an
 *  older version used can collide, and a row under a shared root belongs to
 *  whichever project asks first, which is not an answer. */
function collisionsAmong(plans: readonly ProjectPlan[]): RootCollision[] {
  const byRoot = new Map<string, string[]>();
  for (const plan of plans) {
    if (plan.managedRoot === null) continue;
    const held = byRoot.get(plan.managedRoot) ?? [];
    held.push(plan.path);
    byRoot.set(plan.managedRoot, held);
  }
  return [...byRoot.entries()]
    .filter(([, paths]) => paths.length > 1)
    .map(([root, paths]) => ({ root, projects: [...paths].sort() }))
    .sort((a, b) => (a.root < b.root ? -1 : 1));
}

/** The manifest: every source record with the id it will get and what this run
 *  made of its folder. Read-only. */
export function discover(inputs: DiscoverInputs): Manifest {
  const plans: ProjectPlan[] = [];
  const planned = new Map<string, ProjectPlan>();
  const collected: { plan: ProjectPlan; held: Map<string, Held> }[] = [];
  const quarantined: Quarantined[] = [];
  const sources: string[] = inputs.recentsFile === undefined ? [] : [inputs.recentsFile];

  for (const project of inputs.projects) {
    const path = canonical(project.path);
    let plan = planned.get(path);
    if (plan === undefined) {
      plan = {
        path,
        projectId: `p-${digest(path)}`,
        managedRoot: project.managedRoot === undefined || project.managedRoot === null
          ? null
          : canonical(project.managedRoot),
      };
      planned.set(path, plan);
      plans.push(plan);
    }
    if (project.checkoutFile !== undefined && !sources.includes(project.checkoutFile)) {
      sources.push(project.checkoutFile);
    }
    // A path remembered twice is one project; its rows merge rather than racing.
    let entry = collected.find((one) => one.plan.path === path);
    if (entry === undefined) {
      entry = { plan, held: new Map<string, Held>() };
      collected.push(entry);
    }
    const held = entry.held;
    for (const chat of project.chats ?? []) {
      if (chat.conversationId.trim() === '' || held.has(chat.conversationId)) continue;
      held.set(chat.conversationId, {
        folder: chat.folder ?? null,
        branch: chat.branch ?? null,
        sha: chat.sha ?? null,
        source: null,
        away: false,
      });
    }
    // The checkout index is the ownership record: where a header and a row
    // disagree about the folder, the row is what the conversation was working in.
    for (const [address, row] of rowsOf(project.checkouts, path, project.checkoutFile ?? null, quarantined)) {
      held.set(address, {
        folder: row.folder,
        branch: row.branch,
        sha: null,
        source: project.checkoutFile ?? null,
        away: row.away === true,
      });
    }
  }

  const collisions = collisionsAmong(plans);
  const shared = new Set(collisions.map((one) => one.root));
  const records: ManifestRecord[] = [];

  for (const { plan, held } of collected) {
    for (const [conversationId, row] of held) {
      const folder = row.folder ?? plan.path;
      const here = canonical(folder);
      const isRoot = here === plan.path;
      const present = inputs.exists(folder);
      const managedRoot = plan.managedRoot;
      // Under the root means the root itself or something inside it. The
      // separator matters: `.../one` is not inside `.../onetree`.
      const underRoot = managedRoot !== null
        && (here === managedRoot || here.startsWith(managedRoot.endsWith(sep) ? managedRoot : `${managedRoot}${sep}`));
      let verdict: Verdict;
      let reason: VerdictReason;
      if (isRoot) {
        verdict = present ? 'verified' : 'missing';
        reason = 'project-root';
      } else if (!present) {
        // The copy is gone. A branch is something to spread out again; a folder
        // that left neither behind has nothing to point at.
        verdict = row.branch === null ? 'gone' : 'missing';
        reason = row.branch === null ? 'folder-and-branch-gone' : 'branch-survives';
      } else if (underRoot && managedRoot !== null && !shared.has(managedRoot)) {
        verdict = 'verified';
        reason = 'folder-and-branch';
      } else {
        verdict = 'foreign';
        reason = underRoot ? 'shared-managed-root' : 'outside-managed-root';
      }
      const kind: WorkspaceKind = isRoot ? 'local' : 'worktree';
      // Nothing left to point at: the row is reported rather than given an
      // empty workspace to sit in.
      const pointsAtFolder = verdict !== 'gone' || isRoot;
      records.push({
        projectPath: plan.path,
        projectId: plan.projectId,
        workspaceId: pointsAtFolder ? `w-${digest(plan.projectId, here)}` : null,
        conversationId,
        kind,
        folder,
        branch: row.branch,
        sha: row.sha,
        verdict,
        reason,
        source: row.source,
        away: row.away,
      });
    }
  }

  return { version: MIGRATION_VERSION, projects: plans, records, quarantined, collisions, sources };
}

/* -------------------------------------------------------------------------- */
/* Commit                                                                      */
/* -------------------------------------------------------------------------- */

/** What the world looks like, asked only through here. */
export type MigrationProbe = {
  exists(path: string): Promise<boolean>;
  isRepo(path: string): Promise<boolean>;
  branchOf(path: string): Promise<string | null>;
  /** The folders a repository has checked out. Empty means git could not answer,
   *  which proves nothing and so downgrades nothing. */
  worktreeList(repo: string): Promise<readonly string[]>;
};

/** A durable step, in the order the run takes them. */
export type MigrationStep =
  | { what: 'project'; projectId: string; path: string }
  | { what: 'workspace'; workspaceId: string; state: WorkspaceState }
  | { what: 'conversation'; conversationId: string; workspaceId: string };

export type CommitDeps = {
  /** The registry as read back, including whatever an interrupted run wrote. */
  index: WorkspaceIndex;
  probe: MigrationProbe;
  now: number;
  /** Where the new index will be written, so it is on the backup list. */
  indexFile?: string;
  /** Told after each durable step. A caller that writes here can resume; one
   *  that does not gets the whole index at the end and nothing before it. */
  persist?: (index: WorkspaceIndex, step: MigrationStep) => void | Promise<void>;
};

export type UnlinkedWhy =
  /** No folder and no branch, so there is nowhere to say this chat works. */
  | 'nothing-left'
  /** The legacy row could not be read. */
  | 'corrupt-row'
  /** Another workspace, or an earlier row, holds this conversation. */
  | 'claimed-elsewhere'
  /** This run could not establish a workspace for the row. */
  | 'not-recorded';

export type Unlinked = {
  projectPath: string;
  conversationId: string;
  folder: string | null;
  branch: string | null;
  why: UnlinkedWhy;
};

/** Written after the index. What a later run reads to know this one finished. */
export type MigrationMarker = {
  version: 1;
  completedAt: number;
  /** Source rows accounted for, records and quarantined together. */
  sources: number;
  verdicts: Readonly<Record<Verdict, number>>;
  /** Workspaces this run established, by id. */
  workspaces: readonly string[];
  /** Conversations this run attached to one of them. */
  conversations: readonly string[];
  /** Rows it could not link, by conversation: see `Unlinked` for why. A
   *  conversation here is usually one a live record already holds. */
  unlinked: readonly string[];
  quarantined: readonly string[];
};

export type MigrationResult = {
  index: WorkspaceIndex;
  marker: MigrationMarker;
  unlinked: readonly Unlinked[];
  quarantined: readonly Quarantined[];
  /** Copy these before writing anything over them. */
  backups: readonly Backup[];
  collisions: readonly RootCollision[];
};

/** A stored marker, or null when there is nothing this version may trust.
 *
 * Null is the safe answer: an unreadable file, a file an older version wrote and
 * a file this version wrote are three different things, and only the last one
 * means the migration has happened. Reading it is how the caller decides whether
 * to run at all. */
export function readMarker(text: string): MigrationMarker | null {
  let held: unknown;
  try {
    held = JSON.parse(text);
  } catch {
    return null;
  }
  if (held === null || typeof held !== 'object' || Array.isArray(held)) return null;
  const one = held as Record<string, unknown>;
  if (one['version'] !== MIGRATION_VERSION) return null;
  const completedAt = one['completedAt'];
  if (typeof completedAt !== 'number' || !Number.isFinite(completedAt)) return null;
  const counts = one['verdicts'];
  if (counts === null || typeof counts !== 'object' || Array.isArray(counts)) return null;
  const verdicts = counts as Record<string, unknown>;
  const named = (value: unknown): readonly string[] =>
    Array.isArray(value) ? value.filter((one): one is string => typeof one === 'string') : [];
  return {
    version: MIGRATION_VERSION,
    completedAt,
    sources: typeof one['sources'] === 'number' ? one['sources'] : 0,
    verdicts: {
      verified: typeof verdicts['verified'] === 'number' ? verdicts['verified'] : 0,
      missing: typeof verdicts['missing'] === 'number' ? verdicts['missing'] : 0,
      gone: typeof verdicts['gone'] === 'number' ? verdicts['gone'] : 0,
      foreign: typeof verdicts['foreign'] === 'number' ? verdicts['foreign'] : 0,
    },
    workspaces: named(one['workspaces']),
    conversations: named(one['conversations']),
    unlinked: named(one['unlinked']),
    quarantined: named(one['quarantined']),
  };
}

/** Asking twice about one folder is one question. */
function cachedProbe(probe: MigrationProbe): MigrationProbe {
  const once = <T>(held: Map<string, Promise<T>>, key: string, ask: () => Promise<T>): Promise<T> => {
    const already = held.get(key);
    if (already !== undefined) return already;
    const started = ask();
    held.set(key, started);
    return started;
  };
  const paths = new Map<string, Promise<boolean>>();
  const repos = new Map<string, Promise<boolean>>();
  const branches = new Map<string, Promise<string | null>>();
  const trees = new Map<string, Promise<readonly string[]>>();
  return {
    exists: (path) => once(paths, path, () => probe.exists(path)),
    isRepo: (path) => once(repos, path, () => probe.isRepo(path)),
    branchOf: (path) => once(branches, path, () => probe.branchOf(path)),
    worktreeList: (repo) => once(trees, repo, () => probe.worktreeList(repo)),
  };
}

/** A freshly made project under the id the manifest planned. The plan is what a
 *  resumed run recognises, so it only changes an id nothing else uses. */
function adoptProjectId(
  index: WorkspaceIndex,
  from: string,
  to: string,
): { index: WorkspaceIndex; id: string } {
  const project = index.projects[from];
  if (from === to || project === undefined || index.projects[to] !== undefined) {
    return { index, id: from };
  }
  const projects = { ...index.projects };
  delete projects[from];
  projects[to] = { ...project, projectId: to };
  const byRoot: Record<string, string> = {};
  for (const [root, id] of Object.entries(index.byRoot)) byRoot[root] = id === from ? to : id;
  const workspaces: Record<string, WorkspaceRecord> = {};
  for (const [id, record] of Object.entries(index.workspaces)) {
    workspaces[id] = record.projectId === from ? { ...record, projectId: to } : record;
  }
  return { index: { ...index, projects, byRoot, workspaces }, id: to };
}

/** The same for a workspace. Only ever called for one this run just made. */
function adoptWorkspaceId(
  index: WorkspaceIndex,
  from: string,
  to: string,
): { index: WorkspaceIndex; id: string } {
  const record = index.workspaces[from];
  if (from === to || record === undefined || index.workspaces[to] !== undefined) {
    return { index, id: from };
  }
  const workspaces = { ...index.workspaces };
  delete workspaces[from];
  workspaces[to] = { ...record, workspaceId: to };
  const projects = { ...index.projects };
  const project = projects[record.projectId];
  if (project !== undefined) {
    projects[record.projectId] = {
      ...project,
      workspaces: project.workspaces.map((id) => (id === from ? to : id)),
    };
  }
  const conversations: Record<string, ConversationRecord> = {};
  for (const [id, record] of Object.entries(index.conversations)) {
    conversations[id] = record.workspaceId === from ? { ...record, workspaceId: to } : record;
  }
  return { index: { ...index, workspaces, projects, conversations }, id: to };
}

/** What the folder on disk actually is. A foreign row is not asked: it is
 *  recovery-required either way, and probing it would only confirm that. */
async function factsFor(
  folder: string,
  kind: WorkspaceKind,
  root: string,
  probe: MigrationProbe,
): Promise<WorkspaceFacts> {
  const present = await probe.exists(folder);
  if (!present) return { present: false, repository: false, branch: null };
  const repository = await probe.isRepo(folder);
  const branch = await probe.branchOf(folder);
  if (kind === 'local') return { present: true, repository, branch };
  const listed = await probe.worktreeList(root);
  const registered = listed.length === 0
    ? undefined
    : listed.some((one) => canonical(one) === canonical(folder));
  return { present: true, repository, branch, registered };
}

/** The state a verdict starts in. The probe may still downgrade a `verified`
 *  row to `missing` or `recovery-required`; nothing upgrades a foreign one. */
const STATE_FOR: Readonly<Record<Verdict, WorkspaceState>> = {
  verified: 'ready',
  missing: 'missing',
  gone: 'missing',
  foreign: 'recovery-required',
};

/** Where a conversation should end up, when several rows claim it. A folder
 *  that was found beats one that was not; the rest is order, not preference. */
const RANK: Readonly<Record<Verdict, number>> = { verified: 0, foreign: 1, missing: 2, gone: 3 };

/**
 * Write the manifest down.
 *
 * Every step is idempotent on its own: a project is found by path, a workspace by
 * folder, a conversation by id, so a run that stops after any of them can be
 * repeated over what it left and end in the same index. Nothing is renamed and
 * nothing is deleted.
 */
export async function commit(manifest: Manifest, deps: CommitDeps): Promise<MigrationResult> {
  const probe = cachedProbe(deps.probe);
  let index = deps.index;

  /* Projects first, because a workspace names one. */
  const effectiveProject = new Map<string, string>();
  for (const plan of manifest.projects) {
    const ensured = ensureProject(index, plan.path);
    index = ensured.index;
    let id = ensured.project.projectId;
    if (ensured.made) {
      const adopted = adoptProjectId(index, id, plan.projectId);
      index = adopted.index;
      id = adopted.id;
    }
    effectiveProject.set(plan.path, id);
    if (ensured.made) await deps.persist?.(index, { what: 'project', projectId: id, path: plan.path });
  }

  /* Workspaces. A row whose project is not in the manifest cannot be placed. */
  const planOf = new Map(manifest.projects.map((plan) => [plan.path, plan]));
  const workspaceAt = new Map<string, string>();
  const touched: string[] = [];
  for (const record of manifest.records) {
    if (record.workspaceId === null) continue;
    const projectId = effectiveProject.get(record.projectPath);
    const plan = planOf.get(record.projectPath);
    if (projectId === undefined || plan === undefined) continue;
    const folder = canonical(record.folder);
    const added = addWorkspace(index, {
      projectId,
      path: folder,
      displayPath: record.folder,
      kind: record.kind,
      /* Corrected below by what the folder turned out to be. */
      managed: record.kind === 'worktree' && record.verdict === 'verified',
      baseSha: record.sha,
      branch: record.branch,
      createdBy: MIGRATED_BY,
      state: STATE_FOR[record.verdict],
      now: deps.now,
    });
    index = added.index;
    let id = added.workspace.workspaceId;
    if (added.made) {
      // The planned id is keyed to the project id the manifest predicted; when
      // the app already had this project, the ids it already uses win.
      const planned = plan.projectId === projectId
        ? record.workspaceId
        : `w-${digest(projectId, folder)}`;
      const adopted = adoptWorkspaceId(index, id, planned);
      index = adopted.index;
      id = adopted.id;
    }
    workspaceAt.set(`${projectId}\u0000${folder}`, id);
    if (!touched.includes(id)) touched.push(id);

    const mine = index.workspaces[id];
    if (mine !== undefined && mine.createdBy === MIGRATED_BY && record.verdict !== 'foreign') {
      const facts = await factsFor(folder, record.kind, plan.path, probe);
      const verified = verifyWorkspace(mine, facts, deps.now);
      // Ours to clean up only when this run found it standing and it is a
      // worktree of this project: a folder that is gone, or that has been
      // replaced by something else, is not a folder we may delete.
      const ours = verified.state === 'ready' && record.kind === 'worktree';
      const settled = ours === mine.managed ? verified : { ...verified, managed: ours };
      if (
        settled.state !== mine.state
        || settled.branch !== mine.branch
        || settled.managed !== mine.managed
      ) {
        index = { ...index, workspaces: { ...index.workspaces, [id]: settled } };
      }
    }
    if (added.made) {
      await deps.persist?.(index, { what: 'workspace', workspaceId: id, state: index.workspaces[id]?.state ?? 'ready' });
    }
  }

  /* Conversations, one row per conversation: where several rows name the same
   * conversation, one of them is the better guess and the others are reported. */
  const claims = new Map<string, ManifestRecord[]>();
  for (const record of manifest.records) {
    const held = claims.get(record.conversationId) ?? [];
    held.push(record);
    claims.set(record.conversationId, held);
  }

  const unlinked: Unlinked[] = [];
  const attached: string[] = [];
  const lost = (record: ManifestRecord, why: UnlinkedWhy): void => {
    unlinked.push({
      projectPath: record.projectPath,
      conversationId: record.conversationId,
      folder: record.folder,
      branch: record.branch,
      why,
    });
  };

  for (const [conversationId, candidates] of claims) {
    const ranked = [...candidates].sort((a, b) => {
      const byVerdict = RANK[a.verdict] - RANK[b.verdict];
      if (byVerdict !== 0) return byVerdict;
      return a.folder < b.folder ? -1 : 1;
    });
    const best = ranked[0];
    // Every group was made by pushing, so there is always a first one.
    if (best === undefined) continue;
    // A row that lost is reported by what it had: one with nothing to point at
    // has nothing left, one with a folder lost a contest for the conversation.
    for (const other of ranked.slice(1)) {
      lost(other, other.workspaceId === null ? 'nothing-left' : 'claimed-elsewhere');
    }
    if (best.workspaceId === null) {
      lost(best, 'nothing-left');
      continue;
    }
    const projectId = effectiveProject.get(best.projectPath);
    const id = projectId === undefined
      ? undefined
      : workspaceAt.get(`${projectId}\u0000${canonical(best.folder)}`);
    if (id === undefined) {
      lost(best, 'not-recorded');
      continue;
    }
    const already = index.conversations[conversationId];
    if (already !== undefined) {
      const known = workspaceById(index, already.workspaceId);
      // Somebody already decided. A migration does not overrule a live record,
      // and it does not quietly move a conversation either.
      if (known === null || known.cwd !== canonical(best.folder)) {
        lost(best, 'claimed-elsewhere');
        continue;
      }
      if (!attached.includes(conversationId)) attached.push(conversationId);
      continue;
    }
    index = attachConversation(index, conversationId, id);
    attached.push(conversationId);
    await deps.persist?.(index, { what: 'conversation', conversationId, workspaceId: id });
  }

  for (const bad of manifest.quarantined) {
    if (bad.address === '' || claims.has(bad.address)) continue;
    unlinked.push({
      projectPath: bad.projectPath,
      conversationId: bad.address,
      folder: null,
      branch: null,
      why: 'corrupt-row',
    });
  }

  const verdicts: Record<Verdict, number> = { verified: 0, missing: 0, gone: 0, foreign: 0 };
  for (const record of manifest.records) verdicts[record.verdict] += 1;

  const files = [...manifest.sources, ...(deps.indexFile === undefined ? [] : [deps.indexFile])];
  const backups = files
    .filter((path, at) => files.indexOf(path) === at)
    .map((path) => ({ path, backup: `${path}.bak` }));

  const marker: MigrationMarker = {
    version: MIGRATION_VERSION,
    completedAt: deps.now,
    sources: manifest.records.length + manifest.quarantined.length,
    verdicts,
    workspaces: [...touched].sort(),
    conversations: [...attached].sort(),
    unlinked: [...new Set(unlinked.map((one) => one.conversationId))].sort(),
    quarantined: [...new Set(manifest.quarantined.map((one) => one.address))].sort(),
  };

  return {
    index,
    marker,
    unlinked,
    quarantined: manifest.quarantined,
    backups,
    collisions: manifest.collisions,
  };
}
