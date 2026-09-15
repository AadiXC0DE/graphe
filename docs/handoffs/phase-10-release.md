# Phase 10 handoff: proving the contract, and where the proof stops

This phase is verification. It is the one that says plainly what is provable now
and what is not, so that nothing is claimed as working because a checkbox was
ticked. The run table below was taken on 2026-09-15; the two rows that moved
since are corrected in place, and `STATUS.md` carries the 2026-09-16 reading.

## Appendix D of the plan states test totals this tree contradicts

The plan is gitignored and cannot be edited, so the correction lives here.
Appendix D records the audit's own suite at **308 test files, 6,770 tests
passed, zero failed or pending**, in `/private/tmp/graphe-audit-tests.json`.

On this tree the numbers are different, and the difference is the work: the
branch has since replaced suites (the `lsp` suite became
`tests/search-symbols-text.test.ts`, `tests/visual-diff.test.ts` and 30,000 lines
of the designer paths went with phase 8's retirements, and about forty new suites
landed). Counted here on 2026-09-16: **365 test files, 6,607 tests passed, 13
skipped** — `STATUS.md`'s verified reading, taken by running the suite on this
revision. The file count is independently checkable and I checked it:
`find tests -name '*.test.ts*'` gives 366, and the one that is not part of
`npm test` is `tests/electron/smoke.test.ts`, which needs a built renderer and a
built shell and runs under `npm run test:electron` — 365, as stated.

What follows from the two numbers: the plan's total is the *baseline's*, not a
target the branch has fallen short of. The branch's first commit `2b5bccb` — the
revision the audit ran against — has exactly **308** test files
(`git ls-tree -r --name-only 2b5bccb -- tests | grep -c '\.test\.tsx*$'`), the
plan's file count to the file; the tree now has 366. The test count moved the
other way for the same reason: about 4,700 lines of test were deleted with the
designer retirements in one commit (`89375fa`, which removed
`tests/visual-diff.test.ts`, `tests/review.test.ts` and the rest), and the new
suites are smaller and more numerous — the scenario catalogue, the migration and
readings suites, and the thirteen source-text wiring suites counted under Q02 in
the phase 1 handoff. Neither total is a measure of coverage; the coverage map is.
The one assertion that was red when this table was written
(`tests/project-context.test.ts`, the em dash) is green on this tree as well: the
test and the shipped copy agree again.

The Appendix D addendum about the checkpoint path is corrected in the phase 1
handoff (A04): `src/history/repo.ts` uses a scratch index and `commit-tree` now,
and `--no-verify` appears nowhere in the product.

## What was run, and what it said

