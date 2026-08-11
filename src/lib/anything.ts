/** Ask for anything — one typed line, read against everything the window can
 *  jump to.
 *
 * Pure on purpose. It takes what is on hand and what was typed, and hands back
 * a ranked list; it never reads a clock, a folder or a bridge. The component
 * above it decides what to do with each answer.
 *
 * The last answer is always "say this". Somebody who types a sentence has told
 * us what they want even when nothing in the project is called that, and a
 * search box that dead-ends on "no results" would be the one place in this app
 * that refuses to listen.
 */

import type { Conversation, Page, RecentProject, SavedVersion } from './ipc';
import { ago } from './when';

/** What each answer is, and therefore what pressing it does. */
export type FoundKind = 'project' | 'conversation' | 'page' | 'version' | 'say';

/**
 * One answer, with the thing itself attached.
 *
 * The payload travels rather than an id to look up again, so the caller acts on
 * what it was shown instead of re-finding it in a list that may have moved on.
 */
export type Found =
  | (Row<'project'> & { project: RecentProject })
  | (Row<'conversation'> & { conversation: Conversation })
  | (Row<'page'> & { page: Page })
  | (Row<'version'> & { version: SavedVersion })
  | (Row<'say'> & { say: string });

type Row<K extends FoundKind> = {
  kind: K;
  /** Unique across kinds — a key for the list, and the handle the open row is
   *  named by for anyone listening rather than looking. */
  id: string;
  /** The line somebody reads first. */
  label: string;
  /** The quieter line under it: where it is, or when it was. */
  sub: string;
};

/** Everything the window is willing to jump to. All optional: a person with no
 *  project open can still type a sentence. */
export type Things = {
  projects?: readonly RecentProject[];
  conversations?: readonly Conversation[];
  pages?: readonly Page[];
  versions?: readonly SavedVersion[];
};

export type Ask = {
  /** Epoch ms, passed in so this stays a function of its arguments. */
  now: number;
  /** How many rows to hand back, the "say this" row included. */
  limit?: number;
};

/** A list you scan, not a page you read. Past this it stops being a shortcut. */
export const MOST_WE_SHOW = 8;

/** The word beside each row, so it is written once. */
export const kindWords: Record<FoundKind, string> = {
  project: 'Project',
  conversation: 'Conversation',
  page: 'Page',
  version: 'Version',
  say: 'Ask',
};

/* ------------------------------------------------------------------ matching */

/* How good a kind of match is. Comparable only against each other — the numbers
   mean nothing on their own. */
const EXACT = 4;
const PREFIX = 3;
const WORD = 2;
const INSIDE = 1;
const SCATTERED = 0;

