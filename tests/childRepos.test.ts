/** Finding the projects inside a folder that holds several.
 *
 *  A parent folder with `backend/.git` and `frontend/.git` used to be treated
 *  as one broken repository. This is the detection that tells them apart —
 *  depth one, nothing created, nothing opened, and a parent that is itself a
 *  repository always wins over its children.
 */

import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { changedAcross, childNamed, childRepos, MOST_CHILDREN } from '../electron/childRepos';

let root: string;

async function repo(name: string): Promise<string> {
  const path = join(root, name);
  await mkdir(join(path, '.git'), { recursive: true });
  return path;
}

afterAll(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true });
});

describe('finding child repositories', () => {
  it('finds the children that hold their own .git, by name', async () => {
    root = await mkdtemp(join(tmpdir(), 'graphe-children-'));
    await repo('backend');
    await repo('frontend');
    // A plain folder among them: no .git, so not a project.
    await mkdir(join(root!, 'plain-notes'), { recursive: true });

    const found = await childRepos(root!);
    expect(found.map((one) => one.rel)).toEqual(['backend', 'frontend']);
    expect(found[0]!.path).toBe(join(root!, 'backend'));
  });

  it('counts a parent that is itself a repository as no children at all', async () => {
    root = await mkdtemp(join(tmpdir(), 'graphe-children-'));
    await repo('.git-here');
    // The parent's own .git — the marker that ends the scan before it starts.
    await mkdir(join(root!, '.git'));
    await repo('nested');

    expect(await childRepos(root!)).toEqual([]);
  });

  it('needs two or more to count as several; one nested repo changes nothing', async () => {
    root = await mkdtemp(join(tmpdir(), 'graphe-children-'));
    await repo('example-app-inside-docs');
    expect(await childRepos(root!)).toHaveLength(1);
  });

  it('skips dot folders, never-opened names, plain files and symlinks', async () => {
    root = await mkdtemp(join(tmpdir(), 'graphe-children-'));
    await repo('real');
    await mkdir(join(root, '.hidden', '.git'), { recursive: true });
    await mkdir(join(root, 'node_modules', '.git'), { recursive: true });
    await writeFile(join(root, 'a-file.txt'), 'not a folder');
    // Points at a real repository — followed, it would be counted twice under
    // two names. The link itself is what gets skipped.
    await symlink(join(root!, 'real'), join(root!, 'linked'));

    const found = await childRepos(root!);
    expect(found.map((one) => one.rel)).toEqual(['real']);
  });

  it('counts a .git file like a .git folder — worktrees are repositories too', async () => {
    root = await mkdtemp(join(tmpdir(), 'graphe-children-'));
    const worktree = join(root, 'copy-of-main');
    await mkdir(worktree, { recursive: true });
    await writeFile(join(worktree, '.git'), 'gitdir: /somewhere/else');

    const found = await childRepos(root!);
    expect(found.map((one) => one.rel)).toEqual(['copy-of-main']);
  });

  it('stops at three, however many there are', async () => {
    root = await mkdtemp(join(tmpdir(), 'graphe-children-'));
    for (const name of ['a-one', 'b-two', 'c-three', 'd-four']) await repo(name);

    const found = await childRepos(root!);
    expect(found).toHaveLength(MOST_CHILDREN);
    // Alphabetical, so the cap takes the same children every time rather than
    // readdir order, which answers to nobody.
    expect(found.map((one) => one.rel)).toEqual(['a-one', 'b-two', 'c-three']);
  });

  it('answers empty for a folder that cannot be read or does not exist', async () => {
    expect(await childRepos(join(tmpdir(), `graphe-nowhere-${String(Date.now())}`))).toEqual([]);
  });
});

describe('naming child changes so they match the parent walk', () => {
  it('prefixes every changed file with its project name', () => {
    const marked = changedAcross([
      { rel: 'backend', files: [{ path: 'src/app.ts' }, { path: 'README.md' }] },
      { rel: 'frontend', files: [{ path: 'index.html' }] },
    ]);
    expect(marked).toEqual([
      { path: 'backend/src/app.ts' },
      { path: 'backend/README.md' },
      { path: 'frontend/index.html' },
    ]);
  });

  it('says nothing when a child has nothing changed', () => {
    expect(changedAcross([{ rel: 'backend', files: [] }])).toEqual([]);
  });
});

describe('choosing which project a call is about', () => {
  const found = [
    { rel: 'backend', path: '/Users/mira/Projects/shop/backend' },
    { rel: 'frontend', path: '/Users/mira/Projects/shop/frontend' },
  ] as const;

  it('picks the one named, out of the ones actually found', () => {
    expect(childNamed(found, 'frontend')?.path).toBe('/Users/mira/Projects/shop/frontend');
  });

  it('says nothing for a name nobody found, whatever it is trying to be', () => {
    for (const nonsense of ['', '..', '../..', 'backend/..', '/etc', 'note', undefined]) {
      expect(childNamed(found, nonsense), String(nonsense)).toBeNull();
    }
  });

  /** Most Mac disks do not tell one from the other, so a name that differs only
   *  in case names the same folder. It is still a lookup: nothing here can name
   *  a folder that was not found. */
  it('matches a name the way the disk does', () => {
    expect(childNamed(found, 'BACKEND')?.rel).toBe('backend');
    expect(childNamed(found, 'FrontEnd')?.rel).toBe('frontend');
  });

  it('says nothing at all for a folder that is one project', () => {
    expect(childNamed([], 'backend')).toBeNull();
    expect(childNamed([found[0]], 'backend')).toBeNull();
  });
});