| Command | Result |
| --- | --- |
| `npm run typecheck` | clean |
| `npm run lint` | clean |
| `npm run copy:check` | clean ("Shipped copy is clean.") — it was red earlier in this wave on `src/gallery/Gallery.tsx` and `src/components/NewWorktree.css`, and those were fixed while this was being written |
| `npx vitest run` | 347 files passed, 1 failed, 1 skipped (349); 6427 tests passed, 1 failed, 4 skipped. The failure is `tests/project-context.test.ts` "carries the project's items, named as the project's and not this chat's": the implementation writes `- the brief.pdf: what the site is for` and the test still expects the em dash that was there before the shipped-copy rule was applied to it. Both files are uncommitted work from another workstream, and it is a test pinning copy wording rather than a behaviour that changed |
| `npm run test:electron` | green: 1 file, 4 tests, 20.2 s. A real window on a profile nothing else uses: boot and the profile, two conversations and the connect-a-model path, a file written by a real tool call that the conversation beside it also sees, and a reply arriving in pieces in the order it was sent |
| `npm run test:packaged` | green on arm64: the installed app started with `PATH=/usr/bin:/bin`, a home and profile thrown away afterwards, and no global `pi`, npm or node. The window came up and was visible, the app reports it is packaged and on the disposable profile, the log records `started version=1.0.3 electron=43.4.1 node=24.18.1 runtime=0.85.1`, and Pi kept everything inside the profile. It says itself what it cannot prove: signing and notarization beyond the ad-hoc check, Finder and quarantine, a real provider, the terminal, and the x64 bundle on this machine |
| `node scripts/clean-machine.mjs` | **green on arm64 and on x64 under Rosetta.** The launch a person makes rather than the executable started directly: `open -n -F -a` on the bundle from a login-less environment (`env -i` plus `open --env`), with a project already in the profile. Read through the app's own inspector and the remote debugger, not from disk alone: it reports `isPackaged`, an app path inside the bundle it came from, `userData` equal to the disposable profile, and one **visible** window; the project's row in the picker is pressed, the composer comes up, a draft typed into it is read back, and README.md is listed — so file and chat work carry on with no provider on the machine. It writes `logs/graphe.log`, `workspaces.json` and its compile cache under the profile and nowhere else, records the pinned `runtime=0.85.1` agreeing with the bundle's manifest and `package.json`, and logs no error line. `--without-git` (a `git` exiting 127 first on the PATH): the git band and its commit press are gone, the new-worktree press is gone with it (`src/lib/app-wide.ts:35` gating `src/App.tsx:5298`), the notice names the command line tools, and the composer, the draft and the files remain — the plan's missing-Git sentence, both halves, checked on arm64. On x64 under Rosetta the shell's git probe does not finish in time and nothing about git is asserted there. Full detail in the phase 9 handoff |
| `node scripts/clean-machine.mjs --quarantine` | **recorded, not passed.** A copy with `com.apple.quarantine` set is translocated by macOS to `/private/var/folders/…/T/AppTranslocation/<uuid>/d/Graphe.app` and then refused: "Apple could not verify 'Graphe.app' is free of malware", the app never reaching its profile. `spctl -a -t exec` says `rejected`; the signature is `Signature=adhoc`. This is what RELEASING.md:180-194 already says an un-notarized build does, and it is the honest measurement of the quarantine half of the clean-machine check: the missing prerequisite is notarization, not the app |
| `npm run budget:compare` | **the CI artifact read back.** Pulls the newest two runs carrying the `launch-budget` artifact and prints main chunk, launch set and on-demand set before/after. Run here against runs 34997397590 and 34984506978: main chunk **449.7 → 392.4 KB (−12.75%)**, launch set 639.0 → 581.7 KB, on demand 5221.6 → 5287.1 KB (+1.25%, inside the limit), exit 0. Exits 1 on a regression past the 1% tolerance, over the limit, or an on-demand library in the launch set; exits 2 and says why when `gh` is absent or there is no baseline |
| `npx vite build` then `node scripts/perf-report.mjs --check` | build 62 s; **fails**: main 577.2 KB raw / 184.7 KB gzip against the 450 KB limit. Recorded, attributed and accepted as a narrow exception (phase 9 handoff) |
| `npm run verify:package` | green on **both** bundles: each carries the pinned `@earendil-works/pi-coding-agent 0.85.1`, Pi's 83-package tree, node-pty with an executable helper and a verifying ad-hoc signature; every disk image opens onto `Graphe.app` |
| `npm run licenses:check` | "THIRD-PARTY-LICENSES.md describes everything installed (471 of 471)" |
| `npm run package` | not run for this handoff. The bundles and images in `release/` are the ones built on 2026-09-15, and `verify:package` passes on them |
| `npm run eval` | not run by hand; it runs in CI's Tests job, where a gate nobody runs is not a gate |

## The gates, as CI runs them

The workflow's gates are the ones the plan names, split so a failure says where
it is: **Typecheck** (`tsc --noEmit`), **Lint** (`lint` then `copy:check`),
**Tests** on macOS (`npm test` then `npm run eval`), **Build** (`build` then
`app:build`, then the launch-budget measurement and artifact), **Integration (in
process)** (`tests/e2e`, renamed so it cannot be read as the real-window suite),
**Electron smoke** (`npm run test:electron`), and **Package** (on macOS:
`licenses:check`, `package`, `verify:package`).

Against the plan's eight release-blocking conditions, honestly:

