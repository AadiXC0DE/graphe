/** Writing a file so a crash cannot leave half of one.
 *
 * Everything durable this app keeps — the checklist, the checkout index, the
 * servers it is holding, a stylesheet the design view rewrote — is read back
 * later and believed. A file half-written when the power went is not a smaller
 * file, it is unreadable json, and unreadable json is reported as "there is no
 * checklist" rather than as damage.
 *
 * So: write beside it, then move it into place. `rename` inside one directory
 * is atomic on every filesystem this ships to, which is why the temporary file
 * has to be a neighbour rather than something in the system's temp folder.
 */

import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** A neighbour nothing else will pick. The pid and a counter rather than a
 *  random name, so two writers in one process cannot collide and a stray left
 *  by a crash is recognisable as ours. */
let beside = 0;
function besideIt(file: string): string {
  beside += 1;
  return join(dirname(file), `.${String(process.pid)}-${String(beside)}.writing`);
}

export async function writeAtomically(file: string, text: string | Uint8Array): Promise<void> {
  const temp = besideIt(file);
  await mkdir(dirname(file), { recursive: true });
  try {
    await writeFile(temp, text);
    await rename(temp, file);
  } catch (cause) {
    // A failed write must not leave its scratch behind: the folder is one a
    // person can open, and a litter of `.writing` files reads as damage.
    await rm(temp, { force: true }).catch(() => undefined);
    throw cause;
  }
}

/** The same, where there is nothing to await into — a quit handler, a signal. */
export function writeAtomicallySync(file: string, text: string | Uint8Array): void {
  const temp = besideIt(file);
  mkdirSync(dirname(file), { recursive: true });
  try {
    writeFileSync(temp, text);
    renameSync(temp, file);
  } catch (cause) {
    try {
      rmSync(temp, { force: true });
    } catch {
      // Nothing left to do about it, and the caller's failure is the real one.
    }
    throw cause;
  }
}
