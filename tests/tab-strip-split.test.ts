// @vitest-environment jsdom
/** The press that makes a second pane, in the strip where the hand already is. */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it } from "vitest";

import Tabs from "../src/components/Tabs";

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

const TABS = [
  { id: "v1", title: "Make the header sticky", project: "/work/atlas", state: "idle" as const },
];

function draw(props: Record<string, unknown>): HTMLDivElement {
  const host = document.createElement("div");
  document.body.append(host);
  act(() => createRoot(host).render(createElement(Tabs, props as never)));
  return host;
}

const base = { tabs: TABS, at: "v1", onOpen: () => {}, onClose: () => {}, onNew: () => {} };

describe("the strip", () => {
  it("offers Split at its end, named as the operation", () => {
    const host = draw({ ...base, onSplit: () => {} });
    const press = host.querySelector(".tabs__split") as HTMLButtonElement;
    expect(press.textContent).toBe("Split");
    expect(press.title).toBe("Split");
    // Inside the strip's own row, not a band floating above the thread.
    expect(host.querySelector(".tabs")?.contains(press)).toBe(true);
  });

  it("presses once and reaches the window", () => {
    let splits = 0;
    const host = draw({ ...base, onSplit: () => (splits += 1) });
    act(() => (host.querySelector(".tabs__split") as HTMLButtonElement).click());
    expect(splits).toBe(1);
  });

  it("is absent where the window cannot hold a second pane", () => {
    const host = draw(base);
    expect(host.querySelector(".tabs__split")).toBeNull();
  });

  it("is reachable by keyboard, and reachable is enough to press", () => {
    const host = draw({ ...base, onSplit: () => {} });
    const press = host.querySelector(".tabs__split") as HTMLButtonElement;
    expect(press.tagName).toBe("BUTTON");
    // Not roving: the strip's arrows walk tabs, and a control that is not a tab
    // is reached by tabbing to it, so it must not carry the roving -1.
    expect(press.getAttribute("tabindex")).not.toBe("-1");
  });
});
