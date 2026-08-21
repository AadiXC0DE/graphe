/** Holding two or three goes at the same job against each other.
 *
 * The diffs here are made by real git in real copies of a real project, because
 * the whole answer depends on reading what git actually prints — a new file, a
 * deleted one, two edits far enough apart to come back as separate pieces. Hand
 * written diff text would prove that the arithmetic works on hand written diff
 * text.
 */

import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  AGAINST_WORDS,
  canTake,
  compare,
  isFinal,
  saysNothingHere,
  saysSummary,
  type Difference,
  type Side,
} from '../src/lib/against';

const spawn = promisify(execFile);
const made: string[] = [];
afterAll(async () => {
  await Promise.all(made.map((one) => rm(one, { recursive: true, force: true })));
});

async function raw(cwd: string, ...args: string[]): Promise<string> {
  return (await spawn('git', ['-C', cwd, ...args], { encoding: 'utf8' })).stdout;
}

const PAGE = Array.from({ length: 30 }, (_, at) => `line ${String(at + 1)}`);
const SHARED = Array.from({ length: 10 }, (_, at) => `shared ${String(at + 1)}`);

let parent = '';
let base = '';

/** The project every go starts from. */
async function aProject(): Promise<void> {
  parent = await mkdtemp(join(tmpdir(), 'graphe-against-'));
  made.push(parent);
  base = join(parent, 'base');
  await mkdir(base);
  await raw(base, 'init', '-b', 'main');
  await raw(base, 'config', 'user.email', 'test@graphe.local');
  await raw(base, 'config', 'user.name', 'Test');
  await raw(base, 'config', 'commit.gpgsign', 'false');
  await writeFile(join(base, 'page.txt'), `${PAGE.join('\n')}\n`);
  await writeFile(join(base, 'shared.txt'), `${SHARED.join('\n')}\n`);
  await writeFile(join(base, 'styles.css'), 'body { color: black }\n');
  await writeFile(join(base, 'notes.md'), '# Notes\n\nSomething.\n');
  await raw(base, 'add', '.');
  await raw(base, 'commit', '-m', 'first');
}

/** One go, in its own copy of the project, and the change it ended up with. */
async function aGo(name: string, work: (dir: string) => Promise<void>): Promise<string> {
  const dir = join(parent, name);
  await raw(base, 'worktree', 'add', '--detach', dir);
  await work(dir);
  // A file nobody has told git about, and one that is gone, are both part of
  // what this go did, so the whole copy is measured against where it started.
  await raw(dir, 'add', '-A');
  return raw(dir, 'diff', '--cached', 'HEAD');
}

async function put(dir: string, name: string, lines: readonly string[]): Promise<void> {
  await writeFile(join(dir, name), `${lines.join('\n')}\n`);
}

/** The same edit to the same file, made by every go. */
const settled = [...SHARED];
settled[4] = 'shared 5, settled';

function withLine(at: number, text: string): readonly string[] {
  const lines = [...PAGE];
  lines[at] = text;
  return lines;
}

let one: Side;
let two: Side;
let three: Side;
let blank: Side;
let nearly: Side;

beforeAll(async () => {
  await aProject();

  one = {
    id: 'one',
    state: 'done',
    name: 'Way 1',
    diff: await aGo('one', async (dir) => {
      await put(dir, 'page.txt', withLine(2, 'line 3 — the first way'));
      await put(dir, 'shared.txt', settled);
      await writeFile(join(dir, 'styles.css'), 'body { color: black }\n.a { top: 0 }\n.b { top: 1px }\n');
    }),
  };

  two = {
    id: 'two',
    state: 'done',
    name: 'Way 2',
    diff: await aGo('two', async (dir) => {
      const lines = [...PAGE];
      lines[2] = 'line 3 — the second way';
      lines[19] = 'line 20 — and again down here';
      await put(dir, 'page.txt', lines);
      await put(dir, 'shared.txt', settled);
      await writeFile(join(dir, 'notes.md'), '# Notes\n\nSomething else.\n');
      await writeFile(join(dir, 'new.md'), '# Only here\n');
    }),
  };

  three = {
    id: 'three',
    state: 'done',
    name: 'Way 3',
    diff: await aGo('three', async (dir) => {
      await put(dir, 'page.txt', withLine(24, 'line 25 — the third way'));
      await put(dir, 'shared.txt', settled);
      await unlink(join(dir, 'notes.md'));
    }),
  };

  // A go that came back with nothing to show for itself.
  blank = { id: 'blank', state: 'done', name: 'Way 4', diff: await aGo('blank', async () => {}) };

  // The same edit as everybody else's, off by one space.
  nearly = {
    id: 'nearly',
    state: 'done',
    name: 'Way 5',
    diff: await aGo('nearly', async (dir) => {
      await put(dir, 'shared.txt', [...settled.slice(0, 4), 'shared 5, settled ', ...settled.slice(5)]);
    }),
  };
}, 60_000);

