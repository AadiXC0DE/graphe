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

import type { Checked } from '../hooks';
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
  where: 'Checks live in .agents/checks: one file each, a name and what to look for.',
  /** Under the list, when there are checks to actually run. */
  runThem: 'Run them with run_checks, which puts a reviewer on each of them at once and brings back what they found.',
  /** When there is nothing written down, so nothing was run and nothing spent. */
  nothingWritten: 'This project has not written any checks down, so there was nothing to run and no reviewer was sent.',
  /** Above the gathered answers. */
  gathered(many: number): string {
    return many === 1
      ? 'One check ran against this change. What its reviewer came back with:'
      : `${String(many)} checks ran against this change, one reviewer each, all at once. What each came back with:`;
  },
  /** A reviewer that looked and found nothing is a result, not a gap. */
  quiet: 'Nothing found.',
  /** A reviewer that never answered. Said plainly so a check that did not run
   *  is never read as a check that passed. */
  stalled(why: string): string {
    return `This one did not finish, so nothing was checked from its angle: ${why}`;
  },
  /** What the reviewers were told to do with the change. */
  soFar(done: number, many: number): string {
    return `${String(done)} of ${String(many)} checks answered.`;
  },
} as const;

/**
 * How many reviewers a review has going at once.
 *
 * Every check a project writes down runs; what is capped is how many are in
 * the air together, because a project with twenty of them would otherwise
 * start twenty processes on somebody's laptop inside one turn. Four is what
 * background work allows itself and half of what one turn's helpers may hold,
 * so a review never fills the fleet and leaves the agent nothing to send.
 */
export const CHECKS_AT_A_TIME = 4;

/** How much of one reviewer's answer is kept. Twenty checks each writing an
 *  essay is a context window spent on prose rather than findings. */
const MOST_PER_CHECK = 4000;

/** One check's answer, once its reviewer has finished — or not. */
export type CheckVerdict = {
  check: ProjectCheck;
  /** What the reviewer said, or why it never said anything. */
  said: string;
  /** False when this check did not run to the end. */
  ok: boolean;
};

function whyNot(cause: unknown): string {
  return cause instanceof Error && cause.message !== '' ? cause.message : 'the reviewer stopped.';
}

/**
 * Put a reviewer on every check, `most` of them at a time.
 *
 * The fan-out lives here, away from the process spawning, so the shape of it
 * — the cap, the order, what happens to the rest when one falls over — can be
 * read and tested without a child process anywhere near it.
 *
 * One reviewer failing never takes the others down: its check comes back
 * marked as unrun, and the answers that did arrive still stand.
 */
export async function runEachCheck(
  checks: readonly ProjectCheck[],
  one: (check: ProjectCheck) => Promise<string>,
  most: number = CHECKS_AT_A_TIME,
  onAnswer?: (done: number, many: number) => void,
): Promise<readonly CheckVerdict[]> {
  const verdicts = new Array<CheckVerdict>(checks.length);
  let next = 0;
  let done = 0;

  const lane = async (): Promise<void> => {
    for (;;) {
      const at = next;
      next += 1;
      const check = checks[at];
      if (check === undefined) return;
      try {
        verdicts[at] = { check, said: await one(check), ok: true };
      } catch (cause) {
        verdicts[at] = { check, said: whyNot(cause), ok: false };
      }
      done += 1;
      onAnswer?.(done, checks.length);
    }
  };

  const lanes = Math.min(Math.max(1, Math.trunc(most)), checks.length);
  await Promise.all(Array.from({ length: lanes }, () => lane()));
  return verdicts;
}

/**
 * Every reviewer's answer, gathered under the name of the check it was for.
 *
 * Grouped rather than concatenated: a finding is only worth anything if you
 * know which standard it came from, and the verdict has to name the checks it
 * ran. Nothing is dropped and nothing is summarised — a check that found
 * nothing says so, and a check that never ran says that instead.
 */
export function gatheredChecks(verdicts: readonly CheckVerdict[]): string {
  const parts = verdicts.map((verdict) => {
    const said = verdict.said.trim();
    const body = !verdict.ok
      ? CHECK_WORDS.stalled(said === '' ? 'the reviewer stopped.' : said)
      : said === ''
        ? CHECK_WORDS.quiet
        : said.length > MOST_PER_CHECK
          ? `${said.slice(0, MOST_PER_CHECK)}…`
          : said;
    return `${verdict.check.name}\n${body}`;
  });
  return `${CHECK_WORDS.gathered(verdicts.length)}\n\n${parts.join('\n\n')}\n\n${CHECK_WORDS.name}`;
}

