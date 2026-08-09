/** One desk per project, and nothing shared between them.
 *
 * BACKLOG B2: switching projects must swap the conversation, the spend and the
 * versions together. Not "mostly" — a thread that keeps one sentence from the
 * folder you were in ten seconds ago is worse than one that keeps none, because
 * you cannot tell which sentence it was.
 *
 * So the window keeps a desk per folder: everything it knows about that project,
 * in one object, replaced whole. Switching is choosing which one is in front.
 * Nothing is merged, nothing is carried over, and there is no window-level
 * conversation for anything to fall back to.
 *
 * ## Why plain functions over a class
 *
 * All of this is React state. Every function here takes the whole store and
 * returns a new one, so a switch is a single `setState` and there is no moment
 * where the thread on screen belongs to one project and the meter to another.
 * It also means the isolation claim is testable with no browser in sight, which
 * is the only reason to believe it.
 *
 * ## Events are routed, not assumed
 *
 * `receive` folds an event into the desk the shell says it came from, not into
 * whichever desk happens to be in front. A reply that was still arriving when
 * somebody switched folders belongs to the folder it started in, and it goes
 * there — see `AgentNotice` in ipc.ts.
 */

import type { Attachment } from '../components/Attachments';
import type { AgentNotice, PutBack, SavedVersion } from './ipc';
import { applySpend, type SpendView } from './spend';
import { applyEvent, type Turn } from './thread';

/** Everything the window knows about one project. */
export type Desk = {
  path: string;
  /** What the person calls it. Shown in the quiet strip at the top. */
  name: string;
  /** The conversation, in order. */
  turns: readonly Turn[];
  /** What this sitting has cost. Null until there is a first number — the meter
   *  appears when it has something to say and then stays. */
  spent: SpendView | null;
  /** What has been brought in and not yet said. */
  attachments: readonly Attachment[];
  /** The timeline, newest first. Empty until the shell has been asked. */
  versions: readonly SavedVersion[];
  /** The offer to undo the last "put back", while it is still on offer. */
  putBack: PutBack | null;
};

/** Every desk, and which one is in front. */
export type Desks = {
  readonly current: string | null;
  readonly byPath: Readonly<Record<string, Desk>>;
};

export const noDesks: Desks = { current: null, byPath: {} };

function blankDesk(path: string, name: string): Desk {
  return {
    path,
    name,
    turns: [],
    spent: null,
    attachments: [],
    versions: [],
    putBack: null,
  };
}

/** The desk in front, or null when no project is open. */
export function currentDesk(desks: Desks): Desk | null {
  return desks.current === null ? null : (desks.byPath[desks.current] ?? null);
}

/**
 * Bring a project to the front, making a desk for it if it is new.
 *
 * A project that has been open before is resumed exactly as it was left. That is
 * the whole feature: coming back to a folder should feel like coming back to a
 * desk, not like being handed a clean one.
 */
export function openDesk(desks: Desks, project: { path: string; name: string }): Desks {
  const existing = desks.byPath[project.path];
  // Untouched when there is nothing to change. A desk that comes back as a new
  // object every time it is looked at is a desk React redraws every time it is
  // looked at, and it would make "exactly as you left it" merely a resemblance.
  const desk =
    existing === undefined
      ? blankDesk(project.path, project.name)
      : existing.name === project.name
        ? existing
        : { ...existing, name: project.name };
  return {
    current: project.path,
    byPath: { ...desks.byPath, [project.path]: desk },
  };
}

/** Change one desk, leaving every other one exactly as it was. Unknown paths
 *  change nothing — an answer arriving for a project that has been forgotten is
 *  not a reason to invent it again. */
export function changeDesk(desks: Desks, path: string, change: (desk: Desk) => Desk): Desks {
  const desk = desks.byPath[path];
  if (desk === undefined) return desks;
  const changed = change(desk);
  if (changed === desk) return desks;
  return { ...desks, byPath: { ...desks.byPath, [path]: changed } };
}

/** Change whichever desk is in front. Does nothing when none is. */
export function changeCurrent(desks: Desks, change: (desk: Desk) => Desk): Desks {
  return desks.current === null ? desks : changeDesk(desks, desks.current, change);
}

/**
 * Take one event from the shell, and put it on the right desk.
 *
 * The conversation and the money are folded in the same call because they are
 * two readings of one event and they must never be a frame apart: a meter that
 * has counted something the thread has not yet mentioned is a meter nobody
 * trusts.
 */
export function receive(desks: Desks, notice: AgentNotice): Desks {
  const path = notice.project ?? desks.current;
  if (path === null) return desks;
  return changeDesk(desks, path, (desk) => ({
    ...desk,
    turns: applyEvent(desk.turns, notice.event),
    spent: applySpend(desk.spent, notice.event),
  }));
}

/** Forget a project entirely — used when its folder has gone. If it was the one
 *  in front, nothing takes its place: the picker is the honest thing to show. */
export function closeDesk(desks: Desks, path: string): Desks {
  if (desks.byPath[path] === undefined) return desks;
  const byPath = { ...desks.byPath };
  delete byPath[path];
  return { current: desks.current === path ? null : desks.current, byPath };
}
