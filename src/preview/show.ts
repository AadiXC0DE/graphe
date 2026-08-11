/** "See it" — get the project ready, then open the ready thing.
 *
 * BACKLOG C1. Nobody knows what a development address is, and nobody should have
 * to: one button, and their own browser opens showing their own site.
 *
 * The order is the feature, and it is fixed by notes/strategy/SHARING.md §1.
 * Make the site, then serve what was made. Never the thing a developer runs
 * while they are working — that has had eight documented filesystem escapes
 * since March 2025, and the next one is not written yet. Making first deletes
 * that entire class of problem, along with the module graph, the live-reload
 * socket and the source maps, in one decision.
 *
 * What we lose is that the page does not update while they look at it. That is a
 * fair trade for not handing somebody's private files to a browser, and it is
 * recoverable later by making it again when something changes.
 *
 * ## Everything said here is said in plain words
 *
 * Two sentences, in order: "Putting your site together…", then "Ready". No
 * percentages, no output, no counts. If it fails, the reason goes through the
 * shell's own translation and the raw text lives behind "Show technical
 * details", which is the one place it is allowed.
 */

import { execFile } from 'node:child_process';
import { readFile, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

import { showWords, type ShowProgress } from '../lib/ipc';
import { COULD_NOT_FIND_IT, readTheFolder, type Look, type Manifest } from './detect';
import type { Pointed } from './point';
import { serveFolder, type Serving } from './serve';

/** Something that stopped us, with the raw text kept for the disclosure. */
export class ShowError extends Error {
  readonly details: string;

  constructor(message: string, details = '') {
    super(message);
    this.name = 'ShowError';
    this.details = details;
  }
}

/** Every sentence this module can put in front of somebody. One place, so it can
 *  be read as a whole and swept for the vocabulary we have retired. */
export const showSays = {
  ...showWords,
  noHelper:
    'Your project needs a tool this computer does not seem to have, so I could not get it ready.',
  didNotFinish: 'I could not get your site ready.',
  tookTooLong:
    'Getting your site ready took long enough that I stopped waiting. Nothing has been changed.',
} as const;

export type ShowResult =
  | { kind: 'showing'; serving: Serving }
  /** We could not tell what to do. Ask, in these words. */
  | { kind: 'unsure'; question: string };

export type ShowOptions = {
  folder: string;
  /** Told each time there is something new worth saying. */
  says: (progress: ShowProgress) => void;
  /** How long to wait for one step. Long enough for a cold project, short enough
   *  that a wedged one does not hold the button down forever. */
  patience?: number;
  /** Told about the element somebody clicked in the preview. */
  onPointed?: (pointed: Pointed) => void;
};

const PATIENCE = 6 * 60_000;

/**
 * The places a tool might live, added to whatever we inherited.
 *
 * An app opened from the dock inherits almost no path — macOS gives a GUI
 * process `/usr/bin:/bin:/usr/sbin:/sbin` and nothing else, so everything a
 * designer installed is invisible to us while being perfectly visible in their
 * terminal. That failure looks exactly like "the app is broken", so it is worth
 * the four lines.
 */
function searchPath(): string {
  const home = homedir();
  const extra = [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    join(home, '.volta', 'bin'),
    join(home, '.local', 'bin'),
    join(home, '.bun', 'bin'),
  ];
  const already = (process.env['PATH'] ?? '').split(delimiter).filter(Boolean);
  return [...new Set([...already, ...extra])].join(delimiter);
}

/** Run one thing, in the project's folder, with no shell in the way. */
async function run(
  tool: string,
  args: readonly string[],
  folder: string,
  patience: number,
): Promise<void> {
  try {
    await new Promise<void>((finished, failed) => {
      execFile(
        tool,
        [...args],
        {
          cwd: folder,
          timeout: patience,
          maxBuffer: 32 * 1024 * 1024,
          windowsHide: true,
          env: { ...process.env, PATH: searchPath(), NO_COLOR: '1', CI: '1' },
        },
        (problem, out, errors) => {
          if (problem === null) {
            finished();
            return;
          }
          const failure = problem as NodeJS.ErrnoException & { killed?: boolean };
          if (failure.code === 'ENOENT') {
            failed(new ShowError(showSays.noHelper, `${tool}: not found`));
            return;
          }
          if (failure.killed === true) {
            failed(new ShowError(showSays.tookTooLong, [errors, out].join('\n').trim()));
            return;
          }
          failed(
            new ShowError(
              showSays.didNotFinish,
              [errors, out].filter((part) => part.trim() !== '').join('\n'),
            ),
          );
        },
      );
    });
  } catch (cause) {
    if (cause instanceof ShowError) throw cause;
    throw new ShowError(showSays.didNotFinish, cause instanceof Error ? cause.message : '');
  }
}

/** A glance at the top of the folder. Unreadable is the same as empty here —
 *  the recipe below already knows how to say "I could not tell". */
export async function lookAt(folder: string): Promise<Look> {
  let entries: string[] = [];
  try {
    entries = await readdir(folder);
  } catch {
    entries = [];
  }

  let manifest: Manifest | null = null;
  if (entries.includes('package.json')) {
    try {
      const parsed: unknown = JSON.parse(await readFile(join(folder, 'package.json'), 'utf8'));
      manifest = typeof parsed === 'object' && parsed !== null ? (parsed as Manifest) : null;
    } catch {
      manifest = null;
    }
  }

  return { entries, manifest };
}

/** The first of the likely places that exists and has a page in it. */
async function whereItLanded(
  folder: string,
  outputs: readonly string[],
): Promise<string | null> {
  for (const candidate of outputs) {
    const where = resolve(folder, candidate);
    try {
      const found = await stat(join(where, 'index.html'));
      if (found.isFile()) return where;
    } catch {
      // Not this one.
    }
  }
  return null;
}

/**
 * Get the project ready and start reading it out to this machine.
 *
 * Returns without a server when the folder cannot be read confidently — that is
 * a question for the person, not a guess for us.
 */
export async function makeAndServe(options: ShowOptions): Promise<ShowResult> {
  const folder = resolve(options.folder);
  const patience = options.patience ?? PATIENCE;
  const ways = { onPointed: options.onPointed };
  const recipe = readTheFolder(await lookAt(folder));

  if (recipe.kind === 'unsure') return { kind: 'unsure', question: recipe.question };

  if (recipe.kind === 'as-is') {
    options.says({ says: showSays.puttingTogether, done: false });
    const serving = await serveFolder(folder, ways);
    options.says({ says: showSays.ready, done: true });
    return { kind: 'showing', serving };
  }

  if (recipe.needsPieces) {
    options.says({ says: showSays.gettingPieces, done: false });
    await run(recipe.helper, ['install'], folder, patience);
  }

  options.says({ says: showSays.puttingTogether, done: false });
  await run(recipe.helper, ['run', recipe.script], folder, patience);

  const made = await whereItLanded(folder, recipe.outputs);
  if (made === null) return { kind: 'unsure', question: COULD_NOT_FIND_IT };

  const serving = await serveFolder(made, ways);
  options.says({ says: showSays.ready, done: true });
  return { kind: 'showing', serving };
}
