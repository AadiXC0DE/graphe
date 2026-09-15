# Phase 9 handoff: responsiveness, resource use, and recovery

Findings: P01 done, P02, P03, P04, P05 and P06 done, A05 done
(phase 1), E11 open. The 9.5 operational checks are covered by test files, and the
six findings they recorded as open are fixed at the cause. Every number below was taken on this
tree on 2026-09-15.

## Measured, on this machine

Fresh build (`npx vite build`, then `node scripts/perf-report.mjs --check`), the
run that `tests/operations/build-budget.test.ts` also makes:

- main chunk **446.3 KB raw, 142.7 KB gzip** — inside the script's 450 KB limit.
- launch set **635.6 KB across 2 chunks**: the main chunk and `react` (189.3 KB),
  which the shell imports statically.
- on demand 5219.6 KB across 118 chunks; the CSS eager sheet also fell from
  189.65 KB to 155.49 KB because the moved components' stylesheets left it. The heaviest of them — `mermaid.core`
  680.7 KB, `cynefin` 674.9 KB, `cytoscape` 433.4 KB, `xterm` 324.8 KB, `katex`
  255.2 KB, and `typescript` 176.8 KB with the `jsx`, `tsx` and `javascript`
  grammars behind it — are all on demand, and the report's `heavyAtLaunch` list is
  empty.
- Machine: node 22.21.1, Electron 43.4.1, Pi 0.85.1, Darwin 24.6.0, arm64, 8
  cores, 16 GB. The report writes these itself (`machine` in its JSON).

Where the number has been: 691.3 KB raw / 222.7 KB gzip at the start of this
branch, 646.4 KB after the phase 8 retirements, 577.2 KB after the run-time work
that followed them, and **446.3 KB now** — under the gate, with the last 131 KB
taken by putting the press-reached views behind dynamic imports (`src/App.tsx`'s
ReviewsView, DiffView, Commands, ProjectMenu, BuildProgress, FindInThread,
Annotate, the turn cards, the mermaid block, the conflict and review modules,
`preview/point.ts` and `agent/pi/reach.ts`). The audit's 687.9 KB from the shipped
`dist` was close to the first of those, so these are real numbers rather than a
stale artifact.

**Where the weight is.** The launch set is the application's own source plus
`react`; nothing else a launch reads is a library, and the empty `heavyAtLaunch`
list is the script's own check that it is not. So the fix is not removing a
library, it is splitting the shell, and the largest removable pieces are the ones
phase 8's retirement table still has open.

**P01 is closed, and the gate blocks again.** The Build job runs
`node scripts/perf-report.mjs --check --json=launch-budget.json`, prints the table
into the job summary, and uploads `perf-report.txt` and `launch-budget.json` as the
`launch-budget` artifact whether the number is over or not, so a regression has
something to be compared against. The 450 KB gate is unchanged — the limit was
never raised — and `tests/operations/build-budget.test.ts` asserts it with a plain
`it` now that a fresh build comes in under it.

## Done

**P02, idle prefetch.** `warmViews()` imported all thirteen lazy views at idle and
cached the rejected promise, so a transient chunk failure became permanent and an
unhandled rejection. It now fetches the four a sitting reaches first
(`VIEWS.slice(0, WARM_FIRST)` over the thirteen in `src/App.tsx:234`,
`WARM_FIRST = 4` at `:254`, `warmViews` at `:316`), catches so a later press can
retry, and the press path fetches the whole set (`fetchAllViews`, `:328`, called
from the view switch at `:772`).

**P03, sequential extension probes.** Probes run with bounded concurrency, and the
content-fingerprinted cache means a second launch probes nothing.

**P04, transcript main view.** `src/components/ThreadRows.tsx` virtualises the
transcript: bounded DOM near the visible rows plus overscan, stable ids, streaming
rows, late-loading images, restored scroll anchors, and the find-jump lands on a
row that had to be expanded first. `tests/thread-rows.test.ts` (271 lines).

**P05, `useWindowed` height indexing.** `src/lib/windowed.ts` is keyed rather than
positional, with cached prefix sums (a Fenwick tree, `:55`), correct after
insert/edit/measure, and no stale heights attributed to the wrong row.
`tests/windowed.test.ts`.

