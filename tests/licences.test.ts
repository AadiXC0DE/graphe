/** The manifest describes everything that ships, on whatever machine ships it.
 *
 * It is read out of the installed tree rather than the lockfile, because a
 * lockfile says what was intended and this has to say what is about to be
 * copied into the .app. That makes it machine-shaped: an optional native
 * dependency — `canvas`, under `unpdf` — installs where there is a prebuilt
 * binary for the machine and not where there is not, so two Macs with one
 * lockfile hold different trees.
 *
 * So the rule is not "identical". It is: nothing installed here may be missing
 * from the file. A package named there and absent here is a machine that had
 * it; a package here and named nowhere is something shipping undocumented.
 */

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { describe, expect, it, vi } from 'vitest';

/* Reads every package.json under node_modules that the app depends on, which is
   real disk on an idle machine and several times that under a full run. */
vi.setConfig({ testTimeout: 60_000 });

const root = fileURLToPath(new URL('..', import.meta.url));
const run = promisify(execFile);

describe('what we redistribute', () => {
  it('is all named, on this machine', async () => {
    const ran = await run('node', ['scripts/third-party-licenses.mjs', '--check'], { cwd: root });
    expect(ran.stdout).toContain('describes everything installed');
  });

  it('carries the fingerprint of the tree it was written from', async () => {
    const manifest = await readFile(new URL('../THIRD-PARTY-LICENSES.md', import.meta.url), 'utf8');
    expect(manifest).toMatch(/generated \d{4}-\d{2}-\d{2} from package-lock\.json [0-9a-f]{16}/);
  });

  /* The failure the rule is written against: something installed and named
     nowhere. */
  it('would fail if a package were installed and undocumented', async () => {
    const script = await readFile(
      new URL('../scripts/third-party-licenses.mjs', import.meta.url),
      'utf8',
    );
    expect(script).toContain('installed and undocumented');
    expect(script).toContain('process.exit(1)');
  });
});
