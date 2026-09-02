/** A saved conversation, back on screen.
 *
 * Reopening one folds its whole history — ten thousand events on a long
 * sitting. Folded through `applyEvent` that is a fresh copy of the thread per
 * event, which is seconds of a window that cannot be typed in; folded here it
 * is one array, built once.
 */

import type { AgentEvent } from '../agent/types';
import { applyEventInto, type Turn } from './thread';

/** How much of a long conversation is drawn to begin with. The rest is behind
 *  "load earlier": nobody reopens a sitting to read the top of it. */
export const AT_FIRST = 500;

/** Every event, folded once. */
export function foldEvents(events: readonly AgentEvent[]): readonly Turn[] {
  const turns: Turn[] = [];
  for (const event of events) applyEventInto(turns, event);
  return turns;
}

/** The tail of a thread, and how many turns are above it. */
export function lastTurns(
  turns: readonly Turn[],
  most: number,
): { turns: readonly Turn[]; earlier: number } {
  if (most <= 0) return { turns: [], earlier: turns.length };
  if (turns.length <= most) return { turns, earlier: 0 };
  return { turns: turns.slice(turns.length - most), earlier: turns.length - most };
}
