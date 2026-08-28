/** A flow, before anything runs.
 *
 * The claim this file exists for: drawing one changes nothing. A flow is a
 * draft until Start, so every function here has to be safe to call on a shape
 * nobody has committed to — and the two that decide what happens when somebody
 * does, `runOrder` and `asksOf`, have to agree with what the picture showed.
 */

import { describe, expect, it } from 'vitest';

import {
  asksOf,
  BLOCKS,
  canStart,
  canvasWords,
  canWaitFor,
  change,
  newFlow,
  helperWords,
  isRunning,
  join,
  layOut,
  LOOPS,
  MOST_PICTURES,
  nextUp,
  notReady,
  place,
  placeLoop,
  readFlow,
  readFlows,
  remove,
  reset,
  runOrder,
  specOf,
  waitingOn,
  withFlow,
  withoutFlow,
  type BlockKind,
  type Flow,
} from '../src/work/canvas';

/* ------------------------------------------------------------ scaffolding */

/** A flow built by placing, so ids are the real ones. */
function drawn(...kinds: readonly BlockKind[]): Flow {
  let flow = newFlow();
  for (const kind of kinds) flow = place(flow, kind);
  return flow;
}

/** A chain: each one behind the one before it. */
function chained(...kinds: readonly BlockKind[]): Flow {
  let flow = newFlow();
  let last: string | null = null;
  for (const kind of kinds) {
    flow = place(flow, kind, last);
    last = flow.blocks[flow.blocks.length - 1]?.id ?? null;
  }
  return flow;
}

const idsOf = (flow: Flow): readonly string[] => flow.blocks.map((one) => one.id);

/* ========================================================================== */
/* Placing                                                                    */
/* ========================================================================== */

describe('placing blocks', () => {
  it('starts with nothing and nothing started', () => {
    expect(newFlow().blocks).toEqual([]);
    expect(newFlow().startedAt).toBeNull();
    expect(isRunning(newFlow())).toBe(false);
  });

  it('gives every block an id nobody else has', () => {
    const flow = drawn('work', 'work', 'work');
    expect(new Set(idsOf(flow)).size).toBe(3);
  });

  it('takes the kind’s own words, so a block is worth something the moment it lands', () => {
    const flow = drawn('checks');
    expect(flow.blocks[0]?.says).toBe(specOf('checks').says);
  });

  it('leaves the blocks that need saying what about empty on purpose', () => {
    const flow = drawn('work');
    expect(flow.blocks[0]?.says).toBe('');
    expect(notReady(flow).map((one) => one.kind)).toEqual(['work']);
  });

  it('refuses to place one behind a block nobody has', () => {
    const flow = place(newFlow(), 'work', 'nowhere');
    expect(flow.blocks[0]?.after).toBeNull();
  });

  it('changes only the block it was asked about', () => {
    const flow = drawn('work', 'review');
    const first = flow.blocks[0]!.id;
    const next = change(flow, first, { says: 'Tighten the nav' });
    expect(next.blocks[0]?.says).toBe('Tighten the nav');
    expect(next.blocks[1]?.says).toBe(flow.blocks[1]?.says);
  });
});

describe('taking one out', () => {
  it('hands what was waiting on it to what it was waiting for', () => {
    const flow = chained('look', 'work', 'review');
    const [look, work, review] = idsOf(flow);
    const next = remove(flow, work!);
    expect(idsOf(next)).toEqual([look, review]);
    expect(next.blocks.find((one) => one.id === review)?.after).toBe(look);
  });

  it('frees the head of a chain rather than stranding the rest', () => {
    const flow = chained('look', 'work');
    const next = remove(flow, idsOf(flow)[0]!);
    expect(next.blocks[0]?.after).toBeNull();
  });

  it('does nothing for a block nobody has', () => {
    const flow = drawn('work');
    expect(remove(flow, 'nowhere')).toEqual(flow);
  });
});

/* ========================================================================== */
/* Joining                                                                    */
/* ========================================================================== */

