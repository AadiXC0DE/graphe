/** Migrating the checkouts an older profile wrote into the workspace registry.
 *
 * What these are about: no source record is lost, and running the migration
 * again changes nothing. Every case reads the registry it produced and the
 * lists it returned, never a private detail of the service.
 */

import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import {
  commit,
  discover,
  MIGRATION_VERSION,
  readMarker,
  type LegacyChat,
  type LegacyProject,
  type Manifest,
  type ManifestRecord,
  type MigrationProbe,
} from '../electron/services/migration-service';
import {
  addWorkspace,
  attachConversation,
  canonical,
  conversationsIn,
  emptyIndex,
  ensureProject,
  parseIndex,
  serializeIndex,
  workspaceForConversation,
  type WorkspaceIndex,
  type WorkspaceRecord,
} from '../electron/services/workspace-registry';

const made: string[] = [];

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'graphe-migration-'));
  made.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

const NOW = 1_700_000_000_000;

/** A folder that is there, made if it is not. */
function folderOf(...parts: readonly string[]): string {
  const path = join(...parts);
  mkdirSync(path, { recursive: true });
  return path;
}

function isRepo(folder: string): void {
  mkdirSync(join(folder, '.git'), { recursive: true });
}

/** A probe over the folders this test really made, plus whatever branch and
 *  worktree answers the case is about. Branches are keyed the way the service
 *  asks about them: by the real path, symlinks followed. */
function probeOver(options: {
  branches?: Readonly<Record<string, string | null>>;
  worktrees?: readonly string[];
} = {}): MigrationProbe {
  const branches: Record<string, string | null> = {};
  for (const [path, branch] of Object.entries(options.branches ?? {})) branches[canonical(path)] = branch;
  return {
    exists: async (path) => existsSync(path),
    isRepo: async (path) => existsSync(join(path, '.git')),
    branchOf: async (path) => branches[path] ?? null,
    worktreeList: async () => options.worktrees ?? [],
  };
}

const present = (path: string): boolean => existsSync(path);

/** Every path under a folder, so a test can say the migration wrote nothing. */
function tree(folder: string): readonly string[] {
  const found: string[] = [];
  const walk = (path: string): void => {
    const entries = readdirSync(path, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const entry of entries) {
      const child = join(path, entry.name);
      found.push(`${entry.isDirectory() ? 'd' : 'f'} ${child.slice(folder.length)} ${String(statSync(child).size)}`);
      if (entry.isDirectory()) walk(child);
    }
  };
  walk(folder);
  return found;
}

/** The folders one fixture entry was built around. */
type Paths = {
  userData: string;
  root: string;
  managed: string;
  one: string;
  two: string;
  three: string;
  elsewhere: string;
};

type Shape = {
  rows: (at: Paths) => Readonly<Record<string, unknown>>;
  chats: (at: Paths) => readonly LegacyChat[];
  branches?: Readonly<Record<string, string | null>>;
};

/** Two isolated chats and one local chat, all where they were left. */
const CLEAN: Shape = {
  rows: (at) => ({
    'chat-two': { folder: at.two, branch: 'graphe/two' },
    'chat-one': { folder: at.one, branch: 'graphe/one' },
  }),
  chats: (at) => [
    { conversationId: 'chat-local' },
    { conversationId: 'chat-one', folder: at.one, branch: 'graphe/one' },
  ],
};

/** A profile with one project, its managed worktrees folder, and the legacy
 *  files that describe what it was holding. `three` is never made: a copy that
 *  was put away. */
