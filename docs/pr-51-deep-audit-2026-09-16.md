# PR #51: execution and UI regression audit

Baseline: `b305df7`, branch `fix/ownership-stabilization`, 16 September 2026.
Scope: the stabilization contract, remaining-work document, final-before-publish
document, phase handoffs and acceptance catalogue, compared with production code
and executable tests. This register supersedes older completion claims where it
identifies a regression. Audit first; implementation and verification follow.

P0 means data loss, unintended execution or a wrong-target mutation. P1 means a
broken core workflow or misleading ownership. Source-confirmed means the actual
production call path establishes the defect; it does not claim a desktop
reproduction. No percentage of all possible bugs is measurable from this audit.

## Renderer findings

All rows below are source-confirmed at the baseline; verification is pending.

| ID | Priority | Failure and exact cause | Required fix and regression |
| --- | --- | --- | --- |
| UI01 | P1 | Canvas Close never removes its tab. `App.canvasTabs` maps every stored flow; `closeTabRow` only sets `canvasAt` to null. | Keep open canvas view IDs separately from saved drawings; Close removes the view, reopening restores the same drawing/run. Exercise selected and background Close, then reopen. |
| UI02 | P1 | Keyboard canvas navigation/Close uses conversation handlers. `tabRow.handles(goToTab, closeTab)` receives canvas IDs from `tabRow.drawn`, then passes them through conversation ownership parsing. | Bind the keyboard to the same kind-aware handlers as mouse controls. Test numbered navigation, next/previous and Close for mixed tabs. |
| UI03 | P1 | Split while in canvas breaks the layout and hides its pane controls. `.app--canvas .app__column` hides the controls; `.beside` is a normal-flow block before a full-height canvas, rather than a bounded split. | Render a bounded split with independently scrollable conversation content, visible focus/close controls and responsive sizing. Exercise canvas Split, Watch, close either pane, chat Split, focus changes and narrow windows. |
| UI04 | P0 | A late canvas save can copy A's drawing into B's renderer and subsequently B's storage. `changeFlow` accepts its response without checking project; project changes keep old flows until `flowList` returns; `CanvasView` schedules saves whenever its flow prop changes. | Owner-key all canvas state and writes, clear stale views on project switch, reject stale responses, and only save user edits. Delay A's read/save across A→B→A and inspect both projects' files. |
| UI05 | P1 | Canvas continuously resaves itself. `CanvasView`'s `[flow]` effect calls `onSave`; App wires both `onFlow` and `onSave` to `changeFlow`; each save response replaces flow props and schedules the next save. | One save coordinator; incoming snapshots and run events must never create writes. Assert no save on mount/server update and one coalesced save per edit burst. |
| UI06 | P0 | Canvas edits can disappear or resurrect deleted drawings. Two debounce layers defer the final bridge write after `beforeunload`; Delete neither cancels pending saves nor checks its result; a pending save can recreate a deleted flow. | Single owner-bound queue with flush/cancel and ordered writes; cancel before Delete, await success before removing local data, report save/delete failures. Test edit-close, edit-delete, rejected save/delete and out-of-order replies. |
| UI07 | P1 | Start can run an older drawing after failed saving. `lastSave` tracks only the last global promise, ignores `Result.ok`, and Start runs regardless. | Await all pending writes for the selected project/flow; block Start on failed persistence and keep retryable edits. Test immediate edit→Start and failed-save→Start. |
| UI08 | P1 | Canvas Attach accepts a file selection and does nothing. App never supplies `CanvasView.onKeepAttachments`. | Wire the existing attachment store, surface rejected files, retain owner through upload, and append to the latest block revision. Test file bytes reach a block and subsequent turn. |
| UI09 | P0 | Draft→Canvas can create the canvas in the project selected during upload. The callback awaits `keepBoxAttachments` before `newCanvas` reads the current project. | Capture project and draft owner before upload; store in that project and only navigate if still current. Test switching projects during upload. |
| UI10 | P0 | Secondary-pane plan approval, estimate acceptance, review repair and retry mark the clicked owner but call `deliver`, which reads the focused desk. `forkHere` also reads the focused desk rather than the clicked transcript. | Pass an explicit captured owner through every action, including model/plan state, attachments and shared context. Verify secondary-pane actions call only that conversation/workspace. |
| UI11 | P1 | Closing the focused pane changes `panes.focused` but leaves the desk/composer on the closed conversation. The desk→pane effect only watches `desk.address`. | Reconcile focus and desk as one navigation action; remove closed/deleted conversation references from panes. Test closing either of two different chats and deleting a chat visible twice. |
| UI12 | P1 | Saved second panes disappear after restart. `panesFrom` only accepts conversations already loaded in `held.conversations`; launch normally loads only the first conversation. | Validate persisted views against project conversation records and hydrate the second transcript before restoration. Preserve two views of the same chat too. Test cold restart with different chats and with one chat shown twice. |
| UI13 | P1 | New on an empty chat is ignored despite stable draft identities. `swapConversation(null)` returns when the current transcript is empty, even when there is a draft. | Each explicit New press creates a distinct conversation; retain drafts independently. Verify two empty New actions, typing, switching and restart. |
| UI14 | P1 | Inspector reads still cross owners. `useInspector.refreshVersions` and `refreshBuildPlan` call unqualified bridge methods; versions and overview share one request counter; `refreshRunning` only checks project. | Address every read, use independent request generations per query/owner, clear stale display and reject old responses. Test delayed A responses after B and concurrent overview/version refreshes. |
| UI15 | P1 | Pin advertises a pinned inspector but only changes the label. `inspectorPane` is used for `pinnedWords`; Overview still receives `desk.overview`, current chat references and current run state. | Supply the inspector's actual owner and complete snapshot, or remove the unsupported Pin control until it does. Never show a false ownership label. |
| UI16 | P1 | Tokens show the project root while a worktree conversation is selected. The tokens effect only depends on `openProject` and sends `{project}`. | Fetch using the selected workspace conversation, clear on owner change, reject stale replies. Test two workspaces with different token values. |
| UI17 | P1 | Preview address survives a project switch and can be associated with the next project. `usePreview` keeps page address/owner as window state and only changes owner when the address differs. | Close and clear native preview/address on project/workspace change; use the captured owner for hide/close/reload. Test same localhost address across two owners. |
| UI18 | P1 | Header overflows at the supported 620×520 window and 200% zoom (310 CSS px). Reproduced by the visual matrix: 324px content in a 310px topbar. Fixed minimums in Tabs/project controls exceed available space. | Reduce the project label's minimum and allow the tab group to shrink while retaining reachable actions. Re-run all size/zoom rows and hit tests. |

