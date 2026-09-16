# Phase 8 retirements: the removal manifest

What phase 8 of `docs/graphe-stabilization-plan-2026-09-13.md` removed, row by row, against
the 8.2 table. Read this before re-adding anything named below.

The rule the plan sets is in all four columns of 8.2: remove the production entry point, the
tool registration, the IPC route and the private runtime path, once existing records have a
recovery route. Where a feature kept something on disk, the file is left where it is and
`scripts/export-retired-work.mjs` reads it into an archive. Nothing in that script deletes or
moves anything.

## What the test pass found

The retired test files are gone and the survivors describe what is left: two of them counted a
surface rather than naming it — the shell's four `createSession` sites and the nine screens
`goToScreen` closes — and now count the three sessions and the eight screens that remain, each
still failing where a new one skips the join. One test caught a preference listed here as
removed: `howMuch` was still written, parsed and defaulted through `src/projects/preferences.ts`,
`src/lib/bridge.ts` and `src/lib/ipc.ts`, and came out of all three. Two leftovers the pass did
not clear, both unreferenced, were cleared by hand: `src/design/gate.ts`, named below as deleted
and now actually removed because nothing imported it, and `stackWords.takeAll`, whose press went
with row 6's take-all band; the test that only asserted its wording went with it. The band's
other sentences still in `stackWords` (`show`, `hide`, `heading`, `behind`, `alone`, `meets`,
`meetsWhat`, `onlyOne`, `putBack`, `putBackWhat`) are likewise uncalled by the window and were
left alone; two of them are still reached by the vocabulary sweep in `tests/stack.test.ts`.

## The export route

One script, one command, documented in its own header:

```
node scripts/export-retired-work.mjs                                   # the real profile
node scripts/export-retired-work.mjs --profile <dir> --out <dir>
node scripts/export-retired-work.mjs --project <dir>                   # adds that project's shots
```

The profile defaults to `GRAPHE_PROFILE`, then to the app's own `userData` folder for this
platform (`~/Library/Application Support/Graphe` on macOS, and the lower-case spelling when
that is the one present). It writes `<out>/` containing:

| what | why it exists |
| --- | --- |
| `followed.json`, `followed.md` | the Figma designs each project was being kept in step with |
| `flows/`, `canvases.md` | every saved canvas, with each flow's block count |
| `work/`, `away-work.md` | the notes for every queued, running and finished piece of background work |
| `copies.md` | a manifest of the per-piece worktrees, with each one's branch and whether it holds uncommitted work |
| `standing.json`, `repeats.md` | the repeats the away band scheduled |
| `agreed/` | the baselines the automatic capture compared against |
| `shots/` | only with `--project`: the before/after pictures under `<project>/.git/graphe/shots` |

`copies.md` deliberately copies nothing. Each folder listed in it is a real git worktree with a
branch behind it, so the folder itself is the work: open it, or land the branch.

Walkthrough recordings are not in the list because they were never written to disk. The recorder
coalesced frames in the window's own memory for as long as the tab was open, so once
`EvidenceReel` and the record control went there was nothing left to export.

## Row 1: visual evidence furniture

**Entry points removed.** The `EvidenceReel` render in the transcript, the record control and its
`recording`/`onRecord` props in `BrowserPane`, `usePreview`'s `record`/`recording`/`recorded`/
`setRecorded`, the `pictures` chain that fed version thumbnails (`App` → `Overview` → `History` →
`Versions`, and `HistoryView`), and the automatic capture-on-settle path in the shell.

**Channels removed.** `visualChange` (push), `visualFrames`, `watchStart`, `watchStop`,
`versionPictures`, and with them the `VisualFrames` type.

**Private files deleted.** `src/components/EvidenceReel.tsx` and `.css`,
`src/components/VisualDiff.tsx` and `.css`, `src/diff/holdcamera.ts`, `src/diff/holdshot.ts`,
`src/diff/pairing.ts`, `src/diff/summary.ts`, `src/diff/pixels.ts`, `src/diff/spring.ts`.

