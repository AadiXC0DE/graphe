/** Bringing a conversation's work into the folder somebody has open.
 *
 * This is the one moment the app writes into the project folder without being
 * asked twice, so each file arrives whole or not at all: the bytes land beside
 * the file and are moved into place, which is why the file the person's editor
 * had open is a different file afterwards rather than the same one rewritten
 * under it.
 *
 * Real git, real folders.
 */

import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

import {
  beforeBringingWorkIn,
  bringBack,
  createWorktree,
  type RunGit,
} from '../src/history/worktree';

const spawn = promisify(execFile);

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
  const root = await mkdtemp(path.join(tmpdir(), 'graphe-apply-'));
  await raw(root, 'init', '-b', 'main');
  await raw(root, 'config', 'user.email', 'test@graphe.local');
  await raw(root, 'config', 'user.name', 'Test');
  await raw(root, 'config', 'commit.gpgsign', 'false');
  await writeFile(path.join(root, 'hero.css'), '.hero { padding: 16px; }\n');
  await raw(root, 'add', '.');
  await raw(root, 'commit', '-m', 'first');
  return root;
}

/** Every scratch file the atomic write leaves behind, anywhere in the project. */
function writingLeftInside(root: string): string[] {
  const found: string[] = [];
  const walk = (at: string): void => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      if (entry.name === '.git') continue;
      const here = path.join(at, entry.name);
      if (entry.isDirectory()) walk(here);
      else if (entry.name.endsWith('.writing')) found.push(here);
    }
  };
  walk(root);
  return found;
}

describe('a file arrives whole or not at all', () => {
  it('replaces the file rather than rewriting the one on disk', async () => {
    const repo = await freshRepo();
    try {
      const made = await createWorktree(git(), repo, 'review', null);
      expect(made.ok).toBe(true);
      if (!made.ok || made.value === null) return;

      await writeFile(path.join(made.value.folder, 'hero.css'), '.hero { padding: 32px; }\n');
      const was = await stat(path.join(repo, 'hero.css'));

      const carried = await bringBack(git(), repo, made.value.folder);
      expect(carried.ok).toBe(true);
      if (!carried.ok) return;

      const now = await stat(path.join(repo, 'hero.css'));
      // A different file in the same place: the bytes were written beside it and
      // moved in, so nothing ever read half of them.
      expect(now.ino).not.toBe(was.ino);
      expect(await readFile(path.join(repo, 'hero.css'), 'utf8')).toBe(
        '.hero { padding: 32px; }\n',
      );
      expect(writingLeftInside(repo)).toEqual([]);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it('says which files it carried, in the order a person would list them', async () => {
    const repo = await freshRepo();
    try {
      const made = await createWorktree(git(), repo, 'review', null);
      if (!made.ok || made.value === null) return;
      const { folder } = made.value;

      await writeFile(path.join(folder, 'hero.css'), '.hero { padding: 32px; }\n');
      await mkdir(path.join(folder, 'parts'), { recursive: true });
      await writeFile(path.join(folder, 'parts', 'nav.css'), '.nav { display: flex; }\n');

      const carried = await bringBack(git(), repo, folder);
      expect(carried.ok).toBe(true);
      if (!carried.ok) return;

      expect([...carried.value.applied].sort()).toEqual(['hero.css', 'parts/nav.css']);
      expect(carried.value.conflicted).toEqual([]);
      expect(await readFile(path.join(repo, 'parts', 'nav.css'), 'utf8')).toBe(
        '.nav { display: flex; }\n',
      );
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it('keeps a script runnable on the way home', async () => {
    const repo = await freshRepo();
    try {
      const made = await createWorktree(git(), repo, 'review', null);
      if (!made.ok || made.value === null) return;
      const { folder } = made.value;

      const script = path.join(folder, 'deploy.sh');
      await writeFile(script, '#!/bin/sh\necho up\n');
      await chmod(script, 0o755);

      const carried = await bringBack(git(), repo, folder);
      expect(carried.ok).toBe(true);
      const landed = await stat(path.join(repo, 'deploy.sh'));
      expect(landed.mode & 0o111).not.toBe(0);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it('carries bytes that are not text without touching them', async () => {
    const repo = await freshRepo();
    try {
      const made = await createWorktree(git(), repo, 'review', null);
      if (!made.ok || made.value === null) return;
      const { folder } = made.value;

      const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x1a, 0x0a, 0xff, 0xfe, 0x00]);
      await writeFile(path.join(folder, 'logo.png'), bytes);

      expect((await bringBack(git(), repo, folder)).ok).toBe(true);
      expect(await readFile(path.join(repo, 'logo.png'))).toEqual(bytes);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it('removes a file the conversation deleted, and leaves no scratch behind', async () => {
    const repo = await freshRepo();
    try {
      const made = await createWorktree(git(), repo, 'review', null);
      if (!made.ok || made.value === null) return;
      const { folder } = made.value;

      await rm(path.join(folder, 'hero.css'));
      const carried = await bringBack(git(), repo, folder);
      expect(carried.ok).toBe(true);
      if (!carried.ok) return;
      expect(carried.value.applied).toContain('hero.css');
      await expect(stat(path.join(repo, 'hero.css'))).rejects.toThrow();
      expect(writingLeftInside(repo)).toEqual([]);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it('names the version to take before any of this happens', () => {
    expect(beforeBringingWorkIn).toBe('Before bringing work in');
  });
});
