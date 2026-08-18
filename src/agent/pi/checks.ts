/** What this project asks to be checked, written down as files.
 *
 * A project puts one file per check in `.agents/checks/`, and every review
 * dispatches one reviewer to each of them. The point is that a team's own
 * standards — "does this match the design system", "does anything that uses
 * this component break" — outlive any one conversation and belong in the
 * repository rather than in somebody's phrasing on the day.
 *
 * The folder is the one Goose and Amp settled on, so a project already carrying
 * checks for another tool works here untouched.
 */
import { readdir, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import { REVIEW_ANGLES } from './review';

export type ProjectCheck = {
  /** Stable name for the reviewer sent to it, from the file name. */
  key: string;
  /** What a person calls it. */
  name: string;
  /** What the reviewer is asked to look for. */
  line: string;
};

/** The folders a check can live in, nearest convention first. */
const FOLDERS = ['.agents/checks', '.pi/checks'] as const;

function field(head: string, name: string): string | null {
  const found = head.match(new RegExp(`^${name}:\\s*(.+)$`, 'm'))?.[1];
  return found === undefined ? null : found.trim().replace(/^['"]|['"]$/g, '');
}

function keyOf(file: string): string {
  return (
    basename(file, '.md')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'check'
  );
}

/** One check out of one file. Frontmatter if it has any, otherwise the first
 *  heading and the rest of the words — a check should be writable as an
 *  ordinary note without learning a format first. */
export function checkFromFile(text: string, file: string): ProjectCheck | null {
  const head = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  const rest = head === null ? text : text.slice(head[0].length);
  const front = head?.[1] ?? '';

  const heading = rest.match(/^#{1,6}\s+(.+)$/m)?.[1]?.trim();
  const body = (heading === undefined ? rest : rest.replace(/^#{1,6}\s+.+$/m, '')).trim();

  const name = field(front, 'name') ?? heading ?? keyOf(file).replace(/-/g, ' ');
  const line = field(front, 'description') ?? body;
  if (line === '' || line === null) return null;

  return { key: keyOf(file), name, line };
}

/** Every check the project declares, in a settled order so two reviews of the
 *  same work ask for the same things. Nothing declared is not an error. */
export async function projectChecks(project: string): Promise<readonly ProjectCheck[]> {
  const found = new Map<string, ProjectCheck>();
  for (const folder of FOLDERS) {
    const here = join(project, folder);
    const entries = await readdir(here).catch(() => []);
    for (const entry of [...entries].sort()) {
      if (!entry.endsWith('.md') || entry.startsWith('.')) continue;
      const text = await readFile(join(here, entry), 'utf8').catch(() => '');
      if (text.trim() === '') continue;
      const check = checkFromFile(text, entry);
      // First folder wins, so a project can override what it inherited.
      if (check !== null && !found.has(check.key)) found.set(check.key, check);
    }
  }
  return [...found.values()];
}

/** The built-in angles, in the same shape, for a project that has declared
 *  nothing. Three reviewers looking in three directions beats three looking in
 *  the same one. */
export function usualChecks(): readonly ProjectCheck[] {
  return REVIEW_ANGLES.map((angle) => ({
    key: angle.key,
    name: angle.key,
    line: angle.line,
  }));
}

export const CHECK_WORDS = {
  /** Above the list, when the project wrote its own. */
  itsOwn: 'This project asks for these checks, one reviewer each:',
  /** Above the list, when nobody has written any. */
  usual: 'Nobody has written checks for this project, so check the usual three, one reviewer each:',
  /** How to say what was checked, so the person reading the verdict knows. */
  name: 'Name the checks you ran in the review block, as a "checks" list of their names.',
  /** What a person is told when they ask where checks come from. */
  where: 'Checks live in .agents/checks — one file each, a name and what to look for.',
} as const;

/** The reviewers' marching orders, appended to the change being checked. */
export function checksBrief(checks: readonly ProjectCheck[], own: boolean): string {
  const lines = checks.map((check, index) => `${String(index + 1)}. ${check.name} — ${check.line}`);
  return `${own ? CHECK_WORDS.itsOwn : CHECK_WORDS.usual}\n${lines.join('\n')}\n\n${CHECK_WORDS.name}`;
}
