/** Putting it online, for real.
 *
 * ## Why one host, and why this one
 *
 * Three half-supported hosts would each fail differently on somebody's Tuesday
 * and none of them would be anybody's fault. One, done properly, can be told
 * the truth about: what it needs, whether it is here, and what it did.
 *
 * The choice is Vercel, on one criterion — how much a person who does not write
 * software has to do before the button works. Signing in is a browser round
 * trip with an account most people already have; a folder of finished pages
 * needs no configuration file; and the whole thing can be run without asking a
 * single question at a terminal nobody is looking at, which is the property
 * that rules out the alternatives. A host that stops to ask something is a host
 * that hangs forever inside a desktop app.
 *
 * ## Nothing goes without a press, and nothing goes with a key in it
 *
 * The caller is pressed before this is called, and this refuses on its own
 * account if the finished pages carry something that looks like a credential —
 * because the built output is exactly where a key ends up when nobody meant it
 * to, and the address is exactly where somebody would find it.
 */

import { pinnedSpec } from '../agent/pi/reach';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import type { ShowProgress } from '../lib/ipc';
import { makeAndServe } from '../preview/show';
import { addressIn, onlineWords, safeToPutOnline, type Made } from './online';
import { canPutOnline, type FoundForOnline } from './tools';
import { notHere, runHelper } from './run';

/** The helper, and the way to reach it when it is not installed. Fetching it on
 *  demand is only ever done inside a press that already said something would
 *  leave this computer. */
const HOST = 'vercel';
const FETCH = ['--yes', pinnedSpec('vercel')];

/** Files worth reading before any of them go public. Anything else is bytes. */
const WORDS = new Set(['.html', '.htm', '.js', '.mjs', '.cjs', '.css', '.json', '.txt', '.svg', '.md', '.xml', '.map']);

/** Enough to catch a key copied into the output; not so much that checking a
 *  large site takes longer than making it. */
const MOST_FILES = 400;
const MOST_BYTES = 2 * 1024 * 1024;

export type PutOnline = {
  /** Where it is, once it is. */
  address: string | null;
  /** How many pages went. */
  pages: number;
  says: string;
  /** The real command, for "Show me" and nowhere else. */
  steps: readonly string[];
};

/** Something we stopped at, already written for a person. */
export class OnlineError extends Error {
  readonly details: string;

  constructor(message: string, details = '') {
    super(message);
    this.name = 'OnlineError';
    this.details = details;
  }
}

/** How to reach the host on this computer, or null when there is no way. */
type Way = { tool: string; lead: readonly string[] };

async function howToReachIt(folder: string): Promise<Way | null> {
  const installed = await runHelper(HOST, ['--version'], { folder, patience: 20_000 });
  if (!notHere(installed)) return { tool: HOST, lead: [] };
  const fetcher = await runHelper('npx', ['--version'], { folder, patience: 20_000 });
  if (notHere(fetcher)) return null;
  return { tool: 'npx', lead: FETCH };
}

/**
 * Whether one press would work right now.
 *
 * Deliberately only looks at what is installed. Finding out any harder would
 * mean fetching the helper in order to ask it a question, and downloading
 * something across somebody's connection to draw a panel is exactly the kind of
 * thing this app must never do behind a person's back. Pressing the button does
 * fetch it, because by then they have said so.
 */
export async function whatIsHereForOnline(folder: string): Promise<FoundForOnline> {
  const installed = await runHelper(HOST, ['--version'], { folder, patience: 20_000 });
  if (notHere(installed)) return { helper: false, signedIn: false };
  const who = await runHelper(HOST, ['whoami'], { folder, patience: 45_000 });
  return { helper: true, signedIn: who.code === 0 && who.out.trim() !== '' };
}

/** Every readable file of the finished site, bounded. */
async function whatWouldGoPublic(root: string): Promise<{ made: Made[]; pages: number }> {
  const made: Made[] = [];
  let pages = 0;
  const walk = async (where: string, depth: number): Promise<void> => {
    if (depth > 8 || made.length >= MOST_FILES) return;
    let entries;
    try {
      entries = await readdir(where, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (made.length >= MOST_FILES) return;
      const full = path.join(where, entry.name);
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      const extension = path.extname(entry.name).toLowerCase();
      if (extension === '.html' || extension === '.htm') pages += 1;
      const relative = path.relative(root, full).split(path.sep).join('/');
      if (!WORDS.has(extension)) {
        made.push({ path: relative, text: '' });
        continue;
      }
      let text = '';
      try {
        const bytes = await readFile(full);
        text = bytes.length > MOST_BYTES ? bytes.subarray(0, MOST_BYTES).toString('utf8') : bytes.toString('utf8');
      } catch {
        text = '';
      }
      made.push({ path: relative, text });
    }
  };
  await walk(root, 0);
  return { made, pages };
}

export type PutOnlineOptions = {
  folder: string;
  /** Told each time there is something new worth saying. */
  says: (progress: ShowProgress) => void;
};

/**
 * Get the project ready, check what would become public, and put it online.
 *
 * The getting-ready is "See it"'s own, so the thing that goes online is exactly
 * the thing the person has been looking at — including the rule that we never
 * serve or send what a developer runs while working.
 */
export async function putOnline(options: PutOnlineOptions): Promise<PutOnline> {
  // Asked again here rather than trusted from the panel, and this time the
  // helper may be fetched: the press has happened, and it already said that
  // something was about to leave.
  const way = await howToReachIt(options.folder);
  if (way === null) throw new OnlineError(onlineWords.cannot);
  const who = await runHelper(way.tool, [...way.lead, 'whoami'], {
    folder: options.folder,
    patience: 120_000,
  });
  const can = canPutOnline({ helper: true, signedIn: who.code === 0 && who.out.trim() !== '' });
  if (!can.all) throw new OnlineError(onlineWords.notSignedIn);

  options.says({ says: onlineWords.working, done: false });

  const ready = await makeAndServe({ folder: options.folder, says: () => undefined });
  if (ready.kind !== 'showing') throw new OnlineError(ready.question);
  const made = ready.serving.folder;
  await ready.serving.stop().catch(() => undefined);

  const looked = await whatWouldGoPublic(made);
  if (looked.pages === 0) throw new OnlineError(onlineWords.nothingToPut);

  const safe = safeToPutOnline(looked.made);
  if (!safe.ok) throw new OnlineError(safe.because);

  const steps = [`${HOST} deploy ${made} --prod --yes`];
  const sent = await runHelper(
    way.tool,
    [...way.lead, 'deploy', made, '--prod', '--yes'],
    { folder: options.folder },
  );
  if (sent.code !== 0) throw new OnlineError(onlineWords.couldNotPut, sent.said);

  const address = addressIn(sent.said);
  return {
    address,
    pages: looked.pages,
    says: address === null ? onlineWords.noAddress : onlineWords.live,
    steps,
  };
}