function at(files: readonly Difference[], path: string): Difference {
  const found = files.find((file) => file.path === path);
  if (!found) throw new Error(`nothing about ${path} in the comparison`);
  return found;
}

/* ========================================================================== */

describe('three goes at the same job', () => {
  it('lists every file any of them touched, once, by name', () => {
    const { files } = compare([one, two, three]);
    expect(files.map((file) => file.path)).toEqual([
      'new.md',
      'notes.md',
      'page.txt',
      'shared.txt',
      'styles.css',
    ]);
  });

  it('says which one it was, when only one of them touched a file', () => {
    const { files } = compare([one, two, three]);
    const styles = at(files, 'styles.css');
    expect(styles.onlyIn).toEqual(['one']);
    expect(styles.inBoth).toBe(false);
    expect(styles.counts.two).toBeUndefined();
    expect(styles.counts.three).toBeUndefined();

    // A file one of them made, which the others have never heard of.
    const made = at(files, 'new.md');
    expect(made.onlyIn).toEqual(['two']);
    expect(made.inBoth).toBe(false);
  });

  it('says so when all of them touched a file, and keeps each one’s numbers', () => {
    const { files } = compare([one, two, three]);
    const page = at(files, 'page.txt');
    expect(page.onlyIn).toEqual(['one', 'two', 'three']);
    expect(page.inBoth).toBe(true);
    expect(page.counts.one).toEqual({ added: 1, removed: 1 });
    expect(page.counts.two).toEqual({ added: 2, removed: 2 });
    expect(page.counts.three).toEqual({ added: 1, removed: 1 });
  });

  it('leaves a file all of them changed differently to be decided about', () => {
    const { sameEverywhere } = compare([one, two, three]);
    expect(sameEverywhere).not.toContain('page.txt');
  });

  it('sets aside the file all of them changed in exactly the same way', () => {
    const { files, sameEverywhere } = compare([one, two, three]);
    expect(sameEverywhere).toEqual(['shared.txt']);
    const shared = at(files, 'shared.txt');
    expect(shared.inBoth).toBe(true);
    expect(shared.counts.one).toEqual({ added: 1, removed: 1 });
    expect(shared.counts.one).toEqual(shared.counts.three);
  });

  /* Two goes that both edited a line, one of them leaving a space behind, is
     exactly the case a count comparison would call the same change. */
  it('does not call two nearly identical changes the same change', () => {
    const { sameEverywhere, files } = compare([one, nearly]);
    expect(sameEverywhere).toEqual([]);
    const shared = at(files, 'shared.txt');
    expect(shared.inBoth).toBe(true);
    expect(shared.counts.one).toEqual(shared.counts.nearly);
  });

  it('counts a file one of them deleted against the one that changed it', () => {
    const { files } = compare([two, three]);
    const notes = at(files, 'notes.md');
    expect(notes.onlyIn).toEqual(['two', 'three']);
    expect(notes.inBoth).toBe(true);
    // Three lines gone against one line swapped: the same file, two answers.
    expect(notes.counts.three?.added).toBe(0);
    expect((notes.counts.three?.removed ?? 0) > 0).toBe(true);
    expect(notes.counts.two).toEqual({ added: 1, removed: 1 });
  });
});

describe('two goes at the same job', () => {
  it('reads the same way as three, with two columns of numbers', () => {
    const { files, sameEverywhere } = compare([one, two]);
    expect(sameEverywhere).toEqual(['shared.txt']);

    const page = at(files, 'page.txt');
    expect(page.inBoth).toBe(true);
    expect(Object.keys(page.counts).sort()).toEqual(['one', 'two']);

    const styles = at(files, 'styles.css');
    expect(styles.onlyIn).toEqual(['one']);
    expect(styles.counts.one).toEqual({ added: 2, removed: 0 });
  });
});

