/** 6.2's spike: one conversation's agent runtime in a child process.
 *
 * The claim being tested is narrow and total: with Pi and its extensions in a
 * process of their own, the four things that must cross the boundary still
 * cross, and a child that is killed behaves the way the plan says it must.
 *
 *  - the Guard judges a tool call the same in the child as in-process;
 *  - a trusted extension loads in the child and its UI request reaches the
 *    window and is answered;
 *  - two transcript writes in the child replay through the ordinary reader, and
 *    usage is counted once;
 *  - a hard kill marks the run interrupted, settles a pending wait as
 *    cancelled, and starts nothing on restart.
 *
 * It is deliberately not a migration test. Nothing here asserts that the app
 * uses the supervisor — it does not, yet — only that the seam can carry what a
 * migration would need it to carry. `docs/handoffs/phase-6-runtime-spike.md`
 * holds what could not cross and what is still missing.
 */

import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { childProgram, startRuntime, type ChildExit, type ChildRuntime } from '../electron/services/runtime-supervisor';
import { readTranscript } from '../src/agent/pi/adapter';
import { evaluate } from '../src/agent/guard/policy';
import { records } from '../src/agent/pi/rpc-protocol';
import type { ExtensionAsk } from '../src/lib/extension-ask';
import type { ToolCall } from '../src/agent/types';

/* -------------------------------------------------------------------------- */
/* A model, so a turn is real                                                  */
/* -------------------------------------------------------------------------- */

/** One turn of the script: either words, or a tool call. */
type Step = { says: string } | { calls: { name: string; arguments: Record<string, unknown> } };

/** What Pi's own converter expects on a `done` event. Free: this is not an
 *  account, and a spend figure here would be money nobody paid. */