function world(shape: Shape = CLEAN): {
  paths: Paths;
  project: LegacyProject;
  recentsFile: string;
  checkoutFile: string;
  probe: MigrationProbe;
} {
  const userData = scratch();
  const root = folderOf(userData, 'site');
  isRepo(root);
  const managed = join(userData, 'worktrees', '-Users-somebody-site');
  const one = folderOf(managed, 'one');
  const two = folderOf(managed, 'two');
  isRepo(one);
  isRepo(two);
  const elsewhere = folderOf(userData, 'elsewhere', 'copy');
  isRepo(elsewhere);
  const paths: Paths = { userData, root, managed, one, two, three: join(managed, 'three'), elsewhere };
  const recentsFile = join(userData, 'projects.json');
  const checkoutFile = join(userData, 'conversation-checkouts', 'deadbeef.json');
  return {
    paths,
    recentsFile,
    checkoutFile,
    project: {
      path: root,
      checkoutFile,
      checkouts: shape.rows(paths),
      chats: shape.chats(paths),
      managedRoot: managed,
    },
    probe: probeOver({
      branches: { [one]: 'graphe/one-renamed', [two]: 'graphe/two', ...shape.branches },
      worktrees: [one, two],
    }),
  };
}

function recordFor(index: WorkspaceIndex, conversationId: string): WorkspaceRecord {
  const found = workspaceForConversation(index, conversationId);
  if (found === null) throw new Error(`no workspace recorded for ${conversationId}`);
  return found;
}

function rowOf(manifest: Manifest, conversationId: string): ManifestRecord {
  const found = manifest.records.find((one) => one.conversationId === conversationId);
  if (found === undefined) throw new Error(`no manifest row for ${conversationId}`);
  return found;
}

