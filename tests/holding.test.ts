/** The wait, drawn.
 *
 * A long job that hits a busy service now waits and carries on rather than
 * ending. Up to three quarters of an hour of that produces nothing to look at,
 * so the window says what is happening — and, whatever the ending, never leaves
 * a line spinning for the rest of the sitting.
 */

import { describe, expect, it } from 'vitest';

import { applyEvent, type Turn } from '../src/lib/thread';
import type { AgentEvent } from '../src/agent/types';
import { busyService } from '../src/cost/phrasing';

function fold(events: readonly AgentEvent[]): readonly Turn[] {
  return events.reduce<readonly Turn[]>((turns, event) => applyEvent(turns, event), []);
}

const holds = (turns: readonly Turn[]) => turns.filter((turn) => turn.kind === 'holding');

describe('a service that could not answer', () => {
  it('says how long the wait is', () => {
    const turns = fold([{ type: 'holding', seconds: 60 }]);
    expect(holds(turns)).toHaveLength(1);
    expect(holds(turns)[0]).toMatchObject({ state: 'running', seconds: 60 });
  });

  it('closes when the work picks up again', () => {
    const turns = fold([
      { type: 'holding', seconds: 60 },
      { type: 'held', ok: true },
      { type: 'message-delta', text: 'Carrying on.' },
    ]);
    expect(holds(turns)[0]).toMatchObject({ state: 'done' });
  });

  it('says so plainly when the waiting did not help', () => {
    const turns = fold([
      { type: 'holding', seconds: 1800 },
      { type: 'held', ok: false },
    ]);
    expect(holds(turns)[0]).toMatchObject({ state: 'failed' });
  });

  it('draws one line per wait, not one per announcement', () => {
    const turns = fold([
      { type: 'holding', seconds: 60 },
      { type: 'holding', seconds: 60 },
    ]);
    expect(holds(turns)).toHaveLength(1);
  });

  it('draws each wait of a ladder on its own line', () => {
    const turns = fold([
      { type: 'holding', seconds: 60 },
      { type: 'held', ok: true },
      { type: 'holding', seconds: 300 },
      { type: 'held', ok: true },
    ]);
    expect(holds(turns)).toHaveLength(2);
    expect(holds(turns).map((one) => one.kind === 'holding' && one.seconds)).toEqual([60, 300]);
  });

  it('never spins on past a run that really stopped', () => {
    const turns = fold([
      { type: 'holding', seconds: 60 },
      { type: 'error', message: 'The service stayed busy.' },
    ]);
    expect(holds(turns)[0]).toMatchObject({ state: 'failed' });
  });
});

describe('what the wait says', () => {
  it('rounds to words somebody reads rather than counts', () => {
    expect(busyService.waiting(60)).toContain('a minute');
    expect(busyService.waiting(1800)).toContain('30 minutes');
  });

  it('never names the machinery', () => {
    const everything = [
      busyService.waiting(60),
      busyService.waiting(1800),
      busyService.carriedOn,
      busyService.gaveUp,
    ]
      .join(' ')
      .toLowerCase();
    for (const banned of ['api', 'stream', 'retry', 'provider', 'token', '429', 'rate limit']) {
      expect(everything).not.toContain(banned);
    }
  });
});
