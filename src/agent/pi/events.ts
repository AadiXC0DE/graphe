/** Pi's event stream, read into ours.
 *
 * This file is the only place that knows what Pi's events look like, and it
 * knows it *structurally* — it imports nothing, from Pi or anywhere else except
 * our own contracts. That is deliberate. Pi is pre-1.0 and has already renamed
 * its session, auth and package entry points three times in six weeks
 * (notes/strategy/ARCHITECTURE.md, decision 2). A translation layer that depends
 * on Pi's declared types breaks at compile time on every one of those renames
 * and tells us nothing about whether the payload actually changed. One that
 * reads fields defensively keeps working when a neighbouring type moves, and
 * fails in one obvious place when the payload itself changes.
 *
 * It also means every test in this area is a plain object literal. No model, no
 * credentials, no network.
 *
 * ## Why `tool-start` is not translated
 *
 * Pi emits `tool_execution_start` *before* it asks the Guard whether the call may
 * run at all — the agent loop announces the call, then calls `beforeToolCall`,
 * then executes. Translating that event directly would mean the user sees
 * "running the delete" a beat before they see "I stopped the delete". So the
 * relay below emits `tool-start` itself, from the Guard, once the verdict is in,
 * and drops the `tool-end` that Pi reports for a call it never ran.
 *
 * The invariant that buys us: every `tool-end` has a `tool-start` before it, and
 * a blocked call produces exactly one `blocked` and nothing else.
 */

import type { AgentEvent, ToolCall, Verdict } from '../types';
import { SpendWatch, type SpendReport } from './spend';

type ConfirmVerdict = Extract<Verdict, { kind: 'confirm' }>;

/* -------------------------------------------------------------------------- */
/* Reading someone else's payload                                              */
/* -------------------------------------------------------------------------- */

type Fields = Readonly<Record<string, unknown>>;

function fieldsOf(value: unknown): Fields | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Fields;
}

function textAt(source: Fields, key: string): string | null {
  const value = source[key];
  return typeof value === 'string' && value !== '' ? value : null;
}

function flagAt(source: Fields, key: string): boolean | null {
  const value = source[key];
  return typeof value === 'boolean' ? value : null;
}

function nestedAt(source: Fields, key: string): Fields | null {
  return fieldsOf(source[key]);
}

/** Said when the engine failed and gave us nothing to repeat. Never a stack
 *  trace, never a model name — research/03 §4 on the words we do not use. */
const UNEXPLAINED = 'Something went wrong on my side, and I have stopped where I was.';

/** Pi has carried the failure text on the event, on a nested message, and on a
 *  nested error object across versions. Look in all three before giving up. */
function troubleIn(source: Fields): string {
  const nested = nestedAt(source, 'error');
  return (
    textAt(source, 'errorMessage') ??
    (nested === null ? null : textAt(nested, 'errorMessage')) ??
    textAt(source, 'reason') ??
    UNEXPLAINED
  );
}

/* -------------------------------------------------------------------------- */
/* One event in, one event out                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Translate one event from Pi's session stream into ours, or null when it has
 * no counterpart on our side.
 *
 * Null is the common answer and that is fine: Pi emits turn boundaries,
 * compaction notices, retry schedules, queue updates and thinking deltas, none
 * of which belong in a designer's activity feed.
 */
export function translatePiEvent(event: unknown): AgentEvent | null {
  const source = fieldsOf(event);
  if (source === null) return null;

  switch (textAt(source, 'type')) {
    case 'message_update':
      return fromMessageUpdate(source);
    case 'message_end':
      return fromMessageEnd(source);
    case 'tool_execution_update':
      return fromToolExecutionUpdate(source);
    case 'tool_execution_end':
      return fromToolExecutionEnd(source);
    case 'compaction_start':
      // Pi's own tidying of a long conversation, whichever side asked for it:
      // `reason` is 'manual' when we did, 'threshold' or 'overflow' when Pi
      // decided by itself. The user is told the same thing either way, because
      // from where they are sitting it is the same event — and narrating only
      // the half we caused would mean the app occasionally goes quiet for
      // twenty seconds with no explanation.
      return { type: 'tidying' };

    case 'compaction_end':
      // Aborted or failed is not a failure anybody needs to act on. Nothing was
      // lost, the conversation is simply still long, and Pi will try again at
      // its own threshold.
      return {
        type: 'tidied',
        ok: flagAt(source, 'aborted') !== true && textAt(source, 'errorMessage') === null,
      };

    case 'agent_settled':
      // Not "the reply is finished" — that is `message_end`. This is "there is
      // nothing left running", which is the only honest moment to add up what a
      // sitting cost.
      return { type: 'settled' };
    default:
      return null;
  }
}

function fromMessageUpdate(source: Fields): AgentEvent | null {
  const inner = nestedAt(source, 'assistantMessageEvent');
  if (inner === null) return null;

  switch (textAt(inner, 'type')) {
    case 'text_delta': {
      const text = textAt(inner, 'delta');
      return text === null ? null : { type: 'message-delta', text };
    }
    case 'error':
      return { type: 'error', message: troubleIn(inner) };
    default:
      // Thinking and tool-argument deltas. The user is told what is happening
      // in our words, from `tool-start`, not by watching the model type JSON.
      return null;
  }
}

