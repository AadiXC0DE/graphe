/** What a workspace is, and what a decision about it was about.
 *
 * Two questions that only have an answer if the code reads the repository
 * rather than the path:
 *
 *  - Which repository a folder is. The project folder and every checkout of it
 *    are one identity, and two unrelated repositories are two — so a folder at
 *    the path a copy was recorded at, holding somebody else's repository, is not
 *    that copy's work and must not be merged into the project.
 *  - Which state a review was read against. A decision taken against files that
 *    have since moved is not a decision about what is on disk, and carrying it
 *    out is how the wrong version wins.
 *
 * Real repositories and real git; the queue part is pure.
 */

import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

/* Real repositories and real git, several per test. Under a loaded machine a
   ten second ceiling is the machine talking rather than the code. */
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

import {
  addConversation,
  addWorkspace,
  emptyIndex,
  ensureProject,
  setRepoKey,
  verifyWorkspace,
  workspaceAtPath,
  workspaceForConversation,
  type WorkspaceIndex,
  type WorkspaceRecord,
} from '../electron/services/workspace-registry';
import {
  chooseSetupFiles,
  readSetupChoices,
  seedFromChoices,
  seedingNotes,
} from '../src/history/seeding';
import { createWorktree, repoKeyOf, sameRepository, type RunGit } from '../src/history/worktree';
import {
  queueFrom,
  reviewedAgain,
  staleDecision,
  treeReading,
  type Arriving,
  type Entry,
} from '../src/work/reviewqueue';
import { gitIn, gitRepo, type Built, type GitRepo } from './helpers/fixtures';

const NOW = 1_700_000_000_000;

const made: Built[] = [];
const scratch: string[] = [];

afterEach(async () => {
  for (const one of made.splice(0)) await one.dispose();
  for (const one of scratch.splice(0)) await rm(one, { recursive: true, force: true });
});

function runner(): RunGit {
  return async (args, options) => {
    const one = await gitIn(options.cwd, ...args);
    return { code: one.code, out: one.out };
  };
}

async function cloneOf(repo: GitRepo): Promise<string> {
  const where = await mkdtemp(join(tmpdir(), 'graphe-clone-'));
  scratch.push(where);
  const cloned = await gitIn(where, 'clone', repo.root, join(where, 'copy'));
  if (cloned.code !== 0) throw new Error(`git clone failed: ${cloned.err}`);
  return join(where, 'copy');
}

/* -------------------------------------------------------------------------- */

describe('a repository, as an identity rather than a location', () => {
  it('is one repository to the project and to every checkout of it', async () => {
    const repo = await gitRepo({ dirty: false });
    made.push(repo);
    const checkout = await createWorktree(runner(), repo.root, 'chat', null);
    if (!checkout.ok || checkout.value === null) throw new Error('the fixture could not isolate');

    const project = await repoKeyOf(runner(), repo.root);
    const copy = await repoKeyOf(runner(), checkout.value.folder);
    expect(project).not.toBeNull();
    expect(copy).toBe(project);
    expect(await sameRepository(runner(), repo.root, checkout.value.folder)).toBe(true);
  });

  it('is two repositories to two unrelated projects', async () => {
    const one = await gitRepo({ dirty: false });
    const other = await gitRepo({ dirty: false });
    made.push(one, other);
    expect(await repoKeyOf(runner(), one.root)).not.toBe(await repoKeyOf(runner(), other.root));
    expect(await sameRepository(runner(), one.root, other.root)).toBe(false);
  });

  /* A clone has its own git directory, so it is a repository of its own. An
     identity that merged clones would be a claim about what git holds that git
     does not make: nothing links the two, and a merge between them is not a
     merge at all. */
  it('is a repository of its own to a clone of it', async () => {
    const repo = await gitRepo({ dirty: false });
    made.push(repo);
    const cloned = await cloneOf(repo);
    expect(await repoKeyOf(runner(), cloned)).not.toBe(await repoKeyOf(runner(), repo.root));
  });

  it('is nothing at all to a folder that is not a repository', async () => {
    const repo = await gitRepo({ dirty: false });
    made.push(repo);
    const plain = await mkdtemp(join(tmpdir(), 'graphe-plain-'));
    scratch.push(plain);
    expect(await repoKeyOf(runner(), plain)).toBeNull();
  });
});

