/** Per-project Goals, kept on disk so a restart keeps the rounds.
 *
 * One small file per project under the app's own data directory, like a build
 * plan. A goal that is gone on disk is gone on the screen; a goal that is on
 * disk is read back on the way in.
 */

import { readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

import { writeAtomically } from '../lib/atomic';
import { readStoredGoal, type Goal } from '../work/goal';

/** One goal per conversation, not per project. A project has as many tabs as
 *  it has conversations, and one goal between them belonged to whichever
 *  happened to settle. */
function goalFileFor(project: string, base: string, address = ''): string {
  const key = project.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-');
  const digest = createHash('sha256')
    .update(`${resolve(project)}\u0000${address}`)
    .digest('hex')
    .slice(0, 8);
  return join(base, 'goals', `${key}-${digest}.json`);
}

export class GoalFile {
  static pathFor(project: string, userData: string, address = ''): string {
    return goalFileFor(project, userData, address);
  }

  static async read(project: string, userData: string, address = ''): Promise<Goal | null> {
    const file = goalFileFor(project, userData, address);
    try {
      const raw = await readFile(file, 'utf8');
      // The same parse the window uses, so a half-written file cannot be
      // strict enough for the shell and too loose for the screen.
      return readStoredGoal(JSON.parse(raw) as unknown);
    } catch {
      return null;
    }
  }

  static async write(
    project: string,
    userData: string,
    goal: Goal,
    address = '',
  ): Promise<void> {
    await writeAtomically(
      goalFileFor(project, userData, address),
      `${JSON.stringify(goal, null, 2)}\n`,
    );
  }

  static async clear(project: string, userData: string, address = ''): Promise<void> {
    await rm(goalFileFor(project, userData, address), { force: true }).catch(() => undefined);
  }
}