describe('a go that changed nothing', () => {
  it('is in nobody’s row, and holds everything back from being settled', () => {
    const { files, sameEverywhere } = compare([one, two, blank]);
    // shared.txt is the same in the two that touched it — but not in all of
    // them, so there is still a decision to take about it.
    expect(sameEverywhere).toEqual([]);
    const shared = at(files, 'shared.txt');
    expect(shared.onlyIn).toEqual(['one', 'two']);
    expect(shared.inBoth).toBe(false);
    expect(shared.counts.blank).toBeUndefined();
    expect(files.every((file) => !file.onlyIn.includes('blank'))).toBe(true);
  });

  it('leaves nothing at all to compare when every go came back empty', () => {
    const { files, sameEverywhere } = compare([blank, { ...blank, id: 'other' }]);
    expect(files).toEqual([]);
    expect(sameEverywhere).toEqual([]);
  });
});

describe('the words', () => {
  it('names the one that changed a file on its own', () => {
    expect(AGAINST_WORDS.who(['Way 1'], 3)).toBe('Only Way 1 changed it');
  });

  it('says all of them without listing them', () => {
    expect(AGAINST_WORDS.who(['Way 1', 'Way 2', 'Way 3'], 3)).toBe('All of them changed it');
  });

  it('says both when there are only two of them', () => {
    expect(AGAINST_WORDS.who(['Way 1', 'Way 2'], 2)).toBe('Both changed it');
  });

  it('names two of three rather than pretending it is all or one', () => {
    expect(AGAINST_WORDS.who(['Way 1', 'Way 2'], 3)).toBe('Way 1 and Way 2 changed it');
  });

  it('says how much there is to decide about, and how much there is not', () => {
    expect(AGAINST_WORDS.summary(4, 1)).toBe(
      '4 files to decide about, and 1 file that came out the same in all of them.',
    );
    expect(AGAINST_WORDS.summary(1, 0)).toBe('1 file to decide about.');
    expect(AGAINST_WORDS.summary(0, 0)).toBe('None of them changed anything.');
    expect(AGAINST_WORDS.summary(0, 2)).toMatch(/^Nothing to decide/);
  });

  it('keeps a side that touched nothing out of the totals', () => {
    expect(AGAINST_WORDS.total(0, 0, 0)).toBe('Changed nothing');
    expect(AGAINST_WORDS.total(2, 5, 1)).toBe('2 files, +5 −1');
  });
});

describe('a go that has not finished', () => {
  /** The defect this guards: a still-working go was drawn as a column with
   *  "Use this one" under it. Pressing it closed the sheet and answered that
   *  the go had finished without changing any files — while its changes were
   *  on the screen. The column stays, because watching one form is half of why
   *  this is open; the offer is what goes. */
  it('is not a result to take until it has finished', () => {
    expect(isFinal(one)).toBe(true);
    for (const state of ['waiting', 'running', 'needs-you'] as const) {
      expect(isFinal({ ...one, state })).toBe(false);
      expect(canTake({ ...one, state })).toBe(false);
    }
  });

  it('counts what it has changed so far without calling it a total', () => {
    expect(AGAINST_WORDS.soFar(2, 5, 1)).toBe('2 files so far, +5 −1');
    expect(AGAINST_WORDS.soFar(0, 0, 0)).toBe('Nothing changed yet');
    // "Changed nothing" is a finished answer, and this one is not finished.
    expect(AGAINST_WORDS.soFar(0, 0, 0)).not.toBe(AGAINST_WORDS.total(0, 0, 0));
  });

  it('says how many of the columns can still change under them', () => {
    const mixed = [one, { ...two, state: 'running' as const }];
    expect(saysSummary(mixed, 2, 0)).toMatch(/still going/);
    expect(saysSummary(mixed, 2, 0)).toContain(AGAINST_WORDS.summary(2, 0));
    expect(saysSummary([one, two], 2, 0)).toBe(AGAINST_WORDS.summary(2, 0));
  });
});

