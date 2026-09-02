/** What something running has said, kept by the line rather than by the byte.
 *
 * A server keeps talking for as long as it is up, so there is no "all of it" to
 * hold. Keeping the last few thousand bytes instead loses the morning's log by
 * lunchtime, and cuts whatever survives in the middle of a line. Keeping lines
 * is the shape a person reads in: the last ten thousand of them is a working
 * afternoon, and every one of them is whole.
 *
 * Two things arrive from a real process that a naive buffer never survives: a
 * chunk that stops mid-line, and a line that never ends — a progress bar
 * redrawing itself with a carriage return, or a megabyte of minified stack on
 * one row. The first is held until its newline; the second is overwritten or
 * cut, so nothing here grows without a ceiling.
 *
 * Pure. No process, no clock, no file.
 */

/** Enough to scroll back through a morning's work, and far short of a log
 *  file. */
export const MOST_LINES = 10_000;

/** One line's ceiling. Past this it is not a line anybody reads — it is a
 *  bundle, a data URL or a stack trace with the whole world inlined — and the
 *  front of it is the part that says what happened. */
export const MOST_PER_LINE = 4_000;

/** Put on a line that was cut, so nobody reads the cut as the end of it. */
export const CUT = '…';

export type Scrollback = {
  /** Whatever just arrived, in whatever pieces it arrived in. */
  push(chunk: string): void;
  /** Everything still held, oldest first. The line still being written is the
   *  last one, before its newline. */
  lines(): readonly string[];
  /** Everything from line `n` onward, `n` counted over the whole stream. The
   *  line still being written comes back each time it grows: it is the same
   *  line, not a new one. */
  since(n: number): readonly string[];
  /** How many whole lines have gone by. Hand this back to `since` next time. */
  count(): number;
  /** How many were dropped off the front to stay under the ceiling. */
  dropped(): number;
  /** How much is being held, in bytes as it would be written out. */
  bytes(): number;
  /** Throw the lot away — the thing restarted, and its old output is somebody
   *  else's. */
  clear(): void;
};

function cut(line: string): string {
  return line.length <= MOST_PER_LINE ? line : `${line.slice(0, MOST_PER_LINE)}${CUT}`;
}

/**
 * A ring of lines with a ceiling on both the count and the length of each.
 *
 * `mostLines` is a count of whole lines; the line still being written sits
 * outside it, because it is not finished and cannot be dropped without losing
 * the thing being watched.
 */
export function scrollback(mostLines: number = MOST_LINES): Scrollback {
  const ceiling = Math.max(1, Math.floor(mostLines));
  let kept: string[] = [];
  /** Where the live lines start. Moving an index rather than shifting the array
   *  keeps a server that has printed a million lines cheap to feed. */
  let front = 0;
  let partial = '';
  let gone = 0;
  let held = 0;

  const drop = (): void => {
    while (kept.length - front > ceiling) {
      held -= (kept[front] ?? '').length + 1;
      front += 1;
      gone += 1;
    }
    if (front > ceiling) {
      kept = kept.slice(front);
      front = 0;
    }
  };

  const all = (): string[] => {
    const live = kept.slice(front);
    if (partial !== '') live.push(partial);
    return live;
  };

  return {
    push(chunk: string): void {
      const text = String(chunk).replace(/\r\n/g, '\n');
      if (text === '') return;
      const pieces = text.split('\n');
      for (let at = 0; at < pieces.length; at += 1) {
        const piece = pieces[at] ?? '';
        // A carriage return on its own means "write this line again", which is
        // how a progress bar stays on one row. Whatever came before it is gone.
        const rewrite = piece.lastIndexOf('\r');
        partial = rewrite === -1 ? cut(partial + piece) : cut(piece.slice(rewrite + 1));
        if (at === pieces.length - 1) break;
        kept.push(partial);
        held += partial.length + 1;
        partial = '';
        drop();
      }
    },

    lines(): readonly string[] {
      return all();
    },

    since(n: number): readonly string[] {
      const from = Math.max(0, Math.floor(n) - gone);
      const live = kept.slice(front + from);
      if (partial !== '') live.push(partial);
      return live;
    },

    count(): number {
      return gone + (kept.length - front);
    },

    dropped(): number {
      return gone;
    },

    bytes(): number {
      return held + partial.length;
    },

    clear(): void {
      kept = [];
      front = 0;
      partial = '';
      gone = 0;
      held = 0;
    },
  };
}

export const scrollbackWords = {
  /** Over the top of the panel, when the front of the log has gone. */
  trimmed: (gone: number): string =>
    `The first ${gone.toLocaleString('en-GB')} lines have scrolled off.`,
  empty: 'Nothing said yet.',
} as const;
