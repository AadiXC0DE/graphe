/** The one thing allowed to send a message the person did not type.
 *
 * Before this there were three: a carry-on loop in the window, a goal loop
 * beside it keyed three different ways, and whatever an add-on decided to do on
 * its own. Each fired on the same settle, none knew the other two existed, and
 * the conversation got two or three turns for one reply — or none at all, when
 * they cancelled each other out.
 *
 * The decision itself is pure and lives in `src/work/continuation.ts`. This is
 * the part that cannot be: it holds one state per conversation, hears what the
 * adapter says, and owns the single path a message goes out by — set the job so
 * the tab spins, record the words as the app's own so the waiting line leaves
 * them out, and say out loud what it is doing and why.
 */

import {
  decide,
  extensionOverBudget,
  freshContinuation,
  personSpoke,
  type EndedHow,
  type Facts,
  type Move,
  type Piece,
  type State,
  type Why,
} from '../src/work/continuation';
import { keyOf, ownerOf } from '../src/work/owner';

/** What one conversation is holding between settles. */
type Held = {
  state: State;
  /** Pieces that finished on the board since the last decision. */
  board: Piece[];
  /** An add-on that asked for a turn since the last decision. */
  asked: { from: string; text: string } | null;
  /** How the run that is ending ended, as the adapter reported it. */
  endedHow: EndedHow;
};

/** What the window is told each time this decides something. Drawn as the one
 *  line under the reply — "Step 4 of 12 · carrying on" — with a Stop beside it. */
export type Continuation = {
  project: string;
  address: string;
  round: number;
  why: Why | null;
  said: string;
  /** Whether the job is at rest: nothing more is going out by itself. */
  resting: boolean;
};

export type ListNow = {
  done: number;
  total: number;
  next: string | null;
  finished: boolean;
};

export type GoalNow = { met: boolean; reason: string; objective?: string };

export type OwnerHooks = {
  /** Send on the person's behalf. Everything the screen depends on happens here
   *  and nowhere else. */
  send: (project: string, address: string, text: string, why: Why) => void;
  /** Say something in the conversation. */
  say: (project: string, address: string, text: string) => void;
  /** Tell the window where the loop has got to. */
  tell: (one: Continuation) => void;
  /** The list as it stands, for the decision. */
  list: (project: string, address: string) => Promise<ListNow | null>;
  /** The goal as it stands, or null when there is none. */
  goal: (project: string, address: string) => Promise<GoalNow | null>;
  /** Stop the run that is going. Only an add-on's turn needs this: it has
   *  already begun, so refusing it means ending it. */
  halt: (project: string, address: string) => void;
};

export type ContinuationOwner = {
  /** A run has settled. The one moment a decision is taken. */
  settled: (project: string, address: string, how: EndedHow) => Promise<void>;
  /** The person typed something, so the budget starts again. */
  spoke: (project: string, address: string) => void;
  /** The person pressed Escape. */
  stopped: (project: string, address: string) => void;
  /** A question card, plan card or helper decision opened or closed. */
  waiting: (project: string, address: string, on: boolean) => void;
  /** A board piece finished. */
  landed: (project: string, address: string, piece: Piece) => void;
  /** An add-on asked for a turn of its own. */
  extensionAsked: (project: string, address: string, from: string, text: string) => void;
  /** What this conversation last decided, for the diagnostics. */
  lastMove: (project: string, address: string) => { move: Move; at: number } | null;
  /** Whether the job is at rest. Everything that used to run per settle runs on
   *  this instead, so it runs once per job rather than once per round. */
  resting: (project: string, address: string) => boolean;
  forget: (project: string, address?: string) => void;
};

export function continuationOwner(hooks: OwnerHooks): ContinuationOwner {
  const held = new Map<string, Held>();
  const last = new Map<string, { move: Move; at: number }>();
  const atRest = new Set<string>();

  function heldFor(project: string, address: string): Held {
    const key = keyOf(project, address);
    const found = held.get(key);
    if (found !== undefined) return found;
    const fresh: Held = { state: freshContinuation(), board: [], asked: null, endedHow: 'finished' };
    held.set(key, fresh);
    return fresh;
  }

  return {
    async settled(project, address, how): Promise<void> {
      const one = heldFor(project, address);
      const key = keyOf(project, address);
      const facts: Facts = {
        list: await hooks.list(project, address),
        goal: await hooks.goal(project, address),
        endedHow: how,
        boardFinished: one.board,
        extensionAsked: one.asked,
      };
      const move = decide(one.state, facts);
      last.set(key, { move, at: Date.now() });
      // One event to one send, whatever the reasons present. Consumed here
      // rather than inside the decision, which has to stay pure.
      one.board = [];
      one.asked = null;
      one.state = move.state;
      one.endedHow = how;

      if (move.kind === 'send') {
        atRest.delete(key);
        hooks.say(project, address, move.said);
        hooks.tell({
          project,
          address,
          round: move.state.rounds,
          why: move.why,
          said: move.said,
          resting: false,
        });
        hooks.send(project, address, move.text, move.why);
        return;
      }

      atRest.add(key);
      const said = move.kind === 'stop' ? move.said : (move.said ?? '');
      if (said !== '') hooks.say(project, address, said);
      hooks.tell({ project, address, round: move.state.rounds, why: null, said, resting: true });
    },

    spoke(project, address): void {
      const one = heldFor(project, address);
      one.state = personSpoke(one.state);
      one.board = [];
      one.asked = null;
      atRest.delete(keyOf(project, address));
    },

    stopped(project, address): void {
      const one = heldFor(project, address);
      one.state = { ...one.state, stopped: true };
      atRest.add(keyOf(project, address));
    },

    waiting(project, address, on): void {
      const one = heldFor(project, address);
      one.state = { ...one.state, waitingOnPerson: on };
    },

    landed(project, address, piece): void {
      const one = heldFor(project, address);
      if (!one.board.some((other) => other.id === piece.id)) one.board.push(piece);
    },

    extensionAsked(project, address, from, text): void {
      const one = heldFor(project, address);
      // The turn has already begun, so the budget is checked here rather than
      // on the settle: an add-on that loops would otherwise spend it all first
      // and be told afterwards.
      const over = extensionOverBudget(one.state);
      if (over !== null) {
        one.state = over.state;
        atRest.add(keyOf(project, address));
        hooks.say(project, address, over.said);
        hooks.tell({
          project,
          address,
          round: over.state.rounds,
          why: null,
          said: over.said,
          resting: true,
        });
        hooks.halt(project, address);
        return;
      }
      // The most recent one wins. An add-on that asks twice before a settle is
      // asking for one turn, not two.
      one.asked = { from, text };
    },

    lastMove(project, address): { move: Move; at: number } | null {
      return last.get(keyOf(project, address)) ?? null;
    },

    resting(project, address): boolean {
      return atRest.has(keyOf(project, address));
    },

    forget(project, address): void {
      if (address !== undefined) {
        const key = keyOf(project, address);
        held.delete(key);
        last.delete(key);
        atRest.delete(key);
        return;
      }
      for (const key of [...held.keys()]) {
        if (ownerOf(key).project !== project) continue;
        held.delete(key);
        last.delete(key);
        atRest.delete(key);
      }
    },
  };
}
