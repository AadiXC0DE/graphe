# What is left, and where it stands

Every item the stabilization plan asks for that is not finished, with the phase
it belongs to, its current state and what closed it. Rewritten as work lands; the
phase handoffs carry the detail.

Legend: **done** (in this branch), **open** (not started), **blocked** (needs
something that does not exist yet), **out of reach** (cannot be done in this
environment, with the reason).

## The last wave, finished

| # | Item | Phase | Evidence |
| --- | --- | --- | --- |
| 1 | References, drafts and attachments belong to the conversation (S01) | 4.5 | phase-4-conversations.md; 68 tests across `draft-kept`, `conversation-ownership`, `sidebar`, `attached-pdf-wired`, `threads` |
| 2 | A scripted provider, and the real-window suite it drives | 10.1 | `tests/electron/scripted-model.ts`; `npm run test:electron` green (4 tests) |
| 3 | The 9.5 operational checks, as tests | 9 | `tests/operations` (16 files, 103 tests; 7 record findings that are still open as `it.fails`) |
| 4 | Probe cancellation in a disposable process (E04), tool-name collisions (E09), package lifecycle (E10) | 6 | phase-6-extensions.md; `extension-probe-child` 16, `tool-conflicts` 14, `package-activation` 3 |
| 5 | One overview answer, one folder (W10); preview frames owned (U04) | 5 | phase-5-ownership.md; `overview-roots` 8, `preview-live` 11 |
| 6 | The IPC inventory, and zero unqualified mutation callers | 5.4 | `docs/handoffs/ipc-inventory.md`: one row per channel (202), none unnamed; the four page channels given a required target |
| 7 | Rollback: an older app refuses to write a newer profile | 10.5 | `parseIndex`'s `future` and `verdictOn`; the shell leaves the file alone, refuses the write and skips the migration; RELEASING.md, "Rolling back" |
| 8 | The review pass over the wave: a closed project's page, the watcher's folder, a factory's own stdout, two add-ons wanting one name, a line taken back into the wrong chat, the first-launch mode chips, a refused send's draft | 5, 6 | each named in its phase handoff, with the test that holds it |

## Open, in the order they will be taken

| # | Item | Phase | State |
| --- | --- | --- | --- |
| 1 | Explicit shared project context reaching a turn | 4.4, 5.2 | open |
| 2 | Figma following, the variations UI and the evidence furniture retired, with export paths | 8.2 | open |
| 3 | Held-work singletons keyed by their run (S05) | 5, 7 | open |
| 4 | Session service states driven by the adapter (4.2), with an idempotency key for New | 4.2 | open |
| 5 | `Fork here` at a chosen boundary, and a draft for a chat nobody has sent in | 4.4, 4.5 | open |
| 6 | Competing continuations unified (A03); one admission point for every turn (E07); lifecycle hooks policy (E06) | 7 | open |
| 7 | The navigation model (U03) and composer polish (8.4) | 8 | open |
| 8 | Dependency majors: React 19.3, Electron 44, electron-builder 26, ESLint 10, jsdom 29, Playwright 1.63, Vite 8, Vitest 5, TypeScript 7, concurrently 10, `glob`, `unpdf` | 2 | open |
| 9 | The main-chunk gate: 646.4 KB against 450 KB | 9 | open, assessed |
| 10 | The visual and accessibility matrix, and the minimum-window pass | 8.5 | out of reach here |
| 11 | Agent runtimes out of the Electron main process (6.2) and terminal compatibility mode (6.5) | 6 | blocked on re-hosting the Guard and the trust filter |
| 12 | The rest of phase 6: E11 (installing add-ons without host npm), E12 (a global advisor file rewritten around turns), a terminal opened inside a packaged app, custom renderer fidelity and install cancellation, and the fixture gaps | 6 | open |
| 13 | The rest of phase 9 and 10: the 9.1 packaged measurements, the 9.6 clean-machine smoke, the visual and accessibility layers | 9, 10 | not run here |
| 14 | The seven findings the 9.5 files record as `it.fails` (a key in error details, an erase-on-unseal, an MCP abort, a duplicate server name, a log-line bound, `file://` in the pane, the main chunk) | 9 | open, each with a test that reproduces it |

## Done

Everything else: phases 1 and 3 in full except the recovery UI, phase 4.1/4.3/
4.4's Continue, Fork and Archive, phase 5 in full except S05, the normalised
store and the pane's address, phase 6.1/6.3/6.4/6.5's E02 terminal and the E04/
E09/E10 work above, phase 7.1/7.4/7.5, phase 8's tabs and three retirement rows,
phase 9's P02 to P06 and the 9.5 coverage above, phase 10's gates, catalogue,
real-window suite and the rollback refusal. See `phase-1-contract.md` through
`phase-10-scenarios.md`.

Verified on this tree: `npm run typecheck` clean and `npm test` 350 files passed
(6921 tests, 4 skipped), plus `npm run test:electron` green on Node 22.21.1.