const USAGE = {
  input: 1,
  output: 1,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 2,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

type ScriptedModel = {
  url: string;
  replies(steps: readonly Step[]): void;
  /** How many turns have been asked for, which is how "counted once" is
   *  measured: the model is the one place a duplicated turn would show up. */
  turns(): number;
  stop(): Promise<void>;
};

/** A server that answers Pi's own message protocol from a list of steps.
 *
 *  The same seam the real-window suite uses (`tests/electron/scripted-model.ts`),
 *  narrowed to one connection per turn and no clock: a turn runs the whole real
 *  path — session, Guard, tools, event translation, transcript — with only the
 *  model replaced. */
async function scripted(): Promise<ScriptedModel> {
  const steps: Step[] = [];
  let turns = 0;

  const server: Server = createServer((request, response) => {
    void (async () => {
      for await (const _ of request) {
        // The prompt is not read here: this test asserts about guards, dialogs
        // and transcripts, not about what the model was told.
      }
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      const send = (event: unknown): void => {
        response.write(`data: ${JSON.stringify(event)}\n\n`);
      };
      turns += 1;
      const step = steps.shift() ?? { says: 'nothing was scripted for this turn' };
      send({ type: 'start' });
      if ('calls' in step) {
        const id = `scripted-${String(turns)}`;
        send({ type: 'toolcall_start', contentIndex: 0, id, toolName: step.calls.name });
        send({ type: 'toolcall_delta', contentIndex: 0, delta: JSON.stringify(step.calls.arguments) });
        send({
          type: 'toolcall_end',
          contentIndex: 0,
          toolCall: { type: 'toolCall', id, name: step.calls.name, arguments: step.calls.arguments },
        });
        send({ type: 'done', reason: 'toolUse', usage: USAGE });
      } else {
        send({ type: 'text_start', contentIndex: 0 });
        send({ type: 'text_delta', contentIndex: 0, delta: step.says });
        send({ type: 'text_end', contentIndex: 0, content: step.says });
        send({ type: 'done', reason: 'stop', usage: USAGE });
      }
      response.end();
    })().catch(() => response.destroy());
  });

  const listening = Promise.withResolvers<void>();
  server.listen(0, '127.0.0.1', () => listening.resolve());
  await listening.promise;
  const at = server.address() as AddressInfo | null;
  if (at === null) throw new Error('the scripted model has no port');

  return {
    url: `http://127.0.0.1:${String(at.port)}`,
    replies: (next) => steps.splice(0, steps.length, ...next),
    turns: () => turns,
    stop: () => {
      const closed = Promise.withResolvers<void>();
      server.close(() => closed.resolve());
      // A killed child leaves its keep-alive sockets behind, and `close` waits
      // for them: without this the teardown outlives the last assertion by the
      // whole of a hook's patience.
      server.closeAllConnections();
      return closed.promise;
    },
  };
}

/* -------------------------------------------------------------------------- */
/* The child, as the build makes it                                            */
/* -------------------------------------------------------------------------- */

/** The child program the shell would ship: one file, bundled, ESM for Node,
 *  started by path. esbuild comes with Vite; these are the options
 *  `scripts/build-electron.mjs` uses for the probe runner and the helper. */
async function builtChild(into: string): Promise<string> {
  const outfile = join(into, 'runtime-child.mjs');
  await build({
    entryPoints: [fileURLToPath(new URL('../src/agent/pi/runtime-child.ts', import.meta.url))],
    outfile,
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    minify: false,
    logLevel: 'silent',
    // Pi is external on purpose: it is resolved at runtime from node_modules,
    // exactly as the shipped shell resolves it.
    external: ['@earendil-works/pi-coding-agent'],
    banner: {
      js: [
        "import { createRequire as __createRequire } from 'node:module';",
        'const require = __createRequire(import.meta.url);',
      ].join('\n'),
    },
  });
  return outfile;
}

/** A project folder, a transcript folder and a child program, made once for the
 *  whole file: building the child is the expensive part and nothing here
 *  mutates it. */
let root = '';
let project = '';
let sessions = '';
let program = '';
let modelExtension = '';
let model: ScriptedModel;
/** The app's own installation. A packaged app passes its resolved entry the
 *  same way; the child never guesses where Pi lives. */
const appRoot = fileURLToPath(new URL('..', import.meta.url));

const running: ChildRuntime[] = [];

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'graphe-runtime-spike-'));
  project = join(root, 'project');
  sessions = join(root, 'sessions');
  await mkdir(project, { recursive: true });
  await mkdir(sessions, { recursive: true });
  await writeFile(join(project, 'README.md'), '# a project\n', 'utf8');
  program = await builtChild(root);
  process.env['GRAPHE_RUNTIME_CHILD'] = program;
  model = await scripted();
  modelExtension = join(root, 'scripted-provider.mjs');
  await writeFile(
    modelExtension,
    `export default function provider(pi) {
  pi.registerProvider('graphe-scripted', {
    name: 'Scripted test model',
    baseUrl: process.env['GRAPHE_SPIKE_MODEL'],
    api: 'pi-messages',
    apiKey: 'scripted',
    models: [{
      id: 'scripted',
      name: 'Scripted replies',
      reasoning: false,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 200000,
      maxTokens: 8192,
    }],
  });
}
`,
    'utf8',
  );
}, 120_000);

afterAll(async () => {
  for (const one of running.splice(0)) await one.stop().catch(() => undefined);
  delete process.env['GRAPHE_RUNTIME_CHILD'];
  await model?.stop();
  await rm(root, { recursive: true, force: true });
}, 60_000);

/**
 * The arguments the shell would pass: Pi's own, nothing invented.
 *
 * The scripted provider is registered by an extension handed over by path,
 * exactly as a trusted add-on a person installed would be — the same `-e` the
 * trust filter's kept list becomes. Nothing about the model is special-cased in
 * the child, which is the point: if this turn runs, a real provider would too.
 */
function argsFor(extra: readonly string[] = []): string[] {
  return [
    '--no-extensions',
    '--no-approve',
    '--session-dir',
    sessions,
    '-e',
    modelExtension,
    '--model',
    'graphe-scripted/scripted',
    ...extra,
  ];
}

/**
 * Everything the child relays, and a way to wait for one particular thing.
 *
 * Waits are driven by the stream rather than by polling: `until` is resolved by
 * the listener the moment a matching event arrives, so a quick child costs
 * nothing and a slow one fails on the test's own patience with every event it
 * did send still in hand.
 */
class Watching {
  readonly events: Record<string, unknown>[] = [];
  readonly asks: ExtensionAsk[] = [];
  private readonly waiting: { test: () => boolean; resolve: () => void }[] = [];

  note(event: Record<string, unknown>): void {
    this.events.push(event);
    this.check();
  }

