/** The note written in the seconds before the app goes.
 *
 * 9.4 asks that at quit the app records the runs it interrupted, and that
 * accepted work is written down before it does. The shell does that in
 * `writeDownWhatWasGoing` (electron/main.ts:7437), which has nothing to await
 * into: each piece still going is written with `Notebook.noteNow`
 * (src/work/notebook.ts:74). It runs first in `app.on('before-quit')` (:12278),
 * ahead of `stopEverythingAway` and the kills, so a throw from it would skip
 * every step after it and leave helpers running with nobody left to stop them —
 * and the same write is all that stands between a person's afternoon and a
 * machine that lost power.
 *
 * What is held here is that write: it is on the disk by the time it returns, it
 * replaces only its own note, and a page it cannot write costs the note rather
 * than the quit. Not here: the ordering of the quit sequence itself and the
 * ending of the processes it reaches, which need a real Electron process —
 * `tests/processes.test.ts` (the ledger, including a child that refuses to go)
 * and `tests/running-limits.test.ts` (stopAllNow, and a register that refuses
 * anything new afterwards) hold those halves. The awaited form of the same
 * write, and a note read back on the next launch, are in
 * `tests/surviving.test.ts`; `recoverAfterRestart` (src/domain/conversations.ts:107)
 * has no caller in the shell and is held in `tests/domain.test.ts`. Sleep/wake,
 * renderer crash and force quit need a real window and are not here.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import type { PieceOfWork } from '../../src/history/attempts';
import { Notebook } from '../../src/work/notebook';
import { noteOf, type Owner, type Written } from '../../src/work/written';

const made: string[] = [];

afterAll(async () => {
  await Promise.all(made.map((folder) => rm(folder, { recursive: true, force: true })));
});

async function scratch(what: string): Promise<string> {
  const folder = await realpath(await mkdtemp(join(tmpdir(), `graphe-ops-${what}-`)));
  made.push(folder);
  return folder;
}

const PROJECT = '/projects/site';
const OURS: Owner = { pid: 4242, since: 1000 };

function piece(over: Partial<PieceOfWork> = {}): PieceOfWork {
  return {
    id: 'work-1',
    doing: 'Make the sign-in page work on a phone',
    state: 'running',
    folder: '/copies/project/work-1',
    version: null,
    picture: null,
    at: 500,
    trouble: null,
    ...over,
  };
}

function note(over: Partial<Written> = {}): Written {
  return {
    ...noteOf(piece(), { project: PROJECT, name: 'site', owner: OURS }),
    ...over,
  };
}

/** The one file on a project's page. */
function onlyFile(page: string): string {
  const names = readdirSync(page).filter((one) => one.endsWith('.json'));
  expect(names).toHaveLength(1);
  return join(page, names[0] as string);
}

/* ========================================================================== */

describe('work written down on the way out', () => {
  it('is on the disk by the time the call returns, with nothing left waiting', async () => {
    const root = await scratch('quit');
    const book = new Notebook(root);

    book.noteNow(note());

    // Read synchronously, the way the next launch would: a quit has no second
    // chance, so there is nothing left in flight when this returns.
    const raw = JSON.parse(readFileSync(onlyFile(book.pageFor(PROJECT)), 'utf8')) as {
      work?: { id?: unknown; state?: unknown };
    };
    expect(raw.work?.id).toBe('work-1');
    expect(raw.work?.state).toBe('running');

    const back = await new Notebook(root).page(PROJECT);
    expect(back.map((one) => one.id)).toEqual(['work-1']);
  });

  it('replaces only its own note, leaving the rest of the page where it was', async () => {
    const root = await scratch('quit');
    const book = new Notebook(root);
    // Written by the ordinary, awaited path before anything was interrupted.
    await book.note(note({ id: 'work-2', doing: 'Another thing', at: 100 }));

    book.noteNow(note({ doing: 'Cut short by the quit', at: 200 }));
    book.noteNow(note({ id: 'work-3', doing: 'A third thing', at: 300 }));

    const page = await new Notebook(root).page(PROJECT);
    expect(page.map((one) => [one.id, one.doing])).toEqual([
      ['work-2', 'Another thing'],
      ['work-1', 'Cut short by the quit'],
      ['work-3', 'A third thing'],
    ]);
  });

  it('costs the note rather than the quit when the page cannot be written', async () => {
    const root = await scratch('quit');
    // A path where the page's folder would go, so nothing on it can be written.
    const blocked = join(root, 'not-a-folder');
    await writeFile(blocked, 'not a folder', 'utf8');

    expect(() => new Notebook(blocked).noteNow(note())).not.toThrow();
    expect(readdirSync(root)).toEqual(['not-a-folder']);
    expect(await readFile(blocked, 'utf8')).toBe('not a folder');
  });

  it('leaves no scratch behind on the page a person can open', async () => {
    const root = await scratch('quit');
    const book = new Notebook(root);
    book.noteNow(note());
    book.noteNow(note({ doing: 'And again' }));

    expect(readdirSync(book.pageFor(PROJECT)).every((name) => name.endsWith('.json'))).toBe(true);
  });
});
