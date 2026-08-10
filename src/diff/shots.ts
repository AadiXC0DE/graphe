/** Where the pictures live, and why it is not in the project.
 *
 * DIFFERENTIATORS §7 is the constraint: *"the project is an ordinary folder
 * with ordinary git from the first second… there is nothing to export because
 * nothing was ever trapped."* A feature that scatters half a megabyte of PNGs
 * through somebody's source tree breaks that promise in the most annoying way
 * available — they find them the first time they hand the folder to a developer.
 *
 * So the pictures go inside `.git/graphe/shots/`. Three reasons, in order of how
 * much they matter:
 *
 *  1. **It is not part of the project.** `.git` holds the machinery, never the
 *     work. Nothing in there is listed as a change, nothing is saved into a
 *     version, and a designer looking at their own folder never sees it.
 *  2. **It travels with the project.** A folder that gets moved or renamed
 *     keeps its own pictures. Keeping them in the app's own storage instead
 *     would mean a project's history quietly belonging to whichever machine
 *     took it.
 *  3. **It is thrown away with the project.** Delete the folder, and nothing of
 *     ours is left behind on the disk.
 *
 * Everything here is a string in and a string out, so where the pictures go can
 * be asserted rather than discovered by looking.
 */

/** Inside the project's own machinery, next to nothing else of ours. */
export function shotsFolder(projectFolder: string): string {
  const tidied = projectFolder.replace(/[\\/]+$/, '');
  return `${tidied}/.git/graphe/shots`;
}

/**
 * A name safe to write to a disk, made from an id we chose ourselves.
 *
 * Ids are ours — a version id or a counter — but "ours" is not the same as
 * "safe", and the one thing a path built from an id must never do is leave the
 * folder it was meant to be inside. Anything that is not a letter, a digit or a
 * dash becomes a dash, which cannot express `..` or a slash.
 */
export function shotName(id: string): string {
  const tidied = id.replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  return tidied === '' ? 'shot' : tidied.slice(0, 64);
}

export function shotFile(projectFolder: string, id: string): string {
  return `${shotsFolder(projectFolder)}/${shotName(id)}.png`;
}