const BREAK = /[\s\-_/\\.,:;()[\]{}'"@#]/;

export type Hit = {
  tier: number;
  /** Where the match starts. Earlier reads as more obviously the thing. */
  at: number;
  /** How much text the match is spread over. */
  span: number;
};

/** True when the character at `at` opens a word — after a separator, or at the
 *  hump of a camelCase name, so `heroBanner` answers "banner". */
function startsAWord(text: string, at: number): boolean {
  const before = text[at - 1];
  if (before === undefined) return true;
  if (BREAK.test(before)) return true;
  const here = text[at] ?? '';
  return (
    before === before.toLowerCase() &&
    before !== before.toUpperCase() &&
    here === here.toUpperCase() &&
    here !== here.toLowerCase()
  );
}

/** The letters in order but not together: "hdr" in "header row". Anchored at
 *  the earliest end it can reach, then walked back so the letters sit as close
 *  together as that end allows. */
function scattered(lower: string, needle: string): Hit | null {
  let cursor = 0;
  for (let i = 0; i < needle.length; i += 1) {
    const found = lower.indexOf(needle[i] ?? '', cursor);
    if (found === -1) return null;
    cursor = found + 1;
  }
  const end = cursor - 1;

  let back = end;
  let start = end;
  for (let i = needle.length - 1; i >= 0; i -= 1) {
    const found = lower.lastIndexOf(needle[i] ?? '', back);
    if (found === -1) return null;
    start = found;
    back = found - 1;
  }
  return { tier: SCATTERED, at: start, span: end - start + 1 };
}

/** How well one string answers what was typed, or null when it does not. */
export function hitOf(text: string, needle: string): Hit | null {
  if (needle === '') return null;
  const lower = text.toLowerCase();

  // Every place it appears whole, keeping the best kind of appearance: "pricing"
  // should find the word in "New pricing" rather than the letters in "repricing".
  let best: Hit | null = null;
  for (let at = lower.indexOf(needle); at !== -1; at = lower.indexOf(needle, at + 1)) {
    const tier =
      at === 0
        ? lower.length === needle.length
          ? EXACT
          : PREFIX
        : startsAWord(text, at)
          ? WORD
          : INSIDE;
    if (best === null || tier > best.tier) best = { tier, at, span: needle.length };
    if (tier === EXACT || tier === PREFIX) break;
  }
  if (best !== null) return best;

  return scattered(lower, needle);
}

/* ---------------------------------------------------------------- the things */

/** One string worth matching against, and whether it is what the row is called.
 *  A path or a filename is a real way to find something and a poor reason to
 *  win, so it matches at one tier lower than the name does. */
type Field = { text: string; primary: boolean };

type Candidate = {
  found: Found;
  fields: readonly Field[];
  /** Epoch ms, for the recency tiebreak. Zero when the thing has no moment. */
  when: number;
};

type Ranked = Hit & { found: Found; primary: boolean; length: number; when: number };

function messageCount(messages: number): string {
  return messages === 1 ? '1 message' : `${messages} messages`;
}

function candidates(things: Things, now: number): readonly Candidate[] {
  const all: Candidate[] = [];

  for (const project of things.projects ?? []) {
    all.push({
      found: {
        kind: 'project',
        id: `project:${project.path}`,
        label: project.name,
        sub: project.missing ? 'Not where we left it' : ago(project.lastOpenedAt, now),
        project,
      },
      fields: [
        { text: project.name, primary: true },
        { text: project.path, primary: false },
      ],
      when: project.lastOpenedAt,
    });
  }

  for (const conversation of things.conversations ?? []) {
    all.push({
      found: {
        kind: 'conversation',
        id: `conversation:${conversation.id}`,
        label: conversation.title,
        sub: `${messageCount(conversation.messages)} · ${ago(conversation.at, now)}`,
        conversation,
      },
      fields: [{ text: conversation.title, primary: true }],
      when: conversation.at,
    });
  }

  for (const page of things.pages ?? []) {
    all.push({
      found: {
        kind: 'page',
        id: `page:${page.route}`,
        label: page.name,
        sub: page.route,
        page,
      },
      fields: [
        { text: page.name, primary: true },
        { text: page.route, primary: true },
        { text: page.file, primary: false },
      ],
      when: 0,
    });
  }

  for (const version of things.versions ?? []) {
    all.push({
      found: {
        kind: 'version',
        id: `version:${version.id}`,
        label: version.title,
        sub: version.current
          ? `What it looks like now · ${ago(version.at, now)}`
          : ago(version.at, now),
        version,
      },
      fields: [{ text: version.title, primary: true }],
      when: version.at,
    });
  }

  return all;
}

/** The row that is always available: whatever was typed, said out loud. */
function sayRow(text: string): Found {
  return {
    kind: 'say',
    id: 'say',
    label: text,
    sub: 'Send this and I’ll get to work',
    say: text,
  };
}

/* ----------------------------------------------------------------- the order */

/**
 * Better first.
 *
 * Kind of match, then whether it was the name rather than a path, then how
 * tightly and how early it sat, then how recently the thing was touched. Equal
 * on all of it keeps the order it arrived in, which is the order the window
 * already shows these things in.
 */
function rank(a: Ranked, b: Ranked, typed: number): number {
  if (a.tier !== b.tier) return b.tier - a.tier;
  if (a.primary !== b.primary) return a.primary ? -1 : 1;
  const slack = a.span - typed - (b.span - typed);
  if (slack !== 0) return slack;
  if (a.at !== b.at) return a.at - b.at;
  if (a.when !== b.when) return b.when - a.when;
  return a.length - b.length;
}

/**
 * What was typed, read against everything on hand.
 *
 * An empty box is not a failure to match — it is somebody who has just opened
 * this and wants to see where they have been, so it answers with the most
 * recent things and nothing to say. Anything else always ends with the row that
 * sends the sentence on.
 */
export function findAnything(query: string, things: Things, ask: Ask): readonly Found[] {
  const limit = Math.max(0, ask.limit ?? MOST_WE_SHOW);
  const typed = query.trim();
  const pool = candidates(things, ask.now);

  if (typed === '') {
    return [...pool]
      .sort((a, b) => b.when - a.when)
      .slice(0, limit)
      .map((one) => one.found);
  }

  const needle = typed.toLowerCase();
  const ranked: Ranked[] = [];
  for (const one of pool) {
    let best: Ranked | null = null;
    for (const field of one.fields) {
      const hit = hitOf(field.text, needle);
      if (hit === null) continue;
      const tier = field.primary ? hit.tier : Math.max(SCATTERED, hit.tier - 1);
      const here: Ranked = {
        ...hit,
        tier,
        found: one.found,
        primary: field.primary,
        length: field.text.length,
        when: one.when,
      };
      if (best === null || rank(here, best, needle.length) < 0) best = here;
    }
    if (best !== null) ranked.push(best);
  }

  ranked.sort((a, b) => rank(a, b, needle.length));

  // The sentence always has somewhere to go, so it takes the last place rather
  // than a place — except when nothing matched, where it is the whole answer.
  const say = sayRow(typed);
  const room = Math.max(0, limit - 1);
  const matches = ranked.slice(0, room).map((one) => one.found);
  return matches.length === 0 ? [say].slice(0, limit) : [...matches, say].slice(0, limit);
}
