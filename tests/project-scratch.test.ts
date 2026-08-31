/** What the app writes into an open project while it runs.
 *
 *  A person opened their own repository and found twenty-two untracked files
 *  under `.pi/subagents/` — helper inputs, outputs, whole transcripts, mission
 *  records — sitting there ready to be committed. None of it is their work.
 *
 *  Real repositories in a scratch folder, because the only proof that matters
 *  is what `git add -A` does.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { RUNTIME_SCRATCH, keepOutOfCommits } from '../electron/excludes';
import { artifactsBesideSessions, subagentsLoaded } from '../src/agent/pi/subagents';

let scratch: string;
let repo: string;

function git(args: string[], cwd = repo): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

/** What the subagents extension leaves behind: a run's input, its output, its
 *  transcript, and the mission record beside them. */
function writeHelperScratch(root: string): void {
  mkdirSync(join(root, '.pi', 'subagents', 'artifacts'), { recursive: true });
  mkdirSync(join(root, '.pi', 'subagents', 'missions'), { recursive: true });
  writeFileSync(join(root, '.pi', 'subagents', 'artifacts', 'r1_reviewer_input.md'), 'ask\n');
  writeFileSync(join(root, '.pi', 'subagents', 'artifacts', 'r1_reviewer_output.md'), 'said\n');
  writeFileSync(join(root, '.pi', 'subagents', 'artifacts', 'r1_reviewer.jsonl'), '{}\n');
  writeFileSync(join(root, '.pi', 'subagents', 'missions', 'abc.json'), '{}\n');
}

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'graphe-scratch-'));
  repo = join(scratch, 'project');
  mkdirSync(repo);
  git(['init', '-q']);
  git(['config', 'user.email', 'nobody@example.com']);
  git(['config', 'user.name', 'Nobody']);
  writeFileSync(join(repo, 'a.txt'), 'hello\n');
  git(['add', '-A']);
  git(['commit', '-qm', 'first']);
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe('the helper scratch a project collects', () => {
  it('is never staged by an add of everything', async () => {
    await keepOutOfCommits(repo, RUNTIME_SCRATCH);
    writeHelperScratch(repo);

    git(['add', '-A']);

    expect(git(['status', '--porcelain'])).not.toContain('.pi/subagents');
  });

  it('is staged when nothing keeps it out, which is what this stops', () => {
    writeHelperScratch(repo);

    git(['add', '-A']);

    const staged = git(['status', '--porcelain']);
    expect(staged).toContain('.pi/subagents/artifacts/r1_reviewer_input.md');
    expect(staged).toContain('.pi/subagents/missions/abc.json');
  });

  it('leaves the project config in .pi tracked', async () => {
    await keepOutOfCommits(repo, RUNTIME_SCRATCH);
    mkdirSync(join(repo, '.pi'), { recursive: true });
    writeFileSync(join(repo, '.pi', 'mcp.json'), '{}\n');
    writeFileSync(join(repo, '.pi', 'hooks.json'), '{}\n');

    git(['add', '-A']);

    const staged = git(['status', '--porcelain']);
    expect(staged).toContain('.pi/mcp.json');
    expect(staged).toContain('.pi/hooks.json');
  });

  it("leaves the project's own .gitignore alone", async () => {
    writeFileSync(join(repo, '.gitignore'), 'dist\n');
    git(['add', '-A']);
    git(['commit', '-qm', 'ignore']);

    await keepOutOfCommits(repo, RUNTIME_SCRATCH);

    expect(readFileSync(join(repo, '.gitignore'), 'utf8')).toBe('dist\n');
    expect(git(['status', '--porcelain']).trim()).toBe('');
  });

  it('keeps whatever the exclude file already held, and says each line once', async () => {
    const exclude = join(repo, '.git', 'info', 'exclude');
    writeFileSync(exclude, '# mine\nscratch/\n');

    await keepOutOfCommits(repo, RUNTIME_SCRATCH);
    await keepOutOfCommits(repo, RUNTIME_SCRATCH);

    const lines = readFileSync(exclude, 'utf8').split('\n');
    expect(lines).toContain('scratch/');
    for (const line of RUNTIME_SCRATCH) {
      expect(lines.filter((one) => one.trim() === line)).toHaveLength(1);
    }
  });

  /* A parallel conversation runs in a worktree, which has no `.git` folder of
     its own — the exclude lives in the repository the worktree came from. */
  it('reaches a worktree through the common git folder', async () => {
    const inside = join(repo, '.graphe', 'worktrees', 'new-2');
    git(['worktree', 'add', '--force', '-q', inside, 'HEAD']);

    await keepOutOfCommits(inside, RUNTIME_SCRATCH);
    writeHelperScratch(inside);

    expect(git(['status', '--porcelain'], inside)).not.toContain('.pi/subagents');
  });

  it('answers false where there is no repository to exclude anything in', async () => {
    const plain = join(scratch, 'not-a-repo');
    mkdirSync(plain);
    expect(await keepOutOfCommits(plain, RUNTIME_SCRATCH)).toBe(false);
  });
});

describe('where the subagents extension keeps its artifacts', () => {
  it('is the session folder when nothing has said otherwise', () => {
    expect(artifactsBesideSessions(null)).toEqual({ artifactDir: 'session' });
  });

  it('keeps every other setting in the file', () => {
    expect(artifactsBesideSessions({ fleetView: false })).toEqual({
      fleetView: false,
      artifactDir: 'session',
    });
  });

  it("leaves somebody's own answer standing", () => {
    expect(artifactsBesideSessions({ artifactDir: 'project' })).toBeNull();
  });

  it('never rewrites a file it cannot read as settings', () => {
    expect(artifactsBesideSessions('nonsense')).toBeNull();
    expect(artifactsBesideSessions([1, 2])).toBeNull();
  });
});

describe('whether the extension is even installed', () => {
  it('is told from the package the extension was loaded out of', () => {
    expect(subagentsLoaded([{ resolvedPath: '/home/x/.pi/agent/npm/node_modules/pi-subagents/index.ts' }])).toBe(true);
    expect(subagentsLoaded([{ resolvedPath: '/home/x/.pi/agent/npm/node_modules/pi-lens/index.ts' }])).toBe(false);
    expect(subagentsLoaded([])).toBe(false);
  });
});
