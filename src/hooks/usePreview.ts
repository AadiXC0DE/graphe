/**
 * The project's own page, beside the conversation.
 *
 * The page is drawn by the shell, above the window's own contents, so the
 * window can only say where it is, how much room it has, and whether it is
 * there at all. Everything here is one of those three.
 *
 * Each piece of it is mirrored into a ref as well as state because the one
 * event listener is subscribed once for the life of the window and cannot close
 * over a changing value.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';

import type { Room as PaneRoom } from '../components/BrowserPane';
import { bridge } from '../lib/bridge';
import { recordedIn, type Desks, type Recorded } from '../lib/projects';
import type { Trouble } from '../lib/ipc';

export type Preview = {
  /** How the window is split between the conversation and the page. */
  pane: PaneRoom;
  paneNow: MutableRefObject<PaneRoom>;
  move(next: PaneRoom): void;
  toggle(): void;
  /** Where the page is pointed. Null until something is being served. */
  pageAt: string | null;
  setPageAt: Dispatch<SetStateAction<string | null>>;
  pageAtNow: MutableRefObject<string | null>;
  /** Where the page is drawn, as the pane reports its own box. */
  movedPage(bounds: { x: number; y: number; width: number; height: number }): void;
  /** A served address the window may open on its own. True once per address,
   *  so a pane somebody deliberately closed is not reopened. */
  opensItself(address: string): boolean;
  /** True while a walkthrough is being recorded in the page. */
  recording: boolean;
  /** The last walkthrough, waiting to be looked through. */
  recorded: Recorded | null;
  setRecorded: Dispatch<SetStateAction<Recorded | null>>;
  record(want: boolean): void;
};

export function usePreview(options: {
  desksNow: { current: Desks };
  troubleHere: (trouble: Trouble) => void;
}): Preview {
  const { desksNow, troubleHere } = options;

  const [pane, setPane] = useState<PaneRoom>('off');
  const paneNow = useRef<PaneRoom>('off');
  const [pageAt, setPageAt] = useState<string | null>(null);
  const pageAtNow = useRef<string | null>(null);
  /** The address the window opened on its own, so it does so once and does not
   *  reopen a pane somebody deliberately closed. */
  const openedItself = useRef<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [recorded, setRecorded] = useState<Recorded | null>(null);

  /** Stable on purpose: the pane reports its box from an effect, and a callback
   *  rebuilt on every render made that effect run on every render — which,
   *  while a turn was working, was constantly. */
  const movedPage = useCallback(
    (bounds: { x: number; y: number; width: number; height: number }) => {
      void bridge.pageAt(pageAtNow.current, bounds);
    },
    [],
  );

  const move = useCallback((next: PaneRoom) => {
    paneNow.current = next;
    setPane(next);
  }, []);

  const toggle = useCallback(() => {
    setPane((was) => {
      const next = was === 'whole' ? 'split' : was === 'split' ? 'whole' : 'split';
      paneNow.current = next;
      return next;
    });
  }, []);

  const opensItself = useCallback((address: string) => {
    if (openedItself.current === address) return false;
    openedItself.current = address;
    return true;
  }, []);

  /**
   * Record somebody using the page, and keep what it saw.
   *
   * Nothing is asked for first: the states worth arguing about — hovered,
   * loading, empty, the message that shows for two seconds — only exist while
   * somebody is using the page, so anything that has to be filled in beforehand
   * is a state already gone. What comes back goes into the conversation, where
   * everything else about the work already is.
   */
  const record = useCallback(
    (want: boolean) => {
      if (want) {
        setRecorded(null);
        void bridge.watchStart().then((answer) => {
          if (!answer.ok) {
            troubleHere(answer.trouble);
            return;
          }
          setRecording(true);
        });
        return;
      }
      // Off the moment it is pressed, whatever the run turns out to hold: a
      // control that stays lit while the pictures come back reads as one that
      // did not hear the press.
      setRecording(false);
      void bridge.watchStop().then((answer) => {
        if (!answer.ok) {
          troubleHere(answer.trouble);
          return;
        }
        setRecorded(recordedIn(desksNow.current.current, answer.value));
      });
    },
    [desksNow, troubleHere],
  );

  /* The page closes when the pane does, rather than lingering behind a window
     that is no longer showing it. */
  useEffect(() => {
    if (pane !== 'off') return;
    void bridge.pageAt(null, null);
  }, [pane]);

  /* Closing the pane takes the page with it, so a run against it is over
     whether or not anybody pressed stop — and what it saw is kept, because
     closing the page is not asking to throw the last few minutes away. */
  useEffect(() => {
    if (pane !== 'off' || !recording) return;
    record(false);
  }, [pane, recording, record]);

  return useMemo(() => ({
    pane,
    paneNow,
    move,
    toggle,
    pageAt,
    setPageAt,
    pageAtNow,
    movedPage,
    opensItself,
    recording,
    recorded,
    setRecorded,
    record,
  }), [pane, pageAt, movedPage, move, toggle, opensItself, recording, recorded, record]);
}
