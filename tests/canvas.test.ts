/** The board laid out as a graph.
 *
 * Two claims are worth holding: a chain reads as one straight line, and a line
 * somebody drags is refused here for the same reasons the board would refuse it
 * — the canvas must never be a way to ask for work that could not run.
 */

import { describe, expect, it } from 'vitest';

import {
  askedFor,
  canWaitFor,
  canvasWords,
  layOut,
  STARTERS,
  STEP_KINDS,
  stepKind,
  waitingOn,
  type Step,
} from '../src/work/canvas';
import type { WorkState } from '../src/work/board';

/* ------------------------------------------------------------ scaffolding */

const AT = new Date(2026, 7, 12, 15, 30).getTime();
let counter = 0;

function step(id: string, after: string | null = null, state: WorkState = 'waiting'): Step {
  counter += 1;
  return {
    id,
    doing: `Do ${id}`,
    state,
    at: AT + counter * 1000,
    after,
    says: null,
    trouble: null,
    asking: false,
  };
}

/* ========================================================================== */
/* Laying it out                                                              */
/* ========================================================================== */

describe('laying the board out', () => {
  it('has nothing to draw for an empty board', () => {
    expect(layOut([])).toEqual({ steps: [], columns: 0, rows: 0 });
  });

  it('puts a chain on one row, one column each', () => {
    const flow = layOut([step('a'), step('b', 'a'), step('c', 'b')]);
    expect(flow.columns).toBe(3);
    expect(flow.rows).toBe(1);
    expect(flow.steps.map((one) => [one.id, one.column, one.row])).toEqual([
      ['a', 0, 0],
      ['b', 1, 0],
      ['c', 2, 0],
    ]);
  });

  it('puts work that waits for nothing side by side', () => {
    const flow = layOut([step('a'), step('b'), step('c')]);
    expect(flow.columns).toBe(1);
    expect(flow.rows).toBe(3);
    expect(flow.steps.map((one) => one.row)).toEqual([0, 1, 2]);
  });

  it('keeps the first of a fork on its parent’s row and moves the rest down', () => {
    const flow = layOut([step('a'), step('b', 'a'), step('c', 'a')]);
    const rows = new Map(flow.steps.map((one) => [one.id, one.row]));
    expect(rows.get('a')).toBe(0);
    expect(rows.get('b')).toBe(0);
    expect(rows.get('c')).toBe(1);
    expect(flow.columns).toBe(2);
  });

  it('orders a column by the order the work was asked for', () => {
    const first = step('first');
    const second = step('second');
    const flow = layOut([second, first]);
    expect(flow.steps.map((one) => one.id)).toEqual(['first', 'second']);
  });

  it('draws work whose wait points at something gone, rather than losing it', () => {
    const flow = layOut([step('orphan', 'thrown-away')]);
    expect(flow.steps).toHaveLength(1);
    expect(flow.steps[0]?.column).toBe(0);
  });

  it('draws a loop flat instead of recursing for ever', () => {
    const flow = layOut([step('a', 'b'), step('b', 'a')]);
    expect(flow.steps).toHaveLength(2);
    expect(flow.columns).toBeLessThanOrEqual(2);
  });
});

describe('what waits on what', () => {
  it('finds everything waiting directly on one step', () => {
    const steps = [step('a'), step('b', 'a'), step('c', 'a'), step('d', 'b')];
    expect(waitingOn(steps, 'a').map((one) => one.id)).toEqual(['b', 'c']);
    expect(waitingOn(steps, 'd')).toEqual([]);
  });
});

/* ========================================================================== */
/* Drawing a line between two steps                                           */
/* ========================================================================== */

