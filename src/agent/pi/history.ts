/** A saved conversation, read back as the events the window draws — and as the
 *  moments it can be taken back to.
 *
 * Pi's session entries translated into the same AgentEvents the live stream
 * uses, so the window can fold them through `applyEvent`. Same rules as
 * `events.ts`: no Pi imports, defensive field reads only.
 *
 * Two live-only moments are dropped so a record cannot impersonate a live
 * conversation: an `error`, which would replay as a dismissable trouble card,
 * and a compaction, which Pi hoists above the messages it summarised.
 *
 * Graphe's own words are taken back off the messages it sent on somebody's
 * behalf — the end-of-sitting prompt, the notes it pins above a first question,
 * and every round it sends to carry a checklist or a goal on. They went out as
 * ordinary user messages and are on disk as such, so without this a reopened
 * conversation shows the app talking to itself as though a person had typed it.
 * An add-on's turn is marked by Pi itself and is left out the same way.
 *
 * Known loss: a call the Guard blocked was written down as an ordinary failed
 * result, so it comes back as a step that failed rather than one somebody said
 * no to.
 */

import type { AgentEvent, ToolCall } from '../types';
import { sentOnTheirBehalf } from '../../work/continuation';

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

function momentAt(source: Fields): number | null {
  const value = source['timestamp'];
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/** The words of a user message, whether it was stored as one string or as
 *  blocks. A message that is pictures only cannot be resurrected — there is no
 *  file anywhere that knows what it was — so it simply does not come back. */
/**
 * The prompt sent when a sitting ends, asking for anything worth keeping.
 *
 * Named things rather than impressions: a note saying the work went well helps
 * nobody next time, and a memory full of them is worse than an empty one.
 *
 * It lives beside the replay rather than beside the send, because the two have
 * to agree on it word for word or it comes back as a message somebody read.
 */
export const WORTH_KEEPING = `This sitting is over and nobody is reading this reply, so keep it to the notes.

Look back over what we just did. If you learned anything about this project that would save time next time (how it is built, how it is run, what it expects, a decision and why it went that way, something that caught you out), write each one down with retain, one fact per note, in a sentence that will still make sense months from now.

Write nothing about how this sitting went, nothing you already have a note for, and nothing that reading the code would tell you just as fast. Most sittings are worth one or two notes and many are worth none, which is a fine answer. Say nothing else.`;

/** The line above the notes carried into the first question of a sitting. */
export const NOTES_CARRIED = 'A few notes I keep about this project, most relevant first:';

/**
 * What the person actually typed, out of the message that was sent for them.
 *
 * Three things are Graphe's: the whole end-of-sitting prompt, which nobody
 * wrote and nobody read the reply to; the notes pinned above the first
 * question, which are the app remembering rather than the person speaking; and
 * the rounds the app sends to carry a checklist, a goal or a board piece on,
 * which are the loop talking to itself.
 */
function whatTheyTyped(text: string): string | null {
  const said = text.trim();
  if (said === '' || said === WORTH_KEEPING) return null;
  if (sentOnTheirBehalf(said)) return null;
  if (!said.startsWith(NOTES_CARRIED)) return said;
  const after = said.indexOf('\n\n');
  const typed = after === -1 ? '' : said.slice(after + 2).trim();
  return typed === '' ? null : typed;
}

function userWords(message: Fields): string | null {
  const content = message['content'];
  if (typeof content === 'string') return whatTheyTyped(content);
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
  return words === '' ? null : whatTheyTyped(words);
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
      if (textAt(message, 'customType') !== null) return [];
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

/** One thing the person said, and so one place the conversation can be taken
 *  back to. `at` is null when the record does not say when it happened, which is
 *  a missing caption rather than a reason to lose the moment. */
export type Moment = {
  id: string;
  said: string;
  at: number | null;
  mark: string | null;
};

/** The things the person said, oldest first. A message that was pictures only
 *  is left out for the same reason it is left out of a replay: there is nothing
 *  to show for it. `markOf` supplies whatever was written against a moment. */
export function momentsFromEntries(
  entries: readonly unknown[],
  markOf: (id: string) => string | null = () => null,
): readonly Moment[] {
  const moments: Moment[] = [];
  for (const entry of entries) {
    const source = fieldsOf(entry);
    if (source === null || textAt(source, 'type') !== 'message') continue;
    const id = textAt(source, 'id');
    const message = nestedAt(source, 'message');
    if (id === null || message === null || textAt(message, 'role') !== 'user') continue;
    if (textAt(message, 'customType') !== null) continue;
    const said = userWords(message);
    if (said === null) continue;
    moments.push({ id, said, at: momentAt(source), mark: markOf(id) });
  }
  return moments;
}

/** Which moment a request refers to, checked against the conversation as it
 *  stands. Anything else — a stale id, a moment from a direction already left
 *  behind — is nowhere to go back to, and is answered here rather than by
 *  letting the machinery underneath throw. */
export function momentToReturnTo(moments: readonly Moment[], id: unknown): Moment | null {
  if (typeof id !== 'string' || id === '') return null;
  return moments.find((moment) => moment.id === id) ?? null;
}