### Renderer repair status (2026-09-16)

The renderer ownership, persistence and pane changes are implemented; final
desktop verification is still pending. The implementation now keeps open canvas
views separate from saved drawings (UI01–UI03), makes canvas writes owner-keyed
and serialized with flush/cancel before Start/Delete (UI04–UI07), and wires
canvas attachments to the durable attachment store (UI08–UI09). Secondary-pane
actions, fork/review/plan actions, desk focus, project switching, inspector and
preview reads now carry their captured project/conversation owner (UI10–UI17).
The responsive header minimums were reduced for the documented narrow/zoom
rows (UI18). Focused evidence includes `tests/canvas-view.test.ts`,
`tests/canvas-writes.test.ts`, `tests/panes.test.ts`,
`tests/workspace-registry.test.ts`, `tests/inspector-ownership.test.ts`,
`tests/preview-live.test.ts` and `tests/draft-kept.test.ts`; the real-window
canvas split/close/reopen smoke passed before the final integration changes.
No row here is an exhaustive-bug claim.

### Verification harness defects (not product bugs)

- The long-project-name visual row captures `mine` **after** switching into the
  other project, then compares the original project's restored count with that
  other project's count. Capture `here.tabs` before switching. The observed red
  row alone does not establish a product defect.
- The loading-layout row tries to intercept the Settings module after theme rows
  have already imported it. Test a fresh renderer lifecycle with interception
  installed before the first Settings import; keep the loading assertion.

### Terminal findings added during verification

