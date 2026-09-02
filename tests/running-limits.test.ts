/** Not filling the machine up.
 *
 * Ten node processes and no memory left is what a missing rule here looks like
 * from the outside. Every one of these starts real processes and asks the
 * operating system what is left, because the bug was never in the bookkeeping.
 */

import { execFile } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

import { MOST_RUNNING, Running, sameCommand } from '../src/agent/running';
import { capsNow } from '../src/work/capacity';

const runFile = promisify(execFile);
const PARTS = { shell: '/bin/sh', args: ['-c'] } as const;

const registers: Running[] = [];
function register(): Running {
  const one = new Running();
  registers.push(one);
  return one;
}

afterEach(() => {
  for (const one of registers.splice(0)) one.stopAllNow();
});

/** A folder holding a server that stays up and prints where it is. */
function folderWithServer(): { folder: string; command: string } {
  const folder = mkdtempSync(join(tmpdir(), 'graphe-limits-'));
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

/** What the operating system says is actually alive, by process id. */
async function alive(pid: number): Promise<boolean> {
  try {
    await runFile('/bin/ps', ['-p', String(pid)]);
    return true;
  } catch {
    return false;
  }
}

/** Gone, allowing for the moment between the signal landing and the kernel
 *  reaping. Nothing of ours is being waited for here — the signals have all
 *  been sent by the time this is called, and under a loaded machine `ps` can
 *  still name a process for a beat afterwards. */
async function gone(pid: number, within = 3_000): Promise<boolean> {
  const until = Date.now() + within;
  for (;;) {
    if (!(await alive(pid))) return true;
    if (Date.now() > until) return false;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe('RL-01 the same command twice', () => {
  it('hands back the one already running rather than a second copy', async () => {
    const running = register();
    const { folder, command } = folderWithServer();
    const first = await running.start({ folder, command, parts: PARTS, writable: [folder], settle: 4_000 });
    const second = await running.start({ folder, command, parts: PARTS, writable: [folder], settle: 4_000 });

    expect(second.id).toBe(first.id);
    expect(running.list()).toHaveLength(1);
    // The address is the one thing anybody carries out of here, and reusing is
    // no use if it comes back without one.
    expect(second.address).toBe(first.address);
  }, 30_000);

  it('sees through the whitespace a model varies without meaning to', async () => {
    const running = register();
    const { folder, command } = folderWithServer();
    await running.start({ folder, command, parts: PARTS, writable: [folder], settle: 4_000 });
    await running.start({
      folder,
      command: `  ${command.replace(' ', '   ')}  `,
      parts: PARTS,
      writable: [folder],
      settle: 4_000,
    });
    expect(running.list()).toHaveLength(1);
  }, 30_000);

  it('does not confuse a different command for the same one', async () => {
    const running = register();
    const { folder, command } = folderWithServer();
    await running.start({ folder, command, parts: PARTS, writable: [folder], settle: 4_000 });
    await running.start({
      folder,
      command: `${command} --host`,
      parts: PARTS,
      writable: [folder],
      settle: 4_000,
    });
    expect(running.list()).toHaveLength(2);
  }, 30_000);

  it('starts again once the first has stopped', async () => {
    const running = register();
    const { folder, command } = folderWithServer();
    const first = await running.start({ folder, command, parts: PARTS, writable: [folder], settle: 4_000 });
    await running.stop(first.id);
    const second = await running.start({ folder, command, parts: PARTS, writable: [folder], settle: 4_000 });
    expect(second.id).not.toBe(first.id);
  }, 30_000);

  it('compares commands by what they say, not how they are spaced', () => {
    expect(sameCommand('npm run dev', '  npm   run  dev ')).toBe(true);
    expect(sameCommand('npm run dev', 'npm run devv')).toBe(false);
    expect(sameCommand('npm run dev', 'npm run dev -- --host')).toBe(false);
  });
});

describe('RL-02 a ceiling on how many at once', () => {
  it('takes its ceiling from the one place the caps are worked out', () => {
    expect(MOST_RUNNING).toBe(capsNow().running);
  });

  it('refuses past the ceiling, and names what is already up', async () => {
    const running = register();
    const { folder } = folderWithServer();
    for (let at = 0; at < MOST_RUNNING; at += 1) {
      await running.start({
        folder,
        command: `${process.execPath} server.mjs --n${String(at)}`,
        label: `server ${String(at)}`,
        parts: PARTS,
        writable: [folder],
        settle: 4_000,
      });
    }
    expect(running.list()).toHaveLength(MOST_RUNNING);
    await expect(
      running.start({
        folder,
        command: `${process.execPath} server.mjs --one-too-many`,
        parts: PARTS,
        writable: [folder],
        settle: 4_000,
      }),
    ).rejects.toThrow(/already running/);
    // Refused, not started and then forgotten — the refusal is the whole point.
    expect(running.list()).toHaveLength(MOST_RUNNING);
  }, 60_000);

  it('lets another in once one has been stopped', async () => {
    const running = register();
    const { folder } = folderWithServer();
    const started = [];
    for (let at = 0; at < MOST_RUNNING; at += 1) {
      started.push(
        await running.start({
          folder,
          command: `${process.execPath} server.mjs --n${String(at)}`,
          parts: PARTS,
          writable: [folder],
          settle: 4_000,
        }),
      );
    }
    await running.stop(started[0]!.id);
    running.forgetStopped();
    await expect(
      running.start({
        folder,
        command: `${process.execPath} server.mjs --fresh`,
        parts: PARTS,
        writable: [folder],
        settle: 4_000,
      }),
    ).resolves.toBeTruthy();
  }, 60_000);
});

describe('RL-03 quitting takes the servers with it', () => {
  /* The ordinary stop asks, then insists half a second later on a timer. On
     quit there is no half second, so this one must not need it. */
  it('leaves nothing alive, with no timer to wait for', async () => {
    const running = register();
    const { folder } = folderWithServer();
    const pids: number[] = [];
    for (let at = 0; at < 3; at += 1) {
      await running.start({
        folder,
        command: `${process.execPath} server.mjs --n${String(at)}`,
        parts: PARTS,
        writable: [folder],
        noted: { began: (pid) => pids.push(pid), ended: () => undefined },
        settle: 4_000,
      });
    }
    expect(pids).toHaveLength(3);
    for (const pid of pids) expect(await alive(pid)).toBe(true);

    running.stopAllNow();

    // No await on anything of ours: every signal went out inside that call.
    for (const pid of pids) expect(await gone(pid)).toBe(true);
    expect(running.list()).toHaveLength(0);
  }, 60_000);

  it('refuses to start anything after it', async () => {
    const running = register();
    const { folder, command } = folderWithServer();
    running.stopAllNow();
    await expect(
      running.start({ folder, command, parts: PARTS, writable: [folder], settle: 4_000 }),
    ).rejects.toThrow(/no longer open/);
  }, 20_000);
});
