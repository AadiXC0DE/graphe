/** Two panes over one project, and which one the hand is in.
 *
 * The plan's rule for 8.3 is a condition rather than a feature request: a
 * second pane holds a view id, focusing it sets the target of the composer and
 * the keyboard through that pane's conversation, the inspector follows the
 * focused pane and says `Pinned to <chat>` when it is pinned, and opening the
 * same chat in another pane creates no session. It is explicit that a visual
 * split over one ambiguous global target must not ship, which is why the model
 * is a view id rather than a second nullable string.
 *
 * The model is asserted directly; the wiring is asserted over `src/App.tsx`,
 * which draws the window and needs a real shell to mount.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  MOST_PANES,
  addPane,
  closePane,
  focusPane,
  focusedConversation,
  inspectorPane,
  isPinned,
  onePane,
  paneAt,
  panesShowing,
  pin,
  pinnedWords,
  showIn,
} from "../src/domain/views";

const here = fileURLToPath(new URL("..", import.meta.url));
const APP = readFileSync(`${here}src/App.tsx`, "utf8");
const BAND = readFileSync(`${here}src/components/Panes.tsx`, "utf8");
const TABS = readFileSync(`${here}src/components/Tabs.tsx`, "utf8");

/** One pane on chat A, and a second one opened beside it. */
function two() {
  const first = onePane("chat-a");
  return addPane(first, "chat-b");
}

describe("the panes a window is showing", () => {
  it("is one to start with, and it is the pane the hand is in", () => {
    const only = onePane("chat-a");
    expect(only.open).toHaveLength(1);
    expect(only.focused).toBe(only.open[0]?.id);
    expect(focusedConversation(only)).toBe("chat-a");
  });

  it("opens a second one, and the hand goes to it", () => {
    const panes = two();
    expect(panes.open).toHaveLength(2);
    expect(focusedConversation(panes)).toBe("chat-b");
  });

  /* Two is the most a window this size holds and still draws a transcript worth
   *  reading. A third press is answered with the window as it is rather than
   *  with a pane nobody asked for. */
  it("stops at two, rather than opening one that cannot be read", () => {
    const panes = addPane(two(), "chat-c");
    expect(panes.open).toHaveLength(MOST_PANES);
  });
});

describe("focusing a pane", () => {
  /* The line the plan draws: focusing a pane sets the target of the composer
   *  and the keyboard through that pane's conversation. */
  it("is what decides which conversation the controls address", () => {
    const panes = two();
    const first = panes.open[0];
    expect(first).toBeDefined();
    const back = focusPane(panes, first!.id);
    expect(focusedConversation(back)).toBe("chat-a");
  });

  it("leaves the group alone when it is already there", () => {
    const panes = two();
    expect(focusPane(panes, panes.focused)).toBe(panes);
  });

  it("ignores a pane that is not there, rather than inventing one", () => {
    const panes = two();
    expect(focusPane(panes, "nobody" as never)).toBe(panes);
    expect(paneAt(panes, "nobody" as never)).toBeNull();
  });
});

describe("the inspector beside the panes", () => {
  it("follows the focused pane by default", () => {
    const panes = two();
    expect(inspectorPane(panes).id).toBe(panes.focused);
    expect(isPinned(panes)).toBe(false);
  });

  it("stays where it was put when it is pinned, and says which chat that is", () => {
    const panes = two();
    const first = panes.open[0];
    const held = pin(panes, first!.id);
    expect(isPinned(held)).toBe(true);
    expect(inspectorPane(held).id).toBe(first!.id);
    // The panel names the chat it is reading, because one that stopped
    // following the hand looks exactly like one that is stuck.
    expect(pinnedWords("Make the header sticky")).toBe(
      "Pinned to Make the header sticky",
    );
  });

  it("goes back to following the focus when unpinned", () => {
    const held = pin(two(), two().open[0]?.id ?? null);
    const free = pin(held, null);
    expect(isPinned(free)).toBe(false);
    expect(inspectorPane(free).id).toBe(free.focused);
  });

  it("refuses to pin to a pane nobody can see", () => {
    const panes = two();
    expect(pin(panes, "gone" as never)).toBe(panes);
  });

  /* A pin on a closed pane would leave the panel reading a view that is not
   *  drawn, which is worse than following the hand. */
  it("drops a pin whose pane has been closed", () => {
    const panes = two();
    const first = panes.open[0];
    const held = pin(panes, first!.id);
    const left = closePane(held, first!.id);
    expect(left.pinned).toBeNull();
    expect(left.open).toHaveLength(1);
  });
});

