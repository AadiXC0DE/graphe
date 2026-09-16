/** The commands and events the child session speaks, against the installed
 *  Pi's own documentation.
 *
 * Pi is pre-1.0 and has shipped three SDK-breaking changes in six weeks. The
 * child session is a client of Pi's RPC mode written against `docs/rpc.md`, and
 * the failure this prevents is the quiet one: Pi renames a command, the child
 * answers `success: false`, and a conversation stops being steerable — or a
 * dialog stops arriving — with nothing in the window saying why.
 *
 * So the names are asserted against the installed document rather than from
 * memory. A Pi bump that moves one of them fails here first, by name, before it
 * reaches a person. `tests/pinned-runtime.test.ts` holds the pin itself; this is
 * the half that says what the pin has to keep.
 *
 * It also starts one real child and asks it the commands that have no side
 * effect on a fresh session, so a command that is documented and *not served*
 * is caught too — documentation alone cannot say that.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startRuntime, type ChildRuntime } from '../electron/services/runtime-supervisor';
import { argsFor } from '../src/agent/pi/child-session';
import type { CreateSessionOptions } from '../src/agent/pi/adapter';

/* -------------------------------------------------------------------------- */
/* The document the child session is written against                           */
/* -------------------------------------------------------------------------- */

const PI = '@earendil-works/pi-coding-agent';
const appRoot = fileURLToPath(new URL('..', import.meta.url));
const DOC = join(appRoot, 'node_modules', PI, 'docs', 'rpc.md');

/** Every command `child-session.ts` sends. Read as a list rather than scraped
 *  out of the source: a test that derived the list from the code would agree
 *  with the code whatever either of them said. */
const COMMANDS = [
  'prompt',
  'steer',
  'abort',
  'get_state',
  'set_model',
  'set_thinking_level',
] as const;

/** Every event `child-session.ts` reads a field out of, the heading it is
 *  documented under, and the fields that code touches off the record. */
const EVENTS = [
  { name: 'agent_start', under: '### agent_start', fields: [] },
  { name: 'message_update', under: '### message_update', fields: ['assistantMessageEvent'] },
  {
    name: 'tool_execution_start',
    under: '### tool_execution_start',
    fields: ['toolCallId', 'toolName', 'args'],
  },
  {
    name: 'tool_execution_end',
    under: '### tool_execution_start',
    fields: ['toolCallId', 'toolName', 'result', 'isError'],
  },
  { name: 'agent_end', under: '### agent_end', fields: ['messages', 'willRetry'] },
  { name: 'agent_settled', under: '### agent_settled', fields: [] },
  // A request and a response are one sub-protocol with a heading of its own,
  // rather than an agent event with a section among the others.
  {
    name: 'extension_ui_request',
    under: '### Extension UI Requests (stdout)',
    fields: ['id', 'method'],
  },
] as const;

let doc = '';

beforeAll(async () => {
  doc = await readFile(DOC, 'utf8');
}, 30_000);