describe('a profile that was holding work', () => {
  it('keeps a local chat local, and keeps both isolated chats in their own folders', async () => {
    const w = world();
    const manifest = discover({ projects: [w.project], recentsFile: w.recentsFile, exists: present });
    expect(manifest.version).toBe(MIGRATION_VERSION);
    expect(manifest.records.map((one) => [one.conversationId, one.verdict, one.kind])).toEqual([
      ['chat-local', 'verified', 'local'],
      ['chat-one', 'verified', 'worktree'],
      ['chat-two', 'verified', 'worktree'],
    ]);

    const indexFile = join(w.paths.userData, 'workspaces.json');
    const result = await commit(manifest, { index: emptyIndex(), probe: w.probe, now: NOW, indexFile });

    const local = recordFor(result.index, 'chat-local');
    expect(local.kind).toBe('local');
    expect(local.cwd).toBe(canonical(w.paths.root));
    expect(local.managed).toBe(false);
    expect(local.state).toBe('ready');

    const one = recordFor(result.index, 'chat-one');
    expect(one.cwd).toBe(canonical(w.paths.one));
    expect(one.managed).toBe(true);
    expect(one.state).toBe('ready');
    // The folder is asked, not the metadata: the row said `graphe/one`.
    expect(one.branch).toBe('graphe/one-renamed');

    expect(recordFor(result.index, 'chat-two').cwd).toBe(canonical(w.paths.two));
    expect(result.unlinked).toEqual([]);
    expect(result.marker.verdicts).toEqual({ verified: 3, missing: 0, gone: 0, foreign: 0 });
    expect(result.marker.sources).toBe(3);
    expect(Object.values(result.index.projects)[0]?.workspaces).toHaveLength(3);
    expect(Object.keys(result.index.workspaces)).toHaveLength(3);
    // The ids the manifest planned are the ids it wrote.
    for (const record of manifest.records) {
      expect(record.workspaceId).toBe(recordFor(result.index, record.conversationId).workspaceId);
    }
    // Everything it read is on the backup list, including the file it replaces.
    expect(result.backups).toEqual([
      { path: w.recentsFile, backup: `${w.recentsFile}.bak` },
      { path: w.checkoutFile, backup: `${w.checkoutFile}.bak` },
      { path: indexFile, backup: `${indexFile}.bak` },
    ]);
  });

  it('records a folder that is gone with its branch, without reconstructing anything', async () => {
    const w = world({ rows: (at) => ({ 'chat-away': { folder: at.three, branch: 'graphe/away' } }), chats: () => [] });
    const manifest = discover({ projects: [w.project], exists: present });
    const row = rowOf(manifest, 'chat-away');
    expect([row.verdict, row.reason, row.kind]).toEqual(['missing', 'branch-survives', 'worktree']);
    expect(row.workspaceId).not.toBeNull();

    const result = await commit(manifest, { index: emptyIndex(), probe: w.probe, now: NOW });
    const away = recordFor(result.index, 'chat-away');
    expect(away.state).toBe('missing');
    expect(away.branch).toBe('graphe/away');
    expect(away.cwd).toBe(canonical(w.paths.three));
    // A folder that is not there is not ours to clean up: whatever might appear
    // at that path later was not put there by us.
    expect(away.managed).toBe(false);
    expect(result.marker.verdicts.missing).toBe(1);
    // Reconstruction is a later, explicit action: nothing was spread out again.
    expect(existsSync(w.paths.three)).toBe(false);
    expect(readdirSync(w.paths.managed).sort()).toEqual(['one', 'two']);
  });

  it('believes the folder, not the manifest, when the world moved on', async () => {
    const w = world({
      chats: () => [],
      rows: (at) => ({
        'chat-one': { folder: at.one, branch: 'graphe/one' },
        'chat-two': { folder: at.two, branch: 'graphe/two' },
      }),
    });
    const manifest = discover({ projects: [w.project], exists: present });
    expect(manifest.records.map((one) => one.verdict)).toEqual(['verified', 'verified']);
    // Between discovery and the run: one folder went, one stopped being a repo.
    rmSync(w.paths.one, { recursive: true, force: true });
    rmSync(join(w.paths.two, '.git'), { recursive: true, force: true });

    const result = await commit(manifest, { index: emptyIndex(), probe: w.probe, now: NOW });
    const gone = recordFor(result.index, 'chat-one');
    expect(gone.state).toBe('missing');
    expect(gone.managed).toBe(false);
    expect(gone.branch).toBe('graphe/one');

    const replaced = recordFor(result.index, 'chat-two');
    expect(replaced.state).toBe('recovery-required');
    expect(replaced.managed).toBe(false);
  });

  it('marks a folder outside the managed root as needing recovery, and never adopts it', async () => {
    const w = world({ chats: () => [], rows: (at) => ({ 'chat-elsewhere': { folder: at.elsewhere, branch: 'graphe/x' } }) });
    const manifest = discover({ projects: [w.project], exists: present });
    const row = rowOf(manifest, 'chat-elsewhere');
    expect([row.verdict, row.reason]).toEqual(['foreign', 'outside-managed-root']);

    const result = await commit(manifest, { index: emptyIndex(), probe: w.probe, now: NOW });
    const foreign = recordFor(result.index, 'chat-elsewhere');
    expect(foreign.state).toBe('recovery-required');
    expect(foreign.managed).toBe(false);
    // A folder that looks like a perfectly good checkout is still not ours.
    expect(foreign.cwd).toBe(canonical(w.paths.elsewhere));
    expect(existsSync(join(w.paths.elsewhere, '.git'))).toBe(true);
    expect(result.marker.verdicts.foreign).toBe(1);
  });

  it('adopts nothing when no managed root is known', async () => {
    const w = world({ chats: (at) => [{ conversationId: 'chat-free', folder: at.elsewhere, branch: 'graphe/free' }], rows: () => ({}) });
    const manifest = discover({
      projects: [{ path: w.paths.root, checkoutFile: w.checkoutFile, managedRoot: null, chats: w.project.chats }],
      exists: present,
    });
    expect(rowOf(manifest, 'chat-free').reason).toBe('outside-managed-root');

    const result = await commit(manifest, { index: emptyIndex(), probe: w.probe, now: NOW });
    const free = recordFor(result.index, 'chat-free');
    expect(free.state).toBe('recovery-required');
    expect(free.cwd).toBe(canonical(w.paths.elsewhere));
  });

  it('unlinks a chat with neither folder nor branch instead of inventing a workspace', async () => {
    // A header naming a folder that is gone is the shape that has no branch to
    // spread out again: a checkout row always carries one, a header need not.
    const w = world({ chats: (at) => [{ conversationId: 'chat-nothing', folder: at.three }], rows: () => ({}) });
    const manifest = discover({ projects: [w.project], exists: present });
    const row = rowOf(manifest, 'chat-nothing');
    expect([row.verdict, row.reason, row.workspaceId]).toEqual(['gone', 'folder-and-branch-gone', null]);

    const result = await commit(manifest, { index: emptyIndex(), probe: w.probe, now: NOW });
    // Nothing to point at, so nothing was invented: the project is there to
    // relink through, and the chat is on the list that says so.
    expect(Object.keys(result.index.workspaces)).toHaveLength(0);
    expect(Object.keys(result.index.projects)).toHaveLength(1);
    expect(result.unlinked).toEqual([
      {
        projectPath: canonical(w.paths.root),
        conversationId: 'chat-nothing',
        folder: w.paths.three,
        branch: null,
        why: 'nothing-left',
      },
    ]);
    expect(result.index.conversations['chat-nothing']).toBeUndefined();
    expect(result.marker.unlinked).toEqual(['chat-nothing']);
  });

  it('keeps one corrupt row to itself', async () => {
    const w = world({
      chats: () => [],
      rows: (at) => ({
        'chat-one': { folder: at.one, branch: 'graphe/one' },
        'chat-bad': 42,
        'chat-relative': { folder: 'copies/rel', branch: 'graphe/rel' },
        '': { folder: at.two, branch: 'graphe/two' },
        'chat-two': { folder: at.two, branch: 'graphe/two' },
      }),
    });
    const manifest = discover({ projects: [w.project], recentsFile: w.recentsFile, exists: present });
    expect(manifest.records.map((one) => one.conversationId)).toEqual(['chat-one', 'chat-two']);
    expect(manifest.quarantined.map((one) => [one.address, one.problem])).toEqual([
      ['chat-bad', 'not a folder and branch row'],
      ['chat-relative', 'folder is not absolute'],
      ['', 'empty address'],
    ]);
    expect(manifest.quarantined.every((one) => one.source === w.checkoutFile)).toBe(true);

    const result = await commit(manifest, { index: emptyIndex(), probe: w.probe, now: NOW });
    expect(Object.keys(result.index.workspaces)).toHaveLength(2);
    expect(result.quarantined).toHaveLength(3);
    // A quarantined row is reported by address rather than silently dropped.
    expect(result.unlinked).toEqual([
      { projectPath: canonical(w.paths.root), conversationId: 'chat-bad', folder: null, branch: null, why: 'corrupt-row' },
      {
        projectPath: canonical(w.paths.root),
        conversationId: 'chat-relative',
        folder: null,
        branch: null,
        why: 'corrupt-row',
      },
    ]);
  });
});

