/** A chain of steps, gathered into one row.
 *
 * The test that matters is that nothing is lost and nothing is reordered: the
 * same steps come out, in the same order, in fewer rows.
 */

import { describe, expect, it } from 'vitest';

import {
  ENOUGH_TO_GATHER,
  MOST_IN_A_ROW,
  howItWent,
  rows,
  type StepTurn,
} from '../src/lib/steps';
import { said, type Turn } from '../src/lib/thread';

function step(id: string, label = 'Reading a file', state: StepTurn['state'] = 'done'): StepTurn {
  return { kind: 'did', id, callId: `call-${id}`, state, label };
}

/** Every step that came out, in order, whatever row it ended up in. */
function flat(turns: readonly Turn[], keepApart?: ReadonlySet<string>): readonly string[] {
  return rows(turns, keepApart).flatMap((row) =>
    row.kind === 'steps' ? row.steps.map((one) => one.id) : [row.turn.id],
  );
}

describe('gathering a run of steps', () => {
  it('leaves a short run alone — two lines are two lines either way', () => {
    const turns = [step('a', 'Reading index.html'), step('b', 'Reading about.html')];
    expect(rows(turns).every((row) => row.kind === 'one')).toBe(true);
  });

  it('gathers a long one into a single row', () => {
    const turns = Array.from({ length: 8 }, (_, i) => step(`s${String(i)}`, 'Reading a file'));
    const drawn = rows(turns);

    expect(drawn).toHaveLength(1);
    expect(drawn[0]?.kind).toBe('steps');
    expect(drawn[0]?.kind === 'steps' ? drawn[0].steps : []).toHaveLength(8);
  });

  it('gathers at the threshold and not below it', () => {
    const run = (n: number) => Array.from({ length: n }, (_, i) => step(`s${String(i)}`, 'Reading'));
    expect(rows(run(ENOUGH_TO_GATHER))[0]?.kind).toBe('steps');
    expect(rows(run(ENOUGH_TO_GATHER - 1))[0]?.kind).toBe('one');
  });

  /* The whole point: a message is what the steps happened between, so it ends
     one run and starts another. */
  it('breaks a run on anything that is not a step', () => {
    const turns: Turn[] = [
      step('a', 'Reading'),
      step('b', 'Reading'),
      step('c', 'Reading'),
      said('graphe', 'Two of them load a font from elsewhere.'),
      step('d', 'Changing index.html'),
      step('e', 'Changing about.html'),
      step('f', 'Changing blog.html'),
    ];
    const drawn = rows(turns);

    expect(drawn.map((row) => row.kind)).toEqual(['steps', 'one', 'steps']);
  });

  it('loses nothing and reorders nothing', () => {
    const turns: Turn[] = [
      said('you', 'have a look'),
      step('a', 'Reading'),
      step('b', 'Reading'),
      step('c', 'Reading'),
      step('d', 'Reading'),
      said('graphe', 'Done.'),
    ];

    expect(flat(turns)).toEqual(turns.map((turn) => turn.id));
  });

  /* A picture is pinned under a turn by id. A turn that has one has to stay on
     its own, or the picture is filed under a row that is not there. */
  it('keeps a step on its own when something is pinned under it', () => {
    const turns = [
      step('a', 'Reading'),
      step('b', 'Reading'),
      step('c', 'Reading'),
      step('pinned', 'Changing index.html'),
      step('d', 'Reading'),
      step('e', 'Reading'),
      step('f', 'Reading'),
    ];
    const keepApart = new Set(['pinned']);

    expect(rows(turns, keepApart).map((row) => row.kind)).toEqual(['steps', 'one', 'steps']);
    expect(flat(turns, keepApart)).toEqual(turns.map((turn) => turn.id));
  });
});

describe('how a gathered run reads as a whole', () => {
  it('is still going while any step is', () => {
    expect(howItWent([step('a'), step('b', 'Reading', 'running')])).toBe('running');
    // Even with a failure in it: what is happening now outranks what went wrong.
    expect(howItWent([step('a', 'Reading', 'failed'), step('b', 'Reading', 'running')])).toBe('running');
  });

  it('is stopped when something stopped and nothing is still going', () => {
    expect(howItWent([step('a'), step('b', 'Reading', 'failed')])).toBe('failed');
  });

  it('is finished when every step is', () => {
    expect(howItWent([step('a'), step('b')])).toBe('done');
  });
});

/* A fold that swallows a hundred and fifty steps is a trapdoor: opening it by
   accident drops somebody into a list they have to scroll to the end of to get
   back where they were. */
describe('how much one row is allowed to swallow', () => {
  const run = (n: number) =>
    Array.from({ length: n }, (_, i) => step(`s${String(i)}`, 'Reading a file'));

  it('never puts more than a screenful behind one press', () => {
    for (const many of [40, 150, 999]) {
      const drawn = rows(run(many));
      for (const row of drawn) {
        expect(row.kind).toBe('steps');
        if (row.kind === 'steps') expect(row.steps.length).toBeLessThanOrEqual(MOST_IN_A_ROW);
      }
    }
  });

  it('still loses nothing and reorders nothing when it cuts', () => {
    const turns = run(150);
    expect(flat(turns)).toEqual(turns.map((one) => one.id));
  });

  /* A row of one behind a disclosure is the fold costing a press and saving
     nothing, so a stub joins the row before it. */
  it('never leaves a stub at the end', () => {
    for (const many of [16, 31, 46]) {
      const drawn = rows(run(many));
      const last = drawn[drawn.length - 1];
      expect(last?.kind === 'steps' ? last.steps.length : 0).toBeGreaterThanOrEqual(
        ENOUGH_TO_GATHER,
      );
    }
  });

  it('leaves a run that already fits as one row', () => {
    expect(rows(run(MOST_IN_A_ROW))).toHaveLength(1);
  });
});
