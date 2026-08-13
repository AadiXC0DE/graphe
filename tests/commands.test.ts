/** The main agent's own commands, inside the computer's boundary.
 *
 *  The helper was the easy customer: it could not write anything anyway. This
 *  is the one that can write everything, and the tool that runs it belongs to
 *  Pi rather than to us — so half of this file is about the interposition being
 *  real, and the other half is one command on this machine genuinely failing to
 *  write outside the folder it was given.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { boundaryHere, lookAgain } from '../src/agent/sandbox';
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
