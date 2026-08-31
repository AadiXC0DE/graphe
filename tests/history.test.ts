/** The version timeline, exercised against real projects on a real disk.
 *
 *  Nothing here is mocked. Every test makes a folder in the system's temporary
 *  directory, does things to it, and reads the result back — because the claim
 *  this module makes is not "we call the right functions", it is "your work is
 *  still there", and only the disk can settle that.
 *
 *  A failure in this file is a stop-ship. Replit's agent deleted a production
 *  database and had no way back (research/03 §5); every case below exists so that
 *  the same sentence can never be written about us. */

import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { devNull, tmpdir } from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, describe, expect, it, vi } from 'vitest';

import * as repo from '../src/history/repo';
import * as titles from '../src/history/titles';
import * as timeline from '../src/history/timeline';
import { HistoryError, ProjectHistory, historyProblems } from '../src/history/repo';
import { Timeline, type Version } from '../src/history/timeline';

// Every test spawns several child processes against a cold disk.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

/* ------------------------------------------------------------------ scaffolding */

const madeFolders: string[] = [];

afterAll(async () => {
  await Promise.all(madeFolders.map((folder) => rm(folder, { recursive: true, force: true })));
});

/** A real, empty folder in the real temporary directory. `realpath` because
 *  macOS hands out /var paths that are really /private/var, and comparing the
 *  two later is a false failure nobody enjoys debugging. */
async function newFolder(): Promise<string> {
  const folder = await realpath(await mkdtemp(path.join(tmpdir(), 'graphe-history-')));
  madeFolders.push(folder);
  return folder;
}

async function put(root: string, file: string, contents: string): Promise<void> {
  const target = path.join(root, file);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, contents, 'utf8');
}

async function get(root: string, file: string): Promise<string> {
  return readFile(path.join(root, file), 'utf8');
}

async function present(root: string, file: string): Promise<boolean> {
  try {
    await stat(path.join(root, file));
    return true;
  } catch {
    return false;
  }
}

const spawn = promisify(execFile);

/** Raw access to the storage, for the tests only. The app never does this
 *  outside src/history/repo.ts — here it is how we check that what we claim
 *  happened actually happened. */
async function storage(root: string, args: string[]): Promise<string> {
  const { stdout } = await spawn('git', args, {
    cwd: root,
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: devNull,
      GIT_CONFIG_SYSTEM: devNull,
      GIT_AUTHOR_NAME: 'A Designer',
      GIT_AUTHOR_EMAIL: 'designer@example.com',
      GIT_COMMITTER_NAME: 'A Designer',
      GIT_COMMITTER_EMAIL: 'designer@example.com',
    },
  });
  return stdout;
}

/** A project with one page and one saved version. The starting point for most
 *  of what follows. */
async function projectWithOneVersion(): Promise<{ root: string; line: Timeline; first: Version }> {
  const root = await newFolder();
  const line = await Timeline.open(root);
  await put(root, 'index.html', '<h1>Hello</h1>');
  const first = await line.snapshot({ instruction: 'build me a simple landing page' });
  expect(first).not.toBeNull();
  return { root, line, first: first as Version };
}

/* ========================================================================== */
/* H-01 a folder that has never kept a history                                 */
/* ========================================================================== */

describe('H-01 setting a project up', () => {
  it('sets itself up the first time the project is opened', async () => {
    const root = await newFolder();
    const line = await Timeline.open(root);

    expect(line.projectFolder).toBe(root);
    expect(await new ProjectHistory(root).isReady()).toBe(true);
    expect(await present(root, '.git')).toBe(true);
  });

  it('opening again changes nothing', async () => {
    const root = await newFolder();
    await Timeline.open(root);
    const folder = new ProjectHistory(root);
    expect(await folder.prepare()).toBe(false);

    const line = await Timeline.open(root);
    expect(await line.versions()).toEqual([]);
  });

  it('creates the folder if it is not there yet', async () => {
    const parent = await newFolder();
    const root = path.join(parent, 'a new project');
    const line = await Timeline.open(root);
    expect(await line.versions()).toEqual([]);
  });

  it('has no versions and nothing current before the first save', async () => {
    const root = await newFolder();
    const line = await Timeline.open(root);

    expect(await line.versions()).toEqual([]);
    expect(await line.currentVersion()).toBeNull();
  });

  it('has nothing to save in a genuinely empty project', async () => {
    const root = await newFolder();
    const line = await Timeline.open(root, { neverSave: false });
    expect(await line.snapshot()).toBeNull();
  });

  it('keeps rebuilt folders and private keys out of the history, unasked', async () => {
    const root = await newFolder();
    const line = await Timeline.open(root);
    await put(root, 'node_modules/some-package/index.js', 'module.exports = 1;');
    await put(root, '.env', 'STRIPE_KEY=sk_live_do_not_save_me');
    await put(root, 'index.html', '<h1>Hello</h1>');

    const saved = await line.snapshot();
    expect(saved).not.toBeNull();
    expect(await line.fileAt(saved!.id, 'index.html')).toBe('<h1>Hello</h1>');
    expect(await line.fileAt(saved!.id, '.env')).toBeNull();
    expect(await line.fileAt(saved!.id, 'node_modules/some-package/index.js')).toBeNull();
  });

  it('leaves a project that already decided for itself alone', async () => {
    const root = await newFolder();
    await put(root, '.gitignore', 'my-own-list/\n');
    await Timeline.open(root);
    expect(await get(root, '.gitignore')).toBe('my-own-list/\n');
  });

  it('will not work on a folder named by anything but an absolute path', async () => {
    expect(() => new ProjectHistory('some/relative/path')).toThrow(TypeError);
  });
});