| ID | Priority | Cause | Repair and proof |
| --- | --- | --- | --- |
| T01 | P1 | `TerminalPane` never imported xterm's required stylesheet. Its normally invisible helper textarea painted as a small focused input; viewport positioning and scrolling were also unstyled. | Import the installed xterm stylesheet, retain an invisible helper input, constrain the drawer's flex height, and verify typing and scrollback in Electron. |
| T02 | P1 | ResizeObserver only resent the unchanged default `cols`/`rows`; it never resized xterm itself. A 24-row terminal overflowed the short drawer. | Measure actual rendered cell dimensions, fit rows/columns to the host, then resize the PTY to match. Verify after window resize and with `stty size`. |
| T03 | P0 | Terminal data and exit listeners accepted every session ID; worktree terminals were opened with project-only ownership. | Capture project/conversation, filter every event by terminal ID, and scope terminal listing to exact workspace equality. Add owner-isolation regressions. |
| T04 | P1 | Hide/reopen created another shell; Close only hid the pane. Scrollback replay raced live output, duplicating or losing chunks. | Preserve/reuse hidden sessions, make explicit Close stop the owned shell, and reconcile replay/live chunks by monotonically increasing sequence. Test hide, reopen, close, and concurrent snapshot output. |

### Terminal repair status (2026-09-16)

T01–T04 are implemented: the xterm stylesheet/flex sizing and PTY fit path
were added, terminal events/listing are exact-owner scoped, hidden sessions
are reused while explicit Close stops the owned shell, and scrollback uses a
sequence-bearing snapshot. The real Electron terminal smoke passed its 10
second output/scroll/resize/input scenario. Final integrated verification is
still pending.

The Electron harness now bounds owned-process cleanup and closes test-server
connections so cleanup cannot hide a body assertion behind a 180-second timeout.
The old smoke expectation that unsaved conversation text disappears is replaced
with the required preservation assertion. Final desktop evidence is still pending.

## Backend findings

### Canvas execution

Source-confirmed against the shell integration, not merely the fake runner port.

| ID | Priority | Failure and cause | Exact repair and required proof |
| --- | --- | --- | --- |
| F01 | P1 | `beginRun` never calls terminal cleanup after its initial `drive`; completed flows remain in `liveRuns` and cannot start again. | Always finalize terminal outcomes and await persistence/journal cleanup. Test successful/failed run followed by Start again. |
| F02 | P1 | Crash recovery never converts persisted canvas runs to `interrupted`; the journal uses a synthetic conversation ID. | Recover flow/run/project ownership explicitly, mark unfinished runs interrupted, retain completed blocks and actual lane identities. Test crash→relaunch→Resume. |
| F03 | P0 | Start checks the live map before asynchronous setup reserves the ID, so simultaneous Starts execute twice. | Synchronously reserve owner-qualified flow identity before awaits and release on setup failure. Barrier-test duplicate Start. |
| F04 | P0 | Delete writes removal before stopping; a delayed run persistence callback falls back to its captured drawing and recreates it. | Invalidate callbacks, stop and drain work/persistence, then delete. Test deleting during a held turn. |
| F05 | P0 | Save and run snapshots each perform independent read/modify/write operations on the project's entire flow file. Atomic rename does not prevent lost updates. | Serialize the complete transaction per project; merge drawing/run ownership inside the transaction and await final writes. Race edits, separate flows and run updates. |
| F06 | P0 | Canvas turns call `session.prompt` directly without the normal workspace writer lease. | Acquire/inherit a run-owned workspace lease for each lane and hold it through checks/review, releasing only after owned work stops. Test a chat competing with a flow and two flows sharing a workspace. |
| F07 | P0 | Lane zero starts the most-recent conversation rather than the workspace captured by Start, and its workspace ID remains blank. | Capture Start's conversation/workspace, validate ownership and create a dedicated flow conversation in that exact workspace. Persist every lane workspace ID. Test local/worktree content divergence. |
| F08 | P1 | Block model overrides are not restored when the prior model was default; thinking overrides are never restored. | Restore both settings in `finally`, including default model. Test successive blocks and failure paths. |
| F09 | P1 | Review/PR turns omit usage from run totals; `turnInLane` overwrites rather than sums spend events. | Carry real turn/usage results through all port methods and sum compatible amounts once. Test multiple rounds and review retries. |
| F10 | P1 | `picturesFor` silently drops documents and missing attachment IDs. | Use the normal attachment/document conversion path and fail visibly for unavailable input. Test PDF text/image payloads reaching the model. |
| F11 | P1 | Throwing check/review/PR/stop/persistence ports can reject the runner without a terminal state or cleanup. | Convert failures to truthful block/run states; guarantee final cleanup and persistence error reporting. Throw at each port boundary. |
| F12 | P1 | Worktree capacity is read separately by each flow, without shared reservations. | Reserve/release global lane capacity, including simultaneous flows; test the configured ceiling under fan-out. |
| F13 | P1 | Worktree mode permits a linear PR block even when that block's lane is still on the default branch. | Validate the actual PR lane branch before executing the PR turn. Test default-branch refusal and a real worktree branch. |
| F14 | P1 | Live shape saves alter the displayed/persisted graph while execution uses a captured older graph. | Refuse structural edits during a live run, including stale renderer saves; preserve run ownership. |
| F15 | P1 | `flowSave` validates only ID then casts arbitrary wire objects. | Strictly validate the full drawing at the IPC boundary; reject malformed blocks/IDs/edges and discard renderer-supplied run history. |
| F16 | P0 | `FlowFile.read` turns corrupt primary JSON into an empty success that a later save overwrites. | Preserve corrupt bytes and return an explicit recovery error; never infer absence from parse failure. Replace the obsolete empty-success expectation. |
| F17 | P0 | Stop/Continue/Delete resolve `liveRuns` by unqualified flow ID and never compare its project with the requested project. | Key operations by stable project plus flow and verify ownership before every mutation. Test identical IDs across projects and mismatched requests. |

