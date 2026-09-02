/** Finished work waiting to be looked at, before any of it touches your folder.
 *
 * Today a conversation's work is carried into the person's folder on every
 * settle, so the files under them change while they are reading something else,
 * and the first they hear of a clash is a sentence in a thread. The queue is
 * the other way round: a conversation, a board piece or a schedule finishes and
 * an entry arrives here, and nothing moves until somebody says so.
 *
 * The decision is per file as well as per entry. A review that can only say yes
 * to everything is a review people stop doing, so an entry mostly turned down
 * can still take the one file that was right.
 *
 * Pure: entries in, entries out. The caller carries the files.
 */

/** One file in an entry, and what it does to that file. */
export type FileTally = { path: string; added: number; removed: number };

/** What to do with one file, said against the whole entry's verdict. */
export type FileVerdict = 'take theirs' | 'keep mine';

/** One thing waiting to be looked at. */
export type Entry = {
  id: string;
  from: 'conversation' | 'board' | 'schedule';
  title: string;
  /** The conversation it came out of, so the entry can be opened where it was
   *  made rather than read as a patch with no author. */
  address: string;
  files: readonly FileTally[];
  at: number;
  read: boolean;
  /** Decisions taken file by file. A path with no entry follows whatever the
   *  whole entry is told to do. */
  choices?: Readonly<Record<string, FileVerdict>>;
};

/** What a person says about a whole entry. */
export type Verdict = 'take it' | 'keep mine' | 'ask again' | 'drop it';

/** One entry as it arrives, before the queue knows anything about it. */
export type Arriving = {
  id: string;
  from: Entry['from'];
  title: string;
  address: string;
  files: readonly FileTally[];
  at: number;
};

export const reviewWords = {
  heading: 'Review',
  nothing: 'Nothing waiting for you.',
  nothingDetail: 'Work finished in the background arrives here before it touches your folder.',
  /** The four decisions, in the order they are offered. */
  take: 'Take it',
  mine: 'Keep mine',
  again: 'Ask again',
  drop: 'Throw it away',
  /** The same two, per file. */
  takeFile: 'Take theirs',
  keepFile: 'Keep mine',
  /** The one press after a review that says yes: the branch arrives as one
   *  commit unless somebody asks for the conversation's own saves. */
  land: 'Land',
  openDiff: 'See what changed',
  /** The two ways a landing can arrive, named as themselves. The precise one
   *  sits behind Land rather than in a settings screen. */
  landingHow: 'How it arrives',
  openPr: 'Open a pull request',
  opening: 'Opening the pull request…',
  landing: 'Landing…',
  /** The old behaviour, kept per card for anyone who wants it. */
  mirror: 'Live mirror',
  mirrorWhy:
    'Carry this conversation’s files into your folder as it works, instead of waiting here for a review.',
  /** A land cannot keep the conversation’s own saves once files are left out
   *  of it, so the precise control says so rather than quietly ignoring it. */
  heldBackNote: 'Files you kept your own version of stay out, so this arrives as one commit.',
  nothingChosen: 'Every file here is set to keep your own version, so there is nothing to take.',
  prOpened: (address: string): string => `Pull request opened: ${address}`,
  landed: (title: string): string => `Landed “${title}”.`,
  clashed: (files: readonly string[]): string =>
    files.length === 1
      ? `One file was changed here and in that conversation at the same time: ${files[0] ?? ''}. Decide it place by place.`
      : `${String(files.length)} files were changed here and in that conversation at the same time. Decide them place by place.`,
  /** Where each entry came from, said on the row. */
  froms: {
    conversation: 'From a conversation',
    board: 'From the board',
    schedule: 'From a schedule',
  } as Record<Entry['from'], string>,
  badge: (count: number): string =>
    count === 1 ? '1 waiting for you' : `${String(count)} waiting for you`,
  tally: (added: number, removed: number): string => `+${String(added)} −${String(removed)}`,
  files: (count: number): string => `${String(count)} ${count === 1 ? 'file' : 'files'}`,
  /** What just happened, said back in the words of the thing that happened. */
  took: (title: string, files: number): string =>
    files === 0
      ? `Took nothing from “${title}”.`
      : `Took ${String(files)} ${files === 1 ? 'file' : 'files'} from “${title}” into your project.`,
  kept: (title: string): string => `Kept your own version. “${title}” is off the list.`,
  asked: (title: string): string => `Sent “${title}” back to have another go.`,
  dropped: (title: string): string => `Threw “${title}” away.`,
  gone: 'That one is no longer waiting.',
} as const;

/** How a conversation's work arrives in the person's branch, said as the two
 *  ways it can. Squash is the default everywhere; keeping every version is for
 *  somebody who wants the conversation's own saves in their history. */
export const landingWords = {
  squash: 'One commit, your message',
  every: 'Keep every version',
  note: 'One commit runs your pre-commit hooks and is signed the way your other commits are. Keeping every version brings the conversation’s automatic saves across as they were made: unsigned, and past your hooks.',
  /** When nobody typed one. Reads as a commit subject, because it is one. */
  message: (branch: string): string => `Work from ${branch.replace(/^graphe\//, '')}`,
  failed:
    'Your work is here, but the commit did not go through. A pre-commit hook turned it down, or the signing did. The changes are staged, so you can commit them yourself.',
} as const;

