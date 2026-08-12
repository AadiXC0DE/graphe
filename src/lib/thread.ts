/** The conversation, as data.
 *
 * Lifted out of `App.tsx` when projects became switchable. The window now holds
 * one of these per open project rather than one for the window (BACKLOG B2), and
 * "nothing leaks between projects" is a claim that ought to be provable without
 * a browser — so the fold that builds a thread lives here, next to the store
 * that keeps one per folder, and both are ordinary functions over ordinary data.
 *
 * Nothing in this file draws anything. `App.tsx` still owns every pixel.
 */

import type { ActivityState } from '../components/ActivityLine';
import type { MessageAuthor } from '../components/Message';
import type { AgentEvent } from '../agent/types';
import type { Prompt } from '../cost/phrasing';
import { PLAN_WORDS } from '../agent/plan';
import { describeCall } from './describe';
import { realWords } from './showme';
import type { Decision, Trouble } from './ipc';

/**
 * One thing in the conversation, whoever caused it.
 *
 * A single ordered list rather than a message list with side channels, because
 * the order is the meaning: "I am about to change your header" only makes sense
 * above the change, and "you said no" only makes sense below the question.
 * Splitting activity out into its own pane would lose that, and it is the whole
 * reason the feed reads as one conversation instead of a log next to a chat.
 */
export type Turn =
  | { kind: 'said'; id: string; from: MessageAuthor; text: string; streaming: boolean }
  | {
      kind: 'did';
      id: string;
      callId: string;
      state: ActivityState;
      /** When it began, epoch ms. A helper's card counts up from this; without
       *  it every helper on the board claimed to have started this second. */
      at?: number;
      label: string;
      detail?: string;
      /** What the step has said for itself while running — a helper's findings
       *  as they arrive. Kept apart from `detail`, which is what it was asked:
       *  overwriting one with the other loses the question the moment the first
       *  answer arrives, and a helper with no question beside it is a card
       *  nobody can read. */
      progress?: string;
      /** The real command, path or operation behind this step. Recorded on
       *  every turn and shown only when "Show me" is on — see the note on
       *  `real` below. */
      real?: string;
    }
  | {
      kind: 'asked';
      id: string;
      callId: string;
      question: string;
      detail?: string;
      consequence?: string;
      real?: string;
      /** Null while the question is still open. */
      answered: Decision | null;
    }
  /**
   * "This is a bigger job — about ₹35 and roughly four minutes."
   *
   * COST-DESIGN §2, and the one confirmation in the product that is not about
   * safety. It holds the message somebody typed until they answer, which is why
   * the text lives on the turn: the sentence must not be lost by the window
   * while it waits, and it must not be sent by accident either.
   *
   * Only ever created above the user's own threshold. Every other request goes
   * straight through without a word — a confirmation on every small change is
   * noise, and noise gets dismissed without reading.
   */
  | {
      kind: 'estimate';
      id: string;
      /** What they asked for, held until they say go ahead. */
      text: string;
      /** Every word of it from src/cost/phrasing.ts. Nothing is written here. */
      prompt: Prompt;
      /** Null while the question is still open. */
      answered: 'went-ahead' | 'smaller' | null;
    }
  /**
   * "We've covered a lot in here. I'll tidy up my notes so things stay quick."
   *
   * One line in the conversation, in the place it happened, said once. It is a
   * `did`-shaped thing rather than a message because it is something happening
   * with a beginning and an end — the spinner is honest, and it stops.
   */
  /**
   * "Here's what I'd do." The steps, and the two answers.
   *
   * Shaped like `estimate` because it does the same job: it holds what somebody
   * asked for until they say go ahead. The difference is what it is protecting
   * them from — not the cost, but forty files changed before anybody agreed.
   */
  | {
      kind: 'plan';
      id: string;
      /** Their own words, held until they answer. */
      text: string;
      steps: readonly string[];
      caveats: readonly string[];
      /** Null while the question is still open. */
      answered: 'went-ahead' | 'changing' | null;
    }
  | { kind: 'tidying'; id: string; state: ActivityState }
  | { kind: 'trouble'; id: string; trouble: Trouble };

