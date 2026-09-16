/** Running a flow, against a port that does nothing.
 *
 * The claim this file exists for: what the machine sends, in what order, and what
 * a run looks like when it is over, is decided without Pi, a disk or a clock. The
 * port below records everything it was asked and answers what the test told it
 * to, so every row of the machine's table is a case here.
 *
 * Source text, not behaviour: the two claims at the end — that the runner never
 * removes a worktree, and that it reaches nothing outside its port — no
 * behavioural test can reach, because both are about what is absent from a file.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { newRunId } from '../src/domain/identity';
import {
  change,
  checksFix,
  newFlow,
  place,
  type Block,
  type BlockKind,
  type BlockRun,
  type Flow,
  type Lane,
  type Run,
} from '../src/work/canvas';
import {
  continued,
  drive,
  NEVER_RAN,
  resumed,
  runnerWords,
  stopped,
  tick,
  waitingForRoom,
  WAITING_FOR_ROOM,
  type RunnerPort,
  type Settled,
  type TurnOptions,
} from '../electron/services/flow-runner';

const source = readFileSync(
  fileURLToPath(new URL('../electron/services/flow-runner.ts', import.meta.url)),
  'utf8',
);

/* ------------------------------------------------------------ scaffolding */

/** A chain: each block behind the one before it. `place` gives each block the
 *  retries its kind is worth, which is what the machine reads. */
function chained(...kinds: readonly BlockKind[]): Flow {
  let flow: Flow = { ...newFlow(), name: 'Ship it' };
  let last: string | null = null;
  for (const kind of kinds) {
    flow = place(flow, kind, last);
    last = flow.blocks[flow.blocks.length - 1]?.id ?? null;
  }
  return flow;
}

function lane(id: string, conversationId: string | null = 'c-0', branch: string | null = null): Lane {
  return { id, workspaceId: `ws-${id}`, conversationId, branch };
}

/** A run that has just begun: every block of the flow, not started, in the lane
 *  the flow's own conversation is. */
function begun(flow: Flow, lanes: readonly Lane[] = [lane('lane-0')]): Run {
  const blocks: Record<string, BlockRun> = {};
  for (const block of flow.blocks) {
    blocks[block.id] = {
      state: 'draft',
      lane: 'lane-0',
      startedAt: null,
      endedAt: null,
      said: null,
      turns: 0,
      spent: null,
      rounds: 0,
      result: null,
      failure: null,
    };
  }
  return { id: newRunId(), state: 'running', startedAt: 1, endedAt: null, lanes, blocks, spent: null };
}

/** One plan with two branches after it, and nothing joining them yet: the shape
 *  a fan-out is drawn in. Returns the flow with each block told what to say, so
 *  a turn that went out can be told from a turn that did not. */
function forked(lanes: Flow['lanes']): Flow {
  let flow = place({ ...newFlow(), name: 'Two ways' }, 'plan');
  const head = flow.blocks[0]!.id;
  flow = place(flow, 'ask', head);
  flow = place(flow, 'ask', head);
  flow = change(flow, head, { says: 'Look first' });
  flow = change(flow, flow.blocks[1]!.id, { name: 'Way A', says: 'Way A do it' });
  flow = change(flow, flow.blocks[2]!.id, { name: 'Way B', says: 'Way B do it' });
  return { ...flow, lanes };
}

/** One thing the port was asked, in the order it was asked. */
type Asked =
  | { what: 'openLane'; lane: string }
  | { what: 'send'; lane: string; block: string; text: string; options: TurnOptions }
  | { what: 'checks'; lane: string }
  | { what: 'review'; lane: string }
  | { what: 'pullRequest'; lane: string }
  | { what: 'stop'; lane: string };

/** A port that answers from a queue and writes down everything it was asked.
 *
 * This is the whole of what the machine may touch, which is why the one fake
 * here carries every case in the file. Past the end of a queue a kind answers
 * cleanly: a test that says nothing about the checks is not a test about them. */
