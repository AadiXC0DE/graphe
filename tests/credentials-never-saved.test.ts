/** Keys never reach the history, against real repositories on a real disk.
 *
 *  A developer's own repository comes with whatever `.gitignore` it came with,
 *  and the automatic save cannot depend on that: the folder is saved every time
 *  a turn ends, and a later push publishes whatever it saved. So the check here
 *  is the one that matters — `git log -p` after a save, with no `.env` in it. */

import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { devNull, tmpdir } from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, describe, expect, it, vi } from 'vitest';

import {
  CREDENTIAL_GLOBS,
  ProjectHistory,
  excludePathspecs,
  leftOutWords,
  trackedCredentials,
} from '../src/history/repo';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

/* ------------------------------------------------------------------ scaffolding */

const madeFolders: string[] = [];

afterAll(async () => {
  await Promise.all(madeFolders.map((folder) => rm(folder, { recursive: true, force: true })));
});

async function newFolder(): Promise<string> {
  const folder = await realpath(await mkdtemp(path.join(tmpdir(), 'graphe-secrets-')));
  madeFolders.push(folder);
  return folder;
}

async function put(root: string, file: string, contents: string): Promise<void> {
  const target = path.join(root, file);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, contents, 'utf8');
}

const spawn = promisify(execFile);

