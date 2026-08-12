/** What this computer can actually do, and what to say when it cannot.
 *
 * Landing work somewhere depends on things we did not install and cannot
 * assume: the helper that talks to where a team keeps its work, the helper that
 * puts a site online, an account signed in to each. Every one of those is
 * looked for rather than assumed, and every absence has a sentence.
 *
 * Pure. The looking happens in `developer.ts` and `publish.ts`; deciding what
 * the looking means happens here, where it can be tested without either.
 */

/** What was found on this machine, once somebody has gone and looked. */
export type Found = {
  /** The helper that talks to where the team keeps this project. */
  helper: boolean;
  /** An account signed in to it. */
  signedIn: boolean;
  /** Where the shared copy of this project lives, as `owner/name`. Null when
   *  this project has no shared copy at all. */
  home: string | null;
  /** What everyone else works from, by name. Never written to. */
  theProjectItself: string | null;
};

/** The same question, for putting a site online. */
export type FoundForOnline = { helper: boolean; signedIn: boolean };

export const toolWords = {
  /** The helper is not here. Said without naming a command — the real name
   *  lives under "Show me", where names are allowed. */
  noHelper:
    'This computer has nothing set up to reach where your team keeps this project, so I have left the work ready in your own folder instead.',
  notSignedIn:
    'This computer has the right helper but is not signed in to your team’s account, so I have left the work ready in your own folder instead.',
  noHome:
    'This project is not kept anywhere shared, so there is nowhere for me to send the work to. It is ready in your own folder.',
  ready: 'Everything needed is here.',
  onlineNoHelper: 'This computer has nothing set up to put a project online.',
  onlineNotSignedIn: 'This computer is not signed in to the place I put projects online.',
} as const;

/** Whether the work can be sent all the way, and the sentence when it cannot. */
export type CanSend = { all: boolean; says: string };

/**
 * Can this go the whole way, or only as far as the person's own folder?
 *
 * The order matters: the first missing thing is the one worth saying, because
 * a person told about three problems at once fixes none of them.
 */
export function canSendItOn(found: Found): CanSend {
  if (!found.helper) return { all: false, says: toolWords.noHelper };
  if (!found.signedIn) return { all: false, says: toolWords.notSignedIn };
  if (found.home === null) return { all: false, says: toolWords.noHome };
  return { all: true, says: toolWords.ready };
}

export function canPutOnline(found: FoundForOnline): CanSend {
  if (!found.helper) return { all: false, says: toolWords.onlineNoHelper };
  if (!found.signedIn) return { all: false, says: toolWords.onlineNotSignedIn };
  return { all: true, says: toolWords.ready };
}

/* -------------------------------------------------------------------------- */
/* Reading what the helpers say back                                           */
/* -------------------------------------------------------------------------- */

/** `owner/name`, and nothing that could be a path or an address. */
const HOME = /^[A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*$/;

/**
 * Where this project is kept, out of what the helper reported.
 *
 * Anything unexpected reads as "nowhere shared" rather than as a failure: a
 * folder that is not kept anywhere is an ordinary thing for a project to be,
 * and it has its own sentence already.
 */
export function readWhereItLives(raw: string): { home: string | null; theProjectItself: string | null } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { home: null, theProjectItself: null };
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { home: null, theProjectItself: null };
  }
  const record = parsed as Record<string, unknown>;
  const named = record['nameWithOwner'];
  const home = typeof named === 'string' && HOME.test(named) ? named : null;

  const theirs = record['defaultBranchRef'];
  const name =
    typeof theirs === 'object' && theirs !== null
      ? (theirs as Record<string, unknown>)['name']
      : null;
  const itself = typeof name === 'string' && name.trim() !== '' ? name.trim() : null;

  return { home, theProjectItself: itself };
}

/**
 * Is somebody signed in?
 *
 * Read from what came back rather than from the exit code alone, because the
 * helper reports "logged in" on the error stream when it is happy and on the
 * error stream when it is not. Both streams go in; the words decide.
 */
export function readSignedIn(exitCode: number, said: string): boolean {
  if (exitCode !== 0) return false;
  return !/not logged in|no accounts|you are not|log in to/i.test(said);
}

/** The account name a host printed, or null. Used for nothing but deciding
 *  whether there is one. */
export function readAccount(exitCode: number, said: string): string | null {
  if (exitCode !== 0) return null;
  const line = said
    .split('\n')
    .map((one) => one.trim())
    .filter((one) => one !== '' && !one.startsWith('>') && !/error/i.test(one))
    .pop();
  return line === undefined || line === '' ? null : line;
}
