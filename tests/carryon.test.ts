/** Working a checklist to the end without being asked eleven times.
 *
 * The loop matters less than its brakes: every way out of it is a test here,
 * because a run that will not stop is a worse bug than one that stops early.
 */

import { describe, expect, it } from 'vitest';

import {
  MOST_ROUNDS,
  MOST_STUCK,
  carryOnPrompt,
  carryOnWords,
  freshCarryOn,
  nextMove,
  type CarryOn,
} from '../src/work/carryon';

const plan = (done: number, total: number, next: string | null = 'the next step') => ({
  done,
  total,
  next,
});

describe('CO-01 a list with steps left asks for another round', () => {
  it('asks, and names the step it is picking up', () => {
    const move = nextMove(freshCarryOn(), plan(4, 12, 'Wire the settings row'));
    expect(move.kind).toBe('ask');
    if (move.kind !== 'ask') return;
    expect(move.said).toContain('Wire the settings row');
    expect(move.said).toContain('4');
    expect(move.said).toContain('12');
    expect(move.state.rounds).toBe(1);
  });

  it('counts rounds up as it goes', () => {
    let state = freshCarryOn();
    for (let at = 1; at <= 5; at += 1) {
      const move = nextMove(state, plan(at, 12));
      expect(move.kind).toBe('ask');
      if (move.kind !== 'ask') return;
      expect(move.state.rounds).toBe(at);
      state = move.state;
    }
  });
});

describe('CO-02 a finished list rests', () => {
  it('rests when nothing is next', () => {
    expect(nextMove(freshCarryOn(), plan(12, 12, null)).kind).toBe('rest');
  });

  it('rests on an empty list rather than looping on nothing', () => {
    expect(nextMove(freshCarryOn(), plan(0, 0, null)).kind).toBe('rest');
    expect(nextMove(freshCarryOn(), plan(0, 0, 'ghost')).kind).toBe('rest');
  });

  it('rests when the count says done even if a step is still named', () => {
    expect(nextMove(freshCarryOn(), plan(12, 12, 'somehow')).kind).toBe('rest');
  });
});

describe('CO-03 a round that ticks nothing off', () => {
  it('is tolerated once — a step can take two replies', () => {
    const first = nextMove(freshCarryOn(), plan(4, 12));
    expect(first.kind).toBe('ask');
    if (first.kind !== 'ask') return;
    const second = nextMove(first.state, plan(4, 12));
    expect(second.kind).toBe('ask');
    if (second.kind !== 'ask') return;
    expect(second.state.stuck).toBe(1);
  });

  it('stops the second time, out loud', () => {
    let state: CarryOn = freshCarryOn();
    const first = nextMove(state, plan(4, 12));
    if (first.kind !== 'ask') throw new Error('expected ask');
    state = first.state;
    const second = nextMove(state, plan(4, 12));
    if (second.kind !== 'ask') throw new Error('expected ask');
    state = second.state;
    const third = nextMove(state, plan(4, 12));
    expect(third.kind).toBe('stop');
    if (third.kind !== 'stop') return;
    expect(third.said).toBe(carryOnWords.stuck);
  });

  it('forgives a stuck round once the count moves again', () => {
    const first = nextMove(freshCarryOn(), plan(4, 12));
    if (first.kind !== 'ask') throw new Error('expected ask');
    const stalled = nextMove(first.state, plan(4, 12));
    if (stalled.kind !== 'ask') throw new Error('expected ask');
    expect(stalled.state.stuck).toBe(1);
    const moved = nextMove(stalled.state, plan(5, 12));
    if (moved.kind !== 'ask') throw new Error('expected ask');
    expect(moved.state.stuck).toBe(0);
  });

  it('never gives up on the very first round, which has nothing to compare to', () => {
    expect(nextMove(freshCarryOn(), plan(0, 12)).kind).toBe('ask');
  });

  it('gives up after exactly MOST_STUCK rounds without progress', () => {
    let state = freshCarryOn();
    let asks = 0;
    for (let at = 0; at < 10; at += 1) {
      const move = nextMove(state, plan(3, 9));
      if (move.kind === 'stop') break;
      if (move.kind !== 'ask') throw new Error('expected ask');
      asks += 1;
      state = move.state;
    }
    expect(asks).toBe(MOST_STUCK);
  });
});

describe('CO-04 a run that never converges still ends', () => {
  it('stops at the ceiling, and says how many rounds it had', () => {
    let state = freshCarryOn();
    let rounds = 0;
    // Progress every round, so `stuck` never fires and only the ceiling can end it.
    for (let at = 1; at <= MOST_ROUNDS + 5; at += 1) {
      const move = nextMove(state, plan(at, 10_000));
      if (move.kind === 'stop') {
        expect(move.said).toContain(String(MOST_ROUNDS));
        break;
      }
      if (move.kind !== 'ask') throw new Error('expected ask');
      rounds = move.state.rounds;
      state = move.state;
    }
    expect(rounds).toBe(MOST_ROUNDS);
  });

  it('cannot run forever under any answer the plan can give', () => {
    let state = freshCarryOn();
    let asks = 0;
    for (let at = 0; at < 1000; at += 1) {
      const move = nextMove(state, plan(at % 2, 12));
      if (move.kind !== 'ask') break;
      asks += 1;
      state = move.state;
    }
    expect(asks).toBeLessThanOrEqual(MOST_ROUNDS);
  });
});

describe('CO-05 what the next round is asked for in', () => {
  it('names the step, not "continue"', () => {
    const said = carryOnPrompt('Wire the settings row', 4, 12);
    expect(said).toContain('Wire the settings row');
    expect(said).toContain('4 of 12');
    expect(said).toContain('step_done');
  });

  /* The advisor's completion gate answers with everything not yet proven, and a
     model reading that as permission to stop is the whole bug this closes. */
  it('says plainly that an advisor verdict does not end the list', () => {
    const said = carryOnPrompt('Anything', 1, 3);
    expect(said).toContain('advisor');
    expect(said).toContain('not permission to leave the list unfinished');
  });
});
