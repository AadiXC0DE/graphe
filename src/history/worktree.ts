import { copyFile, mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { seededIn } from './seeding';

/** One conversation, its own checkout.
 *
 * Two tabs working the same project parallel are two agents writing the same
 * files, and that ends in whichever finished second silently winning — the
 * reason Cursor, Windsurf and Claude Code each give an agent its own git
 * worktree and branch, then merge that branch back. This is the same shape,
 * kept small and ordinary-git so a designer's folder stays a normal repository
 * (ARCHITECTURE.md decision 4).
 *
 * Three verbs and one refusal:
 *
 *  - **`create`** makes a checkout and a branch for a conversation, somewhere
 *    the project never tracks. The branch starts where the work would have
 *    started — the current HEAD, or the project's own default line when a
 *    fresh base is asked for.
 *  - **`land`** brings a conversation's branch into the main checkout. Refused
 *    while the main checkout has tracked changes a merge could squash — the one
 *    moment a designer's unfinished work could be silently replaced, and
 *    nothing here is allowed to do that.
 *  - **`drop`** throws a checkout away, branch and all.
 *
 * Everything here is pure: the caller hands in the git runner, so a test can
 * point it at a real repository and the conversation can hand it the shell's
 * own.
 */

/** One conversation's isolated checkout. */
export type Worktree = {
  /** Absolute path of the checkout, where the session works. */
  folder: string;
  /** The branch it is checked out on. */
  branch: string;
};

/** The git runner the caller supplies. `cwd` is where the command runs. */
export type RunGit = (
  args: string[],
  options: { cwd: string },
) => Promise<{ code: number; out?: string }>;

export const worktreeWords = {
  notRepo: 'This folder is not a git repository, so a conversation cannot work on its own checkout of it.',
  dirty: 'You have unsaved work here that a merge could squash. Save it first, and this will finish.',
  noWorktree: 'This conversation has no checkout to merge back.',
  /** A real conflict, said as itself. It used to be reported as "you have
   *  unsaved work", which is advice nobody can act on when what actually
   *  happened is that both sides changed the same lines — and the repository is
   *  left mid-merge, which that sentence gives no hint of. */
  clashed:
    'This conversation and your own work changed the same lines, so I could not put them together. I have left everything exactly as it was.',
  /** A conversation put away and then asked for again, whose work is no longer
   *  in the project. Said rather than quietly opened on the wrong files. */
  gone: 'The work this conversation was doing is not in this project any more, so I could not open it again.',
} as const;

/** What an Apply carried back, and where it could not. */
export type BringBack = {
  /** Paths now carrying the conversation's version in the main checkout. */
  applied: readonly string[];
  /** Paths both sides changed. Left as the main checkout has them. */
  conflicted: readonly string[];
};

export type Result = { ok: true; value: Worktree | null } | { ok: false; because: string };

const ok = (value: Worktree | null = null): Result => ({ ok: true, value });
const no = (because: string): Result => ({ ok: false, because });

export const bringBackWords = {
  notRepo: 'This folder is not a git repository, so a conversation cannot bring its work back here.',
  /** Said when work stayed behind. Both sides changed the same file, so keeping
   *  either one would have thrown the other away without asking. */
  heldBack: (files: readonly string[]): string => {
    const named = files.slice(0, 4).join(', ');
    const rest = files.length > 4 ? ` and ${String(files.length - 4)} more` : '';
    return files.length === 1
      ? `One file was changed here and in this conversation at the same time, so I left yours alone: ${named}. Ask me to bring that one over if you want mine instead.`
      : `${String(files.length)} files were changed here and in this conversation at the same time, so I left yours alone: ${named}${rest}. Ask me to bring those over if you want mine instead.`;
  },
} as const;

/** Whether `folder` is a git checkout itself. */
async function isRepo(run: RunGit, folder: string): Promise<boolean> {
  return (await run(['rev-parse', '--is-inside-work-tree'], { cwd: folder })).code === 0;
}

/** Whether the main checkout has tracked changes a merge could squash.
 *  Untracked files are not squashed by a merge, so they do not hold one up. */
async function isDirty(run: RunGit, repo: string): Promise<boolean> {
  const { code, out } = await run(['status', '--porcelain'], { cwd: repo });
  if (code !== 0 || out === undefined) return false;
  return out.split('\n').some((line) => line.trim() !== '' && !line.startsWith('??'));
}

/** A branch name that reads as belonging to us and no-one else. Every segment
 *  is ours, so nothing in an id can smuggle a traversal or a name around the
 *  prefix. */
export function branchFor(id: string): string {
  const kept = id
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .split('/')
    .filter((part) => part !== '' && part !== '.' && part !== '..')
    .join('/')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `graphe/${kept === '' ? 'conversation' : kept}`;
}

/** A safe leaf name for a folder, from any id. */
export function folderLeaf(id: string): string {
  return branchFor(id).replace(/^graphe\//, '').replace(/[^a-zA-Z0-9_-]/g, '-');
}

/** Where the checkouts live, under the repository's own untracked roof. */
export function checkoutFolder(repo: string): string {
  return `${repo}/.graphe/worktrees`;
}

/**
 * Create one conversation's checkout.
 *
 * `base` names the branch to start from when a fresh base is wanted; null means
 * the current HEAD. The branch is new either way, so the conversation carries on
 * from where the work would have started rather than from a stranger's thread.
 */
export async function createWorktree(
  run: RunGit,
  repo: string,
  id: string,
  base: { ref: string } | null,
  options: { folder?: string } = {},
): Promise<Result> {
  if (!(await isRepo(run, repo))) return no(worktreeWords.notRepo);
  const branch = branchFor(id);
  const folder = options.folder ?? `${checkoutFolder(repo)}/${folderLeaf(id)}`;

  // Make the branch from the base (or the current HEAD), then check it out.
  // An existing branch is not a failure — a crash between create and use should
  // not strand a conversation that is half there — so only the checkout argues.
  const from = base === null ? 'HEAD' : base.ref;
  await run(['branch', branch, from], { cwd: repo });

  const added = await run(['worktree', 'add', '--force', folder, branch], { cwd: repo });
  if (added.code !== 0) return no(worktreeWords.notRepo);
  return ok({ folder, branch });
}

/** The branch a checkout is on, or null when it is not a worktree of ours. */
async function branchAt(run: RunGit, folder: string): Promise<string | null> {
  const { code, out } = await run(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: folder });
  if (code !== 0 || out === undefined) return null;
  const name = out.trim();
  return name === '' || name === 'HEAD' ? null : name;
}

/**
 * Bring a conversation's checkout into the main checkout, then throw the
 * checkout away.
 *
 * Refused while the main checkout has tracked changes a merge could squash.
 * The merge is a fast-forward when it can be, and an ordinary merge otherwise —
 * the conversation carries its own history, so a real conflict is git's and is
 * left for the person rather than guessed at.
 */
export async function landWorktree(run: RunGit, repo: string, folder: string): Promise<Result> {
  const branch = await branchAt(run, folder);
  if (branch === null) return no(worktreeWords.noWorktree);
  if (await isDirty(run, repo)) return no(worktreeWords.dirty);

  const merged = await run(['merge', '--no-edit', branch], { cwd: repo });
  if (merged.code !== 0) {
    // Put the repository back before saying anything. A failed merge leaves it
    // half-merged with markers in the files, and the sentence people used to
    // get — "you have unsaved work" — sent them looking for the wrong thing
    // entirely while the project sat in a state they had not asked for.
    await run(['merge', '--abort'], { cwd: repo });
    return no(worktreeWords.clashed);
  }
  await dropWorktree(run, repo, folder);
  return ok();
}

/** Throw a conversation's checkout away, branch and all. */
export async function dropWorktree(run: RunGit, repo: string, folder: string): Promise<Result> {
  const branch = await branchAt(run, folder);
  await run(['worktree', 'remove', '--force', folder], { cwd: repo });
  if (branch !== null) await run(['branch', '-D', branch], { cwd: repo });
  return ok();
}

/**
 * Give the folder back without throwing the work away.
 *
 * Used when a conversation ends rather than when somebody discards it: the
 * checkout is a whole second copy of the project on disk and there is no reason
 * to keep it, but the branch is where the work is, and a conversation being put
 * down is not a decision to lose it.
 */
export async function releaseWorktree(run: RunGit, repo: string, folder: string): Promise<Result> {
  await run(['worktree', 'remove', '--force', folder], { cwd: repo });
  return ok();
}

/** Spread a conversation's branch back out on disk. Nothing is created: a
 *  conversation whose branch has gone is told so rather than opened on files
 *  that are not its own. */
export async function reopenWorktree(
  run: RunGit,
  repo: string,
  branch: string,
  folder: string,
): Promise<Result> {
  if (!(await isRepo(run, repo))) return no(worktreeWords.notRepo);
  const known = await run(['rev-parse', '--verify', `refs/heads/${branch}`], { cwd: repo });
  if (known.code !== 0) return no(worktreeWords.gone);
  // A folder git still has a note about, from a checkout that went away
  // untidily, would otherwise refuse the add.
  await run(['worktree', 'prune'], { cwd: repo });
  const added = await run(['worktree', 'add', '--force', folder, branch], { cwd: repo });
  if (added.code !== 0) return no(worktreeWords.gone);
  return ok({ folder, branch });
}

/**
 * Put a conversation's checkout away until it is next wanted.
 *
 * What a conversation owns is its branch. The folder is only that branch spread
 * out on disk — kilobytes against gigabytes, and the gigabytes are what a
 * dependency install and a build leave behind in it. So a conversation nobody
 * is in gives the folder back and keeps the branch, and `reopenWorktree` spreads
 * it out again if somebody returns.
 *
 * Refused while the working tree holds something, because that is the one thing
 * the branch is not already holding. Say so with `put`: false is "still there",
 * not "went wrong".
 *
 * Anything the project ignores is carried out first — see `writingLeftBehind`.
 */
export async function putAwayWorktree(
  run: RunGit,
  repo: string,
  folder: string,
  options: { rescue?: Rescue } = {},
): Promise<{ put: boolean }> {
  if (await holdsWork(run, folder)) return { put: false };
  if (!(await carryOutWriting(run, folder, options.rescue))) return { put: false };
  const released = await releaseWorktree(run, repo, folder);
  if (!released.ok) return { put: false };
  await run(['worktree', 'prune'], { cwd: repo });
  return { put: true };
}

/* -------------------------------------------------------------------------- */
/* Giving the idle ones back                                                   */
/* -------------------------------------------------------------------------- */

/** Whether the working tree holds something the branch does not. Ignored files
 *  do not count — an install or a build is made again, and that is the disk
 *  worth reclaiming. A folder git cannot read is treated as holding work. */
export async function holdsWork(run: RunGit, folder: string): Promise<boolean> {
  const { code, out } = await run(['status', '--porcelain'], { cwd: folder });
  if (code !== 0 || out === undefined) return true;
  return out.split('\n').some((line) => line.trim() !== '');
}

/* ---------------------------------------------- what nothing else would keep */

/**
 * Writing a person could have done that no save would ever pick up.
 *
 * `holdsWork` steps over what the project ignores, and it is right to: an
 * install or a build is the disk worth reclaiming. But a project that ignores a
 * notes folder writes real things into that folder, and nothing saves them, or
 * carries them home, or counts them as work — so the folder going is the only
 * copy going. A fifty-kilobyte research report was lost exactly this way, on a
 * restart, with nothing said.
 *
 * Named things a command makes are dropped without being read. Everything else
 * ignored is carried out — and if it is too big to carry, the copy is kept
 * instead of being given back, because "too big" must never quietly mean
 * "deleted". That was the whole bug.
 */
export async function writingLeftBehind(
  run: RunGit,
  folder: string,
): Promise<{ files: readonly string[]; tooBig: boolean }> {
  const { code, out } = await run(['status', '--porcelain', '-z', '--ignored'], { cwd: folder });
  if (code !== 0 || out === undefined) return { files: [], tooBig: false };
  const keep: string[] = [];
  let tooBig = false;
  // A `.env` carried in when the checkout was made is still in the project it
  // came from, so rescuing it would only put someone's keys in a third folder.
  const copies = new Set(await seededIn(run, folder).catch(() => []));
  for (const row of out.split('\0')) {
    if (!row.startsWith('!! ')) continue;
    const entry = row.slice(3).replace(/\/+$/, '');
    // Made again by one command, whatever is in it. These are the disk worth
    // reclaiming and the reason the sweep exists.
    if (MADE_AGAIN.has(entry.split('/')[0] ?? entry)) continue;
    // Entry by entry: a copy holding an install and a page of notes should lose
    // the install and keep the notes.
    const under = await smallFilesUnder(folder, entry);
    if (under === null) tooBig = true;
    else keep.push(...under.filter((one) => !copies.has(one)));
  }
  return { files: keep, tooBig };
}

/** Folders whose whole contents one command puts back. Anything ignored that is
 *  not one of these is treated as somebody's, however big it turns out to be. */
const MADE_AGAIN = new Set([
  'node_modules',
  '.venv',
  'venv',
  '__pycache__',
  'dist',
  'build',
  'out',
  'target',
  'vendor',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.astro',
  '.turbo',
  '.cache',
  '.parcel-cache',
  'coverage',
  '.gradle',
  '.venv-tools',
  'release',
  '.vite',
  '.eval',
]);

/** Past these, carrying an entry out is no longer a small kindness. Generous,
 *  because the cost of being wrong the other way is somebody's writing. */
const RESCUE_FILES = 2_000;
const RESCUE_BYTES = 64 * 1024 * 1024;

/** Everything under one ignored entry, or null once it is plainly a build. */
async function smallFilesUnder(folder: string, entry: string): Promise<string[] | null> {
  const where = entry.replace(/\/+$/, '');
  if (where === '') return null;
  const found: string[] = [];
  let bytes = 0;

  const walk = async (at: string): Promise<boolean> => {
    const about = await stat(resolve(folder, at)).catch(() => null);
    if (about === null) return true;
    if (about.isFile()) {
      found.push(at);
      bytes += about.size;
      return found.length <= RESCUE_FILES && bytes <= RESCUE_BYTES;
    }
    if (!about.isDirectory()) return true;
    for (const name of await readdir(resolve(folder, at)).catch(() => [])) {
      if (!(await walk(`${at}/${name}`))) return false;
    }
    return true;
  };

  return (await walk(where)) ? found : null;
}

/**
 * Told where a copy is and what it holds, before the copy goes.
 *
 * The copying itself is the caller's, the same way the git runner is — and so
 * is saying whether it worked. False keeps the copy: a rescue that could not
 * write, because the disk was full or the folder refused it, must not be
 * followed by deleting the only copy of what it was rescuing.
 */
export type Rescue = (folder: string, files: readonly string[]) => Promise<boolean>;

/**
 * Carry that writing out before the copy goes, and say whether it may go.
 *
 * False means keep it. Only ever because there is more here than can be
 * carried — and a folder that is too big to rescue is the last one to delete
 * on the grounds that it was probably nothing.
 */
async function carryOutWriting(run: RunGit, folder: string, rescue?: Rescue): Promise<boolean> {
  const found = await writingLeftBehind(run, folder).catch(() => ({
    files: [] as readonly string[],
    tooBig: false,
  }));
  if (found.tooBig) return false;
  // Nowhere to put it is not a reason to keep the folder: the caller that did
  // not ask for a rescue is the one that never had anything to lose.
  if (rescue === undefined) return true;
  if (found.files.length === 0) return true;
  return rescue(folder, found.files).catch(() => false);
}

/** The backstop: checkouts left by conversations that are gone, or by a copy of
 *  the app older than any of this. Never takes one the caller says is owned, or
 *  one holding work. The caller says what is on disk. */
export async function sweepCheckouts(
  run: RunGit,
  repo: string,
  found: readonly string[],
  options: { inUse?: (folder: string) => boolean; rescue?: Rescue } = {},
): Promise<readonly string[]> {
  const inUse = options.inUse ?? (() => false);
  const given: string[] = [];
  for (const folder of found) {
    if (inUse(folder)) continue;
    if (await holdsWork(run, folder)) continue;
    if (!(await carryOutWriting(run, folder, options.rescue))) continue;
    const released = await releaseWorktree(run, repo, folder);
    if (released.ok) given.push(folder);
  }
  // Git keeps a note per checkout inside the repository. Removing the folders
  // above leaves those notes pointing at nothing.
  if (given.length > 0) await run(['worktree', 'prune'], { cwd: repo });
  return given;
}

/** The names and statuses git reports, as `{ kind, path }` rows.
 *
 * Always asked for with `-z`. Git's ordinary output quotes any path that is not
 * plain ASCII — `"caf\303\251.css"` — and a name read with the quotes still on
 * it points at no file on disk, so those files were dropped on the way back and
 * the person was told their work had been carried over. NUL-separated output is
 * never quoted and never escaped.
 */
async function changedAgainst(
  run: RunGit,
  dir: string,
  args: string[],
  shape: 'status' | 'paths' = 'status',
): Promise<Array<{ kind: 'A' | 'D' | 'M'; path: string }>> {
  // Right after the subcommand: appended at the end it would land after a `--`
  // and be read as the name of a file to look for.
  const { code, out } = await run([args[0] ?? '', '-z', ...args.slice(1)], { cwd: dir });
  if (code !== 0 || out === undefined) return [];
  const parts = out.split('\0').filter((part) => part !== '');
  const seen = new Map<string, 'A' | 'D' | 'M'>();

  if (shape === 'paths') {
    // `ls-files --others` names files and says nothing about them; every one is
    // new to the main checkout.
    for (const path of parts) if (path !== '.') seen.set(path, 'A');
    return [...seen.entries()].map(([path, kind]) => ({ kind, path }));
  }

  // `--name-status -z` alternates: a status, then the path it belongs to.
  for (let at = 0; at + 1 < parts.length; at += 2) {
    const kind = (parts[at] ?? '').trim().charAt(0);
    const path = parts[at + 1] ?? '';
    if (path === '' || path === '.') continue;
    if (kind !== 'A' && kind !== 'M' && kind !== 'D') continue;
    seen.set(path, kind === 'D' ? 'D' : 'A');
  }
  return [...seen.entries()].map(([path, kind]) => ({ kind, path }));
}

async function worktreeChanges(
  run: RunGit,
  folder: string,
  base: string,
): Promise<Array<{ kind: 'A' | 'D' | 'M'; path: string }>> {
  const committed = await changedAgainst(run, folder, ['diff', '--name-status', '--no-renames', base]);
  const working = await changedAgainst(run, folder, ['diff', '--name-status', '--no-renames']);
  const untracked = await changedAgainst(run, folder, ['ls-files', '--others', '--exclude-standard'], 'paths');
  const byPath = new Map<string, 'A' | 'D' | 'M'>();
  for (const row of [...committed, ...working, ...untracked]) byPath.set(row.path, row.kind);
  return [...byPath.entries()].map(([path, kind]) => ({ kind, path }));
}

/** The commit the worktree branched from: two sides one ancestor, so the
 *  changes each side made since then are the ones worth comparing. */
async function sharedBase(run: RunGit, folder: string, repo: string): Promise<string | null> {
  const branch = await branchAt(run, folder);
  if (branch === null) return null;
  const { code, out } = await run(['merge-base', branch, 'HEAD'], { cwd: repo });
  return code === 0 && out !== undefined ? out.trim() : null;
}

/** Whether the main checkout changed that path since the shared base. */
async function mainChanged(run: RunGit, repo: string, base: string, path: string): Promise<boolean> {
  const [tracked, untracked] = await Promise.all([
    changedAgainst(run, repo, ['diff', '--name-status', '--no-renames', base, '--', path]),
    changedAgainst(run, repo, ['ls-files', '--others', '--exclude-standard', '--', path], 'paths'),
  ]);
  return tracked.length > 0 || untracked.length > 0;
}

/** True when both sides changed a path to the same final state. This is common
 * after the live preview Apply has already carried a conversation's work home;
 * treating identical bytes as a conflict makes the later explicit landing
 * impossible even though there is nothing to choose between. */
async function sameFileState(
  repo: string,
  folder: string,
  row: { kind: 'A' | 'D' | 'M'; path: string },
): Promise<boolean> {
  const target = resolve(repo, row.path);
  if (row.kind === 'D') {
    return readFile(target).then(() => false).catch(() => true);
  }
  const [main, copy] = await Promise.all([
    readFile(target).catch(() => null),
    readFile(resolve(folder, row.path)).catch(() => null),
  ]);
  return main !== null && copy !== null && main.equals(copy);
}

/** Copy one file from the worktree into the main checkout, or remove it. */
async function carryFile(repo: string, folder: string, row: { kind: 'A' | 'D' | 'M'; path: string }): Promise<void> {
  const target = resolve(repo, row.path);
  if (row.kind === 'D') {
    await rm(target, { force: true });
    return;
  }
  await mkdir(dirname(target), { recursive: true });
  await copyFile(resolve(folder, row.path), target);
}

/**
 * Bring a conversation's work back into the main checkout, as uncommitted
 * changes.
 *
 * This is Cursor's Apply: it diffs the checkout's whole state against the base
 * it branched from — committed and uncommitted alike — and carries the files
 * into the main checkout without a commit, so the work is on disk the moment
 * it is applied and the person still decides the saving. A path the main
 * checkout has also changed since the base is left alone and reported, rather
 * than one side silently overwriting the other (that is the one moment a
 * designer's unfinished work could be replaced).
 */
export async function bringBack(
  run: RunGit,
  repo: string,
  folder: string,
): Promise<{ ok: true; value: BringBack } | { ok: false; because: string }> {
  if (!(await isRepo(run, repo))) return { ok: false, because: bringBackWords.notRepo };
  const base = await sharedBase(run, folder, repo);
  if (base === null) return { ok: false, because: bringBackWords.notRepo };
  const changes = await worktreeChanges(run, folder, base);
  const applied: string[] = [];
  const conflicted: string[] = [];
  for (const row of changes) {
    if (await mainChanged(run, repo, base, row.path)) {
      if (await sameFileState(repo, folder, row)) applied.push(row.path);
      else conflicted.push(row.path);
    } else {
      await carryFile(repo, folder, row);
      applied.push(row.path);
    }
  }
  return { ok: true, value: { applied, conflicted } };
}

/* -------------------------------------------------------------------------- */
/* Naming one                                                                  */
/* -------------------------------------------------------------------------- */

/** How many names to try before giving up on counting and taking the moment. */
const ENOUGH = 200;

/**
 * A name for a parallel checkout that nothing else is using.
 *
 * Naming one after how many conversations are open right now is the bug this
 * replaces: open three, close the second, open another, and the count says two
 * while conversation three is still working — so both are handed
 * `conversation-3`, the same branch and the same folder, and two agents write
 * one checkout.
 *
 * `made` only ever goes up. Anything already on disk from an earlier sitting is
 * stepped over rather than reused, because what is in it was somebody's work.
 * Pure: the caller says what exists, so this can be checked without a disk.
 */
export function nextCheckoutName(
  made: number,
  taken: (name: string) => boolean,
  now: number = Date.now(),
): { name: string; made: number } {
  let at = made;
  for (let tries = 0; tries < ENOUGH; tries += 1) {
    at += 1;
    const name = `conversation-${String(at)}`;
    if (!taken(name)) return { name, made: at };
  }
  // Two hundred in use is not a real project. The moment cannot collide with a
  // count, so this can never loop and never hands back a name in use.
  return { name: `conversation-${now.toString(36)}`, made: at };
}

/* -------------------------------------------------------------------------- */
/* Renaming one after what it turned out to be about                           */
/* -------------------------------------------------------------------------- */

/** Every branch this repository already has, for `freeName` to fall back on. */
export async function branchNames(run: RunGit, repo: string): Promise<Set<string>> {
  const listed = await run(['for-each-ref', '--format=%(refname:short)', 'refs/heads'], {
    cwd: repo,
  });
  if (listed.code !== 0 || listed.out === undefined) return new Set();
  return new Set(
    listed.out
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== ''),
  );
}

/**
 * Rename the branch a conversation's checkout is on.
 *
 * Run inside that checkout, where the branch is the current one, so git can
 * only ever be renaming a branch nothing else has out. Refused when the folder
 * is not on `from` any more, or when the branch tracks a copy elsewhere — a
 * name somebody else can already fetch has stopped being ours to change.
 */
export async function renameCheckoutBranch(
  run: RunGit,
  folder: string,
  from: string,
  to: string,
): Promise<boolean> {
  const on = await branchAt(run, folder);
  if (on !== from) return false;

  // Both, because either alone misses a case: `%(upstream)` is empty until a
  // fetch refspec maps the remote, and the config is empty on a branch that
  // was pushed without being set to track.
  const tracks = await run(['for-each-ref', '--format=%(upstream)', `refs/heads/${from}`], {
    cwd: folder,
  });
  if (tracks.code !== 0 || (tracks.out ?? '').trim() !== '') return false;
  const configured = await run(['config', '--get', `branch.${from}.remote`], { cwd: folder });
  if (configured.code === 0 && (configured.out ?? '').trim() !== '') return false;

  return (await run(['branch', '-m', to], { cwd: folder })).code === 0;
}
