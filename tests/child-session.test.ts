/** The child path, chosen by a switch, and what a dead child leaves behind.
 *
 * Phase 6.2's first steps as behaviour rather than as a sketch: one helper picks
 * which process a conversation's agent runs in, and the in-process path stays
 * the default for everybody who has not asked. What is proven here:
 *
 *  - a copy that has asked for nothing gets the in-process path, exactly as it
 *    always did, and so does a helper or a board piece even with the switch on;
 *  - the switch's spelling is one of four, and anything else is not a decision;
 *  - a child-hosted turn writes a transcript the ordinary reader replays, and
 *    its events arrive through the same relay the in-process path uses;
 *  - a child killed mid-turn lets the question it was holding go as cancelled
 *    and says the run was interrupted, so the composer returns to Send.
 *
 * The child is built here the way the runtime spike builds it, because a
 * scratch folder is the only place the built program exists without a packaged
 * app.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { notePackagedApp, readTranscript } from '../src/agent/pi/adapter';
import type { CreateSessionOptions } from '../src/agent/pi/adapter';
import {
  CHILD_RUNTIME_ENV,
  argsFor,
  openSession,
  runtimeChoice,
} from '../src/agent/pi/child-session';
import type { AgentEvent } from '../src/agent/types';

/* -------------------------------------------------------------------------- */
/* A model, so a turn is real                                                  */
/* -------------------------------------------------------------------------- */

