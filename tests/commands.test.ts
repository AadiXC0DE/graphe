/** The main agent's own commands, inside the computer's boundary.
 *
 *  The helper was the easy customer: it could not write anything anyway. This
 *  is the one that can write everything, and the tool that runs it belongs to
 *  Pi rather than to us — so half of this file is about the interposition being
 *  real, and the other half is one command on this machine genuinely failing to
 *  write outside the folder it was given.
 */

import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, describe, expect, it } from 'vitest';

import { boundaryHere, lookAgain } from '../src/agent/sandbox';
import { seatbeltProfile } from '../src/agent/sandbox/profile';
import {
  developmentServerCommand,
  downloadFolders,
  heldLine,
  heldShell,
  isForegroundDevelopmentServer,
  quoted,
  shellBounds,
  type RunShell,
  type ShellRun,
} from '../src/agent/sandbox/shell';

const made: string[] = [];

function newFolder(): string {
  const folder = mkdtempSync(join(tmpdir(), 'graphe-commands-'));
  made.push(folder);
  return folder;
}

afterAll(() => {
  for (const folder of made) rmSync(folder, { recursive: true, force: true });
});

/** A stand-in for the runtime's own runner that only writes down what it was
 *  asked to run. */
function recorder(): { runs: { command: string; cwd: string; run: ShellRun }[]; plain: RunShell } {
  const runs: { command: string; cwd: string; run: ShellRun }[] = [];
  return {
    runs,
    plain: (command, cwd, run) => {
      runs.push({ command, cwd, run });
      return Promise.resolve({ exitCode: 0 });
    },
  };
}

function said(run: ShellRun & { spoken?: string }): string {
  return run.spoken ?? '';
}

function listening(): ShellRun & { spoken: string } {
  const heard = { spoken: '', onData: (data: Buffer) => { heard.spoken += data.toString('utf8'); } };
  return heard;
}

const PARTS = { shell: '/bin/bash', args: ['-c'] as const };

/* ========================================================================== */
/* The line it hands over                                                      */
/* ========================================================================== */

describe('what the runtime is asked to run', () => {
  it('makes one word of anything, however it is spelt', () => {
    expect(quoted('plain')).toBe("'plain'");
    expect(quoted("it's")).toBe("'it'\\''s'");
    expect(quoted('a b; rm -rf /')).toBe("'a b; rm -rf /'");
  });

  it('replaces the shell with the bound command rather than wrapping it', () => {
    const line = heldLine({ command: '/usr/bin/sandbox-exec', args: ['-p', '(version 1)\n', '/bin/bash', '-c', "echo 'hi'"] });
    // `exec`, so what the runtime times out and kills is the bound process.
    expect(line.startsWith("exec '/usr/bin/sandbox-exec'")).toBe(true);
    // The command travels as one word: nothing in it can become a second one.
    expect(line.endsWith("'echo '\\''hi'\\'''")).toBe(true);
  });

  it('binds the folder it was given, a scratch folder, and the download folders', () => {
    const bounds = shellBounds('/Users/mira/copies/one', '/tmp/scratch', '/Users/mira');
    expect(bounds.writable).toContain('/Users/mira/copies/one');
    expect(bounds.writable).toContain('/tmp/scratch');
    expect(bounds.writable).toContain('/Users/mira/.npm');
    expect(bounds.writable).not.toContain('/Users/mira');
    // Ordinary work fetches things, which a read-only helper never had to.
    expect(bounds.reach).toBe('secure');
    expect(downloadFolders('/Users/mira')).toContain('/Users/mira/Library/Caches');
  });
});

