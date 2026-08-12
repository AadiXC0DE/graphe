/** Finding everything in a project, without a disk under it.
 *
 * The walk is handed a folder made of objects, so every bound it stands on —
 * the folders it never opens, the depth, the total — is a fact this file can
 * assert rather than a claim in a comment.
 */

import { describe, expect, it } from 'vitest';
import {
  BIGGEST,
  cannotOpen,
  everythingIn,
  looksBinary,
  markChanged,
  neverOpened,
  tidyPath,
  tooBig,
  type Found,
  type LookInside,
} from '../src/files/listing';
import { containsPath, isCredentialPath } from '../src/agent/guard/paths';
import { buildTree, changedOnly } from '../src/files/tree';

/* -------------------------------------------------------------------------- */
/* A folder made of objects                                                    */
/* -------------------------------------------------------------------------- */

type Shape = { [name: string]: Shape | number };

/** A reader over a plain object. Numbers are files and their size; objects are
 *  folders. Counts every folder it is asked to open, so "skipped before
 *  descending" can be asserted rather than assumed. */
function folderOf(shape: Shape, root = '/project'): { look: LookInside; opened: string[] } {
  const opened: string[] = [];
  const look: LookInside = (path: string) => {
    opened.push(path);
    const parts = path.slice(root.length).split('/').filter((one) => one !== '');
    let here: Shape | number = shape;
    for (const part of parts) {
      if (typeof here === 'number') return Promise.resolve([]);
      const next: Shape | number | undefined = here[part];
      if (next === undefined) return Promise.resolve([]);
      here = next;
    }
    if (typeof here === 'number') return Promise.resolve([]);
    const found: Found[] = Object.entries(here).map(([name, value]) =>
      typeof value === 'number'
        ? { name, kind: 'file' as const, size: value }
        : { name, kind: 'folder' as const, size: 0 },
    );
    return Promise.resolve(found);
  };
  return { look, opened };
}

function deepFolder(depth: number): Shape {
  const bottom: Shape = { 'buried.txt': 10 };
  let shape: Shape = bottom;
  for (let level = 0; level < depth; level += 1) shape = { [`level${String(level)}`]: shape };
  return shape;
}

function manyFiles(count: number): Shape {
  const shape: Shape = {};
  for (let index = 0; index < count; index += 1) shape[`file-${String(index)}.txt`] = index;
  return shape;
}

/* -------------------------------------------------------------------------- */

describe('A1 the walk', () => {
  it('finds every file, project-relative and forward-slashed', async () => {
    const { look } = folderOf({
      'README.md': 120,
      src: { 'index.ts': 40, styles: { 'tokens.css': 80 } },
    });

    const walked = await everythingIn('/project', look);

    expect(walked.files.map((one) => one.path).sort()).toEqual([
      'README.md',
      'src/index.ts',
      'src/styles/tokens.css',
    ]);
    expect(walked.stopped).toBe(false);
  });

  it('carries each file’s size', async () => {
    const { look } = folderOf({ 'a.txt': 7, deep: { 'b.txt': 900 } });
    const walked = await everythingIn('/project', look);
    expect(walked.files.find((one) => one.path === 'a.txt')?.size).toBe(7);
    expect(walked.files.find((one) => one.path === 'deep/b.txt')?.size).toBe(900);
  });

  it('answers in the same order twice', async () => {
    const shape: Shape = { b: { 'y.ts': 1 }, a: { 'z.ts': 1, 'x.ts': 1 }, 'c.ts': 1 };
    const once = await everythingIn('/project', folderOf(shape).look);
    const twice = await everythingIn('/project', folderOf(shape).look);
    expect(once.files).toEqual(twice.files);
  });

  it('is not stopped by a folder that will not open', async () => {
    const look: LookInside = (path) =>
      Promise.resolve(
        path === '/project'
          ? [
              { name: 'locked', kind: 'folder', size: 0 },
              { name: 'open.txt', kind: 'file', size: 3 },
            ]
          : [],
      );
    const walked = await everythingIn('/project', look);
    expect(walked.files.map((one) => one.path)).toEqual(['open.txt']);
  });
});