describe('whether one block may wait for another', () => {
  it('allows an ordinary wait, and allows waiting for nothing', () => {
    const flow = drawn('work', 'review');
    const [work, review] = idsOf(flow);
    expect(canWaitFor(flow, review!, work!)).toEqual({ ok: true });
    expect(canWaitFor(flow, review!, null)).toEqual({ ok: true });
  });

  it('refuses a block waiting for itself', () => {
    const flow = drawn('work');
    const said = canWaitFor(flow, idsOf(flow)[0]!, idsOf(flow)[0]!);
    expect(said.ok).toBe(false);
    expect(said.ok === false && said.because).toBe(canvasWords.itself);
  });

  it('refuses a loop, however long the way round', () => {
    const flow = chained('look', 'work', 'review');
    const [look, , review] = idsOf(flow);
    const said = canWaitFor(flow, look!, review!);
    expect(said.ok).toBe(false);
    expect(said.ok === false && said.because).toBe(canvasWords.loop);
  });

  it('refuses a block nobody has', () => {
    const flow = drawn('work');
    expect(canWaitFor(flow, idsOf(flow)[0]!, 'nowhere').ok).toBe(false);
  });

  it('leaves the flow alone when the join was refused', () => {
    const flow = chained('look', 'work');
    const [look, work] = idsOf(flow);
    expect(join(flow, look!, work!)).toEqual(flow);
    expect(join(flow, work!, work!)).toEqual(flow);
  });
});

/* ========================================================================== */
/* Ready-made loops                                                           */
/* ========================================================================== */

describe('the loops somebody can put down whole', () => {
  it('offers a small number of them', () => {
    expect(LOOPS.length).toBeGreaterThan(0);
    expect(LOOPS.length).toBeLessThanOrEqual(4);
  });

  it('chains every block behind one that comes earlier in the same list', () => {
    for (const loop of LOOPS) {
      loop.blocks.forEach((one, index) => {
        if (one.after === null) return;
        expect(one.after, loop.id).toBeLessThan(index);
      });
    }
  });

  it('starts each loop with exactly one block that waits for nothing', () => {
    for (const loop of LOOPS) {
      expect(loop.blocks.filter((one) => one.after === null), loop.id).toHaveLength(1);
    }
  });

  it('puts one down as a real chain of real ids', () => {
    const flow = placeLoop(newFlow(), LOOPS[0]!);
    expect(flow.blocks).toHaveLength(LOOPS[0]!.blocks.length);
    expect(flow.blocks[0]?.after).toBeNull();
    expect(flow.blocks[1]?.after).toBe(flow.blocks[0]?.id);
    expect(flow.blocks[2]?.after).toBe(flow.blocks[1]?.id);
  });

  it('puts a second one down beside the first rather than over it', () => {
    const flow = placeLoop(placeLoop(newFlow(), LOOPS[1]!), LOOPS[1]!);
    expect(flow.blocks).toHaveLength(LOOPS[1]!.blocks.length * 2);
    expect(new Set(idsOf(flow)).size).toBe(flow.blocks.length);
  });

  it('never draws a loop that could not run', () => {
    for (const loop of LOOPS) {
      const flow = placeLoop(newFlow(), loop);
      for (const block of flow.blocks) {
        expect(canWaitFor(flow, block.id, block.after).ok, loop.id).toBe(true);
      }
    }
  });
});

/* ========================================================================== */
/* Starting                                                                   */
/* ========================================================================== */

describe('whether it can start', () => {
  it('will not start with nothing on it', () => {
    expect(canStart(newFlow())).toBe(false);
  });

  it('will not start while a block has not been said what about', () => {
    const flow = drawn('work');
    expect(canStart(flow)).toBe(false);
    expect(canStart(change(flow, flow.blocks[0]!.id, { says: 'Tighten the nav' }))).toBe(true);
  });

  it('starts happily on blocks that came with their own words', () => {
    expect(canStart(chained('look', 'checks', 'review'))).toBe(true);
  });

  it('will not start twice over', () => {
    const flow = chained('look', 'review');
    const going = { ...flow, running: flow.blocks[0]!.id };
    expect(isRunning(going)).toBe(true);
    expect(canStart(going)).toBe(false);
  });

  it('is a draft again once it has been reset', () => {
    const drew = chained('look', 'review');
    const going: Flow = { ...drew, startedAt: 1, running: drew.blocks[1]!.id, done: [drew.blocks[0]!.id] };
    const back = reset(going);
    expect(isRunning(back)).toBe(false);
    expect(back.startedAt).toBeNull();
    expect(back.done).toEqual([]);
    expect(back.blocks.map((one) => one.after)).toEqual(going.blocks.map((one) => one.after));
    // The conversation is the record of the run, and is not thrown away with it.
    expect(back.conversation).toBe(going.conversation);
  });
});

