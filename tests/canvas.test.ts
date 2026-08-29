import { readFileSync } from 'node:fs';
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
  carryOnWords,
  BLOCKS,
  canStart,
  unjoin,
  joined,
  tidy,
  canvasWords,
  endedAs,
  canWaitFor,
  CARD,
  change,
  newFlow,
  helperWords,
  isArranged,
  isGate,
  isRunning,
  join,
  layOut,
  lineState,
  LOOPS,
  MOST_FILES,
  MOST_TEXT,
  nextUp,
  notReady,
  place,
  placeLoop,
  readFlow,
  readFlows,
  remove,
  reset,
  ROUNDS,
  runOrder,
  specOf,
  startsAt,
  stateOf,
  tidied,
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
    const flow = drawn('custom', 'custom', 'custom');
    expect(new Set(idsOf(flow)).size).toBe(3);
  });

  it('takes the kind’s own words, so a block is worth something the moment it lands', () => {
    const flow = drawn('checks');
    expect(flow.blocks[0]?.says).toBe(specOf('checks').says);
  });

  it('leaves the blocks that need saying what about empty on purpose', () => {
    const flow = drawn('custom');
    expect(flow.blocks[0]?.says).toBe('');
    expect(notReady(flow).map((one) => one.kind)).toEqual(['custom']);
  });

  it('refuses to place one behind a block nobody has', () => {
    const flow = place(newFlow(), 'custom', 'nowhere');
    expect(flow.blocks[0]?.after).toEqual([]);
  });

  it('changes only the block it was asked about', () => {
    const flow = drawn('custom', 'review');
    const first = flow.blocks[0]!.id;
    const next = change(flow, first, { says: 'Tighten the nav' });
    expect(next.blocks[0]?.says).toBe('Tighten the nav');
    expect(next.blocks[1]?.says).toBe(flow.blocks[1]?.says);
  });
});

describe('taking one out', () => {
  it('hands what was waiting on it to what it was waiting for', () => {
    const flow = chained('plan', 'custom', 'review');
    const [look, work, review] = idsOf(flow);
    const next = remove(flow, work!);
    expect(idsOf(next)).toEqual([look, review]);
    expect(next.blocks.find((one) => one.id === review)?.after).toEqual([look]);
  });

  it('frees the head of a chain rather than stranding the rest', () => {
    const flow = chained('plan', 'custom');
    const next = remove(flow, idsOf(flow)[0]!);
    expect(next.blocks[0]?.after).toEqual([]);
  });

  it('does nothing for a block nobody has', () => {
    const flow = drawn('custom');
    expect(remove(flow, 'nowhere')).toEqual(flow);
  });
});

/* ========================================================================== */
/* Joining                                                                    */
/* ========================================================================== */

describe('whether one block may wait for another', () => {
  it('allows an ordinary wait, and allows waiting for nothing', () => {
    const flow = drawn('custom', 'review');
    const [work, review] = idsOf(flow);
    expect(canWaitFor(flow, review!, work!)).toEqual({ ok: true });
    expect(canWaitFor(flow, review!, null)).toEqual({ ok: true });
  });

  it('refuses a block waiting for itself', () => {
    const flow = drawn('custom');
    const said = canWaitFor(flow, idsOf(flow)[0]!, idsOf(flow)[0]!);
    expect(said.ok).toBe(false);
    expect(said.ok === false && said.because).toBe(canvasWords.itself);
  });

  it('refuses a loop, however long the way round', () => {
    const flow = chained('plan', 'custom', 'review');
    const [look, , review] = idsOf(flow);
    const said = canWaitFor(flow, look!, review!);
    expect(said.ok).toBe(false);
    expect(said.ok === false && said.because).toBe(canvasWords.loop);
  });

  it('refuses a block nobody has', () => {
    const flow = drawn('custom');
    expect(canWaitFor(flow, idsOf(flow)[0]!, 'nowhere').ok).toBe(false);
  });

  it('leaves the flow alone when the join was refused', () => {
    const flow = chained('plan', 'custom');
    const [look, work] = idsOf(flow);
    expect(join(flow, look!, work!)).toEqual(flow);
    expect(join(flow, work!, work!)).toEqual(flow);
  });
});

/* ========================================================================== */
/* Ready-made loops                                                           */
/* ========================================================================== */

