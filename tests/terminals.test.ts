/** The row of terminal tabs, and the one rule that must never bend.
 *
 * The rule is T-04: the person's tab is theirs and is not sandboxed; the agent's
 * is a record and never takes a keystroke. Most of what is checked here is that
 * the second half of that holds for every tab the module can produce — a tab
 * that could take typing and carry the agent's boundary is the worst bug this
 * app could have, so it is asserted rather than described.
 */

import { describe, expect, it } from 'vitest';

import {
  MOST_TERMINALS,
  TERMINAL_KEYS,
  afterClosing,
  canType,
  closeTerminal,
  isGuarded,
  killsOnClose,
  noteFor,
  openTerminal,
  saysClose,
  saysNoPrompt,
  saysState,
  tabsFor,
  terminalEnded,
  terminalStarted,
  terminalWords,
  titleFor,
  type Terminal,
} from '../src/work/terminals';

const HERE = '/Users/you/projects/paper-street';

function opened(...wanted: Parameters<typeof openTerminal>[1][]): readonly Terminal[] {
  let all: readonly Terminal[] = [];
  for (const one of wanted) all = openTerminal(all, one).all;
  return all;
}

describe('whose shell it is', () => {
  it('never lets the agent’s tab take a keystroke', () => {
    const all = opened(
      { kind: 'yours', folder: HERE },
      { kind: 'agent', folder: HERE },
      { kind: 'server', folder: HERE, title: 'npm run dev', pid: 41 },
    );
    for (const one of all) {
      expect(canType(one)).toBe(one.kind === 'yours');
    }
  });

  it('sandboxes everything except the person’s own', () => {
    const all = opened(
      { kind: 'yours', folder: HERE },
      { kind: 'agent', folder: HERE },
      { kind: 'server', folder: HERE, pid: 7 },
    );
    expect(all.filter((one) => !isGuarded(one)).map((one) => one.kind)).toEqual(['yours']);
  });

  /* The two facts travel with the kind rather than beside it, so there is no
     way to hand this module a tab where they disagree. */
  it('decides the two facts from the kind, not from the caller', () => {
    const { opened: one } = openTerminal([], {
      kind: 'agent',
      folder: HERE,
      // @ts-expect-error an agent tab that takes typing is not a shape that exists
      takesTyping: true,
    });
    expect(one?.takesTyping).toBe(false);
    expect(one?.guarded).toBe(true);
  });

  it('says why there is no prompt, differently for each', () => {
    const all = opened({ kind: 'agent', folder: HERE }, { kind: 'server', folder: HERE, pid: 3 });
    expect(saysNoPrompt(all[0] as Terminal)).toBe(terminalWords.readingOnly);
    expect(saysNoPrompt(all[1] as Terminal)).toBe(terminalWords.noPrompt);
  });

  it('offers no prompt on a shell that has ended', () => {
    const [yours] = opened({ kind: 'yours', folder: HERE, pid: 900 });
    const ended = terminalEnded([yours as Terminal], (yours as Terminal).id, 0);
    expect(canType(ended[0] as Terminal)).toBe(false);
    expect(saysNoPrompt(ended[0] as Terminal)).not.toBeNull();
  });
});

describe('opening and closing', () => {
  it('hands back the shell that is already open rather than a second one', () => {
    const first = openTerminal([], { kind: 'yours', folder: HERE });
    const again = openTerminal(first.all, { kind: 'yours', folder: HERE });
    expect(again.all).toHaveLength(1);
    expect(again.opened?.id).toBe(first.opened?.id);
    expect(again.because).toBeNull();
  });

  it('opens a shell per folder, because a copy is its own place', () => {
    const all = opened(
      { kind: 'yours', folder: HERE },
      { kind: 'yours', folder: '/Users/you/copies/paper-street/work-1' },
    );
    expect(all).toHaveLength(2);
  });

  it('says why when the row is full, and opens nothing', () => {
    let all: readonly Terminal[] = [];
    for (let at = 0; at < MOST_TERMINALS; at += 1) {
      all = openTerminal(all, { kind: 'server', folder: HERE, id: `run-${String(at)}` }).all;
    }
    const full = openTerminal(all, { kind: 'server', folder: HERE, id: 'one-too-many' });
    expect(full.opened).toBeNull();
    expect(full.because).toContain(String(MOST_TERMINALS));
    expect(full.all).toHaveLength(MOST_TERMINALS);
  });

  it('makes room again once one has ended', () => {
    let all: readonly Terminal[] = [];
    for (let at = 0; at < MOST_TERMINALS; at += 1) {
      all = openTerminal(all, { kind: 'server', folder: HERE, id: `run-${String(at)}` }).all;
    }
    all = terminalEnded(all, 'run-0', 1);
    expect(openTerminal(all, { kind: 'server', folder: HERE, id: 'next' }).opened).not.toBeNull();
  });

  it('gives the same row the same ids every time', () => {
    const once = opened({ kind: 'yours', folder: HERE }, { kind: 'server', folder: HERE });
    const twice = opened({ kind: 'yours', folder: HERE }, { kind: 'server', folder: HERE });
    expect(once.map((one) => one.id)).toEqual(twice.map((one) => one.id));
  });

  it('takes the running piece’s own id for a server', () => {
    const { opened: one } = openTerminal([], { kind: 'server', folder: HERE, id: 'run-3' });
    expect(one?.id).toBe('run-3');
  });

  it('closes one and leaves the rest', () => {
    const all = opened({ kind: 'yours', folder: HERE }, { kind: 'agent', folder: HERE });
    const left = closeTerminal(all, (all[0] as Terminal).id);
    expect(left.map((one) => one.kind)).toEqual(['agent']);
  });

  it('stops what a tab owns on close, and nothing on the agent’s', () => {
    const all = opened(
      { kind: 'yours', folder: HERE, pid: 100 },
      { kind: 'agent', folder: HERE },
      { kind: 'server', folder: HERE, pid: 200 },
    );
    expect(all.map(killsOnClose)).toEqual([true, false, true]);
    expect(saysClose(all[0] as Terminal)).toBe(terminalWords.closeStops);
    expect(saysClose(all[1] as Terminal)).toBe(terminalWords.close);
  });

  it('puts the tab beside the closed one in front', () => {
    const all = opened(
      { kind: 'yours', folder: HERE },
      { kind: 'agent', folder: HERE },
      { kind: 'server', folder: HERE, id: 'run-1' },
    );
    expect(afterClosing(all, HERE, 'agent:' + HERE)).toBe('run-1');
    expect(afterClosing(all, HERE, 'run-1')).toBe('agent:' + HERE);
  });
});

