/** Running somebody else's helper, without ever throwing at the caller.
 *
 * The one impure thing the landing features share. Every call comes back as an
 * exit code and two streams — a helper that is not installed is a code, not an
 * exception — so the modules above can decide what an absence means instead of
 * catching things.
 */

import * as noted from './spawned';
import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

export type Ran = {
  /** 127 when the helper is not on this computer at all. */
  code: number;
  out: string;
  errors: string;
  /** Both streams, for the sentence-deciding above and the disclosure below. */
  said: string;
};

/** True when nothing of that name could be found to run. */
export function notHere(ran: Ran): boolean {
  return ran.code === NOT_HERE;
}

const NOT_HERE = 127;

/** Long enough for a cold project to be got ready and sent; short enough that a
 *  wedged helper does not hold a button down all afternoon. */
const PATIENCE = 8 * 60_000;

/**
 * The places a helper might live, added to whatever we inherited.
 *
 * Same reason as `src/preview/show.ts`: an app opened from the dock inherits
 * almost no path, so everything a person installed is invisible to us while
 * being perfectly visible in their terminal.
 */
function searchPath(): string {
  const home = homedir();
  const extra = [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    join(home, '.volta', 'bin'),
    join(home, '.local', 'bin'),
    join(home, '.bun', 'bin'),
    join(home, '.npm-global', 'bin'),
  ];
  const already = (process.env['PATH'] ?? '').split(delimiter).filter(Boolean);
  return [...new Set([...already, ...extra])].join(delimiter);
}

export type RunOptions = {
  folder: string;
  patience?: number;
  /** Extra environment for this one call. */
  also?: Readonly<Record<string, string>>;
  /** Stop it early. A stopped helper is a code, like every other ending. */
  signal?: AbortSignal;
  /** Handed to the helper on its own input, for anything too long or too
   *  punctuated to survive being an argument. */
  input?: string;
};

/** One helper, once. Never throws — a failure is a code and some words. */
export function runHelper(
  tool: string,
  args: readonly string[],
  options: RunOptions,
): Promise<Ran> {
  return new Promise<Ran>((finished) => {
    const child = execFile(
      tool,
      [...args],
      {
        cwd: options.folder,
        timeout: options.patience ?? PATIENCE,
        maxBuffer: 32 * 1024 * 1024,
        windowsHide: true,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        env: {
          ...process.env,
          ...options.also,
          PATH: searchPath(),
          NO_COLOR: '1',
          // Nothing here can answer a question, so never let one be asked.
          CI: '1',
          GIT_TERMINAL_PROMPT: '0',
        },
      },
      (problem, out, errors) => {
        const said = [out, errors].filter((part) => part.trim() !== '').join('\n');
        if (problem === null) {
          finished({ code: 0, out, errors, said });
          return;
        }
        const failure = problem as NodeJS.ErrnoException & { code?: number | string };
        const code =
          failure.code === 'ENOENT'
            ? NOT_HERE
            : typeof failure.code === 'number'
              ? failure.code
              : 1;
        finished({ code, out, errors, said });
      },
    );
    // Written down while it runs, so quitting can take it with it. A helper
    // that outlives the app spends until it is done with nobody watching.
    noted.started({ pid: child.pid, what: tool, kind: 'helper' });
    child.once('exit', () => noted.ended(child.pid));
    if (options.input !== undefined) {
      child.stdin?.on('error', () => undefined);
      child.stdin?.end(options.input);
    }
  });
}