describe('a gate, and a goal', () => {
  it('knows which block sends nothing', () => {
    const gate = place(newFlow(), 'wait').blocks[0]!;
    const ordinary = place(newFlow(), 'checks').blocks[0]!;
    expect(isGate(gate)).toBe(true);
    expect(isGate(ordinary)).toBe(false);
  });

  it('says a gate needs somebody rather than that it is going', () => {
    const flow = place(newFlow(), 'wait');
    const gate = flow.blocks[0]!;
    expect(stateOf(gate, { ...flow, running: gate.id })).toBe('needs-you');
  });

  it('says an ordinary block that is running is going', () => {
    const flow = place(newFlow(), 'checks');
    const one = flow.blocks[0]!;
    expect(stateOf(one, { ...flow, running: one.id })).toBe('running');
  });

  it('asks a goal to work toward the objective and check itself', () => {
    const flow = place(newFlow(), 'goal');
    const said = change(flow, flow.blocks[0]!.id, { says: 'every type error gone' });
    const asked = asksOf(said.blocks[0]!);
    expect(asked).toContain('every type error gone');
    expect(asked).toContain('checks');
  });

  it('carries the objective into the round that follows', () => {
    const again = carryOnWords('every type error gone', 'three still fail.');
    expect(again).toContain('every type error gone');
    expect(again).toContain('three still fail.');
  });

  it('bounds how long a goal may go round', () => {
    expect(Number.isInteger(ROUNDS)).toBe(true);
    expect(ROUNDS).toBeGreaterThan(1);
  });

  it('starts a fresh flow with nothing running and no rounds spent', () => {
    const flow = newFlow();
    expect(flow.rounds).toBe(0);
    expect(reset({ ...flow, rounds: 7, running: 'x' }).rounds).toBe(0);
  });
});

describe('the loops somebody can put down whole', () => {
  it('offers a small number of them', () => {
    expect(LOOPS.length).toBeGreaterThan(0);
    expect(LOOPS.length).toBeLessThanOrEqual(4);
  });

  it('chains every block behind one that comes earlier in the same list', () => {
    for (const loop of LOOPS) {
      loop.blocks.forEach((one, index) => {
        for (const was of one.after) expect(was, loop.id).toBeLessThan(index);
      });
    }
  });

  it('starts each loop with exactly one block that waits for nothing', () => {
    for (const loop of LOOPS) {
      expect(loop.blocks.filter((one) => one.after.length === 0), loop.id).toHaveLength(1);
    }
  });

  it('puts one down as a real chain of real ids', () => {
    const flow = placeLoop(newFlow(), LOOPS[0]!);
    expect(flow.blocks).toHaveLength(LOOPS[0]!.blocks.length);
    expect(flow.blocks[0]?.after).toEqual([]);
    expect(flow.blocks[1]?.after).toEqual([flow.blocks[0]?.id]);
    expect(flow.blocks[2]?.after).toEqual([flow.blocks[1]?.id]);
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
        for (const was of block.after) {
          expect(canWaitFor(flow, block.id, was).ok, loop.id).toBe(true);
        }
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
    const flow = drawn('custom');
    expect(canStart(flow)).toBe(false);
    expect(canStart(change(flow, flow.blocks[0]!.id, { says: 'Tighten the nav' }))).toBe(true);
  });

  it('starts happily on blocks that came with their own words', () => {
    expect(canStart(chained('plan', 'checks', 'review'))).toBe(true);
  });

  it('will not start twice over', () => {
    const flow = chained('plan', 'review');
    const going = { ...flow, running: flow.blocks[0]!.id };
    expect(isRunning(going)).toBe(true);
    expect(canStart(going)).toBe(false);
  });

  it('is a draft again once it has been reset', () => {
    const drew = chained('plan', 'review');
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
    const flow = chained('plan', 'custom', 'review');
    expect(nextUp(flow)?.id).toBe(flow.blocks[0]!.id);
  });

  it('moves on once the one before it has finished', () => {
    const flow = chained('plan', 'custom', 'review');
    const [look, work] = flow.blocks.map((one) => one.id);
    expect(nextUp({ ...flow, done: [look!] })?.id).toBe(work);
  });

  it('never sends what follows a block that did not happen', () => {
    const flow = chained('plan', 'custom', 'review');
    // Only the second is done, which cannot happen — but if it did, the third
    // must not go: it would be working against a change nobody made.
    expect(nextUp({ ...flow, done: [flow.blocks[1]!.id] })?.id).toBe(flow.blocks[0]!.id);
  });

  it('has nothing left to send once everything has finished', () => {
    const flow = chained('plan', 'review');
    expect(nextUp({ ...flow, done: flow.blocks.map((one) => one.id) })).toBeNull();
  });
});

describe('the order it goes on the board in', () => {
  it('never puts a block before the one it waits for', () => {
    const flow = chained('plan', 'custom', 'checks', 'review');
    const order = runOrder(flow).map((one) => one.id);
    for (const block of flow.blocks) {
      for (const was of block.after) {
        expect(order.indexOf(block.id)).toBeGreaterThan(order.indexOf(was));
      }
    }
  });

  it('holds for a fork as well as a chain', () => {
    let flow = place(newFlow(), 'plan');
    const head = flow.blocks[0]!.id;
    flow = place(flow, 'custom', head);
    flow = place(flow, 'checks', head);
    const order = runOrder(flow).map((one) => one.id);
    expect(order[0]).toBe(head);
    expect(order).toHaveLength(3);
  });
});

