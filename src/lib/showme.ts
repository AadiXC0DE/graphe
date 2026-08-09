/** "Show me" — the real name of everything the app does in plain words.
 *
 * BACKLOG D1, and the principle underneath it: **the agent manages everything by
 * default, and anyone who wants the wheel can have it.** Neither group is
 * punished. A designer who never turns this on never sees a command; a designer
 * who does gets the actual command, the actual path, the actual git operation —
 * not a friendlier paraphrase of one.
 *
 * ## This is the one place jargon is allowed
 *
 * Everywhere else in the product, `commit`, `bash`, `--reset` and `node_modules`
 * are banned words (CONTRIBUTING.md). Here they are the entire point. Somebody
 * who has switched this on is asking what the machinery is called so they can
 * search for it, type it themselves, or check our working. Softening it would
 * make the feature useless and slightly patronising at the same time.
 *
 * So the strings below are deliberately exempt from the language sweep, and they
 * live in this file — one file, easy to find — so that the exemption has an
 * obvious boundary rather than leaking into the rest of the interface.
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
  /** Under the version rail. */
  versions:
    'Every version is a commit in a git repository inside your project folder. Nothing is stored anywhere else, and nothing is sent anywhere.',
  /** Under the "put back" control. */
  putBack:
    'Putting back runs git read-tree -u --reset onto that commit and then commits the result, so the history is added to rather than rewritten — which is why going back can itself be undone.',
  /** Beside a version somebody named. */
  naming: 'A name you type is stored as a git note on the commit, not in its message.',
  /** In the corner, beside the money. */
  spend:
    'Priced from the usage your provider reports for each request, converted at the moment it is read. Graphe takes no cut and never sees the number.',
  /** When a long conversation is tidied. */
  tidying:
    'This is the agent runtime’s own context compaction: the earlier turns are summarised into one entry and the recent ones are kept verbatim. The full transcript stays on disk.',
} as const;

/** The switch itself, and what it promises. */
export const showMeCopy = {
  label: 'Show me what you’re doing',
  hint: 'Adds the real command, file path or operation under each step.',
} as const;
