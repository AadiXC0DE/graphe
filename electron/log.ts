/** A log on disk, so "it stopped" has something to send with it.
 *
 * Three `console.*` calls and nothing written down means a friend reporting a
 * failure has nothing to attach and we have nothing to read. This writes lines
 * to `userData/logs/`, keeps five files of two megabytes, and masks anything
 * the Guard recognises as a secret before it reaches the disk.
 *
 * Transcripts and keys never come through here. What does is what happened:
 * the app started, a run began, a child exited, something threw.
 *
 * Nothing here throws. A log that takes the app down with it is worse than no
 * log at all, so every filesystem call is wrapped and a failed write is simply
 * a line that was not written.
 */

import { appendFileSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { findSecret } from '../src/agent/guard/policy';

export type Level = 'debug' | 'info' | 'warn' | 'error';

export type Log = {
  line(level: Level, what: string, extra?: Record<string, unknown>): void;
  recent(n: number): readonly string[];
  folder: string;
  close(): void;
};

/** Five files of two megabytes: a fortnight of ordinary use, and small enough
 *  that the whole folder still fits in a message. */
export const LOG_FILES = 5;
export const LOG_BYTES = 2 * 1024 * 1024;

/** Lines held in memory for `recent`, which is what the diagnostics bundle
 *  reads. Well past the two hundred it asks for. */
const REMEMBERED = 1000;

const CURRENT = 'graphe.log';

/* -------------------------------------------------------------------------- */
/* Masking                                                                     */
/* -------------------------------------------------------------------------- */

/** A key spelled out beside its name: `OPENAI_API_KEY=sk-…`, `"token": "…"`.
 *  The name stays — knowing *which* credential was involved is the whole point
 *  of the line — and only the value goes. */
const ASSIGNED =
  /([A-Za-z0-9_]*(?:api[_-]?key|apikey|secret|token|password|passwd|access[_-]?key|private[_-]?key)[A-Za-z0-9_]*)(\s*[:=]\s*)(["'`]?)([^"'`\s,;]{6,})\3/gi;

/** A private key runs over many lines, so it cannot be caught word by word. */
const PRIVATE_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;

function hidden(name: string): string {
  return `[${name} hidden]`;
}

/** Everything the Guard would recognise, replaced by the name of what it was. */
export function mask(text: string): string {
  let out = text.replace(PRIVATE_KEY, hidden('private key'));
  out = out.replace(ASSIGNED, (all: string, name: string, between: string, quote: string, value: string) => {
    // A count is not a credential: `tokensUsed=182400` is the sort of line the
    // log exists for.
    if (/^[\d.]+$/.test(value)) return all;
    return `${name}${between}${quote}${hidden('key')}${quote}`;
  });
  return out.replace(/\S+/g, (word) => {
    const name = findSecret(word);
    return name === null ? word : hidden(name);
  });
}

/* -------------------------------------------------------------------------- */
/* One line                                                                    */
/* -------------------------------------------------------------------------- */

function saysExtra(extra: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) continue;
    const said =
      typeof value === 'string'
        ? value
        : typeof value === 'number' || typeof value === 'boolean' || value === null
          ? String(value)
          : safeJson(value);
    parts.push(`${key}=${said.replace(/\s+/g, ' ').trim()}`);
  }
  return parts.join(' ');
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? '?';
  } catch {
    return '?';
  }
}

/** One line as it will be written: when, how loud, what, and the details.
 *  Pure, so the masking can be tested without a folder anywhere near it. */
export function maskedLine(
  level: Level,
  what: string,
  at: number,
  extra?: Record<string, unknown>,
): string {
  const when = new Date(at).toISOString();
  const details = extra === undefined ? '' : saysExtra(extra);
  const body = details === '' ? what : `${what} ${details}`;
  return mask(`${when} ${level.padEnd(5)} ${body.replace(/[\r\n]+/g, ' ⏎ ')}`);
}

