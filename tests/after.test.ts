/** Work that waits for other work — a plan rather than eight things at once.
 *
 * Five claims, and four of them are the ways this design usually fails.
 *
 * 1. **It runs in the order somebody meant.** The second does not take a copy
 *    of the project, does not appear as going, and does not start until the
 *    first has actually landed.
 * 2. **It is refused while it is being described.** Two pieces of work waiting
 *    for each other is something anybody can ask for by accident, and the only
 *    acceptable moment to find out is the moment it is asked for. Never by
 *    watching a board that has stopped moving.
 * 3. **Nothing follows work that did not land.** Not the next one, and not the
 *    one after that. Carrying on regardless would mean working against a
 *    project that was never changed and reporting on it as though it had been.
 * 4. **It survives the app closing.** The wait is on the disk with the work, so
 *    a plan half-done at a quit comes back as the rest of the plan.
 * 5. **The ceiling still binds.** Work released by the one in front of it is
 *    asked for, not started: it queues behind everything else and meets the
 *    limit exactly as anything else does.
 *
 * The board here is the real `Workbench` against real storage wherever the
 * claim is about copies of a project, because "it did not start" and "it
 * started somewhere we were not looking" are the two things that look the same
 * from inside the app.
 */

import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectHistory } from '../src/history/repo';
import { Workbench } from '../src/history/attempts';
import { Fleet } from '../src/cost/fleet';
import { createLimit } from '../src/cost/limits';
import { fromMajor } from '../src/cost/money';
import { afterWords, Following, type Board } from '../src/work/after';
import type { WorkState } from '../src/work/board';
import { Notebook } from '../src/work/notebook';
import { noteOf, type Owner, type Written } from '../src/work/written';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const made: string[] = [];

afterAll(async () => {
  await Promise.all(made.map((folder) => rm(folder, { recursive: true, force: true })));
});

async function newFolder(): Promise<string> {
  const folder = await realpath(await mkdtemp(path.join(tmpdir(), 'graphe-after-')));
  made.push(folder);
  return folder;
}

/* ------------------------------------------------------------ a board of cards */

/**
 * A board with no folders in it, for the claims that are about order rather
 * than about copies. The shell wires the same three calls to `Workbench`.
 */
class Cards {
  readonly asked: string[] = [];
  readonly troubles = new Map<string, string>();
  readonly #state = new Map<string, WorkState>();

  readonly board: Board = {
    ask: (_doing, where) => {
      this.asked.push(where.id);
      this.#state.set(where.id, 'waiting');
    },
    stopped: (id, trouble) => {
      this.#state.set(id, 'failed');
      this.troubles.set(id, trouble);
    },
    stateOf: (id) => this.#state.get(id) ?? null,
  };

  put(id: string, state: WorkState): void {
    this.#state.set(id, state);
  }

  drop(id: string): void {
    this.#state.delete(id);
  }

  stateOf(id: string): WorkState | null {
    return this.#state.get(id) ?? null;
  }
}

let cards: Cards;
let chain: Following;

beforeEach(() => {
  cards = new Cards();
  chain = new Following(cards.board);
});

function hold(id: string, after: string, at = 1000): ReturnType<Following['hold']> {
  return chain.hold({ id, doing: `Do ${id}`, at, after });
}

/* ========================================================================== */
/* Refused while it is being described                                         */
/* ========================================================================== */

describe('a plan that could never run', () => {
  it('refuses one waiting for itself', () => {
    cards.put('one', 'waiting');
    expect(chain.could('one', 'one')).toEqual({ ok: false, because: afterWords.itself });
  });

  it('refuses two waiting for each other, when it is asked for', () => {
    cards.put('one', 'waiting');
    cards.put('two', 'waiting');
    expect(hold('two', 'one')).toEqual({ ok: true, waits: true });

    const back = chain.could('one', 'two');
    expect(back).toEqual({ ok: false, because: afterWords.loop });
    // And nothing was written down, so nothing is left half-planned.
    expect(chain.waiting.map((one) => one.id)).toEqual(['two']);
  });

  it('refuses a ring however long it is', () => {
    for (const id of ['one', 'two', 'three', 'four']) cards.put(id, 'waiting');
    hold('two', 'one');
    hold('three', 'two');
    hold('four', 'three');

    expect(chain.could('one', 'four')).toEqual({ ok: false, because: afterWords.loop });
    expect(chain.could('two', 'four')).toEqual({ ok: false, because: afterWords.loop });
    // The one shape that is not a ring: two things waiting for the same thing.
    cards.put('five', 'waiting');
    expect(chain.could('five', 'one')).toEqual({ ok: true });
  });

  it('refuses waiting for something that is not there', () => {
    cards.put('one', 'waiting');
    expect(chain.could('one', 'nothing-like-that')).toEqual({
      ok: false,
      because: afterWords.missing,
    });
  });

  it('refuses making something that is already going wait', () => {
    cards.put('one', 'waiting');
    for (const state of ['running', 'needs-you'] as const) {
      cards.put('two', state);
      expect(chain.could('two', 'one')).toEqual({ ok: false, because: afterWords.underway });
    }
  });

  it('refuses making something that has already finished wait', () => {
    cards.put('one', 'waiting');
    for (const state of ['done', 'failed'] as const) {
      cards.put('two', state);
      expect(chain.could('two', 'one')).toEqual({ ok: false, because: afterWords.over });
    }
  });

  it('refuses following work that did not work', () => {
    cards.put('one', 'failed');
    cards.put('two', 'waiting');
    expect(hold('two', 'one')).toEqual({ ok: false, because: afterWords.brokeAlready });
    expect(chain.waiting).toEqual([]);
  });

  it('has nothing to wait for when the one in front is already done', () => {
    cards.put('one', 'done');
    expect(hold('two', 'one')).toEqual({ ok: true, waits: false });
    expect(chain.waiting).toEqual([]);
  });
});

