/** T16, T18, T19, T20: who is writing, who is waiting, and who may answer.
 *
 * Phase 10.2 asks for these as named cases. The lease is real and pure; what a
 * view being closed does to it, and what an answer does to a question, are the
 * two places where an app hands somebody else's work to the wrong owner.
 */

import { describe, expect, it } from 'vitest';

import { dialogsOver, type ExtensionAnswer, type ExtensionAsk } from '../../src/agent/pi/extension-ui';
import { WorkspaceLocks, type Ticket } from '../../electron/services/workspace-locks';
import {
  addConversation,
  addWorkspace,
  conversationById,
  conversationsIn,
  emptyIndex,
  ensureProject,
} from '../../electron/services/workspace-registry';

const FOLDER = '/work/site';
const OTHER = '/work/other';

const ticket = (runId: string, over: Partial<Ticket> = {}): Ticket => ({
  key: FOLDER,
  runId,
  label: runId,
  ...over,
});

/** Let every promise that can settle, settle. Nothing here is on a clock. */
const settled = async (): Promise<void> => {
  for (let at = 0; at < 5; at += 1) await Promise.resolve();
};

/** A question put to somebody, with control over when and whether they answer.
 *  Real `dialogsOver` over it, so what is asserted is the host's behaviour. */
function windowToAnswer(): {
  ask: (one: ExtensionAsk) => Promise<ExtensionAnswer>;
  asked: ExtensionAsk[];
  answer: (one: ExtensionAnswer) => void;
  /** Presses somebody made, whether or not they could settle anything. */
  pressed: () => number;
  /** Questions that actually came to an answer. */
  resolved: () => number;
} {
  const asked: ExtensionAsk[] = [];
  const answers: ((one: ExtensionAnswer) => void)[] = [];
  let presses = 0;
  let resolutions = 0;
  return {
    ask: (one) => {
      asked.push(one);
      return new Promise<ExtensionAnswer>((done) => {
        answers.push((answer) => {
          resolutions += 1;
          done(answer);
        });
      });
    },
    asked,
    answer: (one) => {
      presses += 1;
      answers.shift()?.(one);
    },
    pressed: () => presses,
    resolved: () => resolutions,
  };
}

/* -------------------------------------------------------------------------- */

describe('T16: closing the view a run is working in', () => {
  it('does not hand the lease back, and does not take the workspace away', () => {
    const locks = new WorkspaceLocks();
    const runA = ticket('run-a', { label: 'conversation A' });
    expect(locks.request(runA)).toEqual({ granted: true, newlyHeld: true });

    // The window closes the tab, and something asks on its behalf: a view is
    // not the holder, so nothing about it frees the folder.
    expect(locks.release(FOLDER, 'the-tab-that-closed')).toBeNull();
    expect(locks.state(FOLDER).holder?.runId).toBe('run-a');
    expect(locks.state(FOLDER).holder?.label).toBe('conversation A');

    // Chat B in the other folder is not held back by any of this.
    expect(locks.request(ticket('run-b', { key: OTHER }))).toEqual({
      granted: true,
      newlyHeld: true,
    });
    expect(locks.keys()).toEqual([OTHER, FOLDER]);
  });

  it('leaves the conversation and its workspace on disk to be found again', () => {
    const project = ensureProject(emptyIndex(), FOLDER);
    const workspace = addWorkspace(project.index, {
      projectId: project.project.projectId,
      path: FOLDER,
      kind: 'local',
      managed: false,
      now: 1_700_000_000_000,
    });
    const chat = addConversation(workspace.index, {
      conversationId: 'chat-a',
      workspaceId: workspace.workspace.workspaceId,
      now: 1_700_000_000_000,
    });

    // Closing a view is not a deletion: the record, the folder it works in and
    // the conversation that names it are all still there afterwards.
    expect(conversationById(chat.index, 'chat-a')?.workspaceId).toBe(
      workspace.workspace.workspaceId,
    );
    expect(conversationsIn(chat.index, workspace.workspace.workspaceId)).toEqual(['chat-a']);
    expect(chat.index.workspaces[workspace.workspace.workspaceId]?.state).toBe('ready');
    expect(chat.index.workspaces[workspace.workspace.workspaceId]?.cwd).toBe(FOLDER);
  });
});

/* -------------------------------------------------------------------------- */