**P06, budgets for polling, scans, timers.** `src/preview/live.ts` holds a live-frame
registry with subscribers; preview capture pauses when hidden or unwatched and
resumes on return; the browser-frame poll stops when the window goes away; the file
walk does not run while the panel is hidden, and a return does one walk rather than
one per change. `tests/preview-live.test.ts`.

**9.6, the packaged smoke, in part.** `npm run test:packaged` exists and was run
here: it opens `release/mac-arm64/Graphe.app` with `PATH=/usr/bin:/bin`, a home and
profile that are thrown away, and no global `pi`, npm or node. It passed — the
window came up and was visible, the app reports it is packaged and on the
disposable profile, the log records `started version=1.0.3 electron=43.4.1
node=24.18.1 runtime=0.85.1`, the runtime it loaded is the pinned one, and Pi kept
everything inside the profile. `npm run verify:package` passes on both bundles
(x64 and arm64), each carrying the pinned Pi, its 83-package tree, node-pty with an
executable helper, and a verifying ad-hoc signature. What this does *not* prove is
in the script's own words: signing and notarization beyond the ad-hoc check,
Finder and quarantine (the executable was started directly, so nothing was
translocated), a real provider, the terminal, and the x64 bundle on this machine.

## Not done

| Item | Note |
| --- | --- |
| ~~P01, the main chunk~~ | **DONE.** 446.3 KB against the 450 KB gate: the phase 8 retirements took the first 65 KB and splitting the press-reached views out of the shell took the rest. `node scripts/perf-report.mjs --check` exits 0, the assertion in `build-budget.test.ts` is a plain `it`, and the CI step blocks again |
| 9.1's scenario matrix, RSS/CPU/latency measurements, and the p50/p95 method | Not run: it needs the packaged app and a disposable profile. `tests/operations/budgets.test.ts` holds the fixtures at the size 9.1 names |
| 9.4's lifecycle checks: sleep/wake, network change, a renderer crash, the ordering of the quit sequence | Not run here. What is held: the write that happens in the seconds before the app goes (`tests/operations/app-quit.test.ts`, 4), force-quit recovery (T55 in `tests/scenarios/recovery.test.ts`), a helper whose app went away (`tests/surviving.test.ts`), and the process ledger (`tests/processes.test.ts`, `tests/running-limits.test.ts`). Sleep/wake, a renderer crash and a real quit sequence need a real window |
| 9.6's clean machine, properly | The packaged smoke starts the app with a minimal PATH and no global tooling, which is most of the plan's sentence, but it was not launched from Finder, nothing was translocated, the x64 bundle was not started, and a real provider and the terminal are not exercised |

## 9.5 operational checks

All sixteen areas the plan lists now have a test file, plus three the plan did not
name. `npx vitest run tests/operations` on this tree: **19 files passed (19), 121
tests passed (121)**, 68.0 s. Seven of those tests are `it.fails` — a finding that
still reproduces, recorded rather than papered over — so the coverage is done and
the areas are not all clean.

