/** Reusable ways of working, as `/command` prompt templates.
 *
 * "Review this pull request" and "look at what changed" are workflows — a fixed
 * shape of work with a fixed way of being asked, so they can be a command
 * rather than a paragraph somebody writes from memory every time. The trick is
 * that a workflow is *just a file*: a markdown prompt in the same folder
 * convention Pi itself reads (`*.md` in the prompts folder; the filename minus
 * `.md` is the command). Writing one means the command exists; deleting it
 * means it is gone. Nothing has to be recompiled, registered or restarted.
 *
 * That is what makes "the agent can create a workflow": it is exactly one file
 * written into the folder, and the next read of this module sees it. Nothing
 * here executes, installs or trusts a workflow — formatting a prompt is all it
 * does, and where the prompts are read from is decided by the caller, so a
 * project's own files are only ever read as the project's own.
 */

/** One workflow somebody can ask for, ready to send. */
export type Workflow = {
  /** The command word, with the leading slash: `/review`. */
  command: string;
  /** What the command reads as without its slash, for a sentence. */
  name: string;
  /** One sentence saying what this kind of work is, so it can be listed. */
  description: string;
  /** What `/review <this>` should hold the answer to, or null when it has none. */
  hint: string | null;
  /** Where it came from, so two workflows can share a name legibly. */
  source: 'global' | 'project';
  /** The prompt body, ready to have `$1`/`$@` put into it. */
  body: string;
};

export const workflowWords = {
  /** A file that cannot answer to any command word. */
  needName: 'A workflow is named by its file — “review.md” makes the command /review.',
  needBody: 'A workflow needs something to do — the prompt it sends is the whole of it.',
  /** Typed a `/` word nobody has. */
  noPage: 'I could not find a workflow with that name.',
  /** `/review` with nothing after it, when it needs a word to work on. */
  missingArgument: 'Say what you want this to do — /review <this>.',
} as const;

/** What a command word may be: letters, numbers and hyphens, nothing that could
 *  read as a second command. */
const COMMAND = /^[a-z][a-z0-9-]*$/i;

/** The part of a filename a command comes from: `review.md` → `/review`. Null
 *  when the name is not a usable command at all. */
export function commandWord(file: string): string | null {
  if (!file.endsWith('.md')) return null;
  const base = file.slice(0, -3);
  if (base === '' || base.startsWith('.') || !COMMAND.test(base)) return null;
  return `/${base}`;
}

function clean(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const one = value.trim().replace(/^["']|["']$/g, '').replace(/\s+/g, ' ').trim();
  return one === '' ? undefined : one;
}

/** The fields a workflow cares about, out of a prompt file's frontmatter. */
function meta(text: string): { description?: string; hint?: string } {
  const head = text.match(/^---\s*\n([\s\S]*?)\n---/);
  const fields = head?.[1] ?? '';
  return {
    description: clean(fields.match(/^description:\s*(.+)$/m)?.[1]),
    hint: clean(fields.match(/^(?:argument-hint|argumentHint):\s*(.+)$/m)?.[1]),
  };
}

/**
 * `$@` / `$ARGUMENTS` (everything) and `$1`, `$2` … (the Nth typed word) in a prompt body.
 * Also supports `${N:-default}` (use default when N missing) — the minimal
 * subset of pi's `substituteArgs` that covers common workflows. `$ARGUMENTS`
 * is pi's long form for `$@`.
 *
 * A `$1` whose word was not given has nothing to be replaced by — rather than
 * guess, the placeholder is left in place so the agent can see exactly what was
 * missing instead of puzzling over a half-filled sentence.
 */
export function expand(body: string, args: string): string {
  const trimmed = args.trim();
  const words = trimmed === '' ? [] : trimmed.split(/\s+/);
  let out = body;
  // Long form first, then $@
  out = out.replace(/\$ARGUMENTS/g, trimmed);
  out = out.replace(/\$@/g, trimmed);
  // ${N:-default} — N is 1-indexed, default may be empty
  out = out.replace(/\$\{(\d+):-([^}]*)\}/g, (_m, n: string, def: string) => {
    const idx = Number(n) - 1;
    const val = words[idx];
    return val !== undefined && val !== '' ? val : def;
  });
  // $1, $2 ... leave token if missing (so agent sees gap)
  out = out.replace(/\$([1-9][0-9]*)/g, (token, index: string) => words[Number(index) - 1] ?? token);
  return out;
}

/** Turn one prompt file into a workflow. */
export function readWorkflow(
  file: { name: string; body: string },
  source: 'global' | 'project',
): { ok: true; workflow: Workflow } | { ok: false; because: string } {
  const command = commandWord(file.name);
  if (command === null) return { ok: false, because: workflowWords.needName };
  const body = file.body.replace(/^---\s*\n[\s\S]*?\n---\s*/, '').trim();
  if (body === '') return { ok: false, because: workflowWords.needBody };
  const seen = meta(file.body);
  return {
    ok: true,
    workflow: {
      command,
      name: command.slice(1),
      description: seen.description ?? `${command} — a way of working this project added.`,
      hint: seen.hint ?? null,
      source,
      body,
    },
  };
}

/** The prompt to send for one workflow, putting the typed words in. */
export function promptFor(workflow: Workflow, args: string): string {
  return args.trim() === '' ? workflow.body : expand(workflow.body, args);
}

/** One side of the folder read, so the caller decides what is global and what
 *  belongs to the project. */
export type FolderRead = readonly { name: string; body: string }[];

/** Project's own first; a project workflow always wins over a global namesake
 *  rather than the two fighting in the window. Global ones with no project
 *  namesake come after. */
export function workflowsFrom(project: FolderRead, global: FolderRead): readonly Workflow[] {
  const byCommand = new Map<string, Workflow>();
  // Global first, so the project's map.set lands last and wins for the name it
  // shares — a command read belongs to the folder somebody is working in, not
  // to the computer behind it.
  for (const file of global) {
    const read = readWorkflow(file, 'global');
    if (read.ok) byCommand.set(read.workflow.command, read.workflow);
  }
  for (const file of project) {
    const read = readWorkflow(file, 'project');
    if (read.ok) byCommand.set(read.workflow.command, read.workflow);
  }
  // The window reads the project's own first, then the computer's.
  const all = [...byCommand.values()];
  return [...all.filter((one) => one.source === 'project'), ...all.filter((one) => one.source === 'global')];
}