describe('a folder matched against the workspace written down for it', () => {
  /** One project with a local workspace, and a second repository standing at a
   *  path of its own. */
  async function twoProjects(): Promise<{
    index: WorkspaceIndex;
    projectId: string;
    folder: string;
    wrong: string;
  }> {
    const one = await gitRepo({ dirty: false });
    const other = await gitRepo({ dirty: false });
    made.push(one, other);
    const project = ensureProject(emptyIndex(), one.root);
    const added = addWorkspace(project.index, {
      projectId: project.project.projectId,
      path: one.root,
      kind: 'local',
      managed: false,
      repoKey: await repoKeyOf(runner(), one.root),
      now: NOW,
    });
    return {
      index: added.index,
      projectId: project.project.projectId,
      folder: one.root,
      wrong: await repoKeyOf(runner(), other.root).then((key) => key ?? ''),
    };
  }

  it('is that workspace when the repository is the same', async () => {
    const { index, projectId, folder } = await twoProjects();
    const key = await repoKeyOf(runner(), folder);
    expect(workspaceAtPath(index, projectId, folder, key)?.cwd).toBe(folder);
  });

  it('is not that workspace when the folder now holds another repository', async () => {
    const { index, projectId, folder, wrong } = await twoProjects();
    expect(workspaceAtPath(index, projectId, folder, wrong)).toBeNull();
    // And matching on the path alone still finds it, which is why the identity
    // is what a caller with a repository in hand has to pass.
    expect(workspaceAtPath(index, projectId, folder)?.cwd).toBe(folder);
  });

  it('goes back to being unverified when the repository it holds changed', async () => {
    const { index, projectId, folder, wrong } = await twoProjects();
    const record = workspaceAtPath(index, projectId, folder) as WorkspaceRecord;
    const verified = verifyWorkspace(
      record,
      { present: true, repository: true, repoKey: wrong, branch: 'main' },
      NOW + 1,
    );
    expect(verified.state).toBe('recovery-required');
    const same = verifyWorkspace(
      record,
      { present: true, repository: true, repoKey: record.repoKey, branch: 'main' },
      NOW + 1,
    );
    expect(same.state).toBe('ready');
    expect(same.repoKey).toBe(record.repoKey);
  });

  it('keeps a conversation pointed at the workspace it was written into', async () => {
    const { index, projectId, folder } = await twoProjects();
    const record = workspaceAtPath(index, projectId, folder) as WorkspaceRecord;
    const chat = addConversation(index, {
      conversationId: 'chat-here',
      workspaceId: record.workspaceId,
      now: NOW,
    });
    const filled = setRepoKey(chat.index, record.workspaceId, 'not-a-repository', NOW);
    // The identity a record was written with is not rewritten by a mere lookup:
    // it is the folder on disk that decides, and verification says so.
    expect(workspaceForConversation(filled, 'chat-here')?.repoKey).toBe('not-a-repository');
  });
});

/* -------------------------------------------------------------------------- */