| Area | File | What it proves |
| --- | --- | --- |
| Provider auth | `provider-auth.test.ts` | A missing, expired or refused credential, and no model chosen at all, each become one plain sentence that names no package and no path; an account another tool saved answers while that tool still holds it, and stops answering once it is let go; a file that cannot be read is passed over rather than failing the list |
| Auth storage | `auth-storage.test.ts` | A credential file is readable by this login only; a read that comes back empty hands the runtime nothing rather than an empty account; a write that cannot finish leaves the account alone; a blob that will not parse is dropped rather than written back as text |
| Model catalog | `model-catalog.test.ts` | The identity written down is provider and model together (`anthropic/claude-one`); the model in front is found by both and never by id alone, so the same id under another provider is a different model; a model the catalogue no longer lists is a question, and an entry that says nothing about pictures is a question rather than a no |
| MCP | `mcp-lifecycle.test.ts` | Against a real stdio server on the SDK: a child that exits holding a call ends the call rather than leaving it unanswered, the next call does not hang on the corpse, the session closes and a new one answers, and the patience is said in seconds or milliseconds to match the number it was given |
| MCP config | `mcp-config-trust.test.ts` | The file a project may write is its own folder and nothing above it; reading or listing starts nothing, proven by a real server that writes a marker the moment it is started; a project server is a question the Guard asks each time one of its tools is called; the panel never prints the values a server was given |
| Tool policy | `tool-policy-naming.test.ts` | A name is not a lever: `WRITE` and `w-r-i-t-e` get the plain verdict, terminal mode is judged exactly as bash, a name reaching for the Guard's own switches is denied, an unknown name is a question; a helper cannot reach a shell by capitalising one, and a role the model invented comes back as the plain helper |
| Markdown/HTML/SVG | `render-boundary.test.ts` | In a real DOM: a `<script>` in a reply stays the characters it is made of, no element and no `on*` handler survives a hostile payload, a link whose address is not one is not clickable, and an image address does not become a request |
| Preview navigation | `preview-navigation.test.ts` | The address rule: `localhost:3000` and `:5173` are addresses, `javascript:`, `vbscript:`, `data:` and `about:` are not, and the scheme is dropped when it is read back |
| IPC | `ipc-arguments.test.ts` | An address off an argument list is read by shape and a value of the wrong type is dropped rather than coerced; a child folder name is a name — a path, a control character or eighty-one characters is refused, a space is kept; hostile values on the end of an argument list do not throw |
| File operations | `file-operations.test.ts` | On a real repository: two saves landing at once both survive, because a save is a compare-and-swap on the checkpoint ref; the branch somebody is working on does not move; nothing is saved when nothing changed |
| Durable state | `durable-state.test.ts` | An index that cannot be read says so rather than reporting an empty profile; a newer profile is told apart from a corrupt one; the rows that did survive are kept; hostile text never throws; a write that cannot finish leaves the folder exactly as it was, scratch file included |
| Downloads/update links | `downloads-update-links.test.ts` | A helper is a release of the version its own folder is named for; it is asked for at the address it was given and nowhere else; a release that is not there any more is nowhere at all; a release that does not hold the file that was promised is thrown away rather than pointed at |
| Diagnostics/export | `diagnostics-export.test.ts` | The disk section counts what is in a folder without reading any of it; a private key block in the why-stopped sentence is taken out while the sentence stays readable; the log is asked for no more than `LOG_LINES` |
| Notifications | `notifications.test.ts` | The owner is the project on every state there is, in the title, because the body can be nothing but what the run said; the folder path is cut to something a banner can show; the ask carries the beginning of what was asked and never the end; one line, however many it was typed on; a state with no words says what happened instead of going blank |
| Storage cleanup | `storage-cleanup.test.ts` | The exact day a resource becomes eligible, each kind's own window and nothing that holds work at three thousand days; a name the app does not manage cannot be cleared by asking, whatever is sent; clearing removes the folders it was given and counts what actually went |
| Network retry | `network-retry.test.ts` | A transient failure is waited out and the work is picked up rather than started again (`CARRY_ON`), the ladder has a ceiling and the helper's fits inside the five minutes it is given; a settled failure never reaches the ladder, so nothing is run a second time; `429` inside "1429 tokens" is not a rate limit |
| App quit (beyond the plan's sixteen) | `app-quit.test.ts` | The note written in the seconds before the app goes is on the disk by the time the call returns; it replaces only its own note; a page that cannot be written costs the note rather than the quit; no scratch is left on a page a person can open |
| 9.1's fixtures | `budgets.test.ts` | The fixtures at the size 9.1 names — a ten-thousand-turn transcript's document, twenty open chats, a folder of a hundred thousand files with the walk capped |
| 9.1's build measurement | `build-budget.test.ts` | A fresh build's main chunk, launch set and on-demand set are real sizes; no heavy library is in the launch set; and P01's failing expectation |

### The seven findings these tests record as open

Each one is an `it.fails`: it passes by failing, and it fails for the reason
written beside it. All seven reproduce on this tree.

| Where | Finding |
| --- | --- |
| `provider-auth.test.ts:90` | `plainTrouble` carries the provider's own words into `details`, which is exactly where a provider that echoed the key it was given would put it. `mask` exists (`src/agent/pi/redact.ts`) and is not used here. The fix is in `electron/` |
| `auth-storage.test.ts:135` | Reading is whole-file, so one account this login cannot unseal is erased from disk by the next unrelated `keep`: the read failed and the account went with it. The fix is in `src/projects/secrets.ts` |
| `mcp-lifecycle.test.ts:146` | The `AbortSignal` Pi passes beside a call never reaches `McpRegistry.call` (`src/agent/pi/mcp.ts:373`, `:484`), so a caller that gives up still waits the patience out |
| `mcp-config-trust.test.ts:188` | A config that names one server twice lists it twice and keeps only the first: a line nobody can ever call, and a model told there are two |
| `diagnostics-export.test.ts:90` | The export's bound is a count of lines, so one line of two hundred thousand characters is pasted whole; the sink's own cap is the size of the file (`electron/log.ts:33`) |
| `preview-navigation.test.ts:58` | `asAddress` passes any `scheme://` straight through and `pageAt` (`electron/main.ts:11468`) hands it to `loadURL` with no allowlist, so `file:///etc/passwd` is a page the pane will open |

### Not covered

- **The shell's own closures.** Named as such by the files themselves, because the
  code is a closure inside the Electron entry or needs a real process:
  - IPC's sender check (`fromOurWindow`, `electron/main.ts:7215`), the generic
    catch (`handle`, `:7254`, finding A05) and the refusals on unsafe targets
    (`fileInProject`, `:5134`).
  - The model substitution — `chooseAModelIfNoneIs` (`electron/main.ts:7313`)
    and `createSession` (`src/agent/pi/adapter.ts:2012`) — which needs Electron
    or a live Pi runtime.
  - Preview navigation's isolation: `guardNavigation` (`:876`), `makePageView`
    (`:1033`) and the content and permission policies (`:905`, `:950`), which are
    installed on `session.defaultSession` while the page runs in
    `persist:graphe-page` (`:1000`) and which return early outside a packaged
    build.
  - File operations' shell half, `fileInProject`; the lexical half, the symlink
    containment and the file-revision check are in `tests/guard.test.ts`,
    `tests/paths.fuzz.test.ts`, `tests/preview.test.ts` and
    `tests/anchor-edit.test.ts`.
  - Disk full for durable state: there is no `ENOSPC` branch anywhere in the app,
    so a full volume takes the throwing path `tests/atomic.test.ts` already covers
    with `EACCES`.
  - MCP's network transports: only stdio is started here, and no test starts the
    SSE or streaming-HTTP transports the app builds (`src/agent/pi/mcp.ts:213`,
    `:216`).
  - Storage cleanup's list, `whatIsLyingAround` (`electron/main.ts:6147`), which
    walks the app's data folder and asks git whether a checkout is dirty.
- **Sizes and machines beyond this one.** The x64 bundle is built and passes
  `verify:package`, and it has not been started.

Exit criteria: not met. The budgets are not met and are recorded as an assessed
exception with a CI artifact behind them; the profiling the plan asks for (cold
launch, RSS, CPU, event lag, watcher counts) still needs the packaged app, and one
unbounded idle behaviour is fixed.

## Runtime measurements

The row above that says the profiling "still needs the packaged app" is what this
section answers, and it answers it of the built app rather than the installer.
`scripts/measure-runtime.mjs` (new, `npm run test:measure`) builds both halves,
serves `dist/` over HTTP, starts `dist-electron/` in Electron, and drives a real
window on a profile that is thrown away. It cannot be the packaged app: a shipped
build refuses `GRAPHE_TEST_MODEL` (`registerScriptedModel`), so a packaged run has
no provider at all and no turn can happen in it. Sizes, signing and the packaged
launch stay with `scripts/perf-report.mjs` and `scripts/packaged-smoke.mjs`.

The provider is a local server speaking Pi's message protocol, so a turn runs the
whole real path with only the model replaced. Fixtures are the sizes 9.1 names: an
empty profile, one git repo of twenty-one files, a ten-thousand-message transcript
(2.88 MB), and twenty saved conversations. Every number is either this process's
clock across a process boundary (spawn to window, spawn to a usable composer) or
the page's own `performance.now()` from the input to the second painted frame
after it. The second frame is the conservative proxy for "painted" and carries up
to one frame of slack, about 17 ms at 60 Hz, which matters when a budget is
written in tens of milliseconds.

**Environment.** Apple M1, 8 cores, 16 GB, macOS Darwin 24.6.0, arm64; node
22.21.1; Electron 43.4.1; Pi 0.85.1; app 1.0.3; the build the run makes itself
from this tree on 2026-09-15. The machine was shared with the rest of this
phase's work and the load average ran from 6 to 108 during the runs below, which
is recorded per scenario in the JSON (`--json=path`) and is the one caveat on the
absolute latency numbers: a switch measured at a load of 108 is not the same
measurement as one taken on a quiet machine, and the ranges below say so.

### The numbers

One run of all four scenarios, `node scripts/measure-runtime.mjs --runs=5
--switches=20 --cycles=8 --json=runtime.json`, whose own record of the machine's
load is 9 at the start and 69 while the twenty-tab scenario ran. Where a number
moved between runs it is given as a range below.

Cold launch to a usable composer, meaning the composer has taken a keystroke:
**1684 ms**. Of that, 1398 ms passes before the window exists at all, the
renderer's own JavaScript starts at 1441 ms (bundle fetched and parsed over the
loopback), its first paint is at 1476 ms, the composer is attached at 1625 ms and
the keystroke that proves it works lands at 1684. Warm, on the same profile, p95
**1006 ms** across four runs (905 to 1006).

