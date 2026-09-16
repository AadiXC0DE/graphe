// @vitest-environment jsdom
/** A draft in a chat nobody has sent in yet.
 *
 * Two New presses in one project are two chats, and both are real from the
 * moment they are pressed: the shell mints the conversation's own id at creation
 * and writes the registry row before the first word, and the press that asked
 * for the chat is the id it will really have. So the two chats are two keys for
 * a kept draft, and neither leaks into the other — nor into a third chat made
 * after a restart, which is where a name taken from a process-local counter
 * (`new-1`) used to hand somebody back a sentence they had left in another chat.
 *
 * Every step below is the shell's own order, driven through the real pieces: the
 * mint, the registry write, and the box that keeps what was typed. What is not
 * reachable from here is Electron's `main.ts`, which is where the mint is called
 * and where the id is chosen ahead of the transcript; the registry side of that
 * is held by `tests/conversation-identity.test.ts`.
 */

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import Composer, { draftKey } from '../src/components/Composer';
import { newConversationId } from '../src/domain/identity';
import {
  addConversation,
  addWorkspace,
  conversationById,
  emptyIndex,
  ensureProject,
  parseIndex,
  serializeIndex,
  type WorkspaceIndex,
} from '../electron/services/workspace-registry';

const NOW = 1_700_000_000_000;
const PROJECT = '/p/paper-street';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});

const open: { host: HTMLElement; root: Root }[] = [];

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  for (const one of open.splice(0)) {
    act(() => {
      one.root.unmount();
    });
    one.host.remove();
  }
});

/* ------------------------------------------------------------ scaffolding */

/** The project as the shell has it: one folder, one workspace. */
function project(): { index: WorkspaceIndex; workspaceId: string } {
  const ensured = ensureProject(emptyIndex(), PROJECT);
  const added = addWorkspace(ensured.index, {
    projectId: ensured.project.projectId,
    path: PROJECT,
    kind: 'local',
    managed: false,
    now: NOW,
  });
  return { index: added.index, workspaceId: added.workspace.workspaceId };
}

/** One press of New: the id the window names the press with, which is the id the
 *  chat is written down under before it has said anything. */
function press(index: WorkspaceIndex, workspaceId: string): { index: WorkspaceIndex; id: string } {
  const id = newConversationId();
  const made = addConversation(index, { conversationId: id, workspaceId, now: NOW });
  expect(made.made).toBe(true);
  return { index: made.index, id };
}

function draw(props: Record<string, unknown>): { host: HTMLElement; root: Root; close: () => void } {
  const host = document.createElement('div');
  host.className = 'app';
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(createElement(Composer, { onSend: () => undefined, ...props }));
  });
  const held = { host, root };
  open.push(held);
  return {
    host,
    root,
    close: () => {
      const at = open.indexOf(held);
      if (at !== -1) open.splice(at, 1);
      act(() => {
        root.unmount();
      });
      host.remove();
    },
  };
}

function boxIn(host: HTMLElement): HTMLTextAreaElement {
  const field = host.querySelector('textarea');
  if (field === null) throw new Error('the composer drew no box');
  return field;
}

/** Typing, the way React hears it. */
function type(field: HTMLTextAreaElement, text: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  if (setter === undefined) throw new Error('no value setter on a textarea');
  act(() => {
    setter.call(field, text);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** What one chat's box shows on the way back in. */
function reopen(id: string): string {
  const box = draw({ project: PROJECT, conversation: id });
  const shown = boxIn(box.host).value;
  box.close();
  return shown;
}

/* ========================================================================== */

describe('two New presses in one project', () => {
  it('are two chats with two ids, so a sentence left in one is not the other', () => {
    const started = project();
    let index = started.index;

    const first = press(index, started.workspaceId);
    index = first.index;
    const second = press(index, started.workspaceId);
    index = second.index;

    // Two presses, two names — nothing derived from how many chats the process
    // has made, which is what a counter restarting with the process got wrong.
    expect(first.id).not.toBe(second.id);
    expect(draftKey(PROJECT, first.id)).not.toBe(draftKey(PROJECT, second.id));
    expect(Object.keys(index.conversations)).toEqual([first.id, second.id]);

    const one = draw({ project: PROJECT, conversation: first.id });
    type(boxIn(one.host), 'the hero, in this chat');
    one.close();

    const two = draw({ project: PROJECT, conversation: second.id });
    // The second chat opens empty: the first chat's sentence is its own.
    expect(boxIn(two.host).value).toBe('');
    type(boxIn(two.host), 'the pricing page, in this one');
    two.close();

    expect(reopen(first.id)).toBe('the hero, in this chat');
    expect(reopen(second.id)).toBe('the pricing page, in this one');
  });

  it('keeps nothing at all while a chat has no id, rather than sharing one key', () => {
    // What the window draws before the shell has answered: no conversation yet.
    // A box that kept a draft here would keep it under the empty string, and
    // every never-sent chat in the project would read it back.
    const box = draw({ project: PROJECT, conversation: null });
    type(boxIn(box.host), 'nowhere to keep this yet');
    box.close();

    expect(localStorage.length).toBe(0);
  });
});

describe('the launch after two drafts were kept', () => {
  it('does not show either of them to a third New chat', () => {
    const started = project();
    let index = started.index;
    const first = press(index, started.workspaceId);
    index = first.index;
    const second = press(index, started.workspaceId);
    index = second.index;

    const one = draw({ project: PROJECT, conversation: first.id });
    type(boxIn(one.host), 'about the header');
    one.close();
    const two = draw({ project: PROJECT, conversation: second.id });
    type(boxIn(two.host), 'about the footer');
    two.close();

    /* The restart: what the registry wrote is read back off disk, and the launch
       presses New again. The drafts themselves are the window's, and they are
       still there — which is the point, because a chat that lost its sentence
       would pass this test for the wrong reason. */
    const relaunched = parseIndex(serializeIndex(index));
    expect(relaunched.problem).toBeNull();
    expect(conversationById(relaunched.index, first.id)).not.toBeNull();
    expect(conversationById(relaunched.index, second.id)).not.toBeNull();
    expect(reopen(first.id)).toBe('about the header');

    const third = press(relaunched.index, started.workspaceId);
    expect([first.id, second.id]).not.toContain(third.id);
    expect(reopen(third.id)).toBe('');
  });
});
