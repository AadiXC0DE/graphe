/** Handing work to a developer, against real storage and a real computer.
 *
 * What matters here is what happens on the *ordinary* machine: one that has no
 * shared copy of this project, and may or may not have the helper installed.
 * Every one of those paths has to end in a sentence and a piece of work waiting
 * in the person's own folder — never an exception, and never a half-sent
 * anything.
 *
 * Nothing in this file can send anything anywhere: a folder made in the
 * temporary directory has nowhere shared to send to, which is exactly the case
 * being tested.
 */

import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

import { ProjectHistory } from '../src/history/repo';
import { HandoverError, handToDeveloper, whatIsHere, type Change } from '../src/share/developer';
import { handoverWords } from '../src/share/handover';
import { whatIsHereForOnline } from '../src/share/publish';
import { notHere, runHelper } from '../src/share/run';
import { canSendItOn } from '../src/share/tools';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const made: string[] = [];

afterAll(async () => {
  await Promise.all(made.map((folder) => rm(folder, { recursive: true, force: true })));
});

async function newFolder(): Promise<string> {
  const folder = await realpath(await mkdtemp(path.join(tmpdir(), 'graphe-hand-')));
  made.push(folder);
  return folder;
}

/** The smallest thing that is really a picture. */
const A_PICTURE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function aProject(): Promise<{
  history: ProjectHistory;
  root: string;
  under: string;
  pictures: { before: string; after: string };
}> {
  const root = await newFolder();
  const under = await newFolder();
  const shots = await newFolder();
  const history = new ProjectHistory(root);
  await history.prepare();
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(root, 'src', 'hero.css'), '.hero { padding: 16px; }\n', 'utf8');
  await history.snapshot('First pass at the landing page');

  const before = path.join(shots, 'before.png');
  const after = path.join(shots, 'after.png');
  await writeFile(before, A_PICTURE);
  await writeFile(after, A_PICTURE);
  return { history, root, under, pictures: { before, after } };
}

function change(over: Partial<Change> = {}): Change {
  return {
    title: 'Gave the pricing cards more room',
    says: 'Spacing on three cards, from 16 to 24.',
    where: 'Two areas changed, near the top.',
    before: null,
    after: null,
    ...over,
  };
}

/* ========================================================================== */
/* HD-01 running somebody else's helper                                        */
/* ========================================================================== */

describe('HD-01 a helper that is not here is an answer, not an exception', () => {
  it('says plainly that there is nothing of that name to run', async () => {
    const folder = await newFolder();
    const ran = await runHelper('graphe-nothing-of-this-name', ['--version'], { folder });
    expect(notHere(ran)).toBe(true);
    expect(ran.code).toBe(127);
  });

  it('hands back what a helper said, either way', async () => {
    const folder = await newFolder();
    const ran = await runHelper(process.execPath, ['--version'], { folder, patience: 20_000 });
    expect(ran.code).toBe(0);
    expect(ran.said).toMatch(/^v\d+/);
  });

  it('hands back a failure as a number rather than throwing it', async () => {
    const folder = await newFolder();
    const ran = await runHelper(process.execPath, ['-e', 'process.exit(3)'], {
      folder,
      patience: 20_000,
    });
    expect(ran.code).toBe(3);
    expect(notHere(ran)).toBe(false);
  });

  /* Whatever this particular computer happens to have installed, looking has to
     produce an answer of the right shape and never an exception. */
  it('answers about this computer, whatever this computer is', async () => {
    const folder = await newFolder();
    const found = await whatIsHere(folder);
    expect(typeof found.helper).toBe('boolean');
    expect(typeof found.signedIn).toBe('boolean');
    if (!found.helper) {
      expect(found.signedIn).toBe(false);
      expect(found.home).toBeNull();
    }
    expect(canSendItOn(found).all).toBe(false);
    expect(canSendItOn(found).says.length).toBeGreaterThan(30);
  });

  it('answers the same way about putting a project online', async () => {
    const folder = await newFolder();
    const found = await whatIsHereForOnline(folder);
    expect(typeof found.helper).toBe('boolean');
    expect(typeof found.signedIn).toBe('boolean');
    if (!found.helper) expect(found.signedIn).toBe(false);
  });

  it('never sits waiting for an answer nobody can give it', async () => {
    const folder = await newFolder();
    const ran = await runHelper(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], {
      folder,
      patience: 1_500,
    });
    expect(ran.code).not.toBe(0);
  });
});

/* ========================================================================== */
/* HD-02 a project with nowhere shared to send to                              */
/* ========================================================================== */

