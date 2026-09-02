/** A file both sides changed in the same place, read into something a person
 *  can decide about.
 *
 * Today a clash ends the operation with a sentence and leaves the person in
 * their editor hunting for angle brackets. This reads the markers back into
 * regions — what was above, your side, the version it started from, their side,
 * what was below — so the app can put the two versions next to each other and
 * take one.
 *
 * The rule that outranks every other rule here: text this cannot make sense of
 * comes back exactly as it arrived. A parser that guesses at half a marker is a
 * parser that deletes somebody's afternoon, so anything unexpected — a section
 * that never closes, a clash inside a clash — is reported as unreadable and the
 * file is left alone.
 *
 * Pure: text in, text out. No disk, no git.
 */

/** One place both sides wrote. `raw` is every line of it, markers included, so
 *  a clash nobody has decided about is put back byte for byte. */
export type Clash = {
  mine: readonly string[];
  /** The version both sides started from, when the file was written with the
   *  base included (`merge.conflictStyle = diff3`). Null otherwise. */
  base: readonly string[] | null;
  theirs: readonly string[];
  /** What the markers called each side — a branch name, or `HEAD`. */
  mineLabel: string;
  baseLabel: string | null;
  theirsLabel: string;
  raw: readonly string[];
};

export type Region = { kind: 'same'; lines: readonly string[] } | ({ kind: 'clash' } & Clash);

export type Conflict = {
  /** The file exactly as it arrived. */
  text: string;
  regions: readonly Region[];
  clashes: number;
  /** False when the markers did not make sense. Nothing is resolved from a
   *  file that is not `ok`. */
  ok: boolean;
  /** Why not, when it is not. */
  because: string | null;
};

/** Which side to keep in one place. */
export type Take = 'mine' | 'theirs' | 'both';

export const conflictWords = {
  heading: 'Both sides changed this',
  mine: 'Yours',
  theirs: 'Theirs',
  base: 'Before either',
  takeMine: 'Keep mine',
  takeTheirs: 'Take theirs',
  takeBoth: 'Keep both',
  /** The third way out: hand both sides to the conversation that made the
   *  change and let it write the version that holds. */
  askItToReconcile: 'Ask it to work them together',
  resolved: 'Nothing left to decide in this file.',
  /** Said instead of a three-pane view, when the markers are not readable.
   *  Never followed by a rewrite of the file. */
  unreadable:
    'The conflict markers in this file do not make sense to me, so I have not touched it. Open it and sort it out by hand.',
  /** The task the conversation is given when it is asked to reconcile. */
  reconcile: (path: string, clashes: number): string =>
    `${path} has ${String(clashes)} ${clashes === 1 ? 'place' : 'places'} where your changes and mine collide. Read both sides, write the version that holds, and take the markers out.`,
  places: (count: number): string => `${String(count)} ${count === 1 ? 'place' : 'places'}`,
} as const;

/* -------------------------------------------------------------------------- */
/* Reading                                                                     */
/* -------------------------------------------------------------------------- */

const MINE = /^<{7}(?:\s|$)/;
const BASE = /^\|{7}(?:\s|$)/;
const SPLIT = /^={7}(?:\s|$)/;
const THEIRS = /^>{7}(?:\s|$)/;

/** Content keeps its own carriage return; only our reading of a marker drops it. */
function bare(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line;
}

/** What a marker line named, if anything. */
function labelOf(line: string): string {
  return bare(line).slice(7).trim();
}

function unreadable(text: string): Conflict {
  return {
    text,
    regions: [{ kind: 'same', lines: text === '' ? [] : text.split('\n') }],
    clashes: 0,
    ok: false,
    because: conflictWords.unreadable,
  };
}

/**
 * A file with conflict markers, read into regions.
 *
 * A file with no markers at all is readable and has no clashes — that is an
 * ordinary answer, not a failure, and it is what a caller gets after the last
 * place has been decided.
 */
