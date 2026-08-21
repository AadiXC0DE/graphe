/** A helper that changes files.
 *
 * Every other role reports and changes nothing, and that is deliberate. This
 * one writes — so the only thing standing between it and somebody's project is
 * the folder it was given, because every path rule the Guard applies is
 * measured from there. These tests are that claim, checked: a real copy made by
 * real git, and the Guard asked what it would do from inside one.
 */

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

import { HELPER_DECLINED, HELPER_ROLES, ROLES, mayRun, roleSpec } from '../src/agent/pi/child';
import { builderFolder, makeBuilderCopy } from '../src/agent/pi/tools';
import { changesAnything, evaluate } from '../src/agent/guard/policy';

const spawn = promisify(execFile);

async function raw(cwd: string, ...args: string[]): Promise<string> {
  const result = await spawn('git', ['-C', cwd, ...args], { encoding: 'utf8' });
  return result.stdout;
}

async function freshRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'graphe-builder-'));
  await raw(root, 'init', '-b', 'main');
  await raw(root, 'config', 'user.email', 'test@graphe.local');
  await raw(root, 'config', 'user.name', 'Test');
  await raw(root, 'config', 'commit.gpgsign', 'false');
  await writeFile(join(root, 'a.txt'), 'a one\n');
  await raw(root, 'add', '.');
  await raw(root, 'commit', '-m', 'first');
  return root;
}

/* ========================================================================== */
/* B-01 the role                                                               */
/* ========================================================================== */

describe('B-01 one role may change things, and only one', () => {
  it('holds the making tools; the reviewer’s bash is only the one-file test exception', () => {
    expect(roleSpec('builder').tools).toEqual(
      expect.arrayContaining(['read', 'ls', 'grep', 'find', 'write', 'edit', 'bash']),
    );
    for (const role of HELPER_ROLES) {
      const spec = roleSpec(role);
      if (role === 'builder') continue;
      for (const tool of ['write', 'edit']) expect(spec.tools).not.toContain(tool);
      if (role === 'reviewer') expect(spec.tools).toContain('bash');
      else expect(spec.tools).not.toContain('bash');
      expect(spec.mayChange).toBe(false);
    }
  });

  it('never reaches the web, so a change cannot come from a page it read', () => {
    expect(roleSpec('builder').tools).not.toContain('websearch');
    expect(roleSpec('builder').tools).not.toContain('webfetch');
  });

  /* The one that matters: a role nobody recognises must not be the writing one.
     Role names come off model output. */
  it('falls back to the role that changes nothing', () => {
    expect(roleSpec('Builder' as never).mayChange).toBe(false);
    expect(roleSpec('anything' as never).mayChange).toBe(false);
    expect(roleSpec(undefined).mayChange).toBe(false);
    expect(roleSpec(null).name).toBe('helper');
  });

  it('says it builds rather than describes, because a describing builder is the failure', () => {
    expect(ROLES.builder.spoken).toMatch(/rather than describing it/i);
    expect(ROLES.builder.needsCopy).toBe(true);
  });
});

/* ========================================================================== */
/* B-02 the copy, made by real git                                             */
/* ========================================================================== */