/* ========================================================================== */
/* H-02 saving a version                                                       */
/* ========================================================================== */

describe('H-02 saving', () => {
  it('titles a version with what the user asked for, in the past tense', async () => {
    const { first } = await projectWithOneVersion();
    expect(first.title).toBe('Built me a simple landing page');
    expect(first.by).toBe('graphe');
    expect(first.named).toBe(false);
    expect(first.at).toBeGreaterThan(0);
  });

  it('titles a version by what changed when nothing was asked for', async () => {
    const root = await newFolder();
    const line = await Timeline.open(root);
    await line.snapshot();

    await put(root, 'src/styles/tokens.css', ':root { --brand: #16f; }');
    const saved = await line.snapshot();
    expect(saved?.title).toBe('Added the styling');
  });

  it('saves nothing when nothing changed', async () => {
    const { line } = await projectWithOneVersion();
    expect(await line.snapshot()).toBeNull();
    expect(await line.snapshot({ boundary: 'preview-green' })).toBeNull();
    expect((await line.versions()).length).toBe(1);
  });

  it('saves anyway when someone explicitly asks for a save point', async () => {
    const { line } = await projectWithOneVersion();
    const point = await line.snapshot({
      boundary: 'user-asked',
      by: 'you',
      name: 'before I broke the nav',
      evenIfNothingChanged: true,
    });

    expect(point?.title).toBe('before I broke the nav');
    expect(point?.named).toBe(true);
    expect(point?.by).toBe('you');
    expect(point?.boundary).toBe('user-asked');
  });

  it('lists versions newest first', async () => {
    const { root, line } = await projectWithOneVersion();
    await put(root, 'index.html', '<h1>Hello again</h1>');
    await line.snapshot({ instruction: 'change the greeting' });
    await put(root, 'index.html', '<h1>Hello once more</h1>');
    await line.snapshot({ instruction: 'change the greeting again' });

    const all = await line.versions();
    expect(all.map((version) => version.title)).toEqual([
      'Changed the greeting again',
      'Changed the greeting',
      'Built me a simple landing page',
    ]);
    expect(all[0]!.at).toBeGreaterThanOrEqual(all[2]!.at);
  });

  it('can be asked for only the newest few', async () => {
    const { root, line } = await projectWithOneVersion();
    await put(root, 'index.html', 'second');
    await line.snapshot();
    await put(root, 'index.html', 'third');
    await line.snapshot();

    expect((await line.versions({ limit: 2 })).length).toBe(2);
    expect((await line.currentVersion())?.id).toBe((await line.versions())[0]!.id);
  });

  it('reads a file back exactly as it was at a version', async () => {
    const { root, line, first } = await projectWithOneVersion();
    await put(root, 'index.html', '<h1>Changed</h1>');
    const second = await line.snapshot();

    expect(await line.fileAt(first.id, 'index.html')).toBe('<h1>Hello</h1>');
    expect(await line.fileAt(second!.id, 'index.html')).toBe('<h1>Changed</h1>');
    expect(await line.fileAt(first.id, 'never-existed.html')).toBeNull();
  });

  it('refuses to reach outside the project for a file', async () => {
    const { line, first } = await projectWithOneVersion();
    await expect(line.fileAt(first.id, '../somewhere-else.txt')).rejects.toThrow(HistoryError);
  });

  it('says plainly when asked for a version this project has never had', async () => {
    const { line } = await projectWithOneVersion();
    await expect(line.restoreTo('0123456789abcdef')).rejects.toThrow(
      historyProblems.unknownVersion,
    );
    await expect(line.restoreTo('not a version at all')).rejects.toThrow(
      historyProblems.unknownVersion,
    );
  });

  it('knows when there is work in the folder that no version holds', async () => {
    const { root, line } = await projectWithOneVersion();
    expect(await line.hasUnsavedChanges()).toBe(false);
    await put(root, 'index.html', 'half-finished');
    expect(await line.hasUnsavedChanges()).toBe(true);
  });

  it('says what last changed each file, newest wins', async () => {
    const { root, line } = await projectWithOneVersion();
    await put(root, 'src/nav.css', '.nav { gap: 8px; }');
    await line.snapshot({ instruction: 'add the nav' });
    await put(root, 'index.html', '<h1>Hello again</h1>');
    const newest = await line.snapshot({ instruction: 'change the greeting' });

    const changed = await new ProjectHistory(root).lastChangeByFile();
    expect(changed.get('index.html')?.name).toBe('Changed the greeting');
    expect(changed.get('index.html')?.id).toBe(newest!.id);
    expect(changed.get('index.html')?.when).toBeGreaterThan(0);
    // Untouched since its own version, so that is the one it still points at.
    expect(changed.get('src/nav.css')?.name).toBe('Added the nav');
    expect(changed.get('never-existed.html')).toBeUndefined();
  });

  it('reads nothing back from a project with no versions at all', async () => {
    const root = await newFolder();
    await Timeline.open(root);
    expect((await new ProjectHistory(root).lastChangeByFile()).size).toBe(0);
  });

  it('reads back a file whose name is awkward', async () => {
    const { root, line } = await projectWithOneVersion();
    await put(root, 'src/héllo wörld.css', '.a { color: red; }');
    await line.snapshot({ instruction: 'add a stylesheet' });

    const changed = await new ProjectHistory(root).lastChangeByFile();
    expect(changed.get('src/héllo wörld.css')?.name).toBe('Added a stylesheet');
  });
});

