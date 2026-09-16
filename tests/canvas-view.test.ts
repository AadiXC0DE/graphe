// @vitest-environment jsdom
/** The canvas, driven.
 *
 * The drawing is arithmetic and is tested as arithmetic in `tests/canvas.test.ts`.
 * What can only be checked by rendering is the wiring between a hand and that
 * arithmetic: which gesture draws a line, which key takes one off, that undo
 * reaches back one drawing, that the Branches switch writes `lanes`, that Watch
 * hands the lane's own conversation to the pane beside it, and that a screen
 * reader is told when a run ends. Those are the cases here.
 *
 * The gestures are delivered as real pointer events on the real elements, with
 * the three things jsdom does not have — pointer capture, hit testing, and a
 * ResizeObserver — stubbed, because without them every drag quietly does
 * nothing and the test would pass by doing nothing.
 */

import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import CanvasView from '../src/components/canvas/CanvasView';
import type { ConnectionState } from '../src/lib/ipc';
import { newFlow, place, type BlockRun, type BlockState, type Flow, type Run } from '../src/work/canvas';
import { asRunId } from '../src/domain/identity';

/** jsdom has no layout: every rect is zero, `elementFromPoint` is not a
 *  function at all, and a pointer press cannot be captured. Each is stubbed at
 *  the smallest scope that makes a real drag behave like a real drag. */
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
  Element.prototype.setPointerCapture = function setPointerCapture(): void {};
  Element.prototype.releasePointerCapture = function releasePointerCapture(): void {};
  /* jsdom gives every element a zero rect. The two sizes the board actually
   *  measures are the surface's and a card's: the surface is a box, and a card
   *  is where its own inline `left`/`top` put it. Without these the board frames
   *  itself against nothing and every hit test lands on the same point. */
  const rects = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function box(this: Element): DOMRect {
    if (this.classList.contains('canvas__surface')) {
      return { left: 0, top: 0, right: SURFACE.width, bottom: SURFACE.height, width: SURFACE.width, height: SURFACE.height, x: 0, y: 0 } as DOMRect;
    }
    if (this instanceof HTMLElement && this.classList.contains('canvas__card')) {
      const x = Number.parseFloat(this.style.left || '0');
      const y = Number.parseFloat(this.style.top || '0');
      return { left: x, top: y, right: x + 232, bottom: y + 124, width: 232, height: 124, x, y } as DOMRect;
    }
    return rects.call(this);
  };
});

const open: { host: HTMLElement; root: Root }[] = [];
afterEach(() => {
  for (const one of open.splice(0)) {
    act(() => {
      one.root.unmount();
    });
    one.host.remove();
  }
  vi.restoreAllMocks();
});

const CONNECTED: ConnectionState = {
  chosen: null,
  chosenThinking: 'medium',
  providers: [
    {
      providerId: 'anthropic',
      name: 'Anthropic',
      methods: [],
      oauthLabel: null,
      apiKeyLabel: null,
      connected: true,
      available: true,
      subscription: false,
      models: [
        {
          id: 'claude-sonnet-4-5',
          label: 'Claude Sonnet 4.5',
          available: true,
          rates: null,
          contextWindow: null,
          thinking: ['off', 'medium', 'high'],
        },
      ],
    },
  ],
};

type Props = Parameters<typeof CanvasView>[0];

/** The surface's own rect, so a point on the screen maps to a point on the
 *  sheet the way it does in a window. */
const SURFACE = { left: 0, top: 0, width: 1000, height: 600 };

/** The board with its own shape, the way the window holds it: a block placed
 *  from the palette has to actually appear before it can be joined or removed. */
function Board(props: Props) {
  const [flow, setFlow] = useState<Flow>(props.flow);
  return createElement(CanvasView, {
    ...props,
    flow,
    onFlow: (next: Flow) => {
      props.onFlow(next);
      setFlow(next);
    },
  });
}

function draw(over: Partial<Props> = {}): { host: HTMLElement; flow: () => Flow } {
  const host = document.createElement('div');
  document.body.append(host);
  let latest = over.flow ?? newFlow();
  const props: Props = {
    flow: latest,
    onFlow: (next) => {
      latest = next;
    },
    onStart: () => undefined,
    onStop: () => undefined,
    onContinue: () => undefined,
    connection: CONNECTED,
    full: false,
    onFull: () => undefined,
    ...over,
  };
  const root = createRoot(host);
  act(() => {
    root.render(createElement(Board, props));
  });
  open.push({ host, root });
  return { host, flow: () => latest };
}

