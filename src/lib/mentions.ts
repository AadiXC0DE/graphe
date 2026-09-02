/** What `@` offers, from one list.
 *
 * Typing `@` in the box offered skills and nothing else, so the most obvious
 * thing somebody wants to name — a file they are looking at — had to be typed
 * as a path, correctly, from memory. Every editor and every other agent desktop
 * has had this for years; the reason it matters here is narrower than "everyone
 * has it": a path somebody typed by hand is a path the Guard has to refuse when
 * it is wrong, and a refusal for a typo is the app arguing with somebody about
 * spelling.
 *
 * One list, ranked, so a skill and a file are the same gesture. What goes into
 * the message is a real path the Guard already understands.
 *
 * Pure. The tree and the skills are handed in; nothing here reads a disk.
 */

/** One thing `@` can offer. `insert` is what lands in the message — for a file
 *  that is its path, which is the whole point. */
export type Mentionable = {
  kind: 'file' | 'folder' | 'skill';
  /** What it is called, drawn in the row. */
  name: string;
  /** The line under it: a folder for a file, a sentence for a skill. */
  note: string;
  insert: string;
};

export const mentionWords = {
  /** Said above the list, once, so the gesture explains itself the first time. */
  hint: 'Files, folders and skills. Type to narrow.',
  nothing: 'Nothing here matches that.',
  folder: 'Folder',
} as const;

/** As many as a list can offer before it stops being a list. */
export const MOST_OFFERED = 12;

/* -------------------------------------------------------------------------- */
/* Finding the query                                                           */
/* -------------------------------------------------------------------------- */

/**
 * The `@` being typed, or nothing.
 *
 * An `@` only starts one at the beginning of a word — an email address in the
 * middle of a sentence is not somebody reaching for a file — and a space ends
 * it, because a path with a space in it is rarer than a sentence with an `@`.
 */
export function mentionAt(text: string, caret: number): { from: number; query: string } | null {
  const upto = text.slice(0, caret);
  const at = upto.lastIndexOf('@');
  if (at < 0) return null;
  const before = at === 0 ? '' : upto[at - 1];
  if (before !== undefined && before !== '' && !/\s/.test(before)) return null;
  const query = upto.slice(at + 1);
  if (/\s/.test(query)) return null;
  return { from: at, query };
}

/* -------------------------------------------------------------------------- */
/* Ranking                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * How well one candidate answers a query, or -1 for not at all.
 *
 * Subsequence rather than substring, because `apbtn` should find
 * `app/Button.tsx` — that is the whole reason to have this rather than a
 * `filter`. Nearer the end of the path scores higher, since a person typing
 * `button` means the file, not the folder it lives in.
 */
export function scoreOf(candidate: string, query: string): number {
  if (query === '') return 0;
  const hay = candidate.toLowerCase();
  const needle = query.toLowerCase();

  const whole = hay.lastIndexOf(needle);
  // A run of letters together beats the same letters scattered, always.
  if (whole >= 0) return 1_000 + whole;

  let at = 0;
  let last = -1;
  let together = 0;
  for (const letter of needle) {
    const found = hay.indexOf(letter, at);
    if (found < 0) return -1;
    if (found === last + 1) together += 1;
    last = found;
    at = found + 1;
  }
  return together * 10 + last;
}

/* -------------------------------------------------------------------------- */
/* The list                                                                    */
/* -------------------------------------------------------------------------- */

/** A file or folder as the tree knows it: a path relative to the project. */
export type Entry = { path: string; folder: boolean };

/** A skill as the shelf knows it. */
export type Skill = { name: string; handle: string; says: string };

/** The last part of a path — what a person is actually typing at. */
function calledWhat(path: string): string {
  const parts = path.split('/').filter((one) => one !== '');
  return parts[parts.length - 1] ?? path;
}

function withinWhat(path: string): string {
  const parts = path.split('/').filter((one) => one !== '');
  return parts.length <= 1 ? '' : parts.slice(0, -1).join('/');
}

/**
 * Everything `@` offers for one query, best first.
 *
 * Skills first at equal score: somebody who has written a skill reaches for it
 * by name, and a file that happens to share the name is the less likely of the
 * two. Below that, the ranking is the score and then the shorter path — a
 * shallow file is more often the one meant than a deep one.
 */
export function offerFor(
  query: string,
  what: { files: readonly Entry[]; skills: readonly Skill[] },
  most = MOST_OFFERED,
): readonly Mentionable[] {
  const scored: { one: Mentionable; score: number; depth: number; skill: boolean }[] = [];

  for (const skill of what.skills) {
    const score = Math.max(scoreOf(skill.handle, query), scoreOf(skill.name, query));
    if (score < 0) continue;
    scored.push({
      one: { kind: 'skill', name: skill.name, note: skill.says, insert: `@${skill.handle}` },
      score,
      depth: 0,
      skill: true,
    });
  }

  for (const entry of what.files) {
    /* Scored on the name, and on the path only when the name does not answer at
       all. Taking the better of the two sounds fairer and is not: the path
       score rewards a match further along, so `src/app/deeply/nested/Button`
       beat `src/components/Button` for the query "button" — the deeper file
       won for being deeper, which is the opposite of what somebody meant. */
    const byName = scoreOf(calledWhat(entry.path), query);
    const score = byName >= 0 ? byName : scoreOf(entry.path, query) - 1;
    if (score < 0) continue;
    scored.push({
      one: {
        kind: entry.folder ? 'folder' : 'file',
        name: calledWhat(entry.path),
        note: entry.folder ? mentionWords.folder : withinWhat(entry.path),
        insert: entry.path,
      },
      score,
      depth: entry.path.split('/').length,
      skill: false,
    });
  }

  scored.sort(
    (one, other) =>
      other.score - one.score ||
      Number(other.skill) - Number(one.skill) ||
      one.depth - other.depth ||
      one.one.insert.localeCompare(other.one.insert),
  );
  return scored.slice(0, most).map((one) => one.one);
}

/** The message with the chosen thing in place of what was typed. Returns the
 *  new caret too, because a list that leaves the cursor behind is a list nobody
 *  uses twice. */
export function withMention(
  text: string,
  where: { from: number; query: string },
  chosen: Mentionable,
): { text: string; caret: number } {
  const before = text.slice(0, where.from);
  const after = text.slice(where.from + 1 + where.query.length);
  const put = `${chosen.insert} `;
  return { text: `${before}${put}${after}`, caret: before.length + put.length };
}
