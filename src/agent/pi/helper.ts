/** Fetching the piece that has to live inside another app.
 *
 * Figma will not let anything draw from outside it. Its own writing goes
 * through the plugin surface, so a tool that draws is a plugin, and a plugin
 * has to be imported by hand from a menu inside Figma — there is no way to put
 * one there on somebody's behalf, short of publishing it to Figma's own
 * directory, which is a different piece of work.
 *
 * What can be taken off them is everything up to that: finding the release,
 * downloading it, checking it is the file we meant, and unpacking it somewhere
 * they can point Figma at. That is what this does. The last step stays theirs
 * because Figma keeps it.
 *
 * Pinned to a version and a checksum, not "latest". This ends up inside an app
 * where somebody's work lives, and a release published after we shipped is a
 * decision nobody here made.
 */

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** One file to fetch, and the only version of it we mean. */
export type Helper = {
  /** What it is called where somebody has to recognise it. */
  name: string;
  from: string;
  sha256: string;
  /** The file inside it that the other app asks to be pointed at. */
  points: string;
};

export const HELPER_WORDS = {
  cannotFetch: 'I could not fetch it. Check the connection and try again.',
  wrongFile:
    'What came back was not the file I expected, so I have thrown it away rather than put it in front of you.',
  cannotUnpack: 'I could not unpack it.',
} as const;

/** Where one lives once it is here. Named for the version so a newer one is a
 *  different folder rather than a half-overwritten one. */
export function helperFolder(under: string, helper: Helper): string {
  return join(under, 'helpers', helper.name);
}

/**
 * The helper, on disk, ready to be pointed at.
 *
 * Does nothing when it is already here — pressing twice should be as cheap as
 * pressing once, and this runs on a press.
 */
export async function fetchHelper(under: string, helper: Helper): Promise<string> {
  const folder = helperFolder(under, helper);
  const points = join(folder, helper.points);
  if (await readFile(points).then(() => true, () => false)) return points;

  let bytes: Buffer;
  try {
    const answer = await fetch(helper.from);
    if (!answer.ok) throw new Error(String(answer.status));
    bytes = Buffer.from(await answer.arrayBuffer());
  } catch {
    throw new Error(HELPER_WORDS.cannotFetch);
  }

  // Before it is written anywhere somebody might open it.
  const got = createHash('sha256').update(bytes).digest('hex');
  if (got !== helper.sha256) throw new Error(HELPER_WORDS.wrongFile);

  await rm(folder, { recursive: true, force: true });
  await mkdir(folder, { recursive: true });
  const zip = join(folder, 'downloaded.zip');
  await writeFile(zip, bytes);
  try {
    // The system's own, rather than a dependency that would travel in every
    // build for the sake of one press.
    await run('/usr/bin/unzip', ['-o', '-q', zip, '-d', folder]);
  } catch {
    await rm(folder, { recursive: true, force: true });
    throw new Error(HELPER_WORDS.cannotUnpack);
  }
  await rm(zip, { force: true });

  if (!(await readFile(points).then(() => true, () => false))) {
    await rm(folder, { recursive: true, force: true });
    throw new Error(HELPER_WORDS.wrongFile);
  }
  return points;
}
