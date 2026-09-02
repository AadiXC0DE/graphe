/**
 * The goal chip: one sentence saying what done looks like, and where it is
 * written down.
 *
 * Only the display and the store live here. Whether a run goes round again
 * toward the goal is decided in the shell, by the one authority that decides it
 * for every other reason too — the window draws what it is told and never runs
 * a loop of its own.
 *
 * A goal belongs to a folder, so every route that sets one names the folder it
 * is for: a turn settles long after it was sent, and somebody who switched
 * projects in between must not have this goal written into the one they are
 * looking at now.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';

import type { Plans } from '../components/HowToWork';
import { bridge } from '../lib/bridge';
import { currentDesk, type Desks } from '../lib/projects';
import {
  createGoal,
  elapsedWords,
  goalElapsed,
  goalStorageKey,
  parseGoalCommand,
  readStoredGoal,
  ROUNDS,
  withElapsed,
  type Goal,
  type ParsedGoal,
} from '../work/goal';

/** What the window still has to do once a /goal command has been answered. */
export type GoalAnswer = {
  /** The sentence to send on the person's behalf, or null when the command
   *  only had something to say. */
  send: string | null;
  /** What that sentence is priced as. Resuming sends a wrapper around the
   *  objective, and the wrapper is not the job. */
  priceOn: string;
  /** The goal has full access, so nothing stops to ask about money. */
  fullAccess: boolean;
};

export type GoalChip = {
  /** The goal as the chip shows it. */
  goal: Goal | null;
  /** The goal as it stands right now, read inside a callback that was built
   *  before the last change to it. */
  now(): Goal | null;
  /** Write it down for a named folder — disk through the shell, with local
   *  storage as a fallback. */
  persist(next: Goal | null, project: string | null): void;
  /** On screen and written down, in one move. */
  hold(next: Goal | null, project: string | null): void;
  /** On screen only when it belongs to the folder in front, and written down
   *  either way. */
  setFor(next: Goal | null, project: string): void;
  /** The /goal command the message is, or null when it is not one. */
  command(text: string): ParsedGoal | null;
  /** Answer a /goal command. Null when the message was not one. */
  answer(text: string): GoalAnswer | null;
  /** Goal Mode with nothing set yet: the sentence just typed becomes the goal.
   *  False when there is already one, or the sentence is not one to take. */
  adopt(text: string, project: string | null): boolean;
};

