# Phase 9 handoff: responsiveness, resource use, and recovery

Findings: P01 measured (not fixed), P02, P03, P04, P05 and P06 done, A05 done
(phase 1), E11 open; the 9.5 operational checks are covered by test files, with
seven findings they record as still open.

## Measured, on this machine

Fresh build (`npx vite build`, then `node scripts/perf-report.mjs --check`):

- main chunk **646.4 KB raw, 206.6 KB gzip** against the script's 450 KB limit.
- launch set 835.7 KB across two chunks; on-demand 5127.1 KB across 98 chunks.
- Build time 7.0 s. Node 22.21.1, macOS 15.6 (Darwin 24.6.0), arm64.

The first measurement on this branch was 691.3 KB raw / 222.7 KB gzip; the
phase 8 retirements (design hub, style editing, the design-QA panels) took 45 KB
out of it. The rest of the gap is the shell itself, which is where the remaining
retirement rows and the split of the preview bridge would come from.

The audit's 687.9 KB from the shipped `dist` was close to this, so this is the
real number rather than a stale artifact.

**Where the weight is.** The main chunk is 97.4% the application's own source by
source bytes (175 files, 2.15 MB of TypeScript): `App.tsx` 289 KB,
`lib/bridge.ts` 105 KB, `lib/ipc.ts` 102 KB, `preview/point.ts` 53 KB,
`components/Overview.tsx` 42 KB, `work/canvas.ts` 39 KB, `motion/read.ts` 38 KB,
and roughly 100 KB across `design/*`. Only two dependencies are in it at all
(`marked` 42 KB, `use-stick-to-bottom` 16 KB); everything heavy is already a lazy
chunk. So the fix is not removing a library, it is splitting the shell, and the
largest removable pieces are exactly the design and preview modules that phase
8's retirement table removes.

**Recorded as an assessed exception**, not as a raised limit: the gate still says
450 KB, the check is still not wired into CI, and this measurement is the reason.
Wiring a failing gate into CI would block every change on work that belongs to
phase 8; raising the limit would be the thing the plan explicitly forbids.

## Done

**P02, idle prefetch.** `warmViews()` imported all sixteen lazy views at idle and
cached the rejected promise, so a transient chunk failure became permanent and an
unhandled rejection. It now fetches the four a sitting reaches first, catches so
a later press can retry, and the press path fetches the whole set
(`fetchAllViews`) when it needs something not yet here.

## Not done

| Item | Note |
| --- | --- |
| P01, the main chunk | Measured and attributed; the phase 8 retirement work is what removes the weight. Re-measured after the wave: see the number below |
| ~~P03, sequential extension probes~~ | **DONE.** Probes run with bounded concurrency, and the content-fingerprinted cache means a second launch probes nothing |
| ~~P04, transcript main view~~ | **DONE.** `src/components/ThreadRows.tsx` virtualises the transcript: bounded DOM near the visible rows plus overscan, stable ids, streaming rows, late-loading images, restored scroll anchors, and the find-jump lands on a row that had to be expanded first |
| ~~P05, `useWindowed` height indexing~~ | **DONE.** `src/lib/windowed.ts` is keyed rather than positional, with cached prefix sums (a Fenwick tree), correct after insert/edit/measure, and no stale heights attributed to the wrong row |
| ~~P06, budgets for polling, scans, timers~~ | **DONE.** `src/preview/live.ts` holds a live-frame registry with subscribers; preview capture pauses when hidden or unwatched and resumes on return; the browser-frame poll stops when the window goes away; the file walk does not run while the panel is hidden, and a return does one walk rather than one per change |
| 9.1's scenario matrix, RSS/CPU/latency measurements, and the p50/p95 method | Not run: it needs the packaged app and a disposable profile |
| 9.4's lifecycle checks: sleep/wake, network change, a renderer crash or reload, the quit sequence | Not run here. Force-quit recovery is T55 in `tests/scenarios/recovery.test.ts`, and a helper whose app went away is `tests/surviving.test.ts`; nothing covers the rest |
| 9.6 clean-machine packaged smoke | Not run |

## 9.5 operational checks