describe('foreground development servers', () => {
  it('recognises the commands that would otherwise hold the agent open', () => {
    expect(isForegroundDevelopmentServer('npm run dev -- --host 127.0.0.1 --port 5173')).toBe(true);
    expect(isForegroundDevelopmentServer('pnpm run preview')).toBe(true);
    expect(isForegroundDevelopmentServer('yarn start')).toBe(true);
    expect(isForegroundDevelopmentServer('npm test')).toBe(false);
    expect(isForegroundDevelopmentServer('(npm run dev -- --host 127.0.0.1 > /tmp/vite.log 2>&1 & echo $!)')).toBe(true);
    expect(isForegroundDevelopmentServer('nohup npm run dev -- --port 5173 >/tmp/vite.log 2>&1 &')).toBe(true);
  });

  it('recognises a server however it was spelt, not only the package managers', () => {
    for (const command of [
      'python3 -m http.server 4321',
      'python -m SimpleHTTPServer 8000',
      'npx serve site',
      'npx -y http-server ./site -p 4321',
      'php -S localhost:8000',
      'vite --port 5173',
      'next dev',
      'ruby -run -e httpd . -p 4321',
      '(python3 -m http.server 4321 &)',
      'nohup npx serve site >/dev/null 2>&1 &',
    ]) {
      expect(isForegroundDevelopmentServer(command)).toBe(true);
    }
  });

  it('leaves the commands that finish on their own alone', () => {
    for (const command of [
      'npm test',
      'npm run build',
      'python3 scripts/report.py',
      'node scripts/build.mjs',
      'npx tsc --noEmit',
      'serve-report --once', // a word that only starts like one
    ]) {
      expect(isForegroundDevelopmentServer(command)).toBe(false);
    }
  });

  it('turns the model’s background wrapper back into a process we can own and stop', () => {
    expect(developmentServerCommand('(npm run dev -- --host 127.0.0.1 > /tmp/vite.log 2>&1 & echo $!)')).toBe(
      'npm run dev -- --host 127.0.0.1 > /tmp/vite.log 2>&1',
    );
    expect(developmentServerCommand('npm test')).toBeNull();
    expect(developmentServerCommand('nohup npm run dev -- --port 5173 >/tmp/vite.log 2>&1 &')).toBe(
      'npm run dev -- --port 5173 >/tmp/vite.log 2>&1',
    );
  });
});

/* ========================================================================== */
/* The interposition                                                           */
/* ========================================================================== */

describe('a server cannot come up inside the boundary, and says so', () => {
  it('answers in words instead of letting the kernel refuse it four commands later', async () => {
    const folder = newFolder();
    const kept = recorder();
    const shell = heldShell({ folder, parts: () => PARTS, plain: kept.plain });
    const heard = listening();

    const result = await shell.exec('cd site && python3 -m http.server 4321', folder, heard);

    expect(kept.runs).toHaveLength(0);
    expect(result.exitCode).not.toBe(0);
    // It names the tool that does work, rather than only saying no.
    expect(said(heard)).toContain('keep_running');
    expect(said(heard)).toContain('stop_running');
  });

  it('runs it in the person’s own terminal when they asked for that', async () => {
    const folder = newFolder();
    const kept = recorder();
    const shell = heldShell({
      folder,
      parts: () => PARTS,
      plain: kept.plain,
      unrestricted: () => true,
    });

    await shell.exec('python3 -m http.server 4321', folder, listening());
    expect(kept.runs).toHaveLength(1);
  });

  it('lets everything that finishes on its own straight through', async () => {
    const folder = newFolder();
    const kept = recorder();
    const shell = heldShell({ folder, parts: () => PARTS, plain: kept.plain });
    await shell.exec('npm run build', folder, listening());
    expect(kept.runs).toHaveLength(1);
  });
});

