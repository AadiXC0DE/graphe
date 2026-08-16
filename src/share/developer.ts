/** Handing the work to a developer, end to end.
 *
 * The one place in this feature that spawns anything. Everything it decides —
 * what the work is called, what the write-up says, whether any of it is safe to
 * send — comes from `handover.ts` and `tools.ts`, which know nothing about
 * processes and can be tested without one.
 *
 * ## The order, and why it is that order
 *
 * Nothing leaves until the last step. The work is gathered, the pictures are
 * carried along with it, the write-up is built and checked for keys, and only
 * then — on a press that already said what would happen — is anything sent.
 * Every step before that can be undone by letting one name go.
 */

import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { HistoryError, ProjectHistory } from '../history/repo';
import {
  describeForReview,
  handoverWords,
  nameForWork,
  safeToHandOver,
  safeToWriteTo,
  titleOf,
  whereAPictureLives,
  type Handover,
  type Piece,
} from './handover';
import { commitSubject } from '../lib/conventional';
import { canSendItOn, readSignedIn, readWhereItLives, type Found } from './tools';
import { reviewPage, type Review, type Shown } from './review';
import { notHere, runHelper } from './run';

/** The helper that talks to where most teams keep their work. */
const HELPER = 'gh';

/** How many changes travel. Past this it is an archive, not a review, and
 *  nobody approves an archive. */
const MOST = 6;

/** Where the pictures sit inside the work itself. A dot folder, so it stays out
 *  of the way of everything a person actually opens. */
const ALONGSIDE = '.graphe/what-changed';

/** One change with its pictures still as files on this computer. */
export type Change = {
  title: string;
  says: string;
  where: string | null;
  before: string | null;
  after: string | null;
};

export type Handed = {
  /** True when it went all the way to where the team works. */
  sent: boolean;
  /** What this piece of work is called. */
  name: string;
  /** Where somebody can go and look at it, when it got that far. */
  address: string | null;
  /** The sentence to put in front of the person. */
  says: string;
  /** The real names and commands, for "Show me" and nowhere else. */
  steps: readonly string[];
};

export type HandOverOptions = {
  history: ProjectHistory;
  /** The project folder. */
  folder: string;
  /** What people call this project. */
  name: string;
  /** Somewhere outside the project to assemble the work in. */
  under: string;
  /** One line naming the whole piece of work. */
  title: string;
  changes: readonly Change[];
  at: number;
  /** What the work so far cost, already written as money. Left off when null. */
  spent?: string | null;
};

/** Something we stopped at, already written for a person. */
export class HandoverError extends Error {
  readonly details: string;

  constructor(message: string, details = '') {
    super(message);
    this.name = 'HandoverError';
    this.details = details;
  }
}

/* -------------------------------------------------------------------------- */
/* Looking                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * What this computer has for reaching the team's copy.
 *
 * Detected, never assumed. Each answer is separate because each absence has its
 * own sentence, and "it did not work" is not one of them.
 */
export async function whatIsHere(folder: string): Promise<Found> {
  const there = await runHelper(HELPER, ['--version'], { folder, patience: 15_000 });
  if (notHere(there) || there.code !== 0) {
    return { helper: false, signedIn: false, home: null, theProjectItself: null };
  }

  const account = await runHelper(HELPER, ['auth', 'status'], { folder, patience: 30_000 });
  const signedIn = readSignedIn(account.code, account.said);
  if (!signedIn) return { helper: true, signedIn: false, home: null, theProjectItself: null };

  const where = await runHelper(
    HELPER,
    ['repo', 'view', '--json', 'nameWithOwner,defaultBranchRef'],
    { folder, patience: 30_000 },
  );
  const lives = where.code === 0 ? readWhereItLives(where.out) : { home: null, theProjectItself: null };
  return { helper: true, signedIn: true, ...lives };
}

/* -------------------------------------------------------------------------- */
/* Assembling                                                                  */
/* -------------------------------------------------------------------------- */

function pictureName(at: number, half: 'before' | 'after'): string {
  return `${ALONGSIDE}/${String(at + 1).padStart(2, '0')}-${half}.png`;
}

async function asPicture(file: string | null): Promise<string | null> {
  if (file === null) return null;
  try {
    const bytes = await readFile(file);
    return `data:image/png;base64,${bytes.toString('base64')}`;
  } catch {
    return null;
  }
}

/**
 * Put the pictures alongside the work, and give the write-up their addresses.
 *
 * This is the honest answer to a description that wants to show pictures: they
 * travel with the work rather than being links to somewhere that might not
 * still be there in a month. The cost is two small files per change inside a
 * dot folder; the alternative is a write-up full of broken images, which is
 * worse than one with none.
 */
async function carryPictures(
  into: string,
  changes: readonly Change[],
  home: string | null,
  name: string,
): Promise<Piece[]> {
  await mkdir(path.join(into, ALONGSIDE), { recursive: true });
  const pieces: Piece[] = [];

  for (const [at, change] of changes.entries()) {
    const carried: { before: string | null; after: string | null } = { before: null, after: null };
    for (const half of ['before', 'after'] as const) {
      const from = change[half];
      if (from === null) continue;
      const relative = pictureName(at, half);
      try {
        await copyFile(from, path.join(into, relative));
      } catch {
        continue;
      }
      carried[half] = home === null ? null : whereAPictureLives(home, name, relative);
    }
    pieces.push({
      title: change.title,
      says: change.says,
      where: change.where,
      pictures: carried,
    });
  }
  return pieces;
}