class FakePort implements RunnerPort {
  asked: Asked[] = [];
  /** Every run pushed at the shell, newest last. Where Stop reads the live one
   *  from, since the shell's copy is the one that has it. */
  pushed: Run[] = [];
  says = new Map<string, Settled>();
  checksBack: { passed: boolean; report: string }[] = [];
  verdicts: { verdict: 'ships' | 'needs-work' | 'do-not-land'; line: string }[] = [];
  pulls: ({ url: string } | { failure: string })[] = [];
  /** The one lane whose worktree cannot be opened, for the test about a lane
   *  failing before its turn. */
  refuseLane: string | null = null;
  /** Set by a test that needs a turn to stay out, so Stop can be pressed while
   *  one is. */
  hold: Promise<void> | null = null;
  /** Called with every send, so a test can watch the order its own way. */
  onSend: ((block: Block) => void) | null = null;
  at = 1000;

  #firstTurn: () => void = () => undefined;
  /** Resolved by the first turn, whichever lane it went out on. */
  readonly turning: Promise<void> = new Promise<void>((resolve) => {
    this.#firstTurn = resolve;
  });

  sends(): readonly string[] {
    return this.asked.flatMap((one) => (one.what === 'send' ? [one.text] : []));
  }

  /** Every turn, with the lane it went out on. */
  turns(): readonly { lane: string; text: string; options: TurnOptions }[] {
    return this.asked.flatMap((one) =>
      one.what === 'send' ? [{ lane: one.lane, text: one.text, options: one.options }] : [],
    );
  }

  lanesOpened(): readonly string[] {
    return this.asked.flatMap((one) => (one.what === 'openLane' ? [one.lane] : []));
  }

  count(what: Asked['what']): number {
    return this.asked.filter((one) => one.what === what).length;
  }

  /** The last run pushed with this state, which is the one a press acts on. */
  live(state: Run['state'] = 'running'): Run {
    const found = [...this.pushed].reverse().find((one) => one.state === state);
    if (found === undefined) throw new Error(`no ${state} run was pushed`);
    return found;
  }

  async openLane(one: Lane): Promise<Lane> {
    if (this.refuseLane === one.id) throw new Error('no room on this disk');
    this.asked.push({ what: 'openLane', lane: one.id });
    // A worktree lane comes back with a branch on it, which is what Review reads
    // and what the card names.
    return one.id === 'lane-0'
      ? { ...one, conversationId: `c-${one.id}` }
      : { ...one, conversationId: `c-${one.id}`, branch: `flow/${one.id}` };
  }

  async send(one: Lane, block: Block, text: string, options: TurnOptions): Promise<Settled> {
    this.asked.push({ what: 'send', lane: one.id, block: block.id, text, options });
    this.#firstTurn();
    this.onSend?.(block);
    if (this.hold !== null) await this.hold;
    return this.says.get(block.id) ?? { ok: true, said: `${block.name} said so`, turns: 1, spent: null };
  }

  async checks(one: Lane): Promise<{ passed: boolean; report: string }> {
    this.asked.push({ what: 'checks', lane: one.id });
    return this.checksBack.shift() ?? { passed: true, report: '' };
  }

  async review(one: Lane): Promise<{ verdict: 'ships' | 'needs-work' | 'do-not-land'; line: string }> {
    this.asked.push({ what: 'review', lane: one.id });
    return this.verdicts.shift() ?? { verdict: 'ships', line: 'Good.' };
  }

  async pullRequest(one: Lane): Promise<{ url: string } | { failure: string }> {
    this.asked.push({ what: 'pullRequest', lane: one.id });
    return this.pulls.shift() ?? { url: 'https://example.test/pull/1' };
  }

  async stop(one: Lane): Promise<void> {
    this.asked.push({ what: 'stop', lane: one.id });
  }

  changed(run: Run): void {
    this.pushed.push(run);
  }

  now(): number {
    this.at += 10;
    return this.at;
  }
}

/* ========================================================================== */
/* One row of the table at a time                                              */
/* ========================================================================== */

