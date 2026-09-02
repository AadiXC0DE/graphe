/** The ledger of everything the app started.
 *
 * The failure it exists for is the one nobody sees: quit the app, and the
 * development server it started is still holding a port and half a gigabyte
 * with nobody left who can stop it. So these spawn real children and check that
 * none of them are there afterwards — including one that refuses to take the
 * hint.
 */

import { spawn, type ChildProcess } from 'node:child_process';

import { afterEach, describe, expect, it } from 'vitest';

import { addonProcesses, alive, ledger, type Spawned } from '../electron/processes';

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