/** The turn that holds a message back until somebody has seen what it will
 *  cost. Named because the window passes one around. */
export type EstimateTurn = Extract<Turn, { kind: 'estimate' }>;

let counter = 0;

/** Unique for the life of the window, and deliberately not per project: two
 *  threads whose turns share ids would be two threads React cannot tell apart
 *  the moment somebody switches between them. */
export function newId(): string {
  counter += 1;
  return `turn-${counter}`;
}

export function said(from: MessageAuthor, text: string): Turn {
  return { kind: 'said', id: newId(), from, text, streaming: false };
}

export function estimated(text: string, prompt: Prompt): Turn {
  return { kind: 'estimate', id: newId(), text, prompt, answered: null };
}

/** Close off the most recent activity for a call. Returns the same array when
 *  there was nothing to close, which is how `blocked` tells the difference
 *  between "stopped something that had started" and "stopped it before it
 *  started" — the Guard does the latter, and there is no line to update. */
function closeActivity(
  turns: readonly Turn[],
  callId: string,
  state: ActivityState,
  detail?: string,
): readonly Turn[] {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (turn === undefined) continue;
    if (turn.kind !== 'did' || turn.callId !== callId || turn.state !== 'running') continue;
    const next = [...turns];
    next[index] = { ...turn, state, detail: detail ?? turn.detail };
    return next;
  }
  return turns;
}

/**
 * Add a problem, unless it is the one already on screen.
 *
 * `prompt` can report the same failure twice: the adapter relays it as an
 * `error` event on the way out, and the call itself then comes back as a
 * failure. Both are correct and neither is redundant to the code — but two
 * identical cards stacked on top of each other reads as two things having gone
 * wrong, which is exactly the impression the error copy is written to avoid.
 */
export function withTrouble(turns: readonly Turn[], trouble: Trouble): readonly Turn[] {
  const from = Math.max(0, turns.length - 3);
  for (let index = turns.length - 1; index >= from; index -= 1) {
    const turn = turns[index];
    if (turn === undefined || turn.kind !== 'trouble') continue;
    if (turn.trouble.because !== trouble.because) continue;
    // Same failure. The two tellings of it can differ in one way that matters:
    // only one carries the raw text for whoever wants to read it. Keep that one.
    if (turn.trouble.details !== undefined || trouble.details === undefined) return turns;
    const next = [...turns];
    next[index] = { ...turn, trouble };
    return next;
  }
  return [...turns, { kind: 'trouble', id: newId(), trouble }];
}

export const STOPPED_PART_WAY = 'I stopped part way through.';

/** The looking-around pass has no tool call behind it, so it borrows one id.
 *  Nothing else may use it. */
const LOOKING = 'graphe:looking';

/** Hold what somebody asked for while they read the plan for it. */
export function planned(
  text: string,
  proposal: { steps: readonly string[]; caveats: readonly string[] },
): Turn {
  return {
    kind: 'plan',
    id: newId(),
    text,
    steps: proposal.steps,
    caveats: proposal.caveats,
    answered: null,
  };
}