describe('a chain of two asks', () => {
  it('runs them in order, and the second sees nothing prefixed', async () => {
    const flow = chained('ask', 'ask');
    const [first, second] = flow.blocks;
    const told = change(change(flow, first!.id, { says: 'Tighten the nav' }), second!.id, {
      says: 'Now the footer',
    });
    const port = new FakePort();

    const run = await drive(told, begun(told), port);

    expect(run.state).toBe('done');
    expect(port.sends()).toEqual(['Tighten the nav', 'Now the footer']);
    // Both in one lane, so what the first said is already the conversation the
    // second is sent into and is not said again above it.
    expect(port.sends()[1]).not.toContain('came to');
    expect(run.blocks[second!.id]?.state).toBe('done');
    expect(run.blocks[second!.id]?.turns).toBe(1);
  });

  it('opens the flow’s own lane once, and every turn goes into it', async () => {
    const flow = chained('ask', 'checks');
    const port = new FakePort();

    const run = await drive(flow, begun(flow, [lane('lane-0', null)]), port);

    expect(run.state).toBe('done');
    expect(port.lanesOpened()).toEqual(['lane-0']);
    expect(new Set(port.turns().map((one) => one.lane))).toEqual(new Set(['lane-0']));
  });

  it('gives a plan block lookFirst, whatever the block itself was left on', async () => {
    const flow = chained('plan');
    const port = new FakePort();

    await drive(flow, begun(flow), port);

    expect(port.turns()[0]?.options.lookFirst).toBe(true);
    expect(port.turns()[0]?.options.howFar).toBe(flow.howFar);
  });

  it('adds what every turn cost to the run’s own', async () => {
    const flow = chained('ask', 'ask');
    const [first, second] = flow.blocks;
    const port = new FakePort();
    port.says.set(first!.id, { ok: true, said: 'done', turns: 2, spent: { minor: 120, currency: 'USD' } });
    port.says.set(second!.id, { ok: true, said: 'done', turns: 1, spent: { minor: 80, currency: 'USD' } });

    const run = await drive(flow, begun(flow), port);

    expect(run.spent).toEqual({ minor: 200, currency: 'USD' });
    expect(run.blocks[first!.id]?.turns).toBe(2);
  });
});

describe('an ask and a goal', () => {
  it('runs an ask as one turn', async () => {
    const flow = chained('ask');
    const port = new FakePort();
    port.says.set(flow.blocks[0]!.id, { ok: true, said: 'All done', turns: 3, spent: null });

    const run = await drive(flow, begun(flow), port);

    expect(port.count('send')).toBe(1);
    expect(run.blocks[flow.blocks[0]!.id]?.said).toBe('All done');
    expect(run.blocks[flow.blocks[0]!.id]?.turns).toBe(3);
  });

  it('sends a goal a turn, runs the checks, and fixes what failed until they pass', async () => {
    const flow = chained('goal');
    const block = flow.blocks[0]!;
    const port = new FakePort();
    port.checksBack = [
      { passed: false, report: 'not green yet' },
      { passed: true, report: '' },
    ];

    const run = await drive(flow, begun(flow), port);

    expect(run.state).toBe('done');
    expect(port.count('send')).toBe(2);
    expect(port.sends()[1]).toBe(checksFix('not green yet'));
    expect(run.blocks[block.id]?.rounds).toBe(1);
  });

  it('fails a goal whose checks never pass, with the last report as the reason', async () => {
    const flow = chained('goal');
    const block = flow.blocks[0]!;
    const port = new FakePort();
    // Six rounds is what a goal is given, so seven checks without a pass.
    port.checksBack = Array.from({ length: 7 }, () => ({ passed: false, report: 'still red' }));

    const run = await drive(flow, begun(flow), port);

    expect(run.state).toBe('failed');
    expect(port.count('send')).toBe(7);
    expect(run.blocks[block.id]?.rounds).toBe(6);
    expect(run.blocks[block.id]?.failure).toBe('still red');
  });
});