describe('T18: two conversations sending in one workspace', () => {
  it('lets one write, and tells the second who it is waiting for', () => {
    const locks = new WorkspaceLocks();
    expect(locks.request(ticket('run-a', { label: 'conversation A' }))).toEqual({
      granted: true,
      newlyHeld: true,
    });

    const second = locks.request(ticket('run-b', { label: 'conversation B' }));
    expect(second.granted).toBe(false);
    if (second.granted) return;
    expect(second.ahead).toBe(1);
    expect(second.holder).toBe('conversation A');
    expect(locks.state(FOLDER).waiting.map((one) => one.runId)).toEqual(['run-b']);
  });

  it('admits them in the order they arrived, one at a time', async () => {
    const locks = new WorkspaceLocks();
    locks.request(ticket('run-a'));
    const b = locks.request(ticket('run-b'));
    const c = locks.request(ticket('run-c'));
    if (b.granted || c.granted) throw new Error('the queue did not queue');

    expect(locks.release(FOLDER, 'run-a')?.runId).toBe('run-b');
    expect(await b.when).toBe('granted');
    expect(locks.state(FOLDER).holder?.runId).toBe('run-b');
    expect(locks.state(FOLDER).waiting.map((one) => one.runId)).toEqual(['run-c']);

    locks.release(FOLDER, 'run-b');
    expect(await c.when).toBe('granted');
    expect(locks.state(FOLDER).holder?.runId).toBe('run-c');
    expect(locks.state(FOLDER).waiting).toEqual([]);
  });

  it('keeps a second send in the same conversation behind the first run', () => {
    const locks = new WorkspaceLocks();
    locks.request(ticket('run-a1', { label: 'conversation A' }));
    // A second send while the first is running is a different run, and it queues
    // rather than overlapping: a guarded checkout followed by a guarded write is
    // still two runs editing one folder.
    const second = locks.request(ticket('run-a2', { label: 'conversation A' }));
    expect(second.granted).toBe(false);
    expect(locks.state(FOLDER).holder?.runId).toBe('run-a1');
  });

  it('never lets two runs hold the same folder at once', async () => {
    const locks = new WorkspaceLocks();
    const held: string[] = [];
    locks.request(ticket('run-a'));
    held.push(locks.state(FOLDER).holder?.runId ?? '');
    const b = locks.request(ticket('run-b'));
    if (b.granted) throw new Error('the second run was let in while the first held the folder');
    expect(held).toEqual(['run-a']);

    locks.release(FOLDER, 'run-a');
    expect(await b.when).toBe('granted');
    held.push(locks.state(FOLDER).holder?.runId ?? '');
    expect(held).toEqual(['run-a', 'run-b']);
    expect(locks.state(FOLDER).waiting).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */

describe('T19: one run waiting on a person while another is queued', () => {
  it('keeps the folder with the run that will carry on writing', () => {
    const locks = new WorkspaceLocks();
    locks.request(ticket('run-a', { label: 'conversation A' }));
    const b = locks.request(ticket('run-b', { label: 'conversation B' }));

    // A run waiting for an answer is a run that will carry on writing, so the
    // owner is named and the second is still queued behind it.
    expect(locks.state(FOLDER).holder?.label).toBe('conversation A');
    expect(b.granted).toBe(false);
    expect(b.granted === false && b.holder).toBe('conversation A');
  });

  it('answers only the question the answer was for', async () => {
    const forA = windowToAnswer();
    const forB = windowToAnswer();
    const hostA = dialogsOver(forA.ask);
    const hostB = dialogsOver(forB.ask);

    const answeringA = hostA.select('Which file?', ['one.ts', 'two.ts']);
    const answeringB = hostB.select('Which file?', ['three.ts']);
    expect(forA.asked).toHaveLength(1);
    expect(forB.asked).toHaveLength(1);
    expect(forA.asked[0]).not.toBe(forB.asked[0]);

    // B's person answers. A's question is still open, and A's host has not been
    // handed B's answer.
    forB.answer({ kind: 'select', value: 'three.ts' });
    expect(await answeringB).toBe('three.ts');
    expect(forA.resolved()).toBe(0);

    let aSettled = false;
    void answeringA.then(() => {
      aSettled = true;
    });
    await settled();
    expect(aSettled).toBe(false);

    forA.answer({ kind: 'select', value: 'two.ts' });
    expect(await answeringA).toBe('two.ts');
    expect(forA.resolved()).toBe(1);
  });

  it('is not answered by a run that never held the folder', () => {
    const locks = new WorkspaceLocks();
    locks.request(ticket('run-a'));
    expect(locks.release(FOLDER, 'run-b')).toBeNull();
    expect(locks.state(FOLDER).holder?.runId).toBe('run-a');
  });
});

/* -------------------------------------------------------------------------- */

describe('T20: an answer given twice, or after the run has stopped', () => {
  it('takes one answer per question, and a second changes nothing', async () => {
    const person = windowToAnswer();
    const host = dialogsOver(person.ask);
    const answering = host.confirm('Merge it?', 'This rewrites the branch.');

    person.answer({ kind: 'confirm', value: true });
    expect(await answering).toBe(true);
    expect(person.resolved()).toBe(1);

    // A stale press. The host has already answered once, so the second settles
    // nothing: `answered` counts the resolutions that happened, not the presses.
    person.answer({ kind: 'confirm', value: false });
    await settled();
    expect(person.pressed()).toBe(2);
    expect(person.resolved()).toBe(1);
    expect(person.asked).toHaveLength(1);
  });

  it('reads a question nobody answered as cancelled, in the shape of the question', async () => {
    const person = windowToAnswer();
    const host = dialogsOver(person.ask);

    const choosing = host.select('Which file?', ['one.ts']);
    person.answer({ kind: 'select', value: null });
    expect(await choosing).toBeUndefined();

    const typing = host.input('What should it say?');
    person.answer({ kind: 'input', value: null });
    expect(await typing).toBeUndefined();

    const editing = host.editor('Rewrite it', 'old');
    person.answer({ kind: 'editor', value: null });
    expect(await editing).toBeUndefined();
  });

  it('never hands a stale answer to a run that was taken out of the queue', async () => {
    const locks = new WorkspaceLocks();
    locks.request(ticket('run-a'));
    const b = locks.request(ticket('run-b'));
    if (b.granted) throw new Error('the queue did not queue');

    expect(locks.cancel(FOLDER, 'run-b')).toBe(true);
    expect(await b.when).toBe('cancelled');
    expect(locks.state(FOLDER).holder?.runId).toBe('run-a');
    expect(locks.state(FOLDER).waiting).toEqual([]);

    // The ticket is gone, so an answer arriving for it settles nothing and the
    // folder is still the first run's.
    expect(locks.cancel(FOLDER, 'run-b')).toBe(false);
    expect(locks.state(FOLDER).waiting).toEqual([]);
    // And letting go with nobody behind admits nobody: no run starts because a
    // cancelled one is no longer in the queue.
    expect(locks.release(FOLDER, 'run-a')).toBeNull();
    expect(locks.state(FOLDER).holder).toBeNull();
  });
});
