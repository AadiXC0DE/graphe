/** A second copy of a conversation, to take somewhere else.
 *
 * Going back over a conversation to try something differently destroys the
 * direction it was already going in: the words are handed back to be said
 * again, and what came of them the first time is gone. Sometimes that is what
 * you want. Often you want both, and there was no way to have both.
 *
 * A copy is the whole record so far under a new name. Everything up to now
 * happened in both; from here they are two conversations, and neither one
 * knows what the other does next.
 *
 * Pure: lines in, lines out. The file is somebody else's problem.
 */

/** The first line of a record, which names the sitting it belongs to. A copy
 *  needs its own, or the two conversations are one conversation written twice. */
type Header = { type?: unknown; id?: unknown; timestamp?: unknown };

function headerOf(line: string): Header | null {
  try {
    const parsed: unknown = JSON.parse(line);
    if (parsed === null || typeof parsed !== 'object') return null;
    const fields = parsed as Header;
    return fields.type === 'session' ? fields : null;
  } catch {
    return null;
  }
}

export type Copied = { lines: readonly string[]; id: string };

/**
 * The same conversation under a new name.
 *
 * Returns null when the record has no header to replace — a file we did not
 * write, or one that was cut short. Copying that would produce something that
 * reads as a conversation and opens as nothing.
 */
export function copyOfConversation(
  lines: readonly string[],
  id: string,
  at: Date,
): Copied | null {
  const kept = lines.filter((line) => line.trim() !== '');
  const first = kept[0];
  if (first === undefined) return null;
  const header = headerOf(first);
  if (header === null || id.trim() === '') return null;

  const made = { ...header, id, timestamp: at.toISOString() };
  return { lines: [JSON.stringify(made), ...kept.slice(1)], id };
}

/** What the copy is called on disk. The same shape the sessions folder already
 *  uses, so nothing has to know a second naming rule. */
export function copyFileName(id: string, at: Date): string {
  return `${at.toISOString().replace(/[:.]/g, '-')}_${id}.jsonl`;
}

export const COPY_WORDS = {
  /** The control, beside the conversation it copies. */
  make: 'Make a copy',
  hint: 'A second copy of this conversation, so you can try something else without losing this one.',
  /** When there is nothing to copy. */
  cannot: 'I could not make a copy of that conversation.',
} as const;
