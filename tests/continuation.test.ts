/** The one decision to send a message the person did not type.
 *
 * Every reason to carry on is here, and so is every way out of each of them —
 * the exits matter more, because a loop that cannot see it is getting nowhere
 * is worse than no loop at all, and a run that goes quiet is the bug this
 * whole file exists to keep closed.
 */

import { describe, expect, it } from 'vitest';

import { carryOnWords } from '../src/work/carryon';
import {
  MOST_ROUNDS,
  MOST_STUCK,
  continuationWords,
  decide,
  freshContinuation,
  personSpoke,
  type EndedHow,
  type Facts,
  type Move,
  type State,
} from '../src/work/continuation';

const facts = (over: Partial<Facts> = {}): Facts => ({
  list: null,
  goal: null,
  endedHow: 'finished',
  boardFinished: [],
  extensionAsked: null,
  ...over,
});

const list = (done: number, total: number, next: string | null = 'the next step', finished = false) =>
  ({ done, total, next, finished });

const asSend = (move: Move) => {
  if (move.kind !== 'send') throw new Error(`expected send, got ${move.kind}`);
  return move;
};
const asStop = (move: Move) => {
  if (move.kind !== 'stop') throw new Error(`expected stop, got ${move.kind}`);
  return move;
};
const asRest = (move: Move) => {
  if (move.kind !== 'rest') throw new Error(`expected rest, got ${move.kind}`);
  return move;
};

const ALL_ENDED: readonly EndedHow[] = [
  'finished',
  'stopped',
  'failed',
  'asked-person',
  'blocked-by-addon',
];

describe('CN-01 nothing left to do', () => {
  it('rests on a settled reply with no list, no goal and nothing waiting', () => {
    const move = decide(freshContinuation(), facts());
    expect(move.kind).toBe('rest');
    expect(asRest(move).said).toBeUndefined();
  });

  it('hands the state back untouched when it rests', () => {
    const state = freshContinuation();
    expect(asRest(decide(state, facts())).state).toEqual(state);
  });

  it('says the list is done when the list is finished', () => {
    const move = decide(freshContinuation(), facts({ list: list(12, 12, null, true) }));
    expect(asRest(move).said).toBe(continuationWords.listDone);
  });

  it('rests when the count says done even if a step is still named', () => {
    const move = decide(freshContinuation(), facts({ list: list(12, 12, 'somehow') }));
    expect(asRest(move).said).toBe(continuationWords.listDone);
  });

  it('rests on an empty list rather than looping on nothing', () => {
    expect(decide(freshContinuation(), facts({ list: list(0, 0, null) })).kind).toBe('rest');
    expect(decide(freshContinuation(), facts({ list: list(0, 0, 'ghost') })).kind).toBe('rest');
  });
});

describe('CN-02 the person pressed stop', () => {
  it('rests without words — they already know', () => {
    const move = decide({ ...freshContinuation(), stopped: true }, facts());
    expect(asRest(move).said).toBeUndefined();
  });

  it('outranks a checklist with steps left', () => {
    const state = { ...freshContinuation(), stopped: true };
    expect(decide(state, facts({ list: list(4, 12) })).kind).toBe('rest');
  });

  it('outranks an add-on asking for another turn', () => {
    const state = { ...freshContinuation(), stopped: true };
    const move = decide(state, facts({ extensionAsked: { from: 'Helper', text: 'go on' } }));
    expect(move.kind).toBe('rest');
  });

  it('outranks an add-on that blocked the run', () => {
    const state = { ...freshContinuation(), stopped: true };
    expect(decide(state, facts({ endedHow: 'blocked-by-addon' })).kind).toBe('rest');
  });

  it('stays stopped whatever else is true', () => {
    const state = { ...freshContinuation(), stopped: true, rounds: 3 };
    for (const endedHow of ALL_ENDED) {
      expect(decide(state, facts({ endedHow, goal: { met: false, reason: 'not yet' } })).kind).toBe(
        'rest',
      );
    }
  });
});