### Canvas execution repair status (2026-09-16)

| ID | Status | Evidence and remaining limitation |
| --- | --- | --- |
| F01 | Fixed at runner boundary | `beginRun` now settles terminal runs, removes live ownership, releases leases and clears the in-flight note; focused runner/flow tests pass. A full Electron Start-again interaction remains final-gate evidence. |
| F02 | Fixed at flow persistence boundary | `flowList` converts stale `running` and `needs-you` runs to `interrupted`, preserving completed blocks and lane records; Resume also normalizes stale running state. Focused flow persistence tests pass. The launch journal remains a synthetic flow note because the existing journal schema has no canvas-run field. |
| F03 | Fixed | Owner-qualified synchronous `startingFlowRuns` reservation covers Start and Resume, with release on every setup path. The main IPC handler is not independently importable; final Electron barrier coverage remains. |
| F04 | Fixed | Delete advances the owner-qualified flow generation, invalidates callbacks before stopping, waits for the driver/persistence barrier, releases the runner and only then removes the flow. Late callbacks skip missing/invalidated generations. No physical Electron held-turn injection is available in the focused harness. |
| F05 | Fixed at persistence seam | `FlowFile.transact` serializes complete project documents and run callbacks merge against fresh state; saves retain runner-owned runs. `tests/flows.test.ts` now behaviorally races independent additions/edits and verifies both survive; a multi-IPC process race remains final-gate evidence. |
| F06 | Fixed at runner boundary | Each lane acquires a canonical workspace lease and retains it through the run; queued leases can be cancelled and owned leases release on stop/error/terminal. Main IPC competing-chat behavior needs Electron-level proof. |
| F07 | Fixed | Start captures the current conversation's workspace, lane zero opens in that exact workspace, and persisted lanes reacquire their recorded workspace on Resume. Branch metadata is retained for PR validation. Desktop local/worktree divergence remains final-gate evidence. |
| F08 | Fixed | Runner resolves flow defaults for unset blocks and main restores both model and thinking in `finally`, including a previously-null model. Focused default propagation test passes. |
| F09 | Fixed | Streaming spend now sums compatible events; review and PR turn usage flows through block and run totals. Focused runner suite passes; paid-provider accounting remains outside automated scope. |
| F10 | Fixed at attachment seam | Canvas IDs resolve through the attachment store; PDFs become prompt text, images retain payloads, and missing IDs fail visibly. A real stored PDF/image turn remains Electron/provider evidence. |
| F11 | Fixed at runner boundary | Lane/check/review/PR exceptions become failed blocks/runs; stop cleanup is best-effort and cannot reject terminalization. Persistence callbacks now consume failures, publish a failed run and release leases instead of creating unhandled rejections. Run-journal writes/removals now return individual queue errors while keeping later operations usable, and main call sites log/report those failures rather than silently dropping them. Focused fake-port coverage exists for runner paths; physical disk-failure injection remains final-gate evidence. |
| F12 | Fixed | Worktree lanes reserve a shared global count and release reservations on create failure, stop, terminal and error. Capacity behavior is covered by the pure runner suite; simultaneous Electron flows remain final-gate evidence. |
| F13 | Fixed | Pull-request execution refuses a default-branch lane and uses actual lane branch metadata for worktrees. Pure runner tests pass; a real Git/`gh` run remains final-gate evidence. |
| F14 | Fixed | `flowSave` rejects live/starting flows and preserves runner-owned run history; renderer saves update `updatedAt` through the serialized transaction. Renderer save coordinator verification is tracked separately under UI04–UI07. |
| F15 | Fixed at IPC parser | `readFlowStrict` validates the full drawing shape, edges and IDs; `flowSave` no longer casts arbitrary wire objects and discards renderer run history. Focused flow parser tests pass. |
| F16 | Fixed | Existing malformed primary and legacy flow files raise `FlowFileUnreadable` without overwrite; handlers expose recovery trouble, and obsolete empty-success tests were replaced. Focused `flows` tests pass. |
| F17 | Fixed | Stop/Continue/Delete use canonical project-qualified keys and monotonic generations; Stop/Delete install a drain barrier so an old driver cannot mutate a later Start, while deleted callbacks are invalidated. Cross-project IDs cannot address another live run. Main handler interaction remains final Electron evidence. |

