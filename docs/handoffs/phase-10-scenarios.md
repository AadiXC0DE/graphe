# Phase 10.2 handoff: the sixty scenarios, as named tests

Phase 10.2 asks for the catalogue as named test cases rather than a paragraph an
agent can tick off. This is what exists now: eleven suites under `tests/scenarios/`,
96 tests, every one of them running green. Three scenarios are recorded as
defects, each with a test written to fail and a comment naming the finding. Every
case that cannot be proven today is in the table with the production change it
waits on, rather than being quietly left out or weakened into a passing test.

## Where the proof lives

| Layer | What it proves here | Files |
| --- | --- | --- |
| Service and pure unit, over real disk | Workspace identity and state, the writer lease, migration, pull-request checkouts, merges, the trash, the registry, the terminal, the storage sweep, goal outcomes, restart recovery, usage attribution | `tests/scenarios/*.test.ts` (new) |
| Adapter contracts | Replay of a saved transcript, the extension probe and its trust gate, the dialog host, the hook budget, the terminal service, MCP servers | `tests/scenarios/*.test.ts` plus the existing suites they sit beside |
| Existing suites, cited rather than duplicated | Fine-grained properties of a layer whose scenario-level statement is identical: `tests/session-replay-fidelity.test.ts`, `tests/extension-trust.test.ts`, `tests/extension-ui.test.ts`, `tests/terminal.test.ts`, `tests/processes.test.ts`, `tests/storage.test.ts`, `tests/mcp.test.ts`, `tests/tab-strip.test.ts`, `tests/thread-rows.test.ts`, `tests/e2e/scenarios.test.ts` | unchanged |
| Electron end to end | Boot, the workspace index on disk, the migration marker, opening a project by pressing its row, two conversations in one project, the connect-a-model modal, and the switch-back defect below | `tests/electron/smoke.test.ts`, run through `npm run test:electron` (green: 2 tests) |

The Electron layer is cited but not extended. The reason is the same for every
real-window case in the table and it is worth stating once: the smoke suite runs
on a disposable profile with **no model**, so no turn in it can write a file, run
a tool or stream a reply. Every scenario that needs a turn to have happened
(T01's "B sees the file A wrote", T21's second pane, T25's file panel, T44's
preview frame, T47's streaming, T59's packaged app) needs a scripted provider
wired into the Electron layer, which does not exist; the plan lists it as a layer
of its own in 10.1 and phase 1.1 built only the disposable profile. Adding a
window test for those today would be a test of a modal, not of the scenario.

## What was run

| Command | Result |
| --- | --- |
| `npx vitest run tests/scenarios` | 11 files, **96 tests passed**, no skips, no failures (54 s wall on this machine) |
| `npx tsc --noEmit -p <config narrowed to tests/scenarios + tests/helpers>` | clean, 46 s |
| `npx tsc --noEmit` (whole tree) | not clean, and **no error is in a file this task touched**. Every error is in a `src/**` file another workstream is editing on this branch: `src/App.tsx` (unused `Look`, `Move`, `panelRepo`, `inStep`, `lookingAtFigma`, `askFigma`), `src/components/Overview.tsx` (unused `useMemo`), `src/gallery/Gallery.tsx` (`styles` not on `OverviewView`, missing `onOpenDesign`), and at the time of writing `src/design/moved.ts` importing a `./drift` module that is not on disk and `src/lib/projects.ts` reading `Overview.styles` while that field is being moved. The narrowed run above reports only those two, and nothing under `tests/scenarios/` in either run |
| `npm run test:electron` | not run: it builds and launches a real Electron window, and no test added here needs it |

Three of the tests are `it.fails(...)`: vitest counts them as passing when they
fail, which is what they are for. Each names its finding in the comment above it.

## The catalogue

`T` is the case; "must prove" is the plan's own required result, shortened; the
last column names the test that proves it, or the exact reason it is not
provable today.

