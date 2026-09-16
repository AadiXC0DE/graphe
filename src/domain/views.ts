/** Panes: the views onto a project, and which one the hand is in.
 *
 * A pane is a view, not a conversation and not a session. The window used to
 * have one place a conversation could be, so "which conversation" was a single
 * scalar that everything acted on. Two views cannot be said in one scalar, and
 * the plan is explicit that a visual split over one ambiguous global target must
 * not ship: so a pane carries a view id of its own, and the focused pane is what
 * the composer, the keyboard and the inspector address.
 *
 * The project is deliberately not part of a pane. Both panes are views of the
 * project in front — a desk holds every open conversation of a project whole —
 * so a second pane is one project seen twice rather than two projects. That is
 * what makes "opening the same chat in another pane" cost nothing: it is one
 * conversation with two views, and the shell keeps one runtime for it because
 * both ask for it by the same address.
 *
 * Pure, and free of anything a browser-drawn module cannot have, so the window
 * can mint a view id without pulling a Node import into the bundle.
 */

import { newViewId, asViewId, type ViewId } from './identity';

export type { ViewId };

/** One view onto one conversation of the project in front. */
export type Pane = {
  readonly id: ViewId;
  /** The conversation this pane shows, as the shell addresses it. Null before
   *  anything has been opened in it. */
  readonly conversation: string | null;
};

export type Panes = {
  /** One or two, in the order they were opened. The first is always there. */
  readonly open: readonly Pane[];
  /** The pane the hand is in. Its conversation is the one every action
   *  addresses. */
  readonly focused: ViewId;
  /** The pane the inspector is pinned to, or null when it follows the focus.
   *  Pinning is a deliberate act: a panel that moved because a pane was clicked
   *  would be reading a conversation nobody asked it to read. */
  readonly pinned: ViewId | null;
};

/** Two is the most a window this size holds and still draws a transcript worth
 *  reading; beyond that the panes are tabs, which the strip already is. */
export const MOST_PANES = 2;

/** One pane showing one conversation, which is the ordinary window. */
export function onePane(conversation: string | null = null): Panes {
  const only: Pane = { id: newViewId(), conversation };
  return { open: [only], focused: only.id, pinned: null };
}

export function paneAt(panes: Panes, id: ViewId): Pane | null {
  return panes.open.find((one) => one.id === id) ?? null;
}

/** The pane the hand is in. Always one: the focused view cannot be closed
 *  without another taking the focus. */
export function focusedPane(panes: Panes): Pane {
  return (
    paneAt(panes, panes.focused) ??
    panes.open[0] ?? { id: panes.focused, conversation: null }
  );
}

/** Which conversation the composer, the keyboard and the inspector address. */
export function focusedConversation(panes: Panes): string | null {
  return focusedPane(panes).conversation;
}

/** The pane the inspector reads: the pinned one when one is pinned, and the
 *  focused one otherwise. */
export function inspectorPane(panes: Panes): Pane {
  return panes.pinned === null
    ? focusedPane(panes)
    : (paneAt(panes, panes.pinned) ?? focusedPane(panes));
}

export function isPinned(panes: Panes): boolean {
  return panes.pinned !== null && paneAt(panes, panes.pinned) !== null;
}

/** What a pane is showing, in the shape the shell records it by. Pane 0 is the
 *  left one; the record a window writes is always this whole list, because
 *  closing a pane has to be able to take its view away. */
export type Shown = { viewId: string; conversation: string; pane: 0 | 1 };

export function shownNow(panes: Panes): readonly Shown[] {
  const shown: Shown[] = [];
  for (const [at, pane] of panes.open.entries()) {
    if (pane.conversation === null || at > 1) continue;
    shown.push({ viewId: pane.id, conversation: pane.conversation, pane: at === 0 ? 0 : 1 });
  }
  return shown;
}

/** The panes a launch puts back.
 *
 * Pane 0 is the conversation this launch opened on, which is the one the shell
 * just read for us. Pane 1 is the other one the window was showing, when it was
 * showing two and that chat is still in this project. A record whose
 * conversation is gone leaves an ordinary single-pane window rather than a pane
 * that fails the moment it is pressed. */
