/** A tool server that dies, or goes quiet, in the middle of a call.
 *
 * 9.5 asks that connect/list/call/cancel/reconnect work over stdio and that a
 * disconnected server cannot leave a spinner running. The round trip and the
 * server that never answers at all are already proven in
 * `tests/scenarios/mcp.test.ts`; what is here is the other two ways a call
 * stops being a call — the child that exits with the request in its hands, and
 * the caller that gives up — plus the arithmetic of the bound itself.
 *
 * A real stdio server on the Model Context Protocol SDK, started by the app the
 * way it starts any other. Nothing is stubbed at the protocol level, and
 * nothing here reaches the network.
 */

import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { afterAll, describe, expect, it, vi } from 'vitest';

import { McpRegistry, mcpTool, type McpServerConfig } from '../../src/agent/pi/mcp';

vi.setConfig({ testTimeout: 30_000 });

const made: string[] = [];

afterAll(async () => {
  await Promise.all(made.map((folder) => rm(folder, { recursive: true, force: true })));
});

/** Three tools worth distinguishing: one that answers, one that takes the
 *  request and holds it, and one whose process is gone before it can answer. */
const SERVER = (sdk: string): string => `import { Server } from ${JSON.stringify(`${sdk}/server/index.js`)};
import { StdioServerTransport } from ${JSON.stringify(`${sdk}/server/stdio.js`)};
import { ListToolsRequestSchema, CallToolRequestSchema } from ${JSON.stringify(`${sdk}/types.js`)};
const server = new Server({ name: 'perishing', version: '1' }, { capabilities: { tools: {} } });
const tools = [
  { name: 'ping', description: 'answers pong', inputSchema: { type: 'object', properties: {} } },
  { name: 'never', description: 'never answers', inputSchema: { type: 'object', properties: {} } },
  { name: 'die', description: 'exits with the request in hand', inputSchema: { type: 'object', properties: {} } },
];
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === 'ping') return { content: [{ type: 'text', text: 'pong' }] };
  if (request.params.name === 'die') process.exit(0);
  return new Promise(() => undefined);
});
await server.connect(new StdioServerTransport());
`;

async function serverFile(): Promise<string> {
  const folder = await realpath(await mkdtemp(join(tmpdir(), 'graphe-ops-mcp-')));
  made.push(folder);
  const file = join(folder, 'server.mjs');
  await writeFile(file, SERVER(resolve('node_modules/@modelcontextprotocol/sdk/dist/esm')), 'utf8');
  return file;
}

async function registryFor(file: string): Promise<McpRegistry> {
  const config: McpServerConfig = { name: 'perishing', command: process.execPath, args: [file] };
  return new McpRegistry({ servers: [config] });
}

/** The call as a sentence, whichever way it ends: an answer, a refusal, or
 *  still nothing at all by the deadline. */
async function said(call: Promise<unknown>, withinMs: number): Promise<string> {
  const settled = call.then(
    (text) => String(text),
    (cause: unknown) => (cause instanceof Error ? cause.message : String(cause)),
  );
  return Promise.race([settled, sleep(withinMs).then(() => 'still waiting')]);
}

async function withPatience<T>(ms: string, run: () => Promise<T>): Promise<T> {
  process.env['GRAPHE_MCP_CALL_MS'] = ms;
  try {
    return await run();
  } finally {
    delete process.env['GRAPHE_MCP_CALL_MS'];
  }
}

/* ========================================================================== */

describe('a server that dies holding a call', () => {
  it('ends the call rather than leaving it unanswered', async () => {
    const registry = await registryFor(await serverFile());
    expect(await said(registry.call('perishing', 'ping', {}), 5_000)).toBe('pong');

    const died = await said(registry.call('perishing', 'die', {}), 5_000);
    expect(died).not.toBe('still waiting');
    expect(died).toContain('die');
    expect(died).toContain('perishing');
    await registry.close();
  });

  it('does not leave the next call hanging on the corpse', async () => {
    const registry = await registryFor(await serverFile());
    expect(await said(registry.call('perishing', 'ping', {}), 5_000)).toBe('pong');
    void registry.call('perishing', 'die', {}).catch(() => undefined);
    await sleep(500);

    // The session is kept, so the second call goes to a client whose pipes are
    // closed. Whatever it says, it has to come back: a spinner is the defect.
    const second = await said(registry.call('perishing', 'ping', {}), 5_000);
    expect(second).not.toBe('still waiting');
    await registry.close();
  });

  it('lets the session close, and a new one answer again', async () => {
    const file = await serverFile();
    const first = await registryFor(file);
    expect(await said(first.call('perishing', 'ping', {}), 5_000)).toBe('pong');
    void first.call('perishing', 'die', {}).catch(() => undefined);
    await sleep(500);
    await expect(first.close()).resolves.toBeUndefined();

    const second = await registryFor(file);
    expect(await said(second.call('perishing', 'ping', {}), 5_000)).toBe('pong');
    await second.close();
  });
});

describe('the bound on a call', () => {
  it('says seconds when the bound is a second or more', async () => {
    const registry = await registryFor(await serverFile());
    const told = await withPatience('1500', () => said(registry.call('perishing', 'never', {}), 5_000));
    expect(told).toContain('did not answer within 2 seconds');
    await registry.close();
  });

  it('says milliseconds when it is shorter, so the sentence is not a lie', async () => {
    const registry = await registryFor(await serverFile());
    const told = await withPatience('400', () => said(registry.call('perishing', 'never', {}), 5_000));
    expect(told).toContain('did not answer within 400 milliseconds');
    await registry.close();
  });

  /* The bound is the app's; a caller that gives up should not have to wait it
     out. `mcpTool(...).execute` is handed Pi's call id and parameters, and the
     SDK's own cancellation path runs on the AbortSignal Pi passes beside them -
     which never reaches `McpRegistry.call` (src/agent/pi/mcp.ts:373, :484), so
     an aborted call waits for the patience to expire. Recorded, not papered
     over. */
  it.fails('stops early when the caller aborts', async () => {
    const registry = await registryFor(await serverFile());
    const controller = new AbortController();
    const run = mcpTool(registry).execute as unknown as (
      callId: string,
      params: Record<string, unknown>,
      signal: AbortSignal,
    ) => Promise<unknown>;

    await withPatience('5000', async () => {
      const call = run('call-1', { server: 'perishing', tool: 'never' }, controller.signal);
      void call.catch(() => undefined);
      setTimeout(() => controller.abort(), 50);
      const early = await Promise.race([
        call.then(() => 'settled', () => 'settled'),
        sleep(1_000).then(() => 'still waiting'),
      ]);
      expect(early).toBe('settled');
    });
    await registry.close();
  });
});
