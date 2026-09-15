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

/**
 * What a review was read against.
 *
 * `source` identifies the copy's state as it was reviewed — the revision and
 * the working tree together, since a copy's work is usually uncommitted — and
 * `target` the revision of the workspace the work would land in. Both sides can
 * move while somebody reads, and a decision taken against one of them is not a
 * decision about what is on disk now.
 *
 * The working tree half is built by `treeReading` and carries a hash per path:
 * a file written again under the same name is a different reading, which is the
 * case a status line alone cannot see.
 *
 * Optional on the record, and deliberately: an entry that was never opened
 * against a readable state has nothing to be checked against, and `staleDecision`
 * refuses those rather than letting them through unchecked.
 */
export type ReviewSnapshot = { source: string; target: string };

/** One path the working tree reports as moved, and the content behind it. */
export type TreeEntry = {
  /** Two characters, as git writes them: staged state then worktree state. */
  state: string;
  path: string;
  /** What the path holds: the hash of its bytes, or why there are none. */
  hash: string;
};

/**
 * A working tree as one string two readings can be compared by.
 *
 * The path and the status are not enough on their own. `git status` says
 * " M a.ts" both before and after an editor or a terminal writes that file
 * again, so two readings of a tree that really are different would compare
 * equal, and a decision taken against one would be carried out against the
 * other. The hash moves when the bytes do, which is the whole of what makes a
 * stale decision detectable.
 */
export function treeReading(revision: string, entries: readonly TreeEntry[]): string {
  return [revision, ...entries.map((one) => `${one.state} ${one.path} ${one.hash}`)].join('\n');
}

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
  /** What the files above were read from. A decision is scoped to it, and an
   *  entry without one cannot be decided. */
  snapshot?: ReviewSnapshot;
  /** Decisions taken file by file. A path with no entry follows whatever the
   *  whole entry is told to do. */
  choices?: Readonly<Record<string, FileVerdict>>;
  /**
   * A row an older version of the app wrote, with no conversation behind it.
   *
   * Held work used to be recorded once per project rather than once per run, so
   * a row can outlive any record of which chat it came from. It is kept rather
   * than dropped — its files are still on disk, and a review nobody can see is
   * worse than one nobody can answer — and it is drawn without anything that
   * would carry it over, because there is no copy to carry it from.
   */
  unattributed?: true;
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
  snapshot?: ReviewSnapshot;
};

