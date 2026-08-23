/** One conversation, its own checkout — the git worktree behind parallel tabs.
 *
 * Real git throughout, so what is claimed here is what actually happens on a
 * repository: a conversation's work lives in its own folder and branch, its
 * branch lands in the main checkout, and a main checkout with unsaved changes
 * is the one thing never flattened.
 */

import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

import {
  branchFor,
  bringBack,
  checkoutFolder,
  createWorktree,
  dropWorktree,
  holdsWork,
  landWorktree,
  putAwayWorktree,
  reopenWorktree,
  sweepCheckouts,
  worktreeWords,
  writingLeftBehind,
  type RunGit,
} from '../src/history/worktree';
import { existsSync, readFileSync } from 'node:fs';

const spawn = promisify(execFile);

/** A real git runner. The working directory comes with each call. */
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

/** A fresh little repository, set up with direct git so the harness is trusted. */
async function freshRepo(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'graphe-worktree-'));
  await raw(root, 'init', '-b', 'main');
  await raw(root, 'config', 'user.email', 'test@graphe.local');
  await raw(root, 'config', 'user.name', 'Test');
  await raw(root, 'config', 'commit.gpgsign', 'false');
  await writeFile(path.join(root, 'a.txt'), 'a one\n');
  await raw(root, 'add', '.');
  await raw(root, 'commit', '-m', 'first');
  return root;
}

describe('branchFor — a branch that reads as ours', () => {
  it('keeps a clean id under our own prefix', () => {
    expect(branchFor('review')).toBe('graphe/review');
  });

  it('sheds anything that could read as a path outside the prefix', () => {
    expect(branchFor('../escape')).toBe('graphe/escape');
    expect(branchFor('no spaces')).toBe('graphe/no-spaces');
  });
});

describe('checkoutFolder', () => {
  it('lives under the repository, never inside its tracked tree', () => {
    expect(checkoutFolder('/one/two')).toBe('/one/two/.graphe/worktrees');
  });
});

