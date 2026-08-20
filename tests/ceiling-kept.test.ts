/** A ceiling that survives closing the window.
 *
 * The preference file writes only when something it recognises has changed, and
 * the ceiling was not on that list — so setting a spending limit and changing
 * nothing else wrote nothing, and the limit was gone by the next launch while
 * the window still showed it set. A ceiling that forgets itself is not a
 * ceiling, which is what the field's own comment already said.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { PreferenceFile } from '../src/projects/preferences';

const made: string[] = [];

afterAll(async () => {
  await Promise.all(made.map((folder) => rm(folder, { recursive: true, force: true })));
});

async function aFile(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), 'graphe-ceiling-'));
  made.push(folder);
  return join(folder, 'preferences.json');
}

describe('a spending ceiling is remembered', () => {
  it('survives the window closing', async () => {
    const where = await aFile();
    const first = await PreferenceFile.open(where);
    await first.change({ ceiling: { minor: 2500, currency: 'USD' } });

    // The whole of the bug: opened again, it used to be null.
    const again = await PreferenceFile.open(where);
    expect(again.all().ceiling).toEqual({ minor: 2500, currency: 'USD' });
  });

  it('remembers it being changed, not only first set', async () => {
    const where = await aFile();
    const file = await PreferenceFile.open(where);
    await file.change({ ceiling: { minor: 2500, currency: 'USD' } });
    await file.change({ ceiling: { minor: 500, currency: 'USD' } });

    expect((await PreferenceFile.open(where)).all().ceiling).toEqual({
      minor: 500,
      currency: 'USD',
    });
  });

  it('remembers it being taken off', async () => {
    const where = await aFile();
    const file = await PreferenceFile.open(where);
    await file.change({ ceiling: { minor: 2500, currency: 'USD' } });
    await file.change({ ceiling: null });

    expect((await PreferenceFile.open(where)).all().ceiling).toBeNull();
  });

  it('tells a different amount from the same one', async () => {
    const where = await aFile();
    const file = await PreferenceFile.open(where);
    await file.change({ ceiling: { minor: 2500, currency: 'USD' } });
    // Same amount, different currency: not the same ceiling.
    await file.change({ ceiling: { minor: 2500, currency: 'GBP' } });

    expect((await PreferenceFile.open(where)).all().ceiling).toEqual({
      minor: 2500,
      currency: 'GBP',
    });
  });
});