/* ========================================================================== */
/* H-03 naming a version                                                       */
/* ========================================================================== */

describe('H-03 naming a version', () => {
  it('takes the name the user chose', async () => {
    const { line, first } = await projectWithOneVersion();
    const named = await line.nameVersion(first.id, '  before I broke the nav  ');

    expect(named.title).toBe('before I broke the nav');
    expect(named.named).toBe(true);
    expect(named.id).toBe(first.id);
  });

  it('naming an old version disturbs nothing saved since', async () => {
    const { root, line, first } = await projectWithOneVersion();
    await put(root, 'index.html', 'later work');
    const second = await line.snapshot({ instruction: 'move the logo up' });

    await line.nameVersion(first.id, 'the good one');

    const all = await line.versions();
    expect(all.map((version) => version.id)).toEqual([second!.id, first.id]);
    expect(all[0]!.title).toBe('Moved the logo up');
    expect(all[1]!.title).toBe('the good one');
    expect(await get(root, 'index.html')).toBe('later work');
  });

  it('a name can be taken off again', async () => {
    const { line, first } = await projectWithOneVersion();
    await line.nameVersion(first.id, 'temporary');
    const plain = await line.nameVersion(first.id, '   ');

    expect(plain.title).toBe('Built me a simple landing page');
    expect(plain.named).toBe(false);
  });
});

/* ========================================================================== */
/* H-04 going back                                                             */
/* ========================================================================== */

