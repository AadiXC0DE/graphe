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
 *
 * Every send goes through one door before it leaves (`src/work/admission.ts`),
 * which is also where a reason that arrived in a run since stopped is turned
 * down: a board piece or an add-on's ask is a result of that run, not a reason
 * to begin the next one.
 */

import {
  decide,
  freshContinuation,
  MOST_ROUNDS,
  personSpoke,
  type EndedHow,
  type Facts,
  type Move,
  type Piece,
  type State,
  type Why,
} from '../src/work/continuation';
import { admit, type TurnOrigin, type TurnState } from '../src/work/admission';
import { keyOf, ownerOf } from '../src/work/owner';

/** One reason queued for the next decision, with the run it came from.
 *
 * The run is what makes a late arrival safe: a piece that landed, or an add-on
 * that asked for a turn, while the person was typing belongs to a run that has
 * ended, so it is a result to read rather than a reason to send. */
type Queued<A> = { reason: A; epoch: number };

/** What one conversation is holding between settles. */
type Held = {
  state: State;
  /** The run in hand. Stop ends one and a message from the person begins the
   *  next, so nothing decided in the old run can open the new one. */
  epoch: number;
  /** Pieces that finished on the board since the last decision. */
  board: Queued<Piece>[];
  /** An add-on that asked for a turn since the last decision. */
  asked: Queued<{ from: string; text: string }> | null;
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
    const fresh: Held = {
      state: freshContinuation(),
      epoch: 0,
      board: [],
      asked: null,
      endedHow: 'finished',
    };
    held.set(key, fresh);
    return fresh;
  }

  /** What this conversation is, as the one door sees it. The round budget and
   *  the run are this owner's to answer for; the folder lease and whether
   *  anything can answer belong to the shell, which does not say. */
  function stateOf(one: Held, going: boolean): TurnState {
    return {
      run: { epoch: one.epoch, stopped: one.state.stopped },
      going,
      waitingOnPerson: one.state.waitingOnPerson,
      budget: { rounds: one.state.rounds, most: MOST_ROUNDS },
    };
  }

  /** What a message sent for this reason is. A goal round is asked for by
   *  somebody; a board piece is a child coming back; everything else is the
   *  app carrying on. */
  function originOf(why: Why): TurnOrigin {
    if (why === 'goal') return 'explicit-goal';
    if (why === 'board') return 'child-result';
    if (why === 'extension') return 'extension';
    return 'follow-up';
  }

  /** The run the reason being acted on came from. A checklist round, a goal
   *  round and a recovery round are decided now, so they belong to the run in
   *  hand; the two that arrive between settles carry the run they arrived in. */
  function askedIn(why: Why, one: Held): number {
    if (why === 'extension') return one.asked?.epoch ?? one.epoch;
    if (why === 'board') return one.board[0]?.epoch ?? one.epoch;
    return one.epoch;
  }

  return {
    async settled(project, address, how): Promise<void> {
      const one = heldFor(project, address);
      const key = keyOf(project, address);
      const facts: Facts = {
        list: await hooks.list(project, address),
        goal: await hooks.goal(project, address),
        endedHow: how,
        boardFinished: one.board.map((queued) => queued.reason),
        extensionAsked: one.asked?.reason ?? null,
      };
      const move = decide(one.state, facts);
      const asked = move.kind === 'send' ? askedIn(move.why, one) : one.epoch;
      // One event to one send, whatever the reasons present. Consumed here
      // rather than inside the decision, which has to stay pure.
      one.board = [];
      one.asked = null;

      if (move.kind === 'send') {
        /* The door. A send decided here can still be refused: the reason it is
           acting on may belong to a run that was stopped or answered since it
           arrived, and the round it would spend is only spent if it goes out. */
        const verdict = admit({ origin: originOf(move.why), epoch: asked }, stateOf(one, false));
        if (verdict.verdict === 'refused') {
          one.endedHow = how;
          last.set(key, {
            move: { kind: 'rest', said: verdict.said, state: one.state },
            at: Date.now(),
          });
          atRest.add(key);
          if (verdict.said !== '') hooks.say(project, address, verdict.said);
          hooks.tell({
            project,
            address,
            round: one.state.rounds,
            why: null,
            said: verdict.said,
            resting: true,
          });
          return;
        }
        one.state = move.state;
        one.endedHow = how;
        last.set(key, { move, at: Date.now() });
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

      one.state = move.state;
      one.endedHow = how;
      last.set(key, { move, at: Date.now() });
      atRest.add(key);
      const said = move.kind === 'stop' ? move.said : (move.said ?? '');
      if (said !== '') hooks.say(project, address, said);
      hooks.tell({ project, address, round: move.state.rounds, why: null, said, resting: true });
    },

    spoke(project, address): void {
      const one = heldFor(project, address);
      one.state = personSpoke(one.state);
      /* A message from the person begins the next run, so anything still queued
         from the one before it is no longer a reason to send — the epoch says
         so, at the door, rather than the queue being emptied by hand here. */
      one.epoch += 1;
      atRest.delete(keyOf(project, address));
    },

    stopped(project, address): void {
      const one = heldFor(project, address);
      one.state = { ...one.state, stopped: true };
      /* Stop ends the run: the shell stops the session itself, children and
         all, and what is left is everything this owns — the round budget, and
         every reason already queued, which the epoch now excludes. */
      one.epoch += 1;
      atRest.add(keyOf(project, address));
    },

    waiting(project, address, on): void {
      const one = heldFor(project, address);
      one.state = { ...one.state, waitingOnPerson: on };
    },

    landed(project, address, piece): void {
      const one = heldFor(project, address);
      if (one.board.some((held) => held.reason.id === piece.id)) return;
      one.board.push({ reason: piece, epoch: one.epoch });
    },

    extensionAsked(project, address, from, text): void {
      const one = heldFor(project, address);
      /* The turn has already begun, so this is said on the way past rather than
         asked for beforehand: the budget is checked here, an add-on that loops
         would otherwise spend the lot before anything was told, and a
         conversation with nothing running in it ends the one being started. */
      const verdict = admit({ origin: 'extension', epoch: one.epoch, from }, stateOf(one, true));
      if (verdict.verdict === 'refused') {
        atRest.add(keyOf(project, address));
        if (verdict.said !== '') {
          one.state = { ...one.state, stopped: true };
          hooks.say(project, address, verdict.said);
          hooks.tell({
            project,
            address,
            round: one.state.rounds,
            why: null,
            said: verdict.said,
            resting: true,
          });
        }
        hooks.halt(project, address);
        return;
      }
      // The most recent one wins. An add-on that asks twice before a settle is
      // asking for one turn, not two.
      one.asked = { reason: { from, text }, epoch: one.epoch };
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