export function applyEvent(turns: readonly Turn[], event: AgentEvent): readonly Turn[] {
  switch (event.type) {
    case 'message-delta': {
      const last = turns[turns.length - 1];
      if (last !== undefined && last.kind === 'said' && last.from === 'graphe' && last.streaming) {
        return [...turns.slice(0, -1), { ...last, text: last.text + event.text }];
      }
      return [
        ...turns,
        { kind: 'said', id: newId(), from: 'graphe', text: event.text, streaming: true },
      ];
    }

    case 'message-end':
      return turns.map((turn) =>
        turn.kind === 'said' && turn.streaming ? { ...turn, streaming: false } : turn,
      );

    case 'tool-start': {
      const described = describeCall(event.call);
      return [
        ...turns,
        {
          kind: 'did',
          id: newId(),
          callId: event.call.id,
          state: 'running',
          at: Date.now(),
          label: described.label,
          detail: described.detail,
          // Recorded whether or not "Show me" is on, so that turning it on
          // explains the conversation you already had rather than only the one
          // you are about to have. A history that starts when you ask for it is
          // no use for working out what just happened.
          real: realWords(event.call),
        },
      ];
    }

    case 'tool-progress':
      return turns.map((turn) =>
        turn.kind === 'did' && turn.callId === event.id && turn.state === 'running'
          ? { ...turn, progress: event.text }
          : turn,
      );

    case 'tool-end':
      return closeActivity(turns, event.id, event.ok ? 'done' : 'failed');

    case 'blocked': {
      const closed = closeActivity(turns, event.call.id, 'failed', event.reason);
      if (closed !== turns) return closed;
      return [
        ...turns,
        {
          kind: 'did',
          id: newId(),
          callId: event.call.id,
          state: 'failed',
          label: describeCall(event.call).label,
          detail: event.reason,
          real: realWords(event.call),
        },
      ];
    }

    case 'needs-confirmation':
      return [
        ...turns,
        {
          kind: 'asked',
          id: newId(),
          callId: event.call.id,
          question: event.verdict.question,
          detail: event.verdict.detail,
          consequence: event.verdict.consequence,
          real: realWords(event.call),
          answered: null,
        },
      ];

    case 'error':
      return withTrouble(turns, {
        what: STOPPED_PART_WAY,
        because: event.message,
        actionLabel: 'Got it',
      });

    // The person's own words, replayed when a saved conversation comes back
    // (BACKLOG B1.1). During a live sitting the window writes these itself and
    // the shell never sends them; here they arrive as ordinary events, so a
    // rehydrated thread folds the same way a live one does.
    case 'user-said':
      return [...turns, said('you', event.text)];

    // Looking around before touching anything, said once and closed off by
    // whatever the pass came back with.
    case 'planning': {
      const already = turns.some((turn) => turn.kind === 'did' && turn.callId === LOOKING);
      return already
        ? turns
        : [
            ...turns,
            {
              kind: 'did',
              id: newId(),
              callId: LOOKING,
              state: 'running',
              label: PLAN_WORDS.working,
            },
          ];
    }

    case 'planned': {
      const closed = closeActivity(turns, LOOKING, 'done');
      // Nothing proposed is not a plan to approve — whatever it did say is
      // already in the thread above this.
      if (event.steps.length === 0) return closed;
      return [
        ...closed,
        {
          kind: 'plan',
          id: newId(),
          text: '',
          steps: event.steps,
          caveats: event.caveats,
          answered: null,
        },
      ];
    }

    case 'tidying': {
      // Once. Pi can retry its own summarisation, and each attempt announces
      // itself; three copies of "we've covered a lot in here" would be an app
      // fretting rather than an app tidying.
      const already = turns.some((turn) => turn.kind === 'tidying' && turn.state === 'running');
      return already ? turns : [...turns, { kind: 'tidying', id: newId(), state: 'running' }];
    }

    case 'tidied': {
      const index = turns.findLastIndex(
        (turn) => turn.kind === 'tidying' && turn.state === 'running',
      );
      if (index === -1) return turns;
      const next = [...turns];
      // A tidy that could not be done leaves the line saying it was tried and
      // nothing else. Nothing was lost, so there is nothing to apologise for.
      next[index] = { kind: 'tidying', id: turns[index]!.id, state: event.ok ? 'done' : 'failed' };
      return next;
    }

    // Money says nothing in the thread. It is furniture in the corner, and the
    // split behind it is shown only when somebody asks for it — a running
    // commentary on cost is the anxiety this design exists to avoid.
    case 'spend':
    case 'spend-summary':
    case 'settled':
      return turns;
  }
}
