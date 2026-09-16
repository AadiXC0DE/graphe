/** What a checkout needs to run, which git will not carry.
 *
 * `git worktree add` writes tracked files and nothing else, so the second
 * conversation in a project opens on a checkout with no `.env.local` in it. The
 * dev server starts and then falls over at the first request, or refuses
 * sign-in, and the reason is a file that is not there.
 *
 * Which files travel is a person's answer, remembered per folder — nothing is
 * carried until somebody says so. Carrying every gitignored `.env*` on our own
 * authority put a second copy of somebody's keys on disk, in a folder they had
 * not looked at. A project can also say it in a `.worktreeinclude` at its root:
 * `.gitignore` syntax, and a pattern only carries a file that is *also*
 * gitignored, so nothing tracked is ever duplicated. Claude Code reads the same
 * file under the same name, and a developer moving between the two should not
 * have to learn ours.
 *
 * Dependencies are the other half of what a checkout is missing, and they are a
 * step of their own rather than part of this one: a checkout that was made says
 * nothing about whether it can run, and an install is minutes of somebody
 * else's network. See `installDependencies`.
 */

import { chmod, copyFile, lstat, mkdir, open, readdir, readFile, realpath, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

import { writeAtomically } from '../lib/atomic';
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
  type Dependencies,
  type InstallPlan,
  type SetupCandidate,
  type SetupFiles,
} from '../projects/setup';
import type { RunGit } from './worktree';

export const WORKTREE_INCLUDE = '.worktreeinclude';

/** Why a file the project names for a checkout is not in it. */
export type NotCopied =
  /** A path that climbs out of the project, or a link resolving out of either
   *  the project it came from or the checkout it was going into. */
  | 'leaves-the-project'
  /** More of it than one checkout is worth seeding with. */
  | 'past-the-ceiling'
  /** A link, a folder, a socket: a checkout is given plain files. */
  | 'not-a-regular-file'
  /** Gone, unreadable, or the copy itself failed. */
  | 'could-not-be-copied';

/** A file that was named for a checkout and did not arrive. */
export type Omitted = { path: string; because: NotCopied };

/** What one checkout is worth seeding with. Past these, carrying files into a
 *  checkout stops being a small kindness and starts being an install done the
 *  slow way. A caller may bring its own, so the ceiling can be reached in a test
 *  without writing two thousand files. */
export type CarryLimits = { files: number; bytes: number };
export const CARRY_LIMITS: CarryLimits = { files: 2_000, bytes: 64 * 1024 * 1024 };

/** What a checkout was given, and what it was not. */
export type Seeded = {
  /** Paths now in the checkout, relative to the project, that git left behind. */
  carried: readonly string[];
  /** Named for this checkout and not copied, with the reason. Said rather than
   *  swallowed: a missing `.env.local` is the file whose absence makes the dev
   *  server refuse to start, and silence about it reads as "it is there". */
  omitted: readonly Omitted[];
};

const nothing: Seeded = { carried: [], omitted: [] };

/** Why each missing file is missing, in the words a person reads rather than
 *  the words the code uses. */
const LEFT_OUT: Record<NotCopied, string> = {
  'leaves-the-project': 'it points outside the project',
  'past-the-ceiling': 'there was more of it than one checkout is worth seeding with',
  'not-a-regular-file': 'it is not a plain file',
  'could-not-be-copied': 'it could not be read, or written into the checkout',
};

