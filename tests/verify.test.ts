/** What a project checks about itself, without being asked.
 *
 * The loop before this waited for somebody to write `.pi/rules.json`, which
 * almost nobody does — so for almost every project the loop ended at "written".
 * These two run by default because they read the files that just changed, take
 * about a second, and touch nothing outside the folder.
 *
 * The line they must not cross is running a stranger's test suite. This app
 * opens somebody else's folder; their suite can want a database, charge for an
 * API call, or take ten minutes. That stays behind a rule written by somebody
 * who knew what it would cost.
 */

import { describe, expect, it } from 'vitest';

import {
  checksAfterChange,
  lints,
  saysFailed,
  sourceAmong,
  typeChecks,
} from '../src/agent/pi/verify';

const TS = ['package.json', 'tsconfig.json', 'src'];
const LINTED = ['package.json', 'eslint.config.js', 'src'];
const BOTH = ['package.json', 'tsconfig.json', 'eslint.config.js'];
const NEITHER = ['package.json', 'README.md', 'main.py'];

describe('what a folder says it can check', () => {
  it('reads a type-checking project from its settings', () => {
    expect(typeChecks(TS)).toBe(true);
    expect(typeChecks(['tsconfig.base.json'])).toBe(true);
    expect(typeChecks(NEITHER)).toBe(false);
  });

  it('reads a linting project, new config shape or old', () => {
    expect(lints(LINTED)).toBe(true);
    expect(lints(['.eslintrc.json'])).toBe(true);
    expect(lints(['eslint.config.mjs'])).toBe(true);
    expect(lints(NEITHER)).toBe(false);
  });

  it('asks for nothing from a folder that checks nothing', () => {
    expect(checksAfterChange(NEITHER, ['src/a.ts'])).toEqual([]);
  });
});

describe('which files are worth checking', () => {
  it('keeps source and drops the rest', () => {
    expect(sourceAmong(['src/a.ts', 'README.md', 'data.json', 'src/b.tsx'])).toEqual([
      'src/a.ts',
      'src/b.tsx',
    ]);
  });

  it('counts the same file once, however it was written', () => {
    // Two spellings of one file must be one incident to the repair counter,
    // or a single edit spends two of its two attempts.
    expect(sourceAmong(['./src/a.ts', 'src/a.ts', 'src/a.ts'])).toEqual(['src/a.ts']);
  });

  it('is empty for a change that touched no source', () => {
    expect(sourceAmong(['notes.md', 'assets/logo.svg'])).toEqual([]);
    expect(checksAfterChange(BOTH, [])).toEqual([]);
  });
});

describe('what gets run', () => {
  it('lints the files that changed, and nothing else', () => {
    const [lint] = checksAfterChange(LINTED, ['src/a.ts', 'src/b.ts']);
    expect(lint?.key).toBe('lint');
    expect(lint?.args).toEqual(['--no-install', 'eslint', 'src/a.ts', 'src/b.ts']);
  });

  it('type-checks the project whole, because a file alone is a different program', () => {
    const [types] = checksAfterChange(TS, ['src/a.ts']);
    expect(types?.key).toBe('types');
    // No file names: a single file checked on its own is checked without the
    // project's settings and answers about something that does not exist.
    expect(types?.args).toEqual(['--no-install', 'tsc', '--noEmit']);
  });

  it('never installs anything to run a check', () => {
    for (const check of checksAfterChange(BOTH, ['src/a.ts'])) {
      expect(check.args[0]).toBe('--no-install');
    }
  });

  it('never runs a test suite by default', () => {
    const asked = checksAfterChange(BOTH, ['src/a.ts']).flatMap((one) => [one.tool, ...one.args]);
    for (const never of ['test', 'vitest', 'jest', 'mocha', 'pytest', 'run']) {
      expect(asked).not.toContain(never);
    }
  });
});

describe('what the model is told', () => {
  it('names the one file when there is one', () => {
    expect(saysFailed('types', ['src/a.ts'])).toContain('src/a.ts');
  });

  it('counts them when there are several', () => {
    expect(saysFailed('lint', ['src/a.ts', 'src/b.ts'])).toContain('2 files');
  });

  it('says which check, so a repair knows what to run', () => {
    expect(saysFailed('types', ['src/a.ts']).toLowerCase()).toContain('type');
    expect(saysFailed('lint', ['src/a.ts']).toLowerCase()).toContain('lint');
  });
});
