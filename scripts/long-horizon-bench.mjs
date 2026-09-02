#!/usr/bin/env node
/**
 * Whether a model finishes a long job, or stops early.
 *
 * Three fixed jobs — 8, 12 and 20 steps — run against one real model, through
 * the same checklist, the same standing block and the same carry-on decision
 * the app uses. Nothing here is a second implementation: `src/work/buildplan`,
 * `src/work/continuation`, `src/work/carryon` and `src/agent/pi/standing` are
 * loaded and driven as they stand.
 *
 * Every step is a file, so "done" is checked rather than believed. A tick for a
 * step whose file is not there is a false tick, and one is a failure: a model
 * that reports work it did not do is worse on a long job than one that stops.
 *
 * The result is written to the model's own file under the app's data folder, in
 * the shape the model chip reads: finishes long jobs, yes or stops early.
 *
 * Usage:
 *   node scripts/long-horizon-bench.mjs                  # first connected model
 *   node scripts/long-horizon-bench.mjs --model openai/gpt-5
 *   node scripts/long-horizon-bench.mjs --json           # also print the result
 *   node scripts/long-horizon-bench.mjs --list           # what is connected
 *   node scripts/long-horizon-bench.mjs --dry-run        # set up, run nothing
 *
 * It costs real money and takes real minutes, so it never runs in CI.
 */

import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, platform, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);

const USAGE = `long-horizon-bench — does this model finish a long job?

  node scripts/long-horizon-bench.mjs [options]

  --model <provider/id>   Which model to measure. Default: the first connected one.
  --list                  Print the models this machine can reach, and stop.
  --json                  Print the result as JSON as well as in words.
  --out <file>            Write the result here instead of the app's data folder.
  --sizes <a,b,c>         Job sizes to run. Default: 8,12,20. For a quick check.
  --dry-run               Set the jobs up and report what would run.
  --help                  This.

Three jobs of 8, 12 and 20 steps. Each step writes one file, so a tick is
checked rather than believed. It spends real money and takes real minutes.`;

function say(...words) {
  console.log(...words);
}

function flag(name) {
  return args.includes(name);
}

function value(name) {
  const at = args.indexOf(name);
  return at === -1 ? null : (args[at + 1] ?? null);
}

if (flag('--help') || flag('-h')) {
  say(USAGE);
  process.exit(0);
}

/* A bench that spends money and takes minutes has no business in a build. */
if (process.env.CI !== undefined && process.env.CI !== '' && !flag('--anyway')) {
  say('This bench talks to a real model, so it does not run in CI. Run it on a machine with a provider connected.');
  process.exit(0);
}

/* -------------------------------------------------------------------------- */
/* The app's own modules, loaded as they stand                                 */
/* -------------------------------------------------------------------------- */

/** Pi ships the loader that reads TypeScript; it is the same one the add-on
 *  probe uses. Without it there is nothing to measure against. */
function jitiEntry() {
  const places = [
    join(root, 'node_modules/jiti/lib/jiti-static.mjs'),
    join(root, 'node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti-static.mjs'),
  ];
  return places.find((one) => existsSync(one)) ?? null;
}

async function appModules() {
  const entry = jitiEntry();
  if (entry === null) return null;
  const { createJiti } = await import(pathToFileURL(entry).href);
  const jiti = createJiti(pathToFileURL(join(root, 'scripts/')).href, { moduleCache: false });
  const load = (where) => jiti.import(join(root, where));
  return {
    plan: await load('src/work/buildplan.ts'),
    carry: await load('src/work/carryon.ts'),
    onward: await load('src/work/continuation.ts'),
    standing: await load('src/agent/pi/standing.ts'),
  };
}

/* -------------------------------------------------------------------------- */
/* Where the answer is kept                                                    */
/* -------------------------------------------------------------------------- */

/** The same folder the desktop app keeps its own files in. */
function userData() {
  const name = 'Graphe';
  if (platform() === 'darwin') return join(homedir(), 'Library', 'Application Support', name);
  if (platform() === 'win32') return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), name);
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), name);
}

/** One file per model, named the way the model is chosen. */
function resultFile(providerId, modelId) {
  const id = `${providerId}--${modelId}`.replace(/[^a-zA-Z0-9._-]+/g, '-');
  return join(userData(), 'models', `${id}.json`);
}

/* -------------------------------------------------------------------------- */
/* The three jobs                                                              */
/* -------------------------------------------------------------------------- */

const DEFAULT_SIZES = [8, 12, 20];

function sizesAsked() {
  const given = value('--sizes');
  if (given === null) return DEFAULT_SIZES;
  const wanted = given
    .split(',')
    .map((one) => Number(one.trim()))
    .filter((one) => Number.isFinite(one) && one > 0)
    .map((one) => Math.trunc(one));
  return wanted.length === 0 ? DEFAULT_SIZES : wanted;
}