export const seedWords = {
  /** Said once, in the conversation that got the checkout. Copying a `.env` is
   *  a second place someone's keys live, and nobody should have to read a diff
   *  to find that out. */
  carried: (files: readonly string[], from: string): string => {
    const named = [...files].sort().join(', ');
    const many = files.length !== 1;
    return `This conversation works in its own checkout of the project, and a checkout carries tracked files only. I copied ${named} into it from ${from}, so ${many ? 'those files' : 'that file'} now ${many ? 'exist' : 'exists'} in two places. Nothing in your own folder was touched.`;
  },
  /** Said in the same breath as `carried`, when something the project names is
   *  not in the checkout after all. */
  leftOut: (omitted: readonly Omitted[], from: string): string | null => {
    if (omitted.length === 0) return null;
    const named = [...new Set(omitted.map((one) => one.path))].sort().join(', ');
    const why = [...new Set(omitted.map((one) => one.because))]
      .map((one) => LEFT_OUT[one])
      .join('; ');
    return `I did not carry ${named} from ${from} into this checkout: ${why}.`;
  },
  /** What the agent is told when it starts. `npm run dev` answering `command
   *  not found` is a poor way to learn there is no install here. */
  told: (
    carried: readonly string[],
    dependencies: Dependencies = dependenciesNotStarted,
  ): string => {
    const has =
      carried.length === 0
        ? 'nothing that the project gitignores'
        : `the gitignored files carried over for it: ${[...carried].sort().join(', ')}`;
    return [
      `This conversation works in its own git checkout of the project, made with \`git worktree add\`. It holds the tracked files and ${has}.`,
      setupWords.dependencies(dependencies),
      `A \`${WORKTREE_INCLUDE}\` at the project root, in \`.gitignore\` syntax, names any other gitignored file to carry into every checkout, and somebody can choose others for this project when a checkout is made. A gitignored file that is not in the checkout is one nobody chose. Say so if the person asks why something is missing.`,
    ].join(' ');
  },
} as const;

/**
 * Give a checkout what this project's own choices say it carries.
 *
 * The choices are a person's, made in the New worktree flow and kept per
 * project; nothing is carried because a file happens to exist. Read here rather
 * than handed in, so every checkout of a project is seeded the same way.
 */
export async function seedFromChoices(
  run: RunGit,
  repo: string,
  folder: string,
  userData: string,
  limits: CarryLimits = CARRY_LIMITS,
): Promise<Seeded> {
  const chosen = setupFilesIn(await readSetupChoices(userData), repo);
  return chosen.length === 0 ? nothing : seedCheckout(run, repo, folder, chosen, limits);
}

/**
 * What a seeded checkout has to say for itself: what came with it, and what the
 * project named that did not arrive. Both are said, because a `.env.local` that
 * is silently missing is the file whose absence makes the dev server refuse to
 * start.
 */
export function seedingNotes(seeded: Seeded, from: string): readonly string[] {
  const came = seeded.carried.length === 0 ? null : seedWords.carried(seeded.carried, from);
  const left = seedWords.leftOut(seeded.omitted, from);
  return [came, left].filter((one): one is string => one !== null);
}

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

/** Whether a resolved path sits inside a resolved root. Both are resolved, so a
 *  link is not a reason to treat somebody else's folder as part of this one. */
function inside(root: string, at: string): boolean {
  return at === root || at.startsWith(`${root}${sep}`);
}

/** Why the folders this path needs cannot be written through, or null when they
 *  can. A recursive `mkdir` through a link writes outside the checkout, and a
 *  file where a folder should be means the copy cannot be made at all. */
async function blockedBelow(folder: string, path: string): Promise<NotCopied | null> {
  let so = folder;
  for (const part of path.split('/').slice(0, -1)) {
    so = join(so, part);
    const about = await lstat(so).catch(() => null);
    // Nothing here yet: `mkdir` makes it under a folder that has been checked.
    if (about === null) return null;
    if (about.isSymbolicLink()) return 'leaves-the-project';
    if (!about.isDirectory()) return 'could-not-be-copied';
  }
  return null;
}

