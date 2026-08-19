/** Taking in several finished pieces of work that belong in an order.
 *
 * Four pieces finish at once and the board offers four presses. Pressed in the
 * wrong order they produce a project nobody described: the piece that was meant
 * to arrive second arrives first, against files the person building it never
 * saw. So the order is decided here, once, and the whole set goes in as one act.
 *
 * Two relations, and they are not the same thing:
 *
 *  - **The order somebody meant.** "Do this one after that one", said when the
 *    work was asked for. It is what decides who goes in first. It is *not*
 *    evidence that the second one's files contain the first one's — every copy
 *    is made from the project as it stands, so a piece that waited still began
 *    from a project without the one it waited for in it.
 *  - **The same file, twice.** Two pieces that both changed `hero.css` will meet
 *    there. It says nothing about which should go first — it is the same fact
 *    from either end — so it never decides an order. It is the reason the order
 *    matters, and it is what the person is told before they press.
 *
 * Nothing here touches a folder. `takeInOrder` walks the order and asks
 * something else to do each one, so the decision can be tested without a disk
 * and the disk work has no opinions in it.
 */

import { countWord } from './board';

/** One finished piece, as much of it as an order needs. */
export type Standing = {
  id: string;
  /** One sentence: what this piece of work did. */
  doing: string;
  /** When it was asked for, epoch ms. The tie-break. */
  at: number;
  /** Whether it has anything to hand over. */
  ready: boolean;
  /** The piece it was asked to come after, or null. */
  after: string | null;
  /** The files it changed. Null when nobody has looked. */
  touches: readonly string[] | null;
  /** The name several goes at the same thing share. */
  ways?: string | null;
};

/** Two pieces that changed the same file. Said from both ends at once, because
 *  it is one fact and neither of them is the cause of it. */
export type Meeting = {
  one: string;
  other: string;
  /** Sorted, so the sentence reads the same twice. */
  files: readonly string[];
};

export type Ordered = {
  ok: true;
  /** The order they go in, first to last. */
  order: readonly Standing[];
  /** Where two of them changed the same file. */
  meetings: readonly Meeting[];
};

export type Refused = { ok: false; because: string };

/** What came of walking the order. */
export type Took = {
  /** In they went, in this order. */
  landed: readonly string[];
  /** The one that could not go in, and what it disagreed over. Null when the
   *  whole set went in. */
  stoppedAt: { id: string; conflicted: readonly string[] } | null;
  /** Behind the one that stopped. Never tried, still there to take. */
  notReached: readonly string[];
};

/**
 * The one thing this file cannot do: put a piece of work into the project.
 *
 * Named the same way `Workbench.keep` names `lettingGo` — a callback for the
 * step that touches a folder, so the order and the walk stay testable without
 * one.
 */
export type Landing = (
  id: string,
) => Promise<{ ok: true } | { ok: false; conflicted: readonly string[] }>;

/* -------------------------------------------------------------------- words */

/** Every sentence this module can put in front of somebody, in one place so the
 *  vocabulary can be swept. */
