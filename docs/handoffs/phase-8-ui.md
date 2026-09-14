# Phase 8 handoff: the desktop shell and the retired designer workflows

Findings: U01 done, U02 partly, U03 open, U04 open, U05 not verified. This phase
requires visual inspection; none was possible (see "No visual evidence").

## Done

**U01, the tab strip.** `tabs.slice(0, 3)` was the whole of the old behaviour:
the fourth conversation was unreachable and the selected tab could be absent from
the row.

- Every tab is rendered. The strip scrolls horizontally, the width follows the
  real tab count, and the selected tab is scrolled into view with
  `block: 'nearest', inline: 'nearest'` when it changes. The overflow menu is
  driven by measured clipping rather than a count, so it lists only what has
  actually scrolled away.
- U02, partly: roving tabindex (one tab stop, Tab leaves the strip), Arrow keys,
  Home/End, Alt+Arrow for the keyboard equivalent of drag reorder, and focus that
  returns to a neighbour after a close. Close controls are reachable and visible
  on keyboard focus. Accessible names carry the project when two titles collide.
- Evidence: `tests/tab-strip.test.ts` (11 jsdom tests, including 20 tabs
  rendered, the selected state, the width following the count, Arrow/Home/End
  calling `onOpen` with the expected tab, and `scrollIntoView` called with the
  documented options). `tests/tab-order.test.ts` still passes unchanged.

**The one place a copy is made** is a real card now: click the new-worktree
button beside New conversation, read where it would go and what would not come
with it, then press. That is 8.1's "isolation is visible before the first send".

## Not done

| Item | Note |
| --- | --- |
| The retirement table in 8.2 | **Three rows done, three open.** Removed: the Designer hub (route, `DesignView`, `src/design/reading.ts`, the palette/keyboard/sidebar entries), direct style editing of project tokens (`Styles`, `src/design/tokens.ts`, `grouping.ts`, the `designCommit` channel, the token read in `overview`), and the automatic design-QA panels (`Legible`, `Clipped`'s audit use, `Drift`, `Responsive`, `Motion`, `Inspector`, `src/preview/inspect.ts`, `src/design/legibility.ts`, `pairs.ts`, `src/motion/read.ts`) with their tests and the width-check route. Kept, with reasons: the app's own appearance controls (`ColourPicker`, `FontPicker`, `AppearanceBand`, `src/design/appearance.ts`) because those are the theme, not project style editing; `src/design/widths.ts` because the held-pictures machinery still uses it; `Clipped` because it is the general truncation affordance. **Still in the build:** Figma following (`InStep`, `LinkFigma`, `src/design/{figma,follow,moved}.ts`, `src/projects/followed.ts` and their channels), the variations UI (`Against`), and the visual-evidence furniture (`EvidenceReel`, capture-on-settle). Each of those owns state a person made - a followed project, an attempt folder, recorded evidence - so removing the UI without an export path would be worse than leaving it; that export is the work the remaining rows need first |
| U03, the navigation model | Not started |
| U04, preview ownership | Not started |
| U05, the 620x520 layout matrix | Not run |
| Composer polish (8.4) | Untouched: IME, paste limits, message selection while streaming, failed highlighting fallbacks |
| `CLAUDE.md` product guidance | Not edited. The file is untracked in this repository (`CLAUDE.md` is in `.gitignore`), so an edit would not reach the pull request. The plan's instruction to update its "worktree only under Show me" and designer-first guidance is therefore recorded here rather than done |

## No visual evidence

The audit that produced this plan could not drive a browser; neither could this
work. Every claim above is from source, component tests and typechecking. No
screenshot, no keyboard walkthrough, no screen-reader pass and no zoom matrix was
performed, so the phase 8 exit criteria ("visual matrix has screenshots and
recorded interaction results") are not met.
