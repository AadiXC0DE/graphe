/** Naming a conversation's branch after what it is for.
 *
 * A branch is created before anybody has said anything, so it starts neutral —
 * `graphe/conversation-4`. The moment there is a first request there is
 * something to name it after, and the branch becomes `graphe/fix-sticky-header`.
 * Pure: a string in, a name out, so the rules can be checked without a
 * repository.
 *
 * The renaming itself is deliberately narrow. Only a branch we minted, still on
 * its neutral name, tracking nothing, and only ever once — a branch whose name
 * keeps moving under a developer is worse than a dull one.
 */

/** The prefix every branch of ours carries. */
export const OURS = 'graphe/';

/** Neutral names look like this. Anything else under the prefix was either
 *  already named or made for something other than a conversation. */
const NEUTRAL = /^graphe\/conversation-[a-z0-9]+$/;

/** Long enough to say what the work is, short enough to read in a branch list
 *  and type from memory. */
const MOST = 44;

/** Articles. They never name anything, wherever they sit. */
const NOISE = new Set(['a', 'an', 'the']);

/** Politeness and preamble. Trimmed from the head only — "just" in the middle
 *  of a sentence is usually part of it. */
const FILLER = new Set([
  'can', 'could', 'do', 'go', 'hey', 'hi', 'i', 'id', 'im', 'just', 'lets',
  'like', 'me', 'my', 'now', 'ok', 'okay', 'please', 'so', 'then', 'this',
  'to', 'want', 'we', 'would', 'you', 'your',
]);

/** Names git refuses, or that read as something else in a branch list. */
const RESERVED = new Set(['head', 'main', 'master', 'origin', 'conversation']);

/**
 * A git-safe slug for one line of somebody's words, or null when the words
 * name nothing.
 *
 * Everything outside `a-z0-9` becomes a separator, so `..`, `~^:?*[\`, spaces
 * and a leading `.` cannot survive, and neither can a `.lock` ending.
 */
export function slugFor(text: string): string | null {
  const all = text
    .toLowerCase()
    .replace(/`[^`]*`/g, ' ')
    .split(/[^a-z0-9]+/)
    .filter((word) => word !== '');
  if (all.length === 0) return null;
  const said = all.filter((word) => !NOISE.has(word));
  const words = said.length === 0 ? all : said;

  let at = 0;
  while (at < words.length - 1 && FILLER.has(words[at] ?? '')) at += 1;
  const kept: string[] = [];
  let length = 0;
  for (const word of words.slice(at)) {
    const next = length === 0 ? word.length : length + 1 + word.length;
    if (next > MOST) break;
    kept.push(word);
    length = next;
  }
  // One word longer than the cap on its own: clipped rather than dropped, or a
  // request made of a single long word would name nothing.
  if (kept.length === 0) kept.push((words[at] ?? '').slice(0, MOST));

  const slug = kept.join('-');
  if (slug === '' || RESERVED.has(slug)) return null;
  return slug;
}

/** Whether git will take this as a branch name, checked segment by segment. */
export function isSafeBranchName(name: string): boolean {
  if (name === '' || name.length > 200) return false;
  if (name.startsWith('/') || name.endsWith('/') || name.includes('//')) return false;
  if (name.endsWith('.') || name.includes('..') || name.includes('@{')) return false;
  if (/[\s~^:?*[\\\x00-\x1f\x7f]/.test(name)) return false;
  return name
    .split('/')
    .every((part) => part !== '' && !part.startsWith('.') && !part.endsWith('.lock'));
}

/** The name a first request earns, or null when it earns none. */
export function branchNameFor(text: string): string | null {
  const slug = slugFor(text);
  if (slug === null) return null;
  const name = `${OURS}${slug}`;
  return isSafeBranchName(name) ? name : null;
}

/** The wanted name, or the same with a number, so a name already in use falls
 *  back rather than failing. Null when even the numbered ones are taken. */
export function freeName(wanted: string, taken: (name: string) => boolean): string | null {
  if (!taken(wanted)) return wanted;
  for (let n = 2; n <= 50; n += 1) {
    const next = `${wanted}-${String(n)}`;
    if (!taken(next)) return next;
  }
  return null;
}

/** What is known about the branch at the moment a first request arrives. */
export type Naming = {
  /** The branch the conversation's checkout is on. */
  branch: string;
  /** True once this branch has been renamed. Renaming happens at most once. */
  named?: boolean;
  /** True when the branch tracks a copy elsewhere. A pushed branch is somebody
   *  else's reference too, so its name stops being ours to change. */
  pushed?: boolean;
};

/**
 * The name to rename to, or null to leave the branch alone.
 *
 * Null covers every reason not to touch it: not ours, already named, already
 * pushed, or nothing in the words worth naming it after.
 */
export function renameTo(
  state: Naming,
  request: string,
  taken: (name: string) => boolean,
): string | null {
  if (state.named === true || state.pushed === true) return null;
  if (!NEUTRAL.test(state.branch)) return null;
  const wanted = branchNameFor(request);
  if (wanted === null || wanted === state.branch) return null;
  return freeName(wanted, taken);
}