describe('what each block is asked', () => {
  it('sends what somebody typed, as they typed it', () => {
    const flow = drawn('custom');
    const said = change(flow, flow.blocks[0]!.id, { says: '  Tighten the nav  ' });
    expect(asksOf(said.blocks[0]!)).toBe('Tighten the nav');
  });

  it('falls back to the kind’s own words rather than sending nothing', () => {
    const drew = drawn('checks');
    const flow = change(drew, drew.blocks[0]!.id, { says: '   ' });
    expect(asksOf(flow.blocks[0]!)).toBe(specOf('checks').says);
  });

  it('asks the helpers block to split the work and bring it back together', () => {
    const drew = drawn('subagents');
    const flow = change(drew, drew.blocks[0]!.id, { says: 'every page' });
    expect(asksOf(flow.blocks[0]!)).toBe(helperWords('every page'));
    expect(asksOf(flow.blocks[0]!)).toContain('every page');
  });

  it('gives every kind a name and a note, and something to ask where it sends', () => {
    for (const spec of BLOCKS) {
      expect(spec.name).not.toBe('');
      expect(spec.note).not.toBe('');
      // A gate sends nothing at all, which is the whole of what it is.
      if (!spec.needsWords && spec.kind !== 'wait') expect(spec.says.trim(), spec.kind).not.toBe('');
    }
  });

  it('reads as a whole sentence wherever the kind brought its own', () => {
    for (const spec of BLOCKS) {
      if (spec.needsWords || spec.says === '') continue;
      expect(spec.says, spec.kind).toMatch(/^[A-Z].*\.$/s);
    }
  });
});

/* ========================================================================== */
/* Laying it out                                                              */
/* ========================================================================== */

