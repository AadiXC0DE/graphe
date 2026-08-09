/** Shared contracts between the Pi adapter, the Guard, and the cost ledger.
 *
 * Nothing outside src/agent/pi/ may import Pi directly — see notes/strategy/ARCHITECTURE.md.
 * Pi shipped three breaking SDK changes in six weeks, so the blast radius of an
 * upgrade has to stay inside one module. These types are ours, not Pi's. */

/** A tool the model wants to run, normalised away from Pi's own event shape. */
export type ToolCall = {
  id: string;
  /** e.g. 'bash' | 'write' | 'edit' | 'read' | custom tools we register */
  name: string;
  input: Record<string, unknown>;
};

/** What the Guard decided about a tool call. */
export type Verdict =
  | { kind: 'allow' }
  /** Run it, but snapshot first. Used for anything destructive. */
  | { kind: 'snapshot-first'; reason: string }
  /** Ask the user, in plain language. Cannot be globally pre-approved. */
  | { kind: 'confirm'; question: string; detail?: string; consequence?: string }
  /** Refuse outright. The user is told what was stopped and why. */
  | { kind: 'deny'; reason: string };

export type GuardContext = {
  /** Absolute path of the project the user is working in. Nothing may escape it. */
  projectRoot: string;
};

/** Money, in the smallest unit of the user's currency, to avoid float drift. */
export type Money = {
  /** e.g. 4025 means 40.25 */
  minor: number;
  /** ISO 4217, e.g. 'INR' | 'USD' */
  currency: string;
};

/** Why a spend happened. Retries caused by the agent's own failure are tracked
 *  separately so we can show the user what they paid for our mistakes. */
export type SpendReason = 'work' | 'retry-after-failure';

export type SpendEntry = {
  id: string;
  at: number;
  amount: Money;
  reason: SpendReason;
  /** Plain-language label, e.g. 'Building the contact form'. Never model names. */
  label: string;
};

/** Spend grouped under one plain-language label. */
export type LabelTotal = {
  label: string;
  amount: Money;
  entryCount: number;
};

/**
 * The end-of-session split: what the work cost, and what our own failures cost.
 *
 * It lives here rather than in `src/cost/` because it crosses the IPC wire — the
 * ledger is kept in the desktop shell and the window is told the result. Every
 * field is plain data for exactly that reason: no methods, no `Ledger`, nothing
 * that a structured clone would quietly drop.
 */
export type SpendSummary = {
  currency: string;
  /** Everything, both kinds. */
  total: Money;
  /** What the user asked for. */
  work: Money;
  /** What our own failures cost them. */
  retry: Money;
  /** `retry` as a fraction of `total`, 0 when nothing has been spent. */
  retryShare: number;
  entryCount: number;
  /** Epoch ms of the first and last entry, or null for an empty ledger. */
  firstAt: number | null;
  lastAt: number | null;
  /** The single thing we wasted the most on — this is what fills in the
   *  "mostly me retrying the contact form" half of the sentence. Null when
   *  nothing was wasted, or when no one thing dominates. */
  largestRetry: LabelTotal | null;
};

export type AgentEvent =
  | { type: 'message-delta'; text: string }
  | { type: 'message-end' }
  | { type: 'tool-start'; call: ToolCall }
  | { type: 'tool-end'; id: string; ok: boolean }
  | { type: 'blocked'; call: ToolCall; reason: string }
  | { type: 'needs-confirmation'; call: ToolCall; verdict: Extract<Verdict, { kind: 'confirm' }> }
  | { type: 'error'; message: string }
  /**
   * Money that has just been spent, already priced.
   *
   * The unit a model is billed in never appears in this union, and never
   * reaches the window: it is turned into money inside `src/agent/pi/`, at the
   * moment it is read, and nothing downstream is given the chance to display it
   * (notes/strategy/COST-DESIGN.md §1). `label` is the same plain sentence the
   * activity feed uses — 'Changing contact.html', never a tool or model name.
   */
  | { type: 'spend'; amount: Money; label: string; reason: SpendReason }
  /**
   * A long conversation is being tidied up.
   *
   * COST-DESIGN §5: the real driver of runaway cost is a conversation that grew
   * huge, and the sentence people are usually shown about it is the kind that
   * makes a designer feel stupid. So the app says one plain thing — "we've
   * covered a lot in here, I'll tidy up my notes" — and then does it.
   *
   * Behind it is the agent runtime's own tidying, not ours. REUSE-PI.md is
   * explicit: if we find ourselves writing a summariser, stop. These two events
   * exist only so the window can narrate something Pi is doing, whether we asked
   * for it or Pi decided on its own.
   */
  | { type: 'tidying' }
  /** Finished. `ok` is false when it could not be done, which changes nothing
   *  about the conversation — it simply stays long. */
  | { type: 'tidied'; ok: boolean }
  /** The agent has finished everything it was doing, tool calls included. The
   *  moment the session split is worth working out. */
  | { type: 'settled' }
  /** The split, from the shell's ledger. Emitted after `settled`, and only when
   *  there is something to split — no spend, no summary, no zero state. */
  | { type: 'spend-summary'; summary: SpendSummary };
