# What is left, and where it stands

Every item the stabilization plan asks for that is not finished, with the phase
it belongs to, its current state and what closed it. Rewritten as work lands; the
phase handoffs carry the detail.

Legend: **done** (in this branch), **open** (not started), **blocked** (needs
something that does not exist yet), **out of reach** (cannot be done in this
environment, with the reason).

## The last three waves, finished

**Wave one: a conversation owns what was said in it.** The registry holds a real
`ConversationRecord` per conversation, written before the first word. Continue,
Fork, Archive and Delete have distinct behaviour. Replay keeps tool results,
custom messages and branch summaries. Drafts, references and attachments are the
conversation's, not the window's. The scripted provider and the real-window suite
were built (`npm run test:electron`, 4 tests), the 9.5 operational checks became
nineteen files, and the probe, tool-collision and package-lifecycle findings
(E04, E09, E10) landed.

**Wave two: a workspace is an identity, and one writer holds a folder.** `repoKey`
is filled and enforced, so a folder that now holds another repository is not the
workspace written down for it. `Merge worktree <name> into <project>` names both
ends and refuses a dirty destination with its files listed. A review decision is
snapshot-scoped and a stale one is refused. A new checkout is seeded from what the
project chose, and installing dependencies is its own press with its own state.
Queued sends have ids, the band says `Queued for this workspace` and names the run
ahead, and taking one back actually cancels the wait.

**Wave three: the host tells the truth, and the app is proven on a disk.** Close
is view-only with Stop as its own press; the session states are driven and a run
that the app did not finish is written down and reported at the next launch; New
has an idempotency key; `Fork here` sits under a finished exchange and says the
files are shared. A project's shared context reaches a turn, labelled as the
project's. Accepted attachments are stored under the profile by content id, and a
deleted chat can be brought back: the trash is listed on the Storage page beside
the folders, with Restore on each row and one press that empties only what was
picked. An add-on's commands are in the composer's picker and run as commands, the eight
extension states are computed from facts, and the screen says plainly that an
install cannot be cancelled rather than offering a Stop that cannot work. The
packaged smoke exists and passes on arm64, `verify:package` passes on both
bundles, the launch budget is recorded as a CI artifact, and Graphe says at the
top when git or npm is missing. Pi is pinned to 0.85.1 with the patch rows beside
it.

## Open, in the order they will be taken

| # | Item | Phase | State |
| --- | --- | --- | --- |
| 1 | The person-only half of the visual matrix (8.5): what a screen reader *says aloud*, a monitor unplugged, the OS switches changed in System Settings, the native file dialog, overlay stacking over the native page view, a contrast judgement, the loading layout — the machine half runs the whole matrix (`npm run test:visual`: 49 rows, 287 checks, 2 failing in the last full run) | 8 | open, needs somebody at the window |
| 2 | Dependency majors still on their old releases, each with its exact reason and reassessment date 2026-10-16 in `phase-2-upgrade.md`: vitest 5 (needs Node ≥22.12), jsdom 29, eslint 10 + react-hooks 7, TypeScript 7 (three compiler-API consumers unprobed), unpdf 1.8.1, mermaid 12, and electron/builder + `@types/node` (one packaging session on both arches) | 2 | open |
| 3 | The rest of phase 6: custom renderer fidelity, the fixture gaps, and the narrow case where an install through Pi's wrapper route still cannot be cancelled. The terminal inside a packaged app is done (2026-09-16) | 6 | open |
| 4 | 6.2's full migration and 6.5's terminal compatibility mode: the child-runtime spike landed and proves the seam (Guard judging in the shell, extension UI crossing, kill semantics, transcript replay) with the four gaps named in `phase-6-runtime-spike.md`; wiring it in is the remaining work | 6 | open, spike done |
| 5 | The rest of phase 9 and 10: a real model provider, and the plan's remaining measurement scenarios on other hardware | 9, 10 | open |
| 6 | Phase 4 residue, item 6 of `docs/graphe-stabilization-remaining-2026-09-16.md`: every row is done except the window's half of view records, which is the App.tsx owner's. Landed — the never-sent chat's draft (`tests/draft-new-chat.test.ts`, 3), the session states (`tests/session-states.test.ts`, 21), view records in the registry (`tests/workspace-registry.test.ts`, 35), S11's address mapping (`tests/address-mapping.test.ts`, 3), S12's repeated press (`tests/new-press-twice.test.ts`, 4), the run note's lifetime and its `workspaceId` | 4 | open, window call left |


## Done

Everything else: phase 1, phase 3 except the recovery UI, external-change
detection and the rescue-root hashing, phase 4 except the rows above, phase 5
except the rest of 5.1 (the conversations are one record each and the
conversation-action and inspector hooks landed; S05 is settled — resolved by
removal, see `phase-5-ownership.md`), phase 6's E01/E03/E04/E05/E06/E07/E09/E10 and
its fixtures, phase 7 except A03, 7.5's designer-specific instructions and A02's
remainder, phase 8's retirements in full plus its tabs, phase 9's P02 to P06, the
9.5 coverage, the packaged smoke and the CI artifact, phase 10's catalogue,
real-window suite and rollback refusal. W09's rescue roots are hashed from the
stable project id with the legacy roots still read, the add-on install runs as the
app's own cancellable child, 9.6's clean-machine check passes on arm64 and
x64-under-Rosetta, and the accessibility tree is checked by the matrix. Phase 5.1's
conversation store and its two hooks landed, 8.3's second pane exists with the split press where the tabs
are, the recovery surface opens a chat whose folder is gone read-only and offers
relink, and U03's names are one set. The main-chunk gate is met **392.4 KB** against
450 KB (CI blocking again) and the six 9.5 findings are fixed at the cause. See
`phase-1-contract.md` through
`phase-10-scenarios.md`.

Verified on this tree, 2026-09-16: `npm run typecheck`, `npm run lint` and
`npm run copy:check` clean; `npm test` **366 files passed, 1 skipped (367),
6614 tests passed, 14 skipped**; `npm run test:electron` green (14 tests);
`npm run test:measure` against the plan's budgets; `npm run budget:compare` reads
the CI artifact back (449.7 → 392.4 KB); `node scripts/clean-machine.mjs` green on
arm64 and x64-under-Rosetta;
`npm run test:packaged` green on arm64; `npm run verify:package` green on both
bundles; `npm run licenses:check` 424 of 424; `npm run test:visual` runs the whole
matrix — **49 rows, 287 checks, 2 failing** in the last full run
(`results/2026-09-16T06-59-42-221Z/`: the long project name coming back with its
own conversation count, and `.topbar` scrolling sideways at 620×520 zoom 200);
`node scripts/perf-report.mjs --check` **passes at 392.4 KB**,
the CI step blocking on it and the assertion in
`tests/operations/build-budget.test.ts` a plain `it`.
