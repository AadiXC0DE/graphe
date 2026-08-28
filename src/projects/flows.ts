/** The canvas, kept on disk so a flow survives closing the window.
 *
 * One small file per project under the app's own data directory, the same way a
 * goal and a build plan are kept. A flow is a draft until somebody starts it,
 * and a draft nobody can come back to is a drawing nobody would make twice.
 */

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

import { readFlow, type Flow } from '../work/canvas';

function flowFileFor(project: string, base: string): string {
  const key = project.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-');
  const digest = createHash('sha256').update(resolve(project)).digest('hex').slice(0, 8);
  return join(base, 'flows', `${key}-${digest}.json`);
}

export class FlowFile {
  static pathFor(project: string, userData: string): string {
    return flowFileFor(project, userData);
  }

  /** Whatever is on disk, read forgivingly. A file that will not parse is an
   *  empty canvas rather than a screen with an error on it. */
  static async read(project: string, userData: string): Promise<Flow | null> {
    try {
      const raw = await readFile(flowFileFor(project, userData), 'utf8');
      return readFlow(JSON.parse(raw) as unknown);
    } catch {
      return null;
    }
  }

  /** Written beside and renamed over, so a flow is never half a file. */
  static async write(project: string, userData: string, flow: Flow): Promise<void> {
    const file = flowFileFor(project, userData);
    await mkdir(dirname(file), { recursive: true });
    const beside = join(dirname(file), `.${basename(file)}.writing`);
    await writeFile(beside, `${JSON.stringify(flow, null, 2)}\n`, 'utf8');
    await rename(beside, file);
  }

  static async clear(project: string, userData: string): Promise<void> {
    await rm(flowFileFor(project, userData), { force: true }).catch(() => undefined);
  }
}
