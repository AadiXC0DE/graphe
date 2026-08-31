import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

/**
 * Keep what the app writes while it runs out of the person's next commit.
 *
 * Two things land in an open project and neither is the person's work: our own
 * checkouts under `.graphe/`, and the subagents extension's inputs, outputs,
 * transcripts and missions under `.pi/subagents/`. `git add -A` stages every
 * one of them.
 *
 * The lines go in the clone's own exclude file, which is never committed —
 * writing the project's `.gitignore` would be a change to a tracked file
 * nobody asked for. `--git-common-dir` rather than `--git-dir`, so this finds
 * the real one from inside a worktree too.
 *
 * `.pi/subagents/` and not `.pi/`: `.pi/hooks.json` and `.pi/mcp.json` are
 * project config and belong in the repository.
 */
export const RUNTIME_SCRATCH: readonly string[] = ['.graphe/', '.pi/subagents/'];

async function gitTold(cwd: string, args: readonly string[]): Promise<string | null> {
  try {
    const said = await execFileAsync('git', [...args], { cwd, encoding: 'utf8' });
    return said.stdout;
  } catch {
    return null;
  }
}

/**
 * Add lines to the clone's exclude file, keeping whatever is already there.
 *
 * Best effort: a repo whose exclude file cannot be written is not a reason to
 * refuse to open the project.
 */
export async function keepOutOfCommits(
  project: string,
  lines: readonly string[],
): Promise<boolean> {
  const common = await gitTold(project, ['rev-parse', '--git-common-dir']);
  if (common === null) return false;
  const gitDir = resolve(project, common.trim());
  const file = join(gitDir, 'info', 'exclude');
  const existing = await readFile(file, 'utf8').catch(() => '');
  const already = new Set(existing.split('\n').map((line) => line.trim()));
  const missing = lines.filter((line) => !already.has(line));
  if (missing.length === 0) return true;
  const ending = existing === '' || existing.endsWith('\n') ? existing : `${existing}\n`;
  try {
    await mkdir(join(gitDir, 'info'), { recursive: true });
    await writeFile(file, `${ending}${missing.join('\n')}\n`, 'utf8');
    return true;
  } catch {
    return false;
  }
}
