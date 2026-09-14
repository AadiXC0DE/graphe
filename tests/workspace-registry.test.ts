/** The workspace registry, which is what answers "which files am I changing".
 *
 * These are the properties the rest of phase 3 leans on: an id that survives a
 * retry, a symlinked folder that is the same workspace, two projects that share
 * a basename that are not, and a failed verification that can never come back
 * as `ready`.
 */

import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import {
  addConversation,
  addWorkspace,
  conversationById,
  conversationsOfProject,
  updateConversation,
  attachConversation,
  canonical,
  conversationsIn,
  emptyIndex,
  ensureProject,
  markDeleted,
  parseIndex,
  projectAtPath,
  relinkProject,
  serializeIndex,
  verifyWorkspace,
  workspaceAtPath,
  type WorkspaceRecord,
  workspaceById,
  workspaceForConversation,
} from '../electron/services/workspace-registry';

const made: string[] = [];

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'graphe-registry-'));
  made.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

const NOW = 1_700_000_000_000;

describe('a project seen twice', () => {
  it('is one project, not two', () => {
    const root = scratch();
    const first = ensureProject(emptyIndex(), root);
    const second = ensureProject(first.index, root);
    expect(second.project.projectId).toBe(first.project.projectId);
    expect(second.made).toBe(false);
  });

  it('is found again through a symlink to the same folder', () => {
    const root = scratch();
    const link = join(scratch(), 'alias');
    symlinkSync(root, link);
    const first = ensureProject(emptyIndex(), root);
    expect(projectAtPath(first.index, link)?.projectId).toBe(first.project.projectId);
    expect(canonical(link)).toBe(canonical(root));
  });

  it('keeps two folders with the same basename apart', () => {
    const one = join(scratch(), 'site');
    const two = join(scratch(), 'other', 'site');
    mkdirSync(one, { recursive: true });
    mkdirSync(two, { recursive: true });
    const first = ensureProject(emptyIndex(), one);
    const second = ensureProject(first.index, two);
    const projects = Object.values(second.index.projects);
    expect(projects).toHaveLength(2);
    expect(second.project.projectId).not.toBe(first.project.projectId);
  });

  it('keeps its identity, and its old path as an alias, through an explicit relink', () => {
    const before = join(scratch(), 'before');
    const after = join(scratch(), 'after');
    mkdirSync(before, { recursive: true });
    mkdirSync(after, { recursive: true });
    const first = ensureProject(emptyIndex(), before);
    const moved = relinkProject(first.index, first.project.projectId, after);
    expect(moved.projects[first.project.projectId]?.projectId).toBe(first.project.projectId);
    expect(moved.projects[first.project.projectId]?.root).toBe(canonical(after));
    expect(moved.projects[first.project.projectId]?.aliases).toContain(canonical(before));
    // Both paths find the same project, which is what history written at the
    // old one needs.
    expect(projectAtPath(moved, after)?.projectId).toBe(first.project.projectId);
    expect(projectAtPath(moved, before)?.projectId).toBe(first.project.projectId);
    expect(Object.keys(moved.projects)).toHaveLength(1);
  });
});

describe('a workspace', () => {
  it('is written once however many times it is added', () => {
    const root = scratch();
    const project = ensureProject(emptyIndex(), root);
    const wanted = {
      projectId: project.project.projectId,
      path: root,
      kind: 'local' as const,
      managed: false,
      now: NOW,
    };
    const first = addWorkspace(project.index, wanted);
    const second = addWorkspace(first.index, wanted);
    expect(second.made).toBe(false);
    expect(second.workspace.workspaceId).toBe(first.workspace.workspaceId);
    expect(Object.keys(second.index.workspaces)).toHaveLength(1);
    expect(second.index.projects[project.project.projectId]?.workspaces).toHaveLength(1);
  });

  it('is the one its folder resolves to, symlink or not', () => {
    const root = scratch();
    const link = join(scratch(), 'alias');
    symlinkSync(root, link);
    const project = ensureProject(emptyIndex(), root);
    const added = addWorkspace(project.index, {
      projectId: project.project.projectId,
      path: root,
      kind: 'local',
      managed: false,
      now: NOW,
    });
    const found = workspaceAtPath(added.index, project.project.projectId, link);
    expect(found?.workspaceId).toBe(added.workspace.workspaceId);
  });
});