describe('H-04 going back to an earlier version', () => {
  it('puts the files back the way they were', async () => {
    const { root, line, first } = await projectWithOneVersion();
    await put(root, 'index.html', '<h1>Ruined</h1>');
    await line.snapshot({ instruction: 'restyle the whole page' });

    await line.restoreTo(first.id);
    expect(await get(root, 'index.html')).toBe('<h1>Hello</h1>');
  });

  it('takes away files that arrived after that version', async () => {
    const { root, line, first } = await projectWithOneVersion();
    await put(root, 'src/components/Nav.tsx', 'export const Nav = () => null;');
    await line.snapshot({ instruction: 'add a nav' });

    await line.restoreTo(first.id);
    expect(await present(root, 'src/components/Nav.tsx')).toBe(false);
  });

  it('records going back as a version of its own, and throws nothing away', async () => {
    const { root, line, first } = await projectWithOneVersion();
    await put(root, 'index.html', '<h1>Ruined</h1>');
    const ruin = await line.snapshot({ instruction: 'restyle the whole page' });

    const back = await line.restoreTo(first.id);
    const all = await line.versions();

    expect(all.length).toBe(3);
    expect(all[0]!.id).toBe(back.version.id);
    expect(all[0]!.title).toBe('Went back to “Built me a simple landing page”');
    expect(all[0]!.wentBackTo).toBe(first.id);
    // Nothing that ever existed stopped existing.
    expect(all.map((version) => version.id)).toContain(ruin!.id);
    expect(await line.fileAt(ruin!.id, 'index.html')).toBe('<h1>Ruined</h1>');
  });

  it('going back is itself undoable', async () => {
    const { root, line, first } = await projectWithOneVersion();
    await put(root, 'index.html', '<h1>Ruined</h1>');
    await line.snapshot({ instruction: 'restyle the whole page' });

    const back = await line.restoreTo(first.id);
    expect(await get(root, 'index.html')).toBe('<h1>Hello</h1>');

    await line.restoreTo(back.undoTo);
    expect(await get(root, 'index.html')).toBe('<h1>Ruined</h1>');
  });

  it('and undoing the undo works too, as many times as anyone likes', async () => {
    const { root, line, first } = await projectWithOneVersion();
    await put(root, 'index.html', '<h1>Ruined</h1>');
    await line.snapshot({ instruction: 'restyle the whole page' });

    const back = await line.restoreTo(first.id);
    const undone = await line.restoreTo(back.undoTo);
    expect(await get(root, 'index.html')).toBe('<h1>Ruined</h1>');

    await line.restoreTo(undone.undoTo);
    expect(await get(root, 'index.html')).toBe('<h1>Hello</h1>');
    expect((await line.versions()).length).toBe(5);
  });

  it('going back to the version you are already on is harmless', async () => {
    const { root, line, first } = await projectWithOneVersion();
    const back = await line.restoreTo(first.id);

    expect(await get(root, 'index.html')).toBe('<h1>Hello</h1>');
    expect(back.savedFirst).toBeNull();
    expect((await line.versions()).length).toBe(2);
  });

  it('names the version it went back to, so the timeline reads as a story', async () => {
    const { root, line, first } = await projectWithOneVersion();
    await line.nameVersion(first.id, 'before I broke the nav');
    await put(root, 'index.html', 'broken');
    await line.snapshot();

    const back = await line.restoreTo(first.id);
    expect(back.wentBackTo.title).toBe('before I broke the nav');
    expect(back.version.title).toBe('Went back to “before I broke the nav”');
  });
});

/* ========================================================================== */
/* H-05 unfinished work is never lost                                          */
/* ========================================================================== */

describe('H-05 unfinished work, on the way back', () => {
  it('saves half-finished edits before going back, without asking', async () => {
    const { root, line, first } = await projectWithOneVersion();
    await put(root, 'index.html', '<h1>Ruined</h1>');
    await line.snapshot({ instruction: 'restyle the whole page' });
    await put(root, 'index.html', '<h1>Half-finished thought</h1>');

    const back = await line.restoreTo(first.id);

    expect(back.savedFirst).not.toBeNull();
    expect(await line.fileAt(back.savedFirst!.id, 'index.html')).toBe(
      '<h1>Half-finished thought</h1>',
    );
    expect(await get(root, 'index.html')).toBe('<h1>Hello</h1>');
  });

  it('and the rescued work is one undo away', async () => {
    const { root, line, first } = await projectWithOneVersion();
    await put(root, 'index.html', '<h1>Half-finished thought</h1>');

    const back = await line.restoreTo(first.id);
    expect(back.undoTo).toBe(back.savedFirst!.id);

    await line.restoreTo(back.undoTo);
    expect(await get(root, 'index.html')).toBe('<h1>Half-finished thought</h1>');
  });

  it('rescues files that had never been saved at all', async () => {
    const { root, line, first } = await projectWithOneVersion();
    await put(root, 'sketches/idea one.txt', 'a thought I had');
    await put(root, 'sketches/nested/idea two.txt', 'another one');

    const back = await line.restoreTo(first.id);

    // Gone from the folder, because the older version never had them...
    expect(await present(root, 'sketches/idea one.txt')).toBe(false);
    // ...but held safely in the version taken on the way past.
    expect(await line.fileAt(back.savedFirst!.id, 'sketches/idea one.txt')).toBe('a thought I had');
    expect(await line.fileAt(back.savedFirst!.id, 'sketches/nested/idea two.txt')).toBe(
      'another one',
    );

    // And one undo brings them back to the folder.
    await line.restoreTo(back.undoTo);
    expect(await get(root, 'sketches/idea one.txt')).toBe('a thought I had');
    expect(await get(root, 'sketches/nested/idea two.txt')).toBe('another one');
  });

  it('the rescue is not dressed up as a save point the user made', async () => {
    const { root, line, first } = await projectWithOneVersion();
    await put(root, 'index.html', 'unfinished');
    const back = await line.restoreTo(first.id);

    expect(back.savedFirst!.title).toBe(titles.rescueTitle);
    expect(back.savedFirst!.named).toBe(false);
    expect(back.savedFirst!.boundary).toBe('before-going-back');
  });

  it('does nothing extra when there was nothing unfinished', async () => {
    const { root, line, first } = await projectWithOneVersion();
    await put(root, 'index.html', 'later');
    await line.snapshot();

    const back = await line.restoreTo(first.id);
    expect(back.savedFirst).toBeNull();
    expect(back.undoTo).not.toBe(first.id);
  });

  it('the storage layer refuses outright to go back over unsaved work', async () => {
    const { root, first } = await projectWithOneVersion();
    const folder = new ProjectHistory(root);
    await put(root, 'index.html', 'unfinished');

    await expect(folder.restoreTo(first.id, 'Went back')).rejects.toThrow(HistoryError);
    await expect(folder.restoreTo(first.id, 'Went back')).rejects.toThrow(
      historyProblems.unsavedFirst,
    );
    // And it really did leave the folder alone.
    expect(await get(root, 'index.html')).toBe('unfinished');
  });
});

