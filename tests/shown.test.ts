/** Pictures a step took, in the conversation.
 *
 * The agent could always take a screenshot, and until now only the model ever
 * saw it: the feed showed a line saying a picture had been taken and then
 * nothing. A step nobody can check is the opposite of what the feed is for.
 */

import { describe, expect, it } from 'vitest';

import { applyEvent, type Turn } from '../src/lib/thread';
import { translatePiEvent } from '../src/agent/pi/events';

const PIXEL = 'iVBORw0KGgo=';

function started(): readonly Turn[] {
  return applyEvent([], {
    type: 'tool-start',
    call: { id: 'call-1', name: 'browser_picture', input: {} },
  });
}

describe('a picture a step took', () => {
  it('is read off the step’s own answer', () => {
    const event = translatePiEvent({
      type: 'tool_execution_end',
      toolCallId: 'call-1',
      isError: false,
      result: { content: [{ type: 'image', data: PIXEL, mimeType: 'image/jpeg' }] },
    });
    expect(event?.type === 'tool-end' ? event.shown : null).toEqual({
      bytes: PIXEL,
      mimeType: 'image/jpeg',
    });
  });

  it('is the last one, when a step took several', () => {
    const event = translatePiEvent({
      type: 'tool_execution_end',
      toolCallId: 'call-1',
      isError: false,
      result: {
        content: [
          { type: 'image', data: 'first', mimeType: 'image/jpeg' },
          { type: 'text', text: 'and then' },
          { type: 'image', data: 'last', mimeType: 'image/jpeg' },
        ],
      },
    });
    expect(event?.type === 'tool-end' ? event.shown?.bytes : null).toBe('last');
  });

  it('is not carried off a step that failed', () => {
    const event = translatePiEvent({
      type: 'tool_execution_end',
      toolCallId: 'call-1',
      isError: true,
      result: { content: [{ type: 'image', data: PIXEL, mimeType: 'image/jpeg' }] },
    });
    expect(event?.type === 'tool-end' ? event.shown : 'missing').toBeUndefined();
  });

  it('lands on the step it belongs to when that step closes', () => {
    const turns = applyEvent(started(), {
      type: 'tool-end',
      id: 'call-1',
      ok: true,
      shown: { bytes: PIXEL, mimeType: 'image/jpeg' },
    });
    const step = turns[turns.length - 1];
    expect(step?.kind === 'did' ? step.shown?.bytes : null).toBe(PIXEL);
    expect(step?.kind === 'did' ? step.state : null).toBe('done');
  });

  it('leaves a step that took none exactly as it was', () => {
    const turns = applyEvent(started(), { type: 'tool-end', id: 'call-1', ok: true });
    const step = turns[turns.length - 1];
    expect(step?.kind === 'did' ? step.shown : 'missing').toBeUndefined();
  });
});
