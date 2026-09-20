/** Focused renderer contract tests for the person's terminal pane.
 *
 * The native pty is covered by terminal.test.ts. These tests keep the xterm and
 * bridge at the edge so ownership, replay ordering and resize behavior can be
 * checked without launching Electron. */

// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

type TestShell = {
  id: string;
  kind: 'shell';
  workspace: string;
  shell: string;
  startedAt: number;
  exit: null;
};

const bridgeState = vi.hoisted(() => {
  const data: Array<(chunk: { id: string; data: string; sequence: number }) => void> = [];
  const exits: Array<(exit: { id: string; code: number; signal: number | null }) => void> = [];
  let opened: Promise<{ ok: true; value: { id: string; kind: 'shell'; workspace: string; shell: string; startedAt: number; exit: null } }>;
  let resolveOpen: ((answer: Awaited<typeof opened>) => void) | null = null;
  const resetOpen = (): void => {
    opened = new Promise((resolve) => { resolveOpen = resolve; });
  };
  resetOpen();
  return {
    data,
    exits,
    opened: () => opened,
    resolveOpen: (answer: Awaited<typeof opened>) => resolveOpen?.(answer),
    resetOpen,
    terminalList: vi.fn(() => Promise.resolve({ ok: true as const, value: [] as TestShell[] })),
    terminalOpen: vi.fn(() => opened),
    terminalScrollback: vi.fn((_id: string) => Promise.resolve({ ok: true as const, value: { data: 'snapshot\n', sequence: 4 } })),
    terminalResize: vi.fn((_id: string, _cols: number, _rows: number) =>
      Promise.resolve({ ok: true as const, value: null })),
    terminalWrite: vi.fn((_id: string, _data: string) => Promise.resolve({ ok: true as const, value: null })),
    terminalClose: vi.fn((_id: string) => Promise.resolve({ ok: true as const, value: null })),
  };
});

vi.mock('../src/lib/bridge', () => ({
  bridge: {
    terminalList: bridgeState.terminalList,
    terminalOpen: bridgeState.terminalOpen,
    terminalScrollback: bridgeState.terminalScrollback,
    terminalResize: bridgeState.terminalResize,
    terminalWrite: bridgeState.terminalWrite,
    terminalClose: bridgeState.terminalClose,
    onTerminalData: (listener: (chunk: { id: string; data: string; sequence: number }) => void) => {
      bridgeState.data.push(listener);
      return () => {
        const at = bridgeState.data.indexOf(listener);
        if (at >= 0) bridgeState.data.splice(at, 1);
      };
    },
    onTerminalExit: (listener: (exit: { id: string; code: number; signal: number | null }) => void) => {
      bridgeState.exits.push(listener);
      return () => {
        const at = bridgeState.exits.indexOf(listener);
        if (at >= 0) bridgeState.exits.splice(at, 1);
      };
    },
  },
}));

const terminals: FakeTerminal[] = [];
class FakeTerminal {
  cols = 80;
  rows = 24;
  readonly writes: string[] = [];
  private readonly listeners: Array<(data: string) => void> = [];

  open(host: HTMLElement): void {
    host.style.padding = '0px';
    Object.defineProperty(host, 'clientWidth', { configurable: true, value: 800 });
    Object.defineProperty(host, 'clientHeight', { configurable: true, value: 400 });
    const root = document.createElement('div');
    root.className = 'xterm';
    const helper = document.createElement('textarea');
    helper.className = 'xterm-helper-textarea';
    helper.style.opacity = '0';
    helper.style.width = '0px';
    helper.style.height = '0px';
    const viewport = document.createElement('div');
    viewport.className = 'xterm-viewport';
    Object.defineProperty(viewport, 'scrollHeight', { configurable: true, value: 1200 });
    Object.defineProperty(viewport, 'clientHeight', { configurable: true, value: 400 });
    const screen = document.createElement('div');
    screen.className = 'xterm-screen';
    screen.getBoundingClientRect = () => ({ width: 640, height: 384, top: 0, left: 0, right: 640, bottom: 384, x: 0, y: 0, toJSON: () => ({}) });
    const rows = document.createElement('div');
    rows.className = 'xterm-rows';
    screen.append(rows);
    root.append(helper, viewport, screen);
    host.append(root);
    terminals.push(this);
  }

  write(data: string): void {
    this.writes.push(data);
  }

  onData(listener: (data: string) => void): { dispose: () => void } {
    this.listeners.push(listener);
    return { dispose: () => undefined };
  }

  dispose(): void {}
  resize(cols: number, rows: number): void { this.cols = cols; this.rows = rows; }
  focus(): void {}
  type(data: string): void { for (const listener of this.listeners) listener(data); }
}

vi.mock('@xterm/xterm', () => ({ Terminal: FakeTerminal }));

class FakeResizeObserver {
  static all: FakeResizeObserver[] = [];
  constructor(private readonly callback: () => void) { FakeResizeObserver.all.push(this); }
  observe(): void {}
  disconnect(): void {}
  trigger(): void { this.callback(); }
}
vi.stubGlobal('ResizeObserver', FakeResizeObserver);