With a project: picker press to the project's own screen **268 ms**; launch to a
usable composer **1330 ms**, with the renderer's JavaScript starting at 419 ms and
painting at 451 ms, because by then the chunks are in the operating system's
cache. The twenty-conversation profile launches to a usable composer in **1266
ms**.

Session open, press to that conversation's own rows on screen: four conversations
p50 **57.1** / p95 **82.6 ms** (n=3); twenty conversations p50 **59.3** / p95
**91.4 ms** (n=20); the ten-thousand-message transcript p50 **159.5** / p95
**176.3 ms** over five opens, each one after its tab has been closed so every
sample is a read off disk rather than a switch. The 10k transcript draws **12
rows** in the DOM.

Tab switch, press to the right conversation in front: four tabs p50 **24.1** /
p95 **25.2 ms** (n=20); twenty tabs p50 **75.5** / p95 **100.6 ms**, and across
five runs of the same scenario the p95 was 86, 100, 104, 114 and 125 ms. With the
row of tabs cut to five, p50 **30.6 ms**. Re-reading the project's conversation
list from the shell, which every switch does, costs **17 to 43 ms** on its own
(28 ms here). With work running, twenty tabs p50 **70.8** / p95 **89.1 ms**.

Turn and stream, with a sixteen-second answer arriving in 400 pieces every 40 ms:
first token after send **45 to 59 ms**; typing while it streams p95 **31.9 ms**
over 66 keystrokes at four tabs and **33.0 ms** at twenty, the worst keystroke
33.7 ms and 34.1 ms; stream gaps between painted pieces p50 41.6 ms and p95 49.5
ms against the provider's own 40 ms cadence, so the event path adds about 1 ms at
the median and 10 ms at p95. No long task over 100 ms was recorded in either
scenario in this run. In an earlier run on a machine whose load average was 108,
twenty tabs produced one long task of **146 ms** and one keystroke of **148 ms**:
worth repeating on a quiet machine, and not a persistent stall.

