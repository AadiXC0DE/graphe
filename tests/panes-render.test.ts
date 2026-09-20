// @vitest-environment jsdom
/** The band, rendered, so the wiring assertions are not the only evidence.
 *
 * A tablist is a contract with the keyboard, and the wiring test above cannot
 * tell a real one from a well-spelled role attribute. This draws the component
 * and drives it.
 */

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it } from "vitest";

import Panes from "../src/components/Panes";

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

function draw(props: Record<string, unknown>): HTMLDivElement {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(createElement(Panes, props as never)));
  return host;
}

const NOTHING = (): void => undefined;

describe("with one pane", () => {
  /* The single press that makes a second lives at the end of the conversation
   *  tab strip, where somebody choosing a conversation is already looking. One
   *  control for one operation: the band draws nothing at all. */
  it("draws nothing, because there is no question of where the hand is", () => {
    const host = draw({
      panes: [{ id: "v1", title: "One chat", focused: true }],
      pinned: null,
      onFocus: NOTHING,
      onClose: NOTHING,
      onTogglePin: NOTHING,
    });
    expect(host.querySelector('[role="tablist"]')).toBeNull();
    expect(host.textContent).toBe("");
  });
});

describe("the band with two", () => {
  it("says where the hand is, and exactly one tab stop", () => {
    const host = draw({
      panes: [
        { id: "v1", title: "First chat", focused: false },
        { id: "v2", title: "Second chat", focused: true },
      ],
      pinned: "Pinned to First chat",
      onFocus: NOTHING,
      onClose: NOTHING,
      onTogglePin: NOTHING,
    });
    const tabs = [...host.querySelectorAll('[role="tab"]')];
    expect(tabs).toHaveLength(2);
    expect(tabs[1]?.getAttribute("aria-selected")).toBe("true");
    expect(tabs[0]?.getAttribute("aria-selected")).toBe("false");
    // One tab stop, so Tab leaves the band rather than walking every pane.
    expect(
      tabs.filter((one) => one.getAttribute("tabindex") === "0"),
    ).toHaveLength(1);
    // The panel names the chat it stopped following, so a pin is visible.
    expect(host.textContent).toContain("Pinned to First chat");
  });

  it("moves between panes with the arrows", () => {
    const seen: string[] = [];
    const host = draw({
      panes: [
        { id: "v1", title: "First", focused: true },
        { id: "v2", title: "Second", focused: false },
      ],
      pinned: null,
      onFocus: (id: string) => seen.push(id),
      onClose: NOTHING,
      onTogglePin: NOTHING,
    });
    const first = host.querySelector('[role="tab"]') as HTMLButtonElement;
    act(() => {
      first.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      );
    });
    expect(seen).toEqual(["v2"]);
  });

  it("closes the pane it names rather than the one in front", () => {
    const closed: string[] = [];
    const host = draw({
      panes: [
        { id: "v1", title: "First", focused: true },
        { id: "v2", title: "Second", focused: false },
      ],
      pinned: null,
      onFocus: NOTHING,
      onClose: (id: string) => closed.push(id),
      onTogglePin: NOTHING,
    });
    const close = host.querySelector(".panes__close") as HTMLButtonElement;
    act(() => close.click());
    expect(closed).toEqual(["v1"]);
  });
});
