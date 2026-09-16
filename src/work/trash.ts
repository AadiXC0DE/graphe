/** The trash as a screen: what is in it, and the two presses that change it.
 *
 * Deleting a conversation keeps it, so the way back is worth a place somebody
 * can find — beside the folders on the Storage page, because that is where
 * somebody looks for what this app is keeping. Every press re-lists afterwards:
 * what is in the list is the only proof the press worked, and the list is what
 * the shell has rather than what the window hoped for.
 *
 * Nothing here reads the disk, and nothing here holds the words on screen: this
 * is the wire between the section and the three calls the shell already
 * answers, kept apart so the section can be drawn and pressed with a shell that
 * answers in a test.
 */

import type { Result, TrashView, Trouble } from '../lib/ipc';

/** The three calls the window already has for the trash, under the names the
 *  bridge answers to, so the wiring can be handed the bridge itself. */
export type TrashCalls = {
  /** What is in the trash, and the rule it is kept under. */
  trashList(): Promise<Result<TrashView>>;
  /** Put one back under the name the list gave. */
  trashRestore(name: string): Promise<Result<string | null>>;
  /** Throw away exactly these. */
  trashEmpty(names: readonly string[]): Promise<Result<readonly string[]>>;
};

/** What the section does when somebody presses one of its two. */
export type TrashWire = {
  /** List it again and hand the answer over. */
  reload: () => void;
  /** Put one back, by the name it was listed under. */
  restore: (name: string) => void;
  /** Throw away exactly these, and nothing else in the trash. */
  empty: (names: readonly string[]) => void;
};

/**
 * The section's two presses, wired to the shell.
 *
 * An empty selection sends nothing at all: the trash empties what somebody
 * pointed at, and a press that means "all of it" is one nobody can take back.
 * The shell refuses the same thing for the same reason, and neither side
 * leans on the other to hold that line.
 */
export function trashActions(
  calls: TrashCalls,
  changed: (trash: TrashView) => void,
  said: (sentence: string) => void,
): TrashWire {
  /* The shell's own two sentences, in the order they were written to be read:
     what happened, then the likeliest reason. */
  const refused = (trouble: Trouble): void => {
    said(`${trouble.what} ${trouble.because}`);
  };

  const reload = (): void => {
    void calls.trashList().then((answer) => {
      if (answer.ok) changed(answer.value);
      else refused(answer.trouble);
    });
  };

  return {
    reload,
    restore: (name) => {
      if (name === '') return;
      void calls.trashRestore(name).then((answer) => {
        /* A refusal is a conversation already under that name: the kept copy is
           still in the trash, and the person is owed the sentence saying so. */
        if (answer.ok) reload();
        else refused(answer.trouble);
      });
    },
    empty: (names) => {
      const asked = [...new Set(names)].filter((one) => one !== '');
      if (asked.length === 0) return;
      void calls.trashEmpty(asked).then((answer) => {
        if (answer.ok) reload();
        else refused(answer.trouble);
      });
    },
  };
}
