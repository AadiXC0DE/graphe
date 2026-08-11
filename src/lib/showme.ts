/** "Show me" — the real name of everything the app does in plain words.
 *
 * BACKLOG D1, and the principle underneath it: **the agent manages everything by
 * default, and anyone who wants the wheel can have it.** Neither group is
 * punished. A designer who never turns this on never sees a command; a designer
 * who does gets the actual command, the actual path, the actual git operation —
 * not a friendlier paraphrase of one.
 *
 * ## This is the one place jargon is allowed, and only half of it
 *
 * Everywhere else in the product, `commit`, `bash`, `--reset` and `node_modules`
 * are banned words (CONTRIBUTING.md). In `realWords` below they are the entire
 * point: somebody who has switched this on is asking what the machinery is
 * called so they can search for it, type it themselves, or check our working.
 * Softening a path or a command would make the feature useless and slightly
 * patronising at the same time. Those strings are deliberately exempt from the
 * language sweep, and they live in this file — one file, easy to find — so that
 * the exemption has an obvious boundary rather than leaking into the interface.
 *
 * The `behind` sentences are **not** covered by that exemption, and used to be.
 * BACKLOG A3: *Show me may name what was touched, never how the machinery
 * works.* A path, a filename, a command that was run — fine. A sentence teaching
 * a git concept, a compaction strategy or a billing pipeline — cut, and replaced
 * with the record of what actually happened, which is the question "show me" was
 * asked in order to answer.
 *
 * ## What it is not
 *
 * Not a log, and not a terminal. Every line here is *secondary*: it hangs under
 * something already said in plain language and never replaces it. A person with
 * "Show me" on still reads "Changing contact.html" first, and `edit ·
 * /Users/…/contact.html` second, in smaller, quieter type. Making the real
 * words the primary surface would turn this into a developer tool with a nice
 * font, which is the thing we are not building.
 */

import type { ToolCall } from '../agent/types';

/** Long enough for a real command; short enough that one line of it cannot
 *  swallow the conversation. Commands beyond this are truncated with a
 *  character that says so. */
const LIMIT = 400;

function trimmed(value: string): string {
  const oneLine = value.replace(/\s+/g, ' ').trim();
  return oneLine.length > LIMIT ? `${oneLine.slice(0, LIMIT - 1)}…` : oneLine;
}

function textField(input: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  return null;
}

/** The whole path, not the file name.
 *
 *  `describe.ts` deliberately shows only the last part, because that is what
 *  people call their files. This is the opposite job: somebody with "Show me"
 *  on wants the path they could paste into something else. */
function pathField(input: Record<string, unknown>): string | null {
  return textField(input, ['path', 'file_path', 'filePath', 'file', 'filename', 'target']);
}

/**
 * One tool call, in the machinery's own vocabulary.
 *
 * Returns null when there is genuinely nothing more to say than the tool's name
 * — which is honest, and better than padding the line with an argument list
 * nobody asked for.
 */
export function realWords(call: ToolCall): string {
  const name = call.name.toLowerCase();
  const input = call.input;

  switch (name) {
    case 'bash':
    case 'shell':
    case 'run':
    case 'exec': {
      const command = textField(input, ['command', 'cmd', 'script']);
      return command === null ? name : `${name} · ${trimmed(command)}`;
    }

    case 'read':
    case 'view':
    case 'cat':
    case 'write':
    case 'create':
    case 'edit':
    case 'str_replace':
    case 'apply_patch':
    case 'multiedit':
    case 'delete':
    case 'rm': {
      const path = pathField(input);
      return path === null ? name : `${name} · ${trimmed(path)}`;
    }

    case 'glob':
    case 'grep':
    case 'search':
    case 'find': {
      const pattern = textField(input, ['pattern', 'query', 'regex']);
      const where = textField(input, ['path', 'dir', 'directory', 'cwd']);
      if (pattern === null) return where === null ? name : `${name} · ${trimmed(where)}`;
      return where === null
        ? `${name} · ${trimmed(pattern)}`
        : `${name} · ${trimmed(pattern)} in ${trimmed(where)}`;
    }

    case 'fetch':
    case 'web_fetch':
    case 'browse': {
      const url = textField(input, ['url']);
      return url === null ? name : `${name} · ${trimmed(url)}`;
    }

    case 'ls':
    case 'list': {
      const where = textField(input, ['path', 'dir', 'directory']);
      return where === null ? name : `${name} · ${trimmed(where)}`;
    }

    default: {
      // A tool we have no translation for. The name is the real name, and the
      // first string argument is usually the interesting one — but we are
      // guessing at that, so it goes on only when there is one.
      const anything = Object.entries(input).find(
        ([, value]) => typeof value === 'string' && value.trim() !== '',
      );
      return anything === undefined ? name : `${name} · ${trimmed(String(anything[1]))}`;
    }
  }
}

/* -------------------------------------------------------------------------- */
/* The standing explanations                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The things that are true all the time rather than about one tool call.
 *
 * These name what the product's own features are underneath. They are checked
 * against the implementation rather than written from memory — `putBack`
 * describes what `src/history/repo.ts` actually runs, and if that changes this
 * sentence is wrong and should change with it.
 */
export const behind = {
  /** Under the version rail. What the sentence is allowed to say is what
   *  happened, not how it is stored: a designer asking "where does this live?"
   *  wants the record, and a developer would rather read the code than a
   *  glossary (BACKLOG A3). */
  versions:
    'Every saved moment lives in a folder inside your project, next to the files it captured. Nothing is stored anywhere else, and nothing is sent anywhere.',
  /** Under the "put back" control. */
  putBack:
    'Putting back restores the project to that saved moment. It is kept as its own moment, so it can be undone too.',
  /** Beside a version somebody named. */
  naming:
    'A name you type is kept with that saved moment — nothing else about the moment changes.',
  /** In the corner, beside the money. */
  spend:
    'Counted from what your account was actually charged, converted at the moment it is read. Graphe takes no cut and never sees the number.',
  /** When a long conversation is tidied. */
  tidying:
    'I shortened my own notes on the earlier part of this conversation so it stays quick. Every word either of us said is still above, to scroll back through.',
} as const;

/** The switch itself, and what it promises. */
export const showMeCopy = {
  label: 'Show me what you’re doing',
  hint: 'Adds the real command, file path or operation under each step.',
} as const;
