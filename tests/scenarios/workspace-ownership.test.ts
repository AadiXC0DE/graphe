/** T01, T05, T06, T07, T08, T11: which folder a chat is changing.
 *
 * Phase 10.2 asks for named cases rather than a paragraph. These are the ones
 * whose whole meaning is on disk: a new chat in a folder another one is working
 * in, a checkout made on request, navigation that must move nothing, a folder
 * that has been taken away, and two projects that share a name. Everything is a
 * real temporary repository and a real registry; nothing is mocked.
 */

import { existsSync } from 'node:fs';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

/* Real repositories and real git, several per test. Under a loaded machine a
   ten second ceiling is the machine talking rather than the code. */
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

import {
  addConversation,
  addWorkspace,
  canonical,
  conversationById,
  conversationsIn,
  emptyIndex,
  ensureProject,
  markDeleted,
  projectAtPath,
  relinkProject,
  verifyWorkspace,
  workspaceForConversation,
  type WorkspaceFacts,
  type WorkspaceIndex,
  type WorkspaceKind,
} from '../../electron/services/workspace-registry';
import { createWorktree, worktreeWords, type RunGit } from '../../src/history/worktree';
import {
  collidingLegacyNames,
  gitIn,
  gitRepo,
  missingWorktree,
  movedProject,
  plainFolder,
  type Built,
  type GitRepo,
} from '../helpers/fixtures';

const NOW = 1_700_000_000_000;

const made: Built[] = [];

afterEach(async () => {
  for (const one of made.splice(0)) await one.dispose();
});

/** A git runner over the fixture folders, which is what `src/history/` asks
 *  for. `count` records every verb asked, so a test can say what was run. */
function runnerOver(count?: string[]): RunGit {
  return async (args, options) => {
    count?.push(args[0] ?? '');
    const one = await gitIn(options.cwd, ...args);
    return { code: one.code, out: one.out };
  };
}

/** What looking at the folder on disk found, asked the way the app asks it. */
async function factsOf(run: RunGit, folder: string, kind: WorkspaceKind): Promise<WorkspaceFacts> {
  if (!existsSync(folder)) return { present: false, repository: false, branch: null };
  const repository = existsSync(join(folder, '.git'));
  const asked = await run(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: folder });
  const branch = asked.code === 0 ? (asked.out ?? '').trim() : null;
  const detachedAt =
    branch === 'HEAD'
      ? ((await run(['rev-parse', 'HEAD'], { cwd: folder })).out ?? '').trim()
      : undefined;
  return {
    present: true,
    repository,
    branch: branch === 'HEAD' ? null : branch,
    ...(detachedAt === undefined ? {} : { detachedAt }),
    ...(kind === 'worktree' ? { registered: true } : {}),
  };
}

/** One project, one local workspace in its own folder, as opening it leaves it. */
function opened(repo: GitRepo): {
  index: WorkspaceIndex;
  projectId: string;
  workspaceId: string;
  folder: string;
} {
  const project = ensureProject(emptyIndex(), repo.root);
  const workspace = addWorkspace(project.index, {
    projectId: project.project.projectId,
    path: repo.root,
    kind: 'local',
    managed: false,
    now: NOW,
  });
  return {
    index: workspace.index,
    projectId: project.project.projectId,
    workspaceId: workspace.workspace.workspaceId,
    folder: repo.root,
  };
}

/* -------------------------------------------------------------------------- */

