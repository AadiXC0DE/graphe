/** The shape of a project, from a flat list of paths.
 *
 * Two things are being protected here. The order, because a list of files that
 * puts `item10` before `item2` is the tell that nobody thought about the person
 * reading it. And what is left out, because the first thing every other file
 * tree does is bury somebody's four files under a hundred thousand of the
 * machine's own — and the escape hatch out of that has to work too, or the
 * feature only serves half the people using it.
 */

import { describe, expect, it } from 'vitest';

import {
  buildTree,
  changedOnly,
  compareNames,
  EVERYTHING,
  expandAll,
  expandTo,
  flatten,
  foldersTo,
  isNoise,
  nodeAt,
  pathTo,
  saySize,
  segmentsOf,
  totals,
  type FileEntry,
  type FolderNode,
  type TreeNode,
} from '../src/files/tree';

/** Paths, with a size nobody is testing and nothing changed. */
function files(...paths: readonly string[]): readonly FileEntry[] {
  return paths.map((path) => ({ path, size: 100 }));
}

/** Every row's path, in the order it would be drawn. */
function names(nodes: readonly TreeNode[]): readonly string[] {
  return nodes.map((node) => node.name);
}

function folder(nodes: readonly TreeNode[], path: string): FolderNode {
  const found = nodeAt(nodes, path);
  if (found === null || found.kind !== 'folder') throw new Error(`no folder at ${path}`);
  return found;
}

describe('building the tree', () => {
  it('nests a path into a folder per part', () => {
    const tree = buildTree(files('src/pages/pricing.tsx'));

    expect(names(tree)).toEqual(['src']);
    const src = folder(tree, 'src');
    expect(src.depth).toBe(0);
    expect(names(src.children)).toEqual(['pages']);

    const pages = folder(tree, 'src/pages');
    expect(pages.depth).toBe(1);
    expect(pages.children).toEqual([
      {
        kind: 'file',
        name: 'pricing.tsx',
        path: 'src/pages/pricing.tsx',
        size: 100,
        changed: false,
        depth: 2,
      },
    ]);
  });

  it('shares the folders two files have in common', () => {
    const tree = buildTree(files('src/a.tsx', 'src/b.tsx', 'public/logo.svg'));

    expect(names(tree)).toEqual(['public', 'src']);
    expect(folder(tree, 'src').fileCount).toBe(2);
    expect(folder(tree, 'public').fileCount).toBe(1);
  });

  it('adds up the sizes of everything under a folder', () => {
    const tree = buildTree([
      { path: 'src/a.tsx', size: 300 },
      { path: 'src/deep/b.tsx', size: 700 },
      { path: 'readme.md', size: 40 },
    ]);

    expect(folder(tree, 'src').size).toBe(1000);
    expect(totals(tree)).toEqual({ size: 1040, files: 3, changed: 0 });
  });

  it('takes a file at the top of the project as it comes', () => {
    const tree = buildTree(files('readme.md'));
    expect(tree).toEqual([
      { kind: 'file', name: 'readme.md', path: 'readme.md', size: 100, changed: false, depth: 0 },
    ]);
  });

  it('says nothing about an empty list', () => {
    expect(buildTree([])).toEqual([]);
    expect(totals([])).toEqual({ size: 0, files: 0, changed: 0 });
  });

  it('ignores the leading ./ and any doubled or trailing slashes', () => {
    const tree = buildTree(files('./src//a.tsx', 'src/b.tsx/'));
    expect(names(folder(tree, 'src').children)).toEqual(['a.tsx', 'b.tsx']);
  });

  it('drops a path with nothing in it', () => {
    expect(buildTree(files('', '/', '.'))).toEqual([]);
  });

  it('folds the same path listed twice into one file', () => {
    const tree = buildTree([
      { path: 'src/a.tsx', size: 10 },
      { path: 'src/a.tsx', size: 20, changed: true },
    ]);

    const src = folder(tree, 'src');
    expect(src.children).toHaveLength(1);
    expect(src.fileCount).toBe(1);
    expect(src.children[0]).toMatchObject({ size: 20, changed: true });
  });

  it('keeps a file and a folder that share a name apart', () => {
    const tree = buildTree(files('src/logo', 'src/logo/mark.svg'));
    const src = folder(tree, 'src');

    expect(src.children.map((one) => [one.kind, one.path])).toEqual([
      ['folder', 'src/logo'],
      ['file', 'src/logo'],
    ]);
    expect(src.children[0]).toMatchObject({ kind: 'folder', fileCount: 1 });
    expect(nodeAt(tree, 'src/logo/mark.svg')).toMatchObject({ kind: 'file' });
  });

  it('holds a path nested far deeper than anybody would draw', () => {
    const deep = Array.from({ length: 40 }, (_, i) => `f${i}`).join('/');
    const tree = buildTree(files(`${deep}/end.txt`));

    const trail = pathTo(tree, `${deep}/end.txt`);
    expect(trail).toHaveLength(41);
    expect(trail[40]).toMatchObject({ kind: 'file', name: 'end.txt', depth: 40 });
  });

  it('keeps names with spaces and other alphabets whole', () => {
    const tree = buildTree(files('Hero Section copy/Ω logo.svg', 'Zeichnungen/Größe.png'));

    expect(names(tree)).toEqual(['Hero Section copy', 'Zeichnungen']);
    expect(names(folder(tree, 'Hero Section copy').children)).toEqual(['Ω logo.svg']);
    expect(nodeAt(tree, 'Zeichnungen/Größe.png')).toMatchObject({ name: 'Größe.png' });
  });
});