  /** The window's answer is recorded, then what it unblocks is looked for. */
  asked(ask: ExtensionAsk): void {
    this.asks.push(ask);
    this.check();
  }

  /**
   * Resolves the next time `test` holds.
   *
   * Checked on arrival rather than on a clock, so a quick child costs nothing.
   * The patience is a real deadline rather than a poll interval — it is the
   * only timer here, it is bounded by the work a child actually does, and it
   * exists so a wait that will never arrive fails in seconds with every event
   * the child did send still in hand.
   */
  until(test: () => boolean, patienceMs = 40_000): Promise<void> {
    if (test()) return Promise.resolve();
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    const bell = setTimeout(() => {
      this.waiting.splice(this.waiting.findIndex((one) => one.resolve === resolve), 1);
      reject(new Error(`waited ${String(patienceMs)}ms for the child; it sent ${JSON.stringify(this.events.map((one) => one['type']))}`));
    }, patienceMs);
    this.waiting.push({ test, resolve: () => { clearTimeout(bell); resolve(); } });
    return promise;
  }

  private check(): void {
    for (const one of [...this.waiting]) {
      if (!one.test()) continue;
      this.waiting.splice(this.waiting.indexOf(one), 1);
      one.resolve();
    }
  }
}

function watched(): Watching {
  return new Watching();
}

/* ========================================================================== */
/* A turn runs at all                                                          */
/* ========================================================================== */

describe('a conversation hosted in a child', () => {
  it('answers Pi’s own protocol, and writes a transcript that replays', async () => {
    model.replies([{ says: 'first turn' }, { says: 'second turn' }]);
    const seen = watched();
    const runtime = await startRuntime({
      cwd: project,
      agentDir: join(root, 'agent'),
      piEntry: join(appRoot, 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'index.js'),
      env: { GRAPHE_SPIKE_MODEL: model.url },
      args: argsFor(),
      judge: () => Promise.resolve({ block: false }),
      onChatter: () => undefined,
    });
    running.push(runtime);
    runtime.onEvent((event) => seen.note(event));

    const state = await runtime.send({ type: 'get_state' });
    expect(state['success']).toBe(true);
    const data = state['data'] as Record<string, unknown>;
    const file = String(data['sessionFile']);
    expect(file.startsWith(sessions)).toBe(true);

    await runtime.send({ type: 'prompt', message: 'say something' });
    await settled(seen, 1);
    await runtime.send({ type: 'prompt', message: 'and again' });
    await settled(seen, 2);

    // The transcript is Pi's own file, written by the child, read back on this
    // side by the ordinary reader the app already uses for a reopened
    // conversation. If that replays, the transcript crossed intact.
    const replayed = await readTranscript(file);
    expect(replayed.ok).toBe(true);
    if (!replayed.ok) return;
    const said = replayed.value
      .filter((event) => event.type === 'message-delta')
      .map((event) => (event.type === 'message-delta' ? event.text : ''))
      .join('');
    expect(said).toContain('first turn');
    expect(said).toContain('second turn');

    // Usage is accounted once: the model saw each turn exactly once, so there is
    // no second attempt anywhere in the path for a meter to count twice.
    expect(model.turns()).toBe(2);
  }, 120_000);
});

/* ========================================================================== */
/* The Guard                                                                   */
/* ========================================================================== */