/** The same write-up as a page anybody can open with no network at all, kept
 *  beside the pictures. One file, and it works a year later on a train. */
async function pageBeside(
  into: string,
  project: string,
  changes: readonly Change[],
  at: number,
  spent: string | null,
): Promise<void> {
  const shown: Shown[] = [];
  for (const change of changes) {
    shown.push({
      title: change.title,
      when: at,
      says: [change.says, change.where].filter((one) => one !== null && one !== '').join(' '),
      before: await asPicture(change.before),
      after: await asPicture(change.after),
    });
  }
  const review: Review = { project, made: at, changes: shown, spent };
  await writeFile(path.join(into, ALONGSIDE, 'what-changed.html'), reviewPage(review), 'utf8');
}

/**
 * Assemble the work in a copy of the project, and let the copy go.
 *
 * A copy rather than the folder somebody is looking at, for the reason every
 * copy in this codebase exists: the pictures and the page are ours, and nothing
 * of ours may appear in the files a person is working in.
 */
async function gather(options: {
  history: ProjectHistory;
  under: string;
  name: string;
  /** What people call this project. */
  projectName: string;
  title: string;
  changes: readonly Change[];
  at: number;
  spent: string | null;
  home: string | null;
}): Promise<{ pieces: Piece[]; version: string | null }> {
  const where = path.join(options.under, options.name.replace(/\//g, '-'));
  try {
    await rm(where, { recursive: true, force: true });
    await mkdir(path.dirname(where), { recursive: true });
    await options.history.addWorkspace(where);
    const pieces = await carryPictures(where, options.changes, options.home, options.name);
    await pageBeside(where, options.projectName, options.changes, options.at, options.spent);
    const version = await new ProjectHistory(where).snapshot(
      titleOf({ project: options.projectName, title: options.title, pieces }),
    );
    return { pieces, version };
  } finally {
    await options.history.removeWorkspace(where).catch(() => undefined);
    await rm(where, { recursive: true, force: true }).catch(() => undefined);
  }
}

/* -------------------------------------------------------------------------- */
/* The whole thing                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Gather the work, write it up, and — only if this computer can — send it on.
 *
 * Never force. Never the copy everybody else works from. Never anything at all
 * unless the caller was pressed, which is the caller's job to know and this
 * module's job to assume nothing about.
 */
export async function handToDeveloper(options: HandOverOptions): Promise<Handed> {
  const changes = options.changes.slice(0, MOST);
  if (changes.length === 0) throw new HandoverError(handoverWords.nothingToHandOver);

  const found = await whatIsHere(options.folder);
  const shared = await options.history.sharedCopy();
  const reach = canSendItOn({ ...found, home: shared === null ? null : found.home });

  const name = nameForWork(options.title, options.at);
  if (!safeToWriteTo(name, found.theProjectItself)) {
    throw new HandoverError(handoverWords.couldNotSend);
  }

  // Before a single file is written, let alone sent: the words are the same
  // either way, and doing the work first would mean assembling something we
  // then had to be trusted to throw away.
  const safe = safeToHandOver({
    project: options.name,
    title: options.title,
    pieces: changes.map((change) => ({
      title: change.title,
      says: change.says,
      where: change.where,
      pictures: { before: null, after: null },
    })),
  });
  if (!safe.ok) throw new HandoverError(safe.because);

  const gathered = await gather({
    history: options.history,
    under: options.under,
    name,
    projectName: options.name,
    title: options.title,
    changes,
    at: options.at,
    spent: options.spent ?? null,
    home: reach.all ? found.home : null,
  });
  if (gathered.version === null) throw new HandoverError(handoverWords.nothingToHandOver);
  const version = gathered.version;

  const handover: Handover = {
    project: options.name,
    title: options.title,
    pieces: gathered.pieces,
  };
  await options.history.nameLine(name, version);

  const steps = [
    `git push -u origin ${name}`,
    `gh pr create --head ${name} --title "${commitSubject(titleOf(handover))}"`,
  ];

  // As far as this computer can take it. The sentence is the one that names
  // what is missing, and it already says where the work is waiting.
  if (!reach.all) return { sent: false, name, address: null, says: reach.says, steps };

  try {
    await options.history.sendLine(name);
  } catch (cause) {
    const details = cause instanceof HistoryError ? cause.details : '';
    throw new HandoverError(handoverWords.couldNotSend, details);
  }

  const asked = await runHelper(
    HELPER,
    [
      'pr',
      'create',
      '--head',
      name,
      ...(found.theProjectItself === null ? [] : ['--base', found.theProjectItself]),
      '--title',
      titleOf(handover),
      '--body',
      describeForReview(handover),
    ],
    { folder: options.folder, patience: 90_000 },
  );

  if (asked.code !== 0) {
    // The work itself is safely across; only the write-up did not land. Say
    // exactly that rather than implying nothing happened.
    return { sent: true, name, address: null, says: handoverWords.sentWithoutWriteUp, steps };
  }

  return {
    sent: true,
    name,
    address: addressOf(asked.out),
    says: handoverWords.sent,
    steps,
  };
}

/** The one address the helper prints when it has made the request. */
function addressOf(out: string): string | null {
  const found = /https:\/\/\S+/.exec(out);
  return found === null ? null : found[0].replace(/[).,'"]+$/, '');
}