describe('CN-03 an add-on refused every step', () => {
  it('stops out loud rather than leaving the run silent', () => {
    const move = decide(freshContinuation(), facts({ endedHow: 'blocked-by-addon' }));
    expect(asStop(move).said).toBe(continuationWords.blocked);
  });

  it('says the run was left alone, and where to turn the add-on off', () => {
    const move = asStop(decide(freshContinuation(), facts({ endedHow: 'blocked-by-addon' })));
    expect(move.said).toContain('add-on');
    expect(move.said).toContain('Add-ons');
  });

  it('marks the state stopped, so nothing carries on after it', () => {
    const move = asStop(decide(freshContinuation(), facts({ endedHow: 'blocked-by-addon' })));
    expect(move.state.stopped).toBe(true);
    expect(decide(move.state, facts({ list: list(1, 9) })).kind).toBe('rest');
  });

  it('outranks every reason to carry on', () => {
    const move = decide(
      freshContinuation(),
      facts({
        endedHow: 'blocked-by-addon',
        list: list(1, 9),
        goal: { met: false, reason: 'not yet' },
        boardFinished: [{ id: 'p1', title: 'One' }],
        extensionAsked: { from: 'Helper', text: 'go on' },
      }),
    );
    expect(move.kind).toBe('stop');
  });
});

describe('CN-04 somebody is being asked a question', () => {
  it('rests without words when the run ended asking the person', () => {
    const move = decide(freshContinuation(), facts({ endedHow: 'asked-person' }));
    expect(asRest(move).said).toBeUndefined();
  });

  it('rests while a card is open, whatever ended the run', () => {
    const waiting = { ...freshContinuation(), waitingOnPerson: true };
    for (const endedHow of ['finished', 'failed'] as const) {
      expect(decide(waiting, facts({ endedHow })).kind).toBe('rest');
    }
  });

  it('never nudges a checklist while a question is open', () => {
    const waiting = { ...freshContinuation(), waitingOnPerson: true };
    expect(decide(waiting, facts({ list: list(4, 12) })).kind).toBe('rest');
  });

  it('never nudges a goal while a question is open', () => {
    const waiting = { ...freshContinuation(), waitingOnPerson: true };
    expect(decide(waiting, facts({ goal: { met: false, reason: 'two left' } })).kind).toBe('rest');
  });

  it('holds a board finish and an add-on ask rather than sending over a question', () => {
    const waiting = { ...freshContinuation(), waitingOnPerson: true };
    const move = decide(
      waiting,
      facts({
        boardFinished: [{ id: 'p1', title: 'One' }],
        extensionAsked: { from: 'Helper', text: 'go on' },
      }),
    );
    expect(move.kind).toBe('rest');
  });

  it('spends no round while it waits', () => {
    const waiting = { ...freshContinuation(), waitingOnPerson: true, rounds: 5 };
    expect(asRest(decide(waiting, facts({ list: list(4, 12) }))).state.rounds).toBe(5);
  });
});

describe('CN-05 the run itself was stopped', () => {
  it('rests rather than starting it again', () => {
    expect(decide(freshContinuation(), facts({ endedHow: 'stopped' })).kind).toBe('rest');
  });

  it('rests even with steps still on the list', () => {
    const move = decide(freshContinuation(), facts({ endedHow: 'stopped', list: list(2, 9) }));
    expect(move.kind).toBe('rest');
  });
});

describe('CN-06 an add-on asked for another turn', () => {
  it('sends the add-on’s own words, not ours', () => {
    const move = asSend(
      decide(freshContinuation(), facts({ extensionAsked: { from: 'Helper', text: 'Continue objective: ship it' } })),
    );
    expect(move.why).toBe('extension');
    expect(move.text).toBe('Continue objective: ship it');
  });

  it('says which add-on asked, so a turn nobody typed is attributed', () => {
    const move = asSend(
      decide(freshContinuation(), facts({ extensionAsked: { from: 'Helper', text: 'go on' } })),
    );
    expect(move.said).toContain('Helper');
    expect(move.said).toBe(continuationWords.extensionAsked('Helper'));
  });

  it('counts against the same round budget as everything else', () => {
    const move = asSend(
      decide(freshContinuation(), facts({ extensionAsked: { from: 'Helper', text: 'go on' } })),
    );
    expect(move.state.rounds).toBe(1);
  });

  it('sends once per event — the next decision without one rests', () => {
    const first = asSend(
      decide(freshContinuation(), facts({ extensionAsked: { from: 'Helper', text: 'go on' } })),
    );
    expect(decide(first.state, facts()).kind).toBe('rest');
  });

  it('outranks the board, the checklist and the goal', () => {
    const move = asSend(
      decide(
        freshContinuation(),
        facts({
          list: list(1, 9),
          goal: { met: false, reason: 'not yet' },
          boardFinished: [{ id: 'p1', title: 'One' }],
          extensionAsked: { from: 'Helper', text: 'go on' },
        }),
      ),
    );
    expect(move.why).toBe('extension');
  });

  it('is stopped out loud by the ceiling like any other reason', () => {
    const spent = { ...freshContinuation(), rounds: MOST_ROUNDS };
    const move = asStop(
      decide(spent, facts({ extensionAsked: { from: 'Helper', text: 'go on' } })),
    );
    expect(move.said).toBe(continuationWords.spent(MOST_ROUNDS));
    expect(move.state.stopped).toBe(true);
  });
});

