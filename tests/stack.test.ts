/** Several pieces of work that belong in an order, taken in one act.
 *
 * Six claims, and five of them are the ways this design usually fails.
 *
 * 1. **It goes in the order somebody meant**, not the order it finished in and
 *    not the order the board happens to draw. The same set pressed twice lands
 *    the same way, because an order that depends on which copy finished first is
 *    not an order.
 * 2. **The second one is fitted around the first.** This is the whole item: the
 *    piece that goes in second was built from a project without the first one in
 *    it, and it still has to arrive on top of it. Proved on real storage, by
 *    reading the file afterwards and finding both changes in it.
 * 3. **An order that cannot exist is a sentence**, said before anything is
 *    touched, naming what waits for what. Never a project left halfway.
 * 4. **A stop is a stop.** One that will not fit stops the run there; what went
 *    in before it stays in, what is behind it is never tried, and both facts are
 *    said out loud. Nobody is left half-landed without being told.
 * 5. **The whole run is one undo.** However far it got, there is one version to
 *    put the project back to, which is what makes stopping halfway acceptable.
 * 6. **What did not land is still there** — its copy, its version, its card. A
 *    stop costs nobody their work.
 *
 * The disk-touching claims run against real git in throwaway projects, because
 * "it landed on top" and "it replaced what was there" look identical from
 * inside the app and completely different in the file.
 */

import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

import { ProjectHistory } from '../src/history/repo';
import { Workbench } from '../src/history/attempts';
import {
  meetingsIn,
  orderToTake,
  saysTook,
  stackWords,
  takeInOrder,
  type Landing,
  type Standing,
} from '../src/work/stack';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const made: string[] = [];

afterAll(async () => {
  await Promise.all(made.map((folder) => rm(folder, { recursive: true, force: true })));
});

async function newFolder(): Promise<string> {
  const folder = await realpath(await mkdtemp(path.join(tmpdir(), 'graphe-stack-')));
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

const MINUTE = 60 * 1000;
const NOW = new Date(2026, 7, 12, 15, 30).getTime();

function standing(over: Partial<Standing> & { id: string }): Standing {
  return {
    doing: over.id,
    at: NOW,
    ready: true,
    after: null,
    touches: null,
    ...over,
  };
}

/* ========================================================================== */
/* S-01 the order                                                              */
/* ========================================================================== */

describe('S-01 the order they go in', () => {
  /** WHY: the wait is what somebody said when they asked for the work. If the
   *  set landed in the order it was asked for regardless, the sentence "do this
   *  one after that one" would be decoration. */
  it('puts what was asked to wait behind the one it waits for', () => {
    const planned = orderToTake([
      standing({ id: 'nav', doing: 'Tighten the nav', at: NOW, after: 'hero' }),
      standing({ id: 'hero', doing: 'Calm the hero', at: NOW + MINUTE }),
    ]);

    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.order.map((one) => one.id)).toEqual(['hero', 'nav']);
  });

  /** WHY: a chain three deep is where an order that only looks at the piece in
   *  front of it starts landing things in the wrong place. */
  it('follows a chain all the way down, whatever order they arrive in', () => {
    const planned = orderToTake([
      standing({ id: 'c', at: NOW + 2 * MINUTE, after: 'b' }),
      standing({ id: 'a', at: NOW + 3 * MINUTE }),
      standing({ id: 'b', at: NOW, after: 'a' }),
    ]);

    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.order.map((one) => one.id)).toEqual(['a', 'b', 'c']);
  });

  /** WHY: two pieces with nothing between them have to land the same way every
   *  time or "press it again" is a different project each press. Asked-for time
   *  first, name only when even that ties. */
  it('breaks a tie the same way every time, by when it was asked for', () => {
    const pieces = [
      standing({ id: 'later', at: NOW + MINUTE }),
      standing({ id: 'earlier', at: NOW }),
    ];
    const once = orderToTake(pieces);
    const again = orderToTake([...pieces].reverse());

    expect(once.ok && once.order.map((one) => one.id)).toEqual(['earlier', 'later']);
    expect(again.ok && again.order.map((one) => one.id)).toEqual(['earlier', 'later']);
  });

  /** WHY: two asked for in the same millisecond is a plan dispatched in one go,
   *  which is exactly the case the orchestrator produces. */
  it('falls back to the name when they were asked for at the same moment', () => {
    const planned = orderToTake([standing({ id: 'zeta' }), standing({ id: 'alpha' })]);
    expect(planned.ok && planned.order.map((one) => one.id)).toEqual(['alpha', 'zeta']);
  });

  /** WHY: a wait pointing at work that has already gone in, or been thrown
   *  away, is not a constraint on this set. Treating it as one would refuse an
   *  order that is perfectly fine. */
  it('ignores a wait on something that is not in the set', () => {
    const planned = orderToTake([
      standing({ id: 'nav', at: NOW + MINUTE, after: 'gone' }),
      standing({ id: 'hero', at: NOW }),
    ]);
    expect(planned.ok && planned.order.map((one) => one.id)).toEqual(['hero', 'nav']);
  });
});