describe('what comes next', () => {
  it('starts with the one that waits for nothing', () => {
    const flow = chained('look', 'work', 'review');
    expect(nextUp(flow)?.id).toBe(flow.blocks[0]!.id);
  });

  it('moves on once the one before it has finished', () => {
    const flow = chained('look', 'work', 'review');
    const [look, work] = flow.blocks.map((one) => one.id);
    expect(nextUp({ ...flow, done: [look!] })?.id).toBe(work);
  });

  it('never sends what follows a block that did not happen', () => {
    const flow = chained('look', 'work', 'review');
    // Only the second is done, which cannot happen — but if it did, the third
    // must not go: it would be working against a change nobody made.
    expect(nextUp({ ...flow, done: [flow.blocks[1]!.id] })?.id).toBe(flow.blocks[0]!.id);
  });

  it('has nothing left to send once everything has finished', () => {
    const flow = chained('look', 'review');
    expect(nextUp({ ...flow, done: flow.blocks.map((one) => one.id) })).toBeNull();
  });
});

describe('the order it goes on the board in', () => {
  it('never puts a block before the one it waits for', () => {
    const flow = chained('look', 'work', 'checks', 'review');
    const order = runOrder(flow).map((one) => one.id);
    for (const block of flow.blocks) {
      if (block.after === null) continue;
      expect(order.indexOf(block.id)).toBeGreaterThan(order.indexOf(block.after));
    }
  });

  it('holds for a fork as well as a chain', () => {
    let flow = place(newFlow(), 'look');
    const head = flow.blocks[0]!.id;
    flow = place(flow, 'work', head);
    flow = place(flow, 'checks', head);
    const order = runOrder(flow).map((one) => one.id);
    expect(order[0]).toBe(head);
    expect(order).toHaveLength(3);
  });
});

describe('what each block is asked', () => {
  it('sends what somebody typed, as they typed it', () => {
    const flow = drawn('work');
    const said = change(flow, flow.blocks[0]!.id, { says: '  Tighten the nav  ' });
    expect(asksOf(said.blocks[0]!)).toBe('Tighten the nav');
  });

  it('falls back to the kind’s own words rather than sending nothing', () => {
    const drew = drawn('checks');
    const flow = change(drew, drew.blocks[0]!.id, { says: '   ' });
    expect(asksOf(flow.blocks[0]!)).toBe(specOf('checks').says);
  });

  it('asks the helpers block to split the work and bring it back together', () => {
    const drew = drawn('helpers');
    const flow = change(drew, drew.blocks[0]!.id, { says: 'every page' });
    expect(asksOf(flow.blocks[0]!)).toBe(helperWords('every page'));
    expect(asksOf(flow.blocks[0]!)).toContain('every page');
  });

  it('gives every kind a name, a note and something to ask', () => {
    for (const spec of BLOCKS) {
      expect(spec.name).not.toBe('');
      expect(spec.note).not.toBe('');
      if (!spec.needsWords) expect(spec.says.trim()).not.toBe('');
    }
  });

  it('reads as a whole sentence wherever the kind brought its own', () => {
    for (const spec of BLOCKS) {
      if (spec.needsWords) continue;
      expect(spec.says, spec.kind).toMatch(/^[A-Z].*\.$/s);
    }
  });
});

/* ========================================================================== */
/* Laying it out                                                              */
/* ========================================================================== */

describe('laying it out', () => {
  it('has nothing to draw for an empty flow', () => {
    expect(layOut(newFlow())).toEqual({ blocks: [], columns: 0, rows: 0 });
  });

  it('puts a chain on one row, one column each', () => {
    const flow = chained('look', 'work', 'review');
    const out = layOut(flow);
    expect(out.columns).toBe(3);
    expect(out.rows).toBe(1);
    expect(out.blocks.map((one) => one.column)).toEqual([0, 1, 2]);
  });

  it('puts blocks that wait for nothing side by side', () => {
    const out = layOut(drawn('look', 'work', 'review'));
    expect(out.columns).toBe(1);
    expect(out.rows).toBe(3);
  });

  it('keeps the first of a fork on its parent’s row and moves the rest down', () => {
    let flow = place(newFlow(), 'look');
    const head = flow.blocks[0]!.id;
    flow = place(flow, 'work', head);
    flow = place(flow, 'checks', head);
    const rows = new Map(layOut(flow).blocks.map((one) => [one.id, one.row]));
    expect(rows.get(head)).toBe(0);
    expect(new Set([...rows.values()]).size).toBe(2);
  });

  it('draws everything as a draft until it is started', () => {
    const out = layOut(chained('look', 'review'));
    expect(out.blocks.every((one) => one.state === 'draft')).toBe(true);
  });

  it('says which one is going, which is done, and which is still to come', () => {
    const flow = chained('look', 'work', 'review');
    const [look, work] = flow.blocks.map((one) => one.id);
    const going = { ...flow, startedAt: 1, done: [look!], running: work! };
    const states = new Map(layOut(going).blocks.map((one) => [one.id, one.state]));
    expect(states.get(look!)).toBe('done');
    expect(states.get(work!)).toBe('running');
    expect(states.get(flow.blocks[2]!.id)).toBe('waiting');
  });
});