describe('checks', () => {
  it('passes without sending anything', async () => {
    const flow = chained('checks');
    const block = flow.blocks[0]!;
    const port = new FakePort();

    const run = await drive(flow, begun(flow), port);

    expect(run.state).toBe('done');
    expect(port.count('send')).toBe(0);
    expect(port.count('checks')).toBe(1);
    expect(run.blocks[block.id]?.rounds).toBe(0);
  });

  it('sends a fix turn for each failure, then fails once the rounds run out', async () => {
    const flow = chained('checks');
    const block = flow.blocks[0]!;
    const port = new FakePort();
    // Two rounds is what a checks block is placed with, so three check runs.
    port.checksBack = [
      { passed: false, report: 'two type errors' },
      { passed: false, report: 'one type error' },
      { passed: false, report: 'still one' },
    ];

    const run = await drive(flow, begun(flow), port);

    expect(run.state).toBe('failed');
    expect(port.count('send')).toBe(2);
    expect(port.sends()).toEqual([checksFix('two type errors'), checksFix('one type error')]);
    expect(port.count('checks')).toBe(3);
    expect(run.blocks[block.id]?.rounds).toBe(2);
    expect(run.blocks[block.id]?.failure).toBe('still one');
  });
});

describe('a review', () => {
  it('is done on ships, and keeps the verdict as what it came to', async () => {
    const flow = chained('ask', 'review');
    const port = new FakePort();
    port.verdicts = [{ verdict: 'ships', line: 'Good to land.' }];

    const run = await drive(flow, begun(flow), port);

    expect(run.state).toBe('done');
    expect(run.blocks[flow.blocks[1]!.id]?.result).toBe('Good to land.');
    expect(port.count('send')).toBe(1);
  });

  it('is failed on do-not-land, with the verdict as the reason', async () => {
    const flow = chained('ask', 'review');
    const port = new FakePort();
    port.verdicts = [{ verdict: 'do-not-land', line: 'This breaks the export.' }];

    const run = await drive(flow, begun(flow), port);

    expect(run.state).toBe('failed');
    expect(run.blocks[flow.blocks[1]!.id]?.failure).toBe('This breaks the export.');
    // A verdict that says not to land is not a verdict to argue with.
    expect(port.count('review')).toBe(1);
  });

  it('is failed on needs-work with no retry left', async () => {
    const flow = chained('ask', 'review');
    const port = new FakePort();
    port.verdicts = [{ verdict: 'needs-work', line: 'Two things to fix.' }];

    const run = await drive(flow, begun(flow), port);

    expect(run.state).toBe('failed');
    expect(port.count('send')).toBe(1);
    expect(run.blocks[flow.blocks[1]!.id]?.failure).toBe('Two things to fix.');
  });

  it('sends one fix turn and reviews once more when a retry is left', async () => {
    const given = chained('ask', 'review');
    const block = given.blocks[1]!;
    // One retry, which is what the panel writes for a review that may ask once.
    const flow = change(given, block.id, { retries: 1 });
    const port = new FakePort();
    port.verdicts = [
      { verdict: 'needs-work', line: 'Two things to fix.' },
      { verdict: 'ships', line: 'Both fixed.' },
    ];

    const done = await drive(flow, begun(flow), port);

    expect(done.state).toBe('done');
    expect(port.count('review')).toBe(2);
    expect(port.sends()[1]).toBe(runnerWords.reviewing('Two things to fix.'));
    expect(done.blocks[block.id]?.result).toBe('Both fixed.');
    expect(done.blocks[block.id]?.rounds).toBe(1);
  });

  it('fails a second bad verdict rather than going round a third time', async () => {
    const given = chained('ask', 'review');
    const block = given.blocks[1]!;
    const flow = change(given, block.id, { retries: 1 });
    const port = new FakePort();
    port.verdicts = [
      { verdict: 'needs-work', line: 'Two things to fix.' },
      { verdict: 'needs-work', line: 'One thing left.' },
    ];

    const done = await drive(flow, begun(flow), port);

    expect(done.state).toBe('failed');
    expect(port.count('review')).toBe(2);
    expect(done.blocks[block.id]?.failure).toBe('One thing left.');
  });
});