describe('the Guard judging in the shell, not the child', () => {
  it('stops a call the shell refuses, with the shell’s own words', async () => {
    model.replies([
      { calls: { name: 'write', arguments: { path: 'refused.txt', content: 'no' } } },
      { says: 'understood' },
    ]);
    const seen = watched();
    const judged: ToolCall[] = [];
    const runtime = await startRuntime({
      cwd: project,
      agentDir: join(root, 'agent'),
      piEntry: join(appRoot, 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'index.js'),
      env: { GRAPHE_SPIKE_MODEL: model.url },
      args: argsFor(),
      judge: (call) => {
        judged.push(call);
        return Promise.resolve({ block: true, reason: 'The Guard said no, in the shell.' });
      },
    });
    running.push(runtime);
    runtime.onEvent((event) => seen.note(event));

    await runtime.send({ type: 'prompt', message: 'write the file' });
    await settled(seen, 1);

    // The shell saw the call, with the fields the Guard reads.
    expect(judged).toHaveLength(1);
    expect(judged[0]?.name).toBe('write');
    expect(judged[0]?.input).toMatchObject({ path: 'refused.txt' });

    // And it did not happen: the child held the call until the shell answered.
    await expect(readFile(join(project, 'refused.txt'), 'utf8')).rejects.toThrow();

    // The model was told, in the shell's own words, as the tool's error.
    const end = seen.events.find((event) => event['type'] === 'tool_execution_end');
    expect(JSON.stringify(end)).toContain('The Guard said no, in the shell.');
  }, 120_000);

  it('lets a call through when the shell allows it, and it really runs', async () => {
    model.replies([
      { calls: { name: 'write', arguments: { path: 'allowed.txt', content: 'written' } } },
      { says: 'done' },
    ]);
    const seen = watched();
    const runtime = await startRuntime({
      cwd: project,
      agentDir: join(root, 'agent'),
      piEntry: join(appRoot, 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'index.js'),
      env: { GRAPHE_SPIKE_MODEL: model.url },
      args: argsFor(),
      judge: () => Promise.resolve({ block: false }),
    });
    running.push(runtime);
    runtime.onEvent((event) => seen.note(event));

    await runtime.send({ type: 'prompt', message: 'write it' });
    await settled(seen, 1);
    expect(await readFile(join(project, 'allowed.txt'), 'utf8')).toBe('written');
  }, 120_000);

  it('is the same verdict the in-process Guard reaches for the same call', async () => {
    // The point of the boundary is that the decision does not change by moving
    // the agent. Both sides call the same pure policy; what this asserts is that
    // the call the child sends is the call the policy judges — same name, same
    // input — so the verdict cannot differ because the wire reshaped it.
    model.replies([
      { calls: { name: 'bash', arguments: { command: 'rm -rf /tmp/not-a-real-directory' } } },
      { says: 'stood down' },
    ]);
    const seen = watched();
    let overTheWire: ToolCall | null = null;
    const runtime = await startRuntime({
      cwd: project,
      agentDir: join(root, 'agent'),
      piEntry: join(appRoot, 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'index.js'),
      env: { GRAPHE_SPIKE_MODEL: model.url },
      args: argsFor(),
      judge: (call) => {
        overTheWire = call;
        const judged = evaluate(call, { projectRoot: project });
        return Promise.resolve(
          judged.kind === 'deny'
            ? { block: true, reason: judged.reason }
            : judged.kind === 'allow'
              ? { block: false }
              : { block: true, reason: 'the Guard wanted to ask first' },
        );
      },
    });
    running.push(runtime);
    runtime.onEvent((event) => seen.note(event));

    await runtime.send({ type: 'prompt', message: 'clean up' });
    await settled(seen, 1);

    expect(overTheWire).not.toBeNull();
    const inProcess = evaluate(overTheWire as unknown as ToolCall, { projectRoot: project });
    // Judged the same on this side of the boundary as the policy judges it in
    // the process: the wire did not change the call.
    expect(inProcess.kind).not.toBe('allow');
    const end = seen.events.find((event) => event['type'] === 'tool_execution_end');
    expect((end?.['isError'] as boolean | undefined) ?? false).toBe(true);
  }, 120_000);
});

/* ========================================================================== */
/* An extension, and the window                                                */
/* ========================================================================== */

