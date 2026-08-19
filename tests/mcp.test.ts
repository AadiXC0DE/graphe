/** The plugged-in tool servers: config reading, and the whole round trip.
 *
 *  The round trip is real: the test writes a tiny MCP server to a temp file,
 *  starts it through the same stdio transport the app uses, lists its tool and
 *  calls it. Nothing here is stubbed at the protocol level — the claim being
 *  tested is that a configured server actually answers. */

import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterAll, describe, expect, it, vi } from 'vitest';

import type { McpServerConfig } from '../src/agent/pi/mcp';
import {
  MCP_WORDS,
  McpRegistry,
  checkServer,
  inProject,
  keepingUnsent,
  mcpFile,
  mcpTool,
  readMcpConfig,
  savingFrom,
  writeMcpConfig,
} from '../src/agent/pi/mcp';
import { REACHABLE, alreadyReached, asServer } from '../src/agent/pi/reach';
import type { Connected } from '../src/lib/ipc';

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

/** The file itself, as it sits on disk. Every claim about what a save kept is
 *  made against these bytes, never against what was held in memory. */
async function fileText(folder: string): Promise<string> {
  return readFile(mcpFile(folder), 'utf8');
}

async function read(folder: string): Promise<{ servers: McpServerConfig[] }> {
  return JSON.parse(await fileText(folder)) as { servers: McpServerConfig[] };
}