describe('a pull request', () => {
  it('is done on a url', async () => {
    const flow = chained('pull-request');
    const port = new FakePort();
    port.pulls = [{ url: 'https://example.test/pull/7' }];

    const run = await drive(flow, begun(flow), port);

    expect(run.state).toBe('done');
    expect(run.blocks[flow.blocks[0]!.id]?.result).toBe('https://example.test/pull/7');
    expect(port.count('pullRequest')).toBe(1);
  });

  it('is failed with the reason when there is no url', async () => {
    const flow = chained('pull-request');
    const port = new FakePort();
    port.pulls = [{ failure: 'gh is not signed in' }];

    const run = await drive(flow, begun(flow), port);

    expect(run.state).toBe('failed');
    expect(run.blocks[flow.blocks[0]!.id]?.failure).toBe('gh is not signed in');
  });
});

describe('a gate', () => {
  it('sends nothing and holds the run until somebody continues it', async () => {
    const flow = chained('ask', 'gate', 'ask');
    const gate = flow.blocks[1]!.id;
    const port = new FakePort();

    const run = await drive(flow, begun(flow), port);

    expect(run.state).toBe('needs-you');
    expect(run.blocks[gate]?.state).toBe('needs-you');
    // The ask before it has gone, and the one behind it has not.
    expect(port.count('send')).toBe(1);

    const carried = continued(flow, run, port, gate);
    expect(carried.state).toBe('running');
    expect(carried.blocks[gate]?.state).toBe('done');

    const finished = await drive(flow, carried, port);
    expect(finished.state).toBe('done');
    expect(port.count('send')).toBe(2);
  });

  it('is left exactly as it was when the block named is not the gate holding it', () => {
    const flow = chained('ask', 'gate', 'ask');
    const port = new FakePort();
    const held: Run = { ...begun(flow), state: 'needs-you' };

    expect(continued(flow, held, port, flow.blocks[0]!.id)).toBe(held);
    expect(port.pushed).toEqual([]);
  });
});

/* ========================================================================== */
/* Waves: fan-out, the ceiling, failing, stopping, resuming                    */
/* ========================================================================== */

describe('a fan-out in turn', () => {
  it('runs the branches one after another in the flow’s own lane', async () => {
    const forked0 = forked('in-turn');
    const flow = place(forked0, 'ask', [forked0.blocks[1]!.id, forked0.blocks[2]!.id]);
    const port = new FakePort();

    const run = await drive(flow, begun(flow), port);

    expect(run.state).toBe('done');
    expect(new Set(port.turns().map((one) => one.lane))).toEqual(new Set(['lane-0']));
    expect(port.count('send')).toBe(4);
  });

  it('never sends a fan-in before both of the branches it waits for', async () => {
    // The fan-in is placed waiting for the second branch first, so a machine
    // that went by the order of the waits rather than by what has finished
    // would send it early.
    const forked0 = forked('in-turn');
    const flow = place(forked0, 'ask', [forked0.blocks[2]!.id, forked0.blocks[1]!.id]);
    const [head, a, b, fanIn] = flow.blocks;
    const order: string[] = [];
    const port = new FakePort();
    port.onSend = (block) => order.push(block.id);
    port.says.set(fanIn!.id, { ok: true, said: 'Both came to something', turns: 1, spent: null });

    const run = await drive(flow, begun(flow), port);

    expect(run.state).toBe('done');
    expect(order).toEqual([head!.id, a!.id, b!.id, fanIn!.id]);
  });
});