const SIZES = sizesAsked();

function jobFor(many, folder) {
  const steps = Array.from(
    { length: many },
    (_, at) => `Write the file step-${String(at + 1)}.txt in ${folder} containing the single word done`,
  );
  return {
    many,
    steps,
    asked: [
      `There are ${String(many)} things to do, and they are already on the checklist.`,
      'Work through the whole list in this reply. Each step is one file to write, with the single word "done" in it.',
      'Call step_done(n) as each file lands. Do not stop to report progress while steps are still unticked.',
    ].join(' '),
  };
}

/* -------------------------------------------------------------------------- */
/* Running one job                                                             */
/* -------------------------------------------------------------------------- */

async function runJob(pi, app, { runtime, model, many }) {
  const { Type } = await import('typebox');
  const folder = await mkdtemp(join(tmpdir(), 'graphe-bench-'));
  const job = jobFor(many, folder);

  let plan = app.plan.replaceKeepingTicks([], job.steps);
  let falseTicks = 0;

  const landed = (n) => existsSync(join(folder, `step-${String(n)}.txt`));

  const stepTool = (name, describe, extra, move) => ({
    name,
    label: name,
    description: describe,
    parameters: Type.Object({
      n: Type.Integer({ minimum: 1, description: 'The number of the step, as the checklist lists it.' }),
      ...extra(Type),
    }),
    executionMode: 'parallel',
    execute: async (_callId, params) => {
      const moved = move(plan, Math.trunc(params.n), params);
      plan = moved.plan;
      return { content: [{ type: 'text', text: moved.said }], details: {} };
    },
  });

  const customTools = [
    stepTool(
      'step_done',
      'Tick the step you have just finished off the checklist the person can see. Say which step by its number.',
      () => ({}),
      (now, n) => {
        // Checked rather than believed: this is the whole measurement.
        if (!landed(n)) falseTicks += 1;
        return app.plan.tickStep(now, n, null);
      },
    ),
    stepTool(
      'step_failed',
      'Say a step did not work and why. It stays on the list as work still owed.',
      (T) => ({ why: T.String({ minLength: 1 }) }),
      (now, n, params) => app.plan.failStep(now, n, String(params.why ?? '')),
    ),
    stepTool(
      'step_skipped',
      'Say a step is not going to be done, and why. Settled work rather than owed.',
      (T) => ({ why: T.String({ minLength: 1 }) }),
      (now, n, params) => app.plan.skipStep(now, n, String(params.why ?? '')),
    ),
  ];

  const loader = new pi.DefaultResourceLoader({
    cwd: folder,
    agentDir: await pi.getAgentDir(),
    // Nobody's add-ons: the measurement is of the model, not of an install.
    noExtensions: true,
    noThemes: true,
    extensionFactories: [
      {
        name: 'graphe-standing',
        factory: (api) => {
          api.on('before_agent_start', (_event, ctx) => {
            const block = app.standing.standingBlock({
              list: (() => {
                const how = app.plan.progress(plan);
                return how.total === 0
                  ? null
                  : {
                      markdown: app.plan.toMarkdown(plan.slice(0, app.standing.MOST_ROWS)),
                      done: how.done,
                      total: how.total,
                      rows: plan.length,
                    };
              })(),
              goal: null,
              notes: [],
            });
            if (block === null) return undefined;
            const before = ctx.getSystemPrompt?.() ?? '';
            return { systemPrompt: `${before}\n\n${block}` };
          });
        },
      },
    ],
  });
  await loader.reload();

  const { session } = await pi.createAgentSession({
    cwd: folder,
    agentDir: await pi.getAgentDir(),
    resourceLoader: loader,
    tools: ['read', 'write', 'edit', 'bash', ...customTools.map((one) => one.name)],
    customTools,
    modelRuntime: runtime,
    model,
    sessionManager: pi.SessionManager.inMemory(folder),
  });

  const began = Date.now();
  let state = app.onward.freshContinuation();
  let rounds = 0;
  let stopped = '';
  let asked = job.asked;

  for (;;) {
    rounds += 1;
    try {
      await session.prompt(asked);
    } catch (cause) {
      stopped = `the run fell over — ${cause instanceof Error ? cause.message : String(cause)}`;
      break;
    }
    const how = app.plan.progress(plan);
    const next = app.plan.nextOf(plan);
    const move = app.onward.decide(state, {
      list: { done: how.done, total: how.total, next: next?.title ?? null, finished: app.plan.isFinished(plan) },
      goal: null,
      endedHow: 'finished',
      boardFinished: [],
      extensionAsked: null,
    });
    state = move.state;
    if (move.kind !== 'send') {
      stopped = move.said ?? 'the list finished';
      break;
    }
    asked = move.text;
  }

  const finished = Array.from({ length: many }, (_, at) => at + 1).filter(landed).length;
  await rm(folder, { recursive: true, force: true }).catch(() => undefined);

  return {
    steps: many,
    finished,
    rounds,
    falseTicks,
    ms: Date.now() - began,
    ticked: app.plan.progress(plan).done,
    stopped,
  };
}