describe("closing a pane", () => {
  it("moves the hand to the one that is left", () => {
    const panes = two();
    const closed = closePane(panes, panes.focused);
    expect(closed.open).toHaveLength(1);
    expect(closed.focused).toBe(closed.open[0]?.id);
  });

  /* Closing the last view of a project is closing the project, which is a
   *  different act with a different control. */
  it("never closes the last one", () => {
    const only = onePane("chat-a");
    expect(closePane(only, only.focused)).toBe(only);
  });
});

describe("one conversation in two panes", () => {
  /* The condition the plan names in as many words: opening the same chat in
   *  another pane does not create a session. Two panes naming one conversation
   *  is the whole of it — there is nothing here that could ask for a second
   *  runtime, because a pane holds an address and not a session. */
  it("is one conversation with two views, not two conversations", () => {
    const panes = addPane(onePane("chat-a"), "chat-a");
    expect(panes.open).toHaveLength(2);
    expect(panesShowing(panes, "chat-a")).toHaveLength(2);
    expect(new Set(panes.open.map((one) => one.conversation)).size).toBe(1);
  });

  it("leaves the other pane alone when one of them changes chat", () => {
    const panes = two();
    const first = panes.open[0];
    const moved = showIn(panes, first!.id, "chat-c");
    expect(paneAt(moved, first!.id)?.conversation).toBe("chat-c");
    expect(paneAt(moved, panes.focused)?.conversation).toBe("chat-b");
  });
});

describe("where the press that makes a second one lives", () => {
  /* The repo's rule is to put the control where the hand already is. Somebody
     choosing a conversation is looking at the tab strip, so the press sits at
     its right-hand end beside New, and the band above the thread draws nothing
     until there are two panes to tell apart. */
  it("is the end of the conversation tab strip, beside New", () => {
    expect(TABS).toContain("split: 'Split'");
    expect(TABS).toContain("className=\"tabs__split\"");
    expect(TABS).toContain('title={SAYS.split}');
    // It reaches only where the window can hold a second pane, so the press is
    // never a control that goes nowhere.
    expect(TABS).toContain("onSplit === undefined ? null : (");
    expect(APP).toContain("onSplit={splitPane}");
  });

  it("is not a band of its own above the thread", () => {
    expect(BAND).toContain("if (panes.length < 2) return null;");
  });
});

describe("what the window does with it", () => {
  it("holds the panes and reads the controls off the focused one", () => {
    expect(APP).toContain("useState<Panes>(() => onePane())");
    expect(APP).toContain("const aimedAt = focusedConversation(panes);");
  });

  it("retargets by moving the desk to the focused pane, which is one code path", () => {
    expect(APP).toContain("const focusOn = useCallback(");
    expect(APP).toContain("setPanes((current) => focusPane(current, id));");
    // One transcript and one runtime behind both views: focusing swaps the
    // conversation on screen rather than building a second anything.
    expect(APP).toContain("void swapConversation(wanted.conversation);");
  });

  it("draws the pane beside from the same desk, so no second session is built", () => {
    expect(APP).toContain(
      "const otherPane = panes.open.find((one) => one.id !== herePane.id) ?? null;",
    );
    // The beside pane reads the desk it already has.
    expect(APP).toContain("conversationIn(desk, otherPane.conversation).turns");
  });

  /* A card pressed in the pane beside must act on that pane's conversation,
   *  not on whichever one the hand is in. */
  it("binds the beside pane's cards to its own conversation", () => {
    expect(APP).toContain("const ownerThere: Owned = {");
    expect(APP).toContain("respond(ownerThere, turnId, callId, decision)");
  });

  it("says which chat the panel is pinned to, and offers the pin", () => {
    expect(APP).toContain("pinnedTo = isPinned(panes)");
    expect(APP).toContain("pinnedWords(");
    expect(APP).toContain("inspectorPane(panes).conversation");
    expect(BAND).toContain("{pinned === null ? SAYS.pin : SAYS.pinned}");
  });

  /* The band is a real tablist: focusing a pane is what retargets everything,
   *  so it has to be reachable without a mouse. */
  it("is reachable by keyboard, not only by click", () => {
    expect(BAND).toContain('role="tablist"');
    expect(BAND).toContain('ArrowRight');
    expect(BAND).toContain('ArrowLeft');
  });
});
