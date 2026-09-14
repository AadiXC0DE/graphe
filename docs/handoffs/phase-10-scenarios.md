# Phase 10.2 handoff: the sixty scenarios, as named tests

Phase 10.2 asks for the catalogue as named test cases rather than a paragraph an
agent can tick off. This is what exists now: eleven suites under `tests/scenarios/`,
101 tests, every one of them running green. Three defects were found, each with a
failing test naming it; all three are fixed and their tests are ordinary passing
tests (see the register below). The Electron layer 10.1 called a layer of its own
now exists — a scripted provider for the real-window suite — and what it proves is
recorded here with the run that proves it. Every case that cannot be proven today
is in the table with the production change it waits on, rather than being quietly
left out or weakened into a passing test.

## 10.1's layers, and where each proof lives

| Layer | What it proves here | Files |
| --- | --- | --- |
| Service and pure unit, over real disk | Workspace identity and state, the writer lease, migration, pull-request checkouts, merges, the trash, the registry, the terminal, the storage sweep, goal outcomes, restart recovery, usage attribution | `tests/scenarios/*.test.ts` (new) |
| Adapter contracts | Replay of a saved transcript, the extension probe and its trust gate — the probe runs in a process of its own when a built runner is available (`probeInChild` spawns `probe-runner.mjs` under `ELECTRON_RUN_AS_NODE` with a deadline, SIGKILL and a grace; E04, and the source states that without one the factory runs in place where the deadline cannot reach it — `tests/extension-probe-child.test.ts`, 16 tests) — the dialog host, the hook budget, the terminal service, MCP servers | `tests/scenarios/*.test.ts` plus the existing suites they sit beside |
| Existing suites, cited rather than duplicated | Fine-grained properties of a layer whose scenario-level statement is identical: `tests/session-replay-fidelity.test.ts`, `tests/extension-trust.test.ts`, `tests/extension-ui.test.ts`, `tests/terminal.test.ts`, `tests/processes.test.ts`, `tests/storage.test.ts`, `tests/mcp.test.ts`, `tests/tab-strip.test.ts`, `tests/thread-rows.test.ts`, `tests/e2e/scenarios.test.ts` | unchanged |
| Electron end to end | Boot and the profile on disk (the index, the migration marker, the log), opening a project by pressing its row, two conversations in one project, the connect-a-model path when nothing can answer, the switch-back defect below, a file written by a real tool call that the conversation beside it also sees, and a reply arriving in pieces with its caret | `tests/electron/smoke.test.ts`, driven by the scripted provider in `tests/electron/scripted-model.ts`, run through `npm run test:electron` (4 tests, green — see the run table) |

The Electron layer is no longer cited only. 10.1 lists a real renderer, preload,
main, worker and **fake model** as the layer's own; the wave-1 work built the piece
that was missing, a scripted provider.

`tests/electron/scripted-model.ts` is a local server that speaks Pi's own message
protocol (`pi-messages`, the one Pi's own docs describe as usable by any backend)
and answers from a written script. A script is a list of steps, one per turn asked
for: `{ says: [...] }` is said in pieces 500 ms apart — long enough that a test
watching the window sees a reply arrive rather than appear — and `{ calls: { name,
arguments } }` is a tool call. Every request the app sends is kept for a test that
needs to know what the model was told, and a turn beyond the script answers with a
line saying nothing was scripted for it rather than hanging.

The app side is `registerScriptedModel` in `src/agent/pi/adapter.ts`: an ordinary
custom provider (`graphe-scripted`, model `Scripted replies`, API `pi-messages`)
pointed at the URL in `GRAPHE_TEST_MODEL`, registered only when the shell has said
this is an unpackaged copy — `notePackagedApp(app.isPackaged)` in
`electron/main.ts:552` — and refused otherwise however the variable is set. The
variable is the only way in, and `scriptedModel()` itself refuses to start outside
`GRAPHE_ELECTRON_SMOKE=1`, which only `scripts/run-electron-smoke.mjs` sets. So a
turn runs the whole real path — session, Guard, tools, event translation — with
only the model replaced. A launch gets the seam only when it asks for it; a
profile with no model still has to stop at "Connect a model", which is a scenario
of its own and is asserted.

What that buys, in the real window: T01's window half (a turn writes a file
through a tool call in the project, and the conversation opened beside it sees the
same file with an empty thread) and T47's streaming half (a reply caught on screen
in pieces, in the order they were sent, with the caret that marks a growing reply,
gone once it stops growing). What is still out of reach at this layer: a second
pane (T21), the visual and keyboard matrix (T45, T46), a packaged build (T59), and
every case whose production change is unbuilt — the table's own column says which
for each. Adding a window test for those today would be a test of a modal, not of
the scenario.

