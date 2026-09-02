/** A settle that says how it came about.
 *
 * A settle used to say nothing about how the run ended, so the synthetic one
 * Stop makes reached every reader looking exactly like success: the list
 * advanced, the checkout was applied, screenshots were taken for work nobody
 * finished. And the window worked out that it was busy from the shape of the
 * turns, so a step left running by a stop kept the composer a spinner for the
 * rest of the sitting.
 */

import { describe, expect, it } from 'vitest';

import { applyEvent, said, STEP_WAS_STOPPED, type Turn } from '../src/lib/thread';
import { changeDesk, noDesks, openDesk, receive, type Desks } from '../src/lib/projects';
import { sizeUp } from '../src/cost/sizing';
import type { AgentEvent } from '../src/agent/types';

function running(): readonly Turn[] {
  let turns: readonly Turn[] = [];
  turns = applyEvent(turns, {
    type: 'tool-start',
    call: { id: 'a', name: 'bash', input: { command: 'npm test' } },
  });
  turns = applyEvent(turns, { type: 'message-delta', text: 'working on it' });
  return turns;
}

const stillRunning = (turns: readonly Turn[]): number =>
  turns.filter((one) => one.kind === 'did' && one.state === 'running').length;

describe('a run that was ended rather than one that ended', () => {
  it('closes every running step as stopped, and says so', () => {
    const after = applyEvent(running(), { type: 'settled', how: 'stopped' });
    expect(stillRunning(after)).toBe(0);
    const step = after.find((one) => one.kind === 'did');
    expect(step?.kind === 'did' && step.state).toBe('failed');
    expect(step?.kind === 'did' && step.detail).toBe(STEP_WAS_STOPPED);
  });

  it('does the same for a failure and for an add-on that refused everything', () => {
    for (const how of ['failed', 'blocked-by-addon'] as const) {
      expect(stillRunning(applyEvent(running(), { type: 'settled', how }))).toBe(0);
    }
  });

  it('leaves a finished run’s steps alone — they closed themselves', () => {
    const after = applyEvent(running(), { type: 'settled', how: 'finished' });
    expect(stillRunning(after)).toBe(1);
  });

  /* Nothing said is the old shape, and it has to keep meaning what it meant. */
  it('reads a settle with nothing said as one that finished', () => {
    expect(stillRunning(applyEvent(running(), { type: 'settled' }))).toBe(1);
  });

  it('closes the reply that was still arriving, whatever the ending', () => {
    for (const how of ['stopped', 'finished'] as const) {
      const after = applyEvent(running(), { type: 'settled', how });
      expect(after.some((one) => one.kind === 'said' && one.streaming)).toBe(false);
    }
  });
});

describe('an app-level notice', () => {
  it('is said in the thread as a line, never as trouble', () => {
    const after = applyEvent([], {
      type: 'notice',
      what: 'The spending ceiling is reached.',
      because: 'Nothing new will start.',
    });
    expect(after).toHaveLength(1);
    expect(after[0]?.kind).toBe('said');
    expect(after[0]?.kind === 'said' && after[0].text).toContain('ceiling');
    // Trouble paints the conversation red and fails every step it was running,
    // for something the conversation did not do.
    expect(after.some((one) => one.kind === 'said' && 'trouble' in one)).toBe(false);
  });
});

describe('the job in flight', () => {
  const where = '/work/site';

  /* The job is set by the window when it sends, not by anything the agent
     says — so it is set here the same way. */
  function desksWithAJob(): Desks {
    return changeDesk(openDesk(noDesks, { path: where, name: 'site' }), where, (one) => ({
      ...one,
      doing: { task: sizeUp('a short request'), startedAt: Date.now() - 1_000 },
    }));
  }

  /* `doing` used to clear only when a split arrived, and a split arrives only
     when something was priced — so a provider that reports no cost left the tab
     spinning and the composer busy for the rest of the sitting. */
  it('clears when the run does, whatever it cost', () => {
    const desks = receive(desksWithAJob(), {
      project: where,
      conversation: null,
      event: { type: 'settled', how: 'finished' },
    });
    expect(desks.byPath[where]?.doing).toBeNull();
  });

  it('is still there to be filed against when the split lands a beat later', () => {
    let desks = desksWithAJob();
    const before = desks.byPath[where]?.jobs.length ?? 0;
    desks = receive(desks, {
      project: where,
      conversation: null,
      event: { type: 'settled', how: 'finished' },
    });
    desks = receive(desks, {
      project: where,
      conversation: null,
      event: {
        type: 'spend-summary',
        summary: {
          total: { minor: 42, currency: 'USD' },
          byLabel: [],
          byReason: [],
          retries: 0,
        } as unknown as Extract<AgentEvent, { type: 'spend-summary' }>['summary'],
      },
    });
    expect(desks.byPath[where]?.jobs.length).toBe(before + 1);
    expect(desks.byPath[where]?.filing).toBeNull();
  });
});

describe('a line the app says about itself', () => {
  it('reads as a sentence rather than as a turn nobody took', () => {
    const one = said('graphe', 'Step 4 of 12 · carrying on');
    expect(one.kind).toBe('said');
    expect(one.kind === 'said' && one.from).toBe('graphe');
  });
});