/* ========================================================================== */
/* S-02 orders that cannot exist                                               */
/* ========================================================================== */

describe('S-02 refused, in a sentence', () => {
  /** WHY: two waiting for each other is something anybody can ask for by
   *  accident. Discovering it as a project left halfway is the one outcome
   *  nobody can unpick. */
  it('refuses a round trip and names both ends of it', () => {
    const planned = orderToTake([
      standing({ id: 'hero', doing: 'Calm the hero', after: 'nav' }),
      standing({ id: 'nav', doing: 'Tighten the nav', after: 'hero' }),
    ]);

    expect(planned.ok).toBe(false);
    if (planned.ok) return;
    expect(planned.because).toContain('Calm the hero');
    expect(planned.because).toContain('Tighten the nav');
    expect(planned.because).toContain('no order that works');
  });

  /** WHY: a longer round trip is the same fault and has to say the same thing.
   *  A sentence naming only two of three is a sentence somebody cannot act on. */
  it('names every piece in a longer round trip', () => {
    const planned = orderToTake([
      standing({ id: 'a', doing: 'Calm the hero', after: 'c' }),
      standing({ id: 'b', doing: 'Tighten the nav', after: 'a' }),
      standing({ id: 'c', doing: 'Warm the palette', after: 'b' }),
    ]);

    expect(planned.ok).toBe(false);
    if (planned.ok) return;
    for (const doing of ['Calm the hero', 'Tighten the nav', 'Warm the palette']) {
      expect(planned.because).toContain(doing);
    }
  });

  /** WHY: two goes at one thing are alternatives to each other. Ordering them
   *  is the wrong question — landing both would put a decision nobody made into
   *  the project. */
  it('refuses a set holding two goes at the same thing', () => {
    const planned = orderToTake([
      standing({ id: 'one', doing: 'Calm the hero', at: NOW, ways: 'hero' }),
      standing({ id: 'two', doing: 'Calm the hero, warmer', at: NOW + MINUTE, ways: 'hero' }),
    ]);

    expect(planned.ok).toBe(false);
    if (planned.ok) return;
    expect(planned.because).toContain('two goes at the same thing');
    expect(planned.because).toContain('Calm the hero, warmer');
  });

  /** WHY: something still going has no result to take. Letting it into the set
   *  would land the ones around it and silently drop this one. */
  it('refuses a set holding something that has not finished', () => {
    const planned = orderToTake([
      standing({ id: 'hero', doing: 'Calm the hero' }),
      standing({ id: 'nav', doing: 'Tighten the nav', ready: false }),
    ]);

    expect(planned.ok).toBe(false);
    if (planned.ok) return;
    expect(planned.because).toContain('Tighten the nav');
    expect(planned.because).toContain('has not finished');
  });
});