Worktree setup cleanup is also fixed at the runner-port boundary: after a copy
is created, every setup failure stops the owned conversation, releases its
lease and attempts to remove the copy; if removal fails, the workspace/index
record is retained and the error explicitly says cleanup is incomplete, so a
user's evidence is recoverable rather than silently discarded. This is covered
by the focused worktree/landing wiring tests; an injected Electron Git failure
remains final-gate evidence.

Related usability repair: shell-controlled `updatedAt` must advance on actual
drawing edits so Open canvas chooses the last edited drawing. Canvas default
model selection also needs an owner: currently its picker changes the focused
chat while its runner chooses another conversation.

### Data safety and recovery

| ID | Priority | Failure and cause | Exact repair and required proof |
| --- | --- | --- | --- |
| D01 | P0 | `moveToTrash` uses timestamp plus basename and POSIX rename replaces an existing target. Two same-name transcripts deleted in the same millisecond collide. | Allocate collision-free targets atomically; test both transcripts remain independently restorable. |
| D02 | P1 | `dropWorktree` and `releaseWorktree` ignore failed Git removal/branch commands and return success; callers discard ownership records. | Check each result, report partial cleanup accurately and retain recoverable ownership until cleanup succeeds. Test permission/Git failures. |
| D03 | P1 | Worktree land/drop/reviewLand put the conversation down before later operations that can fail, leaving UI/session state inconsistent after refusal. | Preflight first and restore a usable conversation on failed cleanup/merge; preserve workspace records. Test merge conflict, hook rejection and failed removal. |
| D04 | P0 | `saveWorkspaceIndex` catches write errors and resolves successfully. Accepted workspace/conversation/relink changes disappear on restart. | Return the operation's persistence rejection while keeping the queue usable; keep memory/disk coherent and report the failed operation. Inject disk write failure and verify prior data. |
| D05 | P1 | Live project lookup uses lexical `resolve` paths while durable registry uses canonical paths. Opening a symlink alias can create duplicate live project/session ownership. | Canonicalize existing project paths before live lookup; preserve explicit missing-path recovery. Test real path plus symlink opens share live identity. |
| D06 | P1 | One malformed legacy checkout JSON throws inside migration's `Promise.all`, aborting valid projects' migration too. | Parse sources independently; quarantine unreadable source evidence and continue valid records. Test one corrupt source alongside a valid one. |
| D07 | P1 | `readMarker` accepts missing migration evidence/counts by defaulting fields; boot treats that partial marker as completion. | Validate required fields/count consistency and rerun incomplete migration idempotently. Test truncated/malformed markers. |
| D08 | P1 | Attachment metadata validation checks only name/size, trusting mismatched IDs, kinds and thumbnail paths. | Validate complete metadata against requested content ID and constrain thumbnail basename; safely repair metadata on re-import. Test malformed IDs/type/path/size. |
| D09 | P1 | Conversation registration precedes live-session adoption, but `noteWhereItWorks` reads the not-yet-adopted session from the live list. It persists a null transcript link. After a crash, the transcript can receive a second identity and restoring the original pane opens an extra blank tab. | Pass the session being created directly into registration; durably write its transcript and title before adoption. Cover the ordering/explicit source with `pr51-data-wiring`, and verify crash/restart with the real Electron harness. |