**Shared functions kept, and why.** `src/diff/capture.ts` survives with its import closure
(`changed.ts`, `flow.ts`, `recorder.ts`, `regions.ts`, `shots.ts`, `watching.ts`), because the
shell still calls `capture` for a board card's own picture and `filesWrittenBy` for the files a
turn wrote, which the retained overview artifacts and the continue handoff read.
`src/preview/watching.ts` is a different thing entirely — the browser's own console and network
watching — and is untouched. `src/tabs.ts`'s preview frames, the optional web preview,
user-requested screenshot attachments and the user-requested walkthrough machinery in
`BrowserPane`'s address bar all stay.

**Consequence worth knowing.** Version cards in the rail no longer have thumbnails and the
"Hide look-alikes" switch is gone with them: that picture was the automatic capture's, and the
grouping in `src/history/grouping.ts` still supports a `pictureOf`/`onlyChanged` caller, but
nothing passes one. The rail draws a moment's name and its time.

**Data route.** `agreed/` and, with `--project`, `shots/`.

## Row 2: designer handoff and publishing wrappers

**Entry points removed.** The Landing band's hand-over door and the "Export a changelog" press;
`Overview`'s `onShare`, `onHandOver` and `onOpenLink` props (the band was their only consumer);
`RoomShare` and the ring's share tooltip.

**Channels removed.** `handToDeveloper`, `putOnline`, `shareReview`, plus the `HandedOver` and
`WentOnline` types.

**Private files deleted.** `src/components/RoomShare.tsx` and `.css`, `src/share/developer.ts`,
`src/share/online.ts`, `src/share/publish.ts`, `src/share/tools.ts`, `src/share/review.ts`,
`src/share/handover.ts`.

**Shared functions kept, and why.** `graphe:room` and `src/components/Room.tsx` are the context
ring, a retained composer control, and `src/lib/roomshare.ts` is kept because `Room.tsx` reads
`ROOM_WORDS` for the ring's own labels. Every ordinary Git and PR path is untouched:
`graphe:review-*`, `graphe:repo-*`, `graphe:branch-*`, `graphe:worktree-*`, `graphe:checkout-*`,
`graphe:pr-*` (diff, checks, comments, comment, checkout, review-open, worktree-prepare) and the
agent's own git and `gh` tools.

**Data route.** None. What these presses did — a push, a pull request, a deploy — happened
outside the app, and the app kept no record of it.

## Row 3: Figma following

**Entry points removed.** The five channels and the panel; there was no production entry point
left in the window by the time this ran, which is why the whole chain could go at once.

**Channels removed.** `inStep`, `followDesign`, `lookAgain`, `caughtUp`, `stopFollowing`, and the
`InStep` type with the `Move` re-export it needed.

**Private files deleted.** `src/components/InStep.tsx` and `InStep.css`,
`src/projects/followed.ts`, `src/design/follow.ts`, `src/design/moved.ts`.

**Shared functions kept, and why.** `src/design/figma.ts` is `src/agent/pi/tools.ts`'s own reader
for a Figma link, and `src/lib/linkfigma.ts` with `src/components/LinkFigma.tsx` is the
composer's chat-attachment flow. `letFigmaIn`, `figmaLinked`, `onLinkFigma`, `onGetHelper`, the
Figma attachment chip and the Figma credential handed to the agent all stay: an ordinary Figma
link is chat context, which 8.2 says to keep.

**Data route.** `<profile>/followed.json` → `followed.json` and `followed.md`.

**Tests replaced.** `tests/instep.test.ts` and `tests/followed.test.ts` deleted.
`tests/figma.test.ts` stays, because `src/design/figma.ts` stays.

## Row 4: variations and tournaments

**Entry points removed.** The comparison sheet and the two presses that fed it, the palette's
serving of several designs, and the pane's `variations`/`variation`/`onVariation` props, whose
only writer was the removed press.

**Channels removed.** `variationsServe`, `compareWays`, `keepSet`, plus `VariationSpec`,
`VariationsOutcome` and `SideOfWork`. `try_ways` and `score_candidates` were already gone.