describe('every command goes through the boundary first', () => {
  it('uses the normal terminal directly when the person chose get on with it', async () => {
    const folder = newFolder();
    const kept = recorder();
    const shell = heldShell({
      folder,
      parts: () => PARTS,
      plain: kept.plain,
      unrestricted: () => true,
    });
    try {
      await shell.exec('git push', folder, listening());
      expect(kept.runs).toHaveLength(1);
      expect(kept.runs[0]?.command).toBe('git push');
      // The inherited environment is left intact, so Git can use the same
      // credential helper that works in the person's own terminal.
      expect(kept.runs[0]?.run.env?.['TMPDIR']).toBeUndefined();
    } finally {
      await shell.close();
    }
  });

  it('uses the login-environment runner when one is supplied for get on with it', async () => {
    const folder = newFolder();
    const contained = recorder();
    const terminal = recorder();
    const shell = heldShell({
      folder,
      parts: () => PARTS,
      plain: contained.plain,
      unrestrictedPlain: terminal.plain,
      unrestricted: () => true,
    });
    try {
      await shell.exec('npm run app', folder, listening());
      expect(terminal.runs.map((run) => run.command)).toEqual(['npm run app']);
      expect(contained.runs).toHaveLength(0);
    } finally {
      await shell.close();
    }
  });

  it('hands the runtime the held command, with somewhere to write temporary files', async () => {
    lookAgain();
    const look = await boundaryHere();
    const folder = newFolder();
    const kept = recorder();
    const shell = heldShell({ folder, parts: () => PARTS, plain: kept.plain });
    try {
      await shell.exec('ls -la', folder, listening());
      const ran = kept.runs[0];
      expect(ran).toBeDefined();
      if (ran === undefined) return;

      if (!look.ok) {
        // Nothing to wrap with on this machine; the command is untouched.
        expect(ran.command).toBe('ls -la');
        return;
      }

      expect(ran.command.startsWith('exec ')).toBe(true);
      expect(ran.command).toContain(look.tool);
      expect(ran.command).toContain("'ls -la'");
      // A shell writes temporary files constantly. They land in the folder that
      // is bound, not the one that is not.
      const scratch = ran.run.env?.['TMPDIR'];
      expect(typeof scratch).toBe('string');
      expect(ran.command).toContain(scratch ?? 'nowhere');
    } finally {
      await shell.close();
    }
  });

  it('says so out loud, once, when there was no boundary to apply', async () => {
    process.env['GRAPHE_SANDBOX'] = 'off';
    const folder = newFolder();
    const kept = recorder();
    const shell = heldShell({ folder, parts: () => PARTS, plain: kept.plain });
    try {
      const first = listening();
      await shell.exec('ls', folder, first);
      const second = listening();
      await shell.exec('ls', folder, second);

      // It still runs — taking the shell away takes the app away — but the
      // command it runs is the plain one, which is the caller writing it down.
      expect(kept.runs.map((ran) => ran.command)).toEqual(['ls', 'ls']);

      expect(said(first).length).toBeGreaterThan(20);
      expect(said(first)).toContain('Guard');
      for (const word of ['sandbox', 'seatbelt', 'bubblewrap', 'kernel', 'syscall', 'profile']) {
        expect(said(first).toLowerCase()).not.toContain(word);
      }
      // Once. A sentence on every command is noise nobody reads.
      expect(said(second)).toBe('');
    } finally {
      await shell.close();
      delete process.env['GRAPHE_SANDBOX'];
    }
  });

  it('runs the command anyway when there is no shell to name', async () => {
    const folder = newFolder();
    const kept = recorder();
    const shell = heldShell({
      folder,
      parts: () => {
        throw new Error('no bash on this machine');
      },
      plain: kept.plain,
    });
    try {
      const heard = listening();
      await shell.exec('ls', folder, heard);
      expect(kept.runs[0]?.command).toBe('ls');
      // The runner fails the same way it would have anyway, and explains itself.
      expect(said(heard)).toBe('');
    } finally {
      await shell.close();
    }
  });
});

/* ========================================================================== */
/* It is Pi's own bash tool that gets this                                     */
/* ========================================================================== */

