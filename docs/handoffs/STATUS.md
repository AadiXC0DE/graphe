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
| 2 | The three session states nothing drives (`waiting-input`, `compacting`, `archived`), and the second pane that would make T21 and T22 testable | 4.2 | open |
| 3 | Held-work singletons keyed by their run (S05), and the normalised store the plan's 5.1 asks for | 5, 7 | open |
| 4 | The visual and accessibility matrix (8.5) and the minimum-window pass: 620×520, zoom to 200%, keyboard-only, a screen reader, 20+ tabs | 8 | open (needs somebody at the window, and a screen reader; not started) |
| 5 | Competing continuations unified (A03), the designer-specific prompt instructions (7.5), and A02's truncation | 7 | open |
| 6 | The navigation model (U03), composer polish (8.4), and the three retirement rows still in the 8.2 table | 8 | open |
| 7 | Dependency majors: React 19.3, Electron 44, electron-builder 26, ESLint 10, jsdom 29, Playwright 1.63, Vite 8, Vitest 5, TypeScript 7, concurrently 10, `glob`, `unpdf` — each with its reason and reassessment date in `phase-2-upgrade.md` | 2 | open, reassessed 2026-10-13 |
| 8 | The main-chunk gate: 577.2 KB against 450 KB, recorded in CI as a non-blocking artifact | 9 | open, assessed |
| 9 | The rest of phase 6: the bundled package-management route (E11), the global advisor file (E12), an install that can actually be cancelled, a terminal opened inside a packaged app, custom renderer fidelity, the fixture gaps | 6 | open |
| 10 | Agent runtimes out of the Electron main process (6.2) and terminal compatibility mode (6.5) | 6 | blocked on re-hosting the Guard and the trust filter |
| 11 | The rest of phase 9 and 10: the 9.1 packaged measurements, the 9.4 lifecycle checks (sleep/wake, a renderer crash, the quit sequence), the 9.6 clean machine from Finder and the x64 bundle, a real model provider, and something that reads the `launch-budget` artifact back | 9, 10 | open |
| 12 | External-change detection against a reader's revision (nothing compares one today), the recovery UI for the states migration records, and W09's rescue-root collision victims | 3 | open |
| 13 | The seven findings the 9.5 files record as `it.fails` (a key in error details, an erase-on-unseal, an MCP abort, a duplicate server name, a log-line bound, `file://` in the pane, the main chunk) | 9 | open, each with a test that reproduces it |

## Done

Everything else: phase 1, phase 3 except the recovery UI, external-change
detection and the rescue-root hashing, phase 4 except the rows above, phase 5
except S05 and the normalised store, phase 6's E01/E03/E04/E05/E06/E07/E09/E10 and
its fixtures, phase 7 except A03, 7.5's designer-specific instructions and A02's
remainder, phase 8's tabs and three retirement rows, phase 9's P02 to P06, the
9.5 coverage, the packaged smoke and the CI artifact, phase 10's catalogue,
real-window suite and rollback refusal. See `phase-1-contract.md` through
`phase-10-scenarios.md`.

Verified on this tree, 2026-09-15: `npm run typecheck` clean; `npm run lint`
clean; `npm run copy:check` clean; `npm test` **348 files passed, 1 skipped (349),
6428 tests passed, 4 skipped**; `npm run test:electron` green (4 tests); `npm run
test:packaged` green on arm64; `npm run verify:package` green on both bundles;
`npm run licenses:check` 471 of 471; `node scripts/perf-report.mjs --check` fails
at **577.2 KB** against 450 KB, recorded in CI as a non-blocking artifact while
the red `it.fails` in `tests/operations/build-budget.test.ts` stays the gate.
