/** Several separate pieces of work at once, against real storage.
 *
 * The claim is the same one the two-way comparison makes, under more load:
 * **nothing any of them does can reach the files on screen**, whoever finishes
 * first and whoever is thrown away. Plus the two things only a board needs —
 * more go at once than anyone would run by hand, and the ones past the bound
 * wait their turn instead of being refused.
 */

import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

import { ProjectHistory } from '../src/history/repo';
import { Workbench, folderForWork } from '../src/history/attempts';
import { AT_A_TIME, saysBoard } from '../src/work/board';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const made: string[] = [];

afterAll(async () => {
  await Promise.all(made.map((folder) => rm(folder, { recursive: true, force: true })));
});

async function newFolder(): Promise<string> {
  const folder = await realpath(await mkdtemp(path.join(tmpdir(), 'graphe-board-')));
  made.push(folder);
  return folder;
}

async function put(root: string, file: string, contents: string): Promise<void> {
  const target = path.join(root, file);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, contents, 'utf8');
}

async function get(root: string, file: string): Promise<string> {
  return readFile(path.join(root, file), 'utf8');
}

async function there(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

/** A project with one saved version in it, and somewhere to keep the copies. */
async function aProject(): Promise<{ history: ProjectHistory; root: string; under: string }> {
  const root = await newFolder();
  const under = await newFolder();
  const history = new ProjectHistory(root);
  await history.prepare();
  await put(root, 'hero.css', '.hero { padding: 16px; }\n');
  await history.snapshot('First pass at the landing page');
  return { history, root, under };
}

const states = (bench: Workbench) => bench.pieces.map((one) => one.state);

/* ========================================================================== */
/* M-01 more than two                                                          */
/* ========================================================================== */

describe('M-01 several at once', () => {
  it('gives every piece of work its own copy of the project', async () => {
    const { history, under } = await aProject();
    const bench = new Workbench({ history, under });
    for (const doing of ['Calm the hero', 'Tighten the nav', 'Warm the palette']) bench.ask(doing);

    const began = await bench.begin();
    expect(began).toHaveLength(3);
    expect(states(bench)).toEqual(['running', 'running', 'running']);

    const folders = new Set<string>();
    for (const piece of bench.pieces) {
      expect(piece.folder).not.toBeNull();
      folders.add(piece.folder ?? '');
      expect(await get(piece.folder ?? '', 'hero.css')).toBe('.hero { padding: 16px; }\n');
    }
    expect(folders.size).toBe(3);

    await bench.clear();
  });

  it('keeps what each one is doing, in its own words', async () => {
    const { history, under } = await aProject();
    const bench = new Workbench({ history, under });
    const piece = bench.ask('Make the hero calmer', { at: 1000 });

    expect(piece.doing).toBe('Make the hero calmer');
    expect(piece.state).toBe('waiting');
    expect(piece.picture).toBeNull();
    expect(piece.at).toBe(1000);

    bench.showPicture(piece.id, 'data:image/png;base64,AAAA');
    expect(bench.pieces[0]?.picture).toBe('data:image/png;base64,AAAA');
  });

  it('refuses to start over unfinished work rather than risk losing it', async () => {
    const { history, root, under } = await aProject();
    const bench = new Workbench({ history, under });
    bench.ask('Something');
    await put(root, 'hero.css', '.hero { padding: 999px; }\n');

    await expect(bench.begin()).rejects.toThrow();
    expect(states(bench)).toEqual(['waiting']);
  });
});

/* ========================================================================== */
/* M-02 the bound, and the queue behind it                                     */
/* ========================================================================== */

describe('M-02 as many as it can do properly', () => {
  it('never runs more copies at once than the bound allows', async () => {
    const { history, under } = await aProject();
    const bench = new Workbench({ history, under, atOnce: 99 });
    expect(bench.atOnce).toBe(AT_A_TIME);

    for (let n = 0; n < AT_A_TIME + 2; n += 1) bench.ask(`Piece ${String(n + 1)}`, { at: n });
    await bench.begin();

    expect(bench.pieces.filter((one) => one.state === 'running')).toHaveLength(AT_A_TIME);
    expect(bench.pieces.filter((one) => one.state === 'waiting')).toHaveLength(2);
    expect(bench.roomLeft).toBe(0);

    await bench.clear();
  });

  it('makes the ones past the bound wait rather than turning them away', async () => {
    const { history, under } = await aProject();
    const bench = new Workbench({ history, under, atOnce: 2 });
    bench.ask('First', { at: 1 });
    bench.ask('Second', { at: 2 });
    const third = bench.ask('Third', { at: 3 });

    await bench.begin();
    expect(third.state).toBe('waiting');
    expect(saysBoard(bench.pieces)).toBe('Two going, one waiting.');
    expect(await there(folderForWork(under, third.id))).toBe(false);

    // A slot frees up, and the one that has waited longest gets it.
    await bench.settle(bench.pieces[0]?.id ?? '', 'Nothing much');
    await bench.drop(bench.pieces[0]?.id ?? '');
    const began = await bench.begin();

    expect(began).toHaveLength(1);
    expect(began[0]?.doing).toBe('Third');
    expect(third.state).toBe('running');

    await bench.clear();
  });

  it('starts nobody, and touches nothing, when there is no room', async () => {
    const { history, under } = await aProject();
    const bench = new Workbench({ history, under, atOnce: 1 });
    bench.ask('First', { at: 1 });
    await bench.begin();

    const waiting = bench.ask('Second', { at: 2 });
    expect(await bench.begin()).toEqual([]);
    expect(waiting.state).toBe('waiting');

    await bench.clear();
  });
});

/* ========================================================================== */
/* M-03 while they are going                                                   */
/* ========================================================================== */

describe('M-03 out of reach of the files on screen', () => {
  it('keeps everything every piece of work does out of the project entirely', async () => {
    const { history, root, under } = await aProject();
    const bench = new Workbench({ history, under, atOnce: 3 });
    bench.ask('Roomier', { at: 1 });
    bench.ask('Tighter', { at: 2 });
    bench.ask('Warmer', { at: 3 });
    await bench.begin();

    const versionsBefore = await history.versions();
    for (const [index, piece] of bench.pieces.entries()) {
      await put(piece.folder ?? '', 'hero.css', `.hero { padding: ${String(index)}px; }\n`);
      await put(piece.folder ?? '', 'stray.txt', 'only in here');
      await bench.settle(piece.id, `Try ${String(index)}`);
    }

    expect(await get(root, 'hero.css')).toBe('.hero { padding: 16px; }\n');
    expect(await there(path.join(root, 'stray.txt'))).toBe(false);
    expect(await history.hasUnsavedChanges()).toBe(false);
    expect((await history.versions())[0]?.id).toBe(versionsBefore[0]?.id);

    await bench.clear();
  });

  it('says nothing changed when a piece of work changed nothing', async () => {
    const { history, under } = await aProject();
    const bench = new Workbench({ history, under });
    const piece = bench.ask('Did nothing');
    await bench.begin();

    expect(await bench.settle(piece.id, 'Did nothing')).toBeNull();
    expect(piece.state).toBe('done');

    await bench.clear();
  });

  it('lets one fail without taking the others down with it', async () => {
    const { history, under } = await aProject();
    const bench = new Workbench({ history, under, atOnce: 2 });
    const one = bench.ask('This one breaks', { at: 1 });
    const other = bench.ask('This one is fine', { at: 2 });
    await bench.begin();

    bench.stopped(one.id, 'I couldn’t find the file that page is built from.');
    expect(one.state).toBe('failed');
    expect(one.trouble).toContain('couldn’t find');
    expect(other.state).toBe('running');
    // Its copy is still there to look at until somebody throws it away.
    expect(await there(one.folder ?? '')).toBe(true);

    await bench.clear();
  });
});

/* ========================================================================== */
/* M-04 keeping one                                                            */
/* ========================================================================== */

describe('M-04 keeping one of several', () => {
  it('puts that one’s files into the project and leaves the rest going', async () => {
    const { history, root, under } = await aProject();
    const bench = new Workbench({ history, under, atOnce: 3 });
    const one = bench.ask('Roomier', { at: 1 });
    const other = bench.ask('Tighter', { at: 2 });
    await bench.begin();

    await put(one.folder ?? '', 'hero.css', '.hero { padding: 48px; }\n');
    await bench.settle(one.id, 'Roomier hero');
    const otherFolder = other.folder ?? '';

    const kept = await bench.keep(one.id, 'Kept the roomier hero');
    expect(kept).not.toBeNull();
    expect(await get(root, 'hero.css')).toBe('.hero { padding: 48px; }\n');

    // The other was never an alternative to it — it carries on, copy and all.
    expect(bench.pieces.map((piece) => piece.id)).toEqual([other.id]);
    expect(other.state).toBe('running');
    expect(await there(otherFolder)).toBe(true);

    await bench.clear();
  });

  it('records keeping one as a version of its own, so it can be undone', async () => {
    const { history, root, under } = await aProject();
    const before = await history.versions();
    const bench = new Workbench({ history, under });
    const one = bench.ask('Roomier');
    await bench.begin();

    await put(one.folder ?? '', 'hero.css', '.hero { padding: 48px; }\n');
    await bench.settle(one.id, 'Roomier hero');
    await bench.keep(one.id, 'Kept the roomier hero');

    const after = await history.versions();
    expect(after.length).toBeGreaterThan(before.length);
    expect(after[0]?.title).toBe('Kept the roomier hero');

    await history.restoreTo(before[0]?.id ?? '', 'Back to where it was');
    expect(await get(root, 'hero.css')).toBe('.hero { padding: 16px; }\n');
  });

  it('has nothing to keep from one that never finished', async () => {
    const { history, root, under } = await aProject();
    const bench = new Workbench({ history, under });
    const one = bench.ask('Still going');
    await bench.begin();
    await put(one.folder ?? '', 'hero.css', '.hero { padding: 48px; }\n');

    expect(await bench.keep(one.id, 'Kept it')).toBeNull();
    expect(await get(root, 'hero.css')).toBe('.hero { padding: 16px; }\n');

    await bench.clear();
  });
});

/* ========================================================================== */
/* M-05 letting them go                                                        */
/* ========================================================================== */

describe('M-05 throwing one away', () => {
  it('takes away that one’s copy and nobody else’s', async () => {
    const { history, under } = await aProject();
    const bench = new Workbench({ history, under, atOnce: 3 });
    const one = bench.ask('Roomier', { at: 1 });
    const other = bench.ask('Tighter', { at: 2 });
    await bench.begin();

    const gone = one.folder ?? '';
    const stays = other.folder ?? '';
    await bench.drop(one.id);

    expect(await there(gone)).toBe(false);
    expect(await there(stays)).toBe(true);
    expect(await get(stays, 'hero.css')).toBe('.hero { padding: 16px; }\n');
    expect(bench.pieces.map((piece) => piece.id)).toEqual([other.id]);
    expect(await history.workspaces()).toEqual([stays]);

    await bench.clear();
  });

  it('can be thrown away twice, and thrown away before it ever started', async () => {
    const { history, under } = await aProject();
    const bench = new Workbench({ history, under, atOnce: 1 });
    bench.ask('First', { at: 1 });
    const waiting = bench.ask('Never started', { at: 2 });
    await bench.begin();

    await expect(bench.drop(waiting.id)).resolves.toBeUndefined();
    await expect(bench.drop(waiting.id)).resolves.toBeUndefined();
    await expect(bench.drop('nothing-by-that-name')).resolves.toBeUndefined();
    expect(bench.pieces).toHaveLength(1);

    await bench.clear();
  });

  it('leaves the project exactly as it was when the whole board goes', async () => {
    const { history, root, under } = await aProject();
    const versionsBefore = await history.versions();
    const bench = new Workbench({ history, under, atOnce: 3 });
    for (const doing of ['One', 'Two', 'Three']) bench.ask(doing);
    await bench.begin();

    for (const piece of bench.pieces) {
      await put(piece.folder ?? '', 'hero.css', '.hero { padding: 99px; }\n');
      await bench.settle(piece.id, 'Something');
    }
    await bench.clear();

    expect(await get(root, 'hero.css')).toBe('.hero { padding: 16px; }\n');
    expect(await history.hasUnsavedChanges()).toBe(false);
    expect((await history.versions())[0]?.id).toBe(versionsBefore[0]?.id);
    expect(await history.workspaces()).toEqual([]);
    expect(bench.pieces).toEqual([]);
    await expect(bench.clear()).resolves.toBeUndefined();
  });

  it('keeps the copies out of the project folder, under names nobody can steer', async () => {
    const { history, root, under } = await aProject();
    const bench = new Workbench({ history, under });
    const nasty = bench.ask('Sideways', { id: '../../escape' });
    await bench.begin();

    const folder = nasty.folder ?? '';
    expect(folder.startsWith(under)).toBe(true);
    expect(path.relative(under, folder).includes('..')).toBe(false);
    expect(path.relative(root, folder).startsWith('..')).toBe(true);

    await bench.clear();
    expect(await there(folder)).toBe(false);
    expect(await get(root, 'hero.css')).toBe('.hero { padding: 16px; }\n');
  });
});