describe('HD-02 the ordinary machine', () => {
  it('gets the work ready and says the last step is theirs', async () => {
    const { history, root, under, pictures } = await aProject();
    const handed = await handToDeveloper({
      history,
      folder: root,
      name: 'Kettle',
      under,
      title: 'Gave the pricing cards more room',
      changes: [change({ before: pictures.before, after: pictures.after })],
      at: Date.now(),
    });

    expect(handed.sent).toBe(false);
    expect(handed.address).toBeNull();
    expect(handed.says).toContain('your own folder');
    expect(handed.name).toMatch(/^(feat|fix|refactor|docs|chore)\//);
    expect(await history.lineExists(handed.name)).toBe(true);
  });

  it('leaves the folder somebody is looking at exactly as it was', async () => {
    const { history, root, under, pictures } = await aProject();
    const before = await readdir(root);
    await handToDeveloper({
      history,
      folder: root,
      name: 'Kettle',
      under,
      title: 'Something',
      changes: [change({ before: pictures.before, after: pictures.after })],
      at: Date.now(),
    });
    expect(await readdir(root)).toEqual(before);
    expect(await history.unsavedChanges()).toEqual([]);
    expect(await readFile(path.join(root, 'src', 'hero.css'), 'utf8')).toContain('16px');
  });

  it('carries the pictures and the write-up along with the work itself', async () => {
    const { history, root, under, pictures } = await aProject();
    const handed = await handToDeveloper({
      history,
      folder: root,
      name: 'Kettle',
      under,
      title: 'Something',
      changes: [change({ before: pictures.before, after: pictures.after })],
      at: Date.now(),
    });

    // Read straight out of the named work, which is where a developer finds it.
    const listed = await runHelper('git', ['-C', root, 'ls-tree', '-r', '--name-only', handed.name], {
      folder: root,
      patience: 20_000,
    });
    expect(listed.code).toBe(0);
    expect(listed.out).toContain('.graphe/what-changed/01-before.png');
    expect(listed.out).toContain('.graphe/what-changed/01-after.png');
    expect(listed.out).toContain('.graphe/what-changed/what-changed.html');
    // And the project's own files are still in it, untouched.
    expect(listed.out).toContain('src/hero.css');
  });

  it('the write-up it carries opens on its own, with the pictures inside it', async () => {
    const { history, root, under, pictures } = await aProject();
    const handed = await handToDeveloper({
      history,
      folder: root,
      name: 'Kettle',
      under,
      title: 'Something',
      changes: [change({ before: pictures.before, after: pictures.after })],
      at: Date.now(),
    });
    const shown = await runHelper(
      'git',
      ['-C', root, 'show', `${handed.name}:.graphe/what-changed/what-changed.html`],
      { folder: root, patience: 20_000 },
    );
    expect(shown.code).toBe(0);
    expect(shown.out).toContain('Spacing on three cards, from 16 to 24.');
    expect(shown.out).toContain('data:image/png;base64,');
    // Nothing on the page reaches off the machine it was written on.
    expect(shown.out).not.toMatch(/src="https?:/);
  });

  it('leaves no copy of the project lying about afterwards', async () => {
    const { history, root, under, pictures } = await aProject();
    await handToDeveloper({
      history,
      folder: root,
      name: 'Kettle',
      under,
      title: 'Something',
      changes: [change({ before: pictures.before, after: pictures.after })],
      at: Date.now(),
    });
    expect(await readdir(under)).toEqual([]);
  });

  it('works perfectly well with no pictures at all', async () => {
    const { history, root, under } = await aProject();
    const handed = await handToDeveloper({
      history,
      folder: root,
      name: 'Kettle',
      under,
      title: 'Something',
      changes: [change()],
      at: Date.now(),
    });
    expect(handed.sent).toBe(false);
    expect(await history.lineExists(handed.name)).toBe(true);
  });

  it('gives two goes at the same work two different names', async () => {
    const { history, root, under } = await aProject();
    const first = await handToDeveloper({
      history,
      folder: root,
      name: 'Kettle',
      under,
      title: 'Something',
      changes: [change()],
      at: 1_000_000_000_000,
    });
    const second = await handToDeveloper({
      history,
      folder: root,
      name: 'Kettle',
      under,
      title: 'Something',
      changes: [change()],
      at: 1_000_000_060_000,
    });
    expect(first.name).not.toBe(second.name);
    expect(await history.lineExists(first.name)).toBe(true);
    expect(await history.lineExists(second.name)).toBe(true);
  });
});

/* ========================================================================== */
/* HD-03 every way it can stop                                                 */
/* ========================================================================== */

describe('HD-03 stopping, readably', () => {
  it('says there is nothing to hand over rather than handing over nothing', async () => {
    const { history, root, under } = await aProject();
    await expect(
      handToDeveloper({
        history,
        folder: root,
        name: 'Kettle',
        under,
        title: 'Something',
        changes: [],
        at: Date.now(),
      }),
    ).rejects.toThrow(handoverWords.nothingToHandOver);
  });

  it('refuses before writing a single file when a key is in the words', async () => {
    const { history, root, under } = await aProject();
    const before = await runHelper('git', ['-C', root, 'branch', '--list'], {
      folder: root,
      patience: 20_000,
    });

    let stopped: unknown = null;
    try {
      await handToDeveloper({
        history,
        folder: root,
        name: 'Kettle',
        under,
        title: 'Something',
        changes: [change({ says: 'Wired it up with sk-lVn3Q8xTr2Ab9KdMz0PfWq7Y and it works.' })],
        at: Date.now(),
      });
    } catch (cause) {
      stopped = cause;
    }

    expect(stopped).toBeInstanceOf(HandoverError);
    expect((stopped as HandoverError).message).toMatch(/still only on your computer/);
    // Nothing was named, nothing was assembled, nothing left.
    const after = await runHelper('git', ['-C', root, 'branch', '--list'], {
      folder: root,
      patience: 20_000,
    });
    expect(after.out).toBe(before.out);
    expect(await readdir(under)).toEqual([]);
  });

  it('every sentence it can stop with is one a person could act on', () => {
    for (const sentence of [
      handoverWords.nothingToHandOver,
      handoverWords.couldNotSend,
      handoverWords.sentWithoutWriteUp,
    ]) {
      expect(sentence.length).toBeGreaterThan(30);
      expect(sentence).toMatch(/[.!]$/);
    }
  });
});
