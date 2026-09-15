# Phase 3 handoff: explicit workspaces, and navigation that moves nothing

Findings: W01, W02, W03, W05, W07, W08, W09, W10, A04. W04 is in the phase 4
handoff (reopening a missing checkout).
Deliverable: any number of conversations can use a known workspace; isolation is
requested; opening, closing and selecting never move files.

## 3.1 The registry

`electron/services/workspace-registry.ts` (new, pure, 27 tests in
`tests/workspace-registry.test.ts`): versioned index of projects, workspaces and
conversation-to-workspace links. Opaque UUIDs; canonical paths so a symlink is
the same workspace and two folders with the same basename are not; every state
the plan names; `verifyWorkspace` which cannot return `ready` from a failed
verification and records a detached commit as a SHA rather than `HEAD`; explicit
`relinkProject` for a folder that moved (an unrelated new path is a new project,
never a guess).

Persisted at `<userData>/workspaces.json` through the existing atomic writer,
with an unreadable file moved aside rather than replaced.

**The repository identity is filled and enforced.** `repoKeyOf`
(`src/history/worktree.ts:144`) reads `rev-parse --git-common-dir`, so a project
and every checkout of it share one key, a clone of it is a different repository,
and a folder that is not one has none. `workspaceAtPath` refuses to match a path
whose key changed (`electron/services/workspace-registry.ts:329`), `setRepoKey`
records the key the shell learns (`:433`, called from `rememberRepo`,
`electron/main.ts:3547`), and `sameRepository` is the one comparison the worktree
and merge paths ask before they touch another folder. `tests/workspace-identity.test.ts`,
19 tests, holds the identity rule (a checkout agrees with its project, two
projects do not, a clone is its own, a plain folder is nothing), the path-versus-key
match, the state `verifyWorkspace` records when the repository under a path
changed, and the seeded checkout.

## 3.2 New chat means a conversation, not a copy

`startConversationUnlocked` selected a workspace by counting the conversations
already open (`held.sessions.open.length === 0`), so the second chat copied the
project and a failed copy fell through to the project folder (W01, W03).

- A chat works in the project's own folder unless a workspace is named, and
  nothing runs git for an ordinary New chat.
- `Opening` gained `{ kind: 'fresh'; workspace?: string }` and `openingIn()`.
- `New worktree` is a deliberate action: `CHANNEL.worktreePlan` (read-only:
  folder, base branch, base commit, files that would not come with it) and
  `CHANNEL.worktreeNew` (creates the checkout, writes the workspace, starts the
  conversation in it). Failure returns a failure and leaves the project
  untouched; nothing falls back.
- UI: `src/components/NewWorktree.tsx` + `.css`, opened from the Sidebar's
  Conversations band. The card states that a copy starts from the last commit
  and lists what stays behind.
- Evidence: `tests/workspace-registry.test.ts`; the dialog's plan/creation shape
  is covered by the channel types and the typecheck; no Electron visual run was
  performed (see limits).

## 3.3 One writer per folder

`electron/services/workspace-locks.ts` (new, pure, 10 tests in
`tests/workspace-locks.test.ts`): FIFO admission per canonical folder, release by
the holder only, cancellation that resolves the waiter, and inheritance so a
child working in its parent's folder does not queue behind its own parent.

Wired into `CHANNEL.prompt`: a send from a conversation whose folder is held
waits its turn, shows in the waiting line beside the composer, and take-back
cancels the wait rather than leaving a message that cannot be withdrawn. The lock
is released in a `finally`, so failure, stop and success all free it.

The waiting line is now two lines, and the second is the one the plan asked for:

- The shell holds the sends that are waiting for a folder and reports the whole
  line to the window on one event (`queued-for-folder`), as it does for `running`.
  Each send carries the run id it will become, the folder it was queued for as it
  was **at send time**, and the conversation ahead of it by name. Nothing is
  matched by words: two sends of the same sentence are two waits, and each comes
  off the line by its own id (`drainQueued`, `tests/queue.test.ts`).
- The window draws `Queued for this workspace` above the composer, with the
  message, `Waiting on <conversation>` naming the run ahead, `New worktree`
  (the existing card, `src/components/NewWorktree.tsx`) as the way out, and
  `Put it back in the box`. `src/components/InLine.tsx`; the band's markup was
  read from `renderToStaticMarkup` as a throwaway smoke check, not kept.
- `waitingForTheFolder` keeps a list per conversation, so a second send waiting
  is cancellable too (it used to overwrite the first, which then could not be
  taken back). `takeBackFromTheFolder` returns all of them in arrival order.
- Release goes to the key recorded when the lease was taken (`mine.key`), and
  cancellation asks the lock for the folder recorded in the ticket — neither is
  worked out again from the chat's current workspace.
- Scenarios: `tests/scenarios/writer-lease.test.ts` T21 (a parent waiting on its
  own child: admitted without a second hold, freed once, by the parent) and T22
  (a wait taken back leaves the holder writing and moves the next one up).
  16 tests.

