# Phase 4 handoff: conversations that are durable, resumable, and independent of tabs

Findings: W06, S02, S10, S14 done; S01, S09, S11, S12, S13 open.

## Done

**W06 and S10, the conversation list.** `listConversations(projectRoot, dir)`
used Pi's directory-filtered listing, which matches the session header's cwd
exactly, so every chat that worked in a checkout was missing from the sidebar;
and any failure came back as `[]`, which reads as "you have no conversations".

- `src/agent/pi/adapter.ts`: `listAllConversations(sessionDir)` uses Pi's
  supported `SessionManager.listAll` and returns a typed failure instead of an
  empty list. `Conversation` gained `cwd` (read from the header), kept null for
  transcripts too old to carry one.
- `electron/main.ts`: `conversationsInProject(path)` decides membership by the
  registry where it knows, and falls back to the recorded folder (the project
  root, or under its managed worktrees root) for transcripts written before the
  registry existed. The `CHANNEL.conversations` handler reports a read failure
  as a failure with a `Try again` action; the delete handler returns the list the
  same way.

**S02, `busy` survives a swap.** `swapConversation` parked `{turns, doing,
counted}` and dropped `busy`, so a chat being switched away from came back
looking idle while its turn was still running. It now parks and restores `busy`,
as `projects.showThread` already did.

**S14, deleting the chat you are in always leaves you somewhere.** `New` after a
delete went through the empty-thread guard, which read a desk still holding the
deleted conversation's turns as "already looking at a new one". `swapConversation`
takes an explicit `force`, used only by the delete path.

**Delete keeps what it deletes.** The transcript is moved into a trash folder
under the profile with the time it went, and only then is the delete reported as
having happened; the `.bak` shadow copy travels with it. A name already there is
never overwritten. Emptying the trash is deliberately not automatic: it is a
storage decision somebody should be shown (plan 4.6).

**S04 and S13, waiting and stale panels.** See the phase 5 handoff: the waiting
band is owned by the conversation, and overview/version answers carry a
per-owner ask counter so a late answer cannot land under a newer chat.

## Not done

| Item | Finding | What is missing |
| --- | --- | --- |
| ~~Conversation registry record~~ | 4.1 | **DONE after the first draft.** The registry now holds a full `ConversationRecord` per conversation (`workspaceId`, Pi's session id and file once written, title, created/updated, archive flag, lineage, branch leaf, per-conversation overrides), written at session start before the first word, idempotent on re-entry, with a reader that upgrades the earlier version's bare workspace-id mapping. 8 new tests in `tests/workspace-registry.test.ts` |
| ~~Continue / Fork / Archive~~ | 4.4, 4.6 | **DONE after the first draft.** `conversationContinue` opens a new conversation in the source's workspace with one editable note composed from what was actually said and written (`src/work/continuing.ts`, 6 tests) - never a model call, so it costs nothing and invents nothing; the window puts it in the composer as a draft with the caret in it. `conversationFork` uses Pi's own `SessionManager.forkFrom`, refuses while the source is working, and records the lineage link. `conversationArchive` sets the flag the shell fills into the listed rows. Old row below kept for the record. |
| Conversation registry record (original note) | 4.1 | There is no record created before the first send: a draft is still a temporary `new-N` address, and the registry learns about a conversation when its session starts. Titles, archive flags, context lineage and per-conversation overrides are still window state or preferences |
| Session service states | 4.2 | The eleven states exist as vocabulary (`src/domain/conversations.ts`) with transitions and the restart rule, but the adapter does not drive them: `unloaded/opening/queued/stopping/failed` are not observable, and there is no durable recovery record |
| Idempotency key for New | 4.2 | Not implemented; a double IPC retry still makes two records |
| Second view attaches to one runtime | 4.2 | The registry supports many views per conversation, and `WorkspaceLocks` enforces one writer, but no second pane exists in the UI yet |
| ~~Replay fidelity~~ | 4.3 / S09 | **DONE after the first draft.** Tool results keep their text and pictures with a bounded display and a reference for the rest; custom messages survive with their provenance; an unfinished tool replays as interrupted; stop, failure and abort are distinguishable; compaction and branch summaries appear; tool call ids are preserved. 25 new tests in `tests/session-replay-fidelity.test.ts` |
| `Continue in new chat` | 4.4 | Not implemented. The worktree action starts a fresh conversation; there is no handoff summary, no `Fork here`, and no `Resume`/`Continue` distinction in the UI |
| Drafts and attachments | 4.5 / S01 | Draft text is still window state and attachments project state. Untouched |
| Archive and undo-delete | 4.6 | Delete now moves the transcript to `<userData>/trash-conversations/<when>-<name>.jsonl` instead of unlinking it (`electron/services/trash.ts`, 3 tests in `tests/trash.test.ts`), and every view of the id is removed from the strip rather than only the one in front. What is still missing: no archive flag, no retention or emptying policy, and no UI for putting one back |
| Temporary address mapping | 4.4 / S11 | `noteWhereItWorks` writes both the current address and the durable one, which covers the first-write case, but rebuild/fork/eviction transitions are not all covered |

Exit criteria: not met. Resume after close/restart works through the existing
session path and is unaffected by this branch; "history includes main-folder and
isolated chats in one list" is implemented (no automated test at the Electron
level); the rest of the phase 4 list is open.