/* ========================================================================== */
/* It runs in the order somebody meant                                         */
/* ========================================================================== */

describe('one after another', () => {
  it('holds the second back until the first lands, then asks for it', () => {
    cards.put('one', 'running');
    expect(hold('two', 'one')).toEqual({ ok: true, waits: true });
    expect(cards.asked).toEqual([]);
    expect(cards.stateOf('two')).toBeNull();

    cards.put('one', 'done');
    const moved = chain.finished('one');

    expect(moved).toEqual({ started: ['two'], stopped: [] });
    expect(cards.asked).toEqual(['two']);
    expect(cards.stateOf('two')).toBe('waiting');
    expect(chain.waiting).toEqual([]);
  });

  it('lets one step through at a time rather than the whole plan at once', () => {
    cards.put('one', 'running');
    hold('two', 'one');
    hold('three', 'two');

    cards.put('one', 'done');
    expect(chain.finished('one').started).toEqual(['two']);
    expect(cards.asked).toEqual(['two']);

    // The third is still waiting for the second, not for the first.
    cards.put('two', 'done');
    expect(chain.finished('two').started).toEqual(['three']);
    expect(cards.asked).toEqual(['two', 'three']);
  });

  it('starts everything waiting on the same one', () => {
    cards.put('one', 'running');
    hold('two', 'one', 100);
    hold('three', 'one', 200);

    cards.put('one', 'done');
    expect(chain.finished('one').started).toEqual(['two', 'three']);
  });

  it('keeps them in the order they were asked for', () => {
    cards.put('one', 'running');
    hold('late', 'one', 900);
    hold('early', 'one', 100);
    expect(chain.waiting.map((one) => one.id)).toEqual(['early', 'late']);
  });
});

/* ========================================================================== */
/* Nothing follows work that did not land                                      */
/* ========================================================================== */

describe('the one in front did not land', () => {
  it('stops the next one and says why', () => {
    cards.put('one', 'running');
    hold('two', 'one');

    cards.put('one', 'failed');
    const moved = chain.finished('one');

    expect(moved).toEqual({ started: [], stopped: ['two'] });
    expect(cards.stateOf('two')).toBe('failed');
    expect(cards.troubles.get('two')).toBe(afterWords.broke);
  });

  it('stops the whole rest of the plan, not only the next one', () => {
    cards.put('one', 'running');
    hold('two', 'one');
    hold('three', 'two');
    hold('four', 'three');

    cards.put('one', 'failed');
    expect(chain.finished('one').stopped).toEqual(['two', 'three', 'four']);
    expect(chain.waiting).toEqual([]);
    // The first is told what happened; the rest are told the truth about
    // themselves, which is that what they were waiting for never started.
    expect(cards.troubles.get('two')).toBe(afterWords.broke);
    expect(cards.troubles.get('three')).toBe(afterWords.neverStarted);
    expect(cards.troubles.get('four')).toBe(afterWords.neverStarted);
  });

  it('leaves every one of them on the board rather than quietly dropping them', () => {
    cards.put('one', 'running');
    hold('two', 'one');
    hold('three', 'two');

    cards.put('one', 'failed');
    chain.finished('one');
    expect(cards.asked).toEqual(['two', 'three']);
  });

  it('stops what was waiting for one that was thrown away', () => {
    cards.put('one', 'waiting');
    hold('two', 'one');

    cards.drop('one');
    const moved = chain.finished('one');
    expect(moved.stopped).toEqual(['two']);
    expect(cards.troubles.get('two')).toBe(afterWords.thrownAway);
  });

  it('never carries on regardless', () => {
    for (const state of ['failed', 'waiting', 'running', 'needs-you'] as const) {
      cards = new Cards();
      chain = new Following(cards.board);
      cards.put('one', 'running');
      hold('two', 'one');
      cards.put('one', state);

      expect(chain.finished('one').started).toEqual([]);
    }
  });
});