describe('a fan-out with worktrees', () => {
  it('opens a lane per branch, and the fan-in carries the one that is not its own', async () => {
    const forked0 = forked('worktrees');
    const placed = place(forked0, 'ask', [forked0.blocks[1]!.id, forked0.blocks[2]!.id]);
    const flow = change(placed, placed.blocks[3]!.id, { name: 'Compare', says: 'Which way' });
    const [head, a, b, fanIn] = flow.blocks;
    const port = new FakePort();

    const run = await drive(flow, begun(flow), port);

    expect(run.state).toBe('done');
    // Two lanes: the flow's own and one worktree for the branch that needed one.
    expect(run.lanes.map((one) => one.id).sort()).toEqual(['lane-0', 'lane-1']);
    expect(run.lanes.find((one) => one.id === 'lane-1')?.branch).toBe('flow/lane-1');
    // The plan and the first branch run in the flow's own folder; the second
    // branch is the one worktree, opened once.
    expect(port.lanesOpened()).toEqual(['lane-1']);
    expect(run.blocks[a!.id]?.lane).toBe('lane-0');
    expect(run.blocks[b!.id]?.lane).toBe('lane-1');
    // The fan-in takes its first parent's lane rather than a third worktree.
    expect(run.blocks[fanIn!.id]?.lane).toBe('lane-0');
    expect(port.turns().find((one) => one.text.includes('Which way'))?.lane).toBe('lane-0');
    // Both branches ran and both came to something, and both reach the fan-in:
    // Way A's turn is already in that lane's conversation, and Way B's work is
    // the one carried in above the sentence.
    expect(run.blocks[a!.id]?.said).toBe(`${a!.name} said so`);
    expect(run.blocks[b!.id]?.said).toBe(`${b!.name} said so`);
    const last = port.sends()[port.sends().length - 1] ?? '';
    expect(last).toContain(`${b!.name} said so`);
    expect(last).not.toContain(`${a!.name} said so`);
    expect(head!.id).toBe(flow.blocks[0]!.id);
  });

  it('carries every parent that is in another lane, each under its own name', async () => {
    // One plan, three branches, then an ask waiting for the second and third.
    // It runs in the second's lane, so the third's work is the one carried in.
    const base = forked('worktrees');
    const [head, a, b] = base.blocks;
    const withC = place(base, 'ask', head!.id);
    const named = change(withC, withC.blocks[3]!.id, { name: 'Way C', says: 'Way C do it' });
    const c = named.blocks[3]!;
    const placed = place(named, 'ask', [b!.id, c.id]);
    const fanIn = placed.blocks[4]!;
    const flow = change(placed, fanIn.id, { name: 'Compare', says: 'Which way' });
    const port = new FakePort();
    port.says.set(b!.id, { ok: true, said: 'B came to one file', turns: 1, spent: null });
    port.says.set(c!.id, { ok: true, said: 'C came to two files', turns: 1, spent: null });

    const run = await drive(flow, begun(flow), port);

    expect(run.state).toBe('done');
    // B's lane is the fan-in's own, so only C's work is carried in.
    expect(run.blocks[fanIn!.id]?.lane).toBe(run.blocks[b!.id]?.lane);
    const last = port.sends()[port.sends().length - 1] ?? '';
    expect(last).toContain(`What ${c!.name} came to:`);
    expect(last).toContain('C came to two files');
    expect(last).not.toContain('B came to one file');
    expect(last.endsWith('Which way')).toBe(true);
    expect(a!.id).toBe(flow.blocks[1]!.id);
  });

  it('holds a branch past the board’s ceiling, and says so on its card', async () => {
    const flow = forked('worktrees');
    const port = new FakePort();

    // No room at all: the branch that needs a worktree may not open one.
    const held = await drive(flow, begun(flow), port, 0);

    expect(held.state).toBe('running');
    expect(waitingForRoom(held)).toBe(true);
    expect(port.lanesOpened()).toEqual([]);
    const waiting = Object.values(held.blocks).filter((one) => one.result === WAITING_FOR_ROOM);
    expect(waiting.length).toBeGreaterThan(0);
    expect(waiting.every((one) => one.state === 'waiting')).toBe(true);
    // The branch that runs in the flow's own lane needs no worktree, so the
    // ceiling does not hold it back.
    expect(held.blocks[flow.blocks[1]!.id]?.result).not.toBe(WAITING_FOR_ROOM);
  });

  it('takes the branch up once there is room, and forgets it was ever held', async () => {
    const flow = forked('worktrees');
    const port = new FakePort();
    const held = await drive(flow, begun(flow), port, 0);

    const run = await drive(flow, held, port, 4);

    expect(run.state).toBe('done');
    expect(port.lanesOpened()).toEqual(['lane-1']);
    expect(Object.values(run.blocks).every((one) => one.result !== WAITING_FOR_ROOM)).toBe(true);
  });

  it('waits rather than opening a second worktree over the ceiling', async () => {
    // Three branches: the third has nowhere to go with room for two.
    let flow = place({ ...newFlow(), name: 'Three' }, 'plan');
    const head = flow.blocks[0]!.id;
    flow = place(flow, 'ask', head);
    flow = place(flow, 'ask', head);
    flow = place(flow, 'ask', head);
    flow = { ...flow, lanes: 'worktrees' };
    const port = new FakePort();

    const run = await drive(flow, begun(flow), port, 1);

    // One worktree lane may open, so one branch waits for ever rather than two
    // runs sharing a folder.
    expect(port.lanesOpened()).toEqual(['lane-1']);
    expect(run.state).toBe('running');
    expect(waitingForRoom(run)).toBe(true);
    expect(run.blocks[flow.blocks[3]!.id]?.result).toBe(WAITING_FOR_ROOM);
  });
});

