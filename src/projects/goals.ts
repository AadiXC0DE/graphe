/** Per-project Goals, kept on disk so a restart keeps the rounds.
 *
 * One small file per project under the app's own data directory, like a build
 * plan. A goal that is gone on disk is gone on the screen; a goal that is on
 * disk is read back on the way in.
 */

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

import { readStoredGoal, type Goal } from '../work/goal';

function goalFileFor(project: string, base: string): string {
  const key = project.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-');
  const digest = createHash('sha256').update(resolve(project)).digest('hex').slice(0, 8);
  return join(base, 'goals', `${key}-${digest}.json`);
}

export class GoalFile {
  static pathFor(project: string, userData: string): string {
    return goalFileFor(project, userData);
  }

  static async read(project: string, userData: string): Promise<Goal | null> {
    const file = goalFileFor(project, userData);
    try {
      const raw = await readFile(file, 'utf8');
      // The same parse the window uses, so a half-written file cannot be
      // strict enough for the shell and too loose for the screen.
      return readStoredGoal(JSON.parse(raw) as unknown);
    } catch {
      return null;
    }
  }

  static async write(project: string, userData: string, goal: Goal): Promise<void> {
    const file = goalFileFor(project, userData);
    await mkdir(dirname(file), { recursive: true });
    const beside = join(dirname(file), `.${basename(file)}.writing`);
    await writeFile(beside, `${JSON.stringify(goal, null, 2)}\n`, 'utf8');
    await rename(beside, file);
  }

  static async clear(project: string, userData: string): Promise<void> {
    const file = goalFileFor(project, userData);
    await rm(file, { force: true }).catch(() => undefined);
  }
}
