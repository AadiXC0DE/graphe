/** An address survives every move a conversation makes.
 *
 * A conversation is known by one id for the whole of its life, and the id is
 * what everything is filed under — the registry row, a checkout row, a draft key,
 * the run note. Its transcript path is the *other* name it can carry, and a
 * profile written before ids existed files a conversation under exactly that, with
 * no `sessionFile` of its own.
 *
 * So resolving a session's address by the `sessionFile` field alone missed those
 * rows and minted a second id for one transcript, which is a second conversation
 * the same chat is billed and resumed as. What is asserted here is the two halves
 * of the resolution: `conversationById` finds a row by either name, and the
 * shell's `addressFor` is what uses it.
 *
 *  Source text for `addressFor`, which lives in Electron's `main.ts` and cannot be
 *  imported here; the registry half beneath it is behavioural.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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
const MAIN = readFileSync(join(process.cwd(), 'electron', 'main.ts'), 'utf8');

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

describe('a conversation filed under its transcript', () => {
  /* The shape a profile from before ids existed has: the key is the path, and
     there is no `sessionFile` field to find it by. */
  it('is found by the file it is named after, which the field alone would miss', () => {
    const { index, workspaceId } = project();
    const legacy = addConversation(index, {
      conversationId: '/sessions/talk-1.jsonl',
      workspaceId,
      now: NOW,
    });

    // The field is null, so a lookup by field finds nothing at all.
    expect(conversationInFile(legacy.index, '/sessions/talk-1.jsonl')).toBeNull();
    // The row is there under the name it was written with, and that is the one
    // resolution that keeps one transcript one conversation.
    expect(conversationById(legacy.index, '/sessions/talk-1.jsonl')?.conversationId).toBe(
      '/sessions/talk-1.jsonl',
    );
    expect(workspaceForConversation(legacy.index, '/sessions/talk-1.jsonl')?.workspaceId).toBe(
      workspaceId,
    );
  });

  /* And it stays one row once the transcript is attached: a chat written down
     under an id and then given its file is found by both names, the same row. */
  it('is one row however it is asked for, once the transcript is attached', () => {
    const { index, workspaceId } = project();
    const made = addConversation(index, { conversationId: 'conversation-1', workspaceId, now: NOW });
    const written = updateConversation(made.index, 'conversation-1', {
      sessionFile: '/sessions/talk-1.jsonl',
    });

    const byId = conversationById(written, 'conversation-1');
    const byFile = conversationById(written, '/sessions/talk-1.jsonl');
    expect(byId).not.toBeNull();
    expect(byFile).toBe(byId);
    // One row, not two: attaching a file is not a second conversation.
    expect(Object.keys(written.conversations)).toEqual(['conversation-1']);
  });
});

describe('the shell resolving a session address', () => {
  it('asks by either name, rather than by the transcript field alone', () => {
    const start = MAIN.slice(
      MAIN.indexOf('function addressFor('),
      MAIN.indexOf('/**\n * A checkout row filed under the name'),
    );
    expect(start).not.toBe('');
    // `conversationById` is the lookup that answers to both names; the field-only
    // one would have missed every row an older profile wrote.
    expect(start).toContain('conversationById(workspaceIndex, file)');
    expect(start).not.toContain('conversationInFile(workspaceIndex, file)');
    // And a session with no file yet still gets an id of its own rather than the
    // empty string, which is what a never-sent chat is addressed by.
    expect(start).toContain('newAddress()');
  });
});
