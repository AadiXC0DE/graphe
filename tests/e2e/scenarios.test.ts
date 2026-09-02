/** The verification scenarios, run against a scripted model.
 *
 * Every other test in this tree checks one function. These run a whole turn:
 * the person types, the model answers, the step tools move the list the person
 * is watching, the shell decides whether anything goes out on their behalf, and
 * the window folds what came back into a conversation. What is asserted is what
 * somebody sitting in front of it would see.
 *
 * Two of them cannot reach that far without the desktop shell — a settings file
 * on disk and a provider that charges nothing — and are held against the
 * modules that decide those, which is said where they are.
 */

import { describe, expect, it } from 'vitest';
import { join } from 'node:path';

import { GRAPHE_OWNED, reconcile } from '../../src/agent/advisor';
import { budgetMs, forgetOverruns, recentOverruns, withHookBudget, type Overrun } from '../../src/agent/pi/hook-budget';
import { dropsLifecycleHooks, policyFor, saysPolicy } from '../../src/agent/pi/extension-policy';
import { probe, saysCard } from '../../src/agent/pi/extension-probe';
import {
  EXTENSION_BUDGET,
  standingBlock,
  trimToBudget,
  type Piece,
} from '../../src/agent/pi/standing';
import { parseProposal } from '../../src/agent/plan';
import { implementationPlanFromResearch, stepsFromReport } from '../../src/agent/research';
import type { AgentEvent, Money } from '../../src/agent/types';
import { changeDesk, noDesks, openDesk, receive } from '../../src/lib/projects';
import { Workspaces } from '../../src/projects/workspaces';
import { STEP_WAS_STOPPED, type Turn } from '../../src/lib/thread';
import { carryOnWords } from '../../src/work/carryon';
import { MOST_ROUNDS, continuationWords } from '../../src/work/continuation';
import { harness, type Report } from './harness';

const tick = (n: number) => ({ name: 'step_done', input: { n } });
const ticks = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, at) => tick(from + at));

const numbered = (many: number, what = 'Thing') =>
  Array.from({ length: many }, (_, at) => `${what} ${String(at + 1)}`);

function planCard(report: Report): Extract<Turn, { kind: 'plan' }> | undefined {
  return report.turns.find((turn): turn is Extract<Turn, { kind: 'plan' }> => turn.kind === 'plan');
}

function steps(report: Report): Extract<Turn, { kind: 'did' }>[] {
  return report.turns.filter((turn): turn is Extract<Turn, { kind: 'did' }> => turn.kind === 'did');
}

/* -------------------------------------------------------------------------- */

