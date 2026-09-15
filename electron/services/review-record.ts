/** One project's finished work, as it was written down and read back.
 *
 * The queue is the shell's to keep and the window's to draw, so what lives here
 * is the reading of it: a stored row is checked field by field, and one that
 * cannot be read all the way through is dropped rather than repaired, because a
 * half-understood row would draw a card offering to carry files nobody can name.
 *
 * The one exception is a row that names no conversation. Held work used to be
 * recorded once per project rather than once per run, so a row can outlive any
 * record of which chat it came from. Dropping it would hide work whose files are
 * still on disk, so it is kept and marked unattributed — which is what the
 * screen reads to offer nothing that would carry it over.
 *
 * No disk here either: the caller reads the file and hands the text in.
 */

import { queueFrom, type Entry, type FileVerdict, type FileTally } from '../../src/work/reviewqueue';

/** The queue as it is stored: the entries, and the settings an older version
 *  kept beside them. */
export type ReviewIndex = { entries: readonly Entry[]; mirroring: readonly string[] };

/** One stored row, or null when it is not an entry at all. */
export function reviewRow(value: unknown): Entry | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const id = row['id'];
  const title = row['title'];
  const at = row['at'];
  const from = row['from'];
  if (typeof id !== 'string' || id === '') return null;
  if (typeof title !== 'string') return null;
  if (typeof at !== 'number' || !Number.isFinite(at)) return null;
  if (from !== 'conversation' && from !== 'board' && from !== 'schedule') return null;
  const named = row['address'];
  const address = typeof named === 'string' ? named : '';
  const files: FileTally[] = [];
  for (const one of Array.isArray(row['files']) ? (row['files'] as unknown[]) : []) {
    if (one === null || typeof one !== 'object') continue;
    const file = one as Record<string, unknown>;
    if (typeof file['path'] !== 'string' || file['path'] === '') continue;
    files.push({
      path: file['path'],
      added: typeof file['added'] === 'number' ? file['added'] : 0,
      removed: typeof file['removed'] === 'number' ? file['removed'] : 0,
    });
  }
  // Nothing to look at is not a review, and that is the same judgement whether
  // the row is this version's or an older one's.
  if (files.length === 0) return null;
  const choices: Record<string, FileVerdict> = {};
  const stored = row['choices'];
  if (stored !== null && typeof stored === 'object' && !Array.isArray(stored)) {
    for (const [path, choice] of Object.entries(stored as Record<string, unknown>)) {
      if (choice === 'take theirs' || choice === 'keep mine') choices[path] = choice;
    }
  }
  // Written down with the entry, so a review survives a restart still scoped to
  // the state it was read against.
  const held = row['snapshot'];
  const read = held !== null && typeof held === 'object' ? (held as Record<string, unknown>) : {};
  const source = typeof read['source'] === 'string' ? read['source'] : '';
  const target = typeof read['target'] === 'string' ? read['target'] : '';
  return {
    id,
    from,
    title,
    address,
    files,
    at,
    read: row['read'] === true,
    ...(address === '' ? { unattributed: true as const } : {}),
    ...(source === '' || target === '' ? {} : { snapshot: { source, target } }),
    ...(Object.keys(choices).length === 0 ? {} : { choices }),
  };
}

/**
 * A stored queue, read back.
 *
 * A file that will not parse is an empty queue rather than a throw: losing the
 * list of work waiting for somebody is bad, and refusing to start is worse.
 * Answers are ordered newest first, as the queue keeps them.
 */
export function readReviewIndex(text: string): ReviewIndex {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return { entries: [], mirroring: [] };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { entries: [], mirroring: [] };
  }
  const held = parsed as Record<string, unknown>;
  const rows = Array.isArray(held['entries']) ? (held['entries'] as unknown[]) : [];
  const entries: Entry[] = [];
  for (const row of rows) {
    const one = reviewRow(row);
    if (one !== null) entries.push(one);
  }
  const mirroring = Array.isArray(held['mirroring'])
    ? (held['mirroring'] as unknown[]).filter((one): one is string => typeof one === 'string')
    : [];
  return { entries: queueFrom(entries), mirroring };
}

/** The queue as it goes back to disk. */
export function reviewIndexText(index: ReviewIndex): string {
  return JSON.stringify({ entries: index.entries, mirroring: index.mirroring });
}
