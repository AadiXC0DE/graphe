/** T09, T10, T11, T56, T60: a profile that has been running for a while.
 *
 * Phase 10.2 asks for these as named cases. Everything here is a real directory
 * tree, a real repository with a real checkout, and the migration service over
 * both: what a run records, what a second run does over the first one's
 * leftovers, what happens when two projects shared one legacy folder, and what
 * a version that does not understand the file does with it.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

/* Real repositories and real git, several per test. Under a loaded machine a
   ten second ceiling is the machine talking rather than the code. */
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

import {
  commit,
  discover,
  MIGRATION_VERSION,
  readMarker,
  type LegacyChat,
  type MigrationProbe,
} from '../../electron/services/migration-service';
import {
  canonical,
  emptyIndex,
  INDEX_VERSION,
  parseIndex,
  serializeIndex,
  type WorkspaceIndex,
} from '../../electron/services/workspace-registry';
import { createWorktree, type RunGit } from '../../src/history/worktree';
import { gitIn, gitRepo, type Built, type GitRepo } from '../helpers/fixtures';

const NOW = 1_700_000_000_000;

const made: Built[] = [];
const folders: string[] = [];

afterEach(async () => {
  for (const one of made.splice(0)) await one.dispose();
  for (const one of folders.splice(0)) await rm(one, { recursive: true, force: true });
});

async function scratch(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'graphe-scenario-profile-')));
  folders.push(root);
  return root;
}

/** The git runner `src/history/` asks for, over the fixture folders. */
function runner(): RunGit {
  return async (args, options) => {
    const one = await gitIn(options.cwd, ...args);
    return { code: one.code, out: one.out };
  };
}

/** The world as the migration asks about it: the real disk, and git's own
 *  answers rather than a guess about them. */
function probeOver(): MigrationProbe {
  return {
    exists: async (path) => existsSync(path),
    isRepo: async (path) => existsSync(join(path, '.git')),
    branchOf: async (path) => {
      const asked = await gitIn(path, 'rev-parse', '--abbrev-ref', 'HEAD');
      const name = asked.out.trim();
      return asked.code === 0 && name !== '' && name !== 'HEAD' ? name : null;
    },
    worktreeList: async (repo) => {
      const asked = await gitIn(repo, 'worktree', 'list', '--porcelain');
      if (asked.code !== 0) return [];
      return asked.out
        .split('\n')
        .filter((line) => line.startsWith('worktree '))
        .map((line) => line.slice('worktree '.length).trim());
    },
  };
}

/** A project with one checkout of its own, both a little dirty, which is the
 *  profile the case describes. */
async function running(repo: GitRepo): Promise<{ folder: string; branch: string }> {
  const isolated = await createWorktree(runner(), repo.root, 'chat-one', null);
  if (!isolated.ok || isolated.value === null) throw new Error('the fixture could not isolate');
  await writeFile(join(isolated.value.folder, 'half-done.ts'), 'export const wip = true;\n');
  return { folder: isolated.value.folder, branch: isolated.value.branch };
}

/** The legacy profile: a row per conversation, and the folder legacy code
 *  spread copies into. */
function legacyOf(
  repo: GitRepo,
  isolated: { folder: string; branch: string },
  over: {
    managedRoot?: string | null;
    checkouts?: Record<string, unknown>;
    chats?: readonly LegacyChat[];
  } = {},
) {
  return {
    path: repo.root,
    checkoutFile: join(repo.root, 'checkouts.json'),
    managedRoot: over.managedRoot === undefined ? join(repo.root, '.graphe', 'worktrees') : over.managedRoot,
    checkouts: over.checkouts ?? {
      'chat-one': { folder: isolated.folder, branch: isolated.branch },
      'chat-local': { folder: repo.root, branch: 'main' },
    },
    chats: over.chats ?? [
      { conversationId: 'chat-one', folder: isolated.folder, branch: isolated.branch },
      { conversationId: 'chat-local' },
    ],
  };
}

