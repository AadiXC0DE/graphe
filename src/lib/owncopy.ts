/**
 * A conversation working on its own copy of the project, and the two ways out.
 *
 * A second conversation in the same project is given a copy to work in, so two
 * of them are never writing the same files. Putting one down keeps everything
 * it wrote, which leaves that work sitting in a copy with nothing on screen to
 * do about it — these are the two things to do about it.
 *
 * The window only ever learns this about the conversation in front of it, so
 * everything here is written to say no by default: no copy, no offer.
 */

import type { Where } from './ipc';

export const OWN_COPY_WORDS = {
  /** Said on the row, so the two controls under it are not a surprise. */
  says: 'This conversation works in its own worktree.',
  bring: 'Merge the worktree back',
  bringHint: 'Put everything this conversation wrote into your project, and close its copy.',
  away: 'Delete the worktree',
  awayHint: 'Delete everything this conversation wrote.',
  sure: 'Everything this conversation wrote goes with it, and there is no getting it back.',
  yes: 'Yes, throw it away',
  no: 'Keep it',
} as const;

/**
 * Whether a row is the one to offer those two on.
 *
 * Only the conversation on screen, and only when it really has a copy. Offered
 * anywhere else, the destructive one points at work somebody else is still
 * doing.
 */
export function offersOwnCopy(row: string, onScreen: string | null, ownCopy: boolean): boolean {
  return ownCopy && onScreen !== null && row === onScreen;
}

/** The conversation such a press acts on. Never left out: unnamed, the shell
 *  acts on whichever conversation is in front, and one of the two deletes. */
export function ownCopyWhere(row: string): Where {
  return { conversation: row };
}

/**
 * The row still holding a raised "are you sure", once something has moved.
 *
 * A question raised over one conversation must never end up standing over
 * another: the press behind it deletes, and somebody answering it is answering
 * the question they were asked.
 */
export function keepAsking(asking: string | null, onScreen: string | null): string | null {
  return asking !== null && asking === onScreen ? asking : null;
}
