/** Pictures a step took, in the conversation.
 *
 * The agent could always take a screenshot, and until now only the model ever
 * saw it: the feed showed a line saying a picture had been taken and then
 * nothing. A step nobody can check is the opposite of what the feed is for.
 */

import { describe, expect, it } from 'vitest';

import { MOST_PICTURES, applyEvent, type Turn } from '../src/lib/thread';
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

  it('keeps only the newest few, so a long run of them cannot grow forever', () => {
    let turns: readonly Turn[] = [];
    const many = MOST_PICTURES + 4;
    for (let at = 0; at < many; at += 1) {
      turns = applyEvent(turns, {
        type: 'tool-start',
        call: { id: `call-${String(at)}`, name: 'desktop_picture', input: {} },
      });
      turns = applyEvent(turns, {
        type: 'tool-end',
        id: `call-${String(at)}`,
        ok: true,
        shown: { bytes: `picture-${String(at)}`, mimeType: 'image/jpeg' },
      });
    }
    const steps = turns.filter((one) => one.kind === 'did');
    const kept = steps.filter((one) => one.shown !== undefined);
    expect(kept).toHaveLength(MOST_PICTURES);
    // The newest ones, and every line is still there saying what it was.
    expect(steps).toHaveLength(many);
    expect(kept.at(-1)?.shown?.bytes).toBe(`picture-${String(many - 1)}`);
  });
});
