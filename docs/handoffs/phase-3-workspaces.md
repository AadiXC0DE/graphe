# Phase 3 handoff: explicit workspaces, and navigation that moves nothing

Findings: W01, W02, W03, W05 (stated in the action), W08, W09 (partial), A04.
Deliverable: any number of conversations can use a known workspace; isolation is
requested; opening, closing and selecting never move files.

## 3.1 The registry

`electron/services/workspace-registry.ts` (new, pure, 18 tests in
`tests/workspace-registry.test.ts`): versioned index of projects, workspaces and
conversation-to-workspace links. Opaque UUIDs; canonical paths so a symlink is
the same workspace and two folders with the same basename are not; every state
the plan names; `verifyWorkspace` which cannot return `ready` from a failed
verification and records a detached commit as a SHA rather than `HEAD`; explicit
`relinkProject` for a folder that moved (an unrelated new path is a new project,
never a guess).

Persisted at `<userData>/workspaces.json` through the existing atomic writer,
with an unreadable file moved aside rather than replaced.

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

Not implemented: the "offer an explicit isolated workspace" on the waiting row,
and per-child lease inheritance for Pi's own subagents (they never call the
prompt channel, so they run under their parent's lease implicitly).

## 3.4 Implicit synchronization removed

- `bringBack` is gone from the chat-open path (phase 1).
- Live mirror is gone: the per-card switch, `Held.mirroring`, the apply-on-settle
  path and `onTheSameLine` are deleted. The saved `mirroring` array in
  `conversation-review.json` is read and written back untouched so an old profile
  keeps its setting, and it is never applied.
- Settling now does exactly two things: note the work on the review list, and
  re-read the folder.

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
  in-use snapshots. 15 tests in `tests/pr-checkout.test.ts`.
- Caller updated: the recorded branch is the helper's (`graphe/pr-<n>-<sha12>`)
  rather than the old `graphe/pr-<n>`.
- Closing a conversation no longer puts its checkout away: that call was removed
  from `CHANNEL.closeConversation` in this branch's work on the same file.

## 3.7 Checkpoints

`src/history/repo.ts` rewritten by the delegated workstream: the tree is built
in a scratch index (`GIT_INDEX_FILE`) in the temp dir, committed with
`commit-tree` and moved into `refs/graphe/checkpoints` by compare-and-swap.
Nothing is staged into the folder's index, nothing is committed on the
checked-out branch, hooks and signing are not involved. `restoreTo` refuses a
dirty tree. `carryIn` merges in memory with `merge-tree` and applies only a
clean result. 8 tests in `tests/checkpoint-safety.test.ts` compare HEAD, branch,
status, staged diff, working diff, local config and `refs/heads` byte for byte
around a save with a partially staged file.

## What is not done

| Item | Status |
| --- | --- |
| 3.5 steps 3, 5, 6 for the *user-facing* recovery flows (offer reconstruction of a missing checkout, `Workspace unavailable` read-only open, relink UI) | The migration records these states; no UI opens them yet |
| W09's `keptAsideFolder` collision victims: hash new paths by stable id | Not done; the registry keys by canonical path, legacy rescue roots are untouched |
| Per-child lease inheritance, external-change detection invalidating file/diff caches, expected-hash comparison on planned edits | Not done |
| Explicit `Merge into…` with source and target named | Existing merge path kept; no source/target naming added |

Exit criteria: partly. Three ordinary chats in one folder, two explicit
worktrees, dirty-destination conflicts, PR fetch isolation, checkpoint identity
and idempotent migration are all covered by tests. The Electron-level scenarios
(no file movement on navigation measured through the real app) are not.
