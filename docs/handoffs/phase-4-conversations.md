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

**S04 and S13, waiting and stale panels.** See the phase 5 handoff: the waiting
band is owned by the conversation, and overview/version answers carry a
per-owner ask counter so a late answer cannot land under a newer chat.

## Not done

| Item | Finding | What is missing |
| --- | --- | --- |
| Conversation registry record | 4.1 | There is no record created before the first send: a draft is still a temporary `new-N` address, and the registry learns about a conversation when its session starts. Titles, archive flags, context lineage and per-conversation overrides are still window state or preferences |
| Session service states | 4.2 | The eleven states exist as vocabulary (`src/domain/conversations.ts`) with transitions and the restart rule, but the adapter does not drive them: `unloaded/opening/queued/stopping/failed` are not observable, and there is no durable recovery record |
| Idempotency key for New | 4.2 | Not implemented; a double IPC retry still makes two records |
| Second view attaches to one runtime | 4.2 | The registry supports many views per conversation, and `WorkspaceLocks` enforces one writer, but no second pane exists in the UI yet |
| Replay fidelity | 4.3 / S09 | `src/agent/pi/history.ts:eventsOf` still discards tool-result detail and custom messages. Untouched |
| `Continue in new chat` | 4.4 | Not implemented. The worktree action starts a fresh conversation; there is no handoff summary, no `Fork here`, and no `Resume`/`Continue` distinction in the UI |
| Drafts and attachments | 4.5 / S01 | Draft text is still window state and attachments project state. Untouched |
| Archive and undo-delete | 4.6 | Delete removes the transcript file through the existing path; there is no recoverable trash location and no archive concept |
| Temporary address mapping | 4.4 / S11 | `noteWhereItWorks` writes both the current address and the durable one, which covers the first-write case, but rebuild/fork/eviction transitions are not all covered |

Exit criteria: not met. Resume after close/restart works through the existing
session path and is unaffected by this branch; "history includes main-folder and
isolated chats in one list" is implemented (no automated test at the Electron
level); the rest of the phase 4 list is open.
