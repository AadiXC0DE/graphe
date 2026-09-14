/** A project's tool servers: what may be written into the file, and what is
 *  allowed to start before somebody has said yes.
 *
 * 9.5 asks that scope and command/arguments are validated, that a project's
 * config is trusted before its code runs, and that secrets in it are references
 * or redacted values. Three of those are readable from here with no network:
 * the file is the project's own and nothing else's, reading or listing it
 * starts nothing, and a value named like a secret is never printed back. The
 * gate that actually decides whether a project server runs is the Guard, and
 * that is a real function too.
 *
 * The start-line refusals (shell metacharacters, odd names, a duplicate name, a
 * key pasted into the panel) are already proven in `tests/mcp.test.ts`; what is
 * here is the file the project keeps, rather than the form somebody fills in.
 */

import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { afterAll, describe, expect, it, vi } from 'vitest';

import { evaluate, type GuardFacts } from '../../src/agent/guard/policy';
import { McpRegistry, mcpFile, readMcpConfig, type McpServerConfig } from '../../src/agent/pi/mcp';
import { describeStart, readReach, whereOf } from '../../src/agent/pi/reach';

vi.setConfig({ testTimeout: 30_000 });

const made: string[] = [];

afterAll(async () => {
  await Promise.all(made.map((folder) => rm(folder, { recursive: true, force: true })));
});

async function project(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'graphe-ops-mcpconfig-')));
  made.push(root);
  return root;
}

async function put(root: string, servers: readonly McpServerConfig[]): Promise<void> {
  await mkdir(dirname(mcpFile(root)), { recursive: true });
  await writeFile(mcpFile(root), `${JSON.stringify({ servers }, null, 2)}\n`, 'utf8');
}

/** A real stdio server that leaves a mark on disk the moment it is started, so
 *  "nothing ran" is a fact rather than a reading of the source. */
const MARKING_SERVER = (sdk: string, mark: string): string => `import { writeFileSync } from 'node:fs';
import { Server } from ${JSON.stringify(`${sdk}/server/index.js`)};
import { StdioServerTransport } from ${JSON.stringify(`${sdk}/server/stdio.js`)};
import { ListToolsRequestSchema, CallToolRequestSchema } from ${JSON.stringify(`${sdk}/types.js`)};
writeFileSync(${JSON.stringify(mark)}, 'started');
const server = new Server({ name: 'marking', version: '1' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{ name: 'ping', description: 'answers', inputSchema: { type: 'object', properties: {} } }],
}));
server.setRequestHandler(CallToolRequestSchema, async () => ({ content: [{ type: 'text', text: 'pong' }] }));
await server.connect(new StdioServerTransport());
`;

async function markingServer(): Promise<{ file: string; mark: string }> {
  const folder = await project();
  const file = join(folder, 'server.mjs');
  const mark = join(folder, 'started.marker');
  await writeFile(file, MARKING_SERVER(resolve('node_modules/@modelcontextprotocol/sdk/dist/esm'), mark), 'utf8');
  return { file, mark };
}

async function exists(at: string): Promise<boolean> {
  try {
    await stat(at);
    return true;
  } catch {
    return false;
  }
}

/* ========================================================================== */

describe('the scope of a project config', () => {
  it('is the project folder and nothing above it', async () => {
    const root = await project();
    const nested = join(root, 'app');
    await mkdir(nested, { recursive: true });
    await put(root, [{ name: 'above', command: 'echo', args: ['hi'] }]);

    expect(mcpFile(nested)).toBe(join(nested, '.pi', 'mcp.json'));
    // The file beside it belongs to the folder above, not to this project.
    const read = await readMcpConfig(nested);
    expect(read.servers).toEqual([]);
    expect(read.trouble ?? null).toBeNull();
  });

  it('says nothing rather than guessing when there is no file', async () => {
    const read = await readMcpConfig(await project());
    expect(read.servers).toEqual([]);
    expect(read.trouble ?? null).toBeNull();
  });
});