describe('an error', () => {
  it('fails the run and stops everything behind it as never ran', async () => {
    const flow = chained('ask', 'ask', 'ask');
    const [first, second, third] = flow.blocks;
    const port = new FakePort();
    port.says.set(first!.id, { ok: false, failure: 'the model refused' });

    const run = await drive(flow, begun(flow), port);

    expect(run.state).toBe('failed');
    expect(run.blocks[first!.id]?.state).toBe('failed');
    expect(run.blocks[first!.id]?.failure).toBe('the model refused');
    expect(run.blocks[second!.id]?.state).toBe('stopped');
    expect(run.blocks[second!.id]?.failure).toBe(NEVER_RAN);
    expect(run.blocks[third!.id]?.failure).toBe(NEVER_RAN);
    expect(port.count('send')).toBe(1);
  });

  it('keeps what finished before the failure', async () => {
    const flow = chained('ask', 'ask');
    const [first, second] = flow.blocks;
    const port = new FakePort();
    port.says.set(second!.id, { ok: false, failure: 'the turn died' });

    const run = await drive(flow, begun(flow), port);

    expect(run.blocks[first!.id]?.state).toBe('done');
    expect(run.blocks[first!.id]?.said).toBe('Ask said so');
    expect(run.blocks[second!.id]?.state).toBe('failed');
  });

  it('fails the run when a worktree lane cannot be opened, and stops the other lane', async () => {
    const flow = forked('worktrees');
    const port = new FakePort();
    port.refuseLane = 'lane-1';

    const run = await drive(flow, begun(flow), port);

    expect(run.state).toBe('failed');
    expect(run.blocks[flow.blocks[2]!.id]?.failure).toContain('no room on this disk');
    // Nothing is left claimed as running once the run is over.
    expect(Object.values(run.blocks).some((one) => one.state === 'running')).toBe(false);
  });
});

