/** Work that outlives the window it was asked from.
 *
 * Three claims, and they fail in three different ways.
 *
 * 1. **It is still there next time.** A run written down before it starts is a
 *    run that comes back on the board after a quit, a reload or a machine that
 *    lost power. Get this wrong and the copies stay on the disk with nothing
 *    pointing at them and nothing to explain them.
 *
 * 2. **A helper whose app went away is ended.** This is the stop-ship. A helper
 *    is its own program: it does not need us, and it will read and think and
 *    spend against somebody's account for as long as it likes with nothing left
 *    to report to and no limit able to reach it.
 *
 * 3. **Two runs never tread on each other.** One note each, one page per
 *    project, because every board starts its first piece of work at the same
 *    name.
 *
 * The notebook touches a real disk, for the same reason history.test.ts does:
 * the claim is "it is still there next time", and only a disk can settle that.
 */

import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import type { PieceOfWork } from '../src/history/attempts';
import { Notebook, keyFor } from '../src/work/notebook';
import { endStrays, readRunning, whichAreStray, type Alive } from '../src/work/strays';
import {
  addSpend,
  asPiece,
  noteOf,
  onComingBack,
  readWritten,
  writtenWords,
  type Owner,
  type Written,
} from '../src/work/written';

/* ------------------------------------------------------------ scaffolding */

const madeFolders: string[] = [];

afterAll(async () => {
  await Promise.all(madeFolders.map((folder) => rm(folder, { recursive: true, force: true })));
});

async function newFolder(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), 'graphe-surviving-'));
  madeFolders.push(folder);
  return folder;
}

const OURS: Owner = { pid: 4242, since: 1000 };
const BEFORE: Owner = { pid: 99, since: 1 };

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
    ...noteOf(piece(), { project: '/projects/site', name: 'site', owner: BEFORE }),
    ...over,
  };
}

const ALWAYS = { alive: () => true, copyThere: () => true };
const NOBODY = { alive: () => false, copyThere: () => true };

/* ========================================================================== */
/* It is still there next time                                                 */
/* ========================================================================== */

describe('coming back to work that was going', () => {
  it('leaves alone what something else is still looking after', () => {
    expect(onComingBack(note(), { ours: OURS, ...ALWAYS })).toEqual({ do: 'leave' });
  });

  it('knows its own from one that was given the same number later', () => {
    const mine = note({ owner: OURS });
    expect(onComingBack(mine, { ours: OURS, ...ALWAYS })).toEqual({ do: 'carry-on' });

    const namesake = note({ owner: { pid: OURS.pid, since: OURS.since - 5000 } });
    expect(onComingBack(namesake, { ours: OURS, ...NOBODY }).do).not.toBe('carry-on');
  });

  it('picks up one that never got its turn', () => {
    const waiting = note({ state: 'waiting', folder: null });
    expect(onComingBack(waiting, { ours: OURS, ...NOBODY })).toEqual({ do: 'pick-up' });
  });

  it('puts finished work back exactly as it was', () => {
    for (const state of ['done', 'failed'] as const) {
      const over = note({ state, version: 'abc123' });
      expect(onComingBack(over, { ours: OURS, ...NOBODY })).toEqual({ do: 'put-back' });
    }
  });

  it('says so rather than pretending it can carry on mid-thought', () => {
    for (const state of ['running', 'needs-you'] as const) {
      const going = note({ state });
      expect(onComingBack(going, { ours: OURS, ...NOBODY })).toEqual({
        do: 'cut-short',
        trouble: writtenWords.cutShort,
      });
    }
  });

  it('says when the copy it needs has gone', () => {
    const gone = note({ state: 'done', version: 'abc123' });
    const back = onComingBack(gone, { ours: OURS, alive: () => false, copyThere: () => false });
    expect(back).toEqual({ do: 'cut-short', trouble: writtenWords.copyGone });
  });

  it('carries the whole row back onto the board', () => {
    const finished = note({
      state: 'done',
      version: 'abc123',
      picture: 'data:image/png;base64,zzz',
      trouble: null,
    });
    expect(asPiece(finished)).toEqual({
      id: 'work-1',
      doing: 'Make the sign-in page work on a phone',
      state: 'done',
      folder: '/copies/project/work-1',
      version: 'abc123',
      picture: 'data:image/png;base64,zzz',
      at: 500,
      trouble: null,
    });
  });
});

