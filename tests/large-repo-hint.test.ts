/** Saying, once, why saving a big project takes a moment.
 *
 * Every save asks git what changed and stages it, and on a project with tens of
 * thousands of files that is seconds of somebody's afternoon. Two settings make
 * git's own scan fast — so the hint prints the commands, and sets nothing: this
 * is the person's repository configuration, and a tool that rewrites it behind
 * them is a tool they cannot predict.
 */

import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

import { hintForLargeRepo, type Attempt, type GitRunner } from '../src/history/repo';

const spawn = promisify(execFile);

/** Real git, the way the app runs it. */
const realGit: GitRunner = async (args, cwd) => {
  try {
    const done = await spawn('git', [...args], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    return { code: 0, stdout: done.stdout, stderr: done.stderr };
  } catch (error) {
    const failed = error as { code?: number; stdout?: string; stderr?: string };
    return {
      code: typeof failed.code === 'number' ? failed.code : 1,
      stdout: failed.stdout ?? '',
      stderr: failed.stderr ?? '',
    };
  }
};

async function freshRepo(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'graphe-large-'));
  await spawn('git', ['init', '-b', 'main'], { cwd: root });
  await spawn('git', ['config', 'user.email', 'test@graphe.local'], { cwd: root });
  await spawn('git', ['config', 'user.name', 'Test'], { cwd: root });
  await writeFile(path.join(root, 'a.txt'), 'a one\n');
  await spawn('git', ['add', '.'], { cwd: root });
  await spawn('git', ['-c', 'commit.gpgsign=false', 'commit', '-m', 'first'], { cwd: root });
  return root;
}

/** A project of a given size, without writing one. `git ls-files -z` is the
 *  only thing the count comes from, and a hundred thousand real files on disk
 *  would be a slower test and not a truer one. */
function repoOf(files: number, watch?: { calls: number }): GitRunner {
  return async () => {
    if (watch !== undefined) watch.calls += 1;
    const names = Array.from({ length: files }, (_, at) => `src/file-${String(at)}.ts`);
    const stdout = names.map((name) => `${name}\u0000`).join('');
    return { code: 0, stdout, stderr: '' } satisfies Attempt;
  };
}

describe('the hint for a large project', () => {
  it('says nothing about an ordinary project', async () => {
    const repo = await freshRepo();
    try {
      expect(await hintForLargeRepo(repo, realGit)).toBeNull();
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it('prints the two commands once the project is big', async () => {
    const hint = await hintForLargeRepo('/one/big', repoOf(60_000));
    expect(hint).not.toBeNull();
    expect(hint).toContain('60,000 files');
    expect(hint).toContain('git config core.untrackedCache true');
    expect(hint).toContain('git config core.fsmonitor true');
  });

  it('counts the files once, however often it is asked', async () => {
    const watch = { calls: 0 };
    const runner = repoOf(40_000, watch);
    expect(await hintForLargeRepo('/one/counted', runner)).not.toBeNull();
    expect(await hintForLargeRepo('/one/counted', runner)).not.toBeNull();
    expect(watch.calls).toBe(1);
  });

  it('says nothing when git cannot answer', async () => {
    const folder = await mkdtemp(path.join(tmpdir(), 'graphe-not-a-repo-'));
    try {
      expect(await hintForLargeRepo(folder, realGit)).toBeNull();
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });

  it('changes nothing about the project it is talking about', async () => {
    const repo = await freshRepo();
    try {
      const before = (await realGit(['config', '--local', '--list'], repo)).stdout;
      await hintForLargeRepo(repo, realGit);
      expect((await realGit(['config', '--local', '--list'], repo)).stdout).toBe(before);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });
});
