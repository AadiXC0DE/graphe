/** The note left about one piece of work, and what becomes of it next time.
 *
 * The board lives in memory, so a quit takes it with it: the copies stay on
 * disk unreachable and unexplained, and whatever was going is simply gone. A
 * note is the smallest thing that fixes that — what it was doing, where its
 * copy is, what it reached, what it cost, and who was looking after it.
 *
 * Pure, and every input is an argument. Which means the interesting moment —
 * a cold start reading somebody else's half-finished afternoon — is a test
 * rather than a restart.
 */

import type { PieceOfWork } from '../history/attempts';
import type { Money } from '../agent/types';
import type { WorkState } from './board';

/** Who was looking after a piece of work. `since` tells one run of the app from
 *  the next one to be given the same number by the machine. */
export type Owner = { pid: number; since: number };

/** Everything worth knowing about one piece of work that is not in memory. */
export type Written = {
  id: string;
  /** The project folder it belongs to. */
  project: string;
  /** What that folder is called, for the sentence on somebody's screen. */
  name: string;
  doing: string;
  state: WorkState;
  /** When it was asked for, epoch ms. */
  at: number;
  /** Its own copy of the project, once it has one. */
  folder: string | null;
  version: string | null;
  picture: string | null;
  /** What it said, in a sentence. */
  says: string | null;
  trouble: string | null;
  /** What this one has cost on its own. */
  spent: Money | null;
  /** The piece of work it waits for before it starts, or null. A plan lives on
   *  the disk with the work it is a plan for, or it is not a plan next launch. */
  after: string | null;
  owner: Owner;
};

export const writtenWords = {
  cutShort: 'This stopped when the app did. What it got to is still here to look at.',
  copyGone: 'The copy it was working in is not there any more.',
  pickedUp: 'Picked up where it left off.',
} as const;

/* -------------------------------------------------------------------------- */
/* Coming back to one                                                          */
/* -------------------------------------------------------------------------- */

/**
 * What to do with a note found on the way back in.
 *
 * `leave` is the one that keeps two copies of the app off each other's work.
 * `cut-short` is the honest answer for something that was going: the thinking
 * it was in the middle of was never on disk, so it cannot be resumed — but its
 * copy is, and that is worth keeping rather than quietly deleting.
 */
export type ComingBack =
  | { do: 'leave' }
  | { do: 'carry-on' }
  | { do: 'pick-up' }
  | { do: 'cut-short'; trouble: string }
  | { do: 'put-back' };

export type Whether = {
  /** Who is reading it. */
  ours: Owner;
  /** Whether some other run of the app is still there. */
  alive: (pid: number) => boolean;
  /** Whether its copy of the project is still on disk. */
  copyThere: (folder: string) => boolean;
};

export function onComingBack(one: Written, whether: Whether): ComingBack {
  const ours = one.owner.pid === whether.ours.pid && one.owner.since === whether.ours.since;
  if (ours) return { do: 'carry-on' };
  if (whether.alive(one.owner.pid)) return { do: 'leave' };

  // Never started, so nothing was spent and nothing is lost by starting it now.
  if (one.state === 'waiting') return { do: 'pick-up' };
  if (one.folder !== null && !whether.copyThere(one.folder)) {
    return { do: 'cut-short', trouble: writtenWords.copyGone };
  }
  if (one.state === 'running' || one.state === 'needs-you') {
    return { do: 'cut-short', trouble: writtenWords.cutShort };
  }
  return { do: 'put-back' };
}

/** The board's own shape, out of a note. What the state should be is decided by
 *  `onComingBack`; this only carries across what the note holds. */
export function asPiece(one: Written): PieceOfWork {
  return {
    id: one.id,
    doing: one.doing,
    state: one.state,
    folder: one.folder,
    version: one.version,
    picture: one.picture,
    at: one.at,
    trouble: one.trouble,
  };
}

/** A note about a piece of work as it stands. */
export function noteOf(
  piece: PieceOfWork,
  about: {
    project: string;
    name: string;
    owner: Owner;
    says?: string | null;
    spent?: Money | null;
    after?: string | null;
  },
): Written {
  return {
    id: piece.id,
    project: about.project,
    name: about.name,
    doing: piece.doing,
    state: piece.state,
    at: piece.at,
    folder: piece.folder,
    version: piece.version,
    picture: piece.picture,
    says: about.says ?? null,
    trouble: piece.trouble,
    spent: about.spent ?? null,
    after: about.after ?? null,
    owner: about.owner,
  };
}

/** One run's own total. Two currencies in one run has no arithmetic anywhere in
 *  this codebase, so the first one seen is the one counted. */
export function addSpend(running: Money | null, amount: Money): Money | null {
  if (running === null) return { ...amount };
  if (running.currency !== amount.currency) return running;
  return { minor: running.minor + amount.minor, currency: running.currency };
}

/* -------------------------------------------------------------------------- */
/* Reading one back                                                            */
/* -------------------------------------------------------------------------- */

const STATES: readonly WorkState[] = ['waiting', 'running', 'needs-you', 'done', 'failed'];

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function amount(value: unknown): Money | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  const minor = raw['minor'];
  const currency = raw['currency'];
  if (typeof minor !== 'number' || !Number.isFinite(minor)) return null;
  if (typeof currency !== 'string' || currency === '') return null;
  return { minor, currency };
}

/** Whatever was in the file, narrowed to something the board can hold. Anything
 *  unreadable is one note lost rather than a cold start that throws. */
export function readWritten(value: unknown): Written | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  const id = text(raw['id']);
  const project = text(raw['project']);
  const doing = text(raw['doing']);
  if (id === null || project === null || doing === null) return null;

  const state = raw['state'];
  const owner = raw['owner'];
  if (typeof owner !== 'object' || owner === null) return null;
  const who = owner as Record<string, unknown>;
  if (typeof who['pid'] !== 'number' || !Number.isFinite(who['pid'])) return null;

  return {
    id,
    project,
    name: text(raw['name']) ?? project,
    doing,
    state: STATES.includes(state as WorkState) ? (state as WorkState) : 'failed',
    at: typeof raw['at'] === 'number' ? raw['at'] : 0,
    folder: text(raw['folder']),
    version: text(raw['version']),
    picture: text(raw['picture']),
    says: text(raw['says']),
    trouble: text(raw['trouble']),
    spent: amount(raw['spent']),
    after: text(raw['after']),
    owner: {
      pid: who['pid'],
      since: typeof who['since'] === 'number' ? who['since'] : 0,
    },
  };
}
