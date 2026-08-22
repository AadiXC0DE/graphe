/** What a fresh copy of a project needs before work can actually run in it.
 *
 * A copy is made out of the history, so it holds exactly what the history keeps
 * — and the two most important things for running the project are deliberately
 * not in there. The keys in `.env` are private, and the pieces under
 * `node_modules` are rebuilt rather than saved. A copy without them looks
 * complete and fails on the first command, which is the worst kind of broken.
 *
 * Two different answers, because they are two different problems:
 *
 * - **Small private files are carried across.** They are tiny, they exist
 *   nowhere else, and without them nothing the project talks to will answer.
 *   Which files is the project's own business, so a project can say — a list in
 *   `.carryover`, one name a line. Nearly nobody will write one, so the answer
 *   with no list present is the one that has to be right.
 * - **Installed pieces are put back by installing them again.** Sharing one
 *   folder of them between copies is the thing that breaks: the built pieces in
 *   there are compiled against one machine and one place on disk, the shortcuts
 *   in `.bin` point at absolute paths, and two copies running at once write over
 *   each other's caches. It costs a minute per copy and it works.
 *
 * Nothing here follows a shortcut. A link inside the project can point anywhere
 * on the disk, and copying through one is how a private file from somewhere else
 * ends up inside a copy somebody later shares.
 */

