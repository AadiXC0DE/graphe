/** The app going away, and what has to be true by the time it has.
 *
 * 9.4 asks five things of a quit: stop accepting work, persist accepted queues
 * and drafts, request cancellation, wait a bounded interval for the flush, and
 * record the runs it interrupted — then terminate only the process groups it
 * owns. What is already held elsewhere is named so this file does not repeat it:
 *
 *  - the note written on the way out, and that it is on the disk before the
 *    call returns, is `tests/operations/app-quit.test.ts`;
 *  - the ledger, including a child that refuses to go, is `tests/processes.test.ts`;
 *  - the note read back on the next launch, and a copy that has gone, is
 *    `tests/surviving.test.ts`;
 *  - `stopAllNow`, and a register that refuses anything new afterwards, is
 *    `tests/running-limits.test.ts`.
 *
 * What is left is the two halves nobody has put together: that the *window's*
 * accepted work — the draft in the box, the send waiting behind a run — is on
 * the disk before the app goes, and that the events still in the batcher at the
 * moment of the quit are handed over rather than dropped with the process. The
 * first is the one that loses somebody their afternoon, and it is settled here
 * without a window by driving the two stores the window actually writes through
 * and the composer that feeds one of them.
 *
 * Not here, and said rather than faked: sleep/wake and a monitor or a network
 * change are real operating-system events. Nothing in this repository listens
 * for one — there is no `powerMonitor` and no `online`/`offline` handler to
 * drive — so a check would be asserting a handler that does not exist. What
 * happens across a sleep is the same thing that happens across a reload, and
 * that is driven for real in `tests/electron/smoke.test.ts`.
 */

// @vitest-environment jsdom

import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import Composer, { draftKey } from '../../src/components/Composer';
import { batcher } from '../../src/lib/batching';
import { drainQueued } from '../../src/lib/queue';
import type { AgentEvent, WaitingSend } from '../../src/agent/types';
import type { PieceOfWork } from '../../src/history/attempts';
import { PreferenceFile } from '../../src/projects/preferences';
import { Notebook } from '../../src/work/notebook';
import { noteOf, type Owner } from '../../src/work/written';

const made: string[] = [];

function scratch(what: string): string {
  const folder = mkdtempSync(join(tmpdir(), `graphe-life-${what}-`));
  made.push(folder);
  return folder;
}

afterAll(() => {
  for (const folder of made.splice(0)) rmSync(folder, { recursive: true, force: true });
});

const PROJECT = '/projects/paper-street';

/* ========================================================================== */
/* The sentence still in the box                                               */
/* ========================================================================== */

/** A window's own box, on a conversation of its own. What is asserted is where
 *  the words end up, not which of the two stores got them: a draft is accepted
 *  work, and a quit that loses it loses the sentence somebody was in the middle
 *  of writing. */
let root: Root | null = null;
let host: HTMLDivElement | null = null;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  // A test that fails part way through leaves the clock faked, and the next one
  // has nothing that would put it back.
  vi.useRealTimers();
});