/** The reviewers' marching orders, appended to the change being checked. */
export function checksBrief(checks: readonly ProjectCheck[], own: boolean): string {
  const lines = checks.map((check, index) => `${String(index + 1)}. ${check.name} — ${check.line}`);
  return `${own ? CHECK_WORDS.itsOwn : CHECK_WORDS.usual}\n${lines.join('\n')}\n\n${CHECK_WORDS.name}`;
}

/* -------------------------------------------------------------------------- */
/* What a reviewer's answer means                                              */
/* -------------------------------------------------------------------------- */

/** The sentences that count as a reviewer saying its check is clear. Nothing
 *  else does — an answer has to reach for one of these to be read as a pass. */
const ALL_CLEAR: readonly RegExp[] = [
  /\bno\s+(?:\w+\s+){0,2}(?:issues?|problems?|findings?|concerns?|violations?|failures?|regressions?)\b/gi,
  /\bnothing\s+(?:found|wrong|to\s+flag|to\s+report|to\s+raise|of\s+concern)\b/gi,
  /\bno\s+changes?\s+(?:needed|required)\b/gi,
  /\bnone\s+found\b/gi,
  /\ball\s+clear\b/gi,
  /\blooks?\s+(?:good|correct|fine|right)\b/gi,
  /\bpasses\b/gi,
  /\bconforms?\b/gi,
  /\bcomplies\b/gi,
];

/** A word that means the reviewer had something to say after all. Hedges count:
 *  "no issues, though…" is a finding wearing an all-clear at the front. */
const HAD_SOMETHING_TO_SAY =
  /\b(issues?|problems?|bugs?|broken|breaks?|fails?|failing|failed|missing|wrong|incorrect|errors?|inconsistent|violates?|violations?|regress\w*|unsafe|concerns?|todo|fixme|mismatch\w*|should|must|instead|however|but|though|unclear|unsure|unable|cannot|not)\b/i;

/** A place in the project, named. Nobody names a line to say it is fine. */
const POINTS_SOMEWHERE = /\b[\w-]+\.[a-z]{1,5}:\d+/i;

/** How long an answer can be and still read as an all-clear. A reviewer with
 *  nothing to report says so in a line; past this it is treated as findings. */
const CLEAR_IS_SHORT = 400;

/**
 * Whether one reviewer's answer means its check is passing.
 *
 * A reviewer answers in words, so this reads them, and it reads them the way
 * round that costs least when it is wrong. A check recorded as failing only
 * holds work up, and somebody can look and see why; a check recorded as passing
 * lets work through against a standard nobody met, which is the whole reason
 * the standard was written down. So passing is earned three times over: the
 * reviewer finished, it said the check is clear, and it said nothing else.
 *
 * The reviewer that never answered is the case this exists for. It is not a
 * pass and it is not a near-miss — it is silence, and silence unblocks nothing.
 */
export function checkPassed(verdict: CheckVerdict): boolean {
  if (!verdict.ok) return false;

  const said = verdict.said.trim();
  // A reviewer that ran to the end with nothing to say is the quiet pass, and
  // it is the same answer `gatheredChecks` already reads as "Nothing found."
  if (said === '') return true;
  if (said.length > CLEAR_IS_SHORT) return false;

  let rest = said;
  let cleared = false;
  for (const phrase of ALL_CLEAR) {
    const shorter = rest.replace(phrase, ' ');
    if (shorter !== rest) cleared = true;
    rest = shorter;
  }
  return cleared && !HAD_SOMETHING_TO_SAY.test(rest) && !POINTS_SOMEWHERE.test(rest);
}

/**
 * Every answer, under every name a rule could call its check by.
 *
 * A rule says `"needs": "tests"`. The check it means is a file with a name and
 * a heading, and which of the two somebody had in mind is not knowable, so both
 * are recorded and the matching end is forgiving about case and punctuation.
 *
 * Where two checks want the same name, the one that did not pass keeps it: a
 * name that means two things must not quietly mean the easier of the two.
 */
export function whatWasChecked(verdicts: readonly CheckVerdict[]): Record<string, Checked> {
  const world: Record<string, Checked> = {};

  for (const verdict of verdicts) {
    const said = verdict.said.trim();
    const noted: Checked = {
      passing: checkPassed(verdict),
      said: verdict.ok ? said : CHECK_WORDS.stalled(said === '' ? 'the reviewer stopped.' : said),
    };
    for (const handle of [verdict.check.key, verdict.check.name]) {
      if (handle.trim() === '') continue;
      if (world[handle]?.passing === false) continue;
      world[handle] = noted;
    }
  }

  return world;
}
