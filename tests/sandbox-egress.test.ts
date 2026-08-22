/** Which addresses work may reach, checked by name.
 *
 * A port filter says "https" and nothing else, which is the same permission a
 * quiet copy of somebody's folder needs. So the check moved to a door on this
 * machine that reads the name being asked for. Three things have to be true and
 * all three are checked here: the door turns down what is not on the list, it
 * carries through what is, and the boundary makes going round it impossible
 * rather than impolite.
 */

import { execFile } from 'node:child_process';
import { createServer, connect, type Server } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';

import { boundaryHere, hold } from '../src/agent/sandbox';
import { doorwayEnvironment, hostAllowed, openDoorway, reachableHosts } from '../src/agent/sandbox/egress';
import { seatbeltProfile, type Bounds } from '../src/agent/sandbox/profile';
import { heldShell } from '../src/agent/sandbox/shell';

const closing: (() => Promise<void> | void)[] = [];

afterEach(async () => {
  for (const close of closing.splice(0)) await close();
});

/* ========================================================================== */
/* The list                                                                    */
/* ========================================================================== */

describe('the addresses ordinary work reaches', () => {
  it('starts from the places the app itself already goes', () => {
    const hosts = reachableHosts();
    for (const known of [
      'registry.npmjs.org',
      'raw.githubusercontent.com',
      'api.figma.com',
      'lite.duckduckgo.com',
      'export.arxiv.org',
      'api.anthropic.com',
      'pypi.org',
    ]) {
      expect(hosts).toContain(known);
    }
  });

  it('takes what somebody on this computer adds by hand', () => {
    process.env['GRAPHE_EGRESS_HOSTS'] = 'paste.example.dev, *.internal.test';
    try {
      const hosts = reachableHosts(['handed.in']);
      expect(hosts).toContain('paste.example.dev');
      expect(hosts).toContain('*.internal.test');
      expect(hosts).toContain('handed.in');
    } finally {
      delete process.env['GRAPHE_EGRESS_HOSTS'];
    }
  });

  it('matches a name exactly, and a pattern only below itself', () => {
    const list = ['github.com', '*.githubusercontent.com'];
    expect(hostAllowed('github.com', list)).toBe(true);
    expect(hostAllowed('GitHub.com.', list)).toBe(true);
    expect(hostAllowed('raw.githubusercontent.com', list)).toBe(true);
    // The name the pattern was written under is not itself opened up.
    expect(hostAllowed('githubusercontent.com', list)).toBe(false);
    // Nor is anything that merely ends in the same letters.
    expect(hostAllowed('evilgithub.com', list)).toBe(false);
    expect(hostAllowed('github.com.attacker.net', list)).toBe(false);
    expect(hostAllowed('140.82.121.4', list)).toBe(false);
    expect(hostAllowed('', list)).toBe(false);
  });

  it('tells a command every spelling of where the door is', () => {
    const told = doorwayEnvironment(4321);
    expect(told['HTTPS_PROXY']).toBe('http://127.0.0.1:4321');
    expect(told['https_proxy']).toBe('http://127.0.0.1:4321');
    // The runtime's own fetch reads none of the others.
    expect(told['NODE_USE_ENV_PROXY']).toBe('1');
    expect(told['NO_PROXY']).toContain('127.0.0.1');
  });
});

/* ========================================================================== */
/* The door                                                                    */
/* ========================================================================== */

/** Speak to the door the way a command would, and hand back what it said. */
function ask(port: number, line: string): Promise<string> {
  return new Promise((done) => {
    let heard = '';
    const socket = connect(port, '127.0.0.1', () => socket.write(`${line}\r\n\r\n`));
    socket.on('data', (chunk) => {
      heard += chunk.toString('utf8');
      if (heard.includes('\r\n\r\n')) {
        socket.end();
        done(heard);
      }
    });
    socket.on('error', () => done(heard));
    socket.on('close', () => done(heard));
  });
}

describe('what the door does', () => {
  it('turns down an address that is not on the list, and says which', async () => {
    const door = await openDoorway({ patienceMs: 5_000 });
    expect(door.open).toBe(true);
    if (!door.open) return;
    closing.push(door.close);

    const said = await ask(door.port, 'CONNECT paste.attacker.example:443 HTTP/1.1');
    expect(said).toContain('403');
    expect(said).toContain('paste.attacker.example');
    expect(door.turnedAway()).toContain('paste.attacker.example');
  }, 30_000);

  it('answers nothing but a secure connection to a name', async () => {
    const door = await openDoorway({ hosts: ['registry.npmjs.org'], patienceMs: 5_000 });
    if (!door.open) return;
    closing.push(door.close);

    // A port the boundary was never opening anyway.
    expect(await ask(door.port, 'CONNECT registry.npmjs.org:22 HTTP/1.1')).toContain('403');
    // And an ordinary request is not a way through either.
    expect(await ask(door.port, 'GET http://registry.npmjs.org/ HTTP/1.1')).toContain('403');
  }, 30_000);

  it('carries a connection through to an address that is on the list', async () => {
    const listener: Server = createServer((socket) => {
      socket.on('data', (chunk) => socket.write(`heard:${chunk.toString('utf8')}`));
    });
    await new Promise<void>((up) => listener.listen(0, '127.0.0.1', up));
    const to = listener.address();
    if (to === null || typeof to === 'string') return;
    closing.push(() => new Promise<void>((done) => listener.close(() => done())));

    const door = await openDoorway({ hosts: ['127.0.0.1'], ports: [to.port], patienceMs: 5_000 });
    if (!door.open) return;
    closing.push(door.close);

    const carried = await new Promise<string>((done) => {
      let heard = '';
      const socket = connect(door.port, '127.0.0.1', () => {
        socket.write(`CONNECT 127.0.0.1:${String(to.port)} HTTP/1.1\r\n\r\n`);
      });
      socket.on('data', (chunk) => {
        heard += chunk.toString('utf8');
        if (heard.includes('200 Connection Established') && !heard.includes('heard:')) {
          socket.write('ping');
          return;
        }
        if (heard.includes('heard:')) {
          socket.end();
          done(heard);
        }
      });
      socket.on('error', () => done(heard));
    });
    expect(carried).toContain('200 Connection Established');
    expect(carried).toContain('heard:ping');
    expect(door.turnedAway()).toEqual([]);
  }, 30_000);
});