/** Every path under a folder, so a test can say a run wrote nothing there. */
function tree(folder: string): readonly string[] {
  const found: string[] = [];
  const walk = (path: string): void => {
    if (!existsSync(path)) return;
    for (const entry of readdirSync(path, { withFileTypes: true }).sort((one, two) => (one.name < two.name ? -1 : 1))) {
      const child = join(path, entry.name);
      found.push(`${entry.isDirectory() ? 'd' : 'f'} ${child.slice(folder.length)} ${String(statSync(child).size)}`);
      if (entry.isDirectory()) walk(child);
    }
  };
  walk(folder);
  return found;
}

/** What a stray write would move in the project and in its checkout. */
async function onDisk(repo: GitRepo, checkout: string): Promise<Record<string, string>> {
  return {
    status: await repo.status(),
    head: (await repo.git('rev-parse', 'HEAD')).out.trim(),
    staged: (await repo.git('diff', '--cached')).out,
    working: (await repo.git('diff')).out,
    note: await readFile(join(repo.root, repo.paths.committed), 'utf8'),
    checkoutStatus: (await gitIn(checkout, 'status', '--porcelain')).out,
    checkoutFiles: tree(checkout).filter((line) => !line.includes('/.git')).join('\n'),
  };
}

/* -------------------------------------------------------------------------- */

describe('T09: a dirty project and an old checkout, brought across', () => {
  it('accounts for every record, and moves not one working byte', async () => {
    const repo = await gitRepo();
    made.push(repo);
    const isolated = await running(repo);
    const profile = await scratch();
    const before = await onDisk(repo, isolated.folder);
    const profileBefore = tree(profile);

    const manifest = discover({
      projects: [legacyOf(repo, isolated)],
      recentsFile: join(profile, 'projects.json'),
      exists: (path) => existsSync(path),
    });
    const result = await commit(manifest, {
      index: emptyIndex(),
      probe: probeOver(),
      now: NOW,
      indexFile: join(profile, 'workspaces.json'),
    });

    // Every source row is either a record or a quarantine, and both are named.
    expect(result.unlinked).toEqual([]);
    expect(result.marker.sources).toBe(manifest.records.length + manifest.quarantined.length);
    expect(result.marker.sources).toBe(2);
    expect(result.marker.verdicts).toEqual({ verified: 2, missing: 0, gone: 0, foreign: 0 });

    const records = Object.values(result.index.conversations);
    expect(records.map((one) => one.conversationId).sort()).toEqual(['chat-local', 'chat-one']);
    for (const one of records) expect(result.index.workspaces[one.workspaceId]?.cwd).toBeTruthy();
    expect(new Set(Object.values(result.index.workspaces).map((one) => one.cwd)).size).toBe(2);

    // Nothing moved: the same status, the same index, the same bytes, the same
    // half-finished file in the checkout, and an untouched profile.
    expect(await onDisk(repo, isolated.folder)).toEqual(before);
    expect(tree(profile)).toEqual(profileBefore);
    expect(result.backups.map((one) => one.backup).sort()).toEqual(
      [join(profile, 'projects.json'), join(repo.root, 'checkouts.json'), join(profile, 'workspaces.json')]
        .map((path) => `${path}.bak`)
        .sort(),
    );
  });
});

/* -------------------------------------------------------------------------- */

