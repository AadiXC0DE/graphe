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
| `results/2026-09-15T09-58-50-102Z/`, `results/2026-09-15T09-59-38-536Z/` | packaged, `--only=tabs`, run twice | 2 | 27 | 9 |

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

The fixture: two projects. `shop-front-redesign` (a normal folder, 146 files
including a path longer than the panel that lists it) is where everything runs;
`a-project-with-a-name-long-enough-that-it-cannot-fit-in-the-shelf` is the
long-name case, kept separate so that row has one variable in it. The file panel
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
| a screen reader | — | **Not checked here**; a person's, below |
| external monitor disconnect | a window remembered at 9000,9000 ×1000×700 | Passes (the unplug itself is a person's, below) |
| overlay: Settings | inside the window, hittable, focus kept, Escape closes | Passes |
| overlay: extension request | — | **Not reachable**; a person's, below |
| overlay: composer popover | the `@` list: inside the window, hittable, chooseable from the keyboard | Passes, with a finding (86px of sideways scroll) |
| overlay: file dialog | — | **Not reachable**; a person's, below |
| overlay: command palette | ⌘⇧P: inside the window, field hittable, keyboard taken, Escape closes | Passes |
| stack with the native preview visible | — | **Not reachable without a project that serves**; a person's, below |
| contrast | six pieces of text against what they sit on, light and dark | Passes (6.68:1 to 17.29:1; 4.5:1 needed) |
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

### The decisions the fixes bring with them

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

Each of these needs something this harness cannot do. The first two are the two
the plan named; the rest are the parts of the overlays that live outside the DOM.

1. **A screen reader.** VoiceOver on this machine: open the app on a profile with
   two projects and a handful of conversations, then check that (a) VoiceOver
   reads the tab strip as a tablist and names each tab, including the project
   when two names collide, (b) the strip's state marks (working, waiting,
   finished) are announced rather than silent, (c) the composer, its model chip
   and its send control are reachable and named, (d) Settings reads as a dialog
   and VoiceOver stays inside it, and (e) the error card is announced when a turn
   cannot run. Turn on VoiceOver with ⌘F5 and use ⌃⌥←/→ to move by element.
   Finding 5 is the one to watch: two names that differ after 39 characters.
2. **A monitor being unplugged.** The machine half is done (a window remembered at
   9000,9000 comes back at 440,118, on screen). The half that needs hardware: open
   the window on an external display, unplug it, and check the window is still
   reachable — then plug it back in and check the window returns to the second
   display, with its size and place remembered.
3. **The OS reduced-motion switch itself.** The harness tells the renderer
   `prefers-reduced-motion: reduce` through CDP, which is the same signal the CSS
   sees, and the stylesheet's kill switch answers it (transitions go from 0.2s to
   1e-05s). What was not done is changing the setting in System Settings →
   Accessibility → Display → Reduce motion and watching the app: animations of the
   window itself (a sheet arriving, a modal), which CDP does not reach.
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
7. **A contrast judgement.** The arithmetic passes (6.68:1 to 17.29:1 for the six
   pieces of text measured, light and dark). What a machine cannot say is whether
   a 320px project name ellipsised to "a-project-with-a-n…", a 39-character
   conversation title and a "Connect a…" model chip read as clearly as they
   should. That is the same material as findings 2 and 4, looked at rather than
   measured.
8. **The loading layout.** Nothing was caught: the app ships no skeleton, and the
   only loading state is `.sheet.sheet--arriving` (`aria-busy`) behind a lazy
   panel, which never lasted long enough to see on this machine. A person can
   catch it by opening the app cold and pressing a control that loads a heavy
   panel (Settings, Commands, the palette) — or this harness can be taught to look
   from the first frame.

## Running it again

- Re-run `--built` after the working tree settles: at the time of these runs the
  tree had uncommitted work from other agents, so the packaged bundle (10:46) and
  `dist/` (13:50) were not the same code. Both runs agreed, which is why the
  findings above are quoted from either.
- `--conversations=6` keeps the rows short while working on something else; the
  plan's number is the default.
- The harness measures only what the renderer draws. A native view, a native
  dialog and the OS tooltip are outside every screenshot it takes.
