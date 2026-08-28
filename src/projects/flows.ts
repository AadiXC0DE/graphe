/** The canvases a project has, kept on disk.
 *
 * One small file per project under the app's own data directory, the same way a
 * goal and a build plan are kept. A canvas is a tab like a conversation is a
 * tab, so a project has as many as somebody drew, and closing the tab is not
 * the same as throwing the drawing away.
 */

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

import { readFlows, type Flow } from '../work/canvas';

function flowFileFor(project: string, base: string): string {
  const key = project.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-');
  const digest = createHash('sha256').update(resolve(project)).digest('hex').slice(0, 8);
  return join(base, 'flows', `${key}-${digest}.json`);
}

export class FlowFile {
  static pathFor(project: string, userData: string): string {
    return flowFileFor(project, userData);
  }

  /** Whatever is on disk, read forgivingly. A file that will not parse is a
   *  project with no canvases rather than a screen with an error on it. */
  static async read(project: string, userData: string): Promise<readonly Flow[]> {
    try {
      const raw = await readFile(flowFileFor(project, userData), 'utf8');
      return readFlows(JSON.parse(raw) as unknown);
    } catch {
      return [];
    }
  }

  /** Written beside and renamed over, so the list is never half a file. */
  static async write(project: string, userData: string, flows: readonly Flow[]): Promise<void> {
    const file = flowFileFor(project, userData);
    if (flows.length === 0) {
      await rm(file, { force: true }).catch(() => undefined);
      return;
    }
    await mkdir(dirname(file), { recursive: true });
    const beside = join(dirname(file), `.${basename(file)}.writing`);
    await writeFile(beside, `${JSON.stringify(flows, null, 2)}\n`, 'utf8');
    await rename(beside, file);
  }
}
