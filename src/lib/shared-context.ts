/**
 * What the project offers every chat in it.
 *
 * A chat's own references are the conversation's, and belonged there; what a
 * project shares is a different list with a different owner, and it is the one
 * every new chat is given. It is kept in the window because it is handed to the
 * shell with each turn rather than stored in the project's folder: nothing this
 * app writes belongs inside somebody's repository.
 *
 * One key per project, and every read and write behind a try — a window with
 * site data turned off must leave the shelf working rather than break it.
 */

import type { ProjectItem } from './ipc';

export function sharedKey(project: string): string {
  return `graphe:shared:${project}`;
}

/** What was kept, or nothing at all when there is nothing to read. */
export function keptShared(project: string): readonly ProjectItem[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(sharedKey(project));
  } catch {
    return [];
  }
  if (raw === null || raw === '') return [];
  try {
    const held: unknown = JSON.parse(raw);
    if (!Array.isArray(held)) return [];
    return held.filter(
      (one): one is ProjectItem =>
        one !== null &&
        typeof one === 'object' &&
        typeof (one as ProjectItem).name === 'string' &&
        (one as ProjectItem).name.trim() !== '',
    );
  } catch {
    return [];
  }
}

export function keepShared(project: string, items: readonly ProjectItem[]): void {
  try {
    if (items.length === 0) localStorage.removeItem(sharedKey(project));
    else localStorage.setItem(sharedKey(project), JSON.stringify(items));
  } catch {
    /* Nothing kept. The list still works for this sitting. */
  }
}

/** The list with one thing added, or the same list when it is already there.
 *  Keyed by the item's own id, so sharing the same file twice is one row. */
export function sharingWithProject(
  items: readonly ProjectItem[],
  one: ProjectItem,
): readonly ProjectItem[] {
  return items.some((each) => each.id === one.id) ? items : [...items, one];
}

/** And with one thing taken out. Taking it out of the project does not put it
 *  into the chat that took it out: whether this chat was ever given it is the
 *  chat's own record, and this must not invent one. */
export function onlyInThisChat(items: readonly ProjectItem[], id: string): readonly ProjectItem[] {
  const left = items.filter((one) => one.id !== id);
  return left.length === items.length ? items : left;
}
