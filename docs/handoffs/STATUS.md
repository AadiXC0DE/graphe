# What is left, and where it stands

Every item the stabilization plan asks for that is not finished, with the phase
it belongs to, its current state and the commit that closed it. Rewritten as work
lands; the phase handoffs carry the detail.

Legend: **done** (in this branch), **open** (not started), **blocked** (needs
something that does not exist yet), **out of reach** (cannot be done in this
environment, with the reason).

## Wave 1 — running

| # | Item | Phase | Owner | State |
| --- | --- | --- | --- | --- |
| 1 | References, drafts and attachments belong to the conversation (S01, the last recorded defect) | 4.5 | Refs | running |
| 2 | A scripted provider for the real-window suite, so the turn-dependent scenarios can run there | 10.1 | TestProvider | running |
| 3 | The 9.5 operational checks as tests, and the 9.1 scenario matrix | 9 | OpsChecks | running |
| 4 | Probe cancellation in a disposable process (E04), tool-name collisions (E09), package lifecycle (E10) | 6 | ExtLifecycle | running |
| 5 | Unified roots in one overview (W10), preview frame ownership (U04), the IPC inventory | 5.4 | OwnerEvents | running |

## Open, in the order they will be taken

| # | Item | Phase | State |
| --- | --- | --- | --- |
| 6 | Figma following, the variations UI and the evidence furniture retired, with export paths | 8.2 | open |
| 7 | Owner-less events quarantined or hydrated to their owner (S08) | 5 | open |
| 8 | Held-work singletons keyed by their run (S05) | 5, 7 | open |
| 9 | Session service states driven by the adapter, with durable recovery facts | 4.2 | open |
| 10 | `Fork here` at a chosen boundary; archive/undo-delete in the window | 4.4, 4.6 | open |
| 11 | Competing continuations unified (A03); one admission point for every turn (E07); lifecycle hooks policy (E06) | 7 | open |
| 12 | The navigation model (U03) and composer polish (8.4) | 8 | open |
| 13 | Dependency majors: React 19.3, Electron 44, electron-builder 26, ESLint 10, jsdom 29, Playwright 1.63, Vite 8, Vitest 5, TypeScript 7, concurrently 10, `glob`, `unpdf` | 2 | open |
| 14 | The main-chunk gate: 646.4 KB against 450 KB | 9 | open, assessed |
| 15 | The visual and accessibility matrix, and the minimum-window pass | 8.5 | out of reach here |
| 16 | Agent runtimes out of the Electron main process (6.2) and terminal compatibility mode (6.5) | 6 | blocked on re-hosting the Guard and the trust filter |
| 17 | Release notes, rollback instructions and the upgrade path | 10.5 | open |

## Done

Everything else: phases 1 and 3 in full except the recovery UI, phase 4.1/4.3,
phase 5's owner guards, phase 6.1/6.3/6.4, phase 7.1/7.4/7.5, phase 8's tabs and
three retirement rows, phase 9's P02 to P06, phase 10's gates, catalogue and the
real-window suite. See `phase-1-contract.md` through `phase-10-scenarios.md`.
