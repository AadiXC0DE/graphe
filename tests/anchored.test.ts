// @vitest-environment jsdom
/** A menu goes where its control is, not where its ancestor happens to be.
 *
 * The model chip drew its menu `absolute`, so in the composer it landed above
 * the chip and in Settings it landed at the sheet's top right, half off the
 * window. Measured from the control there is no ancestor to be wrong about.
 *
 *  Source text, not behaviour: the chip's portal target and its undrawn-until-placed guard, plus the stylesheet rule jsdom cannot compute; no behavioural test can reach them — jsdom has no frames and computes no CSS.
 */

import { act, createElement, createRef, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import ThinkingWith from '../src/components/ThinkingWith';
import { useAnchored, type Side } from '../src/lib/anchored';
import type { ConnectionState } from '../src/lib/ipc';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.innerWidth = 1200;
  window.innerHeight = 800;
});

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
});

/** A control at a known place, and where a menu anchored to it would go. */
function placed(rect: Partial<DOMRect>, open: boolean, side: Side) {
  const seen = createRef<React.CSSProperties | null>();
  function Probe() {
    const on = useRef<HTMLElement | null>(null);
    on.current = {
      getBoundingClientRect: () => ({ top: 0, left: 0, right: 0, bottom: 0, ...rect }) as DOMRect,
    } as HTMLElement;
    seen.current = useAnchored(on, open, side);
    return null;
  }
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(createElement(Probe)));
  return seen.current;
}

describe('where a menu lands', () => {
  it('hangs under a control, aligned to its right edge', () => {
    expect(placed({ bottom: 120, right: 400 }, true, 'below-right')).toEqual({
      position: 'fixed',
      top: 128,
      right: 800,
      maxHeight: 440,
    });
  });

  it('stands over a control, aligned to its left edge', () => {
    expect(placed({ top: 700, bottom: 728, left: 90, right: 400 }, true, 'above-left')).toEqual({
      position: 'fixed',
      bottom: 108,
      left: 90,
      maxHeight: 440,
    });
  });

  /* The side is a preference, not an instruction. The model chip asks to stand
     over its control because that is right in the composer; asked for it at the
     top of a settings card, standing over means starting above the top of the
     window, which is where it was seen going. */
  it('takes the other side when the one asked for has no room', () => {
    const over = placed({ top: 60, bottom: 88, left: 90, right: 400 }, true, 'above-left') as {
      top?: number;
      bottom?: number;
    };
    expect(over.top).toBe(96);
    expect(over.bottom).toBeUndefined();

    const under = placed({ top: 700, bottom: 728, left: 90, right: 400 }, true, 'below-right') as {
      top?: number;
      bottom?: number;
    };
    expect(under.bottom).toBe(108);
    expect(under.top).toBeUndefined();
  });

  /* However tall it wants to be, it stops at the room there is. */
  it('is only as tall as the room it landed in', () => {
    const at = placed({ bottom: 600, right: 400 }, true, 'below-right') as { maxHeight: number };
    expect(at.maxHeight).toBe(184);
  });

  /* A control near the right edge would otherwise put the menu off it. */
  it('keeps a menu inside the window', () => {
    const at = placed({ bottom: 40, right: 1200 }, true, 'below-right') as { right: number };
    expect(at.right).toBe(8);
  });

  it('says nothing at all while the menu is shut', () => {
    expect(placed({ bottom: 120, right: 400 }, false, 'below-right')).toBeNull();
  });
});

describe('the model chip uses it', () => {
  /* Read from the working directory: this file runs under jsdom, where
     `import.meta.url` is not a file URL. */
  const read = async (path: string): Promise<string> => {
    const { readFileSync } = await import('node:fs');
    return readFileSync(`${process.cwd()}/${path}`, 'utf8');
  };

  it('draws its menu at the window rather than inside its parent', async () => {
    const chip = await read('src/components/ThinkingWith.tsx');
    const styles = await read('src/components/ThinkingWith.css');
    expect(chip).toContain("useAnchored(root, open, bare === true ? 'below-right' : 'above-left')");
    // And never drawn before it has been placed: unplaced, it is a static block
    // at the top of the body for a frame, which is where it was seen landing.
    expect(chip).toContain('{open && at !== null && !nothingConnected ? (');
    expect(chip).toContain('createPortal(');
    expect(chip).toContain('document.body,');
    // Measured from the control, so the menu rule never places it against an
    // ancestor. (The `.thinking--bare .thinking__menu` rule that did is gone.)
    const rule = styles.slice(styles.indexOf('.thinking__menu {'));
    expect(rule.slice(0, rule.indexOf('}'))).not.toContain('position: absolute');
  });

  /** One account with one model, which is all the chip needs to have a menu. */
  const ONE_ACCOUNT: ConnectionState = {
    chosen: { providerId: 'anthropic', modelId: 'haiku' },
    chosenThinking: 'off',
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
            id: 'haiku',
            label: 'Haiku',
            available: true,
            rates: { input: 0.8, output: 4 },
            contextWindow: null,
            takesImages: true,
            thinking: ['off'],
          },
        ],
      },
    ],
  };

  /** The chip rendered and pressed open, its menu where the window holds it. */
  function openChip(): void {
    const where = document.createElement('div');
    document.body.append(where);
    host = where;
    root = createRoot(where);
    act(() => {
      root?.render(
        createElement(ThinkingWith, {
          state: ONE_ACCOUNT,
          onSelect: () => undefined,
          onConnect: () => undefined,
        }),
      );
    });
    act(() => where.querySelector<HTMLElement>('.thinking__chip')?.click());
  }

  /* A press inside the menu is a press inside the control: portalled, it is no
     longer a descendant of the chip, so the outside-click check has to say so. */
  it('does not close itself when somebody presses inside the menu', () => {
    openChip();
    const menu = document.querySelector('.thinking__menu');
    expect(menu).not.toBeNull();

    // A row of the menu, which is in the document rather than in the chip.
    const row = menu?.querySelector('.thinking__menuhead') ?? null;
    expect(row).not.toBeNull();
    act(() => {
      row?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(document.querySelector('.thinking__menu')).not.toBeNull();

    // And a press away from it still shuts it.
    act(() => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(document.querySelector('.thinking__menu')).toBeNull();
  });
});
