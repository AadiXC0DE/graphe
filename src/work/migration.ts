/** The move of older chats, as a screen: what it found and the two presses that
 *  answer it.
 *
 * The shell writes down what the one-time move did, and until now that record
 * only reached the log. This is the reading a person gets instead: how many
 * chats were brought across, where the copies of the files it replaced are, and
 * the two things anybody does with a number they do not like, look at the
 * folder and ask again.
 *
 * The sentences are here rather than in the component so the counts and the
 * words about them cannot drift, and so what the screen would say can be read
 * as a function of a record without an app around it.
 */

import type { MigrationNow, Result, Trouble } from '../lib/ipc';
import { agoInSentence } from '../lib/when';

/** "1 chat" against "4 chats", because a count read out loud is a sentence. */
function chats(n: number): string {
  return n === 1 ? '1 chat' : `${String(n)} chats`;
}

/**
 * What the screen says, in the order it says it: when it happened, what it
 * found, what it could not place, and where the way back is.
 *
 * Each line exists because a count was not zero. A line saying "0 chats were
 * left out" tells somebody to worry about nothing, and the screen is read by
 * exactly the person who is already worried.
 *
 * Nothing at all is the answer for a computer that never needed the move, which
 * is every fresh install: a record is written on every run, so one exists with
 * nothing in it and must not be read as something that happened.
 */
export function saysMigration(now: MigrationNow, at: number = Date.now()): readonly string[] {
  if (!now.newer && now.sources === 0) return [];
  const said: string[] = [];
  if (now.completedAt !== null) {
    said.push(`Moved ${agoInSentence(now.completedAt, at)}.`);
    said.push(`It went through where ${chats(now.sources)} had been working.`);
    if (now.verdicts.verified > 0) {
      said.push(`${chats(now.verdicts.verified)} were in the folder they had been using.`);
    }
    if (now.verdicts.missing > 0) {
      said.push(
        `${chats(now.verdicts.missing)} had lost their folder. The branch they were on is still here.`,
      );
    }
    if (now.verdicts.gone > 0) {
      said.push(
        `${chats(now.verdicts.gone)} had lost both their folder and their branch, so there is nowhere to point them.`,
      );
    }
    if (now.verdicts.foreign > 0) {
      said.push(
        `${chats(now.verdicts.foreign)} were working in a folder Graphe does not manage, so they were left exactly where they are.`,
      );
    }
    if (now.connected > 0) {
      said.push(
        now.connected === 1
          ? 'One of them now opens where it was working.'
          : `${String(now.connected)} of them now open where they were working.`,
      );
    }
    if (now.unlinked > 0) {
      said.push(
        `${chats(now.unlinked)} could not be placed. A chat that is already open keeps the folder it has.`,
      );
    }
    if (now.unreadable > 0) {
      said.push(
        `${String(now.unreadable)} of the notes about them could not be read, and were kept aside rather than thrown away.`,
      );
    }
    if (now.backups === null) {
      said.push('The version that moved them did not write down the copies it kept.');
    } else if (now.backups > 0) {
      said.push(
        now.backups === 1
          ? 'One copy of a file it replaced is still beside it.'
          : `${String(now.backups)} copies of the files it replaced are still beside them.`,
      );
    }
  }
  if (now.newer) {
    said.push('This record of where your chats work was written by a newer version of Graphe.');
    said.push(
      'Graphe has left it exactly as it is and is not writing to it. Open the newer version again, or put a copy back with Graphe closed.',
    );
    said.push('Do not delete it by hand to clear this: it is where every chat finds its files.');
  }
  return said;
}

/** The three calls the window already has for the move, under the names the
 *  bridge answers to, so the wiring can be handed the bridge itself. */
export type MigrationCalls = {
  /** What the move found. */
  migration(): Promise<Result<MigrationNow>>;
  /** The same check again, which changes nothing the second time. */
  migrationCheck(): Promise<Result<MigrationNow>>;
  /** Show the copies it kept where this computer keeps files. */
  showBackups(): Promise<Result<null>>;
};

export type MigrationWire = {
  /** Ask again and hand the answer over. */
  reload: () => void;
  /** Run the check again, and hand over what it found this time. */
  check: () => void;
  /** Show the copies, so a recovery does not start with finding a path. */
  backups: () => void;
};

/**
 * The section's two presses, wired to the shell.
 *
 * Both take the answer the shell gives rather than assuming one: a check that
 * finds the same folders is proof the first one was right, and the readout is
 * redrawn from what came back instead of from what was hoped for.
 */
export function migrationActions(
  calls: MigrationCalls,
  changed: (now: MigrationNow) => void,
  said: (sentence: string) => void,
): MigrationWire {
  /* The shell's own two sentences, in the order they were written to be read:
     what happened, then the likeliest reason. */
  const refused = (trouble: Trouble): void => {
    said(`${trouble.what} ${trouble.because}`);
  };

  return {
    reload: () => {
      void calls.migration().then((answer) => {
        if (answer.ok) changed(answer.value);
        else refused(answer.trouble);
      });
    },
    check: () => {
      void calls.migrationCheck().then((answer) => {
        if (answer.ok) changed(answer.value);
        else refused(answer.trouble);
      });
    },
    backups: () => {
      void calls.showBackups().then((answer) => {
        if (!answer.ok) refused(answer.trouble);
      });
    },
  };
}
