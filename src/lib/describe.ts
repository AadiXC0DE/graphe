/** Tool calls, said the way a person would say them.
 *
 * "Never a spinner without a sentence" (notes/strategy/UI-DESIGN.md): the
 * running state of an activity line always carries a real description, because
 * `bash`, `edit` and `glob` are the vocabulary of the thing doing the work and
 * not of the person watching it. This module is the whole translation, and it is
 * deliberately small — a lookup and a filename, not a paraphrasing engine.
 *
 * Two rules it follows:
 *
 *  - Names of files are shown, because they are the user's own words. Names of
 *    tools never are.
 *  - When we do not recognise a tool, the label says something true and general
 *    rather than guessing. An honest "Working on your project" beats a confident
 *    description of the wrong thing.
 */

import type { ToolCall } from '../agent/types';

export type Described = {
  /** The sentence. Always present. */
  label: string;
  /** The second half of the same thought, when there is one worth reading. */
  detail?: string;
};

/** Long enough to be useful, short enough that the line stays one line. */
const DETAIL_LIMIT = 64;

function textField(input: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  return null;
}

/** The last part of a path is what people call the file. The rest is filing. */
function fileName(input: Record<string, unknown>): string | null {
  const path = textField(input, ['path', 'file_path', 'filePath', 'file', 'filename', 'target']);
  if (path === null) return null;
  const parts = path.split(/[\\/]/).filter((part) => part !== '');
  return parts[parts.length - 1] ?? path;
}

/** Shown only when it is short. A wrapped shell command in a feed of one-line
 *  activities turns the feed into a terminal, which is the one thing this
 *  interface is not. */
function short(value: string | null): string | undefined {
  if (value === null) return undefined;
  const oneLine = value.replace(/\s+/g, ' ').trim();
  return oneLine.length > DETAIL_LIMIT ? undefined : oneLine;
}

function named(verb: string, file: string | null, fallback: string): Described {
  return file === null ? { label: fallback } : { label: `${verb} ${file}` };
}

export function describeCall(call: ToolCall): Described {
  const input = call.input;
  const file = fileName(input);

  switch (call.name.toLowerCase()) {
    case 'read':
    case 'view':
    case 'cat':
      return named('Reading', file, 'Reading your project');

    case 'write':
    case 'create':
      return named('Writing', file, 'Writing a new file');

    case 'edit':
    case 'str_replace':
    case 'apply_patch':
    case 'multiedit':
      return named('Changing', file, 'Changing your project');

    case 'delete':
    case 'rm':
      return named('Removing', file, 'Removing a file');

    case 'ls':
    case 'list':
      return { label: 'Looking at what is in the folder' };

    case 'glob':
    case 'grep':
    case 'search':
    case 'find':
      return {
        label: 'Looking through your files',
        detail: short(textField(input, ['pattern', 'query', 'regex'])),
      };

    case 'bash':
    case 'shell':
    case 'run':
    case 'exec':
      return {
        label: 'Running a command',
        detail: short(textField(input, ['command', 'cmd', 'script'])),
      };

    case 'fetch':
    case 'web_fetch':
    case 'browse':
      return { label: 'Reading something on the web', detail: short(textField(input, ['url'])) };

    default:
      return { label: 'Working on your project' };
  }
}