describe('the order things come in', () => {
  it('puts folders before files', () => {
    const tree = buildTree(files('a.txt', 'zeta/inside.txt'));
    expect(names(tree)).toEqual(['zeta', 'a.txt']);
  });

  it('ignores case, so Assets sits with assets rather than above everything', () => {
    const tree = buildTree(files('banner.png', 'Assets.png', 'cover.png'));
    expect(names(tree)).toEqual(['Assets.png', 'banner.png', 'cover.png']);
  });

  it('counts runs of digits as numbers', () => {
    expect(names(buildTree(files('item10.png', 'item2.png', 'item1.png')))).toEqual([
      'item1.png',
      'item2.png',
      'item10.png',
    ]);
  });

  it('reads a number the same however many noughts are in front of it', () => {
    expect(compareNames('item02', 'item10')).toBeLessThan(0);
    expect(compareNames('item0010', 'item9')).toBeGreaterThan(0);
  });

  it('still puts two spellings of the same number in a settled order', () => {
    expect(compareNames('item2', 'item002')).toBeLessThan(0);
    expect(compareNames('item002', 'item2')).toBeGreaterThan(0);
  });

  it('compares long runs of digits by value rather than by float', () => {
    expect(compareNames('a90071992547409929', 'a90071992547409931')).toBeLessThan(0);
  });

  it('lets the number decide before the case does', () => {
    expect(compareNames('Item2', 'item10')).toBeLessThan(0);
    expect(compareNames('item2', 'Item10')).toBeLessThan(0);
  });

  it('sorts an accented name beside its plain spelling, not after z', () => {
    expect(names(buildTree(files('Éclair.png', 'edge.png', 'zoo.png')))).toEqual([
      'Éclair.png',
      'edge.png',
      'zoo.png',
    ]);
  });

  it('is the same answer whichever way round it is asked', () => {
    expect(compareNames('a', 'a')).toBe(0);
    expect(compareNames('a', 'B')).toBeLessThan(0);
    expect(compareNames('B', 'a')).toBeGreaterThan(0);
  });

  it('sorts every level, not only the top', () => {
    const tree = buildTree(files('src/z.tsx', 'src/a.tsx', 'src/nested/one.tsx'));
    expect(names(folder(tree, 'src').children)).toEqual(['nested', 'a.tsx', 'z.tsx']);
  });

  it('puts what changed first when asked, and keeps folders first inside that', () => {
    const tree = buildTree(
      [
        { path: 'a.txt', size: 1 },
        { path: 'z.txt', size: 1, changed: true },
        { path: 'quiet/one.txt', size: 1 },
        { path: 'work/one.txt', size: 1, changed: true },
      ],
      { changedFirst: true },
    );

    expect(names(tree)).toEqual(['work', 'z.txt', 'quiet', 'a.txt']);
  });
});

