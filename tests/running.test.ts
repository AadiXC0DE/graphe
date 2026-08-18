/** Work that answers by staying up.
 *
 * Two things are tested here and they fail differently. The reading — what an
 * address looks like, what to call a piece — is language, and wrong means the
 * person is handed a link that goes nowhere. The register is a real process
 * holding a real port: wrong means either a turn that hangs forever or a server
 * that dies the moment the turn that started it ends, which are the two
 * failures this whole module exists to end.
 */

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { Running, addressIn, labelFor } from '../src/agent/running';
import { whichServersAreStray } from '../src/work/strays';

const PARTS = { shell: '/bin/bash', args: ['-c'] as const };
const kept: Running[] = [];

afterAll(() => {
  for (const one of kept) one.stopAll();
});

function register(): Running {
  const one = new Running();
  kept.push(one);
  return one;
}

function folderWithServer(): { folder: string; command: string } {
  const folder = mkdtempSync(join(tmpdir(), 'graphe-running-'));
  writeFileSync(
    join(folder, 'server.mjs'),
    `
import { createServer } from 'node:http';
const s = createServer((_q, r) => r.end('hello'));
s.listen(0, '127.0.0.1', () => {
  console.log('ready on http://localhost:' + s.address().port + '/');
});
`,
    'utf8',
  );
  return { folder, command: `${process.execPath} server.mjs` };
}

/* ========================================================================== */
/* RU-01 reading what a server says                                            */
/* ========================================================================== */

describe('RU-01 the address it announces', () => {
  it('finds one however the server phrased it', () => {
    expect(addressIn('  ➜  Local:   http://localhost:5173/')).toBe('http://localhost:5173');
    expect(addressIn('Serving on http://127.0.0.1:8000')).toBe('http://localhost:8000');
    expect(addressIn('listening at http://0.0.0.0:3000')).toBe('http://localhost:3000');
    expect(addressIn('now at http://localhost:4321/site/')).toBe('http://localhost:4321/site/');
  });

  it('takes the last one, which is the one to open', () => {
    const said = 'proxying http://localhost:9000\nnow serving http://localhost:5173/';
    expect(addressIn(said)).toBe('http://localhost:5173');
  });

  it('says nothing rather than guessing', () => {
    expect(addressIn('')).toBeNull();
    expect(addressIn('watching for changes…')).toBeNull();
    expect(addressIn('see https://vite.dev for help')).toBeNull();
  });

  it('names a piece the way somebody would', () => {
    expect(labelFor('npm run dev -- --port 5173')).toBe('npm run dev');
    expect(labelFor('cd site && python3 -m http.server 4321')).toBe('python3 http.server 4321');
    expect(labelFor('   ')).toBe('something');
  });
});

/* ========================================================================== */
/* RU-02 a real server, really held                                            */
/* ========================================================================== */

