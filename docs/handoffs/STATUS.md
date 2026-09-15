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
| 1 | A draft in a chat nobody has sent in: `draftKey` writes a null address as `''`, so two never-sent chats in one project share one key, and the name such a chat is known by is a process-local `new-N` | 4.5, S01 | open |
| 2 | The navigation model (U03) and the conversation panes (8.3): one global target remains, no second pane, and that pane is also what would make T21/T22 testable | 4.2, 8 | open |
| 3 | The normalised renderer store the plan's 5.1 asks for (S05's singleton slots were removed with the held-back row; the review queue keeps an unattributable row labelled rather than dropped) | 5 | open |
| 4 | The person-only half of the visual matrix (8.5): a screen reader, an external monitor unplugged, the OS reduced-motion switch, the native file dialog, real contrast judgement — the machine half is green (38 rows, 225 checks, `npm run test:visual`) | 8 | open, needs somebody at the window |
| 5 | Dependency majors: React 19.3, Electron 44, electron-builder 26, ESLint 10, jsdom 29, Playwright 1.63, Vite 8, Vitest 5, TypeScript 7, concurrently 10, `glob`, `unpdf` — each with its reason and reassessment date in `phase-2-upgrade.md` | 2 | open, reassessed 2026-10-13 |
| 6 | The rest of phase 6: the bundled package-management route (E11), an install that can actually be cancelled, a terminal opened inside a packaged app, custom renderer fidelity, the fixture gaps. E12 is done: the advisor's one settings file is serialized and the limitation labelled, because Pi has no per-session seam for an extension's settings | 6 | open |
| 7 | Agent runtimes out of the Electron main process (6.2) and terminal compatibility mode (6.5) | 6 | blocked on re-hosting the Guard and the trust filter |
| 8 | The rest of phase 9 and 10: the runtime measurements are in (`npm run test:measure`: cold launch, tab switch, typing while streaming, stop, cancellation, idle CPU, open/close plateau — two budgets missed); what is left is the 9.4 lifecycle checks (sleep/wake, a renderer crash, the quit sequence), the 9.6 clean machine from Finder, a real model provider, the plan's remaining fixtures (100k files, 5 MiB output, 20 extensions, two previews), and something that reads the `launch-budget` artifact back | 9, 10 | open |
| 9 | The recovery UI for the states migration records, and W09's rescue-root collision victims | 3 | open |

## Done

Everything else: phase 1, phase 3 except the recovery UI, external-change
detection and the rescue-root hashing, phase 4 except the rows above, phase 5
except S05 and the normalised store, phase 6's E01/E03/E04/E05/E06/E07/E09/E10 and
its fixtures, phase 7 except A03, 7.5's designer-specific instructions and A02's
remainder, phase 8's retirements in full plus its tabs, phase 9's P02 to P06, the
9.5 coverage, the packaged smoke and the CI artifact, phase 10's catalogue,
real-window suite and rollback refusal. The main-chunk gate is met (446.3 KB
against 450 KB, CI blocking again) and the six 9.5 findings are fixed at the
cause. See `phase-1-contract.md` through
`phase-10-scenarios.md`.

Verified on this tree, 2026-09-15: `npm run typecheck`, `npm run lint` and
`npm run copy:check` clean; `npm test` **351 files passed, 1 skipped (352), 6449
tests passed, 11 skipped**; `npm run test:electron` green (11 tests);
`npm run test:packaged` green on arm64; `npm run verify:package` green on both
bundles; `npm run licenses:check` 471 of 471; `npm run test:visual` green (38 rows,
225 checks) after nine findings were fixed; `npm run test:measure` measured against
the plan's budgets; `node scripts/perf-report.mjs --check` **passes at 446.3 KB**,
the CI step blocking on it and the assertion in
`tests/operations/build-budget.test.ts` a plain `it`.