/* ========================================================================== */
/* Against real copies of a project                                            */
/* ========================================================================== */

async function aProject(): Promise<{ history: ProjectHistory; root: string; under: string }> {
  const root = await newFolder();
  const under = await newFolder();
  const history = new ProjectHistory(root);
  await history.prepare();
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(root, 'src', 'hero.css'), '.hero { padding: 16px; }\n', 'utf8');
  await history.snapshot('First pass at the landing page');
  return { history, root, under };
}

/** The board and the waits, wired the way the shell wires them. */
function benchAndChain(bench: Workbench): Following {
  return new Following({
    ask: (doing, where) => {
      bench.ask(doing, where);
    },
    stopped: (id, trouble) => {
      bench.stopped(id, trouble);
    },
    stateOf: (id) => bench.pieces.find((one) => one.id === id)?.state ?? null,
  });
}

describe('a plan against real copies of a project', () => {
  it('never makes a copy for one that is still waiting', async () => {
    const { history, under } = await aProject();
    const bench = new Workbench({ history, under });
    const following = benchAndChain(bench);

    bench.ask('Calm the hero', { id: 'work-1' });
    expect(following.hold({ id: 'work-2', doing: 'Photograph it', at: 2, after: 'work-1' })).toEqual(
      { ok: true, waits: true },
    );

    const began = await bench.begin();
    expect(began.map((one) => one.id)).toEqual(['work-1']);
    expect(bench.pieces).toHaveLength(1);
    expect(began[0]?.folder).not.toBeNull();

    // It only gets a copy once the one in front of it has landed.
    await bench.settle('work-1', 'Calmed the hero');
    expect(following.finished('work-1').started).toEqual(['work-2']);

    const next = await bench.begin();
    expect(next.map((one) => one.id)).toEqual(['work-2']);
    expect(next[0]?.folder).not.toBe(began[0]?.folder);
    await bench.clear();
  });

  it('gives the one behind it no copy at all when the first did not work', async () => {
    const { history, under } = await aProject();
    const bench = new Workbench({ history, under });
    const following = benchAndChain(bench);

    bench.ask('Calm the hero', { id: 'work-1' });
    following.hold({ id: 'work-2', doing: 'Photograph it', at: 2, after: 'work-1' });
    await bench.begin();
    bench.stopped('work-1', 'The model would not answer.');

    following.finished('work-1');
    const fallen = bench.pieces.find((one) => one.id === 'work-2');
    expect(fallen?.state).toBe('failed');
    expect(fallen?.folder).toBeNull();
    expect(fallen?.trouble).toBe(afterWords.broke);

    // And it stays that way: nothing on the board is waiting to be started.
    expect(await bench.begin()).toEqual([]);
    await bench.clear();
  });
});

/* ========================================================================== */
/* The ceiling still binds                                                     */
/* ========================================================================== */

describe('a plan is not a way round the limit', () => {
  it('asks for the next one rather than starting it', () => {
    cards.put('one', 'running');
    hold('two', 'one');
    cards.put('one', 'done');
    chain.finished('one');

    // Waiting, which is the only state anything reaches through this file. What
    // turns waiting into going is the board and the ceiling, neither of which
    // this can reach.
    expect(cards.stateOf('two')).toBe('waiting');
  });

  it('refuses the one released by a plan exactly as it refuses any other', () => {
    const money = new Fleet();
    money.hold(createLimit(fromMajor(8, 'USD'), 'session'));

    // The first takes its share of a ceiling with room for one run and no more.
    expect(money.begin({ id: 'work-1', kind: 'away', stop: () => undefined }).ok).toBe(true);

    cards.put('work-1', 'running');
    hold('work-2', 'work-1');
    cards.put('work-1', 'done');
    expect(chain.finished('work-1').started).toEqual(['work-2']);

    // Released by the plan, and refused by the ceiling all the same.
    const admitted = money.begin({ id: 'work-2', kind: 'away', stop: () => undefined });
    expect(admitted.ok).toBe(false);
    expect(admitted.ok === false && admitted.because).toMatch(/limit/i);
  });
});

/* ========================================================================== */
/* It survives the app closing                                                 */
/* ========================================================================== */

