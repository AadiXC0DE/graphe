/**
 * Whether this project holds work back for a look first.
 *
 * The one reader, because absent means off and four places working that out for
 * themselves is four places to get it wrong. Off is where every other coding
 * agent starts: work happens as it is asked for, and going back is what makes
 * that safe. No folder is never held: there is nothing there to hold anything
 * back from.
 *
 * Its own file rather than beside the preference store: the window reads this
 * too, and the store opens folders and writes files. Importing it from a
 * browser bundle pulled `node:path` in with it and the build stopped.
 */
export function holdsBack(
  held: Readonly<Record<string, boolean>>,
  project: string | null | undefined,
): boolean {
  return project === null || project === undefined || project === ''
    ? false
    : held[project] === true;
}
