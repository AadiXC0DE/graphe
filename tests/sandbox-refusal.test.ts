/** Telling a rule apart from a broken command.
 *
 * When the boundary turns something down, the command prints whatever it prints
 * about `EPERM` and stops. Nothing in that says "a rule", so the model reads a
 * broken machine and tries again, and again, and is charged each time. This is
 * the check that the difference is actually detected — in both directions,
 * because calling an ordinary failure a refusal would teach the model to give up
 * on work it could have finished.
 */

import { describe, expect, it } from 'vitest';

import { boundaryHere } from '../src/agent/sandbox';
import { heldShell, refusedByBoundary, REFUSED, type ShellRun } from '../src/agent/sandbox/shell';

describe('reading a refusal off the end of a command', () => {
  it('recognises the boundary turning something down', () => {
    expect(refusedByBoundary('cat: /Users/mira/.ssh/id: Operation not permitted', 1, true)).toBe('place');
    expect(refusedByBoundary("Error: EPERM: operation not permitted, open '/etc/hosts'", 1, true)).toBe('place');
    expect(refusedByBoundary("dyld: '/x.dylib' (file system sandbox blocked open())", 1, true)).toBe('place');
    expect(refusedByBoundary('sandbox-exec: sandbox_apply: Operation not permitted', 1, true)).toBe('place');
    // The wrapper naming itself counts however it words the excuse.
    expect(refusedByBoundary('bwrap: setting up uid map: Permission denied', 1, true)).toBe('place');
    expect(refusedByBoundary('bubblewrap is unavailable on this machine', 1, true)).toBe('place');
  });

  it('tells an address that was turned away from a folder that was', () => {
    expect(refusedByBoundary('curl: (56) CONNECT tunnel failed, response 403', 56, true)).toBe('address');
    expect(refusedByBoundary('paste.example.com is not on the list of addresses', 1, true)).toBe('address');
    // Different advice, because "try it inside the folder" would be nonsense.
    expect(REFUSED.address).not.toBe(REFUSED.place);
    expect(REFUSED.address).toContain('address');
  });

  it('leaves an ordinary failure alone', () => {
    expect(refusedByBoundary('npm ERR! Missing script: "buld"', 1, true)).toBe(null);
    expect(refusedByBoundary('2 tests failed', 1, true)).toBe(null);
    expect(refusedByBoundary('fatal: not a git repository', 128, true)).toBe(null);
    // A service saying no is not the computer saying no.
    expect(refusedByBoundary('403 Forbidden: token unauthorized', 1, true)).toBe(null);
    expect(refusedByBoundary('mkdir: /opt/thing: Permission denied', 1, true)).toBe(null);
  });

  it('says nothing about a command that worked, or one nothing was around', () => {
    // The developer tools grumble about a cache file and then work perfectly.
    expect(refusedByBoundary("couldn't create cache file (errno=Operation not permitted)", 0, true)).toBe(null);
    expect(refusedByBoundary('cat: /x: Operation not permitted', 1, false)).toBe(null);
    expect(refusedByBoundary('cat: /x: Operation not permitted', null, true)).toBe(null);
  });
});

/* ========================================================================== */
/* The sentence, where the model reads it                                      */
/* ========================================================================== */

type Said = { lines: string[]; run: ShellRun };

function listening(): Said {
  const lines: string[] = [];
  return { lines, run: { onData: (data) => lines.push(data.toString('utf8')) } };
}

/** A shell whose commands never really run: whatever is set here is what the
 *  command "printed", so the two directions can be checked without a machine
 *  that happens to refuse something. */
function shellSaying(output: string, exitCode: number) {
  const heard = listening();
  const shell = heldShell({
    folder: process.cwd(),
    parts: () => ({ shell: '/bin/bash', args: ['-c'] }),
    plain: async (_command, _cwd, run) => {
      run.onData(Buffer.from(output));
      return { exitCode };
    },
  });
  return { shell, heard };
}

describe('what the model is told', () => {
  it('says once, in words, that the boundary is what refused', async () => {
    const look = await boundaryHere();
    if (!look.ok) return;

    const { shell, heard } = shellSaying('cat: /Users/mira/keys: Operation not permitted\n', 1);
    const result = await shell.exec('cat /Users/mira/keys', process.cwd(), heard.run);
    await shell.close();

    expect(result.exitCode).toBe(1);
    const said = heard.lines.join('');
    expect(said).toContain(REFUSED.place);
    // Once, not once per line of the output it appeared in.
    expect(said.split(REFUSED.place)).toHaveLength(2);
    // A sentence, not machinery.
    for (const word of ['sandbox', 'seatbelt', 'kernel', 'EPERM', 'syscall']) {
      expect(REFUSED.place.toLowerCase()).not.toContain(word.toLowerCase());
    }
  }, 60_000);

  it('stays quiet when the command simply failed', async () => {
    const look = await boundaryHere();
    if (!look.ok) return;

    const { shell, heard } = shellSaying('npm ERR! Missing script: "buld"\n', 1);
    await shell.exec('npm run buld', process.cwd(), heard.run);
    await shell.close();

    expect(heard.lines.join('')).not.toContain(REFUSED.place);
  }, 60_000);
});