/* -------------------------------------------------------------------------- */
/* The queue                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The queue after this round of arrivals.
 *
 * An entry already in the queue keeps what a person has done to it — whether it
 * has been read, and any per-file decisions — because a board piece reporting
 * itself twice must not quietly re-open a review somebody was halfway through.
 * An arrival that changed no files never joins: there is nothing to look at.
 *
 * Newest first, which is the order they are drawn in.
 */
export function queueFrom(
  already: readonly Entry[],
  arriving: readonly Arriving[] = [],
): readonly Entry[] {
  const byId = new Map<string, Entry>();
  for (const one of already) byId.set(one.id, one);

  for (const one of arriving) {
    if (one.files.length === 0) continue;
    const before = byId.get(one.id);
    byId.set(one.id, {
      id: one.id,
      from: one.from,
      title: one.title,
      address: one.address,
      files: one.files,
      at: one.at,
      read: before?.read ?? false,
      ...(before?.choices === undefined ? {} : { choices: before.choices }),
    });
  }

  return [...byId.values()].sort((one, other) => other.at - one.at);
}

/** The count on the badge: entries nobody has opened yet. */
export function waiting(entries: readonly Entry[]): number {
  return entries.filter((one) => !one.read).length;
}

/** Opening one is reading it. Separate from deciding, because looking at
 *  something is not agreeing to it. */
export function markRead(entries: readonly Entry[], id: string): readonly Entry[] {
  return entries.map((one) => (one.id === id ? { ...one, read: true } : one));
}

/** One file's decision, set or cleared. Clearing puts it back under whatever
 *  the whole entry is told to do. */
export function chooseFile(
  entries: readonly Entry[],
  id: string,
  path: string,
  choice: FileVerdict | null,
): readonly Entry[] {
  return entries.map((one) => {
    if (one.id !== id) return one;
    const choices = { ...(one.choices ?? {}) };
    if (choice === null) delete choices[path];
    else choices[path] = choice;
    return Object.keys(choices).length === 0
      ? { id: one.id, from: one.from, title: one.title, address: one.address, files: one.files, at: one.at, read: one.read }
      : { ...one, choices };
  });
}

/**
 * Which files to carry into the project, given the whole entry's verdict.
 *
 * `take it` means every file except the ones held back one by one; anything
 * else means only the files singled out. That second half is the whole point of
 * per-file decisions: an entry turned down can still hand over the one file
 * that was right, and one accepted can still keep your own version of a file
 * you had been editing.
 */
export function filesToTake(entry: Entry, verdict: Verdict): readonly string[] {
  const choices = entry.choices ?? {};
  if (verdict === 'take it') {
    return entry.files.filter((one) => choices[one.path] !== 'keep mine').map((one) => one.path);
  }
  return entry.files.filter((one) => choices[one.path] === 'take theirs').map((one) => one.path);
}

/**
 * The queue after a decision, and the sentence to say about it.
 *
 * Every verdict takes the entry off the list — including `ask again`, which
 * hands it back to the conversation that made it. What is left waiting should
 * only ever be what nobody has answered yet.
 */
export function decide(
  entries: readonly Entry[],
  id: string,
  verdict: Verdict,
): { entries: readonly Entry[]; did: string } {
  const one = entries.find((entry) => entry.id === id);
  if (one === undefined) return { entries, did: reviewWords.gone };

  const left = entries.filter((entry) => entry.id !== id);
  if (verdict === 'take it') {
    return { entries: left, did: reviewWords.took(one.title, filesToTake(one, verdict).length) };
  }
  if (verdict === 'ask again') return { entries: left, did: reviewWords.asked(one.title) };
  if (verdict === 'drop it') return { entries: left, did: reviewWords.dropped(one.title) };

  // Kept mine, but a file singled out still crosses.
  const taking = filesToTake(one, verdict);
  return {
    entries: left,
    did: taking.length === 0 ? reviewWords.kept(one.title) : reviewWords.took(one.title, taking.length),
  };
}

/** How many files somebody has said to keep their own version of. */
export function heldBack(entry: Entry): number {
  const choices = entry.choices ?? {};
  return entry.files.filter((one) => choices[one.path] === 'keep mine').length;
}

/** Whether a land can still keep the conversation's own saves.
 *
 * It cannot once any file is being left out: what would arrive then is not the
 * branch, it is a subset of it, and a subset has no history of its own to
 * bring across. Said out loud on the control rather than ignored underneath it.
 */
export function landsAsOneCommit(entry: Entry): boolean {
  return heldBack(entry) > 0;
}

/** One entry off the list, without deciding anything about it. Used when the
 *  work behind it has gone: a row for a conversation that no longer exists is
 *  a review nobody can carry out. */
export function withoutEntry(entries: readonly Entry[], id: string): readonly Entry[] {
  return entries.filter((one) => one.id !== id);
}

/** The line under one entry: where it came from and how much there is. */
export function saysEntry(entry: Entry): string {
  let added = 0;
  let removed = 0;
  for (const file of entry.files) {
    added += file.added;
    removed += file.removed;
  }
  return `${reviewWords.froms[entry.from]} · ${reviewWords.files(entry.files.length)} ${reviewWords.tally(added, removed)}`;
}
