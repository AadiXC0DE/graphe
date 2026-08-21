/** What the palette knows: every action, and which ones a typed word means.
 *
 * Somebody who half-remembers what a thing is called types three letters and
 * expects it at the top. So the ranking is most of this file — a name that
 * starts with what was typed beats one where a later word starts with it,
 * which beats one where the letters merely appear in order.
 *
 * Pure. A command carries its own `run`; nothing here calls it.
 */

export type Command = {
  id: string;
  /** What it is called, in the words the palette shows. */
  name: string;
  /** The band it sits under — 'Conversation', 'Project'. */
  where?: string;
  /** Its chord, already rendered for reading. */
  keys?: string;
  run: () => void;
  /** False keeps it in the list but unrunnable. An action that disappears
   *  teaches nobody where it went, so `whyNot` goes with it. */
  ready?: boolean;
  whyNot?: string;
};

export const KEY_WORDS = {
  placeholder: 'What do you want to do?',
  nothing: 'Nothing here goes by that name.',
  empty: 'There is nothing to do here yet.',
  ungrouped: 'Everything else',
  notReady: 'Not right now.',
} as const;

/* -------------------------------------------------------------------------- */
/* Matching                                                                    */
/* -------------------------------------------------------------------------- */

/* How well one piece of text answers what was typed. The three steps are the
   three ways people search: the beginning, a word inside, the letters. */
const STARTS_WITH = 3;
const STARTS_A_WORD = 2;
const HOLDS_IN_ORDER = 1;

/** The name decides; the group only breaks ties and rescues a command whose
 *  band was typed instead of its name. */
const NAME_OVER_GROUP = 10;

function words(text: string): readonly string[] {
  return text.split(/[^a-z0-9]+/).filter((word) => word !== '');
}

function startsAWord(text: string, query: string): boolean {
  const parts = words(text);
  if (parts.some((word) => word.startsWith(query))) return true;
  // "cp" should find "Copy path": initials are how people abbreviate a name.
  return parts.map((word) => word.slice(0, 1)).join('').startsWith(query);
}

function holdsInOrder(text: string, query: string): boolean {
  let at = 0;
  for (const letter of query) {
    const found = text.indexOf(letter, at);
    if (found === -1) return false;
    at = found + 1;
  }
  return true;
}

function scoreOf(text: string, query: string): number {
  const low = text.toLowerCase();
  if (low === '') return 0;
  if (low.startsWith(query)) return STARTS_WITH;
  if (startsAWord(low, query)) return STARTS_A_WORD;
  if (holdsInOrder(low, query)) return HOLDS_IN_ORDER;
  return 0;
}

/**
 * The commands a typed word means, best first.
 *
 * Nothing typed is not a filter — it is the whole list, in the order it was
 * registered, which is the order somebody arranged it in.
 */
export function matches(commands: readonly Command[], query: string): readonly Command[] {
  const wanted = query.trim().toLowerCase();
  if (wanted === '') return commands.slice();
  return commands
    .map((command, at) => ({
      command,
      at,
      score: scoreOf(command.name, wanted) * NAME_OVER_GROUP + scoreOf(command.where ?? '', wanted),
    }))
    .filter((one) => one.score > 0)
    // Registration order settles equal scores, so the same typing gives the
    // same list every time.
    .sort((one, other) => other.score - one.score || one.at - other.at)
    .map((one) => one.command);
}

/* -------------------------------------------------------------------------- */
/* Bands                                                                       */
/* -------------------------------------------------------------------------- */

export type Band = {
  where: string;
  commands: readonly Command[];
};

/** The list cut into its bands, both the bands and what is in them left in the
 *  order they arrived. */
export function grouped(commands: readonly Command[]): readonly Band[] {
  const bands: Band[] = [];
  const byWhere = new Map<string, Command[]>();
  for (const command of commands) {
    const where = command.where ?? KEY_WORDS.ungrouped;
    let bucket = byWhere.get(where);
    if (bucket === undefined) {
      bucket = [];
      byWhere.set(where, bucket);
      bands.push({ where, commands: bucket });
    }
    bucket.push(command);
  }
  return bands;
}

/** Ready unless it says otherwise, so a command only has to speak up to stop. */
export function isReady(command: Command): boolean {
  return command.ready !== false;
}
