/** The extensions a project carries that somebody said yes to.
 *
 * An extension arriving inside a folder somebody cloned is code they never
 * chose, running where the assistant runs. So none of it loads until it is
 * answered for by name, in the folder it came in, and the answer is remembered
 * per folder because saying yes to one project's copy says nothing about the
 * next project's.
 *
 * Dependency-free on purpose. The shell writes this to a file and the window
 * reads it back, so both sides need it and neither may drag the other's world
 * along: no disk here, no clock, nothing that only exists under Node.
 */

/** Project folder → the ids of the extensions it carries that may load. */
export type Trusted = Readonly<Record<string, readonly string[]>>;

/** Trust off a file somebody could have edited by hand. Anything that is not a
 *  list of non-empty ids under a folder name is dropped rather than refused —
 *  and dropping errs the safe way, since a lost id only asks the question
 *  again. */
export function asTrusted(value: unknown): Trusted {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const trusted: Record<string, readonly string[]> = {};
  for (const [project, ids] of Object.entries(value as Record<string, unknown>)) {
    if (project === '' || !Array.isArray(ids)) continue;
    const clean = [
      ...new Set(ids.filter((id): id is string => typeof id === 'string' && id !== '')),
    ];
    if (clean.length > 0) trusted[project] = clean;
  }
  return trusted;
}

/**
 * The store after somebody said yes to one, or took it back.
 *
 * Saying yes twice is the same answer twice, and a project whose last yes is
 * taken back leaves no entry behind — so a folder nobody trusts anything in
 * costs nothing, however many folders have been opened.
 */
export function trusting(trusted: Trusted, project: string, id: string, trust: boolean): Trusted {
  if (project === '' || id === '') return trusted;
  const already = trusted[project] ?? [];
  const next = trust
    ? already.includes(id)
      ? already
      : [...already, id]
    : already.filter((one) => one !== id);

  const changed: Record<string, readonly string[]> = { ...trusted };
  if (next.length === 0) delete changed[project];
  else changed[project] = next;
  return changed;
}

/** True when two stores say the same thing, so nothing is written for a change
 *  that is not one. */
export function sameTrusted(one: Trusted, other: Trusted): boolean {
  const projects = Object.keys(one);
  if (projects.length !== Object.keys(other).length) return false;
  return projects.every((project) => {
    const mine = one[project] ?? [];
    const theirs = other[project] ?? [];
    return mine.length === theirs.length && mine.every((id, at) => id === theirs[at]);
  });
}

/** Whether this exact extension, in this project, has been said yes to. */
export function isTrusted(trusted: Trusted, project: string, id: string): boolean {
  if (project === '' || id === '') return false;
  return (trusted[project] ?? []).includes(id);
}

/** Everything the separator or a stray space could turn into another name. */
function cleanNameOf(name: string): string {
  return name
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * The id a decision is keyed by: the extension's name and a fingerprint of the
 * code it would load, so a yes given in January stops covering code that lands
 * in March.
 *
 * The digest is a change-detector, not a security boundary. It exists so edited
 * code asks again; anybody who can write into the folder could just as easily
 * write a file that collides with it. The protection is the question.
 */
export function idFor(name: string, source: string): string {
  const clean = cleanNameOf(name);
  if (clean === '' || source === '') return '';

  // Two lanes so a one-character edit cannot quietly land on the same digest.
  let low = 2166136261;
  let high = 2166136261 ^ source.length;
  for (let at = 0; at < source.length; at += 1) {
    const letter = source.charCodeAt(at);
    low = Math.imul(low ^ letter, 16777619) >>> 0;
    high = Math.imul(high ^ (letter + at), 16777619) >>> 0;
  }
  const digest = low.toString(16).padStart(8, '0') + high.toString(16).padStart(8, '0');
  return `${clean}@${digest}`;
}
