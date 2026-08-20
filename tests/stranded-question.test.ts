/** A question that outlives the turn that asked it.
 *
 * The window works out that it is busy from the last turn still waiting on a
 * person. So a confirmation card left unanswered when everything stops is not
 * a cosmetic leftover — it is the app believing, for the rest of the sitting,
 * that work is still going. The composer stays a spinner, and Stop has nothing
 * left to stop, so pressing it does nothing at all.
 *
 * It comes back with the history too, so reopening the conversation reopens the
 * wedge. That is what "clicking stop also did not make it stop" was.
 */

import { describe, expect, it } from 'vitest';

import { applyEvent, planned, said } from '../src/lib/thread';
import type { Turn } from '../src/lib/thread';

const ASKED: Turn = {
  kind: 'asked',
  id: 'a1',
  callId: 'call-1',
  question: 'Run a program from outside your project?',
  answered: null,
};

describe('when everything stops', () => {
  it('closes a question nobody can answer any more', () => {
    const after = applyEvent([said('you', 'start the server'), ASKED], { type: 'settled' });
    const question = after.find((one) => one.kind === 'asked');
    expect(question?.kind).toBe('asked');
    if (question?.kind !== 'asked') return;
    // Refused rather than removed: it happened, and a card that vanishes leaves
    // somebody wondering whether it went through.
    expect(question.answered).toBe('no');
  });

  it('leaves a question somebody already answered exactly as it was', () => {
    const yes: Turn = { ...ASKED, answered: 'yes' };
    const after = applyEvent([yes], { type: 'settled' });
    const question = after.find((one) => one.kind === 'asked');
    if (question?.kind !== 'asked') return;
    expect(question.answered).toBe('yes');
  });

  it('changes nothing when there was no question at all', () => {
    const turns = [said('you', 'hello'), said('graphe', 'hi')];
    expect(applyEvent(turns, { type: 'settled' })).toBe(turns);
  });

  /** A plan and an estimate hold a message back until they are answered; they
   *  are somebody's to answer whenever they get to it, and a settle must not
   *  quietly decide for them. Only a confirmation dies with its turn. */
  it('does not answer a plan on somebody’s behalf', () => {
    const plan = planned('rebuild the header', { steps: ['one'], caveats: [] });
    const after = applyEvent([plan], { type: 'settled' });
    const found = after.find((one) => one.kind === 'plan');
    if (found?.kind !== 'plan') return;
    expect(found.answered).toBeNull();
  });
});

describe('a question the shell says is off the table', () => {
  it('closes exactly the ones it names', () => {
    const other: Turn = { ...ASKED, id: 'a2', callId: 'call-2' };
    const after = applyEvent([ASKED, other], {
      type: 'questions-withdrawn',
      callIds: ['call-1'],
    });
    const first = after.find((one) => one.kind === 'asked' && one.callId === 'call-1');
    const second = after.find((one) => one.kind === 'asked' && one.callId === 'call-2');
    if (first?.kind !== 'asked' || second?.kind !== 'asked') return;
    expect(first.answered).toBe('no');
    expect(second.answered).toBeNull();
  });
});
