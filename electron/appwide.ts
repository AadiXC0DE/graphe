/** The few things that are true of this machine rather than of a conversation.
 *
 * Said app-wide rather than into a thread, because the moment they matter most
 * is the first launch of a packaged build on a Mac with no command line tools:
 * there is no project open, no conversation and nothing in front to say it in,
 * and a notice sent into a conversation that does not exist yet is a notice
 * nobody ever sees.
 *
 * Pure. What the probes found is handed in; what to say about it is decided
 * here, and tested here.
 */

import { APP_NOTICE, type AppNotice } from '../src/lib/ipc';

export const appWideWords = {
  noGit: {
    id: APP_NOTICE.noGit,
    what: 'This Mac does not have git yet, and I keep every version of your work in it.',
    because:
      'macOS installs it with the command line tools: run xcode-select --install in Terminal. Chats and files work meanwhile; the git actions stay out of the way until it is there.',
  },
  noNpm: {
    id: APP_NOTICE.noNpm,
    what: 'This Mac does not have npm on the path, and that is how add-ons are installed.',
    because: 'Install Node, then reopen Graphe. Start it from a terminal that has npm and it will be found.',
  },
} as const satisfies Record<string, AppNotice>;

/** What to say about a machine, given what was found on it. Nothing missing is
 *  nothing said — this is a list of facts, not a health report. */
export function appWideFor(here: { git: boolean; npm: boolean }): readonly AppNotice[] {
  const said: AppNotice[] = [];
  if (!here.git) said.push(appWideWords.noGit);
  if (!here.npm) said.push(appWideWords.noNpm);
  return said;
}
