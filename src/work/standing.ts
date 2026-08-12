/** The things a person has asked for over and over.
 *
 * "Every morning, check the site still builds and tell me if it doesn't." One
 * sentence, one rhythm, and a way to stop it — nothing on this computer may run
 * on its own without being visible and stoppable from the same place it was
 * asked for.
 *
 * Everything here is pure and takes `now`, so what is due can be decided in a
 * test rather than waited for — and so the window can say these sentences too,
 * which it could not if this file knew about a disk. Keeping them is
 * src/projects/standing.ts, next to the other small files this app writes.
 */

import { nextRun, readRepeat, saysNext, saysRepeat, whenNext, type Repeat } from './schedule';

/** One thing asked for on a repeat. */
export type Standing = {
  id: string;
  /** The project folder it belongs to. A repeat is about one project, always. */
  project: string;
  /** What it asks for, in the person's own words. */
  doing: string;
  repeat: Repeat;
  /** False once somebody has stopped it. Stopped rather than removed, so
   *  turning it back on is one press and does not mean typing it again. */
  on: boolean;
  /** When it last actually ran, or null when it never has. */
  lastRunAt: number | null;
  /** What came of the last one, in a sentence. */
  lastSaid: string | null;
  /** When it was asked for, epoch ms. */
  at: number;
};

/** As many as one project can usefully have going. Past this it is not a habit,
 *  it is a machine, and nobody is reading the results of a machine. */
export const MOST_STANDING = 6;

export const standingWords = {
  label: 'Add a schedule',
  title: 'On a schedule',
  hint: 'Something worth doing again and again. It runs on its own and tells you what came of it.',
  example: 'Check the site still builds and tell me if it doesn’t',
  add: 'Add it',
  stop: 'Pause',
  start: 'Resume',
  remove: 'Remove',
  stopped: 'Paused',
  none: 'Nothing is scheduled.',
  full: 'That is as many as I can do properly for one project. Pause one and add again.',
  never: 'Not run yet',
} as const;

/* -------------------------------------------------------------------------- */
/* The list                                                                    */
/* -------------------------------------------------------------------------- */

function tidy(text: string, most = 200): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length <= most ? one : `${one.slice(0, most - 1)}…`;
}

function freeId(all: readonly Standing[], wanted: string): string {
  if (!all.some((one) => one.id === wanted)) return wanted;
  for (let attempt = 2; attempt < 1000; attempt += 1) {
    const next = `${wanted}-${String(attempt)}`;
    if (!all.some((one) => one.id === next)) return next;
  }
  return `${wanted}-${String(all.length)}`;
}

/** Only this project's, oldest first, which is the order they were asked in. */
export function standingFor(all: readonly Standing[], project: string): readonly Standing[] {
  return all.filter((one) => one.project === project).sort((one, other) => one.at - other.at);
}

/** Ask for one more. Refused — as an unchanged list and a reason — once a
 *  project already has as many as it can usefully run. */
export function addStanding(
  all: readonly Standing[],
  wanted: { id: string; project: string; doing: string; repeat: Repeat; at: number },
): { all: readonly Standing[]; added: Standing | null; because: string | null } {
  const doing = tidy(wanted.doing);
  if (doing === '') return { all, added: null, because: null };
  if (standingFor(all, wanted.project).length >= MOST_STANDING) {
    return { all, added: null, because: standingWords.full };
  }
  const added: Standing = {
    id: freeId(all, wanted.id),
    project: wanted.project,
    doing,
    repeat: readRepeat(wanted.repeat),
    on: true,
    lastRunAt: null,
    lastSaid: null,
    at: wanted.at,
  };
  return { all: [...all, added], added, because: null };
}

/** Turn one on or off. Everything else about it is left as it was. */
export function switchStanding(
  all: readonly Standing[],
  id: string,
  on: boolean,
): readonly Standing[] {
  return all.map((one) => (one.id === id ? { ...one, on } : one));
}

/** Forget one entirely. */
export function withoutStanding(all: readonly Standing[], id: string): readonly Standing[] {
  return all.filter((one) => one.id !== id);
}

/** Forget everything belonging to a project — what "I am done with this
 *  project" has to mean, or a folder somebody threw away keeps waking up. */
