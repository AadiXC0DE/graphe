/** What a conversation's checkout needs to run, and what it must never take.
 *
 * Real git and real folders throughout: `git worktree add` carries tracked
 * files and nothing else, and every claim here is about what is on disk
 * afterwards rather than about what we meant to put there. The two failures
 * worth catching are a checkout that cannot run the project, and a checkout
 * that reaches back into the project it was copied from.
 */

import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

import { seedCheckout, seedWords, seededIn, WORKTREE_INCLUDE } from '../src/history/seeding';
import { createWorktree, holdsWork, writingLeftBehind, type RunGit } from '../src/history/worktree';

const spawn = promisify(execFile);

function git(): RunGit {
  return async (args, options) => {
    try {
      const result = await spawn('git', ['-C', options.cwd, ...args], { encoding: 'utf8' });
      return { code: 0, out: result.stdout };
    } catch (error) {
      const failed = error as { code?: number; stdout?: string };
      return { code: typeof failed.code === 'number' ? failed.code : 1, out: failed.stdout ?? '' };
    }
  };
}

async function raw(cwd: string, ...args: string[]): Promise<string> {
  const result = await spawn('git', ['-C', cwd, ...args], { encoding: 'utf8' });
  return result.stdout;
}

/** A repository, its ignore rules, and the files those rules hide. */
async function projectWith(files: Record<string, string>, ignore: readonly string[] = []): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'graphe-seeding-'));
  await raw(root, 'init', '-b', 'main');
  await raw(root, 'config', 'user.email', 'test@graphe.local');
  await raw(root, 'config', 'user.name', 'Test');
  await raw(root, 'config', 'commit.gpgsign', 'false');
  await writeFile(path.join(root, 'a.txt'), 'a one\n');
  if (ignore.length > 0) await writeFile(path.join(root, '.gitignore'), `${ignore.join('\n')}\n`);
  await raw(root, 'add', '.');
  await raw(root, 'commit', '-m', 'first');
  for (const [name, text] of Object.entries(files)) {
    const at = path.join(root, name);
    await mkdir(path.dirname(at), { recursive: true });
    await writeFile(at, text);
  }
  return root;
}

/** A checkout of that project, made where a real one is made: outside it. */
async function checkoutOf(repo: string, name = 'second'): Promise<string> {
  const folder = path.join(await mkdtemp(path.join(tmpdir(), 'graphe-checkout-')), name);
  const made = await createWorktree(git(), repo, name, null, { folder });
  expect(made.ok).toBe(true);
  return folder;
}

const ENV_PROJECT = {
  '.env': 'DATABASE_URL=postgres://real\n',
  '.env.local': 'AUTH_SECRET=shhh\n',
  'node_modules/left-pad/index.js': 'module.exports = 1\n',
};
const ENV_IGNORES = ['.env', '.env.local', 'node_modules/'];

