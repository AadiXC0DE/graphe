// @vitest-environment jsdom
/** The commands drawer: the ledger it reads, and the two tabs it draws.
 *
 * The ledger is the conversation. Every step already carries the real thing
 * behind it, so the question this file settles is which of those are commands
 * and which are paths — a drawer that lists `read · /Users/you/index.html` as
 * something that was run is a drawer nobody can trust.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import Commands from '../src/components/Commands';
import Sidebar from '../src/components/Sidebar';
import { ACTIONS, actionAt } from '../src/lib/actions';
import { realWords } from '../src/lib/showme';
import { saidFrom, saidIn, saysLevel, tabsWords } from '../src/preview/tabs';
import type { Turn } from '../src/lib/thread';
import {
  COMMANDS_WORDS,
  MOST_LINES,
  commandIn,
  commandsRan,
  portIn,
  saysEnded,
  saysHowLong,
  serverTitle,
  tailOf,
} from '../src/work/commands-ran';
import { TERMINAL_KEYS } from '../src/work/terminals';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

const NOTHING = (): void => undefined;

function read(where: string): string {
  return readFileSync(resolve(process.cwd(), where), 'utf8');
}

let counter = 0;
function did(over: Partial<Extract<Turn, { kind: 'did' }>>): Turn {
  counter += 1;
  return {
    kind: 'did',
    id: `t-${String(counter)}`,
    callId: `c-${String(counter)}`,
    state: 'done',
    label: 'Doing something',
    ...over,
  } as Turn;
}

/* -------------------------------------------------------------------------- */

describe('telling a command from a path', () => {
  it('reads the command out of what a shell step recorded', () => {
    expect(commandIn(realWords({ id: '1', name: 'bash', input: { command: 'npm test' } }))).toBe(
      'npm test',
    );
    expect(commandIn(realWords({ id: '2', name: 'Run', input: { command: 'ls -la' } }))).toBe(
      'ls -la',
    );
  });

  /* The bug this exists to stop: a path is spelled the same way a command is,
     and only the tool in front of it says which. */
  it('leaves every path, pattern and address out', () => {
    for (const call of [
      { id: '1', name: 'read', input: { path: '/Users/you/index.html' } },
      { id: '2', name: 'edit', input: { file_path: '/Users/you/app.css' } },
      { id: '3', name: 'grep', input: { pattern: 'colour' } },
      { id: '4', name: 'fetch', input: { url: 'https://example.com' } },
      { id: '5', name: 'ls', input: { path: '/Users/you' } },
    ]) {
      expect(commandIn(realWords(call))).toBeNull();
    }
  });

  it('says nothing about a step that recorded nothing', () => {
    expect(commandIn(undefined)).toBeNull();
    expect(commandIn('bash')).toBeNull();
    expect(commandIn('bash · ')).toBeNull();
  });
});

describe('the conversation as a list of commands', () => {
  it('keeps only the commands, oldest first', () => {
    const rows = commandsRan([
      did({ real: 'bash · npm install' }),
      did({ real: 'read · /Users/you/index.html' }),
      { kind: 'said', id: 's-1', from: 'you', text: 'hello', streaming: false },
      did({ real: 'bash · npm test' }),
    ]);
    expect(rows.map((one) => one.command)).toEqual(['npm install', 'npm test']);
  });

  it('carries how it ended and how long it took', () => {
    const [row] = commandsRan([
      did({ real: 'bash · npm test', state: 'done', at: 1_000, endedAt: 3_400 }),
    ]);
    expect(row?.ended).toBe('ok');
    expect(row?.ms).toBe(2_400);
    expect(saysEnded(row!)).toBe('ok · 2.4s');
  });

  it('says a command is still going rather than guessing how long it took', () => {
    const [row] = commandsRan([did({ real: 'bash · npm run dev', state: 'running', at: 1_000 })]);
    expect(row?.ended).toBe('running');
    expect(row?.ms).toBeNull();
    expect(saysEnded(row!)).toBe('running');
  });

  it('keeps what came back, so a row has something to expand to', () => {
    const [row] = commandsRan([
      did({ real: 'bash · npm test', state: 'failed', detail: '  1 test failed  ' }),
    ]);
    expect(row?.ended).toBe('failed');
    expect(row?.output).toBe('1 test failed');
  });
});

