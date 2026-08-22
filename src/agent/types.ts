/** Shared contracts between the Pi adapter, the Guard, and the cost ledger.
 *
 * Nothing outside src/agent/pi/ may import Pi directly — see notes/strategy/ARCHITECTURE.md.
 * Pi shipped three breaking SDK changes in six weeks, so the blast radius of an
 * upgrade has to stay inside one module. These types are ours, not Pi's. */

import type { Question } from './asking';

/** A tool the model wants to run, normalised away from Pi's own event shape. */
export type ToolCall = {
  id: string;
  /** e.g. 'bash' | 'write' | 'edit' | 'read' | custom tools we register */
  name: string;
  input: Record<string, unknown>;
};

/** What the Guard decided about a tool call. */
/** One problem a reviewer found, in the shape the review card draws. */
export type ReviewFinding = {
  /** P0 blocks shipping, P1 should be fixed first, P2 can wait, P3 is a note. */
  priority: 0 | 1 | 2 | 3;
  file?: string;
  line?: number;
  issue: string;
  impact?: string;
  /** How sure the reviewer is, 0–100. */
  confidence: number;
};

/** The whole call on whether a change ships. */
export type ReviewVerdict = {
  kind: 'ships' | 'needs-work' | 'do-not-land';
  summary: string;
  findings: readonly ReviewFinding[];
  /** What the change was held up against, by name. */
  checks?: readonly string[];
  /** The pull request this verdict is about, when it is about one. */
  pull?: number;
};

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

/** Whether something kept running is on its way up, up, or over. */
export type RunState = 'starting' | 'running' | 'stopped';

/**
 * One thing being kept running: a server, a watcher, an API.
 *
 * Declared here rather than beside the register that owns it, because the
 * window draws these and nothing the window imports may drag a process module
 * in behind it.
 */
export type RunningPiece = {
  id: string;
  /** What to call it in a sentence. The person's own words when they gave any. */
  label: string;
  command: string;
  folder: string;
  /** Where it can be reached, once it has said. Null until then. */
  address: string | null;
  state: RunState;
  since: number;
  /** Null while it is up; the code it ended with once it is not. */
  exitCode: number | null;
  /** Whether what it answers with is a page. Null until it has been asked —
   *  a worker, a watcher, and an API that answers in JSON all hold a port, and
   *  none of them is worth putting in a frame. */
  showsAPage?: boolean | null;
};

/** Money, in the smallest unit of the user's currency, to avoid float drift. */
export type Money = {
  /** e.g. 4025 means 40.25 */
  minor: number;
  /** ISO 4217, e.g. 'INR' | 'USD' */
  currency: string;
};

/** A picture handed to the agent along with a message.
 *
 * Carried as base64 bytes and the MIME type rather than a `File`: the picture
 * crosses the IPC wire twice (renderer → shell → Pi), and a structured clone
 * drops methods and handles long before it reaches the model. The bytes are
 * already encoded by the time anything outside the renderer sees them. */
export type ImageCard = {
  mimeType: string;
  /** The picture, base64-encoded without the data: prefix. */
  bytes: string;
};

/** What the page beside the conversation says about itself: where it is, what
 *  it is called, and what is on it. */
export type PageReading = {
  address: string;
  title: string;
  /** One line per thing on the page, each with a short handle to aim at. */
  outline: string;
};

/** Something to do to that page. `target` is either the words somebody would
 *  read on the thing, or a handle from the last reading. */
export type PageAct =
  | { kind: 'press'; target: string }
  | { kind: 'write'; target: string; text: string; submit: boolean }
  | { kind: 'move'; target: string | null; way: 'up' | 'down' | 'top' | 'bottom' };

/** What came of it. A refusal is an answer rather than a failure: something
 *  that is not on the page is a thing to read again and aim at better. */
export type PageDone =
  | { ok: true; did: string; now: PageReading }
  | { ok: false; because: string };

/** What the page complained about since it last loaded. */
export type PageTrouble = {
  /** Messages the page printed, in the order it printed them. */
  said: readonly string[];
  /** Requests that came back wrong or did not come back. */
  unanswered: readonly string[];
};

/**
 * The page beside the conversation, as the tools reach it.
 *
 * Implemented by the desktop shell, which is the only thing holding the view.
 * Every answer is plain data — the tools never get the view itself, so nothing
 * the model can say reaches past these five methods.
 */
