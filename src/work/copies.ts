/** Where a copy of a project lives, decided once.
 *
 * There are three kinds of copy, and each of them worked out its own name for
 * one: a conversation's checkout, a board piece's copy, and a builder's
 * scratch. All three had to answer the same question — which folder belongs to
 * which project — and all three answered it differently. Two of them flattened
 * every awkward character to a dash, which maps `/x/a-b`, `/x/a.b` and `/x/a b`
 * onto one folder, so clearing one project's copies took another's with it.
 *
 * One derivation now: something readable so a person opening the folder can
 * tell what it is, and a short digest of the real path so two folders with the
 * same name in different places can never collide.
 *
 * Pure, and it knows nothing about where the app keeps its data — the caller
 * says that, because a test says a temporary folder and the shell says the
 * app's own.
 */

import { createHash } from 'node:crypto';
import { basename, join, resolve } from 'node:path';

/** As much of a name as is worth reading in a folder listing. */
const READABLE = 32;

function readable(text: string, most = READABLE): string {
  const one = text
    .replace(/[^a-zA-Z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, most);
  return one === '' ? 'project' : one;
}

/** The short digest that breaks the ties. Given a resolved path, so a symlink
 *  and its target are one project rather than two; given a project's id, so a
 *  project that moves keeps one folder. */
function digestOf(of: string): string {
  return createHash('sha256').update(of).digest('hex').slice(0, 8);
}

/**
 * The one name a project's copies are filed under.
 *
 * Readable half plus digest: `my-site-3f9a1c02`. The readable half is for
 * somebody looking at the folder; the digest is what makes it right.
 */
export function keyFor(project: string): string {
  return `${readable(basename(resolve(project)) || project)}-${digestOf(resolve(project))}`;
}

/** What a copy is for. Each kind gets its own folder under the app's data, so
 *  clearing one kind never reaches another. */
export type CopyKind = 'worktrees' | 'copies' | 'kept-aside' | 'builders' | 'builds';

/** Where this project's copies of one kind live. */
export function copiesFolder(base: string, kind: CopyKind, project: string): string {
  return join(base, kind, keyFor(project));
}

/** Where one particular copy lives — a conversation, a board piece, a builder
 *  call. `which` is whatever the caller already calls it. */
export function copyFolder(
  base: string,
  kind: CopyKind,
  project: string,
  which: string,
): string {
  return join(copiesFolder(base, kind, project), readable(which, 24));
}

/**
 * Where a project's rescued writing goes.
 *
 * Filed under a digest of the project's own id, which is the one thing two
 * projects cannot share. Older versions filed it under the flattened path, so
 * two projects landed in one folder and a rescue there wrote over the other
 * project's copy of any file that had the same name.
 *
 * The id rather than the path, because a project that is moved keeps its id:
 * writing somebody has not come back for stays findable. The readable half is
 * the folder's own name for whoever comes looking.
 */
export function rescueFolder(base: string, project: string, projectId: string): string {
  return join(base, 'kept-aside', rescueKeyFor(project, projectId));
}

/** The name a project's rescued writing is filed under. */
export function rescueKeyFor(project: string, projectId: string): string {
  return `${readable(basename(resolve(project)) || project)}-${rescueDigestOf(projectId)}`;
}

/** The part of that name that is this project and no other. Exposed because the
 *  readable half changes when a project is moved, so finding earlier rescues
 *  after a move means matching on this. */
export function rescueDigestOf(projectId: string): string {
  return digestOf(projectId);
}

/**
 * Where a project's rescued writing was filed by the version before this one.
 *
 * The whole path with every awkward character flattened to a dash, so `/x/a-b`
 * and `/x/a.b` both come out `-x-a-b` and two projects shared one folder. Kept
 * because those folders are still on disk, holding writing nobody has moved.
 */
export function legacyRescueRoot(base: string, project: string): string {
  const key = resolve(project).replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-');
  return join(base, 'kept-aside', key);
}

/** The same, in a folder shared with the whole machine.
 *
 * Anything under the system's temp folder sits beside every other program's
 * scratch, so it says whose it is in the name — somebody clearing space has to
 * be able to tell.
 */
export function scratchFolder(base: string, project: string, which: string): string {
  return join(base, 'graphe-builders', keyFor(project), readable(which, 24));
}
