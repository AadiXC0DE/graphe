# Coverage map: every retained surface, its owner, and what holds it

Phase 10.3 step 1 of `docs/graphe-stabilization-plan-2026-09-13.md`: *inventory every
retained route, menu item, command, keyboard shortcut, IPC channel, tool and background
service, and map each to an owner and at least one behavioural test.*

This is that inventory. **498 entries**, grouped by kind. **157 have a behavioural test.**
**204 are held only as far as the module they delegate to** — the decision is proven where it
lives and nothing drives the entry's own wiring, arguments or dispatch. **38 rest on an
assertion over source text. 98 rest on nothing at all**, and one is an SDK tool this repo
deliberately leaves untouched.

Read it before counting a surface, before claiming a thing is tested, and before deleting
something that looks like a tripwire. Steps 2 to 7 of 10.3 work from this list.

**The rule this document is built on.** An entry is proven only by a test that would fail if
the entry stopped working. Where that test does not exist, the row says so.

## The revision this was read at

The working tree at `b4258d6` **with uncommitted work on top** — the tree is dirty, and two
sibling agents were editing `electron/main.ts`, `src/App.tsx`, `src/lib/ipc.ts` and
`src/components/AddMore.tsx` throughout this pass. The blobs below are what each row was read
from:

| file | blob | note |
| --- | --- | --- |
| `src/App.tsx` | `05cba28dc234` | read there; moved during the pass (`bdd4323d7299` → this → `bfa54ff7dfac`) |
| `src/lib/ipc.ts` | `b49feee15a02` | moved during the pass; `graphe:stop-package` was added by a sibling, taking `CHANNEL` from 184 to 185 keys |
| `electron/main.ts` | `ccde4df9ae35` | moved four times during the pass, 11612 → 11784 lines; every handler line in section 5 was re-derived at this blob and again after it, unchanged |
| `electron/menu.ts` | `34eb29a24868` | |
| `src/lib/keys.ts` | `72b226029173` | |
| `src/lib/actions.ts` | `f0f04ef17803` | |
| `src/agent/pi/tools.ts` | `a7a163748b69` | |
| `src/agent/pi/commands.ts` | `cb8ea9ae4c40` | |
| `src/agent/pi/extension-ui.ts` | `3ea3f41d214e` | |
| `src/components/Composer.tsx` | `f4c22650df88` | |
| `src/components/Sidebar.tsx` | `d4e2c0da9bb3` | |
| `src/work/settingspages.ts` | `7bd92eb1217b` | |

Sections 1 to 6 were assembled from a read of each file on disk, and section 6 was pasted from
the pass that produced it; where a section carries its own hash line (`electron/main.ts`
`dfc5cc2b3049` in section 6, for instance), that is the blob **that section** was read at, and it
is older than the pin above. The expressions are what to trust; the numbers are a snapshot.

Line numbers drift; expressions do not. Every `file:line` here is from the read described
above, and a reader six commits later should treat `main.ts:NNNN` as approximate and re-derive
it (`grep -n 'CHANNEL.<camel>' electron/main.ts`, the commands in *How to keep this true*).

## How a row is graded

| word | what it means |
| --- | --- |
| **behavioural** | a test imports the module that implements the entry, or drives the real Electron app (`tests/electron/smoke.test.ts`, four cases), and asserts an observable result |
| **module-only** | the module the entry delegates to is tested behaviourally, and no test touches this entry's own wiring, arguments or dispatch |
| **source-text** | the only assertion that would fail reads the file's text (`readFileSync` + `toContain`/`toMatch`/slice), even where the same file also has behavioural tests. A tripwire against a join coming apart; not proof the entry works |
| **none** | nothing |
| **n/a** | the entry is a delegate the repo deliberately does not own (Pi's own `read`/`edit` originals) |

Owner is one of `project`, `conversation`, `workspace`, `run`, `process`, `app`. `workspace` is
one folder: a chat's own copy, a named child repo, or the folder the workspace registry wrote
down. `app` is the app itself and things outside any project.

`module-only` is the honest majority here (204 of 498) and it is not a synonym for untested. It
means the decision is proven where it lives and the join to the window is not. The plan asks
for a behavioural test per entry, so a `module-only` row is a gap — usually the cheapest kind
to close, because the seam is one argument list and one call into a module that is already
proven.

Two things this document does **not** re-derive, both still stale in
`docs/handoffs/ipc-inventory.md`: the **callers** of each channel, and the scope/target
columns. Section 7 lists the rows of that document that no longer describe anything.

## How to keep this true

Every claim in this file is reproducible from the tree in about a minute. Run these four, in
this order, and a row that disagrees with the code is a row to fix rather than to argue with.

```bash
# 1. what has moved since: the revision table above is per file
git hash-object src/App.tsx src/lib/ipc.ts electron/main.ts electron/menu.ts \
  src/lib/keys.ts src/lib/actions.ts src/agent/pi/tools.ts src/agent/pi/commands.ts

# 2. the channel list, in declaration order (section 5's numbering)
node -e "const s=require('fs').readFileSync('src/lib/ipc.ts','utf8');const i=s.indexOf('export const CHANNEL = {'),e=s.indexOf('} as const;',i);console.log([...s.slice(i,e).matchAll(/^  ([A-Za-z0-9_]+): '(graphe:[a-z-]+)'/gm)].map((m,n)=>(n+1)+' '+m[2]).join('\\n'))"

# 3. where each one is answered, and whether it is a handler or a push
grep -n 'CHANNEL[.]' electron/main.ts | grep -E 'handle|webContents.send|[.]on[(]'

# 4. what actually drives a thing: the four words, per entry
grep -rn '<the tool, key, command or channel name>' tests/ | head
```

Three rules keep it from rotting:

- **A new channel, key, tool, menu item, screen or service joins this table in the same change
  that adds it.** A surface that arrives without a coverage word is how the 98 `none` rows
  happened.
- **A row whose test is deleted goes back to `none`** rather than staying at whatever it said
  before. Re-pinning a source-text tripwire to new wording is not coverage; the plan's rule is
  to delete an assertion that only holds the wording.
- **`npm test` has to be green before this is trusted.** At the revision read it was not:
  `tests/always-wired.test.ts` was red, and by the time this was finished the offending assertion
  had been deleted and it passed (cross-cutting finding A).

## The shape of the surface

| kind | entries | behavioural | module-only | source-text | none |
| --- | ---: | ---: | ---: | ---: | ---: |
| Routes and screens | 52 | 26 | 21 | 4 | 1 |
| Menu items and keyboard shortcuts | 87 | 15 | 30 | 4 | 38 |
| Commands and the `/` picker | 37 | 20 | 2 | 4 | 11 |
| Tools | 64 | 24 | 31 | 0 | 8 (+1 n/a) |
| IPC channels | 185 | 5 | 119 | 24 | 37 |
| Background services | 73 | 67 | 1 | 2 | 3 |
| **all** | **498** | **157** | **204** | **38** | **98** |

Rows are counted as the tables below present them. Three notes so the numbers are not read as
more than they are:

- The menu table counts **12 separators** and **28 Electron-native roles** (`about`, `quit`,
  `copy`, `zoomIn`, …), which is why that kind carries 38 `none`. Graphe's own pressable menu
  items are 16; the shortcuts proper are 27 actions, 2 accelerators and 2 key-editor rows.
- The IPC table is one row per **declared channel**, including the 17 nothing answers and
  `graphe:event`, which nothing sends. Of the 185, **167 are answered by a handler**, 16 are
  push-only, one is a listener from the page's own world (`graphe:page-pointed`), and one
  (`graphe:event`) is declared with nothing on either end.
- Section 3's rows include the surfaces *around* the `/` picker (the palette, the Commands
  drawer, the Skills sheet) because they are the ways a person invokes something by name; the
  picker's own row list is one row.

## 1. Routes and screens

52 rows: the ten-arm `goToScreen` union, the twenty other navigable destinations, the ten
sidebar entries and the eleven Settings pages. Navigation is a closed string union in
`src/App.tsx` whose dispatch closes every *other* screen in one transition; each member is
backed by its own flag and a lazily imported component, so a member is really two things — the
flag that mounts the screen and the arm that closes the rest. Nothing renders the union as a
whole: `tests/views-arrive.test.ts` reads it, which is why the union itself and half its arms
are **source-text** or **module-only** while the screens they open are well covered.

The one row with nothing behind it is `Gallery` (a `?gallery` query string in a dev build).
`src/components/VersionRow.tsx` and the sidebar's `canvas` place are declared and unreachable;
they are named at the end of the section.

## Revision

App.tsx read and cited at **`05cba28dc234`** (git blob, 12 chars). Sibling agents edited it mid-session: it was `bdd4323d7299` when this scout started and every App.tsx line below was re-read after the drift, at `05cba28dc234`. Other files, unchanged all session: Sidebar.tsx `d4e2c0da9bb3`, settingspages.ts `7bd92eb1217b`, AppWide.tsx `85a762852a42`, app-wide.ts `f3ab2f576833`.

## 1. The screen union (`goToScreen`, src/App.tsx:1664-1676)

| screen | how it is named / reached | declared at | owner | coverage | test |
| --- | --- | --- | --- | --- | --- |
| `chat` | union arm 1658; every tab and every square; what every other screen closes back to. Drawn as ThreadRows (App.tsx:5690) + Composer (5885), or Welcome when the chat is empty (5595) | App.tsx:1658, mount 5690/5885 | conversation | behavioural | tests/electron/smoke.test.ts `it('writes a file through a tool call, and the conversation beside it sees the same file')` drives the real app and asserts thread rows and the reply text. The union arm's own close-others dispatch is only source-checked — tests/views-arrive.test.ts `it('never closes the screen being opened')` |
| `graph` | "Canvas"/"History" (sidebar `history`, palette "Look through the history"); renders HistoryView | App.tsx:1659, flag 1076, mount 6054 | project (versions of the project folder; per child repo when the folder holds several) | module-only — the screen itself is untested, only read as source | tests/graph.test.ts `it('opens a second column for the other side of the work')` exercises `layOut`, the layout HistoryView draws. The screen: tests/multiroot-history-default.test.ts `it('is the value the sheet is actually given, not the raw pick')` (source only) |
| `reviews` | sidebar "Pull requests" (App.tsx:5218); renders ReviewsView | App.tsx:1660, flag 1078, mount 6079 | project | module-only — screen itself untested | tests/review-target.test.ts `it('tells the review the folder is not the pull request')` calls `reviewPrompt`/`whereToRead` imported from ReviewsView.tsx; the sheet itself only read as source by tests/repo-panel.test.ts and tests/multiroot-history-default.test.ts |
| `review` | sidebar "Review" (5212) + palette "Review finished work"; renders ReviewQueue | App.tsx:1661, flag 1085, mount 6109 | project | behavioural | tests/review-queue-screen.test.ts (jsdom; imports and renders `ReviewQueue`) |
| `skills` | sidebar "Skills" (5222), palette, command `/skills`; renders Skills | App.tsx:1662, flag 1028, mount 5356 | app (machine library; rows carry project/global scope) | behavioural | tests/skills-screen.test.ts `it('is the same library the project can ask for')` family — imports and renders `Skills` |
| `connected` | palette "Other tools" only (no sidebar row); renders Connected | App.tsx:1663, flag 1043, mount 5330 | project ("the other tools this project has plugged in") | behavioural | tests/other-tools.test.ts — imports and renders `Connected` |
| `settings` | sidebar "Settings" (5238), palette rows, the model chip's "Change…" (App.tsx:5913); renders Settings | App.tsx:1664, flag 1045, mount 5376 | app | behavioural | tests/settings-screen.test.ts (renders `Settings`, walks every page) |
| `usage` | palette "See what this cost", Settings→Models row, the CostMeter's link; renders Usage | App.tsx:1665, flag 1049, mount 5470 | app (machine spend; the sitting's own figure is passed in) | behavioural | tests/usage-screen.test.ts `it('answers am I fine with three numbers')` family — imports and renders `Usage` |
| `add-more` | sidebar "Add more" (5228), palette, Settings→Add-ons row; renders AddMore | App.tsx:1666, flag 544, mount 6225 | app (what this machine can be given; per-project connection state) | source-text | tests/reach.test.ts reads AddMore.tsx and extracts its `SAYS` block (`it('shows the version on the row, for somebody who wants to know')`); the shelf is never rendered. What it lists is covered behaviourally by tests/packages.test.ts |
| `helpers` | HelperRail rows (App.tsx:5831 → `goToScreen("helpers")`); renders HelpersView | App.tsx:1667, flag `helpersAt`, mount 6180 | project | module-only — screen itself untested | tests/second-look.test.ts imports `tallyOf`/`titleOf` from HelpersView.tsx and exercises them; the rest of its cover is source (`it('scrolls each half on its own, and wraps a path rather than pushing sideways')`) |
| *(the union itself)* | closes the other nine screens | App.tsx:1655-1668 | app | source-text | tests/views-arrive.test.ts `it('never closes the screen being opened')` and `it('opens the new screen before it closes the old one')` — reads App.tsx, no behavioural cover of any dispatch |

## 2. Other navigable destinations (sheets, panes, cards, dev page)

