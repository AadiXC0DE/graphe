/** A flow, before and after anything runs.
 *
 * The claim this file exists for: drawing one changes nothing, and what the
 * machine sends is what the picture showed. Every function here is safe on a
 * shape nobody has committed to, and the ones that decide what happens when
 * somebody does — `readyNow`, `laneFor`, `askOf` — have to agree with each
 * other.
 */

import { describe, expect, it } from 'vitest';

import { newRunId } from '../src/domain/identity';

import {
  askOf,
  ASK_STARTING,
  BLOCKS,
  blockId,
  CARD,
  canvasWords,
  canStart,
  canWaitFor,
  change,
  checksFix,
  columns,
  endedAs,
  goalSays,
  historyOf,
  isArranged,
  isGate,
  join,
  joined,
  KEPT_RUNS,
  KEPT_UNDOS,
  LANE_0,
  laneFor,
  latestRun,
  layOut,
  lineState,
  newFlow,
  nextUp,
  place,
  placeTemplate,
  readyNow,
  readFlow,
  readFlows,
  redo,
  remove,
  retriesFor,
  runOrder,
  specOf,
  stateOf,
  TEMPLATES,
  tidy,
  undo,
  undoable,
  unjoin,
  withFlow,
  withRun,
  withoutFlow,
  type Block,
  type BlockKind,
  type BlockRun,
  type Flow,
  type Run,
  type RunState,
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

/** A block's part of a run, waiting until it is said otherwise. */
function held(over: Partial<BlockRun> = {}): BlockRun {
  return {
    state: 'waiting',
    lane: 'lane-0',
    startedAt: null,
    endedAt: null,
    said: null,
    turns: 0,
    spent: null,
    rounds: 0,
    result: null,
    failure: null,
    ...over,
  };
}

/** A run of this flow, with the blocks it says and nothing else. */
function runOf(blocks: Readonly<Record<string, BlockRun>>, state: RunState = 'done'): Run {
  return {
    id: newRunId(),
    state,
    startedAt: 1,
    endedAt: state === 'done' ? 2 : null,
    lanes: [{ id: 'lane-0', workspaceId: 'ws-1', conversationId: 'c-1', branch: null }],
    blocks,
    spent: null,
  };
}

/** A flow with every block waiting, which is a run that has just begun. */
const begun = (flow: Flow): Run =>
  runOf(Object.fromEntries(flow.blocks.map((one) => [one.id, held()])), 'running');

/** Every block the machine would send, in order, marking each done as it goes.
 *  What the shell does, in one function, so the shape decides the answer. */
function played(flow: Flow): readonly string[] {
  let run = begun(flow);
  const order: string[] = [];
  for (let round = 0; round < 30; round += 1) {
    const ready = readyNow(flow, run);
    if (ready.length === 0) break;
    const blocks: Record<string, BlockRun> = { ...run.blocks };
    for (const block of ready) {
      order.push(block.id);
      blocks[block.id] = held({ state: 'done', lane: laneFor(flow, block), said: block.name, endedAt: 2 });
    }
    run = { ...run, blocks };
  }
  return order;
}

/** A → B, A → C, then D after both. The shape people actually draw. */
function diamond() {
  const flow = laid();
  return {
    flow,
    a: flow.blocks[0]!.id,
    b: flow.blocks[1]!.id,
    c: flow.blocks[2]!.id,
    d: flow.blocks[3]!.id,
  };
}

/** The diamond itself, built by placing so the joins are real. */
function laid(): Flow {
  let flow = place(newFlow(), 'plan');
  const a = flow.blocks[0]!.id;
  flow = place(flow, 'ask', a);
  const b = flow.blocks[1]!.id;
  flow = place(flow, 'checks', a);
  const c = flow.blocks[2]!.id;
  return place(flow, 'review', [b, c]);
}

/* ========================================================================== */
/* Placing                                                                    */
/* ========================================================================== */

describe('placing blocks', () => {
  it('starts with nothing, no runs and nothing going', () => {
    const flow = newFlow();
    expect(flow.blocks).toEqual([]);
    expect(flow.runs).toEqual([]);
    expect(latestRun(flow)).toBeNull();
    expect(flow.lanes).toBe('in-turn');
    expect(flow.howFar).toBe('doing');
  });

  it('gives every block an id nobody else has', () => {
    const flow = drawn('ask', 'ask', 'ask');
    expect(new Set(idsOf(flow)).size).toBe(3);
  });

  it('takes the kind’s name and words, so a block is worth something the moment it lands', () => {
    const flow = drawn('checks');
    expect(flow.blocks[0]?.name).toBe(specOf('checks').name);
    expect(flow.blocks[0]?.says).toBe(specOf('checks').says);
    expect(flow.blocks[0]?.retries).toBe(retriesFor('checks'));
  });

  it('leaves the blocks that need saying what about empty on purpose', () => {
    expect(drawn('ask').blocks[0]?.says).toBe('');
    expect(drawn('goal').blocks[0]?.says).toBe('');
    expect(drawn('plan').blocks[0]?.says).not.toBe('');
  });

  it('gives a block a null model, no thinking, no attachments and no place', () => {
    const block = drawn('review').blocks[0]!;
    expect(block.model).toBeNull();
    expect(block.thinking).toBeNull();
    expect(block.attachments).toEqual([]);
    expect(block.lookFirst).toBe(false);
    expect(block.at).toBeUndefined();
  });

  it('refuses to place one behind a block nobody has', () => {
    expect(place(newFlow(), 'ask', 'nowhere').blocks[0]?.after).toEqual([]);
  });

  it('drops the same wait twice', () => {
    const first = place(newFlow(), 'plan').blocks[0]!.id;
    let flow = place(newFlow(), 'plan');
    const head = flow.blocks[0]!.id;
    flow = place(flow, 'checks', [head, head, first]);
    expect(flow.blocks[1]?.after).toEqual([head]);
  });

  it('changes only the block it was asked about', () => {
    const flow = drawn('ask', 'review');
    const first = flow.blocks[0]!.id;
    const next = change(flow, first, { says: 'Tighten the nav' });
    expect(next.blocks[0]?.says).toBe('Tighten the nav');
    expect(next.blocks[1]?.says).toBe(flow.blocks[1]?.says);
  });

  it('hands out ids that are not the same as a flow’s', () => {
    expect(blockId()).toMatch(/^block-/);
    expect(newFlow().id).toMatch(/^flow-/);
  });
});

describe('taking one out', () => {
  it('hands what was waiting on it to what it was waiting for', () => {
    const flow = chained('plan', 'ask', 'review');
    const [look, work, review] = idsOf(flow);
    const next = remove(flow, work!);
    expect(idsOf(next)).toEqual([look, review]);
    expect(next.blocks.find((one) => one.id === review)?.after).toEqual([look]);
  });

  it('frees the head of a chain rather than stranding the rest', () => {
    const next = remove(chained('plan', 'ask'), idsOf(chained('plan', 'ask'))[0]!);
    expect(next.blocks[0]?.after).toEqual([]);
  });

  it('does nothing for a block nobody has', () => {
    const flow = drawn('ask');
    expect(remove(flow, 'nowhere')).toEqual(flow);
  });

  it('splices a removed block’s waits into what waited on it', () => {
    const { flow, a, b, c, d } = diamond();
    const without = remove(flow, b);
    expect([...(without.blocks.find((one) => one.id === d)?.after ?? [])].sort()).toEqual([a, c].sort());
    expect(without.blocks).toHaveLength(3);
  });

  it('never leaves a block waiting for itself', () => {
    let flow = place(newFlow(), 'plan');
    const a = flow.blocks[0]!.id;
    flow = place(flow, 'checks', a);
    const b = flow.blocks[1]!.id;
    flow = place(flow, 'review', [a, b]);
    const without = remove(flow, b);
    expect(without.blocks.every((one) => !one.after.includes(one.id))).toBe(true);
  });
});

/* ========================================================================== */
/* Joining                                                                    */
/* ========================================================================== */

describe('whether one block may wait for another', () => {
  it('allows an ordinary wait, and allows waiting for nothing', () => {
    const flow = drawn('ask', 'review');
    const [work, review] = idsOf(flow);
    expect(canWaitFor(flow, review!, work!)).toEqual({ ok: true });
    expect(canWaitFor(flow, review!, null)).toEqual({ ok: true });
  });

  it('refuses a block waiting for itself', () => {
    const flow = drawn('ask');
    const said = canWaitFor(flow, idsOf(flow)[0]!, idsOf(flow)[0]!);
    expect(said.ok).toBe(false);
    expect(said.ok === false && said.because).toBe(canvasWords.itself);
  });

  it('refuses a loop, however long the way round', () => {
    const flow = chained('plan', 'ask', 'review');
    const [look, , review] = idsOf(flow);
    const said = canWaitFor(flow, look!, review!);
    expect(said.ok).toBe(false);
    expect(said.ok === false && said.because).toBe(canvasWords.loop);
  });

  it('refuses a ring closed through the other branch', () => {
    const { flow, a, d } = diamond();
    // A already reaches D both ways, so a single-chain walk would miss it.
    expect(canWaitFor(flow, a, d).ok).toBe(false);
    expect(join(flow, a, d)).toBe(flow);
  });

  it('refuses a block nobody has', () => {
    const flow = drawn('ask');
    expect(canWaitFor(flow, idsOf(flow)[0]!, 'nowhere').ok).toBe(false);
    expect(canWaitFor(flow, 'nowhere', idsOf(flow)[0]!).ok).toBe(false);
  });

  it('leaves the flow alone when the join was refused', () => {
    const flow = chained('plan', 'ask');
    const [look, work] = idsOf(flow);
    expect(join(flow, look!, work!)).toEqual(flow);
    expect(join(flow, work!, work!)).toEqual(flow);
  });

  it('joining the same pair twice is one line', () => {
    const { flow, b, d } = diamond();
    expect(join(flow, d, b)).toBe(flow);
  });

  it('joins nothing as waiting for nothing', () => {
    const { flow, d } = diamond();
    expect(join(flow, d, null).blocks.find((one) => one.id === d)?.after).toEqual([]);
  });

  it('takes one wait off and leaves the rest', () => {
    const { flow, b, c, d } = diamond();
    const off = unjoin(flow, d, b);
    expect(off.blocks.find((one) => one.id === d)?.after).toEqual([c]);
    expect(joined(off, d, b)).toBe(false);
    expect(joined(off, d, c)).toBe(true);
    expect(unjoin(off, d, b)).toBe(off);
    expect(unjoin(off, 'nowhere', c)).toBe(off);
  });

  it('the picker never offers a block that would close a ring', () => {
    const { flow, a, b, c, d } = diamond();
    const could = (id: string) =>
      flow.blocks.filter((one) => one.id !== id && canWaitFor(flow, id, one.id).ok).map((one) => one.id);
    expect(could(a)).toEqual([]);
    expect(could(b).sort()).toEqual([a, c].sort());
    expect(could(d).sort()).toEqual([a, b, c].sort());
  });
});

/* ========================================================================== */
/* The kinds                                                                  */
/* ========================================================================== */

describe('the seven kinds', () => {
  it('is seven of them, named for the work rather than the tool', () => {
    expect(BLOCKS.map((one) => one.kind)).toEqual([
      'ask',
      'plan',
      'checks',
      'review',
      'gate',
      'pull-request',
      'goal',
    ]);
  });

  it('gives every kind a name and a note, and words where it sends something', () => {
    for (const spec of BLOCKS) {
      expect(spec.name, spec.kind).not.toBe('');
      expect(spec.note, spec.kind).not.toBe('');
      // A gate sends nothing at all, which is the whole of what it is.
      if (!spec.needsWords && spec.kind !== 'gate') expect(spec.says.trim(), spec.kind).not.toBe('');
    }
  });

  it('reads as a whole sentence wherever the kind brought its own', () => {
    for (const spec of BLOCKS) {
      if (spec.needsWords || spec.says === '') continue;
      expect(spec.says, spec.kind).toMatch(/^[A-Z].*\.$/s);
    }
  });

  it('knows which block sends nothing', () => {
    expect(isGate(place(newFlow(), 'gate').blocks[0]!)).toBe(true);
    expect(isGate(place(newFlow(), 'checks').blocks[0]!)).toBe(false);
  });

  it('gives the two that go round their tries, and nothing else any', () => {
    expect(retriesFor('checks')).toBe(2);
    expect(retriesFor('goal')).toBe(6);
    for (const kind of ['ask', 'plan', 'review', 'gate', 'pull-request'] as const) {
      expect(retriesFor(kind), kind).toBe(0);
    }
    expect(place(newFlow(), 'goal').blocks[0]?.retries).toBe(6);
    expect(place(newFlow(), 'checks').blocks[0]?.retries).toBe(2);
    expect(place(newFlow(), 'ask').blocks[0]?.retries).toBe(0);
  });

  it('asks a goal to work toward the objective and check itself', () => {
    const asked = goalSays('every type error gone');
    expect(asked).toContain('every type error gone');
    expect(asked).toContain('checks');
  });

  it('grades every kind, whatever it is', () => {
    for (const spec of BLOCKS) expect(specOf(spec.kind).kind, spec.kind).toBe(spec.kind);
    expect(specOf('ask').name).toBe('Ask');
  });

  it('names the sentence a checks fix is sent with', () => {
    expect(checksFix(' two still fail. ')).toBe('Fix what failed: two still fail.');
  });

  it('offers the sentences an ask can start from, as sentences rather than kinds', () => {
    expect(ASK_STARTING.map((one) => one.name)).toEqual([
      'Research it',
      'Split between subagents',
      'Check it in the browser',
    ]);
    for (const one of ASK_STARTING) {
      expect(one.says, one.name).toMatch(/^[A-Z].*\.$/s);
      // Starting from one is an ask with words in it, so it is ready to go the
      // moment it lands.
      const drew = place(newFlow(), 'ask');
      const flow = change(drew, drew.blocks[0]!.id, { says: one.says });
      expect(canStart(flow), one.name).toEqual({ ok: true });
      expect(askOf(flow, begun(flow), flow.blocks[0]!), one.name).toBe(one.says);
    }
  });
});

/* ========================================================================== */
/* Templates                                                                  */
/* ========================================================================== */

describe('the templates somebody can put down whole', () => {
  it('is the three templates somebody can put down whole', () => {
    expect(TEMPLATES.map((one) => one.name)).toEqual(['Ship it', 'Plan first', 'Two ways']);
  });

  it('chains every block behind one that comes earlier in the same list', () => {
    for (const template of TEMPLATES) {
      template.blocks.forEach((one, index) => {
        for (const was of one.after) expect(was, template.id).toBeLessThan(index);
      });
    }
  });

  it('starts each one with exactly one block that waits for nothing', () => {
    for (const template of TEMPLATES) {
      expect(template.blocks.filter((one) => one.after.length === 0), template.id).toHaveLength(1);
    }
  });

  it('ships an ask, the checks, a review and the pull request, in that order', () => {
    const ship = TEMPLATES.find((one) => one.id === 'ship-it')!;
    expect(ship.blocks.map((one) => one.kind)).toEqual(['ask', 'checks', 'review', 'pull-request']);
    expect(ship.lanes).toBe('in-turn');
  });

  it('plans first, stops for a yes, then asks and checks', () => {
    const first = TEMPLATES.find((one) => one.id === 'plan-first')!;
    expect(first.blocks.map((one) => one.kind)).toEqual(['plan', 'gate', 'ask', 'checks']);
  });

  it('puts two ways in worktrees, then one ask over what both came to', () => {
    const ways = TEMPLATES.find((one) => one.id === 'two-ways')!;
    expect(ways.lanes).toBe('worktrees');
    const asks = ways.blocks.filter((one) => one.kind === 'ask');
    expect(asks).toHaveLength(3);
    // Two branches off the one plan, and the third after both of them.
    expect(ways.blocks[1]?.after).toEqual([0]);
    expect(ways.blocks[2]?.after).toEqual([0]);
    expect(ways.blocks[3]?.after).toEqual([1, 2]);
    expect(ways.blocks[3]?.says ?? '').not.toBe('');
  });

  it('puts one down as a real chain of real ids, with the names it brought', () => {
    const template = TEMPLATES.find((one) => one.id === 'ship-it')!;
    const flow = placeTemplate(newFlow(), template);
    expect(flow.blocks).toHaveLength(4);
    expect(flow.blocks[0]?.after).toEqual([]);
    expect(flow.blocks[1]?.after).toEqual([flow.blocks[0]?.id]);
    expect(flow.blocks[2]?.after).toEqual([flow.blocks[1]?.id]);
    expect(flow.blocks[3]?.after).toEqual([flow.blocks[2]?.id]);
    expect(new Set(idsOf(flow)).size).toBe(4);
  });

  it('brings the lanes it was drawn for', () => {
    const ways = TEMPLATES.find((one) => one.id === 'two-ways')!;
    expect(placeTemplate(newFlow(), ways).lanes).toBe('worktrees');
    const ship = TEMPLATES.find((one) => one.id === 'ship-it')!;
    expect(placeTemplate(newFlow(), ship).lanes).toBe('in-turn');
  });

  it('names the two branches apart, so what each came to can be told apart', () => {
    const ways = TEMPLATES.find((one) => one.id === 'two-ways')!;
    const flow = placeTemplate(newFlow(), ways);
    expect(flow.blocks.map((one) => one.name)).toEqual(['Plan', 'Way A', 'Way B', 'Compare']);
  });

  it('puts a second one down beside the first rather than over it', () => {
    const ship = TEMPLATES.find((one) => one.id === 'ship-it')!;
    const flow = placeTemplate(placeTemplate(newFlow(), ship), ship);
    expect(flow.blocks).toHaveLength(8);
    expect(new Set(idsOf(flow)).size).toBe(8);
  });

  it('never draws a template that could not run', () => {
    for (const template of TEMPLATES) {
      const flow = placeTemplate(newFlow(), template);
      for (const block of flow.blocks) {
        for (const was of block.after) expect(canWaitFor(flow, block.id, was).ok, template.id).toBe(true);
      }
    }
  });
});

/* ========================================================================== */
/* Starting                                                                   */
/* ========================================================================== */

describe('whether it can start', () => {
  it('will not start with nothing on it, and says so', () => {
    const said = canStart(newFlow());
    expect(said.ok).toBe(false);
    expect(said.ok === false && said.because).toBe(canvasWords.nothingPlaced);
  });

  it('will not start while an ask has not been said what about', () => {
    const flow = drawn('ask');
    const said = canStart(flow);
    expect(said.ok).toBe(false);
    expect(said.ok === false && said.because).toBe(canvasWords.saySomething);
    expect(canStart(change(flow, flow.blocks[0]!.id, { says: 'Tighten the nav' }))).toEqual({ ok: true });
  });

  it('refuses a goal with nothing in it, and a whitespace-only ask', () => {
    expect(canStart(drawn('goal')).ok).toBe(false);
    const flow = drawn('ask');
    expect(canStart(change(flow, flow.blocks[0]!.id, { says: '   ' })).ok).toBe(false);
  });

  it('refuses a ring, however it got there', () => {
    // Drawn joins refuse a ring, so this is one a file or an edit left behind.
    const flow = chained('plan', 'checks', 'review');
    const [look, , review] = idsOf(flow);
    const ringed = change(flow, look!, { after: [review!] });
    const said = canStart(ringed);
    expect(said.ok).toBe(false);
    expect(said.ok === false && said.because).toBe(canvasWords.loop);
  });

  it('refuses a pull request in turn on the default branch, and says why', () => {
    const flow = chained('plan', 'pull-request');
    const said = canStart(flow, 'default-branch');
    expect(said.ok).toBe(false);
    expect(said.ok === false && said.because).toContain('branch');
    expect(said.ok === false && said.because).toContain('worktrees');
    // The same flow is fine off the default branch, and fine in worktrees.
    expect(canStart(flow, 'branch')).toEqual({ ok: true });
    expect(canStart({ ...flow, lanes: 'worktrees' }, 'default-branch')).toEqual({ ok: true });
  });

  it('starts happily on blocks that came with their own words', () => {
    expect(canStart(chained('plan', 'checks', 'review'))).toEqual({ ok: true });
  });

  it('will not start a template until its asks have been said what about', () => {
    for (const template of TEMPLATES) {
      const flow = placeTemplate(newFlow(), template);
      const where = template.lanes === 'worktrees' ? 'default-branch' : 'branch';
      const says = new Set(flow.blocks.filter((one) => one.kind === 'ask' || one.kind === 'goal').map((one) => one.id));
      if (says.size === 0) {
        expect(canStart(flow, where), template.id).toEqual({ ok: true });
        continue;
      }
      const said = canStart(flow, where);
      expect(said.ok, template.id).toBe(false);
      expect(said.ok === false && said.because).toBe(canvasWords.saySomething);
      // And once every one of them has a sentence, it starts.
      const written = flow.blocks.reduce(
        (next, one) => (says.has(one.id) ? change(next, one.id, { says: 'Do the thing.' }) : next),
        flow,
      );
      expect(canStart(written, where), template.id).toEqual({ ok: true });
    }
  });

  it('several starts is a shape, not a mistake', () => {
    const flow = drawn('plan', 'checks');
    expect(canStart(flow)).toEqual({ ok: true });
    expect(flow.blocks.filter((one) => one.after.length === 0)).toHaveLength(2);
  });
});

/* ========================================================================== */
/* Readiness, and lanes                                                       */
/* ========================================================================== */

describe('what may be sent now', () => {
  it('offers nothing at all for a flow nobody has started', () => {
    expect(latestRun(chained('plan', 'review'))).toBeNull();
    expect(nextUp(chained('plan', 'review'))).toBeNull();
  });

  it('offers the block that waits for nothing', () => {
    const flow = chained('plan', 'ask', 'review');
    const run = begun(flow);
    expect(readyNow(flow, run).map((one) => one.id)).toEqual([flow.blocks[0]!.id]);
  });

  it('offers at most one at a time in turn, and the next in run order', () => {
    const { flow, a, b, c, d } = diamond();
    let run = begun(flow);
    expect(readyNow(flow, run).map((one) => one.id)).toEqual([a]);
    run = { ...run, blocks: { ...run.blocks, [a]: held({ state: 'done' }) } };
    // Two branches are up; in turn, only the first of them goes.
    expect(readyNow(flow, run).map((one) => one.id)).toEqual([b]);
    run = { ...run, blocks: { ...run.blocks, [b]: held({ state: 'done' }) } };
    expect(readyNow(flow, run).map((one) => one.id)).toEqual([c]);
    run = { ...run, blocks: { ...run.blocks, [c]: held({ state: 'done' }) } };
    expect(readyNow(flow, run).map((one) => one.id)).toEqual([d]);
    run = { ...run, blocks: { ...run.blocks, [d]: held({ state: 'done' }) } };
    expect(readyNow(flow, run)).toEqual([]);
  });

  it('offers every ready branch at once in worktrees', () => {
    const { flow, a, b, c, d } = diamond();
    const worktrees: Flow = { ...flow, lanes: 'worktrees' };
    let run = begun(worktrees);
    expect(readyNow(worktrees, run).map((one) => one.id)).toEqual([a]);
    run = { ...run, blocks: { ...run.blocks, [a]: held({ state: 'done' }) } };
    expect(readyNow(worktrees, run).map((one) => one.id)).toEqual([b, c]);
    run = { ...run, blocks: { ...run.blocks, [b]: held({ state: 'done' }) } };
    // The other branch is still up on its own.
    expect(readyNow(worktrees, run).map((one) => one.id)).toEqual([c]);
    run = { ...run, blocks: { ...run.blocks, [c]: held({ state: 'done' }) } };
    expect(readyNow(worktrees, run).map((one) => one.id)).toEqual([d]);
  });

  it('never offers what follows a block that did not happen', () => {
    const flow = chained('plan', 'ask', 'review');
    const run = runOf({ [flow.blocks[1]!.id]: held({ state: 'done' }) }, 'running');
    // Only the second is done, which cannot happen — but if it did, the third
    // must not go: it would be working against a change nobody made.
    expect(readyNow(flow, run).map((one) => one.id)).toEqual([flow.blocks[0]!.id]);
  });

  it('never offers one that has had its turn again', () => {
    const flow = chained('plan', 'review');
    const run = runOf({
      [flow.blocks[0]!.id]: held({ state: 'done' }),
      [flow.blocks[1]!.id]: held({ state: 'done' }),
    });
    expect(readyNow(flow, run)).toEqual([]);
  });

  it('holds a failed block’s children back', () => {
    const flow = chained('plan', 'checks', 'review');
    const run = runOf({
      [flow.blocks[0]!.id]: held({ state: 'done' }),
      [flow.blocks[1]!.id]: held({ state: 'failed' }),
      [flow.blocks[2]!.id]: held(),
    });
    expect(readyNow(flow, run)).toEqual([]);
  });

  it('runs each branch, in order, exactly once', () => {
    const { flow } = diamond();
    const order = played(flow);
    expect(order).toHaveLength(4);
    expect(new Set(order).size).toBe(4);
  });

  it('keeps nextUp agreeing with what readyNow offers', () => {
    const { flow, a } = diamond();
    let run = begun(flow);
    expect(nextUp(withRun(flow, run))?.id).toBe(readyNow(flow, run)[0]?.id);
    run = { ...run, blocks: { ...run.blocks, [a]: held({ state: 'done' }) } };
    expect(nextUp(withRun(flow, run))?.id).toBe(readyNow(flow, run)[0]?.id);
  });

  it('never offers two turns in one lane at once, even in worktrees', () => {
    // Two blocks that both start the flow are both in lane-0, which is one
    // folder and one conversation.
    let flow = place(newFlow(), 'plan');
    flow = { ...place(flow, 'checks'), lanes: 'worktrees' };
    const run = begun(flow);
    expect(flow.blocks.map((one) => laneFor(flow, one))).toEqual(['lane-0', 'lane-0']);
    expect(readyNow(flow, run).map((one) => one.id)).toEqual([flow.blocks[0]!.id]);
  });

  it('holds what follows a gate until somebody opens it', () => {
    let flow = place(newFlow(), 'plan');
    const head = flow.blocks[0]!.id;
    flow = place(flow, 'gate', head);
    const gate = flow.blocks[1]!.id;
    flow = place(flow, 'ask', gate);
    const after = flow.blocks[2]!.id;
    let run = begun(flow);
    run = { ...run, blocks: { ...run.blocks, [head]: held({ state: 'done' }) } };
    // The gate is what is up, and once it is waiting for a person it is not
    // offered again: that is `needs-you`, not readiness.
    expect(readyNow(flow, run).map((one) => one.id)).toEqual([gate]);
    run = { ...run, blocks: { ...run.blocks, [gate]: held({ state: 'needs-you' }) } };
    expect(readyNow(flow, run)).toEqual([]);
    expect(nextUp(withRun(flow, run))).toBeNull();
    // Continue opens it, and only then does what follows go.
    run = { ...run, blocks: { ...run.blocks, [gate]: held({ state: 'done' }) } };
    expect(readyNow(flow, run).map((one) => one.id)).toEqual([after]);
  });
});

describe('which lane a block runs in', () => {
  it('puts a block with no parents in the flow’s own lane', () => {
    const flow = drawn('plan', 'checks');
    expect(LANE_0).toBe('lane-0');
    for (const block of flow.blocks) expect(laneFor(flow, block)).toBe(LANE_0);
  });

  it('keeps a chain in one lane, whatever the lanes are set to', () => {
    const chain = chained('plan', 'ask', 'checks', 'review');
    for (const block of chain.blocks) expect(laneFor(chain, block)).toBe('lane-0');
    const worktrees: Flow = { ...chain, lanes: 'worktrees' };
    for (const block of worktrees.blocks) expect(laneFor(worktrees, block)).toBe('lane-0');
  });

  it('gives the second branch a lane of its own in worktrees, and not in turn', () => {
    const { flow, a, b, c } = diamond();
    const worktrees: Flow = { ...flow, lanes: 'worktrees' };
    expect(laneFor(worktrees, worktrees.blocks[0]!)).toBe('lane-0');
    expect(laneFor(worktrees, worktrees.blocks[1]!)).toBe('lane-0');
    expect(laneFor(worktrees, worktrees.blocks[2]!)).toBe('lane-1');
    expect(b).toBe(flow.blocks[1]!.id);
    expect(c).toBe(flow.blocks[2]!.id);
    // In turn, everything is in the one conversation.
    for (const block of flow.blocks) expect(laneFor(flow, block)).toBe('lane-0');
    expect(a).toBe(flow.blocks[0]!.id);
  });

  it('takes a fan-in to its first parent’s lane, not a lane of its own', () => {
    const { flow, d } = diamond();
    const worktrees: Flow = { ...flow, lanes: 'worktrees' };
    expect(laneFor(worktrees, worktrees.blocks[3]!)).toBe('lane-0');
    expect(d).toBe(worktrees.blocks[3]!.id);
  });

  it('keeps a fan in out of a worktree even where it is not its parent’s first child', () => {
    // A → B → X and A → C, then D after B and C. D is B's second child, so
    // without saying so it would look like a second branch off B.
    let flow = place(newFlow(), 'plan');
    const a = flow.blocks[0]!.id;
    flow = place(flow, 'ask', a);
    const b = flow.blocks[1]!.id;
    flow = place(flow, 'checks', b);
    flow = place(flow, 'review', a);
    const c = flow.blocks[3]!.id;
    flow = { ...place(flow, 'review', [b, c]), lanes: 'worktrees' };
    const d = flow.blocks[4]!;
    expect(flow.blocks.map((one) => one.after.length)).toEqual([0, 1, 1, 1, 2]);
    expect(laneFor(flow, d)).toBe(laneFor(flow, flow.blocks[1]!));
    expect(laneFor(flow, flow.blocks[1]!)).toBe('lane-0');
    expect(laneFor(flow, flow.blocks[3]!)).toBe('lane-1');
  });

  it('keeps a whole branch in the branch’s lane', () => {
    const { flow, d } = diamond();
    // A → B → D, and B's lane is the branch's, so D follows it.
    const worktrees: Flow = { ...flow, lanes: 'worktrees' };
    expect(laneFor(worktrees, worktrees.blocks[3]!)).toBe(laneFor(worktrees, worktrees.blocks[1]!));
    expect(d).not.toBe(flow.blocks[2]!.id);
  });

  it('puts the compare block of Two ways on the first branch’s lane', () => {
    const ways = TEMPLATES.find((one) => one.id === 'two-ways')!;
    const flow = placeTemplate(newFlow(), ways);
    const lanes = flow.blocks.map((one) => laneFor(flow, one));
    expect(lanes[0]).toBe('lane-0');
    expect(lanes[1]).toBe('lane-0');
    expect(lanes[2]).toBe('lane-1');
    expect(lanes[3]).toBe('lane-0');
  });

  it('never lands two branches of one flow in the same worktree', () => {
    // A fan out of two, and later a fan out of two more. Both second children
    // are the second child of their parent, so a lane number counted per fork
    // would put both of them in lane-1.
    let flow = place(newFlow(), 'plan');
    const head = flow.blocks[0]!.id;
    flow = place(flow, 'ask', head);
    const one = flow.blocks[1]!.id;
    flow = place(flow, 'ask', head);
    flow = place(flow, 'checks', one);
    const pair = flow.blocks[3]!.id;
    flow = place(flow, 'review', one);
    flow = { ...flow, lanes: 'worktrees' };
    const lanes = new Set(flow.blocks.map((one) => laneFor(flow, one)));
    // lane-0 and two branches, and the review after the checks in the checks's
    // own lane rather than a third.
    expect(lanes).toEqual(new Set(['lane-0', 'lane-1', 'lane-2']));
    expect(laneFor(flow, flow.blocks[2]!)).toBe('lane-1');
    expect(laneFor(flow, flow.blocks[3]!)).toBe('lane-0');
    expect(laneFor(flow, flow.blocks[4]!)).toBe('lane-2');
    expect(pair).toBe(flow.blocks[3]!.id);
  });
});

describe('the order it goes on the board in', () => {
  it('never puts a block before the one it waits for', () => {
    const flow = chained('plan', 'ask', 'checks', 'review');
    const order = runOrder(flow).map((one) => one.id);
    for (const block of flow.blocks) {
      for (const was of block.after) {
        expect(order.indexOf(block.id)).toBeGreaterThan(order.indexOf(was));
      }
    }
  });

  it('holds for a fork as well as a chain', () => {
    const { flow, a } = diamond();
    const order = runOrder(flow).map((one) => one.id);
    expect(order[0]).toBe(a);
    expect(order).toHaveLength(4);
  });

  it('counts a block one past the furthest thing it waits for', () => {
    // A → B → C → E and A → E: E belongs after C, not beside B.
    let flow = place(newFlow(), 'plan');
    const a = flow.blocks[0]!.id;
    flow = place(flow, 'ask', a);
    const b = flow.blocks[1]!.id;
    flow = place(flow, 'checks', b);
    const c = flow.blocks[2]!.id;
    flow = place(flow, 'review', [a, c]);
    const at = columns(flow);
    expect(at.get(flow.blocks[3]!.id)).toBe(3);
    expect(at.get(a)).toBe(0);
  });

  it('does not hang on a ring a hand-edited flow arrived with', () => {
    const flow = chained('plan', 'checks');
    const [a, b] = idsOf(flow);
    const ringed = change(change(flow, a!, { after: [b!] }), b!, { after: [a!] });
    expect(runOrder(ringed)).toHaveLength(2);
  });
});

/* ========================================================================== */
/* What each block is asked                                                   */
/* ========================================================================== */

describe('what each block is asked', () => {
  it('sends what somebody typed, as they typed it, trimmed', () => {
    const flow = drawn('ask', 'review');
    const asked = change(flow, flow.blocks[0]!.id, { says: '  Tighten the nav  ' });
    expect(askOf(asked, begun(asked), asked.blocks[0]!)).toBe('Tighten the nav');
  });

  it('falls back to the kind’s own words rather than sending nothing', () => {
    const flow = drawn('plan');
    const blanked = change(flow, flow.blocks[0]!.id, { says: '   ' });
    expect(askOf(blanked, begun(blanked), blanked.blocks[0]!)).toBe(specOf('plan').says);
  });

  it('asks a goal to work toward the objective', () => {
    const flow = drawn('goal');
    const said = change(flow, flow.blocks[0]!.id, { says: 'every type error gone' });
    const asked = askOf(said, begun(said), said.blocks[0]!);
    expect(asked).toContain('every type error gone');
    expect(asked).toContain('checks');
  });

  it('sends a plan block the sentence its kind brought', () => {
    const flow = drawn('plan');
    expect(askOf(flow, begun(flow), flow.blocks[0]!)).toBe(specOf('plan').says);
    // And what somebody wrote over it is what goes out instead.
    const edited = change(flow, flow.blocks[0]!.id, { says: 'Say what the nav should be.' });
    expect(askOf(edited, begun(edited), edited.blocks[0]!)).toBe('Say what the nav should be.');
  });

  it('carries a parent from another lane in, named for the block it came from', () => {
    const { flow, a, c, d } = diamond();
    const worktrees: Flow = { ...flow, lanes: 'worktrees' };
    const run = runOf({
      [a]: held({ state: 'done', said: 'Two branches, one plan.' }),
      [c]: held({ state: 'done', lane: 'lane-1', said: 'Split them into two files.' }),
    });
    const asked = askOf(worktrees, run, worktrees.blocks[3]!);
    expect(asked).toContain(canvasWords.cameTo('Checks'));
    expect(asked).toContain('Split them into two files.');
    expect(asked).toContain(specOf('review').says);
    expect(d).toBe(worktrees.blocks[3]!.id);
    expect(c).toBe(worktrees.blocks[2]!.id);
  });

  it('adds nothing for a parent already in this lane’s transcript', () => {
    const { flow, a, b } = diamond();
    const run = runOf({
      [a]: held({ state: 'done', said: 'Two branches, one plan.' }),
      [b]: held({ state: 'done', said: 'Done and green.' }),
    });
    // In turn everything is one lane, so both parents are already in it.
    const asked = askOf(flow, run, flow.blocks[3]!);
    expect(asked).toBe(specOf('review').says);
  });

  it('carries only the parents in other lanes, and keeps the first parent’s lane', () => {
    const { flow, b, c } = diamond();
    // D waits for C first and B second, so it runs in C's lane and B's work is
    // the one that is not already in that transcript.
    const swapped = change({ ...flow, lanes: 'worktrees' }, flow.blocks[3]!.id, { after: [c, b] });
    const run = runOf({
      [b]: held({ state: 'done', lane: 'lane-0', said: 'Split them into two files.' }),
      [c]: held({ state: 'done', lane: 'lane-1', said: 'All green.' }),
    });
    const block = swapped.blocks[3]!;
    expect(laneFor(swapped, block)).toBe('lane-1');
    const asked = askOf(swapped, run, block);
    expect(asked).toContain(canvasWords.cameTo('Ask'));
    expect(asked).toContain('Split them into two files.');
    expect(asked).not.toContain('All green.');
    expect(asked.endsWith(specOf('review').says)).toBe(true);
  });

  it('carries in every parent whose work is in another lane', () => {
    // One plan, three branches, then an ask after the second and the third.
    let flow = place(newFlow(), 'plan');
    const head = flow.blocks[0]!.id;
    flow = place(flow, 'ask', head);
    flow = place(flow, 'ask', head);
    flow = place(flow, 'ask', head);
    const second = flow.blocks[2]!.id;
    const third = flow.blocks[3]!.id;
    flow = { ...place(flow, 'ask', [second, third]), lanes: 'worktrees' };
    const last = flow.blocks[4]!;
    // Each later child takes a lane of its own, and the ask runs in the lane of
    // the first of its parents.
    expect(laneFor(flow, flow.blocks[1]!)).toBe('lane-0');
    expect(laneFor(flow, flow.blocks[2]!)).toBe('lane-1');
    expect(laneFor(flow, flow.blocks[3]!)).toBe('lane-2');
    expect(laneFor(flow, last)).toBe('lane-1');
    const run = runOf({
      [second]: held({ state: 'done', lane: 'lane-1', said: 'Two.' }),
      [third]: held({ state: 'done', lane: 'lane-2', said: 'Three.' }),
    });
    const asked = askOf(flow, run, last);
    expect(asked).toContain(canvasWords.cameTo('Ask'));
    expect(asked).toContain('Three.');
    expect(asked).not.toContain('Two.');
  });

  it('says nothing about a parent whose turn has not come', () => {
    const { flow, a, d } = diamond();
    const run = runOf({ [a]: held({ state: 'done' }) });
    expect(askOf(flow, run, flow.blocks[3]!)).toBe(specOf('review').says);
    expect(d).toBe(flow.blocks[3]!.id);
  });

  it('carries the two ways apart into the ask that compares them', () => {
    const ways = TEMPLATES.find((one) => one.id === 'two-ways')!;
    const flow = placeTemplate(newFlow(), ways);
    const order = played(flow);
    // Plan, both branches, then the compare.
    expect(order).toHaveLength(4);
    expect(order[0]).toBe(flow.blocks[0]!.id);
    const run = runOf({
      [flow.blocks[1]!.id]: held({ state: 'done', lane: 'lane-0', said: 'Way A' }),
      [flow.blocks[2]!.id]: held({ state: 'done', lane: 'lane-1', said: 'Way B' }),
    });
    const asked = askOf(flow, run, flow.blocks[3]!);
    expect(asked).toContain(canvasWords.cameTo('Way B'));
    expect(asked).toContain('Way B');
    // The first way is the lane the compare block runs in, so it is not repeated.
    expect(asked).not.toContain(canvasWords.cameTo('Way A'));
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
    const out = layOut(chained('plan', 'ask', 'review'));
    expect(new Set(out.blocks.map((one) => one.y)).size).toBe(1);
    const xs = out.blocks.map((one) => one.x).sort((a, b) => a - b);
    expect(xs).toEqual([0, CARD.width + CARD.gapX, (CARD.width + CARD.gapX) * 2]);
  });

  it('puts blocks that wait for nothing one under another', () => {
    const out = layOut(drawn('plan', 'checks', 'review'));
    expect(new Set(out.blocks.map((one) => one.x)).size).toBe(1);
    expect(new Set(out.blocks.map((one) => one.y)).size).toBe(3);
  });

  it('keeps the first of a fork on its parent’s line and moves the rest down', () => {
    let flow = place(newFlow(), 'plan');
    const head = flow.blocks[0]!.id;
    flow = place(flow, 'ask', head);
    flow = place(flow, 'checks', head);
    const ys = new Map(layOut(flow).blocks.map((one) => [one.id, one.y]));
    expect(ys.get(head)).toBe(0);
    expect(new Set([...ys.values()]).size).toBe(2);
  });

  it('lays every block somewhere of its own', () => {
    const { flow } = diamond();
    const drawn = layOut(flow);
    const spots = new Set(drawn.blocks.map((one) => `${String(one.x)},${String(one.y)}`));
    expect(spots.size).toBe(drawn.blocks.length);
  });

  it('leaves a block where somebody put it', () => {
    const flow = chained('plan', 'ask');
    const moved = change(flow, flow.blocks[1]!.id, { at: { x: 40, y: 300 } });
    const out = layOut(moved);
    expect(out.blocks.find((one) => one.id === flow.blocks[1]!.id)).toMatchObject({ x: 40, y: 300 });
    // And the one nobody moved is still where the arithmetic put it.
    expect(out.blocks.find((one) => one.id === flow.blocks[0]!.id)).toMatchObject({ x: 0, y: 0 });
  });

  it('knows when it has been arranged by hand', () => {
    const flow = chained('plan', 'ask');
    expect(isArranged(flow)).toBe(false);
    expect(isArranged(change(flow, flow.blocks[1]!.id, { at: { x: 999, y: 999 } }))).toBe(true);
    expect(isArranged(change(flow, flow.blocks[1]!.id, { at: tidy(flow)[flow.blocks[1]!.id] }))).toBe(false);
  });

  it('tidying a diamond is the same every time', () => {
    const { flow } = diamond();
    expect(tidy(flow)).toEqual(tidy(flow));
    expect(isArranged(change(flow, flow.blocks[1]!.id, { at: tidy(flow)[flow.blocks[1]!.id] }))).toBe(false);
  });
});

describe('what a line between two blocks is doing', () => {
  it('is idle until the run has left the block it comes from', () => {
    for (const from of ['draft', 'waiting', 'running', 'needs-you', 'failed', 'stopped'] as const) {
      for (const to of ['draft', 'waiting', 'running', 'needs-you', 'done', 'failed', 'stopped'] as const) {
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
});

/* ========================================================================== */
/* States, and the record of a run                                            */
/* ========================================================================== */

describe('where a block has got to', () => {
  it('is a draft until the flow has been started', () => {
    const flow = chained('plan', 'review');
    expect(layOut(flow).blocks.every((one) => one.state === 'draft')).toBe(true);
    expect(stateOf(flow.blocks[0]!, flow)).toBe('draft');
  });

  it('reads the newest run, and says a block nobody has as a draft', () => {
    const flow = chained('plan', 'review');
    const [look, review] = idsOf(flow);
    const run = runOf({
      [look!]: held({ state: 'done' }),
      [review!]: held({ state: 'running' }),
    });
    const started = withRun(flow, run);
    const states = new Map(layOut(started).blocks.map((one) => [one.id, one.state]));
    expect(states.get(look!)).toBe('done');
    expect(states.get(review!)).toBe('running');
    expect(stateOf({ ...flow.blocks[0]!, id: 'nobody' }, started)).toBe('draft');
  });

  it('says a gate needs somebody rather than that it is running', () => {
    const flow = place(newFlow(), 'gate');
    const gate = flow.blocks[0]!;
    expect(stateOf(gate, withRun(flow, runOf({ [gate.id]: held({ state: 'needs-you' }) })))).toBe(
      'needs-you',
    );
  });
});

describe('keeping the runs of a flow', () => {
  it('keeps the newest first', () => {
    const flow = drawn('plan');
    const first = runOf({});
    const second = { ...runOf({}), startedAt: 50 };
    const both = withRun(withRun(flow, first), second);
    expect(both.runs.map((one) => one.startedAt)).toEqual([50, 1]);
    expect(latestRun(both)?.id).toBe(second.id);
  });

  it('replaces the run it is given rather than keeping two of it', () => {
    const flow = drawn('plan');
    const run = begun(flow);
    const once = withRun(flow, run);
    const again = withRun(once, { ...run, state: 'done' });
    expect(again.runs).toHaveLength(1);
    expect(latestRun(again)?.state).toBe('done');
  });

  it('keeps the last ten and no more', () => {
    let flow = drawn('plan');
    for (let n = 0; n < 14; n += 1) flow = withRun(flow, { ...runOf({}), startedAt: n });
    expect(flow.runs).toHaveLength(KEPT_RUNS);
    expect(KEPT_RUNS).toBe(10);
    expect(latestRun(flow)?.startedAt).toBe(13);
    expect(flow.runs[flow.runs.length - 1]?.startedAt).toBe(4);
  });

  it('leaves the drawing alone', () => {
    const flow = chained('plan', 'ask');
    const withIt = withRun(flow, runOf({}));
    expect(withIt.blocks).toEqual(flow.blocks);
    expect(withIt.name).toBe(flow.name);
  });
});

describe('how a run ended', () => {
  it('says nothing while it is still going, or waiting for somebody', () => {
    const flow = drawn('checks');
    expect(endedAs(flow, begun(flow))).toBeNull();
    expect(endedAs(flow, runOf({ [flow.blocks[0]!.id]: held({ state: 'needs-you' }) }, 'needs-you'))).toBeNull();
  });

  it('counts what ran, the turns it took, the cost and the last thing said', () => {
    let flow = place(newFlow(), 'plan');
    const one = flow.blocks[0]!.id;
    flow = place(flow, 'checks', one);
    const two = flow.blocks[1]!.id;
    flow = place(flow, 'pull-request', two);
    const ended = endedAs(
      flow,
      runOf({
        [one]: held({ state: 'done', said: 'Read it.', turns: 4, endedAt: 10 }),
        [two]: held({ state: 'done', said: 'All green.', turns: 3, endedAt: 20 }),
      }),
    );
    expect(ended?.whole).toBe(false);
    expect(ended?.ran).toBe(2);
    expect(ended?.turns).toBe(7);
    expect(ended?.cost).toBeNull();
    expect(ended?.left.map((block) => block.id)).toEqual([flow.blocks[2]!.id]);
    expect(ended?.last?.said).toBe('All green.');
  });

  it('is whole once every block finished, and carries the spend', () => {
    let flow = place(newFlow(), 'plan');
    flow = place(flow, 'checks', flow.blocks[0]!.id);
    const spent = { minor: 120, currency: 'USD' };
    const ended = endedAs(
      flow,
      { ...runOf(Object.fromEntries(flow.blocks.map((one) => [one.id, held({ state: 'done' })]))), spent },
    );
    expect(ended?.whole).toBe(true);
    expect(ended?.left).toEqual([]);
    expect(ended?.turns).toBe(0);
    expect(ended?.last).toBeNull();
    expect(ended?.cost).toBe(spent);
  });

  it('counts a block that was stopped as one that ran, and keeps it out of whole', () => {
    const flow = chained('plan', 'ask');
    const ended = endedAs(
      flow,
      runOf(
        {
          [flow.blocks[0]!.id]: held({ state: 'done', turns: 2 }),
          [flow.blocks[1]!.id]: held({ state: 'stopped', turns: 1 }),
        },
        'stopped',
      ),
    );
    // It had its turn, so it is not a block that never ran.
    expect(ended?.ran).toBe(2);
    expect(ended?.turns).toBe(3);
    expect(ended?.left).toEqual([]);
    expect(ended?.whole).toBe(false);
  });

  it('leaves out of `ran` only the blocks that never had a turn', () => {
    const flow = chained('plan', 'checks', 'review');
    const ended = endedAs(
      flow,
      runOf(
        {
          [flow.blocks[0]!.id]: held({ state: 'done', turns: 2 }),
          [flow.blocks[1]!.id]: held({ state: 'failed', turns: 3, failure: 'two checks fail' }),
        },
        'failed',
      ),
    );
    expect(ended?.ran).toBe(2);
    expect(ended?.turns).toBe(5);
    expect(ended?.left.map((one) => one.id)).toEqual([flow.blocks[2]!.id]);
    expect(ended?.whole).toBe(false);
  });
});

/* ========================================================================== */
/* Undo, and redo                                                             */
/* ========================================================================== */

describe('stepping back through what was drawn', () => {
  it('starts with nothing to step back to', () => {
    const flow = newFlow();
    const history = historyOf(flow);
    expect(history.past).toEqual([]);
    expect(undo(history)).toBe(history);
    expect(redo(history)).toBe(history);
  });

  it('remembers the drawing before the change', () => {
    const flow = drawn('plan');
    const history = undoable(historyOf(flow), place(flow, 'checks'));
    expect(history.past).toEqual([flow]);
    const back = undo(history);
    expect(back.now).toBe(flow);
    expect(redo(back).now.blocks).toHaveLength(2);
  });

  it('leaves the ring alone when the same drawing comes round again', () => {
    const flow = drawn('plan');
    const history = historyOf(flow);
    expect(undoable(history, flow)).toBe(history);
  });

  it('forgets what was ahead once something else is drawn', () => {
    const flow = drawn('plan', 'checks');
    const back = undo(undoable(historyOf(flow), place(flow, 'review')));
    expect(redo(back).now.blocks).toHaveLength(3);
    const changed = undoable(back, change(flow, flow.blocks[0]!.id, { says: 'go' }));
    expect(changed.future).toEqual([]);
    expect(redo(changed)).toBe(changed);
  });

  it('reaches fifty drawings back and no further', () => {
    let flow = drawn('plan');
    let history = historyOf(flow);
    for (let n = 0; n < KEPT_UNDOS + 10; n += 1) {
      flow = place(flow, 'ask');
      history = undoable(history, flow);
    }
    expect(history.past).toHaveLength(KEPT_UNDOS);
    let walked = history;
    let steps = 0;
    while (walked.past.length > 0) {
      walked = undo(walked);
      steps += 1;
    }
    expect(steps).toBe(KEPT_UNDOS);
    // The oldest it can reach is the tenth drawing, not the first.
    expect(walked.now.blocks).toHaveLength(11);
  });

  it('never reaches from one canvas into another', () => {
    const one = drawn('plan');
    const history = undoable(historyOf(one), place(one, 'checks'));
    const other = drawn('ask', 'review');
    const next = undoable(history, other);
    expect(next.past).toEqual([]);
    expect(next.now).toBe(other);
    expect(undo(next)).toBe(next);
  });

  it('walks forward again as many times as it walked back', () => {
    const flow = drawn('plan');
    let history = historyOf(flow);
    for (const kind of ['checks', 'review', 'ask'] as const) history = undoable(history, place(history.now, kind));
    expect(history.now.blocks).toHaveLength(4);
    const back = undo(undo(history));
    expect(back.now.blocks).toHaveLength(2);
    expect(redo(redo(back)).now.blocks).toHaveLength(4);
  });
});

/* ========================================================================== */
/* Reading one back                                                           */
/* ========================================================================== */

describe('reading a flow off the disk', () => {
  it('round-trips one it drew itself', () => {
    const flow = placeTemplate(newFlow(), TEMPLATES[0]!);
    const started = withRun(flow, begun(flow));
    expect(readFlow(JSON.parse(JSON.stringify(started)) as unknown)).toEqual(started);
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

  it('defaults the lanes and the runs an older file never had', () => {
    const flow = readFlow({ id: 'f', blocks: [{ id: 'a', kind: 'plan' }] });
    expect(flow?.lanes).toBe('in-turn');
    expect(flow?.runs).toEqual([]);
    expect(flow?.blocks[0]?.thinking).toBeNull();
    expect(flow?.blocks[0]?.attachments).toEqual([]);
    expect(flow?.blocks[0]?.lookFirst).toBe(false);
  });

  it('reads lanes only when they say worktrees', () => {
    expect(readFlow({ id: 'f', blocks: [], lanes: 'worktrees' })?.lanes).toBe('worktrees');
    expect(readFlow({ id: 'f', blocks: [], lanes: 'sideways' })?.lanes).toBe('in-turn');
    expect(readFlow({ id: 'f', blocks: [], lanes: 7 })?.lanes).toBe('in-turn');
  });

  it('drops a block whose kind nobody has, rather than drawing a card it cannot name', () => {
    expect(readFlow({ id: 'f', blocks: [{ id: 'a', kind: 'interpretive-dance' }] })?.blocks).toEqual([]);
  });

  it('drops a second block claiming an id already taken', () => {
    const flow = readFlow({ id: 'f', blocks: [{ id: 'a', kind: 'ask' }, { id: 'a', kind: 'review' }] });
    expect(flow?.blocks).toHaveLength(1);
    expect(flow?.blocks[0]?.kind).toBe('ask');
  });

  it('takes the kind’s name where the file has none, and the file’s where it has', () => {
    const flow = readFlow({
      id: 'f',
      blocks: [
        { id: 'a', kind: 'checks' },
        { id: 'b', kind: 'checks', name: 'The fast ones' },
        { id: 'c', kind: 'checks', name: '   ' },
      ],
    });
    expect(flow?.blocks.map((one) => one.name)).toEqual(['Checks', 'The fast ones', 'Checks']);
  });

  it('keeps a model only when both halves of it are there, and a level it knows', () => {
    const flow = readFlow({
      id: 'f',
      blocks: [
        { id: 'a', kind: 'ask', model: { providerId: 'anthropic', modelId: 'claude' }, thinking: 'high' },
        { id: 'b', kind: 'ask', model: { providerId: 'anthropic' } },
        { id: 'c', kind: 'ask', model: 'the good one' },
        { id: 'd', kind: 'ask', thinking: 'deeply' },
      ],
    });
    expect(flow?.blocks[0]?.model).toEqual({ providerId: 'anthropic', modelId: 'claude' });
    expect(flow?.blocks[0]?.thinking).toBe('high');
    expect(flow?.blocks[1]?.model).toBeNull();
    expect(flow?.blocks[2]?.model).toBeNull();
    expect(flow?.blocks[3]?.thinking).toBeNull();
  });

  it('lets the file set the tries, and falls back to the kind’s own', () => {
    const flow = readFlow({
      id: 'f',
      blocks: [
        { id: 'a', kind: 'checks' },
        { id: 'b', kind: 'goal' },
        { id: 'c', kind: 'ask' },
        { id: 'd', kind: 'checks', retries: 5 },
        { id: 'e', kind: 'checks', retries: 'lots' },
        { id: 'g', kind: 'checks', retries: -3 },
      ],
    });
    expect(flow?.blocks.map((one) => one.retries)).toEqual([2, 6, 0, 5, 2, 2]);
  });

  it('keeps a place only when it is two numbers', () => {
    const flow = readFlow({
      id: 'f',
      blocks: [
        { id: 'a', kind: 'ask', at: { x: 10, y: 20 } },
        { id: 'b', kind: 'ask', at: { x: '10', y: 20 } },
        { id: 'c', kind: 'ask', at: 'over there' },
      ],
    });
    expect(flow?.blocks[0]?.at).toEqual({ x: 10, y: 20 });
    expect(flow?.blocks[1]?.at).toBeUndefined();
    expect(flow?.blocks[2]?.at).toBeUndefined();
  });

  it('reads a flow written when a block could only wait for one thing', () => {
    const flow = readFlow({
      id: 'f',
      blocks: [
        { id: 'a', kind: 'plan' },
        { id: 'b', kind: 'ask', after: 'a' },
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
        { id: 'b', kind: 'ask', after: ['b', 'gone', 'a', 'a', 7, ''] },
        { id: 'c', kind: 'review', after: {} },
      ],
    });
    expect(flow?.blocks[1]?.after).toEqual(['a']);
    expect(flow?.blocks[2]?.after).toEqual([]);
  });

  it('frees a wait pointing at a block that did not survive the read', () => {
    const flow = readFlow({
      id: 'f',
      blocks: [
        { id: 'a', kind: 'ask', after: 'gone' },
        { id: 'b', kind: 'review', after: 'a' },
      ],
    });
    expect(flow?.blocks[0]?.after).toEqual([]);
    expect(flow?.blocks[1]?.after).toEqual(['a']);
  });

  it('breaks a ring at one edge and keeps every other wait', () => {
    const flow = readFlow({
      id: 'f',
      blocks: [
        { id: 'a', kind: 'plan', after: ['c'] },
        { id: 'b', kind: 'ask', after: ['a'] },
        { id: 'c', kind: 'checks', after: ['b'] },
        { id: 'd', kind: 'review', after: ['a'] },
      ],
    });
    const edges = (flow?.blocks ?? []).flatMap((one) => one.after.map((was) => `${was}->${one.id}`));
    expect(edges).toHaveLength(3);
    expect(edges).toContain('a->d');
    expect(played(flow!)).toHaveLength(4);
  });

  it('comes back at the rung the canvas was set to, and runs on when it is nonsense', () => {
    expect(readFlow({ id: 'f', blocks: [], howFar: 'changing' })?.howFar).toBe('changing');
    expect(readFlow({ id: 'f', blocks: [], howFar: 'whenever' })?.howFar).toBe('doing');
  });

  it('never comes back mid-run: the window that was running it is gone', () => {
    const flow = readFlow({
      id: 'f',
      blocks: [{ id: 'a', kind: 'checks' }, { id: 'b', kind: 'review', after: 'a' }],
      runs: [
        {
          id: 'r1',
          state: 'running',
          startedAt: 5,
          blocks: { a: { state: 'running', lane: 'lane-0', startedAt: 6, turns: 2 } },
        },
      ],
    });
    // What the run says is what the run says; a block nobody has is dropped.
    expect(flow?.runs[0]?.blocks['a']?.state).toBe('running');
    expect(flow?.runs[0]?.blocks['a']?.turns).toBe(2);
    expect(flow?.runs[0]?.blocks['nobody']).toBeUndefined();
  });

  it('keeps the first ten runs it can read, and drops what it cannot', () => {
    const runs = Array.from({ length: 14 }, (_, n) => ({
      id: `r${String(n)}`,
      state: 'done',
      startedAt: n + 1,
      endedAt: n + 1,
      spent: { minor: 10, currency: 'USD' },
      lanes: [{ id: 'lane-0', workspaceId: 'ws-1' }],
      blocks: { a: { state: 'done', lane: 'lane-0', said: 'done', turns: 3 } },
    }));
    const flow = readFlow({
      id: 'f',
      blocks: [{ id: 'a', kind: 'checks' }],
      runs: [
        { id: 'no-when', state: 'done', blocks: {} },
        { id: 'r0', state: 'whenever', startedAt: 1, blocks: {} },
        'not a run',
        ...runs,
      ],
    });
    expect(flow?.runs).toHaveLength(KEPT_RUNS);
    // The file holds them newest first, and what it holds is what is kept.
    expect(flow?.runs[0]?.id).toBe('r0');
    expect(flow?.runs[0]?.spent).toEqual({ minor: 10, currency: 'USD' });
    expect(flow?.runs[0]?.lanes).toEqual([
      { id: 'lane-0', workspaceId: 'ws-1', conversationId: null, branch: null },
    ]);
    expect(flow?.runs[KEPT_RUNS - 1]?.id).toBe('r9');
    // A run the file repeats is not read twice.
    const twice = readFlow({
      id: 'f',
      blocks: [{ id: 'a', kind: 'checks' }],
      runs: [
        { id: 'r1', state: 'done', startedAt: 2, blocks: {} },
        { id: 'r1', state: 'done', startedAt: 2, blocks: {} },
      ],
    });
    expect(twice?.runs).toHaveLength(1);
  });

  it('fills in a run’s missing fields rather than refusing the run', () => {
    const flow = readFlow({
      id: 'f',
      blocks: [{ id: 'a', kind: 'checks' }],
      runs: [{ id: 'r1', state: 'failed', startedAt: 5, blocks: { a: { state: 'failed', failure: 'checks failed' } } }],
    });
    const block = flow?.runs[0]?.blocks['a'];
    expect(flow?.runs[0]?.endedAt).toBeNull();
    expect(flow?.runs[0]?.spent).toBeNull();
    expect(flow?.runs[0]?.lanes).toEqual([]);
    expect(block?.lane).toBe('lane-0');
    expect(block?.said).toBeNull();
    expect(block?.turns).toBe(0);
    expect(block?.rounds).toBe(0);
    expect(block?.failure).toBe('checks failed');
    expect(block?.result).toBeNull();
  });

  it('takes only the runs and blocks it can name, out of any shape at all', () => {
    const flow = readFlow({ id: 'f', blocks: [{ id: 'a', kind: 'checks' }], runs: 'a fine run' });
    expect(flow?.runs).toEqual([]);

    const nobody = readFlow({
      id: 'f',
      blocks: [{ id: 'a', kind: 'checks' }],
      runs: [{ id: 'r1', state: 'done', startedAt: 1, blocks: { gone: { state: 'done' } } }],
    });
    expect(nobody?.runs[0]?.blocks).toEqual({});
  });

  it('reads the ten kinds an old file has, as the seven there are', () => {
    const flow = readFlow({
      id: 'f',
      name: 'Before',
      blocks: [
        { id: 'custom', kind: 'custom', says: 'Tighten the nav.' },
        { id: 'research', kind: 'research', says: 'What does the spec say?' },
        { id: 'subagents', kind: 'subagents', says: 'Every page.' },
        { id: 'browser', kind: 'browser', says: 'The sign-up page.' },
        { id: 'plan', kind: 'plan' },
        { id: 'checks', kind: 'checks' },
        { id: 'goal', kind: 'goal', says: 'No type errors.' },
        { id: 'review', kind: 'review' },
        { id: 'wait', kind: 'wait' },
        { id: 'pr', kind: 'pull-request' },
      ],
    });
    const kinds = new Map((flow?.blocks ?? []).map((one) => [one.id, one.kind]));
    expect(kinds.get('custom')).toBe('ask');
    expect(kinds.get('research')).toBe('ask');
    expect(kinds.get('subagents')).toBe('ask');
    expect(kinds.get('browser')).toBe('ask');
    expect(kinds.get('wait')).toBe('gate');
    expect(kinds.get('plan')).toBe('plan');
    expect(kinds.get('checks')).toBe('checks');
    expect(kinds.get('goal')).toBe('goal');
    expect(kinds.get('review')).toBe('review');
    expect(kinds.get('pr')).toBe('pull-request');
    // The sentence an old one-sentence kind carried is kept, and kept as an ask.
    const said = new Map((flow?.blocks ?? []).map((one) => [one.id, one.says]));
    expect(said.get('research')).toBe('What does the spec say?');
    expect(said.get('browser')).toBe('The sign-up page.');
    expect(said.get('subagents')).toBe('Every page.');
    expect(said.get('custom')).toBe('Tighten the nav.');
    // An old name is not a new one: the kind's own name stands unless the file
    // has a name of its own.
    expect(flow?.blocks[0]?.name).toBe('Ask');
  });

  it('leaves what an old block carried as bytes behind, because bytes are not ids', () => {
    const flow = readFlow({
      id: 'f',
      blocks: [
        {
          id: 'a',
          kind: 'custom',
          pictures: [{ name: 'a.png', mimeType: 'image/png', bytes: 'AAA' }],
          files: [{ name: 'spec.md', mimeType: 'text/markdown', bytes: '# Spec' }],
        },
        { id: 'b', kind: 'custom', attachments: ['content-1', 'content-1', '  ', 7] },
      ],
    });
    expect(flow?.blocks[0]?.attachments).toEqual([]);
    expect(flow?.blocks[1]?.attachments).toEqual(['content-1']);
  });

  it('round-trips the draws a template makes, waits and all', () => {
    const ways = TEMPLATES.find((one) => one.id === 'two-ways')!;
    const flow = placeTemplate(newFlow(), ways);
    const back = readFlows(JSON.parse(JSON.stringify([flow])) as unknown)[0];
    expect(back?.blocks.map((one) => one.after)).toEqual(flow.blocks.map((one) => one.after));
    expect(back?.lanes).toBe('worktrees');
    expect(back?.blocks.map((one) => one.name)).toEqual(flow.blocks.map((one) => one.name));
  });

  it('keeps something true where the file’s numbers are missing', () => {
    const flow = readFlow({ id: 'f', blocks: [] });
    expect(flow?.createdAt).toBe(0);
    expect(flow?.updatedAt).toBe(0);
    expect(readFlow({ id: 'f', blocks: [], createdAt: 900 })?.createdAt).toBe(900);
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

  it('adds one nobody had on the end, and takes one out', () => {
    const flows = readFlows([{ id: 'a', blocks: [] }]);
    expect(withFlow(flows, newFlow()).map((one) => one.id)[0]).toBe('a');
    expect(withFlow(flows, newFlow())).toHaveLength(2);
    const three = readFlows([{ id: 'a', blocks: [] }, { id: 'b', blocks: [] }, { id: 'c', blocks: [] }]);
    expect(withoutFlow(three, 'b').map((one) => one.id)).toEqual(['a', 'c']);
    expect(withoutFlow(three, 'nowhere')).toHaveLength(3);
  });
});

/* ========================================================================== */
/* Words                                                                      */
/* ========================================================================== */

describe('what the canvas says', () => {
  it('has one word for every state a block can be in', () => {
    const states = ['draft', 'waiting', 'running', 'needs-you', 'done', 'failed', 'stopped'] as const;
    for (const state of states) expect(canvasWords.states[state], state).not.toBe('');
    expect(new Set(Object.values(canvasWords.states)).size).toBe(7);
  });

  it('says the states in the words settled on', () => {
    expect(canvasWords.states).toEqual({
      draft: 'Ready',
      waiting: 'Waiting',
      running: 'Running',
      'needs-you': 'Needs you',
      done: 'Done',
      failed: 'Failed',
      stopped: 'Stopped',
    });
  });

  it('names every operation in one word, the way a button wants it', () => {
    expect(canvasWords.start).toBe('Start');
    expect(canvasWords.stop).toBe('Stop');
    expect(canvasWords.continue).toBe('Continue');
    expect(canvasWords.open).toBe('Open');
    expect(canvasWords.watch).toBe('Watch');
    expect(canvasWords.delete).toBe('Delete');
    expect(canvasWords.duplicate).toBe('Duplicate');
    expect(canvasWords.tidy).toBe('Tidy');
    expect(canvasWords.fit).toBe('Fit');
    for (const word of [
      canvasWords.start,
      canvasWords.stop,
      canvasWords.continue,
      canvasWords.open,
      canvasWords.watch,
      canvasWords.delete,
      canvasWords.duplicate,
      canvasWords.tidy,
      canvasWords.fit,
    ]) {
      expect(word.split(' '), word).toHaveLength(1);
    }
  });

  it('counts what is on it without claiming a run that has not happened', () => {
    expect(canvasWords.counted(0, 0, 0)).toBe('Nothing placed yet.');
    expect(canvasWords.counted(1, 0, 0)).toBe('1 block · not started');
    expect(canvasWords.counted(4, 2, 0)).toBe('4 blocks · 2 done');
    expect(canvasWords.counted(4, 1, 2)).toBe('4 blocks · 1 done, 2 running');
    expect(canvasWords.counted(2, 2, 0)).toBe('2 blocks · 2 done');
  });

  it('says what a carried parent came to, and names the block it came from', () => {
    expect(canvasWords.cameTo('Way B')).toBe('What Way B came to:');
  });

  it('names a canvas from the first thing it was asked to do', () => {
    expect(canvasWords.named([])).toBe(canvasWords.untitled);
    expect(canvasWords.named(drawn('ask').blocks)).toBe(canvasWords.untitled);
    expect(canvasWords.named(place(newFlow(), 'checks').blocks)).toMatch(/^Run this project/);
    const long = canvasWords.named([
      { ...place(newFlow(), 'ask').blocks[0]!, says: 'a'.repeat(60) } as Block,
    ]);
    expect(long.length).toBeLessThanOrEqual(28);
    expect(long.endsWith('…')).toBe(true);
  });
});
