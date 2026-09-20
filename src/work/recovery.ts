/** A conversation whose folder is gone, and what may be done about it.
 *
 * The registry writes this down and the migration verifies it, and until now
 * nothing read it: a chat whose recorded folder had been deleted looked exactly
 * like one whose folder was there, and only failed at the moment it was opened.
 * The plan is explicit that the difference must not be hidden: where the folder
 * and its branch are both gone, the history opens read-only and says
 * `Workspace unavailable`, with a relink and an explicit way to start again
 * somewhere new. Nothing pretends the files were recovered.
 *
 * All of it is here rather than split across the two sides: the words, whether a
 * record means the folder cannot be used, and whether a folder somebody chose
 * may become the workspace. The window and the shell must not be able to say
 * different things about one conversation, and a decision kept apart from its
 * sentence is how they come to.
 *
 * Pure, and free of anything only one side has, so it reads the same in the
 * window, in the shell and in a test with neither.
 */

import type { WorkspaceState } from '../../electron/services/workspace-registry';

/** The heading, and the one phrase the surface and the tests name it by. */
export const WORKSPACE_UNAVAILABLE = 'Workspace unavailable';

export const RECOVERY_WORDS = {
  heading: WORKSPACE_UNAVAILABLE,
  /** The folder it was recorded in, and that nothing is written there now. */
  because: (folder: string): string =>
    `This conversation was working in ${folder}, and that folder is gone or is no longer a checkout of this project. It is open read-only, so nothing is written into the wrong place.`,
  /** Choose a folder where the work still is. */
  relink: 'Relink…',
  relinkHint: 'Point this conversation at the folder its work is in now',
  /** Continuing somewhere new is a new chat. The label says so rather than
   *  implying the folder that went missing has been brought back. */
  continueHere: 'Continue in a new workspace',
  continueHint:
    'Start a new conversation here with a note about what was said in this one',
  /** Said while the folder is being chosen. */
  choosing: 'Choosing a folder…',
} as const;

/**
 * Whether a workspace record means "this cannot be opened where it was".
 *
 * `missing` and `recovery-required` both do, and they are different problems: a
 * folder that is gone, and a folder that is there and is something else.
 * Neither is `ready`, and neither may be resolved to whichever folder happens
 * to be in front. `deleted` never reaches here: a deleted workspace resolves to
 * null rather than to a record.
 */
export function isUnusable(state: WorkspaceState): boolean {
  return state === 'missing' || state === 'recovery-required';
}

/** What the conversation's record means for the window about to show it. Null
 *  when there is nothing to say, which is every ordinary open. */
export function unavailableFor(
  record: { state: WorkspaceState; folder: string } | null,
): { folder: string; because: string } | null {
  if (record === null || !isUnusable(record.state)) return null;
  return {
    folder: record.folder,
    because: RECOVERY_WORDS.because(record.folder),
  };
}

/** What was found where a folder is claimed to be. */
export type FolderFacts = {
  readonly present: boolean;
  /** It is a checkout of the same repository the record was made against. A
   *  folder holding somebody else's project is not where this conversation's
   *  work is. A record carrying no key has nothing to compare with, which is
   *  not the same as a mismatch. */
  readonly sameRepository: boolean;
};

/**
 * Whether this conversation may be opened in the folder it recorded.
 *
 * False for a folder that is not there, and false for one that is there and is
 * a different repository: an agent that believes it is editing its own copy
 * while it edits somebody else's work is the failure the shell is arranged
 * around.
 */
export function usableWhereRecorded(
  state: WorkspaceState,
  facts: FolderFacts,
): boolean {
  return state === 'ready' && facts.present && facts.sameRepository;
}

/** Why a folder somebody chose cannot become this conversation's workspace, or
 *  null when it can. The record is left exactly as it was when this answers. */
export function whyNotRelink(facts: FolderFacts): string | null {
  if (!facts.present) return 'That folder is not there.';
  if (!facts.sameRepository) {
    return 'That folder is not a checkout of this project, so it is not where this conversation was working.';
  }
  return null;
}