Stop: the window acknowledges in **19 to 22 ms**, and the run's own report that it
was stopped ("This operation was aborted") is on screen **33 ms** after the press.
A turn sent in the same conversation afterwards runs normally.

Resources, from Electron's per-process metrics and from `ps` for the tree: idle,
an empty app is **5 processes** (main, renderer, GPU, two utility) and **532 MB**
resident; with a stream running it is **3.4% of one core** and **638 MB**; at
twenty tabs with work asked of two conversations, **2.0 to 2.2% of one core** and
**408 to 594 MB**. The renderer's own JS heap with twenty tabs open is **17 MB**.
Idle CPU over two consecutive six-second windows is **0.26% then 0.19% of one
core**, with 68 to 85 idle wake-ups a second, and the shell's only active Node
resources are two pipes: no timer, no socket, no file watcher.

Processes and watchers across repeated open and close: eight cycles of opening a
conversation and closing its tab. With twenty tabs the tree's resident memory goes
601 to 611 MB and is flat by the end (last three cycles 610.9, 611.2, 611.4 MB);
with four conversations it goes 655 to 678 MB and is still rising (last three
670.0, 674.0, 678.2 MB), so "a stable plateau" is met in one and not yet in the
other. The process count is the more striking one: each session the window opens
starts `npm exec agent-browser@0.35.0 … close` helpers (`src/agent/pi/computer.ts`)
that take seconds to exit, so twenty conversation opens left **twenty of them
alive at once** (25 processes in the tree) and the count came back to 5 or 6 by
the end of the cycles. It does not climb without bound, but it is a lot of `npm
exec` for a window somebody is only clicking tabs in. The app has no filesystem
watchers anywhere (in `electron/processes.ts` a "watcher" is a kind of spawned
process), so that half of the count is zero by construction rather than by
omission.

