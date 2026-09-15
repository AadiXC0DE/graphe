/** What a conversation's checkout needs to run, and what it must never take.
 *
 * Real git and real folders throughout: `git worktree add` carries tracked
 * files and nothing else, and every claim here is about what is on disk
 * afterwards rather than about what we meant to put there. The failures worth
 * catching are a checkout that cannot run the project, a checkout that reaches
 * back into the project it was copied from, and a file that arrives in it by
 * way of somebody else's folder.
 */

import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

import {
  CARRY_LIMITS,
  installPlanAt,
  seedCheckout,
  seedingCandidates,
  seedWords,
  seededIn,
  WORKTREE_INCLUDE,
} from '../src/history/seeding';
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

/** Something to point a link at, outside every checkout and every project. */
async function somewhereElse(name: string, text: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'graphe-elsewhere-'));
  await writeFile(path.join(root, name), text);
  return root;
}

/** A checkout of that project, made where a real one is made: outside it. */
async function checkoutOf(repo: string, name = 'second'): Promise<string> {
  const folder = path.join(await mkdtemp(path.join(tmpdir(), 'graphe-checkout-')), name);
  const made = await createWorktree(git(), repo, name, null, { folder });
  expect(made.ok).toBe(true);
  return folder;
}

/** A mode as a person would read it, without the file type bits. */
async function modeOf(file: string): Promise<number> {
  return (await stat(file)).mode & 0o777;
}

const ENV_PROJECT = {
  '.env': 'DATABASE_URL=postgres://real\n',
  '.env.local': 'AUTH_SECRET=shhh\n',
  'node_modules/left-pad/index.js': 'module.exports = 1\n',
};
const ENV_IGNORES = ['.env', '.env.local', 'node_modules/'];
const WANTED = ['.env', '.env.local'];

