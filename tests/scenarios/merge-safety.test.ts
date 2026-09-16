/** T14, T15: bringing a conversation's work into the project.
 *
 * The two ways this goes wrong are both about what is already in the project:
 * somebody's unsaved work, and a file both sides changed. Phase 10.2 asks for
 * the refusal to be safe and for the awkward kinds of change — bytes, a rename,
 * a deletion, a mode, a symlink — to arrive whole.
 *
 * Real repositories and real checkouts; the merge is git's, run the way the app
 * runs it.
 */

import { existsSync, lstatSync, readlinkSync } from 'node:fs';
import { chmod, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

/* Real repositories and real git, several per test. Under a loaded machine a
   ten second ceiling is the machine talking rather than the code. */
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

import { createWorktree, landWorktree, worktreeWords, type RunGit } from '../../src/history/worktree';
import { gitIn, gitRepo, type Built, type GitRepo } from '../helpers/fixtures';

const made: Built[] = [];

afterEach(async () => {
  for (const one of made.splice(0)) await one.dispose();
});

function runner(): RunGit {
  return async (args, options) => {
    const one = await gitIn(options.cwd, ...args);
    return { code: one.code, out: one.out };
  };
}

/** A clean project with one checkout of it, which is where a merge starts. */
async function isolated(): Promise<{ repo: GitRepo; folder: string; branch: string }> {
  const repo = await gitRepo({ dirty: false });
  made.push(repo);
  const checkout = await createWorktree(runner(), repo.root, 'chat', null);
  if (!checkout.ok || checkout.value === null) throw new Error('the fixture could not isolate');
  return { repo, folder: checkout.value.folder, branch: checkout.value.branch };
}

/** The conversation's own saves: a commit on its branch, which is what a merge
 *  brings in. Work sitting uncommitted in a checkout is not on any branch, so
 *  there would be nothing for the merge to carry. */
async function saved(folder: string, message = 'the conversation’s own saves'): Promise<void> {
  const added = await gitIn(folder, 'add', '-A');
  if (added.code !== 0) throw new Error(`git add failed in the checkout: ${added.err}`);
  const committed = await gitIn(folder, 'commit', '-qm', message);
  if (committed.code !== 0) throw new Error(`git commit failed in the checkout: ${committed.err}`);
}

/** Everything a failed merge could have moved in the project. */
async function whenItWentWrong(repo: GitRepo): Promise<Record<string, string>> {
  return {
    head: (await repo.git('rev-parse', 'HEAD')).out.trim(),
    status: (await repo.status()).trim(),
    staged: (await repo.git('diff', '--cached')).out,
    working: (await repo.git('diff')).out,
    committed: (await repo.git('show', 'HEAD:notes.md')).out,
  };
}

/* -------------------------------------------------------------------------- */

describe('T14: a merge asked for while the project has work in it', () => {
  it('is refused, and everything on both sides is left where it was', async () => {
    const { repo, folder } = await isolated();
    await writeFile(join(folder, 'from-the-chat.ts'), 'export const arrived = true;\n');
    await saved(folder);

    // The person's own work in the project: one edit staged, one not, and a file
    // git has never seen.
    await writeFile(join(repo.root, repo.paths.committed), 'my own notes, half written\n');
    await repo.git('add', repo.paths.committed);
    await writeFile(join(repo.root, repo.paths.untracked), 'export const mine = true;\n');
    const before = await whenItWentWrong(repo);

    const landed = await landWorktree(runner(), repo.root, folder, { how: 'squash' });
    expect(landed.ok).toBe(false);
    expect(landed.ok === false && landed.because).toBe(worktreeWords.dirty);

    expect(await whenItWentWrong(repo)).toEqual(before);
    // The conversation keeps its work and its checkout: a refusal is not a
    // decision to throw either away.
    expect(existsSync(join(folder, 'from-the-chat.ts'))).toBe(true);
    expect((await gitIn(repo.root, 'rev-parse', '--verify', 'graphe/chat')).code).toBe(0);
  });

  it('is refused when the only change is staged, which a merge would squash', async () => {
    const { repo, folder } = await isolated();
    await writeFile(join(folder, 'from-the-chat.ts'), 'export const arrived = true;\n');
    await saved(folder);
    const note = join(repo.root, repo.paths.committed);
    await writeFile(note, 'staged and not committed\n');
    await repo.git('add', repo.paths.committed);
    const stagedBefore = (await repo.git('diff', '--cached', '--', repo.paths.committed)).out;

    const landed = await landWorktree(runner(), repo.root, folder, { how: 'squash' });
    expect(landed.ok).toBe(false);
    expect(await readFile(note, 'utf8')).toBe('staged and not committed\n');
    expect((await repo.git('diff', '--cached', '--', repo.paths.committed)).out).toBe(stagedBefore);
    expect((await repo.git('rev-parse', 'HEAD')).out.trim()).toBe(repo.head);
  });
});

/* -------------------------------------------------------------------------- */

describe('T15: the awkward kinds of change, brought in', () => {
  it('carries bytes, a rename, a deletion, a mode and a symlink across whole', async () => {
    const { repo, folder } = await isolated();
    const at = (path: string): string => join(folder, path);

    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x11, 0x22, 0x33, 0x00, 0xff]);
    await writeFile(at(repo.paths.binary), bytes);
    await rename(at(repo.paths.committed), at('readme.md'));
    await rm(at(repo.paths.script));
    await rm(at(repo.paths.link));
    await symlink('readme.md', at(repo.paths.link));
    await writeFile(at('scripts/extra.sh'), '#!/bin/sh\necho extra\n');
    await chmod(at('scripts/extra.sh'), 0o755);
    await saved(folder);

    const landed = await landWorktree(runner(), repo.root, folder, { how: 'squash' });
    expect(landed.ok).toBe(true);

    const inProject = (path: string): string => join(repo.root, path);
    // Bytes, exactly.
    expect(await readFile(inProject(repo.paths.binary))).toEqual(bytes);
    // The rename arrived as a rename rather than as a deletion and an addition.
    expect(existsSync(inProject(repo.paths.committed))).toBe(false);
    expect(await readFile(inProject('readme.md'), 'utf8')).toBe('The fixture note.\n');
    expect((await repo.git('log', '-1', '--name-status', '--format=')).out).toContain('R100');
    // The deletion arrived.
    expect(existsSync(inProject(repo.paths.script))).toBe(false);
    // The symlink is still a symlink, pointing where the conversation left it.
    expect(lstatSync(inProject(repo.paths.link)).isSymbolicLink()).toBe(true);
    expect(readlinkSync(inProject(repo.paths.link))).toBe('readme.md');
    // And the new file kept its execute bit.
    expect((await repo.git('ls-files', '-s', 'scripts/extra.sh')).out).toContain('100755');
    // Nothing half-done is left on either side.
    expect((await repo.status()).trim()).toBe('');
    expect(existsSync(folder)).toBe(false);
  });

  it('stops at a real clash, and leaves the project as it found it', async () => {
    const { repo, folder } = await isolated();
    // Both sides changed the same line of the same file, which is the one case
    // git cannot decide.
    await writeFile(join(folder, repo.paths.committed), 'what the conversation decided\n');
    await saved(folder);
    const projectNote = join(repo.root, repo.paths.committed);
    await writeFile(projectNote, 'what I decided here\n');
    await repo.git('add', repo.paths.committed);
    await repo.git('-c', 'user.email=me@example.com', '-c', 'user.name=me', 'commit', '-qm', 'mine');
    const before = await whenItWentWrong(repo);

    const landed = await landWorktree(runner(), repo.root, folder, { how: 'squash' });
    expect(landed.ok).toBe(false);
    expect(landed.ok === false && landed.because).toBe(worktreeWords.clashed);

    // No conflict markers anywhere, nothing stages the half-merge, and the
    // conversation's own decision is still in its checkout for somebody to look
    // at rather than gone.
    expect(await whenItWentWrong(repo)).toEqual(before);
    expect(await readFile(projectNote, 'utf8')).toBe('what I decided here\n');
    // The only untracked thing is the folder the checkouts live in, which was
    // there before the merge was asked for.
    expect((await repo.git('status', '--porcelain', '-uno')).out.trim()).toBe('');
    expect(await readFile(join(folder, repo.paths.committed), 'utf8')).toBe('what the conversation decided\n');
  });
});
