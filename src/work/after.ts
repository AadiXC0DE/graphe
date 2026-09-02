/** Work that waits for other work, and the two ways that goes wrong.
 *
 * A board is eight things at once. A plan is eight things in an order somebody
 * meant. The whole difference is one sentence — *after that one* — and the two
 * places it fails are both here rather than at three in the morning:
 *
 *  - **It never starts.** Two pieces of work each waiting for the other is
 *    something anybody can ask for by accident. It is refused while it is being
 *    described, in a sentence saying why, and never discovered by watching a
 *    board that has stopped moving.
 *  - **It starts against nothing.** Work that follows work which did not land
 *    would be reading a project that was never changed and reporting on it as
 *    though it had been. So nothing follows what did not land, and every piece
 *    that will now never start says so on its own card.
 *
 * Nothing here starts anything. What a piece of work landing produces is the
 * next one being *asked for*: it goes on the board waiting its turn, behind
 * everything else, and meets the ceiling exactly as anything else does. That is
 * what keeps a plan from being a way round either.
 */

import type { WorkState } from './board';

/** One piece of work waiting for another. */
export type Follower = {
  id: string;
  doing: string;
  /** When it was asked for, epoch ms. */
  at: number;
  /** The piece of work it comes after. */
  after: string;
  /** The conversation that asked for the plan, carried through so the answer
   *  reaches whoever is waiting on it. */
  startedBy?: string | null;
};

export type Allowed = { ok: true } | { ok: false; because: string };

/** Allowed, and whether there is anything left to wait for: what it was asked
 *  to follow may already have finished, and then the answer is simply to start. */
export type Asked = { ok: true; waits: boolean } | { ok: false; because: string };

/** Every sentence this module can put in front of somebody, in one place so the
 *  vocabulary can be swept. */
export const afterWords = {
  /** On the card, under what it is going to do. */
  waits: (doing: string): string => `After “${short(doing)}”`,
  /** The press beside "Start it", the heading over the choice, and the line
   *  under it — said once, so nobody has to try it to find out what it does. */
  start: 'Start it after another',
  pick: 'Which one should it wait for?',
  what: 'It waits until the one you pick has finished, then starts on its own.',
  /** Letting one off its wait. */
  free: 'Start it now instead',
  /** The first option in the list, which is no wait at all. Said as an answer
   *  to the question above it, not as a repeat of the button below. */
  noWait: 'Nothing: start it straight away',
  itself: 'This would be waiting for itself, so it could never start.',
  loop: 'These would end up waiting for each other, so neither could ever start.',
  missing: 'I could not find the one you asked it to wait for.',
  underway: 'This is already going, so it cannot be made to wait.',
  over: 'This has already finished, so there is nothing left for it to wait for.',
  brokeAlready: 'The one you asked it to wait for didn’t work, so nothing can follow it.',
  /** What a card says once the one in front of it did not land. */
  broke: 'The one this was waiting for didn’t work, so this didn’t start.',
  thrownAway: 'The one this was waiting for was thrown away, so this didn’t start.',
  neverStarted: 'The one this was waiting for never started, so this didn’t either.',
} as const;

function short(doing: string): string {
  const one = doing.replace(/\s+/g, ' ').trim();
  return one.length <= 60 ? one : `${one.slice(0, 59)}…`;
}

/**
 * The board, as much of it as this file needs.
 *
 * `ask` is deliberately not "start": what comes next joins the queue like
 * anything else and waits for room and for the ceiling, which is what keeps a
 * plan from being a way round either.
 */
export type Board = {
  /** Put a piece of work on the board, waiting its turn. */
  ask: (doing: string, where: { id: string; at: number; startedBy?: string | null }) => void;
  /** Put one on the board that will never run, and why. */
  stopped: (id: string, trouble: string) => void;
  /** Where one already on the board has got to, or null when it has none. */
  stateOf: (id: string) => WorkState | null;
};

/** What moved, so the caller can write each of them down. */
export type Moved = { started: readonly string[]; stopped: readonly string[] };

/** Where a piece of work has got to, as far as this file cares. */
type Stage = 'unknown' | 'waiting' | 'going' | 'landed' | 'broken';

function stageOf(state: WorkState | null): Stage {
  if (state === null) return 'unknown';
  if (state === 'waiting') return 'waiting';
  if (state === 'running' || state === 'needs-you') return 'going';
  return state === 'done' ? 'landed' : 'broken';
}