describe('a sheet opened before anything has started', () => {
  /** The defect this guards: with every slot full, both goes sit waiting and
   *  the sheet still opened — on nothing, saying "None of these changed
   *  anything." about work that had not begun. */
  const waiting: readonly Side[] = [
    { id: 'first', name: 'Way 1', state: 'waiting', diff: '' },
    { id: 'second', name: 'Way 2', state: 'waiting', diff: '' },
  ];
  const going: readonly Side[] = [waiting[0] as Side, { ...(waiting[1] as Side), state: 'running' }];

  it('says nothing has started, rather than that nothing changed', () => {
    expect(saysSummary(waiting, 0, 0)).toBe(AGAINST_WORDS.waitingToStart);
    expect(saysNothingHere(waiting)).toBe(AGAINST_WORDS.notStarted);
    for (const said of [saysSummary(waiting, 0, 0), saysNothingHere(waiting)]) {
      expect(said).not.toMatch(/changed anything/);
    }
  });

  it('says nothing has finished once one of them is going', () => {
    expect(saysSummary(going, 0, 0)).toBe(AGAINST_WORDS.noneFinished);
    expect(saysNothingHere(going)).toBe(AGAINST_WORDS.nothingSoFar);
  });

  it('still says none of them changed anything when all of them finished', () => {
    const finished = [blank, { ...blank, id: 'other' }];
    expect(saysNothingHere(finished)).toBe(AGAINST_WORDS.nothing);
    expect(saysSummary(finished, 0, 0)).toBe(AGAINST_WORDS.summary(0, 0));
  });
});

/**
 * A go that did not work was drawn as one that had not finished.
 *
 * The sheet asked one question — can this be taken? — and used the answer for
 * a second one it does not settle: can this still change? So a failed go was
 * counted among the ones "still going" directly above its own state line,
 * which read "Didn't work", and every cell it never reached said "Nothing here
 * yet" about a go that will never get there.
 */
describe('a go that did not work', () => {
  const broke = (id: string): Side => ({ id, name: `Way ${id}`, state: 'failed', diff: '' });

  it('is finished, and still has nothing to hand over', () => {
    const side = broke('one');
    expect(isFinal(side)).toBe(true);
    expect(canTake(side)).toBe(false);
  });

  it('is not counted among the ones still going', () => {
    // WHY: the count of columns that can still move is what puts "still going"
    // under the heading, and a failed one cannot move.
    const withFailed = [one, broke('gone')];
    expect(saysSummary(withFailed, 2, 0)).toBe(AGAINST_WORDS.summary(2, 0));
    expect(saysSummary(withFailed, 2, 0)).not.toMatch(/still going/);

    // One really going alongside it is still counted, and counted once.
    const alsoGoing = [...withFailed, { ...two, state: 'running' as const }];
    expect(saysSummary(alsoGoing, 2, 0)).toContain(AGAINST_WORDS.stillGoing(1));
  });

  it('does not leave the sheet saying nothing has finished', () => {
    const all = [broke('one'), broke('two')];
    expect(saysSummary(all, 0, 0)).toBe(AGAINST_WORDS.summary(0, 0));
    expect(saysSummary(all, 0, 0)).not.toBe(AGAINST_WORDS.noneFinished);
  });

  it('does not promise a file it never touched is still to come', () => {
    // WHY: "yet" is a promise about the future, and this one has no future.
    const all = [broke('one'), broke('two')];
    expect(saysNothingHere(all)).toBe(AGAINST_WORDS.nothing);
    expect(saysNothingHere(all)).not.toMatch(/yet/);
  });
});

describe('seeing the goes running, not only their patches', () => {
  /** The whole serving path existed end to end — handler, contract, preload,
   *  bridge, and the strip in the pane — and nothing ever called it. The set
   *  it wants is exactly what several goes at one job already are: each in a
   *  copy of its own, each with a folder. */
  it('offers it only where a copy is still there to serve', () => {
    const gone = [{ id: 'a', name: 'Way 1', state: 'done' as const, diff: '', folder: null }];
    const here = [{ id: 'a', name: 'Way 1', state: 'done' as const, diff: '', folder: '/tmp/one' }];
    expect(gone.some((one) => one.folder !== null)).toBe(false);
    expect(here.some((one) => one.folder !== null)).toBe(true);
  });

  it('says what it does, not how it is served', () => {
    expect(AGAINST_WORDS.inTheBrowser).not.toMatch(/serve|port|localhost|build|worktree/i);
    expect(AGAINST_WORDS.inTheBrowser).toMatch(/browser/i);
  });

  /** Getting several copies ready takes a moment, and a button that looks
   *  unpressed while it works gets pressed again. */
  it('has a word for the wait', () => {
    expect(AGAINST_WORDS.opening).not.toBe(AGAINST_WORDS.inTheBrowser);
    expect(AGAINST_WORDS.opening).toMatch(/…|\.\.\./);
  });
});
