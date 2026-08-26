/**
 * Whether this project's browser keeps its logins.
 *
 * Off is where it starts: a browser that remembers is a browser holding
 * somebody's signed-in accounts on disk, and that should be a thing somebody
 * turned on rather than a thing that happened to them. On, the browser this
 * project drives keeps its cookies and its logins between sittings, so signing
 * in to a staging site or a dashboard is done once.
 *
 * Its own file rather than beside the preference store, for the same reason as
 * `heldback.ts`: the window reads this too, and the store opens folders.
 */
export function keepsLogins(
  kept: Readonly<Record<string, boolean>>,
  project: string | null | undefined,
): boolean {
  return project === null || project === undefined || project === ''
    ? false
    : kept[project] === true;
}