describe('a run written down before it starts', () => {
  it('is still there after everything holding it has gone', async () => {
    const root = await newFolder();
    const asked = note({ state: 'waiting', folder: null, spent: null });

    // One copy of the app writes it down, then goes away entirely.
    await new Notebook(root).note(asked);

    // Another opens the same folder and finds it.
    const later = await new Notebook(root).page('/projects/site');
    expect(later).toHaveLength(1);
    expect(later[0]?.doing).toBe('Make the sign-in page work on a phone');
    expect(later[0]?.state).toBe('waiting');

    const back = onComingBack(later[0] as Written, { ours: OURS, ...NOBODY });
    expect(back).toEqual({ do: 'pick-up' });
  });

  it('comes back with its picture, its sentence and what it cost', async () => {
    const root = await newFolder();
    const landed = note({
      state: 'done',
      version: 'abc123',
      picture: 'data:image/png;base64,zzz',
      says: 'The sign-in page fits a phone now.',
      spent: { minor: 138, currency: 'USD' },
    });
    await new Notebook(root).note(landed);

    const [back] = await new Notebook(root).page('/projects/site');
    expect(back?.picture).toBe('data:image/png;base64,zzz');
    expect(back?.says).toBe('The sign-in page fits a phone now.');
    expect(back?.spent).toEqual({ minor: 138, currency: 'USD' });
  });

  it('is found on a cold start without being told which projects to look in', async () => {
    const root = await newFolder();
    const book = new Notebook(root);
    await book.note(note({ id: 'work-1', project: '/projects/site' }));
    await book.note(note({ id: 'work-1', project: '/projects/shop' }));

    const everything = await new Notebook(root).everything();
    expect([...everything.keys()].sort()).toEqual(['/projects/shop', '/projects/site']);
    expect(everything.get('/projects/shop')).toHaveLength(1);
  });

  it('loses one unreadable note rather than the whole board', async () => {
    const root = await newFolder();
    const book = new Notebook(root);
    await book.note(note({ id: 'work-1' }));
    await writeFile(join(book.pageFor('/projects/site'), 'work-2.json'), '{ half a fi', 'utf8');

    const page = await book.page('/projects/site');
    expect(page.map((one) => one.id)).toEqual(['work-1']);
  });

  it('forgets one project’s notes without touching anybody else’s', async () => {
    const root = await newFolder();
    const book = new Notebook(root);
    await book.note(note({ id: 'work-1', project: '/projects/site' }));
    await book.note(note({ id: 'work-1', project: '/projects/shop' }));

    await book.forget('/projects/site', 'work-1');
    expect(await book.page('/projects/site')).toEqual([]);
    expect(await book.page('/projects/shop')).toHaveLength(1);
  });
});

/* ========================================================================== */
/* Two runs never tread on each other                                          */
/* ========================================================================== */

describe('keeping runs apart on the disk', () => {
  it('gives every piece of work its own note', async () => {
    const root = await newFolder();
    const book = new Notebook(root);

    await Promise.all([
      book.note(note({ id: 'work-1', doing: 'One thing', at: 1 })),
      book.note(note({ id: 'work-2', doing: 'Another thing', at: 2 })),
      book.note(note({ id: 'work-3', doing: 'A third thing', at: 3 })),
    ]);

    const page = await book.page('/projects/site');
    expect(page.map((one) => one.doing)).toEqual(['One thing', 'Another thing', 'A third thing']);
    expect(await readdir(book.pageFor('/projects/site'))).toHaveLength(3);
  });

  it('keeps two projects apart even when the work is called the same thing', async () => {
    const root = await newFolder();
    const book = new Notebook(root);
    await book.note(note({ id: 'work-1', project: '/projects/site', doing: 'The site one' }));
    await book.note(note({ id: 'work-1', project: '/projects/shop', doing: 'The shop one' }));

    expect((await book.page('/projects/site'))[0]?.doing).toBe('The site one');
    expect((await book.page('/projects/shop'))[0]?.doing).toBe('The shop one');
  });

  it('gives two projects with the same name two pages', () => {
    expect(keyFor('/one/deep/site')).not.toBe(keyFor('/another/site'));
    expect(keyFor('/one/deep/site')).toBe(keyFor('/one/deep/site'));
  });

  it('leaves nothing half-written behind', async () => {
    const root = await newFolder();
    const book = new Notebook(root);
    await book.note(note({ id: 'work-1' }));
    const there = await readdir(book.pageFor('/projects/site'));
    expect(there.every((name) => name.endsWith('.json'))).toBe(true);
  });
});

