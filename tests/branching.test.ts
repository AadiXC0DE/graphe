/** Naming a conversation, the moments in it, and going back to one. */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { nameOf, namedAs, readConversations } from '../src/agent/pi/conversations';
import {
  momentToReturnTo,
  momentsFromEntries,
  type Moment,
} from '../src/agent/pi/history';

const NOW = new Date(2026, 7, 11, 18, 30).getTime();

afterEach(() => {
  vi.useRealTimers();
});

describe('namedAs', () => {
  it('keeps a name somebody typed', () => {
    expect(namedAs('Pricing page')).toBe('Pricing page');
  });

  it('is one line however many were typed', () => {
    expect(namedAs('  Pricing\n\npage  ')).toBe('Pricing page');
    expect(namedAs('a\tb')).toBe('a b');
  });

  it('reads nothing at all as no name', () => {
    expect(namedAs('')).toBeNull();
    expect(namedAs('   \n\t ')).toBeNull();
    expect(namedAs(undefined)).toBeNull();
    expect(namedAs(null)).toBeNull();
    expect(namedAs(42)).toBeNull();
    expect(namedAs({ name: 'x' })).toBeNull();
  });
});

describe('nameOf', () => {
  it('prefers the name somebody chose over the opening words', () => {
    expect(nameOf('Pricing page', 'Make the sidebar calmer', NOW)).toBe('Pricing page');
  });

  it('falls back to the opening words when nobody has named it', () => {
    expect(nameOf(undefined, 'Make the sidebar calmer', NOW)).toBe('Make the sidebar calmer');
    expect(nameOf(null, 'Make the sidebar calmer', NOW)).toBe('Make the sidebar calmer');
    expect(nameOf('', 'Make the sidebar calmer', NOW)).toBe('Make the sidebar calmer');
    expect(nameOf('   \n  ', 'Make the sidebar calmer', NOW)).toBe('Make the sidebar calmer');
  });

  it('falls back when the name is not text', () => {
    expect(nameOf(42, 'Make the sidebar calmer', NOW)).toBe('Make the sidebar calmer');
    expect(nameOf({ name: 'x' }, 'Make the sidebar calmer', NOW)).toBe('Make the sidebar calmer');
  });

  it('reads a chosen name the way it reads anything else typed', () => {
    expect(nameOf('**Pricing** page', 'something else', NOW)).toBe('Pricing page');
    expect(nameOf('# Pricing', 'something else', NOW)).toBe('Pricing');
    expect(nameOf('  Pricing\n\n  page ', 'something else', NOW)).toBe('Pricing page');
  });

  it('falls back when the name is markup and nothing else', () => {
    expect(nameOf('**', 'Make the sidebar calmer', NOW)).toBe('Make the sidebar calmer');
    expect(nameOf('---', 'Make the sidebar calmer', NOW)).toBe('Make the sidebar calmer');
  });

  it('shortens a long name the same way an opening line is shortened', () => {
    expect(nameOf('The quick brown fox jumps over the lazy dog and then some', '', NOW)).toBe(
      'The quick brown fox jumps over the lazy…',
    );
  });

  it('names a conversation by its time when there is neither a name nor words', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    expect(nameOf('', '', NOW - 10_000)).toBe('Just now');
    expect(nameOf('  ', '   ', NOW - 5 * 60_000)).toBe('5 minutes ago');
  });
});

describe('the name a conversation is listed under', () => {
  const MODIFIED = new Date(2026, 7, 11, 18, 0).getTime();

  function info(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      path: '/somewhere/one.jsonl',
      id: 'one',
      cwd: '/Users/someone/work',
      created: new Date(MODIFIED - 3_600_000),
      modified: new Date(MODIFIED),
      messageCount: 12,
      firstMessage: 'Make the pricing page calmer',
      ...over,
    };
  }

  it('is the name somebody chose, when there is one', () => {
    expect(readConversations([info({ name: 'Pricing' })])[0]?.title).toBe('Pricing');
  });

  it('is the opening words when nobody has named it', () => {
    expect(readConversations([info()])[0]?.title).toBe('Make the pricing page calmer');
    expect(readConversations([info({ name: '' })])[0]?.title).toBe('Make the pricing page calmer');
    expect(readConversations([info({ name: '  ' })])[0]?.title).toBe('Make the pricing page calmer');
    expect(readConversations([info({ name: 7 })])[0]?.title).toBe('Make the pricing page calmer');
  });
});

const AT = '2026-08-11T17:00:00.000Z';

