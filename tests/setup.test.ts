/** What a project carries into a checkout, and the install that is its own step.
 *
 * The two halves that matter to somebody reading this: which files travel is a
 * decision a person makes per project and which is remembered, and whether the
 * dependencies are installed is a state that starts at "not yet" and is never
 * assumed by the fact that a checkout was made. The install is run through a
 * command the test hands in, so none of this needs npm on the machine.
 */

import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  chooseSetupFiles,
  installDependencies,
  readSetupChoices,
  setupChoicesFile,
  type RunCommand,
} from '../src/history/seeding';
import {
  asSetupFiles,
  choosingSetupFiles,
  dependenciesNotStarted,
  installPlanFor,
  sameSetupFiles,
  setupCandidates,
  setupFilesIn,
  setupWords,
  staysInside,
} from '../src/projects/setup';

const PAPER = '/Users/you/Sites/paper-street';
const ATLAS = '/Users/you/Sites/atlas-studio';

const NPM = { manager: 'npm', command: 'npm', args: ['install'] };

async function userData(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'graphe-setup-'));
}

describe('what a project carries', () => {
  it('carries nothing for a project nobody has decided anything about', () => {
    expect(setupFilesIn({}, PAPER)).toEqual([]);
    expect(setupFilesIn(choosingSetupFiles({}, PAPER, []), PAPER)).toEqual([]);
  });

  /* The whole reason it is keyed by folder: what is safe to carry out of one
     project says nothing about the next. */
  it('keeps each project’s answer to itself', () => {
    let store = choosingSetupFiles({}, PAPER, ['.env.local']);
    store = choosingSetupFiles(store, ATLAS, ['.env', '.dev.vars']);

    expect(setupFilesIn(store, PAPER)).toEqual(['.env.local']);
    expect(setupFilesIn(store, ATLAS)).toEqual(['.dev.vars', '.env']);

    store = choosingSetupFiles(store, PAPER, []);
    expect(setupFilesIn(store, PAPER)).toEqual([]);
    expect(setupFilesIn(store, ATLAS)).toEqual(['.dev.vars', '.env']);
  });

  it('leaves nothing behind when the last one is unticked', () => {
    const store = choosingSetupFiles({}, PAPER, ['.env']);
    expect(Object.keys(choosingSetupFiles(store, PAPER, []))).toEqual([]);
  });

  it('never changes the store it was given', () => {
    const before = choosingSetupFiles({}, PAPER, ['.env']);
    choosingSetupFiles(before, PAPER, ['.env', '.env.local']);
    choosingSetupFiles(before, ATLAS, ['.dev.vars']);
    expect(setupFilesIn(before, PAPER)).toEqual(['.env']);
    expect(Object.keys(before)).toEqual([PAPER]);
  });

  it('takes one path once, whatever a caller hands in', () => {
    const store = choosingSetupFiles({}, PAPER, ['.env.local', '.env', '.env.local', '']);
    expect(setupFilesIn(store, PAPER)).toEqual(['.env', '.env.local']);
  });
});

describe('reading the store back', () => {
  it('is empty for anything that is not a store', () => {
    expect(asSetupFiles(undefined)).toEqual({});
    expect(asSetupFiles(null)).toEqual({});
    expect(asSetupFiles('every env file')).toEqual({});
    expect(asSetupFiles(['.env'])).toEqual({});
  });

  it('drops what cannot be a path in the project, and keeps the rest', () => {
    expect(
      asSetupFiles({
        [PAPER]: ['.env.local', 42, '', '../../.ssh/id_rsa', '/etc/passwd', 'C:\\keys', '.env'],
        [ATLAS]: '.env',
        '': ['.env'],
        '/Users/you/Sites/nothing-decided': [],
      }),
    ).toEqual({ [PAPER]: ['.env', '.env.local'] });
  });

  it('knows a path that climbs out when it sees one', () => {
    expect(staysInside('.env')).toBe(true);
    expect(staysInside('apps/web/.env.local')).toBe(true);
    expect(staysInside('')).toBe(false);
    expect(staysInside('/etc/passwd')).toBe(false);
    expect(staysInside('C:\\keys')).toBe(false);
    expect(staysInside('../.env')).toBe(false);
    expect(staysInside('apps/../../.env')).toBe(false);
  });

  it('agrees with itself only when it says the same thing', () => {
    expect(sameSetupFiles({}, {})).toBe(true);
    expect(sameSetupFiles({ [PAPER]: ['.env'] }, { [PAPER]: ['.env'] })).toBe(true);
    expect(sameSetupFiles({ [PAPER]: ['.env'] }, { [PAPER]: ['.env.local'] })).toBe(false);
    expect(sameSetupFiles({ [PAPER]: ['.env'] }, { [PAPER]: ['.env', '.env.local'] })).toBe(false);
    expect(sameSetupFiles({ [PAPER]: ['.env'] }, { [ATLAS]: ['.env'] })).toBe(false);
    expect(sameSetupFiles({ [PAPER]: ['.env'] }, {})).toBe(false);
    expect(sameSetupFiles({}, { [PAPER]: ['.env'] })).toBe(false);
  });
});