/* ========================================================================== */
/* H-06 filenames people actually use                                          */
/* ========================================================================== */

describe('H-06 awkward filenames', () => {
  const AWKWARD = 'Final Copy (v2) — café ☕ 파일.css';

  it('saves, reads back and restores a file with spaces, punctuation and unicode', async () => {
    const root = await newFolder();
    const line = await Timeline.open(root);
    await put(root, AWKWARD, '.brand { color: #16f; }');
    const first = await line.snapshot({ instruction: 'add the brand colour' });

    expect(await line.fileAt(first!.id, AWKWARD)).toBe('.brand { color: #16f; }');

    await put(root, AWKWARD, '.brand { color: red; }');
    await line.snapshot();
    await line.restoreTo(first!.id);

    expect(await get(root, AWKWARD)).toBe('.brand { color: #16f; }');
  });

  it('reports such a file by its real name, unmangled', async () => {
    const root = await newFolder();
    const line = await Timeline.open(root, { neverSave: false });
    await put(root, path.join('my sketches', AWKWARD), 'x');

    const folder = new ProjectHistory(root, { neverSave: false });
    const unsaved = (await folder.unsavedChanges()).map((change) => change.path.normalize('NFC'));
    expect(unsaved).toEqual([`my sketches/${AWKWARD}`.normalize('NFC')]);

    const saved = await line.snapshot();
    expect(saved?.title).toBe('Added the styling');
  });
});

/* ========================================================================== */
/* H-07 a project that already has a past                                      */
/* ========================================================================== */

describe('H-07 a project that already has history', () => {
  async function projectWithAPast(): Promise<string> {
    const root = await newFolder();
    await storage(root, ['init', '--quiet', '-b', 'main']);
    await put(root, 'index.html', '<h1>Made by hand</h1>');
    await storage(root, ['add', '-A']);
    await storage(root, ['commit', '--quiet', '-m', 'first pass at the homepage']);
    return root;
  }

  it('adopts what is already there without disturbing it', async () => {
    const root = await projectWithAPast();
    const before = await storage(root, ['rev-parse', 'HEAD']);

    const line = await Timeline.open(root);
    const all = await line.versions();

    expect(all.length).toBe(1);
    expect(all[0]!.title).toBe('first pass at the homepage');
    expect(await storage(root, ['rev-parse', 'HEAD'])).toBe(before);
    expect(await present(root, '.gitignore')).toBe(false);
  });

  it('treats work done before we arrived as the user’s own, deliberate work', async () => {
    const root = await projectWithAPast();
    const line = await Timeline.open(root);
    const [existing] = await line.versions();

    expect(existing!.by).toBe('you');
    expect(existing!.named).toBe(true);
    expect(existing!.boundary).toBeNull();
  });

  it('saves on top of it, and can still go back past our arrival', async () => {
    const root = await projectWithAPast();
    const line = await Timeline.open(root);
    const [existing] = await line.versions();

    await put(root, 'index.html', '<h1>Made by us</h1>');
    await line.snapshot({ instruction: 'make the greeting friendlier' });
    expect((await line.versions()).length).toBe(2);

    await line.restoreTo(existing!.id);
    expect(await get(root, 'index.html')).toBe('<h1>Made by hand</h1>');
    expect((await line.versions()).length).toBe(3);
  });
});

/* ========================================================================== */
/* H-08 it works on somebody else's machine                                    */
/* ========================================================================== */

