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
import { describeCall } from './describe';
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
  | { kind: 'did'; id: string; callId: string; state: ActivityState; label: string; detail?: string }
  | {
      kind: 'asked';
      id: string;
      callId: string;
      question: string;
      detail?: string;
      consequence?: string;
      /** Null while the question is still open. */
      answered: Decision | null;
    }
  | { kind: 'trouble'; id: string; trouble: Trouble };

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
          label: described.label,
          detail: described.detail,
        },
      ];
    }

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
          answered: null,
        },
      ];

    case 'error':
      return withTrouble(turns, {
        what: STOPPED_PART_WAY,
        because: event.message,
        actionLabel: 'Got it',
      });

    // Money says nothing in the thread. It is furniture in the corner, and the
    // split behind it is shown only when somebody asks for it — a running
    // commentary on cost is the anxiety this design exists to avoid.
    case 'spend':
    case 'spend-summary':
    case 'settled':
      return turns;
  }
}