import TerminalPane from '../src/components/TerminalPane';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
const hosts: HTMLElement[] = [];
let ownerNumber = 0;
const ignoredClose = (): void => undefined;

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  for (const host of hosts.splice(0)) host.remove();
  bridgeState.data.splice(0);
  bridgeState.exits.splice(0);
  bridgeState.terminalList.mockClear();
  bridgeState.terminalOpen.mockClear();
  bridgeState.terminalScrollback.mockClear();
  bridgeState.terminalResize.mockClear();
  bridgeState.terminalClose.mockClear();
  terminals.splice(0);
  FakeResizeObserver.all.splice(0);
});

function session(workspace: string, id = 'term-1') {
  return {
    ok: true as const,
    value: { id, kind: 'shell' as const, workspace, shell: 'sh', startedAt: 1, exit: null },
  };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function render(open = true): Promise<{ host: HTMLElement; root: Root; workspace: string; onClose: () => void }> {
  const workspace = `/workspace/terminal-pane-${String(ownerNumber += 1)}`;
  bridgeState.resetOpen();
  bridgeState.terminalOpen.mockImplementationOnce(() => bridgeState.opened());
  const host = document.createElement('div');
  const onClose = vi.fn<() => void>();
  document.body.append(host);
  hosts.push(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(createElement(TerminalPane, { workspace, open, onClose }));
    await Promise.resolve();
  });
  bridgeState.resolveOpen(session(workspace));
  await vi.waitFor(() => expect(bridgeState.terminalScrollback).toHaveBeenCalled(), { timeout: 1000 });
  return { host, root, workspace, onClose };
}