## What was run

| Command | Result |
| --- | --- |
| `npm run test:electron` | **run for this hand-off, green.** Built `dist/` (vite build) and `dist-electron/` (boot, main, preload, pagepreload, subagent-runner, probe-runner), then: `Test Files 1 passed (1)`, `Tests 4 passed (4)`, duration 28.59 s. The four real-window cases: boot and the profile; two conversations and the connect-a-model path (with the switch-back defect asserted); a file written through a tool call that the conversation beside it also sees; a reply arriving in pieces with its caret |
| `npx vitest run tests/scenarios` | **run for this hand-off, green:** `Test Files 11 passed (11)`, `Tests 101 passed (101)`, duration 11.96 s |
| `npx vitest run tests/scenarios/conversation-ownership.test.ts tests/draft-kept.test.ts` | **run for this hand-off, green:** 2 files, `Tests 22 passed (22)`, duration 3.13 s |
| `npx vitest run tests/preview-live.test.ts tests/tool-conflicts.test.ts tests/package-activation.test.ts` | **run for this hand-off, green:** 3 files, `Tests 24 passed (24)` (11 + 10 + 3), duration 2.77 s — the evidence behind T44, T37 and T40 |
| `npx vitest run tests/extension-probe-child.test.ts` | **run for this hand-off, green:** 1 file, `Tests 16 passed (16)`, duration 5.35 s — the probe in its own process, including a factory that never yields being killed rather than costing the app, a factory's own marker-shaped line losing to the real answer, and an answer still read after more output than the parent keeps |
| `npx tsc --noEmit` (whole tree) and `npx vitest run` (whole suite) | **not run for this hand-off.** The whole-tree typecheck and the whole suite are the main agent's, run once after every workstream lands; while this ran the tree was red with other workstreams' in-flight edits, so a number taken then would describe half-landed work. Earlier figures, from before the wave-1 work and not re-taken: `npx vitest run` 330 files passed, 1 skipped, **6739 tests passed**, 2 skipped; a narrowed `npx tsc --noEmit` over `tests/scenarios` plus `tests/helpers` was clean |

The three defects this catalogue found are all fixed now; the register below says
what each was and what holds it. Nothing under `tests/scenarios/` is an
`it.fails` any more.

## The catalogue

`T` is the case; "must prove" is the plan's own required result, shortened; the
last column names the test that proves it, or the exact reason it is not
provable today.

