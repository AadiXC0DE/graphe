/** Where writing rescued out of a copy goes, and how an older rescue is found.
 *
 * The failure this exists for: the root a rescue is filed in was named from the
 * project's path with every awkward character flattened to a dash, so two
 * projects differing only in punctuation — `/x/my-site` and `/x/my.site` — shared
 * one folder. A rescue into it wrote over the other project's copy of any file
 * whose name matched. New rescues are filed under a digest of the project's id,
 * which two projects cannot share.
 *
 * What must not happen while fixing that: an older version's rescued copy —
 * which can be the only copy of somebody's page — must still be found, and its
 * folder must never be renamed, moved or written to. The cases below put a
 * legacy root on disk, rescue into the new one, and then check the old folder is
 * byte-for-byte where it was.
 */

import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { legacyRescueRoot, rescueFolder } from '../src/work/copies';
import { rescuedCopies, rescueWords, writesAside, type Rescued } from '../src/work/rescue';
import { putAwayWorktree, writingLeftBehind, type RunGit } from '../src/history/worktree';
import { gitIn } from './helpers/fixtures';

const scratch: string[] = [];

afterEach(async () => {
  for (const one of scratch.splice(0)) await rm(one, { recursive: true, force: true });
});

/** A folder to build in, resolved: macOS hands out `/var` paths that are really
 *  `/private/var`, and a legacy key is a path spelled out. */
async function temporary(prefix: string): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  scratch.push(root);
  return root;
}

/** The git runner `src/history/` asks for. */
function git(): RunGit {
  return async (args, options) => {
    const one = await gitIn(options.cwd, ...args);
    return { code: one.code, out: one.out };
  };
}

/**
 * Two real repositories side by side in one parent, named so that the legacy key
 * — the whole path flattened — is the same string for both.
 *
 * This is the collision the finding names, and it cannot be reproduced across
 * two unrelated temp folders: the shared parent is what makes the paths differ
 * only in punctuation. Both are `website` to a person reading the folder name.
 */
async function collidingPair(): Promise<{ parent: string; one: string; two: string }> {
  const parent = await temporary('graphe-rescue-pair-');
  const one = join(parent, 'my-site');
  const two = join(parent, 'my.site');
  for (const [root, text] of [
    [one, 'the first project’s page\n'],
    [two, 'the second project’s page\n'],
  ] as const) {
    await mkdir(root, { recursive: true });
    await gitIn(root, 'init', '-b', 'main');
    await gitIn(root, 'config', 'user.name', 'Graphe fixtures');
    await gitIn(root, 'config', 'user.email', 'fixtures@graphe.local');
    await gitIn(root, 'config', 'commit.gpgsign', 'false');
    await writeFile(join(root, 'page.md'), text);
    // The one thing the rescue is for: writing no save and no version holds.
    await writeFile(join(root, '.gitignore'), 'notes/\n');
    await gitIn(root, 'add', '-A');
    await gitIn(root, 'commit', '-m', 'starts');
  }
  return { parent, one, two };
}

/** A checkout of one of them, holding a page its project ignores. */
async function checkoutWith(repo: string, text: string): Promise<string> {
  const copy = await temporary('graphe-rescue-copy-');
  await rm(copy, { recursive: true, force: true });
  await gitIn(repo, 'worktree', 'add', '-b', `graphe/wrote-${String(Date.now())}`, copy);
  await mkdir(join(copy, 'notes'), { recursive: true });
  await writeFile(join(copy, 'notes', 'audit.md'), text);
  return copy;
}

