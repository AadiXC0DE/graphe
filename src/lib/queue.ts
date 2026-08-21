/** The waiting line beside the composer, as the window owns it.
 *
 * Pi reports the queue through its own events, but the removal it performs as
 * a message starts is exact-text and can silently no-op — the app must not
 * depend on that bookkeeping to draw the line correctly. The one signal that
 * cannot miss is Pi's `message_start` for the person's message, so the drain
 * here is keyed off that instead: the message the agent has begun on is not
 * waiting any more.
 */

/** One message has begun; take it out of the line. Only the first occurrence
 *  is removed (two identical queued messages start in the order they were
 *  asked, and each own removal). Nothing matching is not a drain — it is the
 *  primary prompt of a new send, or a message in another conversation. */
export function drainStarted(
  line: readonly string[],
  started: string,
): readonly string[] {
  const at = line.findIndex((one) => one === started);
  if (at === -1) return line;
  return line.filter((_, where) => where !== at);
}