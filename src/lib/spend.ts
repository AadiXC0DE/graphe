/** What the window knows about money.
 *
 * A fold, and nothing else: events in, one small object out. It is a separate
 * file from the interface because the rule it encodes — *the meter appears the
 * first time there is a number and then stays* (notes/strategy/UI-DESIGN.md) —
 * is the kind of thing that should be provable without a browser.
 *
 * Two numbers arrive from the shell and they are not the same thing. Each
 * `spend` is an entry, added here as it happens so the corner stays current
 * while the agent is working. Each `spend-summary` is the shell's own ledger,
 * added up properly, and it replaces the running total rather than adding to it
 * — the ledger is the book, this is a tally kept between glances at it.
 */

import type { AgentEvent, Money, SpendSummary } from '../agent/types';
import { add } from '../cost/money';

export type SpendView = {
  /** What has been spent in this sitting. */
  total: Money;
  /** The split between work and our own retries, once a sitting has settled.
   *  Null until then — there is nothing honest to say about it mid-run. */
  split: SpendSummary | null;
};

/**
 * Fold one event in. Null in, null out, until money actually appears: no spend,
 * no view, and nothing for the interface to draw.
 */
export function applySpend(view: SpendView | null, event: AgentEvent): SpendView | null {
  if (event.type === 'spend') {
    if (view === null) return { total: event.amount, split: null };
    // A currency change mid-sitting cannot happen — one account, one currency.
    // If it ever did, the entry is dropped rather than added to the wrong pile.
    if (view.total.currency !== event.amount.currency) return view;
    return { ...view, total: add(view.total, event.amount) };
  }

  if (event.type === 'spend-summary') {
    return { total: event.summary.total, split: event.summary };
  }

  return view;
}