describe('the root a rescue goes in', () => {
  it('tells apart two projects whose paths flatten to the same name', async () => {
    const { one, two } = await collidingPair();
    // The old key really does collide, or this case proves nothing.
    expect(legacyRescueRoot('/profile', one)).toBe(legacyRescueRoot('/profile', two));
    expect(legacyRescueRoot('/profile', one)).toContain('my-site');

    expect(rescueFolder('/profile', one, 'project-one')).not.toBe(
      rescueFolder('/profile', two, 'project-two'),
    );
  });

  it('reads through a relative path to the same folder', async () => {
    const base = '/profile';
    expect(rescueFolder(base, '/work/here/../site', 'p-1')).toBe(
      rescueFolder(base, '/work/site', 'p-1'),
    );
  });

  /* The id rather than the path: somebody who moves a project has not thereby
     given up on the writing rescued out of it. The readable half of the folder
     name follows the project, so the lookup reads the folder rather than
     building the name again. */
  it('still finds a project’s rescue after the project is moved', async () => {
    const base = await temporary('graphe-rescue-profile-');
    const before: Rescued = { base, project: '/work/old', projectId: 'p-1' };
    const source = await temporary('graphe-rescue-source-');
    await writeFile(join(source, 'page.md'), 'written before the move\n');
    expect(await writesAside(before, 'conversation-1')(source, ['page.md'])).toBe(true);

    const after: Rescued = { ...before, project: '/work/new' };
    const found = await rescuedCopies(after, 'conversation-1');
    expect(found).toEqual([join(rescueFolder(base, '/work/old', 'p-1'), 'conversation-1')]);
    expect(await readFile(join(found[0] ?? '', 'page.md'), 'utf8')).toBe(
      'written before the move\n',
    );
    // And it is written into the folder carrying the project's new name, not
    // one shaped by where it used to be.
    expect(await writesAside(after, 'conversation-2')(source, ['page.md'])).toBe(true);
    expect(await rescuedCopies(after, 'conversation-2')).toEqual([
      join(rescueFolder(base, '/work/new', 'p-1'), 'conversation-2'),
    ]);
  });

  it('is somewhere a person can be sent, named after the project', async () => {
    expect(rescueFolder('/profile', '/work/my-site', 'p-1')).toMatch(
      /kept-aside\/my-site-[0-9a-f]{8}$/,
    );
  });
});

describe('two projects that used to share a rescue root', () => {
  it('rescues each into its own root, and finds both again', async () => {
    const { one, two } = await collidingPair();
    const base = await temporary('graphe-rescue-profile-');
    const mine: Rescued = { base, project: one, projectId: 'project-one' };
    const theirs: Rescued = { base, project: two, projectId: 'project-two' };
    // Both paths flatten into one folder, which is what used to make one
    // project's rescue land on the other's. Neither project's own root is it.
    const legacy = legacyRescueRoot(base, one);
    expect(legacyRescueRoot(base, two)).toBe(legacyRescueRoot(base, one));

    for (const [where, text] of [
      [mine, 'the first project wrote this\n'],
      [theirs, 'the second project wrote this\n'],
    ] as const) {
      const source = await temporary('graphe-rescue-source-');
      await writeFile(join(source, 'notes.md'), text);
      expect(await writesAside(where, 'conversation-1')(source, ['notes.md'])).toBe(true);
    }

    const first = await rescuedCopies(mine, 'conversation-1');
    const second = await rescuedCopies(theirs, 'conversation-1');
    // One root each, and neither is the other's: this is the file that used to
    // be written over. Neither is the shared legacy root either, because
    // nothing new is written into it.
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(first[0]).not.toBe(second[0]);
    expect(first[0]).not.toBe(join(legacy, 'conversation-1'));
    expect(second[0]).not.toBe(join(legacy, 'conversation-1'));
    expect(await readFile(join(first[0] ?? '', 'notes.md'), 'utf8')).toBe(
      'the first project wrote this\n',
    );
    expect(await readFile(join(second[0] ?? '', 'notes.md'), 'utf8')).toBe(
      'the second project wrote this\n',
    );
  });

  it('finds an older version’s rescue, and leaves it exactly as it was', async () => {
    const base = await temporary('graphe-rescue-profile-');
    const project = '/p/one/my-site';
    const where: Rescued = { base, project, projectId: 'project-one' };
    const legacy = join(legacyRescueRoot(base, project), 'conversation-1');
    await mkdir(legacy, { recursive: true });
    await writeFile(join(legacy, 'audit.md'), 'fifty kilobytes of research\n');

    expect(await rescuedCopies(where, 'conversation-1')).toEqual([legacy]);
    // Read, never written: what an older version kept is not this one's to
    // change, and nothing new is put in the folder it lives in.
    expect(await readdir(legacy)).toEqual(['audit.md']);
    expect(await readFile(join(legacy, 'audit.md'), 'utf8')).toBe('fifty kilobytes of research\n');
    expect(existsSync(rescueFolder(base, project, where.projectId))).toBe(false);
  });

  /* A rescue that failed leaves its folder behind holding nothing. Sending
     somebody to an empty folder is worse than saying nothing at all. */
  it('leaves an empty folder out of what it finds', async () => {
    const base = await temporary('graphe-rescue-profile-');
    const where: Rescued = { base, project: '/p/one/my-site', projectId: 'project-one' };
    await mkdir(legacyRescueRoot(base, where.project), { recursive: true });
    expect(await rescuedCopies(where, 'conversation-1')).toEqual([]);
  });

  it('names every folder holding the writing, old and new', async () => {
    const base = await temporary('graphe-rescue-profile-');
    const where: Rescued = { base, project: '/p/one/my-site', projectId: 'project-one' };
    const legacy = join(legacyRescueRoot(base, where.project), 'conversation-1');
    await mkdir(legacy, { recursive: true });
    await writeFile(join(legacy, 'page.md'), 'written before\n');

    const source = await temporary('graphe-rescue-source-');
    await writeFile(join(source, 'page.md'), 'written now\n');
    expect(await writesAside(where, 'conversation-1')(source, ['page.md'])).toBe(true);

    const held = await rescuedCopies(where, 'conversation-1');
    expect(held).toEqual([
      join(rescueFolder(base, where.project, where.projectId), 'conversation-1'),
      legacy,
    ]);
    // The sentence a person reads has to name both: the old root is not where
    // anything is written any more, so it is the only way to that page.
    const said = rescueWords.setAside(held);
    for (const one of held) expect(said).toContain(one);
  });

  /* Saying it was carried out and then deleting the only copy is the whole
     failure the rescue exists to prevent. */
  it('fails rather than pretending, when the folder will not take the files', async () => {
    const base = await temporary('graphe-rescue-profile-');
    const source = await temporary('graphe-rescue-source-');
    await writeFile(join(source, 'notes.md'), 'the only copy\n');
    // `kept-aside` is a file here, so the root cannot be made.
    await writeFile(join(base, 'kept-aside'), 'not a folder\n');
    const where: Rescued = { base, project: '/p/one/my-site', projectId: 'project-one' };
    expect(await writesAside(where, 'conversation-1')(source, ['notes.md'])).toBe(false);
  });
});