export type LivePage = {
  /** The project the page was opened for and where it has got to, or null when
   *  no page is open at all. */
  open: () => { project: string | null; address: string } | null;
  read: () => Promise<PageReading | null>;
  act: (what: PageAct) => Promise<PageDone>;
  trouble: () => Promise<PageTrouble | null>;
  picture: () => Promise<ImageCard | null>;
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

/** How this sitting used the model, said without counts a designer has no
 *  intuition for. Built from Pi's own usage block (cache reads, model ids). */
export type SittingUsage = {
  /** Share of the prompt that came back from cache, 0–1. Null when the account
   *  never reports caching, so a zero would mean the wrong thing. */
  reusedShare: number | null;
  /** The model that took the largest share of the bill this sitting. */
  mostUsed: string | null;
  /** Models ordered by spend share, largest first. Empty until something ran. */
  byModel: readonly { name: string; share: number }[];
};

export type AgentEvent =
  | { type: 'message-delta'; text: string }
  | { type: 'message-end' }
  | { type: 'tool-start'; call: ToolCall }
  | { type: 'tool-end'; id: string; ok: boolean; detail?: string }
  /** A tool that is still running has something to say — the helper the `task`
   *  tool spawns, reporting as it reads. Replaces the step's own detail line. */
  | { type: 'tool-progress'; id: string; text: string }
  | { type: 'blocked'; call: ToolCall; reason: string }
  | { type: 'needs-confirmation'; call: ToolCall; verdict: Extract<Verdict, { kind: 'confirm' }> }
  | { type: 'error'; message: string }
  /**
   * Something the person said in an earlier sitting.
   *
   * The live stream never produces this: user turns are written straight to the
   * desk by the window, which is the one place that has the words as they were
   * typed (BACKLOG B1.1). It exists only for rehydration — when a project opens
   * and a saved conversation is read back, the shell replays it through the same
   * events the live stream uses, and the person's own messages have to travel
   * that same road or the thread would come back half-there.
   */
  | { type: 'user-said'; text: string }
  /** Looking around before touching anything, and what it came back with. */
  | { type: 'planning' }
  | { type: 'planned'; steps: readonly string[]; caveats: readonly string[]; questions: readonly string[] }
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
  /**
   * The service could not answer, and this is the wait before asking again.
   *
   * The same shape as tidying, and for the same reason: something is happening
   * that takes real time and produces nothing to look at. A long job that hit a
   * busy provider used to leave the window empty for half an hour, which reads
   * as stopped rather than waiting.
   */
  | { type: 'holding'; seconds: number }
  /** Done waiting. `ok` is false when asking again did not help either. */
  | { type: 'held'; ok: boolean }
  /** The agent has finished everything it was doing, tool calls included. The
   *  moment the session split is worth working out. */
  | { type: 'settled' }
  /**
   * A handful of things it would rather not guess, asked before it starts.
   *
   * Only ever before the first change: somebody who has been asked knows work
   * is about to begin and can walk away, and somebody who walked away must
   * never come back to find nothing happened because a question was waiting.
   */
  | { type: 'asked-first'; id: string; questions: readonly Question[] }
  /** That card can no longer be answered — the turn was stopped, or it closed.
   *  Without this the window keeps drawing a form whose answer goes nowhere. */
  | { type: 'asking-withdrawn'; ids: readonly string[] }
  /** Questions nobody will answer now — the sitting was stopped, or it closed.
   *  Without this the window keeps drawing a card whose answer can never
   *  arrive, and reads the unanswered card as "still working". */
  | { type: 'questions-withdrawn'; callIds: readonly string[] }
  /** A change was checked, and the verdict is in. Carries the same findings
   *  the reply showed as words, so the window can draw them as a card. */
  /** What is waiting behind the run. Both lists, because an interrupt and a
   *  follow-up are different promises and are shown as different things. */
  | { type: 'queued'; steering: readonly string[]; followUp: readonly string[] }
  /** The words of a person's message the moment the agent begins on it. Pi
   *  reports the line draining by its own bookkeeping too, but that removal is
   *  exact-text and can silently no-op; this says directly that one of the
   *  queued messages is no longer waiting, which is what the waiting line is
   *  for. */
  | { type: 'message-started'; text: string }
  | { type: 'reviewed'; verdict: ReviewVerdict }
  /** The split, from the shell's ledger. Emitted after `settled`, and only when
   *  there is something to split — no spend, no summary, no zero state. */
  | { type: 'spend-summary'; summary: SpendSummary }
  /** How the model was used this sitting — cache reuse and which model most.
   *  Updated as turns land; never carries raw counts. */
  | { type: 'model-reading'; reading: SittingUsage }
  /**
   * What is being kept running right now.
   *
   * Sent whenever one starts, says where it is, or stops — not on a clock. The
   * window draws the band from this and nothing else, so a server that fell
   * over stops claiming to be up without anybody having to ask it.
   */
  | { type: 'running'; pieces: readonly RunningPiece[] };