describe('two projects that look alike', () => {
  it('are two projects, and neither chat crosses over', async () => {
    const userData = scratch();
    const aRoot = folderOf(userData, 'work', 'site');
    const bRoot = folderOf(userData, 'archive', 'site');
    const aCopy = folderOf(userData, 'worktrees', 'a', 'copy');
    const bCopy = folderOf(userData, 'worktrees', 'b', 'copy');
    const projects: LegacyProject[] = [
      {
        path: aRoot,
        managedRoot: join(userData, 'worktrees', 'a'),
        chats: [{ conversationId: 'a-chat', folder: aCopy, branch: 'graphe/a' }],
      },
      {
        path: bRoot,
        managedRoot: join(userData, 'worktrees', 'b'),
        chats: [{ conversationId: 'b-chat', folder: bCopy, branch: 'graphe/b' }],
      },
    ];
    const manifest = discover({ projects, exists: present });
    expect(manifest.collisions).toEqual([]);

    const result = await commit(manifest, { index: emptyIndex(), probe: probeOver(), now: NOW });
    expect(Object.keys(result.index.projects)).toHaveLength(2);
    expect(Object.values(result.index.projects).map((one) => one.workspaces.length)).toEqual([1, 1]);
    const a = recordFor(result.index, 'a-chat');
    const b = recordFor(result.index, 'b-chat');
    expect(a.cwd).toBe(canonical(aCopy));
    expect(b.cwd).toBe(canonical(bCopy));
    expect(a.workspaceId).not.toBe(b.workspaceId);
    expect(a.projectId).not.toBe(b.projectId);
  });

  it('adopt nothing under one copies folder that two projects claim', async () => {
    const userData = scratch();
    const shared = folderOf(userData, 'worktrees', '-a-b-c');
    const copy = folderOf(shared, 'copy');
    const projects: LegacyProject[] = ['a/b-c', 'a/b/c'].map((leaf, at) => ({
      path: folderOf(userData, `repo-${String(at)}`, leaf),
      managedRoot: shared,
      chats: [{ conversationId: `chat-${String(at)}`, folder: copy, branch: `graphe/${String(at)}` }],
    }));
    const manifest = discover({ projects, exists: present });
    expect(manifest.collisions).toEqual([
      { root: canonical(shared), projects: manifest.projects.map((one) => one.path).sort() },
    ]);
    expect(manifest.records.map((one) => [one.verdict, one.reason])).toEqual([
      ['foreign', 'shared-managed-root'],
      ['foreign', 'shared-managed-root'],
    ]);

    const result = await commit(manifest, { index: emptyIndex(), probe: probeOver(), now: NOW });
    // One folder, two projects claiming it, and neither is believed: two records
    // that want a person, rather than one record that guessed.
    expect(Object.values(result.index.workspaces).map((one) => [one.cwd, one.state])).toEqual([
      [canonical(copy), 'recovery-required'],
      [canonical(copy), 'recovery-required'],
    ]);
    expect(readdirSync(shared)).toEqual(['copy']);
  });

  it('leaves a conversation alone that a live workspace already holds', async () => {
    const w = world({ chats: () => [], rows: (at) => ({ 'chat-one': { folder: at.one, branch: 'graphe/one' } }) });
    const manifest = discover({ projects: [w.project], exists: present });
    // What the app has already written for this conversation: the project folder.
    const madeProject = ensureProject(emptyIndex(), w.paths.root);
    const madeLocal = addWorkspace(madeProject.index, {
      projectId: madeProject.project.projectId,
      path: w.paths.root,
      kind: 'local',
      managed: false,
      now: NOW,
    });
    const live = attachConversation(madeLocal.index, 'chat-one', madeLocal.workspace.workspaceId);

    const result = await commit(manifest, { index: live, probe: w.probe, now: NOW });
    expect(recordFor(result.index, 'chat-one').cwd).toBe(canonical(w.paths.root));
    // The row is still written down: the folder it names is not lost, it just
    // does not get to claim a conversation the app has already placed.
    expect(Object.keys(result.index.workspaces)).toHaveLength(2);
    expect(Object.values(result.index.workspaces).map((one) => [one.cwd, one.state])).toEqual([
      [canonical(w.paths.root), 'ready'],
      [canonical(w.paths.one), 'ready'],
    ]);
    expect(result.unlinked).toEqual([
      {
        projectPath: canonical(w.paths.root),
        conversationId: 'chat-one',
        folder: w.paths.one,
        branch: 'graphe/one',
        why: 'claimed-elsewhere',
      },
    ]);
  });
});