describe('what a designer never has to see', () => {
  const noisy = files(
    'src/App.tsx',
    'node_modules/react/index.js',
    'dist/bundle.js',
    'build/out.css',
    '.git/HEAD',
    '.env',
    'package-lock.json',
    'pnpm-lock.yaml',
    'Gemfile.lock',
    'src/.DS_Store',
  );

  it('leaves the machinery out by default', () => {
    const tree = buildTree(noisy);
    expect(names(tree)).toEqual(['src']);
    expect(names(folder(tree, 'src').children)).toEqual(['App.tsx']);
  });

  it('hands back the whole project when asked for everything', () => {
    const tree = buildTree(noisy, EVERYTHING);
    expect(names(tree)).toEqual([
      '.git',
      'build',
      'dist',
      'node_modules',
      'src',
      '.env',
      'Gemfile.lock',
      'package-lock.json',
      'pnpm-lock.yaml',
    ]);
    expect(names(folder(tree, 'src').children)).toEqual(['.DS_Store', 'App.tsx']);
  });

  it('takes a list of names to hide in place of the usual one', () => {
    const tree = buildTree(files('node_modules/react/index.js', 'sketches/old.fig'), {
      hide: ['sketches'],
      hideDotted: false,
    });
    expect(names(tree)).toEqual(['node_modules']);
  });

  it('can keep the dotted names while still dropping the rest', () => {
    const tree = buildTree(files('.env', 'node_modules/react/index.js'), { hideDotted: false });
    expect(names(tree)).toEqual(['.env']);
  });

  it('answers for one path on its own', () => {
    expect(isNoise('src/App.tsx')).toBe(false);
    expect(isNoise('src/node_modules/thing/index.js')).toBe(true);
    expect(isNoise('.git/HEAD')).toBe(true);
    expect(isNoise('.git/HEAD', EVERYTHING)).toBe(false);
    expect(isNoise('yarn.lock')).toBe(true);
  });
});

describe('what changed', () => {
  const project: readonly FileEntry[] = [
    { path: 'src/pages/pricing.tsx', size: 10, changed: true },
    { path: 'src/pages/about.tsx', size: 10 },
    { path: 'src/lib/quiet.ts', size: 10 },
    { path: 'public/logo.svg', size: 10, changed: true },
    { path: 'readme.md', size: 10 },
  ];

  it('counts what moved under every folder on the way up', () => {
    const tree = buildTree(project);
    expect(folder(tree, 'src').changedCount).toBe(1);
    expect(folder(tree, 'src').changed).toBe(true);
    expect(folder(tree, 'src/lib').changed).toBe(false);
    expect(totals(tree).changed).toBe(2);
  });

  it('folds away everything nothing happened in', () => {
    const only = changedOnly(buildTree(project));

    expect(names(only)).toEqual(['public', 'src']);
    expect(names(folder(only, 'src').children)).toEqual(['pages']);
    expect(names(folder(only, 'src/pages').children)).toEqual(['pricing.tsx']);
    expect(nodeAt(only, 'src/lib')).toBeNull();
    expect(nodeAt(only, 'readme.md')).toBeNull();
  });

  it('recounts the folders it keeps over what is left in them', () => {
    const only = changedOnly(buildTree(project));
    const src = folder(only, 'src');
    expect(src.fileCount).toBe(1);
    expect(src.size).toBe(10);
    expect(src.changedCount).toBe(1);
  });

  it('says nothing at all when nothing changed', () => {
    expect(changedOnly(buildTree(files('a.txt', 'src/b.txt')))).toEqual([]);
  });

  it('leaves the depths alone, so a folded tree still lines up', () => {
    const only = changedOnly(buildTree(project));
    expect(folder(only, 'src/pages').depth).toBe(1);
    expect(nodeAt(only, 'src/pages/pricing.tsx')?.depth).toBe(2);
  });
});

