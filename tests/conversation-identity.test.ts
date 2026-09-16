/** A chat nobody has sent in has an id of its own.
 *
 * A conversation's identity used to be the Pi transcript it was being written
 * into, and before there was one, a counter that restarts with the process —
 * `new-N`. Both are attributes of a conversation rather than the conversation,
 * and both leaked: two never-sent chats in one project shared a draft key,
 * because the window wrote "no address yet" as the empty string, and a draft
 * kept under `new-1` could resurface in a later launch's new chat.
 *
 * What is asserted here is the registry side of the fix: an id is minted for the
 * chat, the transcript is attached to that id rather than being it, and the two
 * names a conversation can be asked for resolve to one record.
 */

import { describe, expect, it } from 'vitest';

import {
  addConversation,
  addWorkspace,
  conversationById,
  conversationInFile,
  emptyIndex,
  ensureProject,
  updateConversation,
  workspaceForConversation,
} from '../electron/services/workspace-registry';

const NOW = 1_700_000_000_000;

/** A project with one workspace, which is all any of this needs. */
function project() {
  const ensured = ensureProject(emptyIndex(), '/p/paper-street');
  const added = addWorkspace(ensured.index, {
    projectId: ensured.project.projectId,
    path: '/p/paper-street',
    kind: 'local',
    managed: false,
    now: NOW,
  });
  return { index: added.index, workspaceId: added.workspace.workspaceId };
}

describe('a conversation nobody has sent in', () => {
  it('is written down under an id of its own, before it has a transcript', () => {
    const { index, workspaceId } = project();
    const made = addConversation(index, {
      conversationId: 'conversation-1',
      workspaceId,
      now: NOW,
    });

    expect(made.made).toBe(true);
    expect(made.conversation.conversationId).toBe('conversation-1');
    expect(made.conversation.sessionFile).toBeNull();
    // Which is the point: the id is not the transcript, and it is not null.
    expect(made.conversation.conversationId).not.toBe('');
  });

  /* Two chats made in one project are two chats, whatever order they were made
     in and whatever the process was doing at the time. */
  it('is a different chat from another one made beside it', () => {
    const { index, workspaceId } = project();
    const one = addConversation(index, { conversationId: 'conversation-1', workspaceId, now: NOW });
    const two = addConversation(one.index, {
      conversationId: 'conversation-2',
      workspaceId,
      now: NOW,
    });

    expect(two.made).toBe(true);
    expect(conversationById(two.index, 'conversation-1')).not.toBeNull();
    expect(conversationById(two.index, 'conversation-2')).not.toBeNull();
  });
});

describe('the transcript a conversation is written in', () => {
  /* Pi writes the file; the conversation keeps the id it already had. */
  it('is attached to the id rather than being it', () => {
    const { index, workspaceId } = project();
    const made = addConversation(index, {
      conversationId: 'conversation-1',
      workspaceId,
      now: NOW,
    });
    const written = updateConversation(made.index, 'conversation-1', {
      sessionFile: '/sessions/talk-1.jsonl',
    });

    const held = conversationById(written, 'conversation-1');
    expect(held?.conversationId).toBe('conversation-1');
    expect(held?.sessionFile).toBe('/sessions/talk-1.jsonl');
    // One row, not two: attaching a file must not make a second conversation.
    expect(Object.keys(written.conversations)).toEqual(['conversation-1']);
  });

  /* The file is how a listing, a resume and a checkout row name a conversation,
     so it still has to find the record — and find the same one. */
  it('finds the conversation it was attached to, by either name', () => {
    const { index, workspaceId } = project();
    const made = addConversation(index, {
      conversationId: 'conversation-1',
      workspaceId,
      now: NOW,
    });
    const written = updateConversation(made.index, 'conversation-1', {
      sessionFile: '/sessions/talk-1.jsonl',
    });

    expect(conversationById(written, '/sessions/talk-1.jsonl')?.conversationId).toBe(
      'conversation-1',
    );
    expect(conversationInFile(written, '/sessions/talk-1.jsonl')?.conversationId).toBe(
      'conversation-1',
    );
    expect(workspaceForConversation(written, '/sessions/talk-1.jsonl')?.workspaceId).toBe(
      workspaceId,
    );
  });

  /* A profile written before ids existed files a conversation under its
     transcript. Opening it must land on that row, not on a second one beside it
     pointing at the same file. */
  it('keeps an older profile one conversation when it is opened again', () => {
    const { index, workspaceId } = project();
    const legacy = addConversation(index, {
      conversationId: '/sessions/old.jsonl',
      workspaceId,
      now: NOW,
    });
    const written = updateConversation(legacy.index, '/sessions/old.jsonl', {
      sessionFile: '/sessions/old.jsonl',
    });

    expect(conversationById(written, '/sessions/old.jsonl')).not.toBeNull();
    expect(Object.keys(written.conversations)).toEqual(['/sessions/old.jsonl']);
  });

  /* An update aimed at the file must change the record rather than silently do
     nothing — that is how a name typed into the shelf would go missing. */
  it('changes the record however the conversation is named', () => {
    const { index, workspaceId } = project();
    const made = addConversation(index, {
      conversationId: 'conversation-1',
      workspaceId,
      now: NOW,
    });
    const written = updateConversation(made.index, 'conversation-1', {
      sessionFile: '/sessions/talk-1.jsonl',
    });
    const renamed = updateConversation(written, '/sessions/talk-1.jsonl', { title: 'the hero' });

    expect(conversationById(renamed, 'conversation-1')?.title).toBe('the hero');
    expect(Object.keys(renamed.conversations)).toEqual(['conversation-1']);
  });
});