What a decision about a review is checked against now includes content, not just
names: `reviewSnapshotOf` reads each path the tree reports with its status and a
SHA-256 of its bytes (`treeReading` in `src/work/reviewqueue.ts`, `treeEntries`
and `contentOf` in `electron/main.ts`), so a file written again under the same
name is a different reading and `staleDecision` refuses the decision instead of
carrying it out against bytes nobody agreed to. Covered in
`tests/workspace-identity.test.ts` ("the same file was written again under the
same name"). Entries recorded by an older build compare against a reading of the
old shape and are refused once — the safe direction.

Not implemented: per-child lease inheritance for Pi's own subagents (they never
call the prompt channel, so they run under their parent's lease implicitly).

## 3.4 Implicit synchronization removed

- `bringBack` is gone from the chat-open path (phase 1).
- Live mirror is gone: the per-card switch, `Held.mirroring`, the apply-on-settle
  path and `onTheSameLine` are deleted. The saved `mirroring` array in
  `conversation-review.json` is read and written back untouched so an old profile
  keeps its setting, and it is never applied.
- Settling now does exactly two things: note the work on the review list, and
  re-read the folder.
- **Merging names both ends.** The press reads `Merge worktree <source> into
  <target>` (`mergeInto`, `src/lib/owncopy.ts:44`), with the target taken from the
  project in front, and the sidebar builds the same sentence for a copy's card
  (`src/components/Sidebar.tsx:275`). A destination holding work of its own blocks
  the merge, and the block names the files rather than saying "save your work
  first" (`blockingChanges` in `src/history/worktree.ts:290`, the shell's own copy
  of the rule at `electron/main.ts:9596`): a squash merge stages what it brings,
  so somebody has to be told which of their files is in the way. A folder holding
  another repository is refused for the same reason (`sameRepository`, `:9590`).
  `tests/scenarios/merge-safety.test.ts` T14 and T15 are the dirty-destination and
  awkward-change cases.

## 3.5 Migration

`electron/services/migration-service.ts` (new, 14 tests in
`tests/migration.test.ts`): discovery produces a manifest with a verdict per
source record (`verified`, `missing`, `gone`, `foreign`), corrupt rows are
quarantined, a conversation claimed twice is resolved by best verdict, ids are
deterministic so a resume lands on the same records, and nothing on disk is
written except through the injected probe.

Wired at startup in `electron/main.ts` (`migrateWorkspacesOnce`): marker file,
directory lock, legacy files copied aside to `.bak` before the index is
replaced, and never a move, rename or delete of a legacy folder.

## 3.6 Worktree and PR lifecycle

- `electron/prWorktree.ts` (rewritten by the delegated workstream): a review
  checkout is keyed by PR number **and** fetched head SHA, the fetch goes into a
  call-private ref and resolves the SHA explicitly (never `FETCH_HEAD`), reuse
  requires a registered, clean, at-SHA checkout, and every refusal returns a
  typed problem with the folder left alone. Removal requires the exact resolved
  target plus managed metadata, never `--force`. `leftBehind` names superseded or
  in-use snapshots. 18 tests in `tests/pr-checkout.test.ts`.
- Caller updated: the recorded branch is the helper's (`graphe/pr-<n>-<sha12>`)
  rather than the old `graphe/pr-<n>`.
- **Closing a conversation puts nothing away.** `CHANNEL.closeConversation`
  (`electron/main.ts:8907`) is a view operation: a run in flight is left exactly
  where it is (the guard comes first, `inFlight(states.stateOf(named(found.path)))`),
  and a quiet conversation is only put down, with the copy, its branch and
  everything uncommitted left on disk. Throwing a conversation away is its own
  press and also keeps them: `CHANNEL.deleteConversation` (`:8932`) stops the
  live session, forgets the view of the row and moves the transcript to the
  trash, with a comment on the spot saying why a forced removal is not used —
  it would take the uncommitted work with it. `tests/close-keeps-worktree.test.ts`
  (6 tests) is the proof at the git level: a copy holding work nobody has saved
  survives being given back, a forced removal destroys it (which is why deleting
  must not use one), closing is not a teardown, deleting leaves the copy, branch
  and work alone, and the shell never force-removes a worktree.
- Putting a copy away remains an explicit press, and it checks first: `worktreeLand`
  and the give-back handler both run `putAwayCheckoutAt` (`:4001`) and then refuse
  with `HOLDS_WRITING` while the folder is still there (`:9752`, `:9809`).

## 3.7 Checkpoints, secrets and setup

`src/history/repo.ts` rewritten by the delegated workstream: the tree is built
in a scratch index (`GIT_INDEX_FILE`) in the temp dir, committed with
`commit-tree` and moved into `refs/graphe/checkpoints` by compare-and-swap.
Nothing is staged into the folder's index, nothing is committed on the
checked-out branch, hooks and signing are not involved. `restoreTo` refuses a
dirty tree. `carryIn` merges in memory with `merge-tree` and applies only a
clean result. 8 tests in `tests/checkpoint-safety.test.ts` compare HEAD, branch,
status, staged diff, working diff, local config and `refs/heads` byte for byte
around a save with a partially staged file.