describe('B-02 its own copy of the project', () => {
  it('is a real working copy, outside the folder somebody is looking at', async () => {
    const repo = await freshRepo();
    try {
      const copy = await makeBuilderCopy(repo, 'call-1');
      expect(copy).not.toBeNull();
      if (copy === null) return;

      expect(existsSync(join(copy.folder, 'a.txt'))).toBe(true);
      expect(await readFile(join(copy.folder, 'a.txt'), 'utf8')).toBe('a one\n');
      // Outside, so nothing it writes turns up under the project.
      expect(resolve(copy.folder).startsWith(`${resolve(repo)}/`)).toBe(false);

      await copy.letGo();
      expect(existsSync(copy.folder)).toBe(false);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  }, 30_000);

  it('hands back what it changed, not what it says it changed', async () => {
    const repo = await freshRepo();
    try {
      const copy = await makeBuilderCopy(repo, 'call-2');
      if (copy === null) throw new Error('no copy');

      await writeFile(join(copy.folder, 'a.txt'), 'a two\n');
      await writeFile(join(copy.folder, 'new.txt'), 'brand new\n');
      const said = await copy.changeMade();

      expect(said).toContain('a.txt');
      expect(said).toContain('a two');
      // The project itself is untouched while the copy is alive.
      expect(await readFile(join(repo, 'a.txt'), 'utf8')).toBe('a one\n');

      await copy.letGo();
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  }, 30_000);

  it('says plainly when a builder changed nothing', async () => {
    const repo = await freshRepo();
    try {
      const copy = await makeBuilderCopy(repo, 'call-3');
      if (copy === null) throw new Error('no copy');
      expect(await copy.changeMade()).toBe('It changed no files.');
      await copy.letGo();
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  }, 30_000);

  it('two builders never share a folder, and two projects never do either', () => {
    expect(builderFolder('/work/site', 'call-1')).not.toBe(builderFolder('/work/site', 'call-2'));
    // Same folder name, different places. Sharing one copy between them would
    // be one project's work appearing in another's.
    expect(builderFolder('/work/site', 'call-1')).not.toBe(builderFolder('/elsewhere/site', 'call-1'));
  });

  it('cannot be talked into a folder somewhere else by its name', () => {
    for (const id of ['../../etc', '../..', '/absolute', 'a/b/c']) {
      const folder = builderFolder('/work/site', id);
      expect(folder).not.toContain('..');
      expect(folder.startsWith(tmpdir())).toBe(true);
    }
  });

  /* Not beside the project either: that leaves our scaffolding in whatever
     folder somebody keeps their own work in. */
  it('is nowhere near the folder somebody is looking at', () => {
    const folder = builderFolder('/work/site', 'call-1');
    expect(folder.startsWith('/work/')).toBe(false);
    expect(folder).toContain('graphe-builders');
  });

  it('refuses rather than falling back to the real project', async () => {
    const notRepo = await mkdtemp(join(tmpdir(), 'graphe-plain-'));
    try {
      // A folder git cannot make a copy of. Nothing is returned, and the caller
      // turns that into "nothing was changed" rather than working in place.
      const copy = await makeBuilderCopy(join(notRepo, 'nowhere'), 'call-4');
      expect(copy).toBeNull();
    } finally {
      await rm(notRepo, { recursive: true, force: true });
    }
  }, 30_000);
});

/* ========================================================================== */
/* B-03 the boundary, from inside the copy                                     */
/* ========================================================================== */

describe('B-03 what a builder can and cannot reach', () => {
  const copy = { projectRoot: '/work/.graphe-builders/site-call-1' };
  const kind = (name: string, input: Record<string, unknown>): string =>
    evaluate({ id: 'c', name, input }, copy).kind;

  it('may write inside its own copy', () => {
    expect(kind('write', { path: `${copy.projectRoot}/src/a.ts`, content: 'x' })).toBe('allow');
    expect(kind('edit', { path: `${copy.projectRoot}/src/a.ts`, old: 'a', new: 'b' })).toBe('allow');
    expect(changesAnything({ id: 'c', name: 'write', input: { path: `${copy.projectRoot}/a.ts` } }, copy)).toBe(true);
  });

  /* The whole safety story in one test: the folder it was given is the world. */
  it('cannot reach the project it was copied from', () => {
    expect(kind('write', { path: '/work/site/src/a.ts', content: 'x' })).toBe('deny');
    expect(kind('edit', { path: '/work/site/package.json', old: 'a', new: 'b' })).toBe('deny');
    expect(kind('write', { path: `${copy.projectRoot}/../../site/a.ts`, content: 'x' })).toBe('deny');
  });

  it('still cannot do the destructive things, copy or no copy', () => {
    expect(kind('bash', { command: 'rm -rf src' })).toBe('deny');
    expect(kind('write', { path: '/etc/hosts', content: 'x' })).toBe('deny');
    expect(kind('read', { path: `${String(process.env.HOME ?? '/root')}/.ssh/id_rsa` })).toBe('deny');
  });
});

/* ========================================================================== */
/* B-04 the rule itself                                                        */
/* ========================================================================== */

describe('B-04 what a helper is allowed to run', () => {
  const reader = roleSpec('researcher');
  const builder = roleSpec('builder');
  const allow = { kind: 'allow' } as const;
  const deny = { kind: 'deny', reason: 'That is outside your project.' } as const;
  const asks = { kind: 'confirm' } as const;
  const risky = { kind: 'snapshot-first' } as const;

  it('lets a reader read, and refuses it anything that changes', () => {
    expect(mayRun(reader, { name: 'read' }, allow, false)).toBeUndefined();
    expect(mayRun(reader, { name: 'read' }, allow, true)?.reason).toBe(HELPER_DECLINED.reading);
    // A question answered yes on its behalf is free while nothing can change.
    expect(mayRun(reader, { name: 'websearch' }, asks, false)).toBeUndefined();
  });

  it('lets a builder change things, and only what the rules allow outright', () => {
    expect(mayRun(builder, { name: 'write' }, allow, true)).toBeUndefined();
    expect(mayRun(builder, { name: 'bash' }, allow, true)).toBeUndefined();
    // Nobody to ask, and yes is no longer free — so it is no.
    expect(mayRun(builder, { name: 'bash' }, asks, true)?.reason).toBe(HELPER_DECLINED.building);
    expect(mayRun(builder, { name: 'bash' }, risky, true)?.reason).toBe(HELPER_DECLINED.building);
  });

  it('keeps a denial a denial for everybody, and says why', () => {
    for (const spec of [reader, builder]) {
      expect(mayRun(spec, { name: 'read' }, deny, false)?.reason).toBe('That is outside your project.');
    }
  });

  it('refuses a tool the role does not hold, whatever the Guard thought of it', () => {
    expect(mayRun(reader, { name: 'write' }, allow, true)?.reason).toBe(HELPER_DECLINED.reading);
    expect(mayRun(builder, { name: 'websearch' }, allow, false)?.reason).toBe(HELPER_DECLINED.building);
    expect(mayRun(builder, { name: 'WRITE' }, allow, true)).toBeUndefined();
  });

  /* A copy made this way shares refs, the object store and the stash with the
     project it came from, and a git subcommand names no path — so the rules
     that keep a builder inside its folder cannot see it. `git stash pop` in the
     copy takes the person's own stashed work out of their real project. */
  it('never lets a builder run git, whatever the Guard made of the command', () => {
    for (const command of [
      'git stash pop',
      'git switch -c mine',
      'git commit -am done',
      'npm test && git stash',
      'echo hi; git push',
      '(git init)',
    ]) {
      const blocked = mayRun(builder, { name: 'bash', input: { command } }, allow, true);
      expect(blocked?.reason, command).toBe(HELPER_DECLINED.noGit);
    }
  });

  it('leaves ordinary commands alone, including ones that merely say the word', () => {
    for (const command of ['npm test', 'node build.mjs', 'echo digital', 'ls .github']) {
      expect(mayRun(builder, { name: 'bash', input: { command } }, allow, true), command).toBeUndefined();
    }
  });

  /* Role names come off model output, and a lookup with a fallback finds these
     on the prototype instead of falling back. */
  it('is the plain helper for a role that is really a property of every object', () => {
    for (const role of ['toString', 'constructor', 'hasOwnProperty', '__proto__']) {
      const spec = roleSpec(role as never);
      expect(spec.name, role).toBe('helper');
      expect(spec.mayChange, role).toBe(false);
      expect(Array.isArray(spec.tools), role).toBe(true);
    }
  });

  it('never tells a builder it cannot change anything, because it can', () => {
    expect(HELPER_DECLINED.building).not.toMatch(/cannot .*change anything/i);
    expect(HELPER_DECLINED.reading).toMatch(/change anything/i);
  });
});
