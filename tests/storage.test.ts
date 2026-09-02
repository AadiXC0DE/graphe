/** Clearing what is finished with, and never anything else.
 *
 * The whole value of a sweep is the promise underneath it: nothing that still
 * holds a change goes, at any age. That is the first test here and the reason
 * the rest can be about sizes and sentences.
 */

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  KEEP_DAYS,
  measureFolders,
  npmOnPath,
  saysBytes,
  saysStorage,
  storageWords,
  sweep,
  whatToSweep,
  type Sweepable,
} from '../src/work/storage';

const NOW = Date.UTC(2026, 8, 1);
const DAY = 24 * 60 * 60 * 1000;

function old(kind: Sweepable['kind'], days: number, holdsWork = false): Sweepable {
  return { path: `/tmp/graphe-test/${kind}-${String(days)}`, kind, at: NOW - days * DAY, holdsWork };
}

const scratch: string[] = [];

afterEach(async () => {
  for (const folder of scratch.splice(0)) await rm(folder, { recursive: true, force: true });
});

async function folderWith(files: readonly { path: string; bytes: number }[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'graphe-storage-'));
  scratch.push(root);
  for (const file of files) {
    await mkdir(join(root, file.path, '..'), { recursive: true });
    await writeFile(join(root, file.path), 'x'.repeat(file.bytes));
  }
  return root;
}

/* ========================================================================== */
/* What goes                                                                   */
/* ========================================================================== */

describe('deciding what is finished with', () => {
  it('never sweeps something still holding work, however old', () => {
    const ancient = old('checkout', 900, true);
    const { sweep: going, kept } = whatToSweep([ancient], NOW);
    expect(going).toHaveLength(0);
    expect(kept).toContain(ancient);
  });

  it('keeps each kind for its own length of time', () => {
    const all = [
      old('checkout', KEEP_DAYS.checkout + 1),
      old('checkout', KEEP_DAYS.checkout - 1),
      old('copy', KEEP_DAYS.copy + 1),
      old('copy', KEEP_DAYS.copy - 1),
      old('kept-aside', KEEP_DAYS.keptAside + 1),
      old('kept-aside', KEEP_DAYS.keptAside - 1),
      old('transcript', KEEP_DAYS.transcript + 1),
      old('transcript', KEEP_DAYS.transcript - 1),
    ];
    const { sweep: going } = whatToSweep(all, NOW);
    expect(going.map((one) => one.kind).sort()).toEqual(['checkout', 'copy', 'kept-aside', 'transcript']);
  });

  it('treats a build as output rather than as anybody’s work', () => {
    const { sweep: going } = whatToSweep([old('build', KEEP_DAYS.copy + 1)], NOW);
    expect(going).toHaveLength(1);
  });

  it('says what is going and what is staying, and why', () => {
    const { because } = whatToSweep([old('copy', 30), old('checkout', 1), old('checkout', 400, true)], NOW);
    expect(because).toContain('1 folder');
    expect(because).toContain('still holding work');
    expect(because).toContain('too recent');
  });

  it('says so plainly when there is nothing to clear', () => {
    expect(whatToSweep([], NOW).because).toContain('Nothing to clear');
    expect(whatToSweep([old('checkout', 900, true)], NOW).because).toContain('still holding work');
  });
});

/* ========================================================================== */
/* The words                                                                   */
/* ========================================================================== */

describe('what Settings reads', () => {
  it('names the press and says exactly what it removes', () => {
    expect(storageWords.clear).toBe('Clear finished work');
    for (const said of ['fortnight', 'week', 'month', 'three months']) {
      expect(storageWords.what).toContain(said);
    }
    // The promise, in the copy, not only in the code.
    expect(storageWords.what).toContain('stays');
    expect(storageWords.where).toContain('Application Support/Graphe');
  });

  it('reads a folder list as a size and a breakdown', () => {
    const said = saysStorage([
      { name: 'Checkouts', bytes: 1_700_000_000, files: 40_000 },
      { name: 'Board copies', bytes: 1_500_000_000, files: 30_000 },
      { name: 'Logs', bytes: 0, files: 0 },
    ]);
    expect(said).toContain('3.2 GB');
    expect(said.indexOf('Checkouts')).toBeLessThan(said.indexOf('Board copies'));
    expect(said).not.toContain('Logs');
  });

  it('says nothing rather than zero when the folder is empty', () => {
    expect(saysStorage([{ name: 'Checkouts', bytes: 0, files: 0 }])).toContain('Nothing kept');
  });

  it('writes sizes the way a person reads them', () => {
    expect(saysBytes(512)).toBe('512 B');
    expect(saysBytes(2_400)).toBe('2 KB');
    expect(saysBytes(3_400_000)).toBe('3.4 MB');
    expect(saysBytes(112_000_000)).toBe('112 MB');
    expect(saysBytes(3_400_000_000)).toBe('3.4 GB');
  });
});

/* ========================================================================== */
/* The disk                                                                    */
/* ========================================================================== */

describe('measuring and clearing', () => {
  it('measures each folder it keeps, and reports a missing one as empty', async () => {
    const root = await folderWith([
      { path: 'worktrees/one/a.txt', bytes: 100 },
      { path: 'worktrees/one/deep/b.txt', bytes: 50 },
      { path: 'sessions/x.jsonl', bytes: 20 },
    ]);
    const folders = await measureFolders(root);
    const named = new Map(folders.map((one) => [one.name, one]));
    expect(named.get('Checkouts')).toEqual({ name: 'Checkouts', bytes: 150, files: 2 });
    expect(named.get('Conversations')?.bytes).toBe(20);
    expect(named.get('Builds')).toEqual({ name: 'Builds', bytes: 0, files: 0 });
  });

  it('removes what it was given and reports what came back', async () => {
    const root = await folderWith([{ path: 'copies/piece/big.bin', bytes: 4_096 }]);
    const going: Sweepable = { path: join(root, 'copies', 'piece'), kind: 'copy', at: 0, holdsWork: false };
    const { removed, freed } = await sweep([going]);
    expect(removed).toBe(1);
    expect(freed).toBe(4_096);
    expect((await measureFolders(root)).find((one) => one.name === 'Board copies')?.bytes).toBe(0);
  });

  it('refuses anything holding work even when it is handed one', async () => {
    const root = await folderWith([{ path: 'copies/piece/big.bin', bytes: 10 }]);
    const held: Sweepable = { path: join(root, 'copies', 'piece'), kind: 'copy', at: 0, holdsWork: true };
    expect(await sweep([held])).toEqual({ removed: 0, freed: 0 });
    expect((await measureFolders(root)).find((one) => one.name === 'Board copies')?.files).toBe(1);
  });
});

describe('whether add-ons can be installed at all', () => {
  it('answers without running anything, and says no when PATH is empty', async () => {
    const was = process.env['PATH'];
    process.env['PATH'] = '';
    try {
      expect(await npmOnPath()).toBe(false);
    } finally {
      if (was === undefined) delete process.env['PATH'];
      else process.env['PATH'] = was;
    }
  });
});