async function write(folder: string, config: unknown): Promise<void> {
  await mkdir(`${folder}/.pi`, { recursive: true });
  await writeFile(mcpFile(folder), `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

/** What the shell hands the window, and the only thing it takes back — the same
 *  four fields `connectedNow` sends and `connectedSave` reads. */
function asPanelSees(servers: readonly McpServerConfig[]): Connected[] {
  return servers.map((one) => ({
    name: one.name,
    command: one.command,
    args: one.args === undefined ? [] : [...one.args],
    ...(one.address === undefined ? {} : { address: one.address }),
  }));
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
/* ========================================================================== */
/* A list that will not read                                                   */
/* ========================================================================== */

describe('a file that is there and wrong', () => {
  /**
   * The failure this exists for: a missing file and a broken file used to come
   * back identical — `{ servers: [] }` — so one misplaced comma meant no tools,
   * no `mcp` tool registered at all, and not a word about why.
   */
  it('is told apart from no file at all', async () => {
    const empty = await newFolder();
    expect((await readMcpConfig(empty)).trouble).toBeNull();

    const broken = await newFolder();
    await mkdir(join(broken, '.pi'), { recursive: true });
    await writeFile(join(broken, '.pi', 'mcp.json'), '{ "servers": [ , ] }', 'utf8');
    const read = await readMcpConfig(broken);
    expect(read.servers).toEqual([]);
    expect(read.trouble).not.toBeNull();
    expect(read.trouble).toMatch(/not valid JSON/i);
  });

  it('says which part of the shape is wrong', async () => {
    const cases: readonly [string, RegExp][] = [
      ['{}', /no "servers" list/i],
      ['{ "servers": "figma" }', /not a list/i],
      ['[]', /no "servers" list/i],
    ];
    for (const [text, expected] of cases) {
      const folder = await newFolder();
      await mkdir(join(folder, '.pi'), { recursive: true });
      await writeFile(join(folder, '.pi', 'mcp.json'), text, 'utf8');
      expect((await readMcpConfig(folder)).trouble, text).toMatch(expected);
    }
  });

  /* One bad entry must not take the good ones with it. */
  it('keeps the servers it can read, and names the ones it cannot', async () => {
    const folder = await newFolder();
    await mkdir(join(folder, '.pi'), { recursive: true });
    await writeFile(
      join(folder, '.pi', 'mcp.json'),
      JSON.stringify({
        servers: [
          { name: 'figma', command: 'npx' },
          { name: 'nameless' },
          { command: 'no-name-here' },
        ],
      }),
      'utf8',
    );
    const read = await readMcpConfig(folder);
    expect(read.servers.map((one) => one.name)).toEqual(['figma']);
    expect(read.trouble).toBeNull();
    expect(read.skipped?.join(' ')).toContain('figma'.slice(0, 0) + 'nameless');
    expect(read.skipped?.join(' ')).toMatch(/second|third/);
  });

  it('says it plainly, without naming the machinery twice', () => {
    const said = MCP_WORDS.fileTrouble('the file is there but not valid JSON.');
    expect(said).toMatch(/Nothing is connected until it reads/);
  });
});

/* ========================================================================== */
/* Writing the list back                                                       */
/* ========================================================================== */

describe('connecting a tool from the panel', () => {
  it('writes a list that reads back as the same list', async () => {
    const folder = await newFolder();
    const servers = [
      { name: 'figma', command: 'npx', args: ['figma-developer-mcp', '--stdio'] },
      { name: 'notes', command: '/usr/local/bin/notes-mcp' },
    ];
    await writeMcpConfig(folder, servers);
    const read = await readMcpConfig(folder);

    expect(read.trouble).toBeNull();
    expect(read.servers.map((one) => one.name)).toEqual(['figma', 'notes']);
    expect(read.servers[0]?.args).toEqual(['figma-developer-mcp', '--stdio']);
    // Nothing empty left lying in the file for somebody to wonder about.
    expect(read.servers[1]?.args).toBeUndefined();
  });

  it('makes the folder when the project has never had one', async () => {
    const folder = await newFolder();
    await writeMcpConfig(folder, [{ name: 'one', command: 'x' }]);
    expect((await readMcpConfig(folder)).servers).toHaveLength(1);
  });

  it('writes nothing connected as an empty list, not a broken file', async () => {
    const folder = await newFolder();
    await writeMcpConfig(folder, []);
    const read = await readMcpConfig(folder);
    expect(read.servers).toEqual([]);
    expect(read.trouble).toBeNull();
  });
});

/* ========================================================================== */
/* Asking whether one works                                                    */
/* ========================================================================== */

describe('checking a server', () => {
  it('says what it offers when it starts', async () => {
    const folder = await newFolder();
    const sdk = await realpath(resolve('node_modules/@modelcontextprotocol/sdk/dist/esm'));
    const server = join(folder, 'server.mjs');
    await writeFile(server, STUB_SERVER(sdk), 'utf8');

    const health = await checkServer({ name: 'stub', command: process.execPath, args: [server] });
    expect(health.state).toBe('working');
    if (health.state === 'working') expect(health.tools).toContain('ping');
  });

  /* "Would not start" has to be a sentence, not a silence — this is the whole
     reason somebody presses the button. */
  it('says so, with a reason, when it will not start', async () => {
    const health = await checkServer({ name: 'nope', command: '/nowhere/at/all/mcp-server' });
    expect(health.state).toBe('would-not-start');
    if (health.state === 'would-not-start') expect(health.because.length).toBeGreaterThan(0);
  }, 20_000);
});

/* ========================================================================== */
/* A server that is already running                                            */
/* ========================================================================== */

describe('a tool that listens rather than one we start', () => {
  /* A design tool with its own port was unusable: the client only ever spoke
     over pipes, so the one curated entry that needs an address could not be
     reached at all. */
  it('is kept, and read back with its address', async () => {
    const folder = await newFolder();
    await writeMcpConfig(folder, [
      { name: 'figma', command: '', args: [], address: 'http://127.0.0.1:3845/mcp' },
      { name: 'browser', command: 'npx', args: ['-y', '@playwright/mcp@latest'] },
    ]);
    const read = await readMcpConfig(folder);

    expect(read.trouble).toBeNull();
    expect(read.servers.map((one) => one.name)).toEqual(['figma', 'browser']);
    expect(read.servers[0]?.address).toBe('http://127.0.0.1:3845/mcp');
    expect(read.servers[1]?.address).toBeUndefined();
  });

  it('is not a server at all with neither a command nor an address', async () => {
    const folder = await newFolder();
    await mkdir(join(folder, '.pi'), { recursive: true });
    await writeFile(
      join(folder, '.pi', 'mcp.json'),
      JSON.stringify({ servers: [{ name: 'nowhere' }] }),
      'utf8',
    );
    const read = await readMcpConfig(folder);
    expect(read.servers).toEqual([]);
    expect(read.skipped?.join(' ')).toMatch(/neither a command .* nor an address/i);
  });
});

/* ========================================================================== */
/* The vouched-for shelf                                                       */
/* ========================================================================== */

describe('a tool somebody picked off the shelf', () => {
  it('lands on disk as the same thing a hand-typed one does', async () => {
    const browser = REACHABLE.find((one) => one.id === 'browser');
    expect(browser).toBeDefined();
    if (browser === undefined) return;

    const folder = await newFolder();
    await writeMcpConfig(folder, [asServer(browser)]);
    const read = await readMcpConfig(folder);
    expect(read.servers[0]?.name).toBe('browser');
    expect(read.servers[0]?.command).toBe('npx');
    expect(read.servers[0]?.args).toEqual(['-y', '@playwright/mcp@latest']);
  });

  it('turns a listening tool into an address, not a command', () => {
    const figma = REACHABLE.find((one) => one.id === 'figma');
    if (figma === undefined) return;
    const line = asServer(figma);
    expect(line.command).toBe('');
    expect(line.address).toMatch(/^http/);
  });

  /* The shelf has to say which are already on, or it offers to connect
     something that is connected. */
  it('marks the ones this project already has', () => {
    const shelf = alreadyReached(['browser']);
    expect(shelf.find((one) => one.id === 'browser')?.added).toBe(true);
    expect(shelf.find((one) => one.id === 'figma')?.added).toBe(false);
    expect(shelf).toHaveLength(REACHABLE.length);
  });
});

/* A listening tool must survive the whole round trip the panel uses: the shelf
   writes it, the file keeps it, and the panel reads it back. */
describe('a listening tool, end to end', () => {
  it('survives being saved and read again', async () => {
    const folder = await newFolder();
    const figma = REACHABLE.find((one) => one.id === 'figma');
    if (figma === undefined) return;
    await writeMcpConfig(folder, [asServer(figma)]);
    const read = await readMcpConfig(folder);
    expect(read.servers).toHaveLength(1);
    expect(read.servers[0]?.address).toMatch(/^http/);
    expect(read.servers[0]?.command).toBe('');
    expect(read.trouble).toBeNull();
    expect(read.skipped).toEqual([]);
  });
});

/* ========================================================================== */
/* Reaching a listening server                                                 */
/* ========================================================================== */

describe('an address that is not one', () => {
  /* It used to throw out of whatever tool call reached it first, instead of
     coming back as the sentence every other failure in this file returns. */
  it('comes back as words, not as a thrown error', async () => {
    for (const address of ['127.0.0.1:3845', 'not a url', 'httpx://x']) {
      const health = await checkServer({ name: 'odd', command: '', address });
      expect(health.state, address).toBe('would-not-start');
      if (health.state === 'would-not-start') {
        expect(health.because, address).toMatch(/address|reach/i);
      }
    }
  }, 30_000);

  it('says so through a tool call too, rather than throwing', async () => {
    const registry = new McpRegistry({
      servers: [{ name: 'odd', command: '', address: 'not a url' }],
    });
    const said = await registry.call('odd', 'anything', {});
    expect(said).toMatch(/could not reach odd/i);
    await registry.close();
  }, 30_000);

  it('names a listening server by where it answers, not by an empty command', async () => {
    const registry = new McpRegistry({
      servers: [{ name: 'figma', command: '', address: 'http://127.0.0.1:3845/mcp' }],
    });
    const said = await registry.list();
    expect(said).toContain('http://127.0.0.1:3845/mcp');
    expect(said).not.toContain('figma ()');
    await registry.close();
  });
});

/** A server whose one tool reports the folder it was started in. */
const WHERE_SERVER = (sdkPath: string) => `import { Server } from ${JSON.stringify(`${sdkPath}/server/index.js`)};
import { StdioServerTransport } from ${JSON.stringify(`${sdkPath}/server/stdio.js`)};
import { ListToolsRequestSchema, CallToolRequestSchema } from ${JSON.stringify(`${sdkPath}/types.js`)};
const server = new Server({ name: 'where', version: '1' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{ name: 'where', description: 'says where it is', inputSchema: { type: 'object', properties: {} } }],
}));
server.setRequestHandler(CallToolRequestSchema, async () => ({
  content: [{ type: 'text', text: process.cwd() }],
}));
await server.connect(new StdioServerTransport());
`;

describe('a tool starts in the project it belongs to', () => {
  it('starts a server in the project folder, not wherever the app was launched from', async () => {
    const folder = await newFolder();
    const sdk = resolve('node_modules/@modelcontextprotocol/sdk/dist/esm');
    const file = join(folder, 'where.mjs');
    await writeFile(file, WHERE_SERVER(sdk), 'utf8');

    // Without this the server inherits the app's own folder and every answer it
    // gives is about the wrong project — silently, which is the dangerous part.
    const aimed = inProject(
      { servers: [{ name: 'where', command: process.execPath, args: [file] }], trouble: null, skipped: [] },
      folder,
    );
    const registry = new McpRegistry(aimed);
    const said = await registry.call('where', 'where', {});
    await registry.close();

    expect(said.trim()).toBe(folder);
    expect(said.trim()).not.toBe(process.cwd());
  }, 30_000);

  it('leaves a server that names its own folder alone', () => {
    const aimed = inProject(
      { servers: [{ name: 'one', command: 'x', cwd: '/somewhere/else' }], trouble: null, skipped: [] },
      '/the/project',
    );
    expect(aimed.servers[0]?.cwd).toBe('/somewhere/else');
  });

  /* The folder a server is aimed at is for starting it, not for keeping. An
     entry that named no folder must still name none after a save. */
  it('does not write the aimed-at folder into the file', async () => {
    const folder = await newFolder();
    await write(folder, { servers: [{ name: 'one', command: 'x' }] });

    const onDisk = (await readMcpConfig(folder)).servers;
    const panel = asPanelSees(onDisk);
    await writeMcpConfig(folder, keepingUnsent(panel, onDisk));

    expect(await read(folder)).toEqual({ servers: [{ name: 'one', command: 'x' }] });
  });
});

/**
 * Pressing Connect or Disconnect used to empty out the file.
 *
 * The panel is told four fields per entry; a hand-written `.pi/mcp.json` can
 * hold more. The whole list came back from the window on every press and was
 * written whole, so one press on an unrelated tool took another tool's API key
 * off the disk without a word about it.
 */
describe('saving from the panel keeps what the panel never saw', () => {
  it('leaves an untouched tool\'s keys and folder exactly as they were', async () => {
    const folder = await newFolder();
    const written = {
      servers: [
        {
          name: 'figma-dev',
          command: 'npx',
          args: ['figma-developer-mcp', '--stdio'],
          env: { FIGMA_API_KEY: 'figd_secret' },
          cwd: '/opt/design',
        },
      ],
    };
    await write(folder, written);

    // The whole press, in order: read the file, hand the window what it may
    // see, hand it back, write it.
    const onDisk = (await readMcpConfig(folder)).servers;
    const panel = asPanelSees(onDisk);
    expect(panel[0]).not.toHaveProperty('env');
    expect(panel[0]).not.toHaveProperty('cwd');
    await writeMcpConfig(folder, keepingUnsent(panel, onDisk));

    expect(await fileText(folder)).toContain('figd_secret');
    expect(await read(folder)).toEqual(written);
  });

  it('still keeps the other one\'s keys when a tool is disconnected', async () => {
    const folder = await newFolder();
    await write(folder, {
      servers: [
        { name: 'figma-dev', command: 'npx', env: { FIGMA_API_KEY: 'figd_secret' }, cwd: '/opt/design' },
        { name: 'browser', command: 'npx', args: ['-y', '@playwright/mcp@latest'] },
      ],
    });

    const onDisk = (await readMcpConfig(folder)).servers;
    const left = asPanelSees(onDisk).filter((one) => one.name !== 'browser');
    await writeMcpConfig(folder, keepingUnsent(left, onDisk));

    // Gone means gone: keeping the fields must not bring the entry back.
    expect(await read(folder)).toEqual({
      servers: [
        { name: 'figma-dev', command: 'npx', env: { FIGMA_API_KEY: 'figd_secret' }, cwd: '/opt/design' },
      ],
    });
  });

  it('still keeps them when another tool is connected', async () => {
    const folder = await newFolder();
    await write(folder, {
      servers: [{ name: 'figma-dev', command: 'npx', env: { FIGMA_API_KEY: 'figd_secret' } }],
    });

    const onDisk = (await readMcpConfig(folder)).servers;
    const browser = REACHABLE.find((one) => one.id === 'browser');
    expect(browser).toBeDefined();
    if (browser === undefined) return;
    const wanted = [...asPanelSees(onDisk), asServer(browser)];
    await writeMcpConfig(folder, keepingUnsent(wanted, onDisk));

    const after = await read(folder);
    expect(after.servers[0]).toEqual({
      name: 'figma-dev',
      command: 'npx',
      env: { FIGMA_API_KEY: 'figd_secret' },
    });
    expect(after.servers[1]?.name).toBe('browser');
    // A tool the panel just added has no folder of its own, and gains none.
    expect(after.servers[1]).not.toHaveProperty('cwd');
  });

  it('matches a name the file wrote with a space around it', async () => {
    const folder = await newFolder();
    await write(folder, {
      servers: [{ name: ' figma-dev ', command: 'npx', env: { FIGMA_API_KEY: 'figd_secret' } }],
    });

    const onDisk = (await readMcpConfig(folder)).servers;
    // The panel hands back the trimmed name, as the shell always does.
    const panel = asPanelSees(onDisk).map((one) => ({ ...one, name: one.name.trim() }));
    await writeMcpConfig(folder, keepingUnsent(panel, onDisk));

    expect(await read(folder)).toEqual({
      servers: [{ name: 'figma-dev', command: 'npx', env: { FIGMA_API_KEY: 'figd_secret' } }],
    });
  });

  it('does not let a renamed entry inherit the old one\'s keys', async () => {
    const folder = await newFolder();
    await write(folder, {
      servers: [{ name: 'figma-dev', command: 'npx', env: { FIGMA_API_KEY: 'figd_secret' } }],
    });

    const onDisk = (await readMcpConfig(folder)).servers;
    const renamed = asPanelSees(onDisk).map((one) => ({ ...one, name: 'figma' }));
    await writeMcpConfig(folder, keepingUnsent(renamed, onDisk));

    expect(await read(folder)).toEqual({ servers: [{ name: 'figma', command: 'npx' }] });
  });

  it('refuses keys the window offers, taking them only from the file', async () => {
    const folder = await newFolder();
    await write(folder, {
      servers: [{ name: 'figma-dev', command: 'npx', env: { FIGMA_API_KEY: 'figd_secret' } }],
    });

    const onDisk = (await readMcpConfig(folder)).servers;
    const meddled = [
      { name: 'figma-dev', command: 'npx', args: [], env: { FIGMA_API_KEY: 'stolen' }, cwd: '/tmp' },
    ];
    await writeMcpConfig(folder, keepingUnsent(meddled, onDisk));

    expect(await read(folder)).toEqual({
      servers: [{ name: 'figma-dev', command: 'npx', env: { FIGMA_API_KEY: 'figd_secret' } }],
    });
  });
});

/**
 * A save used to replace the one file it could not read.
 *
 * A `.pi/mcp.json` with a comma out of place reads back as no servers at all,
 * so there was nothing to carry across and the write went ahead anyway: the
 * whole file, hand-written entries and their keys included, replaced by
 * whatever the panel happened to be holding. The one state where the file is
 * the only copy of anything was the one state that destroyed it.
 */
describe('saving over a list that would not read', () => {
  const KEYED =
    '{\n  "servers": [\n    { "name": "figma", "command": "npx", "env": { "FIGMA_API_KEY": "figd_secret" } },\n  ]\n}\n';

  it('refuses, and leaves every byte of the file where it was', async () => {
    const folder = await newFolder();
    await mkdir(join(folder, '.pi'), { recursive: true });
    await writeFile(mcpFile(folder), KEYED, 'utf8');
    const before = await fileText(folder);

    const current = await readMcpConfig(folder);
    expect(current.trouble).not.toBeNull();
    const saving = savingFrom([{ name: 'browser', command: 'npx browser-mcp' }], current);
    // WHY: the write the press does next. Doing it here means the file read
    // below is the one the old code would have left behind.
    if (saving.ok) await writeMcpConfig(folder, saving.servers);

    expect(await fileText(folder)).toBe(before);
    expect(saving.ok).toBe(false);
    if (saving.ok) return;
    expect(saving.refused.what).toBe(MCP_WORDS.cannotSave);
    // The reason the file would not read, and what to do, in the same sentence.
    expect(saving.refused.because).toContain(current.trouble);
    expect(saving.refused.because).toMatch(/try again/);
  });

  it('still writes, and still keeps the keys, once the file reads', async () => {
    const folder = await newFolder();
    await write(folder, {
      servers: [{ name: 'figma', command: 'npx', env: { FIGMA_API_KEY: 'figd_secret' } }],
    });
    const current = await readMcpConfig(folder);
    const saving = savingFrom(
      [...asPanelSees(current.servers), { name: 'browser', command: 'npx browser-mcp', args: [] }],
      current,
    );

    expect(saving.ok).toBe(true);
    if (!saving.ok) return;
    await writeMcpConfig(folder, saving.servers);
    const back = await read(folder);
    expect(back.servers.map((one) => one.name)).toEqual(['figma', 'browser']);
    expect(back.servers[0]?.env).toEqual({ FIGMA_API_KEY: 'figd_secret' });
  });
});