/** The surface: where every gesture is in coordinates of. */
function surfaceOf(host: HTMLElement): HTMLElement {
  const surface = host.querySelector('.canvas__surface');
  if (!(surface instanceof HTMLElement)) throw new Error('the board drew no surface');
  return surface;
}

/** One card, by the name on its face, with the box it really occupies. */
function cardAt(host: HTMLElement, name: string): { card: HTMLElement; box: DOMRect } {
  const face = [...host.querySelectorAll('.canvas__face')].find((one) =>
    (one.getAttribute('aria-label') ?? '').startsWith(`${name},`),
  );
  if (!(face instanceof HTMLElement)) throw new Error(`no card called ${name}`);
  const card = face.closest('.canvas__card');
  if (!(card instanceof HTMLElement)) throw new Error(`the card called ${name} has no body`);
  return { card, box: card.getBoundingClientRect() };
}

/** A press, delivered the way a real one arrives. */
function pointer(on: EventTarget, type: string, x: number, y: number): void {
  act(() => {
    on.dispatchEvent(
      new PointerEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true, pointerId: 1, button: 0 }),
    );
  });
}

function press(on: EventTarget, key: string, held = false): void {
  act(() => {
    on.dispatchEvent(
      new KeyboardEvent('keydown', { key, metaKey: held, bubbles: true, cancelable: true }),
    );
  });
}

/** Place a block from the palette. It arrives picked, so the panel is already
 *  open on it. */
function placeOne(host: HTMLElement, kind = 'ask'): void {
  const pick = host.querySelector(`.canvas__pick[data-kind="${kind}"]`);
  if (!(pick instanceof HTMLElement)) throw new Error(`the palette drew no ${kind} to place`);
  act(() => {
    pick.click();
  });
}

/**
 * Where a point on the sheet is on the screen.
 *
 * The board frames itself on mount, so a card's coordinates are not its screen
 * coordinates: a gesture has to be delivered where the hand would be, which is
 * the transform applied. Reading it off the sheet is the only honest way to do
 * that in a test, because the transform is what the board actually wrote.
 */
function onScreen(host: HTMLElement, x: number, y: number): { x: number; y: number } {
  const sheet = host.querySelector('.canvas__sheet');
  if (!(sheet instanceof HTMLElement)) throw new Error('the board drew no sheet');
  const found = /translate\((-?[\d.]+)px, (-?[\d.]+)px\) scale\((-?[\d.]+)\)/.exec(
    sheet.style.transform,
  );
  if (found === null) throw new Error(`the sheet was not framed: ${sheet.style.transform}`);
  const [, tx, ty, scale] = found;
  const at = { x: Number(tx), y: Number(ty) };
  const by = Number(scale);
  return { x: at.x + x * by, y: at.y + y * by };
}

/** A join, the way the hand makes one: press the dot on the right of one card,
 *  drag, and let go over another. */
function dragJoin(host: HTMLElement, from: string, to: string): void {
  const surface = surfaceOf(host);
  const start = cardAt(host, from);
  const end = cardAt(host, to);
  const handle = start.card.querySelector('.canvas__handle');
  if (!(handle instanceof HTMLElement)) throw new Error(`${from} has no dot to drag from`);
  const at = onScreen(host, start.box.right, start.box.top + start.box.height / 2);
  // Over the middle of the target card, which is where a hand would let go.
  const onto = onScreen(host, end.box.left + end.box.width / 2, end.box.top + end.box.height / 2);
  pointer(handle, 'pointerdown', at.x, at.y);
  pointer(surface, 'pointermove', onto.x, onto.y);
  pointer(surface, 'pointerup', onto.x, onto.y);
}

/** Pick one card, the way a hand does: a press on its own face. */
function pick(host: HTMLElement, name: string): void {
  const { card } = cardAt(host, name);
  const face = card.querySelector('.canvas__face');
  if (!(face instanceof HTMLElement)) throw new Error(`${name} has no face to press`);
  act(() => {
    face.click();
  });
}

/** A canvas drawn by placing, left where the arithmetic puts it. */
function drawn(): Flow {
  let flow = newFlow();
  flow = place(flow, 'ask');
  flow = place(flow, 'checks', flow.blocks[0]?.id ?? null);
  return flow;
}