describe('how long, in words', () => {
  it('is short enough to sit at the end of a row', () => {
    expect(saysHowLong(340)).toBe('340ms');
    expect(saysHowLong(1_240)).toBe('1.2s');
    expect(saysHowLong(42_000)).toBe('42s');
    expect(saysHowLong(123_000)).toBe('2m 3s');
    expect(saysHowLong(120_000)).toBe('2m');
    expect(saysHowLong(null)).toBe('');
  });
});

describe('what a tab keeps', () => {
  it('holds the last two thousand lines and no more', () => {
    const said = Array.from({ length: 2_500 }, (_, at) => `line ${String(at)}`).join('\n');
    const kept = tailOf(said);
    expect(kept.split('\n')).toHaveLength(MOST_LINES);
    expect(kept.split('\n')[0]).toBe('line 500');
  });

  it('leaves a short one alone, whole lines only', () => {
    expect(tailOf('one\ntwo')).toBe('one\ntwo');
  });
});

describe('what a server tab is called', () => {
  it('is its name and the port it answers on', () => {
    expect(
      serverTitle({ label: 'dev', command: 'npm run dev', address: 'http://localhost:5173' }),
    ).toBe('dev · :5173');
  });

  it('is its name alone until it has said where it is', () => {
    expect(serverTitle({ label: '', command: 'npm run dev', address: null })).toBe('npm run dev');
    expect(portIn(null)).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* The drawer                                                                  */
/* -------------------------------------------------------------------------- */

const SERVER = {
  id: 'run-1',
  label: 'dev',
  command: 'npm run dev',
  folder: '/a',
  address: 'http://localhost:5173',
  state: 'running' as const,
  since: 0,
  exitCode: null,
};

const PRINTED = [
  { id: 'said-1', level: 'problem' as const, text: 'Cannot read x of undefined', where: 'app.js:12', many: 2 },
  { id: 'said-2', level: 'note' as const, text: 'hello', where: null, many: 1 },
];

function drawer(over: Record<string, unknown> = {}): HTMLDivElement {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root?.render(
      createElement(Commands, {
        open: true,
        onClose: NOTHING,
        turns: [],
        servers: [],
        onSaid: () => Promise.resolve(''),
        onStop: NOTHING,
        onOpenAddress: NOTHING,
        ...over,
      } as never),
    );
  });
  return host;
}

describe('the drawer', () => {
  it('draws one tab per server beside the agent’s', () => {
    const where = drawer({ servers: [SERVER] });
    expect([...where.querySelectorAll('.commands__tab')].map((one) => one.textContent)).toEqual([
      COMMANDS_WORDS.agent,
      'dev · :5173',
    ]);
  });

  it('lists what was run, newest at the bottom', () => {
    const where = drawer({
      turns: [did({ real: 'bash · npm install' }), did({ real: 'bash · npm test' })],
    });
    const said = [...where.querySelectorAll('.commands__cmd')].map((one) => one.textContent);
    expect(said[0]).toContain('npm install');
    expect(said.at(-1)).toContain('npm test');
  });

  it('expands a row to what came back', () => {
    const where = drawer({ turns: [did({ real: 'bash · npm test', detail: 'all good' })] });
    expect(where.querySelector('.commands__out')).toBeNull();
    act(() => {
      where.querySelector<HTMLButtonElement>('.commands__line')?.click();
    });
    expect(where.querySelector('.commands__out')?.textContent).toBe('all good');
  });

  it('says so when nothing has been run', () => {
    expect(drawer().textContent).toContain(COMMANDS_WORDS.none);
  });

  /* Polled rather than pushed. The one thing worth asserting is that it asks at
     all and asks again, because a tail that never moves is a dead drawer. */
  it('reads a server’s tail again while its tab is in front', async () => {
    vi.useFakeTimers();
    const onSaid = vi.fn(() => Promise.resolve('ready in 412 ms'));
    const where = drawer({ servers: [SERVER], onSaid });
    act(() => {
      window.dispatchEvent(new FocusEvent('focus'));
      where.querySelectorAll<HTMLButtonElement>('.commands__tab')[1]?.click();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(onSaid).toHaveBeenCalledWith('run-1');
    const first = onSaid.mock.calls.length;
    await act(async () => {
      vi.advanceTimersByTime(2_100);
      await Promise.resolve();
    });
    expect(onSaid.mock.calls.length).toBeGreaterThan(first);
    expect(where.querySelector('.commands__tail')?.textContent).toBe('ready in 412 ms');
    vi.useRealTimers();
  });

  it('offers Open and Stop only on a server’s tab', () => {
    const where = drawer({ servers: [SERVER] });
    const presses = (): readonly string[] =>
      [...where.querySelectorAll('.commands__press')].map((one) => one.textContent ?? '');
    expect(presses()).not.toContain(COMMANDS_WORDS.stop);
    act(() => {
      where.querySelectorAll<HTMLButtonElement>('.commands__tab')[1]?.click();
    });
    expect(presses()).toContain(COMMANDS_WORDS.open);
    expect(presses()).toContain(COMMANDS_WORDS.stop);
  });

  it('clears the tab it is on and leaves the other alone', () => {
    const where = drawer({
      servers: [SERVER],
      turns: [did({ real: 'bash · npm test' })],
    });
    expect(where.querySelectorAll('.commands__cmd')).toHaveLength(1);
    act(() => {
      [...where.querySelectorAll<HTMLButtonElement>('.commands__press')]
        .find((one) => one.textContent === COMMANDS_WORDS.clear)
        ?.click();
    });
    expect(where.querySelectorAll('.commands__cmd')).toHaveLength(0);
  });

  it('draws nothing at all when it is shut', () => {
    expect(drawer({ open: false }).querySelector('.commands')).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* The two ways in                                                             */
/* -------------------------------------------------------------------------- */

describe('the ways to reach it', () => {
  it('is one action, on the chord the terminal model already spells', () => {
    const one = ACTIONS.find((action) => action.id === 'commands');
    expect(one?.chord).toBe(TERMINAL_KEYS.panel);
    expect(
      actionAt({ key: '`', metaKey: true }, true, 'in a project')?.id,
    ).toBe('commands');
  });

  it('is a row in the shelf, folded or not', () => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    const props = {
      projects: [],
      openPath: null,
      onOpen: NOTHING,
      onBrowse: NOTHING,
      pinned: [],
      conversations: [],
      openConversation: null,
      onOpenConversation: NOTHING,
      onNewConversation: NOTHING,
      onToggle: NOTHING,
      onCommands: NOTHING,
    };
    act(() => {
      root?.render(createElement(Sidebar, { ...props, open: true } as never));
    });
    expect(
      [...host.querySelectorAll('.shelf__more .shelf__rowname')].map((one) => one.textContent),
    ).toContain(COMMANDS_WORDS.name);
    act(() => {
      root?.render(createElement(Sidebar, { ...props, open: false } as never));
    });
    expect(
      [...host.querySelectorAll('.shelf__act')].map((one) => one.getAttribute('aria-label')),
    ).toContain(COMMANDS_WORDS.name);
  });
});

/* -------------------------------------------------------------------------- */
/* The page's tab                                                              */
/* -------------------------------------------------------------------------- */

describe('reading the shell’s own console lines', () => {
  it('pulls the level and the source back off a kept line', () => {
    expect(saidIn('a problem: Cannot read x of undefined (app.js:12)')).toEqual({
      level: 'problem',
      text: 'Cannot read x of undefined',
      where: 'app.js:12',
    });
    expect(saidIn('a warning: something (bundle.js)')).toEqual({
      level: 'warning',
      text: 'something',
      where: 'bundle.js',
    });
  });

  it('takes a line with no level and no source as a plain note', () => {
    expect(saidIn('just talking')).toEqual({ level: 'note', text: 'just talking', where: null });
  });

  /* Through the model rather than beside it, so the count and the ceiling are
     the console drawer's and not a second set. */
  it('collapses a repeat into a count', () => {
    const lot = saidFrom([
      'a problem: boom (app.js:1)',
      'a problem: boom (app.js:1)',
      'a note: hello',
    ]);
    expect(lot).toHaveLength(2);
    expect(lot[0]?.many).toBe(2);
    expect(lot[1]?.level).toBe('note');
  });
});

describe('the page tab', () => {
  it('is not there when no page is open', () => {
    const where = drawer({ servers: [SERVER] });
    expect([...where.querySelectorAll('.commands__tab')].map((one) => one.textContent)).not.toContain(
      COMMANDS_WORDS.page,
    );
  });

  it('is there when one is', () => {
    const where = drawer({ page: 'http://localhost:5173' });
    expect([...where.querySelectorAll('.commands__tab')].map((one) => one.textContent)).toContain(
      COMMANDS_WORDS.page,
    );
  });

  it('says a problem is a problem in words, not only in colour', async () => {
    const where = drawer({
      page: 'http://localhost:5173',
      onPageSaid: () => Promise.resolve(PRINTED),
    });
    await act(async () => {
      window.dispatchEvent(new FocusEvent('focus'));
      where.querySelectorAll<HTMLButtonElement>('.commands__tab')[1]?.click();
      await Promise.resolve();
    });
    const first = where.querySelector('.commands__note');
    expect(first?.className).toContain('commands__note--problem');
    expect(first?.querySelector('.commands__level')?.textContent).toBe(saysLevel('problem'));
    expect(first?.querySelector('.commands__where')?.textContent).toBe('app.js:12');
    expect(where.querySelector('.commands__many')?.textContent).toContain('2');
  });

  it('says so when the page has not complained', () => {
    const where = drawer({ page: 'http://localhost:5173' });
    act(() => {
      where.querySelectorAll<HTMLButtonElement>('.commands__tab')[1]?.click();
    });
    expect(where.textContent).toContain(tabsWords.consoleEmpty);
  });

  it('reads while the window is looked at and stops when it is not', async () => {
    vi.useFakeTimers();
    const onPageSaid = vi.fn(() => Promise.resolve(PRINTED));
    const where = drawer({ page: 'http://localhost:5173', onPageSaid });
    await act(async () => {
      window.dispatchEvent(new FocusEvent('focus'));
      where.querySelectorAll<HTMLButtonElement>('.commands__tab')[1]?.click();
      await Promise.resolve();
    });
    expect(onPageSaid).toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(2_100);
      await Promise.resolve();
    });
    const while_looking = onPageSaid.mock.calls.length;
    expect(while_looking).toBeGreaterThan(1);

    await act(async () => {
      window.dispatchEvent(new FocusEvent('blur'));
      await Promise.resolve();
    });
    await act(async () => {
      vi.advanceTimersByTime(5_000);
      await Promise.resolve();
    });
    expect(onPageSaid.mock.calls.length).toBe(while_looking);
    vi.useRealTimers();
  });

  /* The shell keeps its own sixty lines and there is no way to empty them from
     here, so Clear hides what is shown and says nothing about the buffer. */
  it('clears what it is showing', async () => {
    const onPageSaid = vi.fn(() => Promise.resolve(PRINTED));
    const where = drawer({ page: 'http://localhost:5173', onPageSaid });
    await act(async () => {
      window.dispatchEvent(new FocusEvent('focus'));
      where.querySelectorAll<HTMLButtonElement>('.commands__tab')[1]?.click();
      await Promise.resolve();
    });
    expect(where.querySelectorAll('.commands__note')).toHaveLength(2);
    act(() => {
      [...where.querySelectorAll<HTMLButtonElement>('.commands__press')]
        .find((one) => one.textContent === COMMANDS_WORDS.clear)
        ?.click();
    });
    expect(where.querySelectorAll('.commands__note')).toHaveLength(0);
  });
});

describe('what the page said, on the wire', () => {
  /* Five places, and a test rather than a habit: a channel that exists in four
     of them is a method that resolves to undefined at run time. */
  it('is in all five places', () => {
    expect(read('src/lib/ipc.ts')).toContain("pageSaid: 'graphe:page-said'");
    expect(read('src/lib/ipc.ts')).toMatch(/pageSaid\(where\?: Where\): Promise<Result<readonly Said\[\]>>/);
    expect(read('electron/preload.ts')).toContain('CHANNEL.pageSaid');
    expect(read('electron/main.ts')).toContain('handle<readonly Said[]>(CHANNEL.pageSaid');
    const bridge = read('src/lib/bridge.ts');
    expect(bridge).toContain('pageSaid(): Promise<Result<readonly Said[]>>');
    expect(bridge).toContain('pageSaid: (where) =>');
  });

  it('reads the shell’s lines through the model rather than a second one', () => {
    expect(read('electron/main.ts')).toContain('saidFrom(pageSaid)');
  });
});