describe('what a checkout is missing', () => {
  it('carries the env files, and leaves the install to be installed', async () => {
    const repo = await projectWith({ ...ENV_PROJECT, '.env.example': 'DATABASE_URL=\n' }, ENV_IGNORES);
    // Tracked, so git already puts it in the checkout and nothing here should.
    await writeFile(path.join(repo, '.env.example'), 'DATABASE_URL=\n');
    await raw(repo, 'add', '-f', '.env.example');
    await raw(repo, 'commit', '-m', 'sample');

    const folder = await checkoutOf(repo);
    expect(existsSync(path.join(folder, '.env.local'))).toBe(false);

    const seeded = await seedCheckout(git(), repo, folder);

    expect([...seeded.carried].sort()).toEqual(['.env', '.env.local']);
    expect(await readFile(path.join(folder, '.env.local'), 'utf8')).toBe('AUTH_SECRET=shhh\n');
    expect(await readFile(path.join(folder, '.env'), 'utf8')).toBe('DATABASE_URL=postgres://real\n');
    // Installed in the checkout, never copied into it.
    expect(existsSync(path.join(folder, 'node_modules'))).toBe(false);
    // Tracked, so it arrived with the checkout and was not copied over again.
    expect(await readFile(path.join(folder, '.env.example'), 'utf8')).toBe('DATABASE_URL=\n');
  });

  it('carries an env file from a folder inside the project', async () => {
    const repo = await projectWith(
      { 'apps/web/.env.local': 'NEXT_PUBLIC_URL=http://localhost:3000\n' },
      ['.env.local', '**/.env.local'],
    );
    const folder = await checkoutOf(repo);
    const seeded = await seedCheckout(git(), repo, folder);
    expect(seeded.carried).toEqual(['apps/web/.env.local']);
    expect(existsSync(path.join(folder, 'apps/web/.env.local'))).toBe(true);
  });

  it('leaves the ignore rules exactly as the project wrote them', async () => {
    const repo = await projectWith(ENV_PROJECT, ENV_IGNORES);
    const before = readFileSync(path.join(repo, '.gitignore'), 'utf8');
    const folder = await checkoutOf(repo);
    await seedCheckout(git(), repo, folder);
    expect(readFileSync(path.join(repo, '.gitignore'), 'utf8')).toBe(before);
    expect(readFileSync(path.join(folder, '.gitignore'), 'utf8')).toBe(before);
  });

  it('opens a project that has nothing to carry', async () => {
    const repo = await projectWith({});
    const folder = await checkoutOf(repo);
    const seeded = await seedCheckout(git(), repo, folder);
    expect(seeded.carried).toEqual([]);
    expect(await readFile(path.join(folder, 'a.txt'), 'utf8')).toBe('a one\n');
  });

  it('leaves the sample env alone even where a project ignores it', async () => {
    const repo = await projectWith({ '.env': 'REAL=1\n', '.env.example': 'REAL=\n' }, ['.env*']);
    const folder = await checkoutOf(repo);
    const seeded = await seedCheckout(git(), repo, folder);
    expect(seeded.carried).toEqual(['.env']);
    expect(existsSync(path.join(folder, '.env.example'))).toBe(false);
  });

  it('leaves every other credential where it is', async () => {
    const repo = await projectWith(
      {
        '.env': 'REAL=1\n',
        '.npmrc': '//registry:_authToken=nope\n',
        '.envrc': 'export SECRET=nope\n',
        'id_rsa': 'private key\n',
        'server.pem': 'certificate\n',
      },
      ['.env', '.npmrc', '.envrc', 'id_rsa', 'server.pem'],
    );
    const folder = await checkoutOf(repo);
    const seeded = await seedCheckout(git(), repo, folder);
    expect(seeded.carried).toEqual(['.env']);
    for (const name of ['.npmrc', '.envrc', 'id_rsa', 'server.pem']) {
      expect(existsSync(path.join(folder, name))).toBe(false);
    }
  });
});

describe('asked twice', () => {
  it('copies nothing a second time, and never over the checkout’s own version', async () => {
    const repo = await projectWith(ENV_PROJECT, ENV_IGNORES);
    const folder = await checkoutOf(repo);
    const first = await seedCheckout(git(), repo, folder);
    expect(first.carried.length).toBe(2);

    await writeFile(path.join(folder, '.env'), 'DATABASE_URL=postgres://the-copy\n');
    const again = await seedCheckout(git(), repo, folder);

    expect(again.carried).toEqual([]);
    expect(await readFile(path.join(folder, '.env'), 'utf8')).toBe('DATABASE_URL=postgres://the-copy\n');
  });
});

