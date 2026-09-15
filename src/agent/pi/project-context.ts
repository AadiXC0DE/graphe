/** What the project hands every chat in it.
 *
 * A brief, a specification, a house style: things the project owns rather than
 * things one conversation was sent. They ride the turn, and the window sends
 * them with every message, so a chat nobody has sent in yet is given the same
 * set as one that has been running all week.
 *
 * What they are *not* is this chat's. A reference somebody dropped into one
 * conversation belongs to that conversation and travels nowhere; the words here
 * say which of the two the model is looking at, because a model handed a pile
 * of files with no owner will assume the person in front of it sent them.
 *
 * Pure. What it is handed is worked out by the shell; what it does with it is
 * decided here, and tested here.
 */

import type { ProjectItem } from '../../lib/ipc';

/** As many as are worth carrying on a turn. Past this the list has become a
 *  document, and a document belongs in the project's own folder. */
export const MOST_SHARED = 24;

/** How much of one item's line is worth saying. The name is the point; the
 *  note is the gloss. */
const MOST_NOTE = 160;

export const projectContextWords = {
  open: '<graphe-project-context>',
  close: '</graphe-project-context>',
  lede: 'Shared with every chat in this project. None of it was sent in this chat:',
  /** Said rather than silently dropping the rest: a model that cannot see an
   *  item should know it exists. */
  more: (left: number): string =>
    `${String(left)} more are shared with this project and did not fit here.`,
} as const;

function oneLine(item: ProjectItem): string {
  const note = item.note.replace(/\s+/g, ' ').trim();
  if (note === '') return `- ${item.name}`;
  const cut = note.length <= MOST_NOTE ? note : `${note.slice(0, MOST_NOTE).trimEnd()}…`;
  return `- ${item.name}: ${cut}`;
}

/** The block, or null when the project shares nothing worth saying. */
export function projectContextBlock(items: readonly ProjectItem[]): string | null {
  const worth = items.filter((one) => one.name.trim() !== '');
  if (worth.length === 0) return null;
  const shown = worth.slice(0, MOST_SHARED);
  const lines = shown.map(oneLine);
  const left = worth.length - shown.length;
  if (left > 0) lines.push(projectContextWords.more(left));
  return [projectContextWords.open, projectContextWords.lede, ...lines, projectContextWords.close].join(
    '\n',
  );
}

/**
 * What the project shares, read off what the window sent.
 *
 * The window is not trusted: this arrives as an argument on a channel anything
 * in the renderer can call, so anything that is not an item of the right shape
 * is dropped rather than carried into a prompt.
 */
export function sharedFrom(value: unknown): readonly ProjectItem[] {
  if (!Array.isArray(value)) return [];
  const items: ProjectItem[] = [];
  const seen = new Set<string>();
  for (const one of value) {
    if (one === null || typeof one !== 'object') continue;
    const source = one as Record<string, unknown>;
    const name = typeof source['name'] === 'string' ? source['name'].trim() : '';
    if (name === '') continue;
    const id = typeof source['id'] === 'string' && source['id'] !== '' ? source['id'] : name;
    if (seen.has(id)) continue;
    seen.add(id);
    const note = typeof source['note'] === 'string' ? source['note'].trim() : '';
    items.push({ id, name: name.slice(0, MOST_NOTE), note: note.slice(0, MOST_NOTE) });
    if (items.length >= MOST_SHARED * 2) break;
  }
  return items;
}