describe('a decision about a review that has moved since', () => {
  const touched = [{ state: ' M', path: 'src/Header.tsx', hash: 'h1' }];
  const snapshot = { source: treeReading('head-a', touched), target: 'head-1' };

  function arriving(over: Partial<Arriving> = {}): Arriving {
    return {
      id: 'e1',
      from: 'conversation',
      title: 'Header',
      address: 'conversation-1',
      files: [{ path: 'src/Header.tsx', added: 3, removed: 1 }],
      at: NOW,
      snapshot,
      ...over,
    };
  }

  it('is carried out while both sides are where they were', () => {
    const [entry] = queueFrom([], [arriving()]) as readonly Entry[];
    expect(entry).toBeDefined();
    expect(staleDecision(entry as Entry, snapshot)).toBe(false);
  });

  it('is refused once the copy has moved on', () => {
    const [entry] = queueFrom([], [arriving()]) as readonly Entry[];
    expect(staleDecision(entry as Entry, { source: treeReading('head-b', touched), target: 'head-1' })).toBe(true);
  });

  it('is refused when the same file was written again under the same name', () => {
    // A terminal, an editor or another checkout writing one of the files the
    // person is looking at. The revision and the status line are identical, so
    // the content is the only thing that can tell the two states apart — and
    // carrying the decision out anyway would land bytes nobody agreed to.
    const [entry] = queueFrom([], [arriving()]) as readonly Entry[];
    const written = treeReading('head-a', [{ state: ' M', path: 'src/Header.tsx', hash: 'h2' }]);
    expect(staleDecision(entry as Entry, { source: written, target: 'head-1' })).toBe(true);
  });

  it('is refused once the workspace it would land in has moved on', () => {
    const [entry] = queueFrom([], [arriving()]) as readonly Entry[];
    expect(staleDecision(entry as Entry, { source: snapshot.source, target: 'head-2' })).toBe(true);
  });

  it('is refused when the copy could not be read at all', () => {
    const [entry] = queueFrom([], [arriving()]) as readonly Entry[];
    expect(staleDecision(entry as Entry, null)).toBe(true);
  });

  it('is refused for an entry that was never read against anything', () => {
    const [entry] = queueFrom([], [arriving({ snapshot: undefined })]) as readonly Entry[];
    expect(staleDecision(entry as Entry, snapshot)).toBe(true);
  });

  it('sends the entry back to be looked at again, with nothing of the old answer', () => {
    const [first] = queueFrom([], [arriving()]) as readonly Entry[];
    const decided = { ...(first as Entry), read: true, choices: { 'src/Header.tsx': 'keep mine' as const } };
    const again = reviewedAgain(decided, snapshot);
    expect(again.read).toBe(false);
    expect(again.choices).toBeUndefined();
    // Undecided, and never stale twice over: the reading it now carries is the
    // one on disk.
    expect(staleDecision(again, snapshot)).toBe(false);
  });

  it('keeps what a person did when an arrival is the same state reported again', () => {
    const [first] = queueFrom([], [arriving()]) as readonly Entry[];
    const settled = { ...(first as Entry), read: true, choices: { 'src/Header.tsx': 'keep mine' as const } };
    const again = queueFrom([settled], [arriving()]) as readonly Entry[];
    expect(again[0]?.read).toBe(true);
    expect(again[0]?.choices?.['src/Header.tsx']).toBe('keep mine');
  });

  it('re-opens it when the arrival is a state nobody has looked at', () => {
    const [first] = queueFrom([], [arriving()]) as readonly Entry[];
    const settled = { ...(first as Entry), read: true, choices: { 'src/Header.tsx': 'keep mine' as const } };
    const again = queueFrom([settled], [
      arriving({ snapshot: { source: 'head-b\n', target: 'head-1' } }),
    ]) as readonly Entry[];
    expect(again[0]?.read).toBe(false);
    expect(again[0]?.choices).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */

describe('a checkout seeded from what the project chose', () => {
  it('carries the chosen file and says what it did', async () => {
    const repo = await gitRepo({ dirty: false });
    made.push(repo);
    const profile = await mkdtemp(join(tmpdir(), 'graphe-profile-'));
    scratch.push(profile);
    await writeFile(join(repo.root, '.env.local'), 'SECRET=1\n');
    await writeFile(join(repo.root, '.gitignore'), '.env.local\n');
    await gitIn(repo.root, 'add', '.gitignore');
    await gitIn(repo.root, 'commit', '-qm', 'ignore the local env');

    const checkout = await createWorktree(runner(), repo.root, 'chat', null);
    if (!checkout.ok || checkout.value === null) throw new Error('the fixture could not isolate');

    // Nothing chosen: nothing carried, which is the answer from before anybody
    // has said what this project needs.
    expect((await readSetupChoices(profile))['']).toBeUndefined();
    const bare = await seedFromChoices(runner(), repo.root, checkout.value.folder, profile);
    expect(bare.carried).toEqual([]);

    await chooseSetupFiles(profile, repo.root, ['.env.local']);
    const seeded = await seedFromChoices(runner(), repo.root, checkout.value.folder, profile);
    expect(seeded.carried).toEqual(['.env.local']);
    const notes = seedingNotes(seeded, repo.root);
    expect(notes.join(' ')).toContain('.env.local');
    expect(notes.join(' ')).toContain(repo.root);
  });

  it('says which chosen file did not arrive, and why', async () => {
    const repo = await gitRepo({ dirty: false });
    made.push(repo);
    const profile = await mkdtemp(join(tmpdir(), 'graphe-profile-'));
    scratch.push(profile);
    const outside = await mkdtemp(join(tmpdir(), 'graphe-outside-'));
    scratch.push(outside);
    await writeFile(join(outside, 'keys'), 'SECRET=1\n');
    await writeFile(join(repo.root, '.gitignore'), '.env.local\n');
    await rm(join(repo.root, '.env.local'), { force: true });
    await symlink(join(outside, 'keys'), join(repo.root, '.env.local'));
    await gitIn(repo.root, 'add', '.gitignore');
    await gitIn(repo.root, 'commit', '-qm', 'ignore the local env');
    const checkout = await createWorktree(runner(), repo.root, 'chat', null);
    if (!checkout.ok || checkout.value === null) throw new Error('the fixture could not isolate');

    // A file that is a link out of the project is not one to copy in, and what
    // is left out is said rather than swallowed: a missing `.env.local` is the
    // file whose absence makes a dev server refuse to start.
    await chooseSetupFiles(profile, repo.root, ['.env.local']);
    const seeded = await seedFromChoices(runner(), repo.root, checkout.value.folder, profile);
    expect(seeded.carried).toEqual([]);
    expect(seeded.omitted).toEqual([{ path: '.env.local', because: 'leaves-the-project' }]);
    expect(seedingNotes(seeded, repo.root).join(' ')).toContain('outside the project');
  });
});