describe('H-08 identity and configuration', () => {
  it('attributes automatic saves to Graphe, never to the user', async () => {
    const { root } = await projectWithOneVersion();
    const who = (await storage(root, ['log', '-1', '--format=%an%x09%ae%x09%cn%x09%ce'])).trim();

    expect(who).toBe(
      [
        repo.AUTOMATIC_IDENTITY.name,
        repo.AUTOMATIC_IDENTITY.email,
        repo.AUTOMATIC_IDENTITY.name,
        repo.AUTOMATIC_IDENTITY.email,
      ].join('\t'),
    );
    expect(repo.AUTOMATIC_IDENTITY.email).toBe('noreply@graphe.local');
  });

  it('a commit somebody pressed carries their own name, not ours', async () => {
    const root = await newFolder();
    await writeFile(path.join(root, 'index.html'), '<h1>one</h1>');
    const line = await Timeline.open(root);
    // The identity git would use for this folder if we left it alone.
    await storage(root, ['config', 'user.name', 'A Developer']);
    await storage(root, ['config', 'user.email', 'dev@example.test']);

    await line.snapshot({ by: 'graphe' });
    const automatic = (await storage(root, ['log', '-1', '--format=%an%x09%ae'])).trim();
    expect(automatic).toBe([repo.AUTOMATIC_IDENTITY.name, repo.AUTOMATIC_IDENTITY.email].join('\t'));

    await writeFile(path.join(root, 'index.html'), '<h1>two</h1>');
    await line.snapshot({ by: 'you' });
    const pressed = (await storage(root, ['log', '-1', '--format=%an%x09%ae%x09%cn%x09%ce'])).trim();
    expect(pressed).toBe(['A Developer', 'dev@example.test', 'A Developer', 'dev@example.test'].join('\t'));
  });

  it('a host may say who its saves belong to', async () => {
    const root = await newFolder();
    const line = await Timeline.open(root, {
      identity: { name: 'Studio', email: 'studio@example.test' },
    });
    await put(root, 'index.html', 'x');
    await line.snapshot();

    expect((await storage(root, ['log', '-1', '--format=%ae'])).trim()).toBe('studio@example.test');
  });

  it('cannot be blocked by settings the project itself carries', async () => {
    const { root, line } = await projectWithOneVersion();
    // Three ways a real machine breaks automatic saving: a signing requirement
    // with no key, no identity at all, and a check that always says no.
    await storage(root, ['config', 'commit.gpgsign', 'true']);
    await storage(root, ['config', 'user.email', '']);
    await put(root, '.git/hooks/pre-commit', '#!/bin/sh\nexit 1\n');
    await chmod(path.join(root, '.git/hooks/pre-commit'), 0o755);

    await put(root, 'index.html', 'changed anyway');
    const saved = await line.snapshot({ instruction: 'tighten the spacing' });

    expect(saved?.title).toBe('Tightened the spacing');
    expect(await line.fileAt(saved!.id, 'index.html')).toBe('changed anyway');
  });

  it('keeps the raw failure for the disclosure, and out of the sentence', async () => {
    const root = await newFolder();
    const folder = new ProjectHistory(root, { toolPath: path.join(root, 'no-such-tool') });

    const failure = await folder.prepare().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(HistoryError);
    expect((failure as HistoryError).message).toBe(historyProblems.toolMissing);
    expect((failure as HistoryError).details.length).toBeGreaterThan(0);
  });

  it('says so plainly when a folder is not keeping history yet', async () => {
    const root = await newFolder();
    const folder = new ProjectHistory(root);
    await expect(folder.versions()).rejects.toThrow(historyProblems.notSetUp);
  });
});

/* ========================================================================== */
/* H-09 the language audit                                                     */
/* ========================================================================== */

