/** Keeping part of a change, and taking the rest back out.
 *
 * The working tree already holds everything; keeping a subset means undoing the
 * rest. Real git throughout, because "the patch applied" is exactly the claim
 * that cannot be checked any other way — and the one that must never half
 * happen.
 */

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, describe, expect, it } from 'vitest';

import { ProjectHistory } from '../src/history/repo';
import { diffOf, parseDiff } from '../src/diff/hunks';

const spawn = promisify(execFile);
const made: string[] = [];
afterAll(async () => {
  await Promise.all(made.map((one) => rm(one, { recursive: true, force: true })));
});

async function raw(cwd: string, ...args: string[]): Promise<string> {
  return (await spawn('git', ['-C', cwd, ...args], { encoding: 'utf8' })).stdout;
}

/** A file with three well-separated changes in it, so dropping one is a real
 *  question about which hunk rather than about the whole file. */
async function aProject(): Promise<{ root: string; history: ProjectHistory }> {
  const root = await mkdtemp(join(tmpdir(), 'graphe-drop-'));
  made.push(root);
  await raw(root, 'init', '-b', 'main');
  await raw(root, 'config', 'user.email', 'test@graphe.local');
  await raw(root, 'config', 'user.name', 'Test');
  await raw(root, 'config', 'commit.gpgsign', 'false');
  const lines = Array.from({ length: 30 }, (_, at) => `line ${String(at + 1)}`);
  await writeFile(join(root, 'page.txt'), `${lines.join('\n')}\n`);
  await raw(root, 'add', '.');
  await raw(root, 'commit', '-m', 'first');

  const changed = [...lines];
  changed[2] = 'line 3 — first change';
  changed[14] = 'line 15 — second change';
  changed[27] = 'line 28 — third change';
  await writeFile(join(root, 'page.txt'), `${changed.join('\n')}\n`);
  return { root, history: new ProjectHistory(root) };
}

describe('taking part of a change back out', () => {
  it('undoes exactly the hunks it was given, and leaves the rest', async () => {
    const { root, history } = await aProject();
    const diff = await history.diffFor({ kind: 'working' });
    const files = parseDiff(diff);
    const hunks = files.flatMap((one) => one.hunks);
    expect(hunks).toHaveLength(3);

    // Drop the middle one. The other two must survive untouched.
    const dropping = hunks[1];
    expect(dropping).toBeDefined();
    const patch = diffOf(files, (hunk) => hunk.id === dropping?.id);

    const answer = await history.dropChanges(patch);
    expect(answer.ok).toBe(true);

    const now = await readFile(join(root, 'page.txt'), 'utf8');
    expect(now).toContain('line 3 — first change');
    expect(now).not.toContain('line 15 — second change');
    expect(now).toContain('line 15');
    expect(now).toContain('line 28 — third change');
  }, 30_000);

  it('takes everything back out when everything is dropped', async () => {
    const { root, history } = await aProject();
    const files = parseDiff(await history.diffFor({ kind: 'working' }));
    expect((await history.dropChanges(diffOf(files, () => true))).ok).toBe(true);
    expect(await history.hasUnsavedChanges()).toBe(false);
    expect(await readFile(join(root, 'page.txt'), 'utf8')).toContain('line 3\n');
  }, 30_000);

  it('does nothing at all when nothing was dropped', async () => {
    const { root, history } = await aProject();
    const before = await readFile(join(root, 'page.txt'), 'utf8');
    expect((await history.dropChanges('')).ok).toBe(true);
    expect(await readFile(join(root, 'page.txt'), 'utf8')).toBe(before);
  }, 30_000);

  /* The one outcome nobody could unpick: half a patch. It is checked before it
     is applied, so a patch that would not land leaves the folder alone. */
  it('refuses a patch that would not apply, rather than applying part of it', async () => {
    const { root, history } = await aProject();
    const before = await readFile(join(root, 'page.txt'), 'utf8');
    const nonsense = [
      'diff --git a/page.txt b/page.txt',
      '--- a/page.txt',
      '+++ b/page.txt',
      '@@ -1,2 +1,2 @@',
      '-something that was never there',
      '+something else',
      '',
    ].join('\n');

    const answer = await history.dropChanges(nonsense);
    expect(answer.ok).toBe(false);
    expect(await readFile(join(root, 'page.txt'), 'utf8')).toBe(before);
  }, 30_000);
});