export const reviewWords = {
  heading: 'Review',
  nothing: 'Nothing waiting for you.',
  nothingDetail: 'Work finished in the background arrives here before it touches your folder.',
  /** The four decisions, in the order they are offered. */
  take: 'Take it',
  mine: 'Keep mine',
  again: 'Ask again',
  drop: 'Throw away',
  /** The same two, per file. */
  takeFile: 'Take theirs',
  keepFile: 'Keep mine',
  /** The one press after a review that says yes: the branch arrives as one
   *  commit unless somebody asks for the conversation's own saves. */
  land: 'Land',
  /** The one press after the decision, named by the decision. */
  does: {
    'take it': 'Land',
    'keep mine': 'Keep my files',
    'ask again': 'Send back',
    'drop it': 'Throw it away',
  } as const,
  /** Said under the press before the one that cannot be undone. */
  dropWhy: 'Its branch stays; only the copy goes.',
  /** Where the old behaviour lives now: one row in a menu rather than a switch
   *  and a sentence above the decision. */
  menu: 'More',
  openDiff: 'See what changed',
  /** The two ways a landing can arrive, named as themselves. The precise one
   *  sits behind Land rather than in a settings screen. */
  landingHow: 'How it arrives',
  openPr: 'Open a pull request',
  opening: 'Opening the pull request…',
  landing: 'Landing…',
  /** A land cannot keep the conversation’s own saves once files are left out
   *  of it, so the precise control says so rather than quietly ignoring it. */
  heldBackNote: 'Files you kept your own version of stay out, so this arrives as one commit.',
  nothingChosen: 'Every file here is set to keep your own version, so there is nothing to take.',
  /** Said once, the first time work waits here instead of arriving. Without it
   *  the old behaviour looks like the work went missing. */
  firstTime:
    'Finished work now waits in Review instead of arriving in your folder. Open Review, or turn on carrying files as it works from the entry’s menu.',
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
  /** A row with no conversation behind it: an older version recorded finished
   *  work once per project, so which chat it came from is not written down
   *  anywhere. Said plainly, because the row is otherwise unanswerable. */
  older: 'From an older version of Graphe',
  olderWhy:
    'This was recorded before Graphe kept which chat the work came from, so there is no copy here to carry it over from. It is listed rather than thrown away: its files are still where they were.',
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
  /** A decision taken against files that have since changed. Nothing is carried
   *  out: the answer was about a state of the work that is not there any more. */
  stale: (title: string): string =>
    `“${title}” changed while you were reading it, so I did not carry anything over. It is back in Review as it is now.`,
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
 * Except when the copy or the workspace it would land in has moved since: those
 * decisions were taken about files that are not these files any more, so the
 * entry comes back unread and undecided rather than carrying a stale answer
 * forward. An arrival that changed no files never joins: there is nothing to
 * look at.
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
    // Both sides are in the snapshot, so one comparison covers the copy moving
    // on and the workspace it lands in changing underneath the review.
    const same = sameSnapshot(before?.snapshot, one.snapshot);
    byId.set(one.id, {
      id: one.id,
      from: one.from,
      title: one.title,
      address: one.address,
      files: one.files,
      at: one.at,
      snapshot: one.snapshot,
      read: same ? (before?.read ?? false) : false,
      ...(same && before?.choices !== undefined ? { choices: before.choices } : {}),
    });
  }

  return [...byId.values()].sort((one, other) => other.at - one.at);
}

/** Whether two readings are of the same thing.
 *
 * A reading nobody made is not the same as one that moved: an entry waiting
 * from a session that could not read the state keeps what a person has already
 * done to it, and only a state that is known to have changed sends it back.
 * Deciding is the other way round, and `staleDecision` is where that is. */
export function sameSnapshot(one?: ReviewSnapshot, other?: ReviewSnapshot): boolean {
  if (one === undefined || other === undefined) return true;
  return one.source === other.source && one.target === other.target;
}

/**
 * Whether a decision about `entry` is still about what is on disk.
 *
 * True when either side moved — the copy's files, or the workspace they would
 * land in — and true when either reading is missing, because a decision nobody
 * can check is not one to carry out.
 */
export function staleDecision(entry: Entry, now: ReviewSnapshot | null): boolean {
  if (now === null || entry.snapshot === undefined) return true;
  return entry.snapshot.source !== now.source || entry.snapshot.target !== now.target;
}

/** The entry after the work behind it moved: undecided and unread, so the next
 *  person to look at it is looking at what is there now. */
export function reviewedAgain(entry: Entry, snapshot: ReviewSnapshot): Entry {
  const { choices: _stale, ...rest } = entry;
  return { ...rest, snapshot, read: false };
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
      ? {
          id: one.id,
          from: one.from,
          title: one.title,
          address: one.address,
          files: one.files,
          at: one.at,
          read: one.read,
          snapshot: one.snapshot,
        }
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
 * bring across. Nor can a piece from the board, whose copy is detached and has
 * no branch at all. Said out loud on the control rather than ignored under it.
 */
export function landsAsOneCommit(entry: Entry): boolean {
  return heldBack(entry) > 0 || entry.from === 'board';
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
  const from = entry.unattributed === true ? reviewWords.older : reviewWords.froms[entry.from];
  return `${from} · ${reviewWords.files(entry.files.length)} ${reviewWords.tally(added, removed)}`;
}
