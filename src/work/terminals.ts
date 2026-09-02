/** The row of tabs along the bottom: your shell, the agent's, and every server.
 *
 * Three different things want a terminal and only one of them is a terminal in
 * the usual sense. **Yours** is a shell in the folder you are looking at — your
 * PATH, your prompt, your machine, and nothing between you and it. **The
 * agent's** is a mirror: every command it ran and everything that came back, so
 * "what did it actually do" is a tab rather than an argument. And every server
 * left running gets one, because a dev server's log is the thing you go looking
 * for when the page is blank.
 *
 * Mixing the first two would be the worst bug in the app. Your shell is not
 * sandboxed — it is yours — and the agent's is the Guard's. So a tab that could
 * take typing from a person and also carry the agent's boundary is not something
 * this module can be talked into: the two facts are on the type, filled in from
 * the kind, and there is no shape of `Terminal` where they disagree.
 *
 * Pure. Nothing here opens a process; it decides which tabs exist, what they are
 * called, and which of them a keyboard is allowed to reach.
 */

import { capsNow } from './capacity';

export type TabKind = 'yours' | 'agent' | 'server';

/** Starting is the gap between asking and a process id coming back. Ended keeps
 *  the tab: a server that fell over is exactly the log somebody wants. */
export type TerminalState = 'starting' | 'running' | 'ended';

/**
 * The two facts that must never come apart, tied to the kind that decides them.
 *
 * `guarded` is whether the operating-system boundary is around it, and
 * `takesTyping` is whether a keypress reaches it at all. Yours is the only one
 * that is neither guarded nor read-only, and that is the whole of the rule.
 */
export type Nature =
  | { kind: 'yours'; guarded: false; takesTyping: true }
  | { kind: 'agent'; guarded: true; takesTyping: false }
  | { kind: 'server'; guarded: true; takesTyping: false };

export type Terminal = Nature & {
  id: string;
  /** What the tab says. */
  title: string;
  /** Where it is running, which is also which project it belongs to. */
  folder: string;
  /** For a server, where it can be opened. */
  address?: string;
  state: TerminalState;
  pid: number | null;
  exitCode: number | null;
};

/** What is asked for when a tab is opened. The nature is not among the fields:
 *  it is decided here, from the kind. */
export type Wanted = {
  kind: TabKind;
  folder: string;
  /** Its own id, where the caller already has one — a server tab carries the
   *  running piece's, so the two are the same thing under two names. */
  id?: string;
  title?: string;
  address?: string;
  pid?: number | null;
};

/** How many tabs is a row rather than a scrolling strip, and how many shells one
 *  machine will hold up without the fans coming on. Taken from the same reading
 *  of the machine as everything else that runs at once. */
export const MOST_TERMINALS = capsNow().running + 2;

const NATURE: Record<TabKind, Nature> = {
  yours: { kind: 'yours', guarded: false, takesTyping: true },
  agent: { kind: 'agent', guarded: true, takesTyping: false },
  server: { kind: 'server', guarded: true, takesTyping: false },
};

export const terminalWords = {
  yours: 'Yours',
  agent: 'The agent',
  /** Under the tab strip, so nobody has to be told which is which. */
  yoursNote: 'Your own shell, in this project’s folder. Nothing is between you and it.',
  agentNote: 'Every command the agent ran here, and what came back. Reading only.',
  serverNote: 'Everything this server has said since it started.',
  /** On the agent's tab, where the prompt would be. */
  readingOnly: 'This one is a record of what the agent ran. Type in yours instead.',
  /** On a server's tab, same place: its input was never connected to anything. */
  noPrompt: 'Nothing to type into: this is a server talking, not a shell.',
  newTab: 'New terminal',
  close: 'Close',
  /** Closing a tab that owns a process ends the process, and closing one that
   *  does not is only tidying. Said on the button so the two never look alike. */
  closeStops: 'Close, and stop what is running in it',
  ended: 'Ended',
  starting: 'Starting…',
  running: 'Running',
  /** When the row is full. */
  full: (most: number): string =>
    `${String(most)} terminals is as many as I keep open at once. Close one and this will open.`,
  /** When somebody asks for a shell in a folder that already has one. */
  alreadyOpen: 'That one is already open.',
  panel: 'Terminal',
  showPanel: 'Show the terminal',
  hidePanel: 'Hide the terminal',
} as const;