describe('H-09 the layer below the operation is never spoken', () => {
  /** What stays out of a sentence, and what no longer does.
   *
   *  This list used to hold `commit`, `branch`, `merge` and the rest of git's
   *  operation names, from a time when the audience was designers. CLAUDE.md
   *  now says the opposite in as many words — "Name the operation. `branch`,
   *  `commit`, `pull request`, `changelog` are what the thing is, and a button
   *  that talks around them makes a developer translate before they can act."
   *  The panel has said BRANCH and Commit to people for two releases.
   *
   *  What the same rule still refuses is the layer underneath: "the plumbing
   *  nobody pressed a button to reach". Those are below, and a sentence that
   *  reaches for one is still a sentence explaining a mechanism nobody asked
   *  about. Word boundaries throughout, so "header" is never mistaken for the
   *  thing git calls HEAD. */
  const RETIRED: { name: string; pattern: RegExp }[] = [
    { name: 'HEAD', pattern: /\bhead\b/i },
    { name: 'a raw identifier', pattern: /\bsha\b|\bhunk\b|\breflog\b|\bworktree\b|\brefspec\b|\bblob\b/i },
    { name: 'staging', pattern: /\bstag(e|es|ed|ing)\b/i },
    { name: 'the index', pattern: /\bgit index\b/i },
    { name: 'plumbing output', pattern: /\bstderr\b|\bstdout\b|\bexit code\b/i },
  ];

  /** Every string these modules can put in front of somebody. */
  function everySpokenString(): string[] {
    const found: string[] = [];
    const seen = new Set<unknown>();
    const walk = (value: unknown): void => {
      if (typeof value === 'string') {
        found.push(value);
        return;
      }
      if (!value || typeof value !== 'object' || seen.has(value)) return;
      seen.add(value);
      for (const child of Object.values(value)) walk(child);
    };
    walk(repo.historyProblems);
    walk(titles.boundaryTitles);
    walk(titles.rescueTitle);
    found.push(...titles.auditableTitles());
    return found;
  }

  /** Every name a caller of these modules has to type. */
  function everyPublicName(): string[] {
    return [
      ...Object.keys(repo),
      ...Object.keys(titles),
      ...Object.keys(timeline),
      ...Object.getOwnPropertyNames(ProjectHistory.prototype),
      ...Object.getOwnPropertyNames(Timeline.prototype),
    ];
  }

  it('sweeps a meaningful number of strings', () => {
    // A sweep that silently found nothing would pass every assertion below.
    expect(everySpokenString().length).toBeGreaterThan(80);
    expect(everySpokenString()).toContain(titles.rescueTitle);
    expect(everySpokenString()).toContain(historyProblems.unsavedFirst);
  });

  it('would notice a violation if one were written', () => {
    const violations = [
      'You are in detached HEAD state',
      'Reset the sha to a1b2c3d',
      'Applied the hunk to the index',
      'Read it out of the reflog',
      'Staged your work first',
      'The worktree is dirty',
      'git exited with exit code 128',
      'Wrote the blob and updated the refspec',
    ];
    for (const text of violations) {
      expect(RETIRED.some(({ pattern }) => pattern.test(text)), text).toBe(true);
    }
  });

  /** And the operations themselves are now allowed to be called what they are,
   *  which is the whole of the change. */
  it('lets a sentence name the operation', () => {
    const named = [
      'I couldn’t fast-forward this branch, so I’ve left it as it was.',
      'Nothing to commit.',
      'Opened a pull request.',
      'This repository has no origin.',
    ];
    for (const text of named) {
      expect(RETIRED.some(({ pattern }) => pattern.test(text)), text).toBe(false);
    }
  });

  it('no string these modules produce contains the retired vocabulary', () => {
    const offences: string[] = [];
    for (const text of everySpokenString()) {
      for (const { name, pattern } of RETIRED) {
        if (pattern.test(text)) offences.push(`${name} → "${text}"`);
      }
    }
    expect(offences).toEqual([]);
  });

  it('no name in the public API is one of git’s', () => {
    const words = (name: string): string[] =>
      name
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .split(/[^A-Za-z]+/)
        .filter(Boolean);

    const offences: string[] = [];
    for (const name of everyPublicName()) {
      for (const word of words(name)) {
        for (const { name: retired, pattern } of RETIRED) {
          if (pattern.test(word)) offences.push(`${retired} → ${name}`);
        }
      }
    }
    expect(offences).toEqual([]);
    expect(everyPublicName()).toContain('snapshot');
    expect(everyPublicName()).toContain('versions');
    expect(everyPublicName()).toContain('restoreTo');
    expect(everyPublicName()).toContain('currentVersion');
  });

  it('nor does anything a real project produces along the way', async () => {
    const { root, line, first } = await projectWithOneVersion();
    await put(root, 'src/components/PricingCard.tsx', 'export const PricingCard = () => null;');
    await line.snapshot({ instruction: 'please could you add a pricing card' });
    await put(root, 'index.html', 'unfinished');
    await line.restoreTo(first.id);

    const spoken = (await line.versions()).map((version) => version.title);
    expect(spoken.length).toBe(4);
    for (const text of spoken) {
      for (const { pattern } of RETIRED) expect(text).not.toMatch(pattern);
    }
  });

  it('the raw output is kept, but only behind the disclosure', () => {
    const failure = new HistoryError(historyProblems.saveFailed, 'fatal: not a git repository');
    expect(failure.message).toBe(historyProblems.saveFailed);
    expect(failure.details).toContain('fatal');
    for (const { pattern } of RETIRED) expect(failure.message).not.toMatch(pattern);
  });
});

/* ========================================================================== */
/* H-10 titles a designer can read at a glance                                 */
/* ========================================================================== */

