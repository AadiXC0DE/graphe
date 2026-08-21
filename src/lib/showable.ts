/** Whether a running thing is worth putting on screen.
 *
 * A server that answers with a page belongs in the pane beside the
 * conversation. An API that answers with JSON, a database, a queue worker, a
 * type-checker in watch mode — those hold a port too, and opening any of them
 * shows somebody a wall of braces or a blank frame where their work should be.
 *
 * The question is not what was started. It is what the address answers with,
 * which is the only thing that can be true for a server nobody has thought of
 * yet. Pure: the asking happens at the edge and the answer is judged here.
 */

/** What a browser can draw as a page. Anything else is data, and data belongs
 *  in the conversation rather than in a frame. */
const DRAWABLE = [
  'text/html',
  'application/xhtml',
  'image/',
  'application/pdf',
  'text/plain',
  'image/svg',
] as const;

export type Answered = {
  /** The status it answered with, or null when it did not answer at all. */
  status: number | null;
  /** Its `content-type`, lowercased, or null when it did not say. */
  type: string | null;
};

/**
 * Whether to open this in the pane.
 *
 * A thing that did not answer is not ready — a worker, a watcher, or a server
 * still starting. Silence is not a page.
 *
 * A thing that answered without saying what it sent is treated as a page: a
 * plain static server often omits the header, and the cost of being wrong is a
 * frame somebody closes rather than data dressed up as a design.
 */
export function worthShowing(answered: Answered): boolean {
  if (answered.status === null) return false;
  // A refusal or a crash is still a page somebody may want to see — a 404 from
  // their own site is a thing to fix, not a thing to hide.
  if (answered.status >= 500) return false;
  if (answered.type === null) return true;
  const said = answered.type.toLowerCase();
  return DRAWABLE.some((one) => said.startsWith(one));
}

export const SHOWABLE_WORDS = {
  /** Said beside a piece that is up but has nothing to look at. */
  notAPage: 'Running, with nothing to look at',
} as const;