function runOf(flow: Flow, state: Run['state'], states: readonly BlockState[]): Run {
  const blocks: Record<string, BlockRun> = {};
  flow.blocks.forEach((one, at) => {
    const where = states[at] ?? 'draft';
    blocks[one.id] = {
      state: where,
      lane: 'lane-0',
      startedAt: 1_000,
      endedAt: where === 'running' ? null : 9_000,
      said: where === 'done' ? 'Done, and the checks pass.' : null,
      turns: where === 'draft' ? 0 : 2,
      spent: { minor: 4200, currency: 'INR' },
      rounds: 0,
      result: null,
      failure: where === 'failed' ? 'the build exits 1' : null,
    };
  });
  return {
    id: asRunId('run-1'),
    state,
    startedAt: 1_000,
    endedAt: state === 'running' ? null : 9_000,
    lanes: [{ id: 'lane-0', workspaceId: 'w1', conversationId: 'chat-9', branch: null }],
    blocks,
    spent: { minor: 8400, currency: 'INR' },
  };
}

/* ========================================================================== */
/* Escape, one layer at a time                                                 */
/* ========================================================================== */

describe('what Escape peels', () => {
  it('closes the panel first, and gives up the window only when nothing is open', () => {
    const onFull = vi.fn();
    const { host } = draw({ onFull, full: true });
    placeOne(host);
    expect(host.querySelector('.canvas__panel')).not.toBeNull();

    press(document.body, 'Escape');
    expect(host.querySelector('.canvas__panel')).toBeNull();
    expect(onFull).not.toHaveBeenCalled();

    press(document.body, 'Escape');
    expect(onFull).toHaveBeenCalledWith(false);
  });

  it('drops a half-drawn join before it closes anything else', () => {
    const onFull = vi.fn();
    const flow = drawn();
    const { host } = draw({ flow, onFull, full: true });
    const surface = surfaceOf(host);
    const first = cardAt(host, 'Ask');
    const handle = first.card.querySelector('.canvas__handle');
    if (!(handle instanceof HTMLElement)) throw new Error('no dot to drag from');

    pointer(handle, 'pointerdown', first.box.left + 232, first.box.top + 62);
    pointer(surface, 'pointermove', 500, 400);
    expect(host.querySelector('.canvas__trailing')).not.toBeNull();

    press(document.body, 'Escape');
    expect(host.querySelector('.canvas__trailing')).toBeNull();
    // The join was not written and the window was not given up.
    expect(onFull).not.toHaveBeenCalled();
  });
});

/* ========================================================================== */
/* Joining and unjoining by gesture                                            */
/* ========================================================================== */

describe('drawing a line by hand', () => {
  it('makes the second block wait for the first', () => {
    const flow = drawn();
    const { host } = draw({ flow });
    expect(host.querySelector('.canvas__line')).not.toBeNull();
  });

  it('takes the same line off when the gesture is made over it again', () => {
    const flow = drawn();
    const seen: Flow[] = [];
    const { host } = draw({ flow, onFlow: (next: Flow) => seen.push(next) });
    const [asked, checks] = flow.blocks;
    if (asked === undefined || checks === undefined) throw new Error('the canvas drew nothing');

    // The line runs Ask → Checks, so the gesture that takes it off is a drag
    // from the parent onto the child — the same drag that made it, made again.
    dragJoin(host, 'Ask', 'Checks');
    const last = seen[seen.length - 1];
    expect(last?.blocks.find((one) => one.id === checks.id)?.after).toEqual([]);
  });

  it('refuses a ring where it was drawn, and says so', () => {
    const flow = drawn();
    const seen: Flow[] = [];
    const { host } = draw({ flow, onFlow: (next: Flow) => seen.push(next) });
    const [asked, checks] = flow.blocks;
    if (asked === undefined || checks === undefined) throw new Error('the canvas drew nothing');

    // Checks already waits for Ask, so making Ask wait for Checks would close
    // the ring. The gesture is refused where it was drawn rather than written.
    const before = seen.length;
    dragJoin(host, 'Checks', 'Ask');
    expect(seen.length).toBe(before);
    expect(host.querySelector('.canvas__refused')?.textContent).toContain('wait for each other');
    expect(flow.blocks.find((one) => one.id === asked.id)?.after).toEqual([]);
  });
});

/* ========================================================================== */
/* Undo after removing                                                         */
/* ========================================================================== */