describe('CN-07 board pieces finished', () => {
  it('sends, telling the model which pieces landed', () => {
    const move = asSend(
      decide(
        freshContinuation(),
        facts({
          boardFinished: [
            { id: 'p1', title: 'Dark theme' },
            { id: 'p2', title: 'Light theme' },
          ],
        }),
      ),
    );
    expect(move.why).toBe('board');
    expect(move.text).toContain('Dark theme');
    expect(move.text).toContain('Light theme');
  });

  it('counts them in what it says out loud', () => {
    const move = asSend(
      decide(
        freshContinuation(),
        facts({
          boardFinished: [
            { id: 'p1', title: 'One' },
            { id: 'p2', title: 'Two' },
            { id: 'p3', title: 'Three' },
          ],
        }),
      ),
    );
    expect(move.said).toContain('3');
  });

  it('names the piece when only one landed', () => {
    const move = asSend(
      decide(freshContinuation(), facts({ boardFinished: [{ id: 'p1', title: 'Dark theme' }] })),
    );
    expect(move.said).toContain('Dark theme');
  });

  it('sends once for the event, not twice', () => {
    const first = asSend(
      decide(freshContinuation(), facts({ boardFinished: [{ id: 'p1', title: 'One' }] })),
    );
    expect(decide(first.state, facts()).kind).toBe('rest');
  });

  it('outranks a checklist with steps left', () => {
    const move = asSend(
      decide(
        freshContinuation(),
        facts({ list: list(1, 9), boardFinished: [{ id: 'p1', title: 'One' }] }),
      ),
    );
    expect(move.why).toBe('board');
  });

  it('spends a round, so board finishes cannot run past the ceiling', () => {
    const spent = { ...freshContinuation(), rounds: MOST_ROUNDS };
    const move = asStop(decide(spent, facts({ boardFinished: [{ id: 'p1', title: 'One' }] })));
    expect(move.said).toContain(String(MOST_ROUNDS));
  });
});

describe('CN-08 a checklist with steps left', () => {
  it('sends the carry-on wording, naming the step', () => {
    const move = asSend(
      decide(freshContinuation(), facts({ list: list(4, 12, 'Wire the settings row') })),
    );
    expect(move.why).toBe('checklist');
    expect(move.text).toContain('Wire the settings row');
    expect(move.text).toContain('4 of 12');
    expect(move.text).toContain('step_done');
  });

  it('says the round out loud in the carry-on words', () => {
    const move = asSend(
      decide(freshContinuation(), facts({ list: list(4, 12, 'Wire the settings row') })),
    );
    expect(move.said).toBe(carryOnWords.round(1, 4, 12, 'Wire the settings row'));
  });

  it('counts rounds up as it goes', () => {
    let state: State = freshContinuation();
    for (let at = 1; at <= 5; at += 1) {
      const move = asSend(decide(state, facts({ list: list(at, 12) })));
      expect(move.state.rounds).toBe(at);
      state = move.state;
    }
  });

  it('remembers the tick count it sent on, so progress is measured', () => {
    const move = asSend(decide(freshContinuation(), facts({ list: list(4, 12) })));
    expect(move.state.ticksAtLastRound).toBe(4);
  });

  it('tolerates one round that ticks nothing off', () => {
    const first = asSend(decide(freshContinuation(), facts({ list: list(4, 12) })));
    const second = asSend(decide(first.state, facts({ list: list(4, 12) })));
    expect(second.state.stuckRounds).toBe(1);
  });

  it('stops the second time, out loud', () => {
    const first = asSend(decide(freshContinuation(), facts({ list: list(4, 12) })));
    const second = asSend(decide(first.state, facts({ list: list(4, 12) })));
    const third = asStop(decide(second.state, facts({ list: list(4, 12) })));
    expect(third.said).toBe(carryOnWords.stuck);
    expect(third.state.stopped).toBe(true);
  });

  it('forgives a stuck round once the count moves again', () => {
    const first = asSend(decide(freshContinuation(), facts({ list: list(4, 12) })));
    const stalled = asSend(decide(first.state, facts({ list: list(4, 12) })));
    expect(stalled.state.stuckRounds).toBe(1);
    const moved = asSend(decide(stalled.state, facts({ list: list(5, 12) })));
    expect(moved.state.stuckRounds).toBe(0);
  });

  it('never gives up on the first round, which has nothing to compare to', () => {
    expect(decide(freshContinuation(), facts({ list: list(0, 12) })).kind).toBe('send');
  });

  it('gives up after exactly MOST_STUCK rounds without progress', () => {
    let state: State = freshContinuation();
    let sends = 0;
    for (let at = 0; at < 10; at += 1) {
      const move = decide(state, facts({ list: list(3, 9) }));
      if (move.kind === 'stop') break;
      sends += 1;
      state = asSend(move).state;
    }
    expect(sends).toBe(MOST_STUCK);
  });

  it('stops at the ceiling and says how many rounds it had', () => {
    let state: State = freshContinuation();
    let rounds = 0;
    for (let at = 1; at <= MOST_ROUNDS + 5; at += 1) {
      const move = decide(state, facts({ list: list(at, 10_000) }));
      if (move.kind === 'stop') {
        expect(move.said).toBe(continuationWords.spent(MOST_ROUNDS));
        break;
      }
      rounds = asSend(move).state.rounds;
      state = asSend(move).state;
    }
    expect(rounds).toBe(MOST_ROUNDS);
  });

  it('cannot run forever under any answer the list can give', () => {
    let state: State = freshContinuation();
    let sends = 0;
    for (let at = 0; at < 1000; at += 1) {
      const move = decide(state, facts({ list: list(at % 2, 12) }));
      if (move.kind !== 'send') break;
      sends += 1;
      state = move.state;
    }
    expect(sends).toBeLessThanOrEqual(MOST_ROUNDS);
  });
});

