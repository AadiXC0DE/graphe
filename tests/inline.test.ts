/** Waiting in line: a second thought typed while something is still running.
 *
 * The rule the window follows is one message at a time, in the order they were
 * typed, and never past a question — a question on screen is the agent waiting
 * for a person, and the line waits for that too.
 */

import { describe, expect, it } from 'vitest';

import { askingYou, estimated, said, type Turn } from '../src/lib/thread';

const prompt = {
  title: 'This is a bigger job',
  body: 'Want me to go ahead?',
  confirm: 'Go ahead',
  alternative: 'Start smaller',
};

describe('whether the conversation is waiting on a person', () => {
  it('is not, on an empty thread or an ordinary one', () => {
    expect(askingYou([])).toBe(false);
    expect(askingYou([said('you', 'make the header smaller')])).toBe(false);
  });

  it('is, while an estimate has not been answered', () => {
    const turn = estimated('rebuild the whole site', prompt);
    expect(askingYou([turn])).toBe(true);
  });

  it('is not, once it has been', () => {
    const answered = { ...estimated('rebuild the whole site', prompt), answered: 'went-ahead' } as Turn;
    expect(askingYou([answered])).toBe(false);
  });

  it('is, while the Guard is asking', () => {
    const asking: Turn = {
      kind: 'asked',
      id: 'a1',
      callId: 'c1',
      question: 'Delete the old logo?',
      answered: null,
    };
    expect(askingYou([asking])).toBe(true);
    expect(askingYou([{ ...asking, answered: 'yes' }])).toBe(false);
  });

  it('is, while a plan is waiting to be agreed', () => {
    const plan: Turn = {
      kind: 'plan',
      id: 'p1',
      text: 'redo the pricing page',
      steps: ['read the page', 'change the type'],
      caveats: [],
      answered: null,
    };
    expect(askingYou([plan])).toBe(true);
    expect(askingYou([{ ...plan, answered: 'went-ahead' }])).toBe(false);
  });

  /* Only the last turn: a question answered ten turns ago is history, and a
     line that never drained again would be worse than no line at all. */
  it('looks at the end of the conversation and nowhere else', () => {
    const settled: Turn = {
      kind: 'asked',
      id: 'a1',
      callId: 'c1',
      question: 'Delete the old logo?',
      answered: null,
    };
    expect(askingYou([settled, said('graphe', 'Done.')])).toBe(false);
  });
});
