/** The pull request screen's decisions, kept out of the drawing.
 *
 * Which rows a filter shows, what a row's second line says, what a run of
 * checks comes to in one sentence, and which comments belong to a line. The
 * component reads these; it does not work any of them out for itself.
 */

import type { PullCheck, PullComment, RepoItem } from '../lib/ipc';

/** The four things a row can be, drawn as four different marks. An issue is its
 *  own mark; a draft is a pull request nobody is asking you to merge yet. */
export type Mark = 'open' | 'merged' | 'closed' | 'draft' | 'issue';

/** The chips across the header. State, not tabs: issues are one more state of
 *  the same list rather than a second screen. */
export type Filter = 'open' | 'merged' | 'closed' | 'issues';

export type Chip = { id: Filter; says: string; count: number };

export const PULL_SAYS = {
  open: 'Open',
  merged: 'Merged',
  closed: 'Closed',
  issues: 'Issues',
  /** When every check came back good. */
  allPassed: (count: number): string =>
    `${String(count)} ${count === 1 ? 'check passed' : 'checks passed'}`,
  /** When one did not, named, because the name is what somebody goes and opens. */
  failed: (name: string): string => `${name} failed`,
  running: (count: number): string =>
    `${String(count)} ${count === 1 ? 'check running' : 'checks running'}`,
} as const;

/** Which mark a row carries. `state` arrives from gh as OPEN, CLOSED or MERGED
 *  in any case, so it is lowered before it is read. */
export function markOf(item: RepoItem): Mark {
  if (item.kind === 'issue') return 'issue';
  const state = item.state.toLowerCase();
  if (state === 'merged') return 'merged';
  if (state === 'closed') return 'closed';
  return item.draft ? 'draft' : 'open';
}

/** Whether a row belongs under a chip. A draft is open: it is on the list of
 *  things still in front of you, which is what Open means here. */
export function underFilter(item: RepoItem, filter: Filter): boolean {
  if (filter === 'issues') return item.kind === 'issue';
  if (item.kind === 'issue') return false;
  const mark = markOf(item);
  if (filter === 'open') return mark === 'open' || mark === 'draft';
  return mark === filter;
}

/** The rows one chip shows, in the order github gave them. */
export function listFor(
  items: readonly RepoItem[],
  filter: Filter,
): readonly RepoItem[] {
  return items.filter((one) => underFilter(one, filter));
}

/** The header's chips, each with what it would show. Merged and Closed keep
 *  their place at zero, so the row does not move as pull requests land. */
export function chipsFor(items: readonly RepoItem[]): readonly Chip[] {
  const count = (filter: Filter): number =>
    items.reduce((total, one) => (underFilter(one, filter) ? total + 1 : total), 0);
  return [
    { id: 'open', says: PULL_SAYS.open, count: count('open') },
    { id: 'merged', says: PULL_SAYS.merged, count: count('merged') },
    { id: 'closed', says: PULL_SAYS.closed, count: count('closed') },
    { id: 'issues', says: PULL_SAYS.issues, count: count('issues') },
  ];
}

/** Which chip to land on when the screen opens. Open unless there is nothing
 *  open, because an empty list as the first thing somebody sees reads as a
 *  repository with nothing in it. */
export function firstFilter(items: readonly RepoItem[]): Filter {
  const chips = chipsFor(items);
  return chips.find((one) => one.count > 0)?.id ?? 'open';
}

/** A row's second line: who, when, and how big, with the parts that are not
 *  known yet simply left out rather than shown empty. */
export function rowSub(author: string, when: string, files: number | null): string {
  const parts = [author, when, files === null ? '' : `${String(files)} ${files === 1 ? 'file' : 'files'}`];
  return parts.filter((one) => one.trim() !== '').join(' · ');
}

/** What a run of checks comes to, in the one line that goes under the title.
 *  Null when github reported no checks at all: a line saying nothing ran is a
 *  line nobody needed. The first failure is the one named, and its link is the
 *  one to open. */
export function checkLine(
  checks: readonly PullCheck[],
): { good: boolean; says: string; link: string | null } | null {
  if (checks.length === 0) return null;
  const bad = checks.find((one) => one.state === 'failed');
  if (bad !== undefined) {
    return { good: false, says: PULL_SAYS.failed(bad.name), link: bad.link };
  }
  const running = checks.filter((one) => one.state === 'pending');
  if (running.length > 0) {
    return { good: true, says: PULL_SAYS.running(running.length), link: null };
  }
  const passed = checks.filter((one) => one.state === 'passed');
  return { good: true, says: PULL_SAYS.allPassed(passed.length), link: null };
}

/** The comments on one line of one file. Path and line together, because two
 *  files in a pull request very often change the same line number. */
export function commentsAt(
  comments: readonly PullComment[],
  path: string,
  line: number,
): readonly PullComment[] {
  return comments.filter((one) => one.path === path && one.line === line);
}

/** Every commented line, oldest comment first within each, so a thread reads
 *  down the page in the order it was written. */
export function byLine(
  comments: readonly PullComment[],
): ReadonlyMap<string, readonly PullComment[]> {
  const out = new Map<string, PullComment[]>();
  for (const one of [...comments].sort((a, b) => a.at.localeCompare(b.at))) {
    const key = `${one.path}:${String(one.line)}`;
    out.set(key, [...(out.get(key) ?? []), one]);
  }
  return out;
}

/** Which pull requests carry review comments, for the mark on their row. */
export function hasComments(
  counts: ReadonlyMap<number, number>,
  number: number,
): boolean {
  return (counts.get(number) ?? 0) > 0;
}

/** Where the keyboard lands after a move. Wraps at both ends, because a list
 *  that stops moving under the finger reads as a list that stopped working. */
export function moveBy(count: number, at: number, step: number): number {
  if (count <= 0) return 0;
  return (((at + step) % count) + count) % count;
}

/** The first message of the conversation "Work on this" opens. The issue's own
 *  words, so the agent starts from what was actually asked for. */
export function issuePrompt(item: RepoItem, full: string): string {
  const body =
    item.description === null || item.description.trim() === ''
      ? 'The issue has no description.'
      : item.description.trim();
  return `Work on issue #${String(item.number)} in ${full}.

“${item.title}”

${body}

Read the code before you change anything, and say what you plan to do first if the issue leaves room for more than one answer.`;
}