describe('what a project config can start', () => {
  it('starts nothing just by being read or listed', async () => {
    const root = await project();
    const { file, mark } = await markingServer();
    await put(root, [{ name: 'marking', command: process.execPath, args: [file], cwd: root }]);

    const read = await readMcpConfig(root);
    expect(read.servers.map((one) => one.name)).toEqual(['marking']);
    const registry = new McpRegistry(read);
    expect(await registry.list()).toContain('marking');
    expect(await exists(mark)).toBe(false);

    // The control: the same entry does start when something asks it for a tool,
    // so the marker above was the app holding back rather than a mark that
    // could never appear.
    expect(await registry.call('marking', 'ping', {})).toBe('pong');
    expect(await exists(mark)).toBe(true);
    await registry.close();
  });

  /* The one gate between a project's file and a program running on this
     computer is the Guard: every call to a configured server is a question, and
     so is writing another one into the file. Nothing else consults trust, so
     this is what "trusted before it is started" means in practice. */
  it('is a question every time one of its tools is called', async () => {
    const root = await project();
    const facts: GuardFacts = { projectRoot: root };

    expect(evaluate({ id: '1', name: 'mcp', input: { server: 'marking', tool: 'ping', args: {} } }, facts).kind).toBe(
      'confirm',
    );
    expect(evaluate({ id: '2', name: 'mcp', input: { list: true } }, facts).kind).toBe('allow');
    expect(
      evaluate({ id: '3', name: 'connect_tool', input: { name: 'mine', known: 'figma' } }, facts).kind,
    ).toBe('confirm');
  });
});

describe('what a project config shows', () => {
  it('never prints the values a server was given', async () => {
    const root = await project();
    const { file } = await markingServer();
    await put(root, [
      {
        name: 'marking',
        command: process.execPath,
        args: [file],
        env: { LINEAR_TOKEN: 'sk-live-abcdefghijklmnop' },
      },
    ]);

    const read = await readMcpConfig(root);
    const said = await new McpRegistry(read).list();
    // The list the model reads names what is connected and how it starts. The
    // environment is what holds the key, and it is not part of that.
    expect(said).toContain('marking');
    expect(said).not.toContain('sk-live-abcdefghijklmnop');

    // The secret is in the file somebody wrote by hand — it is the *showing*
    // of it that must not happen, and the panel's own form covers it (see the
    // describeStart case below).
    expect(await readFile(mcpFile(root), 'utf8')).toContain('LINEAR_TOKEN');
  });

  it('covers a value named like a secret when it shows how it starts', () => {
    const read = readReach({
      name: 'linear',
      where: 'npx -y linear-mcp',
      values: 'LINEAR_TOKEN=sk-live-abcdefghijklmnop\nHOST=linear.example',
    });
    expect(read.ok).toBe(true);
    if (!read.ok) return;

    const shown = describeStart(read.reach.start);
    const token = shown.find((one) => one.label === 'LINEAR_TOKEN');
    const host = shown.find((one) => one.label === 'HOST');
    expect(token?.value).not.toContain('sk-live');
    // Covered on purpose, not by accident: it is the value that goes, and the
    // name stays so somebody can see which one is being kept.
    expect(host?.value).toBe('linear.example');
    expect(whereOf(read.reach.start)).not.toContain('sk-live');
  });

  /* A file that names one server twice lists it twice and keeps only the first,
     so the second entry is a line nobody can ever call and the model is told
     there are two. Recorded rather than fixed here: the reader and the writing
     form disagree, and making them agree is a change to src/agent/pi/mcp.ts. */
  it.fails('does not offer the same server twice under one name', async () => {
    const root = await project();
    const { file } = await markingServer();
    await put(root, [
      { name: 'twice', command: process.execPath, args: [file] },
      { name: 'twice', command: process.execPath, args: [file] },
    ]);

    const said = await new McpRegistry(await readMcpConfig(root)).list();
    const lines = said.split('\n').filter((line) => line.startsWith('- '));
    expect(lines).toHaveLength(1);
  });
});