describe('A1 the noise is skipped rather than filtered', () => {
  it('never opens the folders nobody wrote', async () => {
    const { look, opened } = folderOf({
      node_modules: { react: { 'index.js': 10 } },
      '.git': { 'HEAD.txt': 4 },
      dist: { 'bundle.js': 900 },
      src: { 'index.ts': 40 },
    });

    const walked = await everythingIn('/project', look);

    expect(walked.files.map((one) => one.path)).toEqual(['src/index.ts']);
    // The whole point: they are not read and then dropped.
    expect(opened).toEqual(['/project', '/project/src']);
  });

  it('knows the ones it never opens by name', () => {
    expect(neverOpened('node_modules')).toBe(true);
    expect(neverOpened('.git')).toBe(true);
    expect(neverOpened('coverage')).toBe(true);
    expect(neverOpened('src')).toBe(false);
    expect(neverOpened('components')).toBe(false);
  });

  it('keeps files a person did write, dotted ones included', async () => {
    const { look } = folderOf({ '.gitignore': 20, '.env.example': 30, 'app.ts': 40 });
    const walked = await everythingIn('/project', look);
    expect(walked.files.map((one) => one.path).sort()).toEqual([
      '.env.example',
      '.gitignore',
      'app.ts',
    ]);
  });
});

describe('A1 the walk is bounded', () => {
  it('stops descending past the depth it was given', async () => {
    const { look } = folderOf(deepFolder(6));
    const walked = await everythingIn('/project', look, { deepest: 3 });

    expect(walked.files).toEqual([]);
    expect(walked.stopped).toBe(true);
  });

  it('keeps everything above that depth', async () => {
    const { look } = folderOf({ one: { 'shallow.txt': 5, two: { three: { 'deep.txt': 5 } } } });
    const walked = await everythingIn('/project', look, { deepest: 2 });
    expect(walked.files.map((one) => one.path)).toEqual(['one/shallow.txt']);
  });

  it('stops at the total it was given', async () => {
    const { look } = folderOf(manyFiles(500));
    const walked = await everythingIn('/project', look, { most: 50 });

    expect(walked.files).toHaveLength(50);
    expect(walked.stopped).toBe(true);
  });

  it('does not open another folder once the total is reached', async () => {
    const { look, opened } = folderOf({
      a: manyFiles(30),
      b: manyFiles(30),
      c: manyFiles(30),
    });

    await everythingIn('/project', look, { most: 20 });

    expect(opened).toEqual(['/project', '/project/a']);
  });

  it('says nothing was cut when nothing was', async () => {
    const { look } = folderOf(manyFiles(10));
    const walked = await everythingIn('/project', look, { most: 5000 });
    expect(walked.stopped).toBe(false);
  });

  it('holds a folder that is really somebody’s whole computer', async () => {
    const wide: Shape = {};
    for (let index = 0; index < 40; index += 1) wide[`folder-${String(index)}`] = manyFiles(400);
    const { look } = folderOf(wide);

    const walked = await everythingIn('/project', look);

    expect(walked.files.length).toBeLessThanOrEqual(5000);
    expect(walked.stopped).toBe(true);
  });
});

