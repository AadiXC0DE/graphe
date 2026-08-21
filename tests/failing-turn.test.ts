/** A reply that failed part way through.
 *
 * The window draws its quiet mark — the three dots — only when something is
 * happening *and* nothing on screen is already showing it. So a turn that is
 * still marked as streaming reads as "something is running", and the mark stays
 * away. A reply that ends in a failure has ended; if nothing closes it, it
 * stays open for the rest of the sitting and the dots never come back.
 */

import { describe, expect, it } from 'vitest';

import { applyEvent, type Turn } from '../src/lib/thread';
import type { AgentEvent } from '../src/agent/types';

function fold(events: readonly AgentEvent[]): readonly Turn[] {
  return events.reduce<readonly Turn[]>((turns, event) => applyEvent(turns, event), []);
}

/** Exactly what the window reads to decide something is still happening. */
const stillGoing = (turns: readonly Turn[]): boolean =>
  turns.some(
    (turn) =>
      (turn.kind === 'said' && turn.streaming) ||
      (turn.kind === 'did' && turn.state === 'running') ||
      (turn.kind === 'tidying' && turn.state === 'running'),
  );

const streaming = (turns: readonly Turn[]): boolean =>
  turns.some((turn) => turn.kind === 'said' && turn.streaming);

describe('a reply that failed after it had started speaking', () => {
  /* The shell sends `error` *instead of* `message-end` when the failure
     arrives on the assistant's own message, so this is the only thing that
     can close the reply. */
  it('is closed by the failure, not left open forever', () => {
    const turns = fold([
      { type: 'message-delta', text: 'Looking at the picture' },
      { type: 'error', message: 'This model cannot read pictures.' },
    ]);

    expect(streaming(turns)).toBe(false);
    expect(turns.some((turn) => turn.kind === 'trouble')).toBe(true);
  });

  it('still says what went wrong', () => {
    const turns = fold([
      { type: 'message-delta', text: 'Looking' },
      { type: 'error', message: 'This model cannot read pictures.' },
    ]);
    const trouble = turns.find((turn) => turn.kind === 'trouble');
    expect(trouble?.kind === 'trouble' ? trouble.trouble.because : '').toBe(
      'This model cannot read pictures.',
    );
  });

  it('closes every reply that was open, not only the last', () => {
    const turns = fold([
      { type: 'message-delta', text: 'One' },
      { type: 'message-end' },
      { type: 'message-delta', text: 'Two' },
      { type: 'error', message: 'It stopped.' },
    ]);
    expect(streaming(turns)).toBe(false);
  });

  it('leaves an ordinary failure with nothing open alone', () => {
    const turns = fold([{ type: 'error', message: 'It stopped.' }]);
    expect(streaming(turns)).toBe(false);
    expect(turns).toHaveLength(1);
  });

  /* The ordinary ending still works exactly as it did. */
  it('does not disturb a reply that ended properly', () => {
    const turns = fold([
      { type: 'message-delta', text: 'All done' },
      { type: 'message-end' },
    ]);
    expect(streaming(turns)).toBe(false);
    expect(turns.some((turn) => turn.kind === 'trouble')).toBe(false);
  });
});

/* ========================================================================== */
/* Failing anywhere else in a turn                                             */
/* ========================================================================== */

describe('a turn that failed somewhere other than mid-sentence', () => {
  /**
   * Closing only the sentence was half a fix. The window decides something is
   * happening from three things — a streaming reply, a step in progress, a tidy
   * in progress — and a failure during a tool call or a compaction left one of
   * the other two latched on, with the same symptom: no quiet mark for the rest
   * of the sitting.
   */
  it('closes a step that was still running', () => {
    const turns = fold([
      { type: 'tool-start', call: { id: 'c1', name: 'bash', input: { command: 'npm test' } } },
      { type: 'error', message: 'It stopped.' },
    ]);
    expect(stillGoing(turns)).toBe(false);
  });

  it('closes a tidy that was still running', () => {
    const turns = fold([{ type: 'tidying' }, { type: 'error', message: 'It stopped.' }]);
    expect(stillGoing(turns)).toBe(false);
  });

  it('closes all three at once', () => {
    const turns = fold([
      { type: 'message-delta', text: 'Looking' },
      { type: 'tool-start', call: { id: 'c1', name: 'bash', input: { command: 'npm test' } } },
      { type: 'tidying' },
      { type: 'error', message: 'It stopped.' },
    ]);
    expect(stillGoing(turns)).toBe(false);
    expect(turns.some((turn) => turn.kind === 'trouble')).toBe(true);
  });

  it('leaves a step that had already finished as it was', () => {
    const turns = fold([
      { type: 'tool-start', call: { id: 'c1', name: 'bash', input: { command: 'ls' } } },
      { type: 'tool-end', id: 'c1', ok: true },
      { type: 'error', message: 'It stopped.' },
    ]);
    const did = turns.find((turn) => turn.kind === 'did');
    expect(did?.kind === 'did' ? did.state : '').not.toBe('failed');
  });
});
