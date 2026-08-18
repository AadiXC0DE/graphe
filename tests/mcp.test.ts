/** The plugged-in tool servers: config reading, and the whole round trip.
 *
 *  The round trip is real: the test writes a tiny MCP server to a temp file,
 *  starts it through the same stdio transport the app uses, lists its tool and
 *  calls it. Nothing here is stubbed at the protocol level — the claim being
 *  tested is that a configured server actually answers. */

import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterAll, describe, expect, it, vi } from 'vitest';

import { McpRegistry, mcpTool, readMcpConfig } from '../src/agent/pi/mcp';

vi.setConfig({ testTimeout: 30_000 });

const madeFolders: string[] = [];
afterAll(async () => {
  await Promise.all(madeFolders.map((folder) => rm(folder, { recursive: true, force: true })));
});

async function newFolder(): Promise<string> {
  const folder = await realpath(await mkdtemp(join(tmpdir(), 'graphe-mcp-')));
  madeFolders.push(folder);
  return folder;
}

/** A server that answers one tool: `ping` says `pong`. */
const STUB_SERVER = (sdkPath: string) => `import { Server } from ${JSON.stringify(`${sdkPath}/server/index.js`)};
import { StdioServerTransport } from ${JSON.stringify(`${sdkPath}/server/stdio.js`)};
import { ListToolsRequestSchema, CallToolRequestSchema } from ${JSON.stringify(`${sdkPath}/types.js`)};
const server = new Server({ name: 'stub', version: '1' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{ name: 'ping', description: 'answers pong', inputSchema: { type: 'object', properties: {} } }],
}));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = (request.params).name;
  if (name === 'ping') return { content: [{ type: 'text', text: 'pong' }] };
  throw new Error('no such tool: ' + name);
});
await server.connect(new StdioServerTransport());
`;

async function stubServer(): Promise<string> {
  const folder = await newFolder();
  const sdk = resolve('node_modules/@modelcontextprotocol/sdk/dist/esm');
  const file = join(folder, 'server.mjs');
  await writeFile(file, STUB_SERVER(sdk), 'utf8');
  return file;
}

describe('reading the project\'s .pi/mcp.json', () => {
  it('reads the servers it finds, and ignores the rest', async () => {
    const folder = await newFolder();
    await mkdir(join(folder, '.pi'));
    await writeFile(
      join(folder, '.pi/mcp.json'),
      JSON.stringify({
        servers: [
          { name: 'figma', command: 'npx', args: ['figma-mcp', '--stdio'] },
          { name: 'broken', command: 3 },
        ],
      }),
    );
    const config = await readMcpConfig(folder);
    expect(config.servers.length).toBe(1);
    expect(config.servers[0]?.name).toBe('figma');
  });

  it('answers with no servers when there is no file at all', async () => {
    const config = await readMcpConfig(await newFolder());
    expect(config.servers).toEqual([]);
  });
});

describe('a server, end to end', () => {
  it('lists, starts on first use, calls the tool, and closes', async () => {
    const server = await stubServer();
    const registry = new McpRegistry({
      servers: [{ name: 'stub', command: process.execPath, args: [server] }],
    });

    expect(await registry.list()).toContain('stub');

    const answered = await registry.call('stub', 'ping', {});
    expect(answered).toBe('pong');

    // A second call reuses the running server.
    expect(await registry.call('stub', 'ping', {})).toBe('pong');
    await registry.close();
  });

  it('names the server or the tool when either is unknown', async () => {
    const server = await stubServer();
    const registry = new McpRegistry({
      servers: [{ name: 'stub', command: process.execPath, args: [server] }],
    });
    const unknownServer = await registry.call('ghost', 'ping', {});
    expect(unknownServer).toContain('ghost');

    const unknownTool = await registry.call('stub', 'frobnicate', {});
    expect(unknownTool).toContain('frobnicate');
    await registry.close();
  });

  it('surfaces an error the server reports', async () => {
    const server = await stubServer();
    const registry = new McpRegistry({
      servers: [{ name: 'stub', command: process.execPath, args: [server] }],
    });
    const tool = mcpTool(registry);
    const result = await tool.execute(
      'call-1',
      { server: 'stub', tool: 'ping', args: {} },
      undefined,
      undefined,
      undefined as never,
    );
    const text = result.content.find((entry) => entry.type === 'text')?.text ?? '';
    expect(text).toBe('pong');
    await registry.close();
  });
});