describe('where it is wired in', () => {
  const adapter = readFileSync(new URL('../src/agent/pi/adapter.ts', import.meta.url), 'utf8');

  it('replaces the runner inside the bash definition, not the tool itself', () => {
    // Pi owns the tool. Rebuilding it here would mean rebuilding cancelling,
    // timeouts and killing what a command left behind — so the same definition
    // is built, with a different runner underneath it.
    expect(adapter).toContain('createBashToolDefinition');
    expect(adapter).toContain('operations: shell');
    expect(adapter).toContain('heldShell');
    expect(adapter).toContain('unrestrictedPlain: fullAccessShell');
  });

  it('holds the folder this session was opened on, which may be a copy', () => {
    expect(adapter).toContain('folder: options.projectRoot');
  });

  /** The whole interposition rests on one thing being true of the installed
   *  SDK: a tool handed over under a built-in's name is the one the model gets.
   *  Asserted against the real SDK, so an upgrade that changes it fails here
   *  rather than in front of somebody with an unheld shell. */
  it('is the bash the model is given, not a second one beside it', async () => {
    const pi = await import('@earendil-works/pi-coding-agent');
    const folder = newFolder();
    const agentDir = newFolder();
    type CustomTools = NonNullable<Parameters<typeof pi.createAgentSession>[0]>['customTools'];
    const ours = pi.createBashToolDefinition(folder, { operations: { exec: recorder().plain } });
    const { session } = await pi.createAgentSession({
      cwd: folder,
      agentDir,
      tools: ['read', 'bash', 'edit', 'write'],
      customTools: [{ ...ours, description: 'the held one' }] as CustomTools,
      sessionManager: pi.SessionManager.inMemory(folder),
    });
    try {
      expect(session.getActiveToolNames()).toContain('bash');
      expect(session.getToolDefinition('bash')?.description).toBe('the held one');
    } finally {
      session.dispose();
    }
  }, 30_000);
});

/* ========================================================================== */
/* The proof: a command of the main agent's, actually refused                  */
/* ========================================================================== */

/* The one capability a server needs and the ordinary boundary refuses. Proved
   against the kernel rather than against the profile text: a rule that reads
   right and does nothing is exactly the failure this is here to catch. */
describe('the serving boundary', () => {
  const SERVER = `
import { createServer } from 'node:http';
const s = createServer((_q, r) => r.end('ok'));
s.on('error', (e) => { console.log('BIND FAILED ' + e.code); process.exit(3); });
s.listen(0, '127.0.0.1', () => { console.log('LISTENING OK'); process.exit(0); });
`;

  const runFile = promisify(execFile);

  async function tryToListen(reach: 'secure' | 'serving'): Promise<string> {
    const folder = newFolder();
    const script = join(folder, 'server.mjs');
    writeFileSync(script, SERVER, 'utf8');
    const profile = seatbeltProfile({ writable: [folder], reach });
    const args = [
      ...profile.params.flatMap(([name, value]) => ['-D', `${name}=${value}`]),
      '-p',
      profile.text,
      process.execPath,
      script,
    ];
    try {
      const { stdout } = await runFile('/usr/bin/sandbox-exec', args, { timeout: 20_000 });
      return stdout.trim();
    } catch (cause) {
      const said = cause as { stdout?: string; stderr?: string };
      return `${said.stdout ?? ''}${said.stderr ?? ''}`.trim();
    }
  }

  it.runIf(process.platform === 'darwin')('refuses a port under the ordinary boundary', async () => {
    expect(await tryToListen('secure')).toContain('BIND FAILED');
  }, 30_000);

  it.runIf(process.platform === 'darwin')('allows one when serving was asked for', async () => {
    expect(await tryToListen('serving')).toContain('LISTENING OK');
  }, 30_000);

  it('opens nothing to a machine that is not this one', () => {
    const text = seatbeltProfile({ writable: ['/tmp/x'], reach: 'serving' }).text;
    expect(text).toContain('network-bind');
    // Every rule it adds is bounded to this machine.
    for (const line of text.split('\n').filter((one) => one.includes('network-bind') || one.includes('network-inbound'))) {
      expect(line).toContain('localhost');
    }
  });

  it('leaves the ordinary boundary exactly as it was', () => {
    expect(seatbeltProfile({ writable: ['/tmp/x'], reach: 'secure' }).text).not.toContain('network-bind');
    expect(seatbeltProfile({ writable: ['/tmp/x'], reach: 'nothing' }).text).not.toContain('network-bind');
  });

  /* A server that can only leave by 443 cannot reach its own database, and says
     so as a page that will not sign in rather than as anything pointing here.
     Pinned against the kernel: an address in the range reserved for documents
     answers to nobody, so the only way `EPERM` comes back is us refusing. */
  const REACH_OUT = `
const s = require('net').connect({ host: '192.0.2.1', port: 5432, timeout: 2500 });
s.on('connect', () => { console.log('CONNECTED'); process.exit(0); });
s.on('timeout', () => { console.log('TIMED OUT'); process.exit(0); });
s.on('error', (e) => { console.log('ERROR ' + e.code); process.exit(0); });
`;

  async function tryToReachOut(reach: 'secure' | 'serving'): Promise<string> {
    const profile = seatbeltProfile({ writable: [newFolder()], reach });
    const args = [
      ...profile.params.flatMap(([name, value]) => ['-D', `${name}=${value}`]),
      '-p',
      profile.text,
      process.execPath,
      '-e',
      REACH_OUT,
    ];
    try {
      const { stdout } = await runFile('/usr/bin/sandbox-exec', args, { timeout: 20_000 });
      return stdout.trim();
    } catch (cause) {
      const said = cause as { stdout?: string; stderr?: string };
      return `${said.stdout ?? ''}${said.stderr ?? ''}`.trim();
    }
  }

  it.runIf(process.platform === 'darwin')('lets a server reach a database port, not only 443', async () => {
    expect(await tryToReachOut('serving')).not.toContain('EPERM');
  }, 30_000);

  it.runIf(process.platform === 'darwin')('still holds the agent to 443', async () => {
    expect(await tryToReachOut('secure')).toContain('EPERM');
  }, 30_000);

  it('holds the agent to 443 and lets a server out', () => {
    const agent = seatbeltProfile({ writable: ['/tmp/x'], reach: 'secure' }).text;
    expect(agent).toContain('(allow network-outbound (remote tcp "*:443") (remote unix-socket))');

    const server = seatbeltProfile({ writable: ['/tmp/x'], reach: 'serving' }).text;
    expect(server).toContain('(allow network-outbound)');
    expect(server).not.toContain('*:443');
  });

  it('still sends everything through the door when one was asked for', () => {
    const text = seatbeltProfile({ writable: ['/tmp/x'], reach: 'serving', through: 8899 }).text;
    expect(text).toContain('(allow network-outbound (remote ip "localhost:8899")');
    expect(text).not.toContain('(allow network-outbound)\n');
  });
});

