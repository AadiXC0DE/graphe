/** Which files a step actually wrote.
 *
 * `src/lib/describe.ts` answers a neighbouring question — what to *call* a step
 * in the conversation — and answers it with a filename, because "Changing
 * contact.html" is the sentence and the rest of the path is filing. This module
 * wants the filing: the whole path, every path, and only for steps that write.
 * Merging the two would mean one of them doing its job badly.
 *
 * It is deliberately conservative. A step we do not recognise contributes
 * nothing, and a command run in a shell contributes nothing either — guessing
 * which files `npm run something` touched is a way to produce a confident wrong
 * answer, and the cost of missing one is a picture we did not take rather than
 * a picture of the wrong thing.
 */

import type { ToolCall } from '../agent/types';

/** Every spelling of "the file" that a tool has used. Ordered so the most
 *  specific wins where a call carries more than one. */
const PATH_KEYS = [
  'path',
  'file_path',
  'filePath',
  'file',
  'filename',
  'fileName',
  'target',
  'target_file',
  'targetFile',
  'destination',
  'dest',
  'new_path',
  'newPath',
  'old_path',
  'oldPath',
  'source',
  'src',
] as const;

/** Steps that leave the project different from how they found it. Read, list,
 *  search and fetch are all absent on purpose: nothing they do can move a
 *  pixel. */
const WRITES = new Set([
  'write',
  'create',
  'create_file',
  'edit',
  'edit_file',
  'str_replace',
  'str_replace_editor',
  'str_replace_based_edit_tool',
  'apply_patch',
  'patch',
  'multiedit',
  'multi_edit',
  'notebook_edit',
  'delete',
  'rm',
  'remove',
  'move',
  'mv',
  'rename',
  'copy',
  'cp',
]);

function textOf(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function pathsIn(input: Record<string, unknown>): string[] {
  const found: string[] = [];
  for (const key of PATH_KEYS) {
    const one = textOf(input[key]);
    if (one !== null && !found.includes(one)) found.push(one);
  }
  return found;
}

/** A step that edits several files at once carries them in a list. Read one
 *  level down and no further: anything deeper is a shape we have not seen and
 *  should not be inventing. */
function pathsInList(input: Record<string, unknown>): string[] {
  const found: string[] = [];
  for (const value of Object.values(input)) {
    if (!Array.isArray(value)) continue;
    for (const entry of value) {
      if (typeof entry === 'string') {
        const one = textOf(entry);
        if (one !== null && one.includes('.') && !found.includes(one)) found.push(one);
        continue;
      }
      if (entry === null || typeof entry !== 'object') continue;
      for (const one of pathsIn(entry as Record<string, unknown>)) {
        if (!found.includes(one)) found.push(one);
      }
    }
  }
  return found;
}

/**
 * The files this step wrote, as it named them.
 *
 * Empty for anything that only reads, and empty for anything we do not
 * recognise. Paths come back exactly as the step gave them — absolute, relative
 * or with the wrong slashes — because the only thing done with them here is
 * deciding whether a page could have changed, and `couldBeSeen` tidies them
 * itself.
 */
export function filesWrittenBy(call: ToolCall): string[] {
  if (!WRITES.has(call.name.toLowerCase())) return [];
  const direct = pathsIn(call.input);
  const listed = pathsInList(call.input);
  return [...direct, ...listed.filter((one) => !direct.includes(one))];
}