/**
 * What is waiting for what.
 *
 * It answers three questions and nothing else: may this wait for that, what may
 * be asked for now that this has landed, and what will never happen now that it
 * has not. Everything it holds is work with no copy of the project and no turn
 * yet — the moment it has either, the board owns it and this does not.
 */
export class Following {
  readonly #waiting = new Map<string, Follower>();
  readonly #board: Board;

  constructor(board: Board) {
    this.#board = board;
  }

  /** Everything waiting for something else, oldest first — the order they were
   *  asked for, which is the order they will get their turn in. */
  get waiting(): readonly Follower[] {
    return [...this.#waiting.values()].sort((one, other) => one.at - other.at);
  }

  one(id: string): Follower | null {
    return this.#waiting.get(id) ?? null;
  }

  /**
   * Whether one piece of work may be made to wait for another.
   *
   * Answered before anything is written down, so a plan that could never run is
   * refused as it is described rather than found later by nothing happening.
   */
  could(id: string, after: string): Allowed {
    if (id === after) return { ok: false, because: afterWords.itself };
    const theirs = this.#stage(after);
    if (theirs === 'unknown') return { ok: false, because: afterWords.missing };
    if (theirs === 'broken') return { ok: false, because: afterWords.brokeAlready };
    const ours = this.#stage(id);
    if (ours === 'going') return { ok: false, because: afterWords.underway };
    if (ours === 'landed' || ours === 'broken') return { ok: false, because: afterWords.over };
    if (this.#reaches(after, id)) return { ok: false, because: afterWords.loop };
    return { ok: true };
  }

  /** Write one down as waiting. `waits: false` means what it was asked to follow
   *  is already done, so there is nothing to hold it back. */
  hold(one: { id: string; doing: string; at: number; after: string; startedBy?: string | null }): Asked {
    const allowed = this.could(one.id, one.after);
    if (!allowed.ok) return allowed;
    if (this.#stage(one.after) === 'landed') return { ok: true, waits: false };
    this.#waiting.set(one.id, { ...one, doing: one.doing.trim() });
    return { ok: true, waits: true };
  }

  /**
   * One has finished, one way or the other.
   *
   * Landed, and what was waiting for it is asked for — one step only, because
   * what follows *those* is waiting for them and not for this. Did not land, or
   * was thrown away, and nothing behind it happens at all.
   */
  finished(id: string): Moved {
    const state = this.#board.stateOf(id);
    if (state !== 'done') {
      return {
        started: [],
        stopped: this.stopFollowing(id, state === null ? afterWords.thrownAway : afterWords.broke),
      };
    }
    const free = this.waiting.filter((one) => one.after === id);
    for (const one of free) {
      this.#waiting.delete(one.id);
      this.#board.ask(one.doing, { id: one.id, at: one.at, startedBy: one.startedBy ?? null });
    }
    return { started: free.map((one) => one.id), stopped: [] };
  }

  /**
   * Nothing follows this one. Everything behind it, however far back, goes on
   * the board saying why it will never start.
   *
   * On the board rather than quietly dropped: a plan that stopped is something
   * somebody has to be able to see. The ones immediately behind are told what
   * actually happened; the rest are told the truth about themselves, which is
   * that what they were waiting for never started.
   */
  stopFollowing(id: string, because: string): readonly string[] {
    const fallen: string[] = [];
    let front = [id];
    let reason = because;
    while (front.length > 0) {
      const next: string[] = [];
      for (const one of this.waiting) {
        if (!front.includes(one.after)) continue;
        this.#waiting.delete(one.id);
        this.#board.ask(one.doing, { id: one.id, at: one.at, startedBy: one.startedBy ?? null });
        this.#board.stopped(one.id, reason);
        fallen.push(one.id);
        next.push(one.id);
      }
      front = next;
      reason = afterWords.neverStarted;
    }
    return fallen;
  }

  /** Take one out of the waiting, whatever becomes of it next. */
  take(id: string): Follower | null {
    const one = this.#waiting.get(id) ?? null;
    this.#waiting.delete(id);
    return one;
  }

  #stage(id: string): Stage {
    if (this.#waiting.has(id)) return 'waiting';
    return stageOf(this.#board.stateOf(id));
  }

  /** Whether following the waits from one reaches the other. The visited set is
   *  what keeps a shape that should be impossible from spinning anyway. */
  #reaches(from: string, target: string): boolean {
    const seen = new Set<string>();
    let at: string | undefined = from;
    while (at !== undefined && !seen.has(at)) {
      if (at === target) return true;
      seen.add(at);
      at = this.#waiting.get(at)?.after;
    }
    return false;
  }
}