afterEach(() => {
  if (root !== null) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

type Props = Parameters<typeof Composer>[0];

function draw(props: Partial<Props> = {}): HTMLTextAreaElement {
  host ??= document.createElement('div');
  if (host.parentNode === null) document.body.append(host);
  root ??= createRoot(host);
  act(() => {
    root?.render(createElement(Composer, { onSend: () => undefined, ...props }));
  });
  const field = host.querySelector('.composer__input');
  if (!(field instanceof HTMLTextAreaElement)) throw new Error('no box in the window');
  return field;
}

/** Type into the box the way a person does: the value, and the event the box
 *  listens for. `fill` on a textarea does both, and jsdom has no such helper. */
function type(field: HTMLTextAreaElement, text: string): void {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(field, text);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** The unmount is the window going away, so the draft that is written on the
 *  way out is written by the same cleanup a quit would run. */
function closeTheWindow(): void {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
}

describe('the sentence somebody was in the middle of writing', () => {
  it('is on the disk before the window goes, with no timer left to fire', () => {
    vi.useFakeTimers();
    // Typed and left. The debounce behind it is four hundred milliseconds, and
    // shutting the window inside that is the whole failure being tested.
    type(draw({ project: PROJECT, conversation: 'chat-1' }), 'make the pricing page');
    closeTheWindow();

    expect(localStorage.getItem(draftKey(PROJECT, 'chat-1'))).toBe('make the pricing page');
  });

  it('comes back in the box the next launch draws', () => {
    vi.useFakeTimers();
    type(draw({ project: PROJECT, conversation: 'chat-1' }), 'the header still overlaps');
    closeTheWindow();

    // A new sitting, the same conversation.
    const again = draw({ project: PROJECT, conversation: 'chat-1' });
    expect(again.value).toBe('the header still overlaps');
  });

  it('goes with the chat it was written in, and no other', () => {
    vi.useFakeTimers();
    type(draw({ project: PROJECT, conversation: 'chat-1' }), 'about the pricing page');
    closeTheWindow();

    const other = draw({ project: PROJECT, conversation: 'chat-2' });
    expect(other.value).toBe('');
    expect(localStorage.getItem(draftKey(PROJECT, 'chat-1'))).toBe('about the pricing page');
    expect(localStorage.getItem(draftKey(PROJECT, 'chat-2'))).toBeNull();
  });

  it('is dropped rather than kept when the box was emptied before the quit', () => {
    vi.useFakeTimers();
    const field = draw({ project: PROJECT, conversation: 'chat-1' });
    type(field, 'never mind');
    type(field, '');
    closeTheWindow();

    expect(localStorage.getItem(draftKey(PROJECT, 'chat-1'))).toBeNull();
  });

  it('costs the draft rather than the quit when storage refuses to write', () => {
    vi.useFakeTimers();
    const failing = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    try {
      type(draw({ project: PROJECT, conversation: 'chat-1' }), 'a sentence with nowhere to go');
      expect(() => closeTheWindow()).not.toThrow();
    } finally {
      failing.mockRestore();
    }
  });
});

/* ========================================================================== */
/* What the window has accepted and not yet seen happen                        */
/* ========================================================================== */

describe('a send waiting for the folder', () => {
  const waiting = (id: string): WaitingSend => ({
    id,
    text: `send ${id}`,
    workspace: '/copies/paper-street/work-1',
    ahead: 'chat-1',
  });

  it('comes off the line by its own id, so a quit cannot lose the wrong one', () => {
    // The two sends read alike; only the id tells them apart. A drain that
    // worked by wording would take both off, and one of the two would never be
    // sent by anybody.
    const line = [waiting('a'), waiting('b')];
    expect(drainQueued(line, 'a').map((one) => one.id)).toEqual(['b']);
    // An id that was never on the line is not a drain: it is a run that never
    // was queued, and treating it as one would silently empty the line.
    expect(drainQueued(line, 'never')).toEqual(line);
  });
});

/* ========================================================================== */
/* Accepted work on the disk, and what the next launch finds                   */
/* ========================================================================== */

const OURS: Owner = { pid: 4242, since: 1000 };

function piece(over: Partial<PieceOfWork> = {}): PieceOfWork {
  return {
    id: 'work-1',
    doing: 'Make the sign-in page work on a phone',
    state: 'running',
    folder: '/copies/paper-street/work-1',
    version: null,
    picture: null,
    at: 500,
    trouble: null,
    ...over,
  };
}

describe('the note written as the app goes', () => {
  it('records the run as cut short, on a real disk, readable by the next launch', () => {
    const root = scratch('quit');
    const book = new Notebook(root);
    // Exactly what `writeDownWhatWasGoing` (electron/main.ts:7152) writes: the
    // state it failed in, and the sentence that says why.
    book.noteNow(
      noteOf(
        { ...piece(), state: 'failed', trouble: 'This stopped when the app did.' },
        { project: PROJECT, name: 'paper-street', owner: OURS },
      ),
    );

    // Read the way the next launch reads it, off a fresh handle: no cache, no
    // in-memory shortcut.
    const page = readFileSync(onlyJson(book.pageFor(PROJECT)), 'utf8');
    expect(JSON.parse(page)).toMatchObject({
      version: 1,
      work: { id: 'work-1', state: 'failed', trouble: 'This stopped when the app did.' },
    });
  });

  it('leaves the draft beside it, so both halves of the quit survive together', async () => {
    const root = scratch('together');
    vi.useFakeTimers();
    type(draw({ project: PROJECT, conversation: 'chat-1' }), 'and then the pricing page');
    closeTheWindow();

    new Notebook(root).noteNow(
      noteOf(
        { ...piece(), state: 'failed', trouble: 'This stopped when the app did.' },
        { project: PROJECT, name: 'paper-street', owner: OURS },
      ),
    );

    // Two stores, one quit: what was said, and what was about to be said.
    expect(localStorage.getItem(draftKey(PROJECT, 'chat-1'))).toBe('and then the pricing page');
    expect(JSON.parse(readFileSync(onlyJson(new Notebook(root).pageFor(PROJECT)), 'utf8'))).toMatchObject(
      { work: { id: 'work-1' } },
    );
  });

  it('carries the state the quit wrote, so the board comes back honest', async () => {
    const root = scratch('again');
    // Written the way the quit writes it, then read by a fresh handle off the
    // disk — the only reading that settles "it is still there next time". The
    // write that cannot land at all is `app-quit.test.ts`'s.
    new Notebook(root).noteNow(
      noteOf(
        { ...piece(), state: 'failed', trouble: 'This stopped when the app did.' },
        { project: PROJECT, name: 'paper-street', owner: OURS },
      ),
    );

    const page = await new Notebook(root).page(PROJECT);
    expect(page).toHaveLength(1);
    expect(page[0]?.state).toBe('failed');
    expect(page[0]?.trouble).toBe('This stopped when the app did.');
  });
});

function onlyJson(page: string): string {
  const names = readdirSync(page).filter((one) => one.endsWith('.json'));
  expect(names).toHaveLength(1);
  return join(page, names[0] as string);
}

/* ========================================================================== */
/* Preferences accepted before the quit                                        */
/* ========================================================================== */

describe('a preference accepted a moment before the quit', () => {
  it('is on the disk when the write returns, rather than waiting for a timer', async () => {
    const root = scratch('prefs');
    const file = await PreferenceFile.open(join(root, 'preferences.json'));
    // What somebody changed, and the whole of what a quit has to have kept:
    // `change` returns once the file is written, not once it has been queued.
    await file.change({ showFiles: true });

    const back = await PreferenceFile.open(join(root, 'preferences.json'));
    expect(back.all().showFiles).toBe(true);
    expect(readdirSync(root).filter((one) => one.includes('writing'))).toEqual([]);
  });
});

/* ========================================================================== */
/* The last frame, both directions                                             */
/* ========================================================================== */

/** A clock that only moves when it is told to, so the tick is the thing under
 *  test rather than the machine's mood. */
function fakeClock(): { now: () => number; after: (ms: number, run: () => void) => number; stop: (timer: number) => void; tick: (ms: number) => void } {
  let at = 0;
  const due = new Map<number, { at: number; run: () => void }>();
  let next = 0;
  return {
    now: () => at,
    after(ms, run) {
      next += 1;
      due.set(next, { at: at + ms, run });
      return next;
    },
    stop(timer) {
      due.delete(timer);
    },
    tick(ms) {
      at += ms;
      for (const [id, one] of [...due]) {
        if (one.at > at) continue;
        due.delete(id);
        one.run();
      }
    },
  };
}

const delta = (text: string): AgentEvent => ({ type: 'message-delta', text });

describe('the last frame at the quit', () => {
  it('hands over what is waiting, once, so the last thing said is not lost', () => {
    const clock = fakeClock();
    const sent: unknown[][] = [];
    const wire = batcher((frames) => sent.push([...frames]), 16, clock);

    wire.push({ project: PROJECT, conversation: 'chat-1', event: delta('the last thing ') });
    wire.push({ project: PROJECT, conversation: 'chat-1', event: delta('it was saying') });
    expect(sent).toHaveLength(0);

    // `before-quit` calls `wire.flush()` (electron/main.ts:11828) for exactly
    // this: the tick never comes, and the deltas in hand go with the process.
    wire.flush();
    expect(sent).toHaveLength(1);
    const [frame] = sent[0] as { conversation: string | null; events: AgentEvent[] }[];
    // Welded into one delta and in order: what the quit hands over is what the
    // window would have been given had it lived another frame, which is the
    // reason the flush exists at all.
    expect(frame?.events).toEqual([
      { type: 'message-delta', text: 'the last thing it was saying' },
    ]);

    // And it is not handed over twice, which would be the same words said twice.
    wire.flush();
    expect(sent).toHaveLength(1);
    expect(JSON.stringify(sent[0])).toContain('the last thing it was saying');
  });

  it('keeps every conversation in its own frame while it does', () => {
    const clock = fakeClock();
    const sent: unknown[][] = [];
    const wire = batcher((frames) => sent.push([...frames]), 16, clock);

    wire.push({ project: PROJECT, conversation: 'chat-1', event: delta('mine') });
    wire.push({ project: PROJECT, conversation: 'chat-2', event: delta('theirs') });
    wire.flush();

    const frames = sent[0] as { conversation: string | null }[];
    expect(frames.map((one) => one.conversation).sort()).toEqual(['chat-1', 'chat-2']);
  });
});