describe('running it again', () => {
  it('changes nothing, and the same manifest always plans the same ids', async () => {
    const w = world();
    const manifest = discover({ projects: [w.project], recentsFile: w.recentsFile, exists: present });
    // Determinism in discovery is what makes the ids in the index stable.
    expect(discover({ projects: [w.project], recentsFile: w.recentsFile, exists: present })).toEqual(manifest);

    const first = await commit(manifest, { index: emptyIndex(), probe: w.probe, now: NOW });
    const fromNothing = await commit(manifest, { index: emptyIndex(), probe: w.probe, now: NOW });
    const again = await commit(manifest, { index: first.index, probe: w.probe, now: NOW });

    expect(fromNothing.index).toEqual(first.index);
    expect(again.index).toEqual(first.index);
    expect(again.marker).toEqual(first.marker);
    expect(again.unlinked).toEqual([]);
    const cwds = Object.values(again.index.workspaces).map((one) => one.cwd);
    expect(new Set(cwds).size).toBe(cwds.length);
    expect(Object.keys(again.index.conversations)).toHaveLength(3);
    expect(conversationsIn(again.index, recordFor(again.index, 'chat-one').workspaceId)).toEqual(['chat-one']);
  });

  it('resumes from whatever a crash left behind, after every durable step', async () => {
    const w = world({
      chats: () => [{ conversationId: 'chat-local' }],
      rows: (at) => ({
        'chat-one': { folder: at.one, branch: 'graphe/one' },
        'chat-two': { folder: at.two, branch: 'graphe/two' },
        'chat-away': { folder: at.three, branch: 'graphe/away' },
      }),
    });
    const manifest = discover({ projects: [w.project], exists: present });
    const clean = await commit(manifest, { index: emptyIndex(), probe: w.probe, now: NOW });
    expect(Object.keys(clean.index.workspaces)).toHaveLength(4);

    let steps = 0;
    await commit(manifest, {
      index: emptyIndex(),
      probe: w.probe,
      now: NOW,
      persist: () => {
        steps += 1;
      },
    });
    // Every source record gets at least one durable step of its own.
    expect(steps).toBeGreaterThanOrEqual(manifest.records.length);

    for (let until = 1; until <= steps; until += 1) {
      const left: WorkspaceIndex[] = [];
      await expect(
        commit(manifest, {
          index: emptyIndex(),
          probe: w.probe,
          now: NOW,
          persist: (index) => {
            left.push(index);
            if (left.length === until) throw new Error('crash');
          },
        }),
      ).rejects.toThrow('crash');

      const held = left[left.length - 1];
      if (held === undefined) throw new Error('nothing was written before the crash');
      const resumed = await commit(manifest, { index: held, probe: w.probe, now: NOW });
      expect(resumed.index).toEqual(clean.index);
      expect(Object.keys(resumed.index.conversations)).toHaveLength(4);
      expect(resumed.unlinked).toEqual([]);
    }
  });

  it('writes no file of its own, and hands back an index that reads back whole', async () => {
    const w = world({
      chats: () => [{ conversationId: 'chat-local' }],
      rows: (at) => ({
        'chat-one': { folder: at.one, branch: 'graphe/one' },
        'chat-away': { folder: at.three, branch: 'graphe/away' },
        'chat-elsewhere': { folder: at.elsewhere, branch: 'graphe/x' },
      }),
    });
    const manifest = discover({ projects: [w.project], recentsFile: w.recentsFile, exists: present });
    const before = tree(w.paths.userData);
    const result = await commit(manifest, {
      index: emptyIndex(),
      probe: w.probe,
      now: NOW,
      persist: () => undefined,
      indexFile: join(w.paths.userData, 'workspaces.json'),
    });
    expect(tree(w.paths.userData)).toEqual(before);

    const read = parseIndex(serializeIndex(result.index));
    expect(read.problem).toBeNull();
    expect(read.index).toEqual(result.index);
  });

  it('runs again only for a marker this version can trust', async () => {
    const w = world({ chats: () => [], rows: (at) => ({ 'chat-one': { folder: at.one, branch: 'graphe/one' } }) });
    const manifest = discover({ projects: [w.project], exists: present });
    const result = await commit(manifest, { index: emptyIndex(), probe: w.probe, now: NOW });

    expect(readMarker(JSON.stringify(result.marker))).toEqual(result.marker);
    // A half-written file, a file an older version wrote, and a file with the
    // right version but nothing else in it all mean "not migrated yet".
    expect(readMarker('{"version":')).toBeNull();
    expect(readMarker('{"version":null}')).toBeNull();
    expect(readMarker(JSON.stringify({ ...result.marker, version: MIGRATION_VERSION + 1 }))).toBeNull();
    expect(readMarker(JSON.stringify({ ...result.marker, completedAt: undefined }))).toBeNull();
    expect(readMarker(JSON.stringify({ version: MIGRATION_VERSION, completedAt: NOW }))).toBeNull();
    expect(readMarker(JSON.stringify({ ...result.marker, verdicts: [] }))).toBeNull();
  });
});