describe('what waits on what', () => {
  it('finds everything waiting directly on one block', () => {
    let flow = place(newFlow(), 'look');
    const head = flow.blocks[0]!.id;
    flow = place(flow, 'work', head);
    flow = place(flow, 'checks', head);
    expect(waitingOn(flow, head)).toHaveLength(2);
    expect(waitingOn(flow, flow.blocks[1]!.id)).toEqual([]);
  });
});

/* ========================================================================== */
/* Reading one back                                                           */
/* ========================================================================== */

describe('reading a flow off the disk', () => {
  it('round-trips one it drew itself', () => {
    const flow = placeLoop(newFlow(), LOOPS[0]!);
    expect(readFlow(JSON.parse(JSON.stringify(flow)) as unknown)).toEqual(flow);
  });

  it('is no canvas at all for anything that is not one', () => {
    expect(readFlow(null)).toBeNull();
    expect(readFlow('a flow')).toBeNull();
    expect(readFlow({})).toBeNull();
    expect(readFlow({ blocks: 'lots' })).toBeNull();
    // A canvas with no id is a canvas no tab could ever point at.
    expect(readFlow({ blocks: [] })).toBeNull();
  });

  it('names an unnamed one rather than drawing a tab with no words on it', () => {
    expect(readFlow({ id: 'f', blocks: [] })?.name).toBe(canvasWords.untitled);
    expect(readFlow({ id: 'f', name: '   ', blocks: [] })?.name).toBe(canvasWords.untitled);
    expect(readFlow({ id: 'f', name: 'The nav', blocks: [] })?.name).toBe('The nav');
  });

  it('drops a block whose kind nobody has, rather than drawing a card it cannot name', () => {
    expect(readFlow({ id: 'f', blocks: [{ id: 'a', kind: 'interpretive-dance' }] })?.blocks).toEqual([]);
  });

  it('drops a second block claiming an id already taken', () => {
    const flow = readFlow({ id: 'f', blocks: [{ id: 'a', kind: 'work' }, { id: 'a', kind: 'review' }] });
    expect(flow?.blocks).toHaveLength(1);
    expect(flow?.blocks[0]?.kind).toBe('work');
  });

  it('frees a wait pointing at a block that did not survive the read', () => {
    const flow = readFlow({
      id: 'f',
      blocks: [
        { id: 'a', kind: 'work', after: 'gone' },
        { id: 'b', kind: 'review', after: 'a' },
      ],
    });
    expect(flow?.blocks[0]?.after).toBeNull();
    expect(flow?.blocks[1]?.after).toBe('a');
  });

  it('keeps a model only when both halves of it are there', () => {
    const flow = readFlow({
      id: 'f',
      blocks: [
        { id: 'a', kind: 'work', model: { providerId: 'anthropic', modelId: 'claude' } },
        { id: 'b', kind: 'work', model: { providerId: 'anthropic' } },
        { id: 'c', kind: 'work', model: 'the good one' },
      ],
    });
    expect(flow?.blocks[0]?.model).toEqual({ providerId: 'anthropic', modelId: 'claude' });
    expect(flow?.blocks[1]?.model).toBeNull();
    expect(flow?.blocks[2]?.model).toBeNull();
  });

  it('keeps a picture only when it is whole, and never more than it will carry', () => {
    const one = { name: 'a.png', mimeType: 'image/png', bytes: 'AAA' };
    const flow = readFlow({
      id: 'f',
      blocks: [
        { id: 'a', kind: 'work', pictures: [one, { name: 'b.png' }, { ...one, bytes: '' }] },
        { id: 'b', kind: 'work', pictures: Array.from({ length: 9 }, () => one) },
        { id: 'c', kind: 'work', pictures: 'a photo' },
      ],
    });
    expect(flow?.blocks[0]?.pictures).toEqual([one]);
    expect(flow?.blocks[1]?.pictures).toHaveLength(MOST_PICTURES);
    expect(flow?.blocks[2]?.pictures).toBeUndefined();
  });

  it('keeps a rung a block was given, and drops one nobody has', () => {
    const flow = readFlow({
      id: 'f',
      blocks: [
        { id: 'a', kind: 'work', howFar: 'doing' },
        { id: 'b', kind: 'work', howFar: 'sideways' },
      ],
    });
    expect(flow?.blocks[0]?.howFar).toBe('doing');
    expect(flow?.blocks[1]?.howFar).toBeUndefined();
  });

  it('comes back at the rung the canvas was set to, and asks first when it is nonsense', () => {
    expect(readFlow({ id: 'f', blocks: [], howFar: 'changing' })?.howFar).toBe('changing');
    expect(readFlow({ id: 'f', blocks: [], howFar: 'whenever' })?.howFar).toBe('asking');
  });

  it('never comes back mid-run: the window that was running it is gone', () => {
    const flow = readFlow({
      id: 'f',
      blocks: [{ id: 'a', kind: 'checks' }, { id: 'b', kind: 'review', after: 'a' }],
      running: 'a',
      done: ['a', 'nobody-has-this'],
      startedAt: 5,
    });
    expect(flow?.running).toBeNull();
    // What did finish is still finished, and a name nobody has is not.
    expect(flow?.done).toEqual(['a']);
  });

  it('never comes back claiming to have started when it did not', () => {
    expect(readFlow({ id: 'f', blocks: [], startedAt: 'yesterday' })?.startedAt).toBeNull();
    expect(readFlow({ id: 'f', blocks: [], startedAt: -1 })?.startedAt).toBeNull();
  });
});

