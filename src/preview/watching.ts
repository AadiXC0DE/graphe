/**
 * Watching the browser work, a picture at a time.
 *
 * The agent's browser runs out of sight, which is the point — it never takes
 * the screen from anybody. The cost is that "what is it doing" has no answer
 * until it says something. This is the answer: while somebody is watching, the
 * shell takes a picture of it every second or so and the pane draws the last
 * one.
 *
 * The pictures come from the shell rather than from a connection the window
 * opens itself. The window is served from a file, which has no origin a
 * localhost service will accept, so a socket opened here is refused before it
 * carries anything — and a feature that works everywhere except in the app is
 * not a feature.
 */

/** What the pane is showing right now. */
export type Watched = {
  /** The last picture, ready for an `img` src, or null before the first. */
  picture: string | null;
};

export const NOTHING_WATCHED: Watched = { picture: null };

export const WATCH_WORDS = {
  on: 'Watch it work',
  off: 'Stop watching',
  waiting: 'Waiting for the browser to show itself…',
  /** A browser that is not running has nothing to show, and saying so is
   *  better than an empty rectangle. */
  nothing: 'There is no browser open to watch yet. Ask for a page and it will appear here.',
} as const;

/** The most one picture may be. One arrives every second or so and the last is
 *  held in the window's own memory; something enormous is one to ignore. */
export const MOST_PICTURE = 4_000_000;

/** One picture from the shell, folded into what the pane shows. Anything
 *  unreadable leaves the picture somebody is looking at exactly where it was. */
export function watching(now: Watched, bytes: unknown): Watched {
  if (typeof bytes !== 'string' || bytes === '' || bytes.length > MOST_PICTURE) return now;
  return { picture: `data:image/jpeg;base64,${bytes}` };
}