describe('the project it was copied from', () => {
  it('is not touched by the copying, or by anything the checkout does after', async () => {
    const repo = await projectWith(ENV_PROJECT, ENV_IGNORES);
    const folder = await checkoutOf(repo);
    await seedCheckout(git(), repo, folder);

    // What an install and a turn's work look like from inside the checkout.
    await mkdir(path.join(folder, 'node_modules/left-pad'), { recursive: true });
    await writeFile(path.join(folder, 'node_modules/left-pad/index.js'), 'module.exports = 2\n');
    await writeFile(path.join(folder, '.env'), 'DATABASE_URL=postgres://the-copy\n');
    await writeFile(path.join(folder, 'a.txt'), 'changed in the copy\n');

    expect(await readFile(path.join(repo, '.env'), 'utf8')).toBe('DATABASE_URL=postgres://real\n');
    expect(await readFile(path.join(repo, 'node_modules/left-pad/index.js'), 'utf8')).toBe('module.exports = 1\n');
    expect(await readFile(path.join(repo, 'a.txt'), 'utf8')).toBe('a one\n');
    expect(await raw(repo, 'status', '--porcelain')).toBe('');
  });

  it('is where the carried files still live, so putting the checkout away rescues nothing', async () => {
    const repo = await projectWith(ENV_PROJECT, [...ENV_IGNORES, '.env.test', 'notes/']);
    const folder = await checkoutOf(repo);
    await seedCheckout(git(), repo, folder);

    // Somebody's own writing, ignored by the project and in no version of it.
    await mkdir(path.join(folder, 'notes'), { recursive: true });
    await writeFile(path.join(folder, 'notes/findings.md'), 'what I found\n');
    // Written here and nowhere else, so this one is still the only copy.
    await writeFile(path.join(folder, '.env.test'), 'ONLY_HERE=1\n');

    const left = await writingLeftBehind(git(), folder);
    expect(left.files).toContain('notes/findings.md');
    expect(left.files).toContain('.env.test');
    expect(left.files).not.toContain('.env');
    expect(left.files).not.toContain('.env.local');
  });

  it('keeps its note of what was carried out of the working tree', async () => {
    const repo = await projectWith(ENV_PROJECT, ENV_IGNORES);
    const folder = await checkoutOf(repo);
    await seedCheckout(git(), repo, folder);
    expect([...(await seededIn(git(), folder))].sort()).toEqual(['.env', '.env.local']);
    expect(await holdsWork(git(), folder)).toBe(false);
  });
});

describe(WORKTREE_INCLUDE, () => {
  it('carries a gitignored file its patterns match', async () => {
    const repo = await projectWith(
      { 'config/app.local': 'port = 3000\n', [WORKTREE_INCLUDE]: 'config/*.local\n' },
      ['config/*.local'],
    );
    const folder = await checkoutOf(repo);
    const seeded = await seedCheckout(git(), repo, folder);
    expect(seeded.carried).toEqual(['config/app.local']);
    expect(await readFile(path.join(folder, 'config/app.local'), 'utf8')).toBe('port = 3000\n');
  });

  it('carries nothing for a pattern that names a tracked file', async () => {
    const repo = await projectWith({ [WORKTREE_INCLUDE]: 'a.txt\n' });
    const folder = await checkoutOf(repo);
    const seeded = await seedCheckout(git(), repo, folder);
    expect(seeded.carried).toEqual([]);
    // Still there, because git put it there.
    expect(await readFile(path.join(folder, 'a.txt'), 'utf8')).toBe('a one\n');
  });

  it('wins outright: the env files are not added on top of it', async () => {
    const repo = await projectWith(
      { ...ENV_PROJECT, 'config/app.local': 'port = 3000\n', [WORKTREE_INCLUDE]: 'config/*.local\n' },
      [...ENV_IGNORES, 'config/*.local'],
    );
    const folder = await checkoutOf(repo);
    const seeded = await seedCheckout(git(), repo, folder);
    expect(seeded.carried).toEqual(['config/app.local']);
    expect(existsSync(path.join(folder, '.env'))).toBe(false);
    expect(existsSync(path.join(folder, '.env.local'))).toBe(false);
  });
});

describe('what the person is told', () => {
  it('names every file it copied and the folder it came from', () => {
    const said = seedWords.carried(['.env.local', '.env'], '/Users/someone/site');
    expect(said).toContain('.env');
    expect(said).toContain('.env.local');
    expect(said).toContain('/Users/someone/site');
    expect(said).toMatch(/two places/);
  });

  it('tells the agent there is no install here, and how the project can change what is carried', () => {
    const said = seedWords.told(['.env.local']);
    expect(said).toContain('.env.local');
    expect(said).toMatch(/not installed/);
    expect(said).toContain(WORKTREE_INCLUDE);
  });
});