Additional P2 repair: trash listing must not present non-transcript files as
restorable conversations when restore/empty will reject them.

### Data-fix verification (2026-09-16)

The following status is for the implementation pass on this revision. “Wired”
means the Electron-only seam is covered by a source contract; it does not claim
that an Electron process or a failing physical disk was injected here.

| ID | Status | Evidence and remaining limitation |
| --- | --- | --- |
| D01 | Fixed | `moveToTrash` now chooses a collision-free name with an atomic no-clobber move, falls back when hard links are unsupported, and removes only candidates it created if source unlink fails; `tests/trash.test.ts` covers collisions, fallback, and cleanup. |
| D02 | Fixed | `dropWorktree`/`releaseWorktree` check Git results and retain failure ownership; branch-removal failure is distinguished, and `landWorktree` reports the merge as complete but cleanup incomplete. `tests/worktree.test.ts` and `tests/landing-squash.test.ts` cover all stages. |
| D03 | Fixed at operation ordering | Land/drop/review land now stop a copy session while retaining its ownership record, and only put it down/delete the record after success; `tests/pr51-data-wiring.test.ts` covers ordering. No Electron-level merge-hook/removal failure injection was run; a failed operation leaves the session stopped but reopenable. |
| D04 | Fixed at persistence seam | `saveWorkspaceIndex` now returns the write rejection while resetting the queue for later writes; reopen/start paths no longer swallow registry update failures. `tests/pr51-data-wiring.test.ts` covers the seam. A real profile with an injected `EACCES` at the Electron handler still belongs to the final gate. |
| D05 | Fixed at live lookup | `openProject` and `projectAt` canonicalize existing paths before de-duplicating or resolving live ownership, while recents deduplicate `/private`/`/var` aliases without collapsing missing-path recovery. `tests/pr51-data-wiring.test.ts` covers the seam; a desktop symlink-open scenario remains final-gate evidence. |
| D06 | Fixed | Legacy checkout JSON is parsed per project and unreadable sources are quarantined; `tests/operations/durable-state.test.ts` proves one malformed source does not discard another project's record. |
| D07 | Fixed | `readMarker` now requires complete lists, nonnegative integer verdicts, and count consistency; malformed/truncated/mismatched marker cases are covered in `tests/migration.test.ts` and `tests/operations/durable-state.test.ts`. |
| D08 | Fixed | Metadata must match the requested content id, use the fixed thumbnail basename/type contract, and contain a parseable `keptAt`; `tests/attachment-store.test.ts` proves malformed metadata is rejected and repaired on re-import. |
| D09 | Fixed in final integration | Registration now reads `session.conversation` and `session.name` from its explicit parameter, not an absent live-list entry. Durable-before-adoption ordering is preserved. Final desktop crash/restart evidence follows below. |
| P2 trash listing | Fixed | `listTrash` now exposes only regular `.jsonl` transcripts; the trash suite covers unrelated files/directories remaining unlisted. |

The same focused pass also fixed project scoping for durable panes and terminal
lists. `viewsLook`/`viewsNote` now resolve the project from `Where`, reject
foreign conversation ids before mutating anything, and preserve other
projects' panes; `terminalList` uses exact canonical workspace equality rather
than a prefix. `tests/workspace-registry.test.ts` and
`tests/pr51-data-wiring.test.ts` cover the registry and Electron seams.

The checkpoint race found during baseline verification is separately fixed in
`src/history/repo.ts`: a compare-and-swap retry rebuilds its candidate tree from
the newly advanced parent. `tests/operations/file-operations.test.ts` now also
checks that both writers' files are present in the final checkpoint.

### Runtime, subagents and admission

