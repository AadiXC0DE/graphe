/** Durable writes, against a real disk.
 *
 *  Everything this app keeps and reads back later — the checklist, the checkout
 *  index, a stylesheet the design view rewrote — is believed when it is read.
 *  A file half-written is not a smaller file, it is unreadable, and unreadable
 *  is reported as "there is nothing here" rather than as damage. So the claim
 *  under test is the one that matters: a write that fails leaves what was there
 *  before, and leaves nothing else behind. */

import { chmod, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { writeAtomically, writeAtomicallySync } from '../src/lib/atomic';

const madeFolders: string[] = [];

afterAll(async () => {
  for (const folder of madeFolders) {
    await chmod(folder, 0o755).catch(() => undefined);
    await rm(folder, { recursive: true, force: true });
  }
});

async function newFolder(): Promise<string> {
  const folder = await realpath(await mkdtemp(path.join(tmpdir(), 'graphe-atomic-')));
  madeFolders.push(folder);
  return folder;
}

/** Anything left over from a write that did not finish. */
async function scratchIn(folder: string): Promise<string[]> {
  return (await readdir(folder)).filter((name) => name.endsWith('.writing'));
}

/* ========================================================================== */
/* A-01 a write that fails                                                     */
/* ========================================================================== */

describe('A-01 when the write cannot finish', () => {
  it('leaves the file that was already there exactly as it was', async () => {
    const folder = await newFolder();
    const file = path.join(folder, 'checklist.json');
    await writeFile(file, '{"done":true}', 'utf8');

    await chmod(folder, 0o555);
    await expect(writeAtomically(file, '{"done":false}')).rejects.toThrow();
    await chmod(folder, 0o755);

    expect(await readFile(file, 'utf8')).toBe('{"done":true}');
  });

  it('leaves nothing half-written beside it', async () => {
    const folder = await newFolder();
    const file = path.join(folder, 'checklist.json');
    await writeFile(file, '{"done":true}', 'utf8');

    await chmod(folder, 0o555);
    await expect(writeAtomically(file, '{"done":false}')).rejects.toThrow();
    await chmod(folder, 0o755);

    expect(await scratchIn(folder)).toEqual([]);
    expect(await readdir(folder)).toEqual(['checklist.json']);
  });

  it('behaves the same way without anything to wait on', async () => {
    const folder = await newFolder();
    const file = path.join(folder, 'servers.json');
    await writeFile(file, '[]', 'utf8');

    await chmod(folder, 0o555);
    expect(() => {
      writeAtomicallySync(file, '[{"port":5173}]');
    }).toThrow();
    await chmod(folder, 0o755);

    expect(await readFile(file, 'utf8')).toBe('[]');
    expect(await readdir(folder)).toEqual(['servers.json']);
  });
});

/* ========================================================================== */
/* A-02 a write that finishes                                                  */
/* ========================================================================== */

describe('A-02 an ordinary write', () => {
  it('writes the whole file and leaves nothing beside it', async () => {
    const folder = await newFolder();
    const file = path.join(folder, 'checklist.json');

    await writeAtomically(file, '{"done":true}');

    expect(await readFile(file, 'utf8')).toBe('{"done":true}');
    expect(await readdir(folder)).toEqual(['checklist.json']);
  });

  it('replaces what was there before', async () => {
    const folder = await newFolder();
    const file = path.join(folder, 'checklist.json');
    await writeFile(file, 'old', 'utf8');

    await writeAtomically(file, 'new');
    writeAtomicallySync(file, 'newer');

    expect(await readFile(file, 'utf8')).toBe('newer');
    expect(await readdir(folder)).toEqual(['checklist.json']);
  });

  it('makes the folders the file needs', async () => {
    const folder = await newFolder();
    const buried = path.join(folder, 'design', 'tokens', 'colours.css');

    await writeAtomically(buried, ':root { --ink: #111; }');
    expect(await readFile(buried, 'utf8')).toBe(':root { --ink: #111; }');

    const alsoBuried = path.join(folder, 'design', 'review', 'page.html');
    writeAtomicallySync(alsoBuried, '<h1>Review</h1>');
    expect(await readFile(alsoBuried, 'utf8')).toBe('<h1>Review</h1>');
  });

  it('writes bytes as faithfully as text', async () => {
    const folder = await newFolder();
    const file = path.join(folder, 'hero.bin');
    const bytes = Uint8Array.from([0, 1, 2, 250, 251, 252]);

    await writeAtomically(file, bytes);
    expect(new Uint8Array(await readFile(file))).toEqual(bytes);
  });
});

/* ========================================================================== */
/* A-03 several writers at once                                                */
/* ========================================================================== */

describe('A-03 two things saving at the same moment', () => {
  it('ends with one whole readable file, never a blend of them', async () => {
    const folder = await newFolder();
    const file = path.join(folder, 'checkouts.json');
    // Long enough that a non-atomic write would be interrupted part-way.
    const versions = Array.from({ length: 24 }, (_, n) =>
      JSON.stringify({ writer: n, rows: Array.from({ length: 400 }, (_, r) => `row-${String(n)}-${String(r)}`) }),
    );

    await Promise.all(versions.map((text) => writeAtomically(file, text)));

    expect(versions).toContain(await readFile(file, 'utf8'));
    expect(await readdir(folder)).toEqual(['checkouts.json']);
  });

  it('leaves nothing beside it when the sync and async forms race', async () => {
    const folder = await newFolder();
    const file = path.join(folder, 'checkouts.json');

    await Promise.all(
      Array.from({ length: 12 }, (_, n) =>
        n % 2 === 0
          ? writeAtomically(file, `async-${String(n)}`)
          : Promise.resolve().then(() => {
              writeAtomicallySync(file, `sync-${String(n)}`);
            }),
      ),
    );

    expect(await readFile(file, 'utf8')).toMatch(/^(async|sync)-\d+$/);
    expect(await scratchIn(folder)).toEqual([]);
  });
});
