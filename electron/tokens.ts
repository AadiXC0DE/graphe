/** Tokens through the model, read back from this computer's own transcripts.
 *
 * The session files are Pi's — one JSON object per line, each carrying the
 * moment it happened and, on the assistant's messages, the usage block the
 * provider reported. Nothing here prices anything: the counts are read as they
 * were reported, folded into local days by src/lib/token-days.ts, and handed
 * to the window when the cost screen asks.
 *
 * Reading is bounded twice — only files whose name starts inside the window
 * (the names begin with the session's own start stamp), and only lines that
 * mention a usage block at all. A transcript that cannot be parsed costs this
 * feature nothing but its own contribution.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { daysFromUsage, type TokenUsageView } from '../src/lib/token-days';

/** How far back the grid means to look: ten weeks of days, which is what fits
 *  a heatmap somebody can still read at panel size. */
const WINDOW_DAYS = 70;
const DAY = 24 * 60 * 60 * 1000;

/** Whether a file's start stamp falls inside the window. The stamp leads the
 *  name as `YYYY-MM-DDT…`, so the first ten characters date it exactly. */
function withinWindow(fileName: string, oldest: number): boolean {
  const at = Date.parse(`${fileName.slice(0, 10)}T00:00:00`);
  return Number.isFinite(at) && at >= oldest - DAY;
}

/** The tokens one line reports, or null when it reports none. Read
 *  structurally: Pi is pre-1.0 and the shape is what is worth trusting, not
 *  the name of a type that may move. */
function tokensIn(entry: unknown): { at: number; tokens: number } | null {
  if (entry === null || typeof entry !== 'object') return null;
  const one = entry as Record<string, unknown>;
  const at = Date.parse(String(one['timestamp'] ?? ''));
  if (!Number.isFinite(at)) return null;
  const message = one['message'];
  if (message === null || typeof message !== 'object') return null;
  const usage = (message as Record<string, unknown>)['usage'];
  if (usage === null || typeof usage !== 'object') return null;
  const fields = usage as Record<string, unknown>;
  const total = fields['totalTokens'];
  if (typeof total === 'number' && Number.isFinite(total) && total > 0) {
    return { at, tokens: total };
  }
  // Older transcripts report the parts and no sum. Add the parts; anything
  // missing counts as zero rather than blocking the day.
  let sum = 0;
  for (const key of ['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning']) {
    const value = fields[key];
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) sum += value;
  }
  return sum > 0 ? { at, tokens: sum } : null;
}

/** Every token this machine sent through a model in the window, by day. Null
 *  when there is nothing to read — an empty folder is "no answer", not zero
 *  days of zeros. */
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

  const entries: { at: number; tokens: number }[] = [];
  for (const file of files) {
    let text: string;
    try {
      text = await readFile(join(folder, file), 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split('\n')) {
      if (!line.includes('"usage"')) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      const found = tokensIn(parsed);
      if (found !== null) entries.push(found);
    }
  }
  if (entries.length === 0) return null;
  return daysFromUsage(entries);
}