| The plan blocks a release on | Where it stands |
| --- | --- |
| Data loss, pre-trust execution, wrong-owner mutation or workspace corruption | The pre-trust and navigation-write gates pass and are tested. The rest has no end-to-end evidence at the Electron level; the workspace, checkpoint, PR-checkout, migration and merge suites are service-level |
| New/Resume/Continue/Stop/Close behaviour differing from the contract | Resume and Stop are unchanged; Continue, Fork, Archive and view-only Close are built and tested; the end-to-end window run covers none of them |
| Silent workspace fallback or file movement during navigation | No longer possible by construction (nothing on the open path writes), and `tests/close-keeps-worktree.test.ts` and the workspace-identity suite hold the destructive half; it is not exercised in Electron |
| Required extension input disappearing, or terminal mode bypassing permissions | Dialogs are bound, terminal-only requests are visible, and the real terminal says it is the person's shell and not the agent's. Not exercised in Electron. Terminal compatibility mode is not shipped at all (6.5), so there is nothing to bypass |
| Migration records not accounted for, or rollback not exercised | Migration accounting is unit-proven (`tests/migration.test.ts`, 14) but has not been run against a real profile; the rollback refusal is implemented and covered (`parseIndex`'s `future`, RELEASING.md "Rolling back"). What the move found is now on the Storage page rather than only in the log — the counts, the folder the `.bak` copies are in, and two presses, "Check again" (the same run, idempotent) and "Show copies" (`tests/migration-readout.test.ts` 10, `tests/migration-screen.test.ts` 8). A profile from a newer app says so on that screen with what to do, rather than only refusing silently |
| A core action inaccessible at the supported minimum size or by keyboard alone | **Machine half green, person half open.** The matrix now runs (`npm run test:visual`, `docs/handoffs/visual-matrix.md`): 49 rows, 290 checks, over 620×520, 800×600, 1100×780 and a large display, all four zooms, long titles, 20+ tabs, keyboard-only use, reduced motion and the accessibility tree read through CDP. The size and zoom rows were failing and are fixed at the cause (findings 1 and 2 of that file: the panels now give way in order, and the strip keeps its own minimum while the project name ellipsises). What is still a person's — and what the plan's gate is really about — is the screen reader being *listened to*, a contrast judgement, a monitor unplugged, the OS switches changed in System Settings, the native file dialog, overlay stacking over the native page view, and the loading layout |
| Fresh build, packaged runtime or a required regression suite failing | Build, typecheck, lint, `copy:check` and the packaged app all pass, and the suite is green with nothing red: the `tests/project-context.test.ts` assertion this table named (an em dash the shipped copy no longer has) passes on this tree, the test and the copy having been reconciled |
| Performance materially regressing without an explicit assessed exception | The exception is explicit: 577.2 KB against 450 KB, recorded, with the CI artifact keeping the number |

## Appendix B's twenty invariants, held and not held

The plan's Appendix B lists twenty state invariants "to assert in development and
tests". Each row below is the invariant, the test that holds it, and — where it
does not hold whole — the half that is not held. Every path and every `it(...)`
name was read on this tree on 2026-09-16; nothing here is quoted from the plan's
own prose. Seven hold whole, twelve in part: #15 holds whole now, the live
writers wired from the lease plus the open checkouts (`tests/live-writers.test.ts`).

| # | Invariant | Held by | What is not held |
| --- | --- | --- | --- |
| 1 | Exactly one valid or explicitly missing workspace record per conversation | `tests/conversation-identity.test.ts` "is written down under an id of its own, before it has a transcript"; `tests/workspace-registry.test.ts` "exists from the moment it is made, before anything has been said" | Every link being *valid*: a conversation pointing at a workspace that is not there is dropped on read rather than surfacing as explicitly missing (`tests/workspace-registry.test.ts` "drops a conversation that points at a workspace which is not there") |
| 2 | One conversation per open view; a conversation may have many views | `tests/panes.test.ts` "is one conversation with two views, not two conversations" | "Exactly one" is a type, not an assertion: `Pane.conversation` is nullable and a pane before anything is opened is a legitimate open state (`src/domain/views.ts`) |
| 3 | At most one runtime writer per transcript, **including terminal mode** | `tests/domain.test.ts` "has a row for every state and refuses the moves that would double a writer"; `tests/session-states.test.ts` "refuses a move the table does not allow, and says where it really is" | **The terminal half, absent.** There is no terminal mode to hand off to (6.5 is not shipped, `tests/extension-compat.test.ts:11-14`) and `electron/services/terminal.ts` is the person's own pty, writing no conversation transcript, so nothing there can contend for the writing |
| 4 | Every run, request, event and child carries a known owner and epoch | `tests/domain.test.ts` "takes the next position, its own id, and the clock it was handed", "refuses a counter borrowed from another generation", "stales an older generation and a lower place, and nothing else" | Every one of them: a board piece carries `startedBy` and an address rather than an epoch (`tests/board-landed.test.ts` "is kept on the piece") |
| 5 | A terminal state cannot return to running on a late event from the stopped epoch | `tests/domain.test.ts` "calls an ended attempt terminal, and leaves unloaded out of it"; `tests/admission.test.ts` "turns down a reason from a run that has ended, without a word"; `tests/continuation-owner.test.ts` "keeps a piece that landed while the run was stopped from restarting it" | — |
| 6 | No workspace mutation resolves an omitted target from renderer selection | `tests/addressing.test.ts` "finds no address in the calls that name nothing"; `tests/close-is-a-view.test.ts` "ends the run the caller named rather than whichever is in front" | **Partly contradicted by design.** `addressed` (`src/projects/workspaces.ts:150`) hands back `workspaces.current` when nothing is named, and `tests/addressing.test.ts` "hands back the one in front when nothing is named, and only then" asserts that as intended. No mutation service refuses an omitted target outright; the plan's literal rule is not met, and the handoff should say so rather than imply it is |
| 7 | Selecting or closing a view changes no repository files, index, branch or HEAD | `tests/scenarios/workspace-ownership.test.ts` "changes no file, no index entry and no revision", "leaves the local workspace and the project folder exactly as they were"; `tests/scenarios/writer-lease.test.ts` "does not hand the lease back, and does not take the workspace away" | — |
| 8 | A fresh chat holds no other chat's draft, references, questions, queue or overrides | `tests/scenarios/conversation-ownership.test.ts` "shows the fresh conversation nothing that was brought into the other one"; `tests/draft-kept.test.ts` "is named by the conversation own id, so two never-sent chats are two keys" | The last two: per-conversation overrides are stored (`tests/workspace-registry.test.ts` "carries a lineage link and the choice of the chat that made it") but nothing asserts a new chat starts with none, and no test asserts a fresh chat shows no pending question |
| 9 | A shared project item is explicitly shared and never drawn as a private chat event | `tests/project-context.test.ts` "only grows when somebody shares something"; `tests/sidebar.test.ts` "draws what the project offers every chat, labelled and apart" | That it never appears as a transcript turn: the band is asserted, the thread is not |
| 10 | A request is answered at most once, and only in its owning run or epoch | `tests/scenarios/writer-lease.test.ts` "takes one answer per question, and a second changes nothing"; `tests/asked-first.test.ts` "does not take a card away twice"; `tests/asking-wired.test.ts` "is asked for exactly once, and the flag is set before the wait" | "Owning epoch" as a comparison: ownership is held by ids (request, run, queue position), never by comparing a `runtimeEpoch` |
| 11 | A successful operation carries a verifiable resulting owner or revision; an unknown partial result is not success | `tests/domain.test.ts` "carries effects on the partial case alone", "keeps the commit a detached checkout is on" | "Every": a revision travels only where a payload happens to carry one (`tests/external-changes.test.ts` "says so the first time and not the second" is the reader-side rule, not a rule over every operation's result) |
| 12 | Failed persistence keeps the last valid record and produces an actionable error | `tests/atomic.test.ts` "leaves the file that was already there exactly as it was"; `tests/operations/durable-state.test.ts` "says so rather than reporting an empty profile" | — |
| 13 | Untrusted extension discovery executes no code | `tests/scenarios/extensions.test.ts` "is discovered without a line of its code running"; `tests/extension-trust.test.ts` "is not imported, not called, and gets an unknown card" | — |
| 14 | Unsupported extension UI cannot fabricate success or vanish silently | `tests/extension-ui.test.ts` "fails a promise rather than returning a component nobody can see"; `tests/extension-compat.test.ts` "has every terminal-only call refused out loud, once each" | — |
| 15 | A workspace cannot be cleaned up while it has live writers or unrecovered changes | `tests/worktree.test.ts` "leaves the one a conversation is open in"; `tests/operations/storage-cleanup.test.ts` "is never reached by something holding work"; the shell reads who writes where from the workspace lease plus the open checkouts (`liveWriters`, `electron/main.ts:4138`, `electron/services/workspace-live.ts`), and the sweep keeps such a folder and names its writer in the storage row (`tests/live-writers.test.ts`, 7); the real-window smoke test keeps a live copy and clears a stray one. A run cut off by a crash has no live writer at launch by design, so that half of the invariant is unreachable by construction rather than missing |
| 16 | Usage replay cannot charge the same provider run twice | `tests/scenarios/conversation-ownership.test.ts` "charges the ledger's whole total once, not once per report" | — |
| 17 | Every retained UI command resolves to a callable service and a tested failure path | `tests/actions.test.ts` "gives every action a name and somewhere to be reached from" | **Both clauses.** What is asserted is the weaker claim the plan itself names elsewhere: every action has a name, a `where` and a chord in one spelling, with no clashes. `src/lib/actions.ts` carries no handler field at all, so nothing here can resolve to a service |
| 18 | Migration accounts for every source record, including corrupt and unlinked data | `tests/migration.test.ts` "keeps one corrupt row to itself"; `tests/scenarios/migration.test.ts` "accounts for every record, and moves not one working byte" | — |
| 19 | A hidden view needs no continuous screenshots or scans and rehydrates from owned state | `tests/preview-live.test.ts` "stops the shell taking pictures, and starts it again on the way back"; `tests/terminal.test.ts` "keeps what it printed, so a window opened late still sees the session" | A hidden *conversation* view: the reload case says so itself at `tests/electron/smoke.test.ts:1046-1053` — a `message-delta` is "a fact about a screen, not about the record", so the pieces that arrived before a renderer reload are gone from the screen and only the durable transcript is whole. What the shell held survives; what only the screen saw does not |
| 20 | No test claiming desktop behaviour substitutes mock-bridge behaviour unlabelled | The convention exists: 74 test files carry a `Source text, not behaviour:` header note naming the seam a behavioural test cannot reach (`grep -rl 'Source text, not behaviour' tests/` = 74), and CI's job is `name: Integration (in process)` (`.github/workflows/ci.yml:106`) with a comment saying it runs "through the shell's own decision modules with no window: integration coverage, not the real Electron suite, which is `electron-smoke` below" | **Nothing enforces it.** No lint rule, no script: the marker is a habit. Six suites read this repository's own product source without one — `tests/panes.test.ts` (`src/App.tsx`, `Panes.tsx`, `Tabs.tsx`), `tests/project-context.test.ts` (`electron/main.ts`, `src/App.tsx`), `tests/recovery-surface.test.ts` (same, plus `Composer.tsx`), `tests/screen-names.test.ts` (`src/App.tsx`, `Sidebar.tsx`), `tests/package-stop.test.ts` (`electron/main.ts`, `preload.ts`, `bridge.ts`, `App.tsx`) and `tests/browser-safe.test.ts` (follows the window's own imports) — and only `project-context.test.ts` states the limitation in prose near the read. `tests/adapter.test.ts` and `tests/cask.test.ts` also read files without a marker but not product behaviour: Pi's own `dist`, and the cask template beside the release workflow. The other eleven unmarked suites that match a `readFileSync` scan read only temp files they made themselves. Making this an invariant means a script, not a test |

Two of the partials above are worth more than a row: **#6** is a rule the shipped
fallback deliberately breaks, so it should be read as "no mutation resolves an
omitted target by guessing" rather than as the plan's literal sentence; and **#17**
is the plan asking for a property the registry was never built to have. Both are
recorded rather than quietly satisfied by a weaker assertion.

## The scenario catalogue
`docs/handoffs/phase-10-scenarios.md` (not this handoff) holds the row-by-row
mapping of the plan's sixty cases, and its own summary of how many name a test is
the count to read: this handoff's earlier figures were **41 whole, 3 partly, 16
not provable**. Two rows have moved since — `T21` and `T22` were recorded as "not
provable" because the second pane did not exist, and 8.3's pane is now built, so
both are half proven: the pane model and its wiring are tested (`tests/panes.test.ts`
23, `tests/panes-render.test.ts`, `tests/tab-strip-split.test.ts` 4) and what
remains is one runtime, one transcript and one bill through a real window, plus
the durable view record the registry still does not have. Correcting the summary
line itself is the catalogue's own job; what this handoff records is that its
"not provable" list is two rows shorter than it says.
Eleven suites under `tests/scenarios/` — run
here: **11 files, 115 tests, all passing**, 6.4 s — plus the four real-window
cases in `tests/electron/smoke.test.ts`.
Three defects that catalogue found are fixed, each with an ordinary passing test
now holding it.

## What remains, and who it waits on

1. **The person-only half of the visual and accessibility matrix (8.5)** — the
   machine half is done and green (`npm run test:visual`, 49 rows, 290 checks,
   the whole size/zoom/theme/keyboard/reduced-motion/a11y-tree set, re-run twice;
   `docs/handoffs/visual-matrix.md`). What is left needs somebody at the window,
   and is item 1 of that file's own list: what a screen reader *says aloud*, a
   contrast judgement, a monitor unplugged and the window restored, the OS
   switches changed in System Settings, the native file dialog, overlay stacking
   over the native page view, and the loading layout (the one state the harness
   could not hold long enough to sample — making it a machine's check needs the
   lazy chunk served deliberately slowly). It covers T45, T46 (the zoom and
   narrow-window halves) and the plan's minimum-size gate.
2. **A clean machine, properly** — the launch half is now checked rather than
   assumed: `scripts/clean-machine.mjs` asks LaunchServices to open the bundle
   from a login-less environment, reads the app's own answers through its
   inspector and the window through the remote debugger, and starts both
   architectures (x64 under Rosetta). Quarantine and translocation were
   *reproduced* on a flagged copy, and the ad-hoc build is refused by Gatekeeper
   there — recorded, expected, and the reason is notarization. What no run here
   can reach: a person's actual click in Finder, a notarized build and a
   Developer ID signature (there is neither), and a second machine with nothing
   installed.
3. **A real provider** — every run on this branch uses a scripted model or no
   model. Provider retry, compaction, usage accounting against a live service and
   the paid-fallback question (T31's retry half, T32) have no live evidence.
4. **The CI artifacts** — the Build job writes `launch-budget` (the table and the
   JSON) and it is now read back: `npm run budget:compare` compares the newest
   two runs carrying it and reports a regression as a number (main chunk
   449.7 → 392.4 KB against the 450 KB limit, on the runs it was tested with),
   exiting non-zero past a 1% tolerance. It is deliberately not a CI step: the
   Build job already blocks on the limit inside the same job, and a second gate
   on one number only duplicates the failure. `npm run test:packaged` is still
   not in CI, so the packaged *smoke* is proven on this machine and nowhere else;
   the LaunchServices launch (`scripts/clean-machine.mjs`) needs a window and a
   real desktop, so it is a local check by construction.

## What this branch is safe to merge

Nothing in it removes a user-facing capability except two deliberate retirements
the plan itself calls for: live mirror (the saved setting is preserved and
ignored, and merging is still one press) and the built-in `lsp` capability, which
was text search under a false name and is now `search_symbols_text`. Every other
change either narrows what runs before consent, or moves an ownership decision
from "whichever tab is in front" to an explicit one. The migration runs once,
keeps backups, and does not move or delete anything. What it is *not* safe to
claim from this handoff: that the interface is accessible at the minimum window
size, that a signed build behaves on a stranger's machine, or that anything above
has been proven against a real model provider.