describe('CN-09 a goal not met yet', () => {
  it('sends, naming the objective and why it is not met', () => {
    const move = asSend(
      decide(
        freshContinuation(),
        facts({ goal: { met: false, reason: '2/5 tasks done.', objective: 'ship the settings row' } }),
      ),
    );
    expect(move.why).toBe('goal');
    expect(move.text).toContain('ship the settings row');
    expect(move.text).toContain('2/5 tasks done.');
  });

  it('names the objective in what it says out loud', () => {
    const move = asSend(
      decide(
        freshContinuation(),
        facts({ goal: { met: false, reason: 'not yet', objective: 'ship it' } }),
      ),
    );
    expect(move.said).toContain('ship it');
  });

  it('still carries on when the goal was never given words', () => {
    const move = asSend(decide(freshContinuation(), facts({ goal: { met: false, reason: 'not yet' } })));
    expect(move.why).toBe('goal');
    expect(move.text).toContain('not yet');
  });

  it('rests once the goal is met', () => {
    expect(decide(freshContinuation(), facts({ goal: { met: true, reason: 'all done' } })).kind).toBe(
      'rest',
    );
  });

  it('lets the checklist go first while steps are still on it', () => {
    const move = asSend(
      decide(
        freshContinuation(),
        facts({ list: list(1, 9), goal: { met: false, reason: 'not yet' } }),
      ),
    );
    expect(move.why).toBe('checklist');
  });

  it('works the goal once the list beneath it is finished', () => {
    const move = asSend(
      decide(
        freshContinuation(),
        facts({ list: list(9, 9, null, true), goal: { met: false, reason: 'still not proven' } }),
      ),
    );
    expect(move.why).toBe('goal');
  });

  it('stops out loud after MOST_STUCK rounds that move nothing', () => {
    const done = () => facts({ list: list(9, 9, null, true), goal: { met: false, reason: 'no' } });
    const first = asSend(decide(freshContinuation(), done()));
    const second = asSend(decide(first.state, done()));
    const third = asStop(decide(second.state, done()));
    expect(third.said).toBe(continuationWords.goalStuck('no'));
    expect(third.state.stopped).toBe(true);
  });

  it('is held to the same ceiling when there is no list to count against', () => {
    let state: State = freshContinuation();
    let sends = 0;
    for (let at = 0; at < 200; at += 1) {
      const move = decide(state, facts({ goal: { met: false, reason: 'not yet' } }));
      if (move.kind !== 'send') {
        expect(move.kind).toBe('stop');
        break;
      }
      sends += 1;
      state = move.state;
    }
    expect(sends).toBe(MOST_ROUNDS);
  });
});

