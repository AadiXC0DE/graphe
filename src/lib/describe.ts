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

/** Kept whole, on one line. For the few details worth reading in full — the
 *  place that shows them decides how much of it fits. */
function oneLine(value: string | null): string | undefined {
  if (value === null) return undefined;
  const collapsed = value.replace(/\s+/g, ' ').trim();
  return collapsed === '' ? undefined : collapsed;
}

/** The last thing something said, as a line short enough to sit in the feed.
 *  The whole of it is kept on the turn; this is only what the row shows. */
export function lastSaid(text: string): string | undefined {
  const last = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .pop();
  if (last === undefined) return undefined;
  return last.length > SAYING_LIMIT ? `${last.slice(0, SAYING_LIMIT - 1)}…` : last;
}

/** The opening of what something said, as much of it as a feed line holds.
 *
 * The other end of the text from `lastSaid`, and the difference is the shape of
 * the thing talking: a helper reports as it goes, so the newest line is the live
 * one, while the advisor answers once and leads with the answer.
 */
export function opening(text: string): string | undefined {
  const line = text.replace(/\s+/g, ' ').trim();
  if (line === '') return undefined;
  return line.length > SAYING_LIMIT ? `${line.slice(0, SAYING_LIMIT - 1)}…` : line;
}

/** Long enough for a sentence of what a step is doing, short enough that the
 *  feed does not become a second conversation. */
const SAYING_LIMIT = 120;

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

    case 'lsp':
      return {
        label: 'Looking through your code',
        detail: short(textField(input, ['symbol', 'operation', 'query', 'path'])),
      };

    case 'lsp_rename': {
      const symbol = textField(input, ['symbol', 'word', 'name']);
      return {
        label: symbol === null ? 'Renaming across your project' : `Renaming ${symbol} across your project`,
        detail: short(textField(input, ['newName', 'to'])),
      };
    }

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
    case 'webfetch':
    case 'browse':
      return { label: 'Reading something on the web', detail: short(textField(input, ['url'])) };

    /* The page beside the conversation. */
    case 'page_read':
      return { label: 'Reading the page beside us' };
    case 'page_click':
      return { label: 'Pressing something on the page', detail: short(textField(input, ['target'])) };
    case 'page_type':
      return { label: 'Typing into the page', detail: short(textField(input, ['target'])) };
    case 'page_scroll':
      return { label: 'Moving down the page' };
    case 'page_trouble':
      return { label: 'Reading what the page complained about' };
    case 'page_picture':
      return { label: 'Taking a picture of the page' };

    /* A browser of its own. */
    case 'browser_open':
      return { label: BROWSER_LABEL, detail: short(textField(input, ['url'])) };
    case 'browser_read':
      return { label: 'Reading the page in the browser' };
    case 'browser_click':
      return { label: 'Pressing something in the browser', detail: short(textField(input, ['target'])) };
    case 'browser_type':
      return { label: 'Typing into the browser', detail: short(textField(input, ['target'])) };
    case 'browser_scroll':
      return { label: 'Moving down the page in the browser' };
    case 'browser_picture':
      return { label: 'Taking a picture of the browser' };
    case 'browser_trouble':
      return { label: 'Reading what the browser complained about' };
    case 'browser_steps':
      return { label: 'Working through the page in the browser' };
    case 'browser_close':
      return { label: 'Closing the browser' };

    case 'browser_trace':
      return { label: 'Saving what the browser did' };

    /* This computer itself. */
    case 'desktop_picture':
      return { label: SCREEN_LABEL, detail: short(textField(input, ['app'])) };
    case 'desktop_read':
      return { label: 'Reading what a program has named', detail: short(textField(input, ['app'])) };
    case 'desktop_do':
      return { label: 'Working your computer' };
    case 'desktop_apps':
      return { label: 'Looking at what is open on your computer' };
    case 'desktop_open':
      return { label: 'Opening something on your computer', detail: short(textField(input, ['app'])) };

    case 'websearch':
    case 'searchweb':
      return {
        label: WEB_SEARCH_LABEL,
        detail: short(textField(input, ['query', 'q'])),
      };

    case 'task':
    case 'subagent':
    case 'delegate':
      return {
        label: TASK_LABEL,
        // Not through `short`: a piece of work handed to a helper is a
        // paragraph, and dropping it past 64 characters left the helper board
        // saying "Asked" and then nothing at all.
        detail: oneLine(textField(input, ['task', 'instructions'])),
      };

    /* Not "working on your project": it is the opposite of working, and the
       line sits directly above the card holding the questions. */
    case 'ask_first':
    case 'askfirst':
      return { label: ASKING_LABEL };

    /* Graphe's own, which appear in nearly every turn. Left unnamed they all
       read "Working on your project", which is the one sentence that says
       nothing — and it was every other line of a working feed. */
    case 'step_done':
      return { label: 'Ticking one off the list', detail: short(textField(input, ['note'])) };
    case 'cancel_build':
      return { label: 'Taking the checklist off the screen' };
    case 'score_candidates':
      return { label: 'Choosing between the answers' };
    case 'read_map':
      return { label: 'Reading the shape of the project' };
    case 'read_diff':
      return { label: 'Reading the changes so far' };
    case 'run_checks':
      return { label: "Running the project's own checks" };
    case 'figma_read':
      return { label: 'Reading the design file', detail: short(textField(input, ['url'])) };
    case 'keep_running':
      return { label: 'Starting something up', detail: short(textField(input, ['command'])) };
    case 'running':
      return { label: 'Checking what is running' };
    case 'stop_running':
      return { label: 'Stopping what was running' };
    case 'set_going':
      return { label: 'Setting work going in the background', detail: short(textField(input, ['doing'])) };
    case 'try_ways':
      return { label: 'Making a few versions to compare', detail: short(textField(input, ['doing'])) };
    case 'mcp':
      return { label: 'Using a tool you connected', detail: short(textField(input, ['tool', 'server'])) };
    case 'connect_tool':
      return { label: 'Connecting another tool', detail: short(textField(input, ['name', 'known'])) };
    case 'retain':
    case 'remember':
      return { label: 'Making a note to remember' };
    case 'recall':
      return { label: 'Looking through what it remembers', detail: short(textField(input, ['query'])) };
    case 'reflect':
      return { label: 'Thinking over what it remembers' };
    case 'memory_edit':
      return { label: 'Changing a note it kept' };
    case 'forget':
      return { label: 'Forgetting a note' };

    case 'ask_advisor':
      return { label: ADVISOR_LABEL, detail: short(textField(input, ['question'])) };
    case 'record_advisor_outcome':
      return { label: 'Noting how the advice turned out' };

    default:
      return { label: 'Working on your project' };
  }
}

