# Phase 4 handoff: conversations that are durable, resumable, and independent of tabs

Findings: W04 done (reopening a conversation whose folder has gone — see below),
W06, S01, S02, S04, S09, S10, S13, S14 done; S11 and S12 open, 4.2 missing three
states. W07's lifecycle half is dispositioned in the phase 3 handoff (closing is
a view). Numbers here were taken on this tree on 2026-09-15.

## Done

**W06 and S10, the conversation list.** `listConversations(projectRoot, dir)`
used Pi's directory-filtered listing, which matches the session header's cwd
exactly, so every chat that worked in a checkout was missing from the sidebar;
and any failure came back as `[]`, which reads as "you have no conversations".

- `src/agent/pi/adapter.ts`: `listAllConversations(sessionDir)` uses Pi's
  supported `SessionManager.listAll` and returns a typed failure instead of an
  empty list. `Conversation` gained `cwd` (read from the header), kept null for
  transcripts too old to carry one.
- `electron/main.ts`: `conversationsInProject(path)` (`:3338`) decides membership
  by the registry where it knows, and falls back to the recorded folder (the
  project root, or under its managed worktrees root) for transcripts written
  before the registry existed. The `CHANNEL.conversations` handler reports a read
  failure as a failure with a `Try again` action; the delete handler returns the
  list the same way.

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

**The conversation registry record (4.1).** The registry holds a full
`ConversationRecord` per conversation (`workspaceId`, Pi's session id and file
once written, title, created/updated, archive flag, lineage, branch leaf,
per-conversation overrides), written at session start before the first word,
idempotent on re-entry, with a reader that upgrades the earlier version's bare
workspace-id mapping. Part of `tests/workspace-registry.test.ts` (27 tests).

**Continue, Fork and Archive (4.4, 4.6).** `conversationContinue`
(`electron/main.ts:8591`) opens a new conversation in the source's workspace with
one editable note composed from what was actually said and written
(`src/work/continuing.ts`, 6 tests) — never a model call, so it costs nothing and
invents nothing; the window puts it in the composer as a draft with the caret in
it. `conversationFork` (`:8628`) uses Pi's own `SessionManager.forkFrom`, refuses
while the source is working, and records the lineage link.
`conversationArchive` (`:8717`) sets the flag the shell fills into the listed
rows. `tests/conversation-actions.test.ts` (9) holds the three actions on the row
they were pressed on: Continue, Fork and Archive on its own row, Fork refusing a
conversation that is still working and pressable on every other, Archive taking
the row out and Unarchive bringing it back, and the continue note landing in the
composer as a draft with nothing sent.

**`Fork here`, at a chosen boundary.** The control sits at the foot of one message
(`Message`'s `action`, `src/components/Message.tsx:189`; `Turnstile` in
`src/App.tsx:6448` decides which messages have one and passes the exchange they
would stop at), and is refused while that turn is still being written: "A fork
made mid-turn would copy a conversation that had not finished happening"
(`electron/main.ts:8658`), with `Fork here waits until this turn finishes` on the
press meanwhile (`src/lib/threadview.ts:26`). **Its residual risk is stated where
somebody presses it**: a fork is a fork of the conversation, not of the work —
"A second chat from here. Same files, so changes are shared"
(`forkHereHint`, `src/work/continuing.ts:42`). There is no filesystem snapshot
behind the fork and the plan did not ask for one; what the plan asked for is that
nothing implies one. Evidence: `tests/copy-under-the-message.test.ts` (the control
and its sentence) and the fork block in
`tests/scenarios/conversation-ownership.test.ts:447`.