describe('createWorktree', () => {
  it('makes a separate checkout on its own branch, starting at HEAD', async () => {
    const repo = await freshRepo();
    try {
      const made = await createWorktree(git(), repo, 'review', null);
      expect(made.ok).toBe(true);
      if (!made.ok || made.value === null) return;

      expect(made.value.branch).toBe('graphe/review');
      expect(made.value.folder).toContain('.graphe/worktrees/review');
      expect((await raw(made.value.folder, 'rev-parse', '--abbrev-ref', 'HEAD')).trim()).toBe(
        'graphe/review',
      );
      // Started where the work would have — on the current commit.
      expect((await raw(made.value.folder, 'show', 'HEAD:a.txt')).trim()).toBe('a one');
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it('branches from a named base when asked for a fresh start', async () => {
    const repo = await freshRepo();
    try {
      // A second commit on main, so the worktree rooted elsewhere differs.
      await writeFile(path.join(repo, 'a.txt'), 'a two\n');
      await raw(repo, 'commit', '-am', 'second');
      const made = await createWorktree(git(), repo, 'fresh', { ref: 'main~1' });
      expect(made.ok).toBe(true);
      if (!made.ok || made.value === null) return;
      expect((await raw(made.value.folder, 'show', 'HEAD:a.txt')).trim()).toBe('a one');
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it('refuses when the folder is not a repository', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'graphe-notrepo-'));
    try {
      const made = await createWorktree(git(), root, 'review', null);
      expect(made.ok).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('landWorktree — a conversation returns its work home', () => {
  it('merges a change made in the checkout into the main one', async () => {
    const repo = await freshRepo();
    try {
      const made = await createWorktree(git(), repo, 'review', null);
      expect(made.ok).toBe(true);
      if (!made.ok || made.value === null) return;

      // Work happens in the checkout, and the main checkout stays untouched.
      await writeFile(path.join(made.value.folder, 'a.txt'), 'a changed in the conversation\n');
      await raw(made.value.folder, 'commit', '-am', 'changed in a tab');

      const landed = await landWorktree(git(), repo, made.value.folder);
      expect(landed.ok).toBe(true);

      // The main checkout now has the conversation's change, and the checkout
      // is taken away.
      expect((await raw(repo, 'show', 'HEAD:a.txt')).trim()).toBe('a changed in the conversation');
      const list = await raw(repo, 'worktree', 'list');
      expect(list).not.toContain('.graphe/worktrees');
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it('refuses while the main checkout has unsaved tracked changes', async () => {
    const repo = await freshRepo();
    try {
      const made = await createWorktree(git(), repo, 'other', null);
      expect(made.ok).toBe(true);
      if (!made.ok || made.value === null) return;

      await writeFile(path.join(made.value.folder, 'a.txt'), 'done in the tab\n');
      await raw(made.value.folder, 'commit', '-am', 'tab work');

      await writeFile(path.join(repo, 'a.txt'), 'mine, not saved\n');
      const landed = await landWorktree(git(), repo, made.value.folder);
      expect(landed.ok).toBe(false);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });
});

describe('dropWorktree', () => {
  it('throws the checkout and its branch away', async () => {
    const repo = await freshRepo();
    try {
      const made = await createWorktree(git(), repo, 'review', null);
      expect(made.ok).toBe(true);
      if (!made.ok || made.value === null) return;

      const dropped = await dropWorktree(git(), repo, made.value.folder);
      expect(dropped.ok).toBe(true);
      const list = await raw(repo, 'worktree', 'list');
      expect(list).not.toContain('.graphe/worktrees');
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });
});

describe('bringBack — Cursor-style Apply, files come home uncommitted', () => {
  it('carries an edited file into the main checkout', async () => {
    const repo = await freshRepo();
    try {
      const made = await createWorktree(git(), repo, 'review', null);
      expect(made.ok).toBe(true);
      if (!made.ok || made.value === null) return;

      await writeFile(path.join(made.value.folder, 'a.txt'), 'changed in the tab\n');
      // The main checkout is untouched.
      const applied = await bringBack(git(), repo, made.value.folder);
      expect(applied.ok).toBe(true);
      if (applied.ok) expect(applied.value.applied).toContain('a.txt');
      // The change is on disk in main, uncommitted.
      expect((await raw(repo, 'show', 'HEAD:a.txt')).trim()).toBe('a one');
      expect(readFileContent(repo, 'a.txt')).toBe('changed in the tab\n');
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  /* The names git quotes. Read the ordinary way, `café.css` comes back as
     `"caf\303\251.css"` — quotes and all — and points at no file on disk, so
     the work was silently left behind while the person was told it came over. */
  it('carries files whose names git would quote', async () => {
    const repo = await freshRepo();
    try {
      const made = await createWorktree(git(), repo, 'accents', null);
      expect(made.ok).toBe(true);
      if (!made.ok || made.value === null) return;

      const tricky = ['café.css', 'a file with spaces.txt', 'naïve—dash.md'];
      for (const name of tricky) await writeFile(path.join(made.value.folder, name), `${name} body\n`);
      // One of them tracked as well, so both the diff and the untracked list
      // are exercised.
      await raw(made.value.folder, 'add', 'café.css');
      await raw(made.value.folder, 'commit', '-m', 'accented');

      const applied = await bringBack(git(), repo, made.value.folder);
      expect(applied.ok).toBe(true);
      if (!applied.ok) return;
      for (const name of tricky) {
        expect(applied.value.applied).toContain(name);
        expect(readFileContent(repo, name)).toBe(`${name} body\n`);
      }
      // Nothing arrived under a name with quotes or escapes still in it.
      for (const name of applied.value.applied) expect(name).not.toContain('"');
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it('treats a change already applied to main as safely landed, not conflicted', async () => {
    const repo = await freshRepo();
    try {
      const made = await createWorktree(git(), repo, 'already-applied', null);
      expect(made.ok).toBe(true);
      if (!made.ok || made.value === null) return;

      await writeFile(path.join(made.value.folder, 'a.txt'), 'same final work\n');
      await writeFile(path.join(repo, 'a.txt'), 'same final work\n');

      const applied = await bringBack(git(), repo, made.value.folder);
      expect(applied.ok).toBe(true);
      if (!applied.ok) return;
      expect(applied.value.applied).toContain('a.txt');
      expect(applied.value.conflicted).not.toContain('a.txt');
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it('leaves a file alone when the main checkout changed it too', async () => {
    const repo = await freshRepo();
    try {
      const made = await createWorktree(git(), repo, 'other', null);
      expect(made.ok).toBe(true);
      if (!made.ok || made.value === null) return;

      await writeFile(path.join(made.value.folder, 'a.txt'), 'from the tab\n');
      await writeFile(path.join(repo, 'a.txt'), 'mine on main\n');

      const applied = await bringBack(git(), repo, made.value.folder);
      expect(applied.ok).toBe(true);
      if (!applied.ok) return;
      expect(applied.value.applied).not.toContain('a.txt');
      expect(applied.value.conflicted).toContain('a.txt');
      // The main checkout keeps its own version rather than being overwritten.
      expect(readFileContent(repo, 'a.txt')).toBe('mine on main\n');
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it('does not overwrite an unrelated untracked file with the same name on main', async () => {
    const repo = await freshRepo();
    try {
      const made = await createWorktree(git(), repo, 'untracked-both-sides', null);
      expect(made.ok).toBe(true);
      if (!made.ok || made.value === null) return;

      await writeFile(path.join(made.value.folder, 'new.txt'), 'from the tab\n');
      await writeFile(path.join(repo, 'new.txt'), 'mine on main\n');
      const applied = await bringBack(git(), repo, made.value.folder);
      expect(applied.ok).toBe(true);
      if (!applied.ok) return;
      expect(applied.value.conflicted).toContain('new.txt');
      expect(readFileContent(repo, 'new.txt')).toBe('mine on main\n');
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it('carries a new file across', async () => {
    const repo = await freshRepo();
    try {
      const made = await createWorktree(git(), repo, 'new', null);
      expect(made.ok).toBe(true);
      if (!made.ok || made.value === null) return;

      await writeFile(path.join(made.value.folder, 'brand-new.ts'), 'export const x = 1;\n');
      const applied = await bringBack(git(), repo, made.value.folder);
      expect(applied.ok).toBe(true);
      if (applied.ok) expect(applied.value.applied).toContain('brand-new.ts');
      expect(readFileContent(repo, 'brand-new.ts')).toBe('export const x = 1;\n');
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });
});

function readFileContent(folder: string, name: string): string {
  return readFileSync(path.join(folder, name), 'utf8');
}

describe('parallel isolation — the reference behaviour in miniature', () => {
  it('two conversations on different files both land, neither is lost', async () => {
    const repo = await freshRepo();
    await writeFile(path.join(repo, 'b.txt'), 'b one\n');
    await raw(repo, 'add', '.');
    await raw(repo, 'commit', '-m', 'add b');
    try {
      // Primary conversation works on the main folder: edits a.txt.
      await writeFile(path.join(repo, 'a.txt'), 'a from primary\n');
      // A parallel tab in its own checkout edits b.txt.
      const made = await createWorktree(git(), repo, 'tab2', null);
      expect(made.ok).toBe(true);
      if (!made.ok || made.value === null) return;
      await writeFile(path.join(made.value.folder, 'b.txt'), 'b from tab two\n');

      // Bring the tab's work home: b lands, a stays the primary's version.
      const applied = await bringBack(git(), repo, made.value.folder);
      expect(applied.ok).toBe(true);
      if (!applied.ok) return;
      expect(applied.value.applied).toContain('b.txt');
      expect(applied.value.conflicted).not.toContain('a.txt');
      expect(readFileContent(repo, 'a.txt')).toBe('a from primary\n');
      expect((await raw(repo, 'status', '--porcelain')).includes('b.txt')).toBe(true);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it('one conversation never silently overwrites another on the same file', async () => {
    const repo = await freshRepo();
    try {
      // Primary changes a.txt in the main folder.
      await writeFile(path.join(repo, 'a.txt'), 'primary version\n');
      // Parallel tab also changes a.txt, in its checkout.
      const made = await createWorktree(git(), repo, 'tab2', null);
      expect(made.ok).toBe(true);
      if (!made.ok || made.value === null) return;
      await writeFile(path.join(made.value.folder, 'a.txt'), 'tab two version\n');

      const applied = await bringBack(git(), repo, made.value.folder);
      expect(applied.ok).toBe(true);
      if (!applied.ok) return;
      // The tab's file is NOT applied over the primary's — it's reported and
      // the primary keeps its own version.
      expect(applied.value.applied).not.toContain('a.txt');
      expect(applied.value.conflicted).toContain('a.txt');
      expect(readFileContent(repo, 'a.txt')).toBe('primary version\n');
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });
});

describe('shared base — a folder that commits ahead is still protected', () => {
  it('does not overwrite a file the folder committed after the tab branched', async () => {
    const repo = await freshRepo();
    try {
      const made = await createWorktree(git(), repo, 'tab', null);
      expect(made.ok).toBe(true);
      if (!made.ok || made.value === null) return;

      // The primary commits a change to a.txt after the tab branched off it.
      await writeFile(path.join(repo, 'a.txt'), 'primary committed this\n');
      await raw(repo, 'commit', '-am', 'primary advances');

      // The tab edits the same file in its own checkout.
      await writeFile(path.join(made.value.folder, 'a.txt'), 'tab edited this\n');

      const applied = await bringBack(git(), repo, made.value.folder);
      expect(applied.ok).toBe(true);
      if (!applied.ok) return;
      // Not silently overwritten: the tab's version waits, the folder keeps its
      // committed one, and the conflict is reported.
      expect(applied.value.applied).not.toContain('a.txt');
      expect(applied.value.conflicted).toContain('a.txt');
      expect(readFileContent(repo, 'a.txt')).toBe('primary committed this\n');
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });
});

describe('writing nothing else would keep — the report a restart deleted', () => {
  /** A project that ignores a notes folder, and a conversation that wrote in it. */
  async function repoWithNotes(): Promise<{ repo: string; folder: string }> {
    const repo = await freshRepo();
    await writeFile(path.join(repo, '.gitignore'), 'node_modules/\nnotes/\n');
    await raw(repo, 'add', '.');
    await raw(repo, 'commit', '-m', 'ignore the notes');
    const made = await createWorktree(git(), repo, 'wrote-a-report', null);
    if (!made.ok || made.value === null) throw new Error('no checkout');
    return { repo, folder: made.value.folder };
  }

  it('finds a page somebody wrote that no save would ever pick up', async () => {
    const { repo, folder } = await repoWithNotes();
    try {
      await mkdir(path.join(folder, 'notes'), { recursive: true });
      await writeFile(path.join(folder, 'notes', 'audit.md'), '# fifty kilobytes of research\n');
      // The sweep still sees nothing, which is exactly how it was lost.
      expect(await holdsWork(git(), folder)).toBe(false);
      expect(await writingLeftBehind(git(), folder)).toEqual({ files: ['notes/audit.md'], tooBig: false });
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it('leaves the install behind — that is still the disk worth reclaiming', { timeout: 30_000 }, async () => {
    const { repo, folder } = await repoWithNotes();
    try {
      const heavy = path.join(folder, 'node_modules', 'thing');
      await mkdir(heavy, { recursive: true });
      for (let at = 0; at < 401; at += 1) {
        await writeFile(path.join(heavy, `part-${String(at)}.js`), 'made again\n');
      }
      expect(await writingLeftBehind(git(), folder)).toEqual({ files: [], tooBig: false });
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it('keeps the notes and drops the install when a copy holds both', { timeout: 30_000 }, async () => {
    const { repo, folder } = await repoWithNotes();
    try {
      await mkdir(path.join(folder, 'notes'), { recursive: true });
      await writeFile(path.join(folder, 'notes', 'audit.md'), 'kept\n');
      const heavy = path.join(folder, 'node_modules', 'thing');
      await mkdir(heavy, { recursive: true });
      for (let at = 0; at < 401; at += 1) {
        await writeFile(path.join(heavy, `part-${String(at)}.js`), 'made again\n');
      }
      expect(await writingLeftBehind(git(), folder)).toEqual({ files: ['notes/audit.md'], tooBig: false });
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  /* The budget used to be a silent delete: an ignored folder over it was
     classed as a build and the copy given back with it. That is the very bug
     the rescue was added for, wearing a size limit. */
  it('keeps the copy rather than deleting writing it cannot carry', { timeout: 30_000 }, async () => {
    const { repo, folder } = await repoWithNotes();
    try {
      await mkdir(path.join(folder, 'notes'), { recursive: true });
      // Over the size budget, and nothing a command would put back.
      await writeFile(path.join(folder, 'notes', 'big.bin'), Buffer.alloc(65 * 1024 * 1024));
      const found = await writingLeftBehind(git(), folder);
      expect(found.tooBig).toBe(true);

      const away = await putAwayWorktree(git(), repo, folder, { rescue: async () => true });
      expect(away.put).toBe(false);
      expect(existsSync(folder)).toBe(true);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it('still gives back a copy whose bulk is only what a command makes', { timeout: 30_000 }, async () => {
    const { repo, folder } = await repoWithNotes();
    try {
      // Huge, ignored, and rebuilt by one command — the disk worth reclaiming.
      await mkdir(path.join(folder, 'node_modules', 'thing'), { recursive: true });
      await writeFile(
        path.join(folder, 'node_modules', 'thing', 'big.bin'),
        Buffer.alloc(65 * 1024 * 1024),
      );
      const found = await writingLeftBehind(git(), folder);
      expect(found).toEqual({ files: [], tooBig: false });

      const away = await putAwayWorktree(git(), repo, folder, { rescue: async () => true });
      expect(away.put).toBe(true);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  /* Saying it was carried out and then deleting the only copy is the whole
     failure this was written to prevent — a full disk must not become a lost
     report. */
  it('keeps the copy when the writing could not be carried out', async () => {
    const { repo, folder } = await repoWithNotes();
    try {
      await mkdir(path.join(folder, 'notes'), { recursive: true });
      await writeFile(path.join(folder, 'notes', 'audit.md'), 'the only copy\n');
      const away = await putAwayWorktree(git(), repo, folder, {
        rescue: async () => false,
      });
      expect(away.put).toBe(false);
      expect(existsSync(folder)).toBe(true);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it('carries it out before putting the checkout away', async () => {
    const { repo, folder } = await repoWithNotes();
    try {
      await mkdir(path.join(folder, 'notes'), { recursive: true });
      await writeFile(path.join(folder, 'notes', 'audit.md'), 'the only copy\n');
      const saved: string[] = [];
      const away = await putAwayWorktree(git(), repo, folder, {
        rescue: async (_where, files) => {
          saved.push(...files);
          return true;
        },
      });
      expect(away.put).toBe(true);
      expect(saved).toEqual(['notes/audit.md']);
      expect(existsSync(folder)).toBe(false);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it('carries it out before the startup sweep takes the folder', async () => {
    const { repo, folder } = await repoWithNotes();
    try {
      await mkdir(path.join(folder, 'notes'), { recursive: true });
      await writeFile(path.join(folder, 'notes', 'audit.md'), 'the only copy\n');
      const saved: string[] = [];
      const given = await sweepCheckouts(git(), repo, [folder], {
        rescue: async (_where, files) => {
          saved.push(...files);
          return true;
        },
      });
      expect(given).toEqual([folder]);
      expect(saved).toEqual(['notes/audit.md']);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });
});

describe('holdsWork — what a sweep is not allowed to destroy', () => {
  it('says no for a checkout nobody left anything in', async () => {
    const repo = await freshRepo();
    try {
      const made = await createWorktree(git(), repo, 'idle', null);
      if (!made.ok || made.value === null) return;
      expect(await holdsWork(git(), made.value.folder)).toBe(false);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it('says yes for an edit nobody committed', async () => {
    const repo = await freshRepo();
    try {
      const made = await createWorktree(git(), repo, 'busy', null);
      if (!made.ok || made.value === null) return;
      await writeFile(path.join(made.value.folder, 'a.txt'), 'half a thought\n');
      expect(await holdsWork(git(), made.value.folder)).toBe(true);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it('says no once the work is committed, because the branch is holding it', async () => {
    const repo = await freshRepo();
    try {
      const made = await createWorktree(git(), repo, 'saved', null);
      if (!made.ok || made.value === null) return;
      await writeFile(path.join(made.value.folder, 'a.txt'), 'a whole thought\n');
      await raw(made.value.folder, 'commit', '-am', 'the tab saves');
      expect(await holdsWork(git(), made.value.folder)).toBe(false);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it('does not count what the project ignores — that is the disk worth reclaiming', async () => {
    const repo = await freshRepo();
    try {
      await writeFile(path.join(repo, '.gitignore'), 'node_modules/\nrelease/\n');
      await raw(repo, 'add', '.');
      await raw(repo, 'commit', '-m', 'ignore the heavy things');
      const made = await createWorktree(git(), repo, 'built', null);
      if (!made.ok || made.value === null) return;
      await mkdir(path.join(made.value.folder, 'release'), { recursive: true });
      await writeFile(path.join(made.value.folder, 'release', 'app.dmg'), 'pretend this is 240MB\n');
      expect(await holdsWork(git(), made.value.folder)).toBe(false);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });
});

describe('sweepCheckouts — the copies a finished conversation left behind', () => {
  it('gives the folder back and keeps the branch the work is on', async () => {
    const repo = await freshRepo();
    try {
      const made = await createWorktree(git(), repo, 'over', null);
      if (!made.ok || made.value === null) return;
      await writeFile(path.join(made.value.folder, 'a.txt'), 'what the tab did\n');
      await raw(made.value.folder, 'commit', '-am', 'the tab saves');

      const given = await sweepCheckouts(git(), repo, [made.value.folder]);

      expect(given).toEqual([made.value.folder]);
      expect(existsSync(made.value.folder)).toBe(false);
      // The one thing a sweep may never do: the work is still there to land.
      expect((await raw(repo, 'show', 'graphe/over:a.txt')).trim()).toBe('what the tab did');
      // And git is not left with a note pointing at a folder that has gone.
      expect(await raw(repo, 'worktree', 'list')).not.toContain(made.value.folder);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it('leaves a checkout somebody is still in the middle of', async () => {
    const repo = await freshRepo();
    try {
      const made = await createWorktree(git(), repo, 'midway', null);
      if (!made.ok || made.value === null) return;
      await writeFile(path.join(made.value.folder, 'a.txt'), 'half a thought\n');

      const given = await sweepCheckouts(git(), repo, [made.value.folder]);

      expect(given).toEqual([]);
      expect(existsSync(made.value.folder)).toBe(true);
      expect(readFileContent(made.value.folder, 'a.txt')).toBe('half a thought\n');
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it('leaves the one a conversation is open in', async () => {
    const repo = await freshRepo();
    try {
      const made = await createWorktree(git(), repo, 'open-now', null);
      if (!made.ok || made.value === null) return;

      const given = await sweepCheckouts(git(), repo, [made.value.folder], {
        inUse: (folder) => folder === made.value?.folder,
      });

      expect(given).toEqual([]);
      expect(existsSync(made.value.folder)).toBe(true);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it('takes back every idle one at once, which is the whole point', async () => {
    const repo = await freshRepo();
    try {
      const names = ['one', 'two', 'three'];
      const folders: string[] = [];
      for (const name of names) {
        const made = await createWorktree(git(), repo, name, null);
        if (made.ok && made.value !== null) folders.push(made.value.folder);
      }
      expect(folders).toHaveLength(3);

      const given = await sweepCheckouts(git(), repo, folders);

      expect(given).toHaveLength(3);
      for (const folder of folders) expect(existsSync(folder)).toBe(false);
      // Every branch survives its folder.
      for (const name of names) {
        expect((await raw(repo, 'rev-parse', '--verify', `graphe/${name}`)).trim()).not.toBe('');
      }
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });
});

describe('putting a conversation away and asking for it again', () => {
  it('gives the folder back and hands it over again with the work still on it', async () => {
    const repo = await freshRepo();
    try {
      const made = await createWorktree(git(), repo, 'later', null);
      if (!made.ok || made.value === null) return;
      const { folder, branch } = made.value;
      await writeFile(path.join(folder, 'a.txt'), 'what the tab did\n');
      await raw(folder, 'commit', '-am', 'the tab saves');

      expect(await putAwayWorktree(git(), repo, folder)).toEqual({ put: true });
      expect(existsSync(folder)).toBe(false);

      const back = await reopenWorktree(git(), repo, branch, folder);
      expect(back.ok).toBe(true);
      // The same conversation, on the same branch, looking at its own work.
      expect(existsSync(folder)).toBe(true);
      expect((await raw(folder, 'rev-parse', '--abbrev-ref', 'HEAD')).trim()).toBe(branch);
      expect(readFileContent(folder, 'a.txt')).toBe('what the tab did\n');
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it('is what takes the heavy things back, which is the whole point', async () => {
    const repo = await freshRepo();
    try {
      await writeFile(path.join(repo, '.gitignore'), 'node_modules/\nrelease/\n');
      await raw(repo, 'add', '.');
      await raw(repo, 'commit', '-m', 'ignore the heavy things');
      const made = await createWorktree(git(), repo, 'built', null);
      if (!made.ok || made.value === null) return;
      const { folder, branch } = made.value;
      await mkdir(path.join(folder, 'node_modules'), { recursive: true });
      await writeFile(path.join(folder, 'node_modules', 'big'), 'pretend this is 1.5GB\n');
      await mkdir(path.join(folder, 'release'), { recursive: true });
      await writeFile(path.join(folder, 'release', 'app.dmg'), 'pretend this is 240MB\n');

      expect(await putAwayWorktree(git(), repo, folder)).toEqual({ put: true });
      expect(existsSync(path.join(folder, 'node_modules'))).toBe(false);
      expect(existsSync(path.join(folder, 'release'))).toBe(false);

      // And what comes back is the project, not the build.
      const back = await reopenWorktree(git(), repo, branch, folder);
      expect(back.ok).toBe(true);
      expect(existsSync(path.join(folder, 'a.txt'))).toBe(true);
      expect(existsSync(path.join(folder, 'node_modules'))).toBe(false);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it('will not put away a checkout somebody is in the middle of', async () => {
    const repo = await freshRepo();
    try {
      const made = await createWorktree(git(), repo, 'midway', null);
      if (!made.ok || made.value === null) return;
      await writeFile(path.join(made.value.folder, 'a.txt'), 'half a thought\n');

      expect(await putAwayWorktree(git(), repo, made.value.folder)).toEqual({ put: false });
      expect(existsSync(made.value.folder)).toBe(true);
      expect(readFileContent(made.value.folder, 'a.txt')).toBe('half a thought\n');
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it('keeps an untracked file nobody committed, ignored ones aside', async () => {
    const repo = await freshRepo();
    try {
      const made = await createWorktree(git(), repo, 'notes', null);
      if (!made.ok || made.value === null) return;
      await writeFile(path.join(made.value.folder, 'scratch.txt'), 'not committed anywhere\n');

      expect(await putAwayWorktree(git(), repo, made.value.folder)).toEqual({ put: false });
      expect(readFileContent(made.value.folder, 'scratch.txt')).toBe('not committed anywhere\n');
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it('says so rather than opening a conversation on somebody else\'s work', async () => {
    const repo = await freshRepo();
    try {
      const made = await createWorktree(git(), repo, 'lost', null);
      if (!made.ok || made.value === null) return;
      const { folder, branch } = made.value;
      await putAwayWorktree(git(), repo, folder);
      // The branch is thrown away behind its back.
      await raw(repo, 'branch', '-D', branch);

      const back = await reopenWorktree(git(), repo, branch, folder);
      expect(back.ok).toBe(false);
      if (back.ok) return;
      expect(back.because).toBe(worktreeWords.gone);
      // Nothing invented to stand in for it.
      expect(existsSync(folder)).toBe(false);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it('survives being put away and asked for over and over', { timeout: 30_000 }, async () => {
    const repo = await freshRepo();
    try {
      const made = await createWorktree(git(), repo, 'busy-week', null);
      if (!made.ok || made.value === null) return;
      const { folder, branch } = made.value;

      for (const round of ['one', 'two', 'three']) {
        await writeFile(path.join(folder, 'a.txt'), `${round}\n`);
        await raw(folder, 'commit', '-am', `round ${round}`);
        expect(await putAwayWorktree(git(), repo, folder)).toEqual({ put: true });
        expect(existsSync(folder)).toBe(false);
        const back = await reopenWorktree(git(), repo, branch, folder);
        expect(back.ok).toBe(true);
        expect(readFileContent(folder, 'a.txt')).toBe(`${round}\n`);
      }
      // Three rounds of work, all of it still on the one branch.
      expect((await raw(repo, 'log', '--oneline', branch)).trim().split('\n')).toHaveLength(4);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it('a put-away conversation still lands its work in the main checkout', async () => {
    const repo = await freshRepo();
    try {
      const made = await createWorktree(git(), repo, 'landing', null);
      if (!made.ok || made.value === null) return;
      const { folder, branch } = made.value;
      await writeFile(path.join(folder, 'a.txt'), 'the tab decided this\n');
      await raw(folder, 'commit', '-am', 'the tab saves');
      await putAwayWorktree(git(), repo, folder);

      const back = await reopenWorktree(git(), repo, branch, folder);
      expect(back.ok).toBe(true);
      const landed = await landWorktree(git(), repo, folder);
      expect(landed.ok).toBe(true);
      expect(readFileContent(repo, 'a.txt')).toBe('the tab decided this\n');
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });
});
