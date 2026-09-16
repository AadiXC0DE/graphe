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
 * refused without overwriting it, and an empty list is the file gone, because
 * the only reason to write one is that somebody drew something.
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

/** A flow file exists but cannot be trusted. Callers must preserve the bytes
 * and show a recovery result instead of treating this as an empty canvas. */
export class FlowFileUnreadable extends Error {
  readonly file: string;

  constructor(file: string) {
    super(`The canvas file could not be read: ${file}`);
    this.name = 'FlowFileUnreadable';
    this.file = file;
  }
}

/** A file's text, or null only where there is no file to read. Permission,
 * device and directory errors are evidence that an existing file cannot be
 * trusted; treating them as absence would let a later save overwrite it. */
async function textIn(file: string): Promise<string | null> {
  try {
    return await readFile(file, 'utf8');
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new FlowFileUnreadable(file);
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

const transactions = new Map<string, Promise<void>>();

function transactionKey(projectId: string, userData: string): string {
  return `${resolve(userData)}\u0000${projectId}`;
}

/** Parse a durable flow array without silently throwing away part of it. The
 * renderer/file recovery reader is intentionally forgiving for old shapes,
 * but a stored array that loses an entry, id or block on read must be refused
 * before any transaction can rewrite the remaining data. */
function storedFlows(raw: unknown, file: string): readonly Flow[] {
  if (!Array.isArray(raw)) throw new FlowFileUnreadable(file);
  const found = readFlows(raw);
  if (found.length !== raw.length || new Set(found.map((flow) => flow.id)).size !== found.length) {
    throw new FlowFileUnreadable(file);
  }
  for (let at = 0; at < raw.length; at += 1) {
    const source = raw[at];
    const flow = found[at];
    if (typeof source !== 'object' || source === null || Array.isArray(source) || flow === undefined) {
      throw new FlowFileUnreadable(file);
    }
    const blocks = (source as Record<string, unknown>)['blocks'];
    if (!Array.isArray(blocks) || flow.blocks.length !== blocks.length) {
      throw new FlowFileUnreadable(file);
    }
  }
  return found;
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
    if (raw !== null) {
      return storedFlows(jsonIn(raw), FlowFile.pathFor(projectId, userData));
    }
    // No file of its own. Either this project has never been read, or every
    // canvas it had has been thrown away, and the note is what tells them apart.
    if (root === null || (await hasImported(projectId, userData))) return [];
    const olderRaw = await textIn(olderFlowFile(root, userData));
    if (olderRaw !== null) {
      const olderParsed = jsonIn(olderRaw);
      if (!Array.isArray(olderParsed)) {
        throw new FlowFileUnreadable(olderFlowFile(root, userData));
      }
    }
    const found = olderRaw === null
      ? []
      : storedFlows(jsonIn(olderRaw), olderFlowFile(root, userData));
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
      await rm(file, { force: true }).catch((cause) => {
        if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause;
      });
      return;
    }
    await writeAtomically(file, `${JSON.stringify(flows, null, 2)}\n`);
  }

  /** Read/modify/write one project's complete flow document under one queue.
   * Every caller sees the previous committed snapshot, so run events and drawing
   * edits cannot overwrite one another after racing reads. */
  static transact(
    projectId: string,
    userData: string,
    root: string | null,
    change: (flows: readonly Flow[]) => readonly Flow[],
  ): Promise<readonly Flow[]> {
    const key = transactionKey(projectId, userData);
    const prior = transactions.get(key) ?? Promise.resolve();
    const result = prior.then(async () => {
      const held = await FlowFile.read(projectId, userData, root);
      const next = change(held);
      await FlowFile.write(projectId, userData, next);
      return next;
    });
    transactions.set(key, result.then(() => undefined, () => undefined));
    return result;
  }
}