describe('verifying a workspace against the disk', () => {
  const record = (over: Partial<WorkspaceRecord> = {}): WorkspaceRecord => ({
    workspaceId: 'w1',
    projectId: 'p1',
    kind: 'worktree' as const,
    cwd: '/gone',
    displayPath: '/gone',
    repoKey: '/repo/.git',
    managed: true,
    baseSha: 'abc',
    branch: 'graphe/one',
    detachedAt: null,
    state: 'ready' as const,
    createdBy: null,
    createdAt: NOW,
    verifiedAt: NOW,
    ...over,
  });

  it('is missing, never ready, when the folder is not there', () => {
    const after = verifyWorkspace(record(), { present: false, repository: false, branch: null }, NOW + 1);
    expect(after.state).toBe('missing');
  });

  it('needs recovery when the folder is there but is not our worktree any more', () => {
    const after = verifyWorkspace(
      record(),
      { present: true, repository: true, branch: 'graphe/one', registered: false },
      NOW + 1,
    );
    expect(after.state).toBe('recovery-required');
    expect(after.state).not.toBe('ready');
  });

  it('records a detached checkout as a SHA, never as HEAD', () => {
    const after = verifyWorkspace(
      record(),
      { present: true, repository: true, branch: null, detachedAt: 'deadbee' },
      NOW + 1,
    );
    expect(after.state).toBe('ready');
    expect(after.branch).toBeNull();
    expect(after.detachedAt).toBe('deadbee');
  });

  it('remembers the branch it was verified on', () => {
    const after = verifyWorkspace(
      record(),
      { present: true, repository: true, branch: 'graphe/two' },
      NOW + 1,
    );
    expect(after.branch).toBe('graphe/two');
    expect(after.detachedAt).toBeNull();
  });
});

describe('which workspace a conversation works in', () => {
  it('is the one it was attached to, and nothing else when it was never attached', () => {
    const root = scratch();
    const project = ensureProject(emptyIndex(), root);
    const added = addWorkspace(project.index, {
      projectId: project.project.projectId,
      path: root,
      kind: 'local',
      managed: false,
      now: NOW,
    });
    const attached = attachConversation(added.index, 'chat-1', added.workspace.workspaceId);
    expect(workspaceForConversation(attached, 'chat-1')?.cwd).toBe(canonical(root));
    expect(workspaceForConversation(attached, 'chat-2')).toBeNull();
    expect(conversationsIn(attached, added.workspace.workspaceId)).toEqual(['chat-1']);
  });

  it('refuses to attach a conversation to a workspace that is not there', () => {
    expect(() => attachConversation(emptyIndex(), 'chat-1', 'nope')).toThrow();
  });
});

describe('a conversation', () => {
  const project = (root: string) => {
    const ensured = ensureProject(emptyIndex(), root);
    const added = addWorkspace(ensured.index, {
      projectId: ensured.project.projectId,
      path: root,
      kind: 'local',
      managed: false,
      now: NOW,
    });
    return { index: added.index, projectId: ensured.project.projectId, workspaceId: added.workspace.workspaceId };
  };

  it('exists from the moment it is made, before anything has been said', () => {
    const root = scratch();
    const { index, projectId, workspaceId } = project(root);
    const made = addConversation(index, { conversationId: 'chat-1', workspaceId, now: NOW });
    expect(made.made).toBe(true);
    expect(made.conversation.projectId).toBe(projectId);
    expect(made.conversation.sessionFile).toBeNull();
    expect(made.conversation.archived).toBe(false);
    expect(workspaceForConversation(made.index, 'chat-1')?.workspaceId).toBe(workspaceId);
  });

  it('is not made twice, and keeps what it already had', () => {
    const root = scratch();
    const { index, workspaceId } = project(root);
    const first = addConversation(index, { conversationId: 'chat-1', workspaceId, title: 'One', now: NOW });
    const withTitle = updateConversation(first.index, 'chat-1', { title: 'Renamed' });
    const second = addConversation(withTitle, {
      conversationId: 'chat-1',
      workspaceId,
      title: 'Ignored',
      now: NOW + 1000,
    });
    expect(second.made).toBe(false);
    expect(second.conversation.title).toBe('Renamed');
  });

  it('carries a lineage link and the choice of the chat that made it', () => {
    const root = scratch();
    const { index, workspaceId } = project(root);
    const made = addConversation(index, {
      conversationId: 'chat-2',
      workspaceId,
      lineage: { from: 'chat-1', kind: 'continue' },
      now: NOW,
    });
    expect(made.conversation.lineage).toEqual({ from: 'chat-1', kind: 'continue' });
    const chosenModel = updateConversation(made.index, 'chat-2', {
      overrides: { model: { providerId: 'p', modelId: 'm' }, thinking: 'high', plan: true },
    });
    expect(conversationById(chosenModel, 'chat-2')?.overrides.model?.modelId).toBe('m');
  });

  it('is left alone by an update for a conversation nobody wrote down', () => {
    const root = scratch();
    const { index } = project(root);
    expect(updateConversation(index, 'never', { title: 'x' })).toBe(index);
  });

  it('is listed for its project, newest first, archived ones included', () => {
    const root = scratch();
    const { index, projectId, workspaceId } = project(root);
    const one = addConversation(index, { conversationId: 'a', workspaceId, now: NOW });
    const two = addConversation(one.index, { conversationId: 'b', workspaceId, now: NOW + 5 });
    const archived = updateConversation(two.index, 'b', { archived: true, updatedAt: NOW + 9 });
    const listed = conversationsOfProject(archived, projectId);
    expect(listed.map((one) => one.conversationId)).toEqual(['b', 'a']);
    expect(listed[0]?.archived).toBe(true);
  });

  it('is filed under its workspace for the "what would I lose" question', () => {
    const root = scratch();
    const { index, workspaceId } = project(root);
    const made = addConversation(index, { conversationId: 'a', workspaceId, now: NOW });
    expect(conversationsIn(made.index, workspaceId)).toEqual(['a']);
  });
});

