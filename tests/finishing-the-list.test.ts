/** "It does one step and stops."
 *
 * One module decides, in the main process, and it is pure — so these run the
 * decision rather than reading a source file for it.
 */

import { describe, expect, it } from 'vitest';

import {
  decide,
  freshContinuation,
  MOST_ROUNDS,
  MOST_STUCK,
  personSpoke,
  type Facts,
  type State,
} from '../src/work/continuation';
import { listForGoal } from '../src/work/goal';

function facts(over: Partial<Facts> = {}): Facts {
  return {
    list: null,
    goal: null,
    endedHow: 'finished',
    boardFinished: [],
    extensionAsked: null,
    ...over,
  };
}

const list = (done: number, total: number): Facts['list'] => ({
  done,
  total,
  next: done >= total ? null : `Step ${String(done + 1)}`,
  finished: done >= total,
});

/** Run rounds until it stops asking, so the whole loop can be inspected rather
 *  than one turn of it. `ticks` says how many steps each round gets done. */
function through(
  start: State,
  each: Facts,
  ticks: (round: number) => number,
): { sends: number; last: ReturnType<typeof decide> } {
  let state = start;
  let sends = 0;
  let done = each.list?.done ?? 0;
  for (let round = 1; round <= MOST_ROUNDS + 4; round += 1) {
    const total = each.list?.total ?? 0;
    const move = decide(state, { ...each, list: total === 0 ? null : list(done, total) });
    if (move.kind !== 'send') return { sends, last: move };
    sends += 1;
    state = move.state;
    done = Math.min(total, done + ticks(round));
  }
  throw new Error('the loop never stopped');
}

describe('FL-01 a list with steps left asks for the next one', () => {
  it('asks, names the step, and counts the round', () => {
    const move = decide(freshContinuation(), facts({ list: list(3, 12) }));
    expect(move.kind).toBe('send');
    if (move.kind !== 'send') return;
    expect(move.why).toBe('checklist');
    expect(move.said).toContain('Step 4');
    expect(move.state.rounds).toBe(1);
  });

  it('rests the moment the list is finished, and says so rather than going quiet', () => {
    const move = decide(freshContinuation(), facts({ list: list(12, 12) }));
    expect(move.kind).toBe('rest');
    if (move.kind !== 'rest') return;
    expect(move.said ?? '').not.toBe('');
  });

  it('works a twelve-step list down without being asked again', () => {
    const ran = through(freshContinuation(), facts({ list: list(0, 12) }), () => 4);
    expect(ran.sends).toBeGreaterThan(0);
    expect(ran.last.kind).toBe('rest');
  });
});

describe('FL-02 every way it stops', () => {
  it('stops after two rounds that tick nothing off, out loud', () => {
    const ran = through(freshContinuation(), facts({ list: list(2, 9) }), () => 0);
    expect(ran.sends).toBe(MOST_STUCK);
    expect(ran.last.kind).toBe('stop');
    if (ran.last.kind !== 'stop') return;
    expect(ran.last.said).not.toBe('');
  });

  it('stops when the round budget is spent, out loud', () => {
    const ran = through(freshContinuation(), facts({ list: list(0, 500) }), () => 1);
    expect(ran.sends).toBe(MOST_ROUNDS);
    expect(ran.last.kind).toBe('stop');
    if (ran.last.kind !== 'stop') return;
    expect(ran.last.said).toContain(String(MOST_ROUNDS));
  });

  it('never asks again once somebody has pressed Escape', () => {
    const stopped: State = { ...freshContinuation(), stopped: true };
    expect(decide(stopped, facts({ list: list(1, 8) })).kind).toBe('rest');
  });

  it('never nudges somebody who is being asked a question', () => {
    expect(decide(freshContinuation(), facts({ list: list(1, 8), endedHow: 'asked-person' })).kind).toBe(
      'rest',
    );
    const waiting: State = { ...freshContinuation(), waitingOnPerson: true };
    expect(decide(waiting, facts({ list: list(1, 8) })).kind).toBe('rest');
  });

  it('never nudges into a session an add-on has stopped', () => {
    const move = decide(freshContinuation(), facts({ list: list(1, 8), endedHow: 'blocked-by-addon' }));
    expect(move.kind).toBe('stop');
  });

  it('starts the budget again when the person says something', () => {
    const spent: State = { ...freshContinuation(), rounds: MOST_ROUNDS, stuckRounds: 2, stopped: true };
    const after = personSpoke(spent);
    expect(after.rounds).toBe(0);
    expect(after.stopped).toBe(false);
    expect(decide(after, facts({ list: list(1, 8) })).kind).toBe('send');
  });
});

