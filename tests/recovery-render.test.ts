// @vitest-environment jsdom
/** The band, rendered: the sentences a person reads must be the ones on screen.
 *
 * The wiring test above reads the source; this draws the component, because a
 * sentence nobody can see is not a recovery surface. Both ways forward are
 * presses, and a press that does nothing is worse than no press at all.
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it } from "vitest";

import Recovery from "../src/components/Recovery";

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

function draw(props: Record<string, unknown>): HTMLDivElement {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(createElement(Recovery, props as never)));
  return host;
}

describe("the band a missing folder gets", () => {
  it("says Workspace unavailable and names the folder", () => {
    const host = draw({
      trouble: {
        folder: "/work/atlas-copy",
        state: "missing",
        because: "It worked in /work/atlas-copy.",
      },
      onContinue: () => {},
    });
    expect(host.textContent).toContain("Workspace unavailable");
    expect(host.textContent).toContain("/work/atlas-copy");
    expect(host.textContent).toContain("Continue in a new workspace");
  });

  it("offers the relink as well when the window can", () => {
    let relinked = 0;
    let continued = 0;
    const host = draw({
      trouble: { folder: "/gone", state: "missing", because: "gone" },
      onRelink: () => {
        relinked += 1;
      },
      onContinue: () => {
        continued += 1;
      },
    });
    const buttons = [...host.querySelectorAll("button")];
    expect(buttons.map((one) => one.textContent)).toEqual([
      "Relink…",
      "Continue in a new workspace",
    ]);
    act(() => buttons[0]?.click());
    act(() => buttons[1]?.click());
    expect(relinked).toBe(1);
    expect(continued).toBe(1);
  });

  it("says it is still choosing rather than looking dead", () => {
    const host = draw({
      trouble: { folder: "/gone", state: "missing", because: "gone" },
      onRelink: () => {},
      onContinue: () => {},
      choosing: true,
    });
    const first = host.querySelector("button") as HTMLButtonElement;
    expect(first.textContent).toContain("Choosing");
    expect(first.disabled).toBe(true);
  });
});
