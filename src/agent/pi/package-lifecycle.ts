/** What happens to a conversation when the add-ons change.
 *
 * A session is built with the add-ons that were installed at the moment it
 * opened: their factories ran, their tools were registered into it. Installing,
 * updating or removing one afterwards changes nothing about a session that is
 * already going — so somebody installs a thing, watches it do nothing, and has
 * no way to tell whether it is broken or simply not loaded. This file holds the
 * two halves of the honest answer:
 *
 *  - a change is one transaction, run one at a time, with the version that was
 *    there before it starts written down. Two installs at once is how a
 *    half-written folder ends up in the cache.
 *  - a session that was open when a change landed is `activation pending`, and
 *    says so in exactly these words. Reloading the chat rebuilds the session
 *    from the same transcript, model, permissions, draft and workspace, which
 *    is why reloading is a safe thing to ask for.
 */

/** One change to what is installed, and what it replaced. */
export type PackageChange = {
  id: string;
  doing: 'install' | 'update' | 'remove';
  /** What was installed before this ran; null when nothing was, or when
   *  nothing could say. */
  before: { version: string | null } | null;
  /** What is on disk now; null after a removal. */
  after: { version: string | null } | null;
};

/** One line about a change while it is happening or once it has. */
export type PackageProgress = {
  says: string;
  id: string;
  doing: PackageChange['doing'];
  /** False while it is happening, true when it is over. */
  done: boolean;
};

/** What a conversation that was open while an add-on was installed says, and
 *  the exact words: this is the state somebody is looking at, so it is one
 *  sentence everywhere rather than a paraphrase per screen. */
export const RELOAD_TO_ACTIVATE = 'Installed; reload this chat to activate';

/** The same for one that went away. A session holding a removed add-on is the
 *  mirror of one that cannot see a new one. */
export const RELOAD_TO_LET_GO = 'Removed; reload this chat to let it go';

/** What a session says about a change that landed under it. The three cases are
 *  an install, an update and a removal: the first two bring something a running
 *  session has never loaded, the third leaves it holding something that is gone,
 *  and all three are answered by building the session again. */
export function reloadWords(change: PackageChange): string {
  return change.doing === 'remove' ? RELOAD_TO_LET_GO : RELOAD_TO_ACTIVATE;
}

/**
 * One transaction at a time, in the order they were asked for.
 *
 * Installing is npm over a folder both the installer and the next session read:
 * two of them at once is a half-populated `node_modules` that a probe then
 * fingerprints, so the card written down describes a folder that never existed.
 * Failures do not stop the queue — the next change is not the last one's fault.
 */
export function oneAtATime(): <T>(work: () => Promise<T>) => Promise<T> {
  let queue: Promise<unknown> = Promise.resolve();
  return <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.then(work, work);
    queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };
}
