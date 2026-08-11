/** A saved conversation, read back as the events the window draws.
 *
 * Pi's session entries translated into the same AgentEvents the live stream
 * uses, so the window can fold them through `applyEvent`. Same rules as
 * `events.ts`: no Pi imports, defensive field reads only.
 *
 * Two live-only moments are dropped so a record cannot impersonate a live
 * conversation: an `error`, which would replay as a dismissable trouble card,
 * and a compaction, which Pi hoists above the messages it summarised.
 *
 * Known loss: a call the Guard blocked was written down as an ordinary failed
 * result, so it comes back as a step that failed rather than one somebody said
 * no to.
 */

import type { AgentEvent, ToolCall } from '../types';

type Fields = Readonly<Record<string, unknown>>;

function fieldsOf(value: unknown): Fields | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Fields;
}

function textAt(source: Fields, key: string): string | null {
  const value = source[key];
  return typeof value === 'string' && value !== '' ? value : null;
}

function flagAt(source: Fields, key: string): boolean | null {
  const value = source[key];
  return typeof value === 'boolean' ? value : null;
}

function nestedAt(source: Fields, key: string): Fields | null {
  return fieldsOf(source[key]);
}

/** The words of a user message, whether it was stored as one string or as
 *  blocks. A message that is pictures only cannot be resurrected — there is no
 *  file anywhere that knows what it was — so it simply does not come back. */
function userWords(message: Fields): string | null {
  const content = message['content'];
  if (typeof content === 'string') return content === '' ? null : content;
  const list = Array.isArray(content) ? content : null;
  if (list === null) return null;
  let words = '';
  for (const block of list) {
    const source = fieldsOf(block);
    if (source === null) continue;
    if (textAt(source, 'type') !== 'text') continue;
    const text = textAt(source, 'text');
    if (text !== null) words += words === '' ? text : `\n\n${text}`;
  }
  return words === '' ? null : words;
}

function callOf(block: Fields): ToolCall | null {
  const id = textAt(block, 'id');
  const name = textAt(block, 'name');
  if (id === null || name === null) return null;
  const arguments_ = fieldsOf(block['arguments']);
  return { id, name, input: arguments_ === null ? {} : arguments_ };
}

/** One assistant message, in the order its blocks were written — the order the
 *  live feed had them, so the replayed conversation reads the same way. A call
 *  the Guard never let run is still in the transcript as a call that happened;
 *  Pi recorded the result it was refused, and the replay shows that too. */
function assistantEvents(message: Fields): AgentEvent[] {
  const blocks = message['content'];
  if (!Array.isArray(blocks)) return [];
  const events: AgentEvent[] = [];
  let spoke = false;
  for (const block of blocks) {
    const source = fieldsOf(block);
    if (source === null) continue;
    const kind = textAt(source, 'type');
    if (kind === 'text') {
      const text = textAt(source, 'text');
      if (text === null) continue;
      events.push({ type: 'message-delta', text });
      spoke = true;
    } else if (kind === 'toolCall') {
      const call = callOf(source);
      if (call !== null) events.push({ type: 'tool-start', call });
    }
  }
  if (spoke) events.push({ type: 'message-end' });
  // `errorMessage` is dropped on purpose — see the top of the file.
  return events;
}

/** One session entry, read into the events it stands for. */
function eventsOf(entry: unknown): AgentEvent[] {
  const source = fieldsOf(entry);
  if (source === null) return [];
  const kind = textAt(source, 'type');
  if (kind === 'message') {
    const message = nestedAt(source, 'message');
    if (message === null) return [];
    const role = textAt(message, 'role');
    if (role === 'user') {
      const words = userWords(message);
      return words === null ? [] : [{ type: 'user-said', text: words }];
    }
    if (role === 'assistant') return assistantEvents(message);
    if (role === 'toolResult') {
      const id = textAt(message, 'toolCallId');
      if (id === null) return [];
      return [{ type: 'tool-end', id, ok: flagAt(message, 'isError') !== true }];
    }
    return [];
  }
  // Compactions are skipped on purpose; the rest — headers, model and thinking
  // level changes, labels — the window never draws.
  return [];
}

/** Translate a saved conversation into the events that would have made it.
 *  Unrecognised entries are skipped rather than allowed to derail it.
 *
 *  Every step is closed before the replay ends: a call written down with no
 *  result would leave `applyEvent` stuck in `running`, and the conversation
 *  would come back on a spinner that never stops. */
export function eventsFromEntries(entries: readonly unknown[]): readonly AgentEvent[] {
  const events: AgentEvent[] = [];
  const open = new Set<string>();
  for (const entry of entries) {
    for (const event of eventsOf(entry)) {
      if (event.type === 'tool-start') open.add(event.call.id);
      else if (event.type === 'tool-end') open.delete(event.id);
      events.push(event);
    }
  }
  for (const id of open) events.push({ type: 'tool-end', id, ok: false });
  return events;
}
