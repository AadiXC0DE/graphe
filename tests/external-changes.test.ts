/** What a reader was shown, and whether it is still what is on disk.
 *
 * The panel and the review screen both keep what they read and draw it from
 * memory until something asks again, so an editor or a terminal writing one of
 * those paths leaves the screen showing bytes that are no longer there. The
 * claim these tests hold is the one that fixes it: a reading carries the
 * revision it was taken at, and a later read of the same thing says whether it
 * has moved — including an edit that leaves the file exactly as long, which is
 * the case a name and a size cannot see.
 *
 * No disk and no window: readings in, readings out.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import {
  diffKey,
  fileKey,
  fileRevision,
  listRevision,
  listingKey,
  Readings,
} from '../electron/services/readings';

const made: string[] = [];

async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'graphe-readings-'));
  made.push(dir);
  return dir;
}

afterAll(async () => {
  for (const dir of made) await rm(dir, { recursive: true, force: true });
});

describe('a listing says what it was read from', () => {
  it('moves when a file appears, goes or changes length', () => {
    const one = listRevision(['/work/atlas', 'src/app.ts 120', 'src/b.ts 40']);
    const longer = listRevision(['/work/atlas', 'src/app.ts 121', 'src/b.ts 40']);
    const another = listRevision(['/work/atlas', 'src/app.ts 120', 'src/b.ts 40', 'src/c.ts 9']);
    const elsewhere = listRevision(['/work/bee', 'src/app.ts 120', 'src/b.ts 40']);

    expect(longer).not.toBe(one);
    expect(another).not.toBe(one);
    // Two projects with the same names are two listings.
    expect(elsewhere).not.toBe(one);
    // And the same folder read the same way is the same reading, or nothing
    // downstream could ever call a panel current.
    expect(listRevision(['/work/atlas', 'src/app.ts 120', 'src/b.ts 40'])).toBe(one);
  });

  it('moves for an edit that keeps the file exactly as long', () => {
    // The reason a file has a revision of its own rather than being trusted to
    // the listing: `aaa` and `bbb` are the same name and the same three bytes.
    expect(fileRevision('aaa')).not.toBe(fileRevision('bbb'));
    expect(fileRevision('aaa')).toBe(fileRevision('aaa'));
    // Length is in it as well as the hash, so a file at a different size is a
    // different reading even before the bytes are compared.
    expect(fileRevision('aaaa')).not.toBe(fileRevision('aaa'));
  });
});

describe('a read whose revision moved', () => {
  it('says so the first time and not the second', () => {
    const known = new Readings();
    const key = listingKey('/work/atlas');

    // Never read before: nothing has moved under anybody, which is the same
    // answer as "nothing changed".
    expect(known.note(key, 'r1', 1).changed).toBe(false);
    expect(known.held(key)).toEqual({ revision: 'r1', at: 1 });

    // The same folder again: still current.
    expect(known.note(key, 'r1', 2).changed).toBe(false);

    // Somebody edited a file, or a terminal wrote one: what is on screen is not
    // what is there any more.
    expect(known.note(key, 'r2', 3).changed).toBe(true);
    expect(known.held(key)).toEqual({ revision: 'r2', at: 3 });
    // And the reading is replaced, so the next look is compared against now.
    expect(known.note(key, 'r2', 4).changed).toBe(false);
  });

  it('keeps one workspace out of another', () => {
    const known = new Readings();
    known.note(listingKey('/work/atlas'), 'a1', 1);
    known.note(listingKey('/work/bee'), 'b1', 1);
    known.note(fileKey('/work/atlas', 'src/app.ts'), 'f1', 1);
    known.note(diffKey('/work/atlas', 'base'), 'd1', 1);

    // The same file name in another workspace is another reading, which is
    // what a chat working in its own copy depends on.
    expect(known.held(fileKey('/work/bee', 'src/app.ts'))).toBeNull();
    expect(known.held(fileKey('/work/atlas', 'src/app.ts'))?.revision).toBe('f1');
    // And two projects with the same listing are two readings.
    expect(known.note(listingKey('/work/bee'), 'a1', 2).changed).toBe(true);
  });
});

describe('a file changed underneath a reader', () => {
  it('reads different bytes, and the revision is what noticed', async () => {
    const folder = await scratch();
    const where = join(folder, 'notes.md');
    await writeFile(where, 'first\n', 'utf8');

    const before = readFileSync(where);
    const readOnce = fileRevision(before);
    const known = new Readings();
    expect(known.note(fileKey(folder, 'notes.md'), readOnce, 1).changed).toBe(false);

    // Somebody else's editor, at the same length: `first` and `third` are both
    // five characters and a newline, so the name and the size say nothing.
    await writeFile(where, 'third\n', 'utf8');
    const after = readFileSync(where);
    const readAgain = fileRevision(after);

    expect(after.byteLength).toBe(before.byteLength);
    expect(readAgain).not.toBe(readOnce);
    const second = known.note(fileKey(folder, 'notes.md'), readAgain, 2);
    expect(second.changed).toBe(true);
    // What the reader is shown is the file as it is now, not the bytes they
    // were already looking at.
    expect(after.toString('utf8')).toBe('third\n');
  });

  it('sees a listing change when a file appears beside one already read', async () => {
    const folder = await scratch();
    await writeFile(join(folder, 'a.txt'), 'a', 'utf8');
    const listing = (): string =>
      listRevision([
        folder,
        ...['a.txt', 'b.txt']
          .map((name) => {
            try {
              return `${name} ${String(readFileSync(join(folder, name)).byteLength)}`;
            } catch {
              return '';
            }
          })
          .filter((one) => one !== ''),
      ]);

    const known = new Readings();
    expect(known.note(listingKey(folder), listing(), 1).changed).toBe(false);
    expect(known.note(listingKey(folder), listing(), 2).changed).toBe(false);

    await writeFile(join(folder, 'b.txt'), 'bb', 'utf8');
    expect(known.note(listingKey(folder), listing(), 3).changed).toBe(true);
  });
});
