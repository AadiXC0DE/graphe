import { copyFile, mkdir, readFile, stat } from 'node:fs/promises';
import { writeAtomically } from '../lib/atomic';
import { dirname, join, resolve } from 'node:path';

import type { RunGit } from './worktree';

/** What a checkout needs to run, which git will not carry.
 *
 * `git worktree add` writes tracked files and nothing else, so the second
 * conversation in a project opens on a checkout with no `.env.local` in it. The
 * dev server starts and then falls over at the first request, or refuses
 * sign-in, and the reason is a file that is not there.
 *
 * A project says what to carry in a `.worktreeinclude` at its root: `.gitignore`
 * syntax, and a pattern only carries a file that is *also* gitignored, so
 * nothing tracked is ever duplicated. Claude Code reads the same file under the
 * same name, and a developer moving between the two should not have to learn
 * ours.
 *
 * With no such file the default is the env files and nothing else. Dependencies
 * are installed in a checkout rather than carried into it: a copy of
 * `node_modules` is either gigabytes of real disk or a symlink that lets the
 * checkout's install rewrite the person's own project.
 */
export const WORKTREE_INCLUDE = '.worktreeinclude';

/** `.env`, `.env.local`, `.env.production` — not `.envrc`, which is direnv's
 *  and is a credential file before it is an env file. */
const ENV_FILE = /^\.env($|\.)/;

/** Tracked in every project that has one, so it is already in the checkout. */
const ENV_SAMPLE = '.env.example';

/** Past these, carrying files into a checkout stops being a small kindness and
 *  starts being an install done the slow way. */
const CARRY_FILES = 2_000;
const CARRY_BYTES = 64 * 1024 * 1024;

/** What a checkout was given, and what would not fit. */
export type Seeded = {
  /** Paths now in the checkout, relative to the project, that git left behind. */
  carried: readonly string[];
  /** Named by `.worktreeinclude` and past the ceiling above. */
  left: number;
};

const nothing: Seeded = { carried: [], left: 0 };

export const seedWords = {
  /** Said once, in the conversation that got the checkout. Copying a `.env` is
   *  a second place someone's keys live, and nobody should have to read a diff
   *  to find that out. */
  carried: (files: readonly string[], from: string): string => {
    const named = [...files].sort().join(', ');
    const many = files.length !== 1;
    return `This conversation works in its own checkout of the project, and a checkout carries tracked files only. I copied ${named} into it from ${from}, so ${many ? 'those files' : 'that file'} now ${many ? 'exist' : 'exists'} in two places. Nothing in your own folder was touched.`;
  },
  /** What the agent is told when it starts. `npm run dev` answering `command
   *  not found` is a poor way to learn there is no install here. */
  told: (carried: readonly string[]): string => {
    const has =
      carried.length === 0
        ? 'nothing that the project gitignores'
        : `the gitignored files carried over for it: ${[...carried].sort().join(', ')}`;
    return [
      `This conversation works in its own git checkout of the project, made with \`git worktree add\`. It holds the tracked files and ${has}.`,
      'Dependencies are not installed here. Install them in this folder before running anything that needs them, and do not touch the project folder to do it.',
      `A \`${WORKTREE_INCLUDE}\` at the project root — \`.gitignore\` syntax — names any other gitignored file to carry into every checkout. Say so if the person asks why something is missing.`,
    ].join(' ');
  },
} as const;

/** Everything git ignores here: files, and whole folders collapsed to one row. */
async function ignoredEntries(run: RunGit, repo: string): Promise<readonly string[]> {
  const { code, out } = await run(
    ['ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--directory'],
    { cwd: repo },
  );
  if (code !== 0 || out === undefined) return [];
  return out.split('\0').filter((one) => one !== '');
}

/** The files `.worktreeinclude` names, or null when the project has no such
 *  file. Git does the pattern matching, so the syntax is `.gitignore`'s by
 *  construction rather than by our imitation of it. */
async function askedFor(run: RunGit, repo: string): Promise<readonly string[] | null> {
  const found = await stat(join(repo, WORKTREE_INCLUDE)).catch(() => null);
  if (found === null || !found.isFile()) return null;
  const { code, out } = await run(
    ['ls-files', '-z', '--others', '--ignored', `--exclude-from=${WORKTREE_INCLUDE}`],
    { cwd: repo },
  );
  if (code !== 0 || out === undefined) return [];
  return out.split('\0').filter((one) => one !== '');
}

