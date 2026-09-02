/** Which folders become a project, against real folders on a real disk.
 *
 *  The claim here is not "we call the right functions", it is "opening the
 *  Desktop does not turn the Desktop into a repository" — so the fixtures are
 *  real home folders with real Desktops in them, and every refusal is checked
 *  to have left nothing behind. */

import { mkdir, mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import {
  TOO_MANY_BYTES,
  TOO_MANY_FILES,
  openingWords,
  refusedFolder,
  sizeOf,
  verdictFor,
} from '../src/history/opening';

const madeFolders: string[] = [];

afterAll(async () => {
  await Promise.all(madeFolders.map((folder) => rm(folder, { recursive: true, force: true })));
});

/** A stand-in home folder with the shape macOS gives everybody. */
async function newHome(): Promise<string> {
  const home = await realpath(await mkdtemp(path.join(tmpdir(), 'graphe-home-')));
  madeFolders.push(home);
  for (const kept of ['Desktop', 'Documents', 'Downloads', 'Library', 'Movies', 'Music', 'Pictures', 'Public']) {
    await mkdir(path.join(home, kept), { recursive: true });
  }
  await mkdir(path.join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs'), { recursive: true });
  await mkdir(path.join(home, 'Projects', 'landing-page'), { recursive: true });
  return home;
}

async function isEmpty(folder: string): Promise<boolean> {
  return (await readdir(folder)).length === 0;
}

/* ========================================================================== */
/* O-01 the folders that are somebody's whole computer                         */
/* ========================================================================== */

describe('O-01 folders that are not a project', () => {
  it('refuses the home folder itself', async () => {
    const home = await newHome();
    expect(refusedFolder(home, home)).toBe(openingWords.home);
    expect(refusedFolder('~', home)).toBe(openingWords.home);
  });

  it('refuses the Desktop, and says which folder it means', async () => {
    const home = await newHome();
    const reason = refusedFolder(path.join(home, 'Desktop'), home);
    expect(reason).toBe(openingWords.kept('Desktop'));
    expect(reason).toContain('Desktop');
  });

  it('refuses every folder the operating system keeps', async () => {
    const home = await newHome();
    for (const kept of ['Documents', 'Downloads', 'Movies', 'Music', 'Pictures', 'Public']) {
      expect(refusedFolder(path.join(home, kept), home)).toBe(openingWords.kept(kept));
    }
    expect(refusedFolder(path.join(home, 'Library'), home)).toBe(openingWords.system);
  });

  it('refuses the disk, the users folder and the volumes', () => {
    const home = '/Users/designer';
    expect(refusedFolder('/', home)).toBe(openingWords.disk);
    expect(refusedFolder('/Users', home)).toBe(openingWords.system);
    expect(refusedFolder('/Volumes', home)).toBe(openingWords.disk);
    expect(refusedFolder('/Volumes/Backup Drive', home)).toBe(openingWords.disk);
  });

  it('opens a folder on a volume that is not the volume itself', () => {
    expect(refusedFolder('/Volumes/Backup Drive/landing-page', '/Users/designer')).toBeNull();
  });

  it('refuses iCloud Drive and the container above it', async () => {
    const home = await newHome();
    expect(refusedFolder(path.join(home, 'Library', 'Mobile Documents'), home)).toBe(openingWords.cloud);
    expect(refusedFolder(path.join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs'), home)).toBe(
      openingWords.cloud,
    );
  });

  it('opens a project kept inside iCloud Drive', async () => {
    const home = await newHome();
    const inside = path.join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs', 'landing-page');
    expect(refusedFolder(inside, home)).toBeNull();
  });

  it('refuses the scratch folder, which is emptied without warning', () => {
    expect(refusedFolder('/tmp', '/Users/designer')).toBe(openingWords.scratch);
    expect(refusedFolder('/private/tmp', '/Users/designer')).toBe(openingWords.scratch);
  });

  it('ignores a trailing slash and the case of the name', async () => {
    const home = await newHome();
    expect(refusedFolder(`${path.join(home, 'Desktop')}/`, home)).not.toBeNull();
    expect(refusedFolder(path.join(home, 'desktop'), home)).not.toBeNull();
  });

  it('opens an ordinary project folder', async () => {
    const home = await newHome();
    expect(refusedFolder(path.join(home, 'Projects', 'landing-page'), home)).toBeNull();
    expect(refusedFolder(path.join(home, 'Projects'), home)).toBeNull();
  });
});

/* ========================================================================== */
/* O-02 the whole answer, and what it offers instead                           */
/* ========================================================================== */

describe('O-02 the verdict', () => {
  it('refuses the Desktop and offers a folder inside it, creating nothing', async () => {
    const home = await newHome();
    const desktop = path.join(home, 'Desktop');
    const verdict = await verdictFor(desktop, { home, isRepo: false });

    expect(verdict.kind).toBe('refuse');
    if (verdict.kind !== 'refuse') return;
    expect(verdict.because).toContain('Desktop');
    expect(verdict.offer).toBe(openingWords.offer);
    expect(verdict.offer).toContain('folder');
    expect(await isEmpty(desktop)).toBe(true);
  });

  it('refuses the home folder, creating nothing', async () => {
    const home = await newHome();
    const before = (await readdir(home)).sort();
    const verdict = await verdictFor(home, { home, isRepo: false });

    expect(verdict.kind).toBe('refuse');
    expect((await readdir(home)).sort()).toEqual(before);
  });

  it('opens a normal project folder', async () => {
    const home = await newHome();
    const verdict = await verdictFor(path.join(home, 'Projects', 'landing-page'), { home, isRepo: false });
    expect(verdict).toEqual({ kind: 'open' });
  });

  it('opens a folder that already keeps history, wherever it is', async () => {
    const home = await newHome();
    for (const anywhere of [home, path.join(home, 'Desktop'), '/Volumes/Backup Drive']) {
      expect(await verdictFor(anywhere, { home, isRepo: true })).toEqual({ kind: 'open' });
    }
  });

  it('refuses a folder with more files in it than one project has', async () => {
    const home = await newHome();
    const verdict = await verdictFor(path.join(home, 'Projects'), {
      home,
      isRepo: false,
      count: async () => ({ files: TOO_MANY_FILES + 1, bytes: 0 }),
    });

    expect(verdict.kind).toBe('refuse');
    if (verdict.kind !== 'refuse') return;
    expect(verdict.because).toBe(openingWords.tooMany(TOO_MANY_FILES));
    expect(verdict.offer).toBe(openingWords.offer);
  });

  it('refuses a folder holding more than one project could', async () => {
    const home = await newHome();
    const verdict = await verdictFor(path.join(home, 'Projects'), {
      home,
      isRepo: false,
      count: async () => ({ files: 10, bytes: TOO_MANY_BYTES + 1 }),
    });

    expect(verdict.kind).toBe('refuse');
    if (verdict.kind !== 'refuse') return;
    expect(verdict.because).toBe(openingWords.tooBig(TOO_MANY_BYTES));
  });

  it('does not count anything when it has already refused', async () => {
    const home = await newHome();
    let counted = false;
    const verdict = await verdictFor(path.join(home, 'Desktop'), {
      home,
      isRepo: false,
      count: async () => {
        counted = true;
        return { files: 0, bytes: 0 };
      },
    });

    expect(verdict.kind).toBe('refuse');
    expect(counted).toBe(false);
  });
});

/* ========================================================================== */
/* O-03 measuring without walking the whole disk                               */
/* ========================================================================== */

describe('O-03 how much is in there', () => {
  it('counts a small folder, nested folders and all', async () => {
    const home = await newHome();
    const folder = path.join(home, 'Projects', 'landing-page');
    await mkdir(path.join(folder, 'images'), { recursive: true });
    await writeFile(path.join(folder, 'index.html'), '<h1>Hello</h1>', 'utf8');
    await writeFile(path.join(folder, 'images', 'hero.txt'), 'x'.repeat(100), 'utf8');

    const size = await sizeOf(folder, { files: TOO_MANY_FILES, bytes: TOO_MANY_BYTES });
    expect(size.files).toBe(2);
    expect(size.bytes).toBe(114);
    expect(size.over).toBe(false);
  });

  it('gives up as soon as it is past the cap rather than counting the rest', async () => {
    const home = await newHome();
    const folder = path.join(home, 'Projects', 'too-much');
    await mkdir(folder, { recursive: true });
    for (let n = 0; n < 40; n++) await writeFile(path.join(folder, `file-${String(n)}.txt`), 'x', 'utf8');

    const size = await sizeOf(folder, { files: 5, bytes: TOO_MANY_BYTES });
    expect(size.over).toBe(true);
    expect(size.files).toBe(6);
  });

  it('gives up on the size cap too', async () => {
    const home = await newHome();
    const folder = path.join(home, 'Projects', 'heavy');
    await mkdir(folder, { recursive: true });
    for (let n = 0; n < 10; n++) await writeFile(path.join(folder, `file-${String(n)}.txt`), 'x'.repeat(500), 'utf8');

    const size = await sizeOf(folder, { files: TOO_MANY_FILES, bytes: 900 });
    expect(size.over).toBe(true);
    expect(size.bytes).toBeLessThan(2000);
  });

  it('says nothing is there for a folder it cannot read', async () => {
    const home = await newHome();
    const size = await sizeOf(path.join(home, 'never-made'), { files: 10, bytes: 10 });
    expect(size).toEqual({ files: 0, bytes: 0, over: false });
  });
});
