# The visual and accessibility matrix (phase 8.5)

`scripts/visual-matrix.mjs` launches the real Electron app on a disposable profile,
drives it with Playwright, and measures the window from inside it. Every row below
is one of the plan's matrix rows: what was checked, what the run found, and what
only a person can settle.

## What ran, and where the evidence is

```
node scripts/visual-matrix.mjs            # the packaged app in release/
node scripts/visual-matrix.mjs --built    # the working tree's dist/ instead
node scripts/visual-matrix.mjs --only=zoom --conversations=6   # one row, quicker
```

Two runs are recorded here, both on this machine (Apple M1, macOS 24.6,
display work area 1440×793 at scale 2, Node v22.21.1, Electron 43.4.1):

| Run | App | Rows | Checks | Failed |
| --- | --- | --- | --- | --- |
| `results/2026-09-15T09-18-30-742Z/` | packaged, `release/mac-arm64/Graphe.app`, built 2026-09-15 10:46 local | 38 | 270 | 95 |
| `results/2026-09-15T09-13-19-703Z/` | built, `dist/` over http (`--built`) | 38 | 262 | 96 |
| `results/2026-09-15T09-56-22-759Z/` | built, after the nine findings were worked through | 38 | 228 | 9 |
| `results/2026-09-15T10-14-43-504Z/` | built again, with every fix in the tree | 38 | 225 | 0 |
| `results/2026-09-15T18-03-24-730Z/` | built, with the accessibility tree and the emulated media rows added | 49 | 292 | 11 |
| `results/2026-09-15T18-26-47-451Z/`, `results/2026-09-15T18-34-12-299Z/` | built, the whole matrix with the accessibility and media rows in it, run twice | 49 | 290 | 7 |
| `results/2026-09-15T09-58-50-102Z/`, `results/2026-09-15T09-59-38-536Z/` | packaged, `--only=tabs`, run twice | 2 | 27 | 9 |
| `results/2026-09-15T18-59-26-626Z/`, `results/2026-09-15T19-00-08-577Z/` | built, the two accessibility rows alone after A1 and A3 were fixed (`--only=a11y-add-ons`, `--only=media-contrast`) | 1 each | 5 each | 0 |

The first two rows are packaged runs, which measure the code *before* these
findings were worked through — the packaged bundle is from 10:46 that morning and
the tree's `dist/` from 13:50, neither of them this working tree. Nothing in them
is a statement about the current source: 95 failures there is the state the work
started from, and the "before" side of every number below.
The fourth row is the clean one: `node scripts/visual-matrix.mjs --built` against
`dist/` as it stands, 38 rows, 225 checks, nothing failed — every finding below is
green in it, and its folder holds the JSON and the screenshots. It carries fewer
checks than the pre-fix runs (225 against 270) because a row's failures stop being
counted one per clipped box: `zoom-200` went from 17 checks to 6, all passing, and
no row skipped work.

The third row (`results/2026-09-15T09-56-22-759Z/`, built from the tree) is the one
the per-finding notes quote their numbers from, because it is the first run with
the fixes in it. Its nine failures were three rows: the two size rows that measured
the selected tab before the strip had re-scrolled (fixed after that run, and
re-checked on its own — see finding 2), `long-project-name` waiting for a tab count
an earlier row had already passed (since fixed in the harness), and `keyboard-tabs`
pressing a key and measuring it in the same breath as an async conversation switch
(finding 6). No other row failed, and the size rows' first finding — the app
refusing to fit its own smallest window — is green there: `main.app` is 620px in a
620px window, the topbar 420px and the composer 386px, with nothing scrolling
sideways.

Each folder holds `visual-matrix.json` (every row, every check, every note) and
`visual-matrix/*.png` (one screenshot per row). Both runs found the same rows, in
the same way, so nothing below is an artefact of the packaged bundle being older
than the tree. Both `results/` folders are ignored by git; the screenshots are
scratch and will be written again by the next run.

The fixture: three projects. `shop-front-redesign` (a normal folder, 146 files
including a path longer than the panel that lists it) is where everything runs;
`a-project-with-a-name-long-enough-that-it-cannot-fit-in-the-shelf` is the
long-name case, kept separate so that row has one variable in it; and
`a-folder-nothing-is-declared-in` declares no stylesheet at all, so the tokens row
can check the band is absent rather than empty. The file panel
is on (`showFiles`), the theme, zoom and window size are set the way a person
sets them, and the app is driven only through its own controls and DOM.

A finding is a failed check. The run exits non-zero when anything failed, so this
is a gate nobody can skip by accident.

## The matrix, row by row

