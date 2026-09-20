/**
 * What this machine is missing, as the window holds it.
 *
 * A missing git or npm is not any conversation's problem, so it is not kept on
 * a desk: it is kept here and drawn where both the start screen and a
 * conversation can see it. That distinction is the whole point — the notice
 * used to be sent into a conversation, and on a machine's first launch there is
 * no conversation, no project and nothing in front to put it in.
 */

import { APP_NOTICE, type AppNotice } from './ipc';

/** The list with one more fact on it, or the same list when it is already
 *  there. Keyed by id, so being told twice is one row. */
export function keptAppWide(
  was: readonly AppNotice[],
  one: AppNotice,
): readonly AppNotice[] {
  return was.some((each) => each.id === one.id) ? was : [...was, one];
}

/** The facts still worth drawing: everything there is, less what somebody has
 *  already put away. */
export function stillShowing(
  all: readonly AppNotice[],
  away: readonly string[],
): readonly AppNotice[] {
  return away.length === 0 ? all : all.filter((one) => !away.includes(one.id));
}

/** Whether git is here, read off the same facts the band draws — so the
 *  controls that need it answer to one answer rather than two. Read from the
 *  whole list, not the drawn one: putting the sentence away must not put a
 *  press that fails back within reach. */
export function gitIsMissing(facts: readonly AppNotice[]): boolean {
  return facts.some((one) => one.id === APP_NOTICE.noGit);
}
