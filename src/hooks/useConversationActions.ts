/**
 * What a person does to a conversation, bound to the conversation they did it
 * in at the moment they did it.
 *
 * Every one of these is a press: send a sentence, take one back out of the
 * queue, put a failed send back in the box, add a file, write a draft. Each
 * takes the owner it acts on, because a send is a round trip and somebody may
 * have moved to another chat while it was going — a hook that read "the
 * conversation on screen" at the end of an await would put one chat's refusal
 * into another chat's box.
 *
 * The window decides nothing here. This is the shape of the press and where its
 * answer goes; the shell is the one that acts.
 */

import { useCallback } from 'react';

import type { Attachment } from '../components/Attachments';
import {
  changeThread,
  currentDesk,
  intoTheBox,
  putBackTheBox,
  tookBackTheLine,
  tookTheBox,
  type Desks,
  type Owned,
} from '../lib/projects';

export type ConversationActions = {
  /** The conversation the box on screen belongs to, bound at this render — a
   *  keystroke or a file that arrives after a switch belongs to the chat it was
   *  made in. */
  boxOwner: Owned | null;
  /** Put a sentence in the box of the conversation named, composed with
   *  whatever is already there. An example, a handoff note, a line taken back
   *  and a send that came back refused all arrive here. */
  writeDraft(owner: Owned | null, change: (was: string) => string): void;
  /** The same, for the conversation on screen. */
  handIn(change: (was: string) => string): void;
  /** The box's own words on their way back to the conversation they belong to,
   *  bound at the render the box was drawn for. */
  keepDraftAt(owner: Owned | null): (text: string) => void;
  /** Take out of the box what has just been sent, and nothing else. */
  emptyTheBox(owner: Owned | null, accepted: readonly Attachment[]): void;
  /** A send that did not go, back in the box it came from. */
  putBack(owner: Owned, said: string): void;
  /** What came back out of the queue, out of the thread and into the box, in
   *  one write. With no folder open there is no thread to clear. */
  takeBack(owner: Owned | null, words: readonly string[]): void;
  /** Set the box of the conversation on screen — what the composer reports
   *  after an attach, a paste or a removal. */
  fillBox(next: readonly Attachment[]): void;
};

export function useConversationActions(options: {
  /** The desks as they stand, read inside callbacks subscribed once. */
  desksNow: { current: Desks };
  setDesks(change: (current: Desks) => Desks): void;
  /** The conversation in front, as the render has it. The box on screen belongs
   *  to this one, and to no other. */
  front: Owned | null;
  /** The sentence and the box before there is a project to put them in. */
  setLooseDraft(change: (was: string) => string): void;
  emptyLoose(): void;
  fillLoose(next: readonly Attachment[]): void;
}): ConversationActions {
  const { desksNow, setDesks, front, setLooseDraft, emptyLoose, fillLoose } = options;

  /** Whose box the window is looking at, worked out at the moment of asking
   *  rather than at the moment of rendering. */
  const owner = useCallback((): Owned | null => {
    const here = currentDesk(desksNow.current);
    return here === null ? null : { project: here.path, address: here.address };
  }, [desksNow]);

  const writeDraft = useCallback(
    (owner: Owned | null, change: (was: string) => string) => {
      if (owner === null) {
        setLooseDraft(change);
        return;
      }
      setDesks((current) =>
        changeThread(current, owner, (one) => {
          const next = change(one.draft);
          return next === one.draft ? one : { ...one, draft: next };
        }),
      );
    },
    [setDesks, setLooseDraft],
  );

  const handIn = useCallback(
    (change: (was: string) => string) => writeDraft(owner(), change),
    [owner, writeDraft],
  );

  const keepDraftAt = useCallback(
    (owner: Owned | null) => (text: string) => writeDraft(owner, () => text),
    [writeDraft],
  );

  const emptyTheBox = useCallback(
    (owner: Owned | null, accepted: readonly Attachment[]) => {
      if (owner === null) {
        emptyLoose();
        return;
      }
      setDesks((current) => tookTheBox(current, owner, accepted));
    },
    [emptyLoose, setDesks],
  );

  const putBack = useCallback(
    (owner: Owned, said: string) => {
      setDesks((current) => putBackTheBox(current, owner, said));
    },
    [setDesks],
  );

  const takeBack = useCallback(
    (owner: Owned | null, words: readonly string[]) => {
      if (owner === null) {
        setLooseDraft((was) => intoTheBox(was, words));
        return;
      }
      setDesks((current) => tookBackTheLine(current, owner, words));
    },
    [setDesks, setLooseDraft],
  );

  const fillBox = useCallback(
    (next: readonly Attachment[]) => {
      if (front === null) {
        fillLoose(next);
        return;
      }
      setDesks((current) =>
        changeThread(current, front, (one) => ({ ...one, attachments: next })),
      );
    },
    [front, fillLoose, setDesks],
  );

  return {
    boxOwner: front,
    writeDraft,
    handIn,
    keepDraftAt,
    emptyTheBox,
    putBack,
    takeBack,
    fillBox,
  };
}