export function readConflict(text: string): Conflict {
  if (text === '') return { text, regions: [], clashes: 0, ok: true, because: null };
  const lines = text.split('\n');

  const regions: Region[] = [];
  let same: string[] = [];
  let clashes = 0;
  let at = 0;

  const flush = (): void => {
    if (same.length > 0) regions.push({ kind: 'same', lines: same });
    same = [];
  };

  while (at < lines.length) {
    const line = lines[at] ?? '';
    if (!MINE.test(bare(line))) {
      same.push(line);
      at += 1;
      continue;
    }

    const from = at;
    const mineLabel = labelOf(line);
    at += 1;

    const mine: string[] = [];
    let base: string[] | null = null;
    let baseLabel: string | null = null;
    const theirs: string[] = [];
    let side: 'mine' | 'base' | 'theirs' = 'mine';
    let theirsLabel: string | null = null;

    while (at < lines.length) {
      const bodyRaw = lines[at] ?? '';
      const body = bare(bodyRaw);
      // A clash opening inside a clash is not something git writes, and
      // guessing at what it meant is how a file gets eaten.
      if (MINE.test(body)) return unreadable(text);
      if (BASE.test(body)) {
        if (side !== 'mine') return unreadable(text);
        side = 'base';
        base = [];
        baseLabel = labelOf(bodyRaw);
        at += 1;
        continue;
      }
      if (SPLIT.test(body)) {
        if (side === 'theirs') return unreadable(text);
        side = 'theirs';
        at += 1;
        continue;
      }
      if (THEIRS.test(body)) {
        if (side !== 'theirs') return unreadable(text);
        theirsLabel = labelOf(bodyRaw);
        at += 1;
        break;
      }
      if (side === 'mine') mine.push(bodyRaw);
      else if (side === 'base') base?.push(bodyRaw);
      else theirs.push(bodyRaw);
      at += 1;
    }

    // Ran out of file before the clash closed.
    if (theirsLabel === null) return unreadable(text);

    flush();
    clashes += 1;
    regions.push({
      kind: 'clash',
      mine,
      base,
      theirs,
      mineLabel,
      baseLabel,
      theirsLabel,
      raw: lines.slice(from, at),
    });
  }

  flush();
  return { text, regions, clashes, ok: true, because: null };
}

/* -------------------------------------------------------------------------- */
/* Deciding                                                                    */
/* -------------------------------------------------------------------------- */

function sideOf(clash: Clash, take: Take): readonly string[] {
  if (take === 'mine') return clash.mine;
  if (take === 'theirs') return clash.theirs;
  return [...clash.mine, ...clash.theirs];
}

/**
 * The file with the clashes decided.
 *
 * One answer for all of them, or one per place — the chooser is handed the
 * index, and returning null leaves that place exactly as it arrived, markers
 * and all, so a person can settle a long file a piece at a time.
 *
 * A file this could not read comes back unchanged. That is the point of it.
 */
export function resolveWith(
  file: Conflict,
  take: Take | ((at: number) => Take | null),
): string {
  if (!file.ok) return file.text;
  const choose = typeof take === 'function' ? take : (): Take => take;

  const out: string[] = [];
  let at = 0;
  for (const region of file.regions) {
    if (region.kind === 'same') {
      out.push(...region.lines);
      continue;
    }
    const chosen = choose(at);
    at += 1;
    out.push(...(chosen === null ? region.raw : sideOf(region, chosen)));
  }
  return out.join('\n');
}

/** One clash with the file around it, which is what a three-pane view draws:
 *  the lines above, the two versions, and the lines below. Null when there is
 *  no clash at that index. */
export function aroundClash(
  file: Conflict,
  at: number,
): {
  before: readonly string[];
  mine: readonly string[];
  base: readonly string[] | null;
  theirs: readonly string[];
  after: readonly string[];
} | null {
  if (!file.ok) return null;
  const before: string[] = [];
  let seen = 0;
  let found: Clash | null = null;
  const after: string[] = [];

  for (const region of file.regions) {
    if (found !== null) {
      if (region.kind === 'same') after.push(...region.lines);
      else after.push(...region.raw);
      continue;
    }
    if (region.kind === 'same') {
      before.push(...region.lines);
      continue;
    }
    if (seen === at) {
      found = region;
      continue;
    }
    seen += 1;
    before.push(...region.raw);
  }

  if (found === null) return null;
  return { before, mine: found.mine, base: found.base, theirs: found.theirs, after };
}

/** The header over the three panes. */
export function saysConflict(file: Conflict): string {
  if (!file.ok) return conflictWords.unreadable;
  if (file.clashes === 0) return conflictWords.resolved;
  const first = file.regions.find((one) => one.kind === 'clash');
  const sides =
    first === undefined || first.kind !== 'clash'
      ? ''
      : ` — ${first.mineLabel || conflictWords.mine} and ${first.theirsLabel || conflictWords.theirs}`;
  return `Both sides changed the same ${conflictWords.places(file.clashes)} in this file${sides}.`;
}
