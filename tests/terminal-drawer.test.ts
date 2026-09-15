/** The drawer is the record of what was run, and a shell of your own when asked.
 *
 * Two completely different things share the strip along the bottom: the
 * agent's commands, read only, and the person's own terminal, which nothing
 * watches. What this proves is that the record is what opens by default — a
 * drawer nobody asked for a terminal in must not start a shell — that asking
 * for one swaps the whole body rather than mixing the two, and that the
 * sentence saying which of them this is stays on screen with the terminal.
 */

// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { afterAll, describe, expect, it, vi } from 'vitest';

import Commands from '../src/components/Commands';
import { SAYS } from '../src/components/TerminalPane';
import { COMMANDS_WORDS } from '../src/work/commands-ran';
import { terminalWords } from '../src/work/terminals';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOTHING = (): void => undefined;
const made: HTMLElement[] = [];
const roots: Root[] = [];

afterAll(() => {
  for (const root of roots) act(() => root.unmount());
  for (const host of made) host.remove();
});

async function drawer(terminal: {
  workspace: string | null;
  open: boolean;
  onOpen: (open: boolean) => void;
}): Promise<HTMLDivElement> {
  const host = document.createElement('div');
  document.body.append(host);
  made.push(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(
      createElement(Commands, {
        open: true,
        onClose: NOTHING,
        turns: [],
        servers: [],
        onSaid: () => Promise.resolve(''),
        onStop: NOTHING,
        onOpenAddress: NOTHING,
        terminal,
      }),
    );
  });
  return host;
}

const presses = (where: HTMLElement): readonly HTMLButtonElement[] => [
  ...where.querySelectorAll<HTMLButtonElement>('.commands__press'),
];

const pressNamed = (where: HTMLElement, label: string): HTMLButtonElement | undefined =>
  presses(where).find((one) => one.textContent === label);

describe('the drawer with a shell on offer', () => {
  it('opens on the record, and does not start a shell until somebody asks', async () => {
    const onOpen = vi.fn();
    const where = await drawer({ workspace: '/projects/one', open: false, onOpen });

    expect(where.querySelector('.termpane')).toBeNull();
    expect(where.querySelector('.commands')?.textContent).toContain(COMMANDS_WORDS.none);
    const button = pressNamed(where, terminalWords.panel);
    expect(button).toBeDefined();
    expect(button?.getAttribute('aria-pressed')).toBe('false');
  });

  it('swaps the record for the terminal when it is asked for, and back', async () => {
    const onOpen = vi.fn();
    const closed = await drawer({ workspace: '/projects/one', open: false, onOpen });
    await act(async () => {
      pressNamed(closed, terminalWords.panel)?.click();
    });
    expect(onOpen).toHaveBeenCalledWith(true);

    const shown = await drawer({ workspace: '/projects/one', open: true, onOpen });
    expect(shown.querySelector('.termpane')).not.toBeNull();
    // The record is not behind it: the drawer is one thing or the other.
    expect(shown.querySelector('.commands__empty')).toBeNull();
    expect(shown.querySelector('.commands__cmd')).toBeNull();
    await act(async () => {
      shown.querySelector<HTMLButtonElement>('.termpane__close')?.click();
    });
    expect(onOpen).toHaveBeenCalledWith(false);
  });

  it('keeps the sentence saying whose shell this is on screen with it', async () => {
    const where = await drawer({ workspace: '/projects/one', open: true, onOpen: vi.fn() });
    const note = where.querySelector('.termpane__note');
    expect(note?.textContent).toBe(SAYS.here);
    expect(note?.textContent).toContain('not watching');
  });

  it('offers no terminal at all when the app does not pass one', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    made.push(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(
        createElement(Commands, {
          open: true,
          onClose: NOTHING,
          turns: [],
          servers: [],
          onSaid: () => Promise.resolve(''),
          onStop: NOTHING,
          onOpenAddress: NOTHING,
        }),
      );
    });
    expect(pressNamed(host, terminalWords.panel)).toBeUndefined();
    expect(host.querySelector('.termpane')).toBeNull();
  });
});