describe('putting a checkout away, through the real rescue', () => {
  it('writes each project’s ignored notes into its own root', async () => {
    const { one, two } = await collidingPair();
    const base = await temporary('graphe-rescue-profile-');
    const mine: Rescued = { base, project: one, projectId: 'project-one' };
    const theirs: Rescued = { base, project: two, projectId: 'project-two' };
    expect(legacyRescueRoot(base, mine.project)).toBe(legacyRescueRoot(base, theirs.project));

    for (const [where, repo, text] of [
      [mine, one, 'the first project’s page\n'],
      [theirs, two, 'the second project’s page\n'],
    ] as const) {
      const copy = await checkoutWith(repo, text);
      // The sweep sees nothing, which is exactly how this writing was lost
      // once already; the rescue is the only thing that carries it out.
      expect(await writingLeftBehind(git(), copy)).toEqual({
        files: ['notes/audit.md'],
        tooBig: false,
      });
      const away = await putAwayWorktree(git(), repo, copy, {
        rescue: writesAside(where, 'a-copy'),
      });
      expect(away.put).toBe(true);
      expect(existsSync(copy)).toBe(false);
    }

    const mineHeld = await rescuedCopies(mine, 'a-copy');
    const theirsHeld = await rescuedCopies(theirs, 'a-copy');
    expect(mineHeld).toHaveLength(1);
    expect(theirsHeld).toHaveLength(1);
    expect(mineHeld[0]).not.toBe(theirsHeld[0]);
    expect(await readFile(join(mineHeld[0] ?? '', 'notes', 'audit.md'), 'utf8')).toBe(
      'the first project’s page\n',
    );
    expect(await readFile(join(theirsHeld[0] ?? '', 'notes', 'audit.md'), 'utf8')).toBe(
      'the second project’s page\n',
    );
  });
});