const OWNER: Owner = { pid: 4242, since: 1000 };

function note(over: Partial<Written> = {}): Written {
  return {
    ...noteOf(
      {
        id: 'work-1',
        doing: 'Calm the hero',
        state: 'waiting',
        folder: null,
        version: null,
        picture: null,
        at: 500,
        trouble: null,
      },
      { project: '/projects/site', name: 'site', owner: OWNER },
    ),
    ...over,
  };
}

describe('a plan half-done when the app closed', () => {
  it('is on the disk with the work, not in the window', async () => {
    const root = await newFolder();
    const book = new Notebook(root);
    await book.note(note({ id: 'work-1', at: 100 }));
    await book.note(note({ id: 'work-2', doing: 'Photograph it', at: 200, after: 'work-1' }));

    const page = await new Notebook(root).page('/projects/site');
    expect(page.map((one) => one.after)).toEqual([null, 'work-1']);
  });

  it('says nothing about a wait that was never asked for', () => {
    expect(note().after).toBeNull();
  });

  it('picks up the rest of the plan when the first one landed while it was away', () => {
    // What came back off the disk, put on the board before anything is wired up.
    cards.put('work-1', 'done');
    cards.put('work-2', 'waiting');

    // Nothing left to wait for, so it simply takes its turn.
    const asked = chain.hold({ id: 'work-2', doing: 'Photograph it', at: 200, after: 'work-1' });
    expect(asked).toEqual({ ok: true, waits: false });
    expect(chain.waiting).toEqual([]);
  });

  it('keeps waiting when the first one never got its turn either', () => {
    cards.put('work-1', 'waiting');
    cards.put('work-2', 'waiting');
    expect(chain.hold({ id: 'work-2', doing: 'Photograph it', at: 200, after: 'work-1' })).toEqual({
      ok: true,
      waits: true,
    });

    cards.put('work-1', 'done');
    expect(chain.finished('work-1').started).toEqual(['work-2']);
  });

  it('does not run the rest of a plan whose first half was cut short', () => {
    // A run that was mid-thought when the app went away comes back as one that
    // did not work, and nothing behind it may start against a project it never
    // changed.
    cards.put('work-1', 'failed');
    cards.put('work-2', 'waiting');
    expect(chain.hold({ id: 'work-2', doing: 'Photograph it', at: 200, after: 'work-1' })).toEqual({
      ok: false,
      because: afterWords.brokeAlready,
    });
  });

  it('reads a plan back in whichever order the notes came off the disk', () => {
    for (const order of [
      ['work-2', 'work-3'],
      ['work-3', 'work-2'],
    ]) {
      cards = new Cards();
      chain = new Following(cards.board);
      for (const id of ['work-1', 'work-2', 'work-3']) cards.put(id, 'waiting');
      const links: Record<string, string> = { 'work-2': 'work-1', 'work-3': 'work-2' };

      for (const id of order) {
        const held = chain.hold({ id, doing: `Do ${id}`, at: 1, after: links[id] as string });
        expect(held).toEqual({ ok: true, waits: true });
        cards.drop(id);
      }
      expect(chain.waiting.map((one) => one.id).sort()).toEqual(['work-2', 'work-3']);

      cards.put('work-1', 'done');
      expect(chain.finished('work-1').started).toEqual(['work-2']);
    }
  });
});

/* ========================================================================== */
/* The words                                                                   */
/* ========================================================================== */

describe('what it says about a plan', () => {
  const sentences: string[] = Object.values<unknown>(afterWords).filter(
    (one) => typeof one === 'string',
  ) as string[];

  it('speaks no jargon', () => {
    const jargon =
      /\b(dependency|dependencies|DAG|queue|queued|job|process|blocked|upstream|downstream|parent|node|graph|chain)\b/i;
    for (const sentence of sentences) expect(sentence).not.toMatch(jargon);
    expect(afterWords.waits('Tighten the nav')).not.toMatch(jargon);
  });

  it('never blames the person', () => {
    for (const sentence of sentences) {
      expect(sentence).not.toMatch(/\byou (?:cannot|can't|must|should|need to|failed)\b/i);
      expect(sentence).not.toMatch(/\b(sorry|oops|invalid|error)\b/i);
    }
  });

  it('says what one is waiting for in the person’s own words', () => {
    expect(afterWords.waits('Tighten the nav')).toBe('After “Tighten the nav”');
  });

  it('keeps a long one short enough to read at a glance', () => {
    const long = 'Go through every page and make the spacing consistent everywhere it appears';
    expect(afterWords.waits(long).length).toBeLessThanOrEqual(70);
    expect(afterWords.waits(long)).toContain('…');
  });
});
