import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { createWorktree, type RunGit } from '../src/history/worktree';
import { writeAtomically } from '../src/lib/atomic';
import { keepOutOfCommits } from './excludes';
import { canonical } from './services/workspace-registry';

const execFileAsync = promisify(execFile);

/**
 * Prepare an isolated worktree for a pull request — fetch and checkout.
 *
 * The checkout is keyed by the pull request and the commit it was fetched at.
 * A review therefore reads exactly the head it asked for, and a head that moved
 * makes a second snapshot instead of taking the folder somebody is already
 * reading: another review on disk is not ours to move, and its worktree is what
 * a conversation is rooted in.
 *
 * The worktree is left on disk so the review can read files from there rather
 * than from the folder the person happens to have open.
 *
 * Used for PR review isolation (#12): the folder may be on any branch and
 * reading files from it would be reviewing the wrong code.
 */
async function gitRun(
  cwd: string,
  args: string[],
): Promise<{ code: number; out?: string; said?: string }> {
  try {
    const made = await execFileAsync('git', args, { cwd, encoding: 'utf8' });
    return { code: 0, out: made.stdout };
  } catch (cause) {
    const failed = cause as { code?: number; stdout?: string; stderr?: string; message?: string };
    return {
      code: typeof failed.code === 'number' ? failed.code : 1,
      out: failed.stdout ?? '',
      said: (failed.stderr ?? failed.message ?? '').trim(),
    };
  }
}

function gitRunHereFor(): RunGit {
  return (args, options) => gitRun(options.cwd, args);
}

/** What git said, kept for the details behind the message rather than the
 *  message itself. */
function because(what: string, said?: string): Error {
  const detail = (said ?? '').trim();
  return detail === '' ? new Error(what) : new Error(what, { cause: new Error(detail) });
}

/** Why a checkout could not be prepared. Stable, so a caller can act on the
 *  reason while the sentence beside it stays readable. */
export type PrCheckoutProblem = 'invalid' | 'fetch' | 'collision' | 'in-use' | 'partial';

export type PrCheckoutRefusal = Error & { problem: PrCheckoutProblem };

/** A refusal: the sentence for a person, the reason for whoever asked. */
function refusing(problem: PrCheckoutProblem, what: string, said?: string): PrCheckoutRefusal {
  return Object.assign(because(what, said), { problem });
}

/** The reason a refusal carries, or null when this was something else. */
export function problemOf(cause: unknown): PrCheckoutProblem | null {
  const held = (cause as { problem?: unknown } | null)?.problem;
  return typeof held === 'string' ? (held as PrCheckoutProblem) : null;
}

/** The line that keeps the checkouts out of the person's next commit. */
export const EXCLUDE_LINE = '.graphe/';

/**
 * Keep the checkouts out of the person's next commit.
 *
 * `git add -A` stages a worktree folder as an embedded repository, so without
 * this a review checkout lands in somebody's commit.
 */
export function keepCheckoutsOutOfCommits(project: string): Promise<boolean> {
  return keepOutOfCommits(project, [EXCLUDE_LINE]);
}

/* -------------------------------------------------------------------------- */
/* One snapshot per pull request head                                          */
/* -------------------------------------------------------------------------- */

/** How much of a commit is enough to name a checkout by. */
const SHORT = 12;

/** A commit as git writes one. Anything else is not a head we fetched. */
const FULL_SHA = /^[0-9a-f]{40,64}$/;

export type PrSnapshot = {
  /** The folder name, which is the branch name without its prefix. */
  leaf: string;
  folder: string;
  branch: string;
};

/**
 * Where one head of one pull request is reviewed.
 *
 * The head is part of both names. A branch named only after the pull request
 * would have to be moved to review a new head, and moving it is what took the
 * checkout away from a review that was being read.
 */
export function prSnapshot(project: string, prNumber: number, sha: string): PrSnapshot {
  const leaf = `pr-${String(prNumber)}-${sha.slice(0, SHORT)}`;
  return { leaf, folder: join(project, '.graphe', 'worktrees', leaf), branch: `graphe/${leaf}` };
}

/* -------------------------------------------------------------------------- */
/* What git says, read rather than remembered                                  */
/* -------------------------------------------------------------------------- */

