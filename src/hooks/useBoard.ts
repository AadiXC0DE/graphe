/**
 * The board: what background work is happening for the project in front,
 * whether or not this window is looking at it.
 *
 * Kept per folder, for the same reason the files are — a run can land for a
 * project somebody has just switched away from, and it must never be drawn
 * under another folder's name. Every press answers with the whole state, so the
 * window never works out what its own press did.
 *
 * It carries its own clock because the board says how long ago each thing was,
 * and nothing else in the window needs to know the time.
 *
 * Nothing here starts work. What can be started from the window is a
 * conversation; a piece of background work is asked for by the model, through
 * `task` in its background mode, and what the window does with it is answer it,
 * say something to it, take it in or let it go.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { bridge } from '../lib/bridge';
import type { Desks } from '../lib/projects';
import type { Away as AwayState, Decision, Trouble } from '../lib/ipc';

export type Board = {
  /** What this project has on it, or null when it has nothing. */
  here: AwayState | null;
  /** Half-minute ticks, so "20 minutes ago" stays true while nobody touches
   *  anything. */
  clock: number;
  /** Take one finished piece into the project. */
  keepAway(id: string, where?: string, then?: (ok: boolean) => void): void;
  /** Stop one, or let its result go. */
  dropAway(id: string, where?: string): void;
  /** Answer the question one of them stopped on. */
  answerAway(id: string, callId: string, decision: Decision, where?: string): void;
  /** Say something to a piece that is still going, without stopping it. */
  sayToAway(id: string, text: string, where?: string): Promise<boolean>;
};

export function useBoard(options: {
  /** The desks as they stand, read inside listeners subscribed once. */
  desksNow: { current: Desks };
  /** The folder in front. */
  project: string | null;
  troubleHere: (trouble: Trouble) => void;
  refreshVersions: (path: string) => Promise<void>;
  refreshOverview: (path: string, conversation?: string | null) => Promise<void>;
}): Board {
  const { desksNow, project, troubleHere, refreshVersions, refreshOverview } = options;

  const [away, setAway] = useState<Readonly<Record<string, AwayState>>>({});

  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const tick = window.setInterval(() => setClock(Date.now()), 30_000);
    return () => window.clearInterval(tick);
  }, []);

  const refreshAway = useCallback(
    async (path: string) => {
      const answer = await bridge.away({ project: path });
      if (!answer.ok || desksNow.current.current !== path) return;
      setAway((current) => ({ ...current, [path]: answer.value }));
    },
    [desksNow],
  );

  useEffect(() => {
    if (project === null) return;
    void refreshAway(project);
  }, [project, refreshAway]);

  /* Pushed at the window whenever something lands, including the first moment
     after it has been away and come back. Subscribed once. */
  useEffect(() => {
    return bridge.onAway((notice) => {
      // Only the board's own state. A piece finishing reaches the conversation
      // through the shell, which is the one thing allowed to send.
      setAway((current) => ({ ...current, [notice.project]: notice.away }));
      setClock(Date.now());
    });
    // Subscribed once for the life of the window.
  }, []);

  /** Everything the band can do comes back with the whole state, so the window
   *  never has to work out what its own press did. */
  const afterAway = useCallback(
    (path: string) => {
      return (answer: { ok: true; value: AwayState } | { ok: false; trouble: Trouble }) => {
        if (!answer.ok) {
          troubleHere(answer.trouble);
          return;
        }
        setAway((current) => ({ ...current, [path]: answer.value }));
      };
    },
    [troubleHere],
  );

  const keepAway = useCallback(
    // `then` is how a card finds out whether the press worked, so it can stay
    // where it is and show the reason when it did not.
    (id: string, where?: string, then?: (ok: boolean) => void) => {
      const path = where ?? project;
      if (path === null) return;
      void bridge.keepAway(id, { project: path }).then((answer) => {
        afterAway(path)(answer);
        // Keeping one is a version like any other, and the rail has to say so.
        void refreshVersions(path);
        void refreshOverview(path);
        then?.(answer.ok);
      });
    },
    [project, afterAway, refreshVersions, refreshOverview],
  );

  const dropAway = useCallback(
    (id: string, where?: string) => {
      const path = where ?? project;
      if (path === null) return;
      void bridge.stopAway(id, { project: path }).then(afterAway(path));
    },
    [project, afterAway],
  );

  /** The one press that can answer a question a run stopped on. Nothing else in
   *  this window, and nothing at all on the other side, can. */
  const answerAway = useCallback(
    (id: string, callId: string, decision: Decision, where?: string) => {
      const path = where ?? project;
      if (path === null) return;
      void bridge.answerAway(id, callId, decision, { project: path }).then(afterAway(path));
    },
    [project, afterAway],
  );

  /** A sentence into work already going. It is heard between steps, so nothing
   *  half-done is thrown away to make room for it. */
  const sayToAway = useCallback(
    async (id: string, text: string, where?: string): Promise<boolean> => {
      const path = where ?? project;
      if (path === null) return false;
      const answer = await bridge.sayToAway(id, text, { project: path });
      afterAway(path)(answer);
      // Handed back so the card can wait to say it was heard. A refusal is
      // already on screen as a sheet; a note beside it saying the opposite is
      // the one pair of sentences a person cannot reconcile.
      return answer.ok;
    },
    [project, afterAway],
  );

  const here = project === null ? null : (away[project] ?? null);

  return useMemo(
    () => ({ here, clock, keepAway, dropAway, answerAway, sayToAway }),
    [here, clock, keepAway, dropAway, answerAway, sayToAway],
  );
}
