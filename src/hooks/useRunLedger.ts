/**
 * What the window holds about a run while it is still in flight, per
 * conversation.
 *
 * Two conversations work at once all the time, so none of this can be one value
 * for the window: a reply landing in a background tab must not commit into the
 * one in front, and one run's measure must never be borrowed by another's.
 *
 * None of it decides anything. Whether a job carries on is settled in the
 * shell, by the one authority that settles it for every reason; this only
 * remembers what has happened so far so the window can say it.
 */

import { useRef } from 'react';

import { coalescer, type Coalescer } from '../lib/streaming';

export type RunLedger = {
  /** A step has begun. True when it is the first of a run, which is when the
   *  clock starts. */
  stepStarted(owner: string): boolean;
  /** Whether this run has done real tool work since it settled last. A settle
   *  with no work in it is an answer, not a build step. */
  workedSinceSettle(owner: string): boolean;
  /** The work has been taken account of, so the next settle starts fresh. */
  workTakenAccountOf(owner: string): void;
  /** The run is over. How many seconds it went for, or null when no clock was
   *  ever started for it. */
  settled(owner: string): number | null;
  /** Text arrives a token at a time, and every one of them would otherwise copy
   *  the whole turn array. Gathered instead and committed at most every frame. */
  gather(owner: string, text: string, commit: (text: string) => void): void;
  /** Whatever is still gathered goes out now, because the end of a message
   *  closes the turn and an unflushed tail would be lost. */
  flush(owner: string): void;
};

export function useRunLedger(): RunLedger {
  const startedAt = useRef<Readonly<Record<string, number>>>({});
  const didWork = useRef<Readonly<Record<string, boolean>>>({});
  const streams = useRef(new Map<string, Coalescer>());
  const held = useRef<RunLedger | null>(null);

  held.current ??= {
    stepStarted(owner) {
      didWork.current = { ...didWork.current, [owner]: true };
      if (startedAt.current[owner] !== undefined) return false;
      startedAt.current = { ...startedAt.current, [owner]: Date.now() };
      return true;
    },
    workedSinceSettle(owner) {
      return didWork.current[owner] === true;
    },
    workTakenAccountOf(owner) {
      didWork.current = { ...didWork.current, [owner]: false };
    },
    settled(owner) {
      const began = startedAt.current[owner];
      const rest = { ...startedAt.current };
      delete rest[owner];
      startedAt.current = rest;
      if (began === undefined) return null;
      return Math.round((Date.now() - began) / 1000);
    },
    gather(owner, text, commit) {
      let gathering = streams.current.get(owner);
      if (gathering === undefined) {
        gathering = coalescer(commit);
        streams.current.set(owner, gathering);
      }
      gathering.push(text);
    },
    flush(owner) {
      streams.current.get(owner)?.flush();
    },
  };

  return held.current;
}
