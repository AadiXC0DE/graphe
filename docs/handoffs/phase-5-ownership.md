# Phase 5 handoff: every panel, request and control scoped to its owner

Findings: S02, S03, S04, S06, S07, S08 (partial), W10 (partial). U04 open.

## What changed

**S03, overview answers are owner-scoped.** `refreshOverview` compared only
`current.current === path`, so two chats in one project were the same panel. It
now takes a per-owner ask counter (`asksMade`, keyed by project and conversation)
and drops an answer that a newer ask has already replaced or that belongs to a
conversation the panel has moved off. `refreshVersions` takes the same guard for
its timeline and picture answers.

**S04, the waiting band is owned.** `Waiting` no longer calls
`bridge.reviewQueue()` itself and no longer keeps its last successful answer. It
is presentational: `entries` is supplied by the panel's owner, and `App` passes
only the entries belonging to the conversation on screen. Project-wide work is
still on the Review screen, which names the chat behind every row.

**S06, Plan is the conversation's.** `CHANNEL.setPlanMode` applied to every open
session in the project. It now applies to the conversation named in the call
(`workingAt`), and a call with no conversation sets the project default that a
new chat starts from, which is the Settings case. `App`'s `holdWrites` sends the
conversation on screen, so the chip follows the chat rather than the folder.

**S07, file reads are addressed.** `useProjectFiles.refresh` passed no scope at
all and cached per project path; `readFile` was unqualified too. Both now send
`{project, conversation}` and drop an answer whose owner has changed.

**S02 and S14** are in the phase 4 handoff.

## What is not done

| Item | Finding | Note |
| --- | --- | --- |
| S08 owner-less events | One routing rule was found and left: `src/lib/projects.ts:receive` still falls back to `desks.current` for an event with no project, and to spend-only for an unknown conversation. Changing it needs the owner ids to be carried on every event, which is the phase 4/5 normalisation work below |
| Desk/Parked normalisation | The plan's 5.1 maps of projects/workspaces/conversations/runs/views with hooks extracted from `App.tsx` were not built. The two bespoke swap implementations (`swapConversation`, `showThread`) both exist, with the same field list now, which was the transition requirement |
| W10 different roots in one overview | `CHANNEL.overview` still resolves git/preview/artifact roots per panel call. Each now carries the conversation, so a stale answer is dropped, but the roots themselves were not unified |
| Held singleton slots (S05) | `held.waiting/checking/pictures` are still one per project. Nothing was removed, because the replacement (per-run records) belongs with phase 7's task model |
| U04 preview frames | Preview frame messages are still `{project, bytes}`. Not touched |
| Legacy unqualified-call inventory and counter | Not done: no per-channel scope/target table was produced and no counter drives the remainder to zero |

Exit criteria: the two blocking behaviours named in the phase (a delayed answer
must not populate another chat's panel; the waiting band must not claim another
chat's work) are implemented. The inventory, the normalised store and the
"zero unqualified mutation callers" criterion are not.