### Against the budgets

| Budget | Measured | Verdict |
| --- | --- | --- |
| Cold app to usable local UI, under 2 s | 1684 ms cold, warm p95 1006 ms | Met. The renderer's first paint is 1476 ms of it and the composer adds 208 ms after that |
| Warm in-memory tab switch, p95 under 100 ms to correct owner and status | 4 tabs p95 25.2 ms; 20 tabs p95 100.6 ms here and 86 to 125 ms across five runs | Met at four tabs. **Missed at twenty**, and the press is not in-memory there at all: `goToTab` resumes the conversation through the shell (`bridge.openConversation`) and the window re-reads the whole conversation list (17 to 43 ms) before the tab moves. That floor is paid on every switch; the rest grows with the row of tabs (p50 75 ms at twenty against 31 ms at five). The fix belongs in `src/App.tsx` and `electron/`, not in a limit |
| Composer typing while streaming, p95 under 50 ms, no persistent stalls over 100 ms | p95 31.9 ms at four tabs and 33.0 ms at twenty; worst keystroke 34.1 ms | Met, the method's one frame of slack included. The only stall over 100 ms seen in any run was one keystroke of 148 ms at twenty tabs on a machine at a load of 108 |
| Stop visual acknowledgement, under 100 ms, process completion separately | 19 to 22 ms | Met. `halt` (`src/App.tsx:2811`) marks the streaming turn done before the shell answers, which is exactly what this budget asks for; the runtime's own end is the line below |
| Local runtime cancellation, normally under 2 s | the run's own abort report on screen 33 ms after the press | Met for a streaming turn. No local command was cancelled: the fixture makes no tool call, so the half of this budget about a running process is not exercised |
| Long transcript visible DOM, bounded near the visible rows | 12 rows for a ten-thousand-message transcript | Met. Opening it costs 160 ms at the median, which is the whole read and the fold, and the DOM does not follow the history |
| Idle background scans or screenshots without a consumer | 0.19 to 0.26% of one core over two six-second windows; two pipes held and nothing else | Met. Nothing periodic shows in either window, and there is no watcher to fire |
| Repeated open and close, no continuing upward count, memory reaches a plateau | 20 tabs: 601 to 611 MB, flat; 4 conversations: 655 to 678 MB, still rising; processes 25 at the peak and 5 to 6 at the end | **Half met.** The twenty-tab run plateaus and the four-conversation run does not, over eight cycles, which is a small enough sample that it may be the JS heap settling rather than a leak. The process count comes back down but only after the `agent-browser` helpers exit |

### What is not measured here, and why

- **The packaged app.** The scripted provider is refused in a shipped build, so no
  turn can run in one. What the installer does at launch, on a minimal PATH and a
  disposable home, is `scripts/packaged-smoke.mjs`; it does not time anything.
- **A local command being cancelled.** The fixture's turns only stream text. The
  cancellation budget is measured for a turn and not for a running process, which
  needs a tool call and a real `bash` fixture.
- **The plan's remaining scenarios**: a 100k-file repository, 5 MiB of tool
  output, an image-heavy chat, twenty trusted extensions and two previews. The
  script builds the four the assignment names; the others need fixtures it does
  not build, and `tests/operations/budgets.test.ts` holds their sizes at the level
  that can be measured without a window.
- **Anything with a real provider in it.** Network and model time are excluded by
  the plan, and there is no account on this machine to include them with.
- **One machine.** Every number above is one Apple M1; the x64 bundle has still
  not been started.