/* ========================================================================== */
/* S-03 where two of them meet                                                 */
/* ========================================================================== */

describe('S-03 the same file, twice', () => {
  /** WHY: this is the only place the order can cost somebody anything, so it is
   *  said before the press rather than discovered by it. */
  it('says which two changed the same file, and which file', () => {
    const meetings = meetingsIn([
      standing({ id: 'hero', touches: ['hero.css', 'hero.tsx'] }),
      standing({ id: 'nav', touches: ['nav.css', 'hero.css'] }),
      standing({ id: 'copy', touches: ['words.md'] }),
    ]);

    expect(meetings).toEqual([{ one: 'hero', other: 'nav', files: ['hero.css'] }]);
  });

  /** WHY: it reads the same from either end, which is exactly why it can never
   *  decide an order. Reported once, not once per direction. */
  it('reports one meeting per pair, not two', () => {
    const meetings = meetingsIn([
      standing({ id: 'a', touches: ['x.css'] }),
      standing({ id: 'b', touches: ['x.css'] }),
    ]);
    expect(meetings).toHaveLength(1);
  });

  /** WHY: a set nobody has looked at the files of must not invent a warning. */
  it('finds nothing when nobody knows what they changed', () => {
    expect(meetingsIn([standing({ id: 'a' }), standing({ id: 'b' })])).toEqual([]);
  });
});

/* ========================================================================== */
/* S-04 walking the order                                                      */
/* ========================================================================== */

describe('S-04 what a stop does', () => {
  /** WHY: the run has to hand back exactly which ones went in, or the caller
   *  cannot say the true sentence afterwards. */
  it('walks the whole order when every one of them fits', async () => {
    const seen: string[] = [];
    const land: Landing = async (id) => {
      seen.push(id);
      return { ok: true };
    };

    const took = await takeInOrder(['a', 'b', 'c'], land);
    expect(seen).toEqual(['a', 'b', 'c']);
    expect(took).toEqual({ landed: ['a', 'b', 'c'], stoppedAt: null, notReached: [] });
  });

  /** WHY: carrying on past one that would not fit puts work on a foundation
   *  that is not there. The one behind it is never tried, and the result says
   *  so rather than leaving somebody to work out which of five happened. */
  it('stops at the first that will not fit and never tries the rest', async () => {
    const seen: string[] = [];
    const land: Landing = async (id) => {
      seen.push(id);
      return id === 'b' ? { ok: false, conflicted: ['hero.css'] } : { ok: true };
    };

    const took = await takeInOrder(['a', 'b', 'c'], land);
    expect(seen).toEqual(['a', 'b']);
    expect(took.landed).toEqual(['a']);
    expect(took.stoppedAt).toEqual({ id: 'b', conflicted: ['hero.css'] });
    expect(took.notReached).toEqual(['c']);
  });

  /** WHY: a half-landed project that says nothing is the failure this whole
   *  file exists to prevent. The sentence has to carry the count, the one that
   *  stopped it, and the file. */
  it('says how far it got, what stopped it and over what', () => {
    const said = saysTook(
      {
        landed: ['a', 'b'],
        stoppedAt: { id: 'c', conflicted: ['hero.css'] },
        notReached: ['d'],
      },
      (id) => (id === 'c' ? 'Warm the palette' : id),
    );

    expect(said.what).toContain('Two went into your project');
    expect(said.what).toContain('Warm the palette');
    expect(said.what).toContain('hero.css');
    expect(said.because).toContain('still here');
  });

  it('says plainly when the whole set went in', () => {
    const said = saysTook({ landed: ['a', 'b', 'c'], stoppedAt: null, notReached: [] }, (id) => id);
    expect(said.what).toBe('Three went into your project, in order.');
  });
});

/* ========================================================================== */
/* S-05 the words                                                              */
/* ========================================================================== */