describe('finding a way to a file', () => {
  const tree = buildTree(files('src/pages/pricing.tsx', 'src/App.tsx', 'readme.md'));

  it('walks the chain from the top down', () => {
    expect(pathTo(tree, 'src/pages/pricing.tsx').map((one) => one.path)).toEqual([
      'src',
      'src/pages',
      'src/pages/pricing.tsx',
    ]);
  });

  it('stops at a folder when that is what was asked for', () => {
    expect(pathTo(tree, 'src/pages').map((one) => one.path)).toEqual(['src', 'src/pages']);
    expect(nodeAt(tree, 'src/pages')?.kind).toBe('folder');
  });

  it('has nothing to say about a path that is not there', () => {
    expect(pathTo(tree, 'src/pages/missing.tsx')).toEqual([]);
    expect(pathTo(tree, 'nowhere')).toEqual([]);
    expect(pathTo(tree, '')).toEqual([]);
    expect(nodeAt(tree, 'nowhere')).toBeNull();
  });

  it('does not pretend a file has anything underneath it', () => {
    expect(pathTo(tree, 'readme.md/deeper.txt')).toEqual([]);
  });

  it('takes the file at the end of a path a folder also answers to', () => {
    const both = buildTree(files('src/logo', 'src/logo/mark.svg'));
    expect(nodeAt(both, 'src/logo')?.kind).toBe('file');
    expect(nodeAt(both, 'src/logo/mark.svg')?.name).toBe('mark.svg');
  });

  it('names the folders that have to be open for a file to show', () => {
    expect(foldersTo('src/pages/pricing.tsx')).toEqual(['src', 'src/pages']);
    expect(foldersTo('readme.md')).toEqual([]);
    expect(foldersTo('')).toEqual([]);
  });

  it('opens the way to a file without closing anything already open', () => {
    const open = expandTo(new Set(['public']), 'src/pages/pricing.tsx');
    expect([...open].sort()).toEqual(['public', 'src', 'src/pages']);
  });

  it('opens every folder there is', () => {
    expect([...expandAll(tree)].sort()).toEqual(['src', 'src/pages']);
    expect([...expandAll([])]).toEqual([]);
  });

  it('reads a path in parts', () => {
    expect(segmentsOf('./src//a.tsx/')).toEqual(['src', 'a.tsx']);
  });
});

describe('the rows on screen', () => {
  const tree = buildTree(files('src/pages/pricing.tsx', 'src/App.tsx', 'readme.md'));

  it('shows only the top of the project when nothing is open', () => {
    const rows = flatten(tree, new Set());
    expect(rows.map((row) => row.node.path)).toEqual(['src', 'readme.md']);
    expect(rows[0]).toMatchObject({ open: false, level: 1, posInSet: 1, setSize: 2 });
  });

  it('unfolds a folder that is open, and stops there', () => {
    const rows = flatten(tree, new Set(['src']));
    expect(rows.map((row) => row.node.path)).toEqual([
      'src',
      'src/pages',
      'src/App.tsx',
      'readme.md',
    ]);
    expect(rows[1]).toMatchObject({ open: false, level: 2, posInSet: 1, setSize: 2 });
  });

  it('goes all the way down when everything is open', () => {
    const rows = flatten(tree, expandAll(tree));
    expect(rows.map((row) => row.node.path)).toEqual([
      'src',
      'src/pages',
      'src/pages/pricing.tsx',
      'src/App.tsx',
      'readme.md',
    ]);
    expect(rows[2]).toMatchObject({ level: 3, posInSet: 1, setSize: 1 });
  });

  it('ignores an open folder that is no longer in the tree', () => {
    const rows = flatten(changedOnly(tree), new Set(['src', 'gone']));
    expect(rows).toEqual([]);
  });

  it('never says a file is open', () => {
    const rows = flatten(tree, new Set(['readme.md']));
    expect(rows.find((row) => row.node.path === 'readme.md')?.open).toBe(false);
  });

  it('has no rows for an empty project', () => {
    expect(flatten([], new Set())).toEqual([]);
  });
});

describe('saying how big something is', () => {
  it('counts the small ones in bytes', () => {
    expect(saySize(0)).toBe('0 bytes');
    expect(saySize(1)).toBe('1 byte');
    expect(saySize(999)).toBe('999 bytes');
  });

  it('steps up once the number stops being readable', () => {
    expect(saySize(1000)).toBe('1 KB');
    expect(saySize(1450)).toBe('1.5 KB');
    expect(saySize(24_000)).toBe('24 KB');
    expect(saySize(2_400_000)).toBe('2.4 MB');
    expect(saySize(5_000_000_000)).toBe('5 GB');
  });

  it('says nothing rather than something wrong', () => {
    expect(saySize(-1)).toBe('');
    expect(saySize(Number.NaN)).toBe('');
  });
});
