/** How much of an add-on runs, per session.
 *
 * An extension that starts turns of its own is a second thing deciding when
 * work continues, and Graphe already has one. Where Graphe is driving — a piece
 * on the board, a helper, the canvas — that add-on stands down entirely. In a
 * conversation, where a person is watching, its tools stay and only the
 * starting goes.
 *
 * The decision is made from the capability card, so an add-on published
 * tomorrow lands under the same rule as one installed today. No package is
 * named here, and none may be.
 */

import type { CapabilityCard } from './extension-probe';

/** Who is driving. Only the first has a person watching every turn. */
export type SessionKind = 'conversation' | 'board' | 'helper' | 'canvas';

export type Policy = 'on' | 'tools-only' | 'off';

/** Every word this decision puts on screen. The switch belongs beside the model
 *  chip, which is where the hand already is when the run is being set up. */
export const policyWords = {
  label: 'Add-ons that start work on their own',
  note: 'Some add-ons ask for another turn, or carry on after a reply is finished. With this off their tools still work — only the starting stops.',
  /** The three settings, as somebody would choose them. */
  on: 'Let them',
  toolsOnly: 'Tools only',
  off: 'Off here',
} as const;

/** What a setting means, on the row under its name. */
export function saysPolicy(policy: Policy): string {
  if (policy === 'on') return 'Can start turns of its own';
  if (policy === 'tools-only') return 'Its tools work; it cannot start a turn';
  return 'Not running here';
}

/**
 * Whether the loader attaches this add-on's lifecycle handlers.
 *
 * True for `off` as well as `tools-only`: a caller that asks only this question
 * still gets the safe answer, and one that asks `dropsEntirely` first never
 * reaches it.
 */
export function dropsLifecycleHooks(policy: Policy): boolean {
  return policy !== 'on';
}

/** Whether the add-on is left out of the session altogether. */
export function dropsEntirely(policy: Policy): boolean {
  return policy === 'off';
}

/**
 * How much of this add-on runs here.
 *
 * A card that does none of the orchestrating things runs whole, everywhere —
 * the default is on, and nobody has to find a switch to get their tools. A card
 * that does, or a card we could not read at all, stands down where Graphe is
 * driving and keeps its tools where a person is. What somebody chose for this
 * conversation beats both.
 */
export function policyFor(
  card: CapabilityCard | null,
  session: SessionKind,
  chosen?: Policy,
): Policy {
  if (chosen !== undefined && session === 'conversation') return chosen;
  if (card !== null && !card.orchestrating) return 'on';
  /*
   * A conversation gets the whole add-on, hooks and all.
   *
   * It used to get its tools without its hooks, which sounds cautious and is
   * not: an add-on whose tool starts work and whose hook delivers the result is
   * an add-on that launches and then never answers. Half an add-on is worse
   * than none, because none is at least legible.
   *
   * What made the hooks dangerous — two things deciding when a turn begins — is
   * handled where it belongs now. An add-on asking for a turn is one reason
   * among the Continuation Authority's own, counted against the same budget and
   * named out loud, and a lifecycle handler that stops answering is let go of
   * rather than allowed to hold the settle.
   *
   * A board piece, a helper and a canvas block still get none of it. Nobody is
   * sitting in front of those, and four of them each starting turns of their own
   * is four loops nobody asked for.
   */
  if (session === 'conversation') return 'on';
  return 'off';
}
