/** Shared contracts between the Pi adapter, the Guard, and the cost ledger.
 *
 * Nothing outside src/agent/pi/ may import Pi directly — see docs/ARCHITECTURE.md.
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

export type AgentEvent =
  | { type: 'message-delta'; text: string }
  | { type: 'message-end' }
  | { type: 'tool-start'; call: ToolCall }
  | { type: 'tool-end'; id: string; ok: boolean }
  | { type: 'blocked'; call: ToolCall; reason: string }
  | { type: 'needs-confirmation'; call: ToolCall; verdict: Extract<Verdict, { kind: 'confirm' }> }
  | { type: 'error'; message: string };
