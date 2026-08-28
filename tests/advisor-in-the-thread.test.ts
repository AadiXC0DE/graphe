/** The advisor, where somebody can see it.
 *
 * A second model gets consulted during a turn and nobody presses a button for
 * it, so the line in the conversation is the only evidence it ran at all. It
 * used to draw as one more anonymous step: asked, ticked off, and never a word
 * about what came back.
 *
 * Two halves have to survive, and they are carried in different places for the
 * same reason a helper's are — the question is what it was asked, the answer is
 * what it said, and one overwriting the other loses whichever arrives first.
 */

import { describe, expect, it } from 'vitest';

import type { AgentEvent, ToolCall } from '../src/agent/types';
import { applyEvent, type Turn } from '../src/lib/thread';
import { ADVISOR_ANSWERED, ADVISOR_LABEL, describeCall, isAdvisor } from '../src/lib/describe';
import { rows } from '../src/lib/steps';
import { translatePiEvent } from '../src/agent/pi/events';

const ASK: ToolCall = {
  id: 'call-1',
  name: 'ask_advisor',
  input: { question: 'Worker or queue for the retry path?' },
};

function fold(events: readonly AgentEvent[]): readonly Turn[] {
  return events.reduce<readonly Turn[]>((turns, event) => applyEvent(turns, event), []);
}

function step(turns: readonly Turn[]): Extract<Turn, { kind: 'did' }> {
  const found = turns.find((turn) => turn.kind === 'did');
  if (found?.kind !== 'did') throw new Error('no step in the thread');
  return found;
}

describe('the words', () => {
  it('calls it the advisor, which is what the addition and the pattern call it', () => {
    expect(describeCall(ASK).label).toBe(ADVISOR_LABEL);
    expect(ADVISOR_LABEL).toContain('advisor');
    expect(ADVISOR_ANSWERED).toContain('advisor');
  });

  it('puts the question on the line while it is still out', () => {
    expect(describeCall(ASK).detail).toBe('Worker or queue for the retry path?');
  });

  it('knows both halves as the same step', () => {
    expect(isAdvisor(ADVISOR_LABEL)).toBe(true);
    expect(isAdvisor(ADVISOR_ANSWERED)).toBe(true);
    expect(isAdvisor('Reading tokens.css')).toBe(false);
  });
});

describe('what came back', () => {
  it('says the advisor answered, rather than only that it was asked', () => {
    const turns = fold([
      { type: 'tool-start', call: ASK },
      { type: 'tool-end', id: 'call-1', ok: true, detail: 'A queue. A worker loses jobs on restart.' },
    ]);

    expect(step(turns).label).toBe(ADVISOR_ANSWERED);
    expect(step(turns).state).toBe('done');
  });

  it('keeps the question and the answer apart, the way a helper does', () => {
    const turns = fold([
      { type: 'tool-start', call: ASK },
      { type: 'tool-end', id: 'call-1', ok: true, detail: 'A queue. A worker loses jobs on restart.' },
    ]);

    expect(step(turns).detail).toBe('Worker or queue for the retry path?');
    expect(step(turns).progress).toBe('A queue. A worker loses jobs on restart.');
  });

  it('still reads as asked when it came back with nothing to quote', () => {
    const turns = fold([{ type: 'tool-start', call: ASK }, { type: 'tool-end', id: 'call-1', ok: true }]);

    expect(step(turns).label).toBe(ADVISOR_LABEL);
    expect(step(turns).progress).toBeUndefined();
  });

  it('does not claim an answer out of a failure', () => {
    const turns = fold([
      { type: 'tool-start', call: ASK },
      { type: 'tool-end', id: 'call-1', ok: false, detail: 'The advisor model is not configured.' },
    ]);

    expect(step(turns).label).toBe(ADVISOR_LABEL);
    expect(step(turns).state).toBe('failed');
    expect(step(turns).detail).toBe('The advisor model is not configured.');
    expect(step(turns).progress).toBeUndefined();
  });

  it("leaves every other step's detail exactly where it was", () => {
    const turns = fold([
      { type: 'tool-start', call: { id: 'c2', name: 'bash', input: { command: 'npm test' } } },
      { type: 'tool-end', id: 'c2', ok: true, detail: '2 failed' },
    ]);

    expect(step(turns).detail).toBe('2 failed');
    expect(step(turns).progress).toBeUndefined();
  });
});

describe('where it is drawn', () => {
  it('never disappears into a fold of steps', () => {
    const reads: readonly AgentEvent[] = [1, 2, 3, 4].flatMap((n): AgentEvent[] => [
      { type: 'tool-start', call: { id: `r${String(n)}`, name: 'read', input: { path: `a${String(n)}.ts` } } },
      { type: 'tool-end', id: `r${String(n)}`, ok: true },
    ]);
    const turns = fold([
      ...reads.slice(0, 4),
      { type: 'tool-start', call: ASK },
      { type: 'tool-end', id: 'call-1', ok: true, detail: 'A queue.' },
      ...reads.slice(4),
    ]);

    const apart = new Set(
      turns.filter((turn) => turn.kind === 'did' && isAdvisor(turn.label)).map((turn) => turn.id),
    );
    const drawn = rows(turns, apart);

    // Gathered without it, the whole run would be a single row saying "10 steps".
    expect(drawn.some((row) => row.kind === 'one' && row.turn.kind === 'did' && isAdvisor(row.turn.label))).toBe(
      true,
    );
  });
});

describe('the answer reaching the window at all', () => {
  const said = (name: string): unknown => ({
    type: 'tool_execution_end',
    toolCallId: 'call-1',
    toolName: name,
    isError: false,
    result: { content: [{ type: 'text', text: 'A queue. A worker loses jobs on restart.' }] },
  });

  it('carries what the advisor replied, which is the whole of that step', () => {
    expect(translatePiEvent(said('ask_advisor'))).toEqual({
      type: 'tool-end',
      id: 'call-1',
      ok: true,
      detail: 'A queue. A worker loses jobs on restart.',
    });
  });

  it("leaves every other tool's result to the model, as before", () => {
    expect(translatePiEvent(said('read'))).toEqual({ type: 'tool-end', id: 'call-1', ok: true });
  });
});