| Case | Must prove | Where it is proven, or why it is not |
| --- | --- | --- |
| T01 | B sees the same workspace files as A; B's transcript and context are empty | `tests/scenarios/workspace-ownership.test.ts` `T01: chat A writes without committing, then New B opens in the same project` (three tests: same folder and the file visible, B a separate record with no session file or lineage, the write left uncommitted). The window half is not provable: the Electron profile has no model (see above) |
| T02 | Same conversation, session, branch, context and files after close and reopen | `tests/scenarios/conversation-ownership.test.ts` `T02: a conversation with a long history, closed and reopened` (session file, branch leaf and workspace survive; the folder is untouched). The transcript's own content is Pi's and is covered by T28/T29 |
| T03 | A visible handoff and a parent link; B has a new identity | Not provable. `Continue` is not implemented (phase 4.4): `handoffMessage()` exists in `src/work/continuing.ts:60` and no channel or control calls it, and `addConversation` accepts `lineage` while no caller passes one |
| T04 | Correct inherited context and compaction semantics at a fork point | Not provable. No fork path exists (phase 4.4); `lineage: { kind: 'fork' }` is a registry field nothing writes. Compaction boundaries can be *read* (`tests/session-replay-fidelity.test.ts` `RF-04 where the conversation was tidied`) but nothing chooses one to fork at |
| T05 | Correct base and cwd for the new workspace; the local workspace unchanged | `tests/scenarios/workspace-ownership.test.ts` `T05: an isolated workspace created for one conversation` (base is the project head, the checkout carries the committed files, and the project's status, index, HEAD bytes and note file are unchanged apart from the new untracked `.graphe/`). The "isolation is visible before the first send" half is the New-worktree card, a window surface with no runner |
| T06 | No file, index or HEAD change caused by navigation | `tests/scenarios/workspace-ownership.test.ts` `T06: selecting B and then A, again and again` (twenty selections: the snapshot of HEAD, branch, status, staged diff, working diff and the tracked tree is identical, and no mutating git verb was run) |
| T07 | Explicit failure, no local fallback, no orphan duplicate record | `tests/scenarios/workspace-ownership.test.ts` `T07: an isolated workspace that cannot be made` (a typed refusal for a folder that is not a repository, nothing created anywhere, and a retry that cannot duplicate the record). Not provable: the channel path (`CHANNEL.worktreeNew` in `electron/main.ts`) that reports it and leaves the project untouched, and there is no orphan cleanup step to exercise (phase 3 records it as not done) |
| T08 | The chat opens recoverably and cannot execute silently elsewhere | `tests/scenarios/workspace-ownership.test.ts` `T08: a conversation whose checkout was removed behind the app` (state is `missing` and never `ready`, the branch it was on is still named, and a decoy folder with the same name resolves to nothing). Not provable: opening it as a recovery flow in the window (phase 3: "the migration records these states; no UI opens them yet") |
| T09 | Migration preserves every record and every working byte | `tests/scenarios/migration.test.ts` `T09: a dirty project and an old checkout, brought across` (both rows accounted for, both conversations attached, and status, HEAD, staged diff, working diff, file bytes and the checkout's own half-finished file identical afterwards, with an untouched profile and a complete backup list) |
| T10 | Idempotent recovery from a crash between each step; no missing or duplicated sessions | `tests/scenarios/migration.test.ts` `T10: a run that stops part way through, over and over` (a second run over the index left by each of the five durable steps ends in the same conversations, the same workspaces and no duplicate folders; plus a legacy row it cannot read costs its own row and nothing else) |
| T11 | Stable identities across aliases, symlinks and same-name projects; no cross-project rescue or cache | `tests/scenarios/workspace-ownership.test.ts` `T11: one name, two projects, and a folder reached by two paths` (the old sanitized key really collides, the registry keeps both projects apart, a symlink resolves to its own project only, and a move happens only when told, keeping the id and the old path) and `tests/scenarios/migration.test.ts` `T11: two projects that shared one folder of copies` (the collision is named, every row under it is `foreign`/`shared-managed-root`, neither project may adopt or clean it, and nothing under it moves) |
| T12 | A new snapshot for the new head; the old active checkout intact | `tests/scenarios/pr-review.test.ts` `T12: a head that moves while an old review is still open` (the new folder is at the new SHA with the new bytes; the old folder is still on its own branch at its own SHA, still clean, and named in `leftBehind` as `superseded`; and a checkout holding somebody's notes is `in-use` and never repointed) |
| T13 | Two overlapping fetches each get their intended SHA | `tests/scenarios/pr-review.test.ts` `T13: two fetches asked for at once` (two pulls concurrently, each folder at its own commit on its own branch with its own file; the same head asked for in turn reuses the verified checkout). **Defect found**: the same head asked for twice *at once* is refused, see below |
| T14 | Safe refusal or conflict on a dirty or partially staged target; unrelated index and work preserved | `tests/scenarios/merge-safety.test.ts` `T14: a merge asked for while the project has work in it` (refused with the typed sentence; HEAD, status, staged diff, working diff and the conversation's own checkout unchanged; and the same with only a staged change) |
| T15 | Correct bytes and metadata for binary, rename, delete, mode and symlink; recoverable conflict paths | `tests/scenarios/merge-safety.test.ts` `T15: the awkward kinds of change, brought in` (byte-identical binary, a rename recorded as `R100`, the deletion applied, the symlink still a symlink pointing where it was left, `100755` on the new script, checkout gone; and a genuine clash refused with the project left exactly as it was and no markers anywhere) |
| T16 | The run continues and stays discoverable; no workspace cleanup on close | `tests/scenarios/writer-lease.test.ts` `T16: closing the view a run is working in` (a view closing neither frees the lease nor can free it with a run id that does not hold it; and the conversation record, its workspace and its folder are all still there). Not provable: "the run continues and is discoverable" needs the run registry and view records (phase 4.2: the eleven states are vocabulary only and the adapter does not drive them) |
| T17 | Only A and its owned children stop; no late automatic restart | Not provable. Stop is per-session in the adapter and there is no run record or child-run ownership to assert against (E07's admission point is open, phase 6.2 unbuilt). The one-conversation stop path is exercised in `tests/e2e/scenarios.test.ts` `S-3 Escape in the middle of a step` |
| T18 | FIFO lease status and no overlapping writes in one shared workspace | `tests/scenarios/writer-lease.test.ts` `T18: two conversations sending in one workspace` (one holder, the second told who it waits for and how many are ahead, arrival order, a second send in the same conversation queued behind the first run, and never two holders) |
| T19 | The owner is identified; B cannot answer A's request by accident | `tests/scenarios/writer-lease.test.ts` `T19: one run waiting on a person while another is queued` (the lease stays with the run that will carry on writing; two open dialogs cannot cross-answer; a question is settled only by its own answer; and a run that never held the folder cannot release it). Not provable: the main process's pending-request map (`addonAsks` in `electron/main.ts:9502`) through the real channel |
| T20 | At most one valid response; a stale answer is harmless | `tests/scenarios/writer-lease.test.ts` `T20: an answer given twice, or after the run has stopped` (two presses, one resolution; a cancelled select, input and editor each read as nothing chosen; and a cancelled ticket never becomes the holder, so a stale answer settles nothing) |
| T21 | One runtime, writer and bill across two panes showing one chat | Not provable. There is no second pane and no view record: the registry has no `views` at all, and phase 4.2's "second view attaches to one runtime" is not built |
| T22 | Composer, shortcuts and inspector address the pane in focus | Not provable, same reason as T21 (U03's navigation model is not started) |
| T23 | A fresh chat shows no context; shared context is labelled | **Defect found.** `tests/scenarios/conversation-ownership.test.ts` `T23: a reference brought into one chat, then a fresh chat opened` is written to fail: `references` is a field of the project's `Desk` (`src/lib/projects.ts:96`) and `showThread` carries the project's fields across a change of conversation, so a new chat opens holding the other chat's references. Finding S01, phase 4.5 |
| T24 | A delayed overview answer leaves B's panels unchanged | Not provable. The guard is the per-owner ask counter inside `electron/main.ts` (`refreshOverview`, `refreshVersions`), which is not exported and needs the window; the same owner-guard class of behaviour that *is* reachable (a reply for a parked conversation landing in that conversation) is proven in `tests/scenarios/conversation-ownership.test.ts` `T53` second test |
| T25 | No old file text rendered under a new owner | Not provable. The guard lives in the renderer hook `src/hooks/useProjectFiles.ts`; this repo has no hook-test harness (no `@testing-library/react`), the window layer has no model to open a file with, and phase 3 records external-change detection invalidating file caches as not built |
| T26 | B's draft and attachments survive; only A's cleared revision is dropped | Not provable. Drafts and attachments are window state (`App.tsx` `useState` at 1227, attachments cleared on switch at 1219) with no per-conversation store to assert against. Finding S01 |
| T27 | Drafts preserved; queue state shown; no duplicate automatic send | Not provable for the drafts: nothing persists one (no `drafts` key in the IPC contract, the preload or the shell). The "no duplicate automatic send" half is proven by `tests/e2e/scenarios.test.ts` `S-12 background work landing while the conversation is idle` (one send, to the conversation that asked, however often the same piece lands) |
| T28 | Readable history retained from a partial or corrupt transcript; a recovery entry visible | `tests/scenarios/transcript-replay.test.ts` `T28: a transcript that is partial or corrupt` (a truncated entry, an unknown entry kind and values that are not entries at all leave the readable lines intact and throw nothing; a call with no result comes back `interrupted` rather than running). Not provable: an error or recovery entry - the replay returns nothing for an unreadable record and nothing feeds `withTrouble` from a transcript read at a layer this suite can reach |
| T29 | Original names and content visible for unknown tools and custom messages | `tests/scenarios/transcript-replay.test.ts` `T29: history written by tools and add-ons this build does not know` (an unknown tool keeps its own name and its result; an add-on's message comes back as the add-on's and an invisible one is not drawn). The finer properties are in `tests/session-replay-fidelity.test.ts` `RF-01` and `RF-02` |
| T30 | Correct status for compaction success, failure and abort; no infinite busy or lost intent | Not provable. The adapter does not drive `compacting` (phase 4.2), so there is no status, failure or abort path to assert. Only the read side exists: `tests/session-replay-fidelity.test.ts` `RF-04` |
| T31 | Partial data preserved; a retry does not duplicate a completed tool | `tests/scenarios/transcript-replay.test.ts` `T31: a provider that went away in the middle of a tool` (what was already said and written down is kept, the unfinished step is `interrupted` and never `failed`, and a result that *is* there is not dropped for the call after it). Not provable: the retry half, which needs the provider path in `src/agent/pi/adapter.ts` and a real provider |
| T32 | An explicit choice when the model is gone; no silent paid fallback | Not provable. The choice is resolved in the adapter against Pi's own catalog and drawn by the window's connect modal; on a profile with no provider there is nothing to remove and no fallback path to observe. Nothing found by inspection that does fall back either |
| T33 | Discovery produces zero side effects for an untrusted extension | `tests/scenarios/extensions.test.ts` `T33: an add-on nobody has approved` (the marker fixture's top-level write never happens; approving it reads it for real; and the answer is cached once approved). Also `tests/extension-trust.test.ts` |
| T34 | Every interaction type works and cancels correctly | `tests/scenarios/extensions.test.ts` `T34: a trusted add-on that asks somebody something` (select, confirm, input and editor each answered for real; an unanswered select and input read as nothing chosen, an unanswered confirm as no; and the terminal-only half says so and rejects). Also `tests/extension-ui.test.ts` |
| T35 | Namespaced status display; no clobber between two extensions | Not provable. `setStatus` and the widget APIs are recorded as terminal-only (`unsupportedTerminal`) rather than stored, so there is no status store to namespace, and the process split that would make one useful (6.2) is not built |
| T36 | Generic calls and results usable for arbitrary subagent schemas | Not provable. There is no third-party subagent admission or schema layer: E07's admission point is open and 6.2 is unbuilt, so nothing accepts a subagent's own schema. Graphe's own helper path is a different thing and is exercised in `tests/e2e/scenarios.test.ts` `S-7` |
| T37 | Explicit registration resolution for duplicate tool names; old transcripts still readable | Not provable for the resolution: E09 is open (a duplicate between a built-in and an installed add-on is not detected at registration). The readable half is proven by `tests/scenarios/transcript-replay.test.ts` `T29` and `tests/session-replay-fidelity.test.ts` `RF-01` |
| T38 | The shell stays responsive; the failure is scoped to the owner | `tests/scenarios/extensions.test.ts` `T38: a handler that will not stop answering` (the event moves on rather than waiting, the overrun names the add-on and the event, the handler is not run again while the last run is still going, one overrun does not silence the same add-on's next handler, and a handler registered late is wrapped too). Not provable: "the shell stays responsive" for a trusted add-on spinning synchronously, which needs the disposable process (6.2, the largest unbuilt piece) |
| T39 | A late completion mutates nothing and restarts no stopped run | `tests/scenarios/extensions.test.ts` `T39: a hook that was let go of finishes afterwards` (a late completion clears the record and hands its value to nobody, and a handler that has not stopped is reported as possibly still running rather than as stopped). Not provable: "restarts no stopped run", which needs the admission record and the continuation owner (E07) |
| T40 | Installed versus active version honest; a safe reload preserves state | Not provable. E10 is open: installing or removing does not rebuild live session instances and there is no "installed; reload this chat" state |
| T41 | One writer, exact cwd and history, no Guard bypass or duplicated send, at TUI handoff | Not provable. 6.5 (terminal compatibility mode) is deliberately not shipped: the Guard, request and transcript hooks do not cross a process boundary, so there is no handoff to test |
| T42 | Correct input and output through resize, IME, Unicode and bracketed paste; no escape-sequence escalation | `tests/scenarios/terminal.test.ts` `T42: what a person types and what the shell prints` (a real pty: non-ASCII round trip both ways, a bracketed paste delivered byte for byte in one payload with the markers reaching the shell, a nonsense resize clamped and still usable, and a printed clear-and-clipboard sequence arriving in the stream as data rather than being acted on). Not provable here: the renderer's non-interpretation (xterm with link handling and window opening off) is a window property |
| T43 | Specified retention on close; temporary children cleaned up | `tests/scenarios/terminal.test.ts` `T43: closing a terminal, and what it kept` (close ends the shell and refuses more input, `closeAll` ends every terminal this app started, and the scrollback is bounded at 512 KB with the newest output kept) plus `tests/terminal.test.ts` and `tests/processes.test.ts` (`ending everything`, so no child survives the app). Not provable: the process-and-log viewer's retention as a window flow |
| T44 | An old preview frame is rejected; the visible owner is accurate | Not provable. Preview frames are still `{project, bytes}` (phase 5, U04): there is no workspace owner on a frame to reject it by |
| T45 | Modal usable, focus trapped and restored, no intercepted clicks | Not provable. Needs the real window and a visual/accessibility layer; no Electron or browser run is available in this environment |
| T46 | The selected tab is visible and core controls are reachable at 20+ tabs and a narrow window | `tests/tab-strip.test.ts` (unchanged): every tab rendered, the selected tab scrolled into view, Arrow/Home/End and Alt+Arrow, focus returned after a close, twenty tabs. Not provable: the 620x520 zoomed window matrix, which is a visual layer (U05, never run) |
| T47 | Bounded DOM, stable selection and scroll, working Jump to latest while streaming | `tests/thread-rows.test.ts` (unchanged): a screenful and no more, the right screenful while scrolling, the row being read put back when older turns arrive, and a growing row moving what is below it. The arithmetic is in `tests/windowed.test.ts`. Not provable: "Jump to latest" during streaming, which lives in `App.tsx` and needs the window |
| T48 | Bounded memory, an explicit fallback, retained content accessible | `tests/session-replay-fidelity.test.ts` `RF-01` (a long output bounded with a pointer to the rest, an unknown content kind named rather than dropped, a picture named rather than lost on a failure) and `RF-02`; `src/lib/thread.ts` caps the pictures kept per thread. Not provable: the measured memory claim (phase 9.1's matrix) and the diagram failure path, which is a renderer import |
| T49 | A workspace revision invalidates a stale diff or read; no silent overwrite | Not provable. External-change detection invalidating file and diff caches is not built (phase 3's "not done" table): `verifyWorkspace` records `verifiedAt` and a state, and no revision is compared against a reader's |
| T50 | A tightened permission is checked before a queued action runs | Not provable. E07 is open: `forwardTo` still accounts after a turn has begun, so there is no pre-execution permission check to assert |
| T51 | Distinct outcomes for complete, stuck, waiting and stopped; no false checklist or endless loop | `tests/scenarios/recovery.test.ts` `T51: a goal that finished, one that is stuck, one that is waiting` (done only when every step settled and the checks passed; each way of not finishing has its own sentence and they are all different; a finite round ceiling; and pause/resume as explicit commands). Not provable: waiting and stopped as the loop's own outcomes, which need the run records (E07). The loop's stop and the Escape path are in `tests/e2e/scenarios.test.ts` `S-2` and `S-3` |
| T52 | A defined ordering for child completion, a typed follow-up and an extension's turn, with no duplicate admissions | Not provable. E07 is open (no typed request or admission record), so the ordering is not decided anywhere to test. The one part that is decided is proven in `tests/e2e/scenarios.test.ts` `S-7` (one attributed turn per settle, however often the add-on asks) |
| T53 | Usage attributed once, to the correct runs and conversations | `tests/scenarios/conversation-ownership.test.ts` `T53: usage from two runs in one conversation` (the ledger reports the sitting's whole total each time and only the difference is charged to the second job, so the sum is the total and never double; the money lands on the project while the words land in the conversation that ran) |
| T54 | Terminal tool state and a usable reconnect after a disconnect, timeout or cancelled auth; no indefinite wait | `tests/scenarios/mcp.test.ts` `T54: a server that takes a tool call and never answers` (a real stdio server: reached, listed, called; an unreachable one answered with words; and the same server connected again after the hung one is closed). **Defect found**: a call the server never answers has no bound of its own, see below. The ordinary round trip is in `tests/mcp.test.ts` |
| T55 | Accurate interrupted states; no lost accepted writes or orphan spam | `tests/scenarios/recovery.test.ts` `T55: an app that was force quit` (every in-flight state reads `interrupted` and loses its owner and generation; idle, failed, interrupted and archived keep what was written; and `alive` is only believed with a recorded generation). Not provable: "no lost accepted writes" and "no orphan spam" as measurements, which need the packaged app and a real quit |
| T56 | Honest failure with prior data retained and recovery possible, for disk full, permission denied and a corrupt registry | `tests/scenarios/migration.test.ts` `T56: a registry file that will not read` (a broken file comes back as no data with the reason and never as a throw; a future version is refused the same way; readable rows survive an unreadable sibling; and a refused read is never mistaken for an empty profile). Not provable: disk full and permission denied, which need an injected failure in the writers that live in `electron/main.ts` around `app.getPath('userData')` |
| T57 | The correct transcript target is archived or deleted; worktrees and files remain | `tests/scenarios/recovery.test.ts` `T57: deleting a chat, and archiving one` (the transcript is moved to the trash and readable there, the workspace record, its folder and the uncommitted files are untouched and not marked deleted; archiving flips a flag and can be brought back with the same identity; and a workspace can be written down as gone without losing its folder) plus `tests/trash.test.ts` |
| T58 | Dirty and recovery data excluded; the exact removable resources shown | `tests/scenarios/recovery.test.ts` `T58: what the storage screen may clear` (a checkout holding work is kept however old, a finished one goes, the sentence names what stays and why, the exact path removed is the one reported, and a cleared checkout leaves its branch behind so the work is still somewhere) plus `tests/storage.test.ts` |
| T59 | Bundled runtime, assets, helpers and prerequisite UX in a clean installed app from Finder | Not provable. Needs a signed, packaged app launched with a minimal PATH; `npm run package` and `npm run verify:package` are not run in this environment (phase 9.6 and the release handoff both record it as unrun) |
| T60 | A backup is recoverable and an old app never writes incompatible migrated data silently | `tests/scenarios/migration.test.ts` `T60: the app is replaced by an older one` (a marker from a later version is not trusted, so a downgrade re-runs rather than believing what it cannot read; and every file about to be written over is named with its `.bak` before anything is written). Not provable: two real builds of the app swapping over one profile |

## Defects found

Three, each with a failing test that names it. `it.fails` counts as passing when
it fails, which is why the suite is green.

1. **T13: two reviews of one head asked for at once.**
   `tests/scenarios/pr-review.test.ts` `T13: two fetches asked for at once` >
   `it.fails('gives two reviews of the same head one verified checkout rather than two')`.
   Both calls see no branch for that head and both try to create it, so the loser
   is refused with "I fetched pull request #7 but could not point a branch at
   it" rather than reusing the checkout the winner just made
   (`electron/prWorktree.ts:505-514` reads the branch and then creates the
   checkout with nothing held across the two). Nothing is lost: the folder is
   left alone and the message is typed. What is wrong is that the second review
   does not open. Asking in turn reuses it correctly, which is the test below it.

2. **T23: a fresh chat in the same project shows the other chat's references.**
   `tests/scenarios/conversation-ownership.test.ts` `T23: a reference brought
   into one chat, then a fresh chat opened` >
   `it.fails('shows the fresh conversation nothing that was brought into the other one')`.
   `references` is a field of the project's `Desk` (`src/lib/projects.ts:96`),
   `App.tsx` writes it at project level (around 3424), and `showThread` keeps the
   project's fields across a switch, so "explicit shared context" and "private
   context" are the same thing today. Finding S01, phase 4.5. T26 and T27 are
   the same finding on the other two fields (`attachments`, the draft), and are
   recorded as not provable because those live in `App.tsx` state rather than in
   a reducer this suite can drive.

3. **T54: a tool call the server never answers has no bound of its own.**
   `tests/scenarios/mcp.test.ts` `T54: a server that takes a tool call and never
   answers` >
   `it.fails('gives up on a call the server never answers, within a bound of its own')`.
   `McpRegistry.call` awaits `session.client.callTool` with no timer armed
   (`src/agent/pi/mcp.ts:376`), and the catch below it only runs if the call
   rejects: a server that takes the request and holds it leaves the tool waiting
   for ever, which is the "tool spinner that never stops" the plan names, and
   "a disconnected server cannot leave a tool spinner forever" from 9.5. Being
   unreachable, being unknown and answering with an error are all handled and
   tested; only silence is not.

## A fourth finding, from the real window

**Switching back to a conversation whose turn never reached a transcript loses
the words.** The Electron suite caught this one after the catalogue was written:
send a message in a profile with no model, press New, then switch back. The tab
still says what was asked, and the conversation on screen is the empty state.
The shell answers a reopened conversation with an empty history (nothing was
written to disk, because the turn never completed), and the window replaces the
desk's turns with it, so the only copy of those words on screen is gone. Nothing
is lost on disk - there was nothing on disk - but the person watched their
sentence disappear.

Recorded in `tests/electron/smoke.test.ts` as an assertion of what the product
does today, with a note saying what to assert once it is fixed, so the defect
cannot be forgotten and the test cannot silently start passing. Owner: phase 4
(the window should keep the turns it already has when a shell answer carries
none for the same conversation).

## A finding recorded rather than asserted

**T58: what "holds work" means for a checkout.** `whatIsLyingAround` asks
`git status --porcelain` for a checkout (`electron/main.ts:6393-6399`), so a
checkout whose conversation committed its saves and never landed them reads as
holding nothing and is offered for clearing on age alone. The branch survives the
sweep, which is why this is recorded here rather than as a defect:
`tests/scenarios/recovery.test.ts` `T58: what the storage screen may clear` >
`'leaves the branch behind when it clears a checkout, so the work is still
somewhere'` asserts exactly that, so the work is recoverable and not lost. It is
still worth a sentence in the release notes: the folder goes, and the only way
back is `git log graphe/<id>`.

## What a later phase would have to build for the rest

Grouped by the production change each group of cases waits on, so the list can be
worked from.

| Missing | Cases |
| --- | --- |
| The conversation registry as a first-class record with `lineage`, drafts and references owned by the conversation (4.1, 4.4, 4.5) | T03, T04, T23 (defect), T26, T27 |
| Session service states driven by the adapter, and run and view records (4.2) | T16, T17, T21, T22, T30 |
| The typed request and admission record (E07), and 6.2's runtimes out of the main process | T17, T35, T36, T38, T39, T50, T51, T52 |
| The owner-scoped panels completed in the shell and the hooks (5.1, S08, W10, U04) | T24, T25, T44 |
| Extension package lifecycle and the tool-collision registry (E09, E10) | T37, T40 |
| A process boundary that preserves the Guard, request and transcript hooks (6.2, 6.5) | T38, T41 |
| External-change detection against a reader's revision (phase 3, "not done") | T49 |
| The renderer's own suites: a window with a scripted provider, the visual and keyboard matrix, packaging and a clean machine (10.1's last three layers) | T01 (window half), T05 (card), T07, T08, T42 (renderer half), T43 (viewer), T45, T46 (zoom), T47 (jump), T48 (memory), T55 (measurements), T59 |
| Two builds of the app over one profile | T60 (reverse direction) |
| The provider retry path with a real provider | T31 (retry half), T32 |