export const stackWords = {
  /** The one press over the finished pieces. Says how many, because the whole
   *  point is that it is not one of them. */
  takeAll: (count: number): string =>
    count === 2 ? 'Take both' : `Take all ${countWord(count)}`,
  /** Under the press, said once so nobody has to try it to find out. */
  what: 'They go into your project one after another, in the order they need to be in.',
  /** The disclosure beside it: the order itself, for anybody who wants it. */
  show: 'See the order',
  hide: 'Hide the order',
  /** Over the list. */
  heading: 'The order they go in',
  /** Beside a piece in the list that was asked to come after another. */
  behind: (doing: string): string => `after “${short(doing)}”`,
  /** Beside one with nothing in front of it. Not "first" — the number already
   *  says where it comes, and three of five can be waiting for nothing. */
  alone: 'on its own',
  /** Two pieces that changed the same file, said above the list. */
  meets: (one: string, other: string, files: readonly string[]): string =>
    `“${short(one)}” and “${short(other)}” both changed ${named(files)}.`,
  /** What that means for the press, said once rather than per pair. */
  meetsWhat:
    'Whichever goes in first, the next one is fitted around it. If they changed the same lines, that one stops and the rest wait.',
  /** Nothing to take. */
  nothing: 'Nothing has finished yet.',
  /** One finished piece is not a set — it has its own press already. */
  onlyOne: 'Only one has finished, so there is no order to work out.',
  /** Asked for a piece that has not finished. */
  notReady: (doing: string): string =>
    `“${short(doing)}” has not finished, so it cannot go in with the others.`,
  /** Two goes at the same thing cannot both go in — they were alternatives. */
  alternatives: (one: string, other: string): string =>
    `“${short(one)}” and “${short(other)}” are two goes at the same thing, so only one of them can go in. Keep the one you want first.`,
  /** An order that cannot exist. Named end to end, so the sentence says which
   *  two sentences somebody has to change. */
  loop: (names: readonly string[]): string => {
    const round = names.map((one) => `“${short(one)}”`);
    const chain = round
      .slice(1)
      .map((one) => `${one} after`)
      .join(' ');
    return `${round[0] ?? ''} has to go in after ${chain} ${round[0] ?? ''}, so there is no order that works.`;
  },
  /** All of them went in. */
  allIn: (count: number): string =>
    `${capitalise(countWord(count))} went into your project, in order.`,
  /** Some of them went in and then one stopped. The count first, because that
   *  is the fact somebody is standing in front of. */
  someIn: (count: number, doing: string, files: readonly string[]): string => {
    const went =
      count === 0
        ? 'Nothing went in.'
        : count === 1
        ? 'One went into your project.'
        : `${capitalise(countWord(count))} went into your project.`;
    const clash =
      files.length === 0
        ? `Then “${short(doing)}” could not be fitted around what was already there, so it stopped.`
        : `Then “${short(doing)}” changed ${named(files)}, which something already in your project had changed too, so it stopped.`;
    return `${went} ${clash}`;
  },
  /** What is still on the board after a stop. */
  restWait: (count: number): string =>
    count === 0
      ? 'It is still here, so you can open it and decide what you want.'
      : count === 1
      ? 'It and the one behind it are still here, so nothing is lost.'
      : `It and the ${countWord(count)} behind it are still here, so nothing is lost.`,
  /** The one press that undoes the whole run, however far it got. Offered
   *  whether or not it finished — a set that landed in full is as undoable as
   *  one that stopped halfway, and that is the promise. */
  putBack: 'Put it all back',
  putBackWhat: 'Your project goes back to how it was before any of them went in.',
} as const;

function short(doing: string): string {
  const one = doing.replace(/\s+/g, ' ').trim();
  return one.length <= 60 ? one : `${one.slice(0, 59)}…`;
}