describe('a stored index', () => {
  it('survives a round trip', () => {
    const root = scratch();
    const project = ensureProject(emptyIndex(), root);
    const added = addWorkspace(project.index, {
      projectId: project.project.projectId,
      path: root,
      kind: 'local',
      managed: false,
      now: NOW,
    });
    const read = parseIndex(serializeIndex(added.index));
    expect(read.problem).toBeNull();
    expect(read.index.projects[project.project.projectId]?.root).toBe(canonical(root));
    expect(Object.keys(read.index.workspaces)).toHaveLength(1);
  });

  it('comes back empty, with a reason, rather than throwing on a file that is not JSON', () => {
    const read = parseIndex('{ half a');
    expect(read.problem).not.toBeNull();
    expect(read.index.workspaces).toEqual({});
  });

  it('loses only the rows a partial write damaged', () => {
    const good = {
      workspaceId: 'w1',
      projectId: 'p1',
      kind: 'local',
      cwd: '/here',
      displayPath: '/here',
      managed: false,
      state: 'ready',
      createdAt: NOW,
    };
    const read = parseIndex(
      JSON.stringify({
        version: 1,
        projects: { p1: { projectId: 'p1', root: '/here', aliases: [], workspaces: ['w1', 'w2'] } },
        byRoot: { '/here': 'p1' },
        // The second row lost its folder, which is the one field without which
        // a workspace is not a workspace.
        workspaces: { w1: good, w2: { ...good, workspaceId: 'w2', cwd: undefined } },
        conversations: { 'chat-1': 'w1' },
      }),
    );
    expect(read.problem).toBeNull();
    expect(Object.keys(read.index.workspaces)).toEqual(['w1']);
    // The link survives the damaged row next to it, now as a record.
    expect(read.index.conversations['chat-1']?.workspaceId).toBe('w1');
    expect(workspaceById(read.index, 'w1')?.cwd).toBe('/here');
  });

  it('upgrades an index whose conversations were bare workspace ids', () => {
    const read = parseIndex(
      JSON.stringify({
        version: 1,
        projects: { p1: { projectId: 'p1', root: '/here', aliases: [], workspaces: ['w1'] } },
        byRoot: { '/here': 'p1' },
        workspaces: {
          w1: {
            workspaceId: 'w1',
            projectId: 'p1',
            kind: 'local',
            cwd: '/here',
            displayPath: '/here',
            managed: false,
            state: 'ready',
            createdAt: NOW,
          },
        },
        conversations: { 'chat-1': 'w1' },
      }),
    );
    expect(read.problem).toBeNull();
    const record = conversationById(read.index, 'chat-1');
    expect(record?.workspaceId).toBe('w1');
    expect(record?.projectId).toBe('p1');
    expect(record?.sessionFile).toBeNull();
    expect(workspaceForConversation(read.index, 'chat-1')?.cwd).toBe('/here');
  });

  it('drops a conversation that points at a workspace which is not there', () => {
    const read = parseIndex(
      JSON.stringify({
        version: 1,
        projects: {},
        byRoot: {},
        workspaces: {},
        conversations: {
          a: { conversationId: 'a', workspaceId: 'gone', projectId: 'p', title: '', createdAt: 1 },
        },
      }),
    );
    expect(Object.keys(read.index.conversations)).toEqual([]);
  });

  it('treats an unknown state as one needing recovery', () => {
    const read = parseIndex(
      JSON.stringify({
        version: 1,
        projects: {},
        byRoot: {},
        workspaces: {
          w1: {
            workspaceId: 'w1',
            projectId: 'p1',
            kind: 'local',
            cwd: '/here',
            displayPath: '/here',
            managed: false,
            state: 'whatever',
            createdAt: NOW,
          },
        },
        conversations: {},
      }),
    );
    expect(workspaceById(read.index, 'w1')?.state).toBe('recovery-required');
  });

  it('refuses a version it does not know', () => {
    const read = parseIndex(JSON.stringify({ version: 99, projects: {}, byRoot: {}, workspaces: {}, conversations: {} }));
    expect(read.problem).not.toBeNull();
  });
});

describe('deleting a workspace', () => {
  it('keeps the record, marked, so a conversation still knows what it meant', () => {
    const root = scratch();
    const project = ensureProject(emptyIndex(), root);
    const added = addWorkspace(project.index, {
      projectId: project.project.projectId,
      path: root,
      kind: 'local',
      managed: false,
      now: NOW,
    });
    const after = markDeleted(added.index, added.workspace.workspaceId);
    expect(workspaceById(after, added.workspace.workspaceId)).toBeNull();
    expect(after.workspaces[added.workspace.workspaceId]?.state).toBe('deleted');
  });
});