describe('the canvases a project has', () => {
  it('reads a list, and loses only what it cannot read', () => {
    const flows = readFlows([
      { id: 'a', name: 'One', blocks: [] },
      'not a flow',
      { id: 'b', name: 'Two', blocks: [] },
      { id: 'a', name: 'One again', blocks: [] },
    ]);
    expect(flows.map((one) => one.id)).toEqual(['a', 'b']);
    expect(flows[0]?.name).toBe('One');
  });

  it('is no canvases at all for anything that is not a list', () => {
    expect(readFlows(null)).toEqual([]);
    expect(readFlows({ id: 'a' })).toEqual([]);
  });

  it('puts one back in its place rather than on the end', () => {
    const flows = readFlows([{ id: 'a', blocks: [] }, { id: 'b', blocks: [] }]);
    const next = withFlow(flows, { ...flows[0]!, name: 'Renamed' });
    expect(next.map((one) => one.id)).toEqual(['a', 'b']);
    expect(next[0]?.name).toBe('Renamed');
  });

  it('adds one nobody had on the end', () => {
    const flows = readFlows([{ id: 'a', blocks: [] }]);
    expect(withFlow(flows, newFlow()).map((one) => one.id)[0]).toBe('a');
    expect(withFlow(flows, newFlow())).toHaveLength(2);
  });

  it('takes one out and leaves the rest where they were', () => {
    const flows = readFlows([{ id: 'a', blocks: [] }, { id: 'b', blocks: [] }, { id: 'c', blocks: [] }]);
    expect(withoutFlow(flows, 'b').map((one) => one.id)).toEqual(['a', 'c']);
    expect(withoutFlow(flows, 'nowhere')).toHaveLength(3);
  });
});

/* ========================================================================== */
/* Words                                                                      */
/* ========================================================================== */

describe('what the canvas says', () => {
  it('has a word for every state a block can be in', () => {
    const states = ['draft', 'waiting', 'running', 'done', 'failed'] as const;
    for (const state of states) expect(canvasWords.states[state]).not.toBe('');
  });

  it('counts what is on it without claiming a run that has not happened', () => {
    expect(canvasWords.counted(0, 0, 0)).toBe('Nothing placed yet.');
    expect(canvasWords.counted(1, 0, 0)).toBe('1 block · not started');
    expect(canvasWords.counted(4, 2, 0)).toBe('4 blocks · 2 done');
    expect(canvasWords.counted(4, 1, 2)).toBe('4 blocks · 1 done, 2 going');
  });
});
