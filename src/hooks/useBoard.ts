/**
 * The board: what is happening for each project whether or not this window is
 * looking at it.
 *
 * Kept per folder, for the same reason the pictures and the files are — a run
 * can land for a project somebody has just switched away from, and it must
 * never be drawn under another folder's name. Every press answers with the
 * whole state, so the window never works out what its own press did.
 *
 * It carries its own clock because the board says how long ago each thing was,
 * and nothing else in the window needs to know the time.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { bridge } from '../lib/bridge';
import { folderCalled, type Desks } from '../lib/projects';
import { quietWords, wentQuiet } from '../work/board';
import type {
  Away as AwayState,
  Decision,
  EveryKind,
  SideOfWork,
  Trouble,
} from '../lib/ipc';

/** The several goes at one job, held up against each other. */
export type Against = {
  where: string;
  /** What the goes are goes at, for the strip that stands against them. */
  subject: string;
  sides: readonly SideOfWork[];
};

export type Board = {
  /** The board of the project in front, or null when it has nothing on it. */
  here: AwayState | null;
  /** Every other folder that has anything of its own going on. */
  elsewhere: readonly { where: string; project: string; away: AwayState }[];
  /** Half-minute ticks, so "20 minutes ago" stays true while nobody touches
   *  anything. */
  clock: number;
  against: Against | null;
  setAgainst: (next: Against | null) => void;
  keepGoing(text: string, untilDone?: boolean): void;
  startAfter(text: string, after: string): void;
  keepAway(id: string, where?: string, then?: (ok: boolean) => void): void;
  dropAway(id: string, where?: string): void;
  answerAway(id: string, callId: string, decision: Decision, where?: string): void;
  sayToAway(id: string, text: string, where?: string): Promise<boolean>;
  compareWays(named: string, where?: string): void;
  takeAll(ids: readonly string[], where?: string): void;
  stopWaiting(id: string, where?: string): void;
  addRepeat(
    doing: string,
    every: EveryKind,
    at: { hour: number; minute: number },
    on?: number,
  ): void;
  switchRepeat(id: string, on: boolean): void;
  forgetRepeat(id: string): void;
};

