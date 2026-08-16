/** Conventional naming, for the lines of work and the moments on them.
 *
 * Branches and commits that leave the machine — the handover branch, the PR
 * title, the subjects git log shows — carry a conventional type so they read
 * right next to the team's own work: `feat/…`, `fix/…`, `feat: Made the header
 * sticky`. The type is read from the work's own title, never guessed from the
 * tool that made it. Pure: a string in, a string out, and a test can hold the
 * classifier to account.
 */

/** The types this app ever writes, in the order they beat a default. */
export const CONVENTIONAL_TYPES = ['feat', 'fix', 'refactor', 'docs', 'chore'] as const;

export type ConventionalType = (typeof CONVENTIONAL_TYPES)[number];

/** The full conventional set, for stripping a type somebody else's tool wrote
 *  off the plain surface. */
const ALL_TYPES =
  'feat|fix|refactor|docs|chore|test|build|ci|perf|style|revert';

/** The subject without a conventional type prefix, or as it was. */
export function stripType(subject: string): string {
  return subject.replace(new RegExp(`^(${ALL_TYPES}):\\s+`, 'i'), '');
}

const FIX = /\b(fix|fixed|fixing|repair|repaired|correct|corrected|broken|bug|crash|error|issue|wrong|fallback|guard|protect|secure)\b/i;
const REFACTOR = /\b(refactor|tidy|tidied|clean|restructure|renam|mov|simplif|remov|delet|split|extract|consolidate)[a-z]*\b/i;
const DOCS = /\b(doc|documented|docs|readme|comment|explain)[a-z]*\b/i;
const CHORE = /\b(dependenc|bump|upgrad|downgrad|version|config|package|lockfile|format|lint)[a-z]*\b/i;

/**
 * The conventional type a piece of work is, from its own title.
 *
 * Fix beats refactor beats docs beats chore; anything that is not clearly one
 * of those is new work. The title is a sentence in the app's own voice — "Made
 * the header sticky", "Fixed the nav" — so the words are matched as words, and
 * a title that says nothing the classifier knows is still new work rather than
 * a shrug.
 */
export function conventionalType(title: string): ConventionalType {
  if (FIX.test(title)) return 'fix';
  if (REFACTOR.test(title)) return 'refactor';
  if (DOCS.test(title)) return 'docs';
  if (CHORE.test(title)) return 'chore';
  return 'feat';
}

/** The subject a commit should carry: the type, then the work's own words. */
export function commitSubject(title: string): string {
  const plain = title.replace(/\s+/g, ' ').trim();
  return `${conventionalType(plain)}: ${plain}`;
}