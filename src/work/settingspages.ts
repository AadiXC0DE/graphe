/** Settings as pages you can search, rather than one sheet you scroll.
 *
 * One sheet works while there are eleven things on it. The moment there are
 * forty, the only way anybody finds a preference is to read all of them — and
 * the person who knows exactly what they want reads the most. So every
 * preference is a row that knows which page it lives on and what else somebody
 * might call it, and the same search that answers the sidebar answers the
 * command palette: type "dark" anywhere and the theme is one press away.
 *
 * The ranking is the palette's own, so a word typed here and the same word typed
 * into the palette put the same thing at the top.
 *
 * Pure. Nothing here reads or writes a preference — it says what the
 * preferences are and where they are found.
 */

import { policyWords } from '../agent/pi/extension-policy';
import { matches, type Command } from '../lib/commands';
import { THEME_WORDS } from '../lib/theme';

export type Page =
  | 'appearance'
  | 'behaviour'
  | 'notifications'
  | 'keys'
  | 'models'
  | 'add-ons'
  | 'storage'
  | 'privacy'
  | 'advanced'
  /** Reached from the Advanced row rather than the sidebar, because it is one
   *  project's list rather than a preference. */
  | 'always';

/** What kind of control the row is. `goes` opens somewhere else, `press` does
 *  something once, `text` is a field somebody types into. */
export type RowKind = 'switch' | 'choice' | 'goes' | 'press' | 'text';

export type Row = {
  id: string;
  page: Page;
  name: string;
  /** The sentence under the name. Always says what the setting does, never what
   *  it is called again. */
  note: string;
  kind: RowKind;
  /** What else somebody might type looking for this. Never shown; only
   *  searched. */
  also?: readonly string[];
  /** Its chord, where it has one. */
  keys?: string;
};

/** Appearance is how it looks and Behaviour is how it acts, so the two pages
 *  about the app itself sit together at the top; Notifications is behaviour
 *  while you are looking elsewhere, and follows it. Everything below is
 *  machinery, and Advanced is still the floor. */
export const PAGES: readonly Page[] = [
  'appearance',
  'behaviour',
  'notifications',
  'keys',
  'models',
  'add-ons',
  'storage',
  'privacy',
  'advanced',
];

export const pageWords: Record<Page, { name: string; note: string }> = {
  appearance: {
    name: 'Appearance',
    note: 'How the app looks, and how much of the machinery it names.',
  },
  behaviour: {
    name: 'Behaviour',
    note: 'What happens at launch, what sends a message, and what is done for you.',
  },
  notifications: {
    name: 'Notifications',
    note: 'How you hear about work while you are looking at something else.',
  },
  keys: { name: 'Keys', note: 'Every command and the keys it answers to.' },
  models: { name: 'Models', note: 'Which model does the work, whose account pays, and what it cost.' },
  'add-ons': {
    name: 'Add-ons',
    note: 'Skills, the tools this project can reach, and everything else you can give it.',
  },
  storage: { name: 'Storage', note: 'Where this keeps things, and how much room it is taking.' },
  privacy: {
    name: 'Privacy',
    note: 'What reaches your files, what the browser keeps, and what leaves this machine.',
  },
  advanced: {
    name: 'Advanced',
    note: 'What this project runs on its own.',
  },
  always: { name: 'Always', note: 'What runs without being asked, and when.' },
};

/* -------------------------------------------------------------------------- */
/* The answers two of the behaviour rows offer                                 */
/* -------------------------------------------------------------------------- */

/** Where a launch lands. */
export type OpenTo = 'last' | 'list';

export const OPEN_TO: readonly { id: OpenTo; says: string }[] = [
  { id: 'last', says: 'Last project' },
  { id: 'list', says: 'The project list' },
];

export function asOpenTo(raw: unknown): OpenTo {
  return raw === 'list' ? 'list' : 'last';
}

/** How the shelf comes back at launch. */
export type ShelfAtLaunch = 'remembered' | 'open' | 'closed';

export const SHELF_AT_LAUNCH: readonly { id: ShelfAtLaunch; says: string }[] = [
  { id: 'remembered', says: 'As I left it' },
  { id: 'open', says: 'Open' },
  { id: 'closed', says: 'Closed' },
];