describe('a real refusal', () => {
  it('will not let the main agent write outside the folder it was given', async () => {
    lookAgain();
    const look = await boundaryHere();
    if (!look.ok) {
      expect(look.why).toMatch(/no-boundary-here|piece-missing|not-holding/);
      return;
    }

    // Pi's real bash tool, built exactly as the adapter builds it, over Pi's
    // real local runner. Nothing here is a stand-in.
    const pi = await import('@earendil-works/pi-coding-agent');
    const folder = newFolder();
    const shell = heldShell({
      folder,
      parts: () => {
        const config = pi.getShellConfig();
        return { shell: config.shell, args: config.args };
      },
      plain: pi.createLocalBashOperations().exec,
    });
    const bash = pi.createBashToolDefinition(folder, { operations: shell });
    const run = (command: string): Promise<unknown> =>
      bash.execute('call-1', { command }, undefined, undefined, undefined as never);

    const outside = join(homedir(), `.graphe-mainagent-proof-${String(process.pid)}`);
    rmSync(outside, { force: true });

    try {
      await expect(run(`printf '' > ${outside}`)).rejects.toThrow();
      expect(existsSync(outside)).toBe(false);

      // The same write, one folder over, is ordinary work.
      const inside = join(folder, 'allowed.txt');
      await run(`printf 'yes' > ${inside}`);
      expect(existsSync(inside)).toBe(true);

      // And a here-document, which is a temporary file whether anybody meant
      // one or not. Without a scratch folder bound in, this is where every
      // command starts failing for reasons that look like the command.
      const heredoc = await run("cat <<'END'\nstill working\nEND");
      expect(JSON.stringify(heredoc)).toContain('still working');

      // Reading is open, bar the places keys live — including the certificates
      // an https address is checked against, which are named like keys and are
      // the difference between the network working and not.
      if (existsSync('/etc/ssl/cert.pem')) {
        const certificates = await run('head -c 1 /etc/ssl/cert.pem >/dev/null && echo readable');
        expect(JSON.stringify(certificates)).toContain('readable');
      }
      await expect(run(`ls ${join(homedir(), '.ssh')}`)).rejects.toThrow();
    } finally {
      rmSync(outside, { force: true });
      await shell.close();
    }
  }, 60_000);
});
