/** Copying a conversation.
 *
 * Going back over one destroys the direction it was already going in. A copy
 * is the other answer, and the thing that makes it a second conversation
 * rather than the same one written twice is the name at the top of the record.
 * If that is not replaced there are two files claiming to be one sitting, and
 * whichever is opened second wins.
 */

import { describe, expect, it } from 'vitest';

import { COPY_WORDS, copyFileName, copyOfConversation } from '../src/agent/pi/fork';

const HEADER = JSON.stringify({
  type: 'session',
  version: 3,
  id: '01a01107-8a64-7aba-bc83-4c6eddedfd37',
  timestamp: '2026-08-17T18:41:41.988Z',
  cwd: '/work/site',
});
const SAID = JSON.stringify({ type: 'message', id: 'e1c7a2a1', message: { role: 'user' } });
const ANSWERED = JSON.stringify({ type: 'message', id: 'a159c142', message: { role: 'assistant' } });
const AT = new Date('2026-08-19T09:00:00.000Z');

describe('a second copy of a conversation', () => {
  it('keeps everything that was said, in order', () => {
    const copied = copyOfConversation([HEADER, SAID, ANSWERED], 'new-id', AT);
    expect(copied?.lines).toHaveLength(3);
    expect(copied?.lines.slice(1)).toEqual([SAID, ANSWERED]);
  });

  /* The whole point. Two records with one name is one conversation written
     twice, and whichever is opened second wins. */
  it('gives the copy a name of its own, and its own moment', () => {
    const copied = copyOfConversation([HEADER, SAID], 'new-id', AT);
    const head = JSON.parse(copied?.lines[0] ?? '{}') as Record<string, unknown>;
    expect(head.id).toBe('new-id');
    expect(head.timestamp).toBe('2026-08-19T09:00:00.000Z');
    // Everything else about the sitting is the same sitting.
    expect(head.type).toBe('session');
    expect(head.version).toBe(3);
    expect(head.cwd).toBe('/work/site');
  });

  it('drops the blank lines a written file ends with', () => {
    const copied = copyOfConversation([HEADER, SAID, '', '  ', ''], 'new-id', AT);
    expect(copied?.lines).toHaveLength(2);
  });

  it('refuses a record it did not recognise rather than making a broken one', () => {
    expect(copyOfConversation([], 'new-id', AT)).toBeNull();
    expect(copyOfConversation(['not json'], 'new-id', AT)).toBeNull();
    expect(copyOfConversation([SAID, ANSWERED], 'new-id', AT)).toBeNull();
    expect(copyOfConversation(['null'], 'new-id', AT)).toBeNull();
    expect(copyOfConversation([HEADER], '', AT)).toBeNull();
  });

  it('names the file the way the folder already names them', () => {
    const name = copyFileName('01a01107-8a64-7aba-bc83-4c6eddedfd37', AT);
    expect(name).toBe('2026-08-19T09-00-00-000Z_01a01107-8a64-7aba-bc83-4c6eddedfd37.jsonl');
    expect(name).not.toContain(':');
  });

  it('says what it is in words nobody has to learn', () => {
    expect(COPY_WORDS.make).toBe('Make a copy');
    for (const said of Object.values(COPY_WORDS)) {
      expect(said).not.toMatch(/\b(session|fork|branch|jsonl|transcript)\b/i);
    }
  });
});