export function asShelfAtLaunch(raw: unknown): ShelfAtLaunch {
  return raw === 'open' || raw === 'closed' ? raw : 'remembered';
}

/** What the Reply language field shows while nobody has asked for one. */
export const SAME_LANGUAGE = 'Same as the request';

export const settingsWords = {
  title: 'Settings',
  note: 'Things you change once in a while, not every message.',
  search: 'Search settings',
  nothing: 'Nothing here goes by that name.',
  /** Under a result found from another page, so nobody wonders where it came
   *  from. */
  on: (page: Page): string => `on ${pageWords[page].name}`,
} as const;

/**
 * Every preference, in the order its page draws it.
 *
 * The rows are the ones the sheet has today, sorted onto the pages a person
 * would look on, plus the chords the technical half of the audience goes
 * hunting for.
 */
export const ROWS: readonly Row[] = [
  /* ------------------------------------------------------------ appearance */
  {
    id: 'theme',
    page: 'appearance',
    name: THEME_WORDS.name,
    note: THEME_WORDS.note,
    kind: 'choice',
    also: ['colour', 'color', 'dark', 'light', 'appearance', 'palette', 'finish', 'preset', 'glass'],
  },
  {
    id: 'show-me',
    page: 'appearance',
    name: 'Show me the real thing',
    note: 'Commands, paths and model names under the plain sentences.',
    kind: 'switch',
    also: ['technical', 'commands', 'paths', 'developer', 'show me'],
  },
  {
    id: 'files',
    page: 'appearance',
    name: 'Everything in this project',
    note: 'The folder as a tree you can walk, beside the conversation.',
    kind: 'switch',
    also: ['file tree', 'sidebar', 'explorer', 'folder'],
    keys: 'mod+shift+f',
  },

  /* ------------------------------------------------------------- behaviour */
  {
    id: 'open-to',
    page: 'behaviour',
    name: 'When Graphe opens',
    note: 'The project you were last in, or the list of all of them.',
    kind: 'choice',
    also: ['startup', 'launch', 'start', 'last project', 'reopen'],
  },
  {
    id: 'shelf-at-launch',
    page: 'behaviour',
    name: 'Sidebar at launch',
    note: 'Whether the shelf beside the conversation comes back the way you left it.',
    kind: 'choice',
    also: ['startup', 'launch', 'shelf', 'sidebar', 'panel'],
    keys: 'mod+b',
  },
  {
    id: 'send-with',
    page: 'behaviour',
    name: 'Send with',
    note: 'Which press sends a message. The other one starts a new line.',
    kind: 'choice',
    also: ['enter', 'return', 'newline', 'composer', 'submit'],
  },
  {
    id: 'name-conversations',
    page: 'behaviour',
    name: 'Name conversations automatically',
    note: 'The first thing you ask becomes the name of the conversation and of its branch.',
    kind: 'switch',
    also: ['title', 'name', 'rename', 'automatic'],
  },
  {
    id: 'ask-before-closing',
    page: 'behaviour',
    name: 'Ask before closing a conversation that is still working',
    kind: 'switch',
    note: 'Closing one while it runs throws away the turn it was in the middle of.',
    also: ['close', 'confirm', 'warn', 'running', 'quit'],
    keys: 'mod+w',
  },
  {
    id: 'snap-before-apply',
    page: 'behaviour',
    name: 'Take a snapshot before work is brought into my folder',
    note: 'A version put down the moment before your files change, so going back is one press.',
    kind: 'switch',
    also: ['version', 'snapshot', 'undo', 'backup', 'revert'],
  },
  {
    id: 'editor',
    page: 'behaviour',
    name: 'Editor',
    note: 'Where Open in editor goes.',
    kind: 'choice',
    also: ['vscode', 'code', 'ide', 'zed', 'cursor', 'open in'],
  },
  {
    id: 'terminal',
    page: 'behaviour',
    name: 'Terminal',
    note: 'Where a shell on this project opens.',
    kind: 'choice',
    also: ['iterm', 'warp', 'ghostty', 'shell', 'console', 'open in'],
  },
  {
    id: 'new-model',
    page: 'behaviour',
    name: 'Default model for new projects',
    note: 'What a project starts on before anybody chooses something else for it.',
    kind: 'choice',
    also: ['llm', 'default', 'new project', 'opus', 'sonnet', 'haiku'],
  },
  {
    id: 'reply-language',
    page: 'behaviour',
    name: 'Reply language',
    note: 'What replies come back in. Left alone, each answer matches the request.',
    kind: 'text',
    also: ['language', 'locale', 'translate', 'english', 'french'],
  },

  /* --------------------------------------------------------- notifications */
  {
    id: 'when-finished',
    page: 'notifications',
    name: 'When a run finishes and the window is not in front',
    note: 'Nothing is said while you are watching it happen.',
    kind: 'choice',
    also: ['notification', 'alert', 'dock', 'bounce', 'finished', 'done'],
  },
  {
    id: 'when-needed',
    page: 'notifications',
    name: 'When something needs an answer',
    note: 'Said whether or not the window is in front, because nothing moves until you answer.',
    kind: 'choice',
    also: ['notification', 'alert', 'dock', 'bounce', 'question', 'waiting'],
  },
  {
    id: 'notify-sound',
    page: 'notifications',
    name: 'Play a sound',
    note: 'A noise with whatever is said. Off, being told is silent.',
    kind: 'switch',
    also: ['sound', 'noise', 'chime', 'beep', 'audio'],
  },
  {
    id: 'badge-dock',
    page: 'notifications',
    name: 'Badge the Dock with what is waiting',
    note: 'How many pieces of finished work are waiting to be looked at, on the icon.',
    kind: 'switch',
    also: ['badge', 'dock', 'count', 'review', 'icon'],
  },

  /* ------------------------------------------------------------------ keys */
  {
    id: 'shortcuts',
    page: 'keys',
    name: 'Keyboard shortcuts',
    note: 'The chord behind every action in the window, and the ones that ship without one.',
    kind: 'goes',
    also: ['chords', 'bindings', 'hotkeys', 'keys', 'shortcut'],
  },
  {
    id: 'palette',
    page: 'keys',
    name: 'The command palette',
    note: 'Everything this app can do, found by typing part of its name.',
    kind: 'press',
    also: ['search', 'run a command', 'quick open'],
    keys: 'mod+k',
  },

  /* ---------------------------------------------------------------- models */
  {
    id: 'model',
    page: 'models',
    name: 'Which model',
    note: 'The model this project talks to, and what it falls back to when that one is busy.',
    kind: 'choice',
    also: ['llm', 'opus', 'sonnet', 'haiku', 'provider', 'pi'],
  },
  {
    id: 'accounts',
    page: 'models',
    name: 'Accounts and keys',
    note: 'Sign in to a provider, or paste a key. Keys are kept by this computer, never in the window.',
    kind: 'goes',
    also: ['api key', 'sign in', 'token', 'anthropic', 'openai', 'billing', 'login'],
  },
  {
    id: 'usage',
    page: 'models',
    name: 'What this cost',
    note: 'Spend, what was reused from earlier, and the work that needed another try.',
    kind: 'goes',
    also: ['spend', 'cost', 'tokens', 'usage', 'billing'],
  },

  /* --------------------------------------------------------------- add-ons */
  {
    id: 'addons',
    page: 'add-ons',
    /* Short on purpose. The palette scores a name by the letters in it, and a
       long one answers to words nobody meant by it. */
    name: 'Add-ons that start turns',
    note: policyWords.note,
    kind: 'choice',
    also: ['hooks', 'turns', 'extensions', 'orchestrating', 'policy'],
  },
  {
    id: 'skills',
    page: 'add-ons',
    name: 'Skills',
    note: 'Craft you can call up with @ in a message.',
    kind: 'goes',
    also: ['craft', 'prompts', 'abilities'],
  },
  {
    id: 'connected',
    page: 'add-ons',
    name: 'Other tools',
    note: 'The design files, databases and services this project can reach.',
    kind: 'goes',
    also: ['figma', 'database', 'mcp', 'connections', 'services', 'integrations'],
  },
  {
    id: 'add-more',
    page: 'add-ons',
    name: 'Add more to Graphe',
    note: 'Give it new things it can do for you.',
    kind: 'goes',
    also: ['packages', 'extensions', 'install', 'marketplace', 'catalogue'],
  },

  /* --------------------------------------------------------------- storage */
  {
    id: 'storage',
    page: 'storage',
    name: 'Clear finished work',
    note: 'Copies of finished conversations, board pieces already taken in, and old transcripts. Nothing holding work you have not taken in is ever cleared.',
    kind: 'press',
    also: ['disk', 'space', 'room', 'clean up', 'cache'],
  },
  {
    id: 'folder',
    page: 'storage',
    name: 'Reveal the folder',
    note: 'Open it where this computer keeps files.',
    kind: 'goes',
    also: ['finder', 'directory', 'path', 'where'],
  },

  /* --------------------------------------------------------------- privacy */
  {
    id: 'hold-back',
    page: 'privacy',
    name: 'Check new work first',
    note: 'Where there is something to look at, changes are made in a copy and shown to you before anything reaches your files. Off, your files change as the work happens.',
    kind: 'switch',
    also: ['review', 'safety', 'copy', 'before', 'approve'],
  },
  {
    id: 'keep-logins',
    page: 'privacy',
    name: 'Stay signed in while I browse',
    note: 'The browser I open pages in keeps what it is signed in to. Turning it off again forgets what was kept.',
    kind: 'switch',
    also: ['cookies', 'session', 'browser', 'sign in'],
  },
  {
    id: 'diagnostics',
    page: 'privacy',
    name: 'Copy diagnostics',
    note: 'Everything worth sending when something goes wrong: the version, this machine, the add-ons, the last lines of the log. No conversations and no keys.',
    kind: 'press',
    also: ['bug report', 'logs', 'support', 'version'],
  },

  /* -------------------------------------------------------------- advanced */
  {
    id: 'always',
    page: 'advanced',
    name: 'Things this project always does',
    note: 'Commands that run without being asked: format what was written, run the tests. One file, kept with the project.',
    kind: 'goes',
    also: ['hooks', 'format', 'lint', 'tests', 'automatic'],
  },
];