export function useBoard(options: {
  /** The desks as they stand, read inside listeners subscribed once. */
  desksNow: { current: Desks };
  /** The folder in front. */
  project: string | null;
  say: (text: string) => void;
  troubleHere: (trouble: Trouble) => void;
  refreshVersions: (path: string) => Promise<void>;
  refreshOverview: (path: string, conversation?: string | null) => Promise<void>;
}): Board {
  const { desksNow, project, say, troubleHere, refreshVersions, refreshOverview } = options;

  const [away, setAway] = useState<Readonly<Record<string, AwayState>>>({});
  /* Read while a loop is being put down, so each step is chained behind the id
     the board actually gave the one before it rather than a stale one — and,
     in the notice handler, to see what the board looked like a moment ago. */
  const awayNow = useRef<Readonly<Record<string, AwayState>>>({});
  awayNow.current = away;

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
      /* The last piece has landed. Work on the board carries on whether or not
         the conversation does — and used to finish with nothing said, so the
         conversation that started it never learned the thing it was waiting for
         had happened.

         Read against a ref rather than inside the state updater: this sends a
         message, and an updater that React may run twice is no place for one. */
      const over = wentQuiet(awayNow.current[notice.project]?.pieces, notice.away.pieces);
      if (over !== null) {
        const desk = desksNow.current.byPath[notice.project];
        // Only into a conversation with nothing already going: a run in flight
        // hears things between steps, and this is not that.
        if (desk !== undefined && desk.doing == null) {
          say(`Background work finished — ${String(over.length)} to look at.`);
          void bridge.prompt(
            quietWords(over),
            [],
            { queue: 'followUp' },
            {
              project: notice.project,
              ...(desk.address == null ? {} : { conversation: desk.address }),
            },
          );
        }
      }
      setAway((current) => ({ ...current, [notice.project]: notice.away }));
      setClock(Date.now());
    });
    // Subscribed once for the life of the window; everything it reads it reads
    // through a ref.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* Every folder's board, once, on the way in. Notices arrive as things happen;
     without this first read, work already running in a project nobody has
     opened yet would be invisible until it next moved. */
  useEffect(() => {
    void bridge.awayEverywhere().then((answer) => {
      if (!answer.ok) return;
      setAway((current) => {
        const next = { ...current };
        for (const notice of answer.value) next[notice.project] = notice.away;
        return next;
      });
    });
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

  const keepGoing = useCallback(
    (text: string, untilDone = false) => {
      if (project === null) return;
      void bridge.keepGoing(text, untilDone, { project }).then(afterAway(project));
    },
    [project, afterAway],
  );

  /** The same ask, in order: this one waits until that one has finished. The
   *  shell refuses a plan that could never run, and says why. */
  const startAfter = useCallback(
    (text: string, after: string) => {
      if (project === null) return;
      // A plan that could never run comes back refused, with the reason in
      // plain words — the same door every other failure comes through.
      void bridge.startAfter(text, after, { project }).then(afterAway(project));
    },
    [project, afterAway],
  );

  const keepAway = useCallback(
    // `then` is how a sheet finds out whether the press worked, so it can stay
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

  /** The several goes at one job, held up against each other. Read on the
   *  press: a go still working has a different answer a minute later. */
  const [against, setAgainst] = useState<Against | null>(null);

  const compareWays = useCallback(
    (named: string, where?: string) => {
      const path = where ?? project;
      if (path === null) return;
      void bridge.compareWays(named, { project: path }).then((answer) => {
        if (!answer.ok) {
          troubleHere(answer.trouble);
          return;
        }
        // Nothing left of the group to hold up against anything: an empty
        // sheet would be a screen with nothing on it and no way to read why.
        if (answer.value.length === 0) return;
        setAgainst({ where: path, subject: named, sides: answer.value });
      });
    },
    [project, troubleHere],
  );

  /** Take several finished pieces in, in the order they need to be in.
   *  Whatever happens, the whole run is one version away from undone. */
  const takeAll = useCallback(
    (ids: readonly string[], where?: string) => {
      const path = where ?? project;
      if (path === null) return;
      void bridge.keepSet(ids, { project: path }).then((answer) => {
        afterAway(path)(answer);
        // A set landing is a version like any other, and the rail has to say so.
        void refreshVersions(path);
        void refreshOverview(path);
      });
    },
    [project, afterAway, refreshVersions, refreshOverview],
  );

  /** Let a piece off the wait it was given, so it takes the next free slot.
   *  The wait could be set when work was asked for and never changed after —
   *  a piece waiting on something abandoned waited for good. */
  const stopWaiting = useCallback(
    (id: string, where?: string) => {
      const path = where ?? project;
      if (path === null) return;
      void bridge.putAfter(id, null, { project: path }).then(afterAway(path));
    },
    [project, afterAway],
  );

  const addRepeat = useCallback(
    (doing: string, every: EveryKind, at: { hour: number; minute: number }, on?: number) => {
      if (project === null) return;
      void bridge.addRepeat(doing, every, at, on, { project }).then(afterAway(project));
    },
    [project, afterAway],
  );

  const switchRepeat = useCallback(
    (id: string, on: boolean) => {
      if (project === null) return;
      void bridge.switchRepeat(id, on, { project }).then(afterAway(project));
    },
    [project, afterAway],
  );

  const forgetRepeat = useCallback(
    (id: string) => {
      if (project === null) return;
      void bridge.forgetRepeat(id, { project }).then(afterAway(project));
    },
    [project, afterAway],
  );

  const here = project === null ? null : (away[project] ?? null);

  /* Every other folder that has anything of its own going on. Work does not
     stop because somebody opened another project, and this is the only place
     that says so. */
  const elsewhere = useMemo(
    () =>
      Object.entries(away)
        .filter(([path, state]) => path !== project && state.pieces.length > 0)
        .map(([path, state]) => ({ where: path, project: folderCalled(path), away: state })),
    [away, project],
  );

  return useMemo(() => ({
    here,
    elsewhere,
    clock,
    against,
    setAgainst,
    keepGoing,
    startAfter,
    keepAway,
    dropAway,
    answerAway,
    sayToAway,
    compareWays,
    takeAll,
    stopWaiting,
    addRepeat,
    switchRepeat,
    forgetRepeat,
  }), [
    here, elsewhere, clock, against, keepGoing, startAfter, keepAway, dropAway,
    answerAway, sayToAway, compareWays, takeAll, stopWaiting, addRepeat,
    switchRepeat, forgetRepeat,
  ]);
}
