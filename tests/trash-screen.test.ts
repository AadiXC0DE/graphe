// @vitest-environment jsdom
/** The trash on the Storage page, drawn and pressed.
 *
 * Deleting a conversation keeps it, and this is the only way back: the list of
 * what went, a Restore on each row, and one Empty that throws away what was
 * picked rather than the lot. Read as behaviour rather than as source text,
 * because the three things worth getting right are all about what happens when
 * somebody presses — the name that goes to the shell, the re-list after it
 * lands, and a press with nothing picked sending nothing at all.
 */

import { act, createElement, useMemo, useState, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import Trash from '../src/components/Trash';
import type { Result, TrashView, TrashedConversation, Trouble } from '../src/lib/ipc';
import { trashActions, type TrashCalls } from '../src/work/trash';

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

/** The clock the rows are read against, so the moment one went is a number this
 *  file chose rather than whatever time the run started. */
const NOW = Date.parse('2026-09-15T12:00:00Z');

/** A sentence no file in `src/` contains, so a drawn copy of it could only have
 *  come from the shell. */
const RULE = 'The rule this shelf is kept under, sent with the list.';

function kept(name: string, wentAt: string, size: number): TrashedConversation {
  return { name, path: `/data/trash-conversations/${name}`, wentAt, size };
}

const YESTERDAY = kept(
  '2026-09-14T09-00-00-000Z-2026-09-01T08-00-00-000Z_aaa.jsonl',
  '2026-09-14T09:00:00.000Z',
  1200,
);
const THIS_MORNING = kept(
  '2026-09-15T09-00-00-000Z-2026-09-02T10-00-00-000Z_bbb.jsonl',
  '2026-09-15T09:00:00.000Z',
  3_400_000,
);
const LAST_WEEK = kept(
  '2026-09-08T09-00-00-000Z-2026-08-20T07-00-00-000Z_ccc.jsonl',
  '2026-09-08T09:00:00.000Z',
  900,
);

function viewOf(items: readonly TrashedConversation[]): TrashView {
  return { items, rule: RULE };
}

const NOTHING = (): void => undefined;

function draw(element: ReactElement): HTMLDivElement {
  if (host === null) {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  }
  act(() => {
    root?.render(element);
  });
  return host;
}

/** One conversation's row. */
function rows(where: HTMLElement): readonly HTMLElement[] {
  return [...where.querySelectorAll<HTMLElement>('.settings__folder')];
}

function inRow(where: HTMLElement, index: number, label: string): HTMLButtonElement {
  return [...(rows(where)[index]?.querySelectorAll('button') ?? [])].find(
    (one) => one.textContent?.trim() === label,
  ) as HTMLButtonElement;
}

function boxIn(where: HTMLElement, index: number): HTMLInputElement {
  return rows(where)[index]?.querySelector('input') as HTMLInputElement;
}

/** When one of them went, as the row says it. */
function wentIn(where: HTMLElement, index: number): string {
  return rows(where)[index]?.querySelector('.settings__note')?.textContent ?? '';
}

function emptyPress(where: HTMLElement): HTMLButtonElement {
  return [...where.querySelectorAll('button')].find(
    (one) => one.textContent?.trim() === 'Empty selected',
  ) as HTMLButtonElement;
}

const REFUSED: Trouble = {
  what: 'I could not put that conversation back.',
  because: 'A conversation with that name is open already.',
  actionLabel: 'Got it',
};

/** A shell that answers the way the real one does and remembers, in order, what
 *  it was asked. */
function shell(answers: {
  list?: readonly TrashView[];
  restore?: Result<string | null>;
}): { calls: TrashCalls; asked: string[] } {
  const asked: string[] = [];
  const views = answers.list ?? [];
  let listings = 0;
  const calls: TrashCalls = {
    trashList: () => {
      asked.push('list');
      const next = views[Math.min(listings, views.length - 1)] ?? { items: [], rule: RULE };
      listings += 1;
      return Promise.resolve({ ok: true, value: next });
    },
    trashRestore: (name) => {
      asked.push(`restore ${name}`);
      return Promise.resolve(answers.restore ?? { ok: true, value: `/sessions/${name}` });
    },
    trashEmpty: (names) => {
      asked.push(`empty [${names.join(' ')}]`);
      return Promise.resolve({ ok: true, value: names });
    },
  };
  return { calls, asked };
}

/** The section wired the way the window wires it: the sheet's own state, the
 *  shell's three calls, and the re-list after every press that landed. */
function Wired({
  start,
  calls,
  said,
}: {
  start: TrashView;
  calls: TrashCalls;
  said: string[];
}): ReactElement {
  const [view, setView] = useState(start);
  const wire = useMemo(
    () => trashActions(calls, setView, (one) => said.push(one)),
    [calls, said],
  );
  return createElement(Trash, {
    trash: view,
    onRestore: wire.restore,
    onEmpty: wire.empty,
    now: NOW,
  });
}

async function press(node: HTMLButtonElement | null): Promise<void> {
  await act(async () => {
    node?.click();
  });
}

describe('what is in the trash', () => {
  it('lists every conversation the shell returned, with what it is taking', () => {
    const where = draw(
      createElement(Trash, {
        trash: viewOf([YESTERDAY, THIS_MORNING]),
        onRestore: NOTHING,
        onEmpty: NOTHING,
        now: NOW,
      }),
    );

    const said = rows(where).map((one) => one.textContent ?? '');
    expect(rows(where)).toHaveLength(2);
    expect(said[0]).toContain(YESTERDAY.name);
    expect(said[0]).toContain('1 KB');
    expect(said[1]).toContain(THIS_MORNING.name);
    expect(said[1]).toContain('3.4 MB');
  });

  /* Two conversations deleted at different moments have to read differently, or
     the line is a label rather than the moment it says it is. */
  it('says when each one went, from the moment the shell gave', () => {
    const where = draw(
      createElement(Trash, {
        trash: viewOf([YESTERDAY, LAST_WEEK]),
        onRestore: NOTHING,
        onEmpty: NOTHING,
        now: NOW,
      }),
    );

    expect(wentIn(where, 0)).toMatch(/^Deleted \S/);
    expect(wentIn(where, 1)).toMatch(/^Deleted \S/);
    expect(wentIn(where, 0)).not.toBe(wentIn(where, 1));
  });

  it('states the rule it was handed rather than one of its own', () => {
    const where = draw(
      createElement(Trash, {
        trash: viewOf([YESTERDAY]),
        onRestore: NOTHING,
        onEmpty: NOTHING,
        now: NOW,
      }),
    );
    expect(where.textContent).toContain(RULE);
  });

  it('says so when there is nothing in it', () => {
    const where = draw(createElement(Trash, { trash: viewOf([]), now: NOW }));
    expect(where.textContent).toContain('Nothing has been deleted.');
  });

  it('says it is reading before the shell has answered', () => {
    const where = draw(createElement(Trash, { trash: null, now: NOW }));
    expect(where.textContent).toContain('Reading what is here…');
  });
});

describe('putting one back', () => {
  it('names the conversation it was asked for, and lists the trash again', async () => {
    const { calls, asked } = shell({ list: [viewOf([YESTERDAY])] });
    const said: string[] = [];
    const where = draw(
      createElement(Wired, { start: viewOf([YESTERDAY, THIS_MORNING]), calls, said }),
    );

    await press(inRow(where, 1, 'Restore'));

    expect(asked).toEqual([`restore ${THIS_MORNING.name}`, 'list']);
    // The shell's next listing is what is drawn, so what came back is gone.
    expect(rows(where)).toHaveLength(1);
    expect(where.textContent).toContain(YESTERDAY.name);
    expect(where.textContent).not.toContain(THIS_MORNING.name);
  });

  it('says why when a conversation is already under that name, and changes nothing', async () => {
    const { calls, asked } = shell({ restore: { ok: false, trouble: REFUSED } });
    const said: string[] = [];
    const where = draw(createElement(Wired, { start: viewOf([YESTERDAY]), calls, said }));

    await press(inRow(where, 0, 'Restore'));

    expect(asked).toEqual([`restore ${YESTERDAY.name}`]);
    expect(said.join(' ')).toContain(REFUSED.what);
    expect(rows(where)).toHaveLength(1);
  });
});

describe('emptying it', () => {
  it('throws away the conversations that were picked, and only those', async () => {
    const { calls, asked } = shell({ list: [viewOf([THIS_MORNING])] });
    const said: string[] = [];
    const where = draw(
      createElement(Wired, { start: viewOf([YESTERDAY, THIS_MORNING, LAST_WEEK]), calls, said }),
    );

    await act(async () => {
      boxIn(where, 0).click();
      boxIn(where, 2).click();
    });
    await press(emptyPress(where));

    expect(asked).toEqual([`empty [${YESTERDAY.name} ${LAST_WEEK.name}]`, 'list']);
    expect(rows(where)).toHaveLength(1);
    expect(where.textContent).toContain(THIS_MORNING.name);
  });

  it('sends nothing at all when nothing was picked', async () => {
    const { calls, asked } = shell({});
    const said: string[] = [];
    const where = draw(createElement(Wired, { start: viewOf([YESTERDAY]), calls, said }));

    expect(emptyPress(where).disabled).toBe(true);
    await press(emptyPress(where));

    expect(asked).toEqual([]);
    expect(rows(where)).toHaveLength(1);
  });

  /* What was picked is a name, and the shell may have listed the trash again
     since — a restore somewhere else, a second window. A name that is no longer
     there is not one to throw away. */
  it('never sends a name the list no longer carries', async () => {
    const sent: (readonly string[])[] = [];
    const section = (trash: TrashView): ReactElement =>
      createElement(Trash, {
        trash,
        onEmpty: (names) => sent.push(names),
        now: NOW,
      });

    const where = draw(section(viewOf([YESTERDAY, THIS_MORNING])));
    await act(async () => {
      boxIn(where, 0).click();
    });
    // The shell lists it again without the one that was picked.
    draw(section(viewOf([THIS_MORNING])));

    expect(emptyPress(where).disabled).toBe(true);
    await press(emptyPress(where));
    expect(sent).toEqual([]);
  });
});