export function panesFrom(
  shown: readonly Shown[],
  here: readonly string[],
  opened: string | null,
): Panes {
  const known = new Set(here);
  const other = shown.find(
    (one) => one.pane === 1 && known.has(one.conversation),
  );
  const only = onePane(opened);
  if (other === undefined) return only;
  const first = only.open[0];
  if (first === undefined) return only;
  return {
    open: [first, { id: asViewId(other.viewId), conversation: other.conversation }],
    focused: first.id,
    pinned: null,
  };
}

/**
 * Open a second pane, and focus it.
 *
 * A window that cannot hold another says so by returning itself, so the caller
 * draws what is true rather than what it hoped. `conversation` is left out for
 * an empty pane, which is where a chat is chosen.
 */
export function addPane(
  panes: Panes,
  conversation: string | null = null,
): Panes {
  if (panes.open.length >= MOST_PANES) return panes;
  const made: Pane = { id: newViewId(), conversation };
  return { ...panes, open: [...panes.open, made], focused: made.id };
}

/** Close a pane. The last one is not closed: a window with no view has nothing
 *  to draw, and closing the last view of a project is closing the project. */
export function closePane(panes: Panes, id: ViewId): Panes {
  if (panes.open.length <= 1) return panes;
  const left = panes.open.filter((one) => one.id !== id);
  if (left.length === panes.open.length) return panes;
  return {
    open: left,
    focused:
      panes.focused === id ? (left[0]?.id ?? panes.focused) : panes.focused,
    // A pin on a pane that is gone would leave the inspector reading a view
    // nobody can see, so it goes back to following the focus.
    pinned: panes.pinned === id ? null : panes.pinned,
  };
}

/**
 * Put the hand in a pane.
 *
 * This is the whole of "focusing a pane retargets the composer and the
 * keyboard": everything that acts on a conversation asks which one the focused
 * pane holds, so focusing is not decoration.
 */
export function focusPane(panes: Panes, id: ViewId): Panes {
  if (paneAt(panes, id) === null || panes.focused === id) return panes;
  return { ...panes, focused: id };
}

/** Show a conversation in a pane. A pane that is empty and one showing another
 *  chat are the same press from the hand's side. */
export function showIn(
  panes: Panes,
  id: ViewId,
  conversation: string | null,
): Panes {
  const found = paneAt(panes, id);
  if (found === null || found.conversation === conversation) return panes;
  return {
    ...panes,
    open: panes.open.map((one) =>
      one.id === id ? { ...one, conversation } : one,
    ),
  };
}

/** Follow the focus, or stay where it was put. */
export function pin(panes: Panes, id: ViewId | null): Panes {
  if (id !== null && paneAt(panes, id) === null) return panes;
  return panes.pinned === id ? panes : { ...panes, pinned: id };
}

/** Every pane showing a conversation. One is the ordinary case; two is what the
 *  plan calls out, and there is still only one conversation behind them. */
export function panesShowing(
  panes: Panes,
  conversation: string | null,
): readonly Pane[] {
  return panes.open.filter((one) => one.conversation === conversation);
}

export function withoutConversation(panes: Panes, conversation: string, fallback: string | null): Panes {
  const remaining = panes.open.filter((one) => one.conversation !== conversation);
  if (remaining.length === panes.open.length) return panes;
  if (remaining.length === 0) return onePane(fallback);
  return {
    open: remaining,
    focused: remaining.some((one) => one.id === panes.focused) ? panes.focused : remaining[0]!.id,
    pinned: remaining.some((one) => one.id === panes.pinned) ? panes.pinned : null,
  };
}

/**
 * What the inspector's own line says while it is pinned.
 *
 * A pinned panel names the chat it is reading, because a panel that stopped
 * following the hand is otherwise indistinguishable from one that is stuck.
 */
export function pinnedWords(name: string): string {
  return `Pinned to ${name}`;
}