/* ========================================================================== */
/* Helpers left behind by an app that went away                                */
/* ========================================================================== */

const HELPER = '/Applications/Graphe.app/Contents/dist-electron/subagent-runner.mjs';

function running(over: Partial<Alive> = {}): Alive {
  return { pid: 700, ppid: 400, command: `/usr/bin/electron ${HELPER}`, ...over };
}

describe('helpers whose app is not there any more', () => {
  it('ends one whose parent has gone', () => {
    const table = [running({ pid: 700, ppid: 400 })];
    expect(whichAreStray(table, (pid) => pid !== 400)).toEqual([700]);
  });

  it('ends one that has been handed to the machine itself', () => {
    const table = [running({ pid: 700, ppid: 1 })];
    expect(whichAreStray(table, () => true)).toEqual([700]);
  });

  it('never ends one of our own', () => {
    const table = [running({ pid: 700, ppid: process.pid })];
    expect(whichAreStray(table, (pid) => pid === process.pid)).toEqual([]);
  });

  it('leaves alone everything that is not a helper', () => {
    const table = [
      running({ pid: 700, ppid: 1, command: '/usr/bin/node server.js' }),
      running({ pid: 701, ppid: 1, command: 'npm run dev' }),
    ];
    expect(whichAreStray(table, () => false)).toEqual([]);
  });

  /* The window and the graphics are the app's own processes, and when the one
     that owns them goes abruptly they are not always taken with it. One was
     found alone having spent eleven hours at two cores, drawing a window for an
     app that no longer existed. */
  it('ends the app\u2019s own processes when the app itself has gone', () => {
    const helper =
      '/Volumes/Graphe 0.3.0-arm64/Graphe.app/Contents/Frameworks/Graphe Helper (Renderer).app/Contents/MacOS/Graphe Helper (Renderer)';
    expect(whichAreStray([running({ pid: 8784, ppid: 1, command: helper })], () => true)).toEqual([
      8784,
    ]);
  });

  it('leaves a working copy\u2019s own processes alone', () => {
    // A live app's helpers have a live parent, which is the whole test.
    const helper = '/Applications/Graphe.app/Contents/Frameworks/Graphe Helper (GPU).app/x';
    const table = [running({ pid: 8784, ppid: 8279, command: helper })];
    expect(whichAreStray(table, (pid) => pid === 8279)).toEqual([]);
  });

  it('leaves every other app\u2019s helpers alone, orphaned or not', () => {
    const table = [
      running({ pid: 900, ppid: 1, command: '/Applications/Visual Studio Code.app/…/Code Helper' }),
      running({ pid: 901, ppid: 1, command: '/Applications/Slack.app/…/Slack Helper (Renderer)' }),
      running({ pid: 902, ppid: 1, command: '/Applications/Notion.app/…/Notion Helper' }),
    ];
    expect(whichAreStray(table, () => false)).toEqual([]);
  });

  it('reads what the machine says it is running', () => {
    const table = readRunning(
      [
        '  400     1 /Applications/Graphe.app/Contents/MacOS/Graphe',
        '  700   400 /usr/bin/electron /a/dist-electron/subagent-runner.mjs',
        'not a row at all',
        '',
      ].join('\n'),
    );
    expect(table).toEqual([
      { pid: 400, ppid: 1, command: '/Applications/Graphe.app/Contents/MacOS/Graphe' },
      { pid: 700, ppid: 400, command: '/usr/bin/electron /a/dist-electron/subagent-runner.mjs' },
    ]);
  });

  it('ends the ones it found, and only those', async () => {
    const ended: number[] = [];
    const table = [
      running({ pid: 700, ppid: 1 }),
      running({ pid: 701, ppid: process.pid }),
      running({ pid: 702, ppid: 1, command: '/usr/bin/node something-else.js' }),
    ];
    const how = await endStrays(
      () => Promise.resolve(table),
      (pid) => ended.push(pid),
    );
    expect(how).toBe(1);
    expect(ended).toEqual([700]);
  });

  it('ends nothing when the machine will not say what it is running', async () => {
    const ended: number[] = [];
    const how = await endStrays(
      () => Promise.resolve([]),
      (pid) => ended.push(pid),
    );
    expect(how).toBe(0);
    expect(ended).toEqual([]);
  });
});

