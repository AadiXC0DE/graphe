/**
 * What a read-only reviewer may run: one test file, and the history.
 *
 * Pure and deliberately narrow. A general shell in a reviewer would turn a
 * second opinion into another builder. Two shapes are allowed, and nothing
 * else. The normal Guard and sandbox still apply after this allowlist.
 *
 * The history is here because a review of a change is a review of a diff, and
 * a reviewer that cannot read one has nothing to review. Sent to look at a
 * branch it would run `git diff`, be refused, and settle having said nothing —
 * which reads as "found no problems" and is the worst answer a reviewer has.
 *
 * Reading the history is not as simple as naming the read-only verbs. Git will
 * run a program for you if you ask the right way — an external diff driver, a
 * textconv filter, a pager, a `-c` setting, an upload-pack — and `--no-index`
 * walks straight out of the repository. So the verb has to be on the list *and*
 * every word after it has to be clear of the ways back out.
 */

import { containsPath, toPosix } from '../guard/paths';

export const REVIEWER_TEST_WORDS = {
  onlyOne:
    'A reviewer may run one local test file (npx --no-install vitest run <file>, pnpm exec vitest run <file>, yarn vitest run <file>, node --test <file>) or read the history with git (diff, log, show, status, blame and the like). Nothing else.',
  outside: 'That test file is outside the project.',
  notTest: 'That path does not name a test file.',
  /** A git verb that could change something, or is not one we know. */
  readingOnly:
    'A reviewer may only read the history: diff, log, show, status, branch, blame, grep, rev-parse, ls-files, shortlog, diff-tree, describe. Nothing that writes, fetches or checks anything out.',
  /** A word that would have git run a program, or read outside the project. */
  wayOut:
    'That would have git run something of its own or read outside the project, so it is refused. Ask for the same thing without it.',
} as const;

export type ReviewerTestDecision =
  | { ok: true; file: string }
  /** A reading of the history rather than a test file. */
  | { ok: true; file: null; history: true }
  | { ok: false; reason: string };