describe('the row', () => {
  it('draws yours, then the agent’s, then the servers oldest first', () => {
    const all = opened(
      { kind: 'server', folder: HERE, id: 'run-1', title: 'npm run dev' },
      { kind: 'agent', folder: HERE },
      { kind: 'server', folder: HERE, id: 'run-2', title: 'npm run api' },
      { kind: 'yours', folder: HERE },
    );
    expect(tabsFor(all, HERE).map(titleFor)).toEqual([
      terminalWords.yours,
      terminalWords.agent,
      'npm run dev',
      'npm run api',
    ]);
  });

  it('shows the tabs of a folder and everything under it', () => {
    const all = opened(
      { kind: 'yours', folder: HERE },
      { kind: 'server', folder: `${HERE}/site`, id: 'run-1' },
      { kind: 'yours', folder: '/Users/you/projects/other' },
    );
    expect(tabsFor(all, HERE)).toHaveLength(2);
    expect(tabsFor(all, '/Users/you/projects/other')).toHaveLength(1);
  });

  it('does not take another project as its own for sharing a prefix', () => {
    const all = opened({ kind: 'yours', folder: '/Users/you/projects/paper-street-two' });
    expect(tabsFor(all, HERE)).toEqual([]);
  });

  it('names a server after what it was started as', () => {
    const [one] = opened({ kind: 'server', folder: HERE, title: '  npm run dev  ' });
    expect(titleFor(one as Terminal)).toBe('npm run dev');
  });

  it('has something to say about every kind', () => {
    const all = opened(
      { kind: 'yours', folder: HERE },
      { kind: 'agent', folder: HERE },
      { kind: 'server', folder: HERE },
    );
    for (const one of all) expect(noteFor(one).length).toBeGreaterThan(10);
  });
});

describe('what it is doing', () => {
  it('starts before it is running, and keeps the tab once it has ended', () => {
    const { all, opened: one } = openTerminal([], { kind: 'server', folder: HERE, id: 'run-1' });
    expect(one?.state).toBe('starting');
    expect(saysState(one as Terminal)).toBe(terminalWords.starting);

    const up = terminalStarted(all, 'run-1', { pid: 4242, address: 'http://localhost:5173' });
    expect(up[0]?.state).toBe('running');
    expect(up[0]?.pid).toBe(4242);
    expect(up[0]?.address).toBe('http://localhost:5173');

    const gone = terminalEnded(up, 'run-1', 1);
    expect(gone[0]?.state).toBe('ended');
    expect(gone[0]?.exitCode).toBe(1);
    expect(gone[0]?.pid).toBeNull();
    expect(gone).toHaveLength(1);
  });

  it('is running the moment it is handed a process id', () => {
    const { opened: one } = openTerminal([], { kind: 'yours', folder: HERE, pid: 12 });
    expect(one?.state).toBe('running');
  });
});

describe('reaching it', () => {
  /* ⌘J already shows the page beside the conversation, so the panel takes the
     key every terminal in every editor already answers to. */
  it('does not take a chord the window already uses', () => {
    expect(TERMINAL_KEYS.panel).not.toBe('mod+j');
    expect(TERMINAL_KEYS.panel).toBe('mod+`');
    expect(TERMINAL_KEYS.newTab).toBe('mod+shift+t');
  });
});