describe('whether one step may wait for another', () => {
  it('allows an ordinary wait', () => {
    const steps = [step('a'), step('b')];
    expect(canWaitFor(steps, 'b', 'a')).toEqual({ ok: true });
  });

  it('refuses a step waiting for itself', () => {
    const steps = [step('a')];
    const said = canWaitFor(steps, 'a', 'a');
    expect(said.ok).toBe(false);
    expect(said.ok === false && said.because).toContain('itself');
  });

  it('refuses a loop, however long the way round', () => {
    const steps = [step('a'), step('b', 'a'), step('c', 'b')];
    const said = canWaitFor(steps, 'a', 'c');
    expect(said.ok).toBe(false);
    expect(said.ok === false && said.because).toContain('waiting for each other');
  });

  it('refuses to hold back work that is already going', () => {
    const steps = [step('a'), step('b', null, 'running')];
    expect(canWaitFor(steps, 'b', 'a').ok).toBe(false);
  });

  it('refuses to hold back work that has finished', () => {
    const steps = [step('a'), step('b', null, 'done')];
    expect(canWaitFor(steps, 'b', 'a').ok).toBe(false);
  });

  it('refuses to follow work that did not land', () => {
    const steps = [step('a', null, 'failed'), step('b')];
    const said = canWaitFor(steps, 'b', 'a');
    expect(said.ok).toBe(false);
    expect(said.ok === false && said.because).toContain('didn’t work');
  });

  it('refuses a step nobody has', () => {
    expect(canWaitFor([step('a')], 'a', 'nowhere').ok).toBe(false);
  });
});

/* ========================================================================== */
/* What can be placed                                                         */
/* ========================================================================== */

describe('the kinds of step', () => {
  it('gives every kind a name, a note and something to ask', () => {
    for (const kind of STEP_KINDS) {
      expect(kind.name).not.toBe('');
      expect(kind.note).not.toBe('');
      expect(kind.asks('the header').trim()).not.toBe('');
    }
  });

  it('sends what somebody typed as the whole of a plain step', () => {
    expect(stepKind('work').asks('  Tighten the nav  ')).toBe('Tighten the nav');
  });

  it('asks the looking step to change nothing', () => {
    expect(stepKind('look').asks('')).toContain('Change nothing');
  });

  it('falls back to the first kind rather than throwing on a name nobody has', () => {
    expect(stepKind('nonsense' as never).id).toBe('work');
  });

  /* An instruction spliced into a later step's sentence reads as a noun and
     asks for something nobody meant: "check Tighten the nav on mobile". */
  it('keeps what somebody typed out of the steps that come after', () => {
    const instruction = 'Tighten the nav on mobile';
    for (const kind of STEP_KINDS) {
      if (kind.id === 'work' || kind.id === 'look') continue;
      expect(kind.asks(instruction), kind.id).not.toContain(instruction);
    }
  });

  it('reads as a whole sentence whether or not it was given a subject', () => {
    for (const kind of STEP_KINDS) {
      if (kind.needsWords) continue;
      for (const about of ['', 'the pricing page', 'Tighten the nav on mobile']) {
        const asked = kind.asks(about);
        expect(asked, `${kind.id} · "${about}"`).toMatch(/^[A-Z].*\.$/s);
      }
    }
  });
});

describe('the loops somebody can put down whole', () => {
  it('offers a small number of them', () => {
    expect(STARTERS.length).toBeGreaterThan(0);
    expect(STARTERS.length).toBeLessThanOrEqual(3);
  });

  it('chains every step behind one that comes earlier in the same list', () => {
    for (const starter of STARTERS) {
      starter.steps.forEach((one, index) => {
        if (one.after === null) return;
        expect(one.after).toBeLessThan(index);
      });
    }
  });

  it('starts each loop with exactly one step that waits for nothing', () => {
    for (const starter of STARTERS) {
      expect(starter.steps.filter((one) => one.after === null)).toHaveLength(1);
    }
  });

  it('turns a loop into instructions in the order they run', () => {
    const asked = askedFor(STARTERS[0]!, 'the contact form');
    expect(asked).toHaveLength(STARTERS[0]!.steps.length);
    expect(asked[0]?.after).toBeNull();
    expect(asked[0]?.asks).toBe('the contact form');
    expect(asked[1]?.after).toBe(0);
  });
});

describe('what the canvas says', () => {
  it('has a word for every state a piece of work can be in', () => {
    const states: readonly WorkState[] = ['waiting', 'running', 'needs-you', 'done', 'failed'];
    for (const state of states) expect(canvasWords.states[state]).not.toBe('');
  });

  it('counts steps without saying “going” when nothing is', () => {
    expect(canvasWords.counted(1, 0)).toBe('1 step');
    expect(canvasWords.counted(4, 2)).toBe('4 steps · 2 going');
  });

  it('says how many are held up behind one step', () => {
    expect(canvasWords.holdingUp(1)).toBe('1 step waits on this');
    expect(canvasWords.holdingUp(3)).toBe('3 steps wait on this');
  });
});