export function useGoalChip(options: {
  /** The desks as they stand, read inside callbacks built before them. */
  desksNow: { current: Desks };
  /** The folder in front, which is what a goal is loaded for. */
  project: string | null;
  /** The conversation in front. A goal belongs to one of them, so switching
   *  tabs shows that tab's goal rather than the folder's last one. */
  address?: string | null;
  say: (text: string) => void;
  setPlans: Dispatch<SetStateAction<Plans>>;
}): GoalChip {
  const { desksNow, project, address = null, say, setPlans } = options;
  const [goal, setGoal] = useState<Goal | null>(null);
  const goalNow = useRef(goal);
  goalNow.current = goal;
  /** Which conversation a folder is showing. A goal belongs to one, so every
   *  route that writes one has to name it or write into another tab's file. */
  const addressIn = useCallback(
    (forProject: string): string | undefined => desksNow.current.byPath[forProject]?.address ?? undefined,
    [desksNow],
  );

  const persist = useCallback((next: Goal | null, forProject: string | null) => {
    if (forProject === null || forProject === '') {
      return;
    }
    // Every route that sets a goal comes through here with the folder it is
    // for, so this is the one place the folder, the tab and the file agree.
    const conversation = addressIn(forProject);
    if (next === null) {
      void bridge.goalClear({ project: forProject, conversation }).catch(() => undefined);
      // Absent is the goal state we wanted; a missing key is not an error.
      try { localStorage.removeItem(goalStorageKey(forProject, conversation ?? '')); } catch { /* already gone */ }
    } else {
      void bridge.goalSave(next, { project: forProject, conversation }).catch(() => undefined);
      // Fallback only; disk via the shell is the store that matters.
      try { localStorage.setItem(goalStorageKey(forProject, conversation ?? ''), JSON.stringify(next)); } catch { /* quota or private mode */ }
    }
  }, [addressIn]);

  const hold = useCallback(
    (next: Goal | null, forProject: string | null) => {
      setGoal(next);
      persist(next, forProject);
    },
    [persist],
  );

  const setFor = useCallback(
    (next: Goal | null, forProject: string) => {
      if (desksNow.current.current === forProject) setGoal(next);
      persist(next, forProject);
    },
    [desksNow, persist],
  );

  // Load the goal when a project opens or reloads. Always resolves to *this*
  // project's goal: a project with none must clear the previous one's, or a
  // goal leaks across projects on the switch.
  useEffect(() => {
    if (project === null) return;
    const conversation = addressIn(project);
    void bridge.goalLoad({ project, conversation }).then((answer) => {
      let loaded: Goal | null = null;
      if (answer.ok && answer.value !== null) {
        loaded = readStoredGoal(answer.value);
      }
      if (loaded === null) {
        try {
          const raw = localStorage.getItem(goalStorageKey(project, conversation ?? ''));
          if (raw !== null) loaded = readStoredGoal(JSON.parse(raw) as unknown);
        } catch { /* unreadable fallback: disk store is the truth */ }
      }
      // The folder may have been switched while this was in the air, and the
      // answer is only ever about the folder that was asked about.
      if (desksNow.current.current !== project) return;
      if (addressIn(project) !== conversation) return;
      // Null for a conversation with no goal, never the last one's.
      setGoal(loaded === null ? null : withElapsed(loaded));
      // Coming back to a goal that was still going: the chip has to say so.
      // Which conversation carries it on is the shell's, not the window's.
      if (loaded !== null && loaded.status === 'active') setPlans('goal');
    });
  }, [project, address, addressIn, desksNow, setPlans]);

  const answer = useCallback(
    (text: string): GoalAnswer | null => {
      const parsed = parseGoalCommand(text);
      if (parsed === null) return null;
      const nothingToSend: GoalAnswer = { send: null, priceOn: '', fullAccess: false };
      const ownerDesk = currentDesk(desksNow.current);
      if (parsed.kind === 'show') {
        const showing = goalNow.current;
        say(
          showing === null
            ? 'No goal set. Use /goal <one sentence> to set one.'
            : `Goal: ${showing.objective} — ${showing.status}, ${String(showing.iterations)} iterations, ${elapsedWords(goalElapsed(showing))} elapsed.`,
        );
        return nothingToSend;
      }
      if (parsed.kind === 'set' || parsed.kind === 'replace') {
        const objective = parsed.objective.trim() === '' ? text.slice(5).trim() : parsed.objective;
        if (objective === '') {
          say('Say what done looks like after /goal — one sentence, checkable.');
          return nothingToSend;
        }
        const withTime = withElapsed(createGoal(objective, 'doing'));
        setGoal(withTime);
        persist(withTime, ownerDesk?.path ?? desksNow.current.current ?? null);
        setPlans('goal');
        return { send: objective, priceOn: objective, fullAccess: true };
      }
      if (parsed.kind === 'pause') {
        const going = goalNow.current;
        if (going !== null && going.status === 'active') {
          const paused: Goal = { ...withElapsed(going), status: 'paused' };
          setGoal(paused);
          persist(paused, ownerDesk?.path ?? null);
          say('Goal paused — rounds kept, files kept. /goal resume to carry on.');
        } else {
          say('No active goal to pause.');
        }
        return nothingToSend;
      }
      if (parsed.kind === 'resume') {
        const held = goalNow.current;
        if (held === null || held.status !== 'paused') {
          say('No paused goal to resume.');
          return nothingToSend;
        }
        const spent = held.iterations >= ROUNDS;
        const resumed: Goal = {
          ...withElapsed(held),
          status: 'active',
          // Stopped because the rounds ran out, so carrying on means a fresh
          // set of them rather than one round and the same stop.
          iterations: spent ? 0 : held.iterations,
        };
        setGoal(resumed);
        persist(resumed, ownerDesk?.path ?? null);
        setPlans('goal');
        if (spent) say(`Goal resumed with another ${String(ROUNDS)} rounds.`);
        return {
          send: `Carry on toward the goal: ${resumed.objective}`,
          priceOn: resumed.objective,
          fullAccess: true,
        };
      }
      if (parsed.kind === 'clear') {
        const going = goalNow.current;
        if (going !== null) {
          setGoal(null);
          persist(null, ownerDesk?.path ?? null);
          setPlans('auto');
          say(`Goal cleared — was: ${going.objective}`);
        } else {
          say('No goal to clear.');
        }
        return nothingToSend;
      }
      return nothingToSend;
    },
    [desksNow, persist, say, setPlans],
  );

  const adopt = useCallback(
    (text: string, forProject: string | null): boolean => {
      if (goalNow.current !== null) return false;
      const objective = text.trim();
      if (objective === '' || objective.startsWith('/')) return false;
      const withTime = withElapsed(createGoal(objective, 'doing'));
      setGoal(withTime);
      persist(withTime, forProject);
      return true;
    },
    [persist],
  );

  const now = useCallback(() => goalNow.current, []);
  const command = useCallback((text: string) => parseGoalCommand(text), []);

  // Held still between renders, so a callback that lists it is not rebuilt on
  // every render — and neither is the one event listener that lists that.
  return useMemo(
    () => ({ goal, now, persist, hold, setFor, command, answer, adopt }),
    [goal, now, persist, hold, setFor, command, answer, adopt],
  );
}
