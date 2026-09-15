# Phase 8 handoff: the desktop shell and the retired designer workflows

Findings: U01 done, U02 partly, U03 done (one name per thing), U04 done (phase
5), U05 run — the machine half of the matrix is green, the person-only half is
`visual-matrix.md`'s list. The first draft of this handoff said three of these
were open because no browser could be driven; one can now, so the rows below are
corrected in place and the "No visual evidence" section is kept only for what it
still describes.

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

**8.3's second pane.** The plan's condition for a split — "do not ship a visual
split that still has one ambiguous global `inConversation` target" — is met by
giving each pane a view id rather than a second nullable string:
`src/domain/views.ts` holds one or two panes and which one the hand is in, the
focused pane's conversation is what the composer, the keyboard and the inspector
address, and `Panes` in the band above the thread says `Pinned to <chat>` when
the inspector is pinned rather than following the focus. The press sits at the
end of the tab strip beside New (`src/components/Tabs.tsx`, the same place the
hand already is), and opening the same chat in another pane builds no second
session: `Sessions` is keyed by conversation (`src/domain/conversations.ts:221`)
and a pane holds an address, not a session. Evidence: `tests/panes.test.ts` (23),
`tests/panes-render.test.ts`, `tests/tab-strip-split.test.ts` (4).

**U02, assistive-tech validation.** The matrix's accessibility rows now read the
tree through CDP on the opening screen, a conversation, the settings sheet and
the add-ons screen, and its keyboard row walks 40 Tab stops; two findings they
produced (four buttons announced as "Add", two as "Close") are fixed. That is a
machine reading the tree, not a person listening to it — the screen-reader pass
proper is still in the person-only list. See `visual-matrix.md`.

## Item by item, and what is still open

Three rows below were done after this handoff was first written and are struck
through rather than deleted, so a reader who saw the earlier list can see what
changed and where the evidence went.

| Item | Note |
| --- | --- |
| The retirement table in 8.2 | **Three rows done, three open.** Removed: the Designer hub (route, `DesignView`, `src/design/reading.ts`, the palette/keyboard/sidebar entries), direct style editing of project tokens (`Styles`, `src/design/tokens.ts`, `grouping.ts`, the `designCommit` channel, the token read in `overview`), and the automatic design-QA panels (`Legible`, `Clipped`'s audit use, `Drift`, `Responsive`, `Motion`, `Inspector`, `src/preview/inspect.ts`, `src/design/legibility.ts`, `pairs.ts`, `src/motion/read.ts`) with their tests and the width-check route. Kept, with reasons: the app's own appearance controls (`ColourPicker`, `FontPicker`, `AppearanceBand`, `src/design/appearance.ts`) because those are the theme, not project style editing; `src/design/widths.ts` because the held-pictures machinery still uses it; `Clipped` because it is the general truncation affordance. **Still in the build:** Figma following (`InStep`, `LinkFigma`, `src/design/{figma,follow,moved}.ts`, `src/projects/followed.ts` and their channels), the variations UI (`Against`), and the visual-evidence furniture (`EvidenceReel`, capture-on-settle). Each of those owns state a person made - a followed project, an attempt folder, recorded evidence - so removing the UI without an export path would be worse than leaving it; that export is the work the remaining rows need first |
| ~~U03, the navigation model~~ | **Done.** One name per thing, and the set that remains is the one 8.1 names: Branch, Commit, Changes, Merge and Pull request, with `Review` reserved for reviewing a change. `tests/screen-names.test.ts` (10) reads the names off `src/lib/lines.ts`, the palette in `src/App.tsx` and the modules that carry them (`Changes`, `HistoryView`, `ReviewsView`, `reviewqueue`, `owncopy`) and pins that no two point at one thing. The navigation model itself is the pane id: `src/domain/views.ts` |
| ~~U04, preview ownership~~ | **Done.** The phase 5 handoff carries it: `PreviewFrame` carries `preview`, `project` and `epoch`, `src/preview/live.ts` drops a frame from another preview, an earlier epoch or one with no identity, and the four page channels name the project whose page they are about. `tests/preview-live.test.ts` (11) |
| U05, the 620x520 layout matrix | **Run, and the machine half is green.** `docs/handoffs/visual-matrix.md` holds it: 49 rows, 290 checks over `620×520`, `800×600`, `1100×780` and a large display, the four zooms, long titles, 20+ tabs, keyboard-only use, reduced motion, the accessibility tree, contrast and the emulated media queries — re-run twice, the size and zoom rows green after findings 1 and 2 were fixed. What is still a person's is the list at the end of that file: the screen reader's own reading, a monitor unplugged, the OS switches changed in System Settings, the native dialog, overlay stacking over the native page view, a contrast judgement, and the loading layout |
| Composer polish (8.4) | Untouched: IME, paste limits, message selection while streaming, failed highlighting fallbacks |
| `CLAUDE.md` product guidance | Not edited. The file is untracked in this repository (`CLAUDE.md` is in `.gitignore`), so an edit would not reach the pull request. The plan's instruction to update its "worktree only under Show me" and designer-first guidance is therefore recorded here rather than done |

## No visual evidence

The audit that produced this plan could not drive a browser, and this first pass
of the handoff could not either — which is why the rows above originally read
"not started" and "not run". That is no longer true of the machine half: the
matrix now runs (`scripts/visual-matrix.mjs`, `npm run test:visual`), drives the
real Electron app through Playwright, and its results, the findings it produced
and the fixes are in `docs/handoffs/visual-matrix.md`. What was never done, and
is still not, is a person at the window: no screen-reader pass by somebody
listening, no monitor unplugged, no OS switches changed in System Settings, no
native file dialog, no overlay stacking measured against the native page view,
and no contrast judgement — those are item 1 of that file's person-only list, and
they are also why phase 8's exit criterion ("visual matrix has screenshots and
recorded interaction results") reads as met for the machine half and open for the
rest. The claims in the sections above that rest on source and component tests
still do, and each says so where it is made.
