/** The conversations in this project, named the way the person named them.
 *
 * Pure: the shapes Pi hands back are read defensively, field by field, so a
 * changed record or a half-written one costs one row rather than the list.
 */

import { ago } from '../../lib/when';

export type Conversation = {
  id: string;
  path: string;
  title: string;
  at: number;
  messages: number;
};

/** Long enough to recognise the thought, short enough to scan a column of them. */
const LIMIT = 40;

/** Markdown is how people type, not what they meant to say. */
function withoutMarkup(text: string): string {
  return text
    .replace(/^\s*([-*_])\1{2,}\s*$/gm, ' ')
    .replace(/^\s*```.*$/gm, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1')
    .replace(/`+/g, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/(^|\W)_([^_]+)_(?=\W|$)/g, '$1$2')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>+\s?/gm, '')
    .replace(/^\s*([-*+]|\d+[.)])\s+/gm, '')
    .replace(/<[^>]+>/g, ' ');
}

/** Cut at the last whole word, unless the first word alone is already too long. */
function shortened(text: string): string {
  if (text.length <= LIMIT) return text;
  const head = text.slice(0, LIMIT + 1);
  const space = head.lastIndexOf(' ');
  const kept = space > LIMIT / 2 ? head.slice(0, space) : head.slice(0, LIMIT);
  return `${kept.replace(/[\s.,;:!?\u2014\u2013-]+$/, '')}…`;
}

/** What to call a conversation: the person's own opening words, or — when there
 *  were none worth keeping — when it happened. */
export function titleOf(firstMessage: string, at: number): string {
  const said =
    typeof firstMessage === 'string' ? withoutMarkup(firstMessage).replace(/\s+/g, ' ').trim() : '';
  // Leftover punctuation is not a name anybody would recognise.
  return /[\p{L}\p{N}]/u.test(said) ? shortened(said) : ago(at);
}

/** A name somebody typed, ready to keep — or null when there is nothing in it.
 *  One line, however many they pressed return on. */
export function namedAs(text: unknown): string | null {
  if (typeof text !== 'string') return null;
  const kept = text.replace(/\s+/g, ' ').trim();
  return kept === '' ? null : kept;
}

/** What to call a conversation once somebody has had a say: the name they chose,
 *  and only failing that the guess from their opening words. A name that is all
 *  markup or all punctuation is not a name, so the guess still gets its turn. */
export function nameOf(chosen: unknown, firstMessage: string, at: number): string {
  const given = namedAs(chosen);
  const said = given === null ? '' : withoutMarkup(given).replace(/\s+/g, ' ').trim();
  return /[\p{L}\p{N}]/u.test(said) ? shortened(said) : titleOf(firstMessage, at);
}

/**
 * How to open a conversation.
 *
 * A conversation that has a file is always picked up where it was left, never
 * begun again: putting one down puts down the view of it, and every word is
 * still written down. Without a file, `fresh` is the difference between somebody
 * pressing "new" and somebody opening the project they were last in.
 */
export type Opening =
  | { kind: 'carry-on'; path: string }
  | { kind: 'most-recent' }
  | { kind: 'fresh' };

export function openingFor(asked: unknown, fresh = false): Opening {
  if (typeof asked === 'string' && asked.trim() !== '') return { kind: 'carry-on', path: asked };
  return fresh ? { kind: 'fresh' } : { kind: 'most-recent' };
}

type Fields = Readonly<Record<string, unknown>>;

function fieldsOf(value: unknown): Fields | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Fields;
}

function textAt(source: Fields, key: string): string | null {
  const value = source[key];
  return typeof value === 'string' && value !== '' ? value : null;
}

/** A moment, written down as a Date, an ISO string, or milliseconds. */
function momentAt(source: Fields, key: string): number | null {
  const value = source[key];
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function countAt(source: Fields, key: string): number | null {
  const value = source[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.max(0, Math.floor(value));
}

function conversationOf(info: unknown): Conversation | null {
  const source = fieldsOf(info);
  if (source === null) return null;
  const id = textAt(source, 'id');
  const path = textAt(source, 'path');
  if (id === null || path === null) return null;
  const at = momentAt(source, 'modified') ?? momentAt(source, 'created');
  if (at === null) return null;
  const messages = countAt(source, 'messageCount');
  // An empty conversation is a file, not something anyone remembers starting.
  if (messages === null || messages === 0) return null;
  const first = source['firstMessage'];
  return {
    id,
    path,
    title: nameOf(source['name'], typeof first === 'string' ? first : '', at),
    at,
    messages,
  };
}

/** Newest first. Anything that cannot be read all the way through is left out
 *  rather than shown as a row with holes in it. */
export function readConversations(infos: readonly unknown[]): readonly Conversation[] {
  if (!Array.isArray(infos)) return [];
  const found: Conversation[] = [];
  for (const info of infos) {
    const conversation = conversationOf(info);
    if (conversation !== null) found.push(conversation);
  }
  return found.sort((a, b) => b.at - a.at);
}