describe('RU-02 something that stays up', () => {
  it('starts one, waits for its address, and is still up afterwards', async () => {
    const running = register();
    const { folder, command } = folderWithServer();

    const piece = await running.start({ command, folder, parts: PARTS, writable: [folder] });

    expect(piece.state).toBe('running');
    expect(piece.address).toMatch(/^http:\/\/localhost:\d+$/);

    // The whole point: the call that started it has returned, and it is still
    // there to be reached.
    const answer = await fetch(`${piece.address ?? ''}/`);
    expect(await answer.text()).toBe('hello');

    expect(running.list()).toHaveLength(1);
    expect(running.at(piece.id)?.address).toBe(piece.address);
  }, 30_000);

  it('hands back what is new rather than the whole of it again', async () => {
    const running = register();
    const { folder, command } = folderWithServer();
    const piece = await running.start({ command, folder, parts: PARTS, writable: [folder] });

    expect(running.said(piece.id)).toContain('ready on');
    // Read once, and it is read.
    expect(running.said(piece.id)).toBe('');
    expect(running.said(piece.id, { all: true })).toContain('ready on');
  }, 30_000);

  it('runs several at once, each with its own address', async () => {
    const running = register();
    const one = folderWithServer();
    const two = folderWithServer();

    const first = await running.start({ command: one.command, folder: one.folder, parts: PARTS, writable: [one.folder] });
    const second = await running.start({ command: two.command, folder: two.folder, parts: PARTS, writable: [two.folder] });

    expect(first.address).not.toBe(second.address);
    expect(running.list()).toHaveLength(2);
    for (const piece of running.list()) expect(piece.state).toBe('running');
  }, 40_000);

  it('stops one and leaves the other alone', async () => {
    const running = register();
    const one = folderWithServer();
    const two = folderWithServer();
    const first = await running.start({ command: one.command, folder: one.folder, parts: PARTS, writable: [one.folder] });
    const second = await running.start({ command: two.command, folder: two.folder, parts: PARTS, writable: [two.folder] });

    expect(running.stop(first.id)).toBe(true);
    await expect(fetch(`${first.address ?? ''}/`)).rejects.toThrow();

    const still = await fetch(`${second.address ?? ''}/`);
    expect(await still.text()).toBe('hello');
  }, 40_000);

  it('says so when something falls over on the way up, rather than claiming it is running', async () => {
    const running = register();
    const folder = mkdtempSync(join(tmpdir(), 'graphe-running-'));

    const piece = await running.start({
      command: 'echo "cannot start: port already in use" >&2; exit 1',
      folder,
      parts: PARTS,
      writable: [folder],
      settle: 3_000,
    });

    expect(piece.state).toBe('stopped');
    expect(piece.exitCode).toBe(1);
    expect(running.said(piece.id, { all: true })).toContain('port already in use');
  }, 20_000);

  it('takes the project closing as everything closing', async () => {
    const running = register();
    const { folder, command } = folderWithServer();
    const piece = await running.start({ command, folder, parts: PARTS, writable: [folder] });

    running.stopAll();

    expect(running.list()).toHaveLength(0);
    await expect(fetch(`${piece.address ?? ''}/`)).rejects.toThrow();
  }, 30_000);

  it('stopping something twice is not an error anybody can act on', async () => {
    const running = register();
    const { folder, command } = folderWithServer();
    const piece = await running.start({ command, folder, parts: PARTS, writable: [folder] });
    expect(running.stop(piece.id)).toBe(true);
    expect(running.stop(piece.id)).toBe(true);
    expect(running.stop('run-nothing')).toBe(false);
  }, 30_000);
});

/* ========================================================================== */
/* RU-03 servers a crash left behind                                           */
/* ========================================================================== */

describe('RU-03 what a crash leaves holding a port', () => {
  const alive = (pid: number, command: string) => ({ pid, ppid: 1, command });

  it('picks out the ones still running that are still what we wrote down', () => {
    const noted = [
      { pid: 101, command: 'npm run dev' },
      { pid: 102, command: 'python3 -m http.server 4321' },
    ];
    const running = [alive(101, '/bin/bash -lc npm run dev'), alive(999, 'Finder')];
    expect(whichServersAreStray(noted, running)).toEqual([101]);
  });

  /* The one that matters: a number on its own is not evidence. The machine may
     have handed it to somebody else while the app was away. */
  it('never ends a stranger that inherited the number', () => {
    const noted = [{ pid: 101, command: 'npm run dev' }];
    const running = [alive(101, '/Applications/Safari.app/Contents/MacOS/Safari')];
    expect(whichServersAreStray(noted, running)).toEqual([]);
  });

  it('leaves alone what is no longer running at all', () => {
    const noted = [{ pid: 101, command: 'npm run dev' }];
    expect(whichServersAreStray(noted, [])).toEqual([]);
  });

  it('acts on nothing when the note says nothing', () => {
    expect(whichServersAreStray([], [alive(1, 'anything')])).toEqual([]);
    expect(whichServersAreStray([{ pid: 5, command: '   ' }], [alive(5, 'x')])).toEqual([]);
  });
});

describe('RU-04 a piece that will not close', () => {
  it('stops saying "running" when the process itself has gone', async () => {
    const running = register();
    const folder = mkdtempSync(join(tmpdir(), 'graphe-running-'));

    // Hands its output to a child that outlives it, so the pipes stay open and
    // `close` never fires. `exit` still does, and that is the question being
    // asked: is the thing we started still there?
    const piece = await running.start({
      command: 'sleep 60 & echo "handed on"; exit 0',
      folder,
      parts: PARTS,
      writable: [folder],
      settle: 2_000,
    });

    expect(piece.state).toBe('stopped');
    expect(running.at(piece.id)?.state).toBe('stopped');
  }, 20_000);
});
