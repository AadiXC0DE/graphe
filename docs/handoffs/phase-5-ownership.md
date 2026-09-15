# Phase 5 handoff: every panel, request and control scoped to its owner

Findings: S02, S03, S04, S06, S07 and S08's conversation rule done; W10 done;
U04 done; the 5.4 inventory written and its "zero unqualified callers" criterion
met. S05 settled here — resolved by removal, below. The normalised store is the
conversation half only; see the row below.

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
`{project, conversation}` and drop an answer whose owner has changed, and the
handlers behind them (`projectFiles`, `fileText`) read out of
`folderFor(open, where)`: a chat working in its own copy is shown, and opens, the
files it is actually changing rather than the project's.

**S02 and S14** are in the phase 4 handoff.

**W10, one overview answer is about one folder.** `CHANNEL.overview` read the
branch, the artifacts, the swatches and the preview address out of whichever
root the call happened to name, so a panel could describe two folders at once.
Every one of them is now read out of `folderFor(open, where)` — a conversation's
own copy, a named child repository, or the folder the registry wrote down — so
the file list, the diff and the branch in one panel are all the same folder's,
and a folder holding several repositories lists them (`Overview.repos`).
`tests/overview-roots.test.ts` (8) proves the precedence, the status read in the
resolved folder, and that every root follows it.

**U04, every picture of the preview says which preview it is.** A frame was
`{project, bytes}`, so a picture taken of another workspace, or of this one
before a reload, was drawn as though it were current. `PreviewFrame` now carries
`preview`, `project` and `epoch`, and `src/preview/live.ts` accepts a frame only
for the preview the window is showing: another preview's picture, an earlier
epoch's and one with no identity are dropped, and nothing is captured while the
window is hidden. The page itself is one native view for the whole window, so the
four channels that move, hide or record it (`pageAt`, `pageHidden`, `watchStart`,
`watchStop`) now name the project whose page they are about, and the shell
refuses a call that names another project or none (`pageNamed`, "That page is not
the one on screen") instead of reaching somebody else's page; a project closed
while its page is up takes the page with it rather than leaving a view nothing
can reach. `tests/preview-live.test.ts` (11) covers the adoption, the drops, the
re-adoption after a reload and the hidden-window stop.

**5.4, the inventory, and zero unqualified callers.** `docs/handoffs/ipc-inventory.md`
is the per-channel audit the plan asked for: scope, target, the expression in
`electron/main.ts` that resolves it, whether it changes anything, whose answer it
is, and every caller. Against it, every mutation the window makes now names its
target: the 18 call sites that could be told (in `src/App.tsx`, 20 in all
including two `connectedSave` callers the sheet had missed) pass the project or
the conversation they act on, and the four page channels were given a target
rather than being told one. `graphe:watch-browser` follows the conversation's own
folder now, so a chat working in a copy watches the browser that chat drives
instead of the project root's.

**S08, an event for an unknown owner goes nowhere confusing.** `receive` puts an
event whose conversation this window no longer knows to the project's spend alone
— the one part of it that is still true — and never into the tab in front
(`tests/threads.test.ts`: "never puts a delayed event from an unknown
conversation into the tab in front"). The project-less notices that remain are
app-wide by construction (an app error, a newer release, a missing git,
notifications being off) and have no other home; the only write of this class
still unaddressed is the research settle in `src/App.tsx`, which is in the phase
4 handoff's open list.

## What is not done

| Item | Finding | Note |
| --- | --- | --- |
| Desk/Parked normalisation | **Half done, and more than this row used to say.** The conversations are normalised: `Parked` is gone, a conversation is one complete record in a map (`Conversations`, `src/state/conversations.ts:49-105` — turns, doing, filing, counted, busy, attachments, references, draft, plans), and bringing one forward moves a pointer rather than copying a field list (`showThread`, `src/lib/projects.ts:379`). Two of the four hooks the plan names landed in the same commit (`07d9779`): conversation actions (`src/hooks/useConversationActions.ts`) and inspector queries (`src/hooks/useInspector.ts`). What is not done: workspaces, runs and views are not maps in the renderer (`Desk` is still `{path, conversations, address, order, spent, overview, versions, repoVersions, putBack, jobs, …}`), there is no workspace-selector hook, and the extension UI and settings state are still inline in `src/App.tsx` |
| The pane's address across a project switch | The page is one native view for the whole window. A switch closes the page that belonged to the previous project rather than showing it, and the pane's own address is window state, so it is not cleared when the project changes: the new project's page is pointed at the same address. Nothing here draws another project's page, but the address itself is not owned by the conversation |

### S05, settled: resolved by removal

The plan's finding is that held change, checking and pictures were project
singleton slots (`electron/main.ts:Held`). They are gone, not scoped: the
retirement commit that took the held-back workflow out (`89375fa`, "Phase 8's
retirements") deleted `HeldWork`, `HeldPictures` and the `waiting`/`checking`/
`pictures` fields from `Held`, along with `src/projects/heldback.ts`,
`src/lib/heldwrites.ts` and `src/share/review.ts`. `Held` today
(`electron/main.ts:1773-1831`) carries no such slot, so there is no project
singleton left to key by a run — which is why this is a removal and not a
task. (The `waiting` that remains in `electron/main.ts` is the folder-lease
line, `WaitingSend[]`, owned per conversation; `WorkspaceLocks.waiting` is the
per-folder FIFO queue. Neither is the S05 slot.)

What the removal left behind is the migration rule, and it is done: a stored
review row that names no conversation is kept and marked unattributed rather
than dropped (`electron/services/review-record.ts:72`), and the Review screen
draws no decision for it (`src/components/ReviewQueue.tsx:252`, `:367`), so
nothing offers to take files there is no copy of.
`tests/legacy-held-work.test.ts` (6 tests) holds both paths — the row survives
the round trip to disk marked unattributed, and it offers nothing that would
carry its files over.

Exit criteria: met for the parts this phase names as blocking - the audit
inventory includes every channel, zero unqualified mutation callers remain, a
delayed answer cannot populate another chat's panel, the waiting band claims only
its own conversation's work, and an event for an unknown owner never reaches the
tab in front. Partly met on 5.1: the conversations are one complete record each
and the conversation-action and inspector hooks exist, but the renderer still has
no workspace map and no workspace-selector hook, and extension and settings state
are inline in `App.tsx`. S05 needs no criterion here: it was removed rather than
scoped, so there is no one-per-project slot left to assert against.