| Case | Must prove | Where it is proven, or why it is not |
| --- | --- | --- |
| T01 | B sees the same workspace files as A; B's transcript and context are empty | `tests/scenarios/workspace-ownership.test.ts` `T01: chat A writes without committing, then New B opens in the same project` (three tests: same folder and the file visible, B a separate record with no session file or lineage, the write left uncommitted). The window half is proven now: `tests/electron/smoke.test.ts` `writes a file through a tool call, and the conversation beside it sees the same file` runs a real turn that writes `a note.md` in the project, opens a second conversation there, and asserts the file is in the project's file list while that conversation's thread is empty (see the Electron section above) |
| T02 | Same conversation, session, branch, context and files after close and reopen | `tests/scenarios/conversation-ownership.test.ts` `T02: a conversation with a long history, closed and reopened` (session file, branch leaf and workspace survive; the folder is untouched). The transcript's own content is Pi's and is covered by T28/T29 |
| T03 | A visible handoff and a parent link; B has a new identity | Not proven here. Continue now exists end to end - `CHANNEL.conversationContinue` composes the note with `handoffMessage()`, starts the conversation in the source's workspace and records `lineage` - and the row was written before it landed; what is missing is a named test driving it (the service half is testable, and the window runner the draft-in-the-composer half needs now exists — see above — but no test drives it) |
| T04 | Correct inherited context and compaction semantics at a fork point | Partly. `CHANNEL.conversationFork` now writes `lineage: { kind: 'fork' }` and forks through Pi's own `SessionManager.forkFrom`, refusing while the source is working; it forks the whole conversation, not a chosen earlier boundary, so the "at a pre-compaction point" half is still unbuilt and no scenario test drives even the whole-transcript case |
| T05 | Correct base and cwd for the new workspace; the local workspace unchanged | `tests/scenarios/workspace-ownership.test.ts` `T05: an isolated workspace created for one conversation` (base is the project head, the checkout carries the committed files, and the project's status, index, HEAD bytes and note file are unchanged apart from the new untracked `.graphe/`). The "isolation is visible before the first send" half is the New-worktree card: the window runner it needs now exists (see above) and no test drives the card |
| T06 | No file, index or HEAD change caused by navigation | `tests/scenarios/workspace-ownership.test.ts` `T06: selecting B and then A, again and again` (twenty selections: the snapshot of HEAD, branch, status, staged diff, working diff and the tracked tree is identical, and no mutating git verb was run) |
| T07 | Explicit failure, no local fallback, no orphan duplicate record | `tests/scenarios/workspace-ownership.test.ts` `T07: an isolated workspace that cannot be made` (a typed refusal for a folder that is not a repository, nothing created anywhere, and a retry that cannot duplicate the record). Not provable: the channel path (`CHANNEL.worktreeNew` in `electron/main.ts`) that reports it and leaves the project untouched, and there is no orphan cleanup step to exercise (phase 3 records it as not done) |
| T08 | The chat opens recoverably and cannot execute silently elsewhere | `tests/scenarios/workspace-ownership.test.ts` `T08: a conversation whose checkout was removed behind the app` (state is `missing` and never `ready`, the branch it was on is still named, and a decoy folder with the same name resolves to nothing). Not provable: opening it as a recovery flow in the window (phase 3: "the migration records these states; no UI opens them yet") |
| T09 | Migration preserves every record and every working byte | `tests/scenarios/migration.test.ts` `T09: a dirty project and an old checkout, brought across` (both rows accounted for, both conversations attached, and status, HEAD, staged diff, working diff, file bytes and the checkout's own half-finished file identical afterwards, with an untouched profile and a complete backup list) |
| T10 | Idempotent recovery from a crash between each step; no missing or duplicated sessions | `tests/scenarios/migration.test.ts` `T10: a run that stops part way through, over and over` (a second run over the index left by each of the five durable steps ends in the same conversations, the same workspaces and no duplicate folders; plus a legacy row it cannot read costs its own row and nothing else) |
| T11 | Stable identities across aliases, symlinks and same-name projects; no cross-project rescue or cache | `tests/scenarios/workspace-ownership.test.ts` `T11: one name, two projects, and a folder reached by two paths` (the old sanitized key really collides, the registry keeps both projects apart, a symlink resolves to its own project only, and a move happens only when told, keeping the id and the old path) and `tests/scenarios/migration.test.ts` `T11: two projects that shared one folder of copies` (the collision is named, every row under it is `foreign`/`shared-managed-root`, neither project may adopt or clean it, and nothing under it moves) |
| T12 | A new snapshot for the new head; the old active checkout intact | `tests/scenarios/pr-review.test.ts` `T12: a head that moves while an old review is still open` (the new folder is at the new SHA with the new bytes; the old folder is still on its own branch at its own SHA, still clean, and named in `leftBehind` as `superseded`; and a checkout holding somebody's notes is `in-use` and never repointed) |
| T13 | Two overlapping fetches each get their intended SHA | `tests/scenarios/pr-review.test.ts` `T13: two fetches asked for at once` (two pulls concurrently, each folder at its own commit on its own branch with its own file; the same head asked for in turn reuses the verified checkout). **Was a defect**: the same head asked for twice *at once* was refused; fixed, see the register below |
| T14 | Safe refusal or conflict on a dirty or partially staged target; unrelated index and work preserved | `tests/scenarios/merge-safety.test.ts` `T14: a merge asked for while the project has work in it` (refused with the typed sentence; HEAD, status, staged diff, working diff and the conversation's own checkout unchanged; and the same with only a staged change) |
| T15 | Correct bytes and metadata for binary, rename, delete, mode and symlink; recoverable conflict paths | `tests/scenarios/merge-safety.test.ts` `T15: the awkward kinds of change, brought in` (byte-identical binary, a rename recorded as `R100`, the deletion applied, the symlink still a symlink pointing where it was left, `100755` on the new script, checkout gone; and a genuine clash refused with the project left exactly as it was and no markers anywhere) |
| T16 | The run continues and stays discoverable; no workspace cleanup on close | `tests/scenarios/writer-lease.test.ts` `T16: closing the view a run is working in` (a view closing neither frees the lease nor can free it with a run id that does not hold it; and the conversation record, its workspace and its folder are all still there). Not provable: "the run continues and is discoverable" needs the run registry and view records (phase 4.2: the eleven states are vocabulary only and the adapter does not drive them) |
| T17 | Only A and its owned children stop; no late automatic restart | Not provable. Stop is per-session in the adapter and there is no run record or child-run ownership to assert against (E07's admission point is open, phase 6.2 unbuilt). The one-conversation stop path is exercised in `tests/e2e/scenarios.test.ts` `S-3 Escape in the middle of a step` |
| T18 | FIFO lease status and no overlapping writes in one shared workspace | `tests/scenarios/writer-lease.test.ts` `T18: two conversations sending in one workspace` (one holder, the second told who it waits for and how many are ahead, arrival order, a second send in the same conversation queued behind the first run, and never two holders) |
| T19 | The owner is identified; B cannot answer A's request by accident | `tests/scenarios/writer-lease.test.ts` `T19: one run waiting on a person while another is queued` (the lease stays with the run that will carry on writing; two open dialogs cannot cross-answer; a question is settled only by its own answer; and a run that never held the folder cannot release it). Not provable: the main process's pending-request map (`addonAsks` in `electron/main.ts:9502`) through the real channel |
| T20 | At most one valid response; a stale answer is harmless | `tests/scenarios/writer-lease.test.ts` `T20: an answer given twice, or after the run has stopped` (two presses, one resolution; a cancelled select, input and editor each read as nothing chosen; and a cancelled ticket never becomes the holder, so a stale answer settles nothing) |
| T21 | One runtime, writer and bill across two panes showing one chat | Not provable. There is no second pane and no view record: the registry has no `views` at all, and phase 4.2's "second view attaches to one runtime" is not built |
| T22 | Composer, shortcuts and inspector address the pane in focus | Not provable, same reason as T21 (U03's navigation model is not started) |
| T23 | A fresh chat shows no context; shared context is labelled | `tests/scenarios/conversation-ownership.test.ts` `T23: a reference brought into one chat, then a fresh chat opened` (three tests, green): a fresh chat opens with no references, no box and no sentence of the other chat's; the project's own `context` stays visible and is not drawn as something this chat was sent; and each chat gets its own references, box and sentence back, in both directions. **Was a defect** — the references, the box and the sentence were the project's `Desk` fields and `showThread` carried them across a switch; fixed by S01, phase 4.5 (see the register below). What is not driven here: the same case through the real window |
| T24 | A delayed overview answer leaves B's panels unchanged | Not provable. The guard is the per-owner ask counter inside `electron/main.ts` (`refreshOverview`, `refreshVersions`), which is not exported and needs the window; the same owner-guard class of behaviour that *is* reachable (a reply for a parked conversation landing in that conversation) is proven in `tests/scenarios/conversation-ownership.test.ts` `T53` second test |
| T25 | No old file text rendered under a new owner | Not provable. The guard lives in the renderer hook `src/hooks/useProjectFiles.ts` and this repo has no hook-test harness (no `@testing-library/react`); the window layer can now open a file with a model answering (see above), but no test drives a load landing after a switch, and phase 3 records external-change detection invalidating file caches as not built |
| T26 | B's draft and attachments survive; only A's cleared revision is dropped | `tests/scenarios/conversation-ownership.test.ts` `T26: an upload that finishes after the window has moved on` (three tests, green): a send takes out of the box only what it accepted, and only out of the box of the chat that sent it; a picture put in while the send was still going stays; and a refused send's sentence goes back to its own chat without touching the other. **Was finding S01** — window state with no per-conversation store to assert against; fixed by phase 4.5. What is not driven here: the same case through the real window |
| T27 | Drafts preserved; queue state shown; no duplicate automatic send | Half proven. Drafts are kept per project and per conversation by the composer in the window's own storage (`draftKey`, `src/components/Composer.tsx`), come back when that conversation is opened again, and are handed back to the conversation they were written in on a switch or on a send: `tests/draft-kept.test.ts` (twelve tests, green). The "no duplicate automatic send" half is proven by `tests/e2e/scenarios.test.ts` `S-12 background work landing while the conversation is idle` (one send, to the conversation that asked, however often the same piece lands). Not covered: a conversation's place in the lease queue as the window would show it (the queue itself is T18, at the service layer) |
| T28 | Readable history retained from a partial or corrupt transcript; a recovery entry visible | `tests/scenarios/transcript-replay.test.ts` `T28: a transcript that is partial or corrupt` (a truncated entry, an unknown entry kind and values that are not entries at all leave the readable lines intact and throw nothing; a call with no result comes back `interrupted` rather than running). Not provable: an error or recovery entry - the replay returns nothing for an unreadable record and nothing feeds `withTrouble` from a transcript read at a layer this suite can reach |
| T29 | Original names and content visible for unknown tools and custom messages | `tests/scenarios/transcript-replay.test.ts` `T29: history written by tools and add-ons this build does not know` (an unknown tool keeps its own name and its result; an add-on's message comes back as the add-on's and an invisible one is not drawn). The finer properties are in `tests/session-replay-fidelity.test.ts` `RF-01` and `RF-02` |
| T30 | Correct status for compaction success, failure and abort; no infinite busy or lost intent | Not provable. The adapter does not drive `compacting` (phase 4.2), so there is no status, failure or abort path to assert. Only the read side exists: `tests/session-replay-fidelity.test.ts` `RF-04` |
| T31 | Partial data preserved; a retry does not duplicate a completed tool | `tests/scenarios/transcript-replay.test.ts` `T31: a provider that went away in the middle of a tool` (what was already said and written down is kept, the unfinished step is `interrupted` and never `failed`, and a result that *is* there is not dropped for the call after it). Not provable: the retry half, which needs the provider path in `src/agent/pi/adapter.ts` and a real provider |
| T32 | An explicit choice when the model is gone; no silent paid fallback | Not provable. The choice is resolved in the adapter against Pi's own catalog and drawn by the window's connect modal; on a profile with no provider there is nothing to remove and no fallback path to observe. Nothing found by inspection that does fall back either |
| T33 | Discovery produces zero side effects for an untrusted extension | `tests/scenarios/extensions.test.ts` `T33: an add-on nobody has approved` (the marker fixture's top-level write never happens; approving it reads it for real; and the answer is cached once approved). Also `tests/extension-trust.test.ts` |
| T34 | Every interaction type works and cancels correctly | `tests/scenarios/extensions.test.ts` `T34: a trusted add-on that asks somebody something` (select, confirm, input and editor each answered for real; an unanswered select and input read as nothing chosen, an unanswered confirm as no; and the terminal-only half says so and rejects). Also `tests/extension-ui.test.ts` |
| T35 | Namespaced status display; no clobber between two extensions | Not provable. `setStatus` and the widget APIs are recorded as terminal-only (`unsupportedTerminal`) rather than stored, so there is no status store to namespace, and the process split that would make one useful (6.2) is not built |
| T36 | Generic calls and results usable for arbitrary subagent schemas | Not provable. There is no third-party subagent admission or schema layer: E07's admission point is open and 6.2 is unbuilt, so nothing accepts a subagent's own schema. Graphe's own helper path is a different thing and is exercised in `tests/e2e/scenarios.test.ts` `S-7` |
| T37 | Explicit registration resolution for duplicate tool names; old transcripts still readable | `tests/tool-conflicts.test.ts` (ten tests, green). The rule is `src/agent/pi/tool-conflicts.ts` `apartTools`, and it is decided before the session is built: a name that carries Graphe's boundary (`GRAPHE_ONLY`: read, bash, edit, write, grep, find, ls) stays Graphe's and comes off the add-on that wanted it; any other name the person installed keeps theirs, and Graphe's own tool of that name is the one left out; between two add-ons the first to ask keeps it, in the order the caller read them. `src/agent/pi/adapter.ts:3048` applies it — every conflict goes out as a `notice` through `saysToolConflict`, a name the boundary keeps is deleted from that add-on's registry (`apart.took`, around :3058), the session is built with the filtered list (`ourTools`, `nameKept`), and the conflicts are readable at `toolConflicts` (:3813). The registry half is asserted against the real SDK: with the rule applied, `task` runs the add-on's definition and `read` runs Graphe's. A name never changes, so an old transcript still reads as the tool that ran — that half is `tests/scenarios/transcript-replay.test.ts` `T29` and `tests/session-replay-fidelity.test.ts` `RF-01` |
| T38 | The shell stays responsive; the failure is scoped to the owner | `tests/scenarios/extensions.test.ts` `T38: a handler that will not stop answering` (the event moves on rather than waiting, the overrun names the add-on and the event, the handler is not run again while the last run is still going, one overrun does not silence the same add-on's next handler, and a handler registered late is wrapped too). Not provable: "the shell stays responsive" for a trusted add-on spinning synchronously, which needs the disposable process (6.2, the largest unbuilt piece) |
| T39 | A late completion mutates nothing and restarts no stopped run | `tests/scenarios/extensions.test.ts` `T39: a hook that was let go of finishes afterwards` (a late completion clears the record and hands its value to nobody, and a handler that has not stopped is reported as possibly still running rather than as stopped). Not provable: "restarts no stopped run", which needs the admission record and the continuation owner (E07) |
| T40 | Installed versus active version honest; a safe reload preserves state | `tests/package-activation.test.ts` (three tests, green). The state is one sentence everywhere — `Installed; reload this chat to activate`, or `Removed; reload this chat to let it go` (`src/agent/pi/package-lifecycle.ts` `reloadWords`) — carried on the session that was open when the change landed (`activationPending`, `src/agent/pi/adapter.ts:3819`, set by `markActivationPending`), and changes to what is installed run one at a time (`oneAtATime`). The shell marks every conversation open in that project (`electron/main.ts:9736`, called from the add and remove handlers at :9846 and :9856 with `reloadWords`), and reopening a marked conversation puts the old session down and builds it again at the same address instead of resuming it (`electron/main.ts:4998-5004` resumes only when nothing is pending, carrying the permission rung across). The rebuild is asserted against a real session in the same file: same conversation, same transcript, same model choice, same rung |
| T41 | One writer, exact cwd and history, no Guard bypass or duplicated send, at TUI handoff | Not provable. 6.5 (terminal compatibility mode) is deliberately not shipped: the Guard, request and transcript hooks do not cross a process boundary, so there is no handoff to test |
| T42 | Correct input and output through resize, IME, Unicode and bracketed paste; no escape-sequence escalation | `tests/scenarios/terminal.test.ts` `T42: what a person types and what the shell prints` (a real pty: non-ASCII round trip both ways, a bracketed paste delivered byte for byte in one payload with the markers reaching the shell, a nonsense resize clamped and still usable, and a printed clear-and-clipboard sequence arriving in the stream as data rather than being acted on). Not provable here: the renderer's non-interpretation (xterm with link handling and window opening off) is a window property |
| T43 | Specified retention on close; temporary children cleaned up | `tests/scenarios/terminal.test.ts` `T43: closing a terminal, and what it kept` (close ends the shell and refuses more input, `closeAll` ends every terminal this app started, and the scrollback is bounded at 512 KB with the newest output kept) plus `tests/terminal.test.ts` and `tests/processes.test.ts` (`ending everything`, so no child survives the app). Not provable: the process-and-log viewer's retention as a window flow |
| T44 | An old preview frame is rejected; the visible owner is accurate | The rejection is proven: `tests/preview-live.test.ts` (eleven tests, green). `PreviewFrame` (`src/lib/ipc.ts`) carries `preview`, `project`, `workspace`, `epoch` and `bytes`, and `src/preview/live.ts` decides what is drawn: a frame that does not name its preview, its workspace and its epoch is dropped and adopts nothing; a picture from another workspace's browser, or from an earlier epoch of the same preview, is dropped rather than drawn as the one now; the window forgets what a project was showing when the last thing looking at it stops, so a pane opened again adopts whatever the shell sends then; and a picture arriving while the window is out of sight goes to nobody. Not proven: "the visible owner is accurate" as somebody sees it — no test drives a preview in the real window |
| T45 | Modal usable, focus trapped and restored, no intercepted clicks | Not provable. Needs the visual and accessibility layer 10.1 lists — layout, focus, native overlays, keyboard, screen reader — and nothing here asserts those. The Electron runner itself exists and ran here (see above); no test drives the modal for this |
| T46 | The selected tab is visible and core controls are reachable at 20+ tabs and a narrow window | `tests/tab-strip.test.ts` (unchanged): every tab rendered, the selected tab scrolled into view, Arrow/Home/End and Alt+Arrow, focus returned after a close, twenty tabs. Not provable: the 620x520 zoomed window matrix, which is a visual layer (U05, never run) |
| T47 | Bounded DOM, stable selection and scroll, working Jump to latest while streaming | `tests/thread-rows.test.ts` (unchanged): a screenful and no more, the right screenful while scrolling, the row being read put back when older turns arrive, and a growing row moving what is below it. The arithmetic is in `tests/windowed.test.ts`. The streaming half is exercised in a real window now (`tests/electron/smoke.test.ts` `shows a reply arriving in pieces, in the order they were sent`); not provable: "Jump to latest" itself while a reply is arriving, which lives in `App.tsx` and no test presses |
| T48 | Bounded memory, an explicit fallback, retained content accessible | `tests/session-replay-fidelity.test.ts` `RF-01` (a long output bounded with a pointer to the rest, an unknown content kind named rather than dropped, a picture named rather than lost on a failure) and `RF-02`; `src/lib/thread.ts` caps the pictures kept per thread. Not provable: the measured memory claim (phase 9.1's matrix) and the diagram failure path, which is a renderer import |
| T49 | A workspace revision invalidates a stale diff or read; no silent overwrite | Not provable. External-change detection invalidating file and diff caches is not built (phase 3's "not done" table): `verifyWorkspace` records `verifiedAt` and a state, and no revision is compared against a reader's |
| T50 | A tightened permission is checked before a queued action runs | Not provable. E07 is open: `forwardTo` still accounts after a turn has begun, so there is no pre-execution permission check to assert |
| T51 | Distinct outcomes for complete, stuck, waiting and stopped; no false checklist or endless loop | `tests/scenarios/recovery.test.ts` `T51: a goal that finished, one that is stuck, one that is waiting` (done only when every step settled and the checks passed; each way of not finishing has its own sentence and they are all different; a finite round ceiling; and pause/resume as explicit commands). Not provable: waiting and stopped as the loop's own outcomes, which need the run records (E07). The loop's stop and the Escape path are in `tests/e2e/scenarios.test.ts` `S-2` and `S-3` |
| T52 | A defined ordering for child completion, a typed follow-up and an extension's turn, with no duplicate admissions | Not provable. E07 is open (no typed request or admission record), so the ordering is not decided anywhere to test. The one part that is decided is proven in `tests/e2e/scenarios.test.ts` `S-7` (one attributed turn per settle, however often the add-on asks) |
| T53 | Usage attributed once, to the correct runs and conversations | `tests/scenarios/conversation-ownership.test.ts` `T53: usage from two runs in one conversation` (the ledger reports the sitting's whole total each time and only the difference is charged to the second job, so the sum is the total and never double; the money lands on the project while the words land in the conversation that ran) |
| T54 | Terminal tool state and a usable reconnect after a disconnect, timeout or cancelled auth; no indefinite wait | `tests/scenarios/mcp.test.ts` `T54: a server that takes a tool call and never answers` (a real stdio server: reached, listed, called; an unreachable one answered with words; and the same server connected again after the hung one is closed). **Was a defect** — a call the server never answers had no bound of its own; fixed, see the register below. The ordinary round trip is in `tests/mcp.test.ts` |
| T55 | Accurate interrupted states; no lost accepted writes or orphan spam | `tests/scenarios/recovery.test.ts` `T55: an app that was force quit` (every in-flight state reads `interrupted` and loses its owner and generation; idle, failed, interrupted and archived keep what was written; and `alive` is only believed with a recorded generation). Not provable: "no lost accepted writes" and "no orphan spam" as measurements, which need the packaged app and a real quit |
| T56 | Honest failure with prior data retained and recovery possible, for disk full, permission denied and a corrupt registry | `tests/scenarios/migration.test.ts` `T56: a registry file that will not read` (a broken file comes back as no data with the reason and never as a throw; a future version is refused the same way; readable rows survive an unreadable sibling; and a refused read is never mistaken for an empty profile). Not provable: disk full and permission denied, which need an injected failure in the writers that live in `electron/main.ts` around `app.getPath('userData')` |
| T57 | The correct transcript target is archived or deleted; worktrees and files remain | `tests/scenarios/recovery.test.ts` `T57: deleting a chat, and archiving one` (the transcript is moved to the trash and readable there, the workspace record, its folder and the uncommitted files are untouched and not marked deleted; archiving flips a flag and can be brought back with the same identity; and a workspace can be written down as gone without losing its folder) plus `tests/trash.test.ts` |
| T58 | Dirty and recovery data excluded; the exact removable resources shown | `tests/scenarios/recovery.test.ts` `T58: what the storage screen may clear` (a checkout holding work is kept however old, a finished one goes, the sentence names what stays and why, the exact path removed is the one reported, and a cleared checkout leaves its branch behind so the work is still somewhere) plus `tests/storage.test.ts` |
| T59 | Bundled runtime, assets, helpers and prerequisite UX in a clean installed app from Finder | Not provable. Needs a signed, packaged app launched with a minimal PATH; `npm run package` and `npm run verify:package` are not run in this environment (phase 9.6 and the release handoff both record it as unrun) |
| T60 | A backup is recoverable and an old app never writes incompatible migrated data silently | `tests/scenarios/migration.test.ts` `T60: the app is replaced by an older one` (a marker from a later version is not trusted, so a downgrade re-runs rather than believing what it cannot read; and every file about to be written over is named with its `.bak` before anything is written). Not provable: two real builds of the app swapping over one profile |

## Defects found

Three were, each with a failing test that named the finding while it stood. All
three are fixed now and their tests are ordinary passing tests; `it.fails`
appears nowhere under `tests/scenarios/` any more.

1. **T13: two reviews of one head asked for at once.**
   Both calls saw no branch for that head and both tried to create it, so the
   loser was refused with "I fetched pull request #7 but could not point a
   branch at it" rather than reusing the checkout the winner had just made — a
   check-then-act across two git calls with nothing held in between. Nothing was
   lost: the folder was left alone and the message was typed. What was wrong was
   that the second review did not open. Fixed by preparing one review at a time
   per project: `electron/prWorktree.ts:436-473` queues a caller behind whatever
   is already preparing for that project, so the second finds the branch, the
   folder and the registration the first made, and reuses them.
   `tests/scenarios/pr-review.test.ts` `T13: two fetches asked for at once` >
   `gives two reviews of the same head one verified checkout rather than two` is
   a passing test, and the test below it still proves that asking in turn reuses
   the same checkout.

2. **T23: a fresh chat in the same project showed the other chat's references.**
   `references`, `attachments` and `draft` were fields of the project's `Desk`,
   and `showThread` kept the project's fields across a change of conversation,
   so "explicit shared context" and "what this chat was sent" were the same
   thing. Fixed by S01, phase 4.5: those three belong to the conversation, held
   as the conversation in front's own fields and, for a parked conversation, in
   its entry in `parked` (`src/lib/projects.ts` `conversationIn`,
   `changeThread`), while `context` stayed the project's.
   `tests/scenarios/conversation-ownership.test.ts` `T23: a reference brought
   into one chat, then a fresh chat opened` is three passing tests. T26, the
   same finding on the box, is proven in the same file now; T27's draft half is
   proven in `tests/draft-kept.test.ts`.

3. **T54: a tool call the server never answers has no bound of its own.**
   `McpRegistry.call` awaited `session.client.callTool` with no timer armed, and
   the catch below it only ran if the call rejected: a server that took the
   request and held it left the tool waiting for ever — the "tool spinner that
   never stops" the plan names, and "a disconnected server cannot leave a tool
   spinner forever" from 9.5. Being unreachable, being unknown and answering
   with an error were all handled and tested; only silence was not. Fixed with
   the app's own patience: `callPatienceMs()` races the call against
   `CALL_PATIENCE_MS` (120 s), read through `GRAPHE_MCP_CALL_MS` so a test can
   prove the bound without waiting for it. `tests/scenarios/mcp.test.ts` `T54: a
   server that takes a tool call and never answers` > `gives up on a call the
   server never answers, within a bound of its own` is a passing test.

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
| The conversation registry as a first-class record with `lineage` (4.1, 4.4) — 4.5's references, drafts and box owned by the conversation are landed | T03, T04, T27 (the queue state the window would show) |
| Session service states driven by the adapter, and run and view records (4.2) | T16, T17, T21, T22, T30 |
| The typed request and admission record (E07), and 6.2's runtimes out of the main process | T17, T35, T36, T38, T39, T50, T51, T52 |
| The owner-scoped panels completed in the shell and the hooks (5.1, S08, W10) — U04's frame ownership landed | T24, T25 |
| A process boundary that preserves the Guard, request and transcript hooks (6.2, 6.5) | T38, T41 |
| External-change detection against a reader's revision (phase 3, "not done") | T49 |
| The renderer's own suites: the visual and keyboard matrix, packaging and a clean machine (10.1's last three layers) — the window with a scripted provider landed in wave 1 | T05 (card), T07, T08, T42 (renderer half), T43 (viewer), T44 (a preview in the window), T45, T46 (zoom), T47 (jump), T48 (memory), T55 (measurements), T59 |
| Two builds of the app over one profile | T60 (reverse direction) |
| The provider retry path with a real provider | T31 (retry half), T32 |
