/** The ledger, kept where the money is actually spent.
 *
 * The desktop shell owns this, not the window. The shell is the process that
 * talks to the agent, so it is the only one that sees every spend; the window
 * is sent what it needs to draw and would otherwise be reconstructing a total
 * from events it might have missed while it was being reloaded.
 *
 * It is deliberately a thin thing on top of `Ledger`: the arithmetic, the
 * work-versus-retry split and `summary()` all live there and are tested there.
 * All this adds is *when* — a ledger that does not exist until there is a first
 * spend, and a split that is worked out when a sitting settles.
 *
 * ## Why the ledger starts as null
 *
 * Because "no account connected" has to be silent. Someone who has not signed
 * in spends nothing, and a meter reading zero would be an interface element
 * asking to be understood in exchange for no information at all
 * (notes/strategy/COST-DESIGN.md, and the appear-when-it-has-something-to-say
 * rule in UI-DESIGN.md). No spend, no ledger, no summary, no meter.
 *
 * It also means the currency is never guessed. The first spend says what it is
 * in, and that is the ledger's currency from then on.
 */

import type { AgentEvent } from '../agent/types';
import { Ledger } from './ledger';

export class SpendRecorder {
  #ledger: Ledger | null = null;

  /** Null until something has actually been spent. */
  get ledger(): Ledger | null {
    return this.#ledger;
  }

  /**
   * Take one event from the agent, and say what else the window should be told.
   *
   * Returns the events to send *after* the one that came in, which is only ever
   * the summary, and only when there is something to summarise. Everything else
   * returns nothing and passes through untouched.
   */
  observe(event: AgentEvent): AgentEvent[] {
    if (event.type === 'spend') {
      const ledger = this.#for(event.amount.currency);
      // Two currencies in one sitting would mean two accounts, which cannot
      // happen. If it ever did, the entry is dropped rather than added to a
      // total in the wrong currency — a number nobody could act on.
      if (ledger.currency === event.amount.currency) {
        ledger.record({ amount: event.amount, reason: event.reason, label: event.label });
      }
      return [];
    }

    if (event.type === 'settled' && this.#ledger !== null) {
      return [{ type: 'spend-summary', summary: this.#ledger.summary() }];
    }

    return [];
  }

  /** The ledger, made on first use in whatever the money arrived in. */
  #for(currency: string): Ledger {
    const existing = this.#ledger;
    if (existing !== null) return existing;
    const ledger = new Ledger(currency);
    this.#ledger = ledger;
    return ledger;
  }
}