| screen | how it is named / reached | declared at | owner | coverage | test |
| --- | --- | --- | --- | --- | --- |
| Welcome | the start screen and a chat with no turns (App.tsx:5595) | src/components/Welcome.tsx:67 | conversation (with no project open, the app's first screen) | behavioural | tests/electron/smoke.test.ts `it('boots, draws the first screen, and writes what it knows into the profile')` asserts `.welcome__title` in a real window. Source also read by tests/second-look.test.ts and tests/project-context.test.ts |
| Overview (the panel beside the chat) | always drawn once a project has anything to say (App.tsx:5940) | src/components/Overview.tsx:337 | conversation (the panel is the chat's; it reads the project) | module-only — the panel itself untested | tests/fetch-wired.test.ts `it('says up to date, which is an answer and not silence')` calls `saysStanding`/`saysFound` imported from Overview.tsx; the panel's drawing is only read as source (tests/render-loop.test.ts, tests/panel-bands.test.ts, tests/multiroot-wired.test.ts) |
| Files (project files panel) | sidebar "Project files" (App.tsx:5232) and ⌘⇧F / the `files` preference | src/components/Files.tsx:56, mount 5504 | project | behavioural | tests/electron/smoke.test.ts `it('writes a file through a tool call, and the conversation beside it sees the same file')` asserts `.files__row` appears without a relaunch |
| FileView (reading a file in the column) | pressing a file in the panel; replaces the panel while open (App.tsx:5572, `reading`) | src/components/FileView.tsx:53 | project | source-text | tests/read-a-file.test.ts `it('draws every line rather than a chunk of them')` — reads FileView.tsx + its CSS + App.tsx, renders nothing |
| Commands (the drawer along the bottom) | sidebar "Commands" (App.tsx:5233) and ⌘`; renders Commands | src/components/Commands.tsx:95, mount 5514 | conversation (this chat's commands, and the servers it left) | behavioural | tests/terminal-drawer.test.ts renders `Commands`; tests/commands-ran.test.ts `it('names the drawer in both states of the shelf')` family |
| TerminalPane (a shell in the drawer) | the drawer's own tab, drawn inside Commands.tsx:253 | src/components/TerminalPane.tsx:47 | workspace (a shell on the project folder or the chat's checkout) | behavioural | tests/terminal-drawer.test.ts `it('keeps the sentence saying whose shell this is on screen with it')` asserts `.termpane__note` |
| BrowserPane (the page beside the conversation) | the `page` action, "See it", and the preview pill (App.tsx:6153) | src/components/BrowserPane.tsx:75 | project | module-only — the pane itself is never rendered by a test, and no test reads it | tests/preview-tabs.test.ts, tests/preview-live.test.ts and tests/operations/preview-navigation.test.ts cover `preview/tabs` and `preview/live`, which are what it delegates to |
| NewWorktree (the copy a chat asks for) | sidebar row menu "New worktree" and the rail (App.tsx:6203/6213/5842) | src/components/NewWorktree.tsx:55 | conversation (a chat's own copy) | module-only — the card itself is untouched by any test | tests/setup.test.ts `it('puts what is already chosen first, and leaves folders and the sample out')` (projects/setup) and tests/worktree.test.ts `it('makes a separate checkout on its own branch, starting at HEAD')` cover what it drives |
| AddonAsk (src/components/ExtensionRequest) | an add-on's question (App.tsx:6197) | src/components/ExtensionRequest.tsx:29 | conversation | behavioural | tests/extension-request.test.ts `it('answers yes only when yes was pressed')` renders it |
| ConnectModal (connect a model) | the composer chip and any turn with no account (App.tsx:6301) | src/components/ConnectModal.tsx:55 | app | behavioural | tests/electron/smoke.test.ts `it('holds two conversations in one project, and says so when nothing can answer')` waits on `.connectmodal` in the real app |
| Palette (⌘K) | ⌘K / the `ask`-adjacent action (App.tsx:5322) | src/components/Palette.tsx:115 | app | module-only — the sheet itself is never rendered | tests/palette-ui.test.ts `it('walks the rows in the order they are drawn')` exercises its exported row/band/highlight functions |
| Changes (the change in the folder) | the review card's press (App.tsx:5271) | src/components/Changes.tsx:190 | project | module-only — the sheet itself is never rendered | tests/changes-ui.test.ts `it('gives back the change exactly as it arrived when nothing was dropped')` imports its exported helpers; the sheet is only read as source (tests/diffview.test.ts) |
| Conflict (settling files a review left) | a landing that clashed (App.tsx:6136) | src/components/Conflict.tsx:68 | workspace (the checkout the review landed in) | behavioural | tests/conflict-screen.test.ts `it('cannot be written back, whatever anybody presses')` renders it |
| AskAnything (Find anything) | sidebar "Find anything" (App.tsx:5207, `.shelf__more` row / `.shelf__act` in the strip) | src/components/AskAnything.tsx:52, mount 5175 | app | module-only — the sheet is never rendered or read by a test | tests/anything.test.ts `it('puts the sentence first when nothing matches it')` covers `lib/anything`, which it delegates to |
| Sidebar (the shelf) | always, when a project is open (App.tsx:5183); ⌘B folds it | src/components/Sidebar.tsx:239 | project (the folder in front) | behavioural | tests/sidebar.test.ts `it('are the same, in the same order, folded or not')`; row actions in tests/conversation-actions.test.ts; stop in tests/close-is-a-view.test.ts |
| Tabs (the strip) | always with a project open (App.tsx:5058) | src/components/Tabs.tsx:59 | conversation | behavioural | tests/tab-strip.test.ts renders it; tests/budgets.test.ts also draws it |
| Board (what is being worked on) | inside Away, inside the panel (Board.tsx:245; Away.tsx:111) | src/components/Board.tsx:245 | project | module-only — the board itself only read as source | tests/board.test.ts `it('draws what is going first, then what is waiting, then what is finished')` covers src/work/board.ts; Board.tsx only read by tests/helpers-keep-going.test.ts `it('is kept by the panels that answer it in the page itself')` |
| Room (how full the conversation is) | the composer band (Room.tsx:47, drawn from Composer.tsx:1055) | src/components/Room.tsx:47 | conversation | module-only — the band itself is untouched by a test | tests/roomshare.test.ts `it('adds up to the whole conversation')` covers lib/roomshare |
| AppWide (what this machine is missing) | always, above everything (App.tsx:5562) | src/components/AppWide.tsx:29 | app | source-text | tests/project-context.test.ts `it('is drawn before anything that depends on what is open')` asserts `<AppWide` exists in App.tsx and precedes `<Welcome`/`<ThreadRows`; the band is never rendered, though the list it draws (`keptAppWide`/`stillShowing`/`gitIsMissing`) is behaviourally tested in the same file |
| Gallery (/?gallery) | a query string in a dev build only (App.tsx:343) | src/gallery/Gallery.tsx:845 | app | none | no test references it — the only mention of a gallery anywhere in tests/ is prose in tests/theme.test.ts |

## 3. Sidebar entries (src/components/Sidebar.tsx, `placesOf` 204-224; drawn at 722 open and 769 folded)

Every row: **module-only**. sidebar.test.ts asserts the list behaviourally (names, order, and that a place with no callback is dropped) but no test presses a row and asserts where it goes; each destination is covered separately as above.

| sidebar row | id / line | callback in App.tsx | owner | coverage | test |
| --- | --- | --- | --- | --- | --- |
| Find anything | `ask` `Sidebar.tsx:206` | 5207 → `setAsking(true)` → AskAnything:5175 | app | module-only | tests/sidebar.test.ts `it('are the same, in the same order, folded or not')`; the sheet: tests/anything.test.ts (lib only) |
| Canvas | `canvas` `Sidebar.tsx:207` | **no `onCanvas` is passed** — this row is filtered out today | project | module-only (row is not drawn at all) | tests/sidebar.test.ts `it('leaves out a place with nowhere to go, in both')` — presses nothing, asserts the omission |
| History | `history` `Sidebar.tsx:208` | 5208 → `goToScreen("graph")` | project | module-only | tests/sidebar.test.ts; destination: tests/graph.test.ts / tests/multiroot-history-default.test.ts |
| Review | `review` `Sidebar.tsx:209-216` | 5212 → `goToScreen("review")` + `setReviewQueueOpen(true)` | project | module-only | tests/sidebar.test.ts (`it('is a badge on the mark when it is folded')` for the count); destination: tests/review-queue-screen.test.ts |
| Pull requests | `reviews` `Sidebar.tsx:217` | 5218 → `goToScreen("reviews")` | project | module-only | tests/sidebar.test.ts; destination: tests/review-target.test.ts (module-only) |
| Skills | `skills` `Sidebar.tsx:218` | 5222 → `goToScreen("skills")` | app | module-only | tests/sidebar.test.ts; destination: tests/skills-screen.test.ts |
| Project files | `files` `Sidebar.tsx:219` | 5232 → `setFilesOpen(true)` | project | module-only | tests/sidebar.test.ts; destination: tests/electron/smoke.test.ts |
| Commands | `commands` `Sidebar.tsx:220` | 5233 → toggles the drawer (absent with no conversation) | conversation | module-only | tests/commands-ran.test.ts `it('names the drawer in both states of the shelf')` renders Sidebar and asserts the row's name in both states |
| Add more | `more` `Sidebar.tsx:221` | 5228 → `goToScreen("add-more")` | app | module-only | tests/sidebar.test.ts; destination: tests/reach.test.ts (source-text) |
| Settings | `settings` `Sidebar.tsx:222` (asserted to be last) | 5238 → `goToScreen("settings")` | app | module-only | tests/sidebar.test.ts `it('puts Settings last in both')`; destination: tests/settings-screen.test.ts |

Also on the shelf and navigable, all behavioural via tests/conversation-actions.test.ts and tests/close-is-a-view.test.ts: the per-row menu (Continue / Fork / Archive, Sidebar.tsx:831-885) and New worktree (388).

## 4. Settings pages (src/work/settingspages.ts)

Drawn by src/components/Settings.tsx:263. `PAGES` is 59-70; `pageWords` is 72-105.

| page | line (PAGES / pageWords) | owner | coverage | test |
| --- | --- | --- | --- | --- |
| Appearance | `settingspages.ts:60` / `:73` | app | behavioural | tests/settings-screen.test.ts `it('draw a control for every row the model files on them')` loops PAGES and renders each page |
| Behaviour | `settingspages.ts:61` / `:77` | app | behavioural the same PAGES loop and render |
| Notifications | `settingspages.ts:62` / `:81` | app | behavioural the same PAGES loop and render |
| Keys | `settingspages.ts:63` / `:85` | app | behavioural | same, plus `it('read out every action and the chord it answers to')` |
| Models | `settingspages.ts:64` / `:86` | app | behavioural | same, plus the advisor-gate block |
| Add-ons | `settingspages.ts:65` / `:87` | app | behavioural | same, plus `it('is three choices, with the one in force ticked')` |
| Storage | `settingspages.ts:66` / `:91` | app | behavioural the same PAGES loop and render |
| Computer use | `settingspages.ts:67` / `:92` | app | behavioural | same (page drawn via PAGES); the policy module is covered by tests/computeruse.test.ts |
| Privacy | `settingspages.ts:68` / `:96` | app | behavioural | same, plus `it('open on the page holding a row asked for by name')` |
| Advanced | `settingspages.ts:69` / `:100` | app | behavioural the same PAGES loop and render |
| Always | not in PAGES / 104 — reached from the Advanced row (Settings.tsx:863 → 1182) | project | behavioural | tests/settings-screen.test.ts `it('is one line and an Add press when nothing runs yet')` walks Advanced → the row → the page |

## 5. Declared but unreachable

- **src/components/VersionRow.tsx** — the only component in src/components/ that no screen renders; its sole importer is src/gallery/Gallery.tsx.
- **The sidebar's `canvas` place** (Sidebar.tsx:207) — declared, and never drawn, because App.tsx passes no `onCanvas`.
- **src/gallery/Gallery.tsx** — outside the union by design: only `/?gallery` in a dev build reaches it, and no test does.

## Method

Coverage was assigned from the strongest evidence that exists for the entry: **behavioural** when a test renders the component itself (jsdom, `createRoot`) or drives the real Electron app and asserts an observable result; **module-only** when no test renders the entry but a test exercises code it delegates to or exports (so its own mounting, arguments and dispatch are untested, said plainly per row); **source-text** when the only tests that mention it read its source text (these are the `*-wired.test.ts` files and, for the union itself, tests/views-arrive.test.ts); **none** when no test mentions it. tests/operations/ipc-arguments.test.ts set the tone — each row names what is *not* covered rather than implying it is. Every test cited was opened and its header read; representative `it(...)` names are quoted only where they were read. A row whose screen is behavioural but whose press is not (every sidebar row, and every union arm) is marked module-only for the row and names the destination's own test beside it.

Unsettled: none. Two judgement calls are worth naming. (1) `graph`/`reviews`/`helpers` are `module-only` rather than `behavioural` even though the modules they draw from are well tested, because nothing renders those screens. (2) Ownership of the panel bands follows App.tsx's own comment at 5942 — "the queue is the project's, but the panel is the chat's" — so Overview and Room are filed under `conversation` while Board and History are `project`.

**Read against the revision above.** `src/App.tsx` was edited by a sibling mid-pass; every
App.tsx line was re-read at `05cba28dc234`. The `goToScreen` union is at `src/App.tsx:1664-1676`.

## 2. Menu items and keyboard shortcuts

87 rows: every item of `menuTemplate`, both menu accelerators, all 27 shortcut actions with
their default chords, and the two rows of the key editor. This is the kind with the most
`none` (38), and the reason is worth stating plainly rather than fixing row by row: **28 of
them are Electron's own roles** (`about`, `services`, `hide`, `quit`, `undo`, `copy`, `paste`,
`selectAll`, `minimize`, `zoom`, `front`, `reload`, …) which carry no Graphe code, and 12 are
separators. What is left uncounted-by-anything that is genuinely ours: the two accelerators
(`⌘O`, `⌘N`), the three `theme-*` radios, and 3 shortcut actions whose chord is never asserted.
The theme radios are the one dead control in this kind (finding 13): `themeId()` ids are drawn in
`electron/menu.ts:95-97` and `withMenuClicks` (`electron/main.ts:5979-6013`) returns a click for
the four `MENU_IDS` only, so pressing one does nothing.

| entry | kind | file:line | what a press reaches | owner | coverage | test |
|---|---|---|---|---|---|---|
| App menu `Graphe` (macOS only) | menu item | electron/menu.ts:45 | submenu only | app | behavioural | tests/menu.test.ts `it('leads the bar on macOS')` |
| App → `About Graphe` | menu item | electron/menu.ts:47 | native role `about` — no Graphe code | app | none | — (menu.test.ts collects roles but asserts nothing about it) |
| App → separator | menu item | electron/menu.ts:48 | nothing (structural) | app | none | — |
| App → Services | menu item | electron/menu.ts:49 | native role `services` | app | none | — |
| App → separator | menu item | electron/menu.ts:50 | nothing (structural) | app | none | — |
| App → Hide | menu item | electron/menu.ts:51 | native role `hide` | app | none | — |
| App → Hide Others | menu item | electron/menu.ts:52 | native role `hideOthers` | app | none | — |
| App → Show All | menu item | electron/menu.ts:53 | native role `unhide` | app | none | — |
| App → separator | menu item | electron/menu.ts:54 | nothing (structural) | app | none | — |
| App → Quit | menu item | electron/menu.ts:55 | native role `quit` | app | none | — (the `quit` menu.test.ts sees on non-Mac is File's) |
| File | menu item | electron/menu.ts:62 | submenu only | app | behavioural | tests/menu.test.ts `it('opens a folder and starts a conversation, by id')` |
| File → Open folder… (`open-folder`) | menu item | electron/menu.ts:64 | main.ts:5917 → `webContents.send(CHANNEL.fromMenu, {id})` :5920 → preload.ts:1408 → App.tsx:2671 `void browse()` | app | module-only | tests/menu.test.ts `it('opens a folder and starts a conversation, by id')` — the item/id is behavioural; the click branch (main.ts:5917-5922) and App.tsx:2671 have no test at all |
| File → Open folder… accelerator `CmdOrCtrl+O` | accelerator | electron/menu.ts:64 | same as the item above | app | none | — (the only accelerator assertion in tests/ is that `CmdOrCtrl+R` is absent, tests/menu.test.ts `it('binds no accelerator to ⌘R')`) |
| File → New conversation (`new-conversation`) | menu item | electron/menu.ts:65 | main.ts:5924 → `send(CHANNEL.fromMenu, {id})` :5927 → preload.ts:1408 → App.tsx:2672 `void swapConversation(null)` | conversation | module-only | tests/menu.test.ts `it('opens a folder and starts a conversation, by id')` — click branch and App.tsx:2672 untested |
| File → New conversation accelerator `CmdOrCtrl+N` | accelerator | electron/menu.ts:65 | same as the item above | conversation | none | — |
| File → separator | menu item | electron/menu.ts:66 | nothing (structural) | app | none | — |
| File → Close (macOS) | menu item | electron/menu.ts:67 | native role `close` | app | none | — |
| File → Quit (elsewhere) | menu item | electron/menu.ts:67 | native role `quit` | app | behavioural | tests/menu.test.ts `it('is absent everywhere else, and File leads instead')` — indirect: asserts role `quit` is present somewhere when onMac is false |
| Edit | menu item | electron/menu.ts:74 | submenu only | app | none | — (nothing asserts Edit or its contents) |
| Edit → Undo | menu item | electron/menu.ts:76 | native role `undo` | app | none | — |
| Edit → Redo | menu item | electron/menu.ts:77 | native role `redo` | app | none | — |
| Edit → separator | menu item | electron/menu.ts:78 | nothing (structural) | app | none | — |
| Edit → Cut | menu item | electron/menu.ts:79 | native role `cut` | app | none | — |
| Edit → Copy | menu item | electron/menu.ts:80 | native role `copy` | app | none | — |
| Edit → Paste | menu item | electron/menu.ts:81 | native role `paste` | app | none | — |
| Edit → Paste and Match Style (macOS) | menu item | electron/menu.ts:82 | native role `pasteAndMatchStyle` | app | none | — |
| Edit → Delete | menu item | electron/menu.ts:83 | native role `delete` | app | none | — |
| Edit → separator | menu item | electron/menu.ts:84 | nothing (structural) | app | none | — |
| Edit → Select All | menu item | electron/menu.ts:85 | native role `selectAll` | app | none | — |
| View | menu item | electron/menu.ts:113 | submenu only | app | behavioural | tests/menu.test.ts `it('still offers the theme, zoom and full screen')` |
| View → Theme (submenu) | menu item | electron/menu.ts:93 | submenu only | app | behavioural | tests/menu.test.ts `it('still offers the theme, zoom and full screen')` |
| View → Theme → Match this computer (`theme-system`) | menu item | electron/menu.ts:95 | nothing: `withMenuClicks` (main.ts:5915-5949) returns no click for any `theme-*` id, so the radio is drawn and inert | app | module-only | tests/menu.test.ts `it('offers every finish the panel does, and following the computer')` — the id is asserted; the press is wired to nothing and untested |
| View → Theme → separator | menu item | electron/menu.ts:96 | nothing (structural) | app | none | — |
| View → Theme → Light (`theme-light`) | menu item | electron/menu.ts:97 | nothing (no click branch for `theme-*` in main.ts) | app | module-only | tests/menu.test.ts `it('offers every finish the panel does, and following the computer')` — id only |
| View → Theme → Dark (`theme-dark`) | menu item | electron/menu.ts:97 | nothing (no click branch for `theme-*` in main.ts) | app | module-only | tests/menu.test.ts `it('offers every finish the panel does, and following the computer')` — id only |
| View → separator | menu item | electron/menu.ts:100 | nothing (structural) | app | none | — |
| View → Actual Size | menu item | electron/menu.ts:101 | native role `resetZoom` | app | none | — |
| View → Zoom In | menu item | electron/menu.ts:102 | native role `zoomIn` | app | behavioural | tests/menu.test.ts `it('still offers the theme, zoom and full screen')` |
| View → Zoom Out | menu item | electron/menu.ts:103 | native role `zoomOut` | app | none | — |
| View → separator | menu item | electron/menu.ts:104 | nothing (structural) | app | none | — |
| View → Toggle Full Screen | menu item | electron/menu.ts:105 | native role `togglefullscreen` | app | behavioural | tests/menu.test.ts `it('still offers the theme, zoom and full screen')` |
| View → separator (GRAPHE_DEBUG only) | menu item | electron/menu.ts:108 | nothing (structural) | app | none | — |
| View → Developer (GRAPHE_DEBUG only) | menu item | electron/menu.ts:109 | submenu only | app | behavioural | tests/menu.test.ts `it('puts reload and developer tools back')` |
| View → Developer → Reload | menu item | electron/menu.ts:110 | native role `reload` | app | behavioural | tests/menu.test.ts `it('has no reload and no developer tools')` + `it('puts reload and developer tools back')` |
| View → Developer → Force Reload | menu item | electron/menu.ts:110 | native role `forceReload` | app | behavioural | same two tests as above |
| View → Developer → Toggle Developer Tools | menu item | electron/menu.ts:110 | native role `toggleDevTools` | app | behavioural | same two tests as above |
| Window | menu item | electron/menu.ts:118 | submenu only | app | none | — (nothing asserts the Window menu) |
| Window → Minimize (macOS) | menu item | electron/menu.ts:120 | native role `minimize` | app | none | — |
| Window → Zoom (macOS) | menu item | electron/menu.ts:120 | native role `zoom` | app | none | — |
| Window → separator (macOS) | menu item | electron/menu.ts:120 | nothing (structural) | app | none | — |
| Window → Bring All to Front (macOS) | menu item | electron/menu.ts:120 | native role `front` | app | none | — |
| Window → Minimize (elsewhere) | menu item | electron/menu.ts:121 | native role `minimize` | app | none | — |
| Window → Close (elsewhere) | menu item | electron/menu.ts:121 | native role `close` | app | none | — |
| Help | menu item | electron/menu.ts:127 | submenu only | app | behavioural | tests/menu.test.ts `it('carries the version and the diagnostics item')` |
| Help → `Graphe <version>` (version line) | menu item | electron/menu.ts:129 | nothing — `enabled: false` | app | behavioural | tests/menu.test.ts `it('does not offer the version as something to press')` |
| Help → separator | menu item | electron/menu.ts:130 | nothing (structural) | app | none | — |
| Help → Copy diagnostics (`copy-diagnostics`) | menu item | electron/menu.ts:131 | main.ts:5931 → :5933 `diagnosticsNow().then((text) => clipboard.writeText(text))` | app | module-only | tests/menu.test.ts `it('carries the version and the diagnostics item')` — id only; the click branch is a closure in the Electron entry with no test (gap wording model: tests/operations/ipc-arguments.test.ts:1-29) |
| Help → Release notes (`release-notes`) | menu item | electron/menu.ts:132 | main.ts:5936 → :5938 `shell.openExternal(RELEASE_NOTES)` (const at main.ts:5955) | app | module-only | tests/menu.test.ts `it('carries the version and the diagnostics item')` — id only; nothing asserts the URL or the click |
| `ask` — mod+k | shortcut action | src/lib/actions.ts:61 | src/components/AskAnything.tsx:107-111 (own document capture listener) toggles the ask bar; App.tsx:2995 deliberately returns before the registry switch | app | module-only | tests/actions.test.ts `it('finds the action on both machines')`; key-editor.test.ts `it('leaves the three keys that belong to somebody else alone')` is source-text; no test renders AskAnything.tsx |
| `palette` — mod+shift+p | shortcut action | src/lib/actions.ts:62 | App.tsx:3001 `case 'palette'` → `setPaletteOpen` | app | module-only | tests/actions.test.ts `it('follows a rebinding')` (chord), key-editor.test.ts `it('answers every action the registry says has a key in a conversation')` (the `case` is source-text only) |
| `open` — mod+o (also mod+shift+t) | shortcut action | src/lib/actions.ts:63 | App.tsx:3004 → `void browse()` | app | module-only | tests/actions.test.ts `it('answers to an action’s other keys as well as its own')`; the `case` is source-text (key-editor.test.ts) |
| `skills` — no key (null) | shortcut action | src/lib/actions.ts:64 | palette/Settings only | app | module-only | tests/actions.test.ts `it('gives every action a name and somewhere to be reached from')`; the palette row that reaches it is the commands scout's |
| `connected` — no key (null) | shortcut action | src/lib/actions.ts:65 | palette/Settings only | app | module-only | same registry test as above |
| `more` — no key (null) | shortcut action | src/lib/actions.ts:66 | palette/Settings only | app | module-only | same registry test as above |
| `model` — no key (null) | shortcut action | src/lib/actions.ts:67 | palette/Settings only | app | module-only | same registry test as above |
| `usage` — no key (null) | shortcut action | src/lib/actions.ts:68 | palette/Settings only | app | module-only | same registry test as above |
| `settings` — no key (null) | shortcut action | src/lib/actions.ts:69 | palette/Settings only | app | module-only | same registry test as above |
| `new` — mod+t | shortcut action | src/lib/actions.ts:71 | App.tsx:3038 `case 'new'` → `void swapConversation(null)` | conversation | module-only | tests/actions.test.ts `it('says the key that new conversations really answer to')`; `case` source-text only (key-editor.test.ts) |
| `close` — mod+w | shortcut action | src/lib/actions.ts:72 | App.tsx:3022 `case 'close'` → `tabRow.close` | conversation | source-text | tests/key-editor.test.ts `it('answers every action the registry says has a key in a conversation')` — nothing asserts that mod+w means `close`; the only cover is `case 'close':` in src/App.tsx |
| `next` — mod+shift+} | shortcut action | src/lib/actions.ts:73 | App.tsx:3007 `case 'next'` → `tabRow.along(1)` | conversation | source-text | same key-editor.test.ts test; no assertion that mod+shift+} means `next` |
| `previous` — mod+shift+{ | shortcut action | src/lib/actions.ts:74 | App.tsx:3008 `case 'previous'` → `tabRow.along(-1)` | conversation | source-text | same key-editor.test.ts test; no assertion that mod+shift+{ means `previous` |
| `needs-you` — mod+shift+n | shortcut action | src/lib/actions.ts:75 | App.tsx:3015 `case 'needs-you'` → `tabRow.wantsYou()` | conversation | module-only | tests/actions.test.ts `it('says the key that new conversations really answer to')` asserts `chordFor('needs-you')`; `case` source-text only |
| `go-nth` — mod+1 … mod+9 | shortcut action | src/lib/actions.ts:78-83 | App.tsx:3047 `case 'go-nth'` → `tabRow.nth(Number(event.key))` | conversation | module-only | tests/actions.test.ts `it('treats the numbered conversations as one action')`; `case` source-text only |
| `shelf` — mod+b | shortcut action | src/lib/actions.ts:84 | App.tsx:3032 `case 'shelf'` → `setShelfOpen` | project | module-only | tests/key-editor.test.ts `it('still means what it meant: the shipped chords are unchanged')` + tests/actions.test.ts `it('is nothing when the action cannot be reached from here')` |
| `files` — mod+shift+f | shortcut action | src/lib/actions.ts:85 | App.tsx:3041 `case 'files'` → `setFilesOpen(true)` | project | module-only | tests/actions.test.ts `it('has a handler for the key it promises for the file tree')`; the `case` itself is source-text |
| `changes` — no key (null) | shortcut action | src/lib/actions.ts:86 | palette only (App.tsx everyCommand, its own `changes` entry around :4483) | workspace | module-only | tests/actions.test.ts `it('gives every action a name and somewhere to be reached from')` |
| `history` — no key (null) | shortcut action | src/lib/actions.ts:87 | palette only | project | module-only | same registry test as above |
| `reviews` — no key (null) | shortcut action | src/lib/actions.ts:88 | palette only | project | module-only | same registry test as above, plus tests/actions.test.ts `it('puts what somebody half-remembers at the top')` for the ranking |
| `commands` — mod+` | shortcut action | src/lib/actions.ts:89 | App.tsx:3044 `case 'commands'` → `setCommandsOpen` | project | module-only | tests/commands-ran.test.ts `it('is one action, on the chord the terminal model already spells')` (asserts the chord equals TERMINAL_KEYS.panel and actionAt for mod+`); `case` source-text only |
| `send` — enter (also mod+enter) | shortcut action | src/lib/actions.ts:91 | src/components/Composer.tsx:618 `if (e.key === 'Enter' && !e.shiftKey)` → `submit()`; the composer never reads the binding | conversation | behavioural | tests/draft-kept.test.ts `it('is emptied in the conversation that sent it, and only there')` dispatches a real Enter keydown (:271) and asserts what was sent |
| `stop` — escape | shortcut action | src/lib/actions.ts:92 | App.tsx:2945 `escapeMeans({…})` → :2963 `case 'stop'` → `halt()`; order decided in src/lib/escape.ts:44-54 | run | module-only | tests/nothing-stops-the-helpers.test.ts `it('stops the run only when Escape can mean nothing else')` is behavioural on escapeMeans; `it('is what the window actually presses')` pins `case 'stop':`/`halt();` as source text only |
| `page` — mod+j | shortcut action | src/lib/actions.ts:93 | App.tsx:3027 `case 'page'` → `togglePane()` | conversation | module-only | tests/key-editor.test.ts `it('still means what it meant: the shipped chords are unchanged')` |
| `find` — mod+f | shortcut action | src/lib/actions.ts:94 | App.tsx:3035 `case 'find'` → `setFinding`; src/components/FileView.tsx:73/125 takes ⌘F for its own column while it has one | conversation | module-only | tests/key-editor.test.ts `it('still means what it meant: the shipped chords are unchanged')`; the FileView listener is source-text (tests/read-a-file.test.ts `it('is the app’s own, because the browser’s only reaches what is drawn')`, `it('only takes the keys while it has the column')`) |
| `copy` — no key (null) | shortcut action | src/lib/actions.ts:95 | palette only | conversation | module-only | tests/actions.test.ts `it('gives every action a name and somewhere to be reached from')` |
| `tidy` — no key (null) | shortcut action | src/lib/actions.ts:96 | palette only | conversation | module-only | same registry test as above, plus tests/actions.test.ts `it('nests: a conversation is inside a project')` |
| Settings → Keys → `Keyboard shortcuts` row + Chords editor | key editor | src/components/Settings.tsx:656-673 (row), :1232-1318 (Chords) | expands to every action with `chordFor`/`clashesIn` (:1245, :1262); press a row (:1276) then a chord → `onBind` (:1304) → App.tsx:1101 `bindKey` → `localStorage['graphe:keys']` (:268, :1104); Escape leaves it, Backspace/Delete clears it (:1283-1290) | app | source-text | Listing is behavioural: tests/settings-screen.test.ts `it('read out every action and the chord it answers to')` (asserts ACTIONS.length rows and `Ask for anything … ⌘K`). Capture/clear/ignore-modifier is source-text only: tests/key-editor.test.ts `it('is the row itself, because nobody can spell a chord into a field')`, `it('leaves it alone on Escape and clears it on Backspace')`, `it('ignores a modifier held on its own, which is somebody still reaching')` — nothing fires a keydown at a real `.settings__chordset` |
| Settings → Behaviour → `Send with` | key editor | src/components/Settings.tsx:752-765 | writes the `send` binding (`onBind('send', 'enter' | 'mod+enter')`) | conversation | behavioural | tests/settings-screen.test.ts `it('sends with whichever press, through the chords themselves')` and `it('ticks the other press once it is the one bound')`; the composer ignores the result (Composer.tsx:618 tests only `!e.shiftKey`) |

Method. I read every row of `menuTemplate` on disk, matched each `id` to its `withMenuClicks` branch (main.ts:5915-5949) and its renderer answer (single place: App.tsx:2670-2672), and took every chord from `ACTIONS`/`DEFAULT_BINDINGS` in src/lib/actions.ts rather than from any printed hint. Verdict rule: `behavioural` = a test drives the real module/component to an observable result (tests/menu.test.ts for the template, tests/keys.test.ts for the chord code, tests/actions.test.ts for the registry, tests/settings-screen.test.ts for the chord list); `module-only` = the backing module is behaviourally tested while this entry's own wiring or dispatch is not; `source-text` = the only cover is `readFileSync` + `toContain` on src/App.tsx or src/components/Settings.tsx; `none` = no assertion names the entry. Of the four tests named in the ticket, tests/menu.test.ts, tests/keys.test.ts and tests/actions.test.ts are behavioural on their own modules, tests/key-editor.test.ts is the source-text one (it reads App.tsx and Settings.tsx; it is not named `*-wired.test.ts`), and tests/advisor-owned-keys.test.ts has nothing to do with this table — its "keys" are advisor settings keys, so no row here is covered by it. Entries I could not settle: none; every chord's mapping was traced either to an assertion or explicitly to nothing. Largest gaps named rather than guessed: the three `theme-*` radios have ids and no click anywhere in main.ts (inert), both real menu accelerators (`CmdOrCtrl+O`, `CmdOrCtrl+N`) have no test, the four clicks in `withMenuClicks` are untestable closures in the Electron entry (the gap tests/operations/ipc-arguments.test.ts:1-29 documents as its own), and `close`/`next`/`previous` have no test that their chord means what the registry says. Line numbers are from the on-disk revision above (contended files App.tsx `bdd4323d7299` and electron/main.ts `dfc5cc2b3049` were unchanged across two hash reads minutes apart; a later edit by a sibling may move them).

**Read against the revision above.** `tests/menu.test.ts`, `tests/keys.test.ts` and
`tests/actions.test.ts` are behavioural on their own modules; `tests/key-editor.test.ts` is the
source-text one (it reads `src/App.tsx` and `src/components/Settings.tsx` and is not named
`*-wired`). `tests/advisor-owned-keys.test.ts` has nothing to do with this table.

## 3. Commands and the `/` picker

37 rows: the routing module `src/agent/pi/commands.ts`, the workflow-file `/word` family, the
add-on command surface as Pi holds it, the composer's `/` menu, and the three similarly shaped
surfaces that are not the `/` picker (the ⌘K palette, the Commands drawer, the Skills sheet).

The split worth carrying into step 2 of 10.3: **the decision is proven and the join is not.**
`routeFor` — which of a workflow, an add-on or nothing answers a typed word — is behavioural
(`tests/extension-commands.test.ts`), and the caller that acts on it
(`electron/main.ts:10855-10885`) plus the picker's on-screen row list (`rowsForThePicker`,
`CHANNEL.workflows`, `src/components/Composer.tsx:370-374`) are **none**. The typed word is also
re-derived rather than reused: `leadingWord`'s regex is written out by hand again at
`electron/main.ts:10855`, so the regex has a test in one file and a second copy in another.

**No workflow commands ship in the repo** — no `.pi/prompts`, no prompts folder; only skills do
(`electron/main.ts:11682`). Every `/review`-style word comes from the person's own folder, so
the shipped surface is the eight named starters in `src/lib/recipes.ts:26-118`.

## Coverage map — named commands and the `/` picker

Blob hashes are `git hash-object <file>` (no `-w`) on the working tree as read, shortened to 12 chars. Files cited, in table order:
`commands.ts` cb8ea9ae4c40 · `adapter.ts` 9675238edb3d · `main.ts` dfc5cc2b3049 · `Composer.tsx` f4c22650df88 · `preload.ts` db886b5f1873 · `App.tsx` bdd4323d7299 · `work/workflows.ts` c85cc166d61c · `pi/workflows.ts` 22a3cb4562a2 · `lib/ipc.ts` b65144567580 · `Skills.tsx` 448cbb5aa0bb · `extension-probe.ts` 945cbafcc732 · `extension-states.ts` e225ebe3daee · `extension-ui.ts` 3ea3f41d214e · `packages.ts` fbb4d9ca089e · `Commands.tsx` 11af8d9a56e5 · `work/commands-ran.ts` 72ffc52aa4ad · `lib/commands.ts` ad09370cb0c1 · `Palette.tsx` 779edbc11252 · `lib/actions.ts` f0f04ef17803 · `recipes.ts` 987eab22f543 · `Welcome.tsx` a1bd14c133d6 · `extension-commands.test.ts` d4ab09a2bff4 · `extension-ui.test.ts` df8526940466 · `extension-probe.test.ts` 29f48e510f96 · `extension-compat.test.ts` f49e513a4fc1 · `packages.test.ts` 86a1e5d43ba4 · `commands-ran.test.ts` 03075d763c5b · `commands.test.ts` 99076bdeee39 · `workflows.test.ts` e2b650f3138b · `workflow-description.test.ts` 3a75eb57b4ec · `always-wired.test.ts` 061c1a2cfa60 · `palette.test.ts` 8290ff67d8ac · `palette-ui.test.ts` 7a57d6901808 · `actions.test.ts` 0087f73d41f5 · `recipes.test.ts` 3a668764453a · `composer-row.test.ts` 07450e29e592 · `operations/ipc-arguments.test.ts` 7f5f41872c6c

| command or picker surface | file:line where defined | where a press/keystroke is routed (file:line) | owner | coverage | test |
| --- | --- | --- | --- | --- | --- |
| `leadingWord(text)` | src/agent/pi/commands.ts:56 | src/agent/pi/adapter.ts:2811 (`isACommandHere`) → :3498 (look-first suppression); **electron/main.ts:10700 re-implements the same regex inline instead of calling it** | app | behavioural | tests/extension-commands.test.ts:52 `is the word, with the slash off, when a message opens with one` |
| `routeFor(word, here)` | src/agent/pi/commands.ts:68 | electron/main.ts:10705 (workflow vs add-on vs unknown) | app | behavioural | tests/extension-commands.test.ts:75 `is the workflow when both do, which is the one in front of the person` |
| `pickerCommands(workflows, addons)` | src/agent/pi/commands.ts:82 | electron/main.ts:576 (`rowsForThePicker`) → :9248 → electron/preload.ts:436 → src/App.tsx:683 → src/components/Composer.tsx:372 | app | behavioural | tests/extension-commands.test.ts:93 `lists both kinds with where each one comes from` |
| types `AddonCommand` / `WorkflowHere` / `PickerCommand` | src/agent/pi/commands.ts:22 / :31 / :40 | as the three rows above | app | behavioural (as the values those cases pass) | tests/extension-commands.test.ts:38-49 |
| `workflowWords` (needName/needBody/noPage/missingArgument) | src/work/workflows.ts:34 | electron/main.ts:10712, :10720 (the two failure cards) | app | behavioural | tests/workflows.test.ts:50 `refuses a file without a usable command name` |
| `commandWord(file)` — `review.md` → `/review` | src/work/workflows.ts:50 | electron/main.ts:10704 (inside `workflowNamed`) | app | behavioural | tests/workflows.test.ts:15 `takes the extension off the filename` |
| `expand(body, args)` (`$@`, `$1`, `${N:-d}`) | src/work/workflows.ts:83 | electron/main.ts:10717 (via `promptFor`) | app | behavioural | tests/workflows.test.ts:66 `replaces $@ with everything` |
| `readWorkflow(file, source)` (the whole `/word` family from `.pi/prompts/*.md`) | src/work/workflows.ts:102 | src/agent/pi/workflows.ts:48-69 (`availableWorkflows`); project cells from `:53` `join(here,'.pi','prompts')` | project (`.pi/prompts`) | behavioural | tests/workflows.test.ts:34 `reads the frontmatter and the body` |
| global prompt files (`<agentDir>/prompts`, `~/.pi/prompts`) | src/agent/pi/workflows.ts:52-55 | same reader | app | behavioural (as rows of the same function) | tests/workflows.test.ts:87 `lists both folders, project first` |
| `promptFor(workflow, args)` | src/work/workflows.ts:125 | electron/main.ts:10717 | app | behavioural | tests/workflows.test.ts:111 `expands the typed words into the body` |
| `workflowsFrom(project, global)` (project beats global) | src/work/workflows.ts:136 | src/agent/pi/workflows.ts:68 | project | behavioural | tests/workflows.test.ts:92 `a project workflow overrides its global namesake` |
| `Workflow` row type (renderer half) | src/lib/ipc.ts:979 | src/components/Composer.tsx:372-374 | conversation | behavioural (shape only) | tests/workflows.test.ts:34 |
| `availableWorkflows(project, agentDir)` | src/agent/pi/workflows.ts:48 | electron/main.ts:9250 (CHANNEL.workflows) | project | none | — no test imports `src/agent/pi/workflows.ts` |
| `workflowNamed(project, agentDir, command)` | src/agent/pi/workflows.ts:72 | electron/main.ts:10704 | project | none | — |
| typed `/word` → workflow prompt | electron/main.ts:10699-10717 | src/App.tsx:3217 `bridge.prompt` → electron/main.ts:10675 (CHANNEL.prompt, src/lib/ipc.ts:1377) | conversation | none | — the caller of the behaviourally-tested `routeFor` is itself untested; no test drives CHANNEL.prompt with a `/word` |
| typed `/word` → add-on's own handler | electron/main.ts:10706-10707, stale guard :10774-10789, sent :10858 | electron/main.ts:10858 `agent.prompt(...)` (Pi dispatches its commands before templates) | conversation | none | — |
| unknown `/word` refusal card | electron/main.ts:10718-10723 | — | conversation | none | — |
| `rowsForThePicker` (workflow/add-on rows → renderer rows) | electron/main.ts:571 | electron/main.ts:9253 | conversation | none (module-only: `pickerCommands` is behavioural) | — |
| `CHANNEL.workflows` handler | electron/main.ts:9248 (name src/lib/ipc.ts:1434) | electron/preload.ts:436 | conversation | none | — see tests/operations/ipc-arguments.test.ts:1-24 for how this class of gap is stated |
| Composer `/` menu opened by a leading slash | src/components/Composer.tsx:901-902 | :906 `onKeyDown` | conversation | source-text | tests/always-wired.test.ts:99-101 (regex + `chooseCommand`); **:102 asserts `aria-label="Ways of working"`, absent from Composer.tsx at blob f4c22650df88 — :912 says `aria-label="Commands"`** |
| Composer `/` menu rows (filter name+description, `.slice(0, 6)`) | src/components/Composer.tsx:370-374 | — | conversation | source-text (the description line only) | tests/workflow-description.test.ts:22 `is shown as written, with nothing stripped off the front` |
| Composer `/` arrows / Enter / Tab / Escape | src/components/Composer.tsx:575-588 | :586 `chooseCommand(highlighted)` | conversation | none | — |
| Composer `/` row rendering (shadowed row kept, `disabled`) | src/components/Composer.tsx:911-936 | press :923 | conversation | source-text | tests/workflow-description.test.ts:22 (only the `<small>{one.description}</small>` line) |
| Composer `/` row press → `/command ` in the box | src/components/Composer.tsx:382-389 | :923 and :586 | conversation | none | — |
| Composer `/` menu box (width/height/scroll) | src/components/Composer.css | — | conversation | source-text | tests/composer-row.test.ts:90 `holds the menu itself to a width and a height, however many are offered` |
| Skills sheet: a workflow row pressed by name | src/components/Skills.tsx:99-119, `putInBox` :152-155 | :302 → src/App.tsx:5890 (prop) → :5566 (`handIn`) | project | none | — |
| add-on registration as Pi holds it (`commandsHere`) | src/agent/pi/adapter.ts:2797 (namespace in the session face :994) | `session.commands()` src/agent/pi/adapter.ts:3914; picker read electron/main.ts:9252 | conversation | behavioural | tests/extension-commands.test.ts:147 (asserts :168), real add-on fixture |
| `isACommandHere` (a command is not a plan) | src/agent/pi/adapter.ts:2811 | src/agent/pi/adapter.ts:3498 | conversation | none | — |
| probe records `registerCommand` → card | src/agent/pi/extension-probe.ts:180 | src/agent/pi/extension-states.ts:143, :162 | app | behavioural | tests/extension-probe.test.ts:33 `is written down as exactly what it registered` (:38); tests/extension-compat.test.ts:624 `counts an add-on's command on its card, and registers none in the picker` |
| add-on UI context (`dialogsOver`, `unsupportedTerminal`, `uiContextOver`) — what a command handler may call, not a command surface | src/agent/pi/extension-ui.ts:61, :111, :203 | bound by the host | app | behavioural | tests/extension-ui.test.ts:29 (dialogs) and :114/:124/:130 (terminal refusals); `uiContextOver` in tests/extension-compat.test.ts:207-211 |
| package kind `prompts` (an add-on that ships prompt files) | src/agent/pi/packages.ts:47, :144, :152 | not wired to the picker; the shelf only installs | app | behavioural | tests/packages.test.ts:113 `names a kind when the package says one, and calls the rest mixed` |
| **Commands drawer** (shares the name, is *not* the `/` picker) | src/components/Commands.tsx:112 `commandsRan(turns)` ← src/work/commands-ran.ts:78 | drawer rows :350 | conversation | behavioural | tests/commands-ran.test.ts:225 `lists what was run, newest at the bottom` |
| Palette by name: `matches` / `grouped` / `isReady` | src/lib/commands.ts:84, :111, :128 | src/components/Palette.tsx:35-37 → :72, :167-168; also src/lib/actions.ts:182 and src/work/settingspages.ts:518 | app | behavioural | tests/palette.test.ts:34 `puts the name that starts with what was typed above one where a word does` |
| Palette panel keys/click | src/components/Palette.tsx:224-241 | :239 `run(chosenAt(...))`, click :268 → :167-168 `command.run()` | app | module-only | tests/palette-ui.test.ts:59 `numbers the rows down the panel, not down the ranked list` (pure helpers only; the keydown→run wiring is untested) |
| Palette actions registry (`ACTIONS`) | src/lib/actions.ts:60 | src/App.tsx key handling | app | behavioural | tests/actions.test.ts:44 `gives every action a name and somewhere to be reached from` |
| **shipped workflow commands** | — none: no `.pi/prompts`, no prompts folder anywhere in the repo; only skills ship (electron/main.ts:11510 `skillsShippedWith(...'skills')`, `skills/pptx/SKILL.md`) | — | app | none | — |
| shipped named starters (the only shipped named commands that are not `/` words): `Build it from Figma`, `Send in a team`, `Find the duplicates`, `Fix it on a phone`, `Check the contrast`, `Match my colours`, `Fill in the missing states`, `Find what makes it slow` | src/lib/recipes.ts:26-118 | src/components/Welcome.tsx:239 `onUse(recipe.prompt)` → src/App.tsx:5566 | app | module-only | tests/recipes.test.ts:23 `is a short row of real sentences` (the press itself untested) |

Method: verdicts are per entry, read against the files at the hashes above; `behavioural` = a test imports the module implementing the entry (or drives a real session in tests/extension-commands.test.ts) and asserts an observable result, `module-only` = the delegate is tested but this entry's own wiring is not, `source-text` = only readFileSync + toContain/toMatch, `none` = nothing. Read in full for this: commands.ts, extension-ui.ts, tests/commands.test.ts (which is the *shell* command surface — Guard/sandbox — not slash commands), tests/extension-commands.test.ts, tests/commands-ran.test.ts, tests/composer-row.test.ts, tests/workflows.test.ts, tests/workflow-description.test.ts, tests/extension-ui.test.ts. Routing the typed word to workflow-vs-add-on: **behaviourally covered only as the pure `routeFor` decision** (tests/extension-commands.test.ts:66-89); the caller that acts on it (electron/main.ts:10699-10730) and the picker's on-screen row list (`rowsForThePicker`, `CHANNEL.workflows`, Composer.tsx:370-374) are **not** behaviourally covered — the nearest cover for the row list is a source-text assertion about one `<small>` line. Two entries not in the column above because nothing covers them at any level: the `aria-label` mismatch itself, and the fact that `leadingWord`'s regex is duplicated by hand at electron/main.ts:10700, so the regex is tested in one file and used from another.

**Read against the revision above.** `tests/commands.test.ts` is the *shell* command surface
(Guard and sandbox), not slash commands; it is not cover for anything in this table.

## 4. Tools

64 rows: the 56 tools `grapheTools` can hand the model, Pi's own SDK seven that reach the model
through the same allowlist, and the two the `pi-advisor` package registers. The list is built by
`grapheTools` (`src/agent/pi/tools.ts:2391`) and pushed into Pi's `customTools` by
`src/agent/pi/adapter.ts:2991`, so **presence is gated**: `figma_read` needs a token, the page
tools need a live page, the desktop tools need a screen this app can read, and `ask_first`,
the six step tools, `cancel_build` and `make_checklist` exist only where the shell hands over the
callback. A tool that is absent is not a bug; a tool that is present and unproven is.

The one sweep that holds the whole set is `tests/guard-knows-every-tool.test.ts`, and it is
**behavioural**: it builds the real definitions and asserts the Guard has an opinion and the
feed has words for each. What it does *not* do is prove any tool runs. Two tools have no cover
at all — `cancel_build` (`src/agent/pi/tools.ts:2318`) and the tagged `read`
(`src/agent/pi/anchor-edit.ts:308`) — and Pi's untouched `write`, `ls`, `grep` and `find` have
Guard-policy rows and nothing else.

**Revision read at:** `src/agent/pi/tools.ts` blob `a7a163748b69`. Blob hashes were computed by `Main` on request, not by this scout (no shell in this toolset); same moment: `computer.ts 01d437406ab7`, `desktop.ts 07ddd7ea16b2`, `mcp.ts 57ea07151aa2`, `anchor-edit.ts 65aa4c11a36e`, `search-symbols-text.ts e41e98a855a0`, `adapter.ts 9675238edb3d`. Line numbers are from the files on disk at that revision.

## Graphe's own tools

| tool | definition | owner | may touch | coverage | test |
| --- | --- | --- | --- | --- | --- |
| `websearch` | `src/agent/pi/tools.ts:196` | app | the internet, read-only | module-only | `tests/search.test.ts` — `it('stops at the first provider that answers with results')` drives `chainSearch` in `src/agent/pi/search.ts`; the tool's own `execute` is never called |
| `webfetch` | `src/agent/pi/tools.ts:391` | app | https only, read-only | behavioural | `tests/tools.test.ts` — `it('reads the words and leaves the browser instructions behind')` |
| `read_document` | `src/agent/pi/tools.ts:2374` | project | one pdf/docx/pptx/xlsx inside the project | module-only | `tests/documents.test.ts` — `it('reads a word file paragraph by paragraph')`; the entry's own wiring is untested |
| `read_diff` | `src/agent/pi/tools.ts:537` | project | the project's git history, read-only | behavioural | `tests/checks.test.ts` — `it('sends nobody and says nothing extra when the project wrote none')` |
| `run_checks` | `src/agent/pi/tools.ts:624` | process | reads the project's change; spawns one reviewer process per check | behavioural | `tests/checks.test.ts` — `it('sets one reviewer going for every check the project wrote')`; wiring to the desk in `tests/checks-recorded.test.ts` |
| `task` | `src/agent/pi/tools.ts:1345` | process | reads the project; a builder works only in a copy of its own (a scratch workspace) | behavioural | `tests/task-background.test.ts` — `it('puts one piece on the board and answers straight away')`; `tests/tools.test.ts` — `it('says the helper program is missing rather than failing obscurely')`; fan-out timing in `tests/together.test.ts`, ceilings in `tests/fleet.test.ts` |
| `retain` | `src/agent/pi/tools.ts:723` | project | the project's memory db (`scope: 'global'` leaves it) | module-only | `tests/memory.test.ts` — `it('writes a fact and reads it back')`; the tool entry is untested |
| `recall` | `src/agent/pi/tools.ts:756` | project | same store | module-only | `tests/memory.test.ts` — `it('finds a fact whose words the question does not share, when meaning is available')`; entry untested |
| `reflect` | `src/agent/pi/tools.ts:783` | project | same store, project + global notes | module-only | `tests/memory.test.ts` — `it('writes a fact and reads it back')`; entry untested |
| `memory_edit` | `src/agent/pi/tools.ts:806` | project | same store | module-only | `tests/memory.test.ts` — `it('lets a fact go, and revises one by id')`; entry untested |
| `forget` | `src/agent/pi/tools.ts:831` | project | same store | module-only | `tests/memory.test.ts` — `it('lets a fact go, and revises one by id')`; entry untested |
| `debug_attach` | `src/agent/pi/tools.ts:890` | process | attaches to a running pid on this machine | module-only | `tests/debug.test.ts` — `it('attaches, reads frames with variables, steps, evaluates and detaches')` drives `src/agent/pi/debug.ts`; `debugTools` is never called |
| `debug_frames` | `src/agent/pi/tools.ts:932` | process | an attached pid | module-only | `tests/debug.test.ts` (same case); entry untested |
| `debug_step` | `src/agent/pi/tools.ts:944` | process | an attached pid | module-only | `tests/debug.test.ts` (same case); entry untested |
| `debug_eval` | `src/agent/pi/tools.ts:960` | process | an attached pid, evaluates in it | module-only | `tests/debug.test.ts` (same case); entry untested |
| `debug_detach` | `src/agent/pi/tools.ts:975` | process | an attached pid | module-only | `tests/debug.test.ts` (same case); entry untested |
| `keep_running` | `src/agent/pi/tools.ts:1697` | process | starts a process in the project folder that outlives the turn | behavioural | `tests/running.test.ts` — `it('serves on the port it was given, and says so with the address')` |
| `running` | `src/agent/pi/tools.ts:1754` | process | the register of processes started | module-only | `tests/running.test.ts` — `it('hands back what is new rather than the whole of it again')`; the tool's `execute` is not driven |
| `stop_running` | `src/agent/pi/tools.ts:1781` | process | the same register | module-only | `tests/running.test.ts` — `it('stops one and leaves the other alone')`; entry untested |
| `read_map` | `src/agent/pi/tools.ts:1848` | project | walks the project folder, read-only | module-only | `tests/map.test.ts` — `it('counts the files in each folder, biggest first')` drives `mapFrom`/`saysMap`; `readMapTool` is never executed |
| `page_read` | `src/agent/pi/tools.ts:1982` | conversation | the live page open beside this conversation | behavioural | `tests/beside.test.ts` — `it('still reads it, and says whose page it is before anything else')`; `it('says so plainly, and never throws, for every one of them')` for the closed pane |
| `page_click` | `src/agent/pi/tools.ts:2002` | conversation | same live page (a real press) | behavioural | `tests/beside.test.ts` — `it('sends a press through as a press, and says what the page looks like after')` |
| `page_type` | `src/agent/pi/tools.ts:2022` | conversation | same live page | behavioural | `tests/beside.test.ts` — `it('never sends the form unless it was asked to')` |
| `page_scroll` | `src/agent/pi/tools.ts:2050` | conversation | same live page | behavioural | `tests/beside.test.ts` — `it('turns a way it cannot read into down, rather than passing it on')` |
| `page_trouble` | `src/agent/pi/tools.ts:2074` | conversation | same live page's console/requests | behavioural | `tests/beside.test.ts` — `it('says plainly when the page has not complained about anything')` |
| `page_picture` | `src/agent/pi/tools.ts:2098` | conversation | a picture of the same live page | behavioural | `tests/beside.test.ts` — `it('hands the picture back as a picture')` |
| `make_checklist` | `src/agent/pi/tools.ts:2165` | conversation | this conversation's checklist, written through the shell | module-only | `tests/buildplan.test.ts` — `it('adds newly discovered requirements as their own tasks')` covers `src/work/buildplan.ts`; the tool entry is untested (the e2e harness fakes the name) |
| `step_done` | `src/agent/pi/tools.ts:2217` | conversation | the conversation's checklist | module-only | `tests/buildplan.test.ts` — `it('picks a step up only when the model says which')`; entry untested |
| `step_started` | `src/agent/pi/tools.ts:2243` | conversation | same checklist | module-only | `tests/buildplan.test.ts` (same case); entry untested |
| `step_failed` | `src/agent/pi/tools.ts:2255` | conversation | same checklist | module-only | `tests/buildplan.test.ts` — `it('picks a failed step up again, because a failure is work still owed')`; entry untested |
| `step_skipped` | `src/agent/pi/tools.ts:2270` | conversation | same checklist | module-only | `tests/buildplan.test.ts` — `it('counts what is done, what remains and what is stuck')`; entry untested |
| `drop_step` | `src/agent/pi/tools.ts:2285` | conversation | same checklist | module-only | `tests/buildplan.test.ts` — `it('picks a step up only when the model says which')`; entry untested |
| `insert_step` | `src/agent/pi/tools.ts:2300` | conversation | same checklist | module-only | `tests/buildplan.test.ts` — `it('adds newly discovered requirements as their own tasks')`; entry untested |
| `cancel_build` | `src/agent/pi/tools.ts:2318` | conversation | deletes this conversation's checklist file | none | nothing drives it. Named only in the `guard-knows-every-tool` sweep, in `tests/guard.test.ts` policy rows, and by `tests/e2e/harness.ts`'s own fake dispatcher (`clear`) |
| `ask_first` | `src/agent/pi/tools.ts:2332` | conversation | the turn: blocks on a person's answer | behavioural | `tests/asking-wired.test.ts` — `it('hands back whatever the session said, as ordinary text')`; presence/absence cases in `it('is not built when the session was never given a way to ask')`. The same file also asserts source text for the `executionMode` ordering |
| `figma_read` | `src/agent/pi/tools.ts:1579` | app | the Figma API with the account's token, read-only | behavioural | `tests/tools.test.ts` — `it('reads the frame and the variables, and sends the credential only to Figma')` |
| `edit` | `src/agent/pi/anchor-edit.ts:179` | project | files inside the session's folder | behavioural | `tests/anchor-edit.test.ts` — `it('changes the named lines of a real file and reports the new fingerprint')`, `it('refuses a stale fingerprint and leaves the file alone')` |
| `read` (tagged) | `src/agent/pi/anchor-edit.ts:308` | project | files inside the session's folder | none | no test imports `taggedReadTool` or drives its `execute`. `tests/tool-conflicts.test.ts:285` proves only that Graphe's `read` wins the name in a real session |
| `browser_open` | `src/agent/pi/computer.ts:561` | process | the web; its own browser process, one per project | behavioural | `tests/computer.test.ts` — `it('opens a page and comes back with what is on it')`, `it('says so rather than opening it')` |
| `browser_read` | `src/agent/pi/computer.ts:598` | process | that browser's current page | behavioural | `tests/computer.test.ts` — `it('says the program is missing rather than failing obscurely')` |
| `browser_click` | `src/agent/pi/computer.ts:618` | process | a press on that page | module-only | `tests/computer.test.ts` — `it('offers exactly the ten, named for what they do')` plus the press-argument helpers; the tool's `execute` is not driven. Guard row: `it('asks before pressing and before typing')` |
| `browser_type` | `src/agent/pi/computer.ts:638` | process | typing into that page | module-only | as `browser_click` (`fillArgs` helper + `it('asks before pressing and before typing')`); `execute` not driven |
| `browser_scroll` | `src/agent/pi/computer.ts:676` | process | scrolling that page | module-only | `scrollArgs` helper in `tests/computer.test.ts` (`it('reads any unreadable direction as down, which was what was meant')`); `execute` not driven |
| `browser_picture` | `src/agent/pi/computer.ts:700` | process | a picture of that page | module-only | `tests/computer.test.ts` guard row `it('lets it look without asking')`; `execute` not driven |
| `browser_trouble` | `src/agent/pi/computer.ts:731` | process | that page's console/network log | module-only | `saysRequests`/`saysTrouble` helpers in `tests/computer.test.ts` (`it('keeps the requests that did not come back well, and no others')`); `execute` not driven |
| `browser_steps` | `src/agent/pi/computer.ts:745` | process | a whole run on that page | behavioural | `tests/computer.test.ts` — `it('will not open one inside a run of steps either')`; step translation in `it('turns plain words into the program's own list')` |
| `browser_trace` | `src/agent/pi/computer.ts:793` | process | writes a trace file of that page's requests | module-only | name asserted in `it('offers exactly the ten, named for what they do')`; `execute` not driven |
| `browser_close` | `src/agent/pi/computer.ts:818` | process | ends its own browser process | module-only | guard row `it('lets it look without asking')`; `execute` not driven |
| `desktop_picture` | `src/agent/pi/desktop.ts:653` | app | this computer's screen | behavioural | `tests/desktop.test.ts` — `it('hands nothing over when the picture did not come back the size it asked for')`, `it('says it cannot size the screen rather than guessing at one')` |
| `desktop_do` | `src/agent/pi/desktop.ts:678` | app | pointer/keys on this computer | behavioural | `tests/desktop.test.ts` — `it('says which step it could not make rather than pretending it made it')` |
| `desktop_read` | `src/agent/pi/desktop.ts:802` | app | the named things in a program's windows | module-only | `readNamed`/`saysNamed`/`handleNumber` helpers in `tests/desktop.test.ts` (`it('says what it found in words a person would use')`); `execute` not driven |
| `desktop_apps` | `src/agent/pi/desktop.ts:832` | app | the list of open programs | behavioural | `tests/desktop.test.ts` — `it('opens the setting rather than describing where it is')` drives `desktop_apps`; guard row `it('lets it read the list of what is open without asking')` |
| `desktop_open` | `src/agent/pi/desktop.ts:860` | app | opens/brings forward a program | module-only | `tests/desktop.test.ts` — `it('offers exactly the five, named for what they do')` + guard row `it('asks before working the computer, and names the program it would open')`; `execute` not driven |
| `mcp` | `src/agent/pi/mcp.ts:467` | process | starts and drives the project's MCP servers; any tool they offer reaches the model through it | behavioural | `tests/mcp.test.ts` — `it('lists, starts on first use, calls the tool, and closes')`; `tests/operations/mcp-lifecycle.test.ts` |
| `connect_tool` | `src/agent/pi/mcp.ts:805` | project | writes `<project>/.pi/mcp.json` | behavioural | `tests/mcp.test.ts` — `it('appends to the list and leaves everything already in it alone')`, `it('writes nothing at all when it is refused')` |
| `search_symbols_text` | `src/agent/pi/search-symbols-text.ts:272` | project | the project's files, read-only, refuses outside and credential paths | behavioural | `tests/search-symbols-text.test.ts` — `it('finds every line a word appears on, with its file and line number')` |

## Pi's own seven — retained, SDK-defined

| tool | definition | owner | may touch | coverage | test |
| --- | --- | --- | --- | --- | --- |
| `bash` | SDK; Graphe rebuilds it at `src/agent/pi/adapter.ts:3190` with `heldShell` (`src/agent/sandbox/shell.ts`) underneath | project (+ scratch and download folders) | the whole machine, bounded by the seatbelt/bubblewrap boundary | behavioural | `tests/commands.test.ts` — `it('is the bash the model is given, not a second one beside it')`; refusals in `tests/sandbox-refusal.test.ts`, full access in `tests/full-access-servers.test.ts` |
| `write` | SDK (`@earendil-works/pi-coding-agent`), untouched; admitted at `src/agent/pi/adapter.ts:3014` | project | files in the project, Guard-bounded | none | no test drives it; `tests/guard.test.ts` has policy rows only (`it('blocks it when it arrives as a command instead of a file write')`) |
| `ls` | SDK, admitted at `src/agent/pi/adapter.ts:3014` | project | listing the project | none | no test drives it; `tests/guard.test.ts` policy rows only |
| `grep` | SDK, admitted at `src/agent/pi/adapter.ts:3014` | project | searching the project | none | no test drives it; `tests/guard.test.ts` policy rows only (`it('keeps the four read-only ones out of the way of "ask me first"')`) |
| `find` | SDK, admitted at `src/agent/pi/adapter.ts:3014` | project | finding files in the project | none | no test drives it; `tests/guard.test.ts` policy rows only (`it('does not soften the command that shares its name')`) |
| `read` / `edit` | SDK originals built at `adapter.ts:3014-3015` and used only as delegates | — | — | n/a | superseded by the two rows above (tagged `read`, anchored `edit`) |

## Advisor tools (registered by the `pi-advisor` package; not defined in this repo)

| tool | definition | owner | may touch | coverage | test |
| --- | --- | --- | --- | --- | --- |
| `ask_advisor` | none here — name only, in `src/agent/pi/events.ts:271`, `spend.ts:69`, `src/lib/describe.ts:269` | app | a second model, one question | none | the tool itself lives in the add-on and is never executed here. Guard/policy rows: `tests/advisor.test.ts` — `it('lets an ordinary question straight through, because the choice was the consent')`; folding: `tests/advisor-in-the-thread.test.ts` — `it('carries what the advisor replied, which is the whole of that step')` |
| `record_advisor_outcome` | none here — `src/lib/describe.ts:271` | app | nothing; records how advice turned out | none | as `ask_advisor` — `tests/advisor.test.ts:305`, extension-name lists in `it('separates the advisor's own, so a chip can turn those and only those off')` |

## `tests/guard-knows-every-tool.test.ts` — what it actually proves

It is **behavioural**, not source-text: it imports the real `grapheTools` and `pageTools` factories, builds the real definitions, and asserts on real `evaluate`/`describeCall` output. Two `it`s:

- `it('is one the Guard has an opinion about')` — for every name in `grapheTools('/tmp/agent','a-figma-token')` + `pageTools(ROOT)` (a **sweep**, so a tool added to those factories tomorrow is caught), plus a **hard-coded list** of the names no factory returns (`ask_first`, `step_done`, `cancel_build`, `keep_running`, `running`, `stop_running`, `mcp`, `retain`, `recall`, `reflect`, `memory_edit`, `forget`, `debug_attach`, `debug_step`, `debug_frames`, `debug_eval`, `debug_detach`, `read_diff`) and the two advisor names, it fails if `evaluate` answers with the unknown-tool confirm (`/do not fully recognise/`).
- `it('has words of its own for the feed')` — same set, fails if `describeCall(...).label` is `'Working on your project'`.

So: **it does enforce that every tool that reaches the model is classified** — no tool falls through to the unknown-tool question and none draws as the blank label — but only for names reachable from those two factories plus its literal list. A tool defined in `tools.ts` and never added to `grapheTools` escapes the sweep entirely (that is what the list compensates for), and it says nothing about a tool's `execute`, arguments, `executionMode` or reach.

## Method note

1. Read `src/agent/pi/tools.ts` in full (raw, by line range), grepped `src/` for `ToolDefinition`/`promptSnippet` to get the complete set of defining modules (7 files, plus the SDK's seven and the advisor package's two), and read each factory's own body.
2. Verdicts use the four words exactly: `behavioural` = a test imports the module that builds the entry and asserts an observable result; `module-only` = the module the entry delegates to is tested but no test touches this entry's own wiring (stated outright in each such row); `source-text` = only a `readFileSync`+`toContain` assertion; `none` = nothing.
3. Coverage was settled by grepping `tests/` for every tool name and for the factory names (`memoryTools`, `debugTools`, `runningTools`, `readMapTool`, `readDocumentTool`, `taggedReadTool`, …), then reading the test that drives or does not drive it. `tests/tools.test.ts` is invalid UTF-8 and is invisible to `grep`; it was read raw instead, start to finish.
4. Owner is the thing the entry acts on or through: `process` where the subject is an OS process (helpers, reviewers, servers, browser, debugger), `project` where it is the folder or its git history, `conversation` where it is this chat's own on-screen state (checklist, ask card, the page beside the chat), `app` where it is outside any project (network reads, the screen, the advisor).
5. **Every tool whose only cover is a source-text assertion: none.** The `*-wired.test.ts` files here assert routes, IPC and menus, not tool entries; `tests/asking-wired.test.ts` and `tests/checks.test.ts:326` do assert on tool-definition text, but each sits beside behavioural cover for the same tool, so no row rests on source text alone.
6. **Every tool with no cover at all: `read` (tagged, `src/agent/pi/anchor-edit.ts:308`) and `cancel_build` (`src/agent/pi/tools.ts:2318`).** Also uncovered, and listed for completeness: Pi's untouched `write`, `ls`, `grep` and `find`, whose only assertions in this repo are Guard-policy rows; and the `pi-advisor` package's `ask_advisor`/`record_advisor_outcome`, which are never executed here. Nothing needed `none?` — each of these was settled by reading the files named above.

**Read against the revision above.** `tests/tools.test.ts` is invalid UTF-8 and is invisible to
`grep`; it was read raw.

## 5. IPC channels

One row per channel `CHANNEL` declares (`src/lib/ipc.ts`), in declaration order, with the line
in `electron/main.ts` that answers or sends it. **185 channels**, 167 answered by a handler and
16 push-only, one listener from the page's own world, one declared with nothing on either end.
Owners and delegates come from `docs/handoffs/ipc-inventory.md` where it still describes
something; every line number was re-derived from the tree, because that document's numbers have
drifted by hundreds of lines and its row set is stale in both directions (section 7).

The coverage column is the whole point of this section, and it is bleak by construction: **every
window-to-shell call is a `handle(...)` closure inside `register()` in the Electron entry**, and
`tests/operations/ipc-arguments.test.ts` says in its own header which channel-level guarantees
that makes unprovable in-process. So `module-only` (119 rows) is the normal state: the module
the handler delegates to is proven and the channel is not, including its `Where` resolution, its
argument validation and its answer shape. Only five channels are behavioural, and all five are
the real-window suite's: `open-project`, `prompt`, `project-files`, `open-conversation` and
`events`.

**24 channels rest on source text**, 37 on nothing. The 37 are listed by number, with what backs
each, in the findings below.

| # | channel | owner | in `electron/main.ts` | delegates to | coverage | test, or the honest gap |

| ---: | --- | --- | --- | --- | --- | --- |

| 1 | `graphe:open-project` | project | main.ts:7483 | `openProject()` `electron/main.ts:4621` | **behavioural** | `tests/electron/smoke.test.ts` `it('holds two conversations in one project, and says so when nothing can answer')` — presses `.pickerrow__open`, welcome title becomes the folder |
| 2 | `graphe:prompt` | conversation | main.ts:10830 | session run (createSession, `src/agent/pi/adapter.ts`) | **behavioural** | `tests/electron/smoke.test.ts` `it('writes a file through a tool call, and the conversation beside it sees the same file')` |
| 3 | `graphe:stop` | conversation | main.ts:11066 | `sessionAt()` `:1969` → session `.stop()` | **module-only** | `tests/adapter.test.ts` `it('answers every open question with no when the session stops')`; the channel itself untested |
| 4 | `graphe:wait-for-me` | conversation | main.ts:11095 | `sessionAt()` `:1969` → `.holdOn()` | **module-only** | `tests/adapter.test.ts`; channel itself untested |
| 5 | `graphe:steer` | conversation | main.ts:11049 | `sessionAt()` `:1969` → `.steer()` | **module-only** | `tests/adapter.test.ts`; channel itself untested |
| 6 | `graphe:answer` | conversation | main.ts:11145 | `answered()` + session `.answer()` | **source-text** | `tests/app-sent-turn.test.ts` `it('clears the hold on a Guard decision')` |
| 7 | `graphe:answer-asked` | conversation | main.ts:11133 | `answered()` + `.answerAsked()` | **source-text** | `tests/app-sent-turn.test.ts` `it('clears the hold on the questions asked before the work started')`; `tests/asking-wired.test.ts` |
| 8 | `graphe:choose-folder` | none | main.ts:11156 | `dialog.showOpenDialog` | **none** | nothing drives the picker |
| 9 | `graphe:event` | none | `src/lib/ipc.ts:1445` (declared, no handler) | nothing sends it; `electron/preload.ts:988` subscribes | **none** | no test — nothing sends it, and the older inventory reached the same conclusion |
| 10 | `graphe:overview` | workspace | main.ts:7683 | `folderFor()` `:3164` | **source-text** | `tests/overview-roots.test.ts` `it('reads every root it reports out of the one folder it resolved')`; also `tests/branch-display.test.ts`, `tests/multiroot-wired.test.ts` |
| 11 | `graphe:recent-projects` | app | main.ts:7489 | `rememberedProjects()` `:2158` | **source-text** | `tests/first-page.test.ts` `it('is read where the shell answers for the list')` |
| 12 | `graphe:forget-project` | app | main.ts:7493 | `Recents` `src/projects/recents.ts:105` | **none** | no test imports `src/projects/recents.ts` |
| 13 | `graphe:versions` | workspace | main.ts:7519 | `timelineFor()` `:3175` → `Timeline` `src/history/timeline.ts:112` | **module-only** | `tests/history.test.ts` `it('lists versions newest first')`; channel itself untested |
| 14 | `graphe:put-back` | workspace | main.ts:7731 | `timelineFor()` → `Timeline.restoreTo` | **source-text** | `tests/multiroot-wired.test.ts` `it('answers each verb for the project the call names')` |
| 15 | `graphe:name-version` | workspace | main.ts:7753 | `timelineFor()` → rename | **source-text** | same `it` |
| 16 | `graphe:show` | workspace | main.ts:9297 | `folderFor()` `:3164` (page serving) | **source-text** | `tests/multiroot-wired.test.ts` `it('refuses the verbs that need one repository, in the same words everywhere')` |
| 17 | `graphe:show-progress` | push | main.ts:858 | — | **none** | nothing asserts the push or its listener |
| 18 | `graphe:window-state` | push | main.ts:1686 | — | **none** | nothing asserts it |
| 19 | `graphe:pointed` | push | main.ts:3027 | `src/preview/point.ts` payload | **none** | `tests/copyable.test.ts` covers the page-side pointer script, not this push |
| 20 | `graphe:pane-key` | push | main.ts:1058 | — | **none** | nothing asserts it |
| 21 | `graphe:page-pointed` | push | main.ts:1580 | `sayPointed()` `:3018` | **none** | named as untestable in `tests/operations/ipc-arguments.test.ts` header; no test drives it |
| 22 | `graphe:pages` | workspace | main.ts:9290 | `pagesIn()` `src/preview/pages.ts:94`, `filesUnder()` `:5035` | **source-text** | `tests/polyrepo-sweep.test.ts` `it('CHANNEL.pages resolves the folder rather than assuming the parent')` |
| 23 | `graphe:preferences` | app | main.ts:7769 | `PreferenceFile` `src/projects/preferences.ts:354` | **module-only** | `tests/kept.test.ts`, `tests/advisor.test.ts` drive it; channel itself untested |
| 24 | `graphe:set-show-me` | app | main.ts:7771 | `PreferenceFile.change()` | **module-only** | `tests/kept.test.ts` and `tests/advisor.test.ts` drive `PreferenceFile`; the channel itself is untested |
| 25 | `graphe:set-show-files` | app | main.ts:7777 | `PreferenceFile.change()` | **module-only** | as row 24: the module is tested, the channel is not |
| 26 | `graphe:project-files` | project | main.ts:7785 | `everythingIn()` `src/files/listing.ts:96` | **behavioural** | `tests/electron/smoke.test.ts` `it('writes a file through a tool call, and the conversation beside it sees the same file')` — the file row appears in both conversations; also source-text `tests/multiroot-wired.test.ts` |
| 27 | `graphe:file-text` | project | main.ts:7815 | `fileInProject()` `:5093`, `looksBinary()` `src/files/listing.ts:158` | **module-only** | `tests/operations/budgets.test.ts` (`everythingIn`); file-text path untested |
| 28 | `graphe:keep-version` | project | main.ts:7840 | `keeping()` `src/projects/kept.ts:41` | **module-only** | `tests/kept.test.ts`; channel itself untested |
| 29 | `graphe:hatches` | app | main.ts:7850 | `editor()` `:2132` → `findEditors()` `src/shell/editors.ts:118` | **module-only** | `tests/editors.test.ts`; channel itself untested |
| 30 | `graphe:get-helper` | app | main.ts:7856 | `fetchHelper()` `src/agent/pi/helper.ts:56` | **module-only** | `tests/helper-fetch.test.ts`; channel itself untested |
| 31 | `graphe:open-in-editor` | project | main.ts:7914 | `editor()` `:2132`, `inside()` `:5117` | **module-only** | `tests/editors.test.ts`; channel itself untested |
| 32 | `graphe:reveal-folder` | project | main.ts:9273 | `shell.openPath(open.path)` | **none** | no test |
| 33 | `graphe:save-version` | workspace | main.ts:8130 | `timelineFor()` → `Timeline.snapshot` | **source-text** | `tests/multiroot-wired.test.ts` `it('answers each verb for the project the call names')` |
| 34 | `graphe:room` | conversation | main.ts:7979 | `sessionAt()` `:1969` → `.room` | **module-only** | `tests/adapter.test.ts`; channel itself untested |
| 35 | `graphe:carried` | conversation | main.ts:8091 | `sessionAt()` → `.carried` | **module-only** | `tests/adapter.test.ts`; channel itself untested |
| 36 | `graphe:trust-carried` | conversation | main.ts:8105 | prefs + session rebuild (`adapter`) | **source-text** | `tests/nothing-stops-the-helpers.test.ts` `it('remembers the switch and leaves a working conversation alone')` |
| 37 | `graphe:repo-look` | workspace | main.ts:7530 | `readRepo()` `:2607` → `githubRepo()` | **source-text** | `tests/polyrepo-sweep.test.ts`; the github module itself untested |
| 38 | `graphe:repo-comment` | workspace | main.ts:7544 | `folderFor()` + gh call | **source-text** | `tests/multiroot-history-default.test.ts` `it('posts a comment against that same project')` |
| 39 | `graphe:pr-diff` | workspace | main.ts:7562 | `githubRepo()` + `ghText()` in main.ts | **none** | `tests/pulls.test.ts` covers the window's pull helpers, not the channel |
| 40 | `graphe:pr-checks` | workspace | main.ts:7578 | `readChecks()` + `pullCheck()` | **none** | as row 39: `tests/pulls.test.ts` covers the window's helpers, not the channel |
| 41 | `graphe:pr-checkout` | workspace | main.ts:7595 | gh checkout in main.ts | **none** | as row 39: `tests/pulls.test.ts` covers the window's helpers, not the channel |
| 42 | `graphe:pr-comments` | workspace | main.ts:7618 | `readComments()` | **none** | as row 39: the module has no test either |
| 43 | `graphe:pr-comment` | workspace | main.ts:7634 | gh comment in main.ts | **none** | as row 39: the module has no test either |
| 44 | `graphe:stop-asking` | conversation | main.ts:8000 | `sessionAt()` → `.stopAsking()` | **module-only** | `tests/adapter.test.ts`; channel itself untested |
| 45 | `graphe:go-as-far-as` | conversation | main.ts:8043 | `sessionAt()` → rung | **module-only** | `tests/adapter.test.ts`; channel itself untested |
| 46 | `graphe:set-plan-mode` | conversation | main.ts:8065 | session / `held.planMode` (`src/agent/plan.ts`) | **module-only** | `tests/plan.test.ts`; channel itself untested |
| 47 | `graphe:running` | conversation | main.ts:8011 | `sessionAt()` → `.running` | **module-only** | `tests/adapter.test.ts`; channel itself untested |
| 48 | `graphe:running-said` | conversation | main.ts:8017 | `sessionAt()` → `.runningSaid()` | **module-only** | `tests/adapter.test.ts`; channel itself untested |
| 49 | `graphe:page-said` | none | main.ts:8027 | `saidFrom()` + `src/work/commands-ran.ts` | **none** | `tests/commands-ran.test.ts` `it('is in all five places')` |
| 50 | `graphe:stop-running` | conversation | main.ts:8033 | `sessionAt()` + `Running` `src/agent/running.ts` | **module-only** | `tests/fleet.test.ts` drives `Running`; channel itself untested |
| 51 | `graphe:tidy-now` | conversation | main.ts:7987 | `workingAt()` `:1975` → session tidy | **module-only** | `tests/adapter.test.ts`; channel itself untested |
| 52 | `graphe:skills` | none | main.ts:9336 | `availableSkills()` `src/agent/pi/skills.ts:133` | **none** | no test imports `src/agent/pi/skills.ts` |
| 53 | `graphe:skill-text` | none | main.ts:10811 | `skillNamed()` `src/agent/pi/skills.ts:159` | **none** | as row 52: no test imports `src/agent/pi/skills.ts` |
| 54 | `graphe:open-skill-file` | none | main.ts:7948 | `skillNamed()` + `shell.openPath` | **none** | as row 52: no test imports `src/agent/pi/skills.ts` |
| 55 | `graphe:workflows` | none | main.ts:9387 | `availableWorkflows()` `src/agent/pi/workflows.ts:48` | **none** | no test imports it |
| 56 | `graphe:always-does` | workspace | main.ts:9365 | `alwaysFile()`/`rowsFrom()` `src/work/always.ts` | **source-text** | `tests/always-wired.test.ts` `it('lets the window read them, fresh each time')`; module `tests/always.test.ts` |
| 57 | `graphe:always-write` | workspace | main.ts:9376 | `rowsAsGiven()` + write | **source-text** | `tests/always-wired.test.ts` `it('lets the window write the whole list back, atomically')` |
| 58 | `graphe:watch-browser` | project | main.ts:9344 | `watchTheBrowser()` `:2982` | **source-text** | `tests/always-wired.test.ts` `it('takes the next one only once the last has arrived')`; renderer side `tests/preview-live.test.ts` |
| 59 | `graphe:browser-frame` | project | main.ts:3016 | — | **source-text** | `tests/always-wired.test.ts` `it('has the shell take the pictures, not the window')` |
| 60 | `graphe:branch-switch` | workspace | main.ts:9413 | `checkoutEntryFor`/`folderFor`/`timelineFor` `:3111/:3164/:3175` | **source-text** | `tests/multiroot-wired.test.ts`; module `tests/history.test.ts` |
| 61 | `graphe:branch-create` | workspace | main.ts:9493 | `checkoutEntryFor`/`folderFor`/`timelineFor` `:3111/:3164/:3175` | **source-text** | `tests/multiroot-wired.test.ts`, and `tests/history.test.ts` for the timeline module |
| 62 | `graphe:fetch-origin` | workspace | main.ts:9455 | `timelineFor()` → fetch | **source-text** | `tests/fetch-wired.test.ts` `it('runs git through the timeline layer, in the folder the call names')` |
| 63 | `graphe:fast-forward` | workspace | main.ts:9470 | `timelineFor()` + `stillWriting()` | **source-text** | `tests/fetch-wired.test.ts` `it('will not fast-forward under files that are still being written')` |
| 64 | `graphe:worktree-land` | workspace | main.ts:9543 | `landTheCopy()` `:9439` → `landWorktree()` `src/history/worktree.ts:281` | **source-text** | `tests/multiroot-wired.test.ts`; module `tests/scenarios/merge-safety.test.ts` |
| 65 | `graphe:worktree-drop` | workspace | main.ts:9680 | `checkoutEntryFor`/`childRepoFor` + `dropWorktree` | **module-only** | `tests/worktree.test.ts` `it('throws the checkout and its branch away')`; channel itself untested |
| 66 | `graphe:checkouts` | project | main.ts:9718 | `copiesOfProject()` `:4101` → `readGitStatus()` `src/lib/gitstatus.ts` | **module-only** | `tests/gitstatus.test.ts`; channel itself untested |
| 67 | `graphe:checkout-front` | project | main.ts:9731 | `copyNamed()` `:9580` (closure in `register()`) | **none** | nothing tests it |
| 68 | `graphe:checkout-look` | workspace | main.ts:9766 | `checkoutForReview()` `:4413` → `ProjectHistory` `src/history/repo.ts:357` | **module-only** | `tests/operations/file-operations.test.ts`; channel itself untested |
| 69 | `graphe:checkout-land` | project | main.ts:9781 | `copyNamed()` + `landTheCopy()` | **module-only** | `tests/worktree.test.ts` (`landWorktree`); channel itself untested |
| 70 | `graphe:checkout-put-away` | project | main.ts:9799 | `copyNamed()` + put-away (`src/history/worktree.ts`) | **module-only** | `tests/stale-checkouts.test.ts`; channel itself untested |
| 71 | `graphe:pr-worktree-prepare` | workspace | main.ts:10132 | `preparePrWorktree()` `electron/prWorktree.ts:439` | **module-only** | `tests/scenarios/pr-review.test.ts` `it('opens the new snapshot and leaves the old checkout where it is')` |
| 72 | `graphe:worktree-plan` | project | main.ts:8807 | `planForNewWorktree()` `:3802` | **module-only** | `tests/worktree.test.ts`; channel itself untested |
| 73 | `graphe:setup-files` | project | main.ts:8819 | `setupHereOf()` + `src/projects/setup.ts` | **module-only** | `tests/setup.test.ts` `it('puts what is already chosen first, and leaves folders and the sample out')` |
| 74 | `graphe:setup-choose` | project | main.ts:8832 | `choosingSetupFiles()` `src/projects/setup.ts:61` | **module-only** | `tests/setup.test.ts`; channel itself untested |
| 75 | `graphe:setup-install` | project | main.ts:8857 | `installPlanFor()` + run | **module-only** | `tests/setup.test.ts` `it('runs the plan in the checkout and reports running, then done')` |
| 76 | `graphe:setup-state` | project | main.ts:8872 | run record (`src/history/seeding.ts`) | **module-only** | `tests/setup.test.ts`; channel itself untested |
| 77 | `graphe:terminal-open` | process | main.ts:8740 | `terminals.open()` `electron/services/terminal.ts:87` | **module-only** | `tests/scenarios/terminal.test.ts` `it('carries characters outside ASCII through in both directions, whole')` |
| 78 | `graphe:terminal-scrollback` | process | main.ts:8765 | `terminals.scrollback()` | **module-only** | `tests/scenarios/terminal.test.ts` `it('keeps what it printed up to a bound, so a window opened late can still be read')` |
| 79 | `graphe:terminal-write` | process | main.ts:8770 | `terminals.write()` | **module-only** | `tests/scenarios/terminal.test.ts` `it('passes a bracketed paste through byte for byte, in one payload')` |
| 80 | `graphe:terminal-resize` | process | main.ts:8777 | `terminals.resize()` | **module-only** | `tests/scenarios/terminal.test.ts` `it('takes a resize, clamps a nonsense one, and still works afterwards')` |
| 81 | `graphe:terminal-close` | process | main.ts:8785 | `terminals.close()` | **module-only** | `tests/scenarios/terminal.test.ts` `it('ends the shell and forgets it, so nothing can write to it afterwards')` |
| 82 | `graphe:terminal-list` | project | main.ts:8792 | `canonical()` `electron/services/workspace-registry.ts:123` | **module-only** | `tests/scenarios/terminal.test.ts`; channel itself untested |
| 83 | `graphe:terminal-data` | process | main.ts:5674 | `Terminals` chunk callback `:5629` | **module-only** | `tests/scenarios/terminal.test.ts`; the push itself untested |
| 84 | `graphe:terminal-exit` | process | main.ts:5679 | `Terminals` exit callback `:5629` | **module-only** | `tests/scenarios/terminal.test.ts` drives `Terminals`; this push itself is untested |
| 85 | `graphe:conversation-continue` | conversation | main.ts:8591 | `conversationAt()` `:1965` + `openingFor()` `src/agent/pi/conversations.ts` | **module-only** | `tests/conversations.test.ts`; channel itself untested |
| 86 | `graphe:conversation-fork` | conversation | main.ts:8628 | `conversationAt()` + `workspaceForConversation()` | **module-only** | `tests/scenarios/conversation-ownership.test.ts`; channel itself untested |
| 87 | `graphe:conversation-archive` | conversation | main.ts:8717 | archive flag on disk (`src/agent/pi/conversations.ts`) | **module-only** | `tests/conversations.test.ts`; channel itself untested |
| 88 | `graphe:extension-ask` | run | main.ts:5632 | `dialogsOver()` `src/agent/pi/extension-ui.ts` | **module-only** | `tests/scenarios/extensions.test.ts` `it('reads an unanswered select as nothing chosen, and an unanswered confirm as no')`; the push itself untested |
| 89 | `graphe:extension-answer` | run | main.ts:8564 | `addonAsks` `:8519` + extension-ui | **module-only** | `tests/scenarios/extensions.test.ts`; channel itself untested |
| 90 | `graphe:worktree-new` | workspace | main.ts:8886 | `startInNewWorktree()` `:3720` → `createWorktree()` `src/history/worktree.ts:226` | **module-only** | `tests/worktree.test.ts` `it('makes a separate checkout on its own branch, starting at HEAD')` |
| 91 | `graphe:pr-review-open` | workspace | main.ts:10160 | `preparePrWorktree()` + registration | **module-only** | `tests/scenarios/pr-review.test.ts`; channel itself untested |
| 92 | `graphe:review-queue` | project | main.ts:9816 | `reviewRows()` `:4432` → `src/work/reviewqueue.ts` | **module-only** | `tests/reviewqueue.test.ts` `it('takes an arrival in, unread')` |
| 93 | `graphe:review-open` | conversation | main.ts:9824 | `checkoutForReview()` + `markRead` | **module-only** | `tests/reviewqueue.test.ts` `it('reading one is not deciding about it: it stays in the queue')` — boundary row (inventory 91) |
| 94 | `graphe:review-choose` | project | main.ts:9846 | `saveReviewQueue()` `:4227` + `chooseFile()` | **module-only** | `tests/reviewqueue.test.ts` `it('holds one file back out of an entry that is otherwise taken')` — boundary row (inventory 92) |
| 95 | `graphe:review-decide` | conversation | main.ts:9878 | `decide` (src/work/reviewqueue.ts:296), `withoutEntry` (339) | **module-only** | `tests/reviewqueue.test.ts` 'takes it off the list whichever way it goes'; channel untested |
| 96 | `graphe:review-land` | conversation | main.ts:9925 | `landsAsOneCommit` (src/work/reviewqueue.ts:332); `landWorktree` (src/history/worktree.ts) | **module-only** | `tests/board-to-review.test.ts` 'cannot keep every version, because there is no branch to bring across'; channel untested |
| 97 | `graphe:review-pr` | conversation | main.ts:9997 | `filesToTake` (src/work/reviewqueue.ts:281); `ghOpenPr` (main.ts:4530) | **module-only** | `tests/reviewqueue.test.ts` 'takes every file when the whole entry is taken'; channel untested |
| 98 | `graphe:conflict-look` | conversation | main.ts:10051 | `readConflict` (src/diff/conflict.ts:122) | **module-only** | `tests/conflict.test.ts` (imports diff/conflict); channel untested |
| 99 | `graphe:conflict-settle` | project | main.ts:10106 | `insideProject` (main.ts:4497), `readConflict` | **module-only** | `tests/conflict.test.ts`; channel untested |
| 100 | `graphe:build-start` | conversation | main.ts:10498 | `src/work/buildplan.ts` (`readStored`:381, `replaceKeepingTicks`:353) | **module-only** | `tests/buildplan.test.ts` (imports buildplan); channel untested |
| 101 | `graphe:build-plan` | conversation | main.ts:10473 | `readStored` (src/work/buildplan.ts:381), `progress` | **module-only** | `tests/buildplan.test.ts`; channel untested |
| 102 | `graphe:build-advance` | conversation | main.ts:10563 | `tickStep`/`startStep`/`skipStep` (src/work/buildplan.ts) | **module-only** | `tests/buildplan.test.ts`; channel untested |
| 103 | `graphe:build-save` | conversation | main.ts:10531 | `replaceKeepingTicks` (src/work/buildplan.ts:353) | **module-only** | `tests/buildplan.test.ts`; channel untested |
| 104 | `graphe:build-cancel` | conversation | main.ts:10587 | `readStored` (src/work/buildplan.ts:381) | **module-only** | `tests/buildplan.test.ts`; channel untested |
| 105 | `graphe:apps-here` | app | main.ts:7883 | `findEditors`/`findTerminals` (src/shell/editors.ts:118,123); `editorsHere` (main.ts:2119) | **module-only** | `tests/editors.test.ts` 'finds every known editor, in the order they are preferred'; the channel itself is only asserted as text (`tests/editors.test.ts:78` expects main.ts to contain `CHANNEL.appsHere`) |
| 106 | `graphe:set-opens-in` | app | main.ts:7891 | `PreferenceFile.change` (src/projects/preferences.ts:354) | **module-only** | `tests/advisor.test.ts` (imports PreferenceFile); channel untested |
| 107 | `graphe:set-preference` | app | main.ts:7904 | `onePreference` (local) + `PreferenceFile.change` | **module-only** | `tests/advisor.test.ts`; channel untested |
| 108 | `graphe:goal-load` | conversation | main.ts:10752 | `GoalFile.read` (src/projects/goals.ts:27) | **module-only** | `tests/goal-wiring.test.ts` 'reads back what was written at the same address, and nothing at another'; the handler's own block is asserted only as source text ('loads at the address, and refuses when there is no conversation') |
| 109 | `graphe:goal-save` | conversation | main.ts:10770 | `GoalFile.write` (src/projects/goals.ts:27) | **module-only** | `tests/goal-wiring.test.ts` 'clears one conversation without clearing the other'; handler block source-text only ('saves at the address rather than at the project') |
| 110 | `graphe:goal-clear` | conversation | main.ts:10784 | `GoalFile.clear` (src/projects/goals.ts:27) | **module-only** | `tests/goal-wiring.test.ts` 'gives two conversations in one project two files'; handler block source-text only |
| 111 | `graphe:goal-verify` | workspace | main.ts:10794 | `verifyGoal` (src/work/goal.ts:146) | **module-only** | `tests/goal-wiring.test.ts` exercises `src/work/goal.ts` (`goalStorageKey`, 'keys by conversation where there is one'); `verifyGoal` itself and the channel are untested |
| 112 | `graphe:choose-document` | none | main.ts:10481 | `dialog.showOpenDialog` (Electron) | **none** | a native picker; nothing in tests/ touches it |
| 113 | `graphe:conversations` | project | main.ts:9257 | `conversationsInProject` (main.ts:3330) → `listAllConversations` (src/agent/pi/adapter.ts:1645) | **module-only** | `tests/adapter.test.ts` (imports adapter); channel untested |
| 114 | `graphe:open-conversation` | conversation | main.ts:8523 | `startConversation` (main.ts:4643), `openingFor` (src/agent/pi/conversations.ts:103) | **behavioural** | `tests/electron/smoke.test.ts` 'holds two conversations in one project, and says so when nothing can answer' — pressing `.shelf__new` opens a second conversation in the real shell and the tab appears |
| 115 | `graphe:close-conversation` | conversation | main.ts:8907 | `Sessions.close` (src/domain/conversations.ts:148) | **module-only** | `tests/close-is-a-view.test.ts` (imports Sessions); channel untested |
| 116 | `graphe:delete-conversation` | conversation | main.ts:8932 | `moveToTrash` (electron/services/trash.ts:31) | **module-only** | `tests/trash.test.ts` 'is moved out of the sessions folder and kept, whole'; channel untested (the under-sessions refusal is named untestable in `tests/operations/ipc-arguments.test.ts`'s header) |
| 117 | `graphe:keep-attachments` | app | main.ts:9002 | `keep` (electron/services/attachment-store.ts:172) | **module-only** | `tests/attachment-store.test.ts` 'names a file by what is in it, not by what it is called'; channel untested |
| 118 | `graphe:attachment-copy` | app | main.ts:9039 | `copyOf` (electron/services/attachment-store.ts:255) | **module-only** | `tests/attachment-store.test.ts` 'hands the original bytes back by id, and nothing for anything else'; channel untested |
| 119 | `graphe:trash-list` | app | main.ts:9047 | `listTrash` (electron/services/trash.ts:108) | **module-only** | `tests/trash.test.ts` 'says what is in it, when it went and how big, newest first'; channel untested |
| 120 | `graphe:trash-restore` | app | main.ts:9063 | `restoreFromTrash` (electron/services/trash.ts:149) | **module-only** | `tests/trash.test.ts` 'puts one back under the name the shell wrote it under'; channel untested |
| 121 | `graphe:trash-empty` | app | main.ts:9084 | `emptyTrash` (electron/services/trash.ts:184) | **module-only** | `tests/trash.test.ts` 'empties exactly what it was told to, and says what went'; channel untested |
| 122 | `graphe:page-at` | project | main.ts:11467 | `pageNamed` (main.ts:1096), `pageView`/`showTheWorkOnPage` (main.ts:1018) | **none** | the one `WebContentsView` is only reachable inside a running shell; `tests/preview-tabs.test.ts` drives the renderer's tab model, never this channel |
| 123 | `graphe:page-hidden` | project | main.ts:11520 | `pageNamed` (main.ts:1096), `pageView.setVisible` | **none** | same: nothing in tests/ drives the page view's visibility |
| 124 | `graphe:packages` | app | main.ts:9186 | `packageShelf` (src/agent/pi/packages.ts:421) | **module-only** | `tests/packages.test.ts` 'reads a real registry answer into additions'; the shelf's own browse path is untested |
| 125 | `graphe:add-package` | app | main.ts:9198 | `shelved.add` (src/agent/pi/packages.ts:421) | **none** | no test drives `Shelf.add` — `tests/packages.test.ts` covers the catalogue reader only; `tests/package-activation.test.ts` never calls the shelf |
| 126 | `graphe:remove-package` | app | main.ts:9231 | `shelved.remove` (src/agent/pi/packages.ts:421) | **none** | as `add-package`: no test drives `Shelf.remove` (`src/agent/pi/packages.ts:421`) |
| 127 | `graphe:stop-package` | app | main.ts:9248 | `Shelf.stop()` `src/agent/pi/packages.ts:619` | **none** | arrived during this pass: declared `src/lib/ipc.ts:1574`, exposed `electron/preload.ts:967`, handled `electron/main.ts:9248` → `Shelf.stop()` `src/agent/pi/packages.ts:619`. No test, no row in the older inventory |
| 128 | `graphe:connection` | app | main.ts:11170 | `connection` (src/agent/pi/adapter.ts:1326) | **module-only** | `tests/adapter.test.ts` (imports adapter); channel untested |
| 129 | `graphe:connect` | app | main.ts:11193 | `connectToProvider` (src/agent/pi/adapter.ts:1796) | **module-only** | `tests/adapter.test.ts`; channel untested |
| 130 | `graphe:connect-answer` | app | main.ts:11223 | `pendingPrompts` map (local closure) | **none** | the login dialogue is a closure inside the Electron entry; `tests/operations/ipc-arguments.test.ts`'s header names this class of case as provable only in a real process |
| 131 | `graphe:cancel-connect` | app | main.ts:11233 | `connecting?.abort()` (adapter controller) | **module-only** | `tests/adapter.test.ts`; channel untested |
| 132 | `graphe:disconnect` | app | main.ts:11238 | `disconnectProvider` (src/agent/pi/adapter.ts:1810) | **module-only** | `tests/adapter.test.ts`; channel untested |
| 133 | `graphe:select-model` | app | main.ts:11254 | `PreferenceFile.change` (src/projects/preferences.ts:354) + sessions | **module-only** | `tests/advisor.test.ts` (imports PreferenceFile); channel untested |
| 134 | `graphe:select-advisor` | app | main.ts:11309 | `PreferenceFile.change` + sessions loop | **module-only** | `tests/advisor.test.ts`; channel untested |
| 135 | `graphe:set-advisor-thinking` | app | main.ts:11341 | `PreferenceFile.change` + sessions loop | **module-only** | `tests/advisor.test.ts`; channel untested |
| 136 | `graphe:set-advisor-gate` | app | main.ts:11358 | `PreferenceFile.change` + sessions loop | **module-only** | `tests/advisor.test.ts`; channel untested |
| 137 | `graphe:set-addons` | app | main.ts:11374 | `PreferenceFile.change` | **module-only** | `tests/advisor.test.ts`; channel untested |
| 138 | `graphe:set-thinking` | conversation | main.ts:11400 | `PreferenceFile.change` + `sessionAt` (main.ts:1968) | **module-only** | `tests/advisor.test.ts`; channel untested |
| 139 | `graphe:spend-split` | project | main.ts:11431 | `held.spend.ledger.summary()` (src/cost/recorder.ts) | **module-only** | `Ledger.summary()` is behavioural in `tests/cost.test.ts:288`; the channel's own read is untested |
| 140 | `graphe:token-usage` | app | main.ts:11440 | `readTokenUsage` (electron/tokens.ts:118) | **module-only** | `tests/token-transcripts.test.ts` 'reads the usage blocks out of the sessions in the window'; channel untested |
| 141 | `graphe:export-spend` | none | main.ts:11446 | `writeAtomically` (src/lib/atomic.ts:27) + `dialog.showSaveDialog` | **none** | `tests/atomic.test.ts` (imports atomic); the save-dialog half is untestable and the channel itself is untested |
| 142 | `graphe:spend-limit` | app | main.ts:11527 | `fleet.ceiling` (src/cost/fleet.ts) | **module-only** | `tests/after.test.ts` (imports Fleet); channel untested |
| 143 | `graphe:set-spend-limit` | app | main.ts:11531 | `fleet.hold` (src/cost/fleet.ts) + `PreferenceFile.change` | **module-only** | `tests/after.test.ts` (imports Fleet); channel untested |
| 144 | `graphe:connect-step` | push | main.ts:7349 | `sendConnectStep` (local) | **none** | nothing in tests/ subscribes to or asserts this push |
| 145 | `graphe:discovered-accounts` | app | main.ts:11568 | `discoveredAccounts` (src/agent/pi/adapter.ts:1828) | **module-only** | `tests/adapter.test.ts`; channel untested |
| 146 | `graphe:import-account` | app | main.ts:11579 | `importAccount` (src/agent/pi/adapter.ts:1860) | **module-only** | `tests/adapter.test.ts`; channel untested |
| 147 | `graphe:open-link` | none | main.ts:11554 | `shell.openExternal` | **none** | opens a person's own browser; nothing in tests/ drives it |
| 148 | `graphe:set-keep-logins` | project | main.ts:8151 | `keepsLogins` (src/projects/logins.ts:13), `forgetLogins` (src/agent/pi/computer.ts:856) | **module-only** | `keepsLogins` is behavioural in `tests/logins.test.ts` (`it("is one project’s answer and never another’s")`); the channel and `forgetLogins` are untested |
| 149 | `graphe:set-computer-use` | app | main.ts:8163 | `asComputerUse` (src/work/computeruse.ts), `syncComputerUse` (main.ts:2108) | **module-only** | `tests/computeruse.test.ts` 'reads back defensively, so a hand-edited file cannot grant itself more'; channel untested |
| 150 | `graphe:computer-status` | app | main.ts:8173 | `stat('/Applications/Microsoft Excel.app')` | **none** | a filesystem probe on this machine; no test |
| 151 | `graphe:open-computer-settings` | none | main.ts:8180 | `shell.openExternal` (System Settings URLs) | **none** | outside the app; no test |
| 152 | `graphe:set-theme` | app | main.ts:8192 | `themeFrom` (src/lib/theme.ts) + `PreferenceFile.change` | **module-only** | `tests/theme.test.ts` 'falls back to following the computer on anything it cannot read'; channel untested |
| 153 | `graphe:set-appearance` | app | main.ts:11384 | `readAppearance` (src/design/appearance.ts:347) | **module-only** | `tests/appearance.test.ts` (imports design/appearance); channel untested |
| 154 | `graphe:own-styles` | app | main.ts:11394 | `readFile` of `userData/graphe.css` | **none** | one file read; no test |
| 155 | `graphe:connected-look` | project | main.ts:8204 | `readMcpConfig` (src/agent/pi/mcp.ts:513), `inProject` (580), `connectedNow` (local) | **module-only** | `tests/scenarios/mcp.test.ts` exercises `src/agent/pi/mcp.ts`; the channel itself is untested |
| 156 | `graphe:connected-check` | project | main.ts:8210 | `checkServer` (src/agent/pi/mcp.ts:695) | **module-only** | `tests/scenarios/mcp.test.ts` 'is reported as working or not by a check that answers'; channel untested |
| 157 | `graphe:connected-save` | project | main.ts:8221 | `writeMcpConfig` (src/agent/pi/mcp.ts:662) | **module-only** | `tests/scenarios/mcp.test.ts` and `tests/operations/mcp-lifecycle.test.ts`; channel untested |
| 158 | `graphe:take-back-queue` | conversation | main.ts:8325 | `takeBackFromTheFolder` (local), `takingBack` (src/agent/pi/adapter.ts:833) | **module-only** | `takingBack` is behavioural in `tests/adapter.test.ts:946`; the channel is untested |
| 159 | `graphe:changes-look` | workspace | main.ts:8266 | `ProjectHistory.diffFor` (src/history/repo.ts:357) | **module-only** | `tests/after.test.ts` (imports ProjectHistory); channel untested |
| 160 | `graphe:changes-wider` | workspace | main.ts:8279 | `ProjectHistory.diffWider` (src/history/repo.ts:357) | **module-only** | `tests/checkpoint-safety.test.ts` (imports ProjectHistory); channel untested |
| 161 | `graphe:changes-drop` | workspace | main.ts:8292 | `timelineFor` (main.ts:3174), `ProjectHistory` | **module-only** | `tests/drop-changes.test.ts` (imports ProjectHistory); channel untested |
| 162 | `graphe:away` | project | main.ts:8348 | `awayNow` (local) → `Unattended` (src/work/unattended.ts:99) | **module-only** | `tests/unattended.test.ts` 'writes the question down and answers nothing'; channel untested |
| 163 | `graphe:keep-going` | project | main.ts:8358 | `keepGoing` (local) + board (`src/work/board.ts`) | **module-only** | `tests/unattended.test.ts`, `tests/board.test.ts`; channel untested |
| 164 | `graphe:stop-away` | project | main.ts:8367 | `Unattended.stop` (src/work/unattended.ts:99) | **module-only** | `tests/unattended.test.ts` 'is safe to stop twice'; channel untested |
| 165 | `graphe:keep-away` | project | main.ts:8417 | `Workbench.keep` (src/history/attempts.ts:360) | **module-only** | `tests/board-landed.test.ts` (imports Workbench); channel untested |
| 166 | `graphe:answer-away` | project | main.ts:8469 | `Unattended.answer` (src/work/unattended.ts:99) | **module-only** | `tests/unattended.test.ts` 'passes yes through exactly once, and only when a person said it'; channel untested |
| 167 | `graphe:say-to-away` | project | main.ts:8500 | `run.session.steer` (src/agent/pi/adapter.ts) | **module-only** | `tests/adapter.test.ts`; channel untested |
| 168 | `graphe:away-changed` | push | main.ts:6498 | `pushAway` (local) → `awayNow`/`Unattended` | **module-only** | `tests/unattended.test.ts` tests the board's words, not this send; the push itself is untested |
| 169 | `graphe:build-plan-changed` | push | main.ts:10435 | `pushBuildPlan` (local) | **module-only** | `tests/buildplan.test.ts`; the push itself is untested |
| 170 | `graphe:continuation` | push | main.ts:5420 | `continuationOwner` tell (electron/continuation-owner.ts:116) | **module-only** | `tests/continuation-owner.test.ts` 'says out loud what it is doing, and tells the window'; the send site is untested |
| 171 | `graphe:newer-version` | push | main.ts:6120 | `watchForANewerOne` (local) | **source-text** | `tests/newer-build.test.ts` 'has a channel of its own rather than a thread line' asserts `main.ts` contains the send; nothing drives it |
| 172 | `graphe:app-notices` | app | main.ts:10622 | `whatIsMissing` (local, main.ts ~6004) | **source-text** | `tests/project-context.test.ts:194` asserts `main.ts` contains `CHANNEL.appNotices`; nothing drives the read |
| 173 | `graphe:app-notice` | push | main.ts:6064 | local notice send | **source-text** | `tests/project-context.test.ts:194` asserts the send is in `main.ts`; the push itself is untested |
| 174 | `graphe:from-menu` | push | main.ts:5984 | `withMenuClicks` (local) | **none** | no test presses a menu item; `tests/actions.test.ts` covers the renderer's action registry only |
| 175 | `graphe:events` | push | main.ts:848 | `send`/wire batcher (main.ts:843), `batcher` (src/lib/batching.ts) | **behavioural** | `tests/electron/smoke.test.ts` 'shows a reply arriving in pieces, in the order they were sent' — the streamed reply reaches the window through this push and is asserted on screen |
| 176 | `graphe:diagnostics` | app | main.ts:10611 | `gather`/`saysDiagnostics` (electron/diagnostics.ts:55,147) | **module-only** | `tests/diagnostics.test.ts` 'keeps what it was handed'; channel untested |
| 177 | `graphe:app-version` | app | main.ts:10613 | `app.getVersion()` | **none** | Electron API; no test |
| 178 | `graphe:long-jobs` | app | main.ts:10628 | `readFile` of `userData/models/<id>.json` | **none** | no test |
| 179 | `graphe:addons` | project | main.ts:10646 | open sessions' add-on reports (`open.held.sessions.open`) | **none** | the list is drawn under test from a hand-made prop (`tests/settings-screen.test.ts:216`); the channel's own read of live sessions is untested |
| 180 | `graphe:keep-credential` | app | main.ts:10736 | `SecretFile.keep` (src/projects/secrets.ts:64) | **module-only** | `tests/secrets.test.ts` 'holds it for this run and hands it back on the next one'; channel untested |
| 181 | `graphe:storage` | app | main.ts:10681 | `measureFolders` (src/work/storage.ts:164), `whatToSweep` (88) | **module-only** | `tests/storage.test.ts` 'measures each folder it keeps, and reports a missing one as empty'; channel untested |
| 182 | `graphe:clear-folder` | app | main.ts:10700 | `folderNamed` (src/work/storage.ts:71), `canClear` (66) | **module-only** | `tests/disk.test.ts` (imports the storage helpers), `tests/storage.test.ts`; channel untested |
| 183 | `graphe:clear-finished-work` | app | main.ts:10724 | `whatToSweep` (src/work/storage.ts:88), `sweep` (210) | **module-only** | `tests/storage.test.ts` 'removes what it was given and reports what came back'; channel untested |
| 184 | `graphe:credentials-kept` | app | main.ts:10746 | `SecretFile.has`/`canKeep` (src/projects/secrets.ts:64) | **module-only** | `tests/secrets.test.ts` 'refuses to keep it rather than writing it down in the clear'; channel untested |
| 185 | `graphe:continuation-stop` | conversation | main.ts:10603 | `continuationOwner` (electron/continuation-owner.ts:116) | **module-only** | `tests/continuation-owner.test.ts` 'sends nothing once somebody has pressed Escape'; channel untested |

**Read against the revision above.** `electron/main.ts` at `ccde4df9ae35` (11 784 lines), still
being edited by two siblings while this was written; every line here was derived twice, at two
blobs, and agreed both times. `graphe:stop-package` arrived mid-pass and is row 127.

### Pushes, and what listens

The 16 push-only channels, in declaration order: `show-progress`, `window-state`, `pointed`,
`pane-key`, `browser-frame`, `terminal-data`, `terminal-exit`, `extension-ask`, `connect-step`,
`away-changed`, `build-plan-changed`, `continuation`, `newer-version`, `app-notice`, `from-menu`,
`events`. They have no handler by design: the shell sends them and the window subscribes with
`bridge.on…(…)`, which is a subscription rather than a call. A push row is graded by what the
window does with the arrival, which is why `events` is behavioural (the real-window streaming
test asserts the reply on screen) while the rest are `module-only` or `none`. `page-pointed` is
the odd one: it is listened for in `electron/main.ts:1580` from the page's own world, and
`graphe:event` is declared with no handler and nothing sending it — the older inventory reached
the same conclusion about that channel.

## 6. Background services

73 rows across the three places work happens without a person watching: `electron/services/**`
(7 files, the stores with real I/O), `src/work/**` (31 files, the decision and vocabulary code),
and `src/history/**` (12 files, the git-facing machinery). This is the best-covered kind in the
document — 67 of 73 behavioural — and the reason is structural: these are plain modules with
injected dependencies, so the tests drive them directly. The gaps are all at the same place:
**the launch, timer and quit sequences in `electron/main.ts`**, which no test drives because
they are closures inside the Electron entry. The section closes with those, each labelled by how
it is held today.

Four exports have no caller in production, and they want a decision rather than a test:
`roomHere` and `pressureNow` (`src/work/machine.ts:82`, `:127` — the board gate they served is
gone, and no test mentions them either), `saysWorkspace` (`electron/services/terminal.ts:246` —
behavioural cover in `tests/scenarios/terminal.test.ts`, no caller), the three carry-on helpers
(`src/work/carryon.ts:44`, `:61`, `:85` — reached only through `src/work/continuation.ts`), and
`whatIsLyingAround` (`electron/main.ts:6147`, which `tests/operations/storage-cleanup.test.ts:12`
says outright is not reachable from a test).

Read at the working tree as it stood when this ran. Blob hashes (`git hash-object <file> | cut -c1-12`):

`electron/services/` — attachment-store `5108e4882a03`, migration-service `a68424c674cd`, run-record `852064868988`, terminal `c3f4b8e225ce`, trash `0fb405aee41e`, workspace-locks `39aaf4529211`, workspace-registry `7d89aea39252`.
`src/work/` — admission `480d5e831ec9`, after `c2d05e1c0cff`, always `a18146ce7749`, board `61b6aa6f2fd7`, buildbrief `90748b7f2af5`, buildplan `28ae773e098a`, bytes `9ce03bfccee1`, capacity `b5a4bf768cfc`, carryon `a910d2aab966`, commands-ran `72ffc52aa4ad`, computeruse `2d8a017b881c`, continuation `66b221789284`, continuing `63cd97ad42e9`, copies `35df75018072`, goal `b89beb90a97a`, machine `8efdc01e74bf`, notebook `a706682b88ed`, notify `4ea3b154aa5d`, owner `c6399a2deaef`, ports `09bb2acb6b00`, pulls `266390356f95`, reviewqueue `a1ef0014aa49`, settingspages `7bd92eb1217b`, stack `7c8c730b368a`, storage `5eb137e437cf`, strays `f4ed3c533af6`, terminals `6a023d637302`, unattended `0bcdb1e12c30`, workflows `c85cc166d61c`, workspaces `356cc1fe8ab2`, written `6edd9b5bc478`.
`src/history/` — attempts `ea751c7206b1`, checkouts `b49223150f54`, graph `cd65ddc02528`, grouping `5c37a8b833b2`, naming `19f898d4ca4f`, newcopy `6ec7ba23220d`, opening `f47c30734ab0`, repo `7180ca88a398`, seeding `c5b2fb9ec763`, timeline `5d0146f51132`, titles `d0da7505a40d`, worktree `7637dd262852`.
`electron/main.ts` `dfc5cc2b3049`, `electron/continuation-owner.ts` `b587f178b0bd`.

## 1. `electron/services/**` (7 files)

| service or entry point | file:line | what starts it (caller) | owner | coverage | test |
|---|---|---|---|---|---|
| `keep()` — store an attachment's bytes by content | electron/services/attachment-store.ts:172 | IPC `attachKeep` — electron/main.ts:8972; also on send — main.ts:10800 | conversation | behavioural | tests/attachment-store.test.ts `it('names a file by what is in it, not by what it is called')` |
| `copyOf()` — original bytes back by id | attachment-store.ts:255 | IPC — main.ts:8979 | conversation | behavioural | tests/attachment-store.test.ts `it('hands the original bytes back by id, and nothing for anything else')` |
| `MAX_KEPT_BYTES` / `MAX_PER_CONVERSATION` / `contentId()` | attachment-store.ts:39, :44, :68 | the two rows above | conversation | behavioural | tests/attachment-store.test.ts `it('keeps the box’s own ceilings')` |
| `discover()` — plan the profile migration, read-only | electron/services/migration-service.ts:211 | app launch, `migrateWorkspacesOnce` main.ts:3374, called main.ts:11541 | app | behavioural | tests/migration.test.ts `it('keeps a local chat local, and keeps both isolated chats in their own folders')` |
| `commit()` — take the planned durable steps | migration-service.ts:551 | main.ts:3413 | app | behavioural | tests/migration.test.ts `it('resumes from whatever a crash left behind, after every durable step')` |
| `readMarker()` — has this version already run | migration-service.ts:404 | main.ts:3378 (skip-if-done) | app | behavioural | tests/operations/durable-state.test.ts `it('is nothing when it cannot be read')` |
| launch wiring `migrateWorkspacesOnce()` | electron/main.ts:3374 | app start — main.ts:11541 | app | module-only | tests/migration.test.ts drives `discover`/`commit`; no test drives the launch sequence, the marker check or the lock file |
| `readRunNotes()` | electron/services/run-record.ts:70 | app start, `readWhatWasRunning` main.ts:1940, called main.ts:11523 | run | behavioural | tests/session-states.test.ts `it('reads a file that will not parse as no runs, rather than throwing')` |
| `wroteRunNote()` | run-record.ts:104 | main.ts:1909 | run | behavioural | tests/session-states.test.ts `it('is a record while it is going, and gone the moment it ends')` |
| `tookRunNoteAway()` | run-record.ts:123 | main.ts:1952 | run | behavioural | tests/session-states.test.ts `it('hands the whole note back, project and all, once per conversation')` |
| `interruptedWords()` | run-record.ts:140 | main.ts:1949 | run | behavioural | tests/session-states.test.ts `it('reports it as interrupted, says so, and does not start it again')` |
| launch wiring `readWhatWasRunning()` | electron/main.ts:1938 | app start — main.ts:11523 | run | source-text | tests/close-is-a-view.test.ts:98 (`it('reads what was running before anything can open')`) |
| `Terminals.open/write/close` | electron/services/terminal.ts:139, :204, :227 | IPC — main.ts:8686 | workspace | behavioural | tests/scenarios/terminal.test.ts `it('carries characters outside ASCII through in both directions, whole')` |
| `Terminals.closeAll()` | terminal.ts:240 | app start main.ts:11530; before-quit | workspace | behavioural | tests/scenarios/terminal.test.ts:199 |
| `saysWorkspace()` | terminal.ts:246 | nothing outside the module calls it | — | none | internal-only: exported, imported only by tests/scenarios/terminal.test.ts |
| `moveToTrash()` | electron/services/trash.ts:31 | IPC delete — main.ts:8911 | conversation | behavioural | tests/trash.test.ts `it('is moved out of the sessions folder and kept, whole')` |
| `listTrash()` | trash.ts:108 | IPC — main.ts:8987 | conversation | behavioural | tests/trash.test.ts `it('says what is in it, when it went and how big, newest first')` |
| `restoreFromTrash()` (the undo) | trash.ts:149 | IPC — main.ts:9003 | conversation | behavioural | tests/trash.test.ts `it('puts one back under the name the shell wrote it under')` |
| `emptyTrash()` | trash.ts:184 | IPC — main.ts:9027 | conversation | behavioural | tests/trash.test.ts `it('empties exactly what it was told to, and says what it went')` |
| `TRASH_RULE` | trash.ts:55 | travels with `listTrash` | conversation | behavioural | tests/trash.test.ts `it('states the rule rather than leaving it to be guessed')` |
| `WorkspaceLocks.request/release/cancel` | electron/services/workspace-locks.ts:53 | constructed main.ts:5606; `request` main.ts:10755; `cancel` main.ts:5655 | workspace | behavioural | tests/workspace-locks.test.ts `it('queues the second run behind it, and says what it is waiting on')`; also tests/scenarios/writer-lease.test.ts:73 |
| registry — project identity: `ensureProject()` :263, `workspaceAtPath()` :329, `projectAtPath()` :249, `canonical()` :123 | electron/services/workspace-registry.ts | main.ts:3149, :3345, :3656 | workspace | behavioural | tests/workspace-registry.test.ts `it('is one project, not two')` |
| registry — `relinkProject()` | workspace-registry.ts:296 | imported main.ts:281–299; call site not traced | workspace | behavioural | tests/workspace-registry.test.ts `it('keeps its identity, and its old path as an alias, through an explicit relink')` |
| registry — verify/resume a copy: `verifyWorkspace()` | workspace-registry.ts:458 | imported main.ts:281–299; call site not traced | workspace | behavioural | tests/workspace-registry.test.ts `it('needs recovery when the folder is there but is not our worktree any more')` |
| registry — `addWorkspace()` :368, `markDeleted()` :489, `setRepoKey()` :433 | workspace-registry.ts | main.ts:3542 (`setRepoKey`) | workspace | behavioural | tests/workspace-registry.test.ts `it('is written once however many times it is added')`; tests/scenarios/recovery.test.ts `it('writes down a workspace as gone without losing which folder it was')` |
| registry — conversation link: `addConversation()` :551, `attachConversation()` :581, `workspaceForConversation()` :509, `conversationsOfProject()` :526, `conversationById()` :517 | workspace-registry.ts | main.ts:3656, :3606, :3149/:3615 | conversation | behavioural | tests/scenarios/conversation-ownership.test.ts `it('comes back to the same session, the same branch and the same folder')` |
| registry — index read/write: `parseIndex()` :155, `serializeIndex()` :239, `verdictOn()` :234, `emptyIndex()` :116 | workspace-registry.ts | main.ts:3524 (save) | workspace | behavioural | tests/operations/durable-state.test.ts `it('says so rather than reporting an empty profile')` |

## 2. `src/work/**` (31 files)

| service or entry point | file:line | what starts it (caller) | owner | coverage | test |
|---|---|---|---|---|---|
| `admit()` — may this turn begin | src/work/admission.ts:116 | every turn start: src/agent/pi/adapter.ts:3451; seam: electron/continuation-owner.ts:189, :271 | conversation | behavioural | tests/admission.test.ts `it('admits what somebody typed while a question is open and after a stop')` |
| `Following` — work waiting on other work (`hold` :150, `stopFollowing` :190, `take` :211) | src/work/after.ts:112 | away desk opens — main.ts:6230; `hold` main.ts:6936; `finished` main.ts:6814 | run | behavioural | tests/after.test.ts `it('holds the second back until the first lands, then asks for it')` |
| `alwaysFrom()` :77, `commandFor()` :107, `rowsFrom()` :173, `alwaysText()` :236, `alwaysFile()` :126 | src/work/always.ts | adapter import src/agent/pi/adapter.ts:57; window rows via main.ts:101 | project | behavioural | tests/always.test.ts `it('reads a file into the three moments')` |
| the three moments actually running (`runAlways`) | src/agent/pi/adapter.ts (`runAlways('afterEachChange', touched)`) | adapter, on turn end / open | project | source-text | tests/always-wired.test.ts:23 `it('runs at each of the three moments')` — asserts the adapter's source text only |
| `bandOf/orderWork/groupWork/nextUp/roomLeft/AT_A_TIME` | src/work/board.ts:215, :223, :232, :268, :256, :21 | electron/main.ts:376; src/components/Board.tsx:12 | project | behavioural | tests/board.test.ts `it('puts going, waiting and finished in their own bands')` |
| `asBuildRequest()` | src/work/buildbrief.ts:28 | src/App.tsx:5587 | conversation | behavioural | tests/buildplan.test.ts drives it (no `it` name read) |
| `readPlan/toMarkdown/nextOf/progress/addTasks/standing` | src/work/buildplan.ts:190, :149, :87, :93, :115, :133 | electron/main.ts:319 (plan panel, resume) | conversation | behavioural | tests/buildplan.test.ts (no `it` name read) |
| `saysBytes()` | src/work/bytes.ts:8 | src/components/Settings.tsx:6; re-exported through storage.ts | app | behavioural | tests/storage.test.ts `it('writes sizes the way a person reads them')` |
| `capsNow()` :118, `capsFor()` :81, `saysCaps()` :124 | src/work/capacity.ts | read on every fan-out: src/agent/research.ts:18, src/agent/running.ts:32, src/cost/fleet.ts:32, src/agent/pi/checks.ts:17, electron/diagnostics.ts:19; board.ts:21 and terminals.ts:70 take their cap at import | app | behavioural | tests/capacity.test.ts (no `it` name read) |
| `nextMove()` :61, `freshCarryOn()` :44, `carryOnPrompt()` :85 | src/work/carryon.ts | only through src/work/continuation.ts:19 — no caller outside src/work | conversation | behavioural | tests/carryon.test.ts `it('asks, and names the step it is picking up')` |
| `commandsRan()` :78, `commandIn()` :55, `tailOf()` :129, `serverTitle()` :136 | src/work/commands-ran.ts | src/components/Commands.tsx:27 | conversation | behavioural | tests/commands-ran.test.ts `it('keeps only the commands, oldest first')` |
| `asComputerUse()` :87, `isAppAllowed()` :181, `isExcelTarget()` :190, `siteReachable()` :210 | src/work/computeruse.ts | src/projects/preferences.ts:27; src/agent/guard/policy.ts:50 | app | behavioural | tests/computeruse.test.ts `it('matches an app by its name field, exactly')` |
| `decide()` — carry on, rest or stop | src/work/continuation.ts:210 | electron/continuation-owner.ts:32 (round loop) | conversation | behavioural | tests/continuation.test.ts `it('rests on a settled reply with no list, no goal and nothing waiting')` |
| `handoffMessage()` | src/work/continuing.ts:67 | src/components/Sidebar.tsx:7; electron/main.ts:272 | conversation | behavioural | tests/continuing.test.ts `it('says what was being made, where it got to, and which files it is in')` |
| `copiesFolder()` :55, `scratchFolder()` :77, `keyFor()` :46 | src/work/copies.ts | electron/main.ts:327; src/agent/pi/tools.ts:39 | workspace | behavioural | tests/copies.test.ts `it('keeps each kind apart, so clearing one never reaches another')` |
| `createGoal()` :74, `parseGoalCommand()` :119, `verifyGoal()` :146, `goalStorageKey()` :212 | src/work/goal.ts | src/hooks/useGoalChip.ts:32; src/projects/goals.ts:13; electron/main.ts:358 | conversation | behavioural | tests/goal.test.ts `it('starts active, at nought rounds, with full access')`; the goal channels are source-text — tests/goal-wiring.test.ts:70 |
| `howManyFit()` :70, `oneAtATime()` :144 | src/work/machine.ts | src/history/newcopy.ts:33 (installs) | app | behavioural | tests/machine.test.ts `it('never lets two run together')` |
| `roomHere()` :82, `pressureNow()` :127 | src/work/machine.ts | **no caller in `src/` or `electron/`** — the board gate they served is gone (comment at electron/main.ts:6222, src/work/capacity.ts:78) | app | none | tests/machine.test.ts covers the module's other exports; nothing calls these two |
| `Notebook.note()` :59, `noteNow()` :74, `everything()` :100, `forget()` :89 | src/work/notebook.ts:44 | electron/main.ts:379, `notes()` main.ts:5248; quit write at main.ts:7088 | run | behavioural | tests/operations/app-quit.test.ts `it('is on the disk by the time the call returns, with nothing left waiting')` |
| `howToTell()` :53, `badgeFor()` :70, `asTelling()` :34 | src/work/notify.ts | electron/main.ts:255–261, called main.ts:6467; src/projects/preferences.ts:29 | app | behavioural | tests/notify.test.ts `it('says nothing to somebody who is already looking at it')` |
| `keyOf()` :30, `ownerOf()` :35, `frontKey()` :47 | src/work/owner.ts | electron/continuation-owner.ts:34; src/lib/lookfirst.ts:15; src/App.tsx:89 | conversation | behavioural | tests/owner.test.ts `it('gives back the project and address it was made from')` |
| `PORTS_HELD` :106, `portFor()` :40, `portEnv()` :53, `Ports` :77 | src/work/ports.ts | src/agent/pi/adapter.ts:77 (one register per process); src/agent/running.ts:31 | workspace | behavioural | tests/ports.test.ts `it('is the same every time it is asked for')` |
| `markOf/chipsFor/listFor/rowSub/checkLine/issuePrompt/moveBy` | src/work/pulls.ts:36, :64, :55, :85, :94, :150, :143 | src/components/ReviewsView.tsx:15 | project | behavioural | tests/pulls.test.ts `it('reads the state whatever case github sent it in')` |
| `queueFrom()` :174, `decide()` :296, `waiting()` :234, `chooseFile()` :246, `saysEntry` | src/work/reviewqueue.ts | electron/main.ts:254; src/components/Waiting.tsx:3; src/components/ReviewQueue.tsx:17 | conversation | behavioural | tests/reviewqueue.test.ts `it('takes an arrival in, unread')`; the shell wiring is source-text — tests/review-queue-wired.test.ts:87 |
| `ROWS` :159, `rowsOn()` :483, `search()` :515, `settingsCommands()` :534 | src/work/settingspages.ts | src/components/Settings.tsx:43 | app | behavioural | tests/settingspages.test.ts `it('are the ten the app is split into')` |
| `orderToTake()` :190, `takeInOrder()` :299, `meetingsIn()` :268 | src/work/stack.ts | src/history/attempts.ts:22 (`Workbench.keepSet`) | project | behavioural | tests/stack.test.ts (no `it` name read) |
| `whatToSweep()` :88, `sweep()` :210, `measureFolders()` :164, `canClear()` :66, `folderNamed()` :71, `npmOnPath()` :237 | src/work/storage.ts | IPC storage channel — main.ts:10526, :10553, :10571; launch sweep main.ts:11543; quit sweep main.ts:11543 | app | behavioural | tests/storage.test.ts `it('never sweeps something still holding work, however old')`; tests/operations/storage-cleanup.test.ts:55 |
| the launch/quit sweep itself (`whatIsLyingAround → whatToSweep → sweep`) | electron/main.ts:11543–11548 | app start; and `before-quit` | app | none | no test drives it — tests/operations/storage-cleanup.test.ts:12 says the list-builder is unreachable from a test |
| `endStrays()` :137, `whichAreStray()` :65, `whichServersAreStray()` :86, `listRunningPrograms()` :115, `readRunning()` :45 | src/work/strays.ts | app start main.ts:11527 (`await endStrays()`), endStrayServers main.ts:3248/3251; before-quit kills | app | behavioural | tests/surviving.test.ts `it('ends one whose parent has gone')` (drive with injected look/end) |
| `openTerminal()` :234, `closeTerminal()` :262, `tabsFor()` :191, `titleFor()` :166, `TERMINAL_KEYS` :110 | src/work/terminals.ts | src/components/Commands.tsx:28 | workspace | behavioural | tests/terminals.test.ts `it('never lets the agent’s tab take a keystroke')` |
| `Unattended` :99, `saysNotice()` :233, `saysWhileAway()` :198 | src/work/unattended.ts | electron/main.ts:6591 (one per board piece), :6412, :6632 | run | behavioural | tests/unattended.test.ts `it('writes the question down and answers nothing')`; tests/operations/notifications.test.ts:40 |
| `commandWord()` :50, `readWorkflow()` :102, `promptFor()` :125, `workflowsFrom()` :136 | src/work/workflows.ts | src/agent/pi/workflows.ts:16; electron/main.ts:10717 | project | behavioural | tests/workflows.test.ts `it('takes the extension off the filename')` |
| `cardsFrom()` :129, `stateOf()` :110, `canLand()` :157, `saysCard()` :183 | src/work/workspaces.ts | electron/main.ts:204; the branches panel in the window | workspace | behavioural | tests/workspaces.test.ts `it('is working while the conversation is going')` |
| `onComingBack()` :91, `asPiece()` :109, `noteOf()` :126, `readWritten()` :196, `addSpend()` :160 | src/work/written.ts | electron/main.ts:387–395; `onComingBack` at main.ts:6995 (`pickUpWhereWeLeftOff`) | run | behavioural | tests/surviving.test.ts `it('leaves alone what something else is still looking after')` |

## 3. `src/history/**` (12 files)

| service or entry point | file:line | what starts it (caller) | owner | coverage | test |
|---|---|---|---|---|---|
| `Workbench` (`ask/keep/keepSet/drop`) :360, `HeldWork` :146, `folderForWork()` :344 | src/history/attempts.ts | electron/main.ts:361; `new Workbench` main.ts:6224 | project | behavioural | tests/attempts-many.test.ts `it('gives every piece of work its own copy of the project')` |
| `checkoutRow()` :29, `readCheckoutIndex()` :105, `validateCheckouts()` :77 | src/history/checkouts.ts | electron/main.ts:192, :328; `validateCheckouts` main.ts:4951; `readCheckoutIndex` main.ts:3966 | workspace | behavioural | tests/checkout-index.test.ts `it('keeps a row whose folder is not on disk, because that is a checkout put away')`; tests/stale-checkouts.test.ts:54 |
| `layOut()` | src/history/graph.ts:61 | src/components/HistoryView.tsx:94 | project | behavioural | tests/graph.test.ts `it('is no rows and no lines, but still a column wide')` |
| `groupVersions()` :129, `dayLabel()` :87, `looksTheSame()` :108 | src/history/grouping.ts | src/components/Versions.tsx:95; src/lib/shelf.ts:49 | project | behavioural | tests/versions-grouping.test.ts `it('starts a day at local midnight')` |
| `renameTo()` :128, `branchNameFor()` :93, `freeName()` :102, `slugFor()` :46, `isSafeBranchName()` :80 | src/history/naming.ts | electron/main.ts:3062 (first request renames the branch) | conversation | behavioural | tests/branch-naming.test.ts `it('lowercases and joins with dashes')` |
| `getReady()` :258, `carryOver()` :171, `whatToCarry()` :85, `piecesCommand()` :207 | src/history/newcopy.ts | electron/main.ts:77, called main.ts:6671; src/history/attempts.ts:13 | workspace | behavioural | tests/newcopy.test.ts `it('brings the keys across without being asked')` |
| `verdictFor()` :135, `refusedFolder()` :70, `sizeOf()` :94 | src/history/opening.ts | electron/main.ts:339, called main.ts:4930 (open folder) | project | behavioural | tests/opening.test.ts `it('refuses the home folder itself')` |
| `ProjectHistory` (`snapshot` :581, `restoreTo` :666, `dropChanges` :771, `hold`/`release` :864/:872), `trackedCredentials()` :243, `hintForLargeRepo()` :262 | src/history/repo.ts:357 | electron/main.ts:83; src/history/timeline.ts | project | behavioural | tests/history.test.ts `it('sets itself up the first time the project is opened')`; tests/credentials-never-saved.test.ts:99 |
| `seedCheckout()` :298, `seedFromChoices()` :133, `seedingCandidates()` :327, `installPlanAt()` :358, `installDependencies()` :395, `readSetupChoices()` :430, `chooseSetupFiles()` :443, `seededIn()` :484 | src/history/seeding.ts | electron/main.ts:193–203; called main.ts:3766, :8776, :8802 | workspace | behavioural | tests/checkout-seeding.test.ts `it('carries nothing until somebody says so')`; tests/setup.test.ts:43 |
| `Timeline` (`snapshot` :137, `restoreTo` :188) | src/history/timeline.ts:112 | electron/main.ts:82; opened main.ts:3176, :3183, :4767, :4942, :6704, :9477, :10057 | project | behavioural | tests/history.test.ts `it('titles a version with what the user asked for, in the past tense')`; tests/checkpoint-safety.test.ts:101 |
| `titleFor()` :501, `fromInstruction()` :471, `describeFiles()` :269, `goingBackTitle()` :513, `tidyName()` :520 | src/history/titles.ts | src/history/timeline.ts:144 | project | behavioural | tests/history.test.ts `it('turns what the user asked for into what happened')` |
| `createWorktree()` :226, `bringBack()` :738, `landWorktree()` :281, `dropWorktree()` :333, `putAwayWorktree()` :388, `holdsWork()` :409, `reopenWorktree()` :356, `blockingChanges()` :182 | src/history/worktree.ts | electron/main.ts:211–235; `bringBack` main.ts:9500, :9762, :9831 | workspace | behavioural | tests/worktree.test.ts `it('makes a separate checkout on its own branch, starting at HEAD')`; tests/merge-safety.test.ts, tests/stale-checkouts.test.ts |

## Started by app launch or a timer — does any test drive it?

Every one of these runs because `app.whenReady()` fired at electron/main.ts:11481; none of them is driven by a test end to end:

| what the launch does | site | who covers it, and how |
|---|---|---|
| reads runs that were interrupted | `readWhatWasRunning()` main.ts:1938, called :11523 | **source-text** — tests/close-is-a-view.test.ts:98 asserts the call sits between `whenReady` and `register()`; the module (`run-record`) is behavioural |
| ends orphaned helpers | `await endStrays()` main.ts:11527 | **module-only** — tests/surviving.test.ts:271 drives `endStrays` with injected look/end; the launch call is not asserted anywhere |
| ends terminals this app started | `terminals.closeAll()` main.ts:11530 | **behavioural** for `closeAll` — tests/scenarios/terminal.test.ts:199; not for the launch position |
| ends orphaned servers | `endStrayServers()` main.ts:3248, called :11533 | **module-only** — `whichServersAreStray` in tests/running.test.ts; the sweep itself, which reads the noted-server file, is untested |
| the workspace migration | `migrateWorkspacesOnce()` main.ts:3374, called :11541 | **module-only** — tests/migration.test.ts and tests/operations/durable-state.test.ts drive `discover`/`commit`/`readMarker`; nothing drives the launch, the lock file, or the marker skip at main.ts:3377 |
| sweeps stray checkouts | `sweepStrayCheckouts()` main.ts:3915 | **module-only** — `putAwayWorktree`/`holdsWork` in tests/stale-checkouts.test.ts; the sweep loop has no test |
| clears finished work | `whatIsLyingAround()` main.ts:6083 → `whatToSweep`/`sweep` main.ts:11543 | **none** — tests/operations/storage-cleanup.test.ts:12 states plainly that `whatIsLyingAround` is main-process code with an Electron import and is not reachable; the module functions are behavioural in tests/storage.test.ts |
| sweeps scratch older than a week | `sweepScratch()` main.ts:5797 | **source-text** — tests/scratch.test.ts:103 checks main.ts contains `SCRATCH_DAYS = 7` and `void sweepScratch();` |
| picks up background work from last time | `pickUpWhereWeLeftOff()` main.ts:6976, called :11547 | **source-text** for the ordering — tests/repo-panel.test.ts:122 matches `await pathIsWide();
 await pickUpWhereWeLeftOff`; the decisions it makes are behavioural (`onComingBack`, tests/surviving.test.ts:88) |
| polls for a newer release — **the only background timer** | `watchForANewerOne()` main.ts:6049; `setInterval(look, LOOK_FOR_A_NEWER_ONE_EVERY).unref()` main.ts:6067 | **source-text** — tests/newer-build.test.ts:33 slices the function out of main.ts; tests/operations/downloads-update-links.test.ts says the network half is out of reach |
| on quit: writes in-flight work down | `writeDownWhatWasGoing()` main.ts:7087 (called from `before-quit`, main.ts:11571) | **module-only** — tests/operations/app-quit.test.ts:83 drives `Notebook.noteNow`; its header says the ordering of the quit sequence itself is not held |
| on quit: stops everything away | `stopEverythingAway()` main.ts:7134 | **module-only** — `Unattended.stop()` is behavioural (tests/unattended.test.ts:227); the loop over desks is untested |
| the away/continuation round family | `continuationOwner` (electron/continuation-owner.ts, blob b587f178b0bd), constructed and driven from main.ts | **behavioural** — tests/continuation-owner.test.ts, tests/extension-turn.test.ts; the rounds themselves are decided in tests/continuation.test.ts and tests/carryon.test.ts |

## No exported entry point / internal only

- `electron/services/terminal.ts:246` `saysWorkspace()` — exported, but nothing in `src/` or `electron/` calls it; imported only by tests/scenarios/terminal.test.ts. Blob `c3f4b8e225ce`.
- `src/work/machine.ts:82` `roomHere()` and `:127` `pressureNow()` — exported, no caller anywhere outside the module (`grep` over `src/` and `electron/` finds only the definitions and the comment at src/work/capacity.ts:78). Blob `8efdc01e74bf`. Coverage `none`.
- `electron/main.ts:6083` `whatIsLyingAround()` — the list the launch sweep is built from; not reachable from a test (stated in tests/operations/storage-cleanup.test.ts:12). Blob `dfc5cc2b3049`. Coverage `none`.
- `src/work/carryon.ts:44/:61/:85` `freshCarryOn`/`nextMove`/`carryOnPrompt` — no caller outside `src/work`; reached only through src/work/continuation.ts:19 and the tests. Blob `a910d2aab966`.
- Not traced to a caller, so omitted as helpers rather than rowed: `src/history/worktree.ts:548` `sweepCheckouts()`, `:671` `sharedBase()`, `:432` `writingLeftBehind()`, `:144` `repoKeyOf()`, `:173` `sameRepository()`; `src/history/repo.ts:224` `excludePathspecs()`; `src/work/buildplan.ts` display helpers. If the handoff needs these, that is where to look.

## Method

I listed the three directories myself (7 + 31 + 12 files) and grepped every `^export` in them, then grepped `src/` and `electron/` for imports from `work/` and `history/` and for the construction sites of every class, so a row exists only where something outside the module calls the symbol. Coverage was decided by grepping `tests/` for each module's basename and reading the test file's own header and imports — `behavioural` means the test imports that module and asserts a result (the `it` names quoted above were read in this pass, never guessed), `source-text` means the only cover is a `readFileSync` of main.ts or a component (works.hooks without behavioural tests are called out by name), `module-only` means the backing module is tested but this entry's wiring is not, `none` means I found nothing. Owner follows the contract's vocabulary: conversation for per-chat stores, workspace for per-folder ones, run for the in-flight/board pieces, app for profile-wide services. Blob hashes above came from `git hash-object <file> | cut -c1-12` on the live tree, and every line number was read from that same revision — note that electron/main.ts is being edited by two sibling agents right now (blob dfc5cc2b3049), so any main.ts line here may move under you. Where I could not settle a caller I said so (registry `relinkProject`/`verifyWorkspace`, worktree's untraced helpers) rather than inventing one.

## 7. Rows in the older inventory that describe nothing

`docs/handoffs/ipc-inventory.md` is the document this section's channel half was built from, and
its row set has drifted **in both directions**. 29 of its 202 rows name channels `CHANNEL` no
longer declares — retired in phase 8, each with its production entry point, tool registration and
IPC route removed:

`variations-serve` (row 17), `version-pictures` (30), `flow-load`/`flow-save`/`flow-forget`
(103-105), `share-review` (114), `watch-start`/`watch-stop` (121-122), `visual-change`/
`visual-frames` (126-127), `landing` (148), `set-hold-back` (149), `set-how-much` (157),
`decide-on-work` (158), `hand-to-developer` (159), `put-online` (160), `away-everywhere` (169),
`start-after`/`put-after` (171-172), `compare-ways`/`keep-set`/`add-repeat`/`switch-repeat`/
`forget-repeat` (177-181), `in-step`/`follow-design`/`look-again`/`caught-up`/`stop-following`
(198-202).

In the other direction, the inventory **misses 11 live channels**: `setup-files`,
`setup-choose`, `setup-install`, `setup-state`, `keep-attachments`, `attachment-copy`,
`trash-list`, `trash-restore`, `trash-empty`, `app-notices`, `app-notice` — plus
`stop-package`, which arrived during this pass. Its handler line numbers are also several hundred
lines out (it was written against a shorter `electron/main.ts`).

What that document is still good for: the **scope, target, resolved-expression, mutation and
owner** columns for the channels it covers, which are a reading of the handler bodies rather than
a count, and the phase 5.4 finding that no unqualified mutation caller remains. What must not be
trusted from it: row count, row set, line numbers, and the callers column.

## Cross-cutting findings

Five things that are not about one surface's coverage:

- **A. The source-text assertion this document found red has since been deleted, and that is the
  right end for it.** At the revision read (11:23) `tests/always-wired.test.ts` pinned
  `expect(COMPOSER).toContain('aria-label="Ways of working"')` while
  `src/components/Composer.tsx:912` said `aria-label="Commands"`, renamed by the uncommitted copy
  pass: I ran that file and it failed (`1 failed | 9 passed`). Re-run at 11:39 it passes
  (10 passed) with `src/components/Composer.tsx` unchanged at `f4c22650df88`, so the assertion was
  removed rather than re-pinned — which is the plan's rule for an assertion that holds wording
  rather than behaviour, and is the same class the wave's own source-text review is deleting.
  The picker's behaviour remains held by `tests/extension-commands.test.ts`,
  `tests/composer-row.test.ts` and `tests/settings-screen.test.ts`. Recorded here because a
  coverage map that names a red test has to name it going green too. One other file in the same
  set, `tests/multiroot-wired.test.ts`, failed on the first run for the plain reason that a
  sibling was mid-edit in `electron/main.ts`; at the end of the pass all eleven `*-wired` files
  and the four purely source-text ones ran green (180 tests).
- **B. `docs/handoffs/ipc-inventory.md` no longer describes the tree.** 29 of its 202 rows name
  channels that do not exist, 11 live channels are missing from it, and its line numbers are
  hundreds of lines out. Section 7 lists the retired names. Its scope/owner/mutation columns are
  still the best reading of the handler bodies anywhere; its counts are not to be quoted.
- **C. A channel arrived while this was being written.** `graphe:stop-package`
  (`src/lib/ipc.ts:1574`, `electron/preload.ts:967`, handler `electron/main.ts:9248`) was added by
  a sibling mid-pass, with no test and no row in the older inventory. It is row 127 here.
- **D. One regex, two copies.** `leadingWord` (`src/agent/pi/commands.ts:56`) is tested, and its
  pattern is written out again by hand at `electron/main.ts:10855`, which is the copy that
  actually decides whether a typed `/word` is a command. A test of one and a use of the other is
  the shape this repo has shipped more than once.
- **E. Five exports nothing calls.** `roomHere`/`pressureNow` (`src/work/machine.ts:82`, `:127`),
  `saysWorkspace` (`electron/services/terminal.ts:246`), the carry-on helpers
  (`src/work/carryon.ts:44-85`) and `whatIsLyingAround` (`electron/main.ts:6147`). Each is either
  dead or a seam the next step needs; a row in this document is not a substitute for deciding
  which.

## Findings: everything retained with no behavioural test

Ranked by what a plausible bug there would cost, most expensive first. `data loss` means work or
a transcript disappears; `wrong owner` means the change lands on another project, chat, folder or
run; `dead control` means a press does nothing or a feature cannot be reached; `cosmetic` means
the wrong thing is drawn or said. Counts per kind are in *The shape of the surface*.

### Data loss

| # | what | where | cost | today |
| ---: | --- | --- | --- | --- |
| 1 | the launch and quit sweeps: `whatIsLyingAround → whatToSweep → sweep`, stray checkouts, stray helpers and servers, `terminals.closeAll()` | `electron/main.ts:11699-11715`, `:3923` (the sweep), `:6147` (`whatIsLyingAround`) | deletes finished copies, kept-aside work and transcripts at every launch, with no test of the launch list | `none` for the sweep build; `module-only` for `whatToSweep`/`sweep`, `endStrays`, `putAwayWorktree` |
| 2 | `graphe:clear-finished-work` and `graphe:clear-folder` | `electron/main.ts:10724` and `:10700` | erases a storage folder outright | `module-only` (`tests/storage.test.ts`, `tests/disk.test.ts`) |
| 3 | `graphe:trash-empty`, `graphe:trash-restore`, `graphe:delete-conversation` | `electron/main.ts:9084`, `:9063`, `:8932` | a transcript is destroyed or comes back to the wrong name | `module-only` (`tests/trash.test.ts`); the channel's own target resolution is untested, and `tests/operations/ipc-arguments.test.ts` names the under-the-sessions refusal as provable only in a real process |
| 4 | `graphe:changes-drop` | `electron/main.ts:8292` | undoes a patch in the wrong folder, or drops more than was asked | `module-only` (`tests/drop-changes.test.ts`) |
| 5 | `graphe:keep-away`, `graphe:review-land`, `graphe:worktree-land` | `electron/main.ts:8417`, `:9925`, `:9543` | work that was kept is landed on the wrong branch, or lost | `module-only` (`tests/board-landed.test.ts`, `tests/merge-safety.test.ts`) |
| 6 | `graphe:checkout-put-away`, `graphe:checkout-front`, `graphe:checkout-land` | `electron/main.ts:9799`, `:9731`, `:9781` | the wrong checkout is put away or brought in front | `module-only` |
| 7 | the workspace migration on launch: the lock file and the marker skip | `electron/main.ts:3382` and its call at `:11708` | a half-migrated profile written twice | `module-only` (`tests/migration.test.ts` drives `discover`/`commit`; the launch, the lock and the skip are untested) |

### Wrong owner

| # | what | where | cost | today |
| ---: | --- | --- | --- | --- |
| 8 | `graphe:page-at`, `graphe:page-hidden`, `graphe:page-said` | `electron/main.ts:11467`, `:11520`, `:8027` | the shared page view or its answer lands on another project's page | `none` / `source-text` |
| 9 | `graphe:conflict-settle`, `graphe:review-choose`, `graphe:take-back-queue` | `electron/main.ts:10106`, `:9846`, `:8325` | a clash settled against the wrong side; a queue entry chosen for another repo; a line taken back into another chat | `module-only`; the older inventory already records the address being dropped for the first two |
| 10 | `graphe:prompt`'s one-writer-per-folder lock and its per-conversation routing | `electron/main.ts:10830` | two chats write one folder | `behavioural` for the turn itself (real-window suite) and untested for the lock |
| 11 | `graphe:goal-verify`, `graphe:goal-load`/`save`/`clear` | `electron/main.ts:10794`, `:10752-10784` | a goal answered from another chat | `module-only`; the handler bodies are held by source text in `tests/goal-wiring.test.ts` |
| 12 | `watchBrowser`'s watched folder | `electron/main.ts:9344` | two chats in one project share one watched folder (already recorded in the older inventory) | `source-text` |

### Dead control

| # | what | where | cost | today |
| ---: | --- | --- | --- | --- |
| 13 | `View → Theme` radios | `electron/menu.ts:95-97` | three menu items that cannot change anything | `module-only` (the ids are asserted; no click exists) |
| 14 | the typed `/word` routing and the unknown-word card | `electron/main.ts:10855-10885` | a command silently sent to the model as prose | `none` (the pure `routeFor` is proven; the caller is not) |
| 15 | the `/` picker's on-screen rows and its arrow/Enter handling | `src/components/Composer.tsx:370-374`, `:575-588`, `:911-936` | a command offered that cannot be chosen, or a chosen one that inserts nothing | `none` / `source-text` |
| 16 | `cancel_build` | `src/agent/pi/tools.ts:2318` | a model cannot stop a checklist, and nothing proves the tool works | `none` |
| 17 | the tagged `read` tool | `src/agent/pi/anchor-edit.ts:308` | the model's file read is unproven; `tests/tool-conflicts.test.ts` only proves it wins the name | `none` |
| 18 | `graphe:add-package`, `graphe:remove-package`, `graphe:stop-package` | `electron/main.ts:9198`, `:9231`, `:9248` | the only way to add, remove or stop an add-on install | `none` |
| 19 | the sidebar's rows as presses | `src/components/Sidebar.tsx:204-224` → `src/App.tsx:5203-5268` | a row that goes nowhere, or two screens up at once | `module-only` for all ten; the list is behavioural, every press is not |
| 20 | `add-more` (the AddMore shelf) | `src/components/AddMore.tsx` | the screen behind "Add more" is never rendered by a test | `source-text` |
| 21 | `AskAnything` ("Find anything") | `src/components/AskAnything.tsx:52` | the search sheet is never rendered, and its ⌘K listener is its own | `module-only` |
| 22 | `Palette`, `Changes`, `NewWorktree`, `BrowserPane` | `src/components/Palette.tsx:115`, `Changes.tsx:190`, `NewWorktree.tsx:55`, `BrowserPane.tsx:75` | four sheets that open and do nothing, or draw the wrong list | `module-only` |
| 23 | both menu accelerators, `⌘O` and `⌘N` | `electron/menu.ts:64-65` | a shortcut that reaches the wrong screen | `none` |
| 24 | `close`, `next`, `previous` shortcut actions | `src/lib/actions.ts:72-74` | a chord that closes or walks tabs when it should not | `source-text` (the `case` lines only) |
| 25 | the key editor's capture/clear/ignore-modifier behaviour | `src/components/Settings.tsx:1232-1318` | a binding that cannot be set, or one cleared by accident | `source-text`; the list it draws is behavioural |
| 26 | `graphe:event` | `src/lib/ipc.ts:1445` | a channel with no handler and no sender | `none` |

### Cosmetic and native

| # | what | where | cost | today |
| ---: | --- | --- | --- | --- |
| 27 | 28 Electron-native menu roles and 12 separators | `electron/menu.ts` | drawn wrong | nothing asserts them, and nothing needs to except the four that must stay absent (which `tests/menu.test.ts` does assert) |
| 28 | `graphe:app-version`, `graphe:long-jobs`, `graphe:own-styles`, `graphe:computer-status`, `graphe:open-computer-settings`, `graphe:open-link` | `electron/main.ts:10613`, `:10628`, `:11394`, `:8173`, `:8180`, `:11554` | a version or a cost drawn wrong; a file opened in the wrong program | `none` |
| 29 | `Gallery` | `src/components/Gallery.tsx:845` | a dev-only page | `none` |

## The top ten, and the smallest honest test for each

Chosen from the findings above by cost first, then by how cheap the test is. Each entry names
what the test would have to observe, not how to write it.

1. **The launch sweep** (`electron/main.ts:11699-11715`: strays, servers, terminals, stray
   checkouts, then `whatIsLyingAround → whatToSweep → sweep`). This deletes at every launch with
   nothing driving it. *Smallest honest test:* `whatIsLyingAround` already returns a plain list;
   give it the profile root and the clock as arguments and assert in `tests/storage.test.ts`'s
   idiom that a dirty or still-held workspace is in the list of things **not** swept. The
   list-builder is the only part that cannot be reached today, and `tests/operations/storage-cleanup.test.ts:12`
   already says so — the fix is to make it reachable.

2. **`graphe:trash-empty` / `trash-restore` / `delete-conversation`** (`electron/main.ts:9084`,
   `:9063`, `:8932`). Deleting a transcript is the one irreversible thing here. *Smallest honest
   test:* lift the target guard (`resolve(path)` under `resolve(sessionsFolder())`, else refuse)
   into a pure function beside `insideProject` and assert it refuses a sibling folder and a
   `../` path; the trash module itself is already proven.

3. **`graphe:clear-finished-work` and the storage sweep it shares**
   (`electron/main.ts:10724`, `src/work/storage.ts:88`). *Smallest honest test:* one case that
   builds a storage folder holding one dirty old workspace, runs `whatToSweep`, and asserts the
   entry is absent and the reason names the work. `tests/storage.test.ts` has the shape.

4. **`graphe:changes-drop`** (`electron/main.ts:8292`, `src/components/Changes.tsx:190`).
   Dropping a change is a write to somebody's working tree from a sheet no test renders.
   *Smallest honest test:* render `Changes` with a two-hunk diff, press Drop on one row, and
   assert the exact patch handed to the bridge names that file only — jsdom, no Electron needed.

5. **`graphe:stop` and `graphe:stop-running`** (`electron/main.ts:8000`, `:7987`). A Stop that
   does not stop spends money and holds the folder lock. *Smallest honest test:* one case in
   `tests/electron/smoke.test.ts` — start a turn against the scripted model, press Stop, assert
   the run ends and the composer returns to Send. The suite and the model fixture already exist.

6. **The typed `/word` routing** (`electron/main.ts:10855-10885`). A mistyped command arriving as
   prose is the exact failure `src/agent/pi/commands.ts` exists to prevent, and only the pure
   decision is proven. *Smallest honest test:* make the routing body a function of
   `(word, here)` returning the route plus the card, and assert the three outcomes; or a
   real-window case typing `/nope` and asserting the refusal card rather than a sent message.

7. **`graphe:worktree-land` / `checkout-put-away` / `worktree-new`**
   (`electron/main.ts:9543`, `:9799`, `:8840`). Work landed in the wrong folder is workspace
   corruption, which is a release blocker by the plan's own list. *Smallest honest test:* assert
   the handler's folder resolution for a chat working in its own copy — `folderFor(open, where)`
   rather than `open.path` — the same assertion `tests/multiroot-wired.test.ts` makes as source
   text, but through `src/lib/ipc.ts`'s `whereIn` and the real registry rather than by grepping
   `main.ts`.

8. **The `View → Theme` radios** (`electron/menu.ts:95-97`). Three menu items that cannot change
   anything. *Smallest honest test:* none is worth writing for a press that has no effect — the
   honest move is to delete the three radios or give them the click the theme panel has. If they
   stay, `tests/menu.test.ts` should assert that every item carrying an `id` is either in
   `MENU_IDS` or has a documented reason not to be.

9. **`cancel_build`** (`src/agent/pi/tools.ts:2318`). The only way a model can stop a checklist
   it wrote, with no test at all. *Smallest honest test:* call the tool's `execute` with a stub
   `CancelBuild` and assert the callback fired once and the answer names the list it cancelled —
   the same shape as `tests/buildplan.test.ts`'s other cases.

10. **The AddMore shelf and the install path behind it** (`src/components/AddMore.tsx`,
    `graphe:add-package` at `electron/main.ts:9198`). Adding an add-on is the only way to extend
    the app, and neither the shelf nor the install is proven: the shelf is held by source text
    (`tests/reach.test.ts`) and the install by nothing. *Smallest honest test:* render `AddMore`
    with a stub bridge, press Install on one row, and assert the package id handed to the bridge
    and the pending state on the row.

Below the top ten, in the same order: `graphe:keep-away` and the review landing
(`electron/main.ts:8417`, `:9925`), the workspace migration's marker and lock (`:3382`), the key
editor's capture and clear
(`src/components/Settings.tsx:1232`), and the sidebar's ten presses
(`src/components/Sidebar.tsx:204-224`).

## What this means for the rest of 10.3

- **The surface is bigger than the plan's sentence suggests and thinner than the test count
  suggests.** 498 entries, 157 behavioural. The 204 `module-only` rows are the honest middle:
  the logic is proven and the wire is not, which is exactly what step 2 (async action states) and
  step 3 (persistent records) will keep finding.
- **One kind is a genuine hole rather than a thin edge: IPC.** Five behavioural channels out of
  185, and the reason is structural rather than neglectful — every handler is a closure inside
  the Electron entry. `tests/electron/smoke.test.ts` is the only instrument that reaches them and
  it has four cases. If step 2 is to exercise success, rejection, timeout, cancellation,
  duplicate submission, stale response, owner switch and process exit per async action, the
  cheapest move is to keep growing that suite rather than to lift 185 handler bodies out of the
  entry.
- **One document now disagrees with the tree, and it is the kind that gets trusted:** the row set,
  counts and line numbers of `docs/handoffs/ipc-inventory.md` (section 7). The other disagreement
  this pass found — a source-text assertion pinned to a renamed label — was deleted while the pass
  ran (cross-cutting finding A).
- **What this document is not.** It is not a bug list. Nothing here was found by exercising the
  app; every `none` and `module-only` row is a statement about tests, not about behaviour. What
  it gives steps 2 to 9 is the list of things whose failure would be invisible.
