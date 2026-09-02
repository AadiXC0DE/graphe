/** Reading, under the boundary, for real.
 *
 * The rules being right on paper is the easy half and `boundary.test.ts` has
 * it. This is the other half: a command is actually run, and what it could and
 * could not open is checked afterwards. A read allowlist that quietly stops
 * `node` from starting would be worse than no allowlist at all, so the ordinary
 * cases are proved here alongside the refusals.
 */

import { execFile } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
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
      expect(look.why).toMatch(/no-boundary-here|piece-missing|not-holding|boundary-refused/);
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

/* The bug this exists to stop coming back: a dev server started here could not
   read the project's own `.env.local`, so it came up and then failed on every
   request. The agent read that as the file being wrong and spent a dozen turns
   rewriting it — including under sudo — in somebody's real project.

   The boundary is under the project's own processes, not under the agent. The
   Guard still refuses the agent the contents (S-13 in guard.test.ts); this is
   about `npm run dev` being able to open the file it is given. */
describe("the project's own environment file, under the boundary", () => {
  it('opens .env.local at the root and nested, and still refuses one outside', async () => {
    const look = await boundaryHere();
    if (!look.ok) {
      expect(look.why).toMatch(/no-boundary-here|piece-missing|not-holding|boundary-refused/);
      return;
    }

    const folder = await newFolder();
    writeFileSync(join(folder, '.env.local'), 'API_KEY=inside\n');
    writeFileSync(join(folder, '.env'), 'API_KEY=root\n');
    mkdirSync(join(folder, 'apps', 'web'), { recursive: true });
    writeFileSync(join(folder, 'apps', 'web', '.env.production'), 'API_KEY=nested\n');

    const elsewhere = await newFolder();
    writeFileSync(join(elsewhere, '.env'), 'API_KEY=somebody-elses\n');

    for (const [what, path] of [
      ['root .env.local', join(folder, '.env.local')],
      ['root .env', join(folder, '.env')],
      ['nested .env.production', join(folder, 'apps', 'web', '.env.production')],
    ] as const) {
      const read = await bound(folder, '/bin/cat', [path]);
      if (read === null) continue;
      expect(read.code, `${what}: ${read.err}`).toBe(0);
      expect(read.out, what).toContain('API_KEY=');
    }

    // Somebody else's, one folder over, stays shut.
    const theirs = await bound(folder, '/bin/cat', [join(elsewhere, '.env')]);
    if (theirs !== null) expect(theirs.out).not.toContain('somebody-elses');
  });

  it('still covers a real key sitting in the project', async () => {
    const look = await boundaryHere();
    if (!look.ok) return;
    const folder = await newFolder();
    writeFileSync(join(folder, 'server.pem'), 'PRIVATE KEY inside\n');
    const read = await bound(folder, '/bin/cat', [join(folder, 'server.pem')]);
    if (read !== null) expect(read.out).not.toContain('PRIVATE KEY inside');
  });
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
