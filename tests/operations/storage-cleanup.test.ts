/** What the app is willing to clear, and the one line it will not cross.
 *
 * 9.5 asks that storage cleanup lists exact managed resources, never infers
 * unused from age alone, and excludes dirty or recovery data by default. Most
 * of that is already proven — `tests/storage.test.ts` (the hold-work-first rule
 * at 900 days, each kind's own window, the because-sentence, the sweep round
 * trip) and `tests/disk.test.ts` (the row names, the canClear table, the two
 * shell handlers). What is here is the two ends of that contract the existing
 * suites do not name: the exact day a resource becomes eligible, and what a name
 * the app does not manage does.
 *
 * The list itself — `whatIsLyingAround` (electron/main.ts:6210), which walks the
 * app's data folder and asks git whether a checkout is dirty — is main-process
 * code with an Electron import, so it is not reachable here.
 */

import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import {
  canClear,
  folderNamed,
  KEEP_DAYS,
  measureFolders,
  sweep,
  whatToSweep,
  type Sweepable,
} from '../../src/work/storage';

const made: string[] = [];

afterAll(async () => {
  await Promise.all(made.map((folder) => rm(folder, { recursive: true, force: true })));
});

async function scratch(): Promise<string> {
  const folder = await realpath(await mkdtemp(join(tmpdir(), 'graphe-ops-storage-')));
  made.push(folder);
  return folder;
}

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

function aged(kind: Sweepable['kind'], days: number, holdsWork = false): Sweepable {
  return { path: `/data/${kind}`, kind, at: NOW - days * DAY, holdsWork };
}

/* ========================================================================== */

describe('the day a thing becomes eligible', () => {
  it('is exactly the kind’s own window, not a day either side of it', () => {
    for (const kind of ['checkout', 'copy', 'kept-aside', 'transcript'] as const) {
      const days = kind === 'kept-aside' ? KEEP_DAYS.keptAside : KEEP_DAYS[kind];
      expect(whatToSweep([aged(kind, days)], NOW).sweep, `${kind} at ${String(days)} days`).toHaveLength(1);
      const short = { ...aged(kind, days), at: NOW - days * DAY + 1 };
      expect(whatToSweep([short], NOW).sweep, `${kind} a millisecond short`).toHaveLength(0);
    }
  });

  it('is never reached by something holding work', () => {
    for (const kind of ['checkout', 'copy', 'kept-aside', 'transcript'] as const) {
      const held = aged(kind, 3_000, true);
      const decided = whatToSweep([held], NOW);
      expect(decided.sweep, kind).toHaveLength(0);
      expect(decided.kept, kind).toContain(held);
    }
  });
});

describe('the names the app manages', () => {
  it('is a fixed list, so a name nobody manages cannot be cleared by asking', async () => {
    const userData = await scratch();
    // A name off the wire — anything at all, including one built to climb out.
    for (const name of ['../../..', '/etc', 'worktrees', 'Everything', '', 'Scratch/', 'scratch ']) {
      expect(folderNamed(userData, name), JSON.stringify(name)).toBeNull();
      expect(canClear(name), JSON.stringify(name)).toBe(false);
    }
  });

  it('points each managed name at its own folder under the app’s data', () => {
    expect(folderNamed('/data', 'Scratch')).toBe(join('/data', 'scratch'));
    expect(folderNamed('/data', 'Logs')).toBe(join('/data', 'logs'));
    expect(canClear('Scratch')).toBe(true);
    expect(canClear('Logs')).toBe(true);
    // A row that may hold work is listed, never emptied outright.
    expect(canClear('Branches')).toBe(false);
    expect(canClear('Set aside')).toBe(false);
  });
});

describe('clearing what was picked', () => {
  it('removes the folders it was given and counts what actually went', async () => {
    const userData = await scratch();
    const gone = join(userData, 'scratch', 'one');
    const also = join(userData, 'logs');
    await mkdir(gone, { recursive: true });
    await mkdir(also, { recursive: true });
    await writeFile(join(gone, 'a.txt'), 'x'.repeat(100));
    await writeFile(join(also, 'main.log'), 'y'.repeat(50));

    const picked: Sweepable[] = [
      { path: gone, kind: 'copy', at: 0, holdsWork: false },
      { path: also, kind: 'copy', at: 0, holdsWork: false },
      { path: join(userData, 'never-there'), kind: 'copy', at: 0, holdsWork: false },
    ];
    const result = await sweep(picked);

    expect(result.freed).toBe(150);
    // Every managed row reads zero: the two folders that were there are gone,
    // and the rows for the ones that never were are still just rows.
    for (const row of await measureFolders(userData)) expect([row.name, row.bytes, row.files]).toEqual([row.name, 0, 0]);
  });
});