describe('the store on disk', () => {
  it('keeps a project’s answer between sittings', async () => {
    const dir = await userData();
    expect(await readSetupChoices(dir)).toEqual({});

    const after = await chooseSetupFiles(dir, PAPER, ['.env.local', '.env']);

    expect(after).toEqual({ [PAPER]: ['.env', '.env.local'] });
    expect(await readSetupChoices(dir)).toEqual(after);
    expect(setupChoicesFile(dir)).toBe(path.join(dir, 'setup.json'));

    // Another project, decided the next day, leaves the first answer alone.
    expect(await chooseSetupFiles(dir, ATLAS, ['.dev.vars'])).toEqual({
      [PAPER]: ['.env', '.env.local'],
      [ATLAS]: ['.dev.vars'],
    });
    expect(await readSetupChoices(dir)).toEqual({
      [PAPER]: ['.env', '.env.local'],
      [ATLAS]: ['.dev.vars'],
    });

    expect(await chooseSetupFiles(dir, PAPER, [])).toEqual({ [ATLAS]: ['.dev.vars'] });
  });

  it('writes nothing for ticks that say what the file already says', async () => {
    const dir = await userData();
    // Written by hand, and not the way this writes: if it were written again,
    // the spacing would give it away.
    const byHand = JSON.stringify({ [PAPER]: ['.env'] });
    await writeFile(setupChoicesFile(dir), byHand);

    expect(await chooseSetupFiles(dir, PAPER, ['.env'])).toEqual({ [PAPER]: ['.env'] });
    expect(await readFile(setupChoicesFile(dir), 'utf8')).toBe(byHand);
  });

  it('is no choices for a file that is missing or is not json', async () => {
    const dir = await userData();
    expect(await readSetupChoices(dir)).toEqual({});
    await writeFile(setupChoicesFile(dir), '{ this is not json');
    expect(await readSetupChoices(dir)).toEqual({});
    await writeFile(setupChoicesFile(dir), JSON.stringify({ [PAPER]: '../../etc/passwd' }));
    expect(await readSetupChoices(dir)).toEqual({});
  });
});

describe('what the flow offers a project', () => {
  it('puts what is already chosen first, and leaves folders and the sample out', () => {
    expect(
      setupCandidates(
        ['.env', '.env.local', '.env.example', 'node_modules/', 'apps/web/', 'apps/web/.env.local'],
        ['.env.local'],
      ),
    ).toEqual([
      { path: '.env.local', chosen: true },
      { path: '.env', chosen: false },
      { path: 'apps/web/.env.local', chosen: false },
    ]);
  });

  it('offers the sample back where somebody has already chosen it', () => {
    expect(setupCandidates(['.env.example'], ['.env.example'])).toEqual([
      { path: '.env.example', chosen: true },
    ]);
  });

  it('offers nothing for a project that ignores nothing', () => {
    expect(setupCandidates([])).toEqual([]);
  });
});

describe('the install a project needs', () => {
  it('reads which manager wrote the lockfile', () => {
    expect(installPlanFor(['package.json'])).toEqual(NPM);
    expect(installPlanFor(['package.json', 'package-lock.json'])).toEqual(NPM);
    expect(installPlanFor(['package.json', 'pnpm-lock.yaml'])).toEqual({
      manager: 'pnpm',
      command: 'pnpm',
      args: ['install'],
    });
    expect(installPlanFor(['package.json', 'yarn.lock'])).toEqual({
      manager: 'yarn',
      command: 'yarn',
      args: ['install'],
    });
    expect(installPlanFor(['package.json', 'bun.lockb'])).toEqual({
      manager: 'bun',
      command: 'bun',
      args: ['install'],
    });
  });

  /* A migration nobody finished leaves two lockfiles, and the answer must not
     depend on the order the folder happened to list them in. */
  it('gives one answer for a repository with two lockfiles', () => {
    const one = installPlanFor(['yarn.lock', 'pnpm-lock.yaml', 'package.json']);
    const other = installPlanFor(['pnpm-lock.yaml', 'yarn.lock', 'package.json']);
    expect(one).toEqual(other);
    expect(one?.manager).toBe('pnpm');
  });

  it('has nothing to install for a project with no manifest', () => {
    expect(installPlanFor([])).toBeNull();
    expect(installPlanFor(['a.txt', 'README.md', 'src'])).toBeNull();
  });
});

