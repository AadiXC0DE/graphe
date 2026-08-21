/**
 * The checks a project can run on its own files, without being asked.
 *
 * Everything else in the after-call path waits for a project to write rules,
 * which almost nobody does — so for almost every project the loop is still
 * write and stop. These two are the ones worth running by default: they read
 * the files that just changed, they finish in about a second, they touch no
 * network and no database, and they catch what a model actually gets wrong —
 * a type that no longer lines up, an import left behind by a rename.
 *
 * Running a project's whole test suite is deliberately not here. This app opens
 * somebody else's folder, and a stranger's suite can take ten minutes, want a
 * database, charge for an API call, or drop a schema. Codex can, because it
 * built the container it runs in. That one stays behind a rule somebody wrote
 * knowing what it costs.
 *
 * Pure. The caller reads the folder and runs the command.
 */

import { toPosix } from '../guard/paths';

export type Verifiable = {
  /** Named the same way project checks are, so one repair path serves both. */
  key: 'types' | 'lint';
  tool: string;
  args: readonly string[];
};

/** Files worth type-checking or linting. Anything else is not source. */
const SOURCE = /\.(?:[cm]?[jt]sx?)$/i;

/** Names that say a project type-checks. */
const TS_CONFIGS = ['tsconfig.json', 'tsconfig.base.json'];

/** Names that say a project lints, flat config first. */
const LINT_CONFIGS = [
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.cjs',
  'eslint.config.ts',
  '.eslintrc',
  '.eslintrc.js',
  '.eslintrc.cjs',
  '.eslintrc.json',
  '.eslintrc.yml',
  '.eslintrc.yaml',
];

export function typeChecks(entries: readonly string[]): boolean {
  return TS_CONFIGS.some((one) => entries.includes(one));
}

export function lints(entries: readonly string[]): boolean {
  return LINT_CONFIGS.some((one) => entries.includes(one));
}

/**
 * The files from a call worth checking.
 *
 * Sorted and deduplicated so the same edit twice is one incident to the repair
 * counter rather than two.
 */
export function sourceAmong(paths: Iterable<string>): readonly string[] {
  const kept = new Set<string>();
  for (const path of paths) {
    const clean = toPosix(path).trim();
    if (clean === '' || !SOURCE.test(clean)) continue;
    kept.add(clean.replace(/^\.\//, ''));
  }
  return [...kept].sort();
}

/**
 * What to run after a change, for a project that has asked for nothing.
 *
 * Linting names the files that changed, because that is both faster and the
 * only correct way to lint. Type-checking cannot: a file checked on its own is
 * checked without the project's own settings, and answers about a program that
 * does not exist. So it runs whole, which is why the caller runs it once per
 * turn rather than once per edit.
 */
export function checksAfterChange(
  entries: readonly string[],
  touched: readonly string[],
): readonly Verifiable[] {
  if (touched.length === 0) return [];
  const out: Verifiable[] = [];
  if (typeChecks(entries)) {
    out.push({ key: 'types', tool: 'npx', args: ['--no-install', 'tsc', '--noEmit'] });
  }
  if (lints(entries)) {
    out.push({ key: 'lint', tool: 'npx', args: ['--no-install', 'eslint', ...touched] });
  }
  return out;
}

/** What the model is told, when one of these comes back unhappy. */
export function saysFailed(key: Verifiable['key'], touched: readonly string[]): string {
  const named = touched.length === 1 ? touched[0] : `${String(touched.length)} files`;
  return key === 'types'
    ? `The project no longer type-checks after your change to ${named ?? 'those files'}.`
    : `The project's own lint rules are unhappy with your change to ${named ?? 'those files'}.`;
}
