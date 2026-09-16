/** The flows a project has, kept on disk so a restart keeps them.
 *
 * One small file per project under the app's own data directory, keyed by the
 * registry's `projectId` rather than by the folder's path: a project that moves
 * keeps its canvases, and two folders whose paths differ only in punctuation
 * cannot land in one file.
 *
 * A flow file holds ids and never bytes — an attachment is a content id in the
 * attachment store — so a canvas is small enough to read and write whole, and
 * the file a person could open says what their drawing says.
 *
 * Two rules about damage, both learned elsewhere: a file that will not parse is
 * a project with no flows rather than a screen with an error on it, and an empty
 * list is the file gone, because the only reason to write one is that somebody
 * drew something.
 *
 * That second rule is why there is a note of what has been imported. A project
 * with no file is a project that never had a canvas *or* one whose canvases were
 * all thrown away, and those two have to be told apart: reading the old file
 * again after a removal would bring back drawings somebody deleted.
 */

import { createHash } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { writeAtomically } from '../lib/atomic';
import { readFlows, type Flow } from '../work/canvas';

/** Where a project's flows lived before they were keyed by id. Two projects
 *  whose paths differed only in punctuation flattened to one name and shared a
 *  file, so the id replaced the path. Nothing writes here any more; it is read
 *  once, so a drawing somebody made is not lost to the change. */
function olderFlowFile(root: string, userData: string): string {
  const key = root.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-');
  const digest = createHash('sha256').update(resolve(root)).digest('hex').slice(0, 8);
  return join(userData, 'flows', `${key}-${digest}.json`);
}

/** The projects whose old file has already been read. Small and its own file,
 *  because the flow file cannot say it: no file and an emptied file look the
 *  same, and one of them means "look at the old one". */
function importedNote(userData: string): string {
  return join(userData, 'flows', 'imported.json');
}

/** A file's text, or null where there is no file to read. The one place that
 *  decides a file which cannot be read is treated as a file that was never
 *  there, so no caller has to decide it again. */
async function textIn(file: string): Promise<string | null> {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return null;
  }
}

/** The json a file holds, or null where it will not parse. */
function jsonIn(text: string | null): unknown {
  if (text === null) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

async function hasImported(projectId: string, userData: string): Promise<boolean> {
  const raw = jsonIn(await textIn(importedNote(userData)));
  return Array.isArray(raw) && (raw as readonly unknown[]).includes(projectId);
}

async function notedImported(projectId: string, userData: string): Promise<void> {
  const raw = jsonIn(await textIn(importedNote(userData)));
  const held = Array.isArray(raw) ? (raw as readonly unknown[]).filter((one) => typeof one === 'string') : [];
  await writeAtomically(
    importedNote(userData),
    `${JSON.stringify([...new Set([...held, projectId])], null, 2)}\n`,
  );
}

export class FlowFile {
  /** Where one project's flows are kept. Here rather than derived at each call
   *  site, so the shell and a test point at the same file. */
  static pathFor(projectId: string, userData: string): string {
    return join(userData, 'flows', `${projectId}.json`);
  }

  /** Where an earlier version kept them, for the same reason. */
  static olderPathFor(root: string, userData: string): string {
    return olderFlowFile(root, userData);
  }

  /** Whatever is on disk, read forgivingly.
   *
   * `root` is the project's folder, and it is only ever used to find what an
   * earlier version left under the old name. Where the caller does not know it,
   * a project is simply the project its own file describes. */
  static async read(
    projectId: string,
    userData: string,
    root: string | null = null,
  ): Promise<readonly Flow[]> {
    const raw = await textIn(FlowFile.pathFor(projectId, userData));
    if (raw !== null) return readFlows(jsonIn(raw));
    // No file of its own. Either this project has never been read, or every
    // canvas it had has been thrown away, and the note is what tells them apart.
    if (root === null || (await hasImported(projectId, userData))) return [];
    const found = readFlows(jsonIn(await textIn(olderFlowFile(root, userData))));
    // The old file is left exactly where it is: it cost somebody a drawing, and
    // a change to how flows are filed is not a reason to take it away.
    if (found.length === 0) return [];
    await FlowFile.write(projectId, userData, found);
    await notedImported(projectId, userData);
    return found;
  }

  /** Written beside and renamed over, so the list is never half a file. An empty
   *  list is the file gone: a project with no canvases is a project with no file
   *  for them. */
  static async write(projectId: string, userData: string, flows: readonly Flow[]): Promise<void> {
    const file = FlowFile.pathFor(projectId, userData);
    if (flows.length === 0) {
      await rm(file, { force: true }).catch(() => undefined);
      return;
    }
    await writeAtomically(file, `${JSON.stringify(flows, null, 2)}\n`);
  }
}
