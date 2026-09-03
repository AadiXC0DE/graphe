// @vitest-environment jsdom
/** Escape, on a board that is filling the window.
 *
 * There used to be three handlers for one key — one on the window, one on the
 * document, one on the bar — and between them a configuration where none fired:
 * the press landed somewhere none of the three was listening, and a menu that
 * will not close on Escape traps the hand.
 *
 * One handler now, on the window and in the capture phase, so it hears the
 * press wherever the hand is. The one place a renderer cannot hear is the
 * native browser pane, which has its own keyboard; the shell forwards that as a
 * keydown on the window, and the last case here is that forwarding landing.
 */

import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import CanvasView from '../src/components/CanvasView';
import type { ConnectionState } from '../src/lib/ipc';
import { newFlow, type Flow } from '../src/work/canvas';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
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
        },
      ],
    },
  ],
};

type Props = Parameters<typeof CanvasView>[0];

/** The board with its own shape, the way the window holds it: a block placed
 *  from the palette has to actually appear before it can be taken off again. */
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

function draw(over: Partial<Props> = {}): { host: HTMLElement } {
  const host = document.createElement('div');
  document.body.append(host);
  const props: Props = {
    flow: newFlow(),
    onFlow: () => undefined,
    onStart: () => undefined,
    onStop: () => undefined,
    onCarryOn: () => undefined,
    connection: CONNECTED,
    full: true,
    onFull: () => undefined,
    ...over,
  };
  const root = createRoot(host);
  act(() => {
    root.render(createElement(Board, props));
  });
  open.push({ host, root });
  return { host };
}

/** A press, delivered the way a real one arrives. */
function press(on: EventTarget, key: string): void {
  act(() => {
    on.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}

/** Place a block from the palette. It arrives picked, which is the panel the
 *  first Escape has to peel. */
function placeOne(host: HTMLElement): void {
  const pick = host.querySelector('.canvas__pick');
  if (!(pick instanceof HTMLElement)) throw new Error('the palette drew nothing to place');
  act(() => {
    pick.click();
  });
}

describe('what Escape peels', () => {
  it('leaves the whole window before it does anything else, when nothing is open', () => {
    const onFull = vi.fn();
    draw({ onFull });
    press(document.body, 'Escape');
    expect(onFull).toHaveBeenCalledWith(false);
  });

  it('closes the model picker first, and leaves the board where it is', () => {
    const onFull = vi.fn();
    const { host } = draw({ onFull, onModel: () => undefined });

    const chip = host.querySelector('.thinking__chip');
    if (!(chip instanceof HTMLElement)) throw new Error('the bar drew no model picker');
    act(() => {
      chip.click();
    });
    expect(document.querySelector('.thinking__menu')).not.toBeNull();

    press(document.body, 'Escape');
    expect(document.querySelector('.thinking__menu')).toBeNull();
    expect(onFull).not.toHaveBeenCalled();
  });

  /* The bar's own handler used to be the only one that saw this, so it was the
     only place the picker could be closed from. */
  it('closes it from inside the name field too', () => {
    const { host } = draw({ onModel: () => undefined });
    const chip = host.querySelector('.thinking__chip');
    const name = host.querySelector('.canvas__title');
    if (!(chip instanceof HTMLElement) || !(name instanceof HTMLElement)) {
      throw new Error('the bar drew neither the picker nor the name');
    }
    act(() => {
      chip.click();
    });
    press(name, 'Escape');
    expect(document.querySelector('.thinking__menu')).toBeNull();
  });

  it('puts the panel away before it gives up the window', () => {
    const onFull = vi.fn();
    const { host } = draw({ onFull });
    placeOne(host);

    press(document.body, 'Escape');
    expect(onFull).not.toHaveBeenCalled();

    press(document.body, 'Escape');
    expect(onFull).toHaveBeenCalledWith(false);
  });
});

/** The board is one keyboard away from the pane it sits beside. */
describe('a press the shell had to forward', () => {
  it('lands, dispatched on the window as the shell sends it', () => {
    const onFull = vi.fn();
    draw({ onFull });
    press(window, 'Escape');
    expect(onFull).toHaveBeenCalledWith(false);
  });
});

describe('taking a block off', () => {
  it('answers Backspace when a block is picked', () => {
    const onFlow = vi.fn();
    const { host } = draw({ onFlow });
    placeOne(host);
    onFlow.mockClear();

    press(document.body, 'Backspace');
    expect(onFlow).toHaveBeenCalled();
    expect((onFlow.mock.calls[0]?.[0] as Flow).blocks).toHaveLength(0);
  });

  it('does not, while the hand is in the name field', () => {
    const onFlow = vi.fn();
    const { host } = draw({ onFlow });
    placeOne(host);
    onFlow.mockClear();
    const name = host.querySelector('.canvas__title');
    if (!(name instanceof HTMLElement)) throw new Error('the bar drew no name');
    press(name, 'Backspace');
    expect(onFlow).not.toHaveBeenCalled();
  });
});