| ID | Priority | Failure and cause | Exact repair and required proof |
| --- | --- | --- | --- |
| R01 | P1 | Optional child sessions expose empty/no-op feature implementations and do not register Graphe's tool factory; task/MCP/memory/commands and other features silently disappear. | Share supported tool/feature behavior across runtimes, or explicitly prevent unsupported mode activation with a visible reason. Never advertise empty results as feature parity. Test runtime selection and supported capabilities. |
| R02 | P1 | Child `prompt`/`steer` skip the in-process admission callback. | Apply the same admission/epoch checks before either RPC call; test stopped/stale/duplicate requests. |
| R03 | P1 | A rejected child RPC prompt returns `success:false` without a settle event, but Hosted waits forever for settle. | Validate RPC responses and clear in-flight state on rejection; test failed prompt/steer. |
| R04 | P1 | Child Stop emits synthetic settle then accepts late events from the stopped run. | Use one authoritative terminal transition and cancellation generation; test delayed tool/message/settle after Stop. |
| R05 | P1 | Supervisor command promises have no deadline while a child remains alive but nonresponsive. | Bound command waits, clear timers and reject pending work on timeout/write failure/exit. Test nonresponsive child. |
| R06 | P1 | Child exit does not cancel pending shell extension dialogs; child judge timeout does not cancel its shell Guard question. | Propagate cancellation to pending asks/verdicts and withdraw UI requests; test death/timeout and late answers. |
| R07 | P1 | Idle eviction unregisters a child; wake starts it without re-registering, bypassing capacity tracking. | Re-register each live generation and prove evict→wake→capacity enforcement. |
| R08 | P1 | Task fleet initially reserves a no-op Stop callback; Stop during setup clears the entry but later setup still spawns. Already-aborted signals are not checked before spawn. | Preserve cancellation through setup, check before spawn and immediately stop if cancellation wins handoff. Barrier-test Stop during helper setup. |
| R09 | P1 | Builder-copy creation throws before task's `try/finally`, leaking fleet capacity. | Include all post-reservation setup in cleanup scope; test failed worktree creation frees capacity. |
| R10 | P1 | A queued add-on command obtains a workspace lease then returns on stale command validation before its release scope. | Release the newly acquired lease on every early refusal; test a removed command queued behind another run. |
| R11 | P0 | Renderer auto-approves every nonempty questionless plan regardless of permission rung. | Require explicit full-access authorization; ordinary/Plan sessions retain approval. Test each rung and secondary-pane ownership. |

### Runtime and admission repair status (2026-09-16)

The child-runtime guard/fallback is implemented: production sessions no longer
silently opt into the incomplete child surface; unsupported child UI requests
are cancelled and reported, and a child that cannot start falls back to the
same guarded in-process session. Supervisor command waits now have deadlines,
pipe/exit cleanup settles pending RPC and extension asks, Stop ignores late
events, idle eviction re-registers a woken child, and unload failures keep the
child counted (R01, R03–R07). Task setup now checks cancellation before and
after copy creation, provides a real fleet stop signal, and releases the
reservation on copy/setup failure (R08–R09); queued add-on validation releases
newly acquired workspace leases on early refusal (R10). The renderer plan
auto-approval now requires the full-access rung and is covered by
`tests/plan-authorization.test.ts` (R11).

R02 is repaired at the same admission seam as the in-process adapter: Hosted
prompt/steer call `admit` with their origin and running state before RPC. Folder
leases and continuation epochs remain enforced by the shell, as they are for
in-process sessions. The packaged-app flag now absolutely disables experimental
child conversation activation, even if `VITEST` or `NODE_ENV=test` is inherited.
The focused child-session and Hosted tests passed 13/13, including packaged
environment contamination and steering before/during a turn. This closes the
admission bypass without claiming full child-runtime feature parity.

The initial cross-area audit register is complete. Repairs are dispatched against
these concrete rows; new findings during verification will be appended, not hidden.

## Verification and coverage

- Baseline working tree was clean. GitHub CLI is authenticated as `AadiXC0DE`.
  New commits must use `aadityaz2077@gmail.com`, with no attribution trailers.
- An integrated full-suite run completed with 391 files, 7,042 passing tests and
  19 skips. The terminal real-window scenario also passed its 10-second
  output/scroll/resize/input path, and the prior canvas split/close/reopen smoke
  passed. These are intermediate gates only: the final post-repair suite,
  rebuilt Electron canvas gate Stop→Start path, and final visual matrix are
  superseded by the final results below. No result here claims exhaustive
  coverage or 99.9% bug detection.