describe('H-10 titles', () => {
  it('turns what the user asked for into what happened', () => {
    expect(titles.fromInstruction('make the header sticky')).toBe('Made the header sticky');
    expect(titles.fromInstruction('add a footer')).toBe('Added a footer');
    expect(titles.fromInstruction('move the logo up a bit')).toBe('Moved the logo up a bit');
    expect(titles.fromInstruction('swap the two sections')).toBe('Swapped the two sections');
    expect(titles.fromInstruction('tidy up the spacing')).toBe('Tidied up the spacing');
    expect(titles.fromInstruction('give it more breathing room')).toBe(
      'Gave it more breathing room',
    );
  });

  it('drops the politeness and keeps the meaning', () => {
    expect(titles.fromInstruction('please make the header sticky')).toBe('Made the header sticky');
    expect(titles.fromInstruction('hey, can you add a footer')).toBe('Added a footer');
    expect(titles.fromInstruction('could you please tighten the tracking, thanks')).toBe(
      'Tightened the tracking, thanks',
    );
    expect(titles.fromInstruction("let's try the logo bigger")).toBe('Tried the logo bigger');
  });

  it('leaves a sentence alone when it does not start with something it did', () => {
    expect(titles.fromInstruction('the header should be sticky')).toBe(
      'The header should be sticky',
    );
  });

  it('keeps only the first sentence, and keeps it short', () => {
    expect(titles.fromInstruction('add a footer. then make it blue.')).toBe('Added a footer');

    const long = titles.fromInstruction(
      'add a footer with the social links and the address and the opening hours and a small map of where we are',
    );
    expect(long!.length).toBeLessThanOrEqual(72);
    expect(long!.endsWith('…')).toBe(true);
  });

  it('will not title a version with a question', () => {
    expect(titles.fromInstruction('why is the nav broken?')).toBeNull();
    expect(titles.fromInstruction('   ')).toBeNull();
    expect(titles.titleFor({ instruction: 'why is the nav broken?', files: ['styles/site.css'] })).toBe(
      'Updated the styling',
    );
  });

  it('will not repeat retired vocabulary back at the user', () => {
    expect(titles.fromInstruction('commit this')).toBeNull();
    expect(titles.fromInstruction('merge the two versions')).toBeNull();
    expect(titles.titleFor({ instruction: 'push this live', files: ['index.html'] })).toBe(
      'Updated the home page',
    );
  });

  it('names what changed the way a designer would name it', () => {
    const say = (files: string[]): string | null => titles.describeFiles(files);

    expect(say(['index.html'])).toBe('Updated the home page');
    expect(say(['src/app/pricing/page.tsx'])).toBe('Updated the pricing page');
    expect(say(['src/pages/about-us.tsx'])).toBe('Updated the about us page');
    expect(say(['src/components/PricingCard.tsx'])).toBe('Updated the PricingCard component');
    expect(say(['src/components/Button/index.tsx'])).toBe('Updated the Button component');
    expect(say(['src/styles/tokens.css'])).toBe('Updated the styling');
    expect(say(['public/hero.png'])).toBe('Updated the images');
    expect(say(['public/fonts/Inter.woff2'])).toBe('Updated the fonts');
    expect(say(['README.md'])).toBe('Updated the writing');
    expect(say(['package.json', 'package-lock.json'])).toBe('Updated the project setup');
    expect(say([])).toBeNull();
  });

  it('says whether things arrived or went away', () => {
    expect(titles.describeFiles([{ path: 'src/styles/site.css', kind: 'added' }])).toBe(
      'Added the styling',
    );
    expect(titles.describeFiles([{ path: 'public/old-hero.png', kind: 'removed' }])).toBe(
      'Removed the images',
    );
    expect(
      titles.describeFiles([
        { path: 'public/a.png', kind: 'added' },
        { path: 'public/b.png', kind: 'removed' },
      ]),
    ).toBe('Updated the images');
  });

  it('stops listing before the list stops being readable', () => {
    expect(titles.describeFiles(['index.html', 'src/styles/site.css'])).toBe(
      'Updated the home page and the styling',
    );
    expect(
      titles.describeFiles([
        'index.html',
        'src/styles/site.css',
        'public/hero.png',
        'README.md',
        'package.json',
      ]),
    ).toBe('Updated the home page, the styling and a few other things');
  });

  it('never puts a file path or an extension in front of anyone', () => {
    const everyTitle = titles.auditableTitles();
    for (const title of everyTitle) {
      expect(title).not.toContain('/');
      expect(title).not.toContain('\\');
      expect(title).not.toMatch(/\.(tsx?|jsx?|css|scss|html|json|md|png|svg|woff2?)\b/i);
    }
    expect(everyTitle.length).toBeGreaterThan(80);
  });

  it('falls back to the moment when there is nothing else to say', () => {
    expect(titles.titleFor({ boundary: 'preview-green' })).toBe(titles.boundaryTitles['preview-green']);
    expect(titles.titleFor({})).toBe(titles.boundaryTitles['turn-ended']);
    expect(titles.goingBackTitle('')).toBe('Went back to an earlier version');
  });

  it('tidies a name the user typed without arguing with it', () => {
    expect(titles.tidyName('  before I broke the nav \n')).toBe('before I broke the nav');
    expect(titles.tidyName('   ')).toBeNull();
    expect(titles.tidyName('x'.repeat(200))!.length).toBeLessThanOrEqual(72);
  });
});