const SHELL_LANGUAGE = /[;&|`$<>\n\r*?{}()]/;

function tokens(command: string): string[] | null {
  if (SHELL_LANGUAGE.test(command) || command.includes('[') || command.includes(']')) return null;
  const out: string[] = [];
  let word = '';
  let quote: '"' | "'" | null = null;
  let escaped = false;
  for (const char of command.trim()) {
    if (escaped) {
      word += char;
      escaped = false;
      continue;
    }
    if (char === '\\' && quote !== "'") {
      escaped = true;
      continue;
    }
    if (char === '"' || char === "'") {
      if (quote === char) quote = null;
      else if (quote === null) quote = char;
      else word += char;
      continue;
    }
    if (/\s/.test(char) && quote === null) {
      if (word !== '') out.push(word);
      word = '';
      continue;
    }
    word += char;
  }
  if (escaped || quote !== null) return null;
  if (word !== '') out.push(word);
  return out;
}

export function looksLikeTestFile(file: string): boolean {
  const path = toPosix(file).toLowerCase();
  return (
    /(?:^|\/)(?:tests?|__tests__)(?:\/|$)/.test(path) ||
    /\.(?:test|spec)\.(?:[cm]?[jt]sx?)$/.test(path)
  );
}

function fileFrom(parts: readonly string[]): string | null {
  if (
    parts.length === 5 &&
    parts[0] === 'npx' &&
    parts[1] === '--no-install' &&
    parts[2] === 'vitest' &&
    parts[3] === 'run'
  ) return parts[4] ?? null;
  if (
    parts.length === 5 &&
    parts[0] === 'pnpm' &&
    parts[1] === 'exec' &&
    parts[2] === 'vitest' &&
    parts[3] === 'run'
  ) return parts[4] ?? null;
  if (
    parts.length === 4 &&
    parts[0] === 'yarn' &&
    parts[1] === 'vitest' &&
    parts[2] === 'run'
  ) return parts[3] ?? null;
  if (parts.length === 3 && parts[0] === 'node' && parts[1] === '--test') {
    return parts[2] ?? null;
  }
  return null;
}

/**
 * Reading the history, and only reading it.
 *
 * Everything here is a verb that reports. Deliberately not `fetch`, `pull`,
 * `checkout`, `switch`, `restore`, `add`, `commit`, `stash`, `merge`, `rebase`,
 * `apply`, `clean`, `gc`, `worktree`, `config` or `tag` — some write the files,
 * some write the refs, some reach the network, and none of them is reading.
 */
const HISTORY_VERBS = new Set([
  'diff',
  'log',
  'show',
  'status',
  'branch',
  'blame',
  'grep',
  'shortlog',
  'describe',
  'rev-parse',
  'rev-list',
  'ls-files',
  'ls-tree',
  'diff-tree',
  'cat-file',
  'name-rev',
  'whatchanged',
]);

/**
 * The ways a git command stops being a read.
 *
 * Each of these either hands git a program to run, moves the repository it is
 * pointed at, or lets it read a file that is not in the project at all. They
 * are checked against the whole word and against the half before an `=`, so
 * `--output=x` is caught alongside `--output x`.
 */
const WAY_OUT = new Set([
  '-c',
  '-C',
  '--exec-path',
  '--git-dir',
  '--work-tree',
  '--namespace',
  '--upload-pack',
  '--receive-pack',
  '--exec',
  '--output',
  '--ext-diff',
  '--textconv',
  '--no-index',
  '--open-files-in-pager',
  '--config-env',
]);
/* `-p` is deliberately not on that list. After a verb it means "show me the
   patch", which is the single most useful thing a reviewer can ask for. Before
   one it means the pager — and a word before the verb that is not `--no-pager`
   fails the verb check anyway, so `git -p log` never gets here. */

/** Branch and friends can write with a flag rather than a verb. */
const WRITES_ANYWAY = new Set([
  '-d',
  '-D',
  '-m',
  '-M',
  '--delete',
  '--move',
  '--copy',
  '--force',
  '-f',
  '--set-upstream',
  '--set-upstream-to',
  '--unset-upstream',
  '--edit-description',
]);

/** Whether this is a reading of the history, or why it is not. */
function historyFrom(parts: readonly string[]): ReviewerTestDecision | null {
  if (parts[0] !== 'git') return null;

  // Only one global option before the verb, and only the harmless one.
  let at = 1;
  while (parts[at] === '--no-pager') at += 1;

  const verb = parts[at];
  if (verb === undefined) return { ok: false, reason: REVIEWER_TEST_WORDS.readingOnly };
  if (!HISTORY_VERBS.has(verb)) return { ok: false, reason: REVIEWER_TEST_WORDS.readingOnly };

  for (const word of parts.slice(at + 1)) {
    const head = word.split('=')[0] ?? word;
    if (WAY_OUT.has(word) || WAY_OUT.has(head)) {
      return { ok: false, reason: REVIEWER_TEST_WORDS.wayOut };
    }
    // `branch -d` and `grep -f` are not readings, whatever the verb promised.
    if (WRITES_ANYWAY.has(word) && verb !== 'log' && verb !== 'show' && verb !== 'diff') {
      return { ok: false, reason: REVIEWER_TEST_WORDS.readingOnly };
    }
  }
  return { ok: true, file: null, history: true };
}

export function reviewerTestDecision(command: string, projectRoot: string): ReviewerTestDecision {
  const parsed = tokens(command);
  const history = parsed === null ? null : historyFrom(parsed);
  if (history !== null) return history;
  const file = parsed === null ? null : fileFrom(parsed);
  if (file === null || file.trim() === '') return { ok: false, reason: REVIEWER_TEST_WORDS.onlyOne };
  // A word beginning with a dash is an option, not a file, and the runner reads
  // it as one. `--config=<somewhere else>/tests/a.test.ts` looks like a path
  // inside the project to a containment check — it does not begin with a slash,
  // so it is read as relative — while the runner loads it from wherever it
  // actually points and runs it. One test file means one test file.
  if (file.trimStart().startsWith('-')) return { ok: false, reason: REVIEWER_TEST_WORDS.onlyOne };
  if (!containsPath(projectRoot, file).inside) return { ok: false, reason: REVIEWER_TEST_WORDS.outside };
  if (!looksLikeTestFile(file)) return { ok: false, reason: REVIEWER_TEST_WORDS.notTest };
  return { ok: true, file };
}

export function isReviewerTestCommand(command: string, projectRoot: string): boolean {
  return reviewerTestDecision(command, projectRoot).ok;
}
