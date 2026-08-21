/** Which line of work the project is on, and how to move between them.
 *
 * One of the few surfaces allowed to say the real word: somebody who opens this
 * came looking for it. The plain gloss sits beside the name rather than instead
 * of it, so a designer reading over a shoulder is not left guessing.
 *
 * Pure. Nothing here reads a folder or moves anything.
 */

import type { GitBranch } from './ipc';

export const LINE_WORDS = {
  heading: 'Line of work',
  /** Beside the name, for anybody who has not met the word. Says what it is
   *  rather than who named it: "working branch" is the plain answer to "which
   *  one am I on?".
   */
  plainly: 'the working branch',
  open: 'Change line of work',
  find: 'Find a line',
  /** Said on the row the project is already on. */
  onThisOne: 'You are here',
  /** When a line tracks nothing shared yet. */
  notShared: 'not shared yet',
  inStep: 'in step',
  none: 'No other lines of work yet.',
  noneFound: 'Nothing by that name.',
  newLine: 'New line…',
  newPlaceholder: 'what-you-are-trying',
  create: 'Create',
  cancel: 'Cancel',
  /** A name the machine will not take. Said before the press, not after. */
  badName: 'A line’s name cannot have spaces, or start with a dash.',
  taken: 'There is already a line called that.',
} as const;

/** How a line stands against what it tracks, as one short phrase. Null when
 *  there is nothing worth saying — the common case, and a row with nothing
 *  after it reads faster than one saying "in step" every time. */
export function saysStanding(branch: GitBranch): string | null {
  if (branch.upstream === null) return LINE_WORDS.notShared;
  const parts: string[] = [];
  if (branch.ahead > 0) parts.push(`${String(branch.ahead)} ahead`);
  if (branch.behind > 0) parts.push(`${String(branch.behind)} behind`);
  return parts.length === 0 ? null : parts.join(', ');
}

/** The rows to draw for what somebody has typed. The current line stays in the
 *  list rather than being filtered out of it: a switcher that hides where you
 *  are makes you count the ones that are left to work out where that is. */
export function linesMatching(
  branches: readonly GitBranch[],
  typed: string,
): readonly GitBranch[] {
  const looking = typed.trim().toLowerCase();
  if (looking === '') return branches;
  return branches.filter(
    (one) =>
      one.name.toLowerCase().includes(looking) ||
      one.message.toLowerCase().includes(looking),
  );
}

/** Whether a typed name could be a line at all, and why not when it could not.
 *
 * Only the two rules somebody actually trips over. The machine has more, and
 * they surface as a refusal from the thing that refused — repeating its whole
 * rulebook here would be a second source of truth that drifts.
 */
export function refuseName(
  typed: string,
  existing: readonly GitBranch[],
): string | null {
  const name = typed.trim();
  if (name === '') return null;
  if (/\s/.test(name) || name.startsWith('-')) return LINE_WORDS.badName;
  if (existing.some((one) => one.name === name)) return LINE_WORDS.taken;
  return null;
}