/** Raw access to the storage, for the tests only. */
async function storage(root: string, args: string[]): Promise<string> {
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

/** A repository the developer set up themselves: one tracked file, one saved
 *  version, and no ignore rules at all. Graphe never wrote a thing in here. */
async function theirRepo(): Promise<{ root: string; history: ProjectHistory }> {
  const root = await newFolder();
  await storage(root, ['init', '--quiet', '-b', 'main']);
  await put(root, 'README.md', '# Their project\n');
  await storage(root, ['add', 'README.md']);
  await storage(root, ['commit', '--quiet', '--message', 'first']);
  const history = new ProjectHistory(root);
  expect(await history.prepare()).toBe(false);
  return { root, history };
}

async function tracked(root: string): Promise<string[]> {
  return (await storage(root, ['ls-files'])).split('\n').filter((one) => one !== '');
}

/* ========================================================================== */
/* C-01 an untracked credential file is never saved                            */
/* ========================================================================== */

describe('C-01 a repository with no ignore rules', () => {
  it('leaves an untracked .env out of the version entirely', async () => {
    const { root, history } = await theirRepo();
    await put(root, '.env', 'STRIPE_SECRET_KEY=sk_live_do_not_publish\n');
    await put(root, 'index.html', '<h1>Hello</h1>');

    expect(await history.snapshot('Saved after a turn')).not.toBeNull();

    const everything = await storage(root, ['log', '-p']);
    expect(everything).not.toContain('.env');
    expect(everything).not.toContain('sk_live_do_not_publish');
    expect(everything).toContain('index.html');
    expect(await tracked(root)).toEqual(['README.md', 'index.html']);
  });

  it('leaves the file on disk exactly as it was', async () => {
    const { root, history } = await theirRepo();
    await put(root, '.env', 'KEY=one\n');
    await put(root, 'index.html', '<h1>Hello</h1>');
    await history.snapshot('Saved after a turn');

    expect(await readFile(path.join(root, '.env'), 'utf8')).toBe('KEY=one\n');
  });

  it('leaves out every shape of credential file, at any depth', async () => {
    const { root, history } = await theirRepo();
    const secrets = [
      '.env',
      '.env.local',
      '.env.production',
      'secrets/deploy.pem',
      'certs/server.key',
      'id_rsa',
      'id_ed25519',
      'app/.npmrc',
      '.netrc',
      'credentials.json',
      'certs/bundle.p12',
      'certs/bundle.pfx',
      'service-account-graphe.json',
      '.aws/credentials',
    ];
    for (const secret of secrets) await put(root, secret, 'SECRET=do_not_publish\n');
    await put(root, 'index.html', '<h1>Hello</h1>');

    await history.snapshot('Saved after a turn');

    const saving = await tracked(root);
    for (const secret of secrets) expect(saving).not.toContain(secret);
    expect(saving).toEqual(['README.md', 'index.html']);
    expect(await storage(root, ['log', '-p'])).not.toContain('do_not_publish');
  });

  it('still saves ordinary files that only look a little like one', async () => {
    const { root, history } = await theirRepo();
    await put(root, 'environment.ts', 'export const mode = "live";\n');
    await put(root, 'docs/keyboard.md', '# Shortcuts\n');
    await put(root, 'src/id_generator.ts', 'export const id = () => 1;\n');

    await history.snapshot('Saved after a turn');

    expect(await tracked(root)).toEqual([
      'README.md',
      'docs/keyboard.md',
      'environment.ts',
      'src/id_generator.ts',
    ]);
  });

  it('saves nothing at all when the only new file is a credential', async () => {
    const { root, history } = await theirRepo();
    await put(root, '.env', 'KEY=one\n');

    expect(await history.snapshot('Saved after a turn')).toBeNull();
    expect((await storage(root, ['log', '--oneline'])).trim().split('\n')).toHaveLength(1);
  });
});

/* ========================================================================== */
/* C-02 one the project already saves                                          */
/* ========================================================================== */

describe('C-02 a credential file already in the history', () => {
  it('is reported, and left exactly as it was', async () => {
    const { root, history } = await theirRepo();
    await put(root, '.env', 'KEY=one\n');
    await storage(root, ['add', '--force', '.env']);
    await storage(root, ['commit', '--quiet', '--message', 'their own doing']);

    await put(root, '.env', 'KEY=two\n');
    await put(root, 'index.html', '<h1>Hello</h1>');
    await history.snapshot('Saved after a turn');

    expect(history.savedCredentials).toEqual(['.env']);
    expect(await readFile(path.join(root, '.env'), 'utf8')).toBe('KEY=two\n');
    expect(await tracked(root)).toContain('.env');
    // Untouched means untouched: the change to it is not in the new version.
    expect(await storage(root, ['show', '--name-only', '--format=', 'HEAD'])).not.toContain('.env');
    expect((await storage(root, ['status', '--porcelain'])).trim()).toBe('M .env');
  });

  it('says so in a sentence naming the file', () => {
    expect(leftOutWords.already('.env')).toContain('.env');
    expect(leftOutWords.one('.env')).toContain('.env');
  });

  it('reports nothing when the project saves no credentials', async () => {
    const { root, history } = await theirRepo();
    await put(root, '.env', 'KEY=one\n');
    await put(root, 'index.html', '<h1>Hello</h1>');
    await history.snapshot('Saved after a turn');

    expect(history.savedCredentials).toEqual([]);
    expect(await history.trackedCredentials()).toEqual([]);
  });

  it('answers the same question without saving anything', async () => {
    const { root, history } = await theirRepo();
    await put(root, 'secrets/deploy.pem', 'PRIVATE KEY\n');
    await storage(root, ['add', '--force', 'secrets/deploy.pem']);
    await storage(root, ['commit', '--quiet', '--message', 'their own doing']);

    expect(await history.trackedCredentials()).toEqual(['secrets/deploy.pem']);
    expect((await storage(root, ['log', '--oneline'])).trim().split('\n')).toHaveLength(2);
  });
});

/* ========================================================================== */
/* C-03 the ways a credential file can reach the index without `add`           */
/* ========================================================================== */

describe('C-03 work carried in from elsewhere', () => {
  it('does not save a credential a merge brought with it', async () => {
    const { root, history } = await theirRepo();

    await storage(root, ['checkout', '--quiet', '-b', 'graphe/conversation-1']);
    await put(root, 'index.html', '<h1>Hello</h1>');
    await put(root, '.env', 'KEY=from_the_conversation\n');
    await storage(root, ['add', '--force', 'index.html', '.env']);
    await storage(root, ['commit', '--quiet', '--message', 'work on its own line']);
    await storage(root, ['checkout', '--quiet', 'main']);

    const version = (await storage(root, ['rev-parse', 'graphe/conversation-1'])).trim();
    const carried = await history.carryIn(version, 'Kept this piece');
    expect(carried.ok).toBe(true);

    expect(await tracked(root)).toEqual(['README.md', 'index.html']);
    expect(await storage(root, ['log', '-p', 'main'])).not.toContain('from_the_conversation');
  });
});

/* ========================================================================== */
/* C-04 the list itself                                                        */
/* ========================================================================== */

describe('C-04 one source of truth', () => {
  it('turns every glob into a pathspec git will honour', () => {
    expect(excludePathspecs()).toHaveLength(CREDENTIAL_GLOBS.length);
    for (const spec of excludePathspecs()) expect(spec.startsWith(':(exclude,glob)**/')).toBe(true);
  });

  it('reads a folder’s tracked credentials through any git runner', async () => {
    const { root } = await theirRepo();
    await put(root, '.env', 'KEY=one\n');
    await storage(root, ['add', '--force', '.env']);
    await storage(root, ['commit', '--quiet', '--message', 'their own doing']);

    const found = await trackedCredentials(root, async (args, cwd) => ({
      code: 0,
      stdout: await storage(cwd, [...args]),
      stderr: '',
    }));
    expect(found).toEqual(['.env']);
  });
});
