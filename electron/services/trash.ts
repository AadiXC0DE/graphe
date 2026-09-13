/** A conversation somebody deleted, kept rather than destroyed.
 *
 * Deleting a chat is a press, and a press can be a mistake. The transcript is
 * the only copy of what was said, so it is moved somewhere it can be fetched
 * back from by hand rather than unlinked. Nothing here empties itself: throwing
 * old ones away is a storage decision somebody should be shown before it
 * happens, and that is a separate thing to build.
 */

import { mkdir, rename, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';

/** Where deleted transcripts go, beside the sessions they came from. */
export function trashFolder(userData: string): string {
  return join(userData, 'trash-conversations');
}

/**
 * Move a transcript into the trash, and say where it went.
 *
 * A name that is already taken gets a suffix rather than overwriting whatever
 * was there: two chats deleted in the same second are two chats. The `.bak`
 * beside it is the app's own copy of the same file and travels with it.
 *
 * Null when the file cannot be moved. The caller treats that as the delete
 * having failed, which is right: a delete that reports success and left the
 * file where it was is the failure mode worth avoiding.
 */
export async function moveToTrash(
  file: string,
  userData: string,
  at = Date.now(),
): Promise<string | null> {
  const into = trashFolder(userData);
  await mkdir(into, { recursive: true });
  const stamp = new Date(at).toISOString().replace(/[:.]/g, '-');
  const named = `${stamp}-${basename(file)}`;
  const target = join(into, named);
  try {
    await rename(file, target);
  } catch {
    return null;
  }
  // The app's own shadow copy of the same transcript, if there is one. Not
  // worth failing over: it is a derived file.
  await rm(`${file}.bak`, { force: true }).catch(() => undefined);
  return target;
}
