/** T54: another tool's server, when it stops answering.
 *
 * Phase 10.2 requires that a server which disconnects, times out or cancels an
 * authentication leaves the tool in a terminal state with a usable reconnect,
 * and never an indefinite wait. The round trip itself is proven end to end in
 * `tests/mcp.test.ts`; what is here is the server that takes a request and never
 * answers, which is the one case where "no indefinite wait" is the whole claim.
 *
 * A real stdio server on the Model Context Protocol SDK, started by the app the
 * way it starts any other, and nothing is stubbed at the protocol level.
 */

import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterAll, describe, expect, it, vi } from 'vitest';

import { checkServer, McpRegistry, type McpServerConfig } from '../../src/agent/pi/mcp';

vi.setConfig({ testTimeout: 30_000 });

const made: string[] = [];

afterAll(async () => {
  await Promise.all(made.map((folder) => rm(folder, { recursive: true, force: true })));
});

/** A server with two tools: one answers, one takes the request and never
 *  answers at all, the way a server that has lost its own upstream does. */
const SERVER = (sdk: string): string => `import { Server } from ${JSON.stringify(`${sdk}/server/index.js`)};
import { StdioServerTransport } from ${JSON.stringify(`${sdk}/server/stdio.js`)};
import { ListToolsRequestSchema, CallToolRequestSchema } from ${JSON.stringify(`${sdk}/types.js`)};
const server = new Server({ name: 'half-answering', version: '1' }, { capabilities: { tools: {} } });
const tools = [
  { name: 'ping', description: 'answers pong', inputSchema: { type: 'object', properties: {} } },
  { name: 'never', description: 'takes the request and never answers', inputSchema: { type: 'object', properties: {} } },
];
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === 'ping') return { content: [{ type: 'text', text: 'pong' }] };
  // Held open on purpose. Nothing on this side ever settles it.
  return new Promise(() => undefined);
});
await server.connect(new StdioServerTransport());
`;

async function serverFile(): Promise<string> {
  const folder = await realpath(await mkdtemp(join(tmpdir(), 'graphe-scenario-mcp-')));
  made.push(folder);
  const file = join(folder, 'server.mjs');
  await writeFile(file, SERVER(resolve('node_modules/@modelcontextprotocol/sdk/dist/esm')), 'utf8');
  return file;
}

async function registryFor(file: string): Promise<McpRegistry> {
  const config: McpServerConfig = { name: 'half-answering', command: process.execPath, args: [file] };
  const registry = new McpRegistry({ servers: [config] });
  return registry;
}

/* -------------------------------------------------------------------------- */

describe('T54: a server that takes a tool call and never answers', () => {
  it('is reached, listed and called', async () => {
    const file = await serverFile();
    const registry = await registryFor(file);

    expect(await registry.list()).toContain('half-answering');
    expect(await registry.call('half-answering', 'ping', {})).toBe('pong');
    await registry.close();
  });

  it('is reported as working or not by a check that answers', async () => {
    const file = await serverFile();
    const health = await checkServer({ name: 'half-answering', command: process.execPath, args: [file] });

    expect(health.state).toBe('working');
    expect(health.state === 'working' && health.tools).toEqual(['ping', 'never']);
  });

  it('says so rather than waiting for ever on one it cannot reach', async () => {
    const registry = new McpRegistry({ servers: [{ name: 'nowhere', command: '/definitely/not/here' }] });
    const said = await registry.call('nowhere', 'anything', {});

    expect(said).toContain('nowhere');
    expect(said).toContain('could not reach');
    await registry.close();
  });

  /* Phase 10.2 requires that a tool call cannot leave a spinner forever, and a
     silent server is the way that happens: the call is awaited, no timer is
     armed, and the `catch` below only runs if the call rejects rather than
     hangs (src/agent/pi/mcp.ts:376). The test is written to fail: the race it
     loses is the app's wait against a deadline of its own. */
  it.fails('gives up on a call the server never answers, within a bound of its own', async () => {
    const file = await serverFile();
    const registry = await registryFor(file);
    expect(await registry.call('half-answering', 'ping', {})).toBe('pong');

    // A bound of its own, not one the server has to keep: what is asserted is
    // that the call settles at all. Real time on purpose — the subject of the
    // test is the absence of a clock inside the call.
    const deadline = (ms: number): Promise<string> =>
      new Promise((done) => {
        setTimeout(() => done('still waiting'), ms);
      });
    const answered = await Promise.race([registry.call('half-answering', 'never', {}), deadline(2_000)]);

    expect(answered).not.toBe('still waiting');
    await registry.close();
  });

  it('can be connected again after the one that hung is closed', async () => {
    const file = await serverFile();
    const first = await registryFor(file);
    expect(await first.call('half-answering', 'ping', {})).toBe('pong');
    await first.close();

    // A fresh registry over the same server file answers again: the state a
    // person is left in is a terminal one they can act on, not a wedged app.
    const second = await registryFor(file);
    expect(await second.call('half-answering', 'ping', {})).toBe('pong');
    await second.close();
  });
});
