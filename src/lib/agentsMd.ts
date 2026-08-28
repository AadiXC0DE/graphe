/** Read AGENTS.md hierarchy, Codex-compatible.
 *
 * Walks `~/.codex/AGENTS.md` → repo root → nested AGENTS.md, closest wins,
 * 32 KiB cap farthest truncated first. No writes, just reads.
 */

import { readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';

const BUDGET = 32 * 1024;

async function tryRead(path: string): Promise<string | null> {
  try {
    const text = await readFile(path, 'utf8');
    return text.trim() === '' ? null : text;
  } catch {
    return null;
  }
}

async function isGitRoot(dir: string): Promise<boolean> {
  try {
    const st = await stat(join(dir, '.git'));
    return st.isDirectory() || st.isFile();
  } catch {
    return false;
  }
}

export async function findGitRoot(project: string): Promise<string> {
  let cur = resolve(project);
  while (true) {
    if (await isGitRoot(cur)) return cur;
    const parent = dirname(cur);
    if (parent === cur) return cur;
    cur = parent;
  }
}

/** Collect AGENTS.md files from project upward to git root. */
export async function collectAgentsMd(project: string): Promise<readonly string[]> {
  const files: string[] = [];
  // Global first (lowest priority)
  const global = join(homedir(), '.codex', 'AGENTS.md');
  const globalText = await tryRead(global);
  if (globalText !== null) files.push(globalText);

  const gitRoot = await findGitRoot(project);

  // Walk project upward to git root inclusive
  let cur = resolve(project);
  const seen: string[] = [];
  let depth = 0;
  while (true) {
    const candidate = join(cur, 'AGENTS.md');
    const text = await tryRead(candidate);
    if (text !== null) seen.push(text);
    if (cur === gitRoot) break;
    const parent = dirname(cur);
    if (parent === cur) break;
    depth += 1;
    if (depth > 10) break;
    cur = parent;
  }
  // Closest wins — so reverse seen so closest last, then concat closest-last
  // But we want final order: global first, then farthest project upward, closest last
  // seen was collected closest-first, so reverse to farthest-first, then append
  seen.reverse();
  for (const text of seen) files.push(text);

  // Budget: truncate farthest first (keep closest)
  let total = files.reduce((sum, t) => sum + t.length + 2, 0);
  while (total > BUDGET && files.length > 1) {
    const dropped = files.shift();
    if (dropped !== undefined) total -= dropped.length + 2;
  }
  return files;
}

export async function readAgentsMd(project: string): Promise<string | null> {
  const parts = await collectAgentsMd(project);
  if (parts.length === 0) return null;
  return parts.join('\n\n---\n\n');
}