describe('Stop', () => {
  it('stops the running lane, marks the block mid-turn, and leaves the rest to run', async () => {
    const flow = chained('ask', 'ask');
    const [first, second] = flow.blocks;
    const port = new FakePort();
    let release: () => void = () => undefined;
    port.hold = new Promise<void>((resolve) => {
      release = resolve;
    });

    const going = drive(flow, begun(flow), port);
    await port.turning;
    // The press, made while the first turn is out. The run the shell holds is the
    // one that says a block is running.
    const pressed = await stopped(flow, port.live(), port);
    release();
    const after = await going;

    expect(pressed.state).toBe('stopped');
    expect(port.count('stop')).toBe(1);
    expect(pressed.blocks[first!.id]?.state).toBe('stopped');
    // A block nobody had started is not a block that never ran: it is still
    // there to be run.
    expect(pressed.blocks[second!.id]?.state).toBe('draft');
    // The wave that was out when Stop was pressed does not overwrite the stop
    // with its half-finished turn.
    expect(after.state).toBe('stopped');
    expect(after.blocks[first!.id]?.state).toBe('stopped');
    expect(port.count('send')).toBe(1);
  });

  it('stops a run holding at a gate, and the gate with it', async () => {
    const flow = chained('ask', 'gate', 'ask');
    const gate = flow.blocks[1]!.id;
    const port = new FakePort();
    const held = await drive(flow, begun(flow), port);

    const pressed = await stopped(flow, held, port);

    expect(pressed.state).toBe('stopped');
    expect(pressed.blocks[gate]?.state).toBe('stopped');
  });

  it('does nothing to a run that is already over', async () => {
    const flow = chained('ask');
    const port = new FakePort();
    const over = await drive(flow, begun(flow), port);

    const again = await stopped(flow, over, port);

    expect(again).toBe(over);
    expect(port.count('stop')).toBe(0);
  });
});

describe('an interrupted run', () => {
  it('resumes from its first unfinished block, in the lanes it already had', async () => {
    const flow = forked('worktrees');
    const [head, a, b] = flow.blocks;
    const port = new FakePort();
    // As the app left it: the plan and the first branch done, the second branch
    // still to go, and both lanes already open with their own conversations.
    const fresh = begun(flow, [lane('lane-0', 'c-lane-0'), lane('lane-1', 'c-lane-1', 'flow/lane-1')]);
    const was: Run = {
      ...fresh,
      state: 'interrupted',
      blocks: {
        ...fresh.blocks,
        [head!.id]: { ...fresh.blocks[head!.id]!, state: 'done', lane: 'lane-0', said: 'Split in two', turns: 1 },
        [a!.id]: { ...fresh.blocks[a!.id]!, state: 'done', lane: 'lane-0', said: 'A is done', turns: 2 },
      },
    };

    const again = resumed(was, port);
    expect(again.state).toBe('running');
    expect(again.endedAt).toBeNull();
    // What finished stays finished; what did not is run from its beginning.
    expect(again.blocks[head!.id]?.state).toBe('done');
    expect(again.blocks[a!.id]?.state).toBe('done');

    const done = await drive(flow, again, port);

    expect(done.state).toBe('done');
    // Nothing is opened: the lanes the run already had are the ones it goes on
    // in, which is what keeps the worktree branch the same branch.
    expect(port.lanesOpened()).toEqual([]);
    expect(done.blocks[b!.id]?.lane).toBe('lane-1');
    expect(done.lanes.find((one) => one.id === 'lane-1')?.branch).toBe('flow/lane-1');
    expect(port.turns().every((one) => one.lane === 'lane-1')).toBe(true);
  });

  it('is left alone when the run was never stopped', () => {
    const flow = chained('ask');
    const port = new FakePort();
    const going = begun(flow);
    expect(resumed(going, port)).toBe(going);
  });
});

describe('a wave that is already over', () => {
  it('does nothing at all', async () => {
    const flow = chained('ask');
    const port = new FakePort();
    const over = await drive(flow, begun(flow), port);
    const before = port.asked.length;

    const again = await tick(flow, over, port);

    expect(again).toBe(over);
    expect(port.asked.length).toBe(before);
  });
});

/* ========================================================================== */

describe('the runner and worktrees', () => {
  it('never removes one', () => {
    // A flow opens worktrees so branches can run side by side, and nothing about
    // a run finishing is a reason to take somebody's copy away. `releaseWorktree`
    // is `git worktree remove --force`: no check and no rescue.
    expect(source).not.toContain('releaseWorktree');
    expect(source).not.toContain('dropWorktree');
  });

  it('reaches nothing outside its port', () => {
    // The whole of the machine's contact with the world, which is what makes it
    // checkable without Pi, a disk or a clock.
    expect(source).not.toContain("from 'node:");
    expect(source).not.toContain('ipcRenderer');
    expect(source).not.toContain('setTimeout');
    expect(source).not.toContain('Date.now');
  });
});