describe('T10: a run that stops part way through, over and over', () => {
  it('ends in the same index whatever step it stopped after', async () => {
    const repo = await gitRepo();
    made.push(repo);
    const isolated = await running(repo);
    const manifest = discover({
      projects: [legacyOf(repo, isolated)],
      exists: (path) => existsSync(path),
    });

    const steps: { index: WorkspaceIndex; what: string }[] = [];
    const whole = await commit(manifest, {
      index: emptyIndex(),
      probe: probeOver(),
      now: NOW,
      persist: (index, step) => {
        steps.push({ index, what: step.what });
      },
    });
    expect(steps.map((one) => one.what)).toEqual(['project', 'workspace', 'workspace', 'conversation', 'conversation']);
    expect(Object.keys(whole.index.conversations)).toHaveLength(2);

    // A crash after each durable step, then the app started again over what it
    // left: the same conversations, the same workspaces, no second copy of any.
    for (const [at] of steps.entries()) {
      const crashed = steps[at]?.index;
      if (crashed === undefined) continue;
      const resumed = await commit(manifest, { index: crashed, probe: probeOver(), now: NOW + 1 });
      expect(resumed.index.conversations).toEqual(whole.index.conversations);
      expect(Object.keys(resumed.index.workspaces).sort()).toEqual(
        Object.keys(whole.index.workspaces).sort(),
      );
      expect(Object.keys(resumed.index.projects)).toEqual(Object.keys(whole.index.projects));
      const cwds = Object.values(resumed.index.workspaces).map((one) => one.cwd);
      expect(new Set(cwds).size).toBe(cwds.length);
      expect(resumed.marker.quarantined).toEqual([]);
    }
  });

  it('leaves a legacy row it cannot read to itself rather than failing the run', async () => {
    const repo = await gitRepo();
    made.push(repo);
    const isolated = await running(repo);
    const manifest = discover({
      projects: [
        legacyOf(repo, isolated, {
          chats: [{ conversationId: 'chat-one', folder: isolated.folder, branch: isolated.branch }],
          checkouts: {
            'chat-one': { folder: isolated.folder, branch: isolated.branch },
            'chat-broken': 'not a row',
            '': { folder: repo.root, branch: 'main' },
          },
        }),
      ],
      exists: (path) => existsSync(path),
    });
    const result = await commit(manifest, { index: emptyIndex(), probe: probeOver(), now: NOW });

    expect(manifest.quarantined.map((one) => one.address).sort()).toEqual(['', 'chat-broken']);
    // The readable rows still arrived, and the unreadable ones are named rather
    // than counted as nothing at all.
    expect(Object.keys(result.index.conversations)).toEqual(['chat-one']);
    expect(result.marker.quarantined).toEqual(['', 'chat-broken']);
    expect(result.marker.sources).toBe(3);
  });
});

/* -------------------------------------------------------------------------- */