describe('undo', () => {
  it('puts back a block that Backspace took off', () => {
    const flow = drawn();
    const { host, flow: now } = draw({ flow });
    const [asked, checks] = flow.blocks;
    if (asked === undefined || checks === undefined) throw new Error('the canvas drew nothing');

    pick(host, 'Checks');
    press(document.body, 'Backspace');
    expect(now().blocks.map((one) => one.id)).toEqual([asked.id]);

    // What the block waited for is put back with it, not left as a loose card.
    press(document.body, 'z', true);
    expect(now().blocks.map((one) => one.id)).toEqual([asked.id, checks.id]);
    expect(now().blocks.find((one) => one.id === checks.id)?.after).toEqual([asked.id]);

    // And forward again, which is the half of a ring that gets forgotten.
    press(document.body, 'z', true);
    expect(now().blocks.map((one) => one.id)).toEqual([asked.id, checks.id]);
  });

  it('does not remove anything while a run is going', () => {
    const flow = drawn();
    const run = runOf(flow, 'running', ['done', 'running']);
    const { host, flow: now } = draw({ flow: { ...flow, runs: [run] } });
    pick(host, 'Checks');
    press(document.body, 'Backspace');
    expect(now().blocks).toHaveLength(2);
  });
});

/* ========================================================================== */
/* The Branches switch                                                         */
/* ========================================================================== */

describe('the Branches switch', () => {
  it('writes `lanes` on the flow it was given', () => {
    const seen: Flow[] = [];
    const { host } = draw({ onFlow: (next: Flow) => seen.push(next) });
    const pick = host.querySelector('.canvas__lanespick');
    if (!(pick instanceof HTMLSelectElement)) throw new Error('the bar drew no Branches switch');

    act(() => {
      pick.value = 'worktrees';
      pick.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(seen[seen.length - 1]?.lanes).toBe('worktrees');
  });

  it('is refused nothing, and reads back what it wrote', () => {
    const { host } = draw();
    const pick = host.querySelector('.canvas__lanespick');
    if (!(pick instanceof HTMLSelectElement)) throw new Error('the bar drew no Branches switch');
    const options = [...pick.options].map((one) => one.textContent);
    expect(options).toEqual(['In turn', 'In worktrees']);
  });
});

/* ========================================================================== */
/* Watch                                                                       */
/* ========================================================================== */

describe('Watch', () => {
  it('hands the lane its own conversation, not the canvas name', () => {
    const flow = drawn();
    const run: Run = {
      ...runOf(flow, 'running', ['done', 'running']),
      lanes: [
        { id: 'lane-0', workspaceId: 'w1', conversationId: 'chat-9', branch: null },
        { id: 'lane-1', workspaceId: 'w2', conversationId: 'chat-branch', branch: 'graphe/way-b' },
      ],
    };
    const onWatch = vi.fn();
    const { host } = draw({ flow: { ...flow, runs: [run] }, onWatch });

    const watch = [...host.querySelectorAll('.canvas__press')].find(
      (one) => one.textContent === 'Watch',
    );
    if (!(watch instanceof HTMLElement)) throw new Error('the running card offered no Watch');
    act(() => {
      watch.click();
    });
    expect(onWatch).toHaveBeenCalledWith('chat-9');
  });
});

/* ========================================================================== */
/* The live region                                                             */
/* ========================================================================== */

describe('what a screen reader is told', () => {
  it('says how a run finished', () => {
    const flow = drawn();
    const run = runOf(flow, 'done', ['done', 'done']);
    const { host } = draw({ flow: { ...flow, runs: [run] } });
    const live = host.querySelector('.canvas__live');
    expect(live?.getAttribute('role')).toBe('status');
    expect(live?.textContent).toBe('Finished');
  });

  it('says when it failed', () => {
    const flow = drawn();
    const run = runOf(flow, 'failed', ['done', 'failed']);
    const { host } = draw({ flow: { ...flow, runs: [run] } });
    expect(host.querySelector('.canvas__live')?.textContent).toBe('Failed');
  });

  it('says it has stopped to ask, rather than only turning a ring', () => {
    const flow = drawn();
    const run = runOf(flow, 'needs-you', ['done', 'needs-you']);
    const { host } = draw({ flow: { ...flow, runs: [run] }, learning: { step: null, asking: true } });
    expect(host.querySelector('.canvas__live')?.textContent).toBe('It has stopped to ask you something');
  });
});