describe('the commands the child session speaks', () => {
  it('are the ones the installed Pi documents, by name', () => {
    for (const command of COMMANDS) {
      // A heading of its own is what a command has in this document; the
      // examples above it and the prose under it are not the contract.
      expect(doc, `${command} is not a heading in the installed docs/rpc.md`).toMatch(
        new RegExp(`^#### ${command}$`, 'm'),
      );
    }
  });

  it('are answered with the fields the child session reads', () => {
    // The response envelope itself, which every one of them shares.
    expect(doc).toMatch(/"type": "response"/);
    expect(doc).toMatch(/"success": true/);
    // `id` correlation, which is how this side matches an answer to its ask.
    expect(doc).toMatch(/optional `id` field for request\/response correlation/);

    // Per command: the one field this side reads off the answer.
    expect(doc, 'get_state must document the fields read off it').toMatch(
      /"sessionFile": "\/path\/to\/session\.jsonl"/,
    );
    expect(doc).toMatch(/"sessionName": "my-feature-work"/);
    expect(doc).toMatch(/"thinkingLevel": "medium"/);
    expect(doc, 'set_model must document the provider and modelId it is sent').toMatch(
      /"type": "set_model", "provider": .* "modelId":/,
    );
    expect(doc, 'set_thinking_level must document the level it is sent').toMatch(
      /"type": "set_thinking_level", "level": "high"/,
    );
    // `prompt` carries images in Pi's own envelope, which is what
    // `withPictures` builds, and the queue mode this side sends for a second
    // message — which the document lists rather than exemplifies.
    expect(doc).toMatch(/"mimeType": "image\/png"/);
    expect(doc).toContain('`streamingBehavior`');
    expect(doc).toContain('`"followUp"`: Wait until the agent finishes');
  });

  it('sends a prompt with the envelope the document spells', () => {
    const prompt = section('prompt');
    expect(prompt).toContain('"type": "prompt"');
    expect(prompt).toContain('"message"');

    const steer = section('steer');
    expect(steer).toContain('"type": "steer"');
    expect(steer).toContain('"message"');

    const abort = section('abort');
    expect(abort).toContain('{"type": "abort"}');

    const state = section('get_state');
    expect(state).toContain('{"type": "get_state"}');

    const model = section('set_model');
    expect(model).toContain('"provider"');
    expect(model).toContain('"modelId"');

    const thinking = section('set_thinking_level');
    expect(thinking).toContain('"level"');
    // The levels this side offers are Pi's own vocabulary, so the union in
    // `src/lib/ipc.ts` has to be a subset of what the document lists.
    for (const level of ['off', 'minimal', 'low', 'medium', 'high']) {
      expect(thinking, `${level} is not a documented thinking level`).toContain(`\`"${level}"\``);
    }
  });
});

