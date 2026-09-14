/** Which folder this run of the app keeps everything in.
 *
 * Every file the shell writes — sessions, the workspace index, conversation
 * checkouts, logs, the trash, caches — is asked for as `app.getPath('userData')`.
 * Moving that one path is therefore the whole of what a disposable profile is:
 * a test, or a second copy of the app somebody wants to keep apart from their
 * own, names a folder and everything follows.
 *
 * The deciding is here rather than in the shell so it can be tested without
 * Electron: `profileRoot` and its neighbours take `argv`, the environment and
 * the app's own default as plain values, and `applyProfile` is the only part
 * that touches the app.
 *
 * An override that is not absolute is refused rather than guessed at. A path is
 * resolved against whatever directory the process was started from, which for a
 * bundled app is not the directory anybody typed it in, and a test profile that
 * quietly lands inside the repository is worse than one that will not start.
 */

import { mkdirSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

/** Names a profile root. Read first, so it wins over the switch. */
export const PROFILE_ENV = 'GRAPHE_PROFILE';

/** The switch, in both spellings: `--profile=<path>` and `--profile <path>`. */
export const PROFILE_SWITCH = '--profile';

/** Pi's own credential and model folder, which is where signing in writes.
 *  Outside a profile it is `~/.pi/agent` — the user's real one. */
export const AGENT_DIR_ENV = 'PI_CODING_AGENT_DIR';

/** Where the profile came from, for the log line and for diagnostics. */
export type ProfileSource = 'env' | 'argv' | 'user-data';

export type Profile = {
  /** Absolute. Everything the app writes resolves under here. */
  root: string;
  source: ProfileSource;
  /** Pi's credential folder for this profile, or null to leave Pi's own
   *  `~/.pi/agent` alone. Only a disposable profile moves it: an app that
   *  relocated a real person's sign-ins on an upgrade would look like it had
   *  forgotten them. */
  agent: string | null;
  /** What the app would have used with nothing named. */
  fallback: string;
};

/** Pi's credential folder inside a profile. */
export const AGENT_FOLDER = 'agent';

/** The named path, or null when nothing was named.
 *
 *  Empty is nothing: `GRAPHE_PROFILE=` in a shell is a variable somebody meant
 *  to set, and a folder with no name is not a folder. */
function named(where: string, value: string | undefined): string | null {
  const trimmed = (value ?? '').trim();
  if (trimmed === '') return null;
  if (!isAbsolute(trimmed)) {
    throw new Error(`${where} must be an absolute path, got ${JSON.stringify(trimmed)}`);
  }
  return resolve(trimmed);
}

/** The path the switch names, if it is there.
 *
 *  Electron's own argv is what this reads, and it holds the app path, flags
 *  Chromium wants and flags of ours side by side, so the switch is looked for
 *  rather than expected in a position. A trailing `--profile` with nothing after
 *  it names nothing. */
function fromArgv(argv: readonly string[]): string | null {
  for (let at = 0; at < argv.length; at += 1) {
    const one = argv[at] ?? '';
    if (one === PROFILE_SWITCH) {
      const next = argv[at + 1];
      if (next === undefined || next.startsWith('--')) return null;
      return named(PROFILE_SWITCH, next);
    }
    if (one.startsWith(`${PROFILE_SWITCH}=`)) {
      return named(PROFILE_SWITCH, one.slice(PROFILE_SWITCH.length + 1));
    }
  }
  return null;
}

/** The profile this run uses: the environment first, then the switch, then the
 *  app's own folder. */
export function resolveProfile(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  fallback: string,
): Profile {
  const asked = named(PROFILE_ENV, env[PROFILE_ENV]);
  const path = asked ?? fromArgv(argv);
  if (path !== null) {
    return {
      root: path,
      source: asked === null ? 'argv' : 'env',
      agent: join(path, AGENT_FOLDER),
      fallback: resolve(fallback),
    };
  }
  const root = resolve(fallback);
  return { root, source: 'user-data', agent: null, fallback: root };
}

/** Just the folder. */
export function profileRoot(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  fallback: string,
): string {
  return resolveProfile(argv, env, fallback).root;
}

/** True when somebody named the folder, so nothing here is the app's own
 *  profile. The app may seed, clear and throw away a disposable profile; it may
 *  not do any of that to a real one. */
export function isDisposableProfile(profile: Profile): boolean {
  return profile.source !== 'user-data';
}

/** One line for the log: which folder, and who asked for it. Never the contents
 *  of anything, only the path somebody wrote down themselves. */
export function describeProfile(profile: Profile): string {
  if (profile.source === 'user-data') return `profile ${profile.root} (the app's own folder)`;
  const who = profile.source === 'env' ? PROFILE_ENV : PROFILE_SWITCH;
  return `profile ${profile.root} (from ${who})`;
}

/** The bit of Electron this needs, so the module can be tested without it. */
export type ProfileHost = {
  getPath(name: 'userData'): string;
  setPath(name: 'userData', path: string): void;
};

/**
 * Point the app at its profile. Call before the app is ready — the session
 * folder, the log and Electron's own caches are all opened on the way up, and a
 * path changed afterwards leaves some of them behind.
 *
 * With nothing named this does nothing at all: the app keeps using its own
 * folder, and Pi keeps its own `~/.pi/agent`.
 */
export function applyProfile(
  app: ProfileHost,
  argv: readonly string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env,
): Profile {
  const profile = resolveProfile(argv, env, app.getPath('userData'));
  if (!isDisposableProfile(profile)) return profile;
  // Electron creates `userData` on the way to ready, but Pi and the log are
  // asked for a path before that; an existing folder is one less thing to fail.
  mkdirSync(profile.root, { recursive: true });
  app.setPath('userData', profile.root);
  // Pi's own variable, so one that is already set wins: somebody who set it
  // meant it. Otherwise the credentials land beside the rest of the profile.
  if (profile.agent !== null && (env[AGENT_DIR_ENV] ?? '').trim() === '') {
    env[AGENT_DIR_ENV] = profile.agent;
  }
  return profile;
}