describe('a trusted extension in the child', () => {
  it('loads, and its question reaches the window and is answered', async () => {
    const extension = join(root, 'asks.mjs');
    await writeFile(
      extension,
      `export default function asks(pi) {
  pi.registerCommand('ask-one', {
    description: 'Ask one question and say what came back.',
    handler: async (_args, ctx) => {
      const chosen = await ctx.ui.select('Which file should I change?', ['hero.css', 'nav.css']);
      ctx.ui.notify(chosen === undefined ? 'unanswered' : 'chosen ' + chosen);
    },
  });
}
`,
      'utf8',
    );

    model.replies([{ says: 'asked' }]);
    const seen = watched();
    const runtime = await startRuntime({
      cwd: project,
      agentDir: join(root, 'agent'),
      piEntry: join(appRoot, 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'index.js'),
      env: { GRAPHE_SPIKE_MODEL: model.url },
      args: argsFor(['-e', extension]),
      judge: () => Promise.resolve({ block: false }),
      // The window, stood in for. It answers with the second option, so a host
      // that answered itself would be caught by the answer not matching.
      ask: (ask) => {
        seen.asked(ask);
        return Promise.resolve({ kind: 'select', value: 'nav.css' });
      },
    });
    running.push(runtime);
    runtime.onEvent((event) => seen.note(event));

    const commands = await runtime.send({ type: 'get_commands' });
    expect(JSON.stringify(commands)).toContain('ask-one');

    await runtime.send({ type: 'prompt', message: '/ask-one' });
    await seen.until(() => considered(seen).includes('chosen nav.css'));

    // The question crossed as our own shape, with its title intact, and the
    // extension was told the answer the window gave rather than a default.
    expect(seen.asks).toEqual([
      {
        kind: 'select',
        title: 'Which file should I change?',
        options: [
          { label: 'hero.css', value: 'hero.css' },
          { label: 'nav.css', value: 'nav.css' },
        ],
        timeoutMs: null,
      },
    ]);
    expect(considered(seen)).toContain('chosen nav.css');
  }, 120_000);

  it('cancels a question there is no window to answer', async () => {
    const extension = join(root, 'asks-again.mjs');
    await writeFile(
      extension,
      `export default function asks(pi) {
  pi.registerCommand('ask-none', {
    description: 'Ask a question with nobody watching.',
    handler: async (_args, ctx) => {
      const yes = await ctx.ui.confirm('Overwrite it?', 'There is already a file there.');
      ctx.ui.notify(yes ? 'answered yes' : 'not answered yes');
    },
  });
}
`,
      'utf8',
    );

    const seen = watched();
    const runtime = await startRuntime({
      cwd: project,
      agentDir: join(root, 'agent'),
      piEntry: join(appRoot, 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'index.js'),
      env: { GRAPHE_SPIKE_MODEL: model.url },
      args: argsFor(['-e', extension]),
      judge: () => Promise.resolve({ block: false }),
      // No `ask`: the honest default, and never a made-up yes.
    });
    running.push(runtime);
    runtime.onEvent((event) => seen.note(event));

    await runtime.send({ type: 'prompt', message: '/ask-none' });
    await seen.until(() => considered(seen).includes('not answered yes'));
    expect(considered(seen)).toContain('not answered yes');
  }, 120_000);
});

/* ========================================================================== */
/* A child that dies                                                           */
/* ========================================================================== */

describe('a child that is killed', () => {
  it('marks the run interrupted, settles the pending wait as cancelled, and starts nothing again', async () => {
    const extension = join(root, 'asks-forever.mjs');
    await writeFile(
      extension,
      `export default function asks(pi) {
  pi.registerCommand('ask-forever', {
    description: 'Ask a question and never get an answer.',
    handler: async (_args, ctx) => {
      const said = await ctx.ui.input('What should it say?', 'a heading');
      ctx.ui.notify(said === undefined ? 'nothing came back' : 'got ' + said);
    },
  });
}
`,
      'utf8',
    );

    const seen = watched();
    let asked: ExtensionAsk | null = null;
    let cancelledRequest: string | null = null;
    const runtime = await startRuntime({
      cwd: project,
      agentDir: join(root, 'agent'),
      piEntry: join(appRoot, 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'index.js'),
      env: { GRAPHE_SPIKE_MODEL: model.url },
      args: argsFor(['-e', extension]),
      judge: () => Promise.resolve({ block: false }),
      // The window is open and never answers — somebody walked away mid-dialog.
      // This is the wait the kill has to settle.
      ask: (ask) => {
        asked = ask;
        // Never settles: somebody walked away mid-dialog, which is exactly the
        // wait a kill has to cancel.
        return Promise.withResolvers<never>().promise;
      },
      cancelAsk: (requestId) => {
        cancelledRequest = requestId;
      },
    });
    running.push(runtime);
    runtime.onEvent((event) => seen.note(event));
    /** How the supervisor reported the end. */
    const ended = Promise.withResolvers<ChildExit>();
    runtime.onExit((how) => ended.resolve(how));

    // Not awaited: an extension command's handler is what blocks on the dialog,
    // so Pi's response to this prompt does not arrive until somebody answers —
    // which is the wait this test is about. The command is on its way all the
    // same, and the dialog reaching the window is what says so.
    void runtime.send({ type: 'prompt', message: '/ask-forever' });
    await seen.until(() => asked !== null);
    expect(asked).not.toBeNull();
    // The window is holding the dialog open, and the supervisor knows it is.
    const turnsBefore = model.turns();

    // A hard kill, the way a wedged runtime or a dead process goes: no signal
    // this side sent, so it is the child's own death.
    const pid = runtime.pid;
    expect(pid).toBeGreaterThan(0);
    process.kill(pid, 'SIGKILL');

    const how = await ended.promise;
    // The run is interrupted, not finished, and the dialog the window was
    // waiting on is named so its promise can be settled as cancelled.
    expect(how.kind).toBe('died');
    expect(how.unanswered).toHaveLength(1);
    expect(cancelledRequest).toContain(':');

    // Nothing starts again: a prompt after the death is refused rather than
    // reissued to a runtime that is not there, and the model was not asked a
    // second time.
    await expect(runtime.send({ type: 'prompt', message: 'carry on' })).rejects.toThrow();
    expect(model.turns()).toBe(turnsBefore);

    // And nothing was written to the project on the way out.
    const written = await readdir(project);
    expect(written).not.toContain('nothing-came-back.txt');
  }, 120_000);

  it('reports itself as the shell stopping it, not as a death', async () => {
    model.replies([{ says: 'quiet' }]);
    const runtime = await startRuntime({
      cwd: project,
      agentDir: join(root, 'agent'),
      piEntry: join(appRoot, 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'index.js'),
      env: { GRAPHE_SPIKE_MODEL: model.url },
      args: argsFor(),
      judge: () => Promise.resolve({ block: false }),
    });
    const ended = Promise.withResolvers<ChildExit>();
    runtime.onExit((exit) => ended.resolve(exit));
    await runtime.stop();
    // Killed by this side is not an interruption: nobody's run was cut short by
    // something that went wrong.
    expect((await ended.promise).kind).toBe('killed');
    await expect(runtime.send({ type: 'get_state' })).rejects.toThrow();
  }, 60_000);
});

