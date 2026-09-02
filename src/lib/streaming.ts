/** Tokens in, whole phrases out.
 *
 * A reply arrives one token at a time — sixty a second on a fast model — and
 * every one of them used to be a state change, a fresh copy of the thread and a
 * redraw of every row in it. Nobody can read at 60fps anyway, so the text is
 * gathered here and handed on at most once every frame or two.
 *
 * Pure: it holds a string and a timer, and the timer is whatever clock it is
 * given. Nothing here knows what the text is for.
 */

/** How often the gathered text is handed on. Two frames at 60fps, which is
 *  under what anybody perceives as delay and an order of magnitude fewer
 *  redraws than a token each. */
export const EVERY_MS = 33;

/** The clock, so a test can run a whole reply in no time at all. */
export type Clock = {
  now: () => number;
  after: (ms: number, run: () => void) => number;
  stop: (timer: number) => void;
};

const REAL: Clock = {
  now: () => Date.now(),
  after: (ms, run) => setTimeout(run, ms) as unknown as number,
  stop: (timer) => { clearTimeout(timer); },
};

export type Coalescer = {
  /** One token. It goes out with whatever else is waiting. */
  push: (text: string) => void;
  /** Hand on whatever is waiting, now. The end of a message is a moment the
   *  reader can see, so it does not wait for the next tick. */
  flush: () => void;
  /** Drop what is waiting and stop. For a turn that was abandoned. */
  cancel: () => void;
};

/**
 * Gather text and commit it at most every `everyMs`.
 *
 * The first token goes straight through — a reply that takes 33ms to show its
 * first character reads as a slow model, not a smooth one. Everything after it
 * waits for the tick.
 */
export function coalescer(
  commit: (text: string) => void,
  everyMs: number = EVERY_MS,
  clock: Clock = REAL,
): Coalescer {
  let waiting = '';
  let timer: number | null = null;
  let lastAt = -Infinity;

  const send = (): void => {
    timer = null;
    if (waiting === '') return;
    const text = waiting;
    waiting = '';
    lastAt = clock.now();
    commit(text);
  };

  return {
    push(text) {
      if (text === '') return;
      waiting += text;
      if (timer !== null) return;
      const since = clock.now() - lastAt;
      if (since >= everyMs) send();
      else timer = clock.after(everyMs - since, send);
    },
    flush() {
      if (timer !== null) {
        clock.stop(timer);
        timer = null;
      }
      send();
    },
    cancel() {
      if (timer !== null) {
        clock.stop(timer);
        timer = null;
      }
      waiting = '';
    },
  };
}