/** Toggling the panel and opening a tab, in the one spelling the app reads
 *  chords in. Kept here so the palette entry and the hint on the tab strip
 *  cannot drift apart. */
export const TERMINAL_KEYS = {
  panel: 'mod+`',
  newTab: 'mod+shift+t',
} as const;

/* -------------------------------------------------------------------------- */
/* What a tab is allowed to do                                                 */
/* -------------------------------------------------------------------------- */

/** Whether a keypress reaches this one at all. Only the person's own shell
 *  takes typing; the agent's tab is a record, and a server is talking, not
 *  listening. */
export function canType(one: Terminal): boolean {
  return one.takesTyping && one.state !== 'ended';
}

/** Whether the operating-system boundary is around what runs in it. False for
 *  exactly one kind, and that one is the person's own. */
export function isGuarded(one: Terminal): boolean {
  return one.guarded;
}

/** Whether closing the tab ends something. The agent's tab owns no process — it
 *  is a view of commands that have already been and gone — so closing it is
 *  tidying and nothing else. */
export function killsOnClose(one: Terminal): boolean {
  return one.kind !== 'agent' && one.state !== 'ended' && one.pid !== null;
}

/** What the close button says, which depends on whether it stops anything. */
export function saysClose(one: Terminal): string {
  return killsOnClose(one) ? terminalWords.closeStops : terminalWords.close;
}

/** What the tab says about itself, under its name. */
export function saysState(one: Terminal): string {
  if (one.state === 'starting') return terminalWords.starting;
  if (one.state === 'ended') return terminalWords.ended;
  return terminalWords.running;
}

/** Why there is no prompt, or null when there is one. */
export function saysNoPrompt(one: Terminal): string | null {
  if (canType(one)) return null;
  if (one.kind === 'agent') return terminalWords.readingOnly;
  if (one.kind === 'server') return terminalWords.noPrompt;
  return terminalWords.ended;
}

/* -------------------------------------------------------------------------- */
/* The row                                                                     */
/* -------------------------------------------------------------------------- */

/** What one tab is called. Yours and the agent's are fixed words — they are the
 *  same two tabs in every project — and a server is called whatever it was
 *  started as. */
export function titleFor(one: Terminal): string {
  if (one.kind === 'yours') return terminalWords.yours;
  if (one.kind === 'agent') return terminalWords.agent;
  return one.title.trim() === '' ? 'Server' : one.title.trim();
}

/** The note under the strip for whichever tab is in front. */
export function noteFor(one: Terminal): string {
  if (one.kind === 'yours') return terminalWords.yoursNote;
  if (one.kind === 'agent') return terminalWords.agentNote;
  return terminalWords.serverNote;
}

const ORDER: readonly TabKind[] = ['yours', 'agent', 'server'];

/** A tab belongs to the folder it runs in, or to anything under it. A copy of a
 *  project made for background work is its own place and keeps its own tabs. */
function inside(folder: string, project: string): boolean {
  if (folder === project) return true;
  const under = project.endsWith('/') ? project : `${project}/`;
  return folder.startsWith(under);
}

/** The tabs for the project being looked at, in the order they are drawn: yours,
 *  the agent's, then the servers oldest first. */
export function tabsFor(all: readonly Terminal[], project: string): readonly Terminal[] {
  return all
    .map((one, at) => ({ one, at }))
    .filter(({ one }) => inside(one.folder, project))
    .sort((a, b) => ORDER.indexOf(a.one.kind) - ORDER.indexOf(b.one.kind) || a.at - b.at)
    .map(({ one }) => one);
}

