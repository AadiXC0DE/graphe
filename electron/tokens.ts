/** Tokens and money through the model, read back from this computer's own
 *  transcripts.
 *
 * The session files are Pi's — one JSON object per line, each carrying the
 * moment it happened and, on the assistant's messages, the usage block the
 * provider reported. Nothing here prices anything: the counts and the price
 * Pi already worked out are read as they were reported, folded into local days
 * by src/lib/token-days.ts, and handed to the window when the cost screen asks.
 *
 * Reading is bounded twice — only files whose name starts inside the window
 * (the names begin with the session's own start stamp), and only lines that
 * mention a usage block at all. A transcript that cannot be parsed costs this
 * feature nothing but its own contribution.
 */

import { readdir, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { titleOf } from '../src/agent/pi/conversations';
import { shortModelName } from '../src/agent/pi/usage';
import { daysFromUsage, type TokenUsageView, type UsageEntry } from '../src/lib/token-days';

/** How far back the chart means to look: enough days to cover a calendar month
 *  and the thirty-day bar chart in front of it. */
const WINDOW_DAYS = 70;
const DAY = 24 * 60 * 60 * 1000;

/** Whether a file's start stamp falls inside the window. The stamp leads the
 *  name as `YYYY-MM-DDT…`, so the first ten characters date it exactly. */
function withinWindow(fileName: string, oldest: number): boolean {
  const at = Date.parse(`${fileName.slice(0, 10)}T00:00:00`);
  return Number.isFinite(at) && at >= oldest - DAY;
}

/** The session id a transcript's name carries, after the start stamp. */
function idOf(fileName: string): string {
  const cut = fileName.replace(/\.jsonl$/, '');
  const under = cut.indexOf('_');
  return under < 0 ? cut : cut.slice(under + 1);
}

/** A non-negative finite number, or 0. Usage blocks sometimes ship 0 rather
 *  than omitting a field, and both mean the same thing to us. */
function countAt(source: Record<string, unknown>, key: string): number {
  const value = source[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0;
  return value;
}

function fieldsOf(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** The first thing the person typed, which is what the conversation is called
 *  everywhere else in the app. */
function saidIn(entry: Record<string, unknown>): string | null {
  const message = fieldsOf(entry['message']);
  if (message === null || message['role'] !== 'user') return null;
  const content = message['content'];
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return null;
  for (const part of content) {
    const piece = fieldsOf(part);
    const text = piece?.['text'];
    if (typeof text === 'string' && text.trim() !== '') return text;
  }
  return null;
}

/** What one line reports, or null when it reports nothing priced. Read
 *  structurally: Pi is pre-1.0 and the shape is what is worth trusting, not
 *  the name of a type that may move. */
function usageIn(entry: unknown): UsageEntry | null {
  const one = fieldsOf(entry);
  if (one === null) return null;
  const at = Date.parse(String(one['timestamp'] ?? ''));
  if (!Number.isFinite(at)) return null;
  const message = fieldsOf(one['message']);
  if (message === null) return null;
  const usage = fieldsOf(message['usage']);
  if (usage === null) return null;

  const input = countAt(usage, 'input');
  const output = countAt(usage, 'output');
  const cached = countAt(usage, 'cacheRead');
  const total = usage['totalTokens'];
  let tokens =
    typeof total === 'number' && Number.isFinite(total) && total > 0 ? total : 0;
  if (tokens === 0) {
    // Older transcripts report the parts and no sum. Add the parts; anything
    // missing counts as zero rather than blocking the day.
    for (const key of ['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning']) {
      tokens += countAt(usage, key);
    }
  }
  if (tokens <= 0) return null;

  const cost = fieldsOf(usage['cost']);
  const priced = cost === null ? 0 : countAt(cost, 'total');
  const named =
    (typeof message['responseModel'] === 'string' ? message['responseModel'] : '') ||
    (typeof message['model'] === 'string' ? message['model'] : '');
  return {
    at,
    tokens,
    cost: priced,
    input,
    output,
    cached,
    ...(named === '' ? {} : { model: shortModelName(named) }),
  };
}

/** Every token and every penny this machine sent through a model in the
 *  window, by day, by model and by conversation. Null when there is nothing to
 *  read — an empty folder is "no answer", not zero days of zeros. */
export async function readTokenUsage(
  folder: string,
  now: number = Date.now(),
): Promise<TokenUsageView | null> {
  let names: readonly string[];
  try {
    names = await readdir(folder);
  } catch {
    return null;
  }
  const oldest = now - WINDOW_DAYS * DAY;
  const files = names.filter((one) => one.endsWith('.jsonl') && withinWindow(one, oldest)).sort();
  if (files.length === 0) return null;

  const entries: UsageEntry[] = [];
  for (const file of files) {
    const path = join(folder, file);
    let text: string;
    try {
      text = await readFile(path, 'utf8');
    } catch {
      continue;
    }
    const mine: UsageEntry[] = [];
    let firstSaid: string | null = null;
    let startedAt = Date.parse(`${file.slice(0, 10)}T00:00:00`);
    for (const line of text.split('\n')) {
      if (line === '') continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      const fields = fieldsOf(parsed);
      if (fields === null) continue;
      if (firstSaid === null) {
        firstSaid = saidIn(fields);
        const when = Date.parse(String(fields['timestamp'] ?? ''));
        if (firstSaid !== null && Number.isFinite(when)) startedAt = when;
      }
      if (!line.includes('"usage"')) continue;
      const found = usageIn(fields);
      if (found !== null) mine.push(found);
    }
    if (mine.length === 0) continue;
    const conversation = {
      id: idOf(basename(file)),
      title: titleOf(firstSaid ?? '', Number.isFinite(startedAt) ? startedAt : now),
      path,
    };
    for (const one of mine) entries.push({ ...one, conversation });
  }
  if (entries.length === 0) return null;
  return daysFromUsage(entries);
}
