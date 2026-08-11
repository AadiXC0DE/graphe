/** A saved conversation, read back into the desk it was.
 *
 * BACKLOG B1.1: a session persists as JSONL beside the project, and opening the
 * project again resumes the most recent conversation instead of a blank one.
 * The claim under test is the whole of the feature: **a conversation leaves the
 * disk in the same shape it came back in.** Pi's entries are translated into
 * the same AgentEvents the live stream uses, and the window folds them through
 * the same reducer — so the entry literals below are the only Pi-shaped thing
 * in this file, and the turns at the end are the only shape the window ever
 * draws.
 */

import { describe, expect, it } from 'vitest';

import type { AgentEvent } from '../src/agent/types';
import { eventsFromEntries } from '../src/agent/pi/history';
import { applyEvent, type Turn } from '../src/lib/thread';

/** Fold a saved conversation the way the window does when a project opens:
 *  translate, then run every event through the live reducer. */
function revived(entries: readonly unknown[]): readonly Turn[] {
  return (eventsFromEntries(entries) as AgentEvent[]).reduce(applyEvent, []);
}

/* ========================================================================== */
/* S-01 the translation                                                        */
/* ========================================================================== */

describe('S-01 the translation', () => {
  it('turns a user message into the words the window shows for them', () => {
    expect(eventsFromEntries([{ type: 'message', message: { role: 'user', content: 'Make the header darker.' } }])).toEqual(
      [{ type: 'user-said', text: 'Make the header darker.' }],
    );
  });

  it('joins a user message stored as blocks, skipping the pictures', () => {
    const entry = {
      type: 'message',
      message: {
        role: 'user',
        content: [
          { type: 'text', text: 'A' },
          { type: 'image', data: '…', mimeType: 'image/png' },
          { type: 'text', text: 'B' },
        ],
      },
    };
    expect(eventsFromEntries([entry])).toEqual([{ type: 'user-said', text: 'A\n\nB' }]);
  });

  it('leaves a picture-only user message out — nothing on disk can say what it was', () => {
    const entry = {
      type: 'message',
      message: { role: 'user', content: [{ type: 'image', data: '…', mimeType: 'image/png' }] },
    };
    expect(eventsFromEntries([entry])).toEqual([]);
  });

  it('reads an assistant message as text and calls, in the order they were written', () => {
    const entry = {
      type: 'message',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'I can do that.' },
          { type: 'toolCall', id: 'call-1', name: 'edit', arguments: { file: 'index.html' } },
        ],
      },
    };
    expect(eventsFromEntries([entry])).toEqual([
      { type: 'message-delta', text: 'I can do that.' },
      { type: 'tool-start', call: { id: 'call-1', name: 'edit', input: { file: 'index.html' } } },
      { type: 'message-end' },
      // Nothing in this transcript ever came back to say how the edit went, so
      // the replay closes it rather than leaving it turning.
      { type: 'tool-end', id: 'call-1', ok: false },
    ]);
  });

  it('closes a call by its own id, and tells whether it went well', () => {
    const ok = { type: 'message', message: { role: 'toolResult', toolCallId: 'call-1', isError: false } };
    const failed = { type: 'message', message: { role: 'toolResult', toolCallId: 'call-2', isError: true } };
    expect(eventsFromEntries([ok, failed])).toEqual([
      { type: 'tool-end', id: 'call-1', ok: true },
      { type: 'tool-end', id: 'call-2', ok: false },
    ]);
  });

  it('closes a step whose result never arrived, so nothing comes back spinning', () => {
    const entry = {
      type: 'message',
      message: {
        role: 'assistant',
        content: [{ type: 'toolCall', id: 'call-1', name: 'edit', arguments: {} }],
      },
    };
    expect(eventsFromEntries([entry])).toEqual([
      { type: 'tool-start', call: { id: 'call-1', name: 'edit', input: {} } },
      { type: 'tool-end', id: 'call-1', ok: false },
    ]);
  });

  it('closes only the steps that are still open', () => {
    const entries = [
      {
        type: 'message',
        message: {
          role: 'assistant',
          content: [
            { type: 'toolCall', id: 'call-1', name: 'read', arguments: {} },
            { type: 'toolCall', id: 'call-2', name: 'edit', arguments: {} },
          ],
        },
      },
      { type: 'message', message: { role: 'toolResult', toolCallId: 'call-1', isError: false } },
    ];
    const ends = eventsFromEntries(entries).filter((one) => one.type === 'tool-end');
    expect(ends).toEqual([
      { type: 'tool-end', id: 'call-1', ok: true },
      { type: 'tool-end', id: 'call-2', ok: false },
    ]);
  });

  it('does not replay a tidy — there is no honest place to put it', () => {
    expect(eventsFromEntries([{ type: 'compaction' }])).toEqual([]);
  });

  it('does not replay a failure as a live trouble card', () => {
    const entry = {
      type: 'message',
      message: { role: 'assistant', content: [], errorMessage: 'It would not connect.' },
    };
    expect(eventsFromEntries([entry])).toEqual([]);
  });

  it('ignores the furniture — headers, model changes, thinking levels, labels', () => {
    const furniture = [
      { type: 'session', sessionName: 'S' },
      { type: 'thinking_level_change' },
      { type: 'model_change' },
      { type: 'label' },
      null,
      42,
      'not an entry',
      [],
    ];
    expect(eventsFromEntries(furniture)).toEqual([]);
  });

  it('skips an entry that does not look like the shape we know', () => {
    const broken = [
      { type: 'message' },
      { type: 'message', message: { role: 'user', content: 42 } },
      { type: 'message', message: { role: 'assistant', content: 'a string, not blocks' } },
      { type: 'message', message: { role: 'toolResult' } },
    ];
    expect(eventsFromEntries(broken)).toEqual([]);
  });

  it('keeps the conversation in the order it happened', () => {
    const events = eventsFromEntries([
      { type: 'message', message: { role: 'user', content: 'Go.' } },
      { type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'On it.' }] } },
      { type: 'compaction' },
      { type: 'message', message: { role: 'user', content: 'And now this.' } },
    ]);
    expect(events.map((one) => one.type)).toEqual([
      'user-said',
      'message-delta',
      'message-end',
      'user-said',
    ]);
  });
});

