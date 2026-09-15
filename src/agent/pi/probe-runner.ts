/** The disposable half of the probe.
 *
 * An extension's factory is somebody else's code, and a trusted one may loop
 * without ever yielding — no promise race can interrupt that, because the
 * thread it would run on is the one that is busy. This is the same recording as
 * `recordEntry`, in a process the parent can end: it imports the factory, hands
 * it the stub, and writes one line of JSON on stdout. Everything about the
 * deadline, the kill and the reading of that answer belongs to the parent.
 *
 * Built beside the shell (`probe-runner.mjs`) and started under
 * `ELECTRON_RUN_AS_NODE`, exactly like the helper program.
 */

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { PROBE_MARKER, recordEntry } from './extension-probe';

/** The one line the parent reads: the recording, or nothing at all. */
export async function probeLine(path: string): Promise<string> {
  const recorded = await recordEntry(path);
  return `${PROBE_MARKER}${JSON.stringify({ recorded })}\n`;
}

/** Whether this file is the program that was started, rather than a module a
 *  test imported. Both sides are resolved, because a temp folder on this
 *  machine is reached by two paths. */
function startedHere(): boolean {
  const at = process.argv[1];
  if (at === undefined) return false;
  try {
    return realpathSync(at) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (startedHere()) {
  const path = process.argv[2] ?? '';
  probeLine(path)
    .catch(() => `${PROBE_MARKER}${JSON.stringify({ recorded: null })}\n`)
    .then((line) => {
      // Ended outright rather than awaited: a factory that left a timer, a
      // socket or a watcher behind must not keep the child alive past its
      // answer, and nothing here is worth waiting for.
      process.stdout.write(line, () => process.exit(0));
    });
}