function capitalise(sentence: string): string {
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

/** Files in a sentence: three by name, then a count. Enough to recognise the
 *  file, never a list somebody has to read. */
function named(files: readonly string[]): string {
  if (files.length === 0) return 'the same file';
  const first = files.slice(0, 3).join(', ');
  return files.length <= 3 ? first : `${first} and ${countWord(files.length - 3)} more`;
}

/* ------------------------------------------------------------------- order */

/**
 * The order a set of finished pieces has to go in, or why there is none.
 *
 * Refused before anything is touched, for the same reason a wait is refused as
 * it is described: an order that cannot exist should be a sentence, never a
 * project left halfway.
 *
 * The tie-break is the order they were asked for, then the name. Two pieces
 * with nothing between them go in the order somebody wrote them, and the same
 * set lands the same way every time it is pressed.
 */
export function orderToTake(pieces: readonly Standing[]): Ordered | Refused {
  if (pieces.length === 0) return { ok: false, because: stackWords.nothing };

  const notReady = pieces.find((one) => !one.ready);
  if (notReady !== undefined) return { ok: false, because: stackWords.notReady(notReady.doing) };

  const clash = twoGoesAtOne(pieces);
  if (clash !== null) return { ok: false, because: stackWords.alternatives(clash[0], clash[1]) };

  const byId = new Map(pieces.map((one) => [one.id, one]));
  // A wait pointing outside the set is not a constraint on it: what it named is
  // either already in the project or gone, and either way nothing here waits.
  const waitsFor = (one: Standing): string | null =>
    one.after !== null && byId.has(one.after) ? one.after : null;

  const left = new Map(byId);
  const order: Standing[] = [];
  while (left.size > 0) {
    const free = [...left.values()]
      .filter((one) => {
        const on = waitsFor(one);
        return on === null || !left.has(on);
      })
      .sort(earliestFirst);
    const next = free[0];
    if (next === undefined) return { ok: false, because: stackWords.loop(loopIn(left, waitsFor)) };
    left.delete(next.id);
    order.push(next);
  }

  return { ok: true, order, meetings: meetingsIn(order) };
}

function earliestFirst(one: Standing, other: Standing): number {
  return one.at !== other.at ? one.at - other.at : one.id.localeCompare(other.id);
}

/** Two goes at the same thing, in the same set. They were alternatives to each
 *  other, so an order over them is the wrong question entirely. */
function twoGoesAtOne(pieces: readonly Standing[]): [string, string] | null {
  const seen = new Map<string, Standing>();
  for (const one of [...pieces].sort(earliestFirst)) {
    const named = one.ways;
    if (named === undefined || named === null) continue;
    const already = seen.get(named);
    if (already !== undefined) return [already.doing, one.doing];
    seen.set(named, one);
  }
  return null;
}

/** The round trip, named end to end. Every piece waits for at most one other,
 *  so following the waits from anything still stuck arrives back at itself. */
function loopIn(
  left: ReadonlyMap<string, Standing>,
  waitsFor: (one: Standing) => string | null,
): readonly string[] {
  const start = [...left.values()].sort(earliestFirst)[0];
  if (start === undefined) return [];
  const seen: Standing[] = [];
  let at: Standing | undefined = start;
  while (at !== undefined && !seen.includes(at)) {
    seen.push(at);
    const on = waitsFor(at);
    at = on === null ? undefined : left.get(on);
  }
  // Only from where the trip closes: the walk in may have started outside it.
  const from = at === undefined ? 0 : seen.indexOf(at);
  return seen.slice(from).map((one) => one.doing);
}

/**
 * Where two of them changed the same file.
 *
 * Not an order — the fact reads identically from both ends. It is what the
 * person is shown before pressing, because it is the only place the order they
 * chose can cost them anything.
 */
export function meetingsIn(pieces: readonly Standing[]): readonly Meeting[] {
  const meetings: Meeting[] = [];
  for (let index = 0; index < pieces.length; index += 1) {
    for (let other = index + 1; other < pieces.length; other += 1) {
      const here = pieces[index];
      const there = pieces[other];
      if (here === undefined || there === undefined) continue;
      const mine = new Set(here.touches ?? []);
      const files = [...new Set(there.touches ?? [])].filter((file) => mine.has(file)).sort();
      if (files.length > 0) meetings.push({ one: here.id, other: there.id, files });
    }
  }
  return meetings;
}

/* -------------------------------------------------------------------- walk */

/**
 * Walk the order, one at a time, stopping at the first that will not go.
 *
 * Stopping rather than skipping: the order exists because these were meant to
 * arrive in it, and carrying on past a gap puts work on a foundation that is
 * not there. One statement somebody can act on — everything up to here went in,
 * nothing after it did — beats a result they have to reconstruct. Anything that
 * was skipped is still a single press on its own card.
 *
 * What went in stays in. Undoing the two that landed cleanly to punish a third
 * costs somebody work they wanted, and pressing again would fail in the same
 * place having lost it. The whole run is undoable to one point instead, which
 * is the caller's job and is why it hands back what landed.
 */
export async function takeInOrder(order: readonly string[], land: Landing): Promise<Took> {
  const landed: string[] = [];
  for (let index = 0; index < order.length; index += 1) {
    const id = order[index];
    if (id === undefined) continue;
    const put = await land(id);
    if (!put.ok) {
      return {
        landed,
        stoppedAt: { id, conflicted: put.conflicted },
        notReached: order.slice(index + 1),
      };
    }
    landed.push(id);
  }
  return { landed, stoppedAt: null, notReached: [] };
}

/**
 * What happened, in a sentence.
 *
 * Never silent about a half-landed project: a set that stopped says how many
 * went in before it did, which one stopped it and over what, and that the rest
 * are still there.
 */
export function saysTook(
  took: Took,
  doingOf: (id: string) => string,
): { what: string; because: string } {
  if (took.stoppedAt === null) {
    return { what: stackWords.allIn(took.landed.length), because: stackWords.what };
  }
  return {
    what: stackWords.someIn(
      took.landed.length,
      doingOf(took.stoppedAt.id),
      took.stoppedAt.conflicted,
    ),
    because: stackWords.restWait(took.notReached.length),
  };
}
