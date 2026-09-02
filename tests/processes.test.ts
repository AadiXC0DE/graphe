/** The ledger of everything the app started.
 *
 * The failure it exists for is the one nobody sees: quit the app, and the
 * development server it started is still holding a port and half a gigabyte
 * with nobody left who can stop it. So these spawn real children and check that
 * none of them are there afterwards — including one that refuses to take the
 * hint.
 *
 * The second half walks every place in `src/` that starts a process and checks
 * that it says so, and says so again when it is over. A spawn site nobody wrote
 * down is exactly the one that survives a quit.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { addonProcesses, alive, ledger, type Spawned } from '../electron/processes';
import { defaultHost } from '../src/agent/pi/computer';
import { McpRegistry } from '../src/agent/pi/mcp';
import { taskTool } from '../src/agent/pi/tools';
import { runHelper } from '../src/share/run';
import { watchWhatWeStart } from '../src/share/spawned';

vi.setConfig({ testTimeout: 30_000 });

const onUnix = process.platform !== 'win32';
const started: ChildProcess[] = [];

/** A child that will outlive the test unless something ends it. */
function sleeper(command = 'sleep 30'): ChildProcess {
  const child = spawn('sh', ['-c', command], { detached: true, stdio: 'ignore' });
  child.unref();
  started.push(child);
  return child;
}

function ended(child: ChildProcess): Promise<void> {
  return new Promise((done) => {
    if (child.exitCode !== null || child.signalCode !== null) return done();
    child.once('exit', () => done());
  });
}

function noted(pid: number, kind: Spawned['kind'] = 'server'): Spawned {
  return { pid, what: 'a test child', kind, at: Date.now() };
}

afterEach(() => {
  for (const child of started.splice(0)) {
    try {
      if (child.pid !== undefined) process.kill(-child.pid, 'SIGKILL');
    } catch {
      /* already gone, which is the point of most of these */
    }
  }
});

describe('the ledger', () => {
  it('holds what it was told and hands it back', () => {
    const led = ledger();
    led.note(noted(4120, 'helper'));
    led.note({ ...noted(4121, 'server'), project: '/Users/someone/site' });
    expect(led.all()).toHaveLength(2);
    expect(led.all()[0]?.kind).toBe('helper');
  });

  it('forgets one that ended on its own', () => {
    const led = ledger();
    led.note(noted(4120));
    led.gone(4120);
    expect(led.all()).toEqual([]);
  });

  it('does not note the same process twice', () => {
    const led = ledger();
    led.note(noted(4120));
    led.note(noted(4120));
    expect(led.all()).toHaveLength(1);
  });

  it('says what it is holding, with the real pids', () => {
    const led = ledger();
    led.note(noted(4120, 'helper'));
    led.note(noted(4121, 'helper'));
    led.note(noted(4122, 'server'));
    const said = led.says();
    expect(said).toContain('2 helpers');
    expect(said).toContain('1 server');
    expect(said).toContain('4122');
  });

  it('says so when there is nothing', () => {
    expect(ledger().says()).toContain('nothing');
  });
});

describe('ending everything', () => {
  it.runIf(onUnix)('leaves nothing running', async () => {
    const led = ledger();
    const kids = [sleeper(), sleeper()];
    const pids = kids.map((child) => child.pid ?? 0);
    for (const pid of pids) led.note(noted(pid));

    const killed = await led.killAll(300);
    await Promise.all(kids.map(ended));

    for (const pid of pids) {
      expect(killed).toContain(pid);
      expect(alive(pid)).toBe(false);
    }
    expect(led.all()).toEqual([]);
  });

  it.runIf(onUnix)('ends one that ignores being asked', async () => {
    const led = ledger();
    const stubborn = sleeper('trap "" TERM; sleep 30');
    const pid = stubborn.pid ?? 0;
    led.note(noted(pid));

    await led.killAll(200);
    await ended(stubborn);
    expect(alive(pid)).toBe(false);
  });

  it.runIf(onUnix)('does not mind a process that has already gone', async () => {
    const led = ledger();
    const child = sleeper('exit 0');
    await ended(child);
    led.note(noted(child.pid ?? 0));

    await expect(led.killAll(50)).resolves.toEqual([]);
  });

  it('answers at once when it was holding nothing', async () => {
    await expect(ledger().killAll()).resolves.toEqual([]);
  });

  it.runIf(onUnix)('ends everything without waiting, for the quit handler', async () => {
    const led = ledger();
    const kids = [sleeper(), sleeper('trap "" TERM; sleep 30')];
    const pids = kids.map((child) => child.pid ?? 0);
    for (const pid of pids) led.note(noted(pid));

    expect(led.killAllNow()).toEqual(pids);
    await Promise.all(kids.map(ended));
    for (const pid of pids) expect(alive(pid)).toBe(false);
    expect(led.all()).toEqual([]);
  });
});

