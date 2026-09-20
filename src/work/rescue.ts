/** Writing carried out of a copy before the copy goes, and where it is after.
 *
 * A conversation's checkout is given back when nobody is in it, and anything the
 * project ignores but a person wrote goes with it unless it is carried out
 * first: no save and no version holds it. Where it is carried to is the whole of
 * this file.
 *
 * That used to be one folder per project, named from the project's path with
 * every character that is not a letter, digit, dash or underscore flattened to a
 * dash. Two projects differing only in punctuation — `/x/my-site`, `/x/my.site`
 * — flattened to one name and landed in one folder, so a rescue wrote over the
 * other project's copy of any file whose name was the same.
 *
 * New rescues are filed under a digest of the project's id, which two projects
 * cannot share. The old roots are left exactly as they are: one can hold the
 * only copy of somebody's page, so they are read and never written, moved or
 * deleted.
 *
 * The disk is here rather than in the shell because the rules that matter — a
 * rescue that could not be written must not be followed by deleting the copy,
 * and an old root must not be written to — are worth checking without an app
 * around them.
 */

import { constants, existsSync } from 'node:fs';
import { copyFile, mkdir, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { Rescue } from '../history/worktree';
import { legacyRescueRoot, rescueDigestOf, rescueFolder } from './copies';

export type { Rescue };

/** One project's rescued writing, as the two operations below ask about it. */
export type Rescued = { base: string; project: string; projectId: string };

/** What is said when writing has been carried out, and where to go for it. */
export const rescueWords = {
  /** Every folder is named, because they are different folders: the one in use
   *  now, and the ones an earlier version left under a name that two projects
   *  could share. A path is the only way to the files. */
  setAside: (folders: readonly string[]): string =>
    folders.length <= 1
      ? `Your writing from that copy is set aside in ${folders[0] ?? 'the folders Graphe keeps'}.`
      : `Your writing from that copy is set aside, some of it filed by an earlier version under a name projects could share: ${folders.join(', ')}.`,
} as const;

/**
 * Carry files out of `folder` and into this project's rescue root.
 *
 * False keeps the copy. One file that could not be written is enough: saying it
 * went and then deleting the only copy of it is the whole failure this exists to
 * prevent, and a disk that refused the write is exactly when it would happen.
 */
export function writesAside(where: Rescued, whose: string): Rescue {
  const to = join(rescueFolder(where.base, where.project, where.projectId), whose);
  return async (folder, files) => {
    for (const one of files) {
      const target = join(to, one);
      try {
        await mkdir(dirname(target), { recursive: true });
        // Cloned where the filesystem can: on APFS the bytes are shared until
        // one side is written to, so rescuing a large file costs nothing.
        await copyFile(join(folder, one), target, constants.COPYFILE_FICLONE);
      } catch {
        return false;
      }
    }
    return true;
  };
}

/**
 * Every root this project's rescued writing may be in, the one in use first.
 *
 * A root of its own is one whose name carries the project's id, and it is found
 * by reading the folder rather than by building the name again: the readable
 * half of that name is the project folder's, so it changes when the project is
 * moved, and a rescue that could not be found after a move is a rescue lost.
 *
 * Then the root the version before this one used, which is the flattened path —
 * a place to read, never to write.
 */
async function rescueRootsOf(base: string, project: string, projectId: string): Promise<readonly string[]> {
  const mine = rescueFolder(base, project, projectId);
  const legacy = legacyRescueRoot(base, project);
  const under = join(base, 'kept-aside');
  const suffix = `-${rescueDigestOf(projectId)}`;
  const beside = await readdir(under, { withFileTypes: true }).catch(() => []);
  const ours = beside
    .filter((one) => one.isDirectory() && one.name.endsWith(suffix))
    .map((one) => join(under, one.name))
    // The root this version writes to goes first, so what is there now is read
    // before what was there before.
    .sort((one, other) => (one === mine ? -1 : other === mine ? 1 : one.localeCompare(other)));
  return [mine, ...ours.filter((one) => one !== mine), ...(legacy === mine ? [] : [legacy])];
}

/**
 * Every folder holding writing rescued from one conversation, in the order
 * somebody would look: what this version set aside, then what an earlier one
 * did.
 *
 * A folder holding nothing is left out — a rescue that failed leaves one
 * behind, and an empty folder is not a place anybody's writing is.
 */
export async function rescuedCopies(where: Rescued, whose: string): Promise<readonly string[]> {
  const roots = await rescueRootsOf(where.base, where.project, where.projectId);
  const found: string[] = [];
  for (const root of roots) {
    const held = join(root, whose);
    if (!existsSync(held)) continue;
    const inside = await readdir(held).catch(() => []);
    if (inside.length > 0) found.push(held);
  }
  return found;
}