- Browser skill discovery returned no available browser. The repository's real
  Electron harness supplies desktop interactions and screenshots.
- Physical monitor removal, VoiceOver speech and live paid-provider behavior
  require separate evidence. Automated substitutes will not be labeled as those
  checks. Existing documented capability gaps are not automatically fixed by
  making their tests green.

### Integration evidence

- Full unit/integration suite: 391 files passed, 7,042 tests passed, 19 skipped
  (`/tmp/graphe-final-tests2.log`). Subsequent focused canvas/terminal/data
  regressions: 93 passed (`/tmp/graphe-release-focused.log`).
- Production renderer and Electron build passed. Lint: zero errors, 215
  warnings (warnings remain, not described as a clean lint baseline). Shipped
  copy and dependency-license checks passed (424 installed dependencies).
- Bundle budget passed: main 416.7 KB raw / 127.5 KB gzip against a 450 KB cap.
- Final renderer visual matrix: **57 rows, 384 checks, zero failures**;
  `results/2026-09-16T16-27-36-949Z/visual-matrix/`. Includes minimum size,
  zoom, themes, loading accessibility, canvas states, and control hit tests.
- Desktop verification covers real shell typing, wheel scrolling in both
  directions, hidden xterm input, resize/`stty size`, canvas close/reopen,
  keyboard Close, split, repeat Start, and Stop at a gate followed by Start.
  All 19 scenario bodies passed in the first full run; its cleanup gate
  correctly failed on an already-exited-process handle. A later run passed
  18/19 with one pre-crash reply timing failure; that isolated scenario passed
  on rerun. Final consolidated post-packaging result is recorded below when
  complete; intermediate failures are retained here rather than erased.
- Harness corrections: await route handlers before removing interception;
  inject normalized canvas fixtures rather than raw legacy records; retain
  the launched process handle and register its exit waiter before SIGKILL.
- Final child-runtime guard/admission pass: 13 tests passed and typecheck
  passed. Production source is frozen after this pass; the distributable is
  rebuilt from it, not from the earlier interim package.

### Final gates after conversation-registration repair

- Final full unit/integration run on the delivered source: **391 files passed,
  7,045 tests passed, 19 skipped, zero failed** in 361.99 seconds
  (`/tmp/graphe-delivery-tests.log`). This supersedes the earlier 7,042 total.
- Full real Electron suite: **19/19 passed, zero failed, cleanup gate passed**
  in 83.96 seconds (`/tmp/graphe-registration-desktop.log`). This supersedes
  the intermediate desktop failures above. Crash recovery now preserves one
  conversation identity; terminal wheel scrolling, typing, PTY resizing,
  canvas tab/split controls, and gate Stop→Start all pass in real windows.
- Registration/data regressions: **67/67 passed** across three files
  (`/tmp/graphe-registration-tests.log`). Typecheck passed after this repair.
- Final renderer visual result remains **57 rows / 384 checks / zero failed**;
  subsequent repairs changed runtime/registration and test cleanup, not the
  renderer tested by that matrix.
- Packaged Apple Silicon app passed both normal launch and `--without-git`
  checks (`/tmp/graphe-delivery-packaged-smoke.log`,
  `/tmp/graphe-delivery-without-git.log`): real visible window, isolated
  profile, native PTY command execution, dependency loading, and missing-Git
  notice. These are executable packaged-app checks, not merely archive checks.
- Both packaged arm64 and x64 main bundles match the final built main bundle byte for
  byte (SHA-256 `3f3b685cabdb458b3fe5f53e7da35d2ca1de0306b63d691c330a76cd091cf9e2`).
  Both architecture artifacts are ad-hoc signed, not Developer-ID signed or
  notarized. Native x64 execution, Finder/Gatekeeper, and paid-provider runs
  were not performed on this arm64 machine.
- Final `npm run package` completed successfully and verified both bundles,
  native dependencies, archive contents, ad-hoc signatures, and DMG layouts
  (`/tmp/graphe-delivery-package.log`). Final artifacts:
  `release/Graphe-1.0.3-arm64.dmg` (108 MB) and
  `release/Graphe-1.0.3-x64.dmg` (117 MB), with corresponding ZIPs.