**Private files deleted.** `src/components/Against.tsx` and `.css`, `src/work/compare.ts`,
`src/lib/against.ts`.

**Shared functions kept, and why.** `src/history/attempts.ts` keeps `Workbench`, `HeldWork`,
`PieceOfWork`, `folderForWork`, `folderForHeld`, `bothChanged` and `nothingToTake`, and
`src/work/stack.ts` stays with them, because the retained background work still runs on them.
One engine method is now uncalled by the window: `Workbench.keepSet`, whose only production
caller was the removed `keepSet` handler; `tests/stack.test.ts` is its only remaining caller. It
is left in place rather than trimmed, because `attempts.ts` is shared with the retained path.

**Data route.** `<profile>/copies/<key>/<id>` → `copies.md`. Unmerged variants are not discarded,
not copied and not moved.

## Row 5: canvas

**Entry points removed.** `TabKind` and `kind` on `Tab`, the `Kind` glyph and its renders, the
palette action `{ id: 'canvas' }`, and every canvas callback in `App.tsx`: the flow state and
its refs, `changeFlow`, `newCanvas`, `openCanvas`, `forgetCanvas`, `sendBlock`,
`conversationForFlow`, `cameTo`, `goOn`, `startFlow`, `openGate`, `stopFlow`, `canvasHere`,
`canvasDoing`, `canvasTabs`, the flow-loading effect, the held-write timer, and the
canvas-moves-on-settle branch of the settled handler.

**Channels removed.** `flowLoad`, `flowSave`, `flowForget`.

**Private files deleted.** `src/components/CanvasView.tsx` and `.css`, `src/work/canvas.ts`,
`src/projects/flows.ts`, `src/lib/heldwrites.ts`.

**Shared functions kept, and why.** The tab strip, the conversation tabs and everything the
composer drives are untouched; only the second kind of tab went. `App.tsx` still imports
`keyOf`, `Tab` and the thread helpers.

**Data route.** `<profile>/flows/<sanitised>-<sha8>.json` → `flows/` and `canvases.md`. The
saved structure of each canvas is copied whole, so nothing about a flow's blocks is lost.

## Row 6: board and away duplicate orchestration

**The engine stays, deliberately.** Retained `task` in its background mode reaches the board
through `putOnBoard` → `keepGoing` (`electron/main.ts`, the session options), and this phase's
brief forbids removing subagents. So the piece list, its presses and its visibility stay, and
what went is the duplicate orchestration around it.

**Entry points removed.** The repeats list and its three presses, the free-text keep-going form
with its overnight box, the across-project toggle, the wait-for select, the take-all band, the
comparison press, and the App-side callbacks for all of them. `useBoard` no longer starts work:
`keepGoing` and `startAfter` went with the form that called them, `stopWaiting`, `takeAll`,
`compareWays` and the three repeat presses went with the channels, and `elsewhere` went with
`awayEverywhere`.

**Channels removed.** `addRepeat`, `switchRepeat`, `forgetRepeat`, `awayEverywhere`, `putAfter`,
`startAfter`, plus the `Repeating` and `EveryKind` types and `Away.repeats`.

**Private files deleted.** `src/work/standing.ts`, `src/work/schedule.ts`,
`src/projects/standing.ts`.

**Shared functions kept, and why.** `away`, `awayChanged`, `onAway`, `keepGoing`, `stopAway`,
`keepAway`, `answerAway`, `sayToAway`, `awayDesks`, `deskFor`, `runWhatCan`, `pushAway`,
`src/work/board.ts`, `src/work/after.ts`, `src/work/written.ts`, `src/work/notebook.ts`,
`src/work/unattended.ts`, `Workbench`/`HeldWork` in `src/history/attempts.ts`,
`src/components/Board.tsx`, `src/components/Away.tsx` and `src/hooks/useBoard.ts`. Also kept:
`src/share/holding.ts`, because `electron/main.ts`'s `saysHeldWork` reads `holdWords.label` on
the retained `keepAway` path.

