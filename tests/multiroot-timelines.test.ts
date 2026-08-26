/** A timeline each, for a folder that holds several projects.
 *
 *  Phase 0 stopped the parent from becoming a repository. What that left was a
 *  folder where nothing could be saved or gone back to at all. These are the
 *  real thing rather than a reading of the source: two projects beside each
 *  other, each saved and restored on its own, and a parent that still has no
 *  `.git` when it is over.
 */

import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { childRepos, SEVERAL_CHILDREN } from '../electron/childRepos';
import { Timeline } from '../src/history/timeline';

const run = promisify(execFile);

let parent: string;

/** One child project, already a repository with something in it. */
async function project(name: string): Promise<string> {
  const at = join(parent, name);
  await mkdir(at, { recursive: true });
  await writeFile(join(at, 'README.md'), `# ${name}\n`, 'utf8');
  await run('git', ['init', '--quiet', '-b', 'main'], { cwd: at });
  await run('git', ['add', '-A'], { cwd: at });
  await run(
    'git',
    ['-c', 'user.name=Someone', '-c', 'user.email=someone@example.com', 'commit', '-qm', 'first'],
    { cwd: at },
  );
  return at;
}

beforeAll(async () => {
  parent = await mkdtemp(join(tmpdir(), 'graphe-several-'));
  await project('backend');
  await project('frontend');
  await mkdir(join(parent, 'notes'), { recursive: true });
}, 60_000);

afterAll(async () => {
  await rm(parent, { recursive: true, force: true }).catch(() => undefined);
});

async function isRepo(folder: string): Promise<boolean> {
  return access(join(folder, '.git')).then(
    () => true,
    () => false,
  );
}

describe('a folder that holds several projects', () => {
  it('is several, and the parent is none of them', async () => {
    const found = await childRepos(parent);
    expect(found.map((one) => one.rel)).toEqual(['backend', 'frontend']);
    expect(found.length).toBeGreaterThanOrEqual(SEVERAL_CHILDREN);
    expect(await isRepo(parent)).toBe(false);
  });

  it('saves and goes back inside one project without touching the other', async () => {
    const backend = await Timeline.open(join(parent, 'backend'));
    const frontend = await Timeline.open(join(parent, 'frontend'));

    await writeFile(join(parent, 'backend', 'README.md'), '# backend, changed\n', 'utf8');
    const saved = await backend.snapshot({ boundary: 'user-asked', by: 'you', name: 'Changed it' });
    expect(saved?.title).toBe('Changed it');

    // The other project has heard nothing about any of it.
    expect((await frontend.versions()).map((one) => one.title)).toEqual(['first']);
    expect((await backend.versions()).map((one) => one.title)).toEqual(['Changed it', 'first']);

    const first = (await backend.versions()).at(-1);
    expect(first).toBeDefined();
    const restored = await backend.restoreTo(first?.id ?? '');
    expect(restored.wentBackTo.title).toBe('first');
    expect((await frontend.versions()).map((one) => one.title)).toEqual(['first']);
  }, 60_000);

  it('still leaves the folder itself a plain folder afterwards', async () => {
    expect(await isRepo(parent)).toBe(false);
    // And keeping a timeline per project is what makes that possible: opening
    // one is opening the child, never the folder above it.
    expect((await Timeline.open(join(parent, 'backend'))).projectFolder).toBe(
      join(parent, 'backend'),
    );
  }, 60_000);
});