/* ========================================================================== */
/* Going round it                                                              */
/* ========================================================================== */

function bounds(over: Partial<Bounds> = {}): Bounds {
  return { writable: ['/Users/mira/Projects/portfolio'], reach: 'secure', ...over };
}

describe('the rules behind the door', () => {
  it('opens the one address on this machine, and drops the open port', () => {
    const { text } = seatbeltProfile(bounds({ through: 8899 }));
    expect(text).toContain('(allow network-outbound (remote ip "localhost:8899")');
    expect(text).not.toContain('*:443');
    // Nothing to look a name up with either — the door is what does that.
    expect(text).not.toContain('(allow system-socket)');
  });

  it('will not write a port it cannot make sense of into a rule', () => {
    for (const nonsense of [0, -1, 70_000, 1.5, Number.NaN]) {
      const { text } = seatbeltProfile(bounds({ through: nonsense }));
      // Back to the port it could hold before, rather than a rule built from
      // something it could not read.
      expect(text).toContain('(remote tcp "*:443")');
      expect(text).not.toContain('localhost:');
    }
  });

  it('refuses a connection that does not go through the door', async () => {
    const look = await boundaryHere();
    if (!look.ok || look.kind !== 'seatbelt') return;

    // Two listeners on this machine. One is the door; the other stands in for
    // every address the work was never meant to reach.
    const elsewhere = createServer((socket) => socket.end('nope'));
    await new Promise<void>((up) => elsewhere.listen(0, '127.0.0.1', up));
    const other = elsewhere.address();
    if (other === null || typeof other === 'string') return;
    closing.push(() => new Promise<void>((done) => elsewhere.close(() => done())));

    const door = await openDoorway({ patienceMs: 5_000 });
    if (!door.open) return;
    closing.push(door.close);

    const reach = (port: number) =>
      `require("net").connect(${String(port)}, "127.0.0.1")` +
      `.on("connect", () => { console.log("reached"); process.exit(0); })` +
      `.on("error", (e) => { console.log("refused", e.code); process.exit(0); })`;

    const held = await hold(process.execPath, ['-e', reach(door.port)], {
      writable: [process.cwd()],
      reach: 'secure',
      through: door.port,
    });
    expect(held.held).toBe(true);
    if (!held.held) return;
    expect(await ran(held.command, held.args)).toContain('reached');

    const away = await hold(process.execPath, ['-e', reach(other.port)], {
      writable: [process.cwd()],
      reach: 'secure',
      through: door.port,
    });
    if (!away.held) return;
    expect(await ran(away.command, away.args)).toContain('refused');
  }, 60_000);
});

describe('the shell the main agent uses', () => {
  it('opens the door, points work at it, and closes it afterwards', async () => {
    const look = await boundaryHere();
    if (!look.ok || look.kind !== 'seatbelt') return;

    let line = '';
    let told: NodeJS.ProcessEnv = {};
    const shell = heldShell({
      folder: process.cwd(),
      parts: () => ({ shell: '/bin/bash', args: ['-c'] }),
      plain: async (command, _cwd, run) => {
        line = command;
        told = run.env ?? {};
        return { exitCode: 0 };
      },
    });
    await shell.exec('true', process.cwd(), { onData: () => {} });

    const address = told['HTTPS_PROXY'] ?? '';
    const port = /:(\d+)$/.exec(address)?.[1] ?? '';
    expect(port).not.toBe('');
    // The command may reach that one address on this machine and nothing else.
    expect(line).toContain(`localhost:${port}`);
    expect(line).not.toContain('*:443');
    expect(told['NODE_USE_ENV_PROXY']).toBe('1');

    await shell.close();
    // Closed means closed: nothing is listening there afterwards.
    const after = await new Promise<string>((done) => {
      const socket = connect(Number(port), '127.0.0.1');
      socket.on('connect', () => {
        socket.destroy();
        done('open');
      });
      socket.on('error', () => done('shut'));
    });
    expect(after).toBe('shut');
  }, 60_000);
});

function ran(command: string, args: readonly string[]): Promise<string> {
  return new Promise((done) => {
    execFile(command, [...args], { timeout: 30_000 }, (_problem, out, err) => {
      done(`${String(out)}${String(err)}`);
    });
  });
}