**A new checkout is seeded from what the project chose, and installing is its own
step.** `src/history/seeding.ts` carries the gitignored files a project names
(`WORKTREE_INCLUDE`, in `.gitignore` syntax) plus whatever somebody ticked on the
card for this project, with a ceiling on how much of a folder one checkout is
worth (`past-the-ceiling`), a refusal for links and folders, and one sentence per
file that did not arrive rather than silence. The choices persist under the
profile (`setup.json`, `setupChoicesFile`, written through the atomic writer), so
the next card opens with what was chosen last time, and the card re-reads them
when somebody changes them (`CHANNEL.setupChoose`, `electron/main.ts:8832`).
Whether a checkout can run is a separate fact with a separate press:
`CHANNEL.setupInstall` (`:8857`) runs the manager the project's lockfile implies
and reports `not-started`, `running`, `failed` or `done` (`installDependencies`,
`dependenciesNotStarted` in `src/projects/setup.ts`), so a card that made a copy
never reports the creation as the whole of setting up. `src/components/NewWorktree.tsx`
draws both. Evidence: the seeding suite in `tests/workspace-identity.test.ts`
(the chosen file arrives and is said; the one that did not is named with its
reason) and `tests/setup.test.ts` for the persisted choices and the install step
(the store survives a sitting, an unreadable store is no choices rather than a
throw, the manager is read off the lockfile, and an install reports running then
done, or keeps the reason it failed). `tests/checkout-seeding.test.ts` is the same
rule against real git: what a checkout is missing, what `.worktreeinclude` carries,
and that a carried file's mode is owner-only.

## What is not done

| Item | Status |
| --- | --- |
| ~~3.5 steps 3, 5, 6 for the *user-facing* recovery flows~~ | **Done.** A conversation whose recorded folder has gone opens read-only through `readTranscript` and says `Workspace unavailable`, with `Relink…` and `Continue in a new workspace`; `workspaceTrouble`/`readOnlyOpening` (`electron/main.ts:4851`, `:4874`), the band `src/components/Recovery.tsx`, ``tests/recovery-surface.test.ts` and `tests/recovery-render.test.ts``. W04 is this row's origin |
| ~~W09's `keptAsideFolder` collision victims~~ | **Done.** Rescue roots are `kept-aside/<name>-<sha256(projectId)[0..8]>` (`src/work/rescue.ts`, `src/work/copies.ts`), so two projects cannot collide and a moved project keeps its rescue; the legacy sanitized root is still read and never moved (`tests/rescue-roots.test.ts`, 10) |
| Per-child lease inheritance for Pi's own subagents | The lock's inheritance parameter is real and tested; Pi's subagents never call the prompt channel, so they run under their parent's lease implicitly |
| ~~Detecting an external change and invalidating file/diff caches~~ | **Done.** A cached file/diff list carries the revision it was read at and re-reads when it has moved (`tests/external-changes.test.ts`, 6). Was: Nothing compares a reader's revision against a file that has since changed. `verifyWorkspace` records *when* a workspace was last verified and what state it was in (`verifiedAt`, `electron/services/workspace-registry.ts:463`), but no reader holds a revision to compare it against, and the window's copies — the file rail, the Changes panel — refresh on Graphe's own settle and tool-end events, so an editor writing while somebody reads is noticed at the next of those or by reopening the view. A watcher is the file-tree phase's (plan 9.3: deduplicate per workspace, unsubscribe when nobody is looking, invalidate a root's watcher generation); adding one here without that is how a folder ends up watched twice. Two narrower halves *are* built: a review decision is refused when the bytes it was read against have moved (3.3 above), and a planned edit by line range is refused when the file's fingerprint no longer matches the one the read returned (`fingerprint`/`snapshotOf` in `src/agent/pi/anchor-edit.ts:43`, used by `anchorEditTool`, `tests/anchor-edit.test.ts`) |
| Explicit `Merge into…` with source and target named | Done, see 3.4: both ends are in the sentence, and a dirty destination is refused with its files named |

Exit criteria: partly. Three ordinary chats in one folder, two explicit
worktrees, dirty-destination conflicts, PR fetch isolation, checkpoint identity
and idempotent migration are all covered by tests. The Electron-level scenarios
(no file movement on navigation measured through the real app) are not.

Run against this revision on 2026-09-15, all passing: `tests/workspace-identity.test.ts`
19, `tests/workspace-registry.test.ts` 27, `tests/workspace-locks.test.ts` 10,
`tests/pr-checkout.test.ts` 18, `tests/checkpoint-safety.test.ts` 8,
`tests/migration.test.ts` 14, `tests/queue.test.ts` 8,
`tests/scenarios/writer-lease.test.ts` 16, `tests/close-keeps-worktree.test.ts` 6,
`tests/setup.test.ts` + `tests/checkout-seeding.test.ts` 54.
