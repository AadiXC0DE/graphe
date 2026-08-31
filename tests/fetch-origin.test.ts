/** Fetching from origin, against real repositories on a real disk.
 *
 *  Origin is a bare repository in the same scratch folder, so every case below
 *  is the real git operation with no network in it — which is the only way to
 *  settle the claim this makes: a fast-forward runs, and anything that could
 *  lose work refuses and says so.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { HistoryError, ProjectHistory, historyProblems } from '../src/history/repo';

let scratch: string;
/** The shared copy. */
let origin: string;
/** The folder under test. */
let here: string;
/** A second clone, for putting commits on origin from somewhere else. */
let elsewhere: string;

function git(args: string[], cwd: string): string {
  return execFileSync('git', ['-c', 'user.email=nobody@example.com', '-c', 'user.name=Nobody', ...args], {
    cwd,
    encoding: 'utf8',
  });
}

function commit(cwd: string, file: string, text: string): void {
  writeFileSync(join(cwd, file), `${text}\n`);
  git(['add', '-A'], cwd);
  git(['commit', '-qm', text], cwd);
}

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'graphe-fetch-'));
  origin = join(scratch, 'origin.git');
  here = join(scratch, 'here');
  elsewhere = join(scratch, 'elsewhere');

  git(['init', '-q', '--bare', '-b', 'main', origin], scratch);
  git(['init', '-q', '-b', 'main', here], scratch);
  git(['remote', 'add', 'origin', origin], here);
  commit(here, 'a.txt', 'first');
  git(['push', '-q', '--set-upstream', 'origin', 'main'], here);
  git(['clone', '-q', origin, 'elsewhere'], scratch);
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/** One commit on origin that this folder has not seen. */
function moveOriginOn(text = 'from elsewhere'): void {
  commit(elsewhere, 'b.txt', text);
  git(['push', '-q'], elsewhere);
}

describe('fetching from origin', () => {
  it('says up to date, rather than saying nothing', async () => {
    const found = await new ProjectHistory(here).fetchShared();

    expect(found.state).toBe('up-to-date');
    expect(found.branch).toBe('main');
    expect(found.upstream).toBe('origin/main');
    expect(found.ahead).toBe(0);
    expect(found.behind).toBe(0);
  });

  it('counts what origin has that this branch does not', async () => {
    moveOriginOn();
    moveOriginOn('and another');

    const found = await new ProjectHistory(here).fetchShared();

    expect(found.state).toBe('behind');
    expect(found.behind).toBe(2);
    expect(found.ahead).toBe(0);
    // Nothing moved: a fetch is a fetch.
    expect(git(['rev-parse', 'HEAD'], here)).not.toBe(git(['rev-parse', 'origin/main'], here));
  });

  it('counts what this branch has that origin does not', async () => {
    commit(here, 'c.txt', 'mine');

    const found = await new ProjectHistory(here).fetchShared();

    expect(found.state).toBe('ahead');
    expect(found.ahead).toBe(1);
    expect(found.behind).toBe(0);
  });

  it('is an ordinary answer where there is no remote at all', async () => {
    const alone = join(scratch, 'alone');
    git(['init', '-q', '-b', 'main', alone], scratch);
    commit(alone, 'a.txt', 'only here');

    const found = await new ProjectHistory(alone).fetchShared();

    expect(found.state).toBe('no-remote');
    expect(found.branch).toBe('main');
    expect(found.upstream).toBeNull();
  });

  it('is an ordinary answer on a branch that tracks nothing', async () => {
    git(['checkout', '-q', '-b', 'side'], here);

    const found = await new ProjectHistory(here).fetchShared();

    expect(found.state).toBe('no-upstream');
    expect(found.branch).toBe('side');
    expect(found.upstream).toBeNull();
  });

  it('is an ordinary answer on a detached HEAD', async () => {
    git(['checkout', '-q', '--detach', 'HEAD'], here);

    const found = await new ProjectHistory(here).fetchShared();

    expect(found.state).toBe('detached');
    expect(found.branch).toBeNull();
  });

  it('says so when the fetch could not reach origin', async () => {
    rmSync(origin, { recursive: true, force: true });

    await expect(new ProjectHistory(here).fetchShared()).rejects.toThrow(HistoryError);
    await expect(new ProjectHistory(here).fetchShared()).rejects.toThrow(historyProblems.fetchFailed);
  });
});

describe('fast-forwarding onto origin', () => {
  it('takes in what origin had, and says how much', async () => {
    moveOriginOn();
    const history = new ProjectHistory(here);
    await history.fetchShared();

    const moved = await history.fastForward();

    expect(moved.moved).toBe(1);
    expect(moved.state).toBe('up-to-date');
    expect(git(['rev-parse', 'HEAD'], here).trim()).toBe(git(['rev-parse', 'origin/main'], here).trim());
  });

  it('refuses a branch that has diverged, and says which way', async () => {
    moveOriginOn();
    commit(here, 'c.txt', 'mine');
    const history = new ProjectHistory(here);
    await history.fetchShared();
    const before = git(['rev-parse', 'HEAD'], here);

    const found = await history.fastForward();

    expect(found.state).toBe('diverged');
    expect(found.ahead).toBe(1);
    expect(found.behind).toBe(1);
    expect(found.moved).toBe(0);
    expect(git(['rev-parse', 'HEAD'], here)).toBe(before);
  });

  it('refuses while there are uncommitted changes, and leaves them alone', async () => {
    moveOriginOn();
    writeFileSync(join(here, 'a.txt'), 'half-written\n');
    const history = new ProjectHistory(here);
    await history.fetchShared();
    const before = git(['rev-parse', 'HEAD'], here);

    const found = await history.fastForward();

    expect(found.dirty).toBe(true);
    expect(found.state).toBe('behind');
    expect(found.moved).toBe(0);
    expect(git(['rev-parse', 'HEAD'], here)).toBe(before);
    expect(git(['status', '--porcelain'], here)).toContain('a.txt');
  });

  it('does nothing at all when there is nothing to take in', async () => {
    const history = new ProjectHistory(here);
    const before = git(['rev-parse', 'HEAD'], here);

    const found = await history.fastForward();

    expect(found.state).toBe('up-to-date');
    expect(found.moved).toBe(0);
    expect(git(['rev-parse', 'HEAD'], here)).toBe(before);
  });
});
