# Phase 4 handoff: conversations that are durable, resumable, and independent of tabs

Findings: W06, S01, S02, S09, S10, S14 done; S11, S12, S13 and 4.2 open.

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
| ~~Drafts and attachments~~ | 4.5 / S01 | **DONE after the first draft.** A conversation now holds what belongs to it. `src/lib/projects.ts` gives `Parked` its own `attachments`, `references`, `draft` and `plans`; `conversationIn` reads the one in front off the desk's own fields and any other out of `parked`; `changeThread` writes to the conversation named wherever it sits in the row; `showThread` moves a conversation forward whole, so the fields come and go with it. `tookTheBox` takes out of the box only the attachments that send accepted, by identity, and only from the conversation that sent them — a late upload for A cannot clear B's box. `putBackTheBox` returns a refused send's sentence to its own conversation's box, behind anything typed while it was on its way. `src/App.tsx` binds `{project, address}` at send start, puts the sentence back when the shell refuses or throws, empties the box only once the message is admitted (`if (!held) emptyTheBox(mine, inTheBox);`), and names the files the window could not read through `ATTACH_WORDS.notRead` (`src/lib/attachments.ts`); `setPlans` writes through the same owner, and a mode pressed before any conversation exists is held in the window until there is one. `src/components/Composer.tsx` gained `onDraftChange`, called on the way out of the box, on send and on the typing debounce, so the report a switch produces goes to the chat being left rather than the one arrived at and a refused send cannot replace newer typing; a fresh box still restores the sentence from its per-project-and-conversation key (`draftKey`), unchanged. The band in `src/components/Sidebar.tsx` draws the chat's own references and nothing about a project-level list: the scope press this wave first added was cut, because the prompt path carries no project-side context (`PromptOptions` has no field for one) and the press only took a reference out of the chat that used it — see the open row below. Evidence: `tests/scenarios/conversation-ownership.test.ts` (20 — `T23`'s single `it.fails` replaced by three passing tests, a new `T26` block, and `T26b` for a line taken back), `tests/draft-kept.test.ts` (15 — three added by the review pass: the sentence is handed over as somebody types, it stays in front of a refused one, and the cursor is left alone), `tests/sidebar.test.ts` (11), `tests/attached-pdf-wired.test.ts` (6, updated to the new send path) and `tests/threads.test.ts` (16). `npx vitest run tests/draft-kept.test.ts tests/attached-pdf-wired.test.ts tests/scenarios/conversation-ownership.test.ts tests/sidebar.test.ts tests/threads.test.ts` is 5 files, 68 tests, all passing. Not in this work: accepted attachments are still object URLs held in window state rather than stored under app data by content id, and a retry sends the box as it stands rather than deduplicating against what already went. Two residual draft paths are also left as they were, both older than this work and both about a chat nobody has sent in: `draftKey` (`src/components/Composer.tsx`) writes a null address as `''`, and `App.tsx` hands the box `conversation: desk.address`, so two never-sent chats in one project share one key; and the address a never-sent chat is known by is a process-local `new-N` (`addressOf`, `electron/main.ts:1967-1970`), so a draft kept under that name can resurface in a later launch's new chat |
| Archive and the trash | 4.6 | Archive is done: the flag lives on the conversation record, the sidebar lists what was put away, and a control puts one back. Delete moves the transcript to `<userData>/trash-conversations/<when>-<name>.jsonl` (`electron/services/trash.ts`, 3 tests in `tests/trash.test.ts`) rather than unlinking it, and every view of the id leaves the strip. What is still missing: nothing empties the trash (a storage decision somebody should be shown), and there is no in-app way to fetch a deleted conversation back — it is done by hand under the profile's `trash-conversations` |
| Explicit shared project context | 4.4, 5.2 | Not built. A chat's references are its own and drawn as such; there is no project-level list that reaches a turn, and the scope press that pretended otherwise was cut rather than left claiming a delivery nothing makes. The plan's "New chat carries explicit shared project context", labelled `Project context`, needs a prompt-side seam (`PromptOptions` in `src/lib/ipc.ts` has no field for one) and a decision about how the model is given it |
| A draft in a chat nobody has sent in | 4.5 / S01 | The S01 work moved the draft to the conversation, but the unnamed conversation still has no identity of its own, so two things leak between drafts: `draftKey` (`src/components/Composer.tsx`) writes a null address as `''`, and `App.tsx` hands the box `conversation: desk.address`, so two never-sent chats in one project share one key; and the name such a chat is known by is a process-local `new-N` (`addressOf`, `electron/main.ts:1967-1970`), so a draft kept under it can resurface in a later launch's new chat. That last one is the identity 4.1 says a conversation must not have |
| Temporary address mapping | 4.4 / S11 | `noteWhereItWorks` writes both the current address and the durable one, which covers the first-write case, but rebuild/fork/eviction transitions are not all covered |

Exit criteria: not met. Resume after close/restart works through the existing
session path and is unaffected by this branch; "history includes main-folder and
isolated chats in one list" is implemented (no automated test at the Electron
level). "Unsaved drafts survive switching and A's send completion does not clear
B" now holds — `T26` in `tests/scenarios/conversation-ownership.test.ts` and the
`whose sentence the box is holding` block in `tests/draft-kept.test.ts` — while
a draft surviving a restart still rests on the box's own per-project-and-
conversation key (`draftKey` in `src/components/Composer.tsx`), unchanged here
and with no Electron-level test. The rest of the phase 4 list is open.
