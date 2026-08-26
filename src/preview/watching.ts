/**
 * Watching the browser work, a picture a second.
 *
 * The agent's browser runs out of sight, which is the point — it never takes
 * the screen from anybody. The cost is that "what is it doing" has no answer
 * until it says something. This is the answer: the browser shows itself over a
 * connection the window opens, and the pane draws the last picture it sent.
 *
 * Pure. Reading one message and deciding what the pane now shows happens here;
 * opening the connection happens in the window, which is the only part of the
 * app with a socket.
 */

/** What the pane is showing right now. */
export type Watched = {
  /** The last picture, ready for an `img` src, or null before the first. */
  picture: string | null;
  /** Where the browser is, when it has said. */
  address: string | null;
  /** The last thing the page complained about, if it has. */
  trouble: string | null;
};

export const NOTHING_WATCHED: Watched = { picture: null, address: null, trouble: null };

export const WATCH_WORDS = {
  on: 'Watch it work',
  off: 'Stop watching',
  waiting: 'Waiting for the browser to show itself…',
  /** A browser that is not running has nothing to show, and saying so is
   *  better than an empty rectangle. */
  nothing: 'There is no browser open to watch yet. Ask for a page and it will appear here.',
} as const;

function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined;
}

/**
 * One message from the browser, folded into what the pane shows.
 *
 * Anything unrecognised leaves it exactly as it was: a stream that grows a new
 * kind of message must never blank the picture somebody is looking at.
 */
export function watching(now: Watched, message: unknown): Watched {
  const kind = field(message, 'type');
  if (kind === 'frame') {
    const data = field(message, 'data');
    if (typeof data !== 'string' || data === '') return now;
    return { ...now, picture: `data:image/jpeg;base64,${data}` };
  }
  if (kind === 'url') {
    const address = field(message, 'url');
    return typeof address === 'string' && address !== '' ? { ...now, address } : now;
  }
  if (kind === 'page_error') {
    const text = field(message, 'text');
    return typeof text === 'string' && text !== '' ? { ...now, trouble: firstLine(text) } : now;
  }
  return now;
}

/** Read one message off the wire. Null for anything that is not one. */
export function readWatched(data: unknown): unknown {
  if (typeof data !== 'string') return null;
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

function firstLine(text: string): string {
  return text.split('\n')[0]?.trim() ?? '';
}