/** The words a web search wears in the thread and in the overview's research
 *  log. One name in both places, so the log is derived from the thread rather
 *  than kept separately and left to drift. */
export const WEB_SEARCH_LABEL = 'Searching the web';

/** The words a delegated piece of work wears in the thread. */
export const TASK_LABEL = 'Sending a piece of work to a helper';

/** The advisor, asked and answered. Said out loud rather than slipped past:
 *  nobody presses a button for it, so the line is the only evidence it ran. */
export const ADVISOR_LABEL = 'Asking the advisor';
export const ADVISOR_ANSWERED = 'The advisor answered';

/** Whether a step is the advisor's, either half of it. */
export function isAdvisor(label: string): boolean {
  return label === ADVISOR_LABEL || label === ADVISOR_ANSWERED;
}

/** Above the card that holds the questions. */
export const ASKING_LABEL = 'Asking you first';

/**
 * Whether a step whose label begins "Reading" was reading a *file*.
 *
 * The overview counts files read straight off the label, which was fine while
 * the only thing anybody read was a file. A page, a screen and a web address
 * all read too, and counting those as files told somebody their project had
 * forty files in it when it has six.
 */
export function readsAFile(label: string): boolean {
  return label.startsWith('Reading ') && !/^Reading (the|what|something) /.test(label);
}

/** The words a page opened in a browser of its own wears in the thread. */
export const BROWSER_LABEL = 'Opening a page in the browser';

/** The words a picture of this computer's screen wears in the thread. */
export const SCREEN_LABEL = 'Taking a picture of your screen';
