/** Two ends of a path, and one revision compared before anything is replaced.
 *
 * 9.5 asks that file operations canonicalize both ends, refuse traversal and a
 * symlink escape, and compare an expected revision before a destructive
 * replacement. The lexical half — `..`, encoded traversal, look-alike siblings,
 * credential names, the history store — is proven in `tests/guard.test.ts` and
 * `tests/paths.fuzz.test.ts`, and the preview server's `realpath` containment
 * (symlink escape included) in `tests/preview.test.ts`. The expected-revision
 * check before a *file* is rewritten is in `tests/anchor-edit.test.ts`.
 *
 * What none of those cover is the one place a replacement is a whole history:
 * a save is a compare-and-swap on a ref, so two saves landing at the same
 * moment cannot lose each other. That is a real repository here, because the
 * thing being tested is what real git does with a stale expectation.
 *
 * The shell's own composer — `fileInProject` (electron/main.ts:5242), which
 * re-resolves both ends through `realpath` before a read or a write — is a
 * closure inside the Electron entry and is not reachable from a test; it needs
 * `npm run test:electron` or a source-level check, and neither is behaviour.
 */

import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { devNull, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

import { afterAll, describe, expect, it, vi } from 'vitest';

import { ProjectHistory } from '../../src/history/repo';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const made: string[] = [];

afterAll(async () => {
  await Promise.all(made.map((folder) => rm(folder, { recursive: true, force: true })));
});

const spawn = promisify(execFile);

async function git(root: string, args: string[]): Promise<string> {
  const { stdout } = await spawn('git', args, {
    cwd: root,
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: devNull,
      GIT_CONFIG_SYSTEM: devNull,
      GIT_AUTHOR_NAME: 'A Developer',
      GIT_AUTHOR_EMAIL: 'developer@example.com',
      GIT_COMMITTER_NAME: 'A Developer',
      GIT_COMMITTER_EMAIL: 'developer@example.com',
    },
    maxBuffer: 32 * 1024 * 1024,
  });
  return stdout;
}

async function put(root: string, file: string, text: string): Promise<void> {
  const at = join(root, file);
  await mkdir(dirname(at), { recursive: true });
  await writeFile(at, text, 'utf8');
}

/** A repository somebody is working in, with one saved moment already. */
async function workingRepo(): Promise<{ root: string; history: ProjectHistory }> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'graphe-ops-files-')));
  made.push(root);
  await git(root, ['init', '--quiet', '-b', 'main']);
  await put(root, 'index.html', '<h1>one</h1>\n');
  await git(root, ['add', 'index.html']);
  await git(root, ['commit', '--quiet', '--message', 'first']);
  const history = new ProjectHistory(root);
  await history.prepare();
  return { root, history };
}

async function savedTitles(root: string): Promise<string[]> {
  return (await git(root, ['log', '--format=%s', 'refs/graphe/checkpoints']))
    .split('\n')
    .filter((line) => line !== '');
}

async function parents(root: string, id: string): Promise<string[]> {
  return (await git(root, ['log', '--format=%P', '-n', '1', id])).trim().split(' ').filter((one) => one !== '');
}

/* ========================================================================== */

describe('two saves landing at once', () => {
  it('keep both, one on top of the other', async () => {
    const { root } = await workingRepo();
    // Two writers, each with its own scratch index, both read the same tip and
    // then race to move the ref — which is exactly the window the compare is
    // for.
    const one = new ProjectHistory(root);
    const two = new ProjectHistory(root);
    await one.prepare();
    await two.prepare();

    await put(root, 'one.txt', 'from the first writer\n');
    await put(root, 'two.txt', 'from the second writer\n');
    const [first, second] = await Promise.all([one.snapshot('first landing'), two.snapshot('second landing')]);
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first).not.toBe(second);

    const titles = await savedTitles(root);
    expect(titles).toContain('first landing');
    expect(titles).toContain('second landing');
    // A chain, not two tips: whichever landed second took the other as its
    // parent rather than replacing it.
    const tip = (await git(root, ['rev-parse', 'refs/graphe/checkpoints'])).trim();
    const behind = await parents(root, tip);
    expect(behind).toHaveLength(1);
    expect([first, second]).toContain(behind[0]);
  });

  it('leaves the branch somebody is working on exactly where it was', async () => {
    const { root } = await workingRepo();
    const before = (await git(root, ['rev-parse', 'main'])).trim();
    const history = new ProjectHistory(root);

    await put(root, 'quiet.txt', 'a change nobody asked to save\n');
    await expect(history.snapshot('a save')).resolves.not.toBeNull();

    expect((await git(root, ['rev-parse', 'main'])).trim()).toBe(before);
    // The working tree is not staged either: the save went into an index of its
    // own rather than the one the person is about to commit with.
    expect(await git(root, ['diff', '--cached', '--name-only'])).toBe('');
  });

  it('saves nothing, and moves nothing, when nothing changed', async () => {
    const { root, history } = await workingRepo();
    await put(root, 'index.html', '<h1>two</h1>\n');
    await expect(history.snapshot('before')).resolves.not.toBeNull();
    const tip = (await git(root, ['rev-parse', 'refs/graphe/checkpoints'])).trim();

    await expect(history.snapshot('again')).resolves.toBeNull();
    expect((await git(root, ['rev-parse', 'refs/graphe/checkpoints'])).trim()).toBe(tip);
  });
});