function said(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'message',
    id: 'e1',
    parentId: null,
    timestamp: AT,
    message: { role: 'user', content: 'Make the pricing page calmer' },
    ...over,
  };
}

function replied(id: string): Record<string, unknown> {
  return {
    type: 'message',
    id,
    parentId: null,
    timestamp: AT,
    message: { role: 'assistant', content: [{ type: 'text', text: 'Done.' }] },
  };
}

describe('momentsFromEntries', () => {
  it('reads what the person said into a moment we can come back to', () => {
    expect(momentsFromEntries([said()])).toEqual([
      { id: 'e1', said: 'Make the pricing page calmer', at: Date.parse(AT), mark: null },
    ]);
  });

  it('keeps only the things the person said, in the order they said them', () => {
    const found = momentsFromEntries([
      said({ id: 'a', message: { role: 'user', content: 'first' } }),
      replied('b'),
      said({ id: 'c', message: { role: 'user', content: 'second' } }),
      { type: 'compaction', id: 'd', parentId: 'c', timestamp: AT, summary: 'x' },
      { type: 'message', id: 'e', timestamp: AT, message: { role: 'toolResult', toolCallId: 'z' } },
    ]);
    expect(found.map((one) => one.id)).toEqual(['a', 'c']);
    expect(found.map((one) => one.said)).toEqual(['first', 'second']);
  });

  it('reads words that were stored as blocks', () => {
    const found = momentsFromEntries([
      said({
        message: {
          role: 'user',
          content: [
            { type: 'text', text: 'one' },
            { type: 'image', data: 'x' },
            { type: 'text', text: 'two' },
          ],
        },
      }),
    ]);
    expect(found[0]?.said).toBe('one\n\ntwo');
  });

  it('leaves out a message there is nothing to show for', () => {
    expect(momentsFromEntries([said({ message: { role: 'user', content: '' } })])).toEqual([]);
    expect(
      momentsFromEntries([
        said({ message: { role: 'user', content: [{ type: 'image', data: 'x' }] } }),
      ]),
    ).toEqual([]);
    expect(momentsFromEntries([said({ message: { role: 'user', content: 7 } })])).toEqual([]);
  });

  it('steps over anything it cannot read all the way through', () => {
    expect(
      momentsFromEntries([null, undefined, 'one', 7, [], true, said({ id: undefined })]),
    ).toEqual([]);
    expect(momentsFromEntries([said({ message: undefined }), said({ type: undefined })])).toEqual(
      [],
    );
  });

  it('keeps a moment whose time cannot be read, without inventing one', () => {
    expect(momentsFromEntries([said({ timestamp: undefined })])[0]?.at).toBeNull();
    expect(momentsFromEntries([said({ timestamp: 'not a time' })])[0]?.at).toBeNull();
    expect(momentsFromEntries([said({ timestamp: 1_700_000_000 })])[0]?.at).toBeNull();
    expect(momentsFromEntries([said({ timestamp: undefined })])[0]?.id).toBe('e1');
  });

  it('carries whatever was written against a moment', () => {
    const marks: Record<string, string> = { a: 'the good one' };
    const found = momentsFromEntries(
      [said({ id: 'a' }), said({ id: 'b' })],
      (id) => marks[id] ?? null,
    );
    expect(found.map((one) => one.mark)).toEqual(['the good one', null]);
  });

  it('reads an empty conversation as no moments', () => {
    expect(momentsFromEntries([])).toEqual([]);
  });
});

describe('momentToReturnTo', () => {
  const moments: readonly Moment[] = [
    { id: 'a', said: 'first', at: 1, mark: null },
    { id: 'b', said: 'second', at: 2, mark: 'here' },
  ];

  it('finds a moment the conversation still holds', () => {
    expect(momentToReturnTo(moments, 'b')).toEqual(moments[1]);
  });

  it('answers no for a moment this conversation does not have', () => {
    expect(momentToReturnTo(moments, 'c')).toBeNull();
    expect(momentToReturnTo([], 'a')).toBeNull();
  });

  it('answers no for anything that is not a moment at all', () => {
    expect(momentToReturnTo(moments, '')).toBeNull();
    expect(momentToReturnTo(moments, undefined)).toBeNull();
    expect(momentToReturnTo(moments, null)).toBeNull();
    expect(momentToReturnTo(moments, 7)).toBeNull();
    expect(momentToReturnTo(moments, { id: 'a' })).toBeNull();
  });

  it('does not answer with something off the prototype', () => {
    expect(momentToReturnTo(moments, 'toString')).toBeNull();
    expect(momentToReturnTo(moments, 'constructor')).toBeNull();
  });
});