describe('processes somebody else started', () => {
  it.runIf(onUnix)('counts a child nothing noted', async () => {
    const child = sleeper();
    const pid = child.pid ?? 0;
    const counted = await addonProcesses(process.pid);
    expect(counted).toBeGreaterThanOrEqual(1);

    // And not, once the ledger accounts for it.
    const withoutIt = await addonProcesses(process.pid, [pid]);
    expect(withoutIt).toBeLessThan(counted);
  });

  it('answers zero rather than failing on a pid that is not there', async () => {
    await expect(addonProcesses(2 ** 30)).resolves.toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* What each spawn writes down                                                 */
/* -------------------------------------------------------------------------- */

const folders: string[] = [];

async function newFolder(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), 'graphe-spawned-'));
  folders.push(folder);
  return folder;
}

/** A connected tool server that answers nothing and stays up until it is
 *  closed. Enough to have a real child on the other end of a real transport. */
async function stubServer(): Promise<string> {
  const sdk = resolve('node_modules/@modelcontextprotocol/sdk/dist/esm');
  const file = join(await newFolder(), 'server.mjs');
  await writeFile(
    file,
    `import { Server } from ${JSON.stringify(`${sdk}/server/index.js`)};
import { StdioServerTransport } from ${JSON.stringify(`${sdk}/server/stdio.js`)};
import { ListToolsRequestSchema } from ${JSON.stringify(`${sdk}/types.js`)};
const server = new Server({ name: 'stub', version: '1' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [] }));
await server.connect(new StdioServerTransport());
`,
    'utf8',
  );
  return file;
}

/** The helper program, which only exists in a built copy of the app. A
 *  stand-in that reports once and stops is enough to have a real child. */
async function helperProgram(): Promise<string> {
  const file = join(await newFolder(), 'helper.mjs');
  await writeFile(
    file,
    `process.stdin.resume();
process.stdin.on('end', () => {
  console.log(JSON.stringify({ type: 'done', outcome: { ok: true, text: 'reported' } }));
});
`,
    'utf8',
  );
  return file;
}

afterAll(async () => {
  await Promise.all(folders.splice(0).map((one) => rm(one, { recursive: true, force: true })));
});

/** The seam every corner of `src/` starts a process through. Real children
 *  here, because the claim is about the spawn sites and not about the map. */
function watching(): { rows: Spawned[]; gone: number[] } {
  const rows: Spawned[] = [];
  const gone: number[] = [];
  watchWhatWeStart({
    started: (one) => rows.push({ ...one, at: Date.now() }),
    ended: (pid) => gone.push(pid),
  });
  return { rows, gone };
}

/** A row closing is one event later than the call that started it. */
async function until(that: () => boolean): Promise<void> {
  for (let look = 0; look < 200 && !that(); look += 1) {
    await new Promise((done) => setTimeout(done, 25));
  }
  expect(that()).toBe(true);
}

function rowFor(rows: readonly Spawned[], what: string): Spawned {
  const found = rows.find((one) => one.what === what);
  expect(found, `nothing written down for ${what}`).toBeDefined();
  return found as Spawned;
}

describe('what each spawn writes down', () => {
  afterEach(() => {
    watchWhatWeStart(null);
    delete process.env['GRAPHE_HELPER_PROGRAM'];
  });

  it.runIf(onUnix)('an outside command, as a tool', async () => {
    const seen = watching();
    await runHelper('sh', ['-c', 'exit 0'], { folder: tmpdir() });

    const row = rowFor(seen.rows, 'sh');
    expect(row.kind).toBe('tool');
    await until(() => seen.gone.includes(row.pid));
  });

  it.runIf(onUnix)('the browser, as a browser', async () => {
    const seen = watching();
    await defaultHost(tmpdir())('sh', ['-c', 'exit 0'], {});

    const row = rowFor(seen.rows, 'sh');
    expect(row.kind).toBe('browser');
    await until(() => seen.gone.includes(row.pid));
  });

  it('a connected tool server, as an add-on server', async () => {
    const seen = watching();
    const registry = new McpRegistry({
      servers: [{ name: 'stub', command: process.execPath, args: [await stubServer()] }],
    });
    await registry.toolsOf('stub');

    const row = rowFor(seen.rows, 'stub');
    expect(row.kind).toBe('mcp');
    expect(alive(row.pid)).toBe(true);

    await registry.close();
    await until(() => seen.gone.includes(row.pid));
  });

  /* The one connected server that is a language server rather than a tool
     server, so the ledger says which it is holding. */
  it('a read of the code, as a language server', async () => {
    const seen = watching();
    const registry = new McpRegistry({
      servers: [{ name: 'code-read', command: process.execPath, args: [await stubServer()] }],
    });
    await registry.toolsOf('code-read');

    expect(rowFor(seen.rows, 'code-read').kind).toBe('lsp');
    await registry.close();
  });

  it.runIf(onUnix)('a helper agent, as a helper', async () => {
    process.env['GRAPHE_HELPER_PROGRAM'] = await helperProgram();
    const seen = watching();
    await taskTool(await newFolder()).execute(
      'call-1',
      { task: 'Say what you can see and stop.' },
      undefined,
      undefined,
      undefined as never,
    );

    const row = rowFor(seen.rows, 'helper agent');
    await until(() => seen.gone.includes(row.pid));
  });
});
