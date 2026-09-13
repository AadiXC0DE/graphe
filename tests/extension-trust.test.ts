/** Nothing in a folder is run to find out what it does.
 *
 * The probe reads a card by importing the extension and calling its factory,
 * which is running somebody's code. That is fine for an add-on somebody
 * installed and said yes to, and it is not fine for whatever a cloned folder
 * happened to bring along — so the gate is here, in front of the probe, and
 * this is what proves it holds.
 */

import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import { cardsFor } from '../src/agent/pi/extension-probe';

const made: string[] = [];

async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'graphe-trust-'));
  made.push(dir);
  return dir;
}

afterAll(async () => {
  for (const dir of made) await rm(dir, { recursive: true, force: true });
});

/** The fixture copied somewhere disposable, so a probe that runs it writes its
 *  marker into a folder this test owns rather than into the repository. */
async function markerIn(dir: string): Promise<string> {
  const into = join(dir, 'marker');
  await mkdir(into, { recursive: true });
  await copyFile(
    fileURLToPath(new URL('./fixtures/extensions/marker/index.mjs', import.meta.url)),
    join(into, 'index.mjs'),
  );
  return join(into, 'index.mjs');
}

const plainAt = (): string =>
  fileURLToPath(new URL('./fixtures/extensions/plain/index.mjs', import.meta.url));

const ranMark = (path: string): boolean => existsSync(join(path, '..', 'it-ran'));

describe('an extension nobody has said yes to', () => {
  it('is not imported, not called, and gets an unknown card', async () => {
    const cache = await scratch();
    const marker = await markerIn(await scratch());
    const cards = await cardsFor([marker, plainAt()], cache, (path) => path === plainAt(), 'pi-test');

    expect(cards.get(plainAt())?.tools).toEqual(['count_words', 'spell_check']);
    expect(cards.get(marker)).toBeNull();
    // The whole assertion: its top-level write never happened.
    expect(ranMark(marker)).toBe(false);
  });

  it('is run once somebody does say yes, which is what makes the gate a gate', async () => {
    const cache = await scratch();
    const marker = await markerIn(await scratch());
    const cards = await cardsFor([marker], cache, () => true, 'pi-test');
    expect(cards.get(marker)?.tools).toEqual(['marks']);
    expect(ranMark(marker)).toBe(true);
  });
});
