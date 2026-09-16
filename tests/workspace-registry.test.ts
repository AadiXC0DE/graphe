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
  dropView,
  dropViewsOf,
  emptyIndex,
  ensureProject,
  INDEX_VERSION,
  markDeleted,
  noteView,
  noteViewForProject,
  parseIndex,
  projectAtPath,
  relinkProject,
  serializeIndex,
  verifyWorkspace,
  viewInPane,
  viewInPaneForProject,
  viewInProject,
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

describe('a view somebody had open', () => {
  const project = () => {
    const root = scratch();
    const ensured = ensureProject(emptyIndex(), root);
    const added = addWorkspace(ensured.index, {
      projectId: ensured.project.projectId,
      path: root,
      kind: 'local',
      managed: false,
      now: NOW,
    });
    return { index: added.index, workspaceId: added.workspace.workspaceId };
  };

  it('is written down against the conversation and the pane it was in', () => {
    const { index, workspaceId } = project();
    const chat = addConversation(index, { conversationId: 'chat-a', workspaceId, now: NOW });
    const one = noteView(chat.index, { viewId: 'view-1', conversation: 'chat-a', pane: 0 });

    expect(one.made).toBe(true);
    expect(one.view).toEqual({ viewId: 'view-1', conversation: 'chat-a', pane: 0 });
    expect(viewInPane(one.index, 0)?.conversation).toBe('chat-a');
    // The other pane is empty, which is an ordinary single-pane window.
    expect(viewInPane(one.index, 1)).toBeNull();
  });

  /* One pane holds one view. Showing another chat in it moves the view rather
     than adding a second, which is what makes a pair of panes a window. */
  it('moves rather than doubles when another chat is shown in the same pane', () => {
    const { index, workspaceId } = project();
    const first = addConversation(index, { conversationId: 'chat-a', workspaceId, now: NOW });
    const second = addConversation(first.index, {
      conversationId: 'chat-b',
      workspaceId,
      now: NOW,
    });
    const one = noteView(second.index, { viewId: 'view-1', conversation: 'chat-a', pane: 0 });
    const two = noteView(one.index, { viewId: 'view-2', conversation: 'chat-b', pane: 0 });

    expect(Object.keys(two.index.views)).toEqual(['view-2']);
    expect(viewInPane(two.index, 0)?.conversation).toBe('chat-b');
  });

  it('is the same view when the same chat is opened in the same pane again', () => {
    const { index, workspaceId } = project();
    const chat = addConversation(index, { conversationId: 'chat-a', workspaceId, now: NOW });
    const one = noteView(chat.index, { viewId: 'view-1', conversation: 'chat-a', pane: 0 });
    const again = noteView(one.index, { viewId: 'view-1', conversation: 'chat-a', pane: 0 });

    expect(again.made).toBe(false);
    expect(again.index).toBe(one.index);
  });

  /* A view onto a chat nobody wrote down is a pane that fails on the press, so
     it is refused rather than stored. */
  it('is refused for a conversation the registry does not know', () => {
    const { index } = project();
    const refused = noteView(index, { viewId: 'view-1', conversation: 'nobody', pane: 0 });
    expect(refused.made).toBe(false);
    expect(refused.view).toBeNull();
    expect(refused.index).toBe(index);
  });

  it('keeps pane numbers scoped to their project and refuses foreign chats', () => {
    const firstRoot = scratch();
    const secondRoot = scratch();
    const firstProject = ensureProject(emptyIndex(), firstRoot);
    const firstWorkspace = addWorkspace(firstProject.index, {
      projectId: firstProject.project.projectId,
      path: firstRoot,
      kind: 'local',
      managed: false,
      now: NOW,
    });
    const firstChat = addConversation(firstWorkspace.index, {
      conversationId: 'first-chat',
      workspaceId: firstWorkspace.workspace.workspaceId,
      now: NOW,
    });
    const secondProject = ensureProject(firstChat.index, secondRoot);
    const secondWorkspace = addWorkspace(secondProject.index, {
      projectId: secondProject.project.projectId,
      path: secondRoot,
      kind: 'local',
      managed: false,
      now: NOW,
    });
    const secondChat = addConversation(secondWorkspace.index, {
      conversationId: 'second-chat',
      workspaceId: secondWorkspace.workspace.workspaceId,
      now: NOW,
    });

    const firstView = noteViewForProject(
      secondChat.index,
      { viewId: 'first-view', conversation: 'first-chat', pane: 0 },
      firstProject.project.projectId,
    );
    const both = noteViewForProject(
      firstView.index,
      { viewId: 'second-view', conversation: 'second-chat', pane: 0 },
      secondProject.project.projectId,
    );
    expect(viewInPaneForProject(both.index, 0, firstProject.project.projectId)?.conversation).toBe('first-chat');
    expect(viewInPaneForProject(both.index, 0, secondProject.project.projectId)?.conversation).toBe('second-chat');

    const refused = noteViewForProject(
      both.index,
      { viewId: 'foreign-view', conversation: 'second-chat', pane: 1 },
      firstProject.project.projectId,
    );
    expect(refused.made).toBe(false);
    expect(refused.index).toBe(both.index);
    expect(viewInProject(both.index, both.index.views['first-view']!, firstProject.project.projectId)).toBe(true);
  });

  it('is taken away with its pane, and the conversation is not', () => {
    const { index, workspaceId } = project();
    const chat = addConversation(index, { conversationId: 'chat-a', workspaceId, now: NOW });
    const two = noteView(
      noteView(chat.index, { viewId: 'view-1', conversation: 'chat-a', pane: 0 }).index,
      { viewId: 'view-2', conversation: 'chat-a', pane: 1 },
    ).index;

    // Closing one pane leaves the other view, and one conversation behind both.
    const left = dropView(two, 'view-1');
    expect(Object.keys(left.views)).toEqual(['view-2']);
    expect(conversationById(left, 'chat-a')).not.toBeNull();
    expect(dropView(left, 'view-1')).toBe(left);
  });

  it('goes with the conversation when it is deleted, every pane of it', () => {
    const { index, workspaceId } = project();
    const chat = addConversation(index, { conversationId: 'chat-a', workspaceId, now: NOW });
    const kept = addConversation(chat.index, { conversationId: 'chat-b', workspaceId, now: NOW });
    // Two views of the chat being deleted, and one of another one.
    const left = noteView(kept.index, { viewId: 'view-1', conversation: 'chat-a', pane: 0 });
    const right = noteView(left.index, { viewId: 'view-2', conversation: 'chat-a', pane: 1 });
    const other = noteView(right.index, { viewId: 'view-b', conversation: 'chat-b', pane: 0 });

    const after = dropViewsOf(other.index, 'chat-a');
    expect(Object.keys(after.views)).toEqual(['view-b']);
    // Nothing was there: an index with no view of that chat is left alone.
    expect(dropViewsOf(after, 'chat-a')).toBe(after);
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

  /* The bump that added views. A profile written before them is not an error
     and not a migration: it opens with the same rows and no views, which reads
     as the ordinary single-pane window it was. */
  it('reads a profile written before views existed as one with no views', () => {
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
        conversations: {
          'chat-a': {
            conversationId: 'chat-a',
            workspaceId: 'w1',
            projectId: 'p1',
            title: 'the hero',
            createdAt: NOW,
            updatedAt: NOW,
          },
        },
      }),
    );

    expect(read.problem).toBeNull();
    expect(read.index.version).toBe(INDEX_VERSION);
    expect(read.index.views).toEqual({});
    // And the rows it did have are all still there.
    expect(conversationById(read.index, 'chat-a')?.title).toBe('the hero');
    expect(viewInPane(read.index, 0)).toBeNull();
  });

  it('keeps a view through a round trip, and drops one onto a chat that is gone', () => {
    const root = scratch();
    const ensured = ensureProject(emptyIndex(), root);
    const added = addWorkspace(ensured.index, {
      projectId: ensured.project.projectId,
      path: root,
      kind: 'local',
      managed: false,
      now: NOW,
    });
    const chat = addConversation(added.index, {
      conversationId: 'chat-a',
      workspaceId: added.workspace.workspaceId,
      now: NOW,
    });
    const held = noteView(chat.index, { viewId: 'view-1', conversation: 'chat-a', pane: 1 });

    const read = parseIndex(serializeIndex(held.index));
    expect(read.problem).toBeNull();
    expect(viewInPane(read.index, 1)).toEqual({
      viewId: 'view-1',
      conversation: 'chat-a',
      pane: 1,
    });

    // A view pointing at a conversation this index does not hold is dropped:
    // there would be nothing to open, and a pane that fails on the press is
    // worse than a window that comes back with one.
    const orphan = parseIndex(
      JSON.stringify({ ...held.index, views: { 'view-1': { conversation: 'nobody', pane: 0 } } }),
    );
    expect(orphan.problem).toBeNull();
    expect(orphan.index.views).toEqual({});
    // And a pane number that is not one is not a pane.
    const odd = parseIndex(
      JSON.stringify({ ...held.index, views: { 'view-1': { conversation: 'chat-a', pane: 7 } } }),
    );
    expect(odd.index.views).toEqual({});
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

  it('refuses a version it does not know, and says the profile is newer', () => {
    const read = parseIndex(
      JSON.stringify({ version: 99, projects: {}, byRoot: {}, workspaces: {}, conversations: {} }),
    );
    expect(read.problem).not.toBeNull();
    // The difference matters: a file from a newer app is not corruption, and
    // an older build has to leave it alone rather than move it aside.
    expect(read.future).toBe(true);
  });

  it('does not call a damaged file a newer one', () => {
    expect(parseIndex('{ half a').future).toBe(false);
    expect(
      parseIndex(JSON.stringify({ version: 'one', projects: {} })).future,
    ).toBe(false);
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