describe('S-1 twelve things, ticked by the model', () => {
  const twelve = numbered(12);

  async function run(): Promise<{ app: ReturnType<typeof harness>; report: Report }> {
    const app = harness({ asked: 'Do these 12 things.' });
    const report = await app.run([
      {
        says: 'Twelve things, then. Here they are.',
        calls: [{ name: 'make_checklist', input: { steps: twelve, mode: 'replace' } }, ...ticks(1, 3)],
      },
      { says: 'Three more.', calls: ticks(4, 6) },
      { says: 'Three more.', calls: ticks(7, 9) },
      { says: 'And the last three.', calls: ticks(10, 12) },
    ]);
    return { app, report };
  }

  it('shows twelve and finishes at twelve', async () => {
    const { report } = await run();
    expect(report.list).toEqual({
      source: 'What this needs',
      done: 12,
      total: 12,
      next: null,
      finished: true,
    });
  });

  it('changes no status the model did not ask for', async () => {
    const { report } = await run();
    expect(report.appWroteStatuses).toBe(0);
    expect(report.statuses).toEqual(numbered(12, '').map((n) => `${n.trim()} done`));
  });

  it('carries on exactly three times', async () => {
    const { report } = await run();
    expect(report.continuations).toBe(3);
    expect(report.sends.map((one) => one.why)).toEqual(['checklist', 'checklist', 'checklist']);
    expect(report.rounds).toBe(4);
  });

  it('says each round out loud, and says why it stopped', async () => {
    const { report } = await run();
    expect(report.said).toEqual([
      carryOnWords.round(1, 3, 12, 'Thing 4'),
      carryOnWords.round(2, 6, 12, 'Thing 7'),
      carryOnWords.round(3, 9, 12, 'Thing 10'),
      continuationWords.listDone,
    ]);
  });

  it('never asks anybody to agree to a plan first', async () => {
    const { report } = await run();
    expect(planCard(report)).toBeUndefined();
  });

  it('leaves the finished list on screen until it is cleared', async () => {
    const { app } = await run();
    expect(app.tasks()).toHaveLength(12);
    app.clear();
    expect(app.report().list).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */

describe('S-2 a goal with no list', () => {
  const passing = () => ({ passed: true, reason: 'the typecheck passed.' });

  it('writes a list for the goal when the model wrote none', async () => {
    const app = harness({ goal: 'make the tests pass', checks: passing });
    const report = await app.run([{ says: 'Looking at the tests.' }], {
      asked: '/goal make the tests pass',
    });
    expect(app.tasks().map((task) => task.title)).toEqual(['Reach: make the tests pass']);
    expect(report.sends[0]?.why).toBe('goal');
  });

  it('carries on until every step is settled and the checks pass', async () => {
    const app = harness({ goal: 'make the tests pass', checks: passing });
    const report = await app.run(
      [
        {
          says: 'Two steps.',
          calls: [
            { name: 'make_checklist', input: { steps: ['Fix the failing test', 'Run them all'], mode: 'replace' } },
          ],
        },
        { says: 'First one done.', calls: [tick(1)] },
        { says: 'And the second.', calls: [tick(2)] },
      ],
      { asked: '/goal make the tests pass' },
    );
    expect(report.list?.done).toBe(2);
    expect(report.goal?.status).toBe('done');
    expect(report.appWroteStatuses).toBe(0);
  });

  it('stops on the round budget and says so', async () => {
    const app = harness({ goal: 'ship it', list: numbered(40), checks: passing });
    const report = await app.run(
      Array.from({ length: 40 }, (_, at) => ({ calls: [tick(at + 1)] })),
      { asked: '/goal ship it' },
    );
    expect(report.continuations).toBe(MOST_ROUNDS);
    expect(report.said[report.said.length - 1]).toBe(continuationWords.spent(MOST_ROUNDS));
    expect(report.goal?.status).toBe('active');
  });
});

/* -------------------------------------------------------------------------- */

describe('S-3 Escape in the middle of a step', () => {
  async function stopped(): Promise<Report> {
    const app = harness({ list: numbered(5) });
    return app.run([
      {
        says: 'Running the tests.',
        calls: [{ name: 'bash', input: { command: 'npm test' } }],
        how: 'stopped',
      },
    ]);
  }

  it('puts the composer back to Send', async () => {
    expect((await stopped()).busy).toBe(false);
  });

  it('closes the step that was still running', async () => {
    const open = steps(await stopped());
    expect(open).toHaveLength(1);
    expect(open[0]?.state).toBe('failed');
    expect(open[0]?.detail).toBe(STEP_WAS_STOPPED);
  });

  it('moves no status and sends nothing', async () => {
    const report = await stopped();
    expect(report.statuses).toEqual([]);
    expect(report.continuations).toBe(0);
    expect(report.said).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */

describe('S-4 a queued message and a provider that would not answer', () => {
  const typed = 'also make it green';

  async function run(): Promise<Report> {
    const app = harness({ list: numbered(4), asked: 'Do the four things.' });
    return app.run(
      [
        { says: 'Waiting that out.', waits: 30, calls: [tick(1)] },
        { says: 'Making it green.', calls: [tick(2)] },
        { says: 'The rest.', calls: [...ticks(3, 4)] },
      ],
      { typed: { 0: typed } },
    );
  }

  it('waits the provider out rather than ending the run', async () => {
    const report = await run();
    const wait = report.turns.find((turn) => turn.kind === 'holding');
    expect(wait).toMatchObject({ kind: 'holding', state: 'done', seconds: 30 });
  });

  it('finishes both messages', async () => {
    const report = await run();
    expect(report.prompts[0]).toBe('Do the four things.');
    expect(report.prompts).toContain(typed);
    expect(report.list?.done).toBe(4);
    expect(report.waiting).toEqual([]);
  });

  it('shows only the typed message in the waiting line', async () => {
    const report = await run();
    expect(report.waitingSeen.some((line) => line.length === 1)).toBe(true);
    for (const line of report.waitingSeen) {
      expect(line.every((one) => one === typed)).toBe(true);
    }
  });
});

/* -------------------------------------------------------------------------- */

describe('S-5 research with a plan in it, then a question', () => {
  const report = [
    '# What I found',
    '',
    'The router is doing three jobs at once.',
    '',
    'IMPLEMENTATION PLAN',
    '',
    ...numbered(14, 'Step').map((one, at) => `${String(at + 1)}. ${one}`),
  ].join('\n');

  it('reads fourteen steps out of the report', () => {
    const section = implementationPlanFromResearch(report);
    expect(section).not.toBeNull();
    expect(parseProposal(section ?? '').steps).toHaveLength(14);
    expect(stepsFromReport(report)).toMatchObject({ from: 'heading' });
  });

  it('a question after it starts, ticks and continues nothing', async () => {
    const app = harness();
    const asking = await app.run([{ says: 'It is doing three jobs because of the redirect.' }], {
      asked: 'Why is the router doing three jobs?',
    });
    expect(asking.statuses).toEqual([]);
    expect(asking.continuations).toBe(0);
    expect(app.tasks()).toEqual([]);
  });

  it('“Do it” turns the fourteen into a checklist', async () => {
    const app = harness();
    await app.run([{ says: 'It is doing three jobs because of the redirect.' }], {
      asked: 'Why is the router doing three jobs?',
    });
    const steps14 = stepsFromReport(report).steps;
    await app.run(
      [{ says: 'Starting.', calls: [{ name: 'make_checklist', input: { steps: steps14 } }] }],
      { asked: 'Do it' },
    );
    expect(app.tasks()).toHaveLength(14);
    expect(app.report().list?.total).toBe(14);
  });
});

/* -------------------------------------------------------------------------- */

describe('S-6 plan mode, answered in prose', () => {
  const prose = 'I would move the header into its own component and give it the sticky behaviour.';

  it('puts a card up rather than ending quietly', async () => {
    const app = harness();
    const report = await app.run([{ looks: true, says: prose }], {
      asked: 'Make the header sticky',
    });
    const card = planCard(report);
    expect(card).toBeDefined();
    expect(card?.steps).toEqual([prose]);
    expect(card?.answered).toBeNull();
  });

  it('closes the looking-around line it opened', async () => {
    const app = harness();
    const report = await app.run([{ looks: true, says: prose }]);
    expect(steps(report).every((one) => one.state !== 'running')).toBe(true);
  });

  /* An open plan card does not hold the loop back: nothing tells the shell that
     somebody is being asked, so a list still running carries on underneath it.
     Asserted as it behaves, not as it should. */
  /* A card somebody is reading is somebody being waited on. The app used to
     send the next step out underneath it. */
  it('holds a running list back while the card is on screen', async () => {
    const app = harness({ list: numbered(3) });
    const report = await app.run([{ looks: true, says: prose }]);
    expect(planCard(report)).toBeDefined();
    expect(report.continuations).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */

describe('S-7 an add-on that starts work of its own', () => {
  const fixture = join(process.cwd(), 'tests/fixtures/extensions/orchestrating/index.mjs');

  it('is read as one that starts turns and runs work in the background', async () => {
    const card = await probe(fixture);
    expect(card).not.toBeNull();
    expect(card?.startsTurns).toBe(true);
    expect(card?.runsBackgroundWork).toBe(true);
    expect(card?.orchestrating).toBe(true);
    expect(saysCard(card!)).toBe(
      'starts turns on its own · runs work in the background · changes the system prompt',
    );
  });

  /* It used to keep its tools and lose its hooks, which sounds cautious and is
     not: an add-on whose tool starts the work and whose hook delivers the
     result launches and then never answers. Half an add-on is worse than none.
     What made the hooks dangerous is handled below instead — a hook that stops
     answering is let go of, and a turn it asks for is one reason among the
     authority's own. */
  it('runs whole in a conversation, where somebody is watching every turn', async () => {
    const card = await probe(fixture);
    const policy = policyFor(card, 'conversation');
    expect(policy).toBe('on');
    expect(dropsLifecycleHooks(policy)).toBe(false);
  });

  it('stands down where Graphe is driving and nobody is watching', async () => {
    const card = await probe(fixture);
    for (const session of ['board', 'helper', 'canvas'] as const) {
      const policy = policyFor(card, session);
      expect(policy).toBe('off');
      expect(saysPolicy(policy)).toBeTruthy();
    }
  });

  it('lets go of a hook that stops answering', async () => {
    forgetOverruns();
    const over: Overrun[] = [];
    const handlers = new Map<string, ((...args: never[]) => unknown)[]>();
    handlers.set('agent_end', [() => new Promise(() => undefined)]);
    withHookBudget(
      { extensions: [{ path: '/add-ons/orchestrating/index.mjs', handlers }] },
      (one) => over.push(one),
      40,
    );
    const wrapped = handlers.get('agent_end')?.[0];
    const began = Date.now();
    await (wrapped as () => Promise<unknown>)();
    expect(Date.now() - began).toBeLessThan(budgetMs());
    expect(over.map((one) => one.extension)).toEqual(['orchestrating']);
    expect(recentOverruns().map((one) => one.event)).toContain('agent_end');
    forgetOverruns();
  });

  it('trims its six kilobytes out of the prompt and leaves ours alone', async () => {
    const card = await probe(fixture);
    const bytes = card?.toolPromptBytes ?? 0;
    expect(bytes).toBeGreaterThan(EXTENSION_BUDGET);
    const ours = standingBlock({ list: null, goal: 'make the tests pass', notes: [] }) ?? '';
    const pieces: readonly Piece[] = [
      { kind: 'pi', from: 'pi', text: 'p'.repeat(58_000) },
      { kind: 'extension', from: 'orchestrating', text: 'd'.repeat(bytes) },
      { kind: 'graphe', from: 'graphe', text: ours },
    ];
    const trimmed = trimToBudget(pieces);
    expect(trimmed.now).toBeLessThan(trimmed.was);
    expect(trimmed.cut.map((one) => one.from)).toEqual(['orchestrating']);
    const addon = trimmed.pieces.find((one) => one.kind === 'extension');
    expect(addon?.text.length).toBeLessThanOrEqual(EXTENSION_BUDGET + 80);
    expect(trimmed.pieces.find((one) => one.kind === 'graphe')?.text).toBe(ours);
  });

  it('gets one attributed turn per settle, however often it asks', async () => {
    const app = harness();
    const asked = { from: 'orchestrating', text: 'carry on' };
    const report = await app.run([{ says: 'Right.' }, { says: 'Nothing else to do.' }], {
      asks: { 0: [asked, asked] },
    });
    expect(report.continuations).toBe(1);
    expect(report.sends[0]?.why).toBe('extension');
    expect(report.said[0]).toBe(continuationWords.extensionAsked('orchestrating'));
  });
});

/* -------------------------------------------------------------------------- */

describe('S-8 two conversations in one project', () => {
  it('advances each list only from its own conversation', async () => {
    const app = harness({ address: 'one', list: numbered(4, 'One') });
    app.open('two', { list: numbered(3, 'Two') });

    const first = await app.runIn('one', [{ says: 'Two of mine.', calls: ticks(1, 2) }]);
    expect(app.report('one').list).toMatchObject({ done: 2, total: 4 });
    expect(app.report('two').list).toMatchObject({ done: 0, total: 3 });
    expect(first.sends.every((one) => one.why === 'checklist')).toBe(true);

    await app.runIn('two', [{ says: 'All three.', calls: ticks(1, 3) }]);
    expect(app.report('one').list).toMatchObject({ done: 2, total: 4 });
    expect(app.report('two').list).toMatchObject({ done: 3, total: 3, finished: true });
  });

  it('keeps each conversation’s words in its own thread', async () => {
    const app = harness({ address: 'one', list: numbered(4, 'One') });
    app.open('two', { list: numbered(3, 'Two') });
    await app.runIn('one', [{ says: 'Mine.', calls: ticks(1, 4) }]);
    await app.runIn('two', [{ says: 'Theirs.', calls: ticks(1, 3) }]);

    const words = (address: string) =>
      app
        .report(address)
        .turns.filter((turn) => turn.kind === 'said')
        .map((turn) => (turn.kind === 'said' ? turn.text : ''));
    expect(words('one').join(' ')).toContain('Mine.');
    expect(words('one').join(' ')).not.toContain('Theirs.');
    expect(words('two').join(' ')).toContain('Theirs.');
    expect(words('two').join(' ')).not.toContain('Mine.');
  });

  it('never puts down a conversation with a list still owed', () => {
    const closed: string[] = [];
    const room = new Workspaces<{ owes: boolean }>({
      limit: 2,
      mayEvict: (held) => !held.owes,
      close: () => undefined,
      evicted: (one) => closed.push(one.path),
    });
    room.adopt({ path: 'one', name: 'one', held: { owes: true } });
    room.adopt({ path: 'two', name: 'two', held: { owes: false } });
    room.adopt({ path: 'three', name: 'three', held: { owes: false } });

    expect(closed).toEqual(['two']);
    expect(room.open.map((one) => one.path)).toEqual(['three', 'one']);
  });

  it('goes over the limit rather than dropping an unfinished list', () => {
    const closed: string[] = [];
    const room = new Workspaces<{ owes: boolean }>({
      limit: 2,
      mayEvict: (held) => !held.owes,
      close: () => undefined,
      evicted: (one) => closed.push(one.path),
    });
    room.adopt({ path: 'one', name: 'one', held: { owes: true } });
    room.adopt({ path: 'two', name: 'two', held: { owes: true } });
    room.adopt({ path: 'three', name: 'three', held: { owes: false } });

    expect(closed).toEqual([]);
    expect(room.open).toHaveLength(3);
  });
});

/* -------------------------------------------------------------------------- */

/* The live file is the shell's, so this is held against the module that decides
   what happens to it. */
describe('S-9 an advisor settings file written by an older install', () => {
  const older: Record<string, unknown> = {
    contextMaxChars: 15_000,
    advisorRedactSecrets: false,
    gateFailureMode: 'block',
    advisorCustomInvocation: 'my own sentence',
    somethingOfMine: 42,
  };

  it('puts the keys it owns right', () => {
    const { settings, changed } = reconcile(older);
    expect(settings['contextMaxChars']).toBe(GRAPHE_OWNED.contextMaxChars);
    expect(settings['advisorRedactSecrets']).toBe(true);
    expect(changed).toContain('contextMaxChars');
  });

  it('leaves every other key exactly as it was', () => {
    const { settings } = reconcile(older);
    expect(settings['advisorCustomInvocation']).toBe('my own sentence');
    expect(settings['somethingOfMine']).toBe(42);
  });

  it('never lets a gate failure refuse a tool', () => {
    const { settings } = reconcile(older);
    expect(settings['gateFailureMode']).toBe('warn-and-continue');
    expect(settings['advisorBlockOnBlocked']).toBe(false);
  });

  it('stops writing a key somebody has taken back', () => {
    const taken = { ...older, graphe: { ownedOverrides: ['contextMaxChars'] } };
    const { settings, changed } = reconcile(taken);
    expect(settings['contextMaxChars']).toBe(15_000);
    expect(changed).not.toContain('contextMaxChars');
  });
});

/* -------------------------------------------------------------------------- */

/* A provider that charges nothing never sends a split, so this is held against
   the fold that has to clear the job without one. */
describe('S-10 a run that costs nothing', () => {
  const project = '/tmp/graphe-free';

  function desk(event: AgentEvent) {
    let desks = openDesk(noDesks, { path: project, name: 'free' });
    desks = changeDesk(desks, project, (one) => ({
      ...one,
      address: '',
      doing: { task: { kind: 'change', size: 'page' }, startedAt: 0 },
    }));
    desks = receive(desks, { project, conversation: null, event });
    return desks.byPath[project];
  }

  it('clears the job the moment the run settles', () => {
    const now = desk({ type: 'settled', how: 'finished' });
    expect(now?.doing).toBeNull();
    expect(now?.filing).not.toBeNull();
  });

  it('files nothing when the split never comes', () => {
    let desks = openDesk(noDesks, { path: project, name: 'free' });
    desks = changeDesk(desks, project, (one) => ({
      ...one,
      address: '',
      doing: { task: { kind: 'change', size: 'page' }, startedAt: 0 },
    }));
    for (const event of [
      { type: 'settled', how: 'finished' } as AgentEvent,
      { type: 'busy', on: false } as AgentEvent,
    ]) {
      desks = receive(desks, { project, conversation: null, event });
    }
    expect(desks.byPath[project]?.doing).toBeNull();
    expect(desks.byPath[project]?.jobs).toEqual([]);
  });

  it('records the job when a split does arrive', () => {
    let desks = openDesk(noDesks, { path: project, name: 'free' });
    desks = changeDesk(desks, project, (one) => ({
      ...one,
      address: '',
      doing: { task: { kind: 'change', size: 'page' }, startedAt: 0 },
    }));
    const total: Money = { minor: 250, currency: 'INR' };
    for (const event of [
      { type: 'settled', how: 'finished' } as AgentEvent,
      {
        type: 'spend-summary',
        summary: {
          currency: 'INR',
          total,
          work: total,
          retry: { minor: 0, currency: 'INR' },
          retryShare: 0,
          entryCount: 1,
          firstAt: 0,
          lastAt: 1,
          largestRetry: null,
        },
      } as AgentEvent,
    ]) {
      desks = receive(desks, { project, conversation: null, event });
    }
    expect(desks.byPath[project]?.jobs).toHaveLength(1);
    expect(desks.byPath[project]?.filing).toBeNull();
  });

  it('leaves nothing spinning after a settle', async () => {
    const app = harness({ list: numbered(2) });
    const report = await app.run([{ says: 'Both.', calls: ticks(1, 2) }]);
    expect(report.busy).toBe(false);
    expect(report.waiting).toEqual([]);
    expect(app.desks().byPath[app.project]?.doing).toBeNull();
  });
});