/* -------------------------------------------------------------------------- */
/* The verdict                                                                 */
/* -------------------------------------------------------------------------- */

function verdictFrom(jobs) {
  const whole = jobs.every((one) => one.finished === one.steps);
  const clean = jobs.every((one) => one.falseTicks === 0);
  return {
    longJobs: whole && clean ? 'finishes' : 'stops-early',
    says: whole && clean ? 'finishes long jobs' : 'stops early on long jobs',
  };
}

function printResult(result) {
  say('');
  say(`# long-horizon bench — ${result.model.providerId}/${result.model.modelId}`);
  for (const job of result.jobs) {
    const pace = `${(job.ms / 1000).toFixed(1)}s`;
    say(
      `  ${String(job.steps).padStart(2)} steps: ${String(job.finished)}/${String(job.steps)} done · ` +
        `${String(job.rounds)} rounds · ${String(job.falseTicks)} false ticks · ${pace} · ${job.stopped}`,
    );
  }
  say(`  verdict: ${result.says}`);
  say('');
}

/* -------------------------------------------------------------------------- */
/* Going                                                                       */
/* -------------------------------------------------------------------------- */

async function main() {
  const app = await appModules();
  if (app === null) {
    say('I could not read the app’s own modules, so there is nothing honest to measure. Run npm install first.');
    return 0;
  }

  let pi;
  try {
    pi = await import('@earendil-works/pi-coding-agent');
  } catch {
    say('The part that does the work is not installed here. Run npm install first.');
    return 0;
  }

  const agentDir = await pi.getAgentDir();
  const runtime = await pi.ModelRuntime.create({
    authPath: join(agentDir, 'auth.json'),
    modelsPath: join(agentDir, 'models.json'),
    allowModelNetwork: false,
  });

  let usable = [];
  try {
    usable = runtime.getAvailableSnapshot();
  } catch {
    usable = [];
  }

  if (flag('--list')) {
    if (usable.length === 0) say('No model is connected yet.');
    for (const one of usable) say(`  ${one.provider}/${one.id}`);
    return 0;
  }

  if (usable.length === 0) {
    say('No model is connected yet, so there is nothing to measure. Connect a provider in Graphe and run this again.');
    return 0;
  }

  const asked = value('--model');
  const chosen =
    asked === null
      ? usable[0]
      : (usable.find((one) => `${one.provider}/${one.id}` === asked) ?? null);
  if (chosen === null || chosen === undefined) {
    say(`I could not find ${String(asked)} among the models this machine can reach. Try --list.`);
    return 0;
  }

  const model = runtime.getModel(chosen.provider, chosen.id);
  if (model === null || model === undefined) {
    say(`${chosen.provider}/${chosen.id} is listed but could not be opened, so there is nothing to measure.`);
    return 0;
  }

  if (flag('--dry-run')) {
    say(`Would run ${SIZES.map(String).join(', ')}-step jobs against ${chosen.provider}/${chosen.id}.`);
    say(`Result would go to ${resultFile(chosen.provider, chosen.id)}.`);
    return 0;
  }

  const jobs = [];
  for (const many of SIZES) {
    say(`running the ${String(many)}-step job…`);
    jobs.push(await runJob(pi, app, { runtime, model, many }));
  }

  const result = {
    model: { providerId: chosen.provider, modelId: chosen.id },
    at: new Date().toISOString(),
    ...verdictFrom(jobs),
    jobs,
  };
  printResult(result);

  const out = value('--out') ?? resultFile(chosen.provider, chosen.id);
  try {
    await mkdir(dirname(out), { recursive: true });
    // Whatever else is kept about this model stays; only the bench is ours.
    let held = {};
    try {
      held = JSON.parse(await readFile(out, 'utf8'));
    } catch {
      held = {};
    }
    await writeFile(out, `${JSON.stringify({ ...held, longHorizon: result }, null, 2)}\n`, 'utf8');
    say(`wrote ${out}`);
  } catch (cause) {
    say(`I could not write the result down: ${cause instanceof Error ? cause.message : String(cause)}`);
  }

  if (flag('--json')) say(JSON.stringify(result, null, 2));
  return result.longJobs === 'finishes' ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (cause) => {
    say(`The bench stopped: ${cause instanceof Error ? cause.message : String(cause)}`);
    process.exit(1);
  },
);
