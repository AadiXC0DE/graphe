/** Every conversation's own state, in one place, keyed by the address the
 *  shell knows it by.
 *
 * The window used to keep the conversation in front as fields on the project
 * and its siblings as partial records beside it, so bringing one forward copied
 * a subset of fields from one shape into the other — and whatever the copy
 * forgot was a field that silently vanished on every switch. Here a
 * conversation is one complete record and bringing one forward moves a pointer.
 * Nothing is copied, so there is nothing to forget.
 *
 * Address `''` is the conversation a project opens on, before the shell has
 * named it. Everything here is pure: each function takes the whole map and
 * returns a new one, so a switch is one write and no frame can show one
 * conversation's thread beside another's meter.
 */

import type { Attachment } from '../components/Attachments';
import type { Plans } from '../components/HowToWork';
import type { Task, TaskObservation } from '../cost/estimate';
import type { AgentNotice } from '../lib/ipc';
import type { Turn } from '../lib/thread';

/** One thing the agent was given to work from — a screenshot it was sent, or a
 *  design file its link named. Recorded in the overview the moment it is sent,
 *  because the overview's job is the story of the work, and a picture that
 *  shaped the work belongs in it whether the thread still mentions it or not.
 *
 *  It belongs to the conversation that was sent it: the project has no list of
 *  its own, and a fresh chat opens with none. */
export type Reference = {
  id: string;
  kind: 'image' | 'figma' | 'document';
  name: string;
  note: string;
  /** An object URL, for images only. Live for as long as this session. */
  preview?: string;
};

/**
 * One conversation, whole.
 *
 * Every field is present on every conversation, whether it is the one on screen
 * or one of a dozen behind it. That is the point: a record that is only partly
 * filled in is a record whose missing half gets filled from whichever
 * conversation happens to be in front.
 */
export type Conversation = {
  /** The conversation, in order. */
  turns: readonly Turn[];
  /** The job in flight, and when it started, so what it came to can be
   *  measured when it settles. Null when nothing is running. */
  doing: { task: Task; startedAt: number } | null;
  /**
   * The job that has just settled, held only until its cost lands.
   *
   * `doing` clears the moment the run does, because a provider that reports no
   * cost never sends a summary and the spinner used to wait on money that was
   * never coming. The split arrives a beat later, so the job it belongs to is
   * kept here to be filed against.
   */
  filing: { task: Task; startedAt: number } | null;
  /**
   * How much of this conversation's running total has already been attributed
   * to a finished job.
   *
   * The shell's ledger reports the whole sitting each time it settles, so each
   * job is charged the difference. Without this the second job of an afternoon
   * would be recorded as costing everything spent since lunch, and every
   * estimate after it would be nonsense.
   */
  counted: number;
  /**
   * Whether a turn is in flight, as the shell says it.
   *
   * Read off the shapes in `turns` for everything somebody typed, which is fine
   * until the app sends a turn of its own: between "Step 4 of 12 · carrying on"
   * and the first token there is nothing to read, and the composer said Send
   * for a conversation that was already answering.
   */
  busy: boolean;
  /** What this conversation has brought in and not yet said. A fresh chat opens
   *  with an empty box, whatever the one before it held. */
  attachments: readonly Attachment[];
  /** What this conversation brought in *and said* — the story of its work. */
  references: readonly Reference[];
  /** The sentence half-written here. Parked and restored with the rest, so
   *  coming back to a chat finds it as it was left. */
  draft: string;
  /** How this conversation's next message goes out. A chat left in research or
   *  plan does not set the mode for its neighbours. */
  plans: Plans;
};

/** A conversation this project has not had, in the shape everything reads.
 *  Shared: nothing here is ever written to, only copied out of. */
export const NOTHING_SAID: Conversation = {
  turns: [],
  doing: null,
  filing: null,
  counted: 0,
  busy: false,
  attachments: [],
  references: [],
  draft: '',
  plans: 'auto',
};

/** Every conversation open in one project, by address. */
export type Conversations = Readonly<Record<string, Conversation>>;

export const noConversations: Conversations = {};

/**
 * Change the conversation named, or answer with the same map when this project
 * does not have it. A reply arriving for a chat that has been closed is not a
 * reason to open it again.
 */
export function withConversation(
  all: Conversations,
  address: string,
  change: (one: Conversation) => Conversation,
): Conversations {
  const was = all[address];
  if (was === undefined) return all;
  const next = change(was);
  return next === was ? all : { ...all, [address]: next };
}

/** Whether a turn is in flight after this event. The shell says so directly;
 *  a settle is the end of one whatever else was said. */
export function busyAfter(busy: boolean, event: AgentNotice['event']): boolean {
  if (event.type === 'busy') return event.on;
  if (event.type === 'settled') return false;
  return busy;
}

/**
 * File what a job actually came to, when the shell says the sitting has settled
 * and told us the ledger.
 *
 * The next estimate is built from these, which is the whole of what makes it a
 * measurement rather than a guess (COST-DESIGN §2, and the honest note at the
 * top of `estimate.ts`). Only the difference since the last settle is recorded
 * — see `Conversation.counted`. The job itself goes to the project, which is
 * where the estimates for this folder are built.
 */
export function settled(
  one: Conversation,
  notice: AgentNotice,
  at: number,
): { next: Conversation; job: TaskObservation | null } {
  /* The job is over when the run is over, whatever it cost. A provider that
     reports no cost never sends a summary, so the tab spinner and the composer
     used to wait on money that was never coming. The job itself is held back
     one beat so the split, when there is one, still has something to file
     against. */
  if (notice.event.type === 'settled') {
    return { next: { ...one, doing: null, filing: one.doing ?? one.filing }, job: null };
  }
  if (notice.event.type !== 'spend-summary') return { next: one, job: null };

  const total = notice.event.summary.total;
  const spent = total.minor - one.counted;
  const job = one.doing ?? one.filing;
  // Nothing to file: no job in flight, or it cost nothing measurable. A zero is
  // not an observation, and recording one would drag every later estimate down.
  if (job === null || spent <= 0) {
    return {
      next: { ...one, doing: null, filing: null, counted: Math.max(one.counted, total.minor) },
      job: null,
    };
  }

  return {
    next: { ...one, doing: null, filing: null, counted: total.minor },
    job: {
      ...job.task,
      cost: { minor: spent, currency: total.currency },
      durationMs: Math.max(0, at - job.startedAt),
      at,
    },
  };
}