async function carry(
  repo: string,
  folder: string,
  paths: readonly string[],
  limits: CarryLimits,
): Promise<Seeded> {
  const carried: string[] = [];
  const omitted: Omitted[] = [];
  const project = await realpath(repo).catch(() => resolve(repo));
  const checkout = await realpath(folder).catch(() => resolve(folder));
  let bytes = 0;

  for (const one of paths) {
    const leftOut = (because: NotCopied): void => {
      omitted.push({ path: one, because });
    };
    if (!staysInside(one)) {
      leftOut('leaves-the-project');
      continue;
    }
    if (carried.length >= limits.files || bytes >= limits.bytes) {
      leftOut('past-the-ceiling');
      continue;
    }
    const from = join(repo, one);
    const about = await lstat(from).catch(() => null);
    if (about === null) {
      leftOut('could-not-be-copied');
      continue;
    }
    if (!about.isFile()) {
      /* A link is resolved to answer where it really points, so one that leaves
         the project is refused for the reason it deserves rather than lumped in
         with a folder or a socket. Neither is copied: a checkout is given plain
         files, and a link is not a copy of the project's own bytes. */
      const real = about.isSymbolicLink() ? await realpath(from).catch(() => null) : null;
      leftOut(real !== null && !inside(project, real) ? 'leaves-the-project' : 'not-a-regular-file');
      continue;
    }
    // The file itself may be plain while a folder above it is a link, and then
    // these bytes are somebody else's folder's rather than this project's.
    const real = await realpath(from).catch(() => null);
    if (real === null) {
      leftOut('could-not-be-copied');
      continue;
    }
    if (!inside(project, real)) {
      leftOut('leaves-the-project');
      continue;
    }
    const blocked = await blockedBelow(checkout, one);
    if (blocked !== null) {
      leftOut(blocked);
      continue;
    }
    const to = join(checkout, one);
    try {
      await mkdir(dirname(to), { recursive: true });
      /* Made at the mode it keeps rather than narrowed afterwards: these are the
         files a project keeps its credentials in, and a copy that is briefly
         readable by everybody has been readable by everybody. `wx` is also the
         answer to a file already there — a checkout spread out again, or one the
         agent has since edited — because that copy is not ours to replace. */
      const made = await open(to, 'wx', 0o600);
      await made.close();
      await copyFile(from, to);
      await chmod(to, 0o600);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'EEXIST') continue;
      // Half a credential file is worse than none of it.
      await rm(to, { force: true }).catch(() => undefined);
      leftOut('could-not-be-copied');
      continue;
    }
    carried.push(one);
    bytes += about.size;
  }
  return { carried, omitted };
}

/**
 * Give a checkout what the project needs to run.
 *
 * `chosen` is what the person said this project carries — read from the store
 * through `setupFilesIn` — and nothing is carried by default. Never throws and
 * never argues: a checkout that could not be seeded still opens, and the agent
 * installs and asks. Safe to call again — a file already in the checkout is left
 * exactly as it is.
 */
export async function seedCheckout(
  run: RunGit,
  repo: string,
  folder: string,
  chosen: readonly string[] = [],
  limits: CarryLimits = CARRY_LIMITS,
): Promise<Seeded> {
  try {
    const ignored = await ignoredEntries(run, repo);
    const asked = await askedFor(run, repo);
    const ignoredHere = ignoredBy(ignored);
    /* The project's own declaration and the person's choices, both: one is what
       the repository says every checkout needs, and the other is what somebody
       decided in front of this project. Only gitignored paths are carried, so
       nothing tracked is ever copied a second time. */
    const wanted = [
      ...(asked === null ? [] : asked.filter(ignoredHere)),
      ...chosen.filter(ignoredHere),
    ];
    const seeded = await carry(repo, folder, [...new Set(wanted)], limits);
    if (seeded.carried.length > 0) await noteSeeded(run, folder, seeded.carried);
    return seeded;
  } catch {
    return nothing;
  }
}

/** The gitignored files this project could carry, with the ones already chosen
 *  marked: what the flow offers before there is a checkout to seed. */
export async function seedingCandidates(
  run: RunGit,
  repo: string,
  chosen: readonly string[] = [],
): Promise<readonly SetupCandidate[]> {
  return setupCandidates(await ignoredEntries(run, repo), chosen);
}

/* -------------------------------------------------------------------------- */
/* Installing what the checkout needs                                          */
/* -------------------------------------------------------------------------- */

/** When an install is given up on. Long, because its length is somebody else's
 *  dependency tree; finite, because a wedged one must not hold a checkout
 *  hostage for the rest of the afternoon. */
const INSTALL_PATIENCE = 20 * 60_000;

