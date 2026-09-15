/** A conversation somebody deleted, kept rather than destroyed.
 *
 * Deleting a chat is a press, and a press can be a mistake. The transcript is
 * the only copy of what was said, so it is moved somewhere it can be fetched
 * back from rather than unlinked — and it stays there until somebody says
 * otherwise. Nothing on this page empties itself: not a timer, not a size, not
 * a count. The only thing that deletes a kept conversation is a person naming
 * it, which is why `emptyTrash` takes the names and empties nothing else.
 */

import { existsSync } from 'node:fs';
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
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

/** The retention rule, said once here so the window cannot guess at it. Shown
 *  with the list, because "kept until you empty it" is the whole of the
 *  policy and a person is owed it before they delete anything. */
export const TRASH_RULE = 'Nothing in the trash is deleted on its own. It stays until you empty it.';

/** One kept conversation, for the list somebody reads before deciding. */
export type Trashed = {
  /** The name it is kept under, which is how a person names it back. */
  name: string;
  path: string;
  /** When it was deleted, as an ISO moment. The name carries the moment it was
   *  moved; a file put there by hand falls back to when it was last written. */
  wentAt: string;
  size: number;
};

/** A name in the trash, and nothing but a name.
 *
 * The list is drawn from a folder a person can open, and anything could have
 * been dropped into it since. A separator, a `..`, an absolute path or a file
 * that is not a transcript resolves to nothing rather than to somewhere else on
 * the disk. */
function trashName(name: unknown): string | null {
  if (typeof name !== 'string' || name === '' || name !== basename(name)) return null;
  return name.endsWith('.jsonl') ? name : null;
}

/** The moment a delete writes into the name it keeps a transcript under. Two
 *  deletions in the same second are two files because of it, and the moment a
 *  list shows comes back out of it. */
const KEPT_AT = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z-/;

/** When the name says it went. */
function wentWhen(name: string): string | null {
  const parts = KEPT_AT.exec(name);
  if (parts === null) return null;
  const [, day, hour, minute, second, millis] = parts;
  const when = new Date(`${day}T${hour}:${minute}:${second}.${millis}Z`);
  return Number.isNaN(when.getTime()) ? null : when.toISOString();
}

/** What it was called before it was kept, so putting it back gives the file the
 *  name the shell wrote it under: a resume finds it exactly as it left it, and
 *  the transcript's own id and its file name agree again. */
function wasCalled(name: string): string {
  return name.replace(KEPT_AT, '');
}

/**
 * What is in the trash, newest first.
 *
 * A folder that is not there is an empty trash, because nothing has ever been
 * deleted. A folder that cannot be read is not: it throws, and the caller says
 * so, rather than showing somebody an empty list over a folder full of their
 * conversations.
 */
export async function listTrash(userData: string): Promise<readonly Trashed[]> {
  const into = trashFolder(userData);
  let names: readonly string[];
  try {
    names = await readdir(into);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw cause;
  }

  const kept: Trashed[] = [];
  for (const name of names) {
    const path = join(into, name);
    const facts = await stat(path).catch(() => null);
    // A directory here is not a conversation we put away, and a name we cannot
    // read is not one we can put back. Both stay on disk and stay unlisted.
    if (facts === null || !facts.isFile()) continue;
    kept.push({
      name,
      path,
      wentAt: wentWhen(name) ?? facts.mtime.toISOString(),
      size: facts.size,
    });
  }

  return kept.sort((one, two) => (one.wentAt < two.wentAt ? 1 : one.wentAt > two.wentAt ? -1 : 0));
}

/**
 * Put one back where the shell can open it again.
 *
 * Back under its own name, into the sessions folder the app lists from, so the
 * next time somebody looks the conversation is simply there. A name already
 * taken is refused rather than written over: the copy that is there is a
 * conversation somebody has been using, and the kept copy is not lost — it is
 * still in the trash, and the caller says so.
 *
 * Null when it will not move, which the caller reports as the put-back having
 * failed. A put-back that says it worked and left the file in the trash is the
 * failure mode worth avoiding here.
 */
export async function restoreFromTrash(
  name: string,
  userData: string,
  into: string,
): Promise<string | null> {
  const named = trashName(name);
  if (named === null) return null;
  const from = join(trashFolder(userData), named);
  const there = await stat(from).then(
    (one) => one.isFile(),
    () => false,
  );
  if (!there) return null;
  const target = join(into, wasCalled(named));
  if (existsSync(target)) return null;
  await mkdir(into, { recursive: true });
  try {
    await rename(from, target);
  } catch {
    return null;
  }
  return target;
}

/**
 * Throw away exactly the conversations named, and say which went.
 *
 * The names come from the list somebody was just looking at, so a name that is
 * not in the trash any more is skipped rather than reported: two people emptying
 * at once, or a folder someone tidied by hand, is not a failure. A name that is
 * not a plain transcript name is skipped too, and never resolves to a path.
 *
 * What comes back is what was actually deleted, so a screen can say "seven
 * gone" from the count rather than from what it asked for.
 */
export async function emptyTrash(
  userData: string,
  names: readonly string[],
): Promise<readonly string[]> {
  const gone: string[] = [];
  for (const name of names) {
    const named = trashName(name);
    if (named === null) continue;
    const path = join(trashFolder(userData), named);
    const there = await stat(path).then(
      (one) => one.isFile(),
      () => false,
    );
    if (!there) continue;
    try {
      await rm(path, { force: true });
      gone.push(named);
    } catch {
      // Left where it is, and left off the list of what went, which is the
      // truthful answer.
    }
  }
  return gone;
}