describe('FL-03 a goal has a list to be measured against', () => {
  it('gets one of its own written when the model could not write one', () => {
    expect(listForGoal('make the tests pass')).toEqual(['Reach: make the tests pass']);
  });

  it('carries on toward an unmet goal, naming it', () => {
    const move = decide(
      freshContinuation(),
      facts({ goal: { met: false, reason: '2 of 5 steps settled.', objective: 'ship it' } }),
    );
    expect(move.kind).toBe('send');
    if (move.kind !== 'send') return;
    expect(move.why).toBe('goal');
    expect(move.text).toContain('ship it');
  });

  it('rests once the goal is met', () => {
    const move = decide(
      freshContinuation(),
      facts({ goal: { met: true, reason: 'all settled', objective: 'ship it' } }),
    );
    expect(move.kind).toBe('rest');
  });
});

describe('FL-04 one continuation per settle, whatever the reasons', () => {
  it('does not send twice when a list, a goal and the board all want a turn', () => {
    const move = decide(
      freshContinuation(),
      facts({
        list: list(1, 6),
        goal: { met: false, reason: 'not yet', objective: 'ship it' },
        boardFinished: [{ id: 'a', title: 'The header' }],
      }),
    );
    expect(move.kind).toBe('send');
    if (move.kind !== 'send') return;
    expect(move.state.rounds).toBe(1);
  });
});

describe('FL-05 the board tells the conversation it has finished', () => {
  it('takes finished pieces in, naming them', () => {
    const move = decide(
      freshContinuation(),
      facts({ boardFinished: [{ id: 'a', title: 'The header' }] }),
    );
    expect(move.kind).toBe('send');
    if (move.kind !== 'send') return;
    expect(move.why).toBe('board');
    expect(move.text).toContain('The header');
  });
});

describe('FL-06 an add-on that asks for a turn is one of ours, and is named', () => {
  it('is attributed, counted against the budget, and sent once', () => {
    const move = decide(
      freshContinuation(),
      facts({ extensionAsked: { from: 'an add-on', text: 'Continue objective: ship it' } }),
    );
    expect(move.kind).toBe('send');
    if (move.kind !== 'send') return;
    expect(move.why).toBe('extension');
    expect(move.said).toContain('an add-on');
    expect(move.state.rounds).toBe(1);
    // Consumed by the owner, so the same ask cannot send twice.
    expect(decide(move.state, facts()).kind).toBe('rest');
  });
});

describe('FL-07 a run that failed is picked up once, never twice', () => {
  it('tries once', () => {
    const move = decide(freshContinuation(), facts({ endedHow: 'failed' }));
    expect(move.kind).toBe('send');
    if (move.kind !== 'send') return;
    expect(move.why).toBe('recovery');
  });

  it('does not try the same failure again', () => {
    const tried: State = { ...freshContinuation(), recoveryAttempts: 1 };
    expect(decide(tried, facts({ endedHow: 'failed' })).kind).not.toBe('send');
  });

  /* This used to be counted on `stuckRounds`, which a round that ticked nothing
     off also increments, so one stalled round spent the retry a failure is
     allowed and the run rested saying it had already tried when it had not. */
  it('still tries after a round that ticked nothing off', () => {
    const stalled: State = { ...freshContinuation(), stuckRounds: 1 };
    expect(decide(stalled, facts({ endedHow: 'failed' })).kind).toBe('send');
  });
});