**Explicit shared project context reaches a turn (4.4, 5.2).** A project keeps a
list of what every chat in it is given (`keepShared`/`keptShared`,
`src/lib/shared-context.ts`), the sidebar labels it `Project context` with
`Share with project`, and the shell composes it into the turn in front of the
person's own words — behind them when the message is an add-on's `/command`,
because Pi dispatches a command from the start of the text
(`projectContextBlock`, `src/agent/pi/project-context.ts:45`, applied at
`electron/main.ts:10985`). The block says what it is ("Shared with every chat in
this project. None of it was sent in this chat"), bounds how much it carries and
says how much did not fit. Evidence: `tests/project-context.test.ts` (20): what
reaches a turn, what the window sends, the per-project key so two folders never
show each other's list, and that the list only grows when somebody shares. **One
of those 20 is red at this reading, and neither file is committed yet:** the
implementation now writes `- the brief.pdf: what the site is for`
(`src/agent/pi/project-context.ts:41`, a colon) and the test still expects the em
dash that was there before the shipped-copy rule was applied to it. It is a test
pinning copy wording, not a behaviour that changed.

**Attachments are kept under the profile by content id (4.5).**
`electron/services/attachment-store.ts` writes what a send accepted to
`<userData>/attachments/<sha256>.bin` with its metadata beside it, so a retry, a
reload and the same picture from two conversations are one stored copy with one
id; a name that is not a 64-hex content id resolves to nothing rather than to
some other file's bytes, and a row is only ever drawn for something complete
(bytes, then thumbnail, then metadata). `copyOf` gives the original bytes back
for sending again or opening, and returns null rather than inventing anything when
a profile has been moved. Evidence: `tests/attachment-store.test.ts` (9), which
holds the box's own ceilings, the per-conversation limit, and a retry of something
already held not being counted twice.

**Delete keeps what it deletes, and there is a way back (4.6).** The
transcript is moved into `<userData>/trash-conversations/<when>-<name>.jsonl`
with the time it went and only then is the delete reported as having happened;
the `.bak` shadow copy travels with it, and a name already there is never
overwritten (`moveToTrash`, `electron/services/trash.ts`, 11 tests in
`tests/trash.test.ts`). The service half is complete and tested: `listTrash`
returns what is there, newest first, treats a missing folder as empty and a
folder it cannot read as a failure rather than a lie; `restoreFromTrash` puts one
back under its own name into the sessions folder the app lists from, refusing
rather than writing over a conversation that is already there; `emptyTrash` deletes exactly the names it was given and returns
the ones that actually went, so a screen can count what happened rather than what
it asked for. All three are on the wire (`CHANNEL.trashList` `electron/main.ts:9047`,
`trashRestore` `:9063`, `trashEmpty` `:9084`, `TRASH_RULE`, and the bridge in
`src/lib/ipc.ts:2034`). **The screen is on the Storage page:** the deleted
conversations are listed with the moment each went and what it is taking, each
with a Restore and one press that empties only what was picked
(`src/components/Trash.tsx`, wired in `src/App.tsx:2686` and drawn beside the
folders in `src/components/Settings.tsx:1072`; 10 tests in
`tests/trash-screen.test.ts`).

**Replay fidelity (4.3, S09).** Tool results keep their text and pictures with a
bounded display and a reference for the rest; custom messages survive with their
provenance; an unfinished tool replays as interrupted; stop, failure and abort are
distinguishable; compaction and branch summaries appear; tool call ids are
preserved. `tests/session-replay-fidelity.test.ts`, 25 tests.

**Session service states, driven and durable (4.2).** `src/domain/conversations.ts`
carries the driver beside the vocabulary: `Sessions` holds the runtime state and
the written facts for every conversation, refuses a move `TRANSITIONS` does not
allow, and `inFlight` is the one predicate behind both "may this be put down" and
"does closing the view have anything to end". The shell drives it and it is
observable from outside: `opening` and `failed` in `startConversationUnlocked`
(`electron/main.ts:4737`, `:4886`), `queued` while a message waits for the folder
lock (`:10932`), `running`/`idle` from the adapter's own `busy` events in
`forwardTo` (`:2828`), `stopping` in the `CHANNEL.stop` handler (`:11088`), and
every listed row carries its `state` (`conversationsInProject`, `:3338`) so the
shelf says "Still working" after the tab has gone. The durable half:
`electron/services/run-record.ts` writes each run's `DurableFacts` plus its
project to `<userData>/runs-in-flight.json` as the state changes and takes the
note away when it ends, so the file holds exactly the runs still in flight;
`readWhatWasRunning()` (`:1946`) reads it before anything can open, calls
`states.recovered`, and the sentence
"This conversation was in the middle of a run when Graphe stopped…" is said once,
over the conversation, the first time somebody opens it (`tookInterruptedNote`,
`:1938`). Nothing is reissued: a launch marks and reports, it never starts a turn
again. `tests/session-states.test.ts`, 10 tests.

**Close is a view. Stop is the press that ends a run (4.6).**
`CHANNEL.closeConversation` (`electron/main.ts:8907`) takes the guard first: a
conversation with a run in flight is left exactly where it is, and a quiet one is
only put down — nothing is settled up on the way out, and no model call nobody
asked for is spent. `CHANNEL.stop` (`:11067`) is the separate action, records
`stopping` before the run ends, and ends the conversation the caller named rather
than whichever tab is in front, so a Stop from the shelf reaches a conversation
whose tab is gone. Evidence: `tests/close-is-a-view.test.ts` (12) — the handler's
own shape, the shared `inFlight` predicate, the stop's ordering, the launch read,
and the shelf offering Stop on a running row and none once nothing is running.

**New has an idempotency key (4.2).** `src/lib/answered.ts` keeps the answer to a
press for a short window (60 s, at most 64 presses) and drops a failure rather
than answering the next press with it. `App.tsx` names each New press
(`newPress()`, `:290`) and sends it as the third argument of `openConversation`;
`Opening` carries it as `key`, and `startConversation` routes a fresh open through
`presses.answering` keyed by project + press, so the same press twice makes one
conversation while a second press, with a key of its own, still makes a second
draft. `tests/new-press.test.ts`, 8 tests.

**Drafts, references and attachments belong to the conversation (4.5, S01).**
`src/lib/projects.ts` gives `Parked` its own `attachments`, `references`, `draft`
and `plans`; `conversationIn` reads the one in front off the desk's own fields and
any other out of `parked`; `changeThread` writes to the conversation named wherever
it sits in the row; `showThread` moves a conversation forward whole. `tookTheBox`
takes out of the box only the attachments that send accepted, by identity, and
only from the conversation that sent them — a late upload for A cannot clear B's
box — and `putBackTheBox` returns a refused send's sentence to its own
conversation's box, behind anything typed while it was on its way.
`src/components/Composer.tsx` gained `onDraftChange`, called on the way out of the
box, on send and on the typing debounce, so the report a switch produces goes to
the chat being left rather than the one arrived at. Evidence, 6 files, 96 tests,
all passing: `tests/draft-kept.test.ts` 15,
`tests/scenarios/conversation-ownership.test.ts` 20, `tests/sidebar.test.ts` 14,
`tests/attached-pdf-wired.test.ts` 6, `tests/threads.test.ts` 16,
`tests/session-replay-fidelity.test.ts` 25.

## Not done

| Item | Finding | What is missing |
| --- | --- | --- |
| Three of the eleven session states | 4.2 | `waiting-input`, `compacting` and `archived` are in `SESSION_STATES` and in the transition table, and nothing drives them: the adapter does not report a waiting turn or a compaction as a state, and archiving a conversation sets a flag on its record rather than a runtime state |
| Second view attaches to one runtime | 4.2 | **The UI half is done; this row's runtime half is not.** The second pane exists (`src/domain/views.ts`, `src/components/Panes.tsx`, the split press in `src/components/Tabs.tsx`; `tests/panes.test.ts` 23, `tests/panes-render.test.ts`, `tests/tab-strip-split.test.ts` 4), and one runtime behind two views is structural: `Sessions` is keyed by conversation (`src/domain/conversations.ts:221`) and a pane holds an address rather than a session, so opening the same chat twice asks for the same one. What is missing is a view record in the registry — `electron/services/workspace-registry.ts` still has no `views` at all, so a view id lives only in window state and is not durable across a restart |
| A draft in a chat nobody has sent in | 4.5 / S01 | The unnamed conversation still has no identity of its own, so two things leak: `draftKey` (`src/components/Composer.tsx:161`) writes a null address as `''` and `App.tsx` hands the box `conversation: desk.address` only when it is not null, so two never-sent chats in one project share one key; and the name such a chat is known by is a process-local `new-N` (`addressOf`, `electron/main.ts:1993`), so a draft kept under it can resurface in a later launch's new chat. That last one is the identity 4.1 says a conversation must not have |
| Temporary address mapping | 4.4 / S11 | `noteWhereItWorks` (`electron/main.ts:3643`) writes both the current address and the durable one, which covers the first-write case, but rebuild, fork and eviction transitions are not all covered |
| Rapid New presses | S12 | One press twice is one conversation now, but two presses are two drafts by design and nothing coalesces them; a retry landing after the 60 s window also makes a second conversation, and nothing tells the window which of two identical drafts came from which press |
| The interrupted sentence's lifetime | 4.2 | The note is said once per launch and cleared at launch rather than kept until somebody has looked at the conversation it belongs to |
| `workspaceId` in the run record | 4.2 | It is null in the recorded facts: the registry owns the workspace link and the runtime does not ask for it |

Exit criteria: still not met, and closer. Resume after close/restart works through
the existing session path; "history includes main-folder and isolated chats in one
list" is implemented and has no Electron-level test. Unsaved drafts survive
switching and A's send completion does not clear B (`T26`,
`tests/scenarios/conversation-ownership.test.ts`; the `whose sentence the box is
holding` block in `tests/draft-kept.test.ts`), and accepted attachments are now
stored under the profile by content id rather than held as object URLs. A draft
surviving a restart still rests on the box's own per-project-and-conversation key,
with no Electron-level test, and the unnamed-conversation leaks above are open.