type Registration = {
  /** The path git resolved when the checkout was made. */
  folder: string;
  head: string | null;
  branch: string | null;
  locked: boolean;
};

/** Every checkout git knows for this repository, by resolved folder. Reading
 *  git's own list is what makes verification a fact rather than a note. */
async function registrations(run: RunGit, project: string): Promise<Map<string, Registration>> {
  const { code, out } = await run(['worktree', 'list', '--porcelain'], { cwd: project });
  const found = new Map<string, Registration>();
  if (code !== 0 || out === undefined) return found;
  for (const block of out.split(/\n(?=worktree )/)) {
    let folder: string | null = null;
    let head: string | null = null;
    let branch: string | null = null;
    let locked = false;
    for (const line of block.split('\n')) {
      if (line.startsWith('worktree ')) folder = line.slice('worktree '.length).trim();
      else if (line.startsWith('HEAD ')) head = line.slice('HEAD '.length).trim();
      else if (line.startsWith('branch ')) {
        branch = line.slice('branch '.length).trim().replace(/^refs\/heads\//, '');
      } else if (line.startsWith('locked')) locked = true;
    }
    if (folder !== null) found.set(canonical(folder), { folder, head, branch, locked });
  }
  return found;
}

/** Whether a checkout holds nothing but the commit it is at. A folder git
 *  cannot read is treated as holding work. */
async function cleanAt(run: RunGit, folder: string): Promise<boolean> {
  const { code, out } = await run(['status', '--porcelain'], { cwd: folder });
  if (code !== 0 || out === undefined) return false;
  return out.split('\n').every((line) => line.trim() === '');
}

/** What git calls this repository. The same answer from every checkout of it,
 *  which is what makes it an identity rather than a location. */
async function repoKeyOf(run: RunGit, project: string): Promise<string | null> {
  const absolute = await run(['rev-parse', '--path-format=absolute', '--git-common-dir'], {
    cwd: project,
  });
  const said = absolute.code === 0 ? (absolute.out ?? '').trim() : '';
  if (said !== '') return canonical(said);
  const relative = await run(['rev-parse', '--git-common-dir'], { cwd: project });
  const plain = (relative.out ?? '').trim();
  return plain === '' ? null : canonical(resolve(project, plain));
}

/* -------------------------------------------------------------------------- */
/* Which checkouts are ours, written down beside them                           */
/* -------------------------------------------------------------------------- */

type ManagedCheckout = {
  repoKey: string;
  pr: number;
  sha: string;
  branch: string;
  folder: string;
};

/** Beside the checkouts, under the roof the project already keeps out of its
 *  commits. This is what says a folder is ours; the folder itself cannot. */
const MANAGED_FILE = join('.graphe', 'pr-checkouts.json');

async function managedCheckouts(project: string): Promise<Record<string, ManagedCheckout>> {
  let text: string;
  try {
    text = await readFile(join(project, MANAGED_FILE), 'utf8');
  } catch {
    return {};
  }
  let held: unknown;
  try {
    held = JSON.parse(text);
  } catch {
    return {};
  }
  const rows = (held as { checkouts?: unknown } | null)?.checkouts;
  if (typeof rows !== 'object' || rows === null) return {};
  const kept: Record<string, ManagedCheckout> = {};
  for (const [folder, value] of Object.entries(rows as Record<string, unknown>)) {
    const one = value as Partial<ManagedCheckout> | null;
    if (one === null || typeof one !== 'object') continue;
    if (typeof one.repoKey !== 'string' || typeof one.branch !== 'string') continue;
    if (typeof one.folder !== 'string' || typeof one.sha !== 'string') continue;
    if (typeof one.pr !== 'number') continue;
    kept[folder] = {
      repoKey: one.repoKey,
      pr: one.pr,
      sha: one.sha,
      branch: one.branch,
      folder: one.folder,
    };
  }
  return kept;
}

/** Written down so a later answer about the folder is not a guess. Failure is
 *  not worth refusing a review over: it only means the folder cannot be taken
 *  away later without a person looking at it. */
async function noteManaged(project: string, checkout: ManagedCheckout): Promise<void> {
  const all = await managedCheckouts(project);
  all[checkout.folder] = checkout;
  await writeAtomically(join(project, MANAGED_FILE), JSON.stringify({ version: 1, checkouts: all }));
}

async function forgetManaged(project: string, folder: string): Promise<void> {
  const all = await managedCheckouts(project);
  if (all[folder] === undefined) return;
  delete all[folder];
  await writeAtomically(
    join(project, MANAGED_FILE),
    JSON.stringify({ version: 1, checkouts: all }),
  ).catch(() => undefined);
}

/* -------------------------------------------------------------------------- */
/* The fetch                                                                   */
/* -------------------------------------------------------------------------- */

/** Fetches this process has started, so two of them cannot share a ref. */
let fetches = 0;

/**
 * Fetch one pull request's head and read the commit back out of a ref that only
 * this call knows about.
 *
 * `FETCH_HEAD` is one file per repository and every fetch writes it, so a
 * commit resolved from it later is whichever fetch ran last rather than the one
 * this review asked for. The ref carries the pull request number and a token
 * unique to this call, so a concurrent fetch cannot land under it either.
 */
async function fetchPrHead(project: string, prNumber: number): Promise<string> {
  fetches += 1;
  const token = `${String(prNumber)}-${Date.now().toString(36)}-${String(fetches)}-${randomUUID().slice(0, 8)}`;
  const ref = `refs/graphe/pr-fetch/${token}`;
  const fetched = await gitRun(project, [
    'fetch',
    'origin',
    `+pull/${String(prNumber)}/head:${ref}`,
  ]);
  if (fetched.code !== 0) {
    // Pull requests are fetched the way GitHub publishes them, so a project
    // whose origin is somewhere else fails here and should hear that rather
    // than "could not fetch".
    throw refusing(
      'fetch',
      `I could not fetch pull request #${String(prNumber)} from origin. Either it does not exist, or this project's origin is not GitHub. Reviewing a pull request needs a GitHub remote.`,
      fetched.said,
    );
  }
  const resolved = await gitRun(project, ['rev-parse', '--verify', `${ref}^{commit}`]);
  const sha = (resolved.out ?? '').trim();
  // Read, and then gone: nothing else reads this ref, and the checkout names
  // the commit from here.
  await gitRun(project, ['update-ref', '-d', ref]);
  if (resolved.code !== 0 || !FULL_SHA.test(sha)) {
    throw refusing(
      'fetch',
      `I fetched pull request #${String(prNumber)} but could not tell which commit it is at.`,
      resolved.said,
    );
  }
  return sha;
}

/* -------------------------------------------------------------------------- */
/* What is left where it is                                                    */
/* -------------------------------------------------------------------------- */

/** A checkout of this pull request that was left alone, and why. */
export type LeftBehind = {
  folder: string;
  /** The commit it holds, or null when git could not say. */
  sha: string | null;
  /** `superseded` when it is another head of this pull request with nothing in
   *  it; `in-use` when it holds work, or something has hold of it. */
  because: 'superseded' | 'in-use';
};

/** Every other checkout of this pull request, named rather than touched. */
async function leftBehind(
  run: RunGit,
  known: Map<string, Registration>,
  prNumber: number,
  mine: string,
): Promise<LeftBehind[]> {
  const prefix = `graphe/pr-${String(prNumber)}`;
  const kept: LeftBehind[] = [];
  for (const [folder, one] of known) {
    if (folder === mine) continue;
    const branch = one.branch ?? '';
    // The bare name is the checkout reviews of this pull request used to live
    // in. Left alone like the rest: it is still what somebody's review reads.
    if (branch !== prefix && !branch.startsWith(`${prefix}-`)) continue;
    const empty = one.head !== null && (await cleanAt(run, folder));
    kept.push({ folder, sha: one.head, because: empty && !one.locked ? 'superseded' : 'in-use' });
  }
  return kept.sort((one, two) => one.folder.localeCompare(two.folder));
}

/* -------------------------------------------------------------------------- */
/* Taking one away                                                             */
/* -------------------------------------------------------------------------- */

export type Removal = { ok: true } | { ok: false; because: string; said?: string };

/**
 * Take one review snapshot away, when every fact about it still agrees.
 *
 * Only a checkout this helper made may go: the record beside the checkouts has
 * to name this exact folder, this repository, this pull request, this commit
 * and this branch, and git has to agree with all of it — registered here, on
 * that branch, at that commit, with nothing in it. Anything else and the folder
 * stays where it is, because a review somebody is reading is not something to
 * reclaim.
 *
 * The branch stays too. It is where the head is kept, and taking a folder away
 * is not a decision to lose it.
 */
export async function removePrCheckout(
  project: string,
  prNumber: number,
  sha: string,
): Promise<Removal> {
  const wanted = Number.isFinite(prNumber) && prNumber > 0 ? Math.floor(prNumber) : 0;
  if (wanted <= 0 || !FULL_SHA.test(sha)) {
    return { ok: false, because: 'That is not a review snapshot of this project.' };
  }
  const run = gitRunHereFor();
  const snapshot = prSnapshot(project, wanted, sha);
  // The name git would use for it: the part that exists is resolved, so a
  // project open through a symlink still matches git's own list.
  const exact = canonical(snapshot.folder);
  const record = (await managedCheckouts(project))[exact];
  if (record === undefined) {
    return {
      ok: false,
      because: `There is no record here that I made the checkout at ${exact}, so I left it alone.`,
    };
  }
  const repoKey = await repoKeyOf(run, project);
  const agrees =
    record.folder === exact &&
    record.pr === wanted &&
    record.sha === sha &&
    record.branch === snapshot.branch &&
    (repoKey === null || record.repoKey === repoKey);
  if (!agrees) {
    return {
      ok: false,
      because: `The checkout at ${exact} does not match what I wrote down when I made it, so I left it alone.`,
    };
  }
  const there = (await registrations(run, project)).get(exact);
  if (there === undefined) {
    // Nothing is at that path any more. The note is all that is left of it.
    await run(['worktree', 'prune'], { cwd: project });
    await forgetManaged(project, exact);
    return { ok: true };
  }
  if (there.locked) {
    return { ok: false, because: `Something has hold of the checkout at ${exact}, so I left it alone.` };
  }
  if (there.head !== sha || there.branch !== snapshot.branch) {
    return {
      ok: false,
      because: `The checkout at ${exact} is not the commit I made it for, so I left it alone.`,
    };
  }
  if (!(await cleanAt(run, exact))) {
    return { ok: false, because: `The checkout at ${exact} holds work, so I left it alone.` };
  }
  // No `--force`: a checkout that turned out to hold something between the
  // reading above and this line is refused rather than emptied.
  const removed = await gitRun(project, ['worktree', 'remove', exact]);
  if (removed.code !== 0) {
    return {
      ok: false,
      because: `I could not take the checkout at ${exact} away. It is still there, with the branch it is on.`,
      said: removed.said,
    };
  }
  await forgetManaged(project, exact);
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* Preparing one                                                               */
/* -------------------------------------------------------------------------- */

/** What preparing a review answers with. */
export type PrCheckout = {
  folder: string;
  branch: string;
  /** The commit the checkout is at, which is the head that was fetched. */
  sha: string;
  /** True when a checkout that was already there and verified was used. */
  reused: boolean;
  /** Other checkouts of this pull request, left where they are. */
  leftBehind: readonly LeftBehind[];
};

/**
 * Prepare a review checkout of one pull request head.
 *
 * A checkout is reused only when git and the folder itself say all of it: it is
 * registered here, on the branch this head is reviewed on, at exactly this
 * commit, and holding nothing. Anything else is refused with the reason, and
 * the folder is left where it is.
 */
export async function preparePrWorktree(
  project: string,
  prNumber: number,
): Promise<PrCheckout> {
  const wanted = Number.isFinite(prNumber) && prNumber > 0 ? Math.floor(prNumber) : 0;
  if (wanted <= 0) throw refusing('invalid', 'Invalid PR number');
  const run = gitRunHereFor();
  // Before the checkout exists, so there is never a moment where it could be
  // staged.
  await keepCheckoutsOutOfCommits(project);
  const sha = await fetchPrHead(project, wanted);
  const snapshot = prSnapshot(project, wanted, sha);
  // The name git would use for it: the part that exists is resolved, so a
  // project open through a symlink still matches git's own list.
  const exact = canonical(snapshot.folder);
  const known = await registrations(run, project);
  const mine = await leftBehind(run, known, wanted, exact);
  const there = known.get(exact);

  if (there !== undefined) {
    if (there.head !== sha) {
      throw refusing(
        'in-use',
        `A checkout of pull request #${String(wanted)} is already at ${exact}, at ${(there.head ?? 'an unknown commit').slice(0, SHORT)} rather than the head just fetched. I left it where it is.`,
      );
    }
    if (there.branch !== snapshot.branch) {
      throw refusing(
        'collision',
        `The checkout at ${exact} is on ${there.branch ?? 'no branch'}, not on ${snapshot.branch}, so it is not mine to reuse. I left it where it is.`,
      );
    }
    if (await cleanAt(run, exact)) {
      const repoKey = await repoKeyOf(run, project);
      if (repoKey !== null) {
        await noteManaged(project, {
          repoKey,
          pr: wanted,
          sha,
          branch: snapshot.branch,
          folder: exact,
        }).catch(() => undefined);
      }
      return { folder: snapshot.folder, branch: snapshot.branch, sha, reused: true, leftBehind: mine };
    }
    throw refusing(
      'in-use',
      `The checkout of pull request #${String(wanted)} at ${exact} has changes in it, so I left it alone rather than taking it over.`,
    );
  }

  if (await stat(exact).then(() => true, () => false)) {
    throw refusing(
      'collision',
      `Something is already at ${exact} and git does not have it as a checkout of this project, so I left it alone.`,
    );
  }

  // The branch this head is reviewed on, at exactly the commit that was
  // fetched. An existing branch is only this snapshot's own when it is already
  // there.
  const branchRef = `refs/heads/${snapshot.branch}`;
  const wasThere = await run(['rev-parse', '--verify', branchRef], { cwd: project });
  if (wasThere.code === 0) {
    const at = (wasThere.out ?? '').trim();
    if (at !== sha) {
      throw refusing(
        'collision',
        `The branch ${snapshot.branch} is already at ${at.slice(0, SHORT)} rather than the commit fetched for pull request #${String(wanted)}, so I left it alone.`,
        `refs/heads/${snapshot.branch} is at ${at}`,
      );
    }
  } else {
    const branched = await gitRun(project, ['branch', snapshot.branch, sha]);
    if (branched.code !== 0) {
      throw refusing(
        'collision',
        `I fetched pull request #${String(wanted)} but could not point a branch at it.`,
        branched.said,
      );
    }
  }

  // A registration whose folder is gone would refuse the checkout below, and
  // nothing in it is a checkout any more.
  await run(['worktree', 'prune'], { cwd: project });
  const made = await createWorktree(run, project, snapshot.leaf, { ref: sha }, { folder: snapshot.folder });
  if (!made.ok) {
    // No forced add and no forced branch move: the one thing that may be
    // replaced is a checkout that is plainly ours, empty, and at exactly this
    // commit. Anything else is reported instead, with the folder left alone.
    const replaced = await removePrCheckout(project, wanted, sha);
    if (!replaced.ok) {
      throw refusing(
        'partial',
        `I could not make the review checkout of pull request #${String(wanted)} at ${exact}. ${replaced.because}`,
        replaced.said,
      );
    }
    const retried = await createWorktree(run, project, snapshot.leaf, { ref: sha }, {
      folder: snapshot.folder,
    });
    if (!retried.ok) {
      throw refusing(
        'partial',
        `I could not make the review checkout of pull request #${String(wanted)} at ${exact}. Nothing is there now; the branch it would have been on is still here.`,
        retried.because,
      );
    }
  }
  const repoKey = await repoKeyOf(run, project);
  if (repoKey !== null) {
    await noteManaged(project, {
      repoKey,
      pr: wanted,
      sha,
      branch: snapshot.branch,
      folder: exact,
    }).catch(() => undefined);
  }
  return { folder: snapshot.folder, branch: snapshot.branch, sha, reused: false, leftBehind: mine };
}
