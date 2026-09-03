/** Whether a failure is worth waiting out.
 *
 * A run that has spent an hour on a list of jobs must not be ended by a
 * provider having a bad minute. Two lists rather than one, because "retry
 * anything that failed" is how an account gets emptied against a wall:
 *
 * - **Settled** is an answer, not a wobble. No money left, no quota, a key that
 *   is not allowed. Waiting thirty minutes changes none of them.
 * - **Worth waiting** is the rest of the field's own wording — the engine's
 *   list, the shapes providers actually send, and the transport errors
 *   underneath them.
 *
 * Deliberately not here: a conversation that outgrew its window. The engine
 * shortens and carries on by itself, and retrying that would only make it
 * longer.
 *
 * One copy, imported by both the conversation and the helpers it sends, so the
 * two cannot drift apart again.
 */

/** An answer, however unwelcome. Checked first: several of these also carry a
 *  number that the list below would otherwise wait on. */
const SETTLED = /insufficient[_ ]quota|quota exceeded|out of (?:budget|credit)|billing|usage limit reached|available balance|invalid[_ ]api[_ ]key|authentication|permission denied|not authorized/i;

/** Wording the field actually sends when it is momentarily unable, not
 *  unwilling. The numbers are bounded so "1429 tokens" is not a rate limit. */
const WORTH_WAITING =
  /overloaded|rate.?limit|too many requests|\b(?:429|500|502|503|504|524)\b|service.?unavailable|server.?error|internal.?error|provider returned error|network.?error|connection.?(?:error|refused|lost|reset)|other side closed|fetch failed|getaddrinfo|ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|upstream connect|reset before headers|socket hang up|socket connection was closed|timed ?out|timeout|terminated|websocket.?(?:closed|error)|stream ended (?:before|without)|Responses stream ended|ended without producing|http2 request did not get a response|you can retry your request|try your request again|ResourceExhausted/i;

/** The words of a failure, whether it arrived as a throw or as a sentence on a
 *  turn that ended badly. */
function wordsOf(cause: unknown): string {
  if (cause === null || cause === undefined) return '';
  if (typeof cause === 'string') return cause;
  return cause instanceof Error ? cause.message : String(cause);
}

/** Whether waiting and asking again could plausibly get a different answer. */
export function isTransientStreamError(cause: unknown): boolean {
  const said = wordsOf(cause);
  if (said === '') return false;
  if (SETTLED.test(said)) return false;
  return WORTH_WAITING.test(said);
}

/**
 * How long to wait before each further attempt.
 *
 * The engine does three of its own first, two seconds apart — fourteen seconds
 * in total, which covers a blip and nothing else. A rate limit measured in
 * minutes, or an outage, needs a ladder somebody can walk away from: about
 * three quarters of an hour in four steps.
 */
export const WAITS_MS: readonly number[] = [60_000, 5 * 60_000, 10 * 60_000, 30 * 60_000];

/**
 * The same idea at the size of a helper.
 *
 * A helper runs inside a turn somebody is sitting through, and the one above it
 * gives up on a helper that has said nothing for five minutes. A ladder that
 * starts at a minute and reaches thirty is longer than the patience it is being
 * measured against, so the later rungs could never be reached — the helper was
 * killed mid-wait instead. This is the part of a wait that fits inside a turn.
 */
export const HELPER_WAITS_MS: readonly number[] = [15_000, 45_000, 90_000];

/** Said to the model when a turn is picked up after a wait. Never the original
 *  request again: everything finished so far is still in the conversation, and
 *  asking for the whole thing twice is how a list gets done twice. */
export const CARRY_ON =
  'That stopped part way through, and this is the same piece of work carrying on. Pick up exactly where you left off. Do not start again and do not repeat anything already finished. Work through whatever is still left on the list.';