Fourteen of the plan's sixteen areas have a test, one file each in
`tests/operations/`; Downloads/update links and Notifications have none. The
folder holds sixteen files in all — the other two are 9.1's, noted at the end.
`npx vitest run tests/operations` on this tree: **16 files passed (16), 103 tests
passed (103)**, 30.4 s. Seven of those tests are `it.fails` — a finding that still
reproduces, recorded rather than papered over — so the coverage is done and the
areas are not all clean.

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
| Downloads/update links | none | **Not covered** — no file in this suite |
| Diagnostics/export | `diagnostics-export.test.ts` | The disk section counts what is in a folder without reading any of it; a private key block in the why-stopped sentence is taken out while the sentence stays readable; the log is asked for no more than `LOG_LINES` |
| Notifications | none | **Not covered** — no file in this suite |
| Storage cleanup | `storage-cleanup.test.ts` | The exact day a resource becomes eligible, each kind's own window and nothing that holds work at three thousand days; a name the app does not manage cannot be cleared by asking, whatever is sent; clearing removes the folders it was given and counts what actually went |
| Network retry | `network-retry.test.ts` | A transient failure is waited out and the work is picked up rather than started again (`CARRY_ON`), the ladder has a ceiling and the helper's fits inside the five minutes it is given; a settled failure never reaches the ladder, so nothing is run a second time; `429` inside "1429 tokens" is not a rate limit |

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
| `preview-navigation.test.ts:58` | `asAddress` passes any `scheme://` straight through and `pageAt` (`electron/main.ts:11865`) hands it to `loadURL` with no allowlist, so `file:///etc/passwd` is a page the pane will open |
| `build-budget.test.ts:144` | P01: a fresh build's main chunk is over the 450 KB the app promises, kept as a failing expectation rather than by raising the limit |

### Not covered

- **Downloads/update links.** No file here. The row's wiring is read out of the
  source in `tests/newer-build.test.ts` — the channel, the push that does not
  need a project open, the preload listener, the words, the one place the upgrade
  command is named — and nothing runs `newerRelease` or `isNewer`
  (`electron/main.ts:6291`, `:6307`), so the fetch, the three-number comparison
  and "not newer is nothing" are unverified. Nothing here downloads or installs
  anything: the row names the version and offers `brew upgrade --cask graphe`, and
  the what-changed link is built from the version rather than taken from the
  answer, so there is no "updated" state to be wrong about. Signed packaged
  artifacts belong to 9.6, which is not run.
- **Notifications.** No file here. What to tell and when is `src/work/notify.ts`
  (`tests/notify.test.ts`), which switches are offered is
  `tests/settings-screen.test.ts`, and the sentence is `saysNotice`
  (`tests/unattended.test.ts`). The shell's `tellThem` (`electron/main.ts:6836`)
  builds the `Notification` and the click pushes the conversation's path, and
  nothing runs it — so "no full prompt in the body" and "the click returns to the
  right chat" are unverified at that layer. What bounds the body is `saidBriefly`
  (`:6559`), one sentence of at most a hundred and sixty characters, over a title
  that is the project's name trimmed to forty.
- **Uncovered, and named as such by the files themselves**, because the code is a
  closure inside the Electron entry or needs a real process:
  - IPC's sender check (`fromOurWindow`, `electron/main.ts:7400`), the generic
    catch (`:7452`, finding A05), the size caps the shell applies
    (`:9403`, `:11458`) and the refusals on unsafe targets (`:9497`,
    `fileInProject` `:5242`, `:9248`).
  - The model substitution — `chooseAModelIfNoneIs` (`electron/main.ts:7501`) and
    `createSession` (`src/agent/pi/adapter.ts:2632`) — which needs Electron or a
    live Pi runtime.
  - Preview navigation's isolation: `guardNavigation` (`:859`), `makePageView`
    (`:1008`) and the content and permission policies (`:886`, `:923`), which are
    installed on `session.defaultSession` while the page runs in
    `persist:graphe-page` (`:983`) and which return early outside a packaged build.
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
  - Storage cleanup's list, `whatIsLyingAround` (`electron/main.ts:6210`), which
    walks the app's data folder and asks git whether a checkout is dirty.

Two of the sixteen files are 9.1 rather than 9.5: `budgets.test.ts` holds the
fixtures at the size 9.1 names — a ten-thousand-turn transcript's document,
twenty open chats, a folder of a hundred thousand files with the walk capped —
and `build-budget.test.ts` measures a fresh build, printing on this run
`fresh build: main 650.1 KB raw, launch 839.4 KB, on demand 5127.1 KB`. The
assertion that the gate passes is `it.fails`, so the number stays recorded and the
gate stays red. Cold launch, RSS, CPU and a real twenty-session window still need
the packaged app, so 9.1's own row stands.

Exit criteria: not met. One measurement was taken honestly, its dominant cost was
identified, and one unbounded idle behaviour was fixed.