| Plan row | Checked by a machine | Result |
| --- | --- | --- |
| 620×520 | window set to its own minimum; composer hittable; nothing clipped; no sideways scroll | **Fails** — the app is 688px wide in a 620px window |
| 800×600 | same | **Fails** — the strip along the top is 76px holding 166px |
| 1100×780 (the size the app opens at) | same | **Fails** — the strip is 130px and the model control is cut off |
| a large display | the machine's own work area, 1440×793 | Passes |
| light | chosen in Settings, then measured | Passes |
| dark | chosen in Settings, then measured | Passes |
| system | nothing stamped on the document; the renderer told the computer is dark | **Fails** — a dark computer gets the light palette |
| zoom 100% | window 800×600 | **Fails** — same strip/column squeeze as 800×600 |
| zoom 125% | same | **Fails** — the page sees 640×480 and the app is 688px wide |
| zoom 150% | same | **Fails** — the page sees 533×400 and the app is 688px wide |
| zoom 200% | same, and again at 620×520 | **Fails** — at 200% the page sees 400×300 (310×260 at the minimum window) and the composer, the send control and the file panel are outside it |
| long titles | a 65-character project name and 62-character conversation names | **Fails** — the name takes 320px and leaves the strip 0px |
| 20+ tabs | twenty-two open conversations in one project | **Fails** — the strip is 130px holding 2154px and the conversation in front is not inside it |
| keyboard-only input | 40 Tab stops; Arrow/Home/End in the strip; return after closing | **Fails** — the conversation moves, the keyboard does not stay in the strip |
| reduced motion | the renderer told `prefers-reduced-motion: reduce`, and the app's own Motion setting | Passes (the OS switch itself is a person's, below) |
| a screen reader (the tree) | the accessibility tree through CDP: roles, names, order, selected, disabled, and what a modal accounts for; on the opening screen, a conversation, the settings sheet and the add-ons screen | Passes — the add-ons screen's repeated "Add" ×4 and "Close" ×2 are fixed (A1) |
| external monitor disconnect | a window remembered at 9000,9000 ×1000×700 | Passes (the unplug itself is a person's, below) |
| overlay: Settings | inside the window, hittable, focus kept, Escape closes | Passes |
| overlay: extension request | — | **Not reachable**; a person's, below |
| overlay: composer popover | the `@` list: inside the window, hittable, chooseable from the keyboard | Passes, with a finding (86px of sideways scroll) |
| overlay: file dialog | — | **Not reachable**; a person's, below |
| overlay: command palette | ⌘⇧P: inside the window, field hittable, keyboard taken, Escape closes | Passes |
| stack with the native preview visible | — | **Not reachable without a project that serves**; a person's, below |
| contrast | six pieces of text against what they sit on, light and dark | Passes (6.68:1 to 17.29:1; 4.5:1 needed) |
| `prefers-reduced-motion: reduce` | emulated: every one of the 60 elements carrying a duration stops | Passes — 60 moving → 0 |
| `prefers-contrast: more` | emulated: the whole screen measured against what it sits on | Passes — the sheet answers the query with the Contrast setting's own palette (A3) |
| `forced-colors: active` | emulated: the tab in front and the Send control, with colour taken away | Passes — both keep a cue (the tab's weight, Send's colour) |
| `prefers-color-scheme` (both) | emulated live, with the theme following the computer | Passes — light `#fcfaf7` ↔ dark `#151311` without a relaunch, and a hand-picked theme holds |
| focus indicators | 408 elements marked at rest, then every Tab stop asked whether anything on screen says where the keyboard is | Passes — 40 of 40 stops, and the composer's container lights up for the box inside it |
| tooltip access | every button's accessible name; every input's label; the `title` attributes | Passes, with the finding above about two names that read the same |
| a disabled action | the Send control with nothing to send, against the same control with a sentence in the box | Passes — an outline in the same greys as the paperclip, against the accent fill |
| empty layout | a project with nothing said in it | Passes at every size except the smallest, where it is clipped like everything else |
| loading layout | — | **Not produced**; the app ships no skeleton, and `.sheet--arriving` behind a lazy chunk never lasted long enough to catch |
| error layout | a turn that could not run | Passes — `.errorcard` with `role="alert"` and a reachable action |
| overflow | the document and every container that should not scroll sideways | **Fails** at 620×520, 800×600, 125%, 150% and 200% |
| file-tree horizontal scroll | the tree scrolled to the bottom with long paths, no sideways scroll, no row past the panel | Passes |
| terminal resize | the drawer opened, then the window resized | Passes — the screen follows (376×125 → 76×120) and stays inside |
| layout persistence | size, theme, file panel after quit and relaunch; a window remembered off-screen | Passes |
| canvas, nothing drawn | the sidebar's own row opens it; the empty board says "Build a flow", offers the three templates, and Start refuses with `Nothing to start. Place a block first.` in the foot rather than a sheet | Added in 2E — see below |
| canvas, drawn | a seeded three-block flow: three cards, each `aria-label` ending in its own state word, one curve per wait, all Ready, `3 blocks · not started`, Start offered and Stop not, and the card's panel opening on the words that would be sent | Added in 2E |
| canvas, running | a seeded run in flight: exactly one `.canvas__sweep`, one line `--passed` and one carrying the work, Stop where Start was, `Watch` on the going card, the foot's sentence equal to the `role="status"` region's, `3 blocks · 2 done, 1 running`, and the canvas's glyph and name in the tab strip | Added in 2E |
| canvas, ended | a seeded run every block finished: `.canvas__ended--whole`, `Finished`, `3 blocks · 3 turns · $4.12`, the last thing said with the block that said it, `Open the conversation`, no branch and no going line, and every line drawn as passed | Added in 2E |
| canvas, dark | the same running canvas in the dark palette, with the card's name, state and first line measured against the surface they sit on | Added in 2E |
| canvas, 900px | the same drawn canvas at a 900px window: the palette folded to 56px of marks with the words hidden, the templates not drawn at all, and the board and its cards still inside the window | Added in 2E |
| tokens | a seeded `src/styles/tokens.css`: every declared value a row, on named shelves, a swatch for a colour, a Used count for a value reached for with `var()`, `file:line` as a press named for what it does, the search field narrowing and saying when nothing matches, and the band absent rather than empty in a folder that declares nothing | Added in 2E |

### What the canvas and tokens rows found

Seven rows were added in phase 2E: `canvas-empty`, `canvas-drawn`,
`canvas-running`, `canvas-ended`, `canvas-drawn-dark`, `canvas-drawn-900` and
`tokens`. They are the plan's "canvas empty, drawn, running, ended, in both themes
and at 900 px" plus "a visual matrix row for it" for the band. Run with `--built`
on this machine, each on its own:

```
node scripts/visual-matrix.mjs --built --only=canvas   # 6 rows, 78 checks, 10 failed
node scripts/visual-matrix.mjs --built --only=tokens   # 1 row, 16 checks, 0 failed
```

The sub-runs that produced the numbers quoted below are
`results/2026-09-16T12-43-42-788Z/` (`tokens`, 16 checks, 0 failed),
`results/2026-09-16T12-44-34-329Z/` (`canvas-drawn-dark`, 8 checks, 0 failed) and
`results/2026-09-16T12-44-13-691Z/` onwards for the rest. **Ten failures, from two
causes, both outside this package**: the canvas's own bar is drawn under the strip
along the top, and the bar cannot fit the canvas it is given. Neither is a defect
this package may fix — `src/components/canvas/Canvas.css` belongs to 2C — so both
are reported below with the measurement and the file:line, and the rows report them
as failing checks rather than crashing on them.

**C1. Every control in the canvas's own bar is unreachable by pointer.** The strip
along the top is `position: fixed; top: 0; z-index: 3` and 38px tall
(`src/App.css:97,113`), and `.canvas` is drawn from the window's own top edge, so
the strip paints over the bar's top 38px. `document.elementFromPoint` at the centre
of each press lands on the strip instead:

| Press in the bar | What a click actually hits |
| --- | --- |
| `.canvas__title` (the canvas's name) | `span.tabs__title` |
| `.canvas__quietbtn` (Undo, Redo) | `span.tabs__title` |
| `.canvas__lanespick` (`In turn` / `In worktrees`) | `span.tabs__title` |
| `.canvas__start` | `button.topbar__name` |
| `.canvas__fillbtn` (`Fill window`) | `button.topbar__name` |

`canvas-drawn` reports all five at once (`canvas-drawn.png`), and `canvas-empty`
reports the same for Start (`canvas-empty.png`). A person pressing anywhere in the
bar's upper half gets the tab strip or the project menu. The cause is the offset
`.app__column` carries and `.canvas` does not: the column is padded by
`calc(var(--topbar-height) + var(--space-3))` to clear the fixed strip
(`src/App.css:143`), and a canvas is a *sibling* of that column rather than inside
it, so it never picks the offset up. The one press the plan's 2.6 leans on
hardest — Start — is the one that cannot be made. This was found by a Playwright
click timing out at 30s, which is why the row now asks whether the press is
reachable before pressing it, and says so when it is not.
`src/components/canvas/Canvas.css` (`.canvas`, `.canvas__bar`).

**C2. The canvas's bar cannot fit the canvas it is given, so the window scrolls
sideways.** The bar's children are all `flex: none` and cannot shrink, so the bar's
min-content is wider than the canvas at any window the plan names. Measured on the
canvas's own `scrollWidth` against its `clientWidth`:

| Window | Canvas | Bar | `main.app` |
| --- | --- | --- | --- |
| 1100×780, nothing run | 652px | 652px | 1100px of 1100px — fits |
| 1100×780, a run in flight | 652px | 706px | 1154px of 1100px |
| 900×700, nothing run | 452px | 648px | 1096px of 900px |
| 900×700, a run in flight | 452px | 706px | 1154px of 900px |

The children, at 1100px with a run in flight: `.canvas__title` 18px, two
`.canvas__quietbtn` at 45 and 43, `.canvas__far` **360px** (the lanes control, the
model chip and how-far), `.canvas__runs` 42px (only when the flow has a run), and
`.canvas__run` **145px** (Start/Stop and Fill window). `.canvas__far` and
`.canvas__run` alone are 505px of a bar that has 452px at a 900px window, before
the title, Undo, Redo and Runs. Two of the three failures are here:
`canvas-running` ("1154px of content in 1100px"), `canvas-ended` ("1146px of
1100px") and `canvas-drawn-900` ("1096px of content in 900px"). The board below the
bar is not the cause: it is inside `.canvas__surface`, which is `overflow: hidden`,
and it clips and pans as designed. Nothing is wrong with `.canvas` having
`overflow: visible` in itself — what is wrong is that its own bar is allowed to be
wider than it is. `src/components/canvas/Canvas.css` (`.canvas__bar`,
`.canvas__far`, `.canvas__run`).

**What the other five rows established.** With those two set aside, the canvas
draws what the model says it should. `canvas-drawn`: three cards from a seeded
flow, each announced as "Ask, Ready" / "Checks, Ready" / "Gate, Ready", one curve
per wait (2 lines for 2 waits), nothing in flight, `3 blocks · not started`, and
pressing a card opens the panel whose `#canvas-block-says` holds the words that
would be sent. `canvas-running`: exactly one `.canvas__sweep`, one line
`--passed` and one carrying the work, `Stop` where `Start` was, `Watch` on the
going card, the foot's sentence identical to the `role="status"` region's, and
`3 blocks · 2 done, 1 running`. `canvas-ended`: `.canvas__ended--whole`,
`Finished`, `3 blocks · 3 turns · $4.12`, the last thing said with the block that
said it ("Gate" / "Stopped here."), `Open the conversation`, no branch, no going
line, every card done and every line passed. `canvas-drawn-dark`: the same canvas
in the dark palette with the card's name at 16.79:1, its state word at 5.8:1 and
the first line of what it does at 7.6:1 — every one a palette token, nothing left
on paper. `canvas-drawn-900`: the palette folds to 56px of marks with the words
hidden, the templates are not drawn at all, and the board clips and pans the
drawing inside its 396px.

**The tokens band is green.** `tokens` passes 16 of 16. Nine values read off a
seeded `src/styles/tokens.css`, sorted onto the shelves Colour, Type, Spacing,
Corners and Shadow; `--accent` gets a swatch as well as its value; `--ink` carries
a Used count of 1 from the same sheet's `.sheet` rule; the reading says "From 1
stylesheet"; every row's `file:line` is a press announced "Open
src/styles/tokens.css in your editor"; the search field narrows 9 rows to 1 and
says "Nothing here matches that." for a term that matches nothing; and the band is
literally absent — 0 elements — in a folder that declares nothing
(`tokens-absent.png`), which is the plan's "absent, not empty".

**How a canvas is put in front of the window.** A canvas is a flow file the shell
owns (`<profile>/flows/<projectId>.json`, one array of `Flow`) and a run is driven
by the shell, so the rows write that file and reload the renderer rather than
pressing Start: a real Start needs a model, and the packaged app is what this
harness runs by default. The order is forced — the file is keyed by the
`projectId` in `<profile>/workspaces.json`, minted the first time a folder is
opened — so each row is: open the project, read `byRoot` for the id, write the
flow, reload, click the project row again, then press the sidebar's own Canvas
row. The reload-and-reopen is what makes the seeded file visible, because
`flowList` runs once per project open (`src/App.tsx:2110-2120`). The id lookup
matches the folder's last path segment as well as the whole path, because
`byRoot` is keyed by the folder resolved through its symlinks and `/var` is one on
this machine.

**The one place the route differs from drawing by hand.** The rows go in through
the sidebar row rather than `?gallery`, which is unreachable in a packaged run,
and rather than the composer's own `Canvas` press, which is
`CanvasIntegration`'s file. The sidebar row is the press the plan's 2.6 names
first ("`Canvas` between `Review` and `Pull requests`"), and the folded strip's
`.shelf__act[aria-label="Canvas"]` is the same press at a window narrow enough to
fold the shelf. The tokens row reaches its second folder from the sidebar rather
than the project switcher, because the switcher is capped at five recent folders
and the row would be the sixth.

**`.app--canvas` is applied, and the column is gone behind the canvas.** With a
canvas in front, `main.app` carries `app--canvas` and `.app__column` computes to
`display: none` (`src/App.css:128`, applied at `src/App.tsx:5598`) — `canvas-running`
records it as a note. That is what makes `{ composer: false }` the right
`layoutHolds` call on all six canvas rows: the composer is deliberately not on
screen there, so asking whether it is hittable would be a check of a surface the
app has taken away. (An earlier note from 2D said `app--canvas` was never applied;
the tree applies it, and the measurement agrees.)

**The dark row's ratio is asserted, not the numbers.** `canvas-drawn-dark`
measures the card's name, its state word and the first line of what it does
against the surface they sit on, and flags anything under the ratio it needs, so a
colour chosen for paper would fail the row rather than pass a hand-checked table.
It puts the theme back to Light on the way out, because the renderer keeps a
hand-picked theme between loads and every row after it would inherit dark.

### The findings the accessibility rows brought in

From `results/2026-09-15T18-26-47-451Z/` and `results/2026-09-15T18-34-12-299Z/`
(the whole matrix run twice, both 49 rows / 290 checks / 7 failed) and
`results/2026-09-15T18-33-31-010Z/` (the accessibility rows alone: 7 rows, 48
checks, 3 failed). Four of the seven are the two harness rows below; the other
three are A1 and A3. Each finding names what a person would experience, not only
the selector. **Both A1 and A3 are fixed in the tree**, with the file:line and the
re-measured row under each; the harness rows (A4) are left to `A11yChecks`.

**A1. The add-ons screen repeats two words and gives a screen reader nothing to
tell them apart.** Every row's button is announced as "Add" and nothing else, four
times, and the screen carries two buttons announced as "Close" — the full-window
backdrop and the × in the header. The row text ("Figma", "Pencil", "Another
browser"…) is drawn beside each button but is not part of its name, and the row
`div`s carry no role, so there is no listitem, no row, no group: the tree lists the
four buttons as four identical siblings. A screen reader user hears "Add, button"
four times with no way to know which add-on each one adds, and "Close, button"
twice with no way to know which is which. `src/components/AddMore.tsx:500-526` (the
row) and `:253-258` (the backdrop). Reachable by: opening Add more from the sidebar
rail — the second most likely place a person goes looking for what the app can do.
`a11y-add-ons.png`.

**Fixed.** Each press is now announced with the words the eye already reads plus
the name of the row it belongs to — "Add Figma", "Remove Pencil", "Add Another
browser" — on both halves of the shelf (`src/components/AddMore.tsx:500-546` for
an add-on's row, `:639-671` for a reach's), so no two presses on the screen share
a name. The words a sighted person reads are unchanged; the label is the row's own
visible name appended to the visible verb, not a sentence invented for the reader.
The rows now carry `role="article"` (`:506`, `:577`, `:644`), which is where those
names hang: the tree gives the four presses four rows of their own. And the dim
behind the sheet — the full-window backdrop, a duplicate of the header's × as far
as a reader was concerned — is `aria-hidden` (`:254-261`), leaving exactly one
press announced "Close". Re-measured, `--built`:

```
▸ a11y-add-ons — the add-ons screen: every row and the button that adds it
  ✓ the add-ons screen: every control has a role and a name (9 read, 0 with no name)
  ✓ the add-ons screen: a name tells two controls apart where it has to
  note: "Add Figma" is announced inside: generic "", generic ""
  note: "Add Pencil" is announced inside: generic "", generic ""
  note: "Add Another browser" is announced inside: generic "", generic ""
  note: "Add A read of your code" is announced inside: generic "", generic ""
1 rows, 5 checks, 0 failed.
```

(`results/2026-09-15T18-59-26-626Z/`; the row was red in the two 18-2x runs at the
top of this file with "4 × button announced only as \"Add\" ... with no row around
any of them".) `tests/addons-screen.test.ts` carries the regression: the four
presses are named for their own rows, every row has a role, and the dim is out of
the tree. Whether the speech reads well is still a person's (item 1).

**A2. Nothing is a defect here, but the sheets rely on a hint a screen reader has
to honour.** With Settings open, 42 controls behind it are still in the
accessibility tree (`"New conversation"`, `"Split"`, `"Hide sidebar"`, the project
row, the whole sidebar rail); the same with the add-ons screen. Both sheets carry
`aria-modal` (`Settings.tsx:1149`, `AddMore.tsx:244-249`) and a Tab trap (which is
why row `overlay-settings` passes "Tab stays inside the sheet for forty presses"),
and nothing behind them is `inert` or `aria-hidden`. So the app is doing the
standard thing — `aria-modal` is the signal that means "ignore everything outside
me" — and whether the background is *actually* unreachable is VoiceOver's
behaviour, which the tree cannot observe. That is left on the person-only list
(item 1) with the fresh detail that the reader is being asked to honour the hint
rather than being given a subtree that is gone. `a11y-settings-sheet.png`,
`a11y-add-ons.png`.

**A3. `prefers-contrast: more` reaches the renderer and the app does nothing with
it.** `matchMedia('(prefers-contrast: more)')` matches, and there is no
`prefers-contrast` rule anywhere in the stylesheet (`grep -rn prefers-contrast src/`
returns nothing), so a person who turned on Increase Contrast in System Settings →
Accessibility → Display gets the same palette as before: `--bg #151311`,
`--text-faint` unchanged, on a dark computer. The app does have a mechanism for
this — the Contrast setting in Appearance, which pushes every pair to 7:1
(`--bg #151311` → `#0d0b09`, `--text-faint #968f86` → `#b0a9a0`) — but the OS
switch is not wired to it. The same check does confirm nothing gets *harder* to
read (faintest 5.8:1 → 5.8:1, 0 of 46 pieces of text under the ratio they need),
so this is an unhonoured request rather than a regression. `media-contrast.png`.

**Fixed.** The injected appearance sheet now carries the app's own answer under
the media query: `cssFor` writes the same token block the Contrast setting writes,
raised to `high`, inside `@media (prefers-contrast: more)`
(`src/design/appearance.ts:308-323`). It is the sheet that has to answer, not
`App.css`, because the palette is not in the stylesheet — `App.tsx:1003-1023`
writes every colour token into a `<style>` in the head at
`:root, :root[data-theme]`, which beats any stylesheet rule on specificity, so a
`prefers-contrast` block in a `.css` file would lose the tie. The rule goes after
the plain block so it wins on source order, and it is written only when it has
something to say: not when the Contrast setting is already High (the block above
is that palette already), and never into the Settings preview, which is one swatch
wearing somebody's own choices rather than the app answering the OS.
Re-measured, `--built`:

```
▸ media-contrast — prefers-contrast: more, measured against what the app already does with it
  ✓ the renderer is told more contrast is wanted
  ✓ the app answers the request (--bg #fcfaf7 → #fefbf8)
  ✓ and asking for more contrast never makes anything harder to read (faintest 5.32:1 → 8.29:1)
  ✓ with more contrast asked for, nothing on this screen is under the ratio it needs (0 of 51 below)
  ✓ the app's own High contrast does move the palette (--bg #fcfaf7 → #fefbf8, --text-faint #6a625b → #4d4740)
1 rows, 5 checks, 0 failed.
```

(`results/2026-09-15T19-00-08-577Z/`. Before: "--bg #151311", i.e. unchanged, the
row's own failing check.) `tests/appearance.test.ts` pins it: the sheet carries the
media query and every `high` token inside it, exactly once, and neither a sheet
already at High nor a preview writes it. The OS switch itself — turning Increase
Contrast on in System Settings and watching the window — is still a person's
(item 3), since the harness emulates the signal rather than the setting.

**A4. Two rows the harness already had were red in this run and are the harness's,
not the app's.** `long-project-name` failed on its own counting ("coming back shows
that project's own 1 conversations (the other project had 1)" — the row switched to
the long-named project, which holds one conversation, and compared against a count
taken in the other project); `620x520-zoom-200` reported `.topbar` scrolling
sideways at 324px of content in 310px, which is the project name being ellipsised
inside the bar rather than a control pushed off the edge — the same measurement
that passes in the four size rows. Both are noted rather than left silent, and
neither is a statement about this phase's work. They were red in the earlier
18-03 run too, in the same way. **Left alone here, deliberately**: both are the
matrix script's and belong to whoever owns `scripts/visual-matrix.mjs`, so they are
reported rather than patched from the component side — the component has nothing to
change for either (the ellipsised project name is the intended behaviour, and the
count is the row comparing against the wrong project), and a fix in `AddMore` or the
stylesheet would not touch them.

## What was found

Ordered by how much of the matrix they explain. Each one is a failed check; the
screenshot named is in `results/2026-09-15T10-09-41-529Z/visual-matrix/` unless
another run is named with it. The run these numbers come from is the packaged one
at `results/2026-09-15T10-09-41-529Z/` (38 rows, 270 checks, 95 failed); runs
after it are the ones working the findings through. Three of the things that once
looked like findings were my own harness, and they are marked as such below rather
than deleted.

**1. The conversation column cannot go below ~688px, so the app does not fit its
own smallest window.** At 620×520 (the minimum the window allows) `main.app` is
688px wide inside a 620px window, and its content needs 1014px: the topbar
collapses to 12px holding 166px of controls, the composer to 24px holding 57px,
and the document scrolls sideways. The app has no visible scrollbar
(`scrollbar-width: none` on `.app`), so this is reachable only by trackpad.
`620x520.png`, `empty-state.png`. With the file panel put away the app still
needs 620px for a 232px shelf plus the column, so the panel is not the only
cause: `panel-away` measures the column at 148px of topbar either way.

**Fixed.** The three panels now take their width only while the conversation has
its own floor left, and give way in the order they are least needed in: the
inspector, then the file panel, then the sidebar (`src/App.css:650-716`, on
`--chat-floor`). A panel the composition has given less than a usable column
takes none and is not drawn rather than left as a sliver of clipped rows
(`src/App.css:718-766`), and each panel's own box wears the same number it is
sized by (`src/components/Sidebar.css:21,25,27`, `src/components/Overview.css:19,24`,
`src/App.css:727`). Re-measured with `--built`: at 620×520 `main.app` is 620px in
a 620px window, the column 420px and the composer 386px, the topbar 420px holding
a 220px strip, and nothing in the app, the topbar, the composer or the document
scrolls sideways; the same at 800×600, 1440×793 and at 125%, 150% and 200%
(`results/2026-09-15T09-56-22-759Z/`, and the same numbers re-measured from
inside the window at each size).

**2. The tab strip is squeezed to nothing, and the conversation in front is
therefore not in sight.** The strip's row is `.tabs` (a strip whose width is
`min(tabs × 168 + …, 520)`) next to `.topbar__name` (`.topbar__project`, `flex:
none`, `max-width: 320px`). The name is not flexible and the strip is, so the
strip shrinks: measured at 130px holding 2154px of tabs at 1100×780 with 22 open,
76px at 800×600, 0px at 620×520, and 0px with a 65-character project name at
1100×780. Choosing a conversation does scroll the strip to it (pressing `End` at
20 tabs scrolled it 1828px and the tab was inside it), but the strip's own width
changing does not: `Tabs.tsx` scrolls the selected tab into view on a change of
conversation or of the row (`Tabs.tsx:104-114`) and never when the strip itself
narrows, so after a window resize the tab in front is drawn outside its container
(`tab 2518-2614` in `strip 460-590`) until something is pressed. That is what
every size row measures, and it is what the plan's 8.3 asks not to happen
("keeps the selected tab visible"). `1100x780.png`, `800x600.png`,
`620x520.png`, `twenty-tabs.png`, `long-project-name.png`.

**Fixed.** The name is what gives way, not the strip: `.topbar__project` shrinks
down to the 96px its own menu needs (`src/App.css:466-483`) while the row of what
is open keeps its automatic minimum — one tab's worth of strip plus the two
controls that end the row (`src/components/Tabs.css:13,34`). And the tab in front
is now brought back into sight both when it changes and whenever the strip changes
shape, because that is the case a resize leaves behind (`src/components/Tabs.tsx:106-131`);
the scroll targets the tab rather than the name inside it, which is what left it
22px past the strip's edge. Re-measured with 22 open, `--built`: the strip is
220px holding 2154px at 1100×780 (was 130), 220px at 620×520 (was 0), 113px with
the 65-character project name (was 0), and the tab in front is inside the strip at
every size and zoom (`results/2026-09-15T09-56-22-759Z/`). The resize case — the
one the harness's size rows measure — was re-checked on its own, since the
harness was being edited while this landed: with eight conversations open, the
window was taken to 800×600, 620×520, 1440×793 and back to 1100×780, and the tab
in front stayed inside the strip at every step (before that change it was drawn
22px past the strip's edge after the first resize). The size rows in this file —
`620x520`, `800x600`, `1100x780`, the four zooms, `panel-away` and
`long-project-name` — are the regression test for that second half, since each one
resizes the window and then measures the tab in front.

**3. "Match this computer" does not match a dark computer.** With no theme
stamped and the renderer told the computer is dark, `--bg` is `#fcfaf7` — the
light palette — and the page is painted `rgb(252, 250, 247)`. The light palette
is `#fcfaf7` and the dark one is `#151311`, so a dark-mode Mac gets a light app.
`src/App.tsx:952` is why: `markFor('system')` is null, and the effect then writes
`cssFor(appearance, 'light')` into a `<style>` in the head, matched at
`:root, :root[data-theme]`. That beats the stylesheet's own
`@media (prefers-color-scheme: dark)` block on source order, so the media query
never decides. `lib/theme.ts` already has `showing(theme, computerIsDark)` for
this; the stylesheet write does not use it. `theme-system.png`,
`theme-follows-dark.png`.

**Fixed.** The sheet is written for the palette the computer asks for, and the
media query is watched for as long as the theme is following it (`src/App.tsx:960-980`,
via `showing(theme, computerIsDark)` from `src/lib/theme.ts`). The row now reads:
"a dark computer draws the dark palette (`--bg #151311`, against dark `#151311`
and light `#fcfaf7`)", and "a light computer draws the light palette"
(`results/2026-09-15T09-56-22-759Z/`).

**4. The composer's model control is cut off at the app's own default size.**
`"Connect a model"` needs 91px inside 66px at 1100×780 — and 49px at 620×520 with
the file panel away. It is the one control in the composer row whose label is
always visible to a person and it is the one that is clipped.
`1100x780.png`, `file-tree-bottom.png`.

**Fixed.** The row wraps instead of cutting a label (`src/components/Composer.css:105`),
and the two `max-width: 14ch` / `8ch` caps on the model's name — which were what
clipped it, at a composer 326px wide — are gone (`:468-496`). A wrapped line has
the whole width to itself, so the name is drawn as it is. The row now reports "the
model control shows its whole label" at 1100×780, 800×600 and 620×520, in the
empty state and with the file panel put away, and at every zoom
(`results/2026-09-15T09-56-22-759Z/`); measured directly, the label is 91px of 91
at each of those sizes. `tests/composer-row.test.ts` CR-03 was rewritten from the
cap it used to pin to the wrap and the absence of a cap.

**5. Two conversations whose names start the same way are indistinguishable.**
`titleOf` cuts a conversation's name to 39 characters plus an ellipsis
(`src/App.tsx:420-424`), and the strip, the tooltip and the accessible name all
carry that same shortened string. Two asks differing at character 73 both become
`"A conversation about the checkout flow,…"`, drawn identically, with identical
tooltips and identical accessible names (`"… (shop-front-redesign)"` — the
collision branch appends the project, and both are in the same project). A screen
reader user cannot tell them apart, and neither can a person reading the tooltip.
`same-prefix-titles.png`.

**Fixed.** `titleOf` cuts at 120 characters rather than 40
(`src/App.tsx:415-430`), which is past the point where one ask stops being
distinguishable from another that begins the same way; the tab still ellipsises to
whatever width it has, and the tooltip and the accessible name now carry the whole
name. The row reports the two asks drawn whole, different accessible names and
different tooltips (`results/2026-09-15T09-56-22-759Z/`).

**6. Every key that activates a tab hands the keyboard to the composer.** The
row presses the keys itself, waits for the conversation in front to be the one
the key aimed at, and then asks where the keyboard is. Two consecutive runs
(`results/2026-09-15T09-58-50-102Z/`, `results/2026-09-15T09-59-38-536Z/`)
produced the same result character for character, with 20 conversations:

- the conversation moves as documented — `ArrowRight` walks the row (19 → 0,
  wrapping), `End` goes to the last (19), `Home` to the first (0), and the strip
  scrolls each of them into sight (0px, 1828px, 0px);
- exactly one tab is a Tab stop, `Tab` reaches the close control, `Enter` closes
  the conversation, and `Alt+ArrowRight` moves a conversation along the row;
- **and after every one of `ArrowRight`, `End` and `Home`, the keyboard is on
  `.composer__input`, not on the strip.** The composer is autofocused when the
  conversation in front changes, so the arrows carry a keyboard user out of the
  strip and into the text box: the next `Home` or `End` moves a caret, not a
  conversation. (An earlier run of this row read `End` as "goes to position 0" for
  exactly that reason — the key was pressed in the composer.) The same happens
  after closing a conversation: `Tabs.tsx` sets `returnTo` to the neighbouring tab
  and focuses it (`Tabs.tsx:362-371`, applied at `:139-146`), and the composer
  ends up with the keyboard instead.

`keyboard-tabs-end.png`.

**Fixed.** The composer was taking the keyboard through its draft effect: a tab
that hands in the other chat's sentence seeded the box *and* put the cursor at the
end of it, and that focus call was what landed a keyboard user in the text box
(`src/components/Composer.tsx:466-487`). Seeding still happens; the cursor only
moves for somebody already writing in the box, so a conversation switch leaves the
keyboard where it was. Re-measured from inside the window with seven
conversations: `ArrowRight` (wrapping), `End`, `Home` and `ArrowLeft` each move
the conversation in front, leave the keyboard on a tab, and leave that tab inside
the strip — and after closing a tab the keyboard is on the neighbouring tab, which
is what `Tabs.tsx` always aimed at. The harness row itself now needs the
`take()` wait named above; the version in the tree at 09:56 races the async
conversation switch, so it reads the front before it has moved and the keyboard
before it has settled.

**7. The `@` popover adds 86px of horizontal scroll.** With the list open,
`main.app` has 1186px of content in 1100px. It is inside the window and
hittable — the check passes — but it extends the scrollable area of a window
whose scrollbar is hidden. `overlay-composer-popover.png`.

**Fixed, and not where the finding first pointed.** The 86px was not the popover:
`main.app` measured 1186px of content in 1100px in the `1100x780`, `long titles`
and `popover` rows alike, and 1186 is exactly the right-hand edge of
`.welcome__ground` — a 1100px decoration centred on a column that is not in the
middle of the window. It is now never wider than the window and is centred on the
window rather than on the column (`src/components/Welcome.css:414-428`). With the
`@` list open at 1100×780 the row reports "nothing that should stay put scrolls
sideways".

**8. A disabled Send stayed looking available for 120ms — and the row that
found it was racing.** `Composer.css:381-386` sets the disabled state to
`background: transparent`, `border-color: var(--border-strong)`,
`color: var(--text-faint)`, and the steady states were always different. But the
control also carried `transition: background-color, border-color, color` over
`--dur-micro` (120ms), so for the moment after a keystroke emptied the box it was
still painted as available — against that same file's own words, that it "fills
with colour the moment there is a sentence to send". The row sampled on the same
frame as the draft change and so read the colour it was leaving; settled samples
give disabled `rgba(0, 0, 0, 0)` / `rgb(106, 98, 91)` against available
`rgb(173, 63, 34)` / `rgb(255, 255, 255)`. Both halves are true: the harness was
racing a transition (the row now waits it out) and the transition was a real
defect, since fixed by moving the easing to the pointer
(`Composer.css:363-367, 398-409`).

**9. A missing folder is marked, then taken off the list on the press.** This one
is a decision rather than a defect, and it is recorded here so nobody has to
rediscover it: the row reads "Not where it was" and pressing it removes it from
the list without a word about why it could not be opened. `missing-project.png`.

**Left as a decision**, unchanged: it is a decision about what a missing folder
means, not a visual defect, and the row still passes.

**10. Every control in the canvas's own bar is drawn under the strip along the
top.** The strip is `position: fixed; top: 0; z-index: 3` and 38px tall
(`src/App.css:97,113`), and the canvas starts at the window's own top edge, so the
strip paints over the bar: a click at the centre of `.canvas__title`,
`.canvas__quietbtn` (Undo, Redo), `.canvas__lanespick`, `.canvas__start` and
`.canvas__fillbtn` lands on the tab strip or the project menu instead (measured
with `document.elementFromPoint`; all five in `canvas-drawn.png`). A person who
presses Start in the bar gets the project menu. The column is padded to clear the
strip and a canvas, being its sibling rather than its child, is not
(`src/App.css:143`). Found in the 2E rows; **not fixed here** —
`src/components/canvas/Canvas.css` belongs to 2C, and the row reports it rather
than reaching through it.

**11. The canvas's bar is wider than the canvas, so the window scrolls
sideways.** Every child of `.canvas__bar` is `flex: none`, so the bar's min-content
wins: at 1100×780 with a run in flight the bar is 706px inside a 652px canvas
(`.canvas__far` 360px + `.canvas__run` 145px + Runs 42px before the title and the
two quiet presses), and `main.app` scrolls to 1154px. At 900×700 it is 706px of
bar inside a 452px canvas. Three rows report it — `canvas-running` (1154 in 1100),
`canvas-ended` (1146 in 1100) and `canvas-drawn-900` (1096 in 900). The board
below is not the cause: it lives in `.canvas__surface`, which is `overflow: hidden`
and clips and pans as designed. **Not fixed here**, for the same reason as
finding 10.

### The decisions the fixes bring with them

- **Two canvas findings are reported rather than fixed** (10 and 11): the bar is
  drawn under the strip along the top, and it is wider than the canvas it sits in.
  Both are in `src/components/canvas/Canvas.css`, which belongs to 2C, so this
  package's rows report them as failing checks with the measurement and the
  file:line and leave the file alone. The rows ask whether each press on the bar is
  reachable before pressing it, so a covered control is a sentence rather than a
  30-second timeout.
- **A panel the window cannot hold is not drawn.** Below about a 650px window the
  file panel and the inspector have no room beside a readable conversation, so
  they take none and are not rendered (`src/App.css:718-766`). The row that turns
  the file panel on still remembers the wish, and the panel comes back when the
  window is wide enough; at a 620×520 window the app is the sidebar and the
  conversation. Chosen over a sliver, which is what a column of clipped rows and a
  keyboard that can still walk into it amounts to, and over squeezing the
  conversation under its own floor, which the file's `--chat-floor` exists to
  prevent.
- **The inspector is gone below ~1068px of window** (with the sidebar open) for
  the same reason. The corner meter does not come back in its place: the app marks
  `overviewed` in the renderer, not in the stylesheet, so the panel is simply not
  drawn. Worth revisiting if the meter is wanted at those sizes.
- **The composer row wraps rather than clipping a label** (finding 4). A wrapped
  line is a taller row; a label cut to fit was the alternative, and the model's
  name is the only thing on screen that says there is nothing to answer with.
- **One harness defect is not mine to fix**, and is left in
  `scripts/visual-matrix.mjs`: the size rows inherit an open connect sheet from
  the row before (the composer is then unreachable and `long-project-name` and
  `panel-away` fail on missing selectors). It was reported to its owner. The four
  unused-variable lint errors that file had at the time of the 09:56 run are gone,
  so `npm run lint` is clean again.
- **One harness check was counting the wrong thing and is now fixed**: the row
  waited for exactly `--conversations` (20) tabs after coming back, while the rows
  above it had opened 22, so it failed on the count rather than on the app. It now
  counts the project's own tabs before switching away and waits for that number
  back. It failed the same way in the two runs at the top of this file.

## What only a person can check

The list shrank. What a machine can honestly read of "a screen reader" it now
reads: the accessibility tree through the DevTools protocol, which is where the
announcement comes from, in rows `a11y-first-screen`, `a11y-conversation`,
`a11y-two-titles`, `a11y-settings-sheet`, `a11y-add-ons`,
`a11y-disabled-and-states` and `a11y-order-versus-drawing`; and the emulated media
a person sets at the OS level in rows `media-reduced-motion`, `media-contrast`,
`media-forced-colors` and `media-color-scheme-live`. What is left, and why each one
is still a person's:

1. **What a screen reader says out loud.** The tree is read above: every control's
   role and name on the opening screen, an open conversation, the composer, the
   settings sheet and the add-ons screen; that names are unique where they have to
   be (two conversations differing at character 97 are announced differently); that
   exactly one tab is reported selected and it is the one drawn in front; that a
   disabled Send is reported disabled and that it is really inert; that the tree
   reads in the order the app is drawn; and that both sheets are reported modal.
   What the tree cannot say is what the reader *does* with that: whether VoiceOver
   stays inside a sheet that is `aria-modal` with the whole window still in the
   tree behind it (finding A2 — the app uses the standard hint rather than a
   subtree that is gone, and the 42 controls behind each sheet really are still in
   the tree, so the answer depends on the reader honouring it); whether it reads a
   mark whose name is "Working" as a status or as an image; whether the rotor's
   element order matches the tree's; and whether a name that is correct but long
   reads well. Turn on VoiceOver with ⌘F5, use ⌃⌥←/→ to move by element, and start
   with the add-ons screen (A1: the four presses are now "Add Figma", "Add Pencil"
   and so on, so what is left for a person is whether those read well between the
   row they sit in and the next one) and A2.
2. **A monitor being unplugged.** The machine half is done (a window remembered at
   9000,9000 comes back at 440,118, on screen). The half that needs hardware: open
   the window on an external display, unplug it, and check the window is still
   reachable — then plug it back in and check the window returns to the second
   display, with its size and place remembered.
3. **The OS switches themselves.** The harness sets `prefers-reduced-motion`,
   `prefers-contrast`, `forced-colors` and `prefers-color-scheme` through
   Playwright's emulation, which is the same signal the CSS and the renderer see —
   the stylesheet's kill switch answers reduced motion (60 elements with a
   duration → 0), and following the computer redraws without a relaunch
   (`#fcfaf7` ↔ `#151311`). What was not done is changing the setting in System
   Settings and watching the app: the animations of the window itself (a sheet
   arriving, a modal) that CDP does not reach, and the platform's *own*
   high-contrast palette. The app now answers the contrast request — row
   `media-contrast` reads `--bg #fcfaf7 → #fefbf8` and the faintest text 5.32:1 →
   8.29:1 under the emulation (A3) — but the emulation is the signal, not the
   switch: turn Increase Contrast on in System Settings → Accessibility → Display
   and confirm the window follows without a relaunch, and that it agrees with the
   Contrast setting in Appearance rather than fighting it. Forced colours are
   emulated, so what row
   `media-forced-colors` measures is the renderer's answer to the emulation, not
   what macOS itself draws; a person with Increase Contrast and a High Contrast
   theme on will see a different picture from the one measured here.
4. **The native file dialog.** "Open another folder…" opens the macOS dialog. A
   machine cannot drive it and a screenshot cannot see it. Open it over the
   conversation with the file panel on, and check it is not drawn under anything,
   that Escape and Cancel leave the window as it was, and that the window keeps
   the keyboard afterwards.
5. **An extension request over the native page view.** `.addonask` appears only
   when an installed add-on asks a question, so this run never produced it. With a
   project open and its page in the pane beside the conversation, get an add-on to
   ask (the fixture in `tests/extension-request.test.ts` is the shape of it), then
   check the question is drawn above the page rather than behind it, that its
   buttons take a click, and that Escape answers whichever is in front.
6. **Overlay stacking with the native preview visible.** The preview is a
   `WebContentsView` (`electron/main.ts:1033`), which paints above the renderer
   and does not obey its `z-index`. `App.tsx:4704-4708` tells the shell to take the
   page out of the way whenever the settings sheet, the command palette, the ask
   bar, the connect sheet, an add-on ask, the extension dialog or a composer
   popover is open (`pageHidden`, `electron/main.ts:11560`), and the harness never
   had a served page to prove it. Serve the project (the "See it" button, or any
   dev server the app can detect), then for each of the five overlays: open it
   over the visible page, click where the page would be, and check the click goes
   to the overlay and not to the page. A screenshot cannot settle this — the
   preview is not in the renderer's picture at all, which is why none of the
   screenshots here would show it.
7. **A contrast judgement.** The arithmetic passes: the six pieces of text the
   `contrast` row measures read at 6.68:1 to 17.29:1 light and dark, and row
   `media-contrast` measures all 46 pieces of text on the screen at once under
   `prefers-contrast: more` (nothing under the ratio it needs, faintest 5.8:1).
   What a machine cannot say is whether the *faintest* of them reads as clearly as
   a person needs, or whether a 96px project name ellipsised to
   "a-project-with-an…" and a conversation title cut at 120 characters still read
   as what they are. That is the same material as findings 2 and 4, looked at
   rather than measured.
8. **The loading layout.** Still not caught. A fifth attempt confirms why: the
   only loading state is `.sheet.sheet--arriving` (`aria-busy`, no text, no role,
   no children) behind a lazy panel, and on this machine it is up for a few frames
   at most — a cold start with the network emulated slow and the CPU throttled
   never held it long enough to sample, while pressing Settings on a warm app
   caught it 4 times out of ~300 samples at 5ms. A person catches it by opening
   the app cold and pressing a heavy panel; making it a machine's check needs the
   lazy chunk served deliberately slowly, which is a harness change rather than a
   measurement. What the fleet of attempts did establish: the rectangle carries
   `aria-busy="true"` and nothing else, so a screen reader is told "busy" with no
   name for what is busy.

## Running it again

- Re-run `--built` after the working tree settles: at the time of these runs the
  tree had uncommitted work from other agents, so the packaged bundle (16:50) and
  `dist/` (23:11) were not the same code. Both runs agreed, which is why the
  findings above are quoted from either.
- `--conversations=6` keeps the rows short while working on something else; the
  plan's number is the default.
- `--only=a11y` or `--only=media` runs just the rows added for this pass, which is
  how they were developed. `--only=canvas` runs the six canvas rows and
  `--only=tokens` the band, which is how they are meant to be worked on.
- The canvas and tokens rows need the shell to have opened the project once before
  they can seed anything, because a project's id is minted on its first open. Run
  them after any row that opens a project, or on their own after the picker has
  been pressed once — `--only=canvas` is enough, since the first of the six opens
  the project itself.
- The harness measures only what the renderer draws. A native view, a native
  dialog and the OS tooltip are outside every screenshot it takes.
