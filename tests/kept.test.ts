/** The versions somebody chose to keep, and the promise that they stay kept.
 *
 * Two things are being protected here, and neither is about the rail:
 *
 *  1. **One project's shelf is not another's.** Keeping a moment in one folder
 *     must not put it at the top of a different folder's timeline. Everything
 *     is keyed by folder, and the tests below are the reason to keep it that
 *     way when somebody later reaches for a flat list.
 *  2. **An old file still opens.** Keeping arrived after the preferences file
 *     did, so the file on somebody's computer has no `kept` in it. That must
 *     read as "nothing kept yet", never as a failure — a preference file that
 *     will not load takes the switch above it down with it.
 *
 * The arranging is pure, so almost all of this runs without a disk. The two
 * that do touch one are about the file itself, which is the part that can only
 * be proved by writing it and opening it again.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { asKept, keeping, sameKept } from '../src/projects/kept';
import { defaultPreferences, PreferenceFile } from '../src/projects/preferences';

const PAPER = '/Users/you/Sites/paper-street';
const ATLAS = '/Users/you/Sites/atlas-studio';

async function inATemporaryFolder<T>(run: (folder: string) => Promise<T>): Promise<T> {
  const folder = await mkdtemp(join(tmpdir(), 'graphe-kept-'));
  try {
    return await run(folder);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

describe('keeping a version', () => {
  it('adds and removes, and says the same thing twice', () => {
    const one = keeping({}, PAPER, 'v1', true);
    expect(one[PAPER]).toEqual(['v1']);

    // Keeping what is already kept is not a second copy of it.
    expect(keeping(one, PAPER, 'v1', true)[PAPER]).toEqual(['v1']);

    const two = keeping(one, PAPER, 'v2', true);
    expect(two[PAPER]).toEqual(['v1', 'v2']);

    const back = keeping(two, PAPER, 'v1', false);
    expect(back[PAPER]).toEqual(['v2']);
  });

  it('leaves nothing behind when the last one is let go', () => {
    const kept = keeping({}, PAPER, 'v1', true);
    expect(Object.keys(keeping(kept, PAPER, 'v1', false))).toEqual([]);
  });

  it('never changes the shelf it was given', () => {
    const before = keeping({}, PAPER, 'v1', true);
    keeping(before, PAPER, 'v2', true);
    expect(before[PAPER]).toEqual(['v1']);
  });

  it('lets go of something that was never kept without complaining', () => {
    expect(keeping({}, PAPER, 'v9', false)).toEqual({});
    const kept = keeping({}, PAPER, 'v1', true);
    expect(keeping(kept, PAPER, 'v9', false)[PAPER]).toEqual(['v1']);
  });

  /* The whole reason it is keyed by folder. */
  it('keeps each project apart', () => {
    let kept = keeping({}, PAPER, 'v1', true);
    kept = keeping(kept, ATLAS, 'v1', true);
    kept = keeping(kept, ATLAS, 'v2', true);

    expect(kept[PAPER]).toEqual(['v1']);
    expect(kept[ATLAS]).toEqual(['v1', 'v2']);

    // The same version id in two folders is two different moments.
    kept = keeping(kept, PAPER, 'v1', false);
    expect(kept[PAPER]).toBeUndefined();
    expect(kept[ATLAS]).toEqual(['v1', 'v2']);
  });

  it('has nothing to say about a project nobody has kept anything in', () => {
    const kept = keeping({}, PAPER, 'v1', true);
    expect(kept[ATLAS]).toBeUndefined();
    expect(kept['/Users/you/Sites/field-notes'] ?? []).toEqual([]);
  });

  it('ignores a nameless folder or a nameless version', () => {
    expect(keeping({}, '', 'v1', true)).toEqual({});
    expect(keeping({}, PAPER, '', true)).toEqual({});
  });
});

describe('reading a shelf back', () => {
  it('is empty for anything that is not a shelf', () => {
    expect(asKept(undefined)).toEqual({});
    expect(asKept(null)).toEqual({});
    expect(asKept('kept')).toEqual({});
    expect(asKept(['v1', 'v2'])).toEqual({});
  });

  it('drops what it cannot use and keeps the rest', () => {
    expect(
      asKept({
        [PAPER]: ['v1', 42, '', 'v2', 'v1'],
        [ATLAS]: 'v1',
        '': ['v1'],
        '/Users/you/Sites/empty': [],
      }),
    ).toEqual({ [PAPER]: ['v1', 'v2'] });
  });

  it('agrees with itself, and notices when it should not', () => {
    expect(sameKept({}, {})).toBe(true);
    expect(sameKept({ [PAPER]: ['v1'] }, { [PAPER]: ['v1'] })).toBe(true);
    expect(sameKept({ [PAPER]: ['v1'] }, { [PAPER]: ['v2'] })).toBe(false);
    expect(sameKept({ [PAPER]: ['v1'] }, { [PAPER]: ['v1', 'v2'] })).toBe(false);
    expect(sameKept({ [PAPER]: ['v1'] }, { [ATLAS]: ['v1'] })).toBe(false);
    expect(sameKept({ [PAPER]: ['v1'] }, {})).toBe(false);
  });
});

describe('the file it lives in', () => {
  it('opens a file written before keeping existed', async () => {
    await inATemporaryFolder(async (folder) => {
      const file = join(folder, 'preferences.json');
      await writeFile(
        file,
        JSON.stringify({ version: 1, preferences: { showMe: true, model: null } }),
        'utf8',
      );

      const preferences = await PreferenceFile.open(file);
      expect(preferences.all().showMe).toBe(true);
      expect(preferences.all().kept).toEqual({});

      // And keeping something in it still works, rather than failing on the
      // field that was not there.
      const after = await preferences.change({ kept: keeping({}, PAPER, 'v1', true) });
      expect(after.kept[PAPER]).toEqual(['v1']);
    });
  });

  it('starts empty and survives the quit', async () => {
    await inATemporaryFolder(async (folder) => {
      const file = join(folder, 'preferences.json');
      expect((await PreferenceFile.open(file)).all()).toEqual(defaultPreferences);

      const first = await PreferenceFile.open(file);
      let kept = keeping(first.all().kept, PAPER, 'v1', true);
      kept = keeping(kept, ATLAS, 'v7', true);
      await first.change({ kept });

      const later = await PreferenceFile.open(file);
      expect(later.all().kept[PAPER]).toEqual(['v1']);
      expect(later.all().kept[ATLAS]).toEqual(['v7']);

      await later.change({ kept: keeping(later.all().kept, PAPER, 'v1', false) });
      const again = await PreferenceFile.open(file);
      expect(again.all().kept[PAPER]).toBeUndefined();
      expect(again.all().kept[ATLAS]).toEqual(['v7']);
    });
  });

  it('writes nothing for a change that is not one', async () => {
    await inATemporaryFolder(async (folder) => {
      const file = join(folder, 'preferences.json');
      const preferences = await PreferenceFile.open(file);
      await preferences.change({ kept: keeping({}, PAPER, 'v1', true) });
      const written = await readFile(file, 'utf8');

      await preferences.change({ kept: { [PAPER]: ['v1'] } });
      expect(await readFile(file, 'utf8')).toBe(written);
    });
  });

  it('reads past a shelf somebody edited into nonsense', async () => {
    await inATemporaryFolder(async (folder) => {
      const file = join(folder, 'preferences.json');
      await writeFile(
        file,
        JSON.stringify({
          version: 1,
          preferences: { showMe: false, model: null, kept: 'all of them' },
        }),
        'utf8',
      );
      expect((await PreferenceFile.open(file)).all().kept).toEqual({});
    });
  });
});