describe('TerminalPane ownership and replay', () => {
  it('writes only owned chunks, ignores duplicate sequences, and ignores other exits', async () => {
    const { host } = await render();
    const term = terminals[0];
    expect(term).toBeDefined();
    await act(async () => {
      bridgeState.data.forEach((listener) => listener({ id: 'other', data: 'wrong', sequence: 99 }));
      bridgeState.data.forEach((listener) => listener({ id: 'term-1', data: 'live', sequence: 5 }));
      bridgeState.data.forEach((listener) => listener({ id: 'term-1', data: 'duplicate', sequence: 5 }));
    });
    expect(term?.writes).toEqual(['snapshot\n', 'live']);
    await act(async () => {
      bridgeState.exits.forEach((listener) => listener({ id: 'other', code: 1, signal: null }));
    });
    expect(host.querySelector('.termpane__ended')).toBeNull();
    await act(async () => {
      bridgeState.exits.forEach((listener) => listener({ id: 'term-1', code: 0, signal: null }));
    });
    await vi.waitFor(() => expect(host.querySelector('.termpane__ended')?.textContent ?? '').toContain('ended'));
  });

  it('uses the snapshot sequence to avoid replaying a buffered live chunk', async () => {
    const pending = render();
    await vi.waitFor(() => expect(bridgeState.data.length).toBeGreaterThan(0), { timeout: 1000 });
    bridgeState.data.forEach((listener) => listener({ id: 'term-1', data: 'buffered', sequence: 4 }));
    bridgeState.resolveOpen(session('/workspace/pending'));
    const { host } = await pending;
    await vi.waitFor(() => expect(bridgeState.terminalScrollback).toHaveBeenCalled(), { timeout: 1000 });
    expect(terminals[0]?.writes).toEqual(['snapshot\n']);
    expect(host.querySelector('.termpane')).not.toBeNull();
  });

  it('measures the xterm surface and sends a pty resize', async () => {
    await render();
    const term = terminals[0];
    expect(bridgeState.terminalResize).toHaveBeenCalled();
    const first = bridgeState.terminalResize.mock.calls.at(-1);
    expect(first?.[0]).toBe('term-1');
    expect(first?.[1]).toBeGreaterThan(0);
    expect(first?.[2]).toBeGreaterThan(0);
    const before = bridgeState.terminalResize.mock.calls.length;
    FakeResizeObserver.all.at(-1)?.trigger();
    expect(bridgeState.terminalResize.mock.calls.length).toBeGreaterThan(before);
    expect(term?.cols).toBeGreaterThan(0);
    expect(term?.rows).toBeGreaterThan(0);
  });

  it('keeps the shell while hidden, and explicit Close stops the owned session', async () => {
    const { host, root, workspace, onClose } = await render();
    await act(async () => {
      root.render(createElement(TerminalPane, { workspace, open: false, onClose }));
      await Promise.resolve();
    });
    expect(host.querySelector('.termpane')).toBeNull();
    expect(bridgeState.terminalClose).not.toHaveBeenCalled();
    await act(async () => {
      root.render(createElement(TerminalPane, { workspace, open: true, onClose }));
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(host.querySelector('.termpane__close')).not.toBeNull(), { timeout: 1000 });
    const close = host.querySelector<HTMLButtonElement>('.termpane__close');
    expect(close).toBeDefined();
    // Commands hides the pane by changing `open`; only the explicit button is
    // allowed to call terminalClose. The component's callback is still the
    // parent-controlled way to hide it.
    await act(async () => close?.click());
    expect(bridgeState.terminalClose).toHaveBeenCalledWith('term-1');
  });

  it('revalidates a cached shell after a hidden pane misses its exit event', async () => {
    const { root, workspace } = await render();
    await act(async () => {
      root.render(createElement(TerminalPane, { workspace, open: false, onClose: ignoredClose }));
      await Promise.resolve();
    });
    bridgeState.terminalOpen.mockImplementationOnce(() => Promise.resolve(session(workspace, 'term-replacement')));
    await act(async () => {
      root.render(createElement(TerminalPane, { workspace, open: true, onClose: ignoredClose }));
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(bridgeState.terminalOpen).toHaveBeenCalledTimes(2), { timeout: 1000 });
    await vi.waitFor(() => expect(bridgeState.terminalScrollback).toHaveBeenCalledTimes(2), { timeout: 1000 });
    expect(bridgeState.terminalScrollback.mock.calls.at(-1)?.[0]).toBe('term-replacement');
  });

  it('reuses a replacement already listed while validating a stale cache', async () => {
    const { root, workspace } = await render();
    await act(async () => {
      root.render(createElement(TerminalPane, { workspace, open: false, onClose: ignoredClose }));
      await Promise.resolve();
    });
    bridgeState.terminalList.mockImplementationOnce(() => Promise.resolve({ ok: true as const, value: [session(workspace, 'term-replacement').value] }));
    await act(async () => {
      root.render(createElement(TerminalPane, { workspace, open: true, onClose: ignoredClose }));
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(bridgeState.terminalScrollback).toHaveBeenCalledTimes(2), { timeout: 1000 });
    expect(bridgeState.terminalOpen).toHaveBeenCalledTimes(1);
  });

  it('shares one pending replacement when two hidden remounts open together', async () => {
    const { root, workspace } = await render();
    await act(async () => {
      root.render(createElement(TerminalPane, { workspace, open: false, onClose: ignoredClose }));
      await Promise.resolve();
    });
    const secondHost = document.createElement('div');
    document.body.append(secondHost);
    hosts.push(secondHost);
    const secondRoot = createRoot(secondHost);
    roots.push(secondRoot);
    await act(async () => {
      root.render(createElement(TerminalPane, { workspace, open: true, onClose: ignoredClose }));
      secondRoot.render(createElement(TerminalPane, { workspace, open: true, onClose: ignoredClose }));
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(bridgeState.terminalOpen).toHaveBeenCalledTimes(2), { timeout: 1000 });
    expect(bridgeState.terminalOpen).toHaveBeenCalledTimes(2);
  });

  it('keeps the pane open and reports a failed explicit close for retry', async () => {
    const { host, onClose } = await render();
    bridgeState.terminalClose.mockImplementationOnce((_id: string) => Promise.resolve({
      ok: false as const,
      trouble: { because: 'shell could not stop' },
    } as never));
    await act(async () => host.querySelector<HTMLButtonElement>('.termpane__close')?.click());
    await vi.waitFor(() => expect(host.querySelector('.termpane__trouble')?.textContent).toContain('shell could not stop'), { timeout: 1000 });
    expect(onClose).not.toHaveBeenCalled();
    expect(host.querySelector<HTMLButtonElement>('.termpane__close')?.disabled).toBe(false);
    await act(async () => host.querySelector<HTMLButtonElement>('.termpane__close')?.click());
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(1), { timeout: 1000 });
  });

  it('does not let a pending close kill a replacement pane for the same owner', async () => {
    const workspace = '/workspace/terminal-pane-race';
    const first = deferred<ReturnType<typeof session>>();
    const second = deferred<ReturnType<typeof session>>();
    bridgeState.terminalOpen.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);

    const hostOne = document.createElement('div');
    const hostTwo = document.createElement('div');
    document.body.append(hostOne, hostTwo);
    hosts.push(hostOne, hostTwo);
    const rootOne = createRoot(hostOne);
    const rootTwo = createRoot(hostTwo);
    roots.push(rootOne, rootTwo);
    const onClose = vi.fn<() => void>();
    await act(async () => {
      rootOne.render(createElement(TerminalPane, { workspace, open: true, onClose }));
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(hostOne.querySelector('.termpane__close')).not.toBeNull(), { timeout: 1000 });
    await act(async () => hostOne.querySelector<HTMLButtonElement>('.termpane__close')?.click());

    await act(async () => {
      rootTwo.render(createElement(TerminalPane, { workspace, open: true, onClose }));
      await Promise.resolve();
    });
    first.resolve(session(workspace, 'term-first'));
    await vi.waitFor(() => expect(bridgeState.terminalClose).toHaveBeenCalledWith('term-first'), { timeout: 1000 });
    await vi.waitFor(() => expect(bridgeState.terminalOpen).toHaveBeenCalledTimes(2), { timeout: 1000 });
    second.resolve(session(workspace, 'term-second'));
    await vi.waitFor(() => expect(bridgeState.terminalScrollback).toHaveBeenCalledTimes(2), { timeout: 1000 });
    expect(bridgeState.terminalClose).toHaveBeenCalledTimes(1);
    expect(hostTwo.querySelector('.termpane')).not.toBeNull();
  });
});