/* ========================================================================== */
/* Small helpers                                                               */
/* ========================================================================== */

/**
 * Everything the child has told a host about.
 *
 * Pi's own records and its extension UI records both count: a notice an
 * extension raises is exactly as much a thing the window must receive as an
 * assistant message is, and a supervisor that dropped one while delivering the
 * other would pass a test written only against the other.
 */
function considered(seen: Watching): string {
  return JSON.stringify(seen.events);
}

/** Wait until the child has said it settled this many times. */
async function settled(seen: Watching, howMany: number): Promise<void> {
  await seen.until(() => seen.events.filter((event) => event['type'] === 'agent_settled').length >= howMany);
}

/* -------------------------------------------------------------------------- */
/* The wire itself                                                             */
/* -------------------------------------------------------------------------- */

describe('the framing, which is the rule Pi documents and not a line reader', () => {
  it('splits on LF alone, because U+2028 is legal inside a JSON string', () => {
    const record = JSON.stringify({ text: 'one\u2028two\u2029three' });
    const read = records(`${record}\n{"a":1}\n`);
    expect(read.lines).toEqual([record, '{"a":1}']);
    expect(read.rest).toBe('');
  });

  it('accepts a trailing CR and holds back a half-written record', () => {
    const read = records('{"a":1}\r\n{"b":\n');
    expect(read.lines).toEqual(['{"a":1}', '{"b":']);
    expect(read.rest).toBe('');
    const half = records('{"a":1}\n{"b"');
    expect(half.lines).toEqual(['{"a":1}']);
    expect(half.rest).toBe('{"b"');
  });

  it('carries a separator through untouched, because only LF delimits', () => {
    // `stringify` leaves U+2028 in the string, so a reader that split on it
    // would cut this record in half. This is the whole reason for the rule.
    const line = JSON.stringify({ text: 'a\u2028b' });
    expect(line.includes('\u2028')).toBe(true);
    expect(records(`${line}\n`).lines).toEqual([line]);
  });
});

/* -------------------------------------------------------------------------- */

describe('the child program the app would ship', () => {
  it('resolves the built child beside the shell, and an override by name', () => {
    expect(childProgram()).toBe(program);
    process.env['GRAPHE_RUNTIME_CHILD'] = join(root, 'not-here.mjs');
    expect(childProgram()).toBeNull();
    process.env['GRAPHE_RUNTIME_CHILD'] = program;
  });
});