describe('S-05 nothing here names the machinery', () => {
  /** WHY: this feature is the one most likely to reach for the vocabulary of
   *  the thing underneath it, and every one of those words is a word a designer
   *  does not have. */
  it('never says merge, rebase, branch, stack, commit or git', () => {
    const said = [
      ...Object.values(stackWords).map((one) =>
        typeof one === 'function' ? '' : one,
      ),
      stackWords.takeAll(2),
      stackWords.takeAll(4),
      stackWords.behind('Calm the hero'),
      stackWords.meets('Calm the hero', 'Tighten the nav', ['hero.css']),
      stackWords.loop(['Calm the hero', 'Tighten the nav']),
      stackWords.alternatives('one', 'two'),
      stackWords.notReady('Calm the hero'),
      stackWords.allIn(3),
      stackWords.someIn(2, 'Warm the palette', ['hero.css']),
      stackWords.someIn(0, 'Warm the palette', []),
      stackWords.restWait(2),
    ].join(' ');

    for (const banned of ['merge', 'rebase', 'branch', 'stack', 'commit', 'git', 'conflict']) {
      expect(said.toLowerCase()).not.toContain(banned);
    }
  });

  /** WHY: the press has to say how many, because the whole point of it is that
   *  it is not one of them. */
  it('counts them on the press itself', () => {
    expect(stackWords.takeAll(2)).toBe('Take both');
    expect(stackWords.takeAll(4)).toBe('Take all four');
  });
});

/* ========================================================================== */
/* S-06 on real storage                                                        */
/* ========================================================================== */

/** A project with one saved version in it, and somewhere to keep the copies. */
async function aProject(): Promise<{ history: ProjectHistory; root: string; under: string }> {
  const root = await newFolder();
  const under = await newFolder();
  const history = new ProjectHistory(root);
  await history.prepare();
  await put(root, 'hero.css', '.hero {\n  padding: 16px;\n}\n\n.nav {\n  gap: 8px;\n}\n');
  await history.snapshot('First pass at the landing page');
  return { history, root, under };
}

/** Ask for a piece, run it, and save what it did — the three calls the app
 *  makes around whatever the agent got up to in the folder. */
async function didWork(
  bench: Workbench,
  id: string,
  doing: string,
  at: number,
  inside: (folder: string) => Promise<void>,
): Promise<void> {
  bench.ask(doing, { id, at });
  await bench.begin();
  const piece = bench.pieces.find((one) => one.id === id);
  if (piece?.folder == null) throw new Error(`no copy for ${id}`);
  await inside(piece.folder);
  await bench.settle(id, doing);
}