/* -------------------------------------------------------------------------- */
/* Rotation                                                                    */
/* -------------------------------------------------------------------------- */

/** Whether the current file is full, and which of the old ones go.
 *
 *  `files` comes newest first — the one being written to, then the numbered
 *  ones behind it. Pure: the caller does the renaming and the deleting. */
export function rotate(
  files: readonly { name: string; bytes: number }[],
  caps: { keep: number; bytes: number },
): { roll: boolean; drop: readonly string[] } {
  const current = files[0];
  const roll = current !== undefined && current.bytes >= caps.bytes;
  // Rolling pushes a new empty file in front, so one more of the old ones has
  // to go than would otherwise.
  // Never below one: the file being written is not something to drop.
  const keepOld = Math.max(1, roll ? caps.keep - 1 : caps.keep);
  return { roll, drop: files.slice(keepOld).map((one) => one.name) };
}

/* -------------------------------------------------------------------------- */
/* The log itself                                                              */
/* -------------------------------------------------------------------------- */

function bytesOf(file: string): number {
  try {
    return statSync(file).size;
  } catch {
    return -1;
  }
}

/** The files in the folder, newest first: `graphe.log`, then `graphe.1.log` up. */
function present(folder: string): { name: string; bytes: number }[] {
  // Every name, present or not: a gap in the middle must not shift which file
  // falls off the end.
  const found = [{ name: CURRENT, bytes: Math.max(0, bytesOf(join(folder, CURRENT))) }];
  for (let n = 1; n < LOG_FILES; n += 1) {
    const name = `graphe.${String(n)}.log`;
    found.push({ name, bytes: Math.max(0, bytesOf(join(folder, name))) });
  }
  return found;
}

export function openLog(dir: string): Log {
  const folder = dir;
  const remembered: string[] = [];
  let shut = false;

  try {
    mkdirSync(folder, { recursive: true });
  } catch {
    // A folder we cannot make is a log we cannot keep; the app still runs.
  }

  function roll(): void {
    const files = present(folder);
    const { roll: needed, drop } = rotate(files, { keep: LOG_FILES, bytes: LOG_BYTES });
    for (const name of drop) {
      try {
        rmSync(join(folder, name), { force: true });
      } catch {
        /* keep going: a file we cannot remove is not worth a failed write */
      }
    }
    if (!needed) return;
    // Oldest first, so nothing overwrites a file that has not moved yet.
    for (let n = LOG_FILES - 2; n >= 1; n -= 1) {
      try {
        renameSync(join(folder, `graphe.${String(n)}.log`), join(folder, `graphe.${String(n + 1)}.log`));
      } catch {
        /* absent, which is the ordinary case */
      }
    }
    try {
      renameSync(join(folder, CURRENT), join(folder, 'graphe.1.log'));
    } catch {
      /* nothing to move */
    }
  }

  return {
    folder,

    line(level, what, extra) {
      if (shut) return;
      const text = maskedLine(level, what, Date.now(), extra);
      remembered.push(text);
      if (remembered.length > REMEMBERED) remembered.splice(0, remembered.length - REMEMBERED);
      try {
        if (bytesOf(join(folder, CURRENT)) >= LOG_BYTES) roll();
        appendFileSync(join(folder, CURRENT), `${text}\n`);
      } catch {
        // The line is still in `remembered`, so diagnostics gathered in this
        // run has it even when the disk does not.
      }
    },

    recent(n) {
      const want = Math.max(0, Math.trunc(n));
      if (want === 0) return [];
      // The file carries earlier runs as well, which is what somebody reporting
      // a failure after a restart needs.
      try {
        const lines = readFileSync(join(folder, CURRENT), 'utf8').split('\n').filter((one) => one !== '');
        if (lines.length >= remembered.length) return lines.slice(-want);
      } catch {
        /* memory it is */
      }
      return remembered.slice(-want);
    },

    close() {
      shut = true;
    },
  };
}