/** How much of what a failed command said is worth showing. The last line names
 *  the cause; the beginning is a progress bar. */
const WHY_LONG = 300;

/** What running one command came back as: the shape `runHelper` already has, so
 *  the shell hands that in and nothing here knows how a program is started. */
export type RunCommand = (
  command: string,
  args: readonly string[],
  options: { folder: string; patience?: number },
) => Promise<{ code: number; said: string }>;

/** What this checkout's own files say it needs installed, or null when there is
 *  nothing to install from. Read at the root, which is where a manifest lives. */
export async function installPlanAt(folder: string): Promise<InstallPlan | null> {
  const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);
  return installPlanFor(entries.map((one) => one.name));
}

/** What must not travel further out of a command's own words: npm quotes the
 *  registry config it was using when one refuses it, and that config is where
 *  the token lives. */
function withoutCredentials(said: string): string {
  return said
    .replace(/\b(_authToken|_auth|_password|password|token|secret)=(\S+)/gi, '$1=…')
    .replace(/\b(Bearer)\s+\S+/gi, '$1 …');
}

/** Why an install failed, in one line somebody can act on. */
function installFailure(command: string, code: number, said: string): string {
  const lines = withoutCredentials(said)
    .split('\n')
    .map((one) => one.trim())
    .filter((one) => one !== '');
  const last = lines[lines.length - 1] ?? '';
  if (last !== '') return last.slice(-WHY_LONG);
  // 127 is the shell's own code for a program that is not on this computer.
  return code === 127
    ? `${command} is not on this computer`
    : `${command} stopped with ${String(code)}`;
}

/**
 * Install what the checkout needs, as the step of its own that it is.
 *
 * Not a part of making a checkout: it takes minutes, it fails for reasons that
 * have nothing to do with git, and what it leaves behind is an install rather
 * than a copy. The command is handed in, so this is answerable in a test with no
 * npm on the machine, and every state is reported as it happens rather than only
 * at the end.
 */
export async function installDependencies(
  run: RunCommand,
  folder: string,
  plan: InstallPlan,
  report?: (state: Dependencies) => void,
): Promise<Dependencies> {
  report?.({ how: 'running' });
  const ran = await run(plan.command, plan.args, { folder, patience: INSTALL_PATIENCE }).catch(
    (cause: unknown) => ({
      code: 1,
      said: cause instanceof Error ? cause.message : String(cause),
    }),
  );
  const state: Dependencies =
    ran.code === 0
      ? { how: 'done' }
      : { how: 'failed', because: installFailure(plan.command, ran.code, ran.said) };
  report?.(state);
  return state;
}

/* -------------------------------------------------------------------------- */
/* What each project carries                                                   */
/* -------------------------------------------------------------------------- */

/** One small file beside the rest of what this app keeps about a person: keyed
 *  by folder, read whole and written whole, and never a source of errors. */
export function setupChoicesFile(userData: string): string {
  return join(userData, 'setup.json');
}

/** Read back through the same parse the window uses, so a file somebody edited
 *  cannot be strict enough for the shell and too loose for the screen. A file
 *  that cannot be read is no choices, which is the answer from before anybody
 *  made one. */
export async function readSetupChoices(userData: string): Promise<SetupFiles> {
  try {
    return asSetupFiles(JSON.parse(await readFile(setupChoicesFile(userData), 'utf8')) as unknown);
  } catch {
    return {};
  }
}

/** What this project now carries, written down, and the whole store back so the
 *  caller has what it is about to show. Nothing is written for a set of ticks
 *  that says what the file already says; a choice that cannot be written is the
 *  one failure here, and saying so is the caller's job rather than ours to
 *  swallow. */
export async function chooseSetupFiles(
  userData: string,
  project: string,
  files: readonly string[],
): Promise<SetupFiles> {
  const was = await readSetupChoices(userData);
  const next = choosingSetupFiles(was, project, files);
  if (sameSetupFiles(was, next)) return was;
  await writeAtomically(setupChoicesFile(userData), `${JSON.stringify(next, null, 2)}\n`);
  return next;
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
