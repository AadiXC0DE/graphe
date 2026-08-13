/** Who the money went on: the work the user asked for, or our own mess.
 *
 * notes/strategy/COST-DESIGN.md §3 is the reason this file exists, and it is the
 * one number in the product no competitor can ever print, because for all of
 * them the retries *are* the revenue:
 *
 *     Today: $1.20
 *     $0.85 building what you asked for
 *     $0.35 on attempts that didn't work — mostly me retrying the contact form
 *
 * That sentence is only worth showing if the split behind it is real, so it is
 * worth being exact about what the split is made of.
 *
 * ## The two signals, and how much each is worth
 *
 * **Pi says it is retrying.** `auto_retry_start` / `auto_retry_end` are Pi's own
 * announcement that a request failed — overloaded, rate limited, a dropped
 * stream — and that it is going round again. There is no interpretation here at
 * all: while that is open, anything billed is a second attempt at something we
 * already paid for. Certain.
 *
 * **A tool call failed, and the model is now dealing with it.** Pi runs the
 * tools an assistant message asked for, feeds the results back, and the model
 * replies to them. So when a tool call errored since the last assistant message
 * ended, the message that just ended is the model reacting to that failure, and
 * what it cost is what the failure cost. Strong, and not perfect — see below.
 *
 * ## Where the second signal is wrong, in both directions
 *
 * It **over-counts** when a failing tool call was not our mistake: the test
 * suite the agent was asked to run comes back red, `read` is pointed at a file
 * that genuinely is not there. The model's next turn is then charged as a retry
 * when it was the job all along.
 *
 * It **under-counts** the expensive case: an edit that succeeds, is wrong, and
 * is quietly redone three turns later. Nothing failed, so nothing here notices.
 * That is the honest limit of what the event stream can tell us — knowing that
 * an edit was *wrong* means judging the work, not watching it.
 *
 * Two things keep it from drifting. A call the Guard blocked is never counted:
 * Pi reports a block to the model as a tool error, but the user said no, and
 * billing our own safety net to "attempts that didn't work" would be a lie in
 * the flattering direction. And a failure is spent once — it explains the very
 * next message and is then cleared, so one bad `bash` cannot mark the rest of a
 * session as waste.
 *
 * The net effect is a number that is honest about the shape of a session and
 * approximate about the last few percent. Given the alternative on the market
 * is no number at all, that is the right trade — but it is a trade, and it
 * should be described to users as "roughly", never as an audit.
 */

import type { Money, SittingUsage, SpendReason, ToolCall } from '../types';
import { describeCall } from '../../lib/describe';
import {
  PI_CURRENCY,
  Purse,
  cacheHitShare,
  shortModelName,
  usageOfPiMessage,
} from './usage';

/** What we call a stretch of work when nothing more specific has happened yet.
 *  Reads correctly both on its own and spliced into "mostly me retrying …". */
export const DEFAULT_SPEND_LABEL = 'Working on what you asked for';

export type SpendReport = {
  amount: Money;
  label: string;
  reason: SpendReason;
};

type Attempt = {
  /** Same tool, same arguments — the same action tried twice. */
  signature: string;
  label: string;
};

type Fields = Readonly<Record<string, unknown>>;

function fieldsOf(value: unknown): Fields | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Fields;
}

function textAt(source: Fields, key: string): string | null {
  const value = source[key];
  return typeof value === 'string' && value !== '' ? value : null;
}

/** Stable enough to spot the same action twice, and it never leaves this file —
 *  it carries the user's own arguments and has no business anywhere near a
 *  screen or a log. */
function signatureOf(call: ToolCall): string {
  try {
    return `${call.name}:${JSON.stringify(call.input)}`;
  } catch {
    return `${call.name}:?`;
  }
}

/**
 * Watches the stream and answers one question: whose fault was that?
 *
 * Fed both from the Guard (which knows what a call was and whether it was
 * allowed to run) and from Pi's raw events (which know what failed and what it
 * cost). Holds no Pi types — see the note at the top of events.ts for why every
 * payload here is read field by field.
 */
export class SpendWatch {
  readonly #purse: Purse;
  /** Tool calls the Guard let through, by id, so a result can be named. */
  readonly #open = new Map<string, Attempt>();
  /** Calls the Guard stopped. Their failure is a decision, not a mistake. */
  readonly #refused = new Set<string>();
  /** Failures since the last assistant message ended — what it was replying to. */
  #unresolved: Attempt[] = [];
  /** How often each action has failed. Names the thing in "mostly me retrying …". */
  readonly #failures = new Map<string, number>();
  /** Pi's own retry, in flight. */
  #retrying = false;
  /** The last thing we were seen doing, for a turn with no tool calls in it. */
  #doing: string = DEFAULT_SPEND_LABEL;
  /** Prompt-side counts from Pi, for the cache-hit share. Never shown as counts. */
  #input = 0;
  #output = 0;
  #cacheRead = 0;
  #cacheWrite = 0;
  /** True once any turn reported a non-zero cache field — otherwise a 0% hit
   *  would mean "this provider does not cache", not "nothing hit". */
  #sawCache = false;
  /** Whole currency units billed per model name, for "which model most". */
  readonly #byModel = new Map<string, number>();