describe('T01: chat A writes without committing, then New B opens in the same project', () => {
  it('files B in the same folder, so B sees the file A wrote', async () => {
    const repo = await gitRepo({ dirty: false });
    made.push(repo);
    const open = opened(repo);
    const first = addConversation(open.index, {
      conversationId: 'chat-a',
      workspaceId: open.workspaceId,
      title: 'A',
      now: NOW,
    });
    // A writes, and nothing is committed: the ordinary case the question "why
    // does a new chat not see my work" is about.
    await writeFile(join(open.folder, 'written-by-a.ts'), 'export const mine = true;\n');
    const second = addConversation(first.index, {
      conversationId: 'chat-b',
      workspaceId: open.workspaceId,
      title: 'B',
      now: NOW + 1,
    });

    const whereB = workspaceForConversation(second.index, 'chat-b');
    expect(whereB?.cwd).toBe(canonical(open.folder));
    expect(whereB?.cwd).toBe(workspaceForConversation(second.index, 'chat-a')?.cwd);
    expect(existsSync(join(whereB?.cwd ?? '', 'written-by-a.ts'))).toBe(true);
  });

  it('gives B its own identity and no transcript of A', async () => {
    const repo = await gitRepo({ dirty: false });
    made.push(repo);
    const open = opened(repo);
    const first = addConversation(open.index, {
      conversationId: 'chat-a',
      workspaceId: open.workspaceId,
      title: 'A',
      now: NOW,
    });
    const second = addConversation(first.index, {
      conversationId: 'chat-b',
      workspaceId: open.workspaceId,
      title: 'B',
      now: NOW + 1,
    });

    const b = conversationById(second.index, 'chat-b');
    expect(second.conversation.conversationId).toBe('chat-b');
    expect(b?.sessionFile).toBeNull();
    expect(b?.sessionId).toBeNull();
    expect(b?.lineage).toBeNull();
    expect(b?.branchLeaf).toBeNull();
    expect(conversationsIn(second.index, open.workspaceId)).toEqual(['chat-a', 'chat-b']);
  });

  it('leaves the write uncommitted, which is what "without commit" means', async () => {
    const repo = await gitRepo({ dirty: false });
    made.push(repo);
    const open = opened(repo);
    await writeFile(join(open.folder, 'written-by-a.ts'), 'export const mine = true;\n');

    expect(await repo.status()).toContain('?? written-by-a.ts');
    expect((await repo.git('rev-parse', 'HEAD')).out.trim()).toBe(repo.head);
  });
});

/* -------------------------------------------------------------------------- */

