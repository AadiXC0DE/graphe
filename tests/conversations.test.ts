/** Naming and reading back the conversations in a project. */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { readConversations, titleOf } from '../src/agent/pi/conversations';

const NOW = new Date(2026, 7, 11, 18, 30).getTime();

function atFixedTime(run: () => void): void {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  try {
    run();
  } finally {
    vi.useRealTimers();
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe('titleOf', () => {
  it('keeps a short first sentence exactly as it was typed', () => {
    expect(titleOf('Make the sidebar calmer', NOW)).toBe('Make the sidebar calmer');
  });

  it('keeps a line that lands on the limit whole', () => {
    const forty = 'Make the pricing page feel a bit calm';
    expect(forty.length).toBeLessThanOrEqual(40);
    expect(titleOf(forty, NOW)).toBe(forty);
  });

  it('trims a long line at the last whole word', () => {
    const said = 'The quick brown fox jumps over the lazy dog and then some';
    expect(titleOf(said, NOW)).toBe('The quick brown fox jumps over the lazy…');
  });

  it('never runs much past the limit', () => {
    const said =
      'Please go through every screen in the app and make the spacing consistent everywhere';
    const title = titleOf(said, NOW);
    expect(title.length).toBeLessThanOrEqual(41);
    expect(title.endsWith('…')).toBe(true);
    expect(said.startsWith(title.slice(0, -1))).toBe(true);
  });

  it('cuts mid-word when the first word is longer than the limit', () => {
    const title = titleOf('a'.repeat(60), NOW);
    expect(title).toBe(`${'a'.repeat(40)}…`);
  });

  it('does not leave punctuation hanging before the ellipsis', () => {
    const title = titleOf('Fix the header, the footer, and the rest of it, please', NOW);
    expect(title).toBe('Fix the header, the footer, and the rest…');
  });

  it('collapses newlines and runs of whitespace', () => {
    expect(titleOf('  Make it\n\n   calmer\tplease  ', NOW)).toBe('Make it calmer please');
  });

  it('drops heading marks', () => {
    expect(titleOf('## Make the header bigger', NOW)).toBe('Make the header bigger');
  });

  it('drops emphasis, strikethrough and code marks', () => {
    expect(titleOf('**Bold** and *italic* and `code` and ~~gone~~', NOW)).toBe(
      'Bold and italic and code and gone',
    );
    expect(titleOf('__Really__ important', NOW)).toBe('Really important');
  });

  it('leaves underscores inside words alone', () => {
    expect(titleOf('rename the user_name field', NOW)).toBe('rename the user_name field');
  });

  it('keeps the words of a link and drops the address', () => {
    expect(titleOf('[the pricing page](https://example.com/pricing) is broken', NOW)).toBe(
      'the pricing page is broken',
    );
    expect(titleOf('![a screenshot](shot.png) here', NOW)).toBe('a screenshot here');
    expect(titleOf('see [the docs][ref] first', NOW)).toBe('see the docs first');
  });

  it('drops list markers, quote marks and rules', () => {
    expect(titleOf('- one\n- two\n- three', NOW)).toBe('one two three');
    expect(titleOf('1. first\n2. second', NOW)).toBe('first second');
    expect(titleOf('> quoted thing', NOW)).toBe('quoted thing');
    expect(titleOf('---\nafter the rule', NOW)).toBe('after the rule');
  });

  it('keeps the contents of a fenced block, not its fences', () => {
    expect(titleOf('```ts\nconst a = 1\n```', NOW)).toBe('const a = 1');
  });

  it('drops stray html', () => {
    expect(titleOf('<b>make it</b> louder', NOW)).toBe('make it louder');
  });

  it('falls back to the time when there is nothing to read', () => {
    atFixedTime(() => {
      expect(titleOf('', NOW - 10_000)).toBe('Just now');
      expect(titleOf('   \n\t  ', NOW - 10_000)).toBe('Just now');
      expect(titleOf('**', NOW - 10_000)).toBe('Just now');
      expect(titleOf(undefined as unknown as string, NOW - 10_000)).toBe('Just now');
    });
  });

  it('names an unreadable conversation by when it happened', () => {
    atFixedTime(() => {
      expect(titleOf('', NOW - 90_000)).toBe('A minute ago');
      expect(titleOf('', NOW - 5 * 60_000)).toBe('5 minutes ago');
      expect(titleOf('', NOW - 90 * 60_000)).toBe('An hour ago');
      expect(titleOf('', new Date(2026, 7, 11, 13, 30).getTime())).toBe('5 hours ago');
      expect(titleOf('', new Date(2026, 7, 10, 18, 30).getTime())).toBe('Yesterday, 6:30pm');
      expect(titleOf('', new Date(2026, 7, 8, 9, 5).getTime())).toMatch(
        /^(Sun|Mon|Tues|Wednes|Thurs|Fri|Satur)day, 9:05am$/,
      );
      expect(titleOf('', new Date(2026, 6, 12, 9, 5).getTime())).toBe('12 July');
      expect(titleOf('', new Date(2025, 2, 3, 9, 5).getTime())).toBe('3 March 2025');
    });
  });
});

const MODIFIED = new Date(2026, 7, 11, 18, 0).getTime();

function info(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    path: '/Users/someone/.pi/agent/sessions/a/one.jsonl',
    id: 'one',
    cwd: '/Users/someone/work',
    created: new Date(MODIFIED - 3_600_000),
    modified: new Date(MODIFIED),
    messageCount: 12,
    firstMessage: 'Make the pricing page calmer',
    allMessagesText: 'Make the pricing page calmer …',
    ...over,
  };
}

describe('readConversations', () => {
  it('reads a realistic record into our own shape', () => {
    expect(readConversations([info()])).toEqual([
      {
        id: 'one',
        path: '/Users/someone/.pi/agent/sessions/a/one.jsonl',
        title: 'Make the pricing page calmer',
        at: MODIFIED,
        messages: 12,
      },
    ]);
  });

  it('accepts a moment as a Date, an ISO string or milliseconds', () => {
    const iso = new Date(MODIFIED).toISOString();
    const found = readConversations([
      info({ id: 'a', modified: new Date(MODIFIED) }),
      info({ id: 'b', modified: iso }),
      info({ id: 'c', modified: MODIFIED }),
    ]);
    expect(found.map((one) => one.at)).toEqual([MODIFIED, MODIFIED, MODIFIED]);
  });

  it('puts the newest first', () => {
    const found = readConversations([
      info({ id: 'middle', modified: new Date(MODIFIED - 60_000) }),
      info({ id: 'oldest', modified: new Date(MODIFIED - 600_000) }),
      info({ id: 'newest', modified: new Date(MODIFIED) }),
    ]);
    expect(found.map((one) => one.id)).toEqual(['newest', 'middle', 'oldest']);
  });

  it('falls back to when it was started if there is no later moment', () => {
    const started = new Date(MODIFIED - 3_600_000).getTime();
    expect(readConversations([info({ modified: undefined })])[0]?.at).toBe(started);
    expect(readConversations([info({ modified: 'not a date' })])[0]?.at).toBe(started);
    expect(readConversations([info({ modified: new Date('nonsense') })])[0]?.at).toBe(started);
    expect(readConversations([info({ modified: Number.NaN })])[0]?.at).toBe(started);
  });

  it('leaves out a conversation with no moment at all', () => {
    expect(readConversations([info({ modified: undefined, created: undefined })])).toEqual([]);
    expect(readConversations([info({ modified: {}, created: 'soon' })])).toEqual([]);
  });

  it('leaves out a conversation nobody said anything in', () => {
    expect(readConversations([info({ messageCount: 0 })])).toEqual([]);
    expect(readConversations([info({ messageCount: undefined })])).toEqual([]);
    expect(readConversations([info({ messageCount: '12' })])).toEqual([]);
    expect(readConversations([info({ messageCount: Number.NaN })])).toEqual([]);
    expect(readConversations([info({ messageCount: -3 })])).toEqual([]);
  });

  it('rounds a fractional count down', () => {
    expect(readConversations([info({ messageCount: 5.9 })])[0]?.messages).toBe(5);
  });

  it('leaves out anything without a name on disk', () => {
    expect(readConversations([info({ id: undefined })])).toEqual([]);
    expect(readConversations([info({ id: '' })])).toEqual([]);
    expect(readConversations([info({ id: 42 })])).toEqual([]);
    expect(readConversations([info({ path: undefined })])).toEqual([]);
    expect(readConversations([info({ path: null })])).toEqual([]);
  });

  it('steps over anything that is not a record', () => {
    expect(readConversations([null, undefined, 'one', 7, [], true, info()])).toHaveLength(1);
  });

  it('names a conversation by its time when the first message is missing', () => {
    atFixedTime(() => {
      const found = readConversations([
        info({ firstMessage: undefined, modified: new Date(NOW - 5 * 60_000) }),
        info({ id: 'two', firstMessage: 42, modified: new Date(NOW - 90 * 60_000) }),
      ]);
      expect(found.map((one) => one.title)).toEqual(['5 minutes ago', 'An hour ago']);
    });
  });

  it('shortens a long first message the same way a title is shortened', () => {
    const said = '# The quick brown fox jumps over the lazy dog and then some';
    expect(readConversations([info({ firstMessage: said })])[0]?.title).toBe(
      'The quick brown fox jumps over the lazy…',
    );
  });

  it('reads an empty list, and something that is not a list, as nothing', () => {
    expect(readConversations([])).toEqual([]);
    expect(readConversations(null as unknown as readonly unknown[])).toEqual([]);
  });

  it('does not disturb what it was given', () => {
    const given = [info({ id: 'a', modified: new Date(MODIFIED - 60_000) }), info({ id: 'b' })];
    const copy = JSON.parse(JSON.stringify(given));
    readConversations(given);
    expect(JSON.parse(JSON.stringify(given))).toEqual(copy);
  });
});