function fromMessageEnd(source: Fields): AgentEvent | null {
  const message = nestedAt(source, 'message');
  if (message === null) return null;
  // Tool results and user messages come through here too. Only the assistant's
  // own message ending means "I have finished saying this".
  if (textAt(message, 'role') !== 'assistant') return null;

  const failure = textAt(message, 'errorMessage');
  if (failure !== null) return { type: 'error', message: failure };
  return { type: 'message-end' };
}

/** Pi carries a tool's partial result in the shape a tool result takes — an
 *  object whose text lives in `content` entries. A bare string was sent in an
 *  earlier version, so both are read. This is the whole channel a spawned
 *  helper's words travel on; dropping it is what made a finished helper report
 *  "Nothing said yet". */
function partialTextOf(value: unknown): string | null {
  if (typeof value === 'string') return value === '' ? null : value;
  const fields = fieldsOf(value);
  if (fields === null) return null;
  const content = fields['content'];
  if (!Array.isArray(content)) return null;
  let said = '';
  for (const entry of content) {
    const item = fieldsOf(entry);
    if (item === null || textAt(item, 'type') !== 'text') continue;
    const text = textAt(item, 'text');
    if (text !== null) said += text;
  }
  return said === '' ? null : said;
}

/** Everything the step has said so far, whole. The feed shows one line of it
 *  and the helper board shows all of it, so the trimming belongs where it is
 *  drawn rather than here — cutting it at the seam left the board with a
 *  finished helper and no findings. */
function fromToolExecutionUpdate(source: Fields): AgentEvent | null {
  const id = textAt(source, 'toolCallId');
  if (id === null) return null;
  const partial = partialTextOf(source['partialResult']);
  if (partial === null) return null;
  const said = partial.trim();
  if (said === '') return null;
  return { type: 'tool-progress', id, text: said };
}

function fromToolExecutionEnd(source: Fields): AgentEvent | null {
  const id = textAt(source, 'toolCallId');
  if (id === null) return null;
  return { type: 'tool-end', id, ok: flagAt(source, 'isError') !== true };
}

/* -------------------------------------------------------------------------- */
/* The stream the app sees                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Everything the host hears about, in one place.
 *
 * Two sources feed it: Pi's own stream, through `fromPi`, and the Guard, through
 * `started` / `blocked` / `asking`. Keeping both behind one object is what lets
 * the ordering rule above be a property of this file rather than a convention
 * the adapter has to remember.
 */
export type RelayOptions = {
  /** Pi's own running total for the session, in whole currency units, or null
   *  when it cannot be read. Consulted once, when everything settles, so what
   *  the meter shows and what the account is billed cannot drift apart. */
  billedSoFar?: () => number | null;
  /** Overridable for a test. There is one per session otherwise. */
  spend?: SpendWatch;
};

export class EventRelay {
  /** Calls the Guard let through and Pi has not finished yet. */
  private readonly running = new Set<string>();
  /** Calls the Guard stopped. Pi still reports a result for these. */
  private readonly refused = new Set<string>();
  /** Whose fault the money was. See spend.ts. */
  private readonly spend: SpendWatch;
  private readonly billedSoFar: (() => number | null) | undefined;

  constructor(
    private readonly deliver: (event: AgentEvent) => void,
    options: RelayOptions = {},
  ) {
    this.spend = options.spend ?? new SpendWatch();
    this.billedSoFar = options.billedSoFar;
  }

  /** A call that passed the Guard and is about to run. */
  started(call: ToolCall): void {
    this.refused.delete(call.id);
    this.running.add(call.id);
    this.spend.started(call);
    this.deliver({ type: 'tool-start', call });
  }

  /** A call that will not run, and the plain-language reason it will not. */
  blocked(call: ToolCall, reason: string): void {
    this.running.delete(call.id);
    this.refused.add(call.id);
    this.spend.refused(call.id);
    this.deliver({ type: 'blocked', call, reason });
  }

  /** A question for the person. Emitted before anything waits on the answer. */
  asking(call: ToolCall, verdict: ConfirmVerdict): void {
    this.deliver({ type: 'needs-confirmation', call, verdict });
  }

  failed(message: string): void {
    this.deliver({ type: 'error', message });
  }

  /** One event straight out of Pi. Silently drops what is not ours. */
  fromPi(event: unknown): void {
    // Every event, priced or not: what failed and what Pi is retrying are told
    // by events that have no money on them at all.
    const report = this.spend.fromPi(event);
    const translated = translatePiEvent(event);

    if (translated !== null && translated.type === 'settled') {
      // Before, not after. Whoever is keeping the ledger has to have every
      // entry in hand by the time it is asked for the split.
      this.paid(this.spend.settle(this.billedSoFar?.() ?? null));
      this.deliver(translated);
      return;
    }

    this.paid(report);
    if (translated === null) return;

    if (translated.type === 'tool-end') {
      // Pi reports a blocked call as a failed one, because that is what the
      // model is told. The user has already read why it was stopped; a second
      // line saying it failed is noise, and worse, it reads like our fault.
      if (this.refused.delete(translated.id)) return;
      // A result for something we never announced. Nothing to close off.
      if (!this.running.delete(translated.id)) return;
    }

    this.deliver(translated);
  }

  /** Money, said in money. Nothing else about how it was worked out survives
   *  this line — see usage.ts. */
  private paid(report: SpendReport | null): void {
    if (report === null) return;
    this.deliver({
      type: 'spend',
      amount: report.amount,
      label: report.label,
      reason: report.reason,
    });
  }
}