describe('T05: an isolated workspace created for one conversation', () => {
  it('starts at the project’s head, with its own folder and branch', async () => {
    const repo = await gitRepo({ dirty: false });
    made.push(repo);
    const open = opened(repo);
    const run = runnerOver();

    const made_ = await createWorktree(run, repo.root, 'isolated', null);
    expect(made_.ok).toBe(true);
    if (!made_.ok || made_.value === null) return;

    const isolated = addWorkspace(open.index, {
      projectId: open.projectId,
      path: made_.value.folder,
      kind: 'worktree',
      managed: true,
      baseSha: repo.head,
      branch: made_.value.branch,
      createdBy: 'worktreeNew',
      now: NOW,
    });
    expect(isolated.workspace.baseSha).toBe(repo.head);
    expect(isolated.workspace.cwd).toBe(canonical(made_.value.folder));
    expect(isolated.workspace.cwd).not.toBe(canonical(repo.root));
    expect(existsSync(join(made_.value.folder, repo.paths.committed))).toBe(true);
    expect((await gitIn(made_.value.folder, 'rev-parse', 'HEAD')).out.trim()).toBe(repo.head);
  });

  it('leaves the local workspace and the project folder exactly as they were', async () => {
    const repo = await gitRepo();
    made.push(repo);
    const open = opened(repo);
    const before = {
      status: await repo.status(),
      tracked: (await repo.git('status', '--porcelain', '-uno')).out,
      head: (await repo.git('rev-parse', 'HEAD')).out.trim(),
      note: (await repo.git('show', 'HEAD:notes.md')).out,
      index: (await repo.git('diff', '--cached', '--', repo.paths.committed)).out,
    };

    const isolated = await createWorktree(runnerOver(), repo.root, 'isolated', null);
    expect(isolated.ok).toBe(true);

    // The one thing that does appear is the folder the checkout lives in: it is
    // new, it is untracked, and it is the isolation itself rather than a change
    // to the person's work. Everything that was there before is byte for byte
    // as it was, tracked changes included.
    expect((await repo.status()).split('\n').filter((one) => one !== '').sort()).toEqual(
      `${before.status}?? .graphe/\n`.split('\n').filter((one) => one !== '').sort(),
    );
    expect((await repo.git('status', '--porcelain', '-uno')).out).toBe(before.tracked);
    expect((await repo.git('rev-parse', 'HEAD')).out.trim()).toBe(before.head);
    expect((await repo.git('show', 'HEAD:notes.md')).out).toBe(before.note);
    expect((await repo.git('diff', '--cached', '--', repo.paths.committed)).out).toBe(before.index);
    expect(workspaceForConversation(open.index, 'never-added')).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */

describe('T06: selecting B and then A, again and again', () => {
  it('changes no file, no index entry and no revision', async () => {
    const repo = await gitRepo();
    made.push(repo);
    const open = opened(repo);
    const isolated = await createWorktree(runnerOver(), repo.root, 'isolated', null);
    if (!isolated.ok || isolated.value === null) throw new Error('the fixture could not isolate');
    const both = addWorkspace(open.index, {
      projectId: open.projectId,
      path: isolated.value.folder,
      kind: 'worktree',
      managed: true,
      baseSha: repo.head,
      branch: isolated.value.branch,
      now: NOW,
    });
    const chatA = addConversation(both.index, {
      conversationId: 'chat-a',
      workspaceId: open.workspaceId,
      now: NOW,
    });
    const chatB = addConversation(chatA.index, {
      conversationId: 'chat-b',
      workspaceId: both.workspace.workspaceId,
      now: NOW,
    });

    const before = await snapshot(repo);
    const called: string[] = [];
    const run = runnerOver(called);

    // Navigation: ask which workspace each chat is in, and verify it, the way
    // opening a tab does. Twenty times, alternating, as the case says.
    for (let at = 0; at < 10; at += 1) {
      for (const id of ['chat-a', 'chat-b']) {
        const where = workspaceForConversation(chatB.index, id);
        expect(where).not.toBeNull();
        if (where === null) continue;
        const verified = verifyWorkspace(where, await factsOf(run, where.cwd, where.kind), NOW);
        expect(verified.state).toBe('ready');
      }
    }

    expect(await snapshot(repo)).toEqual(before);
    const mutating = ['add', 'commit', 'checkout', 'switch', 'merge', 'reset', 'branch', 'worktree', 'stash', 'restore', 'clean', 'rm', 'push', 'fetch', 'pull'];
    expect(called.filter((verb) => mutating.includes(verb))).toEqual([]);
  });
});

/** The things a stray write would move: the revision, the index, the working
 *  tree and the untracked files. */
async function snapshot(repo: GitRepo): Promise<Record<string, string>> {
  return {
    head: (await repo.git('rev-parse', 'HEAD')).out.trim(),
    branch: (await repo.git('rev-parse', '--abbrev-ref', 'HEAD')).out.trim(),
    status: await repo.status(),
    staged: (await repo.git('diff', '--cached')).out,
    working: (await repo.git('diff')).out,
    tree: (await repo.git('ls-files', '-s')).out,
  };
}

/* -------------------------------------------------------------------------- */

describe('T07: an isolated workspace that cannot be made', () => {
  it('is refused in words, and nothing is made anywhere', async () => {
    const folder = await plainFolder();
    made.push(folder);

    const refused = await createWorktree(runnerOver(), folder.root, 'isolated', null);
    expect(refused.ok).toBe(false);
    expect(refused.ok === false && refused.because).toBe(worktreeWords.notRepo);
    expect(existsSync(join(folder.root, '.graphe'))).toBe(false);
  });

  it('leaves no orphan record to be found later', async () => {
    const repo = await gitRepo({ dirty: false });
    made.push(repo);
    const open = opened(repo);
    const isolated = await createWorktree(runnerOver(), repo.root, 'isolated', null);
    if (!isolated.ok || isolated.value === null) throw new Error('the fixture could not isolate');

    // A creation that was retried after a crash writes the same record, so a
    // failure cannot leave a second one behind.
    const first = addWorkspace(open.index, {
      projectId: open.projectId,
      path: isolated.value.folder,
      kind: 'worktree',
      managed: true,
      now: NOW,
    });
    const again = addWorkspace(first.index, {
      projectId: open.projectId,
      path: isolated.value.folder,
      kind: 'worktree',
      managed: true,
      now: NOW,
    });
    expect(again.made).toBe(false);
    expect(again.workspace.workspaceId).toBe(first.workspace.workspaceId);
    expect(Object.keys(again.index.workspaces)).toHaveLength(2);

    // And a workspace record can be written down as gone without the record of
    // which folder it was being lost, which is what recovery reads.
    const deleted = markDeleted(again.index, first.workspace.workspaceId);
    expect(deleted.workspaces[first.workspace.workspaceId]?.state).toBe('deleted');
    expect(deleted.workspaces[first.workspace.workspaceId]?.cwd).toBe(canonical(isolated.value.folder));
  });
});

/* -------------------------------------------------------------------------- */

describe('T08: a conversation whose checkout was removed behind the app', () => {
  it('comes back missing, never ready', async () => {
    const fixture = await missingWorktree();
    made.push(fixture);
    const project = ensureProject(emptyIndex(), fixture.repo);
    const record = addWorkspace(project.index, {
      projectId: project.project.projectId,
      path: fixture.recorded,
      kind: 'worktree',
      managed: true,
      branch: fixture.branch,
      now: NOW,
    });
    const chat = addConversation(record.index, {
      conversationId: 'chat-away',
      workspaceId: record.workspace.workspaceId,
      now: NOW,
    });

    const where = workspaceForConversation(chat.index, 'chat-away');
    expect(where).not.toBeNull();
    const verified = verifyWorkspace(where!, await factsOf(runnerOver(), where!.cwd, 'worktree'), NOW);
    expect(verified.state).toBe('missing');
    expect(verified.cwd).toBe(canonical(fixture.recorded));
    // The branch survives in the repository even though the copy does not, and
    // the record says which one it was rather than guessing.
    expect(verified.branch).toBe(fixture.branch);
  });

  it('cannot be answered with another folder that happens to share its name', async () => {
    const fixture = await missingWorktree();
    made.push(fixture);
    const project = ensureProject(emptyIndex(), fixture.repo);
    const record = addWorkspace(project.index, {
      projectId: project.project.projectId,
      path: fixture.recorded,
      kind: 'worktree',
      managed: true,
      branch: fixture.branch,
      now: NOW,
    });
    const chat = addConversation(record.index, {
      conversationId: 'chat-away',
      workspaceId: record.workspace.workspaceId,
      now: NOW,
    });

    // A folder with the same leaf name, somewhere else entirely. Nothing may
    // resolve the conversation to it.
    const decoy = join(fixture.root, 'worktrees', 'review');
    await mkdir(decoy, { recursive: true });
    expect(projectAtPath(chat.index, decoy)).toBeNull();
    expect(workspaceForConversation(chat.index, 'chat-away')?.cwd).toBe(canonical(fixture.recorded));
    expect(workspaceForConversation(chat.index, 'chat-away')?.cwd).not.toBe(canonical(decoy));
    // The local workspace of the project is not offered as a substitute either.
    expect(conversationsIn(chat.index, record.workspace.workspaceId)).toEqual(['chat-away']);
  });
});

/* -------------------------------------------------------------------------- */

describe('T11: one name, two projects, and a folder reached by two paths', () => {
  it('keeps two projects with the same folder name apart, though the old key collided', async () => {
    const fixture = await collidingLegacyNames();
    made.push(fixture);
    expect(fixture.legacy).toBe('website');

    const first = ensureProject(emptyIndex(), fixture.first);
    const second = ensureProject(first.index, fixture.second);
    expect(second.project.projectId).not.toBe(first.project.projectId);
    expect(Object.keys(second.index.projects)).toHaveLength(2);
    expect(projectAtPath(second.index, fixture.first)?.projectId).toBe(first.project.projectId);
    expect(projectAtPath(second.index, fixture.second)?.projectId).toBe(second.project.projectId);
  });

  it('resolves a symlink to the project it points at, and to no other', async () => {
    const repo = await gitRepo({ dirty: false });
    made.push(repo);
    const alias = join(repo.root, '..', `${String(Date.now())}-alias`);
    await symlink(repo.root, alias);
    const first = ensureProject(emptyIndex(), repo.root);

    expect(canonical(alias)).toBe(canonical(repo.root));
    expect(projectAtPath(first.index, alias)?.projectId).toBe(first.project.projectId);
    expect(Object.keys(first.index.projects)).toHaveLength(1);
  });

  it('moves a project only when told, and keeps its id and its old path', async () => {
    const fixture = await movedProject();
    made.push(fixture);
    const before = ensureProject(emptyIndex(), fixture.stale);
    const workspace = addWorkspace(before.index, {
      projectId: before.project.projectId,
      path: fixture.stale,
      kind: 'local',
      managed: false,
      now: NOW,
    });
    const chat = addConversation(workspace.index, {
      conversationId: 'chat-moved',
      workspaceId: workspace.workspace.workspaceId,
      now: NOW,
    });

    // Nothing is inferred from the stale path: it is not a project any more,
    // and opening the new folder on its own would be a second project.
    expect(projectAtPath(chat.index, fixture.moved)).toBeNull();
    const moved = relinkProject(chat.index, before.project.projectId, fixture.moved);
    expect(Object.keys(moved.projects)).toHaveLength(1);
    expect(moved.projects[before.project.projectId]?.root).toBe(canonical(fixture.moved));
    expect(moved.projects[before.project.projectId]?.aliases).toContain(canonical(fixture.stale));
    expect(projectAtPath(moved, fixture.stale)?.projectId).toBe(before.project.projectId);
    // The conversation still points at the same workspace record, whose folder
    // is the one it was verified on: a move is not a silent rewrite of that.
    expect(workspaceForConversation(moved, 'chat-moved')?.cwd).toBe(canonical(fixture.stale));
  });
});