/* ========================================================================== */
/* Reading a note back                                                         */
/* ========================================================================== */

describe('reading a note back', () => {
  it('turns down anything that is not one', () => {
    for (const odd of [null, undefined, 42, 'work-1', {}, { id: 'work-1' }]) {
      expect(readWritten(odd)).toBeNull();
    }
  });

  it('turns down one nobody was looking after', () => {
    expect(readWritten({ id: 'work-1', project: '/p', doing: 'A thing' })).toBeNull();
  });

  it('treats a state it has never seen as one that did not work', () => {
    const back = readWritten({
      id: 'work-1',
      project: '/p',
      doing: 'A thing',
      state: 'halfway',
      owner: { pid: 3, since: 4 },
    });
    expect(back?.state).toBe('failed');
  });

  it('adds up what one run cost, and never across two currencies', () => {
    expect(addSpend(null, { minor: 10, currency: 'USD' })).toEqual({ minor: 10, currency: 'USD' });
    expect(addSpend({ minor: 10, currency: 'USD' }, { minor: 5, currency: 'USD' })).toEqual({
      minor: 15,
      currency: 'USD',
    });
    expect(addSpend({ minor: 10, currency: 'USD' }, { minor: 5, currency: 'EUR' })).toEqual({
      minor: 10,
      currency: 'USD',
    });
  });
});

/* ========================================================================== */
/* The words                                                                   */
/* ========================================================================== */

describe('what it says about work it came back to', () => {
  const everything = Object.values(writtenWords);

  it('speaks no jargon', () => {
    const jargon = /\b(git|commit|session|token|API|daemon|process|pid|crash|orphan|worktree)\b/i;
    for (const sentence of everything) expect(sentence).not.toMatch(jargon);
  });

  it('never blames the person', () => {
    for (const sentence of everything) {
      expect(sentence).not.toMatch(/\byou (?:cannot|can't|must|should|need to|failed)\b/i);
      expect(sentence).not.toMatch(/\b(sorry|oops)\b/i);
    }
  });
});

/* ========================================================================== */
/* Goes at the same thing, after a restart                                     */
/* ========================================================================== */

describe('several goes at one thing, written down', () => {
  /**
   * Without this they come back as unrelated pieces: no "Way 2 of 3" on the
   * cards, and keeping one carries it in and leaves the other two sitting
   * there — which is the one thing the feature exists to prevent.
   */
  it('carries the name they share across a restart', () => {
    const note = noteOf(piece({ id: 'work-1', ways: 'ways-call-7' }), {
      project: '/work/site',
      name: 'site',
      owner: OURS,
    });
    expect(note.ways).toBe('ways-call-7');
    expect(asPiece(note).ways).toBe('ways-call-7');
  });

  it('says nothing about ordinary work, which is almost all of it', () => {
    const note = noteOf(piece(), { project: '/work/site', name: 'site', owner: OURS });
    expect(note.ways).toBeUndefined();
    expect(asPiece(note).ways).toBeUndefined();
    // A note written before any of this existed still reads.
    const older = { ...note };
    delete (older as { ways?: unknown }).ways;
    expect(asPiece(older).ways).toBeUndefined();
  });
});