describe('CN-10 a run that fell over', () => {
  it('is picked up once', () => {
    const move = asSend(decide(freshContinuation(), facts({ endedHow: 'failed' })));
    expect(move.why).toBe('recovery');
    expect(move.state.rounds).toBe(1);
  });

  it('says it is picking it up, rather than starting again in silence', () => {
    const move = asSend(decide(freshContinuation(), facts({ endedHow: 'failed' })));
    expect(move.said).toContain('error');
  });

  it('never retries a failure twice in a row', () => {
    const first = asSend(decide(freshContinuation(), facts({ endedHow: 'failed' })));
    const second = asRest(decide(first.state, facts({ endedHow: 'failed' })));
    expect(second.said).toBe(continuationWords.recoveryTwice);
  });

  it('cannot loop on failures however many arrive', () => {
    let state: State = freshContinuation();
    let sends = 0;
    for (let at = 0; at < 50; at += 1) {
      const move = decide(state, facts({ endedHow: 'failed' }));
      if (move.kind === 'send') {
        sends += 1;
        state = move.state;
      } else {
        state = move.state;
      }
    }
    expect(sends).toBe(1);
  });

  it('picks a later failure up again once the person has spoken', () => {
    const first = asSend(decide(freshContinuation(), facts({ endedHow: 'failed' })));
    const after = personSpoke(first.state);
    expect(asSend(decide(after, facts({ endedHow: 'failed' }))).why).toBe('recovery');
  });

  it('lets the checklist go first — the list is the better answer to a failure', () => {
    const move = asSend(
      decide(freshContinuation(), facts({ endedHow: 'failed', list: list(2, 9) })),
    );
    expect(move.why).toBe('checklist');
  });
});

describe('CN-11 the person typed something', () => {
  it('starts the round budget again', () => {
    const spent = { ...freshContinuation(), rounds: MOST_ROUNDS };
    expect(personSpoke(spent).rounds).toBe(0);
    expect(decide(personSpoke(spent), facts({ list: list(1, 9) })).kind).toBe('send');
  });

  it('clears a stop, so Escape ends one run rather than the sitting', () => {
    const stopped = { ...freshContinuation(), stopped: true };
    expect(personSpoke(stopped).stopped).toBe(false);
    expect(decide(personSpoke(stopped), facts({ list: list(1, 9) })).kind).toBe('send');
  });

  it('clears the wait, because they have just answered', () => {
    const waiting = { ...freshContinuation(), waitingOnPerson: true };
    expect(personSpoke(waiting).waitingOnPerson).toBe(false);
  });

  it('forgets the stuck count and the tick baseline', () => {
    const stuck = { ...freshContinuation(), stuckRounds: 1, ticksAtLastRound: 7 };
    expect(personSpoke(stuck).stuckRounds).toBe(0);
    expect(personSpoke(stuck).ticksAtLastRound).toBe(-1);
  });
});

describe('CN-12 the decision is total', () => {
  it('answers for every way a run can end, with and without a reason to carry on', () => {
    for (const endedHow of ALL_ENDED) {
      for (const over of [
        {},
        { list: list(1, 9) },
        { goal: { met: false, reason: 'not yet' } },
        { boardFinished: [{ id: 'p1', title: 'One' }] },
        { extensionAsked: { from: 'Helper', text: 'go on' } },
      ]) {
        const move = decide(freshContinuation(), facts({ endedHow, ...over }));
        expect(['send', 'rest', 'stop']).toContain(move.kind);
        expect(move.state).toBeDefined();
      }
    }
  });

  it('gives back a state on every move, so nothing has to guess the next one', () => {
    for (const endedHow of ALL_ENDED) {
      const move = decide(freshContinuation(), facts({ endedHow, list: list(1, 9) }));
      expect(typeof move.state.rounds).toBe('number');
    }
  });

  it('says something out loud on every stop', () => {
    const spent = { ...freshContinuation(), rounds: MOST_ROUNDS };
    for (const over of [
      { endedHow: 'blocked-by-addon' as const },
      { list: list(1, 9) },
      { boardFinished: [{ id: 'p1', title: 'One' }] },
    ]) {
      const move = decide(spent, facts(over));
      if (move.kind === 'stop') expect(move.said.length).toBeGreaterThan(0);
    }
  });

  it('changes nothing it was given — the same facts twice give the same move', () => {
    const state = freshContinuation();
    const given = facts({ list: list(4, 12) });
    const once = decide(state, given);
    const twice = decide(state, given);
    expect(once).toEqual(twice);
    expect(state).toEqual(freshContinuation());
  });

  it('never sends past the ceiling, whatever the reason', () => {
    const spent = { ...freshContinuation(), rounds: MOST_ROUNDS };
    for (const over of [
      { list: list(1, 9) },
      { goal: { met: false, reason: 'not yet' } },
      { boardFinished: [{ id: 'p1', title: 'One' }] },
      { extensionAsked: { from: 'Helper', text: 'go on' } },
      { endedHow: 'failed' as const },
    ]) {
      expect(decide(spent, facts(over)).kind).not.toBe('send');
    }
  });
});