export function withoutProject(all: readonly Standing[], project: string): readonly Standing[] {
  return all.filter((one) => one.project !== project);
}

/** One has just run. Recorded before anything else happens, so a crash halfway
 *  through cannot leave it looking overdue and run it again on the way back. */
export function ranStanding(
  all: readonly Standing[],
  id: string,
  when: { at: number; said?: string | null },
): readonly Standing[] {
  return all.map((one) =>
    one.id === id
      ? { ...one, lastRunAt: when.at, lastSaid: when.said === undefined ? one.lastSaid : when.said }
      : one,
  );
}

/**
 * Which of a project's repeats want doing right now.
 *
 * One run each, however many were missed — see `whenNext`. A stopped one is
 * never due, which is the whole of "stoppable": pressing stop is the last thing
 * that has to happen for nothing else to.
 */
export function dueNow(
  all: readonly Standing[],
  now: number,
  options: { project?: string; tooLate?: number } = {},
): readonly Standing[] {
  const looking = options.project === undefined ? all : standingFor(all, options.project);
  return looking.filter((one) => {
    if (!one.on) return false;
    const { runNow } = whenNext(one.repeat, {
      lastRunAt: one.lastRunAt,
      now,
      ...(options.tooLate === undefined ? {} : { tooLate: options.tooLate }),
    });
    return runNow;
  });
}

/** When the soonest of them is, so nothing has to be looked at more often than
 *  it needs to be. Null when nothing is running at all. */
export function soonest(all: readonly Standing[], now: number): number | null {
  let best: number | null = null;
  for (const one of all) {
    if (!one.on) continue;
    const at = nextRun(one.repeat, now);
    if (best === null || at < best) best = at;
  }
  return best;
}

/** The two lines one row shows: what it is, and when it happens next. */
export function saysStanding(one: Standing, now: number): { says: string; next: string } {
  const says = saysRepeat(one.repeat);
  if (!one.on) return { says, next: standingWords.stopped };
  const { nextAt } = whenNext(one.repeat, { lastRunAt: one.lastRunAt, now });
  return { says, next: saysNext(Math.max(nextAt, now), now) };
}

/* -------------------------------------------------------------------------- */
/* Reading one back off the disk                                               */
/* -------------------------------------------------------------------------- */

function asRepeat(value: unknown): Repeat | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  const at = raw['at'];
  if (typeof at !== 'object' || at === null) return null;
  const time = at as Record<string, unknown>;
  const hour = typeof time['hour'] === 'number' ? time['hour'] : 9;
  const minute = typeof time['minute'] === 'number' ? time['minute'] : 0;
  const every = raw['every'];
  const on = typeof raw['on'] === 'number' ? raw['on'] : 1;
  if (every === 'day' || every === 'weekday') {
    return readRepeat({ every, at: { hour, minute } });
  }
  if (every === 'week') return readRepeat({ every: 'week', on: on as never, at: { hour, minute } });
  if (every === 'month') return readRepeat({ every: 'month', on, at: { hour, minute } });
  return null;
}

/** Whatever was in the file, narrowed to things that are actually repeats.
 *  Anything unreadable is left out rather than fatal — a file half-written by a
 *  machine that lost power should cost the entries it broke, not the feature. */
export function readStanding(value: unknown): readonly Standing[] {
  const raw = (value as { standing?: unknown } | null)?.standing;
  if (!Array.isArray(raw)) return [];
  const all: Standing[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const one = entry as Record<string, unknown>;
    const repeat = asRepeat(one['repeat']);
    if (
      repeat === null ||
      typeof one['id'] !== 'string' ||
      one['id'] === '' ||
      typeof one['project'] !== 'string' ||
      one['project'] === '' ||
      typeof one['doing'] !== 'string' ||
      one['doing'].trim() === ''
    ) {
      continue;
    }
    all.push({
      id: one['id'],
      project: one['project'],
      doing: tidy(one['doing']),
      repeat,
      on: one['on'] !== false,
      lastRunAt: typeof one['lastRunAt'] === 'number' ? one['lastRunAt'] : null,
      lastSaid: typeof one['lastSaid'] === 'string' ? one['lastSaid'] : null,
      at: typeof one['at'] === 'number' ? one['at'] : 0,
    });
  }
  return all;
}

