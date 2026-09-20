/** What a checkout is given beyond what git carries, and the install it still
 *  needs.
 *
 * Two answers, and they are not the same answer. Which of a project's ignored
 * files travel into a new checkout is the person's, remembered per folder:
 * carrying every `.env*` on our own authority put a second copy of somebody's
 * keys on disk, in a folder they had not looked at. Whether the dependencies
 * are installed is a step of its own with a state of its own, because a checkout
 * that was made says nothing about whether it can run.
 *
 * Decisions only. Nothing here touches a disk or starts a program — the store
 * this is read from and the command it is turned into both live in
 * `src/history/seeding.ts` — because the window reads this file too, and the
 * rest of that side opens folders and writes files.
 */

/** Project folder → the gitignored files it carries into every new checkout. */
export type SetupFiles = Readonly<Record<string, readonly string[]>>;

/** Whether a path names something inside the folder it is relative to. Git
 *  never emits anything else, but a path that climbs out of a checkout is not
 *  one to copy on trust — nor one to take out of a file somebody has edited. */
export function staysInside(path: string): boolean {
  if (path === '' || path.startsWith('/') || /^[A-Za-z]:/.test(path)) return false;
  return !path.split('/').includes('..');
}

/** The paths a stored list holds, with everything that cannot be a path in this
 *  project dropped: these end up in a filesystem call, and a blank, an absolute
 *  path or a climb out of the folder is not a file the project has. */
function pathsIn(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  const kept = value.filter((one): one is string => typeof one === 'string' && staysInside(one));
  return [...new Set(kept)].sort();
}

/** Read off a file somebody could have edited by hand. Anything that is not a
 *  list of paths under a folder name is dropped rather than refused — and
 *  dropping errs the safe way, since a choice nobody can read carries nothing
 *  and a lost choice only asks the question again. */
export function asSetupFiles(value: unknown): SetupFiles {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const store: Record<string, readonly string[]> = {};
  for (const [project, paths] of Object.entries(value as Record<string, unknown>)) {
    const kept = pathsIn(paths);
    if (project !== '' && kept.length > 0) store[project] = kept;
  }
  return store;
}

/** What this project carries. Absent is nothing: the answer is a person's, and
 *  nobody has given it yet. */
export function setupFilesIn(store: SetupFiles, project: string): readonly string[] {
  return project === '' ? [] : (store[project] ?? []);
}

/** The store after somebody said what this project carries — the whole list at
 *  once, because the flow is a set of ticks rather than a sequence of edits.
 *  A project with nothing ticked leaves no entry behind, so a folder nobody has
 *  decided anything about costs nothing however many folders are opened. */
export function choosingSetupFiles(
  store: SetupFiles,
  project: string,
  files: readonly string[],
): SetupFiles {
  if (project === '') return store;
  const kept = pathsIn(files);
  const next: Record<string, readonly string[]> = { ...store };
  if (kept.length === 0) delete next[project];
  else next[project] = kept;
  return next;
}

/** True when two stores say the same thing, so nothing is written for a set of
 *  ticks that says what the file already says. */
export function sameSetupFiles(one: SetupFiles, other: SetupFiles): boolean {
  const projects = Object.keys(one);
  if (projects.length !== Object.keys(other).length) return false;
  return projects.every((project) => {
    const mine = one[project] ?? [];
    const theirs = other[project] ?? [];
    return mine.length === theirs.length && mine.every((path, at) => path === theirs[at]);
  });
}

/** A file a project could carry into a checkout, and whether it already does. */
export type SetupCandidate = { path: string; chosen: boolean };

/** A template rather than a credential, and the one file here a project usually
 *  tracks: carrying it again would put a copy in the checkout that drifts from
 *  the project's own. Offered only where somebody has already chosen it. */
const ENV_SAMPLE = '.env.example';

/**
 * What the flow offers, from git's own listing of everything the project
 * ignores.
 *
 * Folders are left out: a checkout is given files, not a second copy of
 * somebody's `node_modules`, and a pattern that names one is the checkout's
 * install to run. Chosen files come first, because that is what somebody opened
 * this to look at.
 */
export function setupCandidates(
  ignored: readonly string[],
  chosen: readonly string[] = [],
): readonly SetupCandidate[] {
  const picked = new Set(chosen);
  const rows: SetupCandidate[] = [];
  const seen = new Set<string>();
  for (const one of ignored) {
    if (one.endsWith('/') || seen.has(one)) continue;
    seen.add(one);
    const name = one.slice(one.lastIndexOf('/') + 1);
    if (name === ENV_SAMPLE && !picked.has(one)) continue;
    rows.push({ path: one, chosen: picked.has(one) });
  }
  return rows.sort(
    (one, other) =>
      Number(other.chosen) - Number(one.chosen) || (one.path < other.path ? -1 : 1),
  );
}

/** What installing this project's dependencies runs. */
export type InstallPlan = {
  /** Who is doing the installing, for what the person is told. */
  manager: string;
  command: string;
  args: readonly string[];
};

/** A lockfile says which manager wrote it, and only that manager reads it the
 *  way the project meant. Ordered, so a repository carrying two of them — a
 *  migration nobody finished — still gets one answer rather than whichever the
 *  directory happened to list. */
const MANAGERS: ReadonlyArray<{ manager: string; command: string; lockfiles: readonly string[] }> =
  [
    { manager: 'pnpm', command: 'pnpm', lockfiles: ['pnpm-lock.yaml'] },
    { manager: 'yarn', command: 'yarn', lockfiles: ['yarn.lock'] },
    { manager: 'bun', command: 'bun', lockfiles: ['bun.lockb', 'bun.lock'] },
  ];

const INSTALL: readonly string[] = ['install'];

/**
 * What a checkout needs installed, read off the files at its root.
 *
 * Null when there is nothing to install from: a project with no manifest needs
 * no step at all, and inventing one would put a button under a folder that has
 * no answer to give it.
 */
export function installPlanFor(present: readonly string[]): InstallPlan | null {
  const there = new Set(present);
  const wrote = MANAGERS.find((one) => one.lockfiles.some((lock) => there.has(lock)));
  if (wrote !== undefined) {
    return { manager: wrote.manager, command: wrote.command, args: INSTALL };
  }
  return there.has('package.json')
    ? { manager: 'npm', command: 'npm', args: INSTALL }
    : null;
}

/**
 * How far the install in one checkout has got.
 *
 * `not-started` is where every checkout begins, and it is not a way of saying
 * "fine": a checkout that was created has no dependencies in it, and a caller
 * that reported the creation as the whole of setting up would be reporting a
 * folder whose first command fails.
 */
export type Dependencies =
  | { how: 'not-started' }
  | { how: 'running' }
  | { how: 'failed'; because: string }
  | { how: 'done' };

/** Where a checkout that has just been made stands. Named, so the side that
 *  reports a creation has something to report that is not "done". */
export const dependenciesNotStarted: Dependencies = { how: 'not-started' };

export const setupWords = {
  /** Where the step stands, in the row somebody is looking at. */
  dependencies: (state: Dependencies): string => {
    switch (state.how) {
      case 'not-started':
        return 'Dependencies are not installed in this checkout yet.';
      case 'running':
        return 'Installing dependencies…';
      case 'failed':
        return `Dependencies are not installed: ${state.because}`;
      case 'done':
        return 'Dependencies are installed.';
    }
  },
} as const;
