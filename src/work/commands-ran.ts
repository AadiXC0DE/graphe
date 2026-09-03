/** The commands the agent ran, read back out of the conversation.
 *
 * Every step already records the real thing behind it (`lib/showme.ts` writes
 * `real` on to the turn whether or not "Show me" is on), so the ledger the
 * drawer needs is the thread itself. A shell command is spelled `bash · npm
 * test` and a file is spelled `read · /Users/…/index.html`; the part before the
 * separator is the tool, and only four tools are a shell.
 *
 * Pure. Nothing here runs anything or draws anything.
 */

import type { Turn } from '../lib/thread';

/** How a step ended, in the two words the row has room for. */
export type Ended = 'running' | 'ok' | 'failed';

export type CommandRan = {
  /** The turn's own id, so a redraw keeps the row it was expanded on. */
  id: string;
  /** What was typed, without the tool in front of it. */
  command: string;
  ended: Ended;
  /** When it started, epoch ms, or null on a step recorded without one. */
  at: number | null;
  /** How long it took, or null while it is still going. */
  ms: number | null;
  /** What came back, where the conversation kept any. */
  output: string;
};

/** The tools that are a shell. Everything else `realWords` spells is a path, a
 *  pattern or an address, and none of those belong in a list of commands. */
const SHELLS = new Set(['bash', 'shell', 'run', 'exec']);

/** What `realWords` puts between the tool and its argument. */
const BETWEEN = ' · ';

export const COMMANDS_WORDS = {
  name: 'Commands',
  agent: 'Agent',
  page: 'Page',
  none: 'Nothing has been run in this conversation yet.',
  noOutput: 'Nothing came back from this one.',
  clear: 'Clear',
  stop: 'Stop',
  open: 'Open',
  close: 'Close',
  hide: 'Hide the commands',
  running: 'running',
  ok: 'ok',
  failed: 'failed',
} as const;

/** The shell command behind one step, or null when the step was not a command. */
export function commandIn(real: string | undefined): string | null {
  if (real === undefined) return null;
  const at = real.indexOf(BETWEEN);
  if (at === -1) return null;
  const tool = real.slice(0, at).trim().toLowerCase();
  if (!SHELLS.has(tool)) return null;
  const command = real.slice(at + BETWEEN.length).trim();
  return command === '' ? null : command;
}

function endedOf(state: string): Ended {
  if (state === 'done') return 'ok';
  if (state === 'failed') return 'failed';
  return 'running';
}

/**
 * The conversation as a list of commands, oldest first.
 *
 * Oldest first because the drawer scrolls to its own bottom: the newest command
 * is the one somebody just watched happen, and it belongs where the eye already
 * is.
 */
export function commandsRan(turns: readonly Turn[]): readonly CommandRan[] {
  const rows: CommandRan[] = [];
  for (const turn of turns) {
    if (turn.kind !== 'did') continue;
    const command = commandIn(turn.real);
    if (command === null) continue;
    const at = turn.at ?? null;
    const ended = endedOf(turn.state);
    const finished = turn.endedAt ?? null;
    rows.push({
      id: turn.id,
      command,
      ended,
      at,
      ms: at === null || finished === null ? null : Math.max(0, finished - at),
      output: (turn.progress ?? turn.detail ?? '').trim(),
    });
  }
  return rows;
}

/** How long it took, short enough to sit at the end of a row. */
export function saysHowLong(ms: number | null): string {
  if (ms === null) return '';
  if (ms < 1000) return `${String(Math.round(ms))}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds - minutes * 60);
  return rest === 0 ? `${String(minutes)}m` : `${String(minutes)}m ${String(rest)}s`;
}

/** How it ended and how long it took, as the one line the right of the row
 *  shows. Empty for a command with neither, which never happens in practice. */
export function saysEnded(one: CommandRan): string {
  const how = COMMANDS_WORDS[one.ended];
  const took = saysHowLong(one.ms);
  return took === '' ? how : `${how} · ${took}`;
}

/* -------------------------------------------------------------------------- */
/* What a tab keeps                                                            */
/* -------------------------------------------------------------------------- */

/** Lines kept per tab. A development server that has been up all afternoon has
 *  said more than anybody scrolls back through, and the whole of it in the
 *  document is a window that stutters. */
export const MOST_LINES = 2_000;

/** The tail of what something said, at the ceiling. Whole lines only: half a
 *  line at the top reads as a bug in the server rather than in the drawer. */
export function tailOf(said: string, most: number = MOST_LINES): string {
  const lines = said.split('\n');
  return lines.length <= most ? said : lines.slice(lines.length - most).join('\n');
}

/** What a server's tab is called: its name, and the port it answers on when it
 *  has said one. */
export function serverTitle(one: { label: string; command: string; address: string | null }): string {
  const name = one.label.trim() === '' ? one.command.trim() : one.label.trim();
  const port = portIn(one.address);
  return port === null ? name : `${name} · :${port}`;
}

/** The port out of an address, or null when there is not one to read. */
export function portIn(address: string | null): string | null {
  if (address === null) return null;
  const found = /:(\d{2,5})(?:\/|$)/.exec(address);
  return found?.[1] ?? null;
}