**Data route.** `<profile>/work/<key>/<id>.json` → `work/` and `away-work.md`;
`<profile>/copies/<key>/<id>` → `copies.md`; `<profile>/standing.json` → `standing.json` and
`repeats.md`. Queued and unfinished pieces are surfaced as notes with their state, their copy
and any trouble, so unfinished work can be read and asked for again. Nothing is auto-resumed.

## Row 7: held-back designer changes

**Entry points removed.** The `Landing` band and `SeeFirst`; the `heldBack` toggle row in
Settings and its row definition; `App`'s landing state, `refreshLanding`, `changeHoldBack`,
`decideOnWork`, the drift `gate` memo, `changeHowMuch`, the auto-accept effect and
`handToDeveloper`; `Overview`'s `landing`, `gate`, `howMuch`, `going`, `landed`, `decided`
fields and its `onDecide`/`onHowMuch`/`onHandOver` props; the Settings `holdBack` and
`onToggleHoldBack` props; and the write of `heldBack` on the plan-answer path.

**Channels removed.** `landing`, `setHoldBack`, `decideOnWork`, `setHowMuch`, plus the
`Landing`, `WaitingWork` and `Decided` types. `setHowMuch` went with the band because the band's
gate control was its only control; its reader was `decideOnWork` and the capture pipeline, both
of which are in this row.

**Private files deleted.** `src/components/SeeFirst.tsx` and `.css`, `src/components/Landing.tsx`
and `.css`, `src/projects/heldback.ts`, `src/design/gate.ts`, and `heldBack` plus `howMuch` out
of `src/projects/preferences.ts`.

**Shared functions kept, and why.** `HeldWork` and `folderForHeld` stay for as long as the
retained paths call them. `src/share/holding.ts` stays for `saysHeldWork`.
`src/components/Clipped.tsx`'s `howMuch(text)` is an unrelated text clipper and is untouched.
Nothing is auto-accepted: with `decideOnWork` gone there is no path that lets held work in
without a person.

**Data route.** Existing held copies are worktrees under `<profile>/copies/<key>/<id>`; their
pictures were window state and are gone with the band. `copies.md` names every copy and says
whether it holds uncommitted work, which is what turns a held copy into a review entry by hand:
the review queue (`graphe:review-*`) is the retained route for taking a copy in.

## Hands-on detail: what phase 3/4 asked for first

Two data-loss defects in `electron/main.ts` were fixed ahead of the rows, both with tests in
`tests/close-keeps-worktree.test.ts`:

- `closeConversation` no longer calls `putAwayCheckoutAt`. Closing is closing a view; the copy
  stays on disk with whatever is uncommitted in it, and putting a copy away is its own press.
- `deleteConversation` no longer calls the forced `git worktree remove`. It stops the live
  session, forgets only the in-memory checkout row, and leaves the folder, the branch, the
  worktree registration and the on-disk registry row alone, so nothing that chat wrote is lost
  when the chat goes.

That test file also asserts the shell as a whole contains no call to `releaseWorktree`, so no
path in the window can force a worktree away again.

## Row 9: the IME guard

Composition never submits on Enter. `Composer.tsx`'s key handler returns early while
`nativeEvent.isComposing`, so an Enter that ends a Korean or Chinese composition belongs to the
composition; the annotation note field in `Annotate.tsx` and the page-side note box in
`src/preview/point.ts` do the same. Everything else 8.4 asks for is already in place
(Shift+Enter, paste handling, selection through streaming, autoscroll opt-out).

## Copy and gallery

`src/gallery/Gallery.tsx` no longer imports, fixtures or renders anything removed, and its
`Overview` and `Tabs` usages match the surviving props (no `kind`, no `elsewhere`, no landing
fields). `FEATURES.md` lost the "hand it on" claim in item 26; `README.md` lost the schedule
claim in its hero alt text; `site/index.html` lost the walkthrough-recorder cell, the hands-on
"take a stack in order" cell, the schedule point in its away section and the schedule claims in
three image descriptions, with the two "show more" counts adjusted to match; and
`site/scripts/shots.mjs` no longer names a gallery section that is gone.

`CLAUDE.md` was left alone: it already states the new product contract and names no removed
control, so rewriting it would be churn. It is also gitignored.
