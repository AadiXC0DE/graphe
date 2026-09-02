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

/** The short digest that breaks the ties. Of the resolved path, so a symlink
 *  and its target are one project rather than two. */
function digestOf(project: string): string {
  return createHash('sha256').update(resolve(project)).digest('hex').slice(0, 8);
}

/**
 * The one name a project's copies are filed under.
 *
 * Readable half plus digest: `my-site-3f9a1c02`. The readable half is for
 * somebody looking at the folder; the digest is what makes it right.
 */
export function keyFor(project: string): string {
  return `${readable(basename(resolve(project)) || project)}-${digestOf(project)}`;
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
 * The same, in a folder shared with the whole machine.
 *
 * Anything under the system's temp folder sits beside every other program's
 * scratch, so it says whose it is in the name — somebody clearing space has to
 * be able to tell.
 */
export function scratchFolder(base: string, project: string, which: string): string {
  return join(base, 'graphe-builders', keyFor(project), readable(which, 24));
}
