/** The notes the agent keeps between sittings, and the feed that says nothing
 *  about them.
 *
 * Writing a fact down changes nothing in the project and leaves nothing to look
 * at, so it is bookkeeping rather than work. It used to draw a line each way —
 * "Looking through what it remembers", "Making a note to remember" — and the
 * last turn of every sitting is nothing but those, so a reopened conversation
 * ended in a column of them.
 */

import { describe, expect, it } from 'vitest';

import type { AgentEvent, ToolCall } from '../src/agent/types';
import { isNoteKeeping } from '../src/lib/describe';
import { applyEvent, type Turn } from '../src/lib/thread';

function fold(events: readonly AgentEvent[]): readonly Turn[] {
  return events.reduce<readonly Turn[]>((turns, event) => applyEvent(turns, event), []);
}

const call = (id: string, name: string, input: Record<string, unknown> = {}): ToolCall => ({
  id,
  name,
  input,
});

describe('keeping notes says nothing in the conversation', () => {
  it('knows every memory verb', () => {
    for (const verb of ['retain', 'remember', 'recall', 'reflect', 'memory_edit', 'forget']) {
      expect(isNoteKeeping(verb), verb).toBe(true);
    }
    expect(isNoteKeeping('read')).toBe(false);
    expect(isNoteKeeping('task')).toBe(false);
  });

  it('adds no line for a note being written or read back', () => {
    expect(
      fold([
        { type: 'tool-start', call: call('c1', 'recall', { query: 'how this project is built' }) },
        { type: 'tool-end', id: 'c1', ok: true },
        { type: 'tool-start', call: call('c2', 'retain', { content: 'The checks run with npm test.' }) },
        { type: 'tool-end', id: 'c2', ok: true },
      ]),
    ).toEqual([]);
  });

  it('adds no line when one is refused either', () => {
    expect(
      fold([{ type: 'blocked', call: call('c1', 'retain', { content: 'x' }), reason: 'Not this one.' }]),
    ).toEqual([]);
  });

  it('leaves the work around it exactly as it was', () => {
    const turns = fold([
      { type: 'user-said', text: 'Make the header darker.' },
      { type: 'tool-start', call: call('c1', 'recall', { query: 'the header' }) },
      { type: 'tool-end', id: 'c1', ok: true },
      { type: 'tool-start', call: call('c2', 'edit', { path: '/p/index.html' }) },
      { type: 'tool-end', id: 'c2', ok: true },
      { type: 'tool-start', call: call('c3', 'retain', { content: 'The header lives in index.html.' }) },
      { type: 'tool-end', id: 'c3', ok: true },
    ]);

    expect(turns.map((turn) => turn.kind)).toEqual(['said', 'did']);
    expect(turns[1]).toMatchObject({ kind: 'did', label: 'Changing index.html', state: 'done' });
  });
});