describe('T11: two projects that shared one folder of copies', () => {
  it('names the collision, and lets neither project claim what is in it', async () => {
    const first = await gitRepo();
    const second = await gitRepo();
    made.push(first, second);
    const shared = join(first.root, '.graphe', 'worktrees');
    await mkdir(shared, { recursive: true });
    const copy = join(shared, 'website');
    await mkdir(copy, { recursive: true });

    const manifest = discover({
      projects: [
        { path: first.root, managedRoot: shared, checkouts: { 'chat-x': { folder: copy, branch: 'graphe/x' } } },
        { path: second.root, managedRoot: shared, checkouts: { 'chat-y': { folder: copy, branch: 'graphe/y' } } },
      ],
      exists: (path) => existsSync(path),
    });

    expect(manifest.collisions).toEqual([
      { root: canonical(shared), projects: [first.root, second.root].sort() },
    ]);
    for (const record of manifest.records) {
      expect(record.verdict).toBe('foreign');
      expect(record.reason).toBe('shared-managed-root');
    }

    const result = await commit(manifest, { index: emptyIndex(), probe: probeOver(), now: NOW });
    expect(result.collisions).toHaveLength(1);
    // Nothing under a shared root is ours: neither project may clean it up, and
    // both say the folder needs looking at rather than that it is ready.
    for (const workspace of Object.values(result.index.workspaces)) {
      expect(workspace.managed).toBe(false);
      expect(workspace.state).toBe('recovery-required');
    }
    expect(existsSync(copy)).toBe(true);
  });

  it('does not read one project’s copies as another project’s', async () => {
    const first = await gitRepo();
    made.push(first);
    const mine = join(first.root, '.graphe', 'worktrees', 'mine');
    await mkdir(mine, { recursive: true });
    const other = await gitRepo();
    made.push(other);

    const manifest = discover({
      projects: [
        { path: first.root, managedRoot: join(first.root, '.graphe', 'worktrees'), checkouts: { 'chat-x': { folder: mine, branch: 'graphe/x' } } },
        { path: other.root, managedRoot: join(other.root, '.graphe', 'worktrees') },
      ],
      exists: (path) => existsSync(path),
    });
    expect(manifest.collisions).toEqual([]);
    const [row] = manifest.records;
    expect(row?.projectPath).toBe(first.root);
    expect(row?.verdict).toBe('verified');

    const result = await commit(manifest, { index: emptyIndex(), probe: probeOver(), now: NOW });
    const record = Object.values(result.index.workspaces)[0];
    const projectId = result.index.byRoot[canonical(first.root)];
    expect(projectId).toBeDefined();
    expect(record?.projectId).toBe(projectId);
    expect(Object.keys(result.index.workspaces)).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */

describe('T56: a registry file that will not read', () => {
  it('comes back as no data with the reason, never as a throw', () => {
    const broken = parseIndex('{"version":1,"projects":');
    expect(broken.problem).toContain('not JSON');
    expect(broken.index).toEqual(emptyIndex());

    // A profile from a newer app is not corruption: it reads as empty with the
    // reason, and `future` is what tells a caller to leave the file alone.
    const future = parseIndex(
      JSON.stringify({
        version: INDEX_VERSION + 1,
        projects: {},
        byRoot: {},
        workspaces: {},
        conversations: {},
      }),
    );
    expect(future.problem).toContain('newer version');
    expect(future.future).toBe(true);
    expect(future.index).toEqual(emptyIndex());
  });

  it('keeps the rows it can read and drops only the ones it cannot', () => {
    const good = { version: 1, projects: {}, byRoot: {}, workspaces: {}, conversations: {} };
    const half = {
      ...good,
      workspaces: {
        'w-1': {
          workspaceId: 'w-1',
          projectId: 'p-1',
          kind: 'local',
          cwd: '/work/one',
          displayPath: '/work/one',
          repoKey: null,
          managed: false,
          baseSha: null,
          branch: 'main',
          detachedAt: null,
          state: 'ready',
          createdBy: null,
          createdAt: NOW,
          verifiedAt: NOW,
        },
        'w-broken': { workspaceId: 'w-broken' },
      },
    };
    const read = parseIndex(JSON.stringify(half));
    expect(read.problem).toBeNull();
    expect(Object.keys(read.index.workspaces)).toEqual(['w-1']);
    expect(parseIndex(serializeIndex(read.index)).index).toEqual(read.index);
  });

  it('never lets a refused read be mistaken for an empty profile', () => {
    // The failure the plan names: a parse failure turned into empty user data.
    // `problem` is what tells the two apart, and it is non-null whenever the
    // file could not be read.
    expect(parseIndex('').index).toEqual(emptyIndex());
    expect(parseIndex('').problem).not.toBeNull();
    expect(parseIndex(serializeIndex(emptyIndex())).problem).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */

describe('T60: the app is replaced by an older one', () => {
  it('does not trust a marker a later version wrote', async () => {
    const repo = await gitRepo();
    made.push(repo);
    const isolated = await running(repo);
    const manifest = discover({
      projects: [legacyOf(repo, isolated)],
      exists: (path) => existsSync(path),
    });
    const result = await commit(manifest, { index: emptyIndex(), probe: probeOver(), now: NOW });

    const written = JSON.stringify(result.marker);
    expect(readMarker(written)).toEqual(result.marker);
    // A version this build does not know is the same answer as no marker at all,
    // so a downgrade re-runs the migration rather than trusting what it cannot
    // read.
    expect(readMarker(JSON.stringify({ ...result.marker, version: MIGRATION_VERSION + 1 }))).toBeNull();
    expect(readMarker(JSON.stringify({ ...result.marker, version: MIGRATION_VERSION }))).not.toBeNull();
    expect(readMarker('')).toBeNull();
  });

  it('leaves a copy of every file it is about to write over', async () => {
    const repo = await gitRepo();
    made.push(repo);
    const isolated = await running(repo);
    const profile = await scratch();
    const indexFile = join(profile, 'workspaces.json');
    await writeFile(indexFile, serializeIndex(emptyIndex()));

    const manifest = discover({
      projects: [legacyOf(repo, isolated)],
      recentsFile: join(profile, 'projects.json'),
      exists: (path) => existsSync(path),
    });
    const result = await commit(manifest, { index: emptyIndex(), probe: probeOver(), now: NOW, indexFile });

    const named = result.backups.map((one) => one.path).sort();
    expect(named).toEqual([join(profile, 'projects.json'), join(profile, 'workspaces.json'), join(repo.root, 'checkouts.json')].sort());
    for (const one of result.backups) expect(one.backup).toBe(`${one.path}.bak`);
    // Listing a backup is not making one: the caller copies. What is proven
    // here is that the list is complete before anything is written.
    expect(readFileSync(indexFile, 'utf8')).toBe(serializeIndex(emptyIndex()));
  });
});