describe('installing them, as a step of its own', () => {
  it('runs the plan in the checkout and reports running, then done', async () => {
    const folder = await mkdtemp(path.join(tmpdir(), 'graphe-install-'));
    const seen: Array<{ command: string; args: readonly string[]; folder: string }> = [];
    const run: RunCommand = async (command, args, options) => {
      seen.push({ command, args, folder: options.folder });
      return { code: 0, said: 'added 120 packages\n' };
    };
    const states: string[] = [];

    const state = await installDependencies(run, folder, NPM, (one) => states.push(one.how));

    expect(seen).toEqual([{ command: 'npm', args: ['install'], folder }]);
    expect(states).toEqual(['running', 'done']);
    expect(state).toEqual({ how: 'done' });
  });

  it('keeps the reason a failed install gave, and never reports it as done', async () => {
    const folder = await mkdtemp(path.join(tmpdir(), 'graphe-install-'));
    const run: RunCommand = async () => ({
      code: 1,
      said: 'npm ERR! code EACCES\nnpm ERR! syscall mkdir\nEACCES: permission denied, mkdir \'/site/node_modules\'\n',
    });
    const states: string[] = [];

    const state = await installDependencies(run, folder, NPM, (one) => states.push(one.how));

    expect(states).toEqual(['running', 'failed']);
    expect(state).toMatchObject({ how: 'failed' });
    expect(state.how === 'failed' ? state.because : '').toContain('EACCES: permission denied');
  });

  it('says so when the manager is not on the computer at all', async () => {
    const folder = await mkdtemp(path.join(tmpdir(), 'graphe-install-'));
    // 127 is what a shell reports for a program that is not there.
    const run: RunCommand = async () => ({ code: 127, said: '' });

    const state = await installDependencies(run, folder, NPM);

    expect(state).toEqual({ how: 'failed', because: 'npm is not on this computer' });
  });

  it('fails rather than throwing when the command cannot be started', async () => {
    const folder = await mkdtemp(path.join(tmpdir(), 'graphe-install-'));
    const run: RunCommand = async () => {
      throw new Error('spawn pnpm ENOENT');
    };

    const state = await installDependencies(run, folder, { ...NPM, manager: 'pnpm', command: 'pnpm' });

    expect(state.how).toBe('failed');
    expect(state.how === 'failed' ? state.because : '').toContain('spawn pnpm ENOENT');
  });

  /* An install is where a registry token is quoted back at whoever reads the
     reason, and the reason goes on screen. */
  it('does not carry a credential out of what the command said', async () => {
    const folder = await mkdtemp(path.join(tmpdir(), 'graphe-install-'));
    const said = 'npm ERR! code E401\n//registry.npmjs.org/:_authToken=npm_aBcD1234eFgH\n';

    const state = await installDependencies(async () => ({ code: 1, said }), folder, NPM);
    const because = state.how === 'failed' ? state.because : '';

    expect(because).not.toContain('npm_aBcD1234eFgH');
    expect(because).toContain('_authToken=…');

    const bearer = await installDependencies(
      async () => ({ code: 1, said: 'fatal: registry said Authorization: Bearer npx_9zY8xW7v\n' }),
      folder,
      NPM,
    );
    const said2 = bearer.how === 'failed' ? bearer.because : '';
    expect(said2).not.toContain('npx_9zY8xW7v');
  });

  it('says where the step stands, and starts at not started', () => {
    expect(dependenciesNotStarted).toEqual({ how: 'not-started' });
    expect(setupWords.dependencies(dependenciesNotStarted)).toMatch(/not installed/);
    expect(setupWords.dependencies({ how: 'running' })).toMatch(/[Ii]nstalling/);
    expect(setupWords.dependencies({ how: 'failed', because: 'no network' })).toContain('no network');
    expect(setupWords.dependencies({ how: 'done' })).toMatch(/installed/);
  });
});
