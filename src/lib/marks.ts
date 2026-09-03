/** When things happened, so "it feels slow" becomes a number.
 *
 * The app publishes targets — under 400ms to first paint, under 600ms to a
 * conversation on screen, a first token that arrives when the model says it —
 * and until now nothing anywhere measured any of them. This is the tape: a
 * handful of named moments, the gaps between them, and a line each for the
 * machinery views.
 *
 * It is a ring of a couple of hundred entries and it never throws. A recorder
 * that can fail is a recorder somebody switches off, and a moment that is
 * missing has to read as "not yet" rather than as a crash. Where the browser
 * offers `performance` the same names are stamped into its own timeline too, so
 * a profile lines up with this report without anybody correlating by hand.
 */

/** The moments the published targets are measured between. Anything else can
 *  still be marked — this is the vocabulary, not the limit. */
export type Moment = 'launch' | 'first-paint' | 'project-open' | 'first-token' | 'settled';

/** One moment, and how long after the first one it happened. */
export type Mark = { name: string; ms: number };

/** Enough for a long sitting's worth of moments, small enough to forget about.
 *  The oldest go first; the origin never does. */
export const MOST = 240;

export type Marks = {
  mark: (name: string) => void;
  /** Milliseconds between the last `from` and the last `to`, or null while
   *  either of them has not happened. */
  since: (from: string, to: string) => number | null;
  report: () => readonly Mark[];
  /** Start again. For a test, and for a diagnostics bundle that wants this
   *  sitting rather than every sitting. */
  clear: () => void;
};

/** The clock, so a test can put the moments where it wants them. Falls back to
 *  `Date.now` where `performance` is not there at all — a headless build, a
 *  worker, the main process on an old runtime. */
function realNow(): number {
  try {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
      return performance.now();
    }
  } catch {
    /* Reading it is enough to fail in some sandboxes. */
  }
  return Date.now();
}

/** Stamp the same name into the browser's own timeline, when there is one, so a
 *  recorded profile and this report are talking about the same instant. */
function alsoInTheTimeline(name: string): void {
  try {
    if (typeof performance !== 'undefined' && typeof performance.mark === 'function') {
      performance.mark(name);
    }
  } catch {
    /* A duplicate name, a locked-down window: never worth an exception. */
  }
}

/** A tape of its own. The module keeps one; a test can hold as many as it
 *  likes without them treading on each other. */
export function recorder(now: () => number = realNow): Marks {
  let at: { name: string; when: number }[] = [];
  let origin: number | null = null;

  return {
    mark(name) {
      try {
        const when = now();
        if (origin === null) origin = when;
        at.push({ name, when });
        if (at.length > MOST) at = at.slice(at.length - MOST);
        alsoInTheTimeline(name);
      } catch {
        /* Nothing measured is better than a window that fell over measuring. */
      }
    },
    since(from, to) {
      const start = lastNamed(at, from);
      const end = lastNamed(at, to);
      if (start === null || end === null) return null;
      return end - start;
    },
    report() {
      const from = origin;
      if (from === null) return [];
      return at.map((one) => ({ name: one.name, ms: one.when - from }));
    },
    clear() {
      at = [];
      origin = null;
    },
  };
}

function lastNamed(at: readonly { name: string; when: number }[], name: string): number | null {
  for (let index = at.length - 1; index >= 0; index -= 1) {
    const one = at[index];
    if (one !== undefined && one.name === name) return one.when;
  }
  return null;
}

const THE_TAPE = recorder();

/** Note that something happened. */
export const mark = THE_TAPE.mark;
/** How long between two of them. */
export const since = THE_TAPE.since;
/** Every moment so far, in order, timed from the first. */
export const report = THE_TAPE.report;
/** Forget the sitting. */
export const clear = THE_TAPE.clear;

/**
 * The tape as a machinery view prints it: real names, real milliseconds.
 *
 * This is `showme` territory and the diagnostics bundle, so it says `launch`
 * and `first-token` rather than paraphrasing them — somebody reading it went
 * looking for the numbers the targets are written in.
 */
export function saysMarks(marks: readonly Mark[]): string {
  if (marks.length === 0) return 'perf\n  nothing measured yet';
  const width = marks.reduce((most, one) => Math.max(most, one.name.length), 0);
  const lines: string[] = ['perf'];
  let previous = 0;
  for (const one of marks) {
    const gap = one.ms - previous;
    previous = one.ms;
    lines.push(
      `  ${one.name.padEnd(width)}  ${millis(one.ms).padStart(9)}${
        gap > 0 ? `  (+${millis(gap)})` : ''
      }`,
    );
  }
  return lines.join('\n');
}

function millis(ms: number): string {
  return `${(Math.round(ms * 10) / 10).toFixed(1)}ms`;
}