describe('the events the child session reads', () => {
  it('are all in the document’s own event table', () => {
    const table = doc.slice(doc.indexOf('### Event Types'), doc.indexOf('### agent_start'));
    for (const event of EVENTS) {
      // The extension UI request is not an agent event: it is its own
      // sub-protocol, with its own section, and the test below reads that.
      if (event.name === 'extension_ui_request') continue;
      expect(table, `${event.name} is not in the installed event table`).toContain(`| \`${event.name}\` |`);
    }
    // And the one that is not in the table is documented where it lives.
    expect(doc).toContain('## Extension UI Protocol');
  });

  it('carry the fields the child session reads off them', () => {
    for (const event of EVENTS) {
      if (event.fields.length === 0) continue;
      const from = doc.indexOf(event.under);
      expect(from, `${event.under} is no longer in the document`).toBeGreaterThan(-1);
      // Up to the next heading at the same level or above: an event's own
      // section is where its fields are spelled out.
      const rest = doc.slice(from + event.under.length);
      const next = rest.search(/^#{2,3} /m);
      const where = next === -1 ? rest : rest.slice(0, next);
      for (const field of event.fields) {
        expect(where, `${event.name} no longer documents ${field}`).toContain(field);
      }
    }
  });

  it('says the framing is LF and only LF, which is what the reader assumes', () => {
    // The one place a mistake is silent rather than loud: `readline` splits on
    // U+2028 and U+2029 as well, and both are legal inside a JSON string.
    expect(doc).toContain('strict JSONL semantics with LF (`\\n`) as the only record delimiter');
    expect(doc).toContain('Node `readline` is not protocol-compliant');
  });

  it('documents the extension UI request and response pair', () => {
    const ui = doc.slice(doc.indexOf('## Extension UI Protocol'), doc.indexOf('## Error Handling'));
    // A request this side draws, and the two answers it can give.
    expect(ui).toContain('`type: "extension_ui_request"`, a unique `id`, and a `method` field');
    expect(ui).toContain('extension_ui_response');
    expect(ui).toContain('`cancelled: true`');
    // A method with no honest dialog is reported rather than answered, which is
    // only possible while the document lists them separately.
    for (const method of ['select', 'confirm', 'input', 'editor']) {
      expect(ui, `${method} is not documented as a dialog method`).toContain(`\`${method}\``);
    }
  });
});

/** One command's own section of the document, up to the next heading. */
function section(name: string): string {
  const from = doc.indexOf(`#### ${name}\n`);
  if (from === -1) return '';
  const rest = doc.slice(from + name.length);
  const next = rest.search(/^#{2,4} /m);
  return next === -1 ? rest : rest.slice(0, next);
}

describe('the version this contract was read off', () => {
  it('is the pinned one, so a Pi bump fails here first', async () => {
    const manifest = JSON.parse(await readFile(join(appRoot, 'package.json'), 'utf8')) as Record<string, unknown>;
    const pinned = (manifest['dependencies'] as Record<string, string>)[PI];
    const installed = JSON.parse(
      await readFile(join(appRoot, 'node_modules', PI, 'package.json'), 'utf8'),
    ) as Record<string, unknown>;
    /* The document these names were taken from is the one belonging to the
       version on disk. A bump that changes `docs/rpc.md` without changing the
       command names still shows up here, as a version mismatch beside the
       document this file asserts against — which is what "fails here first"
       has to mean for a pre-1.0 dependency. */
    expect(installed['version']).toBe(pinned);
    expect(inspected).toBe(pinned);
  });
});

/** The Pi version whose `docs/rpc.md` this file asserts against. Bump it in the
 *  same commit as the dependency, having read what moved. */
const inspected = '0.85.1';

/* -------------------------------------------------------------------------- */
/* One real child, so "documented" and "served" are both true                  */
/* -------------------------------------------------------------------------- */

const USAGE = {
  input: 1,
  output: 1,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 2,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

let root = '';
let project = '';
let sessions = '';
let agentDir = '';
let program = '';
let runtime: ChildRuntime | null = null;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'graphe-rpc-contract-'));
  project = join(root, 'project');
  sessions = join(root, 'sessions');
  agentDir = join(root, 'agent');
  await mkdir(project, { recursive: true });
  await mkdir(sessions, { recursive: true });
  await mkdir(join(agentDir, 'extensions'), { recursive: true });
  await writeFile(join(project, 'README.md'), '# a project\n', 'utf8');

  const provider = await scripted();
  await writeFile(
    join(agentDir, 'extensions', 'scripted-provider.mjs'),
    `export default function provider(pi) {
  pi.registerProvider('graphe-scripted', {
    name: 'Scripted test model',
    baseUrl: ${JSON.stringify(provider)},
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

  program = join(root, 'runtime-child.mjs');
  await build({
    entryPoints: [fileURLToPath(new URL('../src/agent/pi/runtime-child.ts', import.meta.url))],
    outfile: program,
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    minify: false,
    logLevel: 'silent',
    external: [PI],
    banner: {
      js: [
        "import { createRequire as __createRequire } from 'node:module';",
        'const require = __createRequire(import.meta.url);',
      ].join('\n'),
    },
  });
  process.env['GRAPHE_RUNTIME_CHILD'] = program;

  // The same arguments `argsFor` builds for a real conversation, so what is
  // being tested is the call the app really makes rather than one a test
  // invented.
  const options: CreateSessionOptions = {
    projectRoot: project,
    agentDir,
    sessionDir: sessions,
    fresh: true,
    model: { providerId: 'graphe-scripted', modelId: 'scripted' },
    onEvent: () => undefined,
  };
  runtime = await startRuntime({
    cwd: project,
    agentDir,
    args: await argsFor(options, agentDir),
    judge: () => Promise.resolve({ block: false }),
  });
}, 180_000);

afterAll(async () => {
  await runtime?.stop().catch(() => undefined);
  delete process.env['GRAPHE_RUNTIME_CHILD'];
  await rm(root, { recursive: true, force: true });
}, 60_000);

/** A model that answers Pi's own message protocol, so the child really boots
 *  with a model it can name. Without one there is no catalogue for `get_state`
 *  or `set_model` to answer about. */
async function scripted(): Promise<string> {
  const server: Server = createServer((request, response) => {
    void (async () => {
      for await (const _ of request) {
        // Nothing here reads the prompt: this file is about the shapes.
      }
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      const send = (event: unknown): void => {
        response.write(`data: ${JSON.stringify(event)}\n\n`);
      };
      send({ type: 'start' });
      send({ type: 'text_start', contentIndex: 0 });
      send({ type: 'text_delta', contentIndex: 0, delta: 'ok' });
      send({ type: 'text_end', contentIndex: 0, content: 'ok' });
      send({ type: 'done', reason: 'stop', usage: USAGE });
      response.end();
    })().catch(() => response.destroy());
  });
  const listening = Promise.withResolvers<void>();
  server.listen(0, '127.0.0.1', () => listening.resolve());
  await listening.promise;
  const at = server.address() as AddressInfo | null;
  if (at === null) throw new Error('the scripted model has no port');
  return `http://127.0.0.1:${String(at.port)}`;
}

describe('one real child, served rather than merely documented', () => {
  it('answers get_state with the fields the session reads off it', async () => {
    expect(runtime).not.toBeNull();
    if (runtime === null) return;
    const answer = await runtime.send({ type: 'get_state' });
    expect(answer['success']).toBe(true);
    expect(answer['command']).toBe('get_state');
    const data = answer['data'];
    expect(data).toBeTypeOf('object');
    const state = data as Record<string, unknown>;
    // Exactly the fields `Hosted` reads: the file the transcript is at, the
    // name on the shelf, how deep the model is thinking, and the room left.
    expect(state['sessionFile']).toBeTypeOf('string');
    expect(state['sessionFile']).toContain(sessions);
    expect(state['thinkingLevel']).toBeTypeOf('string');
    expect(state['model']).toBeTypeOf('object');
    const model = state['model'] as Record<string, unknown>;
    expect(model['provider']).toBe('graphe-scripted');
    expect(model['id']).toBe('scripted');
  }, 120_000);

  it('serves every command the child session sends', async () => {
    expect(runtime).not.toBeNull();
    if (runtime === null) return;
    // Only the ones with no side effect on a fresh session, and each is
    // asserted to be answered *as that command* — a name Pi moved would come
    // back as a failure, which is the whole failure this catches.
    for (const [command, body] of [
      ['set_thinking_level', { level: 'low' }],
      ['set_model', { provider: 'graphe-scripted', modelId: 'scripted' }],
      ['steer', { message: 'this goes nowhere yet' }],
    ] as const) {
      const answer = await runtime.send({ type: command, ...body });
      expect(answer['command'], `${command} was not answered as itself`).toBe(command);
      expect(answer['success'], `${command} was refused by the installed Pi`).toBe(true);
    }
  }, 120_000);

  it('answers abort as itself with nothing in flight', async () => {
    expect(runtime).not.toBeNull();
    if (runtime === null) return;
    const answer = await runtime.send({ type: 'abort' });
    expect(answer['command']).toBe('abort');
    expect(answer['success']).toBe(true);
  }, 120_000);

  it('streams the events the child session reads, in the document’s own names', async () => {
    expect(runtime).not.toBeNull();
    if (runtime === null) return;
    const seen: string[] = [];
    /** Pi's own `agent_settled`, which the session waits for. Resolved by the
     *  listener rather than by a clock, so the wait ends when the child ends it. */
    const settled = Promise.withResolvers<void>();
    const drop = runtime.onEvent((event) => {
      const type = event['type'];
      if (typeof type === 'string') seen.push(type);
      if (type === 'agent_settled') settled.resolve();
    });

    await runtime.send({ type: 'prompt', message: 'say something', streamingBehavior: 'followUp' });
    // The test's own patience is the only deadline here: a child that never
    // settles fails on it with every event it did send still in hand.
    await settled.promise;
    drop();

    for (const event of ['agent_start', 'message_update', 'agent_end', 'agent_settled'] as const) {
      expect(seen, `${event} never arrived from the installed Pi`).toContain(event);
    }
    expect(seen.length).toBeGreaterThan(3);
  }, 150_000);
});