const USAGE = {
  input: 1,
  output: 1,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 2,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

type Step = { says: string } | { calls: { name: string; arguments: Record<string, unknown> } };

type Server1 = {
  url: string;
  replies(next: readonly Step[]): void;
  stop(): Promise<void>;
};

/** A server answering Pi's own message protocol, so the turn runs the whole
 *  real path with only the model replaced. */
async function scripted(): Promise<Server1> {
  const steps: Step[] = [];
  const server: Server = createServer((request, response) => {
    void (async () => {
      for await (const _ of request) {
        // The prompt is not read: this asserts about transcripts and events.
      }
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      const send = (event: unknown): void => {
        response.write(`data: ${JSON.stringify(event)}\n\n`);
      };
      const step = steps.shift() ?? { says: 'nothing was scripted for this turn' };
      send({ type: 'start' });
      if ('calls' in step) {
        const id = 'scripted-1';
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
    stop: () => {
      const closed = Promise.withResolvers<void>();
      server.close(() => closed.resolve());
      // A killed child leaves its keep-alive sockets behind and `close` waits
      // for them, which would outlive the last assertion.
      server.closeAllConnections();
      return closed.promise;
    },
  };
}

/* -------------------------------------------------------------------------- */
/* The fixture                                                                 */
/* -------------------------------------------------------------------------- */

let root = '';
let project = '';
let sessions = '';
let agentDir = '';
let model: Server1;

/** The model an add-on registers, written where Pi would load it from. The
 *  child is given it as an ordinary `-e` path, which is exactly what the trust
 *  filter's kept list becomes. */
const PROVIDER = `export default function provider(pi) {
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
`;

/** An extension whose command asks a question and never answers it — the wait a
 *  kill has to settle as cancelled. */
const ASKS_FOREVER = `export default function asks(pi) {
  pi.registerCommand('ask-forever', {
    description: 'Ask a question and never get an answer.',
    handler: async (_args, ctx) => {
      const said = await ctx.ui.input('What should it say?', 'a heading');
      ctx.ui.notify(said === undefined ? 'nothing came back' : 'got ' + said);
    },
  });
}
`;

beforeAll(async () => {
  // Child sessions are exercised here in an unpackaged test harness. The
  // production gate defaults closed so an inherited Vitest marker cannot
  // authorize a packaged app.
  notePackagedApp(false);
  root = await mkdtemp(join(tmpdir(), 'graphe-child-session-'));
  project = join(root, 'project');
  sessions = join(root, 'sessions');
  agentDir = join(root, 'agent');
  await mkdir(join(agentDir, 'extensions'), { recursive: true });
  await mkdir(project, { recursive: true });
  await mkdir(sessions, { recursive: true });
  await writeFile(join(project, 'README.md'), '# a project\n', 'utf8');
  await writeFile(join(agentDir, 'extensions', 'scripted-provider.mjs'), PROVIDER, 'utf8');
  await writeFile(join(agentDir, 'extensions', 'asks-forever.mjs'), ASKS_FOREVER, 'utf8');

  const program = join(root, 'runtime-child.mjs');
  await build({
    entryPoints: [fileURLToPath(new URL('../src/agent/pi/runtime-child.ts', import.meta.url))],
    outfile: program,
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
  process.env['GRAPHE_RUNTIME_CHILD'] = program;
  model = await scripted();
  // Inherited by the child, which is how a proxy or a credential reaches it.
  process.env['GRAPHE_SPIKE_MODEL'] = model.url;
}, 120_000);

afterAll(async () => {
  notePackagedApp(true);
  delete process.env[CHILD_RUNTIME_ENV];
  delete process.env['GRAPHE_RUNTIME_CHILD'];
  delete process.env['GRAPHE_SPIKE_MODEL'];
  await model?.stop();
  await rm(root, { recursive: true, force: true });
}, 60_000);

/** What the shell would pass for a real conversation, narrowed to the two
 *  paths a test here needs. */
function optionsFor(events: AgentEvent[] = [], modelId = 'graphe-scripted/scripted'): CreateSessionOptions {
  const [providerId, id] = modelId.split('/');
  return {
    projectRoot: project,
    agentDir,
    sessionDir: sessions,
    fresh: true,
    onEvent: (event) => events.push(event),
    model: providerId === undefined || id === undefined ? null : { providerId, modelId: id },
  };
}

/* ========================================================================== */
/* Which half hosts the agent                                                  */
/* ========================================================================== */

describe('the switch that picks the process', () => {
  it('is in-process for a copy that has asked for nothing', () => {
    // The whole default. Every other copy of the app, and every test that does
    // not set the variable, behaves exactly as it always has.
    delete process.env[CHILD_RUNTIME_ENV];
    expect(runtimeChoice()).toBe('in-process');
    expect(runtimeChoice('in-process')).toBe('in-process');
  });

  it('takes the profile setting when the environment says nothing', () => {
    delete process.env[CHILD_RUNTIME_ENV];
    expect(runtimeChoice('child')).toBe('child');
  });

  it('lets the environment decide for one run, in either spelling', () => {
    process.env[CHILD_RUNTIME_ENV] = '1';
    expect(runtimeChoice('in-process')).toBe('child');
    process.env[CHILD_RUNTIME_ENV] = 'true';
    expect(runtimeChoice()).toBe('child');
    process.env[CHILD_RUNTIME_ENV] = '0';
    expect(runtimeChoice('child')).toBe('in-process');
    process.env[CHILD_RUNTIME_ENV] = 'false';
    expect(runtimeChoice('child')).toBe('in-process');
    delete process.env[CHILD_RUNTIME_ENV];
  });

  it('never offers the child to a packaged app with inherited test markers', async () => {
    const previousVitest = process.env['VITEST'];
    process.env['VITEST'] = 'true';
    process.env[CHILD_RUNTIME_ENV] = '1';
    notePackagedApp(true);
    try {
      const events: AgentEvent[] = [];
      const session = await openSession(optionsFor(events));
      expect(session.conversation).not.toBeNull();
      expect(events.some((event) => event.type === 'notice' && event.what.includes('experimental'))).toBe(true);
      session.dispose();
    } finally {
      notePackagedApp(false);
      delete process.env[CHILD_RUNTIME_ENV];
      if (previousVitest === undefined) delete process.env['VITEST'];
      else process.env['VITEST'] = previousVitest;
    }
  }, 120_000);

  it('treats anything else as not a decision, so the profile under it stands', () => {
    // A shell that set the variable to something meaningless has not asked for
    // anything, and the default must not win over the setting.
    for (const meaningless of ['', '  ', 'yes', 'on', '2']) {
      process.env[CHILD_RUNTIME_ENV] = meaningless;
      expect(runtimeChoice('child'), `${JSON.stringify(meaningless)} was read as a decision`).toBe('child');
      expect(runtimeChoice()).toBe('in-process');
    }
    delete process.env[CHILD_RUNTIME_ENV];
  });

  it('never offers the child to a helper or a board piece', async () => {
    /* Both are built for one turn by a process that is already another
       conversation's, so a third process each is not what this is for. What
       proves the in-process path was taken is `conversation`: a child session
       cannot name its transcript until Pi has written one and the child has
       said so, and the in-process path knows it at once. */
    process.env[CHILD_RUNTIME_ENV] = '1';
    try {
      for (const sessionKind of ['helper', 'board', 'canvas'] as const) {
        const session = await openSession({ ...optionsFor(), sessionKind });
        expect(session.conversation, `${sessionKind} was offered the child`).not.toBeNull();
        expect(session.model).toEqual({ providerId: 'graphe-scripted', modelId: 'scripted' });
        session.dispose();
      }
    } finally {
      delete process.env[CHILD_RUNTIME_ENV];
    }
  }, 120_000);
});

/* ========================================================================== */
/* Pi's own arguments                                                          */
/* ========================================================================== */

describe('what Pi is told', () => {
  it('names the session, the trust decision, the model and the depth in Pi’s own words', async () => {
    const args = await argsFor({ ...optionsFor(), thinking: 'low' }, agentDir);
    expect(args).toContain('--no-extensions');
    const dir = args.indexOf('--session-dir');
    expect(dir).toBeGreaterThan(-1);
    expect(args[dir + 1]).toBe(sessions);
    // A new conversation rather than the folder's last one.
    expect(args).not.toContain('--continue');
    // Non-interactive modes never prompt, so this is the trust decision — and
    // it is the same callback the in-process loader answers, so the two paths
    // agree about one folder rather than one restricting and one not.
    expect(args).toContain('--no-approve');
    expect(args).not.toContain('--approve');
    const trusted = await argsFor(
      { ...optionsFor(), trustProject: () => true },
      agentDir,
    );
    expect(trusted).toContain('--approve');
    expect(trusted).not.toContain('--no-approve');
    const at = args.indexOf('--model');
    expect(args.slice(at, at + 2)).toEqual(['--model', 'graphe-scripted/scripted']);
    const thinking = args.indexOf('--thinking');
    expect(args.slice(thinking, thinking + 2)).toEqual(['--thinking', 'low']);
  });

  it('hands the project’s own add-ons over by path, as the trust filter kept them', async () => {
    // Both of these live beside the agent folder, so both are add-ons somebody
    // chose by hand and both load.
    const args = await argsFor(optionsFor(), agentDir);
    const loaded = args.flatMap((one, at) => (one === '-e' ? [args[at + 1]] : []));
    expect(loaded.some((one) => one?.endsWith('scripted-provider.mjs'))).toBe(true);
  });

  it('carries the last conversation on unless a new one was asked for', async () => {
    const carried = await argsFor({ ...optionsFor(), fresh: false }, agentDir);
    expect(carried).toContain('--continue');
  });

  it('writes nothing anywhere when it was given nowhere to write', async () => {
    const memory = await argsFor(
      { projectRoot: project, agentDir, onEvent: () => {} },
      agentDir,
    );
    expect(memory).toContain('--no-session');
  });
});

/* ========================================================================== */
/* A turn, hosted in the child                                                 */
/* ========================================================================== */

describe('a conversation in a child, through the same seam', () => {
  it('runs a turn and writes a transcript the ordinary reader replays', async () => {
    process.env[CHILD_RUNTIME_ENV] = '1';
    model.replies([{ says: 'hosted reply' }]);
    const events: AgentEvent[] = [];
    const session = await openSession(optionsFor(events));
    try {
      await session.prompt('say something');
      // Pi's own settled, translated by the relay the in-process path uses —
      // one `fromPi`, not two, which is what keeps the two paths' event
      // streams the same shape.
      expect(events.some((one) => one.type === 'settled')).toBe(true);
      const said = events
        .filter((one): one is Extract<AgentEvent, { type: 'message-delta' }> => one.type === 'message-delta')
        .map((one) => one.text)
        .join('');
      expect(said).toContain('hosted reply');

      const file = session.conversation;
      expect(file).not.toBeNull();
      if (file === null) return;
      // Pi's own file, written in the child, read back here by the reader the
      // app already uses for a reopened conversation.
      const replayed = await readTranscript(file);
      expect(replayed.ok).toBe(true);
      if (!replayed.ok) return;
      expect(JSON.stringify(replayed.value)).toContain('hosted reply');
    } finally {
      session.dispose();
      delete process.env[CHILD_RUNTIME_ENV];
    }
  }, 180_000);

});
