/** The agent runtime is pinned to one version, and it is the one installed.
 *
 * A range meant a fresh clone could install a runtime nobody had ever run this
 * app against — the whole product is a layer over it, so "one patch newer" is
 * not a detail. The upgrade is deliberate: change the pin, run the suite, and
 * these fail until both agree.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));

const RUNTIME = '@earendil-works/pi-coding-agent';

async function json(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(new URL(path, `file://${root}`), 'utf8')) as Record<string, unknown>;
}

describe('the pinned agent runtime', () => {
  it('is pinned exactly, not to a range', async () => {
    const manifest = await json('package.json');
    const pinned = (manifest['dependencies'] as Record<string, string>)[RUNTIME];
    expect(pinned).toBeDefined();
    expect(pinned).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('is the version actually on disk', async () => {
    const manifest = await json('package.json');
    const pinned = (manifest['dependencies'] as Record<string, string>)[RUNTIME];
    const installed = await json(`node_modules/${RUNTIME}/package.json`);
    expect(installed['version']).toBe(pinned);
  });

  it('is what the lockfile resolves the root dependency to', async () => {
    const lock = await json('package-lock.json');
    const packages = lock['packages'] as Record<string, Record<string, unknown>>;
    const asked = (packages['']?.['dependencies'] as Record<string, string>)[RUNTIME];
    const resolved = packages[`node_modules/${RUNTIME}`]?.['version'];
    expect(asked).toBe(resolved);
  });

  it('has nothing left patching it after install', async () => {
    const manifest = await json('package.json');
    const scripts = manifest['scripts'] as Record<string, string>;
    // A patch that rewrites the runtime's own files is a runtime nobody can
    // reason about, and its failure branch takes `npm ci` down with it.
    expect(scripts['postinstall']).toBeUndefined();
  });
});

/* And the app says so at launch when the two disagree — a mismatch on somebody
   else's machine is a Tuesday spent on a bug that was an upgrade. */
describe('the app checks it at launch', () => {
  it('reads the version that is actually running and says when it is not the pin', async () => {
    const shell = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    expect(shell).toContain('async function runtimeVersion()');
    expect(shell).toContain('sayIfTheRuntimeIsNotThePinnedOne');
    expect(shell).toContain("'the agent runtime is not the pinned one'");
    // Said, not refused: a newer runtime that works is not a reason to keep
    // somebody out of their own project.
    expect(shell).not.toContain('runtime is not the pinned one\', () => app.quit');
  });
});