/** The rows on one page, in the order it draws them. */
export function rowsOn(page: Page): readonly Row[] {
  return ROWS.filter((one) => one.page === page);
}

export function rowAt(id: string): Row | null {
  return ROWS.find((one) => one.id === id) ?? null;
}

/** Everything else a row can be found by, as one field the palette's ranking
 *  can score. The name is scored on its own and always outweighs this.
 *
 *  The note is deliberately not in here. The weakest way the palette matches is
 *  "these letters appear in order", and against a paragraph almost any word
 *  appears in order — so searching the notes would find every row for
 *  everything. That is what `also` is for: the two or three words somebody
 *  would actually type. */
function otherWords(row: Row): string {
  return [pageWords[row.page].name, ...(row.also ?? [])].join(' ');
}

const NOTHING = (): void => undefined;

function asCommand(row: Row): Command {
  return { id: row.id, name: row.name, where: otherWords(row), keys: row.keys, run: NOTHING };
}

/**
 * The rows a typed word means, best first.
 *
 * The palette's own ranking, so the sidebar's search and the palette agree
 * about what "dark" means. Nothing typed is every row, in page order.
 */
export function search(query: string): readonly Row[] {
  const wanted = query.trim();
  if (wanted === '') return ROWS.slice();
  const found = matches(ROWS.map(asCommand), wanted);
  return found.map((one) => rowAt(one.id)).filter((one): one is Row => one !== null);
}

/** Which page to show for what was typed — the page the best answer is on, so
 *  searching never leaves somebody looking at a page with no results on it. */
export function pageFor(query: string): Page | null {
  return search(query)[0]?.page ?? null;
}

/**
 * Every preference as a palette entry.
 *
 * X-05 in one function: the palette is the keyboard path to every setting, and
 * `open` is handed the row so the caller only has to know how to show one.
 */
export function settingsCommands(open: (row: Row) => void): readonly Command[] {
  return ROWS.map((row) => ({
    id: `settings:${row.id}`,
    name: row.name,
    where: `${settingsWords.title} · ${pageWords[row.page].name}`,
    keys: row.keys,
    run: () => open(row),
  }));
}
