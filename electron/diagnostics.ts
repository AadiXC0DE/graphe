/** What "Copy diagnostics" copies.
 *
 * When somebody says "it stopped", this is the message they can paste back: the
 * version, the machine, which add-ons are installed and what they are allowed
 * to do, the last lines of the log, why the last run ended, and how much disk
 * the app is holding.
 *
 * What it never carries: the words of any conversation, any file the agent
 * read, and any credential. The log lines arrive already masked; the
 * why-stopped sentence is masked here as well, because it comes from a run.
 */

import { readdir, stat } from 'node:fs/promises';
import { arch, platform, release } from 'node:os';
import { join } from 'node:path';

import type { CapabilityCard } from '../src/agent/pi/extension-probe';
import { saysCard } from '../src/agent/pi/extension-probe';
import { capsNow, saysCaps, type Caps } from '../src/work/capacity';
import { mask } from './log';

/** Enough to see the shape of what happened without pasting a novel. */
export const LOG_LINES = 200;

export type Diagnostics = {
  version: string;
  /** `darwin 24.6.0 arm64` — the machine, in the terms an issue needs. */
  os: string;
  versions: { electron: string; node: string; chromium: string };
  extensions: readonly CapabilityCard[];
  caps: Caps;
  folders: readonly { name: string; bytes: number }[];
  log: readonly string[];
  /** The last run's ending, in Graphe's own words. */
  whyStopped: string;
  at: number;
};

export type Gathering = {
  version: string;
  userData: string;
  versions: { electron: string; node: string; chromium: string };
  extensions: readonly CapabilityCard[];
  whyStopped: string;
  /** The log's own `recent`. Injected so this can be gathered without one. */
  recent: (n: number) => readonly string[];
  caps?: Caps;
  now?: number;
};

function osLine(): string {
  return `${platform()} ${release()} ${arch()}`;
}

export async function gather(input: Gathering): Promise<Diagnostics> {
  return {
    version: input.version,
    os: osLine(),
    versions: input.versions,
    extensions: input.extensions,
    caps: input.caps ?? capsNow(),
    folders: await folderSizes(input.userData),
    log: input.recent(LOG_LINES),
    whyStopped: input.whyStopped,
    at: input.now ?? Date.now(),
  };
}

/* -------------------------------------------------------------------------- */
/* Disk                                                                        */
/* -------------------------------------------------------------------------- */

async function bytesUnder(path: string): Promise<number> {
  let total = 0;
  const left = [path];
  while (left.length > 0) {
    const here = left.pop();
    if (here === undefined) continue;
    let entries;
    try {
      entries = await readdir(here, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(here, entry.name);
      if (entry.isDirectory()) {
        left.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      try {
        total += (await stat(full)).size;
      } catch {
        /* gone between the listing and the look */
      }
    }
  }
  return total;
}

/** What each folder under `userData` is holding, largest first. The answer to
 *  "why is this app four gigabytes", which is usually one folder. */
export async function folderSizes(
  userData: string,
): Promise<readonly { name: string; bytes: number }[]> {
  let entries;
  try {
    entries = await readdir(userData, { withFileTypes: true });
  } catch {
    return [];
  }
  const sizes: { name: string; bytes: number }[] = [];
  for (const entry of entries) {
    const full = join(userData, entry.name);
    if (entry.isDirectory()) {
      sizes.push({ name: entry.name, bytes: await bytesUnder(full) });
      continue;
    }
    if (!entry.isFile()) continue;
    try {
      sizes.push({ name: entry.name, bytes: (await stat(full)).size });
    } catch {
      /* skip */
    }
  }
  return sizes.sort((a, b) => b.bytes - a.bytes);
}

/* -------------------------------------------------------------------------- */
/* The text                                                                    */
/* -------------------------------------------------------------------------- */

function saysBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let n = bytes / 1024;
  let at = 0;
  while (n >= 1024 && at < units.length - 1) {
    n /= 1024;
    at += 1;
  }
  return `${n < 10 ? n.toFixed(1) : String(Math.round(n))} ${units[at] ?? 'KB'}`;
}

/** The bundle as text, ready for the clipboard. */
export function saysDiagnostics(d: Diagnostics): string {
  const lines: string[] = [
    `Graphe ${d.version}`,
    `at        ${new Date(d.at).toISOString()}`,
    `machine   ${d.os}`,
    `built on  Electron ${d.versions.electron} · Node ${d.versions.node} · Chromium ${d.versions.chromium}`,
    `at once   ${saysCaps(d.caps)}`,
    '',
    'Add-ons',
  ];

  if (d.extensions.length === 0) lines.push('  none installed');
  else for (const card of d.extensions) lines.push(`  ${card.id}: ${saysCard(card)}`);

  lines.push('', 'Disk');
  if (d.folders.length === 0) lines.push('  nothing to report');
  else for (const one of d.folders) lines.push(`  ${one.name}: ${saysBytes(one.bytes)}`);

  lines.push('', 'Why the last run stopped', `  ${mask(d.whyStopped).trim() || 'not recorded'}`);

  lines.push('', `Log, last ${String(d.log.length)} lines`);
  if (d.log.length === 0) lines.push('  nothing written yet');
  else for (const line of d.log) lines.push(`  ${line}`);

  lines.push('', 'No conversations, files or keys are in this.');
  return lines.join('\n');
}
