/** Trying a change two ways, against real storage.
 *
 * The claim under test is the one that matters: **nothing an attempt does can
 * reach the files on screen until somebody keeps it**, and keeping one is
 * undoable like every other version. Real folders, real history, no model.
 */

import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

import { ProjectHistory } from '../src/history/repo';
import { Tries, folderForTry, nameOfTry, saysKept, saysTries } from '../src/history/attempts';

vi.setConfig({ testTimeout: 40_000, hookTimeout: 40_000 });

const made: string[] = [];

afterAll(async () => {
  await Promise.all(made.map((folder) => rm(folder, { recursive: true, force: true })));
});

async function newFolder(): Promise<string> {
  const folder = await realpath(await mkdtemp(path.join(tmpdir(), 'graphe-tries-')));
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

describe('T-01 the words', () => {
  it('calls the tries what a designer would call them', () => {
    expect(nameOfTry(0)).toBe('First try');
    expect(nameOfTry(1)).toBe('Second try');
    expect(nameOfTry(2)).toBe('Third try');
  });

  it('keeps the copies out of the project folder', () => {
    expect(folderForTry('/somewhere/else', 'abc', 0)).toBe(path.join('/somewhere/else', 'abc', '1'));
  });

  it('says how many ways it went', () => {
    expect(saysTries(2)).toContain('Two ways');
    expect(saysTries(3)).toContain('3 ways');
  });

  it('titles the kept version with what was asked for', () => {
    expect(saysKept('Second try', 'Make the hero calmer')).toBe(
      'Make the hero calmer: kept the second try',
    );
    expect(saysKept('First try', null)).toBe('Kept the first try');
  });

  it('never says where any of it really lives', () => {
    const everything = [saysTries(2), saysTries(3), saysKept('First try', 'x'), nameOfTry(0)].join(
      ' ',
    );
    for (const banned of ['git', 'worktree', 'branch', 'commit', 'merge', 'checkout']) {
      expect(everything.toLowerCase()).not.toContain(banned);
    }
  });
});

describe('T-02 making the copies', () => {
  it('gives each try its own copy of the project, with the same files in it', async () => {
    const { history, under } = await aProject();
    const tries = await Tries.start({ history, under, id: 'run1', count: 2 });

    expect(tries.attempts).toHaveLength(2);
    for (const attempt of tries.attempts) {
      expect(await get(attempt.folder, 'hero.css')).toBe('.hero { padding: 16px; }\n');
    }
    await tries.discard();
  });

  it('refuses to start over unfinished work rather than risk losing it', async () => {
    const { history, root, under } = await aProject();
    await put(root, 'hero.css', '.hero { padding: 999px; }\n');
    await expect(Tries.start({ history, under, id: 'run2', count: 2 })).rejects.toThrow();
  });

  it('asks for two even when asked for one, and never more than three', async () => {
    const { history, under } = await aProject();
    const one = await Tries.start({ history, under, id: 'run3', count: 1 });
    expect(one.attempts).toHaveLength(2);
    await one.discard();

    const many = await Tries.start({ history, under, id: 'run4', count: 9 });
    expect(many.attempts).toHaveLength(3);
    await many.discard();
  });
});

describe('T-03 while they are being tried', () => {
  it('keeps what one try does out of the project entirely', async () => {
    const { history, root, under } = await aProject();
    const tries = await Tries.start({ history, under, id: 'run5', count: 2 });
    const first = tries.attempts[0]!;

    await put(first.folder, 'hero.css', '.hero { padding: 48px; }\n');
    await tries.settle(first.id, 'Roomier hero');

    expect(await get(root, 'hero.css')).toBe('.hero { padding: 16px; }\n');
    await tries.discard();
  });

  it('says nothing changed when a try changed nothing', async () => {
    const { history, under } = await aProject();
    const tries = await Tries.start({ history, under, id: 'run6', count: 2 });
    expect(await tries.settle(tries.attempts[0]!.id, 'Did nothing')).toBeNull();
    await tries.discard();
  });
});

describe('T-04 keeping one', () => {
  it('puts the kept try’s files into the project, and leaves the other behind', async () => {
    const { history, root, under } = await aProject();
    const tries = await Tries.start({ history, under, id: 'run7', count: 2 });
    const [first, second] = tries.attempts;

    await put(first!.folder, 'hero.css', '.hero { padding: 48px; }\n');
    await tries.settle(first!.id, 'Roomier hero');
    await put(second!.folder, 'hero.css', '.hero { padding: 4px; }\n');
    await tries.settle(second!.id, 'Tighter hero');

    const kept = await tries.keep(second!.id, saysKept(second!.name, 'Change the hero spacing'));
    expect(kept).not.toBeNull();
    expect(await get(root, 'hero.css')).toBe('.hero { padding: 4px; }\n');
  });

  it('records keeping one as a version of its own, so it can be undone', async () => {
    const { history, root, under } = await aProject();
    const before = await history.versions();
    const tries = await Tries.start({ history, under, id: 'run8', count: 2 });
    const first = tries.attempts[0]!;

    await put(first.folder, 'hero.css', '.hero { padding: 48px; }\n');
    await tries.settle(first.id, 'Roomier hero');
    await tries.keep(first.id, saysKept(first.name, null));

    const after = await history.versions();
    expect(after.length).toBeGreaterThan(before.length);
    expect(after[0]?.title).toBe('Kept the first try');

    // And going back past it puts the project exactly where it started.
    const start = before[0]!;
    await history.restoreTo(start.id, 'Back to where it was');
    expect(await get(root, 'hero.css')).toBe('.hero { padding: 16px; }\n');
  });

  it('tidies every copy away once one is kept', async () => {
    const { history, under } = await aProject();
    const tries = await Tries.start({ history, under, id: 'run9', count: 2 });
    const first = tries.attempts[0]!;
    await put(first.folder, 'hero.css', '.hero { padding: 48px; }\n');
    await tries.settle(first.id, 'Roomier hero');
    await tries.keep(first.id, 'Kept the first try');

    for (const attempt of tries.attempts) expect(await there(attempt.folder)).toBe(false);
    expect(await history.workspaces()).toEqual([]);
  });
});

describe('T-05 throwing them away', () => {
  it('leaves the project exactly as it was', async () => {
    const { history, root, under } = await aProject();
    const versionsBefore = await history.versions();
    const tries = await Tries.start({ history, under, id: 'run10', count: 2 });

    for (const attempt of tries.attempts) {
      await put(attempt.folder, 'hero.css', '.hero { padding: 99px; }\n');
      await tries.settle(attempt.id, 'Something');
    }
    await tries.discard();

    expect(await get(root, 'hero.css')).toBe('.hero { padding: 16px; }\n');
    expect(await history.hasUnsavedChanges()).toBe(false);
    const versionsAfter = await history.versions();
    expect(versionsAfter[0]?.id).toBe(versionsBefore[0]?.id);
    expect(await history.workspaces()).toEqual([]);
  });

  it('can be thrown away twice without complaining', async () => {
    const { history, under } = await aProject();
    const tries = await Tries.start({ history, under, id: 'run11', count: 2 });
    await tries.discard();
    await expect(tries.discard()).resolves.toBeUndefined();
  });
});