describe('laying it out', () => {
  it('has nothing to draw for an empty flow', () => {
    expect(layOut(newFlow())).toEqual({ blocks: [], width: 0, height: 0 });
  });

  it('puts a chain on one line, left to right', () => {
    const flow = chained('plan', 'custom', 'review');
    const out = layOut(flow);
    expect(new Set(out.blocks.map((one) => one.y)).size).toBe(1);
    const xs = out.blocks.map((one) => one.x).sort((a, b) => a - b);
    expect(xs).toEqual([0, CARD.width + CARD.gapX, (CARD.width + CARD.gapX) * 2]);
  });

  it('puts blocks that wait for nothing one under another', () => {
    const out = layOut(drawn('plan', 'custom', 'review'));
    expect(new Set(out.blocks.map((one) => one.x)).size).toBe(1);
    expect(new Set(out.blocks.map((one) => one.y)).size).toBe(3);
  });

  it('keeps the first of a fork on its parent’s line and moves the rest down', () => {
    let flow = place(newFlow(), 'plan');
    const head = flow.blocks[0]!.id;
    flow = place(flow, 'custom', head);
    flow = place(flow, 'checks', head);
    const ys = new Map(layOut(flow).blocks.map((one) => [one.id, one.y]));
    expect(ys.get(head)).toBe(0);
    expect(new Set([...ys.values()]).size).toBe(2);
  });

  it('leaves a block where somebody put it', () => {
    const flow = chained('plan', 'custom');
    const moved = change(flow, flow.blocks[1]!.id, { at: { x: 40, y: 300 } });
    const out = layOut(moved);
    expect(out.blocks.find((one) => one.id === flow.blocks[1]!.id)).toMatchObject({ x: 40, y: 300 });
    // And the one nobody moved is still where the arithmetic put it.
    expect(out.blocks.find((one) => one.id === flow.blocks[0]!.id)).toMatchObject({ x: 0, y: 0 });
  });

  it('knows when it has been arranged by hand, and puts it back when asked', () => {
    const flow = chained('plan', 'custom');
    expect(isArranged(flow)).toBe(false);
    const moved = change(flow, flow.blocks[1]!.id, { at: { x: 999, y: 999 } });
    expect(isArranged(moved)).toBe(true);
    expect(isArranged(tidied(moved))).toBe(false);
  });

  it('draws everything as a draft until it is started', () => {
    const out = layOut(chained('plan', 'review'));
    expect(out.blocks.every((one) => one.state === 'draft')).toBe(true);
  });

  it('says which one is going, which is done, and which is still to come', () => {
    const flow = chained('plan', 'custom', 'review');
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
    let flow = place(newFlow(), 'plan');
    const head = flow.blocks[0]!.id;
    flow = place(flow, 'custom', head);
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
    const flow = readFlow({ id: 'f', blocks: [{ id: 'a', kind: 'custom' }, { id: 'a', kind: 'review' }] });
    expect(flow?.blocks).toHaveLength(1);
    expect(flow?.blocks[0]?.kind).toBe('custom');
  });

  it('frees a wait pointing at a block that did not survive the read', () => {
    const flow = readFlow({
      id: 'f',
      blocks: [
        { id: 'a', kind: 'custom', after: 'gone' },
        { id: 'b', kind: 'review', after: 'a' },
      ],
    });
    expect(flow?.blocks[0]?.after).toEqual([]);
    expect(flow?.blocks[1]?.after).toEqual(['a']);
  });

  it('keeps a model only when both halves of it are there', () => {
    const flow = readFlow({
      id: 'f',
      blocks: [
        { id: 'a', kind: 'custom', model: { providerId: 'anthropic', modelId: 'claude' } },
        { id: 'b', kind: 'custom', model: { providerId: 'anthropic' } },
        { id: 'c', kind: 'custom', model: 'the good one' },
      ],
    });
    expect(flow?.blocks[0]?.model).toEqual({ providerId: 'anthropic', modelId: 'claude' });
    expect(flow?.blocks[1]?.model).toBeNull();
    expect(flow?.blocks[2]?.model).toBeNull();
  });

  it('keeps a file only when it is whole, and never more than it will carry', () => {
    const one = { name: 'a.png', mimeType: 'image/png', kind: 'image', bytes: 'AAA' };
    const flow = readFlow({
      id: 'f',
      blocks: [
        { id: 'a', kind: 'custom', files: [one, { name: 'b.png' }, { ...one, bytes: '' }] },
        { id: 'b', kind: 'custom', files: Array.from({ length: 9 }, () => one) },
        { id: 'c', kind: 'custom', files: 'a photo' },
      ],
    });
    expect(flow?.blocks[0]?.files).toEqual([one]);
    expect(flow?.blocks[1]?.files).toHaveLength(MOST_FILES);
    expect(flow?.blocks[2]?.files).toBeUndefined();
  });

  it('reads a flow written before a block could carry anything but a picture', () => {
    const flow = readFlow({
      id: 'f',
      blocks: [{ id: 'a', kind: 'custom', pictures: [{ name: 'a.png', mimeType: 'image/png', bytes: 'AAA' }] }],
    });
    expect(flow?.blocks[0]?.files).toEqual([
      { name: 'a.png', mimeType: 'image/png', kind: 'image', bytes: 'AAA' },
    ]);
  });

  it('puts the text a block carries into what it is asked, and says where it cut', () => {
    const block = {
      id: 'a',
      kind: 'custom' as const,
      says: 'Follow this spec.',
      model: null,
      after: [],
      files: [
        { name: 'spec.md', mimeType: 'text/markdown', kind: 'text' as const, bytes: '# Spec\nDo the thing.' },
        { name: 'shot.png', mimeType: 'image/png', kind: 'image' as const, bytes: 'AAA' },
      ],
    };
    const asked = asksOf(block);
    expect(asked).toContain('Follow this spec.');
    expect(asked).toContain('--- spec.md ---');
    expect(asked).toContain('Do the thing.');
    // A picture is not text and never lands in the words.
    expect(asked).not.toContain('shot.png');

    const long = asksOf({ ...block, files: [{ ...block.files[0]!, bytes: 'x'.repeat(MOST_TEXT + 50) }] });
    expect(long).toContain('cut here');
    expect(long.length).toBeLessThan(MOST_TEXT + 400);
  });

  it('keeps what a block came to, and only for blocks it still has', () => {
    const flow = readFlow({
      id: 'f',
      blocks: [{ id: 'a', kind: 'checks' }],
      said: {
        a: { text: 'All green.', turns: 3, at: 5 },
        gone: { text: 'From a block nobody has.', turns: 1, at: 5 },
        b: { turns: 2 },
      },
    });
    expect(flow?.said['a']).toEqual({ text: 'All green.', turns: 3, at: 5 });
    expect(flow?.said['gone']).toBeUndefined();
    expect(flow?.said['b']).toBeUndefined();
  });

  it('says where a flow begins', () => {
    let flow = place(newFlow(), 'plan');
    const head = flow.blocks[0]!.id;
    flow = place(flow, 'checks', head);
    flow = place(flow, 'review');
    expect(startsAt(flow).map((one) => one.id).sort()).toEqual([head, flow.blocks[2]!.id].sort());
  });

  it('comes back at the rung the canvas was set to, and runs on when it is nonsense', () => {
    expect(readFlow({ id: 'f', blocks: [], howFar: 'changing' })?.howFar).toBe('changing');
    // A flow is left to run. Stopping to ask would stop it where nobody is
    // looking, so the fallback is the rung that does not stop.
    expect(readFlow({ id: 'f', blocks: [], howFar: 'whenever' })?.howFar).toBe('doing');
    expect(newFlow().howFar).toBe('doing');
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

describe('how a run ended', () => {
  it('says nothing before it is started, or while it is going', () => {
    let flow = place(newFlow(), 'checks');
    expect(endedAs(flow)).toBeNull();
    flow = { ...flow, startedAt: 1, running: flow.blocks[0]!.id };
    expect(endedAs(flow)).toBeNull();
    expect(endedAs({ ...flow, running: null })).toBeNull();
  });

  it('counts what ran, the turns it took, and the last thing said', () => {
    let flow = place(newFlow(), 'plan');
    const one = flow.blocks[0]!.id;
    flow = place(flow, 'checks', one);
    const two = flow.blocks[1]!.id;
    flow = place(flow, 'pull-request', two);
    const ended = endedAs({
      ...flow,
      startedAt: 1,
      done: [one, two],
      said: { [one]: { text: 'Read it.', turns: 4, at: 10 }, [two]: { text: 'All green.', turns: 3, at: 20 } },
    });
    expect(ended?.whole).toBe(false);
    expect(ended?.ran).toBe(2);
    expect(ended?.turns).toBe(7);
    expect(ended?.left.map((block) => block.id)).toEqual([flow.blocks[2]!.id]);
    expect(ended?.last?.said.text).toBe('All green.');
  });

  it('is whole once every block has had its turn', () => {
    let flow = place(newFlow(), 'plan');
    flow = place(flow, 'checks', flow.blocks[0]!.id);
    const ended = endedAs({ ...flow, startedAt: 1, done: flow.blocks.map((one) => one.id) });
    expect(ended?.whole).toBe(true);
    expect(ended?.turns).toBe(0);
    expect(ended?.last).toBeNull();
  });
});

describe('branches, and the shapes people actually draw', () => {
  /** A → B, A → C, B → D. Two ends, one start. */
  function branched() {
    let flow = place(newFlow(), 'plan');
    const a = flow.blocks[0]!.id;
    flow = place(flow, 'custom', a);
    const b = flow.blocks[1]!.id;
    flow = place(flow, 'subagents', a);
    const c = flow.blocks[2]!.id;
    flow = place(flow, 'review', b);
    return { flow, a, b, c, d: flow.blocks[3]!.id };
  }

  it('one start, two ends', () => {
    const { flow, c, d } = branched();
    expect(startsAt(flow)).toHaveLength(1);
    const ends = flow.blocks.filter((one) => waitingOn(flow, one.id).length === 0);
    expect(ends.map((one) => one.id).sort()).toEqual([c, d].sort());
  });

  it('runs both branches, each only after what it waits for', () => {
    const { flow, a, b, c, d } = branched();
    let going: Flow = { ...flow, startedAt: 1 };
    const order: string[] = [];
    for (let round = 0; round < 10; round += 1) {
      const next = nextUp(going);
      if (next === null) break;
      order.push(next.id);
      going = { ...going, done: [...going.done, next.id] };
    }
    expect(order[0]).toBe(a);
    expect(order).toHaveLength(4);
    expect(order.indexOf(d)).toBeGreaterThan(order.indexOf(b));
    expect(order).toContain(c);
    expect(endedAs(going)?.whole).toBe(true);
  });

  it('a branch that never finished takes only its own side down', () => {
    const { flow, a, b, c } = branched();
    // A ran, then B was stopped. C still has everything it waits for.
    const stuck: Flow = { ...flow, startedAt: 1, done: [a] };
    expect(nextUp(stuck)?.id === b || nextUp(stuck)?.id === c).toBe(true);
    const past: Flow = { ...stuck, done: [a, c] };
    // What waits on B is never offered while B has not finished.
    expect(nextUp(past)?.id).toBe(b);
  });

  it('lays branches out in their own rows, not on top of each other', () => {
    const { flow } = branched();
    const drawn = layOut(flow);
    const seen = new Set(drawn.blocks.map((one) => `${String(one.x)},${String(one.y)}`));
    expect(seen.size).toBe(drawn.blocks.length);
  });

  it('several starts is a shape, not a mistake', () => {
    let flow = place(newFlow(), 'plan');
    flow = place(flow, 'checks');
    expect(startsAt(flow)).toHaveLength(2);
    expect(canStart({ ...flow, blocks: flow.blocks.map((one) => ({ ...one, says: 'go' })) })).toBe(true);
  });

  it('breaks a ring a file arrived with, so the flow can still run', () => {
    const flow = readFlow({
      id: 'f',
      blocks: [
        { id: 'a', kind: 'checks', after: 'b' },
        { id: 'b', kind: 'checks', after: 'a' },
      ],
    });
    expect(flow?.blocks.filter((one) => one.after.length === 0)).toHaveLength(1);
    expect(nextUp({ ...flow!, startedAt: 1 })).not.toBeNull();
  });

  it('removing the middle of a branch hands its children back up the chain', () => {
    const { flow, a, b, d } = branched();
    const without = remove(flow, b);
    expect(without.blocks.find((one) => one.id === d)?.after).toEqual([a]);
    expect(without.blocks).toHaveLength(3);
  });
});

describe('a folder that holds several projects', () => {
  it('a flow names one of them, and reads one back', () => {
    expect(newFlow().repo).toBeNull();
    expect(readFlow({ id: 'f', blocks: [], repo: 'backend' })?.repo).toBe('backend');
    expect(readFlow({ id: 'f', blocks: [], repo: '' })?.repo).toBeNull();
    expect(readFlow({ id: 'f', blocks: [], repo: 7 })?.repo).toBeNull();
    expect(readFlow({ id: 'f', blocks: [] })?.repo).toBeNull();
  });

  it('what a flow works in survives a write and a read', () => {
    const flow = { ...place(newFlow(), 'pull-request'), repo: 'backend' };
    expect(readFlows(JSON.parse(JSON.stringify([flow])) as unknown)[0]?.repo).toBe('backend');
  });

  it('the window sends every block to the folder the flow names', () => {
    const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
    expect(app).toContain('...(flow.repo === null ? {} : { repo: flow.repo }),');
    // Both the conversation it opens and every turn it sends.
    expect(app.match(/\.\.\.\(flow\.repo === null \? \{\} : \{ repo: flow\.repo \}\),/g)?.length).toBe(2);
  });
});

/* ---------------------------------------------------------------------------
   A block can wait for more than one thing
   --------------------------------------------------------------------------- */

describe('waiting for several blocks at once', () => {
  /** The shape people actually draw: build and check in parallel, one review
   *  after both. A → B, A → C, B → D, C → D. */
  function diamond() {
    let flow = place(newFlow(), 'plan');
    const a = flow.blocks[0]!.id;
    flow = place(flow, 'custom', a);
    const b = flow.blocks[1]!.id;
    flow = place(flow, 'checks', a);
    const c = flow.blocks[2]!.id;
    flow = place(flow, 'review', [b, c]);
    return { flow, a, b, c, d: flow.blocks[3]!.id };
  }

  it('places one behind several at once', () => {
    const { flow, b, c, d } = diamond();
    expect(flow.blocks.find((one) => one.id === d)?.after).toEqual([b, c]);
  });

  it('does not begin until every one of them has finished', () => {
    const { flow, a, b, c, d } = diamond();
    const going: Flow = { ...flow, startedAt: 1 };
    expect(nextUp(going)?.id).toBe(a);
    // A done: both branches are up, in order, and never the review.
    const afterA: Flow = { ...going, done: [a] };
    expect([b, c]).toContain(nextUp(afterA)?.id);
    const afterB: Flow = { ...going, done: [a, b] };
    expect(nextUp(afterB)?.id).toBe(c);
    const afterC: Flow = { ...going, done: [a, c] };
    expect(nextUp(afterC)?.id).toBe(b);
    // Only once both are in.
    expect(nextUp({ ...going, done: [a, b, c] })?.id).toBe(d);
  });

  it('runs every block exactly once', () => {
    const { flow } = diamond();
    let going: Flow = { ...flow, startedAt: 1 };
    const order: string[] = [];
    for (let round = 0; round < 20; round += 1) {
      const next = nextUp(going);
      if (next === null) break;
      order.push(next.id);
      going = { ...going, done: [...going.done, next.id] };
    }
    expect(order).toHaveLength(4);
    expect(new Set(order).size).toBe(4);
    expect(endedAs(going)?.whole).toBe(true);
  });

  it('a branch that never finished holds only what waits on it', () => {
    const { flow, a, b, c, d } = diamond();
    // A and B done, C stopped: the review waits, C is still what is up.
    const stuck: Flow = { ...flow, startedAt: 1, done: [a, b] };
    expect(nextUp(stuck)?.id).toBe(c);
    expect(nextUp(stuck)?.id).not.toBe(d);
  });

  it('one start, one end', () => {
    const { flow, a, d } = diamond();
    expect(startsAt(flow).map((one) => one.id)).toEqual([a]);
    expect(flow.blocks.filter((one) => waitingOn(flow, one.id).length === 0).map((one) => one.id)).toEqual([d]);
  });

  it('sits past the furthest thing it waits for, not beside the nearest', () => {
    // A → B → C → E and A → E: E belongs after C, not next to B.
    let flow = place(newFlow(), 'plan');
    const a = flow.blocks[0]!.id;
    flow = place(flow, 'custom', a);
    const b = flow.blocks[1]!.id;
    flow = place(flow, 'checks', b);
    const c = flow.blocks[2]!.id;
    flow = place(flow, 'review', [a, c]);
    const drawn = layOut(flow);
    const at = (id: string) => drawn.blocks.find((one) => one.id === id)!;
    expect(at(flow.blocks[3]!.id).x).toBeGreaterThan(at(c).x);
  });

  it('lays every block somewhere of its own', () => {
    const { flow } = diamond();
    const drawn = layOut(flow);
    const spots = new Set(drawn.blocks.map((one) => `${String(one.x)},${String(one.y)}`));
    expect(spots.size).toBe(drawn.blocks.length);
  });

  it('refuses a ring closed through the other branch', () => {
    const { flow, a, d } = diamond();
    // A already reaches D through both branches, so A waiting for D is a ring
    // no single-chain walk would have caught.
    expect(canWaitFor(flow, a, d).ok).toBe(false);
    expect(join(flow, a, d)).toBe(flow);
  });

  it('refuses to wait for itself, and for a block nobody has', () => {
    const { flow, a } = diamond();
    expect(canWaitFor(flow, a, a).ok).toBe(false);
    expect(canWaitFor(flow, a, 'nowhere').ok).toBe(false);
    expect(canWaitFor(flow, 'nowhere', a).ok).toBe(false);
  });

  it('joining the same pair twice is one line', () => {
    const { flow, b, d } = diamond();
    const again = join(flow, d, b);
    expect(again).toBe(flow);
    expect(again.blocks.find((one) => one.id === d)?.after).toEqual(flow.blocks.find((one) => one.id === d)?.after);
  });

  it('takes one wait off and leaves the rest', () => {
    const { flow, b, c, d } = diamond();
    const off = unjoin(flow, d, b);
    expect(off.blocks.find((one) => one.id === d)?.after).toEqual([c]);
    expect(joined(off, d, b)).toBe(false);
    expect(joined(off, d, c)).toBe(true);
    // Taking off a wait nobody has changes nothing.
    expect(unjoin(off, d, b)).toBe(off);
    expect(unjoin(off, 'nowhere', c)).toBe(off);
  });

  it('a block with every wait taken off starts the flow', () => {
    const { flow, b, c, d } = diamond();
    const loose = unjoin(unjoin(flow, d, b), d, c);
    expect(startsAt(loose).map((one) => one.id)).toContain(d);
    expect(nextUp({ ...loose, startedAt: 1 })).not.toBeNull();
  });

  it('removing the middle splices its waits into what waited on it', () => {
    const { flow, a, b, c, d } = diamond();
    const without = remove(flow, b);
    // D waited on B and C; B waited on A. D now waits on C and A.
    expect([...(without.blocks.find((one) => one.id === d)?.after ?? [])].sort()).toEqual([a, c].sort());
    expect(without.blocks).toHaveLength(3);
  });

  it('removing a block never leaves one waiting for itself', () => {
    // A → B, B → C, and C → A would be a ring, so: A → B → C, plus A → C.
    let flow = place(newFlow(), 'plan');
    const a = flow.blocks[0]!.id;
    flow = place(flow, 'custom', a);
    const b = flow.blocks[1]!.id;
    flow = place(flow, 'checks', [a, b]);
    const c = flow.blocks[2]!.id;
    const without = remove(flow, b);
    expect(without.blocks.find((one) => one.id === c)?.after).toEqual([a]);
    expect(without.blocks.every((one) => !one.after.includes(one.id))).toBe(true);
  });

  it('the picker never offers a block that would close a ring', () => {
    const { flow, a, b, c, d } = diamond();
    const could = (id: string) =>
      flow.blocks.filter((one) => one.id !== id && canWaitFor(flow, id, one.id).ok).map((one) => one.id);
    expect(could(a)).toEqual([]);
    expect(could(b).sort()).toEqual([a, c].sort());
    expect(could(d).sort()).toEqual([a, b, c].sort());
  });

  it('reads a flow written when a block could only wait for one thing', () => {
    const flow = readFlow({
      id: 'f',
      blocks: [
        { id: 'a', kind: 'plan' },
        { id: 'b', kind: 'custom', after: 'a' },
        { id: 'c', kind: 'review', after: ['a', 'b'] },
      ],
    });
    expect(flow?.blocks[0]?.after).toEqual([]);
    expect(flow?.blocks[1]?.after).toEqual(['a']);
    expect(flow?.blocks[2]?.after).toEqual(['a', 'b']);
  });

  it('drops what it cannot make sense of, one wait at a time', () => {
    const flow = readFlow({
      id: 'f',
      blocks: [
        { id: 'a', kind: 'plan' },
        // itself, a block nobody has, the same one twice, and a number
        { id: 'b', kind: 'custom', after: ['b', 'gone', 'a', 'a', 7, ''] },
        { id: 'c', kind: 'review', after: {} },
      ],
    });
    expect(flow?.blocks[1]?.after).toEqual(['a']);
    expect(flow?.blocks[2]?.after).toEqual([]);
  });

  it('breaks a ring at one edge and keeps every other wait', () => {
    // A → B → C → A, plus a fourth waiting on A. Only the edge that closes the
    // ring goes; the rest of the shape stands.
    const flow = readFlow({
      id: 'f',
      blocks: [
        { id: 'a', kind: 'plan', after: ['c'] },
        { id: 'b', kind: 'custom', after: ['a'] },
        { id: 'c', kind: 'checks', after: ['b'] },
        { id: 'd', kind: 'review', after: ['a'] },
      ],
    });
    const edges = (flow?.blocks ?? []).flatMap((one) => one.after.map((was) => `${was}->${one.id}`));
    // Three of the four survive — which one goes is whichever closed the ring
    // as the file was read, and any of them is a correct break.
    expect(edges).toHaveLength(3);
    // The edge outside the ring is never the one taken.
    expect(edges).toContain('a->d');
    // And what is left runs: something is up, and everything gets a turn.
    let going: Flow = { ...flow!, startedAt: 1 };
    const order: string[] = [];
    for (let round = 0; round < 10; round += 1) {
      const next = nextUp(going);
      if (next === null) break;
      order.push(next.id);
      going = { ...going, done: [...going.done, next.id] };
    }
    expect(new Set(order).size).toBe(4);
  });

  it('reads back exactly what was written, however many waits', () => {
    const { flow } = diamond();
    const back = readFlows(JSON.parse(JSON.stringify([flow])) as unknown)[0];
    expect(back?.blocks.map((one) => one.after)).toEqual(flow.blocks.map((one) => one.after));
  });

  it('every kind of block can wait for several, gates included', () => {
    for (const spec of BLOCKS) {
      let flow = place(newFlow(), 'plan');
      const a = flow.blocks[0]!.id;
      flow = place(flow, 'checks', a);
      const b = flow.blocks[1]!.id;
      flow = place(flow, spec.kind, [a, b]);
      const one = flow.blocks[2]!;
      expect(one.after, spec.kind).toEqual([a, b]);
      // It is offered only once both are in, whatever kind it is.
      expect(nextUp({ ...flow, startedAt: 1, done: [a] })?.id, spec.kind).toBe(b);
      expect(nextUp({ ...flow, startedAt: 1, done: [a, b] })?.id, spec.kind).toBe(one.id);
      // A gate still stops for a person rather than being sent.
      expect(isGate(one), spec.kind).toBe(spec.kind === 'wait');
    }
  });

  it('a gate with two waits holds both branches until it is opened', () => {
    let flow = place(newFlow(), 'plan');
    const a = flow.blocks[0]!.id;
    flow = place(flow, 'checks', a);
    const b = flow.blocks[1]!.id;
    flow = place(flow, 'wait', [a, b]);
    const gate = flow.blocks[2]!.id;
    flow = place(flow, 'pull-request', gate);
    const stopped: Flow = { ...flow, startedAt: 1, done: [a, b], running: gate };
    expect(stateOf(flow.blocks[2]!, stopped)).toBe('needs-you');
    // Nothing past the gate is up while it holds.
    expect(nextUp(stopped)?.id).toBe(gate);
    expect(nextUp({ ...stopped, running: null, done: [a, b, gate] })?.id).toBe(flow.blocks[3]!.id);
  });

  it('tidying a diamond is the same every time', () => {
    const { flow } = diamond();
    expect(tidy(flow)).toEqual(tidy(tidied(flow)));
    expect(isArranged(tidied(flow))).toBe(false);
  });

  it('a flow of nothing but starts is a flow', () => {
    let flow = place(newFlow(), 'plan');
    flow = place(flow, 'checks');
    flow = place(flow, 'review');
    expect(startsAt(flow)).toHaveLength(3);
    const going: Flow = { ...flow, startedAt: 1 };
    expect(nextUp(going)).not.toBeNull();
    expect(endedAs({ ...going, done: flow.blocks.map((one) => one.id) })?.whole).toBe(true);
  });

  it('says how a run of several branches ended', () => {
    const { flow, a, b, c, d } = diamond();
    const half = endedAs({ ...flow, startedAt: 1, done: [a, b] });
    expect(half?.whole).toBe(false);
    expect(half?.left.map((one) => one.id).sort()).toEqual([c, d].sort());
    expect(endedAs({ ...flow, startedAt: 1, done: [a, b, c, d] })?.whole).toBe(true);
  });
});

describe('what a line between two blocks is doing', () => {
  it('is idle until the run has left the block it comes from', () => {
    for (const from of ['draft', 'waiting', 'running', 'needs-you', 'failed'] as const) {
      for (const to of ['draft', 'waiting', 'running', 'needs-you', 'done', 'failed'] as const) {
        expect(lineState(from, to), `${from}->${to}`).toBe('idle');
      }
    }
  });

  it('carries the wave into whatever is being worked on', () => {
    expect(lineState('done', 'running')).toBe('live');
    expect(lineState('done', 'needs-you')).toBe('live');
  });

  it('wears the accent once both ends are finished', () => {
    expect(lineState('done', 'done')).toBe('passed');
  });

  it('says nothing about a block that has not had its turn', () => {
    expect(lineState('done', 'waiting')).toBe('idle');
    expect(lineState('done', 'draft')).toBe('idle');
    expect(lineState('done', 'failed')).toBe('idle');
  });

  it('the view asks this rather than working it out itself', () => {
    const view = readFileSync(new URL('../src/components/CanvasView.tsx', import.meta.url), 'utf8');
    expect(view).toContain('lineState(parent.state, block.state)');
    expect(view).toContain("doing === 'live' ?");
  });
});