/** Whether a path is one git ignores, read off the collapsed listing. */
function ignoredBy(entries: readonly string[]): (path: string) => boolean {
  const files = new Set(entries.filter((one) => !one.endsWith('/')));
  const folders = entries.filter((one) => one.endsWith('/'));
  return (path) => files.has(path) || folders.some((one) => path.startsWith(one));
}

/** The default, for a project that has not said: what it needs to run and
 *  nothing else. Every other credential file — `.npmrc`, a key, a certificate —
 *  is left where it is unless the project asks for it by name. */
function envFiles(entries: readonly string[]): readonly string[] {
  return entries.filter((one) => {
    if (one.endsWith('/')) return false;
    const name = one.slice(one.lastIndexOf('/') + 1);
    return ENV_FILE.test(name) && name !== ENV_SAMPLE;
  });
}

/** Git never emits either of these, but a path that climbs out of the checkout
 *  is not one to copy on trust. */
function staysInside(path: string): boolean {
  if (path === '' || path.startsWith('/')) return false;
  return !path.split('/').includes('..');
}

async function carry(
  repo: string,
  folder: string,
  paths: readonly string[],
): Promise<Seeded> {
  const carried: string[] = [];
  let bytes = 0;
  let left = 0;
  for (const one of paths) {
    if (!staysInside(one)) continue;
    if (carried.length >= CARRY_FILES || bytes >= CARRY_BYTES) {
      left += 1;
      continue;
    }
    const from = join(repo, one);
    const about = await stat(from).catch(() => null);
    if (about === null || !about.isFile()) continue;
    const to = join(folder, one);
    // Already there: a checkout spread out again, or one the agent has since
    // edited. Either way ours is not the version to write.
    if ((await stat(to).catch(() => null)) !== null) continue;
    try {
      await mkdir(dirname(to), { recursive: true });
      await copyFile(from, to);
    } catch {
      continue;
    }
    carried.push(one);
    bytes += about.size;
  }
  return { carried, left };
}

/**
 * Give a checkout what the project needs to run.
 *
 * Never throws and never argues: a checkout that could not be seeded still
 * opens, and the agent installs and asks. Safe to call again — a file already
 * in the checkout is left exactly as it is.
 */
export async function seedCheckout(
  run: RunGit,
  repo: string,
  folder: string,
): Promise<Seeded> {
  try {
    const ignored = await ignoredEntries(run, repo);
    const asked = await askedFor(run, repo);
    const wanted = asked === null ? envFiles(ignored) : asked.filter(ignoredBy(ignored));
    const seeded = await carry(repo, folder, wanted);
    if (seeded.carried.length > 0) await noteSeeded(run, folder, seeded.carried);
    return seeded;
  } catch {
    return nothing;
  }
}

/* -------------------------------------------------------------------------- */
/* What the checkout is not the only copy of                                   */
/* -------------------------------------------------------------------------- */

/** The note lives in the checkout's own git folder, never in its working tree:
 *  nothing here is the person's to commit, or to be counted as their work. */
async function noteFile(run: RunGit, folder: string): Promise<string | null> {
  const { code, out } = await run(['rev-parse', '--git-dir'], { cwd: folder });
  if (code !== 0 || out === undefined) return null;
  const dir = out.trim();
  return dir === '' ? null : join(resolve(folder, dir), 'graphe-seeded');
}

async function noteSeeded(
  run: RunGit,
  folder: string,
  files: readonly string[],
): Promise<void> {
  const at = await noteFile(run, folder);
  if (at === null) return;
  const all = [...new Set([...(await seededIn(run, folder)), ...files])].sort();
  // Beside it and moved into place: a half-written list is a checkout that no
  // longer knows which of its files came from the project, and those are the
  // ones it must not take away with it.
  await writeAtomically(at, `${all.join('\n')}\n`).catch(() => undefined);
}

/** Paths in this checkout that came from the project, so the checkout going
 *  away takes nothing with it that is not still where it came from. */
export async function seededIn(run: RunGit, folder: string): Promise<readonly string[]> {
  const at = await noteFile(run, folder);
  if (at === null) return [];
  const text = await readFile(at, 'utf8').catch(() => '');
  return text.split('\n').filter((one) => one !== '');
}