  constructor(options: { currency?: string } = {}) {
    this.#purse = new Purse(options.currency ?? PI_CURRENCY);
  }

  get currency(): string {
    return this.#purse.currency;
  }

  /** How this sitting used the model so far. Safe to call any time. */
  usage(): SittingUsage {
    const reused = cacheHitShare({
      input: this.#input,
      cacheRead: this.#cacheRead,
      cacheWrite: this.#cacheWrite,
    });
    const rows = [...this.#byModel.entries()]
      .map(([name, major]) => ({ name, major }))
      .sort((a, b) => b.major - a.major || a.name.localeCompare(b.name));
    const total = rows.reduce((sum, one) => sum + one.major, 0);
    const byModel =
      total <= 0
        ? []
        : rows.map((one) => ({
            name: one.name,
            share: one.major / total,
          }));
    return {
      reusedShare: this.#sawCache ? reused : null,
      mostUsed: byModel[0]?.name ?? null,
      byModel,
    };
  }

  /** A call the Guard allowed. */
  started(call: ToolCall): void {
    const attempt: Attempt = { signature: signatureOf(call), label: describeCall(call).label };
    this.#open.set(call.id, attempt);
    this.#refused.delete(call.id);
    this.#doing = attempt.label;
  }

  /** A call the Guard stopped. Pi will report it as an error; it is not one. */
  refused(callId: string): void {
    this.#refused.add(callId);
    this.#open.delete(callId);
  }

  /**
   * One event straight from Pi. Returns money to report, or null — which is the
   * usual answer, since most events are not priced.
   */
  fromPi(event: unknown): SpendReport | null {
    const source = fieldsOf(event);
    if (source === null) return null;

    switch (textAt(source, 'type')) {
      case 'auto_retry_start':
        this.#retrying = true;
        return null;

      case 'auto_retry_end':
        this.#retrying = false;
        return null;

      case 'tool_execution_end':
        this.#toolFinished(source);
        return null;

      case 'message_end':
        return this.#turnPriced(event);

      default:
        return null;
    }
  }

  /**
   * Everything has finished. `billedSoFar` is Pi's own running total for the
   * session, in whole currency units, or null when it could not be read.
   *
   * Pi bills for things that never appear as an assistant message in the
   * stream — tidying a long conversation up, summarising an abandoned branch.
   * Left alone, the meter would quietly under-report those, and a meter that is
   * under a real bill is the failure this whole feature exists to prevent. So
   * the difference is claimed here, as work, because it is: it is the cost of
   * keeping the session usable.
   */
  settle(billedSoFar: number | null): SpendReport | null {
    if (billedSoFar === null || !Number.isFinite(billedSoFar)) return null;
    const missing = billedSoFar - this.#purse.chargedMajor;
    if (missing <= 0) return null;
    const amount = this.#purse.take(missing, 'work');
    return amount === null ? null : { amount, label: DEFAULT_SPEND_LABEL, reason: 'work' };
  }

  #toolFinished(source: Fields): void {
    const id = textAt(source, 'toolCallId');
    if (id === null) return;
    const attempt = this.#open.get(id);
    this.#open.delete(id);
    // A call the Guard stopped comes back from Pi as a failure, because that is
    // what the model is told. It is not one of ours.
    if (this.#refused.delete(id) || attempt === undefined) return;

    if (source['isError'] !== true) {
      this.#failures.delete(attempt.signature);
      return;
    }
    this.#failures.set(attempt.signature, (this.#failures.get(attempt.signature) ?? 0) + 1);
    this.#unresolved.push(attempt);
  }

  #turnPriced(event: unknown): SpendReport | null {
    const usage = usageOfPiMessage(event);
    if (usage !== null) {
      this.#input += usage.input;
      this.#output += usage.output;
      this.#cacheRead += usage.cacheRead;
      this.#cacheWrite += usage.cacheWrite;
      if (usage.cacheRead > 0 || usage.cacheWrite > 0) this.#sawCache = true;
      if (usage.model !== null && usage.costTotal !== null && usage.costTotal > 0) {
        const name = shortModelName(usage.model);
        this.#byModel.set(name, (this.#byModel.get(name) ?? 0) + usage.costTotal);
      }
    }
    const price = usage?.costTotal ?? null;
    const blaming = this.#retrying || this.#unresolved.length > 0;
    const label = blaming ? this.#worstOf(this.#unresolved) : this.#doing;
    // Whatever failed has now been answered. If the answer fails in its turn,
    // the next `tool_execution_end` says so and this fills up again.
    this.#unresolved = [];

    if (price === null) return null;
    const amount = this.#purse.take(price, blaming ? 'retry-after-failure' : 'work');
    if (amount === null) return null;
    return { amount, label, reason: blaming ? 'retry-after-failure' : 'work' };
  }

  /** The action we keep getting wrong, which is the one worth naming. */
  #worstOf(attempts: readonly Attempt[]): string {
    let worst: Attempt | null = null;
    let most = 0;
    for (const attempt of attempts) {
      const failures = this.#failures.get(attempt.signature) ?? 1;
      if (failures >= most) {
        most = failures;
        worst = attempt;
      }
    }
    return worst?.label ?? this.#doing;
  }
}
