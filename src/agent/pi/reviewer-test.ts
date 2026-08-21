/**
 * The one command a read-only reviewer may run: one test file.
 *
 * Pure and deliberately narrow. A general shell in a reviewer would turn a
 * second opinion into another builder. These exact command shapes let a review
 * prove one finding without installs, pipes, globs, redirects, or a project-wide
 * suite. The normal Guard and sandbox still apply after this allowlist.
 */

import { containsPath, toPosix } from '../guard/paths';

export const REVIEWER_TEST_WORDS = {
  onlyOne:
    'A reviewer may only run one local test file: npx --no-install vitest run <file>, pnpm exec vitest run <file>, yarn vitest run <file>, or node --test <file>.',
  outside: 'That test file is outside the project.',
  notTest: 'That path does not name a test file.',
} as const;

export type ReviewerTestDecision =
  | { ok: true; file: string }
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

export function reviewerTestDecision(command: string, projectRoot: string): ReviewerTestDecision {
  const parsed = tokens(command);
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
