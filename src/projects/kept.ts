/** The versions somebody chose to keep at the top of the rail.
 *
 * Keeping is a view preference and not history. It changes which moment the
 * rail shows first and nothing at all about the project, so it lives beside
 * "Show me" rather than in the timeline — and the timeline stays the one thing
 * that only ever records what actually happened.
 *
 * Dependency-free on purpose. The shell writes this to a file and the window
 * reads it back, so both sides need it and neither may drag the other's world
 * along: no disk here, no clock, nothing that only exists under Node.
 */

/** Project folder → the version ids kept for it. Keyed by folder because two
 *  projects sharing a shelf would put yesterday's other job at the top of
 *  today's. */
export type Kept = Readonly<Record<string, readonly string[]>>;

/** Kept ids off a file somebody could have edited by hand. Anything that is not
 *  a list of non-empty ids under a folder name is dropped rather than refused:
 *  a preference that will not load is worse than one that loads short. */
export function asKept(value: unknown): Kept {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const kept: Record<string, readonly string[]> = {};
  for (const [project, ids] of Object.entries(value as Record<string, unknown>)) {
    if (project === '' || !Array.isArray(ids)) continue;
    const clean = [
      ...new Set(ids.filter((id): id is string => typeof id === 'string' && id !== '')),
    ];
    if (clean.length > 0) kept[project] = clean;
  }
  return kept;
}

/**
 * The shelf as it stands after somebody kept a version, or let one go.
 *
 * Keeping what is already kept is the same answer twice, and a project whose
 * last kept version is let go leaves no entry behind — so a folder nobody keeps
 * anything in costs nothing, however many folders have been opened.
 */
export function keeping(kept: Kept, project: string, versionId: string, keep: boolean): Kept {
  if (project === '' || versionId === '') return kept;
  const already = kept[project] ?? [];
  const next = keep
    ? already.includes(versionId)
      ? already
      : [...already, versionId]
    : already.filter((one) => one !== versionId);

  const changed: Record<string, readonly string[]> = { ...kept };
  if (next.length === 0) delete changed[project];
  else changed[project] = next;
  return changed;
}

/** True when two shelves say the same thing, so nothing is written for a change
 *  that is not one. */
export function sameKept(one: Kept, other: Kept): boolean {
  const projects = Object.keys(one);
  if (projects.length !== Object.keys(other).length) return false;
  return projects.every((project) => {
    const mine = one[project] ?? [];
    const theirs = other[project] ?? [];
    return mine.length === theirs.length && mine.every((id, at) => id === theirs[at]);
  });
}