/** Whether a shell already stands for this folder. One per folder per kind:
 *  a second "Yours" in the same place is two prompts and one history. */
function alreadyThere(
  all: readonly Terminal[],
  wanted: Wanted,
): Terminal | undefined {
  if (wanted.kind === 'server') {
    return wanted.id === undefined ? undefined : all.find((one) => one.id === wanted.id);
  }
  return all.find(
    (one) => one.kind === wanted.kind && one.folder === wanted.folder && one.state !== 'ended',
  );
}

function isLive(one: Terminal): boolean {
  return one.state !== 'ended';
}

/** An id nobody has to hand out. Yours and the agent's are one per folder, so
 *  the folder names them; a server without an id of its own is numbered from
 *  the row, so the same row always produces the same answer. */
function idFor(all: readonly Terminal[], wanted: Wanted): string {
  if (wanted.kind !== 'server') return `${wanted.kind}:${wanted.folder}`;
  const many = all.filter((one) => one.kind === 'server').length + 1;
  return `server:${wanted.folder}:${String(many)}`;
}

/**
 * Open a tab, or say why not.
 *
 * Asking for one that already stands hands back the one that is there rather
 * than a second copy — the caller brings it to the front, which is what the
 * press meant. `because` is filled in only when nothing was opened and nothing
 * was found, so exactly one of the two answers is ever non-null.
 */
export function openTerminal(
  all: readonly Terminal[],
  wanted: Wanted,
): { all: readonly Terminal[]; opened: Terminal | null; because: string | null } {
  const standing = alreadyThere(all, wanted);
  if (standing !== undefined) return { all, opened: standing, because: null };

  if (all.filter(isLive).length >= MOST_TERMINALS) {
    return { all, opened: null, because: terminalWords.full(MOST_TERMINALS) };
  }

  const nature = NATURE[wanted.kind];
  const opened: Terminal = {
    ...nature,
    id: wanted.id ?? idFor(all, wanted),
    title: wanted.title ?? '',
    folder: wanted.folder,
    ...(wanted.address === undefined ? {} : { address: wanted.address }),
    state: wanted.pid == null ? 'starting' : 'running',
    pid: wanted.pid ?? null,
    exitCode: null,
  };
  return { all: [...all, opened], opened, because: null };
}

/** Close one. Whether that ended a process is `killsOnClose`, asked before this
 *  is called — by the time it is gone from the row there is nothing left to
 *  ask. */
export function closeTerminal(all: readonly Terminal[], id: string): readonly Terminal[] {
  return all.filter((one) => one.id !== id);
}

/** Its process came up. */
export function terminalStarted(
  all: readonly Terminal[],
  id: string,
  at: { pid: number; address?: string },
): readonly Terminal[] {
  return all.map((one) =>
    one.id === id
      ? {
          ...one,
          state: 'running' as const,
          pid: at.pid,
          ...(at.address === undefined ? {} : { address: at.address }),
        }
      : one,
  );
}

/** It went. The tab stays: what it said on the way out is the reason somebody
 *  is looking. */
export function terminalEnded(
  all: readonly Terminal[],
  id: string,
  exitCode: number | null,
): readonly Terminal[] {
  return all.map((one) =>
    one.id === id ? { ...one, state: 'ended' as const, pid: null, exitCode } : one,
  );
}

/** Which tab to put in front once `id` has gone — the one beside it, in the
 *  order the row is drawn, or null when the row is empty. */
export function afterClosing(
  all: readonly Terminal[],
  project: string,
  id: string,
): string | null {
  const row = tabsFor(all, project);
  const at = row.findIndex((one) => one.id === id);
  if (at === -1) return row[0]?.id ?? null;
  const left = row[at - 1];
  const right = row[at + 1];
  return (right ?? left)?.id ?? null;
}
