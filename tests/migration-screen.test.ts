// @vitest-environment jsdom
/** The move of older chats, drawn and pressed on the Storage page.
 *
 * A record existed before this and reached nobody: the counts went to the log,
 * and somebody whose chat opened in an unexpected folder had nothing to read.
 * What is worth guarding is the screen: that the sentences are drawn, that the
 * recovery is behind one press rather than on a screen of its own, and that a
 * computer which never needed the move is told nothing at all.
 *
 * Read as behaviour, because every one of those is about what happens when
 * somebody presses. The readout itself is proven next door against a real
 * marker file.
 */

import { act, createElement, useMemo, useState, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import Migration from '../src/components/Migration';
import type { MigrationNow, Result } from '../src/lib/ipc';
import { migrationActions, saysMigration, type MigrationCalls } from '../src/work/migration';

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

const NOW = Date.parse('2026-09-15T12:00:00Z');
const MOVED_AT = NOW - 3 * 60 * 60 * 1000;
const PROFILE = '/Users/somebody/Library/Application Support/Graphe';

const NOTHING: MigrationNow = {
  completedAt: null,
  sources: 0,
  verdicts: { verified: 0, missing: 0, gone: 0, foreign: 0 },
  connected: 0,
  unlinked: 0,
  unreadable: 0,
  backups: null,
  backupFolder: PROFILE,
  newer: false,
};

/** What a move that found four chats left behind. */
const MOVED: MigrationNow = {
  ...NOTHING,
  completedAt: MOVED_AT,
  sources: 4,
  verdicts: { verified: 3, missing: 1, gone: 0, foreign: 0 },
  connected: 3,
  unlinked: 1,
  unreadable: 1,
  backups: 3,
};

const NOTHING_PRESSED = (): void => undefined;

function draw(element: ReactElement): HTMLDivElement {
  const where = document.createElement('div');
  document.body.append(where);
  host = where;
  root = createRoot(where);
  act(() => {
    root?.render(element);
  });
  return where;
}

const lines = (where: HTMLElement): readonly string[] =>
  [...where.querySelectorAll<HTMLElement>('.settings__said li')].map((one) => one.textContent ?? '');

const pressFor = (where: HTMLElement, label: string): HTMLButtonElement | undefined =>
  [...where.querySelectorAll('button')].find((one) => one.textContent === label);

async function press(node: HTMLButtonElement | undefined): Promise<void> {
  await act(async () => {
    node?.click();
  });
}

/** A shell that answers the way the real one does and remembers, in order, what
 *  it was asked. */
function shell(answers: { check?: MigrationNow }): { calls: MigrationCalls; asked: string[] } {
  const asked: string[] = [];
  const calls: MigrationCalls = {
    migration: () => {
      asked.push('migration');
      return Promise.resolve({ ok: true, value: MOVED } satisfies Result<MigrationNow>);
    },
    migrationCheck: () => {
      asked.push('check');
      return Promise.resolve({ ok: true, value: answers.check ?? MOVED } satisfies Result<MigrationNow>);
    },
    showBackups: () => {
      asked.push('backups');
      return Promise.resolve({ ok: true, value: null } satisfies Result<null>);
    },
  };
  return { calls, asked };
}

/** The section wired the way the window wires it: the sheet's own state, the
 *  shell's three calls, and the redraw from whatever came back. */
function Wired({ start, calls }: { start: MigrationNow; calls: MigrationCalls }): ReactElement {
  const [now, setNow] = useState(start);
  const wire = useMemo(() => migrationActions(calls, setNow, NOTHING_PRESSED), [calls]);
  return createElement(Migration, {
    migration: now,
    onCheck: wire.check,
    onBackups: wire.backups,
    now: NOW,
  });
}

describe('what the move found', () => {
  it('says when it happened, and puts the rest behind one press', () => {
    const where = draw(createElement(Migration, { migration: MOVED, now: NOW }));

    // The row above it names the section; this is the line it happened in.
    expect(where.textContent).toContain('Moved 3 hours ago.');
    // Closed, because it is read on purpose by somebody already suspicious.
    expect(lines(where)).toEqual([]);
  });

  it('draws every sentence the readout made, and no more', async () => {
    const where = draw(createElement(Migration, { migration: MOVED, now: NOW }));
    await press(pressFor(where, 'Details'));

    const expected = saysMigration(MOVED, NOW).slice(1);
    expect(lines(where)).toEqual(expected);
    expect(lines(where).join(' ')).toContain('could not be read');
    // Nothing about the four chats that were not left out.
    expect(lines(where).join(' ')).not.toContain('4 chats could not be placed');
  });

  it('names where the copies are, and offers the way back', async () => {
    const { calls, asked } = shell({});
    const where = draw(createElement(Wired, { start: MOVED, calls }));
    await press(pressFor(where, 'Details'));

    expect(where.textContent).toContain(PROFILE);
    await press(pressFor(where, 'Show copies'));
    expect(asked).toEqual(['backups']);

    await press(pressFor(where, 'Check again'));
    expect(asked).toEqual(['backups', 'check']);
  });

  /* Offering a press that opens a folder with nothing in it is worse than not
     offering it: the way back has to be known to be there. */
  it('offers the copies only where some are still known to be', async () => {
    const where = draw(
      createElement(Migration, {
        migration: { ...MOVED, backups: 0 },
        onBackups: NOTHING_PRESSED,
        onCheck: NOTHING_PRESSED,
        now: NOW,
      }),
    );
    await press(pressFor(where, 'Details'));
    expect(pressFor(where, 'Show copies')).toBeUndefined();
    expect(pressFor(where, 'Check again')).toBeDefined();
  });

  it('redraws from what the check answered rather than what it hoped', async () => {
    const fewer: MigrationNow = { ...MOVED, unlinked: 0, unreadable: 0, backups: 3 };
    const { calls } = shell({ check: fewer });
    const where = draw(createElement(Wired, { start: MOVED, calls }));
    await press(pressFor(where, 'Details'));
    expect(lines(where).join(' ')).toContain('could not be placed');

    await press(pressFor(where, 'Check again'));
    expect(lines(where).join(' ')).not.toContain('could not be placed');
  });
});

describe('a computer that has never been through it', () => {
  it('says so in one line, with nothing to press', () => {
    const where = draw(
      createElement(Migration, { migration: NOTHING, onCheck: NOTHING_PRESSED, onBackups: NOTHING_PRESSED, now: NOW }),
    );
    expect(where.textContent).toContain('Nothing has been moved on this computer.');
    expect([...where.querySelectorAll('button')]).toEqual([]);
  });

  /* While the shell has not answered there is nothing to claim, one way or the
     other. */
  it('says it is reading rather than that nothing happened', () => {
    const where = draw(createElement(Migration, { migration: null, now: NOW }));
    expect(where.textContent).toContain('Reading what it found');
    expect(where.textContent).not.toContain('Nothing has been moved');
  });
});

describe('a profile from a newer app', () => {
  it('is drawn, says what to do, and keeps the folder out of reach of a delete', async () => {
    const where = draw(
      createElement(Migration, {
        migration: { ...NOTHING, newer: true, backupFolder: PROFILE },
        onCheck: NOTHING_PRESSED,
        now: NOW,
      }),
    );
    await press(pressFor(where, 'Details'));

    const said = where.textContent ?? '';
    expect(said).toContain('newer version of Graphe');
    expect(said).toContain('not writing to it');
    expect(said).toContain('Do not delete it by hand');
  });
});
