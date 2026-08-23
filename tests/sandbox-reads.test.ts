/** Reading, under the boundary, for real.
 *
 * The rules being right on paper is the easy half and `boundary.test.ts` has
 * it. This is the other half: a command is actually run, and what it could and
 * could not open is checked afterwards. A read allowlist that quietly stops
 * `node` from starting would be worse than no allowlist at all, so the ordinary
 * cases are proved here alongside the refusals.
 */

import { execFile } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { mkdtemp, realpath } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { boundaryHere, hold } from '../src/agent/sandbox';
import { credentialFoldersIn } from '../src/agent/sandbox/profile';

const made: string[] = [];
const outside = join(homedir(), `.graphe-read-proof-${String(process.pid)}`);

afterAll(() => {
  for (const folder of made) rmSync(folder, { recursive: true, force: true });
  rmSync(outside, { force: true });
});

async function newFolder(): Promise<string> {
  const folder = await realpath(await mkdtemp(join(tmpdir(), 'graphe-reads-')));
  made.push(folder);
  return folder;
}

type Ran = { code: number; out: string; err: string };

function run(command: string, args: readonly string[], cwd: string): Promise<Ran> {
  return new Promise((done) => {
    execFile(command, [...args], { cwd, timeout: 40_000 }, (problem, out, err) => {
      done({ code: problem === null ? 0 : 1, out: String(out), err: String(err) });
    });
  });
}

/** One command, inside the boundary, in a folder that is bound. */
async function bound(folder: string, command: string, args: readonly string[]): Promise<Ran | null> {
  const held = await hold(command, args, { writable: [folder], reach: 'nothing' });
  if (!held.held) return null;
  return run(held.command, held.args, folder);
}

describe('what a bound command may read', () => {
  it('opens what is in the folder and refuses what is not', async () => {
    const look = await boundaryHere();
    if (!look.ok) {
      // Nothing to prove on a machine with no boundary; the reason is the test.
      expect(look.why).toMatch(/no-boundary-here|piece-missing|not-holding/);
      return;
    }

    const folder = await newFolder();
    writeFileSync(join(folder, 'notes.txt'), 'the work in hand');
    writeFileSync(outside, 'somebody else’s business');

    const inside = await bound(folder, '/bin/cat', [join(folder, 'notes.txt')]);
    expect(inside?.code).toBe(0);
    expect(inside?.out).toContain('the work in hand');

    const elsewhere = await bound(folder, '/bin/cat', [outside]);
    expect(elsewhere?.code).toBe(1);
    expect(elsewhere?.out).not.toContain('business');

    // Not even the names, one folder up from the work.
    const listing = await bound(folder, '/bin/ls', [homedir()]);
    expect(listing?.code).toBe(1);
  }, 90_000);

  it('still lets ordinary work start', async () => {
    const look = await boundaryHere();
    if (!look.ok) return;

    const folder = await newFolder();
    writeFileSync(join(folder, 'thing.json'), '{"ok":true}');

    const echoed = await bound(folder, '/bin/echo', ['hello']);
    expect(echoed?.code).toBe(0);
    expect(echoed?.out.trim()).toBe('hello');

    const shell = await bound(folder, '/bin/sh', ['-c', 'pwd && cat thing.json']);
    expect(shell?.code).toBe(0);
    expect(shell?.out).toContain('{"ok":true}');

    const runtime = await bound(folder, process.execPath, [
      '-e',
      'console.log("started", require("fs").readFileSync("thing.json", "utf8"))',
    ]);
    expect(runtime?.code).toBe(0);
    expect(runtime?.out).toContain('started');
    expect(runtime?.out).toContain('{"ok":true}');
  }, 90_000);
});

/* Keys kept inside the project, rather than in a home folder. The Guard
   already refuses to read either; this is the floor under it, and a repository
   with an `.aws` in it is exactly where a bypass would go looking. */
describe('keys inside the project are covered over too', () => {
  it('names the key-shaped folders under every writable root', () => {
    const covered = credentialFoldersIn('/work/site');
    for (const place of ['.ssh', '.aws', '.gnupg', '.kube', '.docker', '.config/gcloud']) {
      expect(covered, place).toContain(`/work/site/${place}`);
    }
  });

  /** A project's own code reads `.env` to run. Covering it over would stop the
   *  thing being built rather than protect it — that one belongs to the Guard,
   *  which refuses it on the way in while leaving the project itself able to. */
  it('leaves the one file the project itself has to read', () => {
    const covered = credentialFoldersIn('/work/site');
    expect(covered.some((one) => one.endsWith('.env'))).toBe(false);
  });
});
