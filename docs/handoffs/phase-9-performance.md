# Phase 9 handoff: responsiveness, resource use, and recovery

Findings: P01 measured (not fixed), P02, P03, P04, P05 and P06 done, A05 done
(phase 1), E11 open. The 9.5 operational checks are covered by test files, with
seven findings they record as still open. Every number below was taken on this
tree on 2026-09-15.

## Measured, on this machine

Fresh build (`npx vite build`, then `node scripts/perf-report.mjs --check`), the
run that `tests/operations/build-budget.test.ts` also makes:

- main chunk **577.2 KB raw, 184.7 KB gzip** against the script's 450 KB limit.
- launch set **766.5 KB across 2 chunks** — the main chunk and `react` (189.3 KB),
  which the shell imports statically.
- on demand 5077.3 KB across 96 chunks. The heaviest of them — `mermaid.core`
  680.7 KB, `cynefin` 674.9 KB, `cytoscape` 433.4 KB, `xterm` 324.8 KB, `katex`
  255.2 KB, and `typescript` 176.8 KB with the `jsx`, `tsx` and `javascript`
  grammars behind it — are all on demand, and the report's `heavyAtLaunch` list is
  empty.
- Machine: node 22.21.1, Electron 43.4.1, Pi 0.85.1, Darwin 24.6.0, arm64, 8
  cores, 16 GB. The report writes these itself (`machine` in its JSON).

Where the number has been: 691.3 KB raw / 222.7 KB gzip at the start of this
branch, 646.4 KB after the phase 8 retirements, **577.2 KB now**. The retirement
work has taken 114 KB out of the main chunk. The audit's 687.9 KB from the shipped
`dist` was close to the first of those, so these are real numbers rather than a
stale artifact.

**Where the weight is.** The launch set is the application's own source plus
`react`; nothing else a launch reads is a library, and the empty `heavyAtLaunch`
list is the script's own check that it is not. So the fix is not removing a
library, it is splitting the shell, and the largest removable pieces are the ones
phase 8's retirement table still has open.

**P01 is an assessed exception, and the check is now recorded in CI rather than
blocked on.** The Build job runs `node scripts/perf-report.mjs --check
--json=launch-budget.json` under `continue-on-error: true`, prints the table into
the job summary, and uploads `perf-report.txt` and `launch-budget.json` as the
`launch-budget` artifact whether the number is over or not, so a regression has
something to be compared against. The 450 KB gate itself is unchanged and is held
where it was: the `it.fails` in `tests/operations/build-budget.test.ts:156`.
Raising the limit is the one thing the plan forbids, and blocking every change on
work that belongs to phase 8 is what the artifact is there to avoid.

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
| P01, the main chunk | Measured and attributed: 577.2 KB against 450 KB, recorded in CI as a non-blocking artifact and held by a failing expectation. The phase 8 retirement work is what removes the rest |
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
| `build-budget.test.ts:156` | P01: a fresh build's main chunk is over the 450 KB the app promises, kept as a failing expectation rather than by raising the limit |

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
