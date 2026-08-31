/** The subagents extension's own settings, and where it keeps what it writes.
 *
 * Left alone it writes helper inputs, outputs, transcripts and mission records
 * into `<project>/.pi/subagents/` — somebody else's repository, full of files
 * that are not their work. `artifactDir: "session"` puts the artifacts under
 * the agent folder's session directory instead, beside the transcripts.
 *
 * That covers the artifacts and the chain scratch. The extension hard-codes
 * missions, refinements, schedules and project panes relative to the project,
 * so the exclude in `electron/excludes.ts` is what actually guarantees none of
 * it can be committed.
 */

import { join } from 'node:path';
import type { LoadedExtension } from '../advisor';
import { fromPackage } from '../advisor';

export const SUBAGENTS_PACKAGE = 'pi-subagents';

/** Under the agent folder, which is where the extension itself reads it. */
export const SUBAGENT_SETTINGS_FILE = join('extensions', 'subagent', 'config.json');

export function subagentsLoaded(extensions: readonly LoadedExtension[]): boolean {
  return extensions.some((one) => fromPackage(one.resolvedPath ?? one.path ?? '', SUBAGENTS_PACKAGE));
}

/**
 * The settings with the artifacts pointed out of the project.
 *
 * `null` means leave the file exactly as it is — either it already says where
 * artifacts go, which is somebody's answer, or it is not something we can read
 * and rewriting it would throw away what it holds.
 */
export function artifactsBesideSessions(existing: unknown): Record<string, unknown> | null {
  if (existing === null || existing === undefined) return { artifactDir: 'session' };
  if (typeof existing !== 'object' || Array.isArray(existing)) return null;
  const kept = existing as Record<string, unknown>;
  if ('artifactDir' in kept) return null;
  return { ...kept, artifactDir: 'session' };
}
