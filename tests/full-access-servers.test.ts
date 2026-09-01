/** A server started in full access is still a server somebody has to stop.
 *
 * Full access runs the command in a real terminal, which is the point of it. It
 * used to also mean the command was waited on for twenty minutes and was
 * invisible to the register that knows what is up — so several conversations
 * each starting the same server filled the machine, with nothing on screen to
 * say why.
 */

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { Running } from '../src/agent/running';
import { heldShell } from '../src/agent/sandbox/shell';

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

function project(): string {
  const folder = mkdtempSync(join(tmpdir(), 'graphe-fa-'));
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
  // The shape this actually happens in: `npm run dev`, which is what the
  // foreground-server check recognises and what a person asks for.
  writeFileSync(
    join(folder, 'package.json'),
    JSON.stringify({ name: 'fixture', version: '1.0.0', scripts: { dev: `${process.execPath} server.mjs` } }),
    'utf8',
  );
  return folder;
}

/** The shell as the adapter builds it in full access, register and all. */
function shellWith(running: Running, folder: string) {
  const ran: string[] = [];
  const shell = heldShell({
    folder,
    parts: () => PARTS,
    unrestricted: () => true,
    plain: async (command) => {
      ran.push(command);
      return { exitCode: 0 };
    },
    unrestrictedPlain: async (command) => {
      ran.push(command);
      return { exitCode: 0 };
    },
    keepInstead: async (command, cwd) => {
      const already = running.same(command, cwd) !== null;
      const piece = await running.start({
        command,
        folder: cwd,
        parts: PARTS,
        writable: [cwd],
        settle: 4_000,
      });
      return `${already ? 'That is already running' : 'Started and left running'} at ${String(
        piece.address,
      )}. End it with stop_running(${piece.id}).`;
    },
  });
  return { shell, ran };
}

const heard = () => {
  const said: string[] = [];
  return { said, run: { onData: (b: Buffer) => said.push(b.toString('utf8')) } };
};

describe('FA-01 a development server goes to the register', () => {
  it('is started for real, and named so it can be stopped', async () => {
    const running = register();
    const folder = project();
    const { shell, ran } = shellWith(running, folder);
    const listening = heard();

    const result = await shell.exec('npm run dev', folder, listening.run as never);

    expect(result.exitCode).toBe(0);
    // Not waited on: nothing reached the plain runner.
    expect(ran).toHaveLength(0);
    // And it is genuinely up, in the one place that knows.
    expect(running.list()).toHaveLength(1);
    expect(listening.said.join('')).toContain('stop_running(');
    expect(listening.said.join('')).toContain('http://localhost:');
  }, 30_000);

  it('does not start a second copy of one already up', async () => {
    const running = register();
    const folder = project();
    const { shell } = shellWith(running, folder);
    const command = 'npm run dev';

    await shell.exec(command, folder, heard().run as never);
    const second = heard();
    await shell.exec(command, folder, second.run as never);

    expect(running.list()).toHaveLength(1);
    expect(second.said.join('')).toContain('already running');
  }, 30_000);
});

describe('FA-02 what still goes to the terminal', () => {
  it('anything that finishes on its own', async () => {
    const running = register();
    const folder = project();
    const { shell, ran } = shellWith(running, folder);
    await shell.exec('npm run build', folder, heard().run as never);
    expect(ran).toEqual(['npm run build']);
    expect(running.list()).toHaveLength(0);
  });

  /* Without the hook this is the older behaviour, deliberately: full access
     means the person's own terminal. The hook is what makes it stoppable. */
  it('and a server too, where nothing was given to keep it', async () => {
    const ran: string[] = [];
    const folder = project();
    const shell = heldShell({
      folder,
      parts: () => PARTS,
      unrestricted: () => true,
      plain: async (command) => {
        ran.push(command);
        return { exitCode: 0 };
      },
    });
    await shell.exec('python3 -m http.server 4321', folder, heard().run as never);
    expect(ran).toEqual(['python3 -m http.server 4321']);
  });
});
