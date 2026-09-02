/** A model that says exactly what it is told to, in the events the adapter emits.
 *
 * Every other test in this tree checks one function. This is the transport that
 * lets a whole turn run — the reply, the tool calls, the settle and the busy
 * flag — with no provider, no network and no clock behind it.
 *
 * A tool call comes out as `tool-start` and `tool-end` with nothing on the end:
 * what a step tool answers depends on the list, and the list belongs to the
 * harness. It fills the answer in as it replays.
 */

import { parseProposal } from '../../src/agent/plan';
import type { AgentEvent, SettledHow } from '../../src/agent/types';

/** One reply: what it says, what it calls, and how it ends. */
export type Scripted = {
  says?: string;
  calls?: { name: string; input?: unknown }[];
  how?: SettledHow;
  /** Seconds waited out because the provider could not answer. */
  waits?: number;
  /** A look-around before anything changes; the reply is read back as a plan. */
  looks?: boolean;
  /** What went wrong, when `how` is `failed`. */
  trouble?: string;
};

export type FakeModel = {
  /** The whole stream for one reply. Rounds past the script settle saying
   *  nothing, which is what a model with nothing left to add does. */
  events: (round: number) => readonly AgentEvent[];
  turns: number;
};

/** Small enough that a reply arrives in several pieces, as a real one does. */
const CHUNK = 24;

function deltas(text: string): readonly AgentEvent[] {
  const out: AgentEvent[] = [];
  for (let at = 0; at < text.length; at += CHUNK) {
    out.push({ type: 'message-delta', text: text.slice(at, at + CHUNK) });
  }
  return out;
}

function asInput(input: unknown): Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
}

export function fakeModel(script: readonly Scripted[]): FakeModel {
  const events = (round: number): readonly AgentEvent[] => {
    const turn = script[round];
    const out: AgentEvent[] = [{ type: 'busy', on: true }];
    if (turn === undefined) {
      out.push({ type: 'message-end' }, { type: 'settled', how: 'finished' }, { type: 'busy', on: false });
      return out;
    }

    if (turn.waits !== undefined) {
      out.push({ type: 'holding', seconds: turn.waits }, { type: 'held', ok: true });
    }
    if (turn.looks === true) out.push({ type: 'planning' });

    const said = turn.says ?? '';
    out.push(...deltas(said));

    const how = turn.how ?? 'finished';
    // A run that was ended rather than one that ended leaves its steps open:
    // nothing reports back, which is exactly what the window has to survive.
    const ended = how === 'stopped';
    for (const [at, call] of (turn.calls ?? []).entries()) {
      const id = `r${String(round)}-c${String(at)}`;
      out.push({ type: 'tool-start', call: { id, name: call.name, input: asInput(call.input) } });
      if (!ended) out.push({ type: 'tool-end', id, ok: true });
    }

    if (how === 'failed') {
      out.push({ type: 'error', message: turn.trouble ?? 'The provider stopped answering.' });
    } else if (!ended) {
      out.push({ type: 'message-end' });
    }

    if (turn.looks === true) out.push({ type: 'planned', ...parseProposal(said) });
    out.push({ type: 'settled', how }, { type: 'busy', on: false });
    return out;
  };

  return { events, turns: script.length };
}
