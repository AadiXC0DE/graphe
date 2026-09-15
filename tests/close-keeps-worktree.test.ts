/** Closing a conversation, and throwing one away, must not cost the work.
 *
 * Two rules, both stated by name in the plan. Closing a tab is closing a view:
 * it must not put the conversation's checkout away, because workspace cleanup is
 * an independent operation taken only when nothing live needs the folder. And
 * deleting a chat retains the workspace — the transcript goes to the trash, the
 * worktree, its branch and anything uncommitted in it do not.
 *
 * The handlers are closures inside `register()` in `electron/main.ts`, so they
 * cannot be called from here; that they are wired the other way is read off that
 * source, the way `tests/board-landed.test.ts` reads the same file. What the two
 *  operations actually do to a repository is proved below with real git.
 *
 *  Source text, not behaviour: no handler force-removing a copy or putting one away on close; no behavioural test can reach it — those handlers are closures in register().
 */

import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';

import { afterAll, describe, expect, it, vi } from 'vitest';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  createWorktree,
  releaseWorktree,
  putAwayWorktree,
  type RunGit,
} from '../src/history/worktree';

/* Real git in real temporary folders, which is a fraction of a second idle and
   several times that under a full parallel run. */
vi.setConfig({ testTimeout: 30_000 });

const main = readFileSync(fileURLToPath(new URL('../electron/main.ts', import.meta.url)), 'utf8');

const spawn = promisify(execFile);
const made: string[] = [];

afterAll(async () => {
  await Promise.all(made.map((folder) => rm(folder, { recursive: true, force: true })));
});

function git(): RunGit {
  return async (args, options) => {
    try {
      const result = await spawn('git', ['-C', options.cwd, ...args], { encoding: 'utf8' });
      return { code: 0, out: result.stdout };
    } catch (error) {
      const failed = error as { code?: number };
      return { code: typeof failed.code === 'number' ? failed.code : 1, out: '' };
    }
  };
}

async function raw(cwd: string, ...args: string[]): Promise<string> {
  const result = await spawn('git', ['-C', cwd, ...args], { encoding: 'utf8' });
  return result.stdout;
}

async function freshRepo(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'graphe-close-'));
  made.push(root);
  await raw(root, 'init', '-b', 'main');
  await raw(root, 'config', 'user.email', 'test@graphe.local');
  await raw(root, 'config', 'user.name', 'Test');
  await raw(root, 'config', 'commit.gpgsign', 'false');
  await writeFile(path.join(root, 'a.txt'), 'a one\n');
  await raw(root, 'add', '.');
  await raw(root, 'commit', '-m', 'first');
  return root;
}

/** One conversation's copy, with something in it that no branch holds. */
async function copyWithUnsavedWork(repo: string, id: string): Promise<string> {
  const started = await createWorktree(git(), repo, id, null);
  if (!started.ok) throw new Error(started.because);
  const folder = started.value?.folder ?? '';
  await writeFile(path.join(folder, 'half-done.txt'), 'not saved anywhere yet\n');
  return folder;
}

/** The body of one shell handler, from `handle` to the call that ends it. */
function handler(name: string): string {
  const at = main.indexOf(`CHANNEL.${name},`);
  expect(at, `${name} is still registered`).toBeGreaterThan(-1);
  const start = main.lastIndexOf('handle', at);
  const end = main.indexOf('\n  });', at);
  return main.slice(start, end);
}

/* ========================================================================== */

describe('a copy holding work nobody has saved', () => {
  it('is still there after being given back, rather than being taken', async () => {
    const repo = await freshRepo();
    const folder = await copyWithUnsavedWork(repo, 'half-done');

    // The operation a close is allowed to rely on: it refuses a folder holding
    // work, and says so by leaving it where it is.
    const away = await putAwayWorktree(git(), repo, folder);
    expect(away.put).toBe(false);
    expect(existsSync(folder)).toBe(true);
    expect(existsSync(path.join(folder, 'half-done.txt'))).toBe(true);
  });

  it('is destroyed by the forced removal, which is why deleting must not use it', async () => {
    const repo = await freshRepo();
    const folder = await copyWithUnsavedWork(repo, 'thrown-away');

    await releaseWorktree(git(), repo, folder);

    expect(existsSync(folder)).toBe(false);
    expect(existsSync(path.join(folder, 'half-done.txt'))).toBe(false);
  });
});

describe('closing a conversation', () => {
  it('is closing a view, and does not put the checkout away', () => {
    expect(handler('closeConversation')).not.toContain('putAwayCheckoutAt');
  });
});

describe('throwing a conversation away', () => {
  it('leaves the copy, its branch and the work in it alone', () => {
    const block = handler('deleteConversation');
    expect(block).not.toContain('releaseWorktree');
    expect(block).not.toContain('dropWorktree');
    // The registry row is left on disk, so the copy can still be landed or
    // given back deliberately afterwards.
    expect(block).not.toContain('saveCheckouts');
  });

  it('still moves the transcript somewhere recoverable', () => {
    expect(handler('deleteConversation')).toContain('moveToTrash');
  });
});

describe('the shell as a whole', () => {
  it('never force-removes a worktree', () => {
    // `releaseWorktree` is `git worktree remove --force`: no check, no rescue.
    // The presses that give a copy back go through the put-away path, which
    // reads the folder first and keeps it when it holds anything.
    expect(main).not.toContain('releaseWorktree(');
  });
});