describe('A1 what moved, marked on it', () => {
  it('marks the files the version touched and leaves the rest alone', () => {
    const files = [
      { path: 'src/Hero.tsx', size: 10 },
      { path: 'src/Nav.tsx', size: 10 },
    ];

    const marked = markChanged(files, [{ path: 'src/Hero.tsx' }]);

    expect(marked.find((one) => one.path === 'src/Hero.tsx')?.changed).toBe(true);
    expect(marked.find((one) => one.path === 'src/Nav.tsx')?.changed).toBeUndefined();
  });

  it('leaves the list exactly as it was when nothing moved', () => {
    const files = [{ path: 'a.ts', size: 1 }];
    expect(markChanged(files, [])).toBe(files);
  });

  it('matches however the two sides spell a path', () => {
    const marked = markChanged([{ path: 'src/app/page.tsx', size: 1 }], [
      { path: './src/app/page.tsx' },
    ]);
    expect(marked[0]?.changed).toBe(true);
    expect(marked).toHaveLength(1);
  });

  it('adds a changed file the walk never reached rather than losing it', () => {
    const marked = markChanged([{ path: 'src/Hero.tsx', size: 10 }], [
      { path: 'src/Hero.tsx' },
      { path: 'deep/past/the/cap.tsx' },
    ]);

    expect(marked).toHaveLength(2);
    expect(marked.find((one) => one.path === 'deep/past/the/cap.tsx')).toEqual({
      path: 'deep/past/the/cap.tsx',
      size: 0,
      changed: true,
    });
  });

  it('marks a file once, whatever the other side sent twice', () => {
    const marked = markChanged([{ path: 'a.ts', size: 1 }], [{ path: 'a.ts' }, { path: 'a.ts' }]);
    expect(marked).toHaveLength(1);
  });

  it('reaches the panel: the marks survive into the tree it draws', () => {
    const marked = markChanged(
      [
        { path: 'src/Hero.tsx', size: 10 },
        { path: 'src/Nav.tsx', size: 10 },
      ],
      [{ path: 'src/Hero.tsx' }],
    );

    const onlyMoved = changedOnly(buildTree(marked));
    const folder = onlyMoved[0];

    expect(folder?.kind).toBe('folder');
    expect(folder?.kind === 'folder' ? folder.children.map((one) => one.name) : []).toEqual([
      'Hero.tsx',
    ]);
  });

  it('tidies a path the same way both sides do', () => {
    expect(tidyPath('./src//app/page.tsx')).toBe('src/app/page.tsx');
    expect(tidyPath('src\\app\\page.tsx')).toBe('src/app/page.tsx');
    expect(tidyPath('/')).toBe('');
  });
});

describe('A1 nothing outside the project', () => {
  const root = '/Users/you/Sites/paper-street';

  it('refuses a location that climbs out, with a sentence', () => {
    const check = containsPath(root, '../../.ssh/id_rsa');
    expect(check.inside).toBe(false);
    expect(check.reason).toMatch(/outside your project/);
  });

  it('refuses an absolute location somewhere else', () => {
    expect(containsPath(root, '/etc/passwd').inside).toBe(false);
  });

  it('refuses the home folder in its short form', () => {
    const check = containsPath(root, '~/Documents/notes.txt');
    expect(check.inside).toBe(false);
    expect(check.reason).toMatch(/home folder/);
  });

  it('refuses a climb that was written in an encoding', () => {
    expect(containsPath(root, '%2e%2e%2f%2e%2e%2fsecrets.txt').inside).toBe(false);
  });

  it('allows an ordinary file of the project, however it is written', () => {
    expect(containsPath(root, 'src/components/Hero.tsx').inside).toBe(true);
    expect(containsPath(root, './src/components/Hero.tsx').inside).toBe(true);
    expect(containsPath(root, `${root}/src/components/Hero.tsx`).inside).toBe(true);
  });

  it('refuses the files that hold keys and passwords, inside the project or not', () => {
    expect(isCredentialPath('.env')).toBe(true);
    expect(isCredentialPath('config/secrets.json')).toBe(true);
    expect(isCredentialPath('certs/site.pem')).toBe(true);
    expect(isCredentialPath('src/components/Hero.tsx')).toBe(false);
  });

  it('says why in words nobody has to decode', () => {
    for (const sentence of Object.values(cannotOpen)) {
      expect(sentence).toMatch(/^[A-Z]/);
      expect(sentence).toMatch(/\.$/);
      expect(sentence).not.toMatch(/\b(git|commit|branch|staged|token|API|repository|directory)\b/i);
    }
  });
});

describe('A1 a file that cannot be read on screen', () => {
  it('knows bytes from words', () => {
    expect(looksBinary(new TextEncoder().encode('export const a = 1;\n'))).toBe(false);
    expect(looksBinary(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0d]))).toBe(true);
  });

  it('looks no further than the start of a long file', () => {
    const bytes = new Uint8Array(40_000);
    bytes.fill(65);
    bytes[30_000] = 0;
    expect(looksBinary(bytes)).toBe(false);
  });

  it('finds a byte hiding at the very start', () => {
    expect(looksBinary(new Uint8Array([0]))).toBe(true);
  });

  it('has nothing to say about an empty file', () => {
    expect(looksBinary(new Uint8Array(0))).toBe(false);
  });

  it('refuses one too big to put on a screen', () => {
    expect(tooBig(BIGGEST + 1)).toBe(true);
    expect(tooBig(BIGGEST)).toBe(false);
    expect(tooBig(1_200)).toBe(false);
  });
});
