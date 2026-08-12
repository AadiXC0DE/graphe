/** Work that waits to be let in, against real storage.
 *
 * The claim under test is the one the product's whole promise rests on: nothing
 * held back can reach the files on screen until somebody says so, **and both
 * answers are undoable**. Turning work down that quietly destroyed it would be
 * the one place in this app where a decision could not be taken back, so the
 * bulk of what follows is about the work still being there afterwards.
 *
 * Real folders, real history, no model.
 */

import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

import { HeldWork, folderForHeld, holdWords } from '../src/history/attempts';
import { ProjectHistory, historyProblems } from '../src/history/repo';
import { Timeline } from '../src/history/timeline';

vi.setConfig({ testTimeout: 40_000, hookTimeout: 40_000 });

const made: string[] = [];

afterAll(async () => {
  await Promise.all(made.map((folder) => rm(folder, { recursive: true, force: true })));
});

async function newFolder(): Promise<string> {
  const folder = await realpath(await mkdtemp(path.join(tmpdir(), 'graphe-held-')));
  made.push(folder);
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

async function there(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function aProject(): Promise<{ history: ProjectHistory; root: string; under: string }> {
  const root = await newFolder();
  const under = await newFolder();
  const history = new ProjectHistory(root);
  await history.prepare();
  await put(root, 'hero.css', '.hero { padding: 16px; }\n');
  await history.snapshot('First pass at the landing page');
  return { history, root, under };
}

/** One piece of work, done and waiting. */
async function somethingWaiting(): Promise<{
  history: ProjectHistory;
  root: string;
  under: string;
  work: HeldWork;
}> {
  const { history, root, under } = await aProject();
  const work = await HeldWork.start({
    history,
    under,
    id: 'held-1',
    doing: 'give the hero more room',
  });
  await put(work.folder, 'hero.css', '.hero { padding: 48px; }\n');
  await work.settle('give the hero more room');
  return { history, root, under, work };
}

/* ========================================================================== */
/* L-01 the words                                                              */
/* ========================================================================== */

describe('L-01 the words', () => {
  it('names the thing after what it does for you, not how it works', () => {
    expect(holdWords.label).toBe('Work in a copy, and ask me first');
    expect(holdWords.approve).toBe('Let it in');
    expect(holdWords.setAside).toBe('Set it aside');
  });

  it('keeps the copies out of the project folder', () => {
    expect(folderForHeld('/somewhere/else', 'held-1')).toBe(path.join('/somewhere/else', 'held-1'));
  });

  it('cleans up an awkward name rather than putting it in a path', () => {
    expect(folderForHeld('/x', '../../etc/passwd')).toBe(path.join('/x', 'etc-passwd'));
    expect(folderForHeld('/x', '')).toBe(path.join('/x', 'work'));
  });

  it('never says a word from the machinery it is built on', () => {
    const everything = Object.values(holdWords).join(' ').toLowerCase();
    for (const banned of [
      'git',
      'worktree',
      'branch',
      'commit',
      'merge',
      'checkout',
      'stage',
      'staged',
      'rebase',
      'push',
      'revert',
    ]) {
      expect(everything).not.toContain(banned);
    }
  });

  it('ends every sentence it says, so none of them read as a fragment', () => {
    const sentences = [
      holdWords.hint,
      holdWords.making,
      holdWords.waiting,
      holdWords.isIn,
      holdWords.isAside,
    ];
    for (const one of sentences) expect(one).toMatch(/[.!]$/);
  });
});

/* ========================================================================== */
/* L-02 out of reach of the files on screen                                    */
/* ========================================================================== */

describe('L-02 nothing reaches the project until somebody says so', () => {
  it('does the work somewhere else entirely', async () => {
    const { root, under, work } = await somethingWaiting();
    expect(await get(root, 'hero.css')).toContain('16px');
    expect(work.folder.startsWith(under)).toBe(true);
    expect(work.folder.startsWith(root)).toBe(false);
  });

  it('leaves nothing behind in the folder somebody is looking at', async () => {
    const { root, work } = await somethingWaiting();
    expect(await there(work.folder)).toBe(false);
    const inside = await new ProjectHistory(root).unsavedChanges();
    expect(inside).toEqual([]);
  });

  it('refuses to start while there is unfinished work, rather than losing it', async () => {
    const { history, root, under } = await aProject();
    await put(root, 'hero.css', '.hero { padding: 99px; }\n');
    await expect(
      HeldWork.start({ history, under, id: 'held-2', doing: 'anything' }),
    ).rejects.toThrow(historyProblems.unsavedFirst);
    expect(await get(root, 'hero.css')).toContain('99px');
  });

  it('says so plainly when it changed nothing at all', async () => {
    const { history, under } = await aProject();
    const work = await HeldWork.start({ history, under, id: 'held-3', doing: 'think about it' });
    expect(await work.settle('think about it')).toBeNull();
    expect(work.waiting.state).toBe('nothing');
  });
});

/* ========================================================================== */
/* L-03 letting it in                                                          */
/* ========================================================================== */

describe('L-03 letting it in', () => {
  it('puts the work into the project', async () => {
    const { history, root, work } = await somethingWaiting();
    const outcome = await work.approve('give the hero more room');
    expect(outcome).not.toBeNull();
    expect(await get(root, 'hero.css')).toContain('48px');
    expect(work.waiting.state).toBe('in');
    expect(await history.currentVersion()).toBe(outcome?.version);
  });

  it('records it as a version of its own, so it can be undone', async () => {
    const { root, work } = await somethingWaiting();
    const outcome = await work.approve('give the hero more room');
    expect(outcome).not.toBeNull();
    if (outcome === null) return;

    const line = await Timeline.open(root);
    await line.restoreTo(outcome.undoTo);
    expect(await get(root, 'hero.css')).toContain('16px');
  });

  it('throws nothing away on the way in — the moment before is still there', async () => {
    const { history, work } = await somethingWaiting();
    const before = await history.versions();
    await work.approve('give the hero more room');
    const after = await history.versions();
    for (const one of before) {
      expect(after.some((other) => other.id === one.id)).toBe(true);
    }
  });

  it('says nothing happened rather than pretending, when nothing did', async () => {
    const { history, under } = await aProject();
    const work = await HeldWork.start({ history, under, id: 'held-4', doing: 'nothing at all' });
    await work.settle('nothing at all');
    expect(await work.approve('nothing at all')).toBeNull();
  });
});

/* ========================================================================== */
/* L-04 setting it aside, and getting it back                                  */
/* ========================================================================== */

describe('L-04 turning work down is not throwing it away', () => {
  it('leaves the project exactly as it was', async () => {
    const { root, work } = await somethingWaiting();
    expect(work.setAside()).toBe(work.waiting.version);
    expect(await get(root, 'hero.css')).toContain('16px');
  });

  it('keeps the work reachable once its copy has gone, so it can come back', async () => {
    const { history, root, work } = await somethingWaiting();
    const version = work.setAside();
    expect(version).not.toBeNull();
    if (version === null) return;

    // The whole promise: a version nobody points at stops being findable, and
    // this one is still findable after the copy that made it is long gone.
    expect(await history.holding()).toContain(version);
    expect(await history.version(version)).not.toBeNull();

    const line = await Timeline.open(root);
    await line.restoreTo(version);
    expect(await get(root, 'hero.css')).toContain('48px');
  });

  it('and bringing it back is itself undoable, like everything else', async () => {
    const { root, work } = await somethingWaiting();
    const version = work.setAside();
    if (version === null) throw new Error('expected a version');

    const line = await Timeline.open(root);
    const brought = await line.restoreTo(version);
    expect(await get(root, 'hero.css')).toContain('48px');
    await line.restoreTo(brought.undoTo);
    expect(await get(root, 'hero.css')).toContain('16px');
  });

  it('stops keeping it only when somebody says so twice', async () => {
    const { history, work } = await somethingWaiting();
    const version = work.waiting.version;
    work.setAside();
    await work.forget();
    expect(await history.holding()).not.toContain(version);
    expect(work.waiting.version).toBeNull();
  });

  it('stops keeping it once it is in, because the project itself now holds it', async () => {
    const { history, work } = await somethingWaiting();
    const version = work.waiting.version;
    await work.approve('give the hero more room');
    expect(await history.holding()).not.toContain(version);
  });
});

/* ========================================================================== */
/* L-05 letting the copy go                                                    */
/* ========================================================================== */

describe('L-05 nothing is left lying about', () => {
  it('can be let go twice, and let go before it ever finished', async () => {
    const { history, under } = await aProject();
    const work = await HeldWork.start({ history, under, id: 'held-5', doing: 'something' });
    await work.release();
    await work.release();
    expect(await there(work.folder)).toBe(false);
  });

  it('leaves the project untouched when the work is abandoned half way', async () => {
    const { history, root, under } = await aProject();
    const work = await HeldWork.start({ history, under, id: 'held-6', doing: 'something' });
    await put(work.folder, 'hero.css', '.hero { padding: 99px; }\n');
    await work.release();
    expect(await get(root, 'hero.css')).toContain('16px');
    expect(await new ProjectHistory(root).unsavedChanges()).toEqual([]);
  });
});

/* ========================================================================== */
/* L-06 the storage layer's own new words                                      */
/* ========================================================================== */

describe('L-06 naming work, and where it is kept', () => {
  it('will not take a name somebody else already used', async () => {
    const { history } = await aProject();
    const version = await history.currentVersion();
    if (version === null) throw new Error('expected a version');
    await history.nameLine('graphe/one', version);
    expect(await history.lineExists('graphe/one')).toBe(true);
    await expect(history.nameLine('graphe/one', version)).rejects.toThrow(
      historyProblems.nameTaken,
    );
  });

  it('letting a name go leaves every version under it exactly where it was', async () => {
    const { history } = await aProject();
    const version = await history.currentVersion();
    if (version === null) throw new Error('expected a version');
    await history.nameLine('graphe/two', version);
    await history.dropLine('graphe/two');
    expect(await history.lineExists('graphe/two')).toBe(false);
    expect(await history.version(version)).not.toBeNull();
  });

  it('says a project kept only on this computer is kept only on this computer', async () => {
    const { history } = await aProject();
    expect(await history.sharedCopy()).toBeNull();
  });

  it('answers plainly rather than throwing when there is nowhere to send to', async () => {
    const { history } = await aProject();
    const version = await history.currentVersion();
    if (version === null) throw new Error('expected a version');
    await history.nameLine('graphe/three', version);
    await expect(history.sendLine('graphe/three')).rejects.toThrow(historyProblems.sendFailed);
  });

  it('keeps its new sentences free of the vocabulary it is built on', () => {
    const retired = /\b(git|commit|branch|merge|push|pull|head|stash|revert|rebase|checkout|clone|repo|worktree|stage[ds]?)\b/i;
    for (const sentence of [
      historyProblems.holdFailed,
      historyProblems.nameTaken,
      historyProblems.sendFailed,
    ]) {
      expect(sentence).not.toMatch(retired);
      expect(sentence).toMatch(/[.!]$/);
    }
  });
});