import { constants } from 'node:fs';
import { access, copyFile, lstat, mkdir, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { helperFor } from '../preview/detect';
import { runHelper } from '../share/run';
import { oneAtATime } from '../work/machine';

/** Where a project says which private files its copies need. */
export const CARRY_LIST = '.carryover';

/** With no list of its own, this is what a copy gets. Keys first, because a
 *  project that cannot reach its own data is a project nobody can work on. */
export const CARRIED_BY_DEFAULT: readonly string[] = [
  '.env',
  '.env.*',
  '.npmrc',
  '.nvmrc',
  '.tool-versions',
  '.dev.vars',
];

/** Never carried, whatever a list says. The first two are rebuilt or shared;
 *  the last is the record that makes this a copy at all. */
const NEVER_CARRY = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.cache']);

/** A private file is a few kilobytes. Anything of size is something else. */
const BIGGEST = 4 * 1024 * 1024;
const MOST_FILES = 200;
const DEEPEST = 6;

/** One name a line, `#` for a note. Anything reaching outside the project is
 *  dropped rather than argued with — a list is not a way out of the folder. */
export function readCarryList(text: string): string[] {
  const wanted: string[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.split('#')[0]?.trim() ?? '';
    if (line === '') continue;
    const clean = line.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
    if (clean === '' || path.posix.isAbsolute(clean) || /^[A-Za-z]:/.test(clean)) continue;
    if (clean.split('/').some((segment) => segment === '..' || segment === '')) continue;
    if (!wanted.includes(clean)) wanted.push(clean);
  }
  return wanted;
}

/** What this project wants carried into a copy of it. */
export async function whatToCarry(from: string): Promise<string[]> {
  try {
    const list = await readFile(path.join(from, CARRY_LIST), 'utf8');
    const wanted = readCarryList(list);
    if (wanted.length > 0) return wanted;
  } catch {
    // No list, or one we could not read. The default is the answer either way.
  }
  return [...CARRIED_BY_DEFAULT];
}

async function isThere(target: string): Promise<boolean> {
  try {
    await access(target, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/** `*` and `?` within one name. Deliberately not a whole pattern language:
 *  people write `.env.*` and stop there. */
function nameMatcher(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped.replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]')}$`);
}

async function filesUnder(from: string, folder: string, depth: number): Promise<string[]> {
  if (depth > DEEPEST) return [];
  let entries: string[] = [];
  try {
    entries = await readdir(path.join(from, folder));
  } catch {
    return [];
  }
  const found: string[] = [];
  for (const entry of entries) {
    if (NEVER_CARRY.has(entry)) continue;
    const relative = path.posix.join(folder, entry);
    const info = await lstat(path.join(from, relative)).catch(() => null);
    if (info === null || info.isSymbolicLink()) continue;
    if (info.isDirectory()) found.push(...(await filesUnder(from, relative, depth + 1)));
    else if (info.isFile()) found.push(relative);
  }
  return found;
}

/** Everything one entry names, as paths relative to the project. */
async function matching(from: string, entry: string): Promise<string[]> {
  const parts = entry.split('/');
  const last = parts[parts.length - 1] ?? '';
  const parent = parts.slice(0, -1).join('/');

  if (!last.includes('*') && !last.includes('?')) {
    const info = await lstat(path.join(from, entry)).catch(() => null);
    if (info === null || info.isSymbolicLink()) return [];
    if (info.isDirectory()) return filesUnder(from, entry, 1);
    return info.isFile() ? [entry] : [];
  }

  let entries: string[] = [];
  try {
    entries = await readdir(path.join(from, parent === '' ? '.' : parent));
  } catch {
    return [];
  }
  const matcher = nameMatcher(last);
  const found: string[] = [];
  for (const name of entries) {
    if (!matcher.test(name) || NEVER_CARRY.has(name)) continue;
    const relative = parent === '' ? name : path.posix.join(parent, name);
    const info = await lstat(path.join(from, relative)).catch(() => null);
    if (info === null || info.isSymbolicLink() || !info.isFile()) continue;
    found.push(relative);
  }
  return found;
}

/**
 * Put a project's private files into a fresh copy of it, and say what went.
 *
 * Never throws and never overwrites: a file the copy already has came out of the
 * history, and the history wins. A copy that ends up without its keys is a copy
 * that cannot reach its data, which the work will say for itself — losing the
 * copy over it would be worse.
 */
export async function carryOver(from: string, to: string): Promise<string[]> {
  if (path.resolve(from) === path.resolve(to)) return [];
  const carried: string[] = [];
  for (const entry of await whatToCarry(from)) {
    if (carried.length >= MOST_FILES) break;
    for (const relative of await matching(from, entry)) {
      if (carried.length >= MOST_FILES) break;
      if (relative.split('/').some((segment) => NEVER_CARRY.has(segment))) continue;
      const source = path.join(from, relative);
      const target = path.join(to, relative);
      try {
        const info = await lstat(source);
        if (!info.isFile() || info.isSymbolicLink() || info.size > BIGGEST) continue;
        if (await isThere(target)) continue;
        await mkdir(path.dirname(target), { recursive: true });
        await copyFile(source, target, constants.COPYFILE_EXCL);
        carried.push(relative);
      } catch {
        // One file we could not carry is not a reason to abandon the rest.
      }
    }
  }
  return carried;
}

/**
 * What has to run in this copy before anything in it works, or null when it has
 * nothing to install.
 *
 * Always the exact-versions form when there is a record of them, because a copy
 * that quietly installs something newer than the project proves nothing about
 * the project. Which tool is `helperFor`'s answer, so a project is read the same
 * way here as it is when it gets made to look at.
 */
export async function piecesCommand(folder: string): Promise<readonly string[] | null> {
  let entries: string[] = [];
  try {
    entries = await readdir(folder);
  } catch {
    return null;
  }
  if (!entries.includes('package.json')) return null;

  const helper = helperFor({ entries, manifest: null });
  if (helper !== 'npm') return [helper, 'install', '--frozen-lockfile'];
  return entries.includes('package-lock.json') ? ['npm', 'ci'] : ['npm', 'install'];
}

/** Every install in the app queues here. Module-level on purpose: the point is
 *  that two copies in two projects still take their turn. */
const inTurn = oneAtATime();

/** Whether the pieces are already in place. Copies are made fresh, so this is
 *  normally false — but a copy reused after a stop should not pay for it twice. */
async function piecesAreIn(folder: string): Promise<boolean> {
  return isThere(path.join(folder, 'node_modules'));
}

export type Fresh = {
  /** The private files that came across. */
  carried: readonly string[];
  /** What was run to put the pieces back, when anything was. */
  installed: readonly string[] | null;
  /** True when the copy is ready to be worked in. */
  ready: boolean;
  /** What went wrong, in a sentence, when it did not. */
  trouble: string | null;
};

/** Said when the pieces could not be put back. Whoever reads it is looking at a
 *  copy that would fail on its first command. */
const PIECES_MISSING =
  'This copy of your project is missing the pieces it is built from, so I stopped before working in it.';

/**
 * Make a fresh copy fit to work in: its private files, then its pieces.
 *
 * The install is the slow half, so this is worth starting the moment a copy
 * exists rather than when somebody first asks it for something.
 *
 * One at a time across the whole app, whatever else is going. Four copies each
 * putting a gigabyte and a half of pieces back at once is what took a laptop
 * down hard enough to need the power button; run one after another they take
 * the same total time and the machine stays usable throughout.
 */
export async function getReady(
  from: string,
  to: string,
  options: { patience?: number } = {},
): Promise<Fresh> {
  const carried = await carryOver(from, to);
  if (await piecesAreIn(to)) {
    return { carried, installed: null, ready: true, trouble: null };
  }

  const command = await piecesCommand(to);
  if (command === null) return { carried, installed: null, ready: true, trouble: null };

  const [tool = 'npm', ...args] = command;
  const how = options.patience === undefined ? { folder: to } : { folder: to, patience: options.patience };
  const ran = await inTurn(() => runHelper(tool, args, how));
  if (ran.code === 0) return { carried, installed: command, ready: true, trouble: null };
  return { carried, installed: command, ready: false, trouble: PIECES_MISSING };
}