describe('S-06 several going into a real project', () => {
  /** WHY: **the item itself.** The second one was built from a project without
   *  the first one in it. If taking a set replaced the project with each copy
   *  in turn, the last one would win and the first one's change would be gone
   *  without a word. Both lines have to be in the file afterwards. */
  it('fits the second one around the first, though it was built without it', async () => {
    const { history, root, under } = await aProject();
    const bench = new Workbench({ history, under });

    await didWork(bench, 'hero', 'Calm the hero', NOW, async (folder) => {
      await put(folder, 'hero.css', '.hero {\n  padding: 48px;\n}\n\n.nav {\n  gap: 8px;\n}\n');
    });
    await didWork(bench, 'nav', 'Tighten the nav', NOW + MINUTE, async (folder) => {
      await put(folder, 'hero.css', '.hero {\n  padding: 16px;\n}\n\n.nav {\n  gap: 2px;\n}\n');
    });

    const took = await bench.keepSet(['hero', 'nav'], (piece) => `Kept ${piece.doing}`, {
      after: (id) => (id === 'nav' ? 'hero' : null),
    });

    expect(took.ok).not.toBe(false);
    if (took.ok === false) return;
    expect(took.landed).toEqual(['hero', 'nav']);
    expect(took.stoppedAt).toBeNull();

    const after = await get(root, 'hero.css');
    expect(after).toContain('padding: 48px');
    expect(after).toContain('gap: 2px');
  });

  /** WHY: the order comes from what somebody said, not from what finished
   *  first. Reading the titles back is the only way to tell which actually
   *  happened. */
  it('lands them in the order they were asked to go in', async () => {
    const { history, under } = await aProject();
    const bench = new Workbench({ history, under });

    // Asked for last, but everything else waits for it.
    await didWork(bench, 'c', 'Warm the palette', NOW, async (folder) => {
      await put(folder, 'palette.css', ':root { --warm: 1; }\n');
    });
    await didWork(bench, 'b', 'Tighten the nav', NOW + MINUTE, async (folder) => {
      await put(folder, 'nav.css', '.nav { gap: 2px; }\n');
    });
    await didWork(bench, 'a', 'Calm the hero', NOW + 2 * MINUTE, async (folder) => {
      await put(folder, 'hero.tsx', 'export const Hero = () => null;\n');
    });

    const took = await bench.keepSet(['a', 'b', 'c'], (piece) => `Kept ${piece.doing}`, {
      after: (id) => (id === 'b' ? 'a' : id === 'c' ? 'b' : null),
    });

    expect(took.ok === false ? null : took.landed).toEqual(['a', 'b', 'c']);

    const titles = (await history.versions({ limit: 4 })).map((one) => one.title);
    expect(titles.slice(0, 3)).toEqual([
      'Kept Warm the palette',
      'Kept Tighten the nav',
      'Kept Calm the hero',
    ]);
  });

  /** WHY: what went in before the stop is work somebody wanted, and taking it
   *  back out to punish an unrelated third piece costs them it twice — once
   *  now, and again when the same press fails in the same place. */
  it('keeps what went in before a stop, and never tries what was behind it', async () => {
    const { history, root, under } = await aProject();
    const bench = new Workbench({ history, under });

    await didWork(bench, 'a', 'Calm the hero', NOW, async (folder) => {
      await put(folder, 'hero.css', '.hero {\n  padding: 48px;\n}\n\n.nav {\n  gap: 8px;\n}\n');
    });
    // The same line, differently. Nothing can fit both.
    await didWork(bench, 'b', 'Loosen the hero', NOW + MINUTE, async (folder) => {
      await put(folder, 'hero.css', '.hero {\n  padding: 96px;\n}\n\n.nav {\n  gap: 8px;\n}\n');
    });
    await didWork(bench, 'c', 'Warm the palette', NOW + 2 * MINUTE, async (folder) => {
      await put(folder, 'palette.css', ':root { --warm: 1; }\n');
    });

    const took = await bench.keepSet(['a', 'b', 'c'], (piece) => `Kept ${piece.doing}`);

    expect(took.ok).not.toBe(false);
    if (took.ok === false) return;
    expect(took.landed).toEqual(['a']);
    expect(took.stoppedAt?.id).toBe('b');
    expect(took.stoppedAt?.conflicted).toEqual(['hero.css']);
    expect(took.notReached).toEqual(['c']);

    expect(await get(root, 'hero.css')).toContain('padding: 48px');
    expect(await there(path.join(root, 'palette.css'))).toBe(false);
  });

  /** WHY: a stop that quietly ate the work behind it would be worse than no
   *  set at all. Both are still on the board with their own copies, so each is
   *  still one press on its own card. */
  it('leaves what did not go in exactly where it was, copy and all', async () => {
    const { history, under } = await aProject();
    const bench = new Workbench({ history, under });

    await didWork(bench, 'a', 'Calm the hero', NOW, async (folder) => {
      await put(folder, 'hero.css', '.hero {\n  padding: 48px;\n}\n\n.nav {\n  gap: 8px;\n}\n');
    });
    await didWork(bench, 'b', 'Loosen the hero', NOW + MINUTE, async (folder) => {
      await put(folder, 'hero.css', '.hero {\n  padding: 96px;\n}\n\n.nav {\n  gap: 8px;\n}\n');
    });
    await didWork(bench, 'c', 'Warm the palette', NOW + 2 * MINUTE, async (folder) => {
      await put(folder, 'palette.css', ':root { --warm: 1; }\n');
    });

    await bench.keepSet(['a', 'b', 'c'], (piece) => `Kept ${piece.doing}`);

    expect(bench.pieces.map((one) => one.id)).toEqual(['b', 'c']);
    for (const piece of bench.pieces) {
      expect(piece.version).not.toBeNull();
      expect(piece.folder).not.toBeNull();
      expect(await there(piece.folder ?? '')).toBe(true);
    }
  });

  /** WHY: stopping halfway is only acceptable because the whole run is one
   *  press away from never having happened. Without this the choice would be
   *  indefensible. */
  it('hands back one version that undoes the whole run, however far it got', async () => {
    const { history, root, under } = await aProject();
    const bench = new Workbench({ history, under });
    const before = await history.currentVersion();

    await didWork(bench, 'a', 'Calm the hero', NOW, async (folder) => {
      await put(folder, 'hero.css', '.hero {\n  padding: 48px;\n}\n\n.nav {\n  gap: 8px;\n}\n');
    });
    await didWork(bench, 'b', 'Tighten the nav', NOW + MINUTE, async (folder) => {
      await put(folder, 'nav.css', '.nav { gap: 2px; }\n');
    });

    const took = await bench.keepSet(['a', 'b'], (piece) => `Kept ${piece.doing}`);
    expect(took.ok === false ? null : took.landed).toHaveLength(2);
    if (took.ok === false) return;
    expect(took.undoTo).toBe(before);

    await history.restoreTo(took.undoTo ?? '', 'Put it all back');
    expect(await get(root, 'hero.css')).toContain('padding: 16px');
    expect(await there(path.join(root, 'nav.css'))).toBe(false);
  });

  /** WHY: an order that cannot exist has to be refused before the first one
   *  goes in, or the refusal arrives with a project already changed. */
  it('refuses a round trip without touching the project', async () => {
    const { history, root, under } = await aProject();
    const bench = new Workbench({ history, under });

    await didWork(bench, 'a', 'Calm the hero', NOW, async (folder) => {
      await put(folder, 'hero.tsx', 'export const Hero = () => null;\n');
    });
    await didWork(bench, 'b', 'Tighten the nav', NOW + MINUTE, async (folder) => {
      await put(folder, 'nav.css', '.nav { gap: 2px; }\n');
    });

    const before = await history.currentVersion();
    const took = await bench.keepSet(['a', 'b'], (piece) => `Kept ${piece.doing}`, {
      after: (id) => (id === 'a' ? 'b' : 'a'),
    });

    expect(took.ok).toBe(false);
    expect(await history.currentVersion()).toBe(before);
    expect(await there(path.join(root, 'nav.css'))).toBe(false);
    expect(bench.pieces).toHaveLength(2);
  });

  /** WHY: the warning before the press is only worth anything if it is read off
   *  what the work actually did. Nothing else knows — the copy is gone the
   *  moment the piece is taken. */
  it('remembers what each piece changed, read while its copy still existed', async () => {
    const { history, under } = await aProject();
    const bench = new Workbench({ history, under });

    await didWork(bench, 'a', 'Calm the hero', NOW, async (folder) => {
      await put(folder, 'hero.css', '.hero {\n  padding: 48px;\n}\n\n.nav {\n  gap: 8px;\n}\n');
      await put(folder, 'hero.tsx', 'export const Hero = () => null;\n');
    });

    const piece = bench.pieces.find((one) => one.id === 'a');
    expect([...(piece?.touches ?? [])].sort()).toEqual(['hero.css', 'hero.tsx']);
  });
});