describe('what a checkout is missing', () => {
  it('carries nothing until somebody says so', async () => {
    const repo = await projectWith(ENV_PROJECT, ENV_IGNORES);
    const folder = await checkoutOf(repo);

    const seeded = await seedCheckout(git(), repo, folder);

    expect(seeded).toEqual({ carried: [], omitted: [] });
    // Every gitignored `.env*` used to arrive here on our own authority, which
    // is a second copy of somebody's keys in a folder they had not looked at.
    expect(existsSync(path.join(folder, '.env'))).toBe(false);
    expect(existsSync(path.join(folder, '.env.local'))).toBe(false);
  });

  it('carries the files the project chose, and leaves the install to be installed', async () => {
    const repo = await projectWith({ ...ENV_PROJECT, '.env.example': 'DATABASE_URL=\n' }, ENV_IGNORES);
    // Tracked, so git already puts it in the checkout and nothing here should.
    await writeFile(path.join(repo, '.env.example'), 'DATABASE_URL=\n');
    await raw(repo, 'add', '-f', '.env.example');
    await raw(repo, 'commit', '-m', 'sample');

    const folder = await checkoutOf(repo);
    expect(existsSync(path.join(folder, '.env.local'))).toBe(false);

    const seeded = await seedCheckout(git(), repo, folder, WANTED);

    expect([...seeded.carried].sort()).toEqual(['.env', '.env.local']);
    expect(await readFile(path.join(folder, '.env.local'), 'utf8')).toBe('AUTH_SECRET=shhh\n');
    expect(await readFile(path.join(folder, '.env'), 'utf8')).toBe('DATABASE_URL=postgres://real\n');
    // Installed in the checkout, never copied into it.
    expect(existsSync(path.join(folder, 'node_modules'))).toBe(false);
    // Tracked, so it arrived with the checkout and was not copied over again.
    expect(await readFile(path.join(folder, '.env.example'), 'utf8')).toBe('DATABASE_URL=\n');
  });

  it('gives what it carries a mode only its owner can read', async () => {
    const repo = await projectWith(ENV_PROJECT, ENV_IGNORES);
    const folder = await checkoutOf(repo);

    await seedCheckout(git(), repo, folder, WANTED);

    for (const name of WANTED) expect(await modeOf(path.join(folder, name))).toBe(0o600);
  });

  it('carries a file from a folder inside the project', async () => {
    const repo = await projectWith(
      { 'apps/web/.env.local': 'NEXT_PUBLIC_URL=http://localhost:3000\n' },
      ['.env.local', '**/.env.local'],
    );
    const folder = await checkoutOf(repo);
    const seeded = await seedCheckout(git(), repo, folder, ['apps/web/.env.local']);
    expect(seeded.carried).toEqual(['apps/web/.env.local']);
    expect(await modeOf(path.join(folder, 'apps/web/.env.local'))).toBe(0o600);
  });

  it('leaves the ignore rules exactly as the project wrote them', async () => {
    const repo = await projectWith(ENV_PROJECT, ENV_IGNORES);
    const before = readFileSync(path.join(repo, '.gitignore'), 'utf8');
    const folder = await checkoutOf(repo);
    await seedCheckout(git(), repo, folder, WANTED);
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

  it('carries exactly what the project chose, and no other credential', async () => {
    const repo = await projectWith(
      {
        '.env': 'REAL=1\n',
        '.env.local': 'LOCAL=1\n',
        '.npmrc': '//registry:_authToken=nope\n',
        '.envrc': 'export SECRET=nope\n',
        'id_rsa': 'private key\n',
        'server.pem': 'certificate\n',
      },
      ['.env', '.env.local', '.npmrc', '.envrc', 'id_rsa', 'server.pem'],
    );
    const folder = await checkoutOf(repo);
    // `.npmrc` is a choice somebody can make here, and nothing here makes it.
    const seeded = await seedCheckout(git(), repo, folder, WANTED);
    expect([...seeded.carried].sort()).toEqual(WANTED);
    for (const name of ['.npmrc', '.envrc', 'id_rsa', 'server.pem']) {
      expect(existsSync(path.join(folder, name))).toBe(false);
    }
  });

  it('does not carry the sample env even where the project ignores it', async () => {
    const repo = await projectWith({ '.env': 'REAL=1\n', '.env.example': 'REAL=\n' }, ['.env', '.env.example']);
    const folder = await checkoutOf(repo);
    const seeded = await seedCheckout(git(), repo, folder, ['.env']);
    expect(seeded.carried).toEqual(['.env']);
    expect(existsSync(path.join(folder, '.env.example'))).toBe(false);
  });

  it('leaves out what will not fit, and says which and why', async () => {
    const repo = await projectWith(
      { '.env': 'A=1\n', '.env.local': 'B=2\n', '.env.test': 'C=3\n' },
      ['.env', '.env.local', '.env.test'],
    );
    const folder = await checkoutOf(repo);

    const seeded = await seedCheckout(
      git(),
      repo,
      folder,
      ['.env', '.env.local', '.env.test'],
      { files: 2, bytes: CARRY_LIMITS.bytes },
    );

    expect(seeded.carried).toHaveLength(2);
    expect(seeded.omitted).toEqual([{ path: '.env.test', because: 'past-the-ceiling' }]);
    expect(existsSync(path.join(folder, '.env.test'))).toBe(false);
  });

  it('refuses a folder somebody named, because an install is not a copy', async () => {
    const repo = await projectWith({ 'node_modules/left-pad/index.js': 'x\n' }, ['node_modules/']);
    const folder = await checkoutOf(repo);

    const seeded = await seedCheckout(git(), repo, folder, ['node_modules/']);

    expect(seeded.carried).toEqual([]);
    expect(seeded.omitted).toEqual([{ path: 'node_modules/', because: 'not-a-regular-file' }]);
    expect(existsSync(path.join(folder, 'node_modules'))).toBe(false);
  });

  /* As root, a file with no permissions is readable anyway, and this proves
     nothing either way. */
  it.runIf(process.getuid?.() !== 0)(
    'leaves nothing half-written when a file cannot be read',
    async () => {
      const repo = await projectWith({ '.env': 'REAL=1\n' }, ['.env']);
      await chmod(path.join(repo, '.env'), 0o000);
      const folder = await checkoutOf(repo);

      const seeded = await seedCheckout(git(), repo, folder, ['.env']);

      expect(seeded.omitted).toEqual([{ path: '.env', because: 'could-not-be-copied' }]);
      expect(existsSync(path.join(folder, '.env'))).toBe(false);
    },
  );
});

describe('what must not arrive through somebody else’s folder', () => {
  it('refuses a file that is a link out of the project', async () => {
    const outside = await somewhereElse('real.env', 'STRIPE_KEY=live\n');
    const repo = await projectWith({}, ['.env']);
    await symlink(path.join(outside, 'real.env'), path.join(repo, '.env'));
    const folder = await checkoutOf(repo);

    const seeded = await seedCheckout(git(), repo, folder, ['.env']);

    expect(seeded.carried).toEqual([]);
    expect(seeded.omitted).toEqual([{ path: '.env', because: 'leaves-the-project' }]);
    expect(existsSync(path.join(folder, '.env'))).toBe(false);
    // And the file it pointed at is still the only copy of itself.
    expect(await readFile(path.join(outside, 'real.env'), 'utf8')).toBe('STRIPE_KEY=live\n');
  });

  it('refuses to write through a link out of the checkout', async () => {
    const outside = await somewhereElse('keep.txt', 'not mine\n');
    const repo = await projectWith({ 'config/app.local': 'port = 3000\n' }, ['config/*.local']);
    const folder = await checkoutOf(repo);
    // A link where the checkout keeps its config: a recursive copy would follow
    // it and write the file into somebody else's folder entirely.
    await symlink(outside, path.join(folder, 'config'));

    const seeded = await seedCheckout(git(), repo, folder, ['config/app.local']);

    expect(seeded.carried).toEqual([]);
    expect(seeded.omitted).toEqual([{ path: 'config/app.local', because: 'leaves-the-project' }]);
    expect(existsSync(path.join(outside, 'app.local'))).toBe(false);
  });

  it('takes a path that climbs out of a store as nothing at all', async () => {
    const repo = await projectWith({ '.env': 'REAL=1\n' }, ['.env']);
    const folder = await checkoutOf(repo);

    // What a hand-edited store could say. Nothing ignored matches these, so
    // there is nothing to carry and nothing to report leaving out.
    const seeded = await seedCheckout(git(), repo, folder, ['../.env', '/etc/passwd', '', 'notes/']);

    expect(seeded).toEqual({ carried: [], omitted: [] });
    expect(existsSync(path.join(folder, '.env'))).toBe(false);
  });
});

describe('asked twice', () => {
  it('copies nothing a second time, and never over the checkout’s own version', async () => {
    const repo = await projectWith(ENV_PROJECT, ENV_IGNORES);
    const folder = await checkoutOf(repo);
    const first = await seedCheckout(git(), repo, folder, WANTED);
    expect(first.carried.length).toBe(2);

    await writeFile(path.join(folder, '.env'), 'DATABASE_URL=postgres://the-copy\n');
    const again = await seedCheckout(git(), repo, folder, WANTED);

    expect(again.carried).toEqual([]);
    expect(await readFile(path.join(folder, '.env'), 'utf8')).toBe('DATABASE_URL=postgres://the-copy\n');
  });
});

describe('the project it was copied from', () => {
  it('is not touched by the copying, or by anything the checkout does after', async () => {
    const repo = await projectWith(ENV_PROJECT, ENV_IGNORES);
    const folder = await checkoutOf(repo);
    await seedCheckout(git(), repo, folder, WANTED);

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
    await seedCheckout(git(), repo, folder, WANTED);

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
    await seedCheckout(git(), repo, folder, WANTED);
    expect([...(await seededIn(git(), folder))].sort()).toEqual(WANTED);
    expect(await holdsWork(git(), folder)).toBe(false);
  });
});

describe('the install, which making a checkout does not do', () => {
  it('leaves a checkout that cannot run yet, and says what it would run', async () => {
    const repo = await projectWith({}, ['node_modules/']);
    await writeFile(path.join(repo, 'package.json'), '{ "name": "site" }\n');
    await writeFile(path.join(repo, 'package-lock.json'), '{ "lockfileVersion": 3 }\n');
    await raw(repo, 'add', 'package.json', 'package-lock.json');
    await raw(repo, 'commit', '-m', 'manifest');

    const folder = await checkoutOf(repo);
    const seeded = await seedCheckout(git(), repo, folder);

    // The manifest is tracked, so it is in the checkout; the install is not, and
    // nothing about making the checkout pretends otherwise.
    expect(await readFile(path.join(folder, 'package.json'), 'utf8')).toBe('{ "name": "site" }\n');
    expect(seeded.carried).toEqual([]);
    expect(existsSync(path.join(folder, 'node_modules'))).toBe(false);
    expect(await installPlanAt(folder)).toEqual({
      manager: 'npm',
      command: 'npm',
      args: ['install'],
    });
  });

  it('has nothing to install for a project with no manifest', async () => {
    const repo = await projectWith({});
    const folder = await checkoutOf(repo);
    expect(await installPlanAt(folder)).toBeNull();
  });
});

describe('what the flow offers', () => {
  it('lists what the project ignores, folders and the sample left out', async () => {
    const repo = await projectWith(
      {
        '.env': 'A=1\n',
        '.env.local': 'B=2\n',
        '.env.example': 'A=\n',
        'node_modules/x/index.js': 'x\n',
      },
      ['.env', '.env.local', '.env.example', 'node_modules/'],
    );

    const rows = await seedingCandidates(git(), repo, ['.env.local']);

    expect(rows).toEqual([
      { path: '.env.local', chosen: true },
      { path: '.env', chosen: false },
    ]);
  });

  it('offers a project that ignores nothing an empty list', async () => {
    const repo = await projectWith({});
    expect(await seedingCandidates(git(), repo)).toEqual([]);
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

  it('does not add the env files on top of it', async () => {
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

  it('carries what the file names and what the person chose, both', async () => {
    const repo = await projectWith(
      { ...ENV_PROJECT, 'config/app.local': 'port = 3000\n', [WORKTREE_INCLUDE]: 'config/*.local\n' },
      [...ENV_IGNORES, 'config/*.local'],
    );
    const folder = await checkoutOf(repo);
    const seeded = await seedCheckout(git(), repo, folder, ['.env.local']);
    expect([...seeded.carried].sort()).toEqual(['.env.local', 'config/app.local']);
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

  it('says what was named for the checkout and did not arrive, and why', () => {
    const said = seedWords.leftOut(
      [
        { path: '.env.local', because: 'leaves-the-project' },
        { path: '.env.production', because: 'past-the-ceiling' },
      ],
      '/Users/someone/site',
    );
    expect(said).toContain('.env.local');
    expect(said).toContain('.env.production');
    expect(said).toContain('outside the project');
    expect(said).toContain('worth seeding with');
    expect(said).toContain('/Users/someone/site');
  });

  it('says nothing where nothing was left out', () => {
    expect(seedWords.leftOut([], '/Users/someone/site')).toBeNull();
  });

  it('tells the agent there is no install here, and how the project can change what is carried', () => {
    const said = seedWords.told(['.env.local']);
    expect(said).toContain('.env.local');
    expect(said).toMatch(/not installed/);
    expect(said).toContain(WORKTREE_INCLUDE);
  });
});