/* ========================================================================== */
/* S-02 the journey: entries, through the translation, onto the desk           */
/* ========================================================================== */

describe('S-02 the journey back onto the desk', () => {
  it('rebuilds a whole conversation, user turns and agent turns alike', () => {
    const turns = revived([
      { type: 'message', message: { role: 'user', content: 'Make the header darker.' } },
      {
        type: 'message',
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'I can do that.' },
            { type: 'toolCall', id: 'call-1', name: 'edit', arguments: { file: 'index.html' } },
          ],
        },
      },
      { type: 'message', message: { role: 'toolResult', toolCallId: 'call-1', isError: false } },
      {
        type: 'message',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Done — the header is darker now.' }] },
      },
    ]);

    expect(turns.map((turn) => turn.kind)).toEqual(['said', 'said', 'did', 'said']);
    expect(turns[0]).toMatchObject({ kind: 'said', from: 'you', text: 'Make the header darker.' });
    expect(turns[1]).toMatchObject({
      kind: 'said',
      from: 'graphe',
      text: 'I can do that.',
      streaming: false,
    });
    expect(turns[2]).toMatchObject({ kind: 'did', callId: 'call-1', state: 'done' });
    expect(turns[3]).toMatchObject({
      kind: 'said',
      from: 'graphe',
      text: 'Done — the header is darker now.',
      streaming: false,
    });
  });

  it('leaves a call that failed, failed', () => {
    const turns = revived([
      { type: 'message', message: { role: 'user', content: 'Delete it.' } },
      {
        type: 'message',
        message: {
          role: 'assistant',
          content: [{ type: 'toolCall', id: 'call-1', name: 'rm', arguments: { path: 'old.html' } }],
        },
      },
      { type: 'message', message: { role: 'toolResult', toolCallId: 'call-1', isError: true } },
    ]);
    expect(turns[1]).toMatchObject({ kind: 'did', callId: 'call-1', state: 'failed' });
  });

  it('does not open a restored conversation on a spinner', () => {
    const turns = revived([
      { type: 'message', message: { role: 'user', content: 'Rebuild the nav.' } },
      {
        type: 'message',
        message: {
          role: 'assistant',
          content: [{ type: 'toolCall', id: 'call-1', name: 'edit', arguments: { file: 'nav.tsx' } }],
        },
      },
    ]);
    expect(turns.every((turn) => turn.kind !== 'did' || turn.state !== 'running')).toBe(true);
  });

  it('does not greet a returning conversation with last week’s error', () => {
    const turns = revived([
      { type: 'message', message: { role: 'user', content: 'Long chat.' } },
      { type: 'compaction' },
      {
        type: 'message',
        message: { role: 'assistant', content: [], errorMessage: 'The connection dropped.' },
      },
    ]);
    expect(turns.map((turn) => turn.kind)).toEqual(['said']);
  });

  it('an empty transcript is an empty desk', () => {
    expect(revived([])).toEqual([]);
  });
});
