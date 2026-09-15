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

import { newViewId, type ViewId } from './identity';

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

/**
 * What the inspector's own line says while it is pinned.
 *
 * A pinned panel names the chat it is reading, because a panel that stopped
 * following the hand is otherwise indistinguishable from one that is stuck.
 */
export function pinnedWords(name: string): string {
  return `Pinned to ${name}`;
}
