/** One name for one thing, across the screens that are left.
 *
 * U03 is the plan's finding that Design, Canvas, Review and History had
 * overloaded navigation: several of them named the same thing, and `Review` in
 * particular meant a change under review in one place and unread finished work
 * in another. Phase 8 retired the designer screens; what this asserts is that
 * the set that remains is one recognisable set, named per 8.1 — Branch, Commit,
 * Changes, Merge and Pull request, with `Review` reserved for reviewing a
 * change — and that no two names point at one thing.
 *
 * The names are read off the modules that carry them rather than off a running
 * window, because a name is a string a person reads and the surface that draws
 * it is tested where the surface is.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { LINE_WORDS } from "../src/lib/lines";
import { SAYS as CHANGES } from "../src/components/Changes";
import { SAYS as HISTORY } from "../src/components/HistoryView";
import { SAYS as VIEWS } from "../src/components/ReviewsView";
import { reviewWords } from "../src/work/reviewqueue";
import { OWN_COPY_WORDS } from "../src/lib/owncopy";

const here = fileURLToPath(new URL("..", import.meta.url));
const APP = readFileSync(`${here}src/App.tsx`, "utf8");
const SIDEBAR = readFileSync(`${here}src/components/Sidebar.tsx`, "utf8");

/** The names the palette offers, as they are written. */
function paletteNames(): readonly string[] {
  return [...APP.matchAll(/\{ id: '([a-z-]+)', name: '([^']+)'/g)].map(
    (one) => one[2] ?? "",
  );
}

describe("the names the screen headings carry", () => {
  it("calls the line of work Branch", () => {
    expect(LINE_WORDS.heading).toBe("Branch");
  });

  it("calls the working diff Changes, and not a sentence about it", () => {
    expect(CHANGES.heading).toBe("Changes");
  });

  it("calls the commits History", () => {
    expect(HISTORY.heading).toBe("History");
  });

  it("calls the remote screen Pull requests, in the words git uses", () => {
    expect(VIEWS.heading).toBe("Pull requests");
  });

  it("keeps Merge for merging, in the words owncopy speaks", () => {
    expect(OWN_COPY_WORDS.bring).toBe("Merge into…");
  });
});

describe("Review means reviewing a change", () => {
  /* The one word the plan singles out. It is the queue of finished work waiting
   *  to be looked at, and the count under it says so; it is not unread task
   *  completion, not a list of pull requests and not a working tree. */
  it("is the heading of the finished-work queue", () => {
    expect(reviewWords.heading).toBe("Review");
  });

  it("says what is waiting rather than naming a different thing", () => {
    expect(reviewWords.badge(1)).toContain("waiting for you");
    expect(reviewWords.nothing).not.toContain("Review");
  });
});

describe("no two names point at one thing", () => {
  /* The defect U03 names: the same surface under two names. `Changes` and
   *  `History` reading the same thing was the pair to separate — one is the
   *  working tree, the other is the commits — and a palette that said
   *  "Review the working diff" while the heading said "What changed" was one
   *  surface under three names. */
  it("offers each screen once, under the name its heading uses", () => {
    const names = paletteNames();
    expect(names).toContain("Changes");
    expect(names).toContain("History");
    expect(names).toContain("Pull requests");
    expect(names).toContain("Review");
    // The old phrasings, which named a screen by describing it.
    expect(names).not.toContain("Review the working diff");
    expect(names).not.toContain("Look through the history");
    expect(names).not.toContain("Read the pull requests");
    expect(names).not.toContain("Review finished work");
  });

  it("does not carry the retired screens anywhere a person can press", () => {
    // The canvas was retired in phase 8 and has no entry point left.
    expect(SIDEBAR).not.toContain("Canvas");
    expect(SIDEBAR).not.toContain("onCanvas");
    expect(APP).not.toContain("CanvasView");
    expect(APP).not.toContain("DesignView");
  });

  /* Every name the palette shows is distinct: two rows with one name is two
   * presses a person cannot tell apart. */
  it("gives every palette row a name of its own", () => {
    const names = paletteNames();
    expect(names.length).toBeGreaterThan(10);
    expect(new Set(names).size).toBe(names.length);
  });
});